# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

from __future__ import annotations

import json
import queue
import threading
import time
from types import SimpleNamespace
from unittest.mock import Mock

import app.mqtt as mqtt_module
import paho.mqtt.client as mqtt

from app.mqtt import (
    MQTTClientManager,
    _InboundMQTTMessage,
    _QueuedInboundStateDevice,
    _StatePersistenceJob,
    load_latest_device_state_payload,
)
from app.sql_models import AuthStatus, ConnStatus, DeviceHistory, EventType


class FakeMQTTMessage:
    def __init__(self, *, topic: str, payload: str) -> None:
        self.topic = topic
        self.payload = payload.encode("utf-8")


class FakePublishInfo:
    rc = mqtt.MQTT_ERR_SUCCESS

    def __init__(self) -> None:
        self.waited = False
        self._published = False

    def wait_for_publish(self, timeout: float | None = None) -> None:
        self.waited = True
        self._published = True

    def is_published(self) -> bool:
        return self._published


class FakePahoClient:
    def __init__(self, info: FakePublishInfo) -> None:
        self.info = info
        self.published: list[tuple[str, str, int]] = []

    def publish(self, topic: str, payload: str, qos: int = 0):
        self.published.append((topic, payload, qos))
        return self.info


class FakeQuery:
    def __init__(self, result):
        self.result = result

    def options(self, *_args, **_kwargs):
        return self

    def filter(self, *_args, **_kwargs):
        return self

    def first(self):
        return self.result


class FakeSession:
    def __init__(self, *, device) -> None:
        self.device = device
        self.added: list[object] = []
        self.commits = 0
        self.closed = False
        self.rolled_back = False

    def query(self, model):
        if model is mqtt_module.Device:
            return FakeQuery(self.device)
        raise AssertionError(f"Unexpected model query: {model!r}")

    def add(self, obj) -> None:
        if obj not in self.added:
            self.added.append(obj)

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rolled_back = True

    def close(self) -> None:
        self.closed = True


def test_on_message_enqueues_state_work_outside_callback() -> None:
    manager = MQTTClientManager()
    process_state = Mock()
    manager.process_state_message = process_state

    try:
        manager.on_message(
            None,
            None,
            FakeMQTTMessage(
                topic="econnect/local/device/device-123/state",
                payload='{"kind":"state"}',
            ),
        )
        deadline = time.time() + 2.0
        while process_state.call_count == 0 and time.time() < deadline:
            time.sleep(0.01)

        process_state.assert_called_once()
        assert process_state.call_args.args == ("device-123", '{"kind":"state"}')
        assert process_state.call_args.kwargs["mqtt_callback_entered_at"]
        assert process_state.call_args.kwargs["mqtt_callback_enqueued_at"]
        assert process_state.call_args.kwargs["state_worker_started_at"]
        assert isinstance(process_state.call_args.kwargs["state_worker_index"], int)
        assert process_state.call_args.kwargs["state_queue_depth_at_enqueue"] == 1
        assert process_state.call_args.kwargs["state_pending_device_count_at_enqueue"] == 1
        assert process_state.call_args.kwargs["state_queue_depth_at_worker_start"] == 0
        assert process_state.call_args.kwargs["state_pending_device_count_at_worker_start"] == 1
    finally:
        manager.stop()


def test_publish_command_records_enqueue_and_flush_trace() -> None:
    manager = MQTTClientManager()
    info = FakePublishInfo()
    manager.client = FakePahoClient(info)
    manager.connected = True

    latency_trace: dict[str, object] = {}

    assert manager.publish_command(
        "device-123",
        {"kind": "action", "pin": 3, "value": 156},
        latency_trace=latency_trace,
    ) is True

    assert info.waited is True
    assert latency_trace["paho_publish_requested_at"]
    assert latency_trace["paho_publish_enqueued_at"]
    assert latency_trace["paho_publish_flushed_at"]
    assert latency_trace["mqtt_publish_completed_at"]
    assert latency_trace["paho_publish_rc"] == mqtt.MQTT_ERR_SUCCESS


def test_enqueue_state_message_coalesces_same_device_backlog() -> None:
    manager = MQTTClientManager()
    manager._inbound_worker_count = 1
    manager._inbound_messages = [queue.Queue()]
    manager._pending_state_messages = [{}]
    manager._pending_state_locks = [threading.Lock()]
    manager._queued_state_devices = [set()]

    first_message = _InboundMQTTMessage(
        topic_kind="state",
        device_id="device-123",
        payload_str='{"value":146}',
        mqtt_callback_entered_at="2026-04-18T16:00:00+00:00",
        mqtt_callback_enqueued_at="2026-04-18T16:00:00.001000+00:00",
    )
    second_message = _InboundMQTTMessage(
        topic_kind="state",
        device_id="device-123",
        payload_str='{"value":156}',
        mqtt_callback_entered_at="2026-04-18T16:00:01+00:00",
        mqtt_callback_enqueued_at="2026-04-18T16:00:01.001000+00:00",
    )

    manager._enqueue_state_message(first_message)
    manager._enqueue_state_message(second_message)

    queued = manager._inbound_messages[0].get_nowait()
    assert isinstance(queued, _QueuedInboundStateDevice)
    assert queued.device_id == "device-123"
    assert manager._inbound_messages[0].empty()

    pending_message = manager._take_pending_state_message(0, "device-123")
    assert pending_message is not None
    assert pending_message.topic_kind == second_message.topic_kind
    assert pending_message.device_id == second_message.device_id
    assert pending_message.payload_str == second_message.payload_str
    assert pending_message.mqtt_callback_entered_at == second_message.mqtt_callback_entered_at
    assert pending_message.mqtt_callback_enqueued_at == second_message.mqtt_callback_enqueued_at
    assert pending_message.state_worker_index == 0
    assert pending_message.state_queue_depth_at_enqueue == 1
    assert pending_message.state_pending_device_count_at_enqueue == 1


def test_command_delivery_merges_pending_and_state_latency_trace(monkeypatch) -> None:
    manager = MQTTClientManager()
    manager.pending_commands["cmd-1"] = {
        "device_id": "device-123",
        "pin": 3,
        "value": 156,
        "command_id": "cmd-1",
        "latency_trace": {
            "server": {
                "api_received_at": "2026-04-18T16:00:00+00:00",
                "mqtt_publish_completed_at": "2026-04-18T16:00:00.010000+00:00",
            }
        },
    }
    ws_mock = Mock()
    monkeypatch.setattr("app.mqtt.ws_manager.broadcast_device_event_sync", ws_mock)

    manager.resolve_command_ack(
        "device-123",
        {
            "command_id": "cmd-1",
            "applied": True,
            "latency_trace": {
                "server": {
                    "mqtt_callback_entered_at": "2026-04-18T16:00:00.050000+00:00",
                    "state_worker_started_at": "2026-04-18T16:00:00.051000+00:00",
                    "state_worker_index": 2,
                    "state_queue_depth_at_enqueue": 3,
                    "state_pending_device_count_at_enqueue": 2,
                }
            },
        },
        Mock(),
    )

    payload = ws_mock.call_args.args[3]
    server_trace = payload["latency_trace"]["server"]
    assert server_trace["api_received_at"] == "2026-04-18T16:00:00+00:00"
    assert server_trace["mqtt_publish_completed_at"] == "2026-04-18T16:00:00.010000+00:00"
    assert server_trace["mqtt_callback_entered_at"] == "2026-04-18T16:00:00.050000+00:00"
    assert server_trace["state_worker_started_at"] == "2026-04-18T16:00:00.051000+00:00"
    assert server_trace["state_worker_index"] == 2
    assert server_trace["state_queue_depth_at_enqueue"] == 3
    assert server_trace["state_pending_device_count_at_enqueue"] == 2
    assert server_trace["command_acknowledged_at"]
    assert server_trace["command_delivery_broadcast_at"]


def test_process_state_message_enqueues_persistence_and_keeps_broadcast_trace_early(monkeypatch) -> None:
    manager = MQTTClientManager()
    fake_device = SimpleNamespace(
        device_id="device-123",
        auth_status=AuthStatus.approved,
        conn_status=ConnStatus.online,
        last_seen=None,
        firmware_revision=None,
        firmware_version=None,
        pin_configurations=[],
        room_id=99,
        ip_address=None,
        pairing_requested_at=None,
        name="Trace Device",
    )
    fake_session = FakeSession(device=fake_device)
    ws_mock = Mock()

    monkeypatch.setattr("app.mqtt.SessionLocal", lambda: fake_session)
    monkeypatch.setattr(
        "app.mqtt.load_latest_device_state_payload",
        lambda _db, _device_id: (None, None),
    )
    monkeypatch.setattr(
        "app.mqtt.enrich_reported_mqtt_state",
        lambda _previous_state, _pin_configurations, _state_payload: {
            "kind": "action",
            "pin": 3,
            "value": 1,
            "latency_trace": {"server": {}},
        },
    )
    monkeypatch.setattr("app.mqtt.ws_manager.broadcast_device_event_sync", ws_mock)
    manager.resolve_command_ack = Mock(return_value={"command_id": "cmd-1", "reason": "applied_false"})
    enqueue_persistence_job = Mock()
    manager._enqueue_state_persistence_job = enqueue_persistence_job

    manager.process_state_message(
        "device-123",
        '{"kind":"action","pin":3,"value":1}',
        mqtt_callback_entered_at="2026-04-18T16:00:00.050000+00:00",
        mqtt_callback_enqueued_at="2026-04-18T16:00:00.051000+00:00",
        state_worker_started_at="2026-04-18T16:00:00.052000+00:00",
        state_worker_index=2,
        state_queue_depth_at_enqueue=3,
        state_pending_device_count_at_enqueue=2,
        state_queue_depth_at_worker_start=1,
        state_pending_device_count_at_worker_start=1,
    )

    assert enqueue_persistence_job.call_count == 1
    persistence_job = enqueue_persistence_job.call_args.args[0]
    assert isinstance(persistence_job, _StatePersistenceJob)
    payload = persistence_job.state_history_payload
    server_trace = payload["latency_trace"]["server"]

    assert server_trace["state_worker_index"] == 2
    assert server_trace["state_queue_depth_at_enqueue"] == 3
    assert server_trace["state_pending_device_count_at_enqueue"] == 2
    assert server_trace["state_queue_depth_at_worker_start"] == 1
    assert server_trace["state_pending_device_count_at_worker_start"] == 1
    assert server_trace["state_history_recorded_at"]
    assert server_trace["device_state_broadcast_at"]
    assert "post_broadcast_work_started_at" not in server_trace
    assert persistence_job.command_failure_payload == {"command_id": "cmd-1", "reason": "applied_false"}

    broadcast_payload = next(
        call.args[3]
        for call in ws_mock.call_args_list
        if call.args[:3] == ("device_state", "device-123", 99)
    )
    broadcast_server_trace = broadcast_payload["latency_trace"]["server"]
    assert broadcast_server_trace["device_state_broadcast_at"]
    assert "post_broadcast_work_started_at" not in broadcast_server_trace
    assert "state_worker_completed_at" not in broadcast_server_trace
    cached_state = manager.latest_reported_state("device-123")
    assert cached_state == broadcast_payload
    assert fake_session.commits == 0
    assert fake_session.closed is True


def test_process_state_message_carries_board_timing_trace_into_broadcast(monkeypatch) -> None:
    manager = MQTTClientManager()
    fake_device = SimpleNamespace(
        device_id="device-123",
        auth_status=AuthStatus.approved,
        conn_status=ConnStatus.online,
        last_seen=None,
        firmware_revision=None,
        firmware_version=None,
        pin_configurations=[],
        room_id=99,
        ip_address=None,
        pairing_requested_at=None,
        name="Trace Device",
    )
    fake_session = FakeSession(device=fake_device)
    ws_mock = Mock()

    monkeypatch.setattr("app.mqtt.SessionLocal", lambda: fake_session)
    monkeypatch.setattr(
        "app.mqtt.load_latest_device_state_payload",
        lambda _db, _device_id: (None, None),
    )
    monkeypatch.setattr(
        "app.mqtt.enrich_reported_mqtt_state",
        lambda _previous_state, _pin_configurations, _state_payload: {
            "kind": "state",
            "pin": 3,
            "value": 7195,
            "latency_trace": {"server": {}},
        },
    )
    monkeypatch.setattr("app.mqtt.ws_manager.broadcast_device_event_sync", ws_mock)
    manager.resolve_command_ack = Mock(return_value=None)
    manager._enqueue_state_persistence_job = Mock()

    manager.process_state_message(
        "device-123",
        json.dumps(
            {
                "kind": "state",
                "pin": 3,
                "value": 7195,
                "board_timing": {
                    "state_published_at": "2026-04-27T03:00:00.000000+00:00",
                },
            }
        ),
        mqtt_callback_entered_at="2026-04-27T03:00:00.010000+00:00",
        mqtt_callback_enqueued_at="2026-04-27T03:00:00.011000+00:00",
        state_worker_started_at="2026-04-27T03:00:00.012000+00:00",
        state_worker_index=1,
        state_queue_depth_at_enqueue=1,
        state_pending_device_count_at_enqueue=1,
        state_queue_depth_at_worker_start=0,
        state_pending_device_count_at_worker_start=0,
    )

    broadcast_payload = next(
        call.args[3]
        for call in ws_mock.call_args_list
        if call.args[:3] == ("device_state", "device-123", 99)
    )
    assert broadcast_payload["latency_trace"]["board"]["state_published_at"] == "2026-04-27T03:00:00.000000+00:00"


def test_persist_state_job_records_worker_tail_trace(monkeypatch) -> None:
    manager = MQTTClientManager()
    fake_device = SimpleNamespace(
        device_id="device-123",
        auth_status=AuthStatus.approved,
        conn_status=ConnStatus.offline,
        last_seen=None,
        firmware_revision=None,
        firmware_version=None,
        pin_configurations=[],
        room_id=99,
        ip_address=None,
        pairing_requested_at=None,
        name="Trace Device",
    )
    fake_session = FakeSession(device=fake_device)

    monkeypatch.setattr("app.mqtt.SessionLocal", lambda: fake_session)
    monkeypatch.setattr("app.mqtt.process_state_event_for_automations", lambda *args, **kwargs: [])
    monkeypatch.setattr("app.mqtt.create_system_log", lambda *args, **kwargs: None)
    monkeypatch.setattr("app.mqtt._reconcile_ota_jobs", lambda *args, **kwargs: "noop")

    manager._persist_state_job(
        _StatePersistenceJob(
            device_id="device-123",
            state_sequence=1,
            observed_at=mqtt_module.datetime.now(mqtt_module.timezone.utc),
            state_history_payload={
                "kind": "action",
                "pin": 3,
                "value": 1,
                "latency_trace": {"server": {"device_state_broadcast_at": "2026-04-19T10:00:00+00:00"}},
            },
            previous_state_payload=None,
            enriched_state_payload={
                "kind": "action",
                "pin": 3,
                "value": 1,
            },
            was_offline=True,
            device_name="Trace Device",
        )
    )

    state_history = next(
        obj
        for obj in fake_session.added
        if isinstance(obj, DeviceHistory) and obj.event_type == EventType.state_change
    )
    payload = json.loads(state_history.payload)
    server_trace = payload["latency_trace"]["server"]
    assert server_trace["post_broadcast_work_started_at"]
    assert server_trace["automation_started_at"]
    assert server_trace["automation_completed_at"]
    assert server_trace["db_commit_completed_at"]
    assert server_trace["state_commit_completed_at"]
    assert server_trace["state_worker_completed_at"]
    assert fake_session.commits == 2
    assert fake_session.closed is True

    cached_state = manager.latest_reported_state("device-123")
    assert cached_state is not None
    assert cached_state["latency_trace"]["server"]["state_worker_completed_at"]


def test_state_cache_keeps_newer_sequence() -> None:
    manager = MQTTClientManager()

    manager._remember_latest_reported_state(
        "device-123",
        {"pin": 3, "value": 1},
        state_sequence=2,
    )
    manager._remember_latest_reported_state(
        "device-123",
        {"pin": 3, "value": 0},
        state_sequence=1,
    )
    manager._remember_latest_device_runtime_metadata(
        "device-123",
        {"conn_status": ConnStatus.online},
        state_sequence=2,
    )
    manager._remember_latest_device_runtime_metadata(
        "device-123",
        {"conn_status": ConnStatus.offline},
        state_sequence=1,
    )

    assert manager.latest_reported_state("device-123") == {"pin": 3, "value": 1}
    assert manager.latest_device_runtime_metadata("device-123") == {"conn_status": ConnStatus.online}


def test_load_latest_device_state_payload_prefers_runtime_cache(monkeypatch) -> None:
    manager = MQTTClientManager()
    manager._remember_latest_reported_state(
        "device-123",
        {"pin": 3, "value": 1},
        state_sequence=1,
    )
    monkeypatch.setattr("app.mqtt.mqtt_manager", manager)

    db = Mock()
    latest_state_record, payload = load_latest_device_state_payload(db, "device-123")

    assert latest_state_record is None
    assert payload == {"pin": 3, "value": 1}
    db.query.assert_not_called()
