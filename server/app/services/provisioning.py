from __future__ import annotations

import hashlib
import hmac
import json
import uuid
from typing import Any, Mapping

from app.auth import SECRET_KEY

PROJECT_DEVICE_NAMESPACE = uuid.UUID("6f917b58-7bd4-4b8f-a24f-62b8c6f9a4b5")
PRIVATE_DEVICE_SECRET_KEY = "_device_secret_key"


def derive_project_device_id(project_id: str) -> str:
    return str(uuid.uuid5(PROJECT_DEVICE_NAMESPACE, project_id))


def derive_project_secret(project_id: str, device_id: str) -> str:
    payload = f"econnect:{project_id}:{device_id}".encode("utf-8")
    return hmac.new(SECRET_KEY.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def _normalize_secret(secret_key: str | None) -> str | None:
    if not isinstance(secret_key, str):
        return None
    normalized = secret_key.strip()
    return normalized or None


def extract_project_secret_from_payload(payload: object) -> str | None:
    if isinstance(payload, Mapping):
        return _normalize_secret(payload.get(PRIVATE_DEVICE_SECRET_KEY))  # type: ignore[arg-type]

    if isinstance(payload, str):
        try:
            decoded = json.loads(payload)
        except json.JSONDecodeError:
            return None
        if isinstance(decoded, Mapping):
            return _normalize_secret(decoded.get(PRIVATE_DEVICE_SECRET_KEY))  # type: ignore[arg-type]

    return None


def stamp_project_secret(
    config_payload: Mapping[str, Any] | None,
    project_id: str,
    persisted_secret: str | None = None,
) -> dict[str, Any]:
    stamped = dict(config_payload or {})
    _, secret_key = build_project_firmware_identity(project_id, persisted_secret)
    stamped[PRIVATE_DEVICE_SECRET_KEY] = secret_key
    return stamped


def strip_project_secret_from_payload(payload: object) -> dict[str, Any] | None:
    if isinstance(payload, Mapping):
        sanitized = dict(payload)
        sanitized.pop(PRIVATE_DEVICE_SECRET_KEY, None)
        return sanitized

    if isinstance(payload, str):
        try:
            decoded = json.loads(payload)
        except json.JSONDecodeError:
            return None
        if isinstance(decoded, Mapping):
            sanitized = dict(decoded)
            sanitized.pop(PRIVATE_DEVICE_SECRET_KEY, None)
            return sanitized

    return None


def build_project_firmware_identity(project_id: str, persisted_secret: str | None = None) -> tuple[str, str]:
    device_id = derive_project_device_id(project_id)
    return device_id, _normalize_secret(persisted_secret) or derive_project_secret(project_id, device_id)


def verify_project_secret(
    project_id: str,
    device_id: str,
    secret_key: str | None,
    persisted_secret: str | None = None,
) -> bool:
    if not secret_key:
        return False

    expected_device_id = derive_project_device_id(project_id)
    if expected_device_id != device_id:
        return False

    _, expected_secret = build_project_firmware_identity(project_id, persisted_secret)
    return hmac.compare_digest(expected_secret, secret_key)
