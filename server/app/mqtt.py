from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timedelta
from typing import Any

import paho.mqtt.client as mqtt
from dotenv import load_dotenv
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.orm import Session

import asyncio
from app.database import SessionLocal
from app.models import DeviceRegister
from app.services.builder import (
    build_job_firmware_version,
    describe_runtime_firmware_mismatch,
    extract_runtime_firmware_network_targets,
)
from app.services.system_logs import create_system_log, record_system_log
from app.services.device_registration import (
    build_pairing_request_event_payload,
    build_registration_ack_payload,
    register_device_payload,
)
from app.services.automation_runtime import process_state_event_for_automations
from app.sql_models import (
    AuthStatus,
    ConnStatus,
    Device,
    DeviceHistory,
    EventType,
    JobStatus,
    SystemLogCategory,
    SystemLogSeverity,
)
from app.ws_manager import manager as ws_manager

load_dotenv()

logger = logging.getLogger(__name__)

MQTT_BROKER = os.getenv("MQTT_BROKER", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", 1883))
MQTT_NAMESPACE = os.getenv("MQTT_NAMESPACE", "local")

STATE_TOPIC_SUBSCRIPTION = f"econnect/{MQTT_NAMESPACE}/device/+/state"
REGISTER_TOPIC_SUBSCRIPTION = f"econnect/{MQTT_NAMESPACE}/device/+/register"
OTA_FLASHING_RECONCILIATION_TIMEOUT = timedelta(
    seconds=max(60, int(os.getenv("OTA_FLASHING_RECONCILIATION_TIMEOUT_SECONDS", "60")))
)
OTA_RECENT_FLASH_CONFIRMATION_WINDOW = timedelta(
    seconds=max(120, int(os.getenv("OTA_RECENT_FLASH_CONFIRMATION_WINDOW_SECONDS", "180")))
)


def _job_reference_time(job) -> datetime:
    return job.finished_at or job.updated_at or job.created_at or datetime.utcnow()


def _mark_ota_job_failed(job, *, now: datetime, message: str) -> None:
    job.status = JobStatus.flash_failed
    job.error_message = message
    job.finished_at = now
    job.updated_at = now


def _reconcile_ota_jobs(db: Session, device: Device, reported_version: str) -> str:
    if not device.provisioning_project_id or not reported_version:
        return "noop"

    from app.sql_models import BuildJob, JobStatus

    now = datetime.utcnow()
    flashing_jobs = db.query(BuildJob).filter(
        BuildJob.project_id == device.provisioning_project_id,
        BuildJob.status == JobStatus.flashing
    ).all()
    matched_job = None
    for job in flashing_jobs:
        expected_version = build_job_firmware_version(job.id)
        if reported_version == expected_version:
            matched_job = job
            break

    if matched_job:
        matched_job.status = JobStatus.flashed
        matched_job.finished_at = now
        matched_job.updated_at = now
        logger.info("Reconciled OTA job %s to flashed via firmware_version match.", matched_job.id)
        return "confirmed"

    if flashing_jobs:
        if len(flashing_jobs) > 1:
            logger.warning(
                "Skipping OTA mismatch reconciliation for device %s because %s flashing jobs are active.",
                device.device_id,
                len(flashing_jobs),
            )
            return "noop"

        job = flashing_jobs[0]
        delta = now - _job_reference_time(job)
        if delta > OTA_FLASHING_RECONCILIATION_TIMEOUT:
            expected_version = build_job_firmware_version(job.id)
            _mark_ota_job_failed(
                job,
                now=now,
                message=(
                    f"OTA timeout/reconciliation: device reported version '{reported_version}' "
                    f"after reboot, expected '{expected_version}'"
                ),
            )
            logger.warning("Reconciled OTA job %s to flash_failed (version mismatch).", job.id)
            return "timeout_mismatch"

        return "pending"

    recent_flashed_jobs = sorted(
        db.query(BuildJob)
        .filter(
            BuildJob.project_id == device.provisioning_project_id,
            BuildJob.status == JobStatus.flashed,
        )
        .all(),
        key=_job_reference_time,
        reverse=True,
    )
    recent_flashed_job = next(
        (
            job
            for job in recent_flashed_jobs
            if now - _job_reference_time(job) <= OTA_RECENT_FLASH_CONFIRMATION_WINDOW
        ),
        None,
    )
    if not recent_flashed_job:
        return "noop"

    expected_version = build_job_firmware_version(recent_flashed_job.id)
    if reported_version == expected_version:
        return "confirmed"

    _mark_ota_job_failed(
        recent_flashed_job,
        now=now,
        message=(
            f"OTA verification failed: device came back reporting firmware '{reported_version}' "
            f"after OTA success, expected '{expected_version}'."
        ),
    )
    logger.warning(
        "Downgraded OTA job %s to flash_failed after reboot version mismatch for device %s.",
        recent_flashed_job.id,
        device.device_id,
    )
    return "post_flash_mismatch"


def build_pairing_rejected_ack_payload(device: Device) -> dict[str, Any]:
    auth_status = device.auth_status.value if hasattr(device.auth_status, "value") else str(device.auth_status)
    conn_status = device.conn_status.value if hasattr(device.conn_status, "value") else str(device.conn_status)
    mode = device.mode.value if hasattr(device.mode, "value") else str(device.mode)
    return {
        "status": "pairing_rejected",
        "device_id": device.device_id,
        "reason": "admin_rejected",
        "auth_status": auth_status,
        "conn_status": conn_status,
        "mode": mode,
        "mac_address": device.mac_address,
        "message": "Pairing was rejected by the server. Reboot or power-cycle the board to try again.",
    }


def build_pairing_awaiting_approval_ack_payload(device: Device) -> dict[str, Any]:
    auth_status = device.auth_status.value if hasattr(device.auth_status, "value") else str(device.auth_status)
    return {
        "status": "awaiting_approval",
        "device_id": device.device_id,
        "reason": "active_pairing_request",
        "auth_status": auth_status,
        "pairing_requested_at": (
            device.pairing_requested_at.isoformat() if device.pairing_requested_at else None
        ),
        "message": "Device is already pending admin approval. Keep the current pairing request active.",
    }


def _normalize_state_scalar(value: Any) -> Any:
    if isinstance(value, bool):
        return 1 if value else 0
    return value


def _extract_state_pin_rows(state_payload: dict[str, Any]) -> list[dict[str, Any]]:
    pins = state_payload.get("pins")
    if not isinstance(pins, list):
        return []
    return [row for row in pins if isinstance(row, dict)]


def _state_row_matches_command(command: dict[str, Any], state_row: dict[str, Any]) -> bool:
    command_value = _normalize_state_scalar(command.get("value"))
    state_value = _normalize_state_scalar(state_row.get("value"))
    command_brightness = command.get("brightness")
    state_brightness = state_row.get("brightness")

    value_matches = state_value is not None and command_value is not None and state_value == command_value
    brightness_matches = (
        state_brightness is not None
        and command_brightness is not None
        and state_brightness == command_brightness
    )
    return value_matches or brightness_matches


class MQTTClientManager:
    def __init__(self):
        self.client_id = f"econnect_server_{MQTT_NAMESPACE}_{uuid.uuid4().hex[:8]}"
        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=self.client_id,
        )
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message
        self.client.on_disconnect = self.on_disconnect
        self.connected = False
        self.pending_commands = {}
        self.runtime_network_state: dict[str, object] | None = None

    def start(self):
        try:
            logger.info(
                "Connecting to MQTT Broker at %s:%s (Namespace: %s)",
                MQTT_BROKER,
                MQTT_PORT,
                MQTT_NAMESPACE,
            )
            self.client.connect(MQTT_BROKER, MQTT_PORT, 60)
            self.client.loop_start()
        except Exception as exc:
            logger.error("Failed to connect to MQTT broker: %s", exc)

    def stop(self):
        if self.connected:
            self.client.loop_stop()
            self.client.disconnect()

    def set_runtime_network_state(self, runtime_state: dict[str, object] | None) -> None:
        self.runtime_network_state = runtime_state if isinstance(runtime_state, dict) else None

    def registration_ack_topic(self, device_id: str) -> str:
        return f"econnect/{MQTT_NAMESPACE}/device/{device_id}/register/ack"

    def command_topic(self, device_id: str) -> str:
        return f"econnect/{MQTT_NAMESPACE}/device/{device_id}/command"

    def state_ack_topic(self, device_id: str) -> str:
        return f"econnect/{MQTT_NAMESPACE}/device/{device_id}/state/ack"

    def _runtime_network_targets(self) -> dict[str, object] | None:
        return extract_runtime_firmware_network_targets(self.runtime_network_state)

    def _attach_runtime_network(self, payload: dict[str, Any]) -> dict[str, Any]:
        runtime_targets = self._runtime_network_targets()
        if runtime_targets is not None:
            payload["runtime_network"] = runtime_targets
        return payload

    def _build_manual_reflash_required_payload(
        self,
        device_id: str,
        *,
        message: str,
    ) -> dict[str, Any]:
        return self._attach_runtime_network(
            {
                "status": "manual_reflash_required",
                "device_id": device_id,
                "reason": "firmware_network_mismatch",
                "message": message,
            }
        )

    def on_connect(self, client, userdata, flags, reason_code, properties=None):
        if reason_code.is_failure:
            logger.error("Failed to connect, return code %s", reason_code)
            return

        was_connected = self.connected
        self.connected = True
        logger.info("Successfully connected to MQTT broker")
        client.subscribe(STATE_TOPIC_SUBSCRIPTION)
        client.subscribe(REGISTER_TOPIC_SUBSCRIPTION)
        logger.info("Subscribed to %s", STATE_TOPIC_SUBSCRIPTION)
        logger.info("Subscribed to %s", REGISTER_TOPIC_SUBSCRIPTION)
        if not was_connected:
            record_system_log(
                event_code="mqtt_connected",
                message="MQTT broker connection established.",
                severity=SystemLogSeverity.info,
                category=SystemLogCategory.connectivity,
                details={
                    "broker": MQTT_BROKER,
                    "port": MQTT_PORT,
                    "namespace": MQTT_NAMESPACE,
                },
            )

    def on_disconnect(self, client, userdata, disconnect_flags, reason_code, properties=None):
        was_connected = self.connected
        self.connected = False
        if reason_code.is_failure:
            logger.warning(
                "Unexpected MQTT disconnection (code %s). Will auto-reconnect.",
                reason_code,
            )
        else:
            logger.info("Disconnected from MQTT broker.")

        if was_connected or reason_code.is_failure:
            record_system_log(
                event_code="mqtt_disconnected",
                message="MQTT broker connection dropped." if reason_code.is_failure else "MQTT broker connection closed.",
                severity=SystemLogSeverity.critical if reason_code.is_failure else SystemLogSeverity.info,
                category=SystemLogCategory.connectivity,
                details={
                    "broker": MQTT_BROKER,
                    "port": MQTT_PORT,
                    "namespace": MQTT_NAMESPACE,
                    "reason_code": str(reason_code),
                    "unexpected": bool(reason_code.is_failure),
                },
            )

    def on_message(self, client, userdata, msg):
        try:
            topic_parts = msg.topic.split("/")
            if len(topic_parts) < 5 or topic_parts[0] != "econnect":
                return

            device_id = topic_parts[3]
            topic_kind = topic_parts[4]
            payload_str = msg.payload.decode("utf-8")

            if topic_kind == "state":
                self.process_state_message(device_id, payload_str)
                return

            if topic_kind == "register":
                self.process_registration_message(device_id, payload_str)
        except Exception as exc:
            logger.error("Error processing MQTT message: %s", exc)

    def process_state_message(self, device_id: str, payload_str: str) -> None:
        payload_json: dict[str, Any] | None = None
        try:
            decoded = json.loads(payload_str)
            if isinstance(decoded, dict):
                payload_json = decoded
        except json.JSONDecodeError:
            payload_json = None

        db = SessionLocal()
        try:
            device = db.query(Device).filter(Device.device_id == device_id).first()
            if not device:
                logger.warning(
                    "Ignoring MQTT state for unknown device %s",
                    device_id,
                )
                self.publish_json(
                    self.state_ack_topic(device_id),
                    self._attach_runtime_network(
                        {
                        "status": "re_pair_required",
                        "device_id": device_id,
                        "reason": "unknown_device",
                        "message": "Device UUID is not registered on the server.",
                        }
                    ),
                    wait_for_publish=False,
                )
                return

            mismatch_message = describe_runtime_firmware_mismatch(
                payload_json,
                self._runtime_network_targets(),
            )
            if mismatch_message:
                logger.warning("Rejecting MQTT state for %s: %s", device_id, mismatch_message)
                self.publish_json(
                    self.state_ack_topic(device_id),
                    self._build_manual_reflash_required_payload(
                        device_id,
                        message=mismatch_message,
                    ),
                    wait_for_publish=False,
                )
                return

            auth_status = (
                device.auth_status.value if hasattr(device.auth_status, "value") else str(device.auth_status)
            )
            if device.auth_status != AuthStatus.approved:
                if device.auth_status == AuthStatus.rejected:
                    logger.info(
                        "Informing device %s that pairing was rejected until reboot.",
                        device_id,
                    )
                    ack_payload = build_pairing_rejected_ack_payload(device)
                elif device.auth_status == AuthStatus.pending and device.pairing_requested_at is not None:
                    logger.info(
                        "Device %s is already awaiting approval; preserving the current pairing request.",
                        device_id,
                    )
                    ack_payload = build_pairing_awaiting_approval_ack_payload(device)
                else:
                    logger.info(
                        "Requesting re-pair for device %s because auth_status=%s",
                        device_id,
                        auth_status,
                    )
                    ack_payload = {
                        "status": "re_pair_required",
                        "device_id": device_id,
                        "reason": "not_approved",
                        "auth_status": auth_status,
                        "message": "Device is no longer approved and must pair again.",
                    }
                self.publish_json(
                    self.state_ack_topic(device_id),
                    self._attach_runtime_network(ack_payload),
                    wait_for_publish=False,
                )
                return

            observed_at = datetime.utcnow()
            was_offline = device.conn_status != ConnStatus.online
            previous_revision = device.firmware_revision
            previous_version = device.firmware_version
            device.conn_status = ConnStatus.online
            device.last_seen = observed_at
            if isinstance(payload_json, dict):
                self.resolve_command_ack(device_id, payload_json, db)

                reported_ip = payload_json.get("ip_address")
                if isinstance(reported_ip, str) and reported_ip.strip():
                    device.ip_address = reported_ip.strip()

                reported_revision = payload_json.get("firmware_revision")
                if isinstance(reported_revision, str) and reported_revision.strip():
                    device.firmware_revision = reported_revision.strip()

                reported_fw = payload_json.get("firmware_version")
                if isinstance(reported_fw, str) and reported_fw.strip():
                    device.firmware_version = reported_fw.strip()
                    _reconcile_ota_jobs(db, device, device.firmware_version)

            if was_offline:
                db.add(
                    DeviceHistory(
                        device_id=device_id,
                        event_type=EventType.online,
                        payload=json.dumps(
                            {
                                "reason": "mqtt_state",
                                "reported_at": observed_at.isoformat(),
                            }
                        ),
                    )
                )

                try:
                    ws_manager.broadcast_device_event_sync(
                        "device_online",
                        device_id,
                        device.room_id,
                        {
                            "reason": "mqtt_state",
                            "reported_at": observed_at.isoformat(),
                        }
                    )
                except Exception:
                    pass

                create_system_log(
                    db,
                    occurred_at=observed_at,
                    severity=SystemLogSeverity.info,
                    category=SystemLogCategory.connectivity,
                    event_code="device_online",
                    message=f'Device "{device.name}" is back online.',
                    device_id=device.device_id,
                    firmware_version=device.firmware_version,
                    firmware_revision=device.firmware_revision,
                    details={
                        "reason": "mqtt_state",
                        "reported_at": observed_at.isoformat(),
                    },
                )

            firmware_changed = (
                device.firmware_version != previous_version
                or device.firmware_revision != previous_revision
            )
            if firmware_changed and (device.firmware_version or device.firmware_revision):
                create_system_log(
                    db,
                    occurred_at=observed_at,
                    severity=SystemLogSeverity.info,
                    category=SystemLogCategory.firmware,
                    event_code="device_firmware_reported",
                    message=f'Device "{device.name}" reported firmware metadata.',
                    device_id=device.device_id,
                    firmware_version=device.firmware_version,
                    firmware_revision=device.firmware_revision,
                    details={
                        "previous_firmware_version": previous_version,
                        "next_firmware_version": device.firmware_version,
                        "previous_firmware_revision": previous_revision,
                        "next_firmware_revision": device.firmware_revision,
                        "ip_address": device.ip_address,
                    },
                )

            db.add(
                DeviceHistory(
                    device_id=device_id,
                    event_type=EventType.state_change,
                    payload=payload_str,
                )
            )
            if isinstance(payload_json, dict):
                try:
                    process_state_event_for_automations(
                        db,
                        device_id=device_id,
                        state_payload=payload_json,
                        publish_command=self.enqueue_command,
                        triggered_at=observed_at,
                    )
                except Exception:
                    logger.exception("Automation graph evaluation failed for MQTT state %s", device_id)

            try:
                ws_manager.broadcast_device_event_sync(
                    "device_state",
                    device_id,
                    device.room_id,
                    {
                        **(payload_json or {}),
                        "reported_at": observed_at.isoformat(),
                    }
                )
            except Exception:
                pass

            # Check if this is an OTA status report from the device
            if isinstance(payload_json, dict) and payload_json.get("event") == "ota_status":
                from app.sql_models import BuildJob, JobStatus
                job_id = payload_json.get("job_id")
                ota_status = payload_json.get("status")

                if job_id and ota_status:
                    job = db.query(BuildJob).filter(BuildJob.id == job_id).first()
                    if job:
                        if ota_status == "success":
                            job.status = JobStatus.flashed
                        elif ota_status == "failed":
                            job.status = JobStatus.flash_failed
                            job.error_message = payload_json.get("message")

                        job.finished_at = datetime.utcnow()
                        db.commit()

            db.commit()
        finally:
            db.close()

    def resolve_command_ack(self, device_id: str, state_payload: dict, db: Session) -> None:
        ack_cmd_id = state_payload.get("command_id")
        applied = state_payload.get("applied", True)

        matched_cmd_id = None
        if ack_cmd_id and ack_cmd_id in self.pending_commands:
            matched_cmd_id = ack_cmd_id
        else:
            pin = state_payload.get("pin")
            val = state_payload.get("value")
            bright = state_payload.get("brightness")

            if isinstance(val, bool):
                val = 1 if val else 0

            for cid, cmd in list(self.pending_commands.items()):
                if cmd["device_id"] == device_id and cmd.get("pin") == pin:
                    cmd_val = cmd.get("value")
                    if isinstance(cmd_val, bool):
                        cmd_val = 1 if cmd_val else 0
                    cmd_bright = cmd.get("brightness")

                    match_val = val is not None and cmd_val is not None and cmd_val == val
                    match_bright = bright is not None and cmd_bright is not None and cmd_bright == bright

                    if match_val or match_bright:
                        matched_cmd_id = cid
                        break

            if not matched_cmd_id:
                pin_rows = _extract_state_pin_rows(state_payload)
                for cid, cmd in list(self.pending_commands.items()):
                    if cmd["device_id"] != device_id:
                        continue

                    state_row = next(
                        (
                            row
                            for row in pin_rows
                            if row.get("pin") == cmd.get("pin")
                            and _state_row_matches_command(cmd, row)
                        ),
                        None,
                    )
                    if state_row:
                        matched_cmd_id = cid
                        break

        if matched_cmd_id:
            cmd = self.pending_commands.pop(matched_cmd_id, None)
            if cmd:
                if applied is False:
                    status = "failed"
                    reason = "applied_false"
                    event_type = EventType.command_failed
                else:
                    status = "acknowledged"
                    reason = "state_match"
                    event_type = EventType.state_change

                if status == "failed":
                    db.add(
                        DeviceHistory(
                            device_id=device_id,
                            event_type=event_type,
                            payload=json.dumps({"command_id": matched_cmd_id, "reason": reason})
                        )
                    )

                try:
                    ws_manager.broadcast_device_event_sync(
                        "command_delivery",
                        device_id,
                        None,
                        {
                            "command_id": matched_cmd_id,
                            "status": status,
                            "reason": reason
                        }
                    )
                except Exception:
                    pass

    def process_registration_message(self, device_id: str, payload_str: str) -> dict[str, Any]:
        ack_topic = self.registration_ack_topic(device_id)

        try:
            raw_payload = json.loads(payload_str)
            if not isinstance(raw_payload, dict):
                raise ValueError("Registration payload must be a JSON object.")
            raw_payload.setdefault("device_id", device_id)
            if raw_payload.get("device_id") != device_id:
                raise ValueError("Device id in payload does not match MQTT topic.")
            payload = DeviceRegister.model_validate(raw_payload)
        except (json.JSONDecodeError, ValidationError, ValueError) as exc:
            ack_payload = self._attach_runtime_network(
                build_registration_ack_payload(
                    status="error",
                    device_id=device_id,
                    secret_verified=False,
                    error="validation",
                    message=str(exc),
                )
            )
            self.publish_json(ack_topic, ack_payload, wait_for_publish=False)
            return ack_payload

        mismatch_message = describe_runtime_firmware_mismatch(
            raw_payload,
            self._runtime_network_targets(),
        )
        if mismatch_message:
            ack_payload = self._build_manual_reflash_required_payload(
                device_id,
                message=mismatch_message,
            )
            self.publish_json(ack_topic, ack_payload, wait_for_publish=False)
            return ack_payload

        db = SessionLocal()
        try:
            result = register_device_payload(db, payload)
            db.commit()
            db.refresh(result.device)

            if result.pairing_requested:
                ws_manager.broadcast_device_event_sync(
                    "pairing_requested",
                    result.device.device_id,
                    None,
                    build_pairing_request_event_payload(result.device),
                )

            if result.device.firmware_version:
                _reconcile_ota_jobs(db, result.device, result.device.firmware_version)
                db.commit()

            ack_payload = self._attach_runtime_network(
                build_registration_ack_payload(
                    status="ok",
                    device_id=result.device.device_id,
                    secret_verified=result.secret_verified,
                    project_id=result.project_id,
                    auth_status=(
                        result.device.auth_status.value
                        if hasattr(result.device.auth_status, "value")
                        else str(result.device.auth_status)
                    ),
                    topic_pub=result.device.topic_pub,
                    topic_sub=result.device.topic_sub,
                )
            )
        except HTTPException as exc:
            db.rollback()
            detail = exc.detail if isinstance(exc.detail, dict) else {}
            ack_payload = self._attach_runtime_network(
                build_registration_ack_payload(
                    status="error",
                    device_id=device_id,
                    secret_verified=False,
                    error=detail.get("error", "server"),
                    message=detail.get("message", str(exc.detail)),
                )
            )
        except Exception:
            db.rollback()
            logger.exception("Unhandled MQTT registration error for device %s", device_id)
            ack_payload = self._attach_runtime_network(
                build_registration_ack_payload(
                    status="error",
                    device_id=device_id,
                    secret_verified=False,
                    error="server",
                    message="Server failed to process MQTT registration.",
                )
            )
        finally:
            db.close()

        self.publish_json(ack_topic, ack_payload, wait_for_publish=False)
        return ack_payload

    def publish_json(
        self,
        topic: str,
        payload: dict[str, Any],
        *,
        qos: int = 1,
        wait_for_publish: bool = True,
    ) -> bool:
        if not self.connected:
            logger.error("Cannot publish to %s: MQTT client is not connected.", topic)
            return False

        try:
            payload_str = json.dumps(payload)
            info = self.client.publish(topic, payload_str, qos=qos)
            if not wait_for_publish:
                return info.rc == mqtt.MQTT_ERR_SUCCESS

            info.wait_for_publish(timeout=2.0)
            if info.is_published():
                return True

            logger.error("Publish timeout for topic %s", topic)
            return False
        except Exception as exc:
            logger.error("Exception publishing to %s: %s", topic, exc)
            return False

    def publish_command(self, device_id: str, payload: dict[str, Any]) -> bool:
        return self.publish_json(self.command_topic(device_id), payload)

    def enqueue_command(self, device_id: str, payload: dict[str, Any]) -> bool:
        # Automation paths only need broker enqueue confirmation here. Device-level
        # acknowledgement is handled later via state updates rather than publish blocking.
        return self.publish_json(
            self.command_topic(device_id),
            payload,
            wait_for_publish=False,
        )


mqtt_manager = MQTTClientManager()
