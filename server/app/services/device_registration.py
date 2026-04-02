from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import DeviceRegister
from app.services.provisioning import (
    build_project_firmware_identity,
    extract_project_secret_from_payload,
    verify_project_secret,
)
from app.sql_models import (
    AccountType,
    AuthStatus,
    BackupArchive,
    ConnStatus,
    Device,
    DeviceHistory,
    DiyProject,
    HouseholdRole,
    PinConfiguration,
    SystemLog,
    User,
)


@dataclass
class DeviceRegistrationResult:
    device: Device
    secret_verified: bool
    project_id: str | None
    pairing_requested: bool


def build_device_topics(device_id: str) -> tuple[str, str]:
    namespace = os.getenv("MQTT_NAMESPACE", "local")
    return (
        f"econnect/{namespace}/device/{device_id}/state",
        f"econnect/{namespace}/device/{device_id}/command",
    )


def get_layout_widgets(layout: Any) -> list[dict[str, Any]]:
    if isinstance(layout, dict) and isinstance(layout.get("widgets"), list):
        return [widget for widget in layout["widgets"] if isinstance(widget, dict)]
    if isinstance(layout, list):
        return [widget for widget in layout if isinstance(widget, dict)]
    return []


def build_device_widgets(device: Device) -> list[dict[str, Any]]:
    widgets: list[dict[str, Any]] = []
    for index, pin in enumerate(device.pin_configurations):
        pin_mode = pin.mode.value if hasattr(pin.mode, "value") else str(pin.mode)
        widget_type = "text"
        if pin_mode == "OUTPUT":
            widget_type = "switch"
        elif pin_mode == "PWM":
            widget_type = "dimmer"
        elif pin_mode in {"INPUT", "ADC"}:
            widget_type = "status"

        widgets.append(
            {
                "i": f"{device.device_id}:{pin.gpio_pin}:{index}",
                "x": 0,
                "y": index * 2,
                "w": 2,
                "h": 2,
                "type": widget_type,
                "deviceId": device.device_id,
                "pin": pin.gpio_pin,
                "label": pin.label or f"{pin.function or 'Pin'} {pin.gpio_pin}",
            }
        )

    return widgets


def sync_user_dashboard_widgets(user: User, device: Device) -> None:
    existing_widgets = [
        widget
        for widget in get_layout_widgets(user.ui_layout)
        if widget.get("deviceId") != device.device_id
    ]
    user.ui_layout = [*existing_widgets, *build_device_widgets(device)]


def remove_device_widgets(user: User | None, device_id: str) -> None:
    if not user:
        return

    user.ui_layout = [
        widget
        for widget in get_layout_widgets(user.ui_layout)
        if widget.get("deviceId") != device_id
    ]


def is_room_admin(user: User) -> bool:
    role = getattr(user, "current_household_role", None)
    normalized_role = role.value if hasattr(role, "value") else role
    return user.account_type == AccountType.admin or normalized_role in {
        HouseholdRole.owner.value,
        HouseholdRole.admin.value,
    }


def is_mqtt_managed_device(device: Device) -> bool:
    return bool(device.topic_pub and device.topic_sub)


def mqtt_only_error(message: str) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={"error": "mqtt_only", "message": message},
    )


def _raise_secure_pairing_error(message: str) -> None:
    raise HTTPException(
        status_code=401,
        detail={"error": "unauthorized_device", "message": message},
    )


def _normalize_device_name(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_mac_address(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().replace("-", ":").upper()
    return normalized or None


def _resolve_project_secure_device_name(secure_project: DiyProject | None) -> str | None:
    if secure_project:
        config_json = secure_project.config if isinstance(secure_project.config, dict) else {}
        candidate = config_json.get("project_name") or secure_project.name or "E-Connect Node"
        return _normalize_device_name(str(candidate))
    return None


def _resolve_allowed_secure_device_names(secure_project: DiyProject | None, device: Device | None) -> set[str]:
    allowed_names: set[str] = set()
    project_name = _resolve_project_secure_device_name(secure_project)
    if project_name:
        allowed_names.add(project_name)
    if secure_project and isinstance(secure_project.pending_config, dict):
        pending_name = secure_project.pending_config.get("project_name")
        if pending_name:
            allowed_names.add(_normalize_device_name(str(pending_name)))
    if device:
        stored_name = _normalize_device_name(device.name)
        if stored_name:
            allowed_names.add(stored_name)
    return allowed_names


def _can_reclaim_stale_secure_mac_binding(device: Device | None) -> bool:
    if not device:
        return False

    return (
        device.provisioning_project_id is None
        and device.auth_status == AuthStatus.pending
        and device.pairing_requested_at is None
    )


def _reclaim_stale_secure_mac_binding(db: Session, device: Device, *, target_device_id: str) -> Device:
    old_device_id = device.device_id
    original_mac = device.mac_address
    owner = db.query(User).filter(User.user_id == device.owner_id).first()
    remove_device_widgets(owner, old_device_id)

    temporary_mac = ":".join(
        uuid.uuid4().hex[index : index + 2].upper()
        for index in range(0, 12, 2)
    )
    device.mac_address = temporary_mac
    db.flush()

    reclaimed_device = Device(
        device_id=target_device_id,
        mac_address=original_mac,
        name=device.name,
        room_id=device.room_id,
        owner_id=device.owner_id,
        auth_status=device.auth_status,
        conn_status=device.conn_status,
        mode=device.mode,
        firmware_revision=device.firmware_revision,
        firmware_version=device.firmware_version,
        ip_address=device.ip_address,
        last_seen=device.last_seen,
        pairing_requested_at=device.pairing_requested_at,
        topic_pub=device.topic_pub,
        topic_sub=device.topic_sub,
        provisioning_project_id=device.provisioning_project_id,
    )
    db.add(reclaimed_device)
    db.flush()

    db.query(PinConfiguration).filter(PinConfiguration.device_id == old_device_id).update(
        {PinConfiguration.device_id: target_device_id},
        synchronize_session=False,
    )
    db.query(DeviceHistory).filter(DeviceHistory.device_id == old_device_id).update(
        {DeviceHistory.device_id: target_device_id},
        synchronize_session=False,
    )
    db.query(BackupArchive).filter(BackupArchive.device_id == old_device_id).update(
        {BackupArchive.device_id: target_device_id},
        synchronize_session=False,
    )
    db.query(SystemLog).filter(SystemLog.device_id == old_device_id).update(
        {SystemLog.device_id: target_device_id},
        synchronize_session=False,
    )
    db.delete(device)
    db.flush()
    return reclaimed_device


def build_pairing_request_event_payload(device: Device) -> dict[str, Any]:
    auth_status = device.auth_status.value if hasattr(device.auth_status, "value") else str(device.auth_status)
    conn_status = device.conn_status.value if hasattr(device.conn_status, "value") else str(device.conn_status)
    mode = device.mode.value if hasattr(device.mode, "value") else str(device.mode)
    return {
        "name": device.name,
        "mode": mode,
        "auth_status": auth_status,
        "conn_status": conn_status,
        "mac_address": device.mac_address,
        "pairing_requested_at": (
            device.pairing_requested_at.isoformat() if device.pairing_requested_at else None
        ),
    }


def build_pairing_queue_event_payload(device: Device, *, reason: str) -> dict[str, Any]:
    return {
        **build_pairing_request_event_payload(device),
        "reason": reason,
    }


def register_device_payload(db: Session, payload: DeviceRegister) -> DeviceRegistrationResult:
    device = None
    secure_project = None
    secret_verified = False
    pairing_requested = False
    reclaimed_stale_secure_mac = False
    requested_at = datetime.utcnow()
    force_pairing_request = bool(payload.force_pairing_request)
    normalized_payload_name = _normalize_device_name(payload.name)
    normalized_payload_mac = _normalize_mac_address(payload.mac_address)

    if payload.device_id:
        device = db.query(Device).filter(Device.device_id == payload.device_id).first()

    if device and device.provisioning_project_id:
        persisted_secret = None
        if device.provisioning_project_id:
            persisted_project = (
                db.query(DiyProject)
                .filter(DiyProject.id == device.provisioning_project_id)
                .first()
            )
            if persisted_project is not None:
                persisted_secret = (
                    extract_project_secret_from_payload(persisted_project.pending_config)
                    or extract_project_secret_from_payload(persisted_project.config)
                )
        if not verify_project_secret(
            device.provisioning_project_id,
            device.device_id,
            payload.secret_key,
            persisted_secret,
        ):
            _raise_secure_pairing_error("Secret key mismatch for provisioned device.")
        secret_verified = True
        secure_project = (
            db.query(DiyProject)
            .filter(DiyProject.id == device.provisioning_project_id)
            .first()
        )
    elif payload.project_id:
        secure_project = db.query(DiyProject).filter(DiyProject.id == payload.project_id).first()
        if not secure_project:
            _raise_secure_pairing_error("Provisioning project was not found on the server.")
        if secure_project.room_id is None:
            _raise_secure_pairing_error("Provisioning project is missing a room assignment.")

        persisted_secret = (
            extract_project_secret_from_payload(secure_project.pending_config)
            or extract_project_secret_from_payload(secure_project.config)
        )
        expected_device_id, _ = build_project_firmware_identity(secure_project.id, persisted_secret)
        if payload.device_id != expected_device_id:
            _raise_secure_pairing_error("Provisioned device id does not match the server record.")
        if not verify_project_secret(secure_project.id, expected_device_id, payload.secret_key, persisted_secret):
            _raise_secure_pairing_error("Secret key mismatch for provisioned project.")

        secret_verified = True
        if not device:
            device = db.query(Device).filter(Device.device_id == expected_device_id).first()

    if not device and not secret_verified:
        device = db.query(Device).filter(Device.mac_address == normalized_payload_mac).first()

    if secret_verified:
        if not normalized_payload_name or not normalized_payload_mac:
            _raise_secure_pairing_error("Provisioned devices must report UUID, name, and MAC address.")

        allowed_names = _resolve_allowed_secure_device_names(secure_project, device)
        if allowed_names and normalized_payload_name not in allowed_names:
            _raise_secure_pairing_error("Trusted device name mismatch for provisioned device.")

        if device:
            expected_mac = _normalize_mac_address(device.mac_address)
            if expected_mac and normalized_payload_mac != expected_mac:
                # Check if another device is currently using the new MAC address
                mac_conflict = db.query(Device).filter(Device.mac_address == normalized_payload_mac, Device.device_id != payload.device_id).first()
                if mac_conflict:
                    if _can_reclaim_stale_secure_mac_binding(mac_conflict):
                        device = _reclaim_stale_secure_mac_binding(
                            db,
                            mac_conflict,
                            target_device_id=payload.device_id,
                        )
                        reclaimed_stale_secure_mac = True
                    else:
                        _raise_secure_pairing_error("MAC address is already bound to another device.")
                else:
                    # Allow MAC update since the secret is correct (typical for board replacement)
                    pass
        else:
            mac_bound_device = db.query(Device).filter(Device.mac_address == normalized_payload_mac).first()
            if mac_bound_device and mac_bound_device.device_id != payload.device_id:
                if _can_reclaim_stale_secure_mac_binding(mac_bound_device):
                    device = _reclaim_stale_secure_mac_binding(
                        db,
                        mac_bound_device,
                        target_device_id=payload.device_id,
                    )
                    reclaimed_stale_secure_mac = True
                else:
                    _raise_secure_pairing_error("MAC address is already bound to another device.")

    existing_auth_status = device.auth_status if device else None
    if reclaimed_stale_secure_mac and secret_verified and not force_pairing_request:
        existing_auth_status = AuthStatus.approved

    admin = db.query(User).filter(User.account_type == AccountType.admin).first()
    if not admin:
        raise HTTPException(status_code=400, detail="System not initialized. No admin found.")

    resolved_device_id = payload.device_id or (device.device_id if device else str(uuid.uuid4()))
    topic_pub, topic_sub = build_device_topics(resolved_device_id)

    if not device:
        secure_owner_id = secure_project.user_id if secure_project else admin.user_id
        should_start_pending = force_pairing_request or not secret_verified
        device = Device(
            device_id=resolved_device_id,
            mac_address=normalized_payload_mac or payload.mac_address,
            name=normalized_payload_name or payload.name,
            room_id=secure_project.room_id if secure_project else None,
            owner_id=secure_owner_id,
            auth_status=AuthStatus.pending if should_start_pending else AuthStatus.approved,
            conn_status=ConnStatus.online,
            mode=payload.mode,
            firmware_revision=payload.firmware_revision,
            firmware_version=payload.firmware_version,
            ip_address=payload.ip_address,
            last_seen=datetime.utcnow(),
            pairing_requested_at=requested_at if should_start_pending else None,
            topic_pub=topic_pub,
            topic_sub=topic_sub,
            provisioning_project_id=secure_project.id if secure_project else None,
        )
        pairing_requested = should_start_pending
        db.add(device)
        db.flush()
    else:
        if normalized_payload_mac:
            device.mac_address = normalized_payload_mac
        elif payload.mac_address:
            device.mac_address = payload.mac_address

        if secret_verified:
            if normalized_payload_name:
                device.name = normalized_payload_name
        elif normalized_payload_name:
            device.name = normalized_payload_name
        elif payload.name:
            device.name = payload.name

        device.firmware_revision = payload.firmware_revision
        device.firmware_version = payload.firmware_version
        device.ip_address = payload.ip_address or device.ip_address
        device.mode = payload.mode
        device.last_seen = datetime.utcnow()
        device.conn_status = ConnStatus.online
        device.topic_pub = topic_pub
        device.topic_sub = topic_sub
        if secret_verified:
            device.owner_id = secure_project.user_id if secure_project else device.owner_id
            device.room_id = (
                secure_project.room_id if secure_project and secure_project.room_id else device.room_id
            )
            device.provisioning_project_id = (
                secure_project.id if secure_project else device.provisioning_project_id
            )

        if existing_auth_status == AuthStatus.approved and not force_pairing_request:
            device.auth_status = AuthStatus.approved
            device.pairing_requested_at = None
        else:
            device.auth_status = AuthStatus.pending
            device.pairing_requested_at = requested_at
            pairing_requested = True

    db.query(PinConfiguration).filter(PinConfiguration.device_id == device.device_id).delete()

    for pin in payload.pins:
        db.add(
            PinConfiguration(
                device_id=device.device_id,
                gpio_pin=pin.gpio_pin,
                mode=pin.mode,
                function=pin.function,
                label=pin.label,
                v_pin=pin.v_pin,
                extra_params=pin.extra_params,
            )
        )

    db.flush()
    db.refresh(device)

    if device.auth_status == AuthStatus.approved:
        owner = db.query(User).filter(User.user_id == device.owner_id).first()
        if owner:
            sync_user_dashboard_widgets(owner, device)

    db.flush()
    db.refresh(device)
    return DeviceRegistrationResult(
        device=device,
        secret_verified=secret_verified,
        project_id=secure_project.id if secure_project else device.provisioning_project_id,
        pairing_requested=pairing_requested,
    )


def build_registration_ack_payload(
    *,
    status: str,
    device_id: str,
    secret_verified: bool,
    project_id: str | None = None,
    auth_status: str | None = None,
    topic_pub: str | None = None,
    topic_sub: str | None = None,
    error: str | None = None,
    message: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "status": status,
        "transport": "mqtt",
        "device_id": device_id,
        "secret_verified": secret_verified,
    }
    if project_id:
        payload["project_id"] = project_id
    if auth_status:
        payload["auth_status"] = auth_status
    if topic_pub:
        payload["topic_pub"] = topic_pub
    if topic_sub:
        payload["topic_sub"] = topic_sub
    if error:
        payload["error"] = error
    if message:
        payload["message"] = message
    return payload


def serialize_payload(payload: dict[str, Any]) -> str:
    return json.dumps(payload)
