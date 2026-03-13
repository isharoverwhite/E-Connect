from __future__ import annotations

import hashlib
import hmac
import uuid

from app.auth import SECRET_KEY

PROJECT_DEVICE_NAMESPACE = uuid.UUID("6f917b58-7bd4-4b8f-a24f-62b8c6f9a4b5")


def derive_project_device_id(project_id: str) -> str:
    return str(uuid.uuid5(PROJECT_DEVICE_NAMESPACE, project_id))


def derive_project_secret(project_id: str, device_id: str) -> str:
    payload = f"econnect:{project_id}:{device_id}".encode("utf-8")
    return hmac.new(SECRET_KEY.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def build_project_firmware_identity(project_id: str) -> tuple[str, str]:
    device_id = derive_project_device_id(project_id)
    return device_id, derive_project_secret(project_id, device_id)


def verify_project_secret(project_id: str, device_id: str, secret_key: str | None) -> bool:
    if not secret_key:
        return False

    expected_device_id = derive_project_device_id(project_id)
    if expected_device_id != device_id:
        return False

    expected_secret = derive_project_secret(project_id, device_id)
    return hmac.compare_digest(expected_secret, secret_key)
