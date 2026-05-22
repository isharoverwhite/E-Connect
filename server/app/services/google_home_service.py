# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.
"""Google Smart Home fulfillment service — device mapping, state conversion, Report State."""

import base64
import json
import logging
import os
import time
import uuid
from typing import Any

import httpx
from jose import jwt
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

_ENV_PROJECT_ID = os.getenv("GOOGLE_HOME_PROJECT_ID", "")
_ENV_SERVICE_ACCOUNT_JSON = os.getenv("GOOGLE_HOME_SERVICE_ACCOUNT_JSON", "")
_ENV_CLIENT_ID = os.getenv("GOOGLE_HOME_CLIENT_ID", "")
_ENV_CLIENT_SECRET = os.getenv("GOOGLE_HOME_CLIENT_SECRET", "")


def _get_db_config() -> "dict[str, str]":
    """Return the Google Home config stored in the DB, or empty dict if unavailable."""
    try:
        from app.database import SessionLocal
        from app.sql_models import GoogleHomeConfig
        db = SessionLocal()
        try:
            row = db.query(GoogleHomeConfig).first()
            if row is None:
                return {}
            return {
                "client_id": row.client_id or "",
                "client_secret": row.client_secret or "",
                "project_id": row.project_id or "",
                "service_account_json": row.service_account_json or "",
            }
        finally:
            db.close()
    except Exception:
        return {}


def get_effective_client_id() -> str:
    db_cfg = _get_db_config()
    return db_cfg.get("client_id") or _ENV_CLIENT_ID


def get_effective_client_secret() -> str:
    db_cfg = _get_db_config()
    return db_cfg.get("client_secret") or _ENV_CLIENT_SECRET


def get_effective_project_id() -> str:
    db_cfg = _get_db_config()
    return db_cfg.get("project_id") or _ENV_PROJECT_ID


def get_effective_service_account_json() -> str:
    db_cfg = _get_db_config()
    return db_cfg.get("service_account_json") or _ENV_SERVICE_ACCOUNT_JSON


def is_google_home_configured() -> bool:
    return bool(get_effective_client_id() and get_effective_client_secret())

# ─── Google device-type constants ────────────────────────────────────────────

_GOOGLE_TYPE = {
    "light": "action.devices.types.LIGHT",
    "switch": "action.devices.types.SWITCH",
    "fan": "action.devices.types.FAN",
    "sensor": "action.devices.types.SENSOR",
    "outlet": "action.devices.types.OUTLET",
    "lock": "action.devices.types.LOCK",
    "thermostat": "action.devices.types.THERMOSTAT",
    "camera": "action.devices.types.CAMERA",
    "speaker": "action.devices.types.SPEAKER",
    "vacuum": "action.devices.types.VACUUM",
    "washer": "action.devices.types.WASHER",
    "ac_unit": "action.devices.types.AC_UNIT",
}

_FUNCTION_TO_TYPE: list[tuple[list[str], str]] = [
    (["light", "led", "lamp", "bulb", "strip", "rgb", "neon"], "light"),
    (["fan", "ventilator", "exhaust", "blower"], "fan"),
    (["lock", "door", "gate", "bolt"], "lock"),
    (["outlet", "socket", "plug"], "outlet"),
    (["sensor", "temp", "temperature", "humidity", "dht", "bme", "adc"], "sensor"),
    (["relay", "switch", "power", "motor", "pump", "heater", "cooler", "valve"], "switch"),
]


def _infer_device_type_from_pins(pin_configurations: list[Any]) -> str:
    """Determine Google Home device type by examining pin function names."""
    functions = [
        (getattr(p, "function", None) or "").lower()
        for p in pin_configurations
        if getattr(p, "function", None)
    ]
    labels = [
        (getattr(p, "label", None) or "").lower()
        for p in pin_configurations
        if getattr(p, "label", None)
    ]
    tokens = functions + labels

    for keywords, dtype in _FUNCTION_TO_TYPE:
        for token in tokens:
            if any(kw in token for kw in keywords):
                return dtype
    return "switch"


def _build_traits_for_type(
    device_type: str,
    capabilities: set[str],
    has_pwm_pin: bool,
) -> tuple[list[str], dict[str, Any]]:
    """Return (traits_list, attributes_dict) for a Google Home device."""
    traits: list[str] = []
    attributes: dict[str, Any] = {}

    if device_type in {"light", "switch", "fan", "outlet", "lock", "washer"}:
        traits.append("action.devices.traits.OnOff")

    if device_type == "light" and (has_pwm_pin or "brightness" in capabilities):
        traits.append("action.devices.traits.Brightness")

    if device_type == "fan" and "speed" in capabilities:
        traits.append("action.devices.traits.FanSpeed")
        attributes["availableFanSpeeds"] = {
            "speeds": [
                {"speed_name": "Low", "speed_values": [{"speed_synonym": ["low", "slow"], "lang": "en"}]},
                {"speed_name": "Medium", "speed_values": [{"speed_synonym": ["medium", "mid"], "lang": "en"}]},
                {"speed_name": "High", "speed_values": [{"speed_synonym": ["high", "fast", "max"], "lang": "en"}]},
            ],
            "ordered": True,
        }
        attributes["reversible"] = False

    if device_type == "lock":
        traits = ["action.devices.traits.LockUnlock"]

    if device_type == "sensor":
        traits.append("action.devices.traits.SensorState")
        attributes["sensorStatesSupported"] = [
            {
                "name": "AirQuality",
                "descriptiveCapabilities": {"availableStates": ["healthy", "moderate", "unhealthy", "unknown"]},
            }
        ]

    return traits, attributes


# ─── Physical device sync ─────────────────────────────────────────────────────

def _serialize_physical_device(device: Any) -> dict[str, Any] | None:
    """Convert an E-Connect physical Device to Google Home SYNC format."""
    from app.sql_models import AuthStatus, PinMode

    if device.auth_status != AuthStatus.approved:
        return None

    pins = list(device.pin_configurations or [])
    device_type = _infer_device_type_from_pins(pins)
    has_pwm = any(getattr(p, "mode", None) == PinMode.PWM for p in pins)
    capabilities: set[str] = set()
    if has_pwm:
        capabilities.add("brightness")

    traits, attributes = _build_traits_for_type(device_type, capabilities, has_pwm)

    room_hint = device.room.name if device.room is not None else None

    return {
        "id": device.device_id,
        "type": _GOOGLE_TYPE.get(device_type, "action.devices.types.SWITCH"),
        "traits": traits,
        "name": {"name": device.name},
        "willReportState": bool(get_effective_project_id()),
        "roomHint": room_hint,
        "deviceInfo": {"manufacturer": "E-Connect", "model": "DIY Board"},
        "attributes": attributes,
        "otherDeviceIds": [{"deviceId": device.device_id}],
    }


# ─── External device sync ─────────────────────────────────────────────────────

def _serialize_external_device(device: Any) -> dict[str, Any] | None:
    """Convert an E-Connect ExternalDevice to Google Home SYNC format."""
    from app.sql_models import AuthStatus

    if device.auth_status != AuthStatus.approved:
        return None

    schema_snapshot = device.schema_snapshot if isinstance(device.schema_snapshot, dict) else {}
    display = schema_snapshot.get("display") if isinstance(schema_snapshot.get("display"), dict) else {}
    raw_caps = display.get("capabilities") if isinstance(display.get("capabilities"), list) else []
    capabilities: set[str] = {
        str(c).strip().lower() for c in raw_caps if isinstance(c, str) and c.strip()
    }

    raw_device_type = str(schema_snapshot.get("device_type") or display.get("card_type") or "light").strip().lower()
    device_type = raw_device_type if raw_device_type in _GOOGLE_TYPE else "switch"

    has_brightness = "brightness" in capabilities
    traits, attributes = _build_traits_for_type(device_type, capabilities, has_brightness)

    room_hint = device.room.name if device.room is not None else None

    return {
        "id": device.device_id,
        "type": _GOOGLE_TYPE.get(device_type, "action.devices.types.SWITCH"),
        "traits": traits,
        "name": {"name": device.name},
        "willReportState": bool(get_effective_project_id()),
        "roomHint": room_hint,
        "deviceInfo": {
            "manufacturer": "E-Connect",
            "model": str(device.provider or "External Device"),
        },
        "attributes": attributes,
        "otherDeviceIds": [{"deviceId": device.device_id}],
    }


# ─── SYNC ─────────────────────────────────────────────────────────────────────

def sync_devices_for_user(db: Session, user: Any) -> list[dict[str, Any]]:
    """Return the list of Google Home devices for this user (SYNC intent)."""
    from app.sql_models import Device, ExternalDevice

    result: list[dict[str, Any]] = []

    physical_devices = (
        db.query(Device)
        .filter(Device.owner_id == user.user_id)
        .all()
    )
    for device in physical_devices:
        serialized = _serialize_physical_device(device)
        if serialized:
            result.append(serialized)

    external_devices = (
        db.query(ExternalDevice)
        .filter(ExternalDevice.owner_id == user.user_id)
        .all()
    )
    for device in external_devices:
        serialized = _serialize_external_device(device)
        if serialized:
            result.append(serialized)

    return result


# ─── QUERY ────────────────────────────────────────────────────────────────────

def _get_physical_device_google_state(db: Session, device: Any) -> dict[str, Any]:
    """Read physical device state and convert to Google Home format."""
    from app.sql_models import ConnStatus, PinMode
    from app.mqtt import load_latest_device_state_payload

    online = device.conn_status == ConnStatus.online
    _record, state = load_latest_device_state_payload(db, device.device_id)

    if not isinstance(state, dict):
        return {"online": online, "on": False}

    pins = list(device.pin_configurations or [])
    has_pwm = any(getattr(p, "mode", None) == PinMode.PWM for p in pins)

    pin_rows: dict[int, dict[str, Any]] = {}
    raw_pins = state.get("pins")
    if isinstance(raw_pins, list):
        for row in raw_pins:
            if isinstance(row, dict) and isinstance(row.get("pin"), int):
                pin_rows[row["pin"]] = row
    elif isinstance(state.get("pin"), int):
        pin_rows[state["pin"]] = state

    device_state: dict[str, Any] = {"online": online}

    output_value = None
    for pin_cfg in pins:
        gpio = getattr(pin_cfg, "gpio_pin", None)
        if gpio is not None and gpio in pin_rows:
            row = pin_rows[gpio]
            v = row.get("value")
            if isinstance(v, (int, float)):
                output_value = v
                break

    if output_value is not None:
        device_state["on"] = output_value != 0
        if has_pwm:
            device_state["brightness"] = min(100, int(output_value * 100 / 255)) if output_value > 1 else int(output_value * 100)
    else:
        device_state["on"] = False

    return device_state


def _get_external_device_google_state(device: Any) -> dict[str, Any]:
    """Convert external device last_state to Google Home format."""
    from app.sql_models import ConnStatus

    online = device.conn_status == ConnStatus.online
    last_state = device.last_state if isinstance(device.last_state, dict) else {}

    device_state: dict[str, Any] = {"online": online}

    on_value = last_state.get("on") or last_state.get("power") or last_state.get("is_on")
    if on_value is not None:
        device_state["on"] = bool(on_value)
    else:
        device_state["on"] = False

    brightness = last_state.get("brightness") or last_state.get("bright")
    if isinstance(brightness, (int, float)):
        device_state["brightness"] = int(brightness)

    return device_state


def query_device_states(db: Session, user: Any, device_ids: list[str]) -> dict[str, Any]:
    """Return Google Home state for requested device IDs (QUERY intent)."""
    from app.sql_models import Device, ExternalDevice

    states: dict[str, Any] = {}

    for device_id in device_ids:
        physical = db.query(Device).filter(
            Device.device_id == device_id,
            Device.owner_id == user.user_id,
        ).first()
        if physical is not None:
            states[device_id] = _get_physical_device_google_state(db, physical)
            continue

        external = db.query(ExternalDevice).filter(
            ExternalDevice.device_id == device_id,
            ExternalDevice.owner_id == user.user_id,
        ).first()
        if external is not None:
            states[device_id] = _get_external_device_google_state(external)
            continue

        states[device_id] = {"online": False, "status": "ERROR", "errorCode": "deviceNotFound"}

    return states


# ─── EXECUTE ──────────────────────────────────────────────────────────────────

def execute_google_command(
    db: Session,
    user: Any,
    device_ids: list[str],
    execution: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Translate a Google Home EXECUTE intent into E-Connect commands.

    Returns a list of Google Home CommandResult dicts.
    """
    from app.sql_models import Device, ExternalDevice, AuthStatus

    results: list[dict[str, Any]] = []

    for device_id in device_ids:
        physical = db.query(Device).filter(
            Device.device_id == device_id,
            Device.owner_id == user.user_id,
        ).first()

        if physical is not None:
            if physical.auth_status != AuthStatus.approved:
                results.append({"ids": [device_id], "status": "ERROR", "errorCode": "deviceNotReady"})
                continue
            try:
                _execute_physical_device_command(db, physical, execution)
                results.append({"ids": [device_id], "status": "SUCCESS"})
            except Exception as exc:
                logger.warning("Google Home EXECUTE failed for %s: %s", device_id, exc)
                results.append({"ids": [device_id], "status": "ERROR", "errorCode": "hardError"})
            continue

        external = db.query(ExternalDevice).filter(
            ExternalDevice.device_id == device_id,
            ExternalDevice.owner_id == user.user_id,
        ).first()
        if external is not None:
            try:
                _execute_external_device_command(external, execution)
                results.append({"ids": [device_id], "status": "SUCCESS"})
            except Exception as exc:
                logger.warning("Google Home EXECUTE failed for external %s: %s", device_id, exc)
                results.append({"ids": [device_id], "status": "ERROR", "errorCode": "hardError"})
            continue

        results.append({"ids": [device_id], "status": "ERROR", "errorCode": "deviceNotFound"})

    return results


def _execute_physical_device_command(db: Session, device: Any, execution: list[dict[str, Any]]) -> None:
    from app.sql_models import PinMode
    from app.mqtt import mqtt_manager

    pins = list(device.pin_configurations or [])
    output_pins = [p for p in pins if getattr(p, "mode", None) in {PinMode.OUTPUT, PinMode.PWM}]
    if not output_pins:
        raise ValueError("No controllable pins")

    primary_pin = output_pins[0]

    for cmd in execution:
        command_name = str(cmd.get("command") or "").strip()
        params = cmd.get("params") if isinstance(cmd.get("params"), dict) else {}

        if command_name == "action.devices.commands.OnOff":
            on = bool(params.get("on", False))
            value = 1 if on else 0
            if getattr(primary_pin, "mode", None) == PinMode.PWM:
                restore = getattr(primary_pin, "extra_params", {}) or {}
                value = int(restore.get("restore_value", 255)) if on else 0
            mqtt_manager.publish_command(
                device.device_id,
                {"action": "set", "pin": primary_pin.gpio_pin, "value": value},
            )

        elif command_name == "action.devices.commands.BrightnessAbsolute":
            brightness_pct = int(params.get("brightness", 100))
            pwm_pins = [p for p in output_pins if getattr(p, "mode", None) == PinMode.PWM]
            target_pin = pwm_pins[0] if pwm_pins else primary_pin
            pwm_value = int(brightness_pct * 255 / 100)
            mqtt_manager.publish_command(
                device.device_id,
                {"action": "set", "pin": target_pin.gpio_pin, "value": pwm_value},
            )


def _execute_external_device_command(device: Any, execution: list[dict[str, Any]]) -> None:
    from app.services.external_runtime import execute_external_device_command

    for cmd in execution:
        command_name = str(cmd.get("command") or "").strip()
        params = cmd.get("params") if isinstance(cmd.get("params"), dict) else {}

        if command_name == "action.devices.commands.OnOff":
            ec_command = {"action": "set", "key": "power", "value": 1 if params.get("on") else 0}
        elif command_name == "action.devices.commands.BrightnessAbsolute":
            ec_command = {"action": "set", "key": "brightness", "value": int(params.get("brightness", 100))}
        else:
            continue

        execute_external_device_command(device, ec_command)


# ─── Report State ─────────────────────────────────────────────────────────────

def _load_service_account_credentials() -> dict[str, Any] | None:
    raw = get_effective_service_account_json().strip()
    if not raw:
        return None
    try:
        if raw.startswith("{"):
            return json.loads(raw)
        decoded = base64.b64decode(raw).decode("utf-8")
        return json.loads(decoded)
    except Exception:
        logger.warning("Failed to parse Google Home service account JSON")
        return None


async def _get_google_access_token() -> str | None:
    creds = _load_service_account_credentials()
    if not creds:
        return None

    now = int(time.time())
    claim = {
        "iss": creds["client_email"],
        "scope": "https://www.googleapis.com/auth/homegraph",
        "aud": "https://oauth2.googleapis.com/token",
        "iat": now,
        "exp": now + 3600,
    }

    try:
        assertion = jwt.encode(claim, creds["private_key"], algorithm="RS256")
    except Exception:
        logger.warning("Failed to sign service account JWT for Google Home")
        return None

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    "assertion": assertion,
                },
            )
            if resp.status_code == 200:
                return resp.json().get("access_token")
            logger.warning("Google token exchange failed: %s", resp.text)
    except Exception:
        logger.warning("Failed to exchange service account JWT for access token")
    return None


async def report_state_to_google(agent_user_id: str, states: dict[str, Any]) -> bool:
    """Push device state changes to Google's Home Graph (Report State)."""
    if not get_effective_project_id():
        return False

    access_token = await _get_google_access_token()
    if not access_token:
        return False

    payload = {
        "requestId": str(uuid.uuid4()),
        "agentUserId": agent_user_id,
        "payload": {"devices": {"states": states}},
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://homegraph.googleapis.com/v1/devices:reportStateAndNotification",
                headers={"Authorization": f"Bearer {access_token}"},
                json=payload,
            )
            if resp.status_code == 200:
                return True
            logger.warning("Google Report State failed (%s): %s", resp.status_code, resp.text)
    except Exception:
        logger.warning("Failed to call Google Report State API")
    return False


async def request_sync_for_user(agent_user_id: str) -> bool:
    """Tell Google to re-sync devices for this user (Request Sync)."""
    if not get_effective_project_id():
        return False

    access_token = await _get_google_access_token()
    if not access_token:
        return False

    payload = {"requestId": str(uuid.uuid4()), "agentUserId": agent_user_id}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://homegraph.googleapis.com/v1/devices:requestSync",
                headers={"Authorization": f"Bearer {access_token}"},
                json=payload,
            )
            return resp.status_code == 200
    except Exception:
        logger.warning("Failed to call Google Request Sync API")
    return False
