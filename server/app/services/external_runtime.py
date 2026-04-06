# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

from __future__ import annotations

import copy
import json
import logging
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

from app.services.extension_runtime_api import (
    ExtensionRuntimeError,
    ExtensionUnsupportedError,
    ExtensionValidationError,
)
from app.services.extension_runtime_loader import (
    ExtensionRuntimeLoadError,
    load_installed_extension_runtime,
    resolve_runtime_hook,
)
from app.sql_models import ExternalDevice


YEELIGHT_PORT = 55443
YEELIGHT_TIMEOUT_SECONDS = 0.5
YEELIGHT_READ_TIMEOUT_WINDOWS = 3
YEELIGHT_SESSION_IDLE_SECONDS = 15.0
YEELIGHT_DISCOVERY_HOST = "239.255.255.250"
YEELIGHT_DISCOVERY_PORT = 1982
YEELIGHT_DISCOVERY_TIMEOUT_SECONDS = 1.0
YEELIGHT_DISCOVERY_ATTEMPTS = 2
YEELIGHT_DISCOVERY_HELPER_PORT = 8915
YEELIGHT_DISCOVERY_HELPER_URL_ENV = "ECONNECT_YEELIGHT_DISCOVERY_HELPER_URL"
YEELIGHT_DISCOVERY_HELPER_PATH = "/yeelight/discover"
YEELIGHT_DISCOVERY_HELPER_TIMEOUT_SECONDS = 1.5
YEELIGHT_TRANSITION_MS = 150
YEELIGHT_RECONCILE_DELAY_SECONDS = 0.15
DEFAULT_LIGHT_CAPABILITIES = ("power", "brightness")
YEELIGHT_SCHEMA_CAPABILITY_HINTS = {
    "yeelight_white_light": ("power", "brightness"),
    "yeelight_ambient_light": ("power", "brightness", "color_temperature"),
    "yeelight_color_light": ("power", "brightness", "rgb", "color_temperature"),
    "yeelight_full_spectrum_light": ("power", "brightness", "rgb", "color_temperature"),
}
YEELIGHT_PROBE_PROPERTIES = ["power", "bright", "ct", "rgb", "model", "hue", "sat", "color_mode"]

logger = logging.getLogger(__name__)


class ExternalDeviceRuntimeError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        mark_offline: bool = False,
        connection_failed: bool = False,
    ):
        super().__init__(message)
        self.mark_offline = mark_offline
        self.connection_failed = connection_failed


class ExternalDeviceRuntimeValidationError(ExternalDeviceRuntimeError):
    pass


class ExternalDeviceRuntimeUnsupportedError(ExternalDeviceRuntimeError):
    pass


@dataclass
class ExternalRuntimeExecutionResult:
    state: dict[str, Any]


def execute_external_device_command(device: ExternalDevice, command: dict[str, Any]) -> ExternalRuntimeExecutionResult:
    state = _invoke_extension_runtime_hook(device, "execute_command", command)
    return ExternalRuntimeExecutionResult(state=_normalize_runtime_state_payload(state))


def validate_external_device_command(device: ExternalDevice, command: dict[str, Any]) -> None:
    _invoke_extension_runtime_hook(device, "validate_command", command)


def probe_external_device_state(device: ExternalDevice) -> ExternalRuntimeExecutionResult:
    state = _invoke_extension_runtime_hook(device, "probe_state")
    return ExternalRuntimeExecutionResult(state=_normalize_runtime_state_payload(state))


def _invoke_extension_runtime_hook(device: ExternalDevice, hook_key: str, command: dict[str, Any] | None = None) -> Any:
    if device.installed_extension is None:
        provider_key = _resolve_provider_key(device)
        raise ExternalDeviceRuntimeUnsupportedError(
            f"External runtime is not implemented for provider '{provider_key or 'unknown'}'."
        )

    try:
        runtime = load_installed_extension_runtime(device.installed_extension)
        hook = resolve_runtime_hook(runtime, hook_key)
    except ExtensionRuntimeLoadError as exc:
        raise ExternalDeviceRuntimeUnsupportedError(str(exc)) from exc

    runtime_device = _serialize_runtime_device(device)
    try:
        if command is None:
            return hook(runtime_device)
        return hook(runtime_device, copy.deepcopy(command))
    except ExtensionValidationError as exc:
        raise ExternalDeviceRuntimeValidationError(
            str(exc),
            mark_offline=exc.mark_offline,
            connection_failed=exc.connection_failed,
        ) from exc
    except ExtensionUnsupportedError as exc:
        raise ExternalDeviceRuntimeUnsupportedError(
            str(exc),
            mark_offline=exc.mark_offline,
            connection_failed=exc.connection_failed,
        ) from exc
    except ExtensionRuntimeError as exc:
        raise ExternalDeviceRuntimeError(
            str(exc),
            mark_offline=exc.mark_offline,
            connection_failed=exc.connection_failed,
        ) from exc
    except ValueError as exc:
        if hook_key == "validate_command":
            raise ExternalDeviceRuntimeValidationError(str(exc)) from exc
        raise ExternalDeviceRuntimeError(str(exc)) from exc
    except Exception as exc:
        raise ExternalDeviceRuntimeError(
            str(exc) or f"Extension hook '{hook_key}' failed.",
            mark_offline=bool(getattr(exc, "mark_offline", False)),
            connection_failed=bool(getattr(exc, "connection_failed", False)),
        ) from exc


def _normalize_runtime_state_payload(result: Any) -> dict[str, Any]:
    if isinstance(result, dict):
        if isinstance(result.get("state"), dict):
            return copy.deepcopy(result["state"])
        return copy.deepcopy(result)
    raise ExternalDeviceRuntimeError("Extension runtime hook must return a JSON object state.")


def _serialize_runtime_device(device: ExternalDevice) -> dict[str, Any]:
    installed_extension = device.installed_extension
    extension_manifest = (
        copy.deepcopy(installed_extension.manifest)
        if installed_extension is not None and isinstance(installed_extension.manifest, dict)
        else {}
    )
    extension_payload = {
        "extension_id": str(getattr(installed_extension, "extension_id", "") or ""),
        "version": str(getattr(installed_extension, "version", "") or ""),
        "provider_key": str(getattr(installed_extension, "provider_key", "") or ""),
        "provider_name": str(getattr(installed_extension, "provider_name", "") or ""),
        "package_runtime": str(getattr(installed_extension, "package_runtime", "") or ""),
        "package_entrypoint": str(getattr(installed_extension, "package_entrypoint", "") or ""),
        "package_root": getattr(installed_extension, "package_root", None),
        "archive_path": str(getattr(installed_extension, "archive_path", "") or ""),
        "archive_sha256": str(getattr(installed_extension, "archive_sha256", "") or ""),
        "manifest": extension_manifest,
    }
    return {
        "device_id": str(getattr(device, "device_id", "") or ""),
        "device_schema_id": str(getattr(device, "device_schema_id", "") or ""),
        "name": str(getattr(device, "name", "") or ""),
        "provider": str(getattr(device, "provider", "") or ""),
        "room_id": getattr(device, "room_id", None),
        "config": copy.deepcopy(device.config) if isinstance(device.config, dict) else {},
        "schema_snapshot": copy.deepcopy(device.schema_snapshot) if isinstance(device.schema_snapshot, dict) else {},
        "last_state": copy.deepcopy(device.last_state) if isinstance(device.last_state, dict) else {},
        "conn_status": _stringify_runtime_scalar(getattr(device, "conn_status", None)),
        "auth_status": _stringify_runtime_scalar(getattr(device, "auth_status", None)),
        "extension": extension_payload,
    }


def _stringify_runtime_scalar(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    enum_value = getattr(value, "value", None)
    if isinstance(enum_value, str):
        return enum_value
    return str(value)


@dataclass(frozen=True)
class _PreparedYeelightCommand:
    action: str
    desired_power: str | None = None
    brightness: int | None = None
    rgb: dict[str, int] | None = None
    color_temperature: int | None = None


@dataclass
class _YeelightDiagnostics:
    host: str
    events: list[dict[str, Any]]
    discovery: dict[str, Any] | None = None

    def add(self, event: str, **details: Any) -> None:
        payload = {"event": event, **details}
        self.events.append(payload)


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


_YEELIGHT_SESSION_POOL_LOCK = threading.Lock()
_YEELIGHT_SESSION_POOL: dict[tuple[str, int], _YeelightSessionState] = {}


class _YeelightLanSession:
    def __init__(
        self,
        host: str,
        *,
        port: int = YEELIGHT_PORT,
        timeout: int = YEELIGHT_TIMEOUT_SECONDS,
        diagnostics: _YeelightDiagnostics | None = None,
    ):
        self.host = host
        self.port = port
        self.timeout = timeout
        self._state: _YeelightSessionState | None = None
        self._diagnostics = diagnostics
        self.observed_music_mode = False

    def __enter__(self) -> "_YeelightLanSession":
        state = _get_yeelight_session_state(self.host, port=self.port, timeout=self.timeout)
        state.lock.acquire()
        self._state = state
        try:
            if self._session_is_expired():
                if self._diagnostics is not None:
                    self._diagnostics.add("socket_recycled_idle", host=self.host, port=self.port)
                self._close_socket()
            if state.socket is None:
                if self._diagnostics is not None:
                    self._diagnostics.add("connect_start", host=self.host, port=self.port, timeout=self.timeout)
                state.socket = socket.create_connection((self.host, self.port), timeout=self.timeout)
                if self._diagnostics is not None:
                    self._diagnostics.add("connect_ok", host=self.host, port=self.port)
            elif self._diagnostics is not None:
                self._diagnostics.add("session_reused", host=self.host, port=self.port)
            state.socket.settimeout(self.timeout)
        except OSError as exc:
            self._close_socket()
            state.lock.release()
            self._state = None
            if self._diagnostics is not None:
                self._diagnostics.add(
                    "connect_error",
                    host=self.host,
                    port=self.port,
                    error=str(exc),
                    error_type=type(exc).__name__,
                )
            raise ExternalDeviceRuntimeError(
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
            raise ExternalDeviceRuntimeError("Yeelight session is not connected.", mark_offline=True)

        request_id = state.request_id
        state.request_id += 1
        encoded_payload = self._encode_payload(request_id, method_name, params)

        try:
            if self._diagnostics is not None:
                self._diagnostics.add(
                    "send",
                    request_id=request_id,
                    method=method_name,
                    payload=encoded_payload.decode("utf-8", errors="replace").strip(),
                )
            state.socket.sendall(encoded_payload)
            return self._read_matching_reply(request_id)
        except TimeoutError as exc:
            if self._diagnostics is not None:
                self._diagnostics.add(
                    "send_error",
                    request_id=request_id,
                    method=method_name,
                    error=str(exc),
                    error_type=type(exc).__name__,
                )
            raise ExternalDeviceRuntimeError(
                f"Yeelight LAN command '{method_name}' failed: {exc}",
                mark_offline=True,
            ) from exc
        except (OSError, json.JSONDecodeError) as exc:
            self._close_socket()
            if self._diagnostics is not None:
                self._diagnostics.add(
                    "send_error",
                    request_id=request_id,
                    method=method_name,
                    error=str(exc),
                    error_type=type(exc).__name__,
                )
            raise ExternalDeviceRuntimeError(
                f"Yeelight LAN command '{method_name}' failed: {exc}",
                mark_offline=True,
            ) from exc

    def _encode_payload(self, request_id: int, method_name: str, params: list[Any]) -> bytes:
        payload = {"id": request_id, "method": method_name, "params": params}
        return (json.dumps(payload) + "\r\n").encode("utf-8")

    def _read_matching_reply(self, expected_id: int) -> dict[str, Any]:
        while True:
            message = self._read_next_message()
            if not isinstance(message, dict):
                continue

            if _is_music_mode_notification(message):
                self.observed_music_mode = True
                if self._diagnostics is not None:
                    self._diagnostics.add("music_mode_notification", payload=message)

            if message.get("id") != expected_id:
                continue

            error = message.get("error")
            if isinstance(error, dict):
                error_message = error.get("message") or "Yeelight rejected the command."
                raise ExternalDeviceRuntimeError(str(error_message))
            return message

    def _read_next_message(self) -> dict[str, Any]:
        raw_line = self._read_next_line()
        if self._diagnostics is not None:
            self._diagnostics.add("recv_line", payload=raw_line)
        parsed = json.loads(raw_line)
        if not isinstance(parsed, dict):
            raise ExternalDeviceRuntimeError("Yeelight returned a malformed response.", mark_offline=True)
        return parsed

    def _read_next_line(self) -> str:
        state = self._require_state()
        timeout_windows = 0
        while b"\r\n" not in state.recv_buffer:
            if state.socket is None:
                raise ExternalDeviceRuntimeError("Yeelight session is not connected.", mark_offline=True)
            try:
                packet = state.socket.recv(4096)
            except TimeoutError:
                timeout_windows += 1
                if self._diagnostics is not None:
                    self._diagnostics.add(
                        "recv_timeout",
                        timeout=self.timeout,
                        window=timeout_windows,
                    )
                if timeout_windows < YEELIGHT_READ_TIMEOUT_WINDOWS:
                    continue
                raise
            if not packet:
                if self._diagnostics is not None:
                    self._diagnostics.add("recv_eof")
                self._close_socket()
                break
            timeout_windows = 0
            if self._diagnostics is not None:
                self._diagnostics.add("recv_chunk", payload=packet.decode("utf-8", errors="replace"))
            state.recv_buffer += packet

        if b"\r\n" in state.recv_buffer:
            raw_line, _, state.recv_buffer = state.recv_buffer.partition(b"\r\n")
        else:
            raw_line, state.recv_buffer = state.recv_buffer, b""

        decoded = raw_line.decode("utf-8").strip()
        if not decoded:
            raise ExternalDeviceRuntimeError("Yeelight returned an empty response.", mark_offline=True)
        return decoded

    def _require_state(self) -> _YeelightSessionState:
        if self._state is None:
            raise ExternalDeviceRuntimeError("Yeelight session is not connected.", mark_offline=True)
        return self._state

    def _session_is_expired(self) -> bool:
        state = self._require_state()
        return (
            state.socket is not None
            and state.last_used_at > 0
            and (time.monotonic() - state.last_used_at) > YEELIGHT_SESSION_IDLE_SECONDS
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
        if self._diagnostics is not None:
            self._diagnostics.add("socket_closed", host=self.host, port=self.port)


def _get_yeelight_session_state(host: str, *, port: int, timeout: float) -> _YeelightSessionState:
    key = (host, port)
    with _YEELIGHT_SESSION_POOL_LOCK:
        state = _YEELIGHT_SESSION_POOL.get(key)
        if state is None:
            state = _YeelightSessionState(host, port=port, timeout=timeout)
            _YEELIGHT_SESSION_POOL[key] = state
        else:
            state.timeout = timeout
        return state

def _resolve_provider_key(device: ExternalDevice) -> str:
    if device.installed_extension is not None and isinstance(device.installed_extension.provider_key, str):
        return device.installed_extension.provider_key.strip().lower()
    if isinstance(device.provider, str):
        return device.provider.strip().lower()
    return ""


def _resolve_light_capabilities(device: ExternalDevice) -> tuple[str, ...]:
    schema_snapshot = device.schema_snapshot if isinstance(device.schema_snapshot, dict) else {}
    display = schema_snapshot.get("display") if isinstance(schema_snapshot.get("display"), dict) else {}
    raw_schema_capabilities = display.get("capabilities") if isinstance(display.get("capabilities"), list) else None
    last_state = device.last_state if isinstance(device.last_state, dict) else {}
    raw_observed_capabilities = last_state.get("capabilities") if isinstance(last_state.get("capabilities"), list) else None

    merged = _normalize_capabilities(raw_schema_capabilities)
    observed = _normalize_capabilities(raw_observed_capabilities)
    if observed:
        merged = tuple(dict.fromkeys((*merged, *observed)))
    provider_key = _resolve_provider_key(device)
    schema_id = str(getattr(device, "device_schema_id", "") or "").strip().lower()
    if provider_key == "yeelight" and schema_id in YEELIGHT_SCHEMA_CAPABILITY_HINTS:
        merged = tuple(dict.fromkeys((*merged, *YEELIGHT_SCHEMA_CAPABILITY_HINTS[schema_id])))
    if merged:
        return merged
    return DEFAULT_LIGHT_CAPABILITIES


def _resolve_temperature_range(device: ExternalDevice) -> tuple[int, int]:
    schema_snapshot = device.schema_snapshot if isinstance(device.schema_snapshot, dict) else {}
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


def _resolve_known_yeelight_power_state(device: ExternalDevice) -> str | None:
    last_state = device.last_state if isinstance(device.last_state, dict) else {}
    return _resolve_known_yeelight_power_state_from_state(last_state)


def _resolve_known_yeelight_power_state_from_state(last_state: Any) -> str | None:
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


def _execute_yeelight_command(device: ExternalDevice, command: dict[str, Any]) -> ExternalRuntimeExecutionResult:
    config = device.config if isinstance(device.config, dict) else {}
    host = config.get("ip_address")
    if not isinstance(host, str) or not host.strip():
        raise ExternalDeviceRuntimeValidationError("Yeelight device is missing a valid ip_address.")

    capabilities = _resolve_light_capabilities(device)
    temperature_range = _resolve_temperature_range(device)
    known_power_state = _resolve_known_yeelight_power_state(device)
    prepared_command = _prepare_yeelight_command(command, capabilities=capabilities, temperature_range=temperature_range)
    command_kind = str(command.get("kind") or "action").strip().lower()
    if command_kind != "action":
        raise ExternalDeviceRuntimeValidationError("Yeelight only supports action commands.")

    host = host.strip()
    diagnostics = _create_yeelight_diagnostics(host) if _yeelight_diagnostics_enabled() else None
    discovery = _refresh_yeelight_discovery(host, diagnostics) if diagnostics is not None else None

    try:
        state = _execute_yeelight_command_direct(
            host=host,
            prepared_command=prepared_command,
            capabilities=capabilities,
            known_power_state=known_power_state,
            previous_state=device.last_state if isinstance(device.last_state, dict) else None,
            diagnostics=diagnostics,
        )
    except ExternalDeviceRuntimeError as exc:
        if discovery is None:
            discovery = _refresh_yeelight_discovery(host, diagnostics)
        reconciled_state = _reconcile_yeelight_command_after_failure(
            previous_error=exc,
            host=host,
            prepared_command=prepared_command,
            command=command,
            capabilities=capabilities,
            temperature_range=temperature_range,
            diagnostics=diagnostics,
        )
        if reconciled_state is not None:
            _emit_yeelight_diagnostics(diagnostics, host=host, stage="command_succeeded_reconciled")
            return ExternalRuntimeExecutionResult(state=reconciled_state)
        if discovery is not None and not exc.connection_failed:
            _emit_yeelight_diagnostics(diagnostics, host=host, stage="command_failed_online")
            raise ExternalDeviceRuntimeError(str(exc), mark_offline=False) from exc
        _emit_yeelight_diagnostics(diagnostics, host=host, stage="command_failed")
        raise exc
    _emit_yeelight_diagnostics(diagnostics, host=host, stage="command_succeeded")
    return ExternalRuntimeExecutionResult(state=state)


def _probe_yeelight_device(device: ExternalDevice) -> dict[str, Any]:
    config = device.config if isinstance(device.config, dict) else {}
    host = config.get("ip_address")
    if not isinstance(host, str) or not host.strip():
        raise ExternalDeviceRuntimeValidationError("Yeelight device is missing a valid ip_address.")

    host = host.strip()
    diagnostics = _create_yeelight_diagnostics(host) if _yeelight_diagnostics_enabled() else None
    capabilities = _resolve_light_capabilities(device)
    try:
        state = _probe_yeelight_state(
            host=host,
            capabilities=capabilities,
            diagnostics=diagnostics,
        )
    except ExternalDeviceRuntimeError:
        _emit_yeelight_diagnostics(diagnostics, host=host, stage="probe_failed")
        raise

    _emit_yeelight_diagnostics(diagnostics, host=host, stage="probe_succeeded")
    return state


def _reconcile_yeelight_command_after_failure(
    *,
    previous_error: ExternalDeviceRuntimeError,
    host: str,
    prepared_command: _PreparedYeelightCommand,
    command: dict[str, Any],
    capabilities: tuple[str, ...],
    temperature_range: tuple[int, int],
    diagnostics: _YeelightDiagnostics | None,
) -> dict[str, Any] | None:
    if diagnostics is not None:
        diagnostics.add("reconcile_after_failure", reason=str(previous_error))

    time.sleep(YEELIGHT_RECONCILE_DELAY_SECONDS)
    try:
        observed_state = _probe_yeelight_state(
            host=host,
            capabilities=capabilities,
            diagnostics=diagnostics,
        )
    except ExternalDeviceRuntimeError:
        return None

    if _yeelight_state_matches_command(
        state=observed_state,
        command=command,
        temperature_range=temperature_range,
    ):
        if diagnostics is not None:
            diagnostics.add("reconcile_state_match", state=observed_state)
        return observed_state

    secondary_state = _retry_yeelight_command_with_power_preflight(
        host=host,
        prepared_command=prepared_command,
        command=command,
        capabilities=capabilities,
        temperature_range=temperature_range,
        diagnostics=diagnostics,
    )
    if secondary_state is not None:
        return secondary_state

    if diagnostics is not None:
        diagnostics.add("reconcile_state_mismatch", state=observed_state)
    return None


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
    diagnostics: _YeelightDiagnostics | None,
) -> dict[str, Any]:
    with _YeelightLanSession(host, diagnostics=diagnostics) as session:
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
    diagnostics: _YeelightDiagnostics | None,
) -> dict[str, Any] | None:
    if prepared_command.action not in {"brightness", "rgb", "color_temperature"}:
        return None
    if prepared_command.action == "brightness" and (prepared_command.brightness or 0) <= 0:
        return None

    if diagnostics is not None:
        diagnostics.add("secondary_write_with_power_preflight")

    try:
        with _YeelightLanSession(host, diagnostics=diagnostics) as session:
            _send_yeelight_power_command(session, "on", allow_timeout=True)
            _apply_yeelight_command_without_power_preflight(session, prepared_command)
    except ExternalDeviceRuntimeError as exc:
        if diagnostics is not None:
            diagnostics.add("secondary_write_error", error=str(exc), error_type=type(exc).__name__)

    time.sleep(YEELIGHT_RECONCILE_DELAY_SECONDS)
    try:
        observed_state = _probe_yeelight_state(
            host=host,
            capabilities=capabilities,
            diagnostics=diagnostics,
        )
    except ExternalDeviceRuntimeError:
        return None

    if _yeelight_state_matches_command(
        state=observed_state,
        command=command,
        temperature_range=temperature_range,
    ):
        if diagnostics is not None:
            diagnostics.add("secondary_write_state_match", state=observed_state)
        return observed_state
    if diagnostics is not None:
        diagnostics.add("secondary_write_state_mismatch", state=observed_state)
    return None


def collect_yeelight_diagnostics(host: str) -> dict[str, Any]:
    normalized_host = host.strip()
    diagnostics = _create_yeelight_diagnostics(normalized_host)
    _refresh_yeelight_discovery(normalized_host, diagnostics)

    try:
        with _YeelightLanSession(normalized_host, diagnostics=diagnostics) as session:
            reply = session.send("get_prop", list(YEELIGHT_PROBE_PROPERTIES))
            diagnostics.add("probe_reply", payload=reply)
    except ExternalDeviceRuntimeError as exc:
        diagnostics.add("probe_error", error=str(exc), error_type=type(exc).__name__)

    return {
        "host": normalized_host,
        "discovery": diagnostics.discovery,
        "events": diagnostics.events,
        "online": diagnostics.discovery is not None,
        "control_transport": _summarize_yeelight_control_transport(diagnostics.events),
    }


def _refresh_yeelight_discovery(host: str, diagnostics: _YeelightDiagnostics | None) -> dict[str, Any] | None:
    discovery = _discover_yeelight_metadata(host)
    if diagnostics is not None:
        diagnostics.discovery = discovery
        if discovery is not None:
            diagnostics.add("discovery_match", metadata=discovery)
        else:
            diagnostics.add("discovery_missing", host=host)
    return discovery

def _probe_yeelight_state(
    *,
    host: str,
    capabilities: tuple[str, ...],
    diagnostics: _YeelightDiagnostics | None,
) -> dict[str, Any]:
    try:
        with _YeelightLanSession(host, diagnostics=diagnostics) as session:
            props_response = session.send("get_prop", list(YEELIGHT_PROBE_PROPERTIES))
        return _build_yeelight_state(
            props_response=props_response,
            host=host,
            capabilities=capabilities,
        )
    except ExternalDeviceRuntimeError as exc:
        if diagnostics is not None:
            diagnostics.add("state_probe_error", error=str(exc), error_type=type(exc).__name__)
        if exc.connection_failed:
            raise
        discovery = _refresh_yeelight_discovery(host, diagnostics)
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

def _is_music_mode_notification(message: dict[str, Any]) -> bool:
    if str(message.get("method") or "").strip().lower() != "props":
        return False
    params = message.get("params")
    if not isinstance(params, dict):
        return False
    raw_music = params.get("music_on")
    if isinstance(raw_music, bool):
        return raw_music
    if isinstance(raw_music, (int, float)):
        return int(raw_music) == 1
    return str(raw_music).strip().lower() in {"1", "on", "true"}


def _summarize_yeelight_control_transport(events: list[dict[str, Any]]) -> str:
    event_names = {str(event.get("event") or "") for event in events}
    if "probe_reply" in event_names:
        return "direct"
    if "connect_ok" in event_names:
        return "tcp-no-ack"
    return "offline"


def _send_yeelight_power_command(
    session: _YeelightLanSession,
    desired_power: str,
    *,
    allow_timeout: bool = False,
) -> None:
    try:
        session.send("set_power", [desired_power, "smooth", YEELIGHT_TRANSITION_MS, 0])
    except ExternalDeviceRuntimeError as exc:
        if not allow_timeout:
            raise
        if session._diagnostics is not None:
            session._diagnostics.add(
                "power_preflight_failed_continuing",
                desired_power=desired_power,
                error=str(exc),
                error_type=type(exc).__name__,
            )


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
            [_rgb_triplet_to_int(command.rgb or {"r": 0, "g": 0, "b": 0}), "smooth", YEELIGHT_TRANSITION_MS],
        )
        return

    if command.action == "color_temperature":
        if known_power_state == "off":
            _send_yeelight_power_command(session, "on", allow_timeout=True)
        session.send("set_ct_abx", [command.color_temperature or 4000, "smooth", YEELIGHT_TRANSITION_MS])
        return

    if command.action == "brightness":
        requested_brightness = command.brightness or 0
        if requested_brightness <= 0:
            if known_power_state == "off":
                return
            session.send("set_power", ["off", "smooth", YEELIGHT_TRANSITION_MS, 0])
        else:
            if known_power_state == "off":
                _send_yeelight_power_command(session, "on", allow_timeout=True)
            session.send(
                "set_bright",
                [_ui_brightness_to_yeelight(requested_brightness), "smooth", YEELIGHT_TRANSITION_MS],
            )
        return

    if command.action == "power":
        desired_power = command.desired_power or "off"
        if known_power_state == desired_power:
            return
        session.send("set_power", [desired_power, "smooth", YEELIGHT_TRANSITION_MS, 0])
        return

    raise ExternalDeviceRuntimeValidationError(
        "Yeelight command must provide 'value', 'brightness', 'rgb', or 'color_temperature'."
    )


def _apply_yeelight_command_without_power_preflight(
    session: _YeelightLanSession,
    command: _PreparedYeelightCommand,
) -> None:
    if command.action == "rgb":
        session.send(
            "set_rgb",
            [_rgb_triplet_to_int(command.rgb or {"r": 0, "g": 0, "b": 0}), "smooth", YEELIGHT_TRANSITION_MS],
        )
        return

    if command.action == "color_temperature":
        session.send("set_ct_abx", [command.color_temperature or 4000, "smooth", YEELIGHT_TRANSITION_MS])
        return

    if command.action == "brightness":
        requested_brightness = command.brightness or 0
        if requested_brightness <= 0:
            session.send("set_power", ["off", "smooth", YEELIGHT_TRANSITION_MS, 0])
        else:
            session.send(
                "set_bright",
                [_ui_brightness_to_yeelight(requested_brightness), "smooth", YEELIGHT_TRANSITION_MS],
            )
        return

    raise ExternalDeviceRuntimeValidationError(
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
        raise ExternalDeviceRuntimeError("Yeelight returned an invalid property response.")

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
    power_state = _resolve_known_yeelight_power_state_from_state(baseline) or "off"
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


def _yeelight_diagnostics_enabled() -> bool:
    raw_value = str(os.getenv("ECONNECT_YEELIGHT_DIAGNOSTICS", "")).strip().lower()
    return raw_value in {"1", "true", "yes", "on", "debug"}


def _create_yeelight_diagnostics(host: str) -> _YeelightDiagnostics:
    return _YeelightDiagnostics(host=host, events=[])


def _emit_yeelight_diagnostics(diagnostics: _YeelightDiagnostics | None, *, host: str, stage: str) -> None:
    if diagnostics is None:
        return
    logger.warning(
        "Yeelight diagnostics [%s] host=%s payload=%s",
        stage,
        host,
        json.dumps(
            {
                "host": diagnostics.host,
                "discovery": diagnostics.discovery,
                "events": diagnostics.events,
            },
            default=str,
        ),
    )


def _discover_yeelight_metadata(host: str) -> dict[str, Any] | None:
    discovery = _discover_yeelight_metadata_via_udp(host)
    if discovery is not None:
        return discovery
    return _discover_yeelight_metadata_via_helper(host)


def _discover_yeelight_metadata_via_udp(host: str) -> dict[str, Any] | None:
    message = "\r\n".join(
        [
            "M-SEARCH * HTTP/1.1",
            f"HOST: {YEELIGHT_DISCOVERY_HOST}:{YEELIGHT_DISCOVERY_PORT}",
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
        discovery_socket.settimeout(YEELIGHT_DISCOVERY_TIMEOUT_SECONDS)
        for _ in range(YEELIGHT_DISCOVERY_ATTEMPTS):
            discovery_socket.sendto(message, (YEELIGHT_DISCOVERY_HOST, YEELIGHT_DISCOVERY_PORT))
            try:
                while True:
                    packet, addr = discovery_socket.recvfrom(4096)
                    if addr[0] != host:
                        continue
                    return _parse_yeelight_discovery_packet(packet)
            except TimeoutError:
                continue
    except OSError as exc:
        logger.warning("Yeelight discovery probe failed for host=%s: %s", host, exc)
    finally:
        discovery_socket.close()
    return None


def _discover_yeelight_metadata_via_helper(host: str) -> dict[str, Any] | None:
    query = urllib.parse.urlencode({"host": host})
    for base_url in _resolve_yeelight_discovery_helper_urls():
        target_url = _build_yeelight_discovery_helper_url(base_url, query=query)
        try:
            with urllib.request.urlopen(target_url, timeout=YEELIGHT_DISCOVERY_HELPER_TIMEOUT_SECONDS) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except Exception:
            continue
        if isinstance(payload, dict):
            if isinstance(payload.get("metadata"), dict):
                return payload["metadata"]
            return payload
    return None


def _resolve_yeelight_discovery_helper_urls() -> tuple[str, ...]:
    candidates: list[str] = []
    raw_helper_url = str(os.getenv(YEELIGHT_DISCOVERY_HELPER_URL_ENV, "")).strip()
    if raw_helper_url:
        candidates.append(raw_helper_url)
    candidates.append(f"http://host.docker.internal:{YEELIGHT_DISCOVERY_HELPER_PORT}")
    gateway = _resolve_default_gateway()
    if gateway is not None:
        candidates.append(f"http://{gateway}:{YEELIGHT_DISCOVERY_HELPER_PORT}")
    return tuple(dict.fromkeys(candidate.rstrip("/") for candidate in candidates if candidate.strip()))


def _build_yeelight_discovery_helper_url(base_url: str, *, query: str) -> str:
    parsed = urllib.parse.urlsplit(base_url)
    if not parsed.scheme or not parsed.netloc:
        return f"{base_url.rstrip('/')}{YEELIGHT_DISCOVERY_HELPER_PATH}?{query}"
    helper_path = parsed.path.rstrip("/") or YEELIGHT_DISCOVERY_HELPER_PATH
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


def _validate_yeelight_command(device: ExternalDevice, command: dict[str, Any]) -> None:
    config = device.config if isinstance(device.config, dict) else {}
    host = config.get("ip_address")
    if not isinstance(host, str) or not host.strip():
        raise ExternalDeviceRuntimeValidationError("Yeelight device is missing a valid ip_address.")

    command_kind = str(command.get("kind") or "action").strip().lower()
    if command_kind != "action":
        raise ExternalDeviceRuntimeValidationError("Yeelight only supports action commands.")

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

    raise ExternalDeviceRuntimeValidationError(
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
        raise ExternalDeviceRuntimeValidationError(
            f"This external light schema does not support '{capability}' control."
        )


def _coerce_binary_state(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    raise ExternalDeviceRuntimeValidationError("Yeelight binary commands require a numeric or boolean value.")


def _normalize_ui_brightness(value: int | float) -> int:
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
        raise ExternalDeviceRuntimeValidationError("RGB commands require an object payload.")

    channels: dict[str, int] = {}
    for channel in ("r", "g", "b"):
        raw_channel = value.get(channel)
        if not isinstance(raw_channel, (int, float)) or isinstance(raw_channel, bool):
            raise ExternalDeviceRuntimeValidationError("RGB channels must be numeric.")
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
        raise ExternalDeviceRuntimeValidationError("Color temperature must be numeric.")
    minimum, maximum = allowed_range
    rounded = int(round(float(value)))
    return max(minimum, min(maximum, rounded))


def _coerce_int(value: Any, *, fallback: int | None = None) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        if fallback is None:
            raise ExternalDeviceRuntimeError("Yeelight returned a non-numeric value.")
        return fallback
    if math.isnan(float(parsed)):
        if fallback is None:
            raise ExternalDeviceRuntimeError("Yeelight returned NaN.")
        return fallback
    return parsed
