# Copyright (c) 2026 Dinh Trung Kien. All rights reserved.

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

try:
    from app.services.extension_runtime_api import (
        ExtensionRuntimeError,
        ExtensionUnsupportedError,
        ExtensionValidationError,
    )
except Exception:
    class ExtensionRuntimeError(RuntimeError):
        def __init__(
            self,
            message: str,
            *,
            mark_offline: bool = False,
            connection_failed: bool = False,
        ) -> None:
            super().__init__(message)
            self.mark_offline = mark_offline
            self.connection_failed = connection_failed

    class ExtensionValidationError(ExtensionRuntimeError):
        pass

    class ExtensionUnsupportedError(ExtensionRuntimeError):
        pass


PROVIDER_NAME = "Demo Multi-Card"
_DEFAULT_CAPABILITIES = {
    "switch": ("power",),
    "fan": ("power", "speed"),
    "sensor": ("temperature", "humidity", "value"),
}


def validate_command(device: dict[str, Any], command: dict[str, Any]) -> None:
    _require_ip_address(device)
    card_type = _resolve_card_type(device)
    command_kind = str(command.get("kind") or "action").strip().lower()
    if command_kind != "action":
        raise ExtensionValidationError("Demo multi-card provider only supports action commands.")

    if card_type == "sensor":
        raise ExtensionUnsupportedError("Demo climate sensor is read-only.")

    if card_type == "switch":
        if "value" not in command:
            raise ExtensionValidationError("Switch commands must provide 'value'.")
        _coerce_binary_state(command.get("value"))
        return

    if card_type == "fan":
        if "speed" in command:
            _normalize_speed(command.get("speed"))
            return
        if "value" in command:
            _coerce_binary_state(command.get("value"))
            return
        raise ExtensionValidationError("Fan commands must provide 'speed' or 'value'.")

    raise ExtensionUnsupportedError(f"Unsupported demo card type '{card_type}'.")


def execute_command(device: dict[str, Any], command: dict[str, Any]) -> dict[str, Any]:
    validate_command(device, command)

    card_type = _resolve_card_type(device)
    if card_type == "switch":
        desired_power = _coerce_binary_state(command.get("value"))
        return _build_switch_state(
            device,
            power_on=desired_power,
        )

    if card_type == "fan":
        if "speed" in command:
            speed = _normalize_speed(command.get("speed"))
            return _build_fan_state(
                device,
                power_on=speed > 0,
                speed=speed,
            )

        desired_power = _coerce_binary_state(command.get("value"))
        previous_state = device.get("last_state") if isinstance(device.get("last_state"), dict) else {}
        previous_speed = _coerce_optional_number(previous_state.get("speed"))
        next_speed = previous_speed if previous_speed is not None and previous_speed > 0 else _resolve_default_speed(device)
        if not desired_power:
            next_speed = 0
        return _build_fan_state(
            device,
            power_on=desired_power,
            speed=next_speed,
        )

    raise ExtensionUnsupportedError(f"Unsupported demo card type '{card_type}'.")


def probe_state(device: dict[str, Any]) -> dict[str, Any]:
    _require_ip_address(device)
    card_type = _resolve_card_type(device)

    if card_type == "switch":
        return _build_switch_state(
            device,
            power_on=_resolve_switch_power(device),
        )

    if card_type == "fan":
        last_state = device.get("last_state") if isinstance(device.get("last_state"), dict) else {}
        speed = _coerce_optional_number(last_state.get("speed"))
        if speed is None:
            speed = _resolve_default_speed(device)
        return _build_fan_state(
            device,
            power_on=speed > 0,
            speed=speed,
        )

    if card_type == "sensor":
        return _build_sensor_state(device)

    raise ExtensionUnsupportedError(f"Unsupported demo card type '{card_type}'.")


def _build_switch_state(device: dict[str, Any], *, power_on: bool) -> dict[str, Any]:
    state = _build_base_state(device)
    state.update(
        {
            "kind": "action",
            "pin": 0,
            "value": 1 if power_on else 0,
            "power": "on" if power_on else "off",
        }
    )
    return state


def _build_fan_state(device: dict[str, Any], *, power_on: bool, speed: int | float) -> dict[str, Any]:
    normalized_speed = _normalize_speed(speed)
    state = _build_base_state(device)
    state.update(
        {
            "kind": "action",
            "pin": 0,
            "value": 1 if power_on else 0,
            "power": "on" if power_on else "off",
            "speed": normalized_speed if power_on else 0,
        }
    )
    return state


def _build_sensor_state(device: dict[str, Any]) -> dict[str, Any]:
    config = device.get("config") if isinstance(device.get("config"), dict) else {}
    last_state = device.get("last_state") if isinstance(device.get("last_state"), dict) else {}

    temperature = _coerce_optional_number(config.get("temperature"))
    if temperature is None:
        temperature = _coerce_optional_number(last_state.get("temperature"))
    if temperature is None:
        temperature = 24.5

    humidity = _coerce_optional_number(config.get("humidity"))
    if humidity is None:
        humidity = _coerce_optional_number(last_state.get("humidity"))
    if humidity is None:
        humidity = 56

    value = _coerce_optional_number(config.get("value"))
    if value is None:
        value = _coerce_optional_number(last_state.get("value"))
    if value is None:
        value = temperature

    unit = _coerce_optional_string(config.get("unit")) or _coerce_optional_string(last_state.get("unit")) or "C"
    trend = _coerce_optional_string(config.get("trend")) or _coerce_optional_string(last_state.get("trend")) or "stable"

    state = _build_base_state(device)
    state.update(
        {
            "temperature": temperature,
            "humidity": humidity,
            "value": value,
            "unit": unit,
            "trend": trend,
        }
    )
    return state


def _build_base_state(device: dict[str, Any]) -> dict[str, Any]:
    config = device.get("config") if isinstance(device.get("config"), dict) else {}
    return {
        "provider": PROVIDER_NAME,
        "reported_at": datetime.now(timezone.utc).isoformat(),
        "ip_address": str(config.get("ip_address") or "").strip(),
        "capabilities": list(_resolve_capabilities(device)),
    }


def _resolve_card_type(device: dict[str, Any]) -> str:
    schema_snapshot = device.get("schema_snapshot") if isinstance(device.get("schema_snapshot"), dict) else {}
    display = schema_snapshot.get("display") if isinstance(schema_snapshot.get("display"), dict) else {}
    raw_card_type = display.get("card_type")
    if isinstance(raw_card_type, str):
        normalized = raw_card_type.strip().lower()
        if normalized:
            return normalized

    schema_id = str(device.get("device_schema_id") or "").strip().lower()
    if schema_id == "smart_switch":
        return "switch"
    if schema_id == "ceiling_fan":
        return "fan"
    if schema_id == "climate_sensor":
        return "sensor"
    return "switch"


def _resolve_capabilities(device: dict[str, Any]) -> tuple[str, ...]:
    schema_snapshot = device.get("schema_snapshot") if isinstance(device.get("schema_snapshot"), dict) else {}
    display = schema_snapshot.get("display") if isinstance(schema_snapshot.get("display"), dict) else {}
    raw_capabilities = display.get("capabilities") if isinstance(display.get("capabilities"), list) else []

    capabilities: list[str] = []
    for raw_capability in raw_capabilities:
        if not isinstance(raw_capability, str):
            continue
        normalized = raw_capability.strip().lower()
        if normalized and normalized not in capabilities:
            capabilities.append(normalized)

    if capabilities:
        return tuple(capabilities)
    return _DEFAULT_CAPABILITIES.get(_resolve_card_type(device), ("power",))


def _resolve_switch_power(device: dict[str, Any]) -> bool:
    last_state = device.get("last_state") if isinstance(device.get("last_state"), dict) else {}
    for candidate in (last_state.get("power"), last_state.get("value")):
        normalized = _coerce_optional_binary_state(candidate)
        if normalized is not None:
            return normalized

    config = device.get("config") if isinstance(device.get("config"), dict) else {}
    default_on = config.get("default_on")
    if isinstance(default_on, bool):
        return default_on
    return False


def _resolve_default_speed(device: dict[str, Any]) -> int:
    config = device.get("config") if isinstance(device.get("config"), dict) else {}
    raw_speed = _coerce_optional_number(config.get("default_speed"))
    if raw_speed is None:
        return 0
    return _normalize_speed(raw_speed)


def _require_ip_address(device: dict[str, Any]) -> None:
    config = device.get("config") if isinstance(device.get("config"), dict) else {}
    host = config.get("ip_address")
    if not isinstance(host, str) or not host.strip():
        raise ExtensionValidationError("Demo provider device is missing a valid ip_address.")


def _coerce_binary_state(value: Any) -> bool:
    normalized = _coerce_optional_binary_state(value)
    if normalized is None:
        raise ExtensionValidationError("Binary commands require a boolean or numeric value.")
    return normalized


def _coerce_optional_binary_state(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value != 0
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"on", "true", "1", "high"}:
            return True
        if normalized in {"off", "false", "0", "low"}:
            return False
    return None


def _normalize_speed(value: Any) -> int:
    numeric_value = _coerce_optional_number(value)
    if numeric_value is None:
        raise ExtensionValidationError("Fan speed commands require a numeric speed value.")
    return max(0, min(100, int(round(float(numeric_value)))))


def _coerce_optional_number(value: Any) -> int | float | None:
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else value
    if isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            return None
        try:
            parsed = float(normalized)
        except ValueError:
            return None
        return int(parsed) if parsed.is_integer() else parsed
    return None


def _coerce_optional_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None
