# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

"""
Unit tests for server/app/services/automation_runtime.py

Coverage:
- Graph validation (trigger, condition, action node normalisation)
- Trigger matching (device_state, device_value, device_on_off_event, time_schedule)
- Condition evaluation (state_equals, numeric_compare with all operators)
- Action dispatch (set_output, set_value, missing/unapproved device)
- Full graph execution via _evaluate_graph_execution
- High-level entry points: process_state_event_for_automations,
  process_time_trigger_automations, trigger_automation_manually
- compute_next_time_trigger_run and schedule helpers
- Edge cases: empty graph, missing device, disabled automation, condition miss noop
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.services.automation_runtime import (
    AutomationGraphValidationError,
    _decode_history_payload,
    _evaluate_condition_node,
    _evaluate_graph_execution,
    _extract_binary_value,
    _extract_metric_value,
    _extract_pin_snapshot,
    _is_condition_miss_noop,
    _normalize_binary_state,
    _state_trigger_value_changed,
    _trigger_matches_state_event,
    compute_next_time_trigger_run,
    deserialize_automation_graph,
    normalize_automation_graph,
    process_state_event_for_automations,
    process_time_trigger_automations,
    serialize_automation,
    sync_automation_schedule_projection,
    trigger_automation_manually,
)
from app.sql_models import (
    AccountType,
    AuthStatus,
    Automation,
    AutomationExecutionLog,
    ConnStatus,
    Device,
    DeviceHistory,
    EventType,
    ExecutionStatus,
    Household,
    HouseholdMembership,
    HouseholdRole,
    PinConfiguration,
    PinMode,
    User,
)

# ---------------------------------------------------------------------------
# Test database setup
# ---------------------------------------------------------------------------

SQLALCHEMY_DATABASE_URL = "sqlite://"

_engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(
    autocommit=False, autoflush=False, bind=_engine, expire_on_commit=False
)


@pytest.fixture(autouse=True)
def fresh_db():
    """Recreate all tables for every test."""
    Base.metadata.drop_all(bind=_engine)
    Base.metadata.create_all(bind=_engine)
    yield
    Base.metadata.drop_all(bind=_engine)


@pytest.fixture()
def db():
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_device(
    db,
    *,
    device_id: str = "dev-001",
    name: str = "Test Device",
    auth_status: AuthStatus = AuthStatus.approved,
    owner_id: int,
) -> Device:
    device = Device(
        device_id=device_id,
        mac_address=f"AA:BB:CC:DD:{device_id[-2:]}:01",
        name=name,
        owner_id=owner_id,
        auth_status=auth_status,
        conn_status=ConnStatus.online,
        mode="library",
    )
    db.add(device)
    db.flush()
    return device


def _make_user(db) -> User:
    user = User(
        fullname="Test User",
        username="test-user",
        authentication="hashed",
        account_type=AccountType.admin,
    )
    db.add(user)
    db.flush()
    return user


def _make_automation(
    db,
    *,
    creator_id: int,
    graph: dict,
    name: str = "Test Automation",
    is_enabled: bool = True,
    schedule_type: str = "manual",
    schedule_hour: int | None = None,
    schedule_minute: int | None = None,
    next_run_at: datetime | None = None,
    timezone: str | None = None,
) -> Automation:
    automation = Automation(
        creator_id=creator_id,
        name=name,
        script_code=json.dumps(graph),
        is_enabled=is_enabled,
        schedule_type=schedule_type,
        schedule_hour=schedule_hour,
        schedule_minute=schedule_minute,
        next_run_at=next_run_at,
        timezone=timezone,
    )
    db.add(automation)
    db.flush()
    return automation


def _add_state_history(db, *, device_id: str, payload: dict) -> DeviceHistory:
    row = DeviceHistory(
        device_id=device_id,
        event_type=EventType.state_change,
        payload=json.dumps(payload),
        changed_by=None,
    )
    db.add(row)
    db.flush()
    return row


_NO_OP_PUBLISH = MagicMock(return_value=True)

# Reusable graph fragments
def _simple_device_state_graph(
    trigger_device: str = "src",
    action_device: str = "dst",
    trigger_pin: int = 4,
    action_pin: int = 12,
) -> dict:
    return {
        "nodes": [
            {
                "id": "t1",
                "type": "trigger",
                "kind": "device_state",
                "config": {"device_id": trigger_device, "pin": trigger_pin},
            },
            {
                "id": "a1",
                "type": "action",
                "kind": "set_output",
                "config": {"device_id": action_device, "pin": action_pin, "value": 1},
            },
        ],
        "edges": [
            {
                "source_node_id": "t1",
                "source_port": "event_out",
                "target_node_id": "a1",
                "target_port": "event_in",
            }
        ],
    }


def _graph_with_condition(
    trigger_device: str = "src",
    action_device: str = "dst",
    cond_device: str = "src",
    expected: str = "on",
) -> dict:
    return {
        "nodes": [
            {
                "id": "t1",
                "type": "trigger",
                "kind": "device_state",
                "config": {"device_id": trigger_device, "pin": 4},
            },
            {
                "id": "c1",
                "type": "condition",
                "kind": "state_equals",
                "config": {"device_id": cond_device, "pin": 4, "expected": expected},
            },
            {
                "id": "a1",
                "type": "action",
                "kind": "set_output",
                "config": {"device_id": action_device, "pin": 12, "value": 1},
            },
        ],
        "edges": [
            {
                "source_node_id": "t1",
                "source_port": "event_out",
                "target_node_id": "c1",
                "target_port": "event_in",
            },
            {
                "source_node_id": "c1",
                "source_port": "pass_out",
                "target_node_id": "a1",
                "target_port": "event_in",
            },
        ],
    }


def _time_schedule_graph(
    hour: int = 8,
    minute: int = 0,
    weekdays: list | None = None,
    action_device: str = "dst",
) -> dict:
    return {
        "nodes": [
            {
                "id": "t1",
                "type": "trigger",
                "kind": "time_schedule",
                "config": {"hour": hour, "minute": minute, "weekdays": weekdays or []},
            },
            {
                "id": "a1",
                "type": "action",
                "kind": "set_output",
                "config": {"device_id": action_device, "pin": 12, "value": 1},
            },
        ],
        "edges": [
            {
                "source_node_id": "t1",
                "source_port": "event_out",
                "target_node_id": "a1",
                "target_port": "event_in",
            }
        ],
    }


# ============================================================
# Section 1: Pure utility function tests
# ============================================================


class TestDecodeHistoryPayload:
    def test_valid_json_dict(self):
        assert _decode_history_payload('{"pin": 4, "value": 1}') == {"pin": 4, "value": 1}

    def test_valid_json_non_dict_returns_none(self):
        assert _decode_history_payload("[1,2,3]") is None

    def test_empty_string_returns_none(self):
        assert _decode_history_payload("") is None

    def test_none_returns_none(self):
        assert _decode_history_payload(None) is None

    def test_python_literal_fallback(self):
        result = _decode_history_payload("{'key': 'val'}")
        assert result == {"key": "val"}

    def test_garbage_returns_none(self):
        assert _decode_history_payload("not json at all!!!") is None


class TestNormalizeBinaryState:
    def test_true_bool(self):
        assert _normalize_binary_state(True) is True

    def test_false_bool(self):
        assert _normalize_binary_state(False) is False

    def test_positive_int_is_true(self):
        assert _normalize_binary_state(1) is True

    def test_zero_int_is_false(self):
        assert _normalize_binary_state(0) is False

    def test_on_string(self):
        assert _normalize_binary_state("on") is True

    def test_off_string(self):
        assert _normalize_binary_state("off") is False

    def test_high_string(self):
        assert _normalize_binary_state("HIGH") is True

    def test_low_string(self):
        assert _normalize_binary_state("LOW") is False

    def test_unknown_string_returns_none(self):
        assert _normalize_binary_state("maybe") is None


class TestExtractPinSnapshot:
    def test_pins_list_finds_correct_pin(self):
        payload = {"pins": [{"pin": 4, "value": 1}, {"pin": 5, "value": 0}]}
        result = _extract_pin_snapshot(payload, 4)
        assert result == {"pin": 4, "value": 1}

    def test_pins_list_pin_not_found_returns_none(self):
        payload = {"pins": [{"pin": 4, "value": 1}]}
        assert _extract_pin_snapshot(payload, 99) is None

    def test_flat_single_pin_payload(self):
        payload = {"pin": 4, "value": 1, "mode": "OUTPUT"}
        result = _extract_pin_snapshot(payload, 4)
        assert result is not None
        assert result["value"] == 1
        assert result["mode"] == "OUTPUT"

    def test_flat_wrong_pin_returns_none(self):
        payload = {"pin": 4, "value": 1}
        assert _extract_pin_snapshot(payload, 5) is None

    def test_none_payload_returns_none(self):
        assert _extract_pin_snapshot(None, 4) is None


class TestExtractBinaryValue:
    def test_value_on(self):
        assert _extract_binary_value({"value": "on"}) is True

    def test_value_off(self):
        assert _extract_binary_value({"value": "off"}) is False

    def test_value_1_int(self):
        assert _extract_binary_value({"value": 1}) is True

    def test_value_0_int(self):
        assert _extract_binary_value({"value": 0}) is False

    def test_none_snapshot_returns_none(self):
        assert _extract_binary_value(None) is None

    def test_brightness_fallback(self):
        assert _extract_binary_value({"brightness": "on"}) is True


class TestExtractMetricValue:
    def test_temperature_metric_direct(self):
        assert _extract_metric_value({"temperature": 25.5}, metric="temperature") == 25.5

    def test_humidity_metric_direct(self):
        assert _extract_metric_value({"humidity": 60.0}, metric="humidity") == 60.0

    def test_no_metric_uses_value_key(self):
        assert _extract_metric_value({"value": 42}, metric=None) == 42.0

    def test_temperature_legacy_value_divided_by_10(self):
        # Legacy: if no "temperature" key, use value/10
        result = _extract_metric_value({"value": 250}, metric="temperature")
        assert result == 25.0

    def test_missing_key_returns_none(self):
        assert _extract_metric_value({"value": 5}, metric="humidity") is None


class TestStateTriggerValueChanged:
    def test_no_previous_snapshot_always_true(self):
        snapshot = {"value": 1}
        assert _state_trigger_value_changed(
            "device_state", current_snapshot=snapshot, previous_snapshot=None
        )

    def test_binary_same_value_returns_false(self):
        snap = {"value": 1}
        assert not _state_trigger_value_changed(
            "device_on_off_event",
            current_snapshot=snap,
            previous_snapshot=snap,
        )

    def test_binary_different_value_returns_true(self):
        cur = {"value": 1}
        prev = {"value": 0}
        assert _state_trigger_value_changed(
            "device_on_off_event", current_snapshot=cur, previous_snapshot=prev
        )

    def test_numeric_same_value_returns_false(self):
        snap = {"value": 25}
        assert not _state_trigger_value_changed(
            "device_value", current_snapshot=snap, previous_snapshot=snap, metric=None
        )

    def test_numeric_changed_value_returns_true(self):
        cur = {"value": 30}
        prev = {"value": 25}
        assert _state_trigger_value_changed(
            "device_value", current_snapshot=cur, previous_snapshot=prev, metric=None
        )


# ============================================================
# Section 2: Graph validation tests
# ============================================================


class TestNormalizeAutomationGraph:
    def test_valid_minimal_graph(self):
        graph = _simple_device_state_graph()
        result = normalize_automation_graph(graph)
        assert len(result["nodes"]) == 2
        assert len(result["edges"]) == 1

    def test_missing_nodes_raises(self):
        with pytest.raises(AutomationGraphValidationError, match="nodes and edges"):
            normalize_automation_graph({"nodes": [], "edges": None})

    def test_no_trigger_raises(self):
        bad_graph = {
            "nodes": [
                {
                    "id": "a1",
                    "type": "action",
                    "kind": "set_output",
                    "config": {"device_id": "x", "pin": 4, "value": 1},
                }
            ],
            "edges": [],
        }
        with pytest.raises(AutomationGraphValidationError, match="exactly one trigger"):
            normalize_automation_graph(bad_graph)

    def test_no_action_raises(self):
        bad_graph = {
            "nodes": [
                {
                    "id": "t1",
                    "type": "trigger",
                    "kind": "device_state",
                    "config": {"device_id": "x", "pin": 4},
                }
            ],
            "edges": [],
        }
        with pytest.raises(AutomationGraphValidationError, match="at least one action"):
            normalize_automation_graph(bad_graph)

    def test_duplicate_node_ids_raises(self):
        bad_graph = {
            "nodes": [
                {
                    "id": "n1",
                    "type": "trigger",
                    "kind": "device_state",
                    "config": {"device_id": "x", "pin": 4},
                },
                {
                    "id": "n1",
                    "type": "action",
                    "kind": "set_output",
                    "config": {"device_id": "x", "pin": 12, "value": 1},
                },
            ],
            "edges": [
                {
                    "source_node_id": "n1",
                    "source_port": "event_out",
                    "target_node_id": "n1",
                    "target_port": "event_in",
                }
            ],
        }
        with pytest.raises(AutomationGraphValidationError, match="unique"):
            normalize_automation_graph(bad_graph)

    def test_cycle_raises(self):
        # Build a graph where condition loops back to itself (self-edge)
        bad_graph = {
            "nodes": [
                {
                    "id": "t1",
                    "type": "trigger",
                    "kind": "device_state",
                    "config": {"device_id": "x", "pin": 4},
                },
                {
                    "id": "c1",
                    "type": "condition",
                    "kind": "state_equals",
                    "config": {"device_id": "x", "pin": 4, "expected": "on"},
                },
                {
                    "id": "a1",
                    "type": "action",
                    "kind": "set_output",
                    "config": {"device_id": "y", "pin": 12, "value": 1},
                },
            ],
            "edges": [
                {
                    "source_node_id": "t1",
                    "source_port": "event_out",
                    "target_node_id": "c1",
                    "target_port": "event_in",
                },
                {
                    "source_node_id": "c1",
                    "source_port": "pass_out",
                    "target_node_id": "a1",
                    "target_port": "event_in",
                },
                # This edge creates an unreachable cycle
                {
                    "source_node_id": "c1",
                    "source_port": "fail_out",
                    "target_node_id": "c1",
                    "target_port": "event_in",
                },
            ],
        }
        with pytest.raises(AutomationGraphValidationError):
            normalize_automation_graph(bad_graph)

    def test_unsupported_trigger_kind_raises(self):
        bad_graph = {
            "nodes": [
                {
                    "id": "t1",
                    "type": "trigger",
                    "kind": "unknown_kind",
                    "config": {"device_id": "x", "pin": 4},
                },
                {
                    "id": "a1",
                    "type": "action",
                    "kind": "set_output",
                    "config": {"device_id": "x", "pin": 12, "value": 1},
                },
            ],
            "edges": [
                {
                    "source_node_id": "t1",
                    "source_port": "event_out",
                    "target_node_id": "a1",
                    "target_port": "event_in",
                }
            ],
        }
        with pytest.raises(AutomationGraphValidationError, match="Unsupported trigger"):
            normalize_automation_graph(bad_graph)

    def test_time_trigger_validates_hour_range(self):
        bad_graph = _time_schedule_graph(hour=25, minute=0)
        with pytest.raises(AutomationGraphValidationError, match="hour"):
            normalize_automation_graph(bad_graph)

    def test_time_trigger_validates_minute_range(self):
        bad_graph = _time_schedule_graph(hour=8, minute=61)
        with pytest.raises(AutomationGraphValidationError, match="minute"):
            normalize_automation_graph(bad_graph)

    def test_state_equals_requires_on_or_off(self):
        bad_graph = {
            "nodes": [
                {
                    "id": "t1",
                    "type": "trigger",
                    "kind": "device_state",
                    "config": {"device_id": "x", "pin": 4},
                },
                {
                    "id": "c1",
                    "type": "condition",
                    "kind": "state_equals",
                    "config": {"device_id": "x", "pin": 4, "expected": "maybe"},
                },
                {
                    "id": "a1",
                    "type": "action",
                    "kind": "set_output",
                    "config": {"device_id": "x", "pin": 12, "value": 1},
                },
            ],
            "edges": [
                {
                    "source_node_id": "t1",
                    "source_port": "event_out",
                    "target_node_id": "c1",
                    "target_port": "event_in",
                },
                {
                    "source_node_id": "c1",
                    "source_port": "pass_out",
                    "target_node_id": "a1",
                    "target_port": "event_in",
                },
            ],
        }
        with pytest.raises(AutomationGraphValidationError, match="on.*off|off.*on"):
            normalize_automation_graph(bad_graph)

    def test_set_output_invalid_value_raises(self):
        bad_graph = {
            "nodes": [
                {
                    "id": "t1",
                    "type": "trigger",
                    "kind": "device_state",
                    "config": {"device_id": "x", "pin": 4},
                },
                {
                    "id": "a1",
                    "type": "action",
                    "kind": "set_output",
                    "config": {"device_id": "x", "pin": 12, "value": 5},
                },
            ],
            "edges": [
                {
                    "source_node_id": "t1",
                    "source_port": "event_out",
                    "target_node_id": "a1",
                    "target_port": "event_in",
                }
            ],
        }
        with pytest.raises(AutomationGraphValidationError, match="0 or 1"):
            normalize_automation_graph(bad_graph)

    def test_string_json_graph_is_accepted(self):
        graph = _simple_device_state_graph()
        result = normalize_automation_graph(json.dumps(graph))
        assert result["nodes"]

    def test_invalid_json_string_raises(self):
        with pytest.raises(AutomationGraphValidationError, match="valid JSON"):
            normalize_automation_graph("not json {")

    def test_time_trigger_weekdays_normalized(self):
        graph = _time_schedule_graph(hour=6, minute=30, weekdays=["Mon", "WED", "fri"])
        result = normalize_automation_graph(graph)
        trigger = next(n for n in result["nodes"] if n["type"] == "trigger")
        assert trigger["config"]["weekdays"] == ["mon", "wed", "fri"]

    def test_disconnected_trigger_raises(self):
        # Trigger has no outgoing edge
        bad_graph = {
            "nodes": [
                {
                    "id": "t1",
                    "type": "trigger",
                    "kind": "device_state",
                    "config": {"device_id": "x", "pin": 4},
                },
                {
                    "id": "a1",
                    "type": "action",
                    "kind": "set_output",
                    "config": {"device_id": "x", "pin": 12, "value": 1},
                },
            ],
            "edges": [],
        }
        with pytest.raises(AutomationGraphValidationError):
            normalize_automation_graph(bad_graph)


# ============================================================
# Section 3: Trigger matching tests
# ============================================================


class TestTriggerMatchesStateEvent:
    def _make_graph(self, kind: str = "device_state", device_id: str = "dev") -> dict:
        return deserialize_automation_graph(
            json.dumps(_simple_device_state_graph(trigger_device=device_id))
            if kind == "device_state"
            else json.dumps(
                {
                    "nodes": [
                        {
                            "id": "t1",
                            "type": "trigger",
                            "kind": kind,
                            "config": {"device_id": device_id, "pin": 4},
                        },
                        {
                            "id": "a1",
                            "type": "action",
                            "kind": "set_output",
                            "config": {"device_id": "dst", "pin": 12, "value": 1},
                        },
                    ],
                    "edges": [
                        {
                            "source_node_id": "t1",
                            "source_port": "event_out",
                            "target_node_id": "a1",
                            "target_port": "event_in",
                        }
                    ],
                }
            )
        )

    def test_device_state_trigger_matching_device(self):
        graph = self._make_graph("device_state", "dev")
        payload = {"pins": [{"pin": 4, "value": 1}]}
        assert _trigger_matches_state_event(graph, device_id="dev", state_payload=payload)

    def test_device_state_trigger_wrong_device_no_match(self):
        graph = self._make_graph("device_state", "dev")
        payload = {"pins": [{"pin": 4, "value": 1}]}
        assert not _trigger_matches_state_event(graph, device_id="other", state_payload=payload)

    def test_device_state_trigger_no_pin_data_no_match(self):
        graph = self._make_graph("device_state", "dev")
        payload = {"pins": []}
        assert not _trigger_matches_state_event(graph, device_id="dev", state_payload=payload)

    def test_time_trigger_never_matches_state_event(self):
        graph = deserialize_automation_graph(json.dumps(_time_schedule_graph()))
        payload = {"pins": [{"pin": 4, "value": 1}]}
        assert not _trigger_matches_state_event(graph, device_id="dst", state_payload=payload)

    def test_device_on_off_matches_when_value_changed(self):
        graph = self._make_graph("device_on_off_event", "dev")
        cur = {"pins": [{"pin": 4, "value": 1}]}
        prev = {"pins": [{"pin": 4, "value": 0}]}
        assert _trigger_matches_state_event(
            graph, device_id="dev", state_payload=cur, previous_state_payload=prev
        )

    def test_device_on_off_no_match_when_same_value(self):
        graph = self._make_graph("device_on_off_event", "dev")
        cur = {"pins": [{"pin": 4, "value": 1}]}
        prev = {"pins": [{"pin": 4, "value": 1}]}
        assert not _trigger_matches_state_event(
            graph, device_id="dev", state_payload=cur, previous_state_payload=prev
        )

    def test_device_value_trigger_matches_when_numeric_changed(self):
        graph = deserialize_automation_graph(
            json.dumps(
                {
                    "nodes": [
                        {
                            "id": "t1",
                            "type": "trigger",
                            "kind": "device_value",
                            "config": {"device_id": "sensor", "pin": 34},
                        },
                        {
                            "id": "a1",
                            "type": "action",
                            "kind": "set_output",
                            "config": {"device_id": "dst", "pin": 12, "value": 1},
                        },
                    ],
                    "edges": [
                        {
                            "source_node_id": "t1",
                            "source_port": "event_out",
                            "target_node_id": "a1",
                            "target_port": "event_in",
                        }
                    ],
                }
            )
        )
        cur = {"pins": [{"pin": 34, "value": 30}]}
        prev = {"pins": [{"pin": 34, "value": 25}]}
        assert _trigger_matches_state_event(
            graph, device_id="sensor", state_payload=cur, previous_state_payload=prev
        )


# ============================================================
# Section 4: Condition evaluation tests
# ============================================================


class TestEvaluateConditionNode:
    def _state_equals_node(
        self, expected: str = "on", device_id: str = "dev", pin: int = 4
    ) -> dict:
        return {
            "id": "c1",
            "type": "condition",
            "kind": "state_equals",
            "config": {"device_id": device_id, "pin": pin, "expected": expected},
        }

    def _numeric_compare_node(
        self,
        operator: str = "gt",
        value: float = 20.0,
        secondary_value: float | None = None,
        metric: str | None = None,
        device_id: str = "dev",
        pin: int = 4,
    ) -> dict:
        config: dict[str, Any] = {
            "device_id": device_id,
            "pin": pin,
            "operator": operator,
            "value": value,
        }
        if secondary_value is not None:
            config["secondary_value"] = secondary_value
        if metric is not None:
            config["metric"] = metric
        return {"id": "c1", "type": "condition", "kind": "numeric_compare", "config": config}

    def _payloads(self, value: Any, pin: int = 4) -> dict:
        return {"dev": {"pins": [{"pin": pin, "value": value}]}}

    # --- state_equals ---

    def test_state_equals_on_passes_when_on(self):
        node = self._state_equals_node("on")
        result, _ = _evaluate_condition_node(node, state_payloads=self._payloads(1))
        assert result is True

    def test_state_equals_on_fails_when_off(self):
        node = self._state_equals_node("on")
        result, _ = _evaluate_condition_node(node, state_payloads=self._payloads(0))
        assert result is False

    def test_state_equals_off_passes_when_off(self):
        node = self._state_equals_node("off")
        result, _ = _evaluate_condition_node(node, state_payloads=self._payloads(0))
        assert result is True

    def test_state_equals_no_live_state_returns_false(self):
        node = self._state_equals_node("on")
        result, msg = _evaluate_condition_node(node, state_payloads={})
        assert result is False
        assert "no live state" in msg

    def test_state_equals_string_value(self):
        node = self._state_equals_node("on")
        payloads = {"dev": {"pins": [{"pin": 4, "value": "on"}]}}
        result, _ = _evaluate_condition_node(node, state_payloads=payloads)
        assert result is True

    # --- numeric_compare ---

    def test_numeric_gt_passes_when_greater(self):
        node = self._numeric_compare_node("gt", 20.0)
        result, _ = _evaluate_condition_node(node, state_payloads=self._payloads(25))
        assert result is True

    def test_numeric_gt_fails_when_equal(self):
        node = self._numeric_compare_node("gt", 20.0)
        result, _ = _evaluate_condition_node(node, state_payloads=self._payloads(20))
        assert result is False

    def test_numeric_gte_passes_when_equal(self):
        node = self._numeric_compare_node("gte", 20.0)
        result, _ = _evaluate_condition_node(node, state_payloads=self._payloads(20))
        assert result is True

    def test_numeric_lt_passes_when_less(self):
        node = self._numeric_compare_node("lt", 30.0)
        result, _ = _evaluate_condition_node(node, state_payloads=self._payloads(25))
        assert result is True

    def test_numeric_lte_passes_when_equal(self):
        node = self._numeric_compare_node("lte", 25.0)
        result, _ = _evaluate_condition_node(node, state_payloads=self._payloads(25))
        assert result is True

    def test_numeric_between_passes_when_in_range(self):
        node = self._numeric_compare_node("between", 10.0, secondary_value=30.0)
        result, _ = _evaluate_condition_node(node, state_payloads=self._payloads(20))
        assert result is True

    def test_numeric_between_fails_when_outside(self):
        node = self._numeric_compare_node("between", 10.0, secondary_value=30.0)
        result, _ = _evaluate_condition_node(node, state_payloads=self._payloads(35))
        assert result is False

    def test_numeric_no_numeric_value_returns_false(self):
        node = self._numeric_compare_node("gt", 10.0)
        payloads = {"dev": {"pins": [{"pin": 4, "value": "unknown"}]}}
        result, msg = _evaluate_condition_node(node, state_payloads=payloads)
        assert result is False

    def test_numeric_temperature_metric(self):
        node = self._numeric_compare_node("gt", 20.0, metric="temperature")
        payloads = {"dev": {"pins": [{"pin": 4, "temperature": 25.0}]}}
        result, _ = _evaluate_condition_node(node, state_payloads=payloads)
        assert result is True

    def test_numeric_humidity_metric(self):
        node = self._numeric_compare_node("lt", 70.0, metric="humidity")
        payloads = {"dev": {"pins": [{"pin": 4, "humidity": 60.0}]}}
        result, _ = _evaluate_condition_node(node, state_payloads=payloads)
        assert result is True


# ============================================================
# Section 5: _evaluate_graph_execution tests (core engine)
# ============================================================


class TestEvaluateGraphExecution:
    """Tests for the internal graph walker that produces AutomationExecutionLog."""

    def _setup_exec(self, db, graph: dict, state_payloads: dict | None = None):
        user = _make_user(db)
        automation = _make_automation(db, creator_id=user.user_id, graph=graph)
        db.commit()
        publish_command = MagicMock(return_value=True)

        # Build approved devices based on graph action configs
        device_lookup: dict[str, Any] = {}
        for node in graph["nodes"]:
            if node["type"] == "action" and node["kind"] != "send_telegram_notification":
                did = node["config"]["device_id"]
                device = Device(
                    device_id=did,
                    mac_address=f"AA:{did[:2].upper()}:00:00:00:01",
                    name=did,
                    owner_id=user.user_id,
                    auth_status=AuthStatus.approved,
                    conn_status=ConnStatus.online,
                    mode="library",
                )
                db.add(device)
                device_lookup[did] = device
        db.commit()

        normalized_graph = deserialize_automation_graph(json.dumps(graph))
        return automation, normalized_graph, publish_command, device_lookup, state_payloads or {}

    def test_action_without_condition_succeeds(self, db):
        graph = _simple_device_state_graph(action_device="dst")
        automation, normalized_graph, publish_command, device_lookup, state_payloads = (
            self._setup_exec(db, graph)
        )
        log = _evaluate_graph_execution(
            db,
            automation=automation,
            normalized_graph=normalized_graph,
            trigger_source="device_state",
            state_payloads=state_payloads,
            device_lookup=device_lookup,
            publish_command=publish_command,
        )
        assert log.status == ExecutionStatus.success
        publish_command.assert_called_once()

    def test_condition_pass_runs_action(self, db):
        graph = _graph_with_condition(
            trigger_device="src", action_device="dst", cond_device="src", expected="on"
        )
        # src device must exist in lookup for condition
        user = _make_user(db)
        automation = _make_automation(db, creator_id=user.user_id, graph=graph)
        src_device = Device(
            device_id="src",
            mac_address="AA:BB:CC:DD:EE:01",
            name="src",
            owner_id=user.user_id,
            auth_status=AuthStatus.approved,
            conn_status=ConnStatus.online,
            mode="library",
        )
        dst_device = Device(
            device_id="dst",
            mac_address="AA:BB:CC:DD:EE:02",
            name="dst",
            owner_id=user.user_id,
            auth_status=AuthStatus.approved,
            conn_status=ConnStatus.online,
            mode="library",
        )
        db.add_all([src_device, dst_device])
        db.commit()

        state_payloads = {"src": {"pins": [{"pin": 4, "value": 1}]}}
        device_lookup = {"src": src_device, "dst": dst_device}
        normalized_graph = deserialize_automation_graph(json.dumps(graph))
        publish_command = MagicMock(return_value=True)

        log = _evaluate_graph_execution(
            db,
            automation=automation,
            normalized_graph=normalized_graph,
            trigger_source="device_state",
            state_payloads=state_payloads,
            device_lookup=device_lookup,
            publish_command=publish_command,
        )
        assert log.status == ExecutionStatus.success
        publish_command.assert_called_once()

    def test_condition_fail_skips_action(self, db):
        graph = _graph_with_condition(expected="on")
        user = _make_user(db)
        automation = _make_automation(db, creator_id=user.user_id, graph=graph)
        src_device = Device(
            device_id="src",
            mac_address="AA:11:00:00:00:01",
            name="src",
            owner_id=user.user_id,
            auth_status=AuthStatus.approved,
            conn_status=ConnStatus.online,
            mode="library",
        )
        dst_device = Device(
            device_id="dst",
            mac_address="AA:22:00:00:00:01",
            name="dst",
            owner_id=user.user_id,
            auth_status=AuthStatus.approved,
            conn_status=ConnStatus.online,
            mode="library",
        )
        db.add_all([src_device, dst_device])
        db.commit()

        # state is "off" but condition expects "on" -> fail branch, no action
        state_payloads = {"src": {"pins": [{"pin": 4, "value": 0}]}}
        device_lookup = {"src": src_device, "dst": dst_device}
        normalized_graph = deserialize_automation_graph(json.dumps(graph))
        publish_command = MagicMock(return_value=True)

        log = _evaluate_graph_execution(
            db,
            automation=automation,
            normalized_graph=normalized_graph,
            trigger_source="device_state",
            state_payloads=state_payloads,
            device_lookup=device_lookup,
            publish_command=publish_command,
        )
        assert log.status == ExecutionStatus.failed
        assert "No action applied" in (log.error_message or "")
        publish_command.assert_not_called()

    def test_missing_action_device_in_lookup_fails(self, db):
        graph = _simple_device_state_graph(action_device="missing")
        user = _make_user(db)
        automation = _make_automation(db, creator_id=user.user_id, graph=graph)
        db.commit()

        normalized_graph = deserialize_automation_graph(json.dumps(graph))
        publish_command = MagicMock(return_value=True)

        log = _evaluate_graph_execution(
            db,
            automation=automation,
            normalized_graph=normalized_graph,
            trigger_source="device_state",
            state_payloads={},
            device_lookup={},  # empty — device missing
            publish_command=publish_command,
        )
        assert log.status == ExecutionStatus.failed
        publish_command.assert_not_called()

    def test_unapproved_device_fails_action(self, db):
        graph = _simple_device_state_graph(action_device="pending")
        user = _make_user(db)
        automation = _make_automation(db, creator_id=user.user_id, graph=graph)
        unapproved = Device(
            device_id="pending",
            mac_address="AA:FF:00:00:00:01",
            name="pending",
            owner_id=user.user_id,
            auth_status=AuthStatus.pending,
            conn_status=ConnStatus.online,
            mode="library",
        )
        db.add(unapproved)
        db.commit()

        normalized_graph = deserialize_automation_graph(json.dumps(graph))
        publish_command = MagicMock(return_value=True)

        log = _evaluate_graph_execution(
            db,
            automation=automation,
            normalized_graph=normalized_graph,
            trigger_source="device_state",
            state_payloads={},
            device_lookup={"pending": unapproved},
            publish_command=publish_command,
        )
        assert log.status == ExecutionStatus.failed
        publish_command.assert_not_called()

    def test_publish_command_failure_recorded(self, db):
        graph = _simple_device_state_graph(action_device="dst")
        user = _make_user(db)
        automation = _make_automation(db, creator_id=user.user_id, graph=graph)
        dst = Device(
            device_id="dst",
            mac_address="AA:33:00:00:00:01",
            name="dst",
            owner_id=user.user_id,
            auth_status=AuthStatus.approved,
            conn_status=ConnStatus.online,
            mode="library",
        )
        db.add(dst)
        db.commit()

        normalized_graph = deserialize_automation_graph(json.dumps(graph))
        # Simulate MQTT publish failure
        failing_publish = MagicMock(return_value=False)

        log = _evaluate_graph_execution(
            db,
            automation=automation,
            normalized_graph=normalized_graph,
            trigger_source="device_state",
            state_payloads={},
            device_lookup={"dst": dst},
            publish_command=failing_publish,
        )
        assert log.status == ExecutionStatus.failed
        assert "command dispatch failed" in (log.error_message or "")

    def test_multiple_actions_both_dispatched(self, db):
        graph = {
            "nodes": [
                {
                    "id": "t1",
                    "type": "trigger",
                    "kind": "device_state",
                    "config": {"device_id": "src", "pin": 4},
                },
                {
                    "id": "a1",
                    "type": "action",
                    "kind": "set_output",
                    "config": {"device_id": "dst1", "pin": 12, "value": 1},
                },
                {
                    "id": "a2",
                    "type": "action",
                    "kind": "set_output",
                    "config": {"device_id": "dst2", "pin": 13, "value": 0},
                },
            ],
            "edges": [
                {
                    "source_node_id": "t1",
                    "source_port": "event_out",
                    "target_node_id": "a1",
                    "target_port": "event_in",
                },
                {
                    "source_node_id": "a1",
                    "source_port": "event_out",
                    "target_node_id": "a2",
                    "target_port": "event_in",
                },
            ],
        }
        user = _make_user(db)
        automation = _make_automation(db, creator_id=user.user_id, graph=graph)
        for did in ("dst1", "dst2"):
            db.add(
                Device(
                    device_id=did,
                    mac_address=f"AA:{did[-1]}A:00:00:00:01",
                    name=did,
                    owner_id=user.user_id,
                    auth_status=AuthStatus.approved,
                    conn_status=ConnStatus.online,
                    mode="library",
                )
            )
        db.commit()

        normalized_graph = deserialize_automation_graph(json.dumps(graph))
        publish_command = MagicMock(return_value=True)
        dst1 = db.query(Device).filter(Device.device_id == "dst1").first()
        dst2 = db.query(Device).filter(Device.device_id == "dst2").first()

        log = _evaluate_graph_execution(
            db,
            automation=automation,
            normalized_graph=normalized_graph,
            trigger_source="device_state",
            state_payloads={},
            device_lookup={"dst1": dst1, "dst2": dst2},
            publish_command=publish_command,
        )
        assert log.status == ExecutionStatus.success
        assert publish_command.call_count == 2

    def test_set_value_action_dispatch(self, db):
        graph = {
            "nodes": [
                {
                    "id": "t1",
                    "type": "trigger",
                    "kind": "device_state",
                    "config": {"device_id": "src", "pin": 4},
                },
                {
                    "id": "a1",
                    "type": "action",
                    "kind": "set_value",
                    "config": {"device_id": "dimmer", "pin": 13, "value": 180},
                },
            ],
            "edges": [
                {
                    "source_node_id": "t1",
                    "source_port": "event_out",
                    "target_node_id": "a1",
                    "target_port": "event_in",
                }
            ],
        }
        user = _make_user(db)
        automation = _make_automation(db, creator_id=user.user_id, graph=graph)
        dimmer = Device(
            device_id="dimmer",
            mac_address="AA:DD:00:00:00:01",
            name="Dimmer",
            owner_id=user.user_id,
            auth_status=AuthStatus.approved,
            conn_status=ConnStatus.online,
            mode="library",
        )
        db.add(dimmer)
        db.commit()

        normalized_graph = deserialize_automation_graph(json.dumps(graph))
        publish_command = MagicMock(return_value=True)

        log = _evaluate_graph_execution(
            db,
            automation=automation,
            normalized_graph=normalized_graph,
            trigger_source="device_state",
            state_payloads={},
            device_lookup={"dimmer": dimmer},
            publish_command=publish_command,
        )
        assert log.status == ExecutionStatus.success
        called_args = publish_command.call_args[0]
        assert called_args[0] == "dimmer"
        assert called_args[1]["value"] == 180

    def test_execution_log_is_persisted_to_db(self, db):
        graph = _simple_device_state_graph(action_device="dst")
        user = _make_user(db)
        automation = _make_automation(db, creator_id=user.user_id, graph=graph)
        dst = Device(
            device_id="dst",
            mac_address="AA:EE:00:00:00:01",
            name="dst",
            owner_id=user.user_id,
            auth_status=AuthStatus.approved,
            conn_status=ConnStatus.online,
            mode="library",
        )
        db.add(dst)
        db.commit()

        normalized_graph = deserialize_automation_graph(json.dumps(graph))
        _evaluate_graph_execution(
            db,
            automation=automation,
            normalized_graph=normalized_graph,
            trigger_source="manual",
            state_payloads={},
            device_lookup={"dst": dst},
            publish_command=MagicMock(return_value=True),
        )
        db.commit()

        count = db.query(AutomationExecutionLog).filter(
            AutomationExecutionLog.automation_id == automation.id
        ).count()
        assert count == 1


# ============================================================
# Section 6: process_state_event_for_automations
# ============================================================


class TestProcessStateEventForAutomations:
    def _seed(self, db) -> tuple[User, Device, Device]:
        user = _make_user(db)
        src = Device(
            device_id="src",
            mac_address="AA:11:22:33:44:55",
            name="Source",
            owner_id=user.user_id,
            auth_status=AuthStatus.approved,
            conn_status=ConnStatus.online,
            mode="library",
        )
        dst = Device(
            device_id="dst",
            mac_address="BB:11:22:33:44:55",
            name="Target",
            owner_id=user.user_id,
            auth_status=AuthStatus.approved,
            conn_status=ConnStatus.online,
            mode="library",
        )
        db.add_all([src, dst])
        db.commit()
        return user, src, dst

    def test_matching_trigger_produces_log(self, db):
        user, src, dst = self._seed(db)
        graph = _simple_device_state_graph(trigger_device="src", action_device="dst")
        _make_automation(db, creator_id=user.user_id, graph=graph)
        db.commit()

        publish = MagicMock(return_value=True)
        state_payload = {"pins": [{"pin": 4, "value": 1}]}
        logs = process_state_event_for_automations(
            db,
            device_id="src",
            state_payload=state_payload,
            publish_command=publish,
            previous_state_payload=None,
        )
        assert len(logs) == 1
        assert logs[0].status == ExecutionStatus.success

    def test_non_matching_device_produces_no_logs(self, db):
        user, src, dst = self._seed(db)
        graph = _simple_device_state_graph(trigger_device="src", action_device="dst")
        _make_automation(db, creator_id=user.user_id, graph=graph)
        db.commit()

        publish = MagicMock(return_value=True)
        state_payload = {"pins": [{"pin": 4, "value": 1}]}
        logs = process_state_event_for_automations(
            db,
            device_id="other-device",
            state_payload=state_payload,
            publish_command=publish,
            previous_state_payload=None,
        )
        assert logs == []

    def test_disabled_automation_is_skipped(self, db):
        user, src, dst = self._seed(db)
        graph = _simple_device_state_graph(trigger_device="src", action_device="dst")
        _make_automation(db, creator_id=user.user_id, graph=graph, is_enabled=False)
        db.commit()

        publish = MagicMock(return_value=True)
        state_payload = {"pins": [{"pin": 4, "value": 1}]}
        logs = process_state_event_for_automations(
            db,
            device_id="src",
            state_payload=state_payload,
            publish_command=publish,
            previous_state_payload=None,
        )
        assert logs == []

    def test_invalid_graph_automation_skipped_gracefully(self, db):
        user = _make_user(db)
        db.add(
            Automation(
                creator_id=user.user_id,
                name="Broken",
                script_code="not valid json",
                is_enabled=True,
            )
        )
        db.commit()

        publish = MagicMock(return_value=True)
        logs = process_state_event_for_automations(
            db,
            device_id="any",
            state_payload={"pins": [{"pin": 4, "value": 1}]},
            publish_command=publish,
            previous_state_payload=None,
        )
        assert logs == []

    def test_condition_miss_noop_log_not_returned(self, db):
        """When condition fails and no action fires, the noop log should be deleted."""
        user, src, dst = self._seed(db)
        # condition expects "on" but state is "off"
        graph = _graph_with_condition(
            trigger_device="src", action_device="dst", cond_device="src", expected="on"
        )
        _make_automation(db, creator_id=user.user_id, graph=graph)
        db.commit()

        publish = MagicMock(return_value=True)
        state_payload = {"pins": [{"pin": 4, "value": 0}]}
        logs = process_state_event_for_automations(
            db,
            device_id="src",
            state_payload=state_payload,
            publish_command=publish,
            previous_state_payload=None,
        )
        assert logs == []

    def test_multiple_automations_all_evaluated(self, db):
        user, src, dst = self._seed(db)
        graph = _simple_device_state_graph(trigger_device="src", action_device="dst")
        _make_automation(db, creator_id=user.user_id, graph=graph, name="Auto-1")
        _make_automation(db, creator_id=user.user_id, graph=graph, name="Auto-2")
        db.commit()

        publish = MagicMock(return_value=True)
        state_payload = {"pins": [{"pin": 4, "value": 1}]}
        logs = process_state_event_for_automations(
            db,
            device_id="src",
            state_payload=state_payload,
            publish_command=publish,
            previous_state_payload=None,
        )
        assert len(logs) == 2


# ============================================================
# Section 7: process_time_trigger_automations
# ============================================================


class TestProcessTimeTriggerAutomations:
    def _seed(self, db) -> tuple[User, Device]:
        user = _make_user(db)
        device = Device(
            device_id="dst",
            mac_address="CC:11:22:33:44:55",
            name="Timed Device",
            owner_id=user.user_id,
            auth_status=AuthStatus.approved,
            conn_status=ConnStatus.online,
            mode="library",
        )
        db.add(device)
        db.commit()
        return user, device

    def test_automation_fires_when_next_run_at_reached(self, db):
        user, device = self._seed(db)
        graph = _time_schedule_graph(action_device="dst")
        now = datetime(2026, 5, 21, 8, 0, 0, tzinfo=timezone.utc)
        sched = now.replace(tzinfo=None)

        automation = _make_automation(
            db,
            creator_id=user.user_id,
            graph=graph,
            schedule_type="time",
            schedule_hour=8,
            schedule_minute=0,
            next_run_at=sched,
        )
        db.commit()

        publish = MagicMock(return_value=True)
        logs = process_time_trigger_automations(db, publish_command=publish, reference_time=now)
        assert len(logs) == 1
        assert logs[0].status == ExecutionStatus.success

    def test_automation_not_fired_when_next_run_at_is_future(self, db):
        user, device = self._seed(db)
        graph = _time_schedule_graph(action_device="dst")
        now = datetime(2026, 5, 21, 8, 0, 0, tzinfo=timezone.utc)
        future_sched = (now + timedelta(hours=1)).replace(tzinfo=None)

        _make_automation(
            db,
            creator_id=user.user_id,
            graph=graph,
            schedule_type="time",
            schedule_hour=9,
            schedule_minute=0,
            next_run_at=future_sched,
        )
        db.commit()

        publish = MagicMock(return_value=True)
        logs = process_time_trigger_automations(db, publish_command=publish, reference_time=now)
        assert logs == []

    def test_disabled_automation_not_fired(self, db):
        user, device = self._seed(db)
        graph = _time_schedule_graph(action_device="dst")
        now = datetime(2026, 5, 21, 8, 0, 0, tzinfo=timezone.utc)
        sched = now.replace(tzinfo=None)

        _make_automation(
            db,
            creator_id=user.user_id,
            graph=graph,
            is_enabled=False,
            schedule_type="time",
            schedule_hour=8,
            schedule_minute=0,
            next_run_at=sched,
        )
        db.commit()

        publish = MagicMock(return_value=True)
        logs = process_time_trigger_automations(db, publish_command=publish, reference_time=now)
        assert logs == []

    def test_next_run_at_updated_after_fire(self, db):
        user, device = self._seed(db)
        graph = _time_schedule_graph(hour=8, minute=0, action_device="dst")
        now = datetime(2026, 5, 21, 8, 0, 0, tzinfo=timezone.utc)
        sched = now.replace(tzinfo=None)

        automation = _make_automation(
            db,
            creator_id=user.user_id,
            graph=graph,
            schedule_type="time",
            schedule_hour=8,
            schedule_minute=0,
            next_run_at=sched,
        )
        db.commit()

        publish = MagicMock(return_value=True)
        process_time_trigger_automations(db, publish_command=publish, reference_time=now)
        db.commit()

        db.refresh(automation)
        # next_run_at should have advanced past now
        if automation.next_run_at is not None:
            assert automation.next_run_at > sched

    def test_no_automations_returns_empty(self, db):
        publish = MagicMock(return_value=True)
        now = datetime(2026, 5, 21, 8, 0, 0, tzinfo=timezone.utc)
        logs = process_time_trigger_automations(db, publish_command=publish, reference_time=now)
        assert logs == []


# ============================================================
# Section 8: trigger_automation_manually
# ============================================================


class TestTriggerAutomationManually:
    def _seed(self, db) -> tuple[User, Device, Automation]:
        user = _make_user(db)
        device = Device(
            device_id="dst",
            mac_address="DD:11:22:33:44:55",
            name="Manual Target",
            owner_id=user.user_id,
            auth_status=AuthStatus.approved,
            conn_status=ConnStatus.online,
            mode="library",
        )
        db.add(device)
        graph = _simple_device_state_graph(action_device="dst")
        automation = _make_automation(db, creator_id=user.user_id, graph=graph)
        db.commit()
        return user, device, automation

    def test_manual_trigger_fires_action(self, db):
        user, device, automation = self._seed(db)
        publish = MagicMock(return_value=True)
        log = trigger_automation_manually(
            db, automation=automation, publish_command=publish
        )
        assert log.status == ExecutionStatus.success
        publish.assert_called_once()

    def test_manual_trigger_sets_trigger_source_to_manual(self, db):
        user, device, automation = self._seed(db)
        publish = MagicMock(return_value=True)
        log = trigger_automation_manually(
            db, automation=automation, publish_command=publish
        )
        assert log.trigger_source == "manual"

    def test_manual_trigger_updates_last_triggered(self, db):
        user, device, automation = self._seed(db)
        publish = MagicMock(return_value=True)
        before = datetime.now(timezone.utc).replace(tzinfo=None)
        trigger_automation_manually(db, automation=automation, publish_command=publish)
        assert automation.last_triggered is not None
        assert automation.last_triggered >= before.replace(second=0, microsecond=0)


# ============================================================
# Section 9: compute_next_time_trigger_run
# ============================================================


class TestComputeNextTimeTriggerRun:
    def test_same_time_today_returns_today(self):
        # Reference: Monday 2026-05-18 08:00 UTC (Asia/Ho_Chi_Minh = UTC+7 -> 15:00 local)
        reference = datetime(2026, 5, 18, 8, 0, 0, tzinfo=timezone.utc)
        config = {"hour": 15, "minute": 0, "weekdays": []}
        result = compute_next_time_trigger_run(
            config, timezone_name="Asia/Ho_Chi_Minh", reference_time=reference
        )
        assert result is not None
        # The result should be today at 08:00 UTC (15:00 +07)
        assert result.hour == 8
        assert result.minute == 0

    def test_past_time_today_rolls_to_next_day(self):
        # Reference: 2026-05-18 10:00 UTC -> 17:00 local (Asia/Ho_Chi_Minh)
        reference = datetime(2026, 5, 18, 10, 0, 0, tzinfo=timezone.utc)
        config = {"hour": 7, "minute": 0, "weekdays": []}
        result = compute_next_time_trigger_run(
            config, timezone_name="Asia/Ho_Chi_Minh", reference_time=reference
        )
        assert result is not None
        # Should be the next day
        assert result > reference.replace(tzinfo=None)

    def test_weekday_filter_skips_wrong_days(self):
        # 2026-05-18 is Monday; if we only allow weekends, it should skip ahead
        reference = datetime(2026, 5, 18, 0, 0, 0, tzinfo=timezone.utc)
        config = {"hour": 8, "minute": 0, "weekdays": ["sat", "sun"]}
        result = compute_next_time_trigger_run(
            config, timezone_name="UTC", reference_time=reference
        )
        assert result is not None
        # 2026-05-23 is Saturday
        result_utc = result.replace(tzinfo=timezone.utc)
        assert result_utc.weekday() in (5, 6)  # Sat or Sun

    def test_returns_naive_datetime(self):
        reference = datetime(2026, 5, 18, 0, 0, 0, tzinfo=timezone.utc)
        config = {"hour": 8, "minute": 0, "weekdays": []}
        result = compute_next_time_trigger_run(
            config, timezone_name="UTC", reference_time=reference
        )
        assert result is not None
        assert result.tzinfo is None


# ============================================================
# Section 10: sync_automation_schedule_projection
# ============================================================


class TestSyncAutomationScheduleProjection:
    def _make_auto_obj(self, db) -> Automation:
        user = _make_user(db)
        graph = _time_schedule_graph(hour=9, minute=30, weekdays=["mon"])
        auto = _make_automation(db, creator_id=user.user_id, graph=graph)
        db.commit()
        return auto

    def test_time_graph_sets_schedule_fields(self, db):
        auto = self._make_auto_obj(db)
        graph = _time_schedule_graph(hour=9, minute=30, weekdays=["mon"])
        normalized = deserialize_automation_graph(json.dumps(graph))
        sync_automation_schedule_projection(
            auto, normalized, effective_timezone="UTC"
        )
        assert auto.schedule_type == "time"
        assert auto.schedule_hour == 9
        assert auto.schedule_minute == 30
        assert "mon" in (auto.schedule_weekdays or [])

    def test_non_time_graph_resets_schedule_fields(self, db):
        user = _make_user(db)
        graph = _simple_device_state_graph()
        auto = _make_automation(
            db,
            creator_id=user.user_id,
            graph=graph,
            schedule_type="time",
            schedule_hour=9,
            schedule_minute=30,
        )
        db.commit()

        normalized = deserialize_automation_graph(json.dumps(graph))
        sync_automation_schedule_projection(auto, normalized, effective_timezone="UTC")
        assert auto.schedule_type == "manual"
        assert auto.schedule_hour is None
        assert auto.schedule_minute is None
        assert auto.next_run_at is None


# ============================================================
# Section 11: serialize_automation
# ============================================================


class TestSerializeAutomation:
    def test_basic_fields_present(self, db):
        user = _make_user(db)
        graph = _simple_device_state_graph()
        auto = _make_automation(db, creator_id=user.user_id, graph=graph, name="My Rule")
        db.commit()

        result = serialize_automation(auto)
        assert result["name"] == "My Rule"
        assert result["is_enabled"] is True
        assert "graph" in result
        assert result["last_execution"] is None

    def test_broken_graph_gives_empty_graph(self, db):
        user = _make_user(db)
        auto = Automation(
            creator_id=user.user_id,
            name="Broken",
            script_code="garbage",
            is_enabled=True,
        )
        db.add(auto)
        db.commit()

        result = serialize_automation(auto)
        assert result["graph"]["nodes"] == []
        assert result["graph"]["edges"] == []


# ============================================================
# Section 12: _is_condition_miss_noop
# ============================================================


class TestIsConditionMissNoop:
    def _make_log(
        self, status: ExecutionStatus, error_message: str | None, log_output: dict | None
    ) -> AutomationExecutionLog:
        log = AutomationExecutionLog(
            automation_id=1,
            status=status,
            trigger_source="device_state",
            log_output=json.dumps(log_output) if log_output else None,
            error_message=error_message,
        )
        return log

    def test_detects_condition_miss_noop(self):
        log = self._make_log(
            ExecutionStatus.failed,
            "No action applied because no branch passed all conditions.",
            {"evaluations": ["c1: GPIO 4 expected on -> false"], "actions": []},
        )
        assert _is_condition_miss_noop(log)

    def test_success_log_not_noop(self):
        log = self._make_log(
            ExecutionStatus.success,
            None,
            {"evaluations": [], "actions": ["a1: dst GPIO 12 -> on"]},
        )
        assert not _is_condition_miss_noop(log)

    def test_failed_with_actions_not_noop(self):
        log = self._make_log(
            ExecutionStatus.failed,
            "No action applied because no branch passed all conditions.",
            {"evaluations": ["c1: GPIO 4 expected on -> false"], "actions": ["a1: dst GPIO 12 -> on"]},
        )
        assert not _is_condition_miss_noop(log)

    def test_evaluation_passes_not_noop(self):
        log = self._make_log(
            ExecutionStatus.failed,
            "No action applied because no branch passed all conditions.",
            {"evaluations": ["c1: GPIO 4 expected on -> true"], "actions": []},
        )
        assert not _is_condition_miss_noop(log)

    def test_wrong_error_message_not_noop(self):
        log = self._make_log(
            ExecutionStatus.failed,
            "Some other error",
            {"evaluations": ["c1: GPIO 4 expected on -> false"], "actions": []},
        )
        assert not _is_condition_miss_noop(log)
