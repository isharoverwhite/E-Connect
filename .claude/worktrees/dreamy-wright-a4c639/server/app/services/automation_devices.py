# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

from __future__ import annotations

import copy
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any, Callable, Mapping

from sqlalchemy.orm import Session, joinedload

from app.ws_manager import manager as ws_manager

from ..sql_models import AuthStatus, ConnStatus, ExternalDevice, PinMode
from .external_runtime import (
    ExternalDeviceRuntimeError,
    ExternalDeviceRuntimeUnsupportedError,
    ExternalDeviceRuntimeValidationError,
    execute_external_device_command,
)

AUTOMATION_EXTERNAL_POWER_PIN = 0
AUTOMATION_EXTERNAL_VALUE_PIN = 1
AUTOMATION_EXTERNAL_SPEED_PIN = 2
AUTOMATION_EXTERNAL_TEMPERATURE_PIN = 3
AUTOMATION_EXTERNAL_HUMIDITY_PIN = 4
AUTOMATION_EXTERNAL_SENSOR_VALUE_PIN = 5

_CAPABILITY_POWER = "power"
_CAPABILITY_BRIGHTNESS = "brightness"
_CAPABILITY_SPEED = "speed"
_CAPABILITY_TEMPERATURE = "temperature"
_CAPABILITY_HUMIDITY = "humidity"
_CAPABILITY_VALUE = "value"

_DEFAULT_CAPABILITIES_BY_CARD_TYPE: dict[str, tuple[str, ...]] = {
    "light": (_CAPABILITY_POWER, _CAPABILITY_BRIGHTNESS),
    "switch": (_CAPABILITY_POWER,),
    "fan": (_CAPABILITY_POWER,),
    "sensor": (_CAPABILITY_VALUE,),
}

StateChangeCallback = Callable[[str, dict[str, Any], dict[str, Any] | None], None]


def attach_external_device_automation_metadata(device: ExternalDevice) -> ExternalDevice:
    setattr(device, "pin_configurations", build_external_device_automation_pins(device))
    setattr(device, "is_external", True)
    return device


def build_external_device_automation_pins(device: ExternalDevice) -> list[SimpleNamespace]:
    device_id = str(getattr(device, "device_id", "") or "")
    capabilities = _resolve_external_capabilities(device)
    pins: list[SimpleNamespace] = []

    if _CAPABILITY_POWER in capabilities:
        pins.append(
            SimpleNamespace(
                id=-1,
                device_id=device_id,
                gpio_pin=AUTOMATION_EXTERNAL_POWER_PIN,
                mode=PinMode.OUTPUT,
                function="switch",
                label="Power",
                v_pin=None,
                extra_params={"external_field": "power"},
            )
        )

    if _CAPABILITY_BRIGHTNESS in capabilities:
        pins.append(
            SimpleNamespace(
                id=-2,
                device_id=device_id,
                gpio_pin=AUTOMATION_EXTERNAL_VALUE_PIN,
                mode=PinMode.PWM,
                function="brightness",
                label="Brightness",
                v_pin=None,
                extra_params={"external_field": "brightness"},
            )
        )

    if _CAPABILITY_SPEED in capabilities:
        pins.append(
            SimpleNamespace(
                id=-3,
                device_id=device_id,
                gpio_pin=AUTOMATION_EXTERNAL_SPEED_PIN,
                mode=PinMode.PWM,
                function="fan_speed",
                label="Speed",
                v_pin=None,
                extra_params={"external_field": "speed", "min_value": 0, "max_value": 100},
            )
        )

    if _CAPABILITY_TEMPERATURE in capabilities:
        pins.append(
            SimpleNamespace(
                id=-4,
                device_id=device_id,
                gpio_pin=AUTOMATION_EXTERNAL_TEMPERATURE_PIN,
                mode=PinMode.ADC,
                function="temperature_sensor",
                label="Temperature",
                v_pin=None,
                extra_params={"external_field": "temperature"},
            )
        )

    if _CAPABILITY_HUMIDITY in capabilities:
        pins.append(
            SimpleNamespace(
                id=-5,
                device_id=device_id,
                gpio_pin=AUTOMATION_EXTERNAL_HUMIDITY_PIN,
                mode=PinMode.ADC,
                function="humidity_sensor",
                label="Humidity",
                v_pin=None,
                extra_params={"external_field": "humidity"},
            )
        )

    if _CAPABILITY_VALUE in capabilities:
        pins.append(
            SimpleNamespace(
                id=-6,
                device_id=device_id,
                gpio_pin=AUTOMATION_EXTERNAL_SENSOR_VALUE_PIN,
                mode=PinMode.ADC,
                function="sensor",
                label="Value",
                v_pin=None,
                extra_params={"external_field": "value"},
            )
        )

    return pins


def serialize_external_device_automation_pins(device: ExternalDevice) -> list[dict[str, Any]]:
    serialized: list[dict[str, Any]] = []
    for pin in build_external_device_automation_pins(device):
        serialized.append(
            {
                "id": pin.id,
                "device_id": pin.device_id,
                "gpio_pin": pin.gpio_pin,
                "mode": pin.mode,
                "function": pin.function,
                "label": pin.label,
                "v_pin": pin.v_pin,
                "extra_params": pin.extra_params,
            }
        )
    return serialized


def build_external_device_state_payload(
    device: ExternalDevice,
    *,
    state: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    effective_state = state if isinstance(state, Mapping) else {}
    if not effective_state and isinstance(getattr(device, "last_state", None), dict):
        effective_state = getattr(device, "last_state")

    payload: dict[str, Any] = {"pins": []}
    capabilities = _resolve_external_capabilities(device)
    power_state = _coerce_binary_state(
        effective_state.get("power"),
        effective_state.get("value"),
        effective_state.get("brightness"),
        effective_state.get("speed"),
    )
    brightness_value = _coerce_number(effective_state.get("brightness"))
    speed_value = _coerce_number(effective_state.get("speed"))
    temperature_value = _coerce_number(effective_state.get("temperature"))
    humidity_value = _coerce_number(effective_state.get("humidity"))
    sensor_value = _coerce_state_scalar(effective_state.get("value"))
    runtime_unit = _coerce_string(effective_state.get("unit"))
    runtime_trend = _coerce_string(effective_state.get("trend"))
    reported_at = effective_state.get("reported_at")

    if _CAPABILITY_POWER in capabilities and power_state is not None:
        payload["pins"].append(
            {
                "pin": AUTOMATION_EXTERNAL_POWER_PIN,
                "value": 1 if power_state else 0,
                "power": "on" if power_state else "off",
            }
        )

    if _CAPABILITY_BRIGHTNESS in capabilities and brightness_value is not None:
        payload["pins"].append(
            {
                "pin": AUTOMATION_EXTERNAL_VALUE_PIN,
                "value": brightness_value,
                "brightness": brightness_value,
            }
        )

    if _CAPABILITY_SPEED in capabilities and speed_value is not None:
        payload["pins"].append(
            {
                "pin": AUTOMATION_EXTERNAL_SPEED_PIN,
                "value": speed_value,
                "unit": "%",
            }
        )

    if _CAPABILITY_TEMPERATURE in capabilities and temperature_value is not None:
        payload["pins"].append(
            {
                "pin": AUTOMATION_EXTERNAL_TEMPERATURE_PIN,
                "value": temperature_value,
                "temperature": temperature_value,
                "unit": runtime_unit or "°C",
                "trend": runtime_trend,
            }
        )

    if _CAPABILITY_HUMIDITY in capabilities and humidity_value is not None:
        payload["pins"].append(
            {
                "pin": AUTOMATION_EXTERNAL_HUMIDITY_PIN,
                "value": humidity_value,
                "humidity": humidity_value,
                "unit": "%",
                "trend": runtime_trend,
            }
        )

    if _CAPABILITY_VALUE in capabilities and sensor_value is not None:
        payload["pins"].append(
            {
                "pin": AUTOMATION_EXTERNAL_SENSOR_VALUE_PIN,
                "value": sensor_value,
                "unit": runtime_unit,
                "trend": runtime_trend,
            }
        )

    if reported_at is not None:
        payload["reported_at"] = reported_at
    return payload


def build_external_device_action_command(
    device: ExternalDevice,
    *,
    action_kind: str,
    pin: int,
    value: Any,
) -> dict[str, Any]:
    capabilities = _resolve_external_capabilities(device)

    if pin == AUTOMATION_EXTERNAL_POWER_PIN:
        if action_kind != "set_output":
            raise ValueError("External power automation pins only support set_output actions.")
        if _CAPABILITY_POWER not in capabilities:
            raise ValueError("External device does not expose power automation control.")
        return {"kind": "action", "value": 1 if _coerce_bool_required(value) else 0}

    if pin == AUTOMATION_EXTERNAL_VALUE_PIN:
        if action_kind != "set_value":
            raise ValueError("External brightness automation pins only support set_value actions.")
        if _CAPABILITY_BRIGHTNESS not in capabilities:
            raise ValueError("External device does not expose brightness automation control.")
        numeric_value = _coerce_numeric_required(value)
        if float(numeric_value).is_integer():
            numeric_value = int(numeric_value)
        return {"kind": "action", "brightness": numeric_value}

    if pin == AUTOMATION_EXTERNAL_SPEED_PIN:
        if action_kind != "set_value":
            raise ValueError("External fan speed automation pins only support set_value actions.")
        if _CAPABILITY_SPEED not in capabilities:
            raise ValueError("External device does not expose fan speed automation control.")
        numeric_value = _coerce_numeric_required(value)
        if float(numeric_value).is_integer():
            numeric_value = int(numeric_value)
        return {"kind": "action", "speed": numeric_value}

    raise ValueError(f"External automation pin '{pin}' is not supported.")


def dispatch_external_device_automation_command(
    db: Session,
    *,
    device_id: str,
    command: Mapping[str, Any],
    on_state_change: StateChangeCallback | None = None,
) -> bool:
    external_device = (
        db.query(ExternalDevice)
        .options(joinedload(ExternalDevice.installed_extension))
        .filter(ExternalDevice.device_id == device_id)
        .first()
    )
    if external_device is None:
        return False
    if external_device.auth_status != AuthStatus.approved:
        return False

    pin = _coerce_int(command.get("pin"))
    if pin is None:
        return False

    if pin == AUTOMATION_EXTERNAL_POWER_PIN and "value" in command:
        action_kind = "set_output"
        raw_value = command.get("value")
    elif pin == AUTOMATION_EXTERNAL_VALUE_PIN and "value" in command:
        action_kind = "set_value"
        raw_value = command.get("value")
    elif pin == AUTOMATION_EXTERNAL_SPEED_PIN and "value" in command:
        action_kind = "set_value"
        raw_value = command.get("value")
    elif "brightness" in command:
        action_kind = "set_value"
        raw_value = command.get("brightness")
    elif "speed" in command:
        action_kind = "set_value"
        raw_value = command.get("speed")
    else:
        return False

    try:
        runtime_command = build_external_device_action_command(
            external_device,
            action_kind=action_kind,
            pin=pin,
            value=raw_value,
        )
    except ValueError:
        return False

    previous_status = external_device.conn_status
    previous_state = copy.deepcopy(external_device.last_state) if isinstance(external_device.last_state, dict) else {}
    previous_payload = build_external_device_state_payload(external_device, state=previous_state)

    try:
        runtime_result = execute_external_device_command(external_device, runtime_command)
    except (ExternalDeviceRuntimeValidationError, ExternalDeviceRuntimeUnsupportedError):
        return False
    except ExternalDeviceRuntimeError as exc:
        if exc.mark_offline:
            external_device.conn_status = ConnStatus.offline
            db.add(external_device)
            db.flush()
            try:
                ws_manager.broadcast_device_event_sync(
                    "device_offline",
                    external_device.device_id,
                    external_device.room_id,
                    {
                        "reported_at": datetime.now(timezone.utc).isoformat(),
                        "reason": str(exc),
                    },
                )
            except Exception:
                pass
        return False

    runtime_state = runtime_result.state if isinstance(runtime_result.state, dict) else {}
    if not runtime_state:
        return False

    external_device.last_state = runtime_state
    external_device.last_seen = _coerce_runtime_reported_at(runtime_state.get("reported_at"))
    external_device.conn_status = ConnStatus.online
    db.add(external_device)
    db.flush()

    current_payload = build_external_device_state_payload(external_device, state=runtime_state)
    state_changed = _canonicalize_state_payload(previous_payload) != _canonicalize_state_payload(current_payload)

    if previous_status != ConnStatus.online:
        try:
            ws_manager.broadcast_device_event_sync(
                "device_online",
                external_device.device_id,
                external_device.room_id,
                runtime_state,
            )
        except Exception:
            pass

    try:
        ws_manager.broadcast_device_event_sync(
            "device_state",
            external_device.device_id,
            external_device.room_id,
            runtime_state,
        )
    except Exception:
        pass

    if on_state_change is not None and state_changed:
        on_state_change(external_device.device_id, current_payload, previous_payload)

    return True


def _resolve_external_capabilities(device: ExternalDevice) -> tuple[str, ...]:
    schema_snapshot = device.schema_snapshot if isinstance(device.schema_snapshot, dict) else {}
    display = schema_snapshot.get("display") if isinstance(schema_snapshot.get("display"), dict) else {}
    raw_capabilities = display.get("capabilities") if isinstance(display.get("capabilities"), list) else []
    card_type = _resolve_external_card_type(device)

    capabilities: list[str] = []
    for raw_value in raw_capabilities:
        if isinstance(raw_value, str):
            normalized = raw_value.strip().lower()
            if normalized and normalized not in capabilities:
                capabilities.append(normalized)

    if not capabilities:
        capabilities.extend(_DEFAULT_CAPABILITIES_BY_CARD_TYPE.get(card_type, (_CAPABILITY_POWER,)))
    elif card_type == "light" and _CAPABILITY_POWER not in capabilities:
        capabilities.insert(0, _CAPABILITY_POWER)
    return tuple(capabilities)


def _resolve_external_card_type(device: ExternalDevice) -> str:
    schema_snapshot = device.schema_snapshot if isinstance(device.schema_snapshot, dict) else {}
    display = schema_snapshot.get("display") if isinstance(schema_snapshot.get("display"), dict) else {}
    raw_card_type = display.get("card_type")
    if isinstance(raw_card_type, str):
        normalized = raw_card_type.strip().lower()
        if normalized:
            return normalized
    return "light"


def _coerce_bool_required(value: Any) -> bool:
    normalized = _coerce_binary_state(value)
    if normalized is None:
        raise ValueError("Automation boolean action requires a binary value.")
    return normalized


def _coerce_numeric_required(value: Any) -> float:
    if isinstance(value, bool):
        raise ValueError("Automation numeric action requires a numeric value.")
    if isinstance(value, (int, float)):
        return float(value)
    raise ValueError("Automation numeric action requires a numeric value.")


def _coerce_binary_state(*candidates: Any) -> bool | None:
    for candidate in candidates:
        if isinstance(candidate, bool):
            return candidate
        if isinstance(candidate, (int, float)) and not isinstance(candidate, bool):
            return candidate > 0
        if isinstance(candidate, str):
            normalized = candidate.strip().lower()
            if normalized in {"on", "true", "1", "high"}:
                return True
            if normalized in {"off", "false", "0", "low"}:
                return False
    return None


def _coerce_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, (int, float)):
        return int(value)
    return None


def _coerce_number(value: Any) -> int | float | None:
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else value
    return None


def _coerce_state_scalar(value: Any) -> int | float | bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if not normalized:
            return None
        if normalized in {"on", "true", "1", "high"}:
            return True
        if normalized in {"off", "false", "0", "low"}:
            return False
        try:
            parsed = float(normalized)
        except ValueError:
            return None
        return int(parsed) if parsed.is_integer() else parsed
    return None


def _coerce_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _coerce_runtime_reported_at(value: Any) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    if isinstance(value, str):
        normalized = value.strip()
        if normalized:
            try:
                parsed = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
            except ValueError:
                parsed = None
            if parsed is not None:
                if parsed.tzinfo is not None:
                    return parsed.astimezone(timezone.utc).replace(tzinfo=None)
                return parsed

    return datetime.now(timezone.utc)


def _canonicalize_state_payload(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {
            str(key): _canonicalize_state_payload(inner_value)
            for key, inner_value in sorted(value.items(), key=lambda item: str(item[0]))
            if key != "reported_at"
        }
    if isinstance(value, list):
        return [_canonicalize_state_payload(item) for item in value]
    return value
