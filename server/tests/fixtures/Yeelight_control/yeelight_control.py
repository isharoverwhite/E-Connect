# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

from __future__ import annotations

import json
import math
import os
import socket
import threading
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
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


DEFAULT_PORT = 55443
DEFAULT_TIMEOUT_SECONDS = 0.5
DEFAULT_READ_TIMEOUT_WINDOWS = 3
DEFAULT_SESSION_IDLE_SECONDS = 15.0
DISCOVERY_HOST = "239.255.255.250"
DISCOVERY_PORT = 1982
DISCOVERY_TIMEOUT_SECONDS = 1.0
DISCOVERY_ATTEMPTS = 2
DISCOVERY_HELPER_PORT = 8915
DISCOVERY_HELPER_URL_ENV = "ECONNECT_YEELIGHT_DISCOVERY_HELPER_URL"
DISCOVERY_HELPER_PATH = "/yeelight/discover"
DISCOVERY_HELPER_TIMEOUT_SECONDS = 1.5
TRANSITION_MS = 150
RECONCILE_DELAY_SECONDS = 0.15
DEFAULT_LIGHT_CAPABILITIES = ("power", "brightness")
SCHEMA_CAPABILITY_HINTS = {
    "yeelight_white_light": ("power", "brightness"),
    "yeelight_ambient_light": ("power", "brightness", "color_temperature"),
    "yeelight_color_light": ("power", "brightness", "rgb", "color_temperature"),
    "yeelight_full_spectrum_light": ("power", "brightness", "rgb", "color_temperature"),
}
PROBE_PROPERTIES = ["power", "bright", "ct", "rgb", "model", "hue", "sat", "color_mode"]


@dataclass
class _PreparedYeelightCommand:
    action: str
    desired_power: str | None = None
    brightness: int | None = None
    rgb: dict[str, int] | None = None
    color_temperature: int | None = None


class _YeelightSessionState:
    def __init__(self, host: str, *, port: int, timeout: float):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.request_id = 1
        self.socket: socket.socket | None = None
        self.recv_buffer = b""
        self.last_used_at = 0.0
        self.lock = threading.Lock()


_SESSION_POOL_LOCK = threading.Lock()
_SESSION_POOL: dict[tuple[str, int], _YeelightSessionState] = {}


class _YeelightLanSession:
    def __init__(self, host: str, *, port: int = DEFAULT_PORT, timeout: int = DEFAULT_TIMEOUT_SECONDS):
        self.host = host
        self.port = port
        self.timeout = timeout
        self._state: _YeelightSessionState | None = None

    def __enter__(self) -> "_YeelightLanSession":
        state = _get_session_state(self.host, port=self.port, timeout=self.timeout)
        state.lock.acquire()
        self._state = state
        try:
            if self._session_is_expired():
                self._close_socket()
            if state.socket is None:
                state.socket = socket.create_connection((self.host, self.port), timeout=self.timeout)
            state.socket.settimeout(self.timeout)
        except OSError as exc:
            self._close_socket()
            state.lock.release()
            self._state = None
            raise ExtensionRuntimeError(
                f"Yeelight connection failed: {exc}",
                mark_offline=True,
                connection_failed=True,
            ) from exc
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        state = self._state
        if state is None:
            return
        state.last_used_at = time.monotonic()
        state.lock.release()
        self._state = None

    def send(self, method_name: str, params: list[Any]) -> dict[str, Any]:
        state = self._require_state()
        if state.socket is None:
            raise ExtensionRuntimeError("Yeelight session is not connected.", mark_offline=True)

        request_id = state.request_id
        state.request_id += 1
        payload = {"id": request_id, "method": method_name, "params": params}
        encoded_payload = (json.dumps(payload) + "\r\n").encode("utf-8")
        try:
            state.socket.sendall(encoded_payload)
            return self._read_matching_reply(request_id)
        except TimeoutError as exc:
            raise ExtensionRuntimeError(
                f"Yeelight LAN command '{method_name}' failed: {exc}",
                mark_offline=True,
            ) from exc
        except (OSError, json.JSONDecodeError) as exc:
            self._close_socket()
            raise ExtensionRuntimeError(
                f"Yeelight LAN command '{method_name}' failed: {exc}",
                mark_offline=True,
            ) from exc

    def _read_matching_reply(self, request_id: int) -> dict[str, Any]:
        while True:
            message = self._read_message()
            if message.get("id") != request_id:
                continue
            error = message.get("error")
            if isinstance(error, dict):
                raise ExtensionRuntimeError(str(error.get("message") or "Yeelight rejected the command."))
            return message

    def _read_message(self) -> dict[str, Any]:
        state = self._require_state()
        timeout_windows = 0
        while b"\r\n" not in state.recv_buffer:
            if state.socket is None:
                raise ExtensionRuntimeError("Yeelight session is not connected.", mark_offline=True)
            try:
                packet = state.socket.recv(4096)
            except TimeoutError as exc:
                timeout_windows += 1
                if timeout_windows < DEFAULT_READ_TIMEOUT_WINDOWS:
                    continue
                raise
            if not packet:
                self._close_socket()
                break
            timeout_windows = 0
            state.recv_buffer += packet

        if b"\r\n" in state.recv_buffer:
            raw_line, _, state.recv_buffer = state.recv_buffer.partition(b"\r\n")
        else:
            raw_line, state.recv_buffer = state.recv_buffer, b""

        text = raw_line.decode("utf-8").strip()
        if not text:
            raise ExtensionRuntimeError("Yeelight returned an empty response.", mark_offline=True)
        payload = json.loads(text)
        if not isinstance(payload, dict):
            raise ExtensionRuntimeError("Yeelight returned malformed JSON.", mark_offline=True)
        return payload

    def _require_state(self) -> _YeelightSessionState:
        if self._state is None:
            raise ExtensionRuntimeError("Yeelight session is not connected.", mark_offline=True)
        return self._state

    def _session_is_expired(self) -> bool:
        state = self._require_state()
        return (
            state.socket is not None
            and state.last_used_at > 0
            and (time.monotonic() - state.last_used_at) > DEFAULT_SESSION_IDLE_SECONDS
        )

    def _close_socket(self) -> None:
        state = self._state
        if state is None or state.socket is None:
            return
        try:
            state.socket.close()
        except OSError:
            pass
        state.socket = None
        state.recv_buffer = b""


def _get_session_state(host: str, *, port: int, timeout: float) -> _YeelightSessionState:
    key = (host, port)
    with _SESSION_POOL_LOCK:
        state = _SESSION_POOL.get(key)
        if state is None:
            state = _YeelightSessionState(host, port=port, timeout=timeout)
            _SESSION_POOL[key] = state
        else:
            state.timeout = timeout
        return state


def validate_command(device: dict[str, Any], command: dict[str, Any]) -> None:
    _validate_yeelight_command(device, command)


def execute_command(device: dict[str, Any], command: dict[str, Any]) -> dict[str, Any]:
    config = device.get("config") if isinstance(device.get("config"), dict) else {}
    host = config.get("ip_address")
    if not isinstance(host, str) or not host.strip():
        raise ExtensionValidationError("Yeelight device is missing a valid ip_address.")

    capabilities = _resolve_light_capabilities(device)
    temperature_range = _resolve_temperature_range(device)
    known_power_state = _resolve_known_power_state(device)
    prepared_command = _prepare_yeelight_command(command, capabilities=capabilities, temperature_range=temperature_range)
    command_kind = str(command.get("kind") or "action").strip().lower()
    if command_kind != "action":
        raise ExtensionValidationError("Yeelight only supports action commands.")

    normalized_host = host.strip()
    try:
        return _execute_yeelight_command_direct(
            host=normalized_host,
            prepared_command=prepared_command,
            capabilities=capabilities,
            known_power_state=known_power_state,
            previous_state=device.get("last_state") if isinstance(device.get("last_state"), dict) else None,
        )
    except ExtensionRuntimeError as exc:
        reconciled_state = _reconcile_yeelight_command_after_failure(
            previous_error=exc,
            host=normalized_host,
            prepared_command=prepared_command,
            command=command,
            capabilities=capabilities,
            temperature_range=temperature_range,
        )
        if reconciled_state is not None:
            return reconciled_state

        discovery = None if exc.connection_failed else _discover_yeelight_metadata(normalized_host)
        if discovery is not None:
            raise ExtensionRuntimeError(str(exc), mark_offline=False) from exc
        raise


def probe_state(device: dict[str, Any]) -> dict[str, Any]:
    config = device.get("config") if isinstance(device.get("config"), dict) else {}
    host = config.get("ip_address")
    if not isinstance(host, str) or not host.strip():
        raise ExtensionValidationError("Yeelight device is missing a valid ip_address.")

    return _probe_yeelight_state(
        host=host.strip(),
        capabilities=_resolve_light_capabilities(device),
    )


def _resolve_light_capabilities(device: dict[str, Any]) -> tuple[str, ...]:
    schema_snapshot = device.get("schema_snapshot") if isinstance(device.get("schema_snapshot"), dict) else {}
    display = schema_snapshot.get("display") if isinstance(schema_snapshot.get("display"), dict) else {}
    raw_schema_capabilities = display.get("capabilities") if isinstance(display.get("capabilities"), list) else None
    last_state = device.get("last_state") if isinstance(device.get("last_state"), dict) else {}
    raw_observed_capabilities = last_state.get("capabilities") if isinstance(last_state.get("capabilities"), list) else None

    merged = _normalize_capabilities(raw_schema_capabilities)
    observed = _normalize_capabilities(raw_observed_capabilities)
    if observed:
        merged = tuple(dict.fromkeys((*merged, *observed)))

    schema_id = str(device.get("device_schema_id") or "").strip().lower()
    if schema_id in SCHEMA_CAPABILITY_HINTS:
        merged = tuple(dict.fromkeys((*merged, *SCHEMA_CAPABILITY_HINTS[schema_id])))
    if merged:
        return merged
    return DEFAULT_LIGHT_CAPABILITIES


def _resolve_temperature_range(device: dict[str, Any]) -> tuple[int, int]:
    schema_snapshot = device.get("schema_snapshot") if isinstance(device.get("schema_snapshot"), dict) else {}
    display = schema_snapshot.get("display") if isinstance(schema_snapshot.get("display"), dict) else {}
    raw_range = display.get("temperature_range")
    if (
        isinstance(raw_range, dict)
        and isinstance(raw_range.get("min"), int)
        and isinstance(raw_range.get("max"), int)
        and raw_range["min"] < raw_range["max"]
    ):
        return raw_range["min"], raw_range["max"]
    return (1700, 6500)


def _resolve_known_power_state(device: dict[str, Any]) -> str | None:
    return _resolve_known_power_state_from_state(device.get("last_state"))


def _resolve_known_power_state_from_state(last_state: Any) -> str | None:
    if not isinstance(last_state, dict):
        return None

    raw_power = last_state.get("power")
    if isinstance(raw_power, str):
        normalized_power = raw_power.strip().lower()
        if normalized_power in {"on", "off"}:
            return normalized_power

    raw_value = last_state.get("value")
    if isinstance(raw_value, bool):
        return "on" if raw_value else "off"
    if isinstance(raw_value, (int, float)) and not isinstance(raw_value, bool):
        return "on" if raw_value != 0 else "off"

    raw_brightness = last_state.get("brightness")
    if isinstance(raw_brightness, (int, float)) and not isinstance(raw_brightness, bool):
        return "on" if raw_brightness > 0 else "off"

    return None


def _reconcile_yeelight_command_after_failure(
    *,
    previous_error: ExtensionRuntimeError,
    host: str,
    prepared_command: _PreparedYeelightCommand,
    command: dict[str, Any],
    capabilities: tuple[str, ...],
    temperature_range: tuple[int, int],
) -> dict[str, Any] | None:
    time.sleep(RECONCILE_DELAY_SECONDS)
    try:
        observed_state = _probe_yeelight_state(
            host=host,
            capabilities=capabilities,
        )
    except ExtensionRuntimeError:
        return None

    if _yeelight_state_matches_command(
        state=observed_state,
        command=command,
        temperature_range=temperature_range,
    ):
        return observed_state

    return _retry_yeelight_command_with_power_preflight(
        host=host,
        prepared_command=prepared_command,
        command=command,
        capabilities=capabilities,
        temperature_range=temperature_range,
    )


def _yeelight_state_matches_command(
    *,
    state: dict[str, Any],
    command: dict[str, Any],
    temperature_range: tuple[int, int],
) -> bool:
    if "value" in command:
        desired_power = 1 if _coerce_binary_state(command.get("value")) else 0
        return _coerce_int(state.get("value"), fallback=0) == desired_power

    if "brightness" in command:
        requested_brightness = _normalize_ui_brightness(command.get("brightness"))
        observed_brightness = _coerce_int(state.get("brightness"), fallback=0)
        if requested_brightness <= 0:
            return _coerce_int(state.get("value"), fallback=0) == 0
        return abs(observed_brightness - requested_brightness) <= 3

    if "color_temperature" in command:
        requested_temperature = _normalize_color_temperature(command.get("color_temperature"), temperature_range)
        observed_temperature = _coerce_int(state.get("color_temperature"), fallback=requested_temperature)
        return abs(observed_temperature - requested_temperature) <= 50

    if "rgb" in command:
        requested_rgb = _normalize_rgb_payload(command.get("rgb"))
        observed_rgb = state.get("rgb")
        return isinstance(observed_rgb, dict) and all(
            _coerce_int(observed_rgb.get(channel), fallback=-1) == requested_rgb[channel]
            for channel in ("r", "g", "b")
        )

    return False


def _execute_yeelight_command_direct(
    *,
    host: str,
    prepared_command: _PreparedYeelightCommand,
    capabilities: tuple[str, ...],
    known_power_state: str | None,
    previous_state: dict[str, Any] | None,
) -> dict[str, Any]:
    with _YeelightLanSession(host) as session:
        _apply_yeelight_command(
            session,
            prepared_command,
            known_power_state=known_power_state,
        )
    return _build_yeelight_predicted_state(
        host=host,
        previous_state=previous_state,
        prepared_command=prepared_command,
        capabilities=capabilities,
    )


def _retry_yeelight_command_with_power_preflight(
    *,
    host: str,
    prepared_command: _PreparedYeelightCommand,
    command: dict[str, Any],
    capabilities: tuple[str, ...],
    temperature_range: tuple[int, int],
) -> dict[str, Any] | None:
    if prepared_command.action not in {"brightness", "rgb", "color_temperature"}:
        return None
    if prepared_command.action == "brightness" and (prepared_command.brightness or 0) <= 0:
        return None

    try:
        with _YeelightLanSession(host) as session:
            _send_yeelight_power_command(session, "on", allow_timeout=True)
            _apply_yeelight_command_without_power_preflight(session, prepared_command)
    except ExtensionRuntimeError:
        pass

    time.sleep(RECONCILE_DELAY_SECONDS)
    try:
        observed_state = _probe_yeelight_state(
            host=host,
            capabilities=capabilities,
        )
    except ExtensionRuntimeError:
        return None

    if _yeelight_state_matches_command(
        state=observed_state,
        command=command,
        temperature_range=temperature_range,
    ):
        return observed_state
    return None


def _probe_yeelight_state(
    *,
    host: str,
    capabilities: tuple[str, ...],
) -> dict[str, Any]:
    try:
        with _YeelightLanSession(host) as session:
            props_response = session.send("get_prop", list(PROBE_PROPERTIES))
        return _build_yeelight_state(
            props_response=props_response,
            host=host,
            capabilities=capabilities,
        )
    except ExtensionRuntimeError as exc:
        if exc.connection_failed:
            raise
        discovery = _discover_yeelight_metadata(host)
        if discovery is None:
            raise
        return _build_yeelight_state_from_metadata(
            discovery=discovery,
            host=host,
            capabilities=capabilities,
        )


def _build_yeelight_state_from_metadata(
    *,
    discovery: dict[str, Any],
    host: str,
    capabilities: tuple[str, ...],
) -> dict[str, Any]:
    power_state = str(discovery.get("power") or "off").strip().lower()
    effective_capabilities = _infer_yeelight_capabilities(
        capabilities,
        raw_ct=discovery.get("ct"),
        raw_rgb=discovery.get("rgb"),
        raw_color_mode=discovery.get("color_mode"),
        support_methods=discovery.get("support_methods"),
    )
    state: dict[str, Any] = {
        "kind": "action",
        "pin": 0,
        "value": 1 if power_state == "on" else 0,
        "brightness": _yeelight_brightness_to_ui(discovery.get("bright")) if power_state == "on" else 0,
        "power": power_state,
        "provider": "Yeelight",
        "reported_at": datetime.now(timezone.utc).isoformat(),
        "ip_address": host,
        "model": str(discovery.get("model") or "").strip(),
        "color_mode": _coerce_int(discovery.get("color_mode"), fallback=0),
        "capabilities": list(effective_capabilities),
    }

    if "color_temperature" in effective_capabilities:
        state["color_temperature"] = _coerce_int(discovery.get("ct"), fallback=4000)

    if "rgb" in effective_capabilities:
        state["rgb"] = _decode_rgb_triplet(discovery.get("rgb"))

    return state


def _send_yeelight_power_command(
    session: _YeelightLanSession,
    desired_power: str,
    *,
    allow_timeout: bool = False,
) -> None:
    try:
        session.send("set_power", [desired_power, "smooth", TRANSITION_MS, 0])
    except ExtensionRuntimeError:
        if not allow_timeout:
            raise


def _apply_yeelight_command(
    session: _YeelightLanSession,
    command: _PreparedYeelightCommand,
    *,
    known_power_state: str | None,
) -> None:
    if command.action == "rgb":
        if known_power_state == "off":
            _send_yeelight_power_command(session, "on", allow_timeout=True)
        session.send(
            "set_rgb",
            [_rgb_triplet_to_int(command.rgb or {"r": 0, "g": 0, "b": 0}), "smooth", TRANSITION_MS],
        )
        return

    if command.action == "color_temperature":
        if known_power_state == "off":
            _send_yeelight_power_command(session, "on", allow_timeout=True)
        session.send("set_ct_abx", [command.color_temperature or 4000, "smooth", TRANSITION_MS])
        return

    if command.action == "brightness":
        requested_brightness = command.brightness or 0
        if requested_brightness <= 0:
            if known_power_state == "off":
                return
            session.send("set_power", ["off", "smooth", TRANSITION_MS, 0])
        else:
            if known_power_state == "off":
                _send_yeelight_power_command(session, "on", allow_timeout=True)
            session.send(
                "set_bright",
                [_ui_brightness_to_yeelight(requested_brightness), "smooth", TRANSITION_MS],
            )
        return

    if command.action == "power":
        desired_power = command.desired_power or "off"
        if known_power_state == desired_power:
            return
        session.send("set_power", [desired_power, "smooth", TRANSITION_MS, 0])
        return

    raise ExtensionValidationError(
        "Yeelight command must provide 'value', 'brightness', 'rgb', or 'color_temperature'."
    )


def _apply_yeelight_command_without_power_preflight(
    session: _YeelightLanSession,
    command: _PreparedYeelightCommand,
) -> None:
    if command.action == "rgb":
        session.send(
            "set_rgb",
            [_rgb_triplet_to_int(command.rgb or {"r": 0, "g": 0, "b": 0}), "smooth", TRANSITION_MS],
        )
        return

    if command.action == "color_temperature":
        session.send("set_ct_abx", [command.color_temperature or 4000, "smooth", TRANSITION_MS])
        return

    if command.action == "brightness":
        requested_brightness = command.brightness or 0
        if requested_brightness <= 0:
            session.send("set_power", ["off", "smooth", TRANSITION_MS, 0])
        else:
            session.send(
                "set_bright",
                [_ui_brightness_to_yeelight(requested_brightness), "smooth", TRANSITION_MS],
            )
        return

    raise ExtensionValidationError(
        "Secondary Yeelight write requires 'brightness', 'rgb', or 'color_temperature'."
    )


def _build_yeelight_state(
    *,
    props_response: dict[str, Any],
    host: str,
    capabilities: tuple[str, ...],
) -> dict[str, Any]:
    result = props_response.get("result")
    if not isinstance(result, list) or len(result) < 7:
        raise ExtensionRuntimeError("Yeelight returned an invalid property response.")

    if len(result) >= 8:
        raw_ct = result[2]
        raw_rgb = result[3]
        raw_model = result[4]
        raw_color_mode = result[7]
    else:
        raw_ct = 0
        raw_rgb = result[2]
        raw_model = result[3]
        raw_color_mode = result[6]

    effective_capabilities = _infer_yeelight_capabilities(
        capabilities,
        raw_ct=raw_ct,
        raw_rgb=raw_rgb,
        raw_color_mode=raw_color_mode,
    )
    power_state = str(result[0]).strip().lower()
    rgb_triplet = _decode_rgb_triplet(raw_rgb)
    state: dict[str, Any] = {
        "kind": "action",
        "pin": 0,
        "value": 1 if power_state == "on" else 0,
        "brightness": _yeelight_brightness_to_ui(result[1]) if power_state == "on" else 0,
        "power": power_state,
        "provider": "Yeelight",
        "reported_at": datetime.now(timezone.utc).isoformat(),
        "ip_address": host,
        "model": str(raw_model).strip(),
        "color_mode": _coerce_int(raw_color_mode),
        "capabilities": list(effective_capabilities),
    }

    if "color_temperature" in effective_capabilities:
        state["color_temperature"] = _coerce_int(raw_ct, fallback=4000)

    if "rgb" in effective_capabilities:
        state["rgb"] = rgb_triplet

    return state


def _build_yeelight_predicted_state(
    *,
    host: str,
    previous_state: dict[str, Any] | None,
    prepared_command: _PreparedYeelightCommand,
    capabilities: tuple[str, ...],
) -> dict[str, Any]:
    baseline = previous_state if isinstance(previous_state, dict) else {}
    baseline_rgb = _coerce_rgb_triplet(baseline.get("rgb"))
    effective_capabilities = _infer_yeelight_capabilities(
        capabilities,
        raw_ct=baseline.get("color_temperature"),
        raw_rgb=_rgb_triplet_to_int(baseline_rgb),
        raw_color_mode=baseline.get("color_mode"),
    )
    power_state = _resolve_known_power_state_from_state(baseline) or "off"
    brightness = _coerce_int(baseline.get("brightness"), fallback=0)
    color_temperature = _coerce_int(baseline.get("color_temperature"), fallback=4000)
    rgb_triplet = baseline_rgb
    color_mode = _coerce_int(baseline.get("color_mode"), fallback=0)

    if prepared_command.action == "power":
        desired_power = prepared_command.desired_power or "off"
        power_state = desired_power
        if desired_power == "off":
            brightness = 0
        elif brightness <= 0:
            brightness = 255
    elif prepared_command.action == "brightness":
        requested_brightness = prepared_command.brightness or 0
        if requested_brightness <= 0:
            power_state = "off"
            brightness = 0
        else:
            power_state = "on"
            brightness = requested_brightness
    elif prepared_command.action == "rgb":
        power_state = "on"
        brightness = brightness if brightness > 0 else 255
        rgb_triplet = prepared_command.rgb or rgb_triplet
        color_mode = 1
    elif prepared_command.action == "color_temperature":
        power_state = "on"
        brightness = brightness if brightness > 0 else 255
        color_temperature = prepared_command.color_temperature or color_temperature
        color_mode = 2

    state: dict[str, Any] = {
        "kind": "action",
        "pin": 0,
        "value": 1 if power_state == "on" else 0,
        "brightness": brightness if power_state == "on" else 0,
        "power": power_state,
        "provider": "Yeelight",
        "reported_at": datetime.now(timezone.utc).isoformat(),
        "ip_address": host,
        "model": str(baseline.get("model") or "").strip(),
        "color_mode": color_mode,
        "capabilities": list(effective_capabilities),
    }

    if "color_temperature" in effective_capabilities:
        state["color_temperature"] = color_temperature

    if "rgb" in effective_capabilities:
        state["rgb"] = rgb_triplet

    return state


def _discover_yeelight_metadata(host: str) -> dict[str, Any] | None:
    discovery = _discover_yeelight_metadata_via_udp(host)
    if discovery is not None:
        return discovery
    return _discover_yeelight_metadata_via_helper(host)


def _discover_yeelight_metadata_via_udp(host: str) -> dict[str, Any] | None:
    message = "\r\n".join(
        [
            "M-SEARCH * HTTP/1.1",
            f"HOST: {DISCOVERY_HOST}:{DISCOVERY_PORT}",
            'MAN: "ssdp:discover"',
            "ST: wifi_bulb",
            "",
            "",
        ]
    ).encode("utf-8")
    discovery_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    try:
        discovery_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        discovery_socket.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
        discovery_socket.settimeout(DISCOVERY_TIMEOUT_SECONDS)
        for _ in range(DISCOVERY_ATTEMPTS):
            discovery_socket.sendto(message, (DISCOVERY_HOST, DISCOVERY_PORT))
            try:
                while True:
                    packet, addr = discovery_socket.recvfrom(4096)
                    if addr[0] != host:
                        continue
                    return _parse_yeelight_discovery_packet(packet)
            except TimeoutError:
                continue
    finally:
        discovery_socket.close()
    return None


def _discover_yeelight_metadata_via_helper(host: str) -> dict[str, Any] | None:
    query = urllib.parse.urlencode({"host": host})
    for base_url in _resolve_discovery_helper_urls():
        target_url = _build_discovery_helper_url(base_url, query=query)
        try:
            with urllib.request.urlopen(target_url, timeout=DISCOVERY_HELPER_TIMEOUT_SECONDS) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except Exception:
            continue
        if isinstance(payload, dict):
            if isinstance(payload.get("metadata"), dict):
                return payload["metadata"]
            return payload
    return None


def _resolve_discovery_helper_urls() -> tuple[str, ...]:
    candidates: list[str] = []
    raw_helper_url = str(os.getenv(DISCOVERY_HELPER_URL_ENV, "")).strip()
    if raw_helper_url:
        candidates.append(raw_helper_url)
    candidates.append(f"http://host.docker.internal:{DISCOVERY_HELPER_PORT}")
    gateway = _resolve_default_gateway()
    if gateway is not None:
        candidates.append(f"http://{gateway}:{DISCOVERY_HELPER_PORT}")
    return tuple(dict.fromkeys(candidate.rstrip("/") for candidate in candidates if candidate.strip()))


def _build_discovery_helper_url(base_url: str, *, query: str) -> str:
    parsed = urllib.parse.urlsplit(base_url)
    if not parsed.scheme or not parsed.netloc:
        return f"{base_url.rstrip('/')}{DISCOVERY_HELPER_PATH}?{query}"
    helper_path = parsed.path.rstrip("/") or DISCOVERY_HELPER_PATH
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, helper_path, query, ""))


def _resolve_default_gateway() -> str | None:
    try:
        with open("/proc/net/route", encoding="utf-8") as route_file:
            next(route_file, None)
            for line in route_file:
                columns = line.strip().split()
                if len(columns) < 3 or columns[1] != "00000000":
                    continue
                gateway = int(columns[2], 16).to_bytes(4, "little")
                resolved = socket.inet_ntoa(gateway)
                if resolved and resolved != "0.0.0.0":
                    return resolved
    except (OSError, ValueError):
        return None
    return None


def _parse_yeelight_discovery_packet(packet: bytes) -> dict[str, Any]:
    metadata: dict[str, Any] = {}
    for line in packet.decode("utf-8", errors="replace").split("\r\n"):
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        metadata[key.strip().lower()] = value.strip()
    support = metadata.get("support")
    if isinstance(support, str):
        metadata["support_methods"] = [method for method in support.split(" ") if method]
    return metadata


def _validate_yeelight_command(device: dict[str, Any], command: dict[str, Any]) -> None:
    config = device.get("config") if isinstance(device.get("config"), dict) else {}
    host = config.get("ip_address")
    if not isinstance(host, str) or not host.strip():
        raise ExtensionValidationError("Yeelight device is missing a valid ip_address.")

    command_kind = str(command.get("kind") or "action").strip().lower()
    if command_kind != "action":
        raise ExtensionValidationError("Yeelight only supports action commands.")

    capabilities = _resolve_light_capabilities(device)
    temperature_range = _resolve_temperature_range(device)
    _prepare_yeelight_command(command, capabilities=capabilities, temperature_range=temperature_range)


def _prepare_yeelight_command(
    command: dict[str, Any],
    *,
    capabilities: tuple[str, ...],
    temperature_range: tuple[int, int],
) -> _PreparedYeelightCommand:
    if "rgb" in command:
        _require_capability(capabilities, "rgb")
        rgb = _normalize_rgb_payload(command.get("rgb"))
        return _PreparedYeelightCommand(action="rgb", rgb=rgb)

    if "color_temperature" in command:
        _require_capability(capabilities, "color_temperature")
        temperature = _normalize_color_temperature(command.get("color_temperature"), temperature_range)
        return _PreparedYeelightCommand(action="color_temperature", color_temperature=temperature)

    brightness_value = command.get("brightness")
    if isinstance(brightness_value, (int, float)) and not isinstance(brightness_value, bool):
        _require_capability(capabilities, "brightness")
        requested_brightness = _normalize_ui_brightness(brightness_value)
        return _PreparedYeelightCommand(action="brightness", brightness=requested_brightness)

    if "value" in command:
        _require_capability(capabilities, "power")
        desired_power = "on" if _coerce_binary_state(command.get("value")) else "off"
        return _PreparedYeelightCommand(action="power", desired_power=desired_power)

    raise ExtensionValidationError(
        "Yeelight command must provide 'value', 'brightness', 'rgb', or 'color_temperature'."
    )


def _normalize_capabilities(raw_capabilities: Any) -> tuple[str, ...]:
    if not isinstance(raw_capabilities, list):
        return ()
    capabilities = [str(capability).strip().lower() for capability in raw_capabilities if isinstance(capability, str)]
    return tuple(dict.fromkeys(capability for capability in capabilities if capability))


def _infer_yeelight_capabilities(
    base_capabilities: tuple[str, ...],
    *,
    raw_ct: Any,
    raw_rgb: Any,
    raw_color_mode: Any,
    support_methods: Any = None,
) -> tuple[str, ...]:
    capability_set = set(base_capabilities or DEFAULT_LIGHT_CAPABILITIES)
    capability_set.update(DEFAULT_LIGHT_CAPABILITIES)

    if _coerce_int(raw_ct, fallback=0) > 0:
        capability_set.add("color_temperature")

    if _coerce_int(raw_color_mode, fallback=0) in {1, 3} or _coerce_int(raw_rgb, fallback=0) > 0:
        capability_set.add("rgb")

    if isinstance(support_methods, list):
        normalized_methods = {
            str(method).strip().lower()
            for method in support_methods
            if isinstance(method, str) and method.strip()
        }
        if "set_ct_abx" in normalized_methods:
            capability_set.add("color_temperature")
        if "set_rgb" in normalized_methods:
            capability_set.add("rgb")

    ordered = ["power", "brightness", "rgb", "color_temperature"]
    return tuple(capability for capability in ordered if capability in capability_set)


def _require_capability(capabilities: tuple[str, ...], capability: str) -> None:
    if capability not in capabilities:
        raise ExtensionValidationError(
            f"This external light schema does not support '{capability}' control."
        )


def _coerce_binary_state(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    raise ExtensionValidationError("Yeelight binary commands require a numeric or boolean value.")


def _normalize_ui_brightness(value: int | float | Any) -> int:
    return max(0, min(255, int(round(float(value)))))


def _ui_brightness_to_yeelight(value: int) -> int:
    if value <= 0:
        return 1
    scaled = round((value / 255) * 100)
    return max(1, min(100, scaled))


def _yeelight_brightness_to_ui(value: Any) -> int:
    try:
        level = int(value)
    except (TypeError, ValueError):
        return 0
    level = max(1, min(100, level))
    return max(1, min(255, round((level / 100) * 255)))


def _normalize_rgb_payload(value: Any) -> dict[str, int]:
    if not isinstance(value, dict):
        raise ExtensionValidationError("RGB commands require an object payload.")

    channels: dict[str, int] = {}
    for channel in ("r", "g", "b"):
        raw_channel = value.get(channel)
        if not isinstance(raw_channel, (int, float)) or isinstance(raw_channel, bool):
            raise ExtensionValidationError("RGB channels must be numeric.")
        channels[channel] = max(0, min(255, int(round(raw_channel))))
    return channels


def _rgb_triplet_to_int(rgb: dict[str, int]) -> int:
    return (rgb["r"] << 16) + (rgb["g"] << 8) + rgb["b"]


def _decode_rgb_triplet(value: Any) -> dict[str, int]:
    raw_value = _coerce_int(value, fallback=0)
    return {
        "r": (raw_value >> 16) & 0xFF,
        "g": (raw_value >> 8) & 0xFF,
        "b": raw_value & 0xFF,
    }


def _coerce_rgb_triplet(value: Any) -> dict[str, int]:
    if isinstance(value, dict):
        return {
            "r": max(0, min(255, _coerce_int(value.get("r"), fallback=0))),
            "g": max(0, min(255, _coerce_int(value.get("g"), fallback=0))),
            "b": max(0, min(255, _coerce_int(value.get("b"), fallback=0))),
        }
    return _decode_rgb_triplet(value)


def _normalize_color_temperature(value: Any, allowed_range: tuple[int, int]) -> int:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ExtensionValidationError("Color temperature must be numeric.")
    minimum, maximum = allowed_range
    rounded = int(round(float(value)))
    return max(minimum, min(maximum, rounded))


def _coerce_int(value: Any, *, fallback: int | None = None) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        if fallback is None:
            raise ExtensionRuntimeError("Yeelight returned a non-numeric value.")
        return fallback
    if math.isnan(float(parsed)):
        if fallback is None:
            raise ExtensionRuntimeError("Yeelight returned NaN.")
        return fallback
    return parsed
