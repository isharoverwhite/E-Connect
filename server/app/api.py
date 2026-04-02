from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, BackgroundTasks, Form, Query, Request, WebSocket, WebSocketDisconnect, Body
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy import or_
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.exc import IntegrityError
from typing import List, Optional, Any, Callable, Literal, Union
import ast
import datetime as stdlib_datetime
import json
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
import anyio
import asyncio
import hashlib

from .mqtt import build_pairing_rejected_ack_payload, mqtt_manager
from .ws_manager import manager as ws_manager

from .models import (
    UserCreate, UserResponse, Token, TokenData, InitialServerRequest, RefreshTokenRequest,
    DeviceApprovalRequest, DeviceAvailabilityResponse, DeviceHandshakeResponse, DeviceRegister, DeviceResponse, PinConfigCreate,
    AutomationCreate, AutomationResponse, AutomationUpdate,
    DeviceHistoryCreate, DeviceHistoryResponse,
    SystemLogAcknowledgeResponse, SystemLogListResponse, SystemLogResponse, SystemStatusResponse,
    GeneralSettingsResponse, GeneralSettingsUpdate,
    FirmwareResponse, DeviceMode, AccountType, EventType,
    RoomAccessUpdate, RoomUpdate, RoomCreate, RoomResponse, GenerateConfigRequest, GenerateConfigResponse,
    FirmwareNetworkTargetsResponse,
    SetupResponse, HouseholdResponse, TriggerResponse, ExecutionStatus, AutomationLogResponse,
    AutomationScheduleContextResponse,
    DiyProjectCreate, DiyProjectDeleteRequest, DiyProjectResponse, BuildJobResponse, JobStatus, SerialSessionResponse,
    ManagedUserResponse, DiyProjectUsageResponse, ProjectDeviceUsage,
    WifiCredentialCreate, WifiCredentialUpdate, WifiCredentialRevealRequest, WifiCredentialResponse, WifiCredentialSecretResponse,
)
from .sql_models import (
    User, Device, Automation, DeviceHistory,
    Room, RoomPermission, BackupArchive, Household, HouseholdMembership, HouseholdRole,
    AuthStatus, ConnStatus, AutomationExecutionLog, DiyProject, BuildJob, SerialSession, SerialSessionStatus,
    SystemLog, SystemLogCategory as SqlSystemLogCategory, SystemLogSeverity as SqlSystemLogSeverity,
    WifiCredential,
)
from .database import SessionLocal, get_db
from .auth import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    ACCESS_TOKEN_TYPE,
    ALGORITHM,
    REFRESH_TOKEN_EXPIRE_MINUTES,
    REFRESH_TOKEN_TYPE,
    SECRET_KEY,
    create_access_token,
    create_ota_token,
    create_refresh_token,
    get_password_hash,
    verify_ota_token,
    verify_password,
)
from .services.builder import (
    build_job_firmware_version,
    build_firmware_task,
    describe_network_target_change,
    get_durable_artifact_path,
    infer_firmware_network_targets,
    resolve_webapp_transport,
)
from .services.device_registration import (
    build_pairing_queue_event_payload,
    build_pairing_request_event_payload,
    is_mqtt_managed_device,
    mqtt_only_error,
    register_device_payload,
)
from .services.diy_validation import resolve_board_definition, validate_diy_config
from .services.user_management import resolve_household_id_for_user
from .services.provisioning import derive_project_secret
from .services.i2c_registry import I2CLibrary, get_i2c_catalog
from .services.system_metrics import collect_system_metrics
from .services.system_logs import (
    SYSTEM_LOG_ALERT_SEVERITIES,
    SYSTEM_LOG_RETENTION_DAYS,
    create_system_log,
)
from .services.timezone_settings import (
    apply_effective_timezone_context,
    get_current_server_time,
    get_supported_timezones,
    normalize_supported_timezone,
    resolve_effective_timezone_context,
)
from .services.automation_runtime import (
    AutomationGraphValidationError,
    normalize_automation_graph,
    refresh_time_trigger_automations_for_household,
    process_state_event_for_automations,
    serialize_automation,
    serialize_execution_log,
    serialize_graph_for_storage,
    sync_automation_schedule_projection,
    trigger_automation_manually,
)

router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")
logger = logging.getLogger(__name__)
ACTIVE_BUILD_JOB_STATUSES = (
    JobStatus.queued,
    JobStatus.building,
    JobStatus.flashing,
)
DEVICE_HEARTBEAT_TIMEOUT_SECONDS = max(
    5,
    int(os.getenv("DEVICE_HEARTBEAT_TIMEOUT_SECONDS", "15")),
)
DEVICE_HEARTBEAT_TIMEOUT = timedelta(seconds=DEVICE_HEARTBEAT_TIMEOUT_SECONDS)


def _get_primary_membership(db: Session, user: User) -> Optional[HouseholdMembership]:
    return (
        db.query(HouseholdMembership)
        .filter(HouseholdMembership.user_id == user.user_id)
        .order_by(HouseholdMembership.id.asc())
        .first()
    )


def _build_user_session_payload(user: User, membership: Optional[HouseholdMembership]) -> dict[str, Any]:
    household_role = None
    if membership and membership.role is not None:
        household_role = membership.role.value if hasattr(membership.role, "value") else str(membership.role)

    return {
        "sub": user.username,
        "account_type": user.account_type.value if hasattr(user.account_type, "value") else str(user.account_type),
        "household_id": membership.household_id if membership else None,
        "household_role": household_role,
    }


def _issue_user_session_tokens(
    user: User,
    membership: Optional[HouseholdMembership],
    *,
    keep_login: bool,
) -> Token:
    issued_at = stdlib_datetime.datetime.now(timezone.utc)
    access_expires_at = None
    refresh_expires_at = None

    if not keep_login:
        access_expires_at = issued_at + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        refresh_expires_at = issued_at + timedelta(minutes=REFRESH_TOKEN_EXPIRE_MINUTES)

    payload = _build_user_session_payload(user, membership)
    access_token = create_access_token(
        data=payload,
        expires_at=access_expires_at,
        persistent=keep_login,
    )
    refresh_token = create_refresh_token(
        data=payload,
        expires_at=refresh_expires_at,
        persistent=keep_login,
    )

    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        access_token_expires_at=access_expires_at,
        refresh_token_expires_at=refresh_expires_at,
        keep_login=keep_login,
    )


def _set_request_timezone_context(request: Request, context: dict[str, Any]) -> None:
    request.app.state.server_timezone = context["effective_timezone"]
    request.app.state.server_timezone_source = context["timezone_source"]


def _serialize_general_settings(household: Household, context: dict[str, Any]) -> GeneralSettingsResponse:
    effective_timezone = str(context["effective_timezone"])
    return GeneralSettingsResponse(
        household_id=household.household_id,
        configured_timezone=context.get("configured_timezone"),
        effective_timezone=effective_timezone,
        timezone_source=str(context["timezone_source"]),
        current_server_time=get_current_server_time(effective_timezone),
        timezone_options=list(get_supported_timezones()),
    )


def _serialize_time_context_response(context: dict[str, Any]) -> AutomationScheduleContextResponse:
    effective_timezone = str(context["effective_timezone"])
    return AutomationScheduleContextResponse(
        effective_timezone=effective_timezone,
        timezone_source=str(context["timezone_source"]),
        current_server_time=get_current_server_time(effective_timezone),
    )


def _coerce_utc_api_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _serialize_system_log_entry(entry: SystemLog) -> SystemLogResponse:
    return SystemLogResponse(
        id=entry.id,
        occurred_at=_coerce_utc_api_datetime(entry.occurred_at),
        severity=entry.severity,
        category=entry.category,
        event_code=entry.event_code,
        message=entry.message,
        device_id=entry.device_id,
        firmware_version=entry.firmware_version,
        firmware_revision=entry.firmware_revision,
        details=entry.details,
        is_read=entry.is_read,
        read_at=_coerce_utc_api_datetime(entry.read_at),
        read_by_user_id=entry.read_by_user_id,
    )


def _resolve_effective_timezone_payload(db: Session, current_user: User) -> dict[str, Any]:
    household = _get_current_household_or_404(db, current_user)
    return resolve_effective_timezone_context(household=household)


def _require_current_user_password(
    current_user: User,
    password: Optional[str],
    *,
    missing_action: str,
    invalid_action: str,
) -> None:
    normalized_password = password.strip() if isinstance(password, str) else ""
    if not normalized_password:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "validation",
                "message": f"Enter your account password before {missing_action}.",
            },
        )

    if not verify_password(normalized_password, current_user.authentication):
        raise HTTPException(
            status_code=403,
            detail={
                "error": "invalid_password",
                "message": f"Incorrect password. Enter the password for the signed-in account to {invalid_action}.",
            },
        )


def _background_session_factory(db: Session) -> sessionmaker:
    return sessionmaker(autocommit=False, autoflush=False, bind=db.get_bind())


def _get_runtime_firmware_network_state(request: Request) -> dict[str, object] | None:
    runtime_state = getattr(request.app.state, "firmware_network_state", None)
    return runtime_state if isinstance(runtime_state, dict) else None


def _stamp_project_network_targets(config: dict[str, Any], targets: dict[str, Any]) -> dict[str, Any]:
    stamped = dict(config)
    stamped["advertised_host"] = str(targets["advertised_host"])
    stamped["api_base_url"] = str(targets["api_base_url"])
    stamped["mqtt_broker"] = str(targets["mqtt_broker"])
    stamped["mqtt_port"] = int(targets["mqtt_port"])
    stamped["target_key"] = str(targets["target_key"])
    return stamped


def _decode_history_payload(payload: Optional[str]) -> Optional[dict[str, Any]]:
    if not payload:
        return None

    try:
        decoded = json.loads(payload)
        return decoded if isinstance(decoded, dict) else None
    except json.JSONDecodeError:
        try:
            decoded = ast.literal_eval(payload)
            return decoded if isinstance(decoded, dict) else None
        except (ValueError, SyntaxError):
            return None


def _resolve_system_advertised_host(request: Request) -> Optional[str]:
    try:
        targets = infer_firmware_network_targets(
            request.headers,
            request.url.scheme,
            _get_runtime_firmware_network_state(request),
        )
    except ValueError:
        runtime_state = _get_runtime_firmware_network_state(request)
        if isinstance(runtime_state, dict):
            raw_targets = runtime_state.get("targets")
            if isinstance(raw_targets, dict):
                raw_host = raw_targets.get("advertised_host")
                if isinstance(raw_host, str) and raw_host.strip():
                    return raw_host.strip()
        return None

    advertised_host = targets.get("advertised_host")
    if isinstance(advertised_host, str) and advertised_host.strip():
        return advertised_host.strip()
    return None


def _calculate_system_overall_status(
    *,
    unread_alert_severities: list[SqlSystemLogSeverity],
) -> Literal["healthy", "warning", "critical"]:
    if any(severity in {SqlSystemLogSeverity.critical, SqlSystemLogSeverity.error} for severity in unread_alert_severities):
        return "critical"

    if any(severity == SqlSystemLogSeverity.warning for severity in unread_alert_severities):
        return "warning"

    return "healthy"


def _attach_runtime_state(db: Session, device: Device) -> Device:
    latest_state = (
        db.query(DeviceHistory)
        .filter(
            DeviceHistory.device_id == device.device_id,
            DeviceHistory.event_type == EventType.state_change,
        )
        .order_by(DeviceHistory.timestamp.desc())
        .first()
    )

    if latest_state:
        setattr(device, "last_state", _decode_history_payload(latest_state.payload))
    else:
        setattr(device, "last_state", None)

    return device


def _expire_device_if_stale(db: Session, device: Device, *, reference_time: datetime) -> bool:
    if device.conn_status == ConnStatus.offline:
        return False

    if device.last_seen and (reference_time - device.last_seen) <= DEVICE_HEARTBEAT_TIMEOUT:
        return False

    device.conn_status = ConnStatus.offline
    db.add(
        DeviceHistory(
            device_id=device.device_id,
            event_type=EventType.offline,
            payload=json.dumps(
                {
                    "reason": "heartbeat_timeout",
                    "timeout_seconds": DEVICE_HEARTBEAT_TIMEOUT_SECONDS,
                    "last_seen": device.last_seen.isoformat() if device.last_seen else None,
                    "evaluated_at": reference_time.isoformat(),
                }
            ),
        )
    )
    create_system_log(
        db,
        severity=SqlSystemLogSeverity.warning,
        category=SqlSystemLogCategory.connectivity,
        event_code="device_offline",
        message=f'Device "{device.name}" is offline.',
        device_id=device.device_id,
        firmware_version=device.firmware_version,
        firmware_revision=device.firmware_revision,
        details={
            "reason": "heartbeat_timeout",
            "timeout_seconds": DEVICE_HEARTBEAT_TIMEOUT_SECONDS,
            "last_seen": device.last_seen.isoformat() if device.last_seen else None,
            "evaluated_at": reference_time.isoformat(),
        },
    )

    # Broadcast offline event via WebSocket dynamically instead of waiting for full restart
    try:
        ws_manager.broadcast_device_event_sync(
            "device_offline",
            device.device_id,
            device.room_id,
            {"reason": "heartbeat_timeout"}
        )
    except Exception:
        pass

    return True


def _expire_stale_devices(db: Session, devices: list[Device]) -> None:
    reference_time = datetime.utcnow()
    status_changed = False

    for device in devices:
        status_changed = _expire_device_if_stale(
            db,
            device,
            reference_time=reference_time,
        ) or status_changed

    if status_changed:
        db.commit()


def expire_stale_online_devices_once(
    *,
    session_factory: Optional[Callable[[], Session]] = None,
) -> int:
    db = (session_factory or SessionLocal)()
    try:
        devices = db.query(Device).filter(Device.conn_status == ConnStatus.online).all()
        if not devices:
            return 0

        reference_time = datetime.utcnow()
        expired_count = 0

        for device in devices:
            if _expire_device_if_stale(db, device, reference_time=reference_time):
                expired_count += 1

        if expired_count:
            db.commit()

        return expired_count
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _broadcast_pairing_queue_updated(device: Device, *, reason: str) -> None:
    try:
        ws_manager.broadcast_device_event_sync(
            "pairing_queue_updated",
            device.device_id,
            None,
            build_pairing_queue_event_payload(device, reason=reason),
        )
    except Exception:
        pass


def _resolve_build_artifact_path(job: BuildJob, artifact_name: Literal["firmware", "bootloader", "partitions"]) -> Optional[str]:
    if artifact_name == "firmware":
        return job.artifact_path

    try:
        candidate = get_durable_artifact_path(job.id, artifact_name)
        if os.path.exists(candidate):
            return candidate
    except ValueError:
        pass

    if not job.artifact_path:
        return None

    artifact_dir = os.path.dirname(job.artifact_path)
    fallback_candidate = os.path.join(artifact_dir, f"{job.id}.{artifact_name}.bin")
    return fallback_candidate if os.path.exists(fallback_candidate) else None


def _get_layout_widgets(layout: Any) -> list[dict[str, Any]]:
    if isinstance(layout, dict) and isinstance(layout.get("widgets"), list):
        return [widget for widget in layout["widgets"] if isinstance(widget, dict)]
    if isinstance(layout, list):
        return [widget for widget in layout if isinstance(widget, dict)]
    return []


def _build_device_widgets(device: Device) -> list[dict[str, Any]]:
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

        widgets.append({
            "i": f"{device.device_id}:{pin.gpio_pin}:{index}",
            "x": 0,
            "y": index * 2,
            "w": 2,
            "h": 2,
            "type": widget_type,
            "deviceId": device.device_id,
            "pin": pin.gpio_pin,
            "label": pin.label or f"{pin.function or 'Pin'} {pin.gpio_pin}",
        })

    return widgets


def _sync_user_dashboard_widgets(user: User, device: Device):
    existing_widgets = [
        widget for widget in _get_layout_widgets(user.ui_layout)
        if widget.get("deviceId") != device.device_id
    ]
    user.ui_layout = [*existing_widgets, *_build_device_widgets(device)]


def _remove_device_widgets(user: Optional[User], device_id: str):
    if not user:
        return

    user.ui_layout = [
        widget for widget in _get_layout_widgets(user.ui_layout)
        if widget.get("deviceId") != device_id
    ]


def _build_device_topics(device_id: str) -> tuple[str, str]:
    namespace = os.getenv("MQTT_NAMESPACE", "local")
    return (
        f"econnect/{namespace}/device/{device_id}/state",
        f"econnect/{namespace}/device/{device_id}/command",
    )


def _raise_secure_pairing_error(message: str):
    raise HTTPException(
        status_code=401,
        detail={"error": "unauthorized_device", "message": message},
    )


def _raise_automation_graph_http_error(exc: AutomationGraphValidationError) -> None:
    raise HTTPException(
        status_code=400,
        detail={
            "error": exc.code,
            "message": exc.message,
        },
    ) from exc


def _get_user_automation(db: Session, automation_id: int, user: User) -> Automation:
    automation = (
        db.query(Automation)
        .filter(Automation.id == automation_id, Automation.creator_id == user.user_id)
        .first()
    )
    if automation is None:
        raise HTTPException(status_code=404, detail="Automation not found")
    return automation


def _automation_response_model(automation: Automation) -> AutomationResponse:
    return AutomationResponse.model_validate(serialize_automation(automation))


def _automation_log_response_model(log: AutomationExecutionLog) -> AutomationLogResponse:
    return AutomationLogResponse.model_validate(serialize_execution_log(log))


def _apply_automation_payload(
    automation: Automation,
    payload: AutomationCreate | AutomationUpdate,
    *,
    device_scope: dict[str, Device] | None = None,
    effective_timezone: str,
) -> Automation:
    try:
        normalized_graph = normalize_automation_graph(
            payload.graph,
            device_scope=device_scope,
        )
    except AutomationGraphValidationError as exc:
        _raise_automation_graph_http_error(exc)

    name = payload.name.strip()
    if not name:
        raise HTTPException(
            status_code=400,
            detail={"error": "validation", "message": "Automation name is required."},
        )

    automation.name = name
    automation.script_code = serialize_graph_for_storage(normalized_graph)
    automation.is_enabled = payload.is_enabled
    sync_automation_schedule_projection(
        automation,
        normalized_graph,
        effective_timezone=effective_timezone,
        reference_time=datetime.now(timezone.utc),
    )
    return automation


def _serialize_managed_user(user: User, membership: HouseholdMembership) -> User:
    setattr(user, "household_role", membership.role)
    return user


def _normalize_household_role(user: User) -> Optional[str]:
    role = getattr(user, "current_household_role", None)
    if hasattr(role, "value"):
        return role.value
    if isinstance(role, str):
        return role
    return None


def _is_room_admin(user: User) -> bool:
    current_household_role = _normalize_household_role(user)
    return user.account_type == AccountType.admin or current_household_role in {
        HouseholdRole.owner.value,
        HouseholdRole.admin.value,
    }


def _get_household_member_ids(db: Session, household_id: Optional[int]) -> list[int]:
    if household_id is None:
        return []

    rows = (
        db.query(HouseholdMembership.user_id)
        .filter(HouseholdMembership.household_id == household_id)
        .all()
    )
    return [row[0] for row in rows]


def _get_household_room_ids(db: Session, household_id: Optional[int]) -> list[int]:
    if household_id is None:
        return []

    rows = db.query(Room.room_id).filter(Room.household_id == household_id).all()
    return [row[0] for row in rows]


def _resolve_household_scope(
    db: Session,
    current_user: User,
) -> tuple[Optional[int], list[int], list[int]]:
    household_id = resolve_household_id_for_user(db, current_user)
    household_member_ids = _get_household_member_ids(db, household_id)
    household_room_ids = _get_household_room_ids(db, household_id)
    return household_id, household_member_ids, household_room_ids


def _build_household_device_scope_filters(
    household_member_ids: list[int],
    household_room_ids: list[int],
) -> list[Any]:
    filters: list[Any] = []
    if household_member_ids:
        filters.append(Device.owner_id.in_(household_member_ids))
    if household_room_ids:
        filters.append(Device.room_id.in_(household_room_ids))
    return filters


def _build_household_project_scope_filters(
    household_member_ids: list[int],
    household_room_ids: list[int],
) -> list[Any]:
    filters: list[Any] = []
    if household_member_ids:
        filters.append(DiyProject.user_id.in_(household_member_ids))
    if household_room_ids:
        filters.append(DiyProject.room_id.in_(household_room_ids))
    return filters


def _get_room_permission_map(db: Session, room_ids: list[int]) -> dict[int, list[int]]:
    if not room_ids:
        return {}

    permissions = (
        db.query(RoomPermission)
        .filter(RoomPermission.room_id.in_(room_ids), RoomPermission.can_control.is_(True))
        .all()
    )
    permission_map: dict[int, list[int]] = {}
    for permission in permissions:
        permission_map.setdefault(permission.room_id, []).append(permission.user_id)
    return permission_map


def _serialize_room_response(room: Room, assigned_user_ids: Optional[list[int]] = None) -> dict[str, Any]:
    return {
        "room_id": room.room_id,
        "user_id": room.user_id,
        "household_id": room.household_id,
        "name": room.name,
        "allowed_user_ids": assigned_user_ids or [],
        "assigned_user_ids": assigned_user_ids or [],
    }


def _get_room_or_404(db: Session, room_id: int) -> Room:
    room = db.query(Room).filter(Room.room_id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return room


def _get_current_household_or_404(db: Session, current_user: User) -> Household:
    household_id = resolve_household_id_for_user(db, current_user)
    if household_id is None:
        raise HTTPException(status_code=404, detail="Household not found")

    household = (
        db.query(Household)
        .filter(Household.household_id == household_id)
        .first()
    )
    if not household:
        raise HTTPException(status_code=404, detail="Household not found")
    return household


def _get_room_in_household_or_404(db: Session, current_user: User, room_id: int) -> Room:
    household_id = resolve_household_id_for_user(db, current_user)
    room = (
        db.query(Room)
        .filter(Room.room_id == room_id, Room.household_id == household_id)
        .first()
    )
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return room


def _replace_room_permissions(db: Session, room: Room, allowed_user_ids: list[int]) -> list[int]:
    unique_ids = sorted(set(allowed_user_ids))
    db.query(RoomPermission).filter(RoomPermission.room_id == room.room_id).delete()
    for user_id in unique_ids:
        db.add(RoomPermission(room_id=room.room_id, user_id=user_id, can_control=True))
    return unique_ids


def _validate_room_permission_targets(
    db: Session,
    household_id: Optional[int],
    allowed_user_ids: list[int],
) -> list[int]:
    unique_ids = sorted(set(allowed_user_ids))
    if not unique_ids:
        return []

    memberships = (
        db.query(HouseholdMembership.user_id)
        .filter(
            HouseholdMembership.household_id == household_id,
            HouseholdMembership.user_id.in_(unique_ids),
        )
        .all()
    )
    membership_user_ids = {row[0] for row in memberships}
    if membership_user_ids != set(unique_ids):
        raise HTTPException(
            status_code=400,
            detail={"error": "validation", "message": "One or more selected users are not in this household."},
        )
    return unique_ids


def _get_accessible_room_ids_for_user(db: Session, current_user: User) -> list[int]:
    household_id = resolve_household_id_for_user(db, current_user)
    if household_id is None:
        return []

    if _is_room_admin(current_user):
        return _get_household_room_ids(db, household_id)

    rows = (
        db.query(RoomPermission.room_id)
        .join(Room, Room.room_id == RoomPermission.room_id)
        .filter(
            RoomPermission.user_id == current_user.user_id,
            RoomPermission.can_control.is_(True),
            Room.household_id == household_id,
        )
        .all()
    )
    return [row[0] for row in rows]


def _get_device_or_404(db: Session, device_id: str) -> Device:
    device = db.query(Device).filter(Device.device_id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


def _get_device_in_household_or_404(db: Session, current_user: User, device_id: str) -> Device:
    _household_id, household_member_ids, household_room_ids = _resolve_household_scope(db, current_user)
    household_filters = _build_household_device_scope_filters(household_member_ids, household_room_ids)
    if not household_filters:
        raise HTTPException(status_code=404, detail="Device not found")

    device = (
        db.query(Device)
        .filter(Device.device_id == device_id)
        .filter(or_(*household_filters))
        .first()
    )
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


def _get_project_in_household_or_404(db: Session, current_user: User, project_id: str) -> DiyProject:
    _household_id, household_member_ids, household_room_ids = _resolve_household_scope(db, current_user)
    household_filters = _build_household_project_scope_filters(household_member_ids, household_room_ids)
    if not household_filters:
        raise HTTPException(status_code=404, detail="Project not found")

    project = (
        db.query(DiyProject)
        .filter(DiyProject.id == project_id)
        .filter(or_(*household_filters))
        .first()
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _get_build_job_in_household_or_404(db: Session, current_user: User, job_id: str) -> BuildJob:
    _household_id, household_member_ids, household_room_ids = _resolve_household_scope(db, current_user)
    household_filters = _build_household_project_scope_filters(household_member_ids, household_room_ids)
    if not household_filters:
        raise HTTPException(status_code=404, detail="Job not found")

    job = (
        db.query(BuildJob)
        .join(DiyProject)
        .filter(BuildJob.id == job_id)
        .filter(or_(*household_filters))
        .first()
    )
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def _ensure_device_control_access(db: Session, current_user: User, device: Device) -> None:
    if device.auth_status != AuthStatus.approved:
        raise HTTPException(status_code=409, detail="Device is not approved for control")

    if _is_room_admin(current_user):
        return

    accessible_room_ids = set(_get_accessible_room_ids_for_user(db, current_user))
    if device.room_id is None or device.room_id not in accessible_room_ids:
        raise HTTPException(status_code=403, detail="Not authorized")


def _attach_room_name(device: Device) -> Device:
    setattr(device, "room_name", device.room.name if device.room else None)
    return device


def _serialize_device_availability(device: Device) -> dict[str, Any]:
    return {
        "device_id": device.device_id,
        "room_id": device.room_id,
        "room_name": getattr(device, "room_name", None),
        "auth_status": device.auth_status,
        "conn_status": device.conn_status,
        "pairing_requested_at": device.pairing_requested_at,
    }


def _get_managed_membership_or_404(db: Session, admin: User, user_id: int) -> HouseholdMembership:
    household_id = resolve_household_id_for_user(db, admin)
    if household_id is None:
        raise HTTPException(status_code=404, detail="Household not found")

    membership = (
        db.query(HouseholdMembership)
        .filter(
            HouseholdMembership.household_id == household_id,
            HouseholdMembership.user_id == user_id,
        )
        .first()
    )
    if not membership:
        raise HTTPException(status_code=404, detail="User not found")

    return membership


def _mask_secret(secret: str) -> str:
    if not secret:
        return ""
    return "*" * max(8, min(len(secret), 16))


def _serialize_wifi_credential(credential: WifiCredential, *, usage_count: int = 0) -> dict[str, Any]:
    return {
        "id": credential.id,
        "household_id": credential.household_id,
        "ssid": credential.ssid,
        "masked_password": _mask_secret(credential.password),
        "usage_count": usage_count,
        "created_at": credential.created_at,
        "updated_at": credential.updated_at,
    }


def _get_wifi_credential_in_household_or_404(
    db: Session,
    current_user: User,
    credential_id: int,
) -> WifiCredential:
    household_id = resolve_household_id_for_user(db, current_user)
    credential = (
        db.query(WifiCredential)
        .filter(
            WifiCredential.id == credential_id,
            WifiCredential.household_id == household_id,
        )
        .first()
    )
    if not credential:
        raise HTTPException(status_code=404, detail="Wi-Fi credential not found")
    return credential


def _resolve_wifi_credential_for_payload(
    db: Session,
    current_user: User,
    *,
    requested_credential_id: Optional[int],
    existing_credential_id: Optional[int] = None,
    config_payload: Optional[dict[str, Any]] = None,
    create_from_legacy: bool = False,
    required: bool = True,
    missing_message: str = "Select a Wi-Fi credential before continuing.",
) -> Optional[WifiCredential]:
    if requested_credential_id is not None:
        return _get_wifi_credential_in_household_or_404(db, current_user, requested_credential_id)

    if existing_credential_id is not None:
        return _get_wifi_credential_in_household_or_404(db, current_user, existing_credential_id)

    household_id = resolve_household_id_for_user(db, current_user)
    if household_id is None:
        raise HTTPException(status_code=404, detail="Household not found")

    payload = config_payload if isinstance(config_payload, dict) else {}
    wifi_ssid = payload.get("wifi_ssid")
    wifi_password = payload.get("wifi_password")
    if isinstance(wifi_ssid, str) and wifi_ssid.strip() and isinstance(wifi_password, str) and wifi_password:
        existing = (
            db.query(WifiCredential)
            .filter(
                WifiCredential.household_id == household_id,
                WifiCredential.ssid == wifi_ssid.strip(),
                WifiCredential.password == wifi_password,
            )
            .order_by(WifiCredential.id.asc())
            .first()
        )
        if existing is not None:
            return existing

        if create_from_legacy and current_user.account_type == AccountType.admin:
            created = WifiCredential(
                household_id=household_id,
                ssid=wifi_ssid.strip(),
                password=wifi_password,
            )
            db.add(created)
            db.flush()
            return created

    if required:
        raise HTTPException(
            status_code=400,
            detail={"error": "validation", "message": missing_message},
        )

    return None


def _stamp_wifi_credential_config(
    config_payload: Optional[dict[str, Any]],
    credential: WifiCredential,
) -> dict[str, Any]:
    stamped = dict(config_payload or {})
    stamped["wifi_credential_id"] = credential.id
    stamped["wifi_ssid"] = credential.ssid
    stamped["wifi_password"] = credential.password
    return stamped


def _extract_wifi_credential_id_from_config(config_payload: Optional[dict[str, Any]]) -> Optional[int]:
    if not isinstance(config_payload, dict):
        return None

    raw_value = config_payload.get("wifi_credential_id")
    return raw_value if isinstance(raw_value, int) else None


def _raise_legacy_ota_disabled() -> None:
    raise HTTPException(
        status_code=410,
        detail={
            "error": "disabled",
            "message": "Legacy OTA endpoints are disabled. Use DIY build artifacts and signed OTA downloads instead.",
        },
    )

# --- Dependencies ---
async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    from jose import jwt, JWTError
    credentials_exception = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        token_type: Optional[str] = payload.get("type")
        account_type: str = payload.get("account_type")
        household_id: int = payload.get("household_id")
        household_role: str = payload.get("household_role")
        if username is None or token_type not in (None, ACCESS_TOKEN_TYPE):
            raise credentials_exception
        token_data = TokenData(
            username=username,
            account_type=account_type,
            household_id=household_id,
            household_role=household_role
        )
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.username == token_data.username).first()
    if user is None:
        raise credentials_exception

    # Attach session household context dynamically for route handlers
    setattr(user, "current_household_id", token_data.household_id)
    setattr(user, "current_household_role", token_data.household_role)

    return user

async def get_admin_user(current_user: User = Depends(get_current_user)):
    if not _is_room_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin or Owner privileges required")
    return current_user


async def get_account_admin_user(current_user: User = Depends(get_current_user)):
    if current_user.account_type != AccountType.admin:
        raise HTTPException(status_code=403, detail="Admin account required")
    return current_user

# --- WebSocket Endpoints ---

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: Optional[str] = Query(None), db: Session = Depends(get_db)):
    if not token:
        await websocket.close(code=1008, reason="Missing token")
        return

    from jose import jwt, JWTError
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        token_type: Optional[str] = payload.get("type")
        if not username or token_type not in (None, ACCESS_TOKEN_TYPE):
            raise ValueError("Invalid sub in token")
    except (JWTError, ValueError):
        await websocket.close(code=1008, reason="Invalid token")
        return

    user = db.query(User).filter(User.username == username).first()
    if not user:
        await websocket.close(code=1008, reason="User missing")
        return

    acc_type_val = user.account_type.value if hasattr(user.account_type, "value") else str(user.account_type)
    accessible_room_ids = _get_accessible_room_ids_for_user(db, user) if acc_type_val != "admin" else []

    await ws_manager.connect(websocket, user.user_id, acc_type_val, accessible_room_ids)
    try:
        while True:
            # We don't expect much client->server WS text, but we need to keep the loop
            # alive and wait for disconnects
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)

# --- Auth Endpoints ---

@router.get("/system/status")
async def get_system_status(db: Session = Depends(get_db)):
    """
    Check if the server has been initialized with at least one user (the Master Admin).
    """
    user_count = db.query(User).count()
    return {"initialized": user_count > 0}

@router.post("/auth/initialserver", response_model=SetupResponse)
async def initialserver(payload: InitialServerRequest, db: Session = Depends(get_db)):
    # Check if system is already initialized
    if db.query(User).count() > 0:
        raise HTTPException(status_code=403, detail={"error": "system_initialized", "message": "System already initialized"})

    hashed_password = get_password_hash(payload.password)

    new_user = User(
        fullname=payload.fullname,
        username=payload.username,
        authentication=hashed_password,
        account_type=AccountType.admin, # Force admin
        ui_layout=payload.ui_layout or {}
    )
    db.add(new_user)
    try:
        db.commit()
        db.refresh(new_user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Username already registered")

    # Optimistic concurrency check to handle race conditions
    first_user = db.query(User).order_by(User.user_id.asc()).first()
    if first_user and first_user.user_id != new_user.user_id:
        db.delete(new_user)
        db.commit()
        raise HTTPException(status_code=403, detail={"error": "system_initialized", "message": "System already initialized"})

    # Create Baseline Household
    household_name = payload.householdName.strip() if payload.householdName and payload.householdName.strip() else f"{new_user.fullname}'s Household"
    new_household = Household(name=household_name)
    db.add(new_household)
    db.commit()
    db.refresh(new_household)

    # Automatically add the setup admin as the owner of the household
    membership = HouseholdMembership(
        household_id=new_household.household_id,
        user_id=new_user.user_id,
        role=HouseholdRole.owner
    )
    db.add(membership)
    db.commit()

    return SetupResponse(user=new_user, household=new_household)

@router.post("/users", response_model=UserResponse)
async def create_user(user_data: UserCreate, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    """
    Admin-only endpoint to create additional household users.
    """
    if db.query(User).filter(User.username == user_data.username).first():
        raise HTTPException(status_code=400, detail="Username already registered")

    hashed_password = get_password_hash(user_data.password)
    admin_household_id = resolve_household_id_for_user(db, admin)
    if admin_household_id is None:
        raise HTTPException(status_code=404, detail="Household not found")

    new_user = User(
        fullname=user_data.fullname,
        username=user_data.username,
        authentication=hashed_password,
        account_type=user_data.account_type,
        ui_layout=user_data.ui_layout or {}
    )
    db.add(new_user)
    try:
        db.commit()
        db.refresh(new_user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Database error or username collision")

    # Bind to Admin's Household
    membership_role = HouseholdRole.admin if user_data.account_type == AccountType.admin else HouseholdRole.member
    membership = HouseholdMembership(
        household_id=admin_household_id,
        user_id=new_user.user_id,
        role=membership_role
    )
    db.add(membership)
    db.commit()

    return new_user


@router.get("/users", response_model=List[ManagedUserResponse])
async def list_users(db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    household_id = resolve_household_id_for_user(db, admin)
    if household_id is None:
        return []

    memberships = (
        db.query(HouseholdMembership)
        .join(User, User.user_id == HouseholdMembership.user_id)
        .filter(HouseholdMembership.household_id == household_id)
        .order_by(User.created_at.asc(), User.user_id.asc())
        .all()
    )
    return [_serialize_managed_user(membership.user, membership) for membership in memberships]

@router.delete("/users/{user_id}", response_model=dict)
async def delete_user(user_id: int, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    if user_id == admin.user_id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")

    membership = _get_managed_membership_or_404(db, admin, user_id)
    user = membership.user

    if user.user_id == 1:
        raise HTTPException(status_code=400, detail="Cannot delete the initial server account")

    db.delete(user)
    db.commit()

    return {"status": "success", "message": "User deleted"}


@router.post("/users/{user_id}/promote", response_model=ManagedUserResponse)
async def toggle_admin_user(user_id: int, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    if user_id == admin.user_id:
        raise HTTPException(status_code=400, detail="You cannot modify your own role")

    from app.models import AccountType
    membership = _get_managed_membership_or_404(db, admin, user_id)

    if membership.user.user_id == 1:
        raise HTTPException(status_code=400, detail="Cannot modify the role of the initial server account")

    if membership.user.account_type == AccountType.admin:
        membership.user.account_type = AccountType.parent
        membership.role = HouseholdRole.member
    else:
        membership.user.account_type = AccountType.admin
        membership.role = HouseholdRole.admin

    db.commit()
    db.refresh(membership.user)
    return _serialize_managed_user(membership.user, membership)

@router.post("/auth/token", response_model=Token)
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    keep_login: bool = Form(False),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.username == form_data.username).first()
    # Check password against 'authentication' column
    if not user or not verify_password(form_data.password, user.authentication):
        raise HTTPException(
            status_code=401,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Find active household membership for context binding
    membership = _get_primary_membership(db, user)

    return _issue_user_session_tokens(user, membership, keep_login=keep_login)


@router.post("/auth/refresh", response_model=Token)
async def refresh_access_token(payload: RefreshTokenRequest, db: Session = Depends(get_db)):
    from jose import JWTError, jwt

    credentials_exception = HTTPException(
        status_code=401,
        detail={
            "error": "invalid_refresh_token",
            "message": "Refresh token is invalid or expired. Please sign in again.",
        },
    )

    try:
        claims = jwt.decode(payload.refresh_token, SECRET_KEY, algorithms=[ALGORITHM])
        username: Optional[str] = claims.get("sub")
        token_type: Optional[str] = claims.get("type")
        keep_login = bool(claims.get("keep_login"))
        if not username or token_type != REFRESH_TOKEN_TYPE:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exception

    membership = _get_primary_membership(db, user)
    return _issue_user_session_tokens(user, membership, keep_login=keep_login)

@router.get("/users/me", response_model=UserResponse)
async def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.put("/users/me/layout", response_model=UserResponse)
async def update_layout(layout: Any, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Update User's Dashboard Grid Layout.
    """
    current_user.ui_layout = layout
    db.commit()
    db.refresh(current_user)
    return current_user


@router.get("/settings/general", response_model=GeneralSettingsResponse)
async def get_general_settings(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    household = _get_current_household_or_404(db, current_user)
    timezone_context = apply_effective_timezone_context(household=household)
    _set_request_timezone_context(request, timezone_context)
    return _serialize_general_settings(household, timezone_context)


@router.put("/settings/general", response_model=GeneralSettingsResponse)
async def update_general_settings(
    payload: GeneralSettingsUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    household = _get_current_household_or_404(db, current_user)
    previous_context = resolve_effective_timezone_context(household=household)
    requested_timezone = payload.timezone.strip() if isinstance(payload.timezone, str) else ""

    if requested_timezone:
        normalized_timezone = normalize_supported_timezone(requested_timezone)
        if normalized_timezone is None:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "validation",
                    "message": "Select a valid IANA timezone from the supported timezone list.",
                },
            )
    else:
        normalized_timezone = None

    household.timezone = normalized_timezone
    db.add(household)
    db.flush()

    next_context = apply_effective_timezone_context(household=household)
    refresh_time_trigger_automations_for_household(
        db,
        household_id=household.household_id,
        effective_timezone=str(next_context["effective_timezone"]),
        reference_time=datetime.now(timezone.utc),
    )
    create_system_log(
        db,
        severity=SqlSystemLogSeverity.info,
        category=SqlSystemLogCategory.health,
        event_code="server_timezone_updated",
        message=f"Server timezone now resolves to {next_context['effective_timezone']}.",
        details={
            "previous_effective_timezone": previous_context["effective_timezone"],
            "previous_source": previous_context["timezone_source"],
            "configured_timezone": normalized_timezone,
            "effective_timezone": next_context["effective_timezone"],
            "timezone_source": next_context["timezone_source"],
        },
    )
    db.commit()
    db.refresh(household)

    _set_request_timezone_context(request, next_context)
    return _serialize_general_settings(household, next_context)

# --- Room Endpoints ---

@router.post("/rooms", response_model=RoomResponse)
async def create_room(room: RoomCreate, db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    room_name = room.name.strip()
    if not room_name:
        raise HTTPException(
            status_code=400,
            detail={"error": "validation", "message": "Room name is required."},
        )

    household_id = resolve_household_id_for_user(db, current_user)
    if household_id is None:
        raise HTTPException(status_code=404, detail="Household not found")

    existing_room = (
        db.query(Room)
        .filter(Room.household_id == household_id, Room.name == room_name)
        .first()
    )
    if existing_room:
        raise HTTPException(
            status_code=409,
            detail={"error": "conflict", "message": "A room with this name already exists."},
        )

    allowed_user_ids = _validate_room_permission_targets(db, household_id, room.allowed_user_ids)

    new_room = Room(name=room_name, user_id=current_user.user_id, household_id=household_id)
    db.add(new_room)
    db.flush()
    assigned_user_ids = _replace_room_permissions(
        db,
        new_room,
        sorted({*allowed_user_ids, current_user.user_id}),
    )
    db.commit()
    db.refresh(new_room)
    return _serialize_room_response(new_room, assigned_user_ids)

@router.get("/rooms", response_model=List[RoomResponse])
async def list_rooms(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    household_id = resolve_household_id_for_user(db, current_user)
    if household_id is None:
        return []

    query = db.query(Room).filter(Room.household_id == household_id).order_by(Room.name.asc(), Room.room_id.asc())
    if not _is_room_admin(current_user):
        accessible_room_ids = _get_accessible_room_ids_for_user(db, current_user)
        if not accessible_room_ids:
            return []
        query = query.filter(Room.room_id.in_(accessible_room_ids))

    rooms = query.all()
    room_ids = [room.room_id for room in rooms]
    permission_map = _get_room_permission_map(db, room_ids) if _is_room_admin(current_user) else {}
    return [
        _serialize_room_response(room, permission_map.get(room.room_id, []))
        for room in rooms
    ]


@router.put("/rooms/{room_id}/access", response_model=RoomResponse)
async def update_room_access(
    room_id: int,
    payload: RoomAccessUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    room = _get_room_in_household_or_404(db, current_user, room_id)
    household_id = resolve_household_id_for_user(db, current_user)
    assigned_user_ids = _replace_room_permissions(
        db,
        room,
        _validate_room_permission_targets(db, household_id, payload.allowed_user_ids),
    )
    db.commit()
    db.refresh(room)
    return _serialize_room_response(room, assigned_user_ids)


@router.put("/rooms/{room_id}", response_model=RoomResponse)
async def update_room(
    room_id: int,
    payload: RoomUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    room = _get_room_in_household_or_404(db, current_user, room_id)
    room_name = payload.name.strip()
    if not room_name:
        raise HTTPException(
            status_code=400,
            detail={"error": "validation", "message": "Room name is required."},
        )

    household_id = resolve_household_id_for_user(db, current_user)
    existing_room = (
        db.query(Room)
        .filter(Room.household_id == household_id, Room.name == room_name, Room.room_id != room_id)
        .first()
    )
    if existing_room:
        raise HTTPException(
            status_code=409,
            detail={"error": "conflict", "message": "A room with this name already exists."},
        )

    room.name = room_name
    db.commit()
    db.refresh(room)

    room_ids = [room.room_id]
    permission_map = _get_room_permission_map(db, room_ids) if _is_room_admin(current_user) else {}
    return _serialize_room_response(room, permission_map.get(room.room_id, []))


@router.delete("/rooms/{room_id}")
async def delete_room(
    room_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    room = _get_room_in_household_or_404(db, current_user, room_id)
    # 1. Clear room associations from devices
    devices_in_room = db.query(Device).filter(Device.room_id == room_id).all()
    for d in devices_in_room:
        d.room_id = None

    # 2. Clear room associations from DIY projects to prevent MariaDB foreign key violations
    from app.sql_models import DiyProject
    projects_in_room = db.query(DiyProject).filter(DiyProject.room_id == room_id).all()
    for p in projects_in_room:
        p.room_id = None

    db.delete(room)
    db.commit()
    return {"message": "Room deleted successfully"}


@router.get("/wifi-credentials", response_model=List[WifiCredentialResponse])
async def list_wifi_credentials(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_account_admin_user),
):
    household_id = resolve_household_id_for_user(db, current_user)
    if household_id is None:
        return []

    credentials = (
        db.query(WifiCredential)
        .filter(WifiCredential.household_id == household_id)
        .order_by(WifiCredential.ssid.asc(), WifiCredential.id.asc())
        .all()
    )
    if not credentials:
        return []

    usage_counts: dict[int, int] = {}
    credential_ids = [credential.id for credential in credentials]
    for project_credential_id, in (
        db.query(DiyProject.wifi_credential_id)
        .filter(DiyProject.wifi_credential_id.in_(credential_ids))
        .all()
    ):
        if project_credential_id is None:
            continue
        usage_counts[project_credential_id] = usage_counts.get(project_credential_id, 0) + 1

    return [
        _serialize_wifi_credential(credential, usage_count=usage_counts.get(credential.id, 0))
        for credential in credentials
    ]


@router.post("/wifi-credentials", response_model=WifiCredentialResponse)
async def create_wifi_credential(
    payload: WifiCredentialCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_account_admin_user),
):
    household_id = resolve_household_id_for_user(db, current_user)
    if household_id is None:
        raise HTTPException(status_code=404, detail="Household not found")

    normalized_ssid = payload.ssid.strip()
    if not normalized_ssid:
        raise HTTPException(
            status_code=400,
            detail={"error": "validation", "message": "SSID is required."},
        )

    existing = (
        db.query(WifiCredential)
        .filter(
            WifiCredential.household_id == household_id,
            WifiCredential.ssid == normalized_ssid,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail={"error": "conflict", "message": f"Wi-Fi SSID '{normalized_ssid}' already exists."},
        )

    credential = WifiCredential(
        household_id=household_id,
        ssid=normalized_ssid,
        password=payload.password,
    )
    db.add(credential)
    db.commit()
    db.refresh(credential)
    return _serialize_wifi_credential(credential)


@router.put("/wifi-credentials/{credential_id}", response_model=WifiCredentialResponse)
async def update_wifi_credential(
    credential_id: int,
    payload: WifiCredentialUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_account_admin_user),
):
    credential = _get_wifi_credential_in_household_or_404(db, current_user, credential_id)
    normalized_ssid = payload.ssid.strip()
    if not normalized_ssid:
        raise HTTPException(
            status_code=400,
            detail={"error": "validation", "message": "SSID is required."},
        )

    existing = (
        db.query(WifiCredential)
        .filter(
            WifiCredential.household_id == credential.household_id,
            WifiCredential.ssid == normalized_ssid,
            WifiCredential.id != credential.id,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail={"error": "conflict", "message": f"Wi-Fi SSID '{normalized_ssid}' already exists."},
        )

    credential.ssid = normalized_ssid
    credential.password = payload.password
    db.commit()
    db.refresh(credential)
    usage_count = db.query(DiyProject).filter(DiyProject.wifi_credential_id == credential.id).count()
    return _serialize_wifi_credential(credential, usage_count=usage_count)


@router.delete("/wifi-credentials/{credential_id}")
async def delete_wifi_credential(
    credential_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_account_admin_user),
):
    credential = _get_wifi_credential_in_household_or_404(db, current_user, credential_id)
    usage_count = db.query(DiyProject).filter(DiyProject.wifi_credential_id == credential.id).count()
    if usage_count:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "conflict",
                "message": f"Cannot delete Wi-Fi SSID '{credential.ssid}' because it is used by {usage_count} project(s).",
            },
        )

    db.delete(credential)
    db.commit()
    return {"status": "deleted", "id": credential_id}


@router.post("/wifi-credentials/{credential_id}/reveal", response_model=WifiCredentialSecretResponse)
async def reveal_wifi_credential_password(
    credential_id: int,
    payload: WifiCredentialRevealRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_account_admin_user),
):
    credential = _get_wifi_credential_in_household_or_404(db, current_user, credential_id)
    _require_current_user_password(
        current_user,
        payload.password if payload is not None else None,
        missing_action="viewing this Wi-Fi password",
        invalid_action="view this Wi-Fi password",
    )
    return {
        "id": credential.id,
        "ssid": credential.ssid,
        "password": credential.password,
    }


@router.post("/config", response_model=DeviceHandshakeResponse)
async def register_device_handshake(
    payload: DeviceRegister,
    db: Session = Depends(get_db)
):
    """
    HTTP handshake remains available only for legacy discovery paths.
    MQTT-managed DIY firmware must register over MQTT.
    """
    if payload.mode == DeviceMode.library:
        raise mqtt_only_error(
            "DIY firmware registration must be published to the MQTT register topic."
        )

    if payload.mode == DeviceMode.no_code:
        if not payload.mac_address or not payload.name:
            raise HTTPException(
                status_code=422,
                detail={"error": "validation", "message": "mac_address and name are required for no-code mode"}
            )

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

    _attach_room_name(result.device)
    response = DeviceHandshakeResponse.model_validate(result.device)
    response.secret_verified = result.secret_verified
    response.project_id = result.project_id
    return response

@router.post("/device/{device_id}/approve")
async def approve_device(
    device_id: str,
    payload: DeviceApprovalRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    device = _get_device_in_household_or_404(db, admin, device_id)
    room = _get_room_in_household_or_404(db, admin, payload.room_id)

    device.auth_status = AuthStatus.approved
    device.pairing_requested_at = None
    device.room_id = room.room_id
    owner = db.query(User).filter(User.user_id == device.owner_id).first()
    _sync_user_dashboard_widgets(owner or admin, device)

    db.commit()
    _broadcast_pairing_queue_updated(device, reason="approved")
    return {"status": "approved", "device_id": device_id}

@router.post("/device/{device_id}/reject")
async def reject_device(device_id: str, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    """
    Explicitly reject a pending device handshake so it does not appear in discovery.
    """
    device = _get_device_in_household_or_404(db, admin, device_id)

    device.auth_status = AuthStatus.rejected
    device.pairing_requested_at = None
    db.commit()
    mqtt_manager.publish_json(
        mqtt_manager.state_ack_topic(device_id),
        build_pairing_rejected_ack_payload(device),
        wait_for_publish=False,
    )
    _broadcast_pairing_queue_updated(device, reason="rejected")
    return {"status": "rejected"}

def _load_visible_devices(
    db: Session,
    current_user: User,
    requested_status: AuthStatus,
) -> list[Device]:
    query = db.query(Device).filter(Device.auth_status == requested_status)
    if requested_status == AuthStatus.pending:
        query = query.filter(Device.pairing_requested_at.isnot(None)).order_by(Device.pairing_requested_at.desc())
    household_id = resolve_household_id_for_user(db, current_user)
    household_member_ids = _get_household_member_ids(db, household_id)
    household_room_ids = _get_household_room_ids(db, household_id)

    household_filters = []
    if household_member_ids:
        household_filters.append(Device.owner_id.in_(household_member_ids))
    if household_room_ids:
        household_filters.append(Device.room_id.in_(household_room_ids))
    if household_filters:
        query = query.filter(or_(*household_filters))

    if not _is_room_admin(current_user):
        if requested_status != AuthStatus.approved:
            raise HTTPException(status_code=403, detail="Not authorized to view this device state")

        accessible_room_ids = _get_accessible_room_ids_for_user(db, current_user)
        if not accessible_room_ids:
            return []
        query = query.filter(Device.room_id.in_(accessible_room_ids))

    devices = query.all()

    _expire_stale_devices(db, devices)

    return [_attach_room_name(_attach_runtime_state(db, device)) for device in devices]


def _automation_device_scope_for_user(db: Session, current_user: User) -> dict[str, Device]:
    visible_devices = _load_visible_devices(db, current_user, AuthStatus.approved)
    return {device.device_id: device for device in visible_devices}


@router.get("/devices", response_model=List[Union[DeviceResponse, DeviceAvailabilityResponse]])
async def list_devices(
    auth_status: Optional[AuthStatus] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    requested_status = auth_status or AuthStatus.approved
    devices = _load_visible_devices(db, current_user, requested_status)
    if _is_room_admin(current_user):
        return devices
    return [_serialize_device_availability(device) for device in devices]


@router.get("/dashboard/devices", response_model=List[DeviceResponse])
async def list_dashboard_devices(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _load_visible_devices(db, current_user, AuthStatus.approved)

@router.get("/device/{device_id}", response_model=DeviceResponse)
async def get_device(device_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Get detailed information about a single device.
    """
    device = _get_device_or_404(db, device_id)
    _ensure_device_control_access(db, current_user, device)
    return _attach_room_name(_attach_runtime_state(db, device))


@router.put("/device/{device_id}/config")
async def update_device_config(
    device_id: str,
    config: dict,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user)
):
    """
    Update the pin configuration for a managed device and optionally trigger a rebuild.
    """
    device = _get_device_in_household_or_404(db, current_user, device_id)
    if not device.provisioning_project_id:
        raise HTTPException(status_code=400, detail="Not a managed DIY device")

    project = _get_project_in_household_or_404(db, current_user, device.provisioning_project_id)

    if not isinstance(project.config, dict):
        project.config = {}

    _require_current_user_password(
        current_user,
        config.get("password") if isinstance(config, dict) else None,
        missing_action="updating this board config",
        invalid_action="update this board config",
    )

    requested_pins = config.get("pins", []) if isinstance(config, dict) else []
    current_config = dict(project.config)
    current_config["pins"] = requested_pins
    wifi_credential = _resolve_wifi_credential_for_payload(
        db,
        current_user,
        requested_credential_id=config.get("wifi_credential_id") if isinstance(config, dict) else None,
        existing_credential_id=project.wifi_credential_id,
        config_payload=current_config,
        create_from_legacy=True,
        required=True,
        missing_message="Select a Wi-Fi credential before updating this board config.",
    )
    current_config = _stamp_wifi_credential_config(current_config, wifi_credential)

    validation_warnings = []
    try:
        _, validation_errors, validation_warnings = validate_diy_config(
            board_profile=project.board_profile,
            config=current_config
        )
        if validation_errors:
            raise Exception(" ".join(validation_errors))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    active_job = (
        db.query(BuildJob)
        .filter(
            BuildJob.project_id == project.id,
            BuildJob.status.in_(ACTIVE_BUILD_JOB_STATUSES),
        )
        .with_for_update()
        .order_by(BuildJob.created_at.desc())
        .first()
    )
    if active_job:
        raise HTTPException(
            status_code=409,
            detail={"error": "conflict", "message": "Another build or OTA job is already in progress for this device"},
        )

    try:
        targets = infer_firmware_network_targets(
            request.headers,
            request.url.scheme,
            _get_runtime_firmware_network_state(request),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": "validation", "message": str(exc)},
        )
    network_target_warning = describe_network_target_change(current_config, targets)
    if network_target_warning:
        validation_warnings.append(network_target_warning)
    staged_config = _stamp_project_network_targets(current_config, targets)

    # Trigger rebuild only after validation passes and no active job exists.
    job = BuildJob(
        id=str(uuid.uuid4()),
        project_id=project.id,
        status=JobStatus.queued,
        staged_project_config=staged_config,
    )
    db.add(job)
    project.pending_config = staged_config
    project.pending_build_job_id = job.id
    db.commit()
    db.refresh(job)

    background_tasks.add_task(
        build_firmware_task,
        job.id,
        validation_warnings,
        _background_session_factory(db),
    )

    return {
        "status": "success",
        "job_id": job.id,
        "message": "Staged config queued and build started. The current saved config stays active until the board reports the rebuilt firmware.",
    }

@router.delete("/device/{device_id}")
async def delete_device(device_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    """
    Unpair a device from the dashboard while preserving its identity so it can be paired again.
    """
    device = _get_device_in_household_or_404(db, current_user, device_id)

    owner = db.query(User).filter(User.user_id == device.owner_id).first()
    device.auth_status = AuthStatus.pending
    device.pairing_requested_at = None
    _remove_device_widgets(owner, device.device_id)
    db.commit()
    _broadcast_pairing_queue_updated(device, reason="unpaired")
    return {"status": "unpaired", "detail": f"Device {device_id} removed from the dashboard and is ready to pair again."}

@router.post("/device/{device_id}/command")
async def send_command(device_id: str, command: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Send a command to the device via MQTT and record the publish result.
    """
    device = _get_device_or_404(db, device_id)
    _ensure_device_control_access(db, current_user, device)

    # If this is an OTA command, mark the build job as flashing
    ota_job = None
    if command.get("action") == "ota" and command.get("job_id"):
        if not _is_room_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin or Owner privileges required for OTA")
        if not device.provisioning_project_id:
            raise HTTPException(status_code=400, detail="Device is not linked to a managed DIY project")
        ota_job = _get_build_job_in_household_or_404(db, current_user, command["job_id"])
        if ota_job.project_id != device.provisioning_project_id:
            raise HTTPException(status_code=400, detail="Build job does not belong to the target device")
        if ota_job.status not in {JobStatus.artifact_ready, JobStatus.flash_failed}:
            raise HTTPException(
                status_code=409,
                detail={"error": "conflict", "message": "Artifact is not ready for flashing"},
            )

        # Security: Inject artifact MD5 and server signature into the OTA command
        try:
            with open(ota_job.artifact_path, "rb") as f:
                firmware_bytes = f.read()
            firmware_md5 = hashlib.md5(firmware_bytes).hexdigest()
        except Exception:
            raise HTTPException(status_code=500, detail="Failed to read firmware artifact to generate signature.")

        secret_key = derive_project_secret(device.provisioning_project_id, device.device_id)
        signature_payload = (firmware_md5 + secret_key).encode("utf-8")
        signature = hashlib.md5(signature_payload).hexdigest()

        command["md5"] = firmware_md5
        command["signature"] = signature

        ota_job.status = JobStatus.flashing
        ota_job.error_message = None
        ota_job.finished_at = None
        db.commit()

    command_id = str(uuid.uuid4())
    command["command_id"] = command_id

    # Publish via MQTT
    success = mqtt_manager.publish_command(device_id, command)

    # If the OTA publish failed entirely, revert the job out of flashing
    if not success and ota_job and ota_job.status == JobStatus.flashing:
        ota_job.status = JobStatus.flash_failed
        ota_job.error_message = "Failed to publish firmware download command over MQTT."
        db.commit()

    if success:
        event_type = EventType.command_requested
    else:
        event_type = EventType.command_failed

    # Log command request/failure
    history = DeviceHistory(
        device_id=device_id,
        event_type=event_type,
        payload=str(command),
        changed_by=current_user.user_id
    )
    db.add(history)
    db.commit()

    if not success:
        return {"status": "failed", "message": "Failed to publish to MQTT broker"}

    if command.get("action") != "ota":
        mqtt_manager.pending_commands[command_id] = {
            "device_id": device_id,
            "pin": command.get("pin"),
            "value": command.get("value"),
            "brightness": command.get("brightness"),
            "timestamp": datetime.utcnow().timestamp(),
            "command_id": command_id
        }

        async def check_command_timeout():
            await asyncio.sleep(5)
            if command_id in mqtt_manager.pending_commands:
                cmd = mqtt_manager.pending_commands.pop(command_id, None)
                if cmd:
                    from app.database import SessionLocal
                    db_bg = SessionLocal()
                    try:
                        db_bg.add(
                            DeviceHistory(
                                device_id=device_id,
                                event_type=EventType.command_failed,
                                payload=json.dumps({"command_id": command_id, "reason": "timeout"}),
                                changed_by=current_user.user_id
                            )
                        )
                        db_bg.commit()
                    finally:
                        db_bg.close()
                    try:
                        ws_manager.broadcast_device_event_sync(
                            "command_delivery",
                            device_id,
                            None,
                            {
                                "command_id": command_id,
                                "status": "failed",
                                "reason": "timeout"
                            }
                        )
                    except Exception:
                        pass
        asyncio.create_task(check_command_timeout())

    return {"status": "pending", "command_id": command_id, "message": "Command requested"}

@router.get("/device/{device_id}/command/latest")
async def get_latest_command(device_id: str, db: Session = Depends(get_db)):
    """
    Get the most recent command sent to the device.
    """
    device = _get_device_or_404(db, device_id)
    if is_mqtt_managed_device(device):
        raise mqtt_only_error(
            "MQTT-managed DIY devices do not support HTTP command polling."
        )

    cmd = (
        db.query(DeviceHistory)
        .filter(
            DeviceHistory.device_id == device_id,
            DeviceHistory.event_type.in_(
                [EventType.command_requested, EventType.command_failed]
            ),
        )
        .order_by(DeviceHistory.timestamp.desc())
        .first()
    )

    if not cmd:
        return {"status": "none"}

    return {
        "status": "ok",
        "command_id": cmd.id,
        "payload": cmd.payload,
        "timestamp": cmd.timestamp
    }

# --- DIY Builder ---

@router.post("/diy/config/generate", response_model=GenerateConfigResponse)
async def generate_diy_config(
    request: GenerateConfigRequest,
    http_request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Generate device config JSON from board and pin mappings.
    """
    try:
        targets = infer_firmware_network_targets(
            http_request.headers,
            http_request.url.scheme,
            _get_runtime_firmware_network_state(http_request),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": "validation", "message": str(exc)},
        )

    wifi_credential = _resolve_wifi_credential_for_payload(
        db,
        current_user,
        requested_credential_id=request.wifi_credential_id,
        config_payload={
            "wifi_ssid": request.wifi_ssid,
            "wifi_password": request.wifi_password,
        },
        required=True,
        missing_message="Select a Wi-Fi credential before generating the device config.",
    )

    config = {
        "board": request.board,
        "wifi": {
            "ssid": wifi_credential.ssid,
            "password": wifi_credential.password,
        },
        "mqtt": {
            "broker": targets["mqtt_broker"],
            "port": int(targets["mqtt_port"]),
        },
        "network_targets": {
            "advertised_host": str(targets["advertised_host"]),
            "api_base_url": str(targets["api_base_url"]),
            "mqtt_broker": str(targets["mqtt_broker"]),
            "mqtt_port": int(targets["mqtt_port"]),
            "target_key": str(targets["target_key"]),
        },
        "pins": [
            {
                "gpio": p.gpio_pin,
                "mode": p.mode.value,
                "function": p.function,
                "label": p.label
            } for p in request.pins
        ]
    }
    return {"status": "success", "config": config}

@router.get("/diy/network-targets", response_model=FirmwareNetworkTargetsResponse)
async def get_diy_network_targets(
    request: Request,
    _current_user: User = Depends(get_admin_user),
):
    try:
        targets = infer_firmware_network_targets(
            request.headers,
            request.url.scheme,
            _get_runtime_firmware_network_state(request),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": "validation", "message": str(exc)},
        )

    audit = getattr(request.app.state, "firmware_network_audit", None)
    warning = None
    stale_project_count = 0
    stale_device_count = 0
    if isinstance(audit, dict):
        raw_warning = audit.get("warning")
        if isinstance(raw_warning, str) and raw_warning.strip():
            warning = raw_warning
        raw_project_count = audit.get("stale_project_count")
        raw_device_count = audit.get("stale_device_count")
        if raw_project_count is not None:
            stale_project_count = int(raw_project_count)
        if raw_device_count is not None:
            stale_device_count = int(raw_device_count)

    webapp_transport = resolve_webapp_transport(str(targets["api_base_url"]))
    metrics = collect_system_metrics()

    return FirmwareNetworkTargetsResponse(
        advertised_host=str(targets["advertised_host"]),
        api_base_url=str(targets["api_base_url"]),
        mqtt_broker=str(targets["mqtt_broker"]),
        mqtt_port=int(targets["mqtt_port"]),
        webapp_protocol=str(webapp_transport["webapp_protocol"]),
        webapp_port=int(webapp_transport["webapp_port"]),
        target_key=str(targets["target_key"]),
        warning=warning,
        stale_project_count=stale_project_count,
        stale_device_count=stale_device_count,
        cpu_percent=metrics["cpu_percent"],
        memory_used=metrics["memory_used"],
        memory_total=metrics["memory_total"],
        storage_used=metrics["storage_used"],
        storage_total=metrics["storage_total"],
    )

@router.get("/diy/i2c/libraries", response_model=List[I2CLibrary])
async def list_i2c_libraries(current_user: User = Depends(get_current_user)):
    """
    Get the catalog of supported Adafruit I2C libraries.
    """
    return get_i2c_catalog()

@router.post("/diy/projects", response_model=DiyProjectResponse)
async def create_diy_project(project: DiyProjectCreate, db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    if project.room_id is None:
        raise HTTPException(
            status_code=400,
            detail={"error": "validation", "message": "Select a room before creating a device project."},
        )

    room = _get_room_in_household_or_404(db, current_user, project.room_id)
    wifi_credential = _resolve_wifi_credential_for_payload(
        db,
        current_user,
        requested_credential_id=project.wifi_credential_id,
        config_payload=project.config,
        create_from_legacy=True,
        required=True,
        missing_message="Select a Wi-Fi credential before creating a device project.",
    )
    stamped_config = _stamp_wifi_credential_config(project.config, wifi_credential)
    new_project = DiyProject(
        id=str(uuid.uuid4()),
        user_id=current_user.user_id,
        room_id=room.room_id,
        wifi_credential_id=wifi_credential.id,
        name=project.name,
        board_profile=project.board_profile,
        config=stamped_config,
    )
    db.add(new_project)
    db.commit()
    db.refresh(new_project)
    return new_project

@router.get("/diy/projects", response_model=List[DiyProjectUsageResponse])
async def list_diy_projects(
    board_profile: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    household_id = resolve_household_id_for_user(db, current_user)
    household_member_ids = _get_household_member_ids(db, household_id)

    query = db.query(DiyProject)
    if current_user.account_type != AccountType.admin:
        if not household_member_ids:
            return []
        query = query.filter(DiyProject.user_id.in_(household_member_ids))

    projects = query.order_by(DiyProject.updated_at.desc(), DiyProject.created_at.desc()).all()
    if board_profile:
        try:
            expected_board = resolve_board_definition(board_profile)
            matched_projects = []
            for project in projects:
                try:
                    if resolve_board_definition(project.board_profile).canonical_id == expected_board.canonical_id:
                        matched_projects.append(project)
                except ValueError:
                    if project.board_profile == board_profile:
                        matched_projects.append(project)
            projects = matched_projects
        except ValueError:
            projects = [project for project in projects if project.board_profile == board_profile]

    if not projects:
        return []

    project_ids = [p.id for p in projects]
    devices = db.query(Device).filter(
        Device.provisioning_project_id.in_(project_ids),
        Device.auth_status == AuthStatus.approved
    ).all()
    devices = [_attach_room_name(d) for d in devices]

    device_map = {}
    for d in devices:
        proj_id = d.provisioning_project_id
        if proj_id not in device_map:
            device_map[proj_id] = []
        device_map[proj_id].append({
            "device_id": d.device_id,
            "name": d.name,
            "conn_status": d.conn_status,
            "auth_status": d.auth_status,
            "room_id": d.room_id,
            "room_name": getattr(d, "room_name", None)
        })

    response_data = []
    for p in projects:
        p_devices = device_map.get(p.id, [])
        usage_state = "in_use" if p_devices else "unused"
        # We can construct Pydantic models directly or let router validate dicts
        p_dict = {
            "id": p.id,
            "user_id": p.user_id,
            "room_id": p.room_id,
            "wifi_credential_id": p.wifi_credential_id,
            "name": p.name,
            "board_profile": p.board_profile,
            "config": p.config,
            "created_at": p.created_at,
            "updated_at": p.updated_at,
            "usage_state": usage_state,
            "devices": p_devices
        }
        response_data.append(p_dict)

    return response_data

@router.delete("/diy/projects/{project_id}")
async def delete_diy_project(
    project_id: str,
    delete_request: Optional[DiyProjectDeleteRequest] = Body(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    _require_current_user_password(
        current_user,
        delete_request.password if delete_request is not None else None,
        missing_action="deleting this board config",
        invalid_action="delete this board config",
    )

    project = _get_project_in_household_or_404(db, current_user, project_id)

    # Check if used by any approved device
    active_devices = db.query(Device).filter(
        Device.provisioning_project_id == project_id,
        Device.auth_status == AuthStatus.approved
    ).all()
    if active_devices:
        # Return 409 Conflict with machine-actionable error payload
        raise HTTPException(
            status_code=409,
            detail={
                "error": "conflict",
                "message": f"Cannot delete '{project.name}' because it is in use by {len(active_devices)} approved device(s)."
            }
        )

    # Unlink pending/rejected devices before deleting
    db.query(Device).filter(Device.provisioning_project_id == project_id).update(
        {Device.provisioning_project_id: None}, synchronize_session=False
    )
    db.commit()
    # Clean up serial sessions referencing build jobs from this project
    build_job_ids = [job.id for job in project.build_jobs]
    if build_job_ids:
        db.query(SerialSession).filter(SerialSession.build_job_id.in_(build_job_ids)).delete(synchronize_session=False)
        db.commit()

    try:
        db.delete(project)
        db.commit()
    except IntegrityError as e:
        db.rollback()
        # This catches things like SerialSession -> build_job constraint violation.
        raise HTTPException(
            status_code=409,
            detail={
                "error": "conflict",
                "message": "Cannot delete because its build artifact is locked by an active process."
            }
        )
    return {"status": "deleted", "id": project_id}

@router.get("/diy/projects/{project_id}", response_model=DiyProjectResponse)
async def get_diy_project(project_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    return _get_project_in_household_or_404(db, current_user, project_id)

@router.put("/diy/projects/{project_id}", response_model=DiyProjectResponse)
async def update_diy_project(project_id: str, project_update: DiyProjectCreate, db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    project = _get_project_in_household_or_404(db, current_user, project_id)
    if project_update.room_id is None:
        raise HTTPException(
            status_code=400,
            detail={"error": "validation", "message": "Select a room before saving the device project."},
        )
    room = _get_room_in_household_or_404(db, current_user, project_update.room_id)
    wifi_credential = _resolve_wifi_credential_for_payload(
        db,
        current_user,
        requested_credential_id=project_update.wifi_credential_id,
        existing_credential_id=project.wifi_credential_id,
        config_payload=project_update.config,
        create_from_legacy=True,
        required=True,
        missing_message="Select a Wi-Fi credential before saving the device project.",
    )
    project.name = project_update.name
    project.board_profile = project_update.board_profile
    project.room_id = room.room_id
    project.wifi_credential_id = wifi_credential.id
    project.config = _stamp_wifi_credential_config(project_update.config, wifi_credential)
    project.pending_config = None
    project.pending_build_job_id = None
    db.commit()
    db.refresh(project)
    return project

@router.post("/diy/build", response_model=BuildJobResponse)
async def trigger_diy_build(
    project_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    project = (
        db.query(DiyProject)
        .filter(DiyProject.id == project_id)
        .with_for_update()
        .first()
    )
    if not project:
         raise HTTPException(status_code=404, detail="Project not found")
    _get_project_in_household_or_404(db, current_user, project_id)
    if project.room_id is None:
         raise HTTPException(
             status_code=400,
             detail={"error": "validation", "message": "Select a room before triggering a server build."},
         )

    _, validation_errors, validation_warnings = validate_diy_config(project.board_profile, project.config)
    if validation_errors:
         raise HTTPException(status_code=400, detail={"error": "validation", "messages": validation_errors})

    active_job = (
        db.query(BuildJob)
        .filter(
            BuildJob.project_id == project.id,
            BuildJob.status.in_(ACTIVE_BUILD_JOB_STATUSES),
        )
        .with_for_update()
        .order_by(BuildJob.created_at.desc())
        .first()
    )
    if active_job:
        return active_job

    current_config = project.config if isinstance(project.config, dict) else {}
    try:
        targets = infer_firmware_network_targets(
            request.headers,
            request.url.scheme,
            _get_runtime_firmware_network_state(request),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": "validation", "message": str(exc)},
        )
    network_target_warning = describe_network_target_change(current_config, targets)
    if network_target_warning:
        validation_warnings.append(network_target_warning)
    project.config = _stamp_project_network_targets(current_config, targets)

    job_id = str(uuid.uuid4())
    job = BuildJob(
        id=job_id,
        project_id=project.id,
        status=JobStatus.queued
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(
        build_firmware_task,
        job_id,
        validation_warnings,
        _background_session_factory(db),
    )
    return job

@router.get("/diy/build/{job_id}", response_model=BuildJobResponse)
async def get_build_job(job_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    job = _get_build_job_in_household_or_404(db, current_user, job_id)

    # Inject an ephemeral OTA token upon successful access by owner
    job.ota_token = create_ota_token(job.id)
    job.expected_firmware_version = build_job_firmware_version(job.id)
    return job

@router.get("/diy/build/{job_id}/artifact")
async def get_build_artifact(job_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    job = _get_build_job_in_household_or_404(db, current_user, job_id)

    artifact_path = _resolve_build_artifact_path(job, "firmware")
    if job.status != JobStatus.artifact_ready or not artifact_path or not os.path.exists(artifact_path):
         raise HTTPException(status_code=400, detail="Artifact not ready or missing")

    return FileResponse(artifact_path, media_type='application/octet-stream', filename=f"firmware_{job_id}.bin")


@router.get("/diy/build/{job_id}/artifact/{artifact_name}")
async def get_build_artifact_part(
    job_id: str,
    artifact_name: Literal["firmware", "bootloader", "partitions"],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    job = _get_build_job_in_household_or_404(db, current_user, job_id)

    artifact_path = _resolve_build_artifact_path(job, artifact_name)
    if job.status != JobStatus.artifact_ready or not artifact_path or not os.path.exists(artifact_path):
        raise HTTPException(status_code=400, detail=f"{artifact_name} artifact not ready or missing")

    return FileResponse(
        artifact_path,
        media_type="application/octet-stream",
        filename=f"{artifact_name}_{job_id}.bin",
    )

@router.get("/diy/ota/download/{job_id}/firmware.bin")
async def get_ota_firmware(job_id: str, token: str, db: Session = Depends(get_db)):
    """
    Endpoint for DIY devices to download the firmware artifact over OTA.
    Requires a valid JWT token tied to the specific job_id to prevent unauthorized downloads.
    """
    verified_job_id = verify_ota_token(token)
    if not verified_job_id or verified_job_id != job_id:
        raise HTTPException(status_code=401, detail="Invalid or expired OTA token")

    job = db.query(BuildJob).filter(BuildJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    artifact_path = _resolve_build_artifact_path(job, "firmware")
    # Only allow download if the job is either artifact_ready or already flashing.
    allowed_statuses = [JobStatus.artifact_ready, JobStatus.flashing, JobStatus.flashed, JobStatus.flash_failed]
    if job.status not in allowed_statuses or not artifact_path or not os.path.exists(artifact_path):
        raise HTTPException(status_code=400, detail="Artifact not ready or missing")

    return FileResponse(
        artifact_path,
        media_type="application/octet-stream",
        filename=f"firmware_{job_id}.bin",
    )

@router.get("/diy/build/{job_id}/logs")
async def get_build_logs(job_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    job = _get_build_job_in_household_or_404(db, current_user, job_id)

    if not job.log_path or not os.path.exists(job.log_path):
         return {"logs": ""}

    with open(job.log_path, "r") as f:
         return {"logs": f.read()}


TERMINAL_JOB_STATUSES = {
    JobStatus.artifact_ready,
    JobStatus.flashed,
    JobStatus.build_failed,
    JobStatus.flash_failed,
    JobStatus.cancelled,
}

@router.get("/diy/build/{job_id}/logs/stream")
async def stream_build_logs(job_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    """
    Server-Sent Events endpoint that streams build log lines as they are written.
    Sends events of type 'log' with the new log text, and a final 'done' event
    when the job reaches a terminal state.
    """
    from fastapi.responses import StreamingResponse as _StreamingResponse
    from app.database import SessionLocal  # Import missing SessionLocal

    job = _get_build_job_in_household_or_404(db, current_user, job_id)

    # For already-terminal jobs with a log, stream the full log and close immediately.
    job_id_str = str(job.id)
    log_path_snapshot = job.log_path
    initial_status = job.status
    db.close()  # Release the session before entering the generator

    async def event_generator():
        poll_interval = 0.5  # seconds between log file tails

        # Wait up to 30 s for the log file to appear (queued -> building transition)
        waited = 0.0
        while not (log_path_snapshot and os.path.exists(log_path_snapshot)):
            if waited > 30.0:
                yield "event: done\ndata: timeout waiting for log file\n\n"
                return
            await asyncio.sleep(poll_interval)
            waited += poll_interval

            # Re-read job status to detect if it moved to a terminal state without log
            with SessionLocal() as _db:
                _job = _db.query(BuildJob).filter(BuildJob.id == job_id_str).first()
                if _job and _job.status in TERMINAL_JOB_STATUSES and not (
                    _job.log_path and os.path.exists(_job.log_path)
                ):
                    yield f"event: status\ndata: {_job.status.value}\n\n"
                    yield "event: done\ndata: terminal\n\n"
                    return

        position = 0
        try:
            with open(log_path_snapshot, "r", errors="replace") as log_file:
                while True:
                    log_file.seek(position)
                    chunk = log_file.read(8192)
                    if chunk:
                        position = log_file.tell()
                        # Escape SSE data: replace newlines within the chunk with \ndata: continuations
                        lines = chunk.splitlines()
                        for line in lines:
                            yield f"data: {line}\n"
                        yield "\n"

                    # Check terminal state
                    with SessionLocal() as _db:
                        _job = _db.query(BuildJob).filter(BuildJob.id == job_id_str).first()
                        current_status = _job.status if _job else None

                    if current_status in TERMINAL_JOB_STATUSES:
                        # Flush any remaining content
                        log_file.seek(position)
                        tail = log_file.read()
                        if tail:
                            for line in tail.splitlines():
                                yield f"data: {line}\n"
                            yield "\n"
                        yield f"event: status\ndata: {current_status.value}\n\n"
                        yield "event: done\ndata: terminal\n\n"
                        return

                    await asyncio.sleep(poll_interval)
        except Exception as exc:
            yield f"event: error\ndata: {str(exc)}\n\n"
            yield "event: done\ndata: error\n\n"

    return _StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )

@router.post("/serial/lock", response_model=SerialSessionResponse)
async def acquire_serial_lock(
    device_id: str = "generic",
    port: str = "default",
    job_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    active_lock = (
        db.query(SerialSession)
        .filter(SerialSession.port == port, SerialSession.status == SerialSessionStatus.locked)
        .order_by(SerialSession.created_at.desc())
        .first()
    )
    if active_lock and active_lock.locked_by_user_id != current_user.user_id:
        raise HTTPException(
            status_code=409,
            detail={"error": "conflict", "message": f"Serial port {port} is currently locked"},
        )

    build_job = None
    if job_id:
        build_job = _get_build_job_in_household_or_404(db, current_user, job_id)
        if build_job.status != JobStatus.artifact_ready:
            raise HTTPException(
                status_code=409,
                detail={"error": "conflict", "message": "Artifact is not ready for flashing"},
            )

    if active_lock and active_lock.locked_by_user_id == current_user.user_id:
        active_lock.device_id = device_id
        active_lock.build_job_id = build_job.id if build_job else None
        db.commit()
        db.refresh(active_lock)
        return active_lock

    serial_session = SerialSession(
        port=port,
        device_id=device_id,
        build_job_id=build_job.id if build_job else None,
        locked_by_user_id=current_user.user_id,
        status=SerialSessionStatus.locked,
    )
    db.add(serial_session)
    db.commit()
    db.refresh(serial_session)
    return serial_session

@router.post("/serial/unlock")
async def release_serial_lock(
    port: str = "default",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    active_lock = (
        db.query(SerialSession)
        .filter(SerialSession.port == port, SerialSession.status == SerialSessionStatus.locked)
        .order_by(SerialSession.created_at.desc())
        .first()
    )
    if not active_lock:
        return {"status": "unlocked", "port": port}

    if active_lock.locked_by_user_id != current_user.user_id and current_user.account_type != AccountType.admin:
        raise HTTPException(status_code=403, detail="Not authorized to unlock this port")

    active_lock.status = SerialSessionStatus.released
    active_lock.released_at = datetime.utcnow()
    db.commit()
    return {"status": "unlocked", "port": port}

@router.get("/serial/status")
async def get_serial_status(port: str = "default", db: Session = Depends(get_db), _admin: User = Depends(get_admin_user)):
    active_lock = (
        db.query(SerialSession)
        .filter(SerialSession.port == port, SerialSession.status == SerialSessionStatus.locked)
        .order_by(SerialSession.created_at.desc())
        .first()
    )
    return {
        "locked": active_lock is not None,
        "port": port,
        "device_id": active_lock.device_id if active_lock else None,
        "user_id": active_lock.locked_by_user_id if active_lock else None,
        "job_id": active_lock.build_job_id if active_lock else None,
    }

# --- System Logs / Stats ---

@router.get("/system/live-status", response_model=SystemStatusResponse)
async def get_system_status(
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    metrics = collect_system_metrics()
    timezone_context = _resolve_effective_timezone_payload(db, admin)
    effective_timezone = str(timezone_context["effective_timezone"])
    retention_cutoff = datetime.utcnow() - timedelta(days=SYSTEM_LOG_RETENTION_DAYS)
    alert_query = db.query(SystemLog).filter(
        SystemLog.occurred_at >= retention_cutoff,
        SystemLog.severity.in_(SYSTEM_LOG_ALERT_SEVERITIES),
        SystemLog.is_read.is_(False),
    )
    unread_alert_entries = (
        alert_query
        .order_by(SystemLog.occurred_at.desc(), SystemLog.id.desc())
        .all()
    )
    latest_alert = (
        unread_alert_entries[0]
        if unread_alert_entries
        else None
    )
    active_alert_count = len(unread_alert_entries)

    started_at = getattr(request.app.state, "server_started_at", None)
    uptime_seconds = 0
    if isinstance(started_at, datetime):
        uptime_seconds = max(0, int((datetime.utcnow() - started_at).total_seconds()))

    database_ready = getattr(request.app.state, "database_ready", True)
    database_status = "ok" if database_ready else "unavailable"
    mqtt_status = "connected" if mqtt_manager.connected else "disconnected"

    return SystemStatusResponse(
        overall_status=_calculate_system_overall_status(
            unread_alert_severities=[entry.severity for entry in unread_alert_entries],
        ),
        database_status=database_status,
        mqtt_status=mqtt_status,
        started_at=_coerce_utc_api_datetime(started_at) if isinstance(started_at, datetime) else None,
        uptime_seconds=uptime_seconds,
        advertised_host=_resolve_system_advertised_host(request),
        cpu_percent=float(metrics["cpu_percent"]),
        memory_used=int(metrics["memory_used"]),
        memory_total=int(metrics["memory_total"]),
        storage_used=int(metrics["storage_used"]),
        storage_total=int(metrics["storage_total"]),
        retention_days=SYSTEM_LOG_RETENTION_DAYS,
        active_alert_count=active_alert_count,
        effective_timezone=effective_timezone,
        timezone_source=str(timezone_context["timezone_source"]),
        current_server_time=get_current_server_time(effective_timezone),
        latest_alert_at=_coerce_utc_api_datetime(latest_alert.occurred_at) if latest_alert else None,
        latest_alert_message=latest_alert.message if latest_alert else None,
    )


@router.get("/system/time-context", response_model=AutomationScheduleContextResponse)
async def get_system_time_context(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    timezone_context = _resolve_effective_timezone_payload(db, current_user)
    return _serialize_time_context_response(timezone_context)


@router.get("/system/logs", response_model=SystemLogListResponse)
async def list_system_logs(
    limit: int = Query(500, ge=1, le=2000),
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    timezone_context = _resolve_effective_timezone_payload(db, admin)
    effective_timezone = str(timezone_context["effective_timezone"])
    retention_cutoff = datetime.utcnow() - timedelta(days=SYSTEM_LOG_RETENTION_DAYS)
    base_query = db.query(SystemLog).filter(SystemLog.occurred_at >= retention_cutoff)
    raw_entries = (
        base_query
        .order_by(SystemLog.occurred_at.desc(), SystemLog.id.desc())
        .limit(limit)
        .all()
    )
    entries = [_serialize_system_log_entry(entry) for entry in raw_entries]
    total = base_query.count()

    return SystemLogListResponse(
        entries=entries,
        total=total,
        retention_days=SYSTEM_LOG_RETENTION_DAYS,
        effective_timezone=effective_timezone,
        timezone_source=str(timezone_context["timezone_source"]),
        current_server_time=get_current_server_time(effective_timezone),
        oldest_occurred_at=entries[-1].occurred_at if entries else None,
        latest_occurred_at=entries[0].occurred_at if entries else None,
    )


@router.post("/system/logs/{log_id}/read", response_model=SystemLogAcknowledgeResponse)
async def mark_system_log_read(
    log_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    entry = db.query(SystemLog).filter(SystemLog.id == log_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="System log not found")

    updated_count = 0
    if not entry.is_read:
        entry.is_read = True
        entry.read_at = datetime.utcnow()
        entry.read_by_user_id = admin.user_id
        db.commit()
        updated_count = 1

    return SystemLogAcknowledgeResponse(updated_count=updated_count)


@router.post("/system/logs/mark-all-read", response_model=SystemLogAcknowledgeResponse)
async def mark_all_system_logs_read(
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    retention_cutoff = datetime.utcnow() - timedelta(days=SYSTEM_LOG_RETENTION_DAYS)
    unread_alert_entries = (
        db.query(SystemLog)
        .filter(
            SystemLog.occurred_at >= retention_cutoff,
            SystemLog.severity.in_(SYSTEM_LOG_ALERT_SEVERITIES),
            SystemLog.is_read.is_(False),
        )
        .all()
    )

    read_at = datetime.utcnow()
    for entry in unread_alert_entries:
        entry.is_read = True
        entry.read_at = read_at
        entry.read_by_user_id = admin.user_id

    if unread_alert_entries:
        db.commit()

    return SystemLogAcknowledgeResponse(updated_count=len(unread_alert_entries))


# --- Telemetry / History ---

@router.post("/device/{device_id}/history", response_model=DeviceHistoryResponse)
async def push_history(device_id: str, entry: DeviceHistoryCreate, db: Session = Depends(get_db)):
    """
    Device pushes state change or events.
    """
    device = db.query(Device).filter(Device.device_id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if is_mqtt_managed_device(device):
        raise mqtt_only_error(
            "MQTT-managed DIY devices must publish telemetry to the MQTT state topic."
        )

    # Update last seen
    device.last_seen = datetime.utcnow()

    history = DeviceHistory(
        device_id=device_id,
        event_type=entry.event_type,
        payload=entry.payload,
        # changed_by=None (since it's from device/automation)
    )
    db.add(history)
    decoded_payload = _decode_history_payload(entry.payload) if entry.event_type == EventType.state_change else None
    if decoded_payload is not None:
        try:
            process_state_event_for_automations(
                db,
                device_id=device_id,
                state_payload=decoded_payload,
                publish_command=mqtt_manager.publish_command,
                triggered_at=datetime.now(timezone.utc).replace(tzinfo=None),
            )
        except Exception:
            logger.exception("Automation graph evaluation failed for device history event %s", device_id)
    db.commit()
    db.refresh(history)
    return history

@router.get("/device/{device_id}/history", response_model=List[DeviceHistoryResponse])
async def get_history(device_id: str, db: Session = Depends(get_db), _admin: User = Depends(get_admin_user)):
    return db.query(DeviceHistory).filter(DeviceHistory.device_id == device_id).order_by(DeviceHistory.timestamp.desc()).limit(50).all()


@router.get("/device/{device_id}/export")
async def export_history_csv(device_id: str, db: Session = Depends(get_db), _admin: User = Depends(get_admin_user)):
    """
    Export device history as CSV.
    """
    import csv
    from io import StringIO
    from fastapi.responses import StreamingResponse

    history = db.query(DeviceHistory).filter(DeviceHistory.device_id == device_id).all()

    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(['Timestamp', 'Event Type', 'Payload', 'Changed By'])

    for h in history:
        writer.writerow([h.timestamp, h.event_type.value, h.payload, h.changed_by])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=device_{device_id}_history.csv"}
    )


# --- Automation ---

@router.get("/automation/schedule-context", response_model=AutomationScheduleContextResponse)
async def get_automation_schedule_context(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    household = _get_current_household_or_404(db, user)
    timezone_context = resolve_effective_timezone_context(household=household)
    return _serialize_time_context_response(timezone_context)


@router.post("/automation", response_model=AutomationResponse)
async def create_automation(auto: AutomationCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    new_auto = Automation(creator_id=user.user_id)
    device_scope = _automation_device_scope_for_user(db, user)
    household = _get_current_household_or_404(db, user)
    timezone_context = resolve_effective_timezone_context(household=household)
    _apply_automation_payload(
        new_auto,
        auto,
        device_scope=device_scope,
        effective_timezone=str(timezone_context["effective_timezone"]),
    )
    db.add(new_auto)
    db.commit()
    db.refresh(new_auto)
    return _automation_response_model(new_auto)

@router.get("/automations", response_model=List[AutomationResponse])
async def list_automations(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    automations = (
        db.query(Automation)
        .filter(Automation.creator_id == user.user_id)
        .order_by(Automation.id.asc())
        .all()
    )
    return [_automation_response_model(automation) for automation in automations]


@router.put("/automation/{automation_id}", response_model=AutomationResponse)
async def update_automation(
    automation_id: int,
    payload: AutomationUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    automation = _get_user_automation(db, automation_id, user)
    device_scope = _automation_device_scope_for_user(db, user)
    household = _get_current_household_or_404(db, user)
    timezone_context = resolve_effective_timezone_context(household=household)
    _apply_automation_payload(
        automation,
        payload,
        device_scope=device_scope,
        effective_timezone=str(timezone_context["effective_timezone"]),
    )
    db.commit()
    db.refresh(automation)
    return _automation_response_model(automation)


@router.delete("/automation/{automation_id}", response_model=dict)
async def delete_automation(
    automation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    automation = _get_user_automation(db, automation_id, user)
    db.delete(automation)
    db.commit()
    return {"message": "Automation deleted."}


@router.post("/automation/{automation_id}/trigger", response_model=TriggerResponse)
async def trigger_automation(automation_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """
    Manually trigger a saved automation graph against the latest persisted device state.
    """
    auto = _get_user_automation(db, automation_id, user)
    device_scope = _automation_device_scope_for_user(db, user)
    execution_log = trigger_automation_manually(
        db,
        automation=auto,
        publish_command=mqtt_manager.enqueue_command,
        device_scope=device_scope,
        triggered_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.commit()
    db.refresh(auto)
    db.refresh(execution_log)
    raw_status = execution_log.status.value if hasattr(execution_log.status, "value") else str(execution_log.status)
    success = raw_status == ExecutionStatus.success.value
    if success:
        msg = f"Automation '{auto.name}' executed successfully."
        response_status = ExecutionStatus.success
    else:
        msg = execution_log.error_message or f"Automation '{auto.name}' did not apply any action."
        response_status = ExecutionStatus.failed
    return TriggerResponse(
        status=response_status,
        message=msg,
        log=_automation_log_response_model(execution_log),
    )

# --- OTA (Simplified from previous) ---

@router.post("/ota/upload", response_model=FirmwareResponse)
async def upload_firmware(version: str, board: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    _raise_legacy_ota_disabled()

@router.get("/ota/latest/{board}", response_model=FirmwareResponse)
async def get_latest_firmware(board: str, db: Session = Depends(get_db)):
    _raise_legacy_ota_disabled()

@router.get("/ota/download/{filename}")
async def download_firmware(filename: str):
    _raise_legacy_ota_disabled()


# --- System & Backup ---

@router.get("/system/backup")
async def system_backup_endpoint(db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    """
    Full System Backup. Generates JSON snapshot and stores in BackupArchive (for a device? No, global system backup).
    The requirements mentioned "Full Backup & Restore" for the system, but the DB schema has `backup_archives` per device.
    Implementation: Global export returned to admin, but NOT stored in per-device table to avoid confusion.
    """
    # 1. Users
    users = db.query(User).all()
    # 2. Devices
    devices = db.query(Device).all()
    # 3. Automations
    automations = db.query(Automation).all()

    backup_data = {
        "timestamp": str(datetime.utcnow()),
        "users": [{"username": u.username, "layout": u.ui_layout} for u in users],
        "devices": [{"id": d.device_id, "name": d.name, "mac": d.mac_address} for d in devices],
        "automations": [{"name": a.name, "graph": serialize_automation(a)["graph"]} for a in automations]
    }
    return backup_data

@router.post("/device/{device_id}/backup")
async def create_device_backup(device_id: str, note: str, db: Session = Depends(get_db), _admin: User = Depends(get_admin_user)):
    """
    Create a backup snapshot for a specific device in `backup_archives`.
    """
    device = db.query(Device).filter(Device.device_id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    # Snapshot config
    config_snapshot = {
        "device_info": {
            "name": device.name,
            "mode": device.mode
        },
        "pins": [
            {
                "pin": p.gpio_pin,
                "mode": p.mode,
                "label": p.label
            } for p in device.pin_configurations
        ]
    }

    archive = BackupArchive(
        device_id=device_id,
        full_config_snapshot=config_snapshot,
        note=note
    )
    db.add(archive)
    db.commit()
    return {"status": "backup_created", "archive_id": archive.id}

@router.get("/device/{device_id}/restore/{archive_id}")
async def restore_device_backup(device_id: str, archive_id: int, db: Session = Depends(get_db), _admin: User = Depends(get_admin_user)):
    """
    Restore a device config from a backup archive.
    """
    archive = db.query(BackupArchive).filter(BackupArchive.id == archive_id, BackupArchive.device_id == device_id).first()
    if not archive:
        raise HTTPException(status_code=404, detail="Archive not found")

    device = db.query(Device).filter(Device.device_id == device_id).first()

    snapshot = archive.full_config_snapshot
    if "device_info" in snapshot:
        device.name = snapshot["device_info"].get("name", device.name)
        device.mode = snapshot["device_info"].get("mode", device.mode)

    # Restore pins logic can be added here if needed (delete old, add new from snapshot)

    db.commit()
    return {"status": "restored"}
