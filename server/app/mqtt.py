# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

from __future__ import annotations

import json
import logging
import os
import uuid
import copy
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Mapping

import paho.mqtt.client as mqtt
from dotenv import load_dotenv
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.orm import Session

import asyncio
from app.database import SessionLocal
from app.models import DeviceRegister
from app.runtime_timestamps import normalize_build_job_timestamp
from app.services.builder import (
    cleanup_job_build_outputs,
    build_job_firmware_version,
    describe_runtime_firmware_mismatch,
    extract_runtime_firmware_network_targets,
    promote_build_job_project_config,
)
from app.services.system_logs import create_system_log, record_system_log
from app.services.device_registration import (
    build_pairing_request_event_payload,
    build_registration_ack_payload,
    register_device_payload,
)
from app.services.automation_runtime import process_state_event_for_automations
from app.services.automation_devices import dispatch_external_device_automation_command
from app.services.command_ordering import command_ordering_manager
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


def _utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _job_reference_time(job, *, reference_time: datetime | None = None) -> datetime:
    candidate = job.finished_at or job.updated_at or job.created_at
    return normalize_build_job_timestamp(
        candidate,
        reference_time=reference_time or _utcnow_naive(),
    )


def _mark_ota_job_failed(job, *, now: datetime, message: str) -> None:
    job.status = JobStatus.flash_failed
    job.error_message = message
    job.finished_at = now
    job.updated_at = now


def _reconcile_ota_jobs(db: Session, device: Device, reported_version: str) -> str:
    if not device.provisioning_project_id or not reported_version:
        return "noop"

    from app.sql_models import BuildJob, JobStatus

    now = _utcnow_naive()
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
        promote_build_job_project_config(matched_job)
        cleanup_job_build_outputs(matched_job.id)
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
        delta = now - _job_reference_time(job, reference_time=now)
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
        key=lambda job: _job_reference_time(job, reference_time=now),
        reverse=True,
    )
    recent_flashed_job = next(
        (
            job
            for job in recent_flashed_jobs
            if now - _job_reference_time(job, reference_time=now) <= OTA_RECENT_FLASH_CONFIRMATION_WINDOW
        ),
        None,
    )
    if not recent_flashed_job:
        return "noop"

    expected_version = build_job_firmware_version(recent_flashed_job.id)
    if reported_version == expected_version:
        promote_build_job_project_config(recent_flashed_job)
        cleanup_job_build_outputs(recent_flashed_job.id)
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


_STATE_PIN_TOP_LEVEL_KEYS = {
    "pin",
    "value",
    "brightness",
    "restore_value",
    "restore_brightness",
    "mode",
    "function",
    "label",
    "extra_params",
    "active_level",
    "datatype",
    "trend",
    "unit",
    "pins",
}
_STATE_METADATA_EXCLUDED_KEYS = {
    "pin",
    "value",
    "brightness",
    "restore_value",
    "restore_brightness",
    "pins",
    "reported_at",
    "command_id",
    "applied",
    "predicted",
}
_PREDICTED_STATE_STALE_METADATA_KEYS = {
    "event",
    "job_id",
    "message",
    "status",
}


def _coerce_pin_number(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


def _coerce_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


def _coerce_pin_mode(pin_config: Any) -> str | None:
    raw_mode = getattr(pin_config, "mode", None)
    if hasattr(raw_mode, "value"):
        raw_mode = raw_mode.value
    return str(raw_mode).strip().upper() if raw_mode else None


def _copy_json_value(value: Any) -> Any:
    return copy.deepcopy(value)


def _pwm_bounds_from_extra_params(extra_params: Mapping[str, Any] | None) -> tuple[int, int]:
    if not isinstance(extra_params, Mapping):
        return 0, 255

    raw_min = _coerce_int(extra_params.get("min_value"))
    raw_max = _coerce_int(extra_params.get("max_value"))
    return raw_min if raw_min is not None else 0, raw_max if raw_max is not None else 255


def _pwm_off_output_value(extra_params: Mapping[str, Any] | None) -> int:
    pwm_min, pwm_max = _pwm_bounds_from_extra_params(extra_params)
    return pwm_min if pwm_min > pwm_max else 0


def _pwm_on_output_value(extra_params: Mapping[str, Any] | None) -> int:
    _pwm_min, pwm_max = _pwm_bounds_from_extra_params(extra_params)
    return pwm_max


def _clamp_pwm_value(extra_params: Mapping[str, Any] | None, value: int) -> int:
    pwm_min, pwm_max = _pwm_bounds_from_extra_params(extra_params)
    lower_bound = pwm_min if pwm_min < pwm_max else pwm_max
    upper_bound = pwm_min if pwm_min > pwm_max else pwm_max
    return max(lower_bound, min(upper_bound, value))


def _coerce_pwm_control_value(
    row: Mapping[str, Any] | None,
    *,
    extra_params: Mapping[str, Any] | None,
) -> int | None:
    if not isinstance(row, Mapping):
        return None

    numeric_value = _coerce_int(row.get("value"))
    legacy_brightness = _coerce_int(row.get("brightness"))

    if legacy_brightness is not None and (numeric_value is None or numeric_value in {0, 1}):
        return _clamp_pwm_value(extra_params, legacy_brightness)
    if numeric_value is None:
        return None
    return _clamp_pwm_value(extra_params, numeric_value)


def _coerce_pwm_restore_value(
    row: Mapping[str, Any] | None,
    *,
    extra_params: Mapping[str, Any] | None,
) -> int | None:
    if not isinstance(row, Mapping):
        return None

    restore_value = _coerce_int(row.get("restore_value"))
    legacy_restore_brightness = _coerce_int(row.get("restore_brightness"))

    if legacy_restore_brightness is not None and (restore_value is None or restore_value in {0, 1}):
        return _clamp_pwm_value(extra_params, legacy_restore_brightness)
    if restore_value is None:
        return None
    return _clamp_pwm_value(extra_params, restore_value)


def _extract_effective_command_value(command: Mapping[str, Any] | None) -> int | None:
    if not isinstance(command, Mapping):
        return None

    numeric_value = _coerce_int(command.get("value"))
    if numeric_value is not None:
        return numeric_value
    return _coerce_int(command.get("brightness"))


def _extract_effective_state_value(state_row: Mapping[str, Any] | None) -> int | None:
    if not isinstance(state_row, Mapping):
        return None

    extra_params = state_row.get("extra_params") if isinstance(state_row.get("extra_params"), Mapping) else None
    if "brightness" in state_row:
        return _coerce_pwm_control_value(state_row, extra_params=extra_params)

    value = state_row.get("value")
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


def _copy_state_pin_row(row: Mapping[str, Any]) -> dict[str, Any]:
    return {key: _copy_json_value(value) for key, value in row.items()}


def _extract_state_top_level_row(state_payload: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(state_payload, Mapping):
        return None

    pin_number = _coerce_pin_number(state_payload.get("pin"))
    if pin_number is None:
        return None

    row: dict[str, Any] = {"pin": pin_number}
    for key in _STATE_PIN_TOP_LEVEL_KEYS:
        if key in {"pin", "pins"}:
            continue
        if key in state_payload:
            row[key] = _copy_json_value(state_payload[key])
    return row


def _extract_state_pin_rows_by_pin(state_payload: Mapping[str, Any] | None) -> dict[int, dict[str, Any]]:
    rows: dict[int, dict[str, Any]] = {}
    if not isinstance(state_payload, Mapping):
        return rows

    raw_pins = state_payload.get("pins")
    if isinstance(raw_pins, list):
        for row in raw_pins:
            if not isinstance(row, Mapping):
                continue
            pin_number = _coerce_pin_number(row.get("pin"))
            if pin_number is None:
                continue
            rows[pin_number] = _copy_state_pin_row(row)

    top_level_row = _extract_state_top_level_row(state_payload)
    if top_level_row is not None:
        rows[top_level_row["pin"]] = {
            **rows.get(top_level_row["pin"], {}),
            **top_level_row,
        }

    return rows


def _build_pin_row_from_config(pin_config: Any) -> dict[str, Any]:
    pin_number = _coerce_pin_number(getattr(pin_config, "gpio_pin", None))
    if pin_number is None:
        raise ValueError("Pin configuration must provide a numeric gpio_pin")

    mode = _coerce_pin_mode(pin_config)
    extra_params = getattr(pin_config, "extra_params", None)
    extra_params = _copy_json_value(extra_params) if isinstance(extra_params, Mapping) else {}
    row: dict[str, Any] = {
        "pin": pin_number,
        "mode": mode,
        "function": getattr(pin_config, "function", None),
        "label": getattr(pin_config, "label", None),
        "extra_params": extra_params,
    }

    if mode == "OUTPUT":
        active_level = _coerce_int(extra_params.get("active_level")) if isinstance(extra_params, Mapping) else None
        row["value"] = 0
        if active_level in (0, 1):
            row["active_level"] = active_level
    elif mode == "PWM":
        row["value"] = _pwm_off_output_value(extra_params)

    return row


def _copy_snapshot_metadata(*sources: Mapping[str, Any] | None) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for source in sources:
        if not isinstance(source, Mapping):
            continue
        for key, value in source.items():
            if key in _STATE_METADATA_EXCLUDED_KEYS:
                continue
            payload[key] = _copy_json_value(value)
    return payload


def _enrich_restore_fields(
    row: dict[str, Any],
    *,
    previous_row: Mapping[str, Any] | None = None,
) -> None:
    previous_row = previous_row if isinstance(previous_row, Mapping) else {}
    mode = str(row.get("mode") or "").upper()

    if mode == "PWM":
        extra_params = row.get("extra_params") if isinstance(row.get("extra_params"), Mapping) else {}
        off_output = _pwm_off_output_value(extra_params)
        current_value = _coerce_pwm_control_value(row, extra_params=extra_params)
        previous_restore_value = _coerce_pwm_restore_value(previous_row, extra_params=extra_params)
        previous_value = _coerce_pwm_control_value(previous_row, extra_params=extra_params)

        if current_value is None:
            current_value = previous_value if previous_value is not None else off_output

        row["value"] = _clamp_pwm_value(extra_params, current_value)

        if row["value"] == off_output:
            remembered_value = previous_restore_value
            if remembered_value is None and previous_value is not None and previous_value != off_output:
                remembered_value = previous_value
            if remembered_value is None or remembered_value == off_output:
                remembered_value = _pwm_on_output_value(extra_params)
            row["restore_value"] = _clamp_pwm_value(extra_params, remembered_value)
        else:
            row["restore_value"] = row["value"]
        row.pop("brightness", None)
        row.pop("restore_brightness", None)
        return

    if mode == "OUTPUT":
        current_value = _coerce_int(row.get("value"))
        if current_value is None:
            current_value = _coerce_int(previous_row.get("value"))
        row["value"] = 0 if current_value == 0 else 1
        row["restore_value"] = 1 if row["value"] != 0 else (_coerce_int(previous_row.get("restore_value")) or 1)
        return

    row.pop("restore_value", None)
    row.pop("restore_brightness", None)


def _finalize_state_payload(
    rows_by_pin: dict[int, dict[str, Any]],
    *,
    metadata: Mapping[str, Any] | None = None,
    reported_at: str | None = None,
) -> dict[str, Any]:
    payload = dict(metadata) if isinstance(metadata, Mapping) else {}
    if reported_at:
        payload["reported_at"] = reported_at

    pins = [_copy_state_pin_row(rows_by_pin[pin]) for pin in sorted(rows_by_pin)]
    payload["pins"] = pins

    if len(pins) == 1:
        row = pins[0]
        payload["pin"] = row["pin"]
        for key in ("value", "brightness", "restore_value", "restore_brightness"):
            if key in row:
                payload[key] = row[key]
        if "mode" in row:
            payload["mode"] = row["mode"]
    else:
        for key in ("pin", "value", "brightness", "restore_value", "restore_brightness", "mode"):
            payload.pop(key, None)

    return payload


def _build_physical_device_rows(
    previous_state: Mapping[str, Any] | None,
    pin_configurations: Iterable[Any],
) -> tuple[dict[int, dict[str, Any]], dict[int, dict[str, Any]], dict[int, Any]]:
    previous_rows = _extract_state_pin_rows_by_pin(previous_state)
    pin_config_map: dict[int, Any] = {}

    for pin_config in pin_configurations:
        pin_number = _coerce_pin_number(getattr(pin_config, "gpio_pin", None))
        if pin_number is None:
            continue
        pin_config_map[pin_number] = pin_config

    if pin_config_map:
        rows_by_pin: dict[int, dict[str, Any]] = {}
    else:
        rows_by_pin = {
            pin_number: _copy_state_pin_row(row)
            for pin_number, row in previous_rows.items()
        }

    for pin_number, pin_config in pin_config_map.items():
        config_row = _build_pin_row_from_config(pin_config)
        previous_row = previous_rows.get(pin_number)
        rows_by_pin[pin_number] = {
            **config_row,
            **(_copy_state_pin_row(previous_row) if isinstance(previous_row, Mapping) else {}),
        }

    for pin_number, row in rows_by_pin.items():
        _enrich_restore_fields(row, previous_row=previous_rows.get(pin_number))

    return rows_by_pin, previous_rows, pin_config_map


def sanitize_physical_device_state_payload(
    state_payload: Mapping[str, Any] | None,
    pin_configurations: Iterable[Any],
) -> dict[str, Any] | None:
    if not isinstance(state_payload, Mapping):
        return None

    rows_by_pin, _previous_rows, pin_config_map = _build_physical_device_rows(state_payload, pin_configurations)
    if not pin_config_map:
        copied_payload = _copy_json_value(state_payload)
        return copied_payload if isinstance(copied_payload, dict) else None

    reported_at = None
    raw_reported_at = state_payload.get("reported_at")
    if isinstance(raw_reported_at, str) and raw_reported_at.strip():
        reported_at = raw_reported_at

    metadata = {
        key: _copy_json_value(value)
        for key, value in state_payload.items()
        if key not in {"pin", "value", "brightness", "restore_value", "restore_brightness", "pins", "reported_at"}
    }

    return _finalize_state_payload(
        rows_by_pin,
        metadata=metadata,
        reported_at=reported_at,
    )


def load_latest_device_state_payload(db: Session, device_id: str) -> tuple[DeviceHistory | None, dict[str, Any] | None]:
    latest_state = (
        db.query(DeviceHistory)
        .filter(
            DeviceHistory.device_id == device_id,
            DeviceHistory.event_type == EventType.state_change,
        )
        .order_by(DeviceHistory.timestamp.desc(), DeviceHistory.id.desc())
        .first()
    )

    if latest_state is None:
        return None, None

    try:
        decoded = json.loads(latest_state.payload)
    except json.JSONDecodeError:
        return latest_state, None

    return latest_state, decoded if isinstance(decoded, dict) else None


def enrich_reported_mqtt_state(
    previous_state: Mapping[str, Any] | None,
    pin_configurations: Iterable[Any],
    state_payload: Mapping[str, Any] | None,
) -> dict[str, Any]:
    rows_by_pin, previous_rows, pin_config_map = _build_physical_device_rows(previous_state, pin_configurations)
    incoming_rows = _extract_state_pin_rows_by_pin(state_payload)

    for pin_number, incoming_row in incoming_rows.items():
        if pin_config_map and pin_number not in pin_config_map:
            continue
        current_row = rows_by_pin.get(pin_number, {})
        rows_by_pin[pin_number] = {
            **current_row,
            **_copy_state_pin_row(incoming_row),
        }

    for pin_number, row in rows_by_pin.items():
        if pin_number in pin_config_map:
            row.update(
                {
                    key: value
                    for key, value in _build_pin_row_from_config(pin_config_map[pin_number]).items()
                    if key not in row or row[key] is None
                }
            )
        _enrich_restore_fields(row, previous_row=previous_rows.get(pin_number))

    metadata = _copy_snapshot_metadata(previous_state, state_payload)
    metadata["predicted"] = False
    return _finalize_state_payload(
        rows_by_pin,
        metadata=metadata,
        reported_at=str(state_payload.get("reported_at")) if isinstance(state_payload, Mapping) and state_payload.get("reported_at") else None,
    )


def build_predicted_mqtt_state(
    previous_state: Mapping[str, Any] | None,
    pin_configurations: Iterable[Any],
    command: Mapping[str, Any] | None,
) -> dict[str, Any] | None:
    if not isinstance(command, Mapping):
        return None

    command_kind = str(command.get("kind") or "action").strip().lower()
    if command_kind != "action":
        return None

    target_pin = _coerce_pin_number(command.get("pin"))
    if target_pin is None:
        return None

    rows_by_pin, previous_rows, pin_config_map = _build_physical_device_rows(previous_state, pin_configurations)
    target_row = _copy_state_pin_row(rows_by_pin.get(target_pin, {"pin": target_pin}))
    target_mode = str(target_row.get("mode") or "").upper()
    if not target_mode and target_pin in pin_config_map:
        target_row.update(_build_pin_row_from_config(pin_config_map[target_pin]))
        target_mode = str(target_row.get("mode") or "").upper()

    if target_mode == "OUTPUT":
        next_value = _coerce_int(command.get("value"))
        if next_value is None:
            return None
        target_row["value"] = 0 if next_value == 0 else 1
    elif target_mode == "PWM":
        extra_params = target_row.get("extra_params") if isinstance(target_row.get("extra_params"), Mapping) else {}
        off_output = _pwm_off_output_value(extra_params)
        requested_value = _coerce_int(command.get("value"))
        requested_brightness = _coerce_int(command.get("brightness"))
        requested_power = command.get("power")
        remembered_value = _coerce_pwm_restore_value(target_row, extra_params=extra_params)
        current_value = _coerce_pwm_control_value(target_row, extra_params=extra_params)

        if isinstance(requested_power, bool):
            if not requested_power:
                requested_value = off_output
            elif requested_value is None and requested_brightness is None:
                if remembered_value is not None and remembered_value != off_output:
                    requested_value = remembered_value
                elif current_value is not None and current_value != off_output:
                    requested_value = current_value
                else:
                    requested_value = _pwm_on_output_value(extra_params)

        if requested_value is None:
            requested_value = requested_brightness

        if requested_value is None:
            return None

        target_row["value"] = _clamp_pwm_value(extra_params, requested_value)
    else:
        return None

    _enrich_restore_fields(target_row, previous_row=previous_rows.get(target_pin))
    rows_by_pin[target_pin] = target_row

    metadata = _copy_snapshot_metadata(previous_state)
    for key in _PREDICTED_STATE_STALE_METADATA_KEYS:
        metadata.pop(key, None)
    metadata["kind"] = command_kind
    metadata["predicted"] = True
    if not metadata.get("kind"):
        metadata["kind"] = command_kind

    return _finalize_state_payload(rows_by_pin, metadata=metadata)


def _extract_state_pin_rows(state_payload: dict[str, Any]) -> list[dict[str, Any]]:
    pins = state_payload.get("pins")
    if not isinstance(pins, list):
        return []
    return [row for row in pins if isinstance(row, dict)]


def _state_row_matches_command(command: dict[str, Any], state_row: dict[str, Any]) -> bool:
    command_value = _extract_effective_command_value(command)
    state_value = _extract_effective_state_value(state_row)
    return state_value is not None and command_value is not None and state_value == command_value


def _build_command_ack_resolution_payload(
    enriched_state_payload: Mapping[str, Any] | None,
    raw_state_payload: Mapping[str, Any] | None,
) -> dict[str, Any]:
    if isinstance(enriched_state_payload, Mapping):
        payload = _copy_json_value(enriched_state_payload)
        if not isinstance(payload, dict):
            payload = dict(enriched_state_payload)
    else:
        payload = {}

    if not isinstance(raw_state_payload, Mapping):
        return payload

    if "command_id" in raw_state_payload:
        payload["command_id"] = _copy_json_value(raw_state_payload.get("command_id"))
    if "applied" in raw_state_payload:
        payload["applied"] = _copy_json_value(raw_state_payload.get("applied"))
    return payload


def _pending_command_priority(item: tuple[str, dict[str, Any]]) -> tuple[int, float]:
    _command_id, command = item
    sequence_number = _coerce_int(command.get("sequence_number"))
    timestamp = command.get("timestamp")
    try:
        numeric_timestamp = float(timestamp)
    except (TypeError, ValueError):
        numeric_timestamp = 0.0
    return sequence_number if sequence_number is not None else 0, numeric_timestamp


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

    def latest_pending_predicted_state(self, device_id: str) -> dict[str, Any] | None:
        latest_match: dict[str, Any] | None = None
        latest_priority = (float("-inf"), float("-inf"))
        for pending in self.pending_commands.values():
            if pending.get("device_id") != device_id:
                continue
            predicted_state = pending.get("predicted_state")
            if not isinstance(predicted_state, dict):
                continue
            sequence_number = _coerce_int(pending.get("sequence_number"))
            try:
                timestamp = float(pending.get("timestamp") or 0.0)
            except (TypeError, ValueError):
                timestamp = 0.0
            priority = (float(sequence_number if sequence_number is not None else 0), timestamp)
            if latest_match is None or priority >= latest_priority:
                latest_match = predicted_state
                latest_priority = priority

        return _copy_json_value(latest_match) if isinstance(latest_match, dict) else None

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

            observed_at = datetime.now(timezone.utc)
            was_offline = device.conn_status != ConnStatus.online
            previous_revision = device.firmware_revision
            previous_version = device.firmware_version
            _latest_state_record, previous_state = load_latest_device_state_payload(db, device.device_id)
            device.conn_status = ConnStatus.online
            device.last_seen = observed_at
            enriched_state_payload: dict[str, Any] | None = None
            if isinstance(payload_json, dict):
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

                enriched_state_payload = enrich_reported_mqtt_state(
                    previous_state,
                    device.pin_configurations,
                    {
                        **payload_json,
                        "reported_at": observed_at.isoformat(),
                    },
                )
                self.resolve_command_ack(
                    device_id,
                    _build_command_ack_resolution_payload(
                        enriched_state_payload,
                        payload_json,
                    ),
                    db,
                )

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
                    payload=json.dumps(enriched_state_payload if isinstance(enriched_state_payload, dict) else payload_json or {}),
                )
            )

            try:
                ws_manager.broadcast_device_event_sync(
                    "device_state",
                    device_id,
                    device.room_id,
                    enriched_state_payload if isinstance(enriched_state_payload, dict) else {
                        **(payload_json or {}),
                        "reported_at": observed_at.isoformat(),
                    },
                )
            except Exception:
                pass

            if isinstance(enriched_state_payload, dict):
                try:
                    import time
                    start_time = time.perf_counter()
                    def dispatch_command(target_device_id: str, command: dict[str, Any]) -> bool:
                        physical_device = db.query(Device).filter(Device.device_id == target_device_id).first()
                        if physical_device is not None:
                            return self.enqueue_command(target_device_id, command)

                        def on_state_change(
                            changed_device_id: str,
                            current_payload: dict[str, Any],
                            previous_payload: dict[str, Any] | None,
                        ) -> None:
                            process_state_event_for_automations(
                                db,
                                device_id=changed_device_id,
                                state_payload=current_payload,
                                previous_state_payload=previous_payload,
                                publish_command=dispatch_command,
                                triggered_at=observed_at,
                            )

                        return dispatch_external_device_automation_command(
                            db,
                            device_id=target_device_id,
                            command=command,
                            on_state_change=on_state_change,
                        )

                    process_state_event_for_automations(
                        db,
                        device_id=device_id,
                        state_payload=enriched_state_payload,
                        publish_command=dispatch_command,
                        triggered_at=observed_at,
                    )
                    end_time = time.perf_counter()
                    logger.debug(f"Automation execution took {(end_time - start_time) * 1000:.2f}ms for device {device_id}")
                except Exception:
                    logger.exception("Automation graph evaluation failed for MQTT state %s", device_id)

            # Check if this is an OTA status report from the device
            if isinstance(payload_json, dict) and payload_json.get("event") == "ota_status":
                from app.sql_models import BuildJob, JobStatus
                job_id = payload_json.get("job_id")
                ota_status = payload_json.get("status")

                if job_id and ota_status:
                    job = db.query(BuildJob).filter(BuildJob.id == job_id).first()
                    if job:
                        ota_event_time = _utcnow_naive()
                        if ota_status == "success":
                            job.status = JobStatus.flashed
                            job.error_message = None
                        elif ota_status == "failed":
                            _mark_ota_job_failed(
                                job,
                                now=ota_event_time,
                                message=payload_json.get("message") or "OTA status reported failure.",
                            )

                        if ota_status == "success":
                            job.finished_at = ota_event_time
                            job.updated_at = ota_event_time
                            cleanup_job_build_outputs(job.id)
                            if device.firmware_version:
                                _reconcile_ota_jobs(db, device, device.firmware_version)
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
            state_value = _extract_effective_state_value(state_payload)

            pending_items = sorted(
                list(self.pending_commands.items()),
                key=_pending_command_priority,
                reverse=True,
            )

            for cid, cmd in pending_items:
                if cmd["device_id"] == device_id and cmd.get("pin") == pin:
                    if state_value is not None and _extract_effective_command_value(cmd) == state_value:
                        matched_cmd_id = cid
                        break

            if not matched_cmd_id:
                pin_rows = _extract_state_pin_rows(state_payload)
                for cid, cmd in pending_items:
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
                command_ordering_manager.complete(matched_cmd_id)
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
            
            try:
                from app.services.system_logs import create_system_log 
                from app.sql_models import SystemLogSeverity, SystemLogCategory
                create_system_log(
                    db,
                    occurred_at=datetime.now(timezone.utc),
                    severity=SystemLogSeverity.error,
                    category=SystemLogCategory.connectivity,
                    event_code="device_registration_rejected",
                    message=f"Device pairing rejected: {detail.get('message', str(exc.detail))}",
                    device_id=device_id,
                    details=detail
                )
                db.commit()
            except Exception:
                pass

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
