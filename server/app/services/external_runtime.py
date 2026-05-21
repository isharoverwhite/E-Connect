# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

from __future__ import annotations

import concurrent.futures
import copy
import os
from dataclasses import dataclass
from typing import Any

EXTENSION_HOOK_TIMEOUT_SECONDS = max(1.0, float(os.getenv("EXTENSION_HOOK_TIMEOUT_SECONDS", "10")))
_hook_executor = concurrent.futures.ThreadPoolExecutor(
    max_workers=8,
    thread_name_prefix="ext-hook",
)

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


def discover_external_devices_via_extension(installed_extension: Any) -> list[dict[str, Any]]:
    """Invoke the discover_devices hook on an installed extension.

    Returns a list of discovered device candidates. Raises
    ExternalDeviceRuntimeUnsupportedError if the extension does not declare
    the discover_devices hook.
    """
    try:
        runtime = load_installed_extension_runtime(installed_extension)
    except ExtensionRuntimeLoadError as exc:
        raise ExternalDeviceRuntimeUnsupportedError(str(exc)) from exc

    hook_name = runtime.hook_names.get("discover_devices")
    if not hook_name:
        raise ExternalDeviceRuntimeUnsupportedError(
            "This extension does not support device discovery."
        )

    hook = getattr(runtime.module, hook_name, None)
    if not callable(hook):
        raise ExternalDeviceRuntimeUnsupportedError(
            f"Extension discover_devices hook '{hook_name}' is not callable."
        )

    try:
        result = hook()
    except ExtensionValidationError as exc:
        raise ExternalDeviceRuntimeValidationError(
            str(exc), mark_offline=exc.mark_offline, connection_failed=exc.connection_failed
        ) from exc
    except ExtensionUnsupportedError as exc:
        raise ExternalDeviceRuntimeUnsupportedError(
            str(exc), mark_offline=exc.mark_offline, connection_failed=exc.connection_failed
        ) from exc
    except ExtensionRuntimeError as exc:
        raise ExternalDeviceRuntimeError(
            str(exc), mark_offline=exc.mark_offline, connection_failed=exc.connection_failed
        ) from exc
    except Exception as exc:
        raise ExternalDeviceRuntimeError(str(exc) or "discover_devices hook failed.") from exc

    if not isinstance(result, list):
        raise ExternalDeviceRuntimeError("Extension discover_devices hook must return a list.")
    return result


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
    cmd_copy = copy.deepcopy(command) if command is not None else None

    def _call() -> Any:
        return hook(runtime_device) if cmd_copy is None else hook(runtime_device, cmd_copy)

    future = _hook_executor.submit(_call)
    try:
        result = future.result(timeout=EXTENSION_HOOK_TIMEOUT_SECONDS)
    except concurrent.futures.TimeoutError:
        raise ExternalDeviceRuntimeError(
            f"Extension hook '{hook_key}' timed out after {EXTENSION_HOOK_TIMEOUT_SECONDS}s.",
            mark_offline=True,
            connection_failed=True,
        )
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
    return result


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


def _resolve_provider_key(device: ExternalDevice) -> str:
    if device.installed_extension is not None and isinstance(device.installed_extension.provider_key, str):
        return device.installed_extension.provider_key.strip().lower()
    if isinstance(device.provider, str):
        return device.provider.strip().lower()
    return ""


def _stringify_runtime_scalar(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    enum_value = getattr(value, "value", None)
    if isinstance(enum_value, str):
        return enum_value
    return str(value)
