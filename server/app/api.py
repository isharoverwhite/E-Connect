# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, BackgroundTasks, Form, Query, Request, WebSocket, WebSocketDisconnect, Body
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload, sessionmaker
from sqlalchemy.exc import IntegrityError
from typing import List, Optional, Any, Callable, Literal, Union
import ast
import copy
import datetime as stdlib_datetime
import json
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
import asyncio
import hashlib
from urllib.parse import urlencode
from pathlib import Path

from .mqtt import (
    OTA_FLASHING_RECONCILIATION_TIMEOUT,
    _reconcile_ota_jobs,
    build_pairing_rejected_ack_payload,
    build_predicted_mqtt_state,
    load_latest_device_state_payload,
    mqtt_manager,
    sanitize_physical_device_state_payload,
)
from .runtime_timestamps import normalize_build_job_timestamp, normalize_utc_naive_timestamp
from .ws_manager import manager as ws_manager

from .models import (
    ApiKeyCreateRequest, ApiKeyCreateResponse, ApiKeyResponse,
    UserCreate, UserResponse, Token, TokenData, InitialServerRequest, RefreshTokenRequest,
    DeviceApprovalRequest, DeviceAvailabilityResponse, DeviceHandshakeResponse, DeviceRegister, DeviceResponse, PinConfigCreate,
    AutomationCreate, AutomationResponse, AutomationUpdate,
    DeviceHistoryCreate, DeviceHistoryResponse,
    SystemLogAcknowledgeResponse, SystemLogListResponse, SystemLogResponse, SystemStatusResponse,
    FirmwareTemplateStatusResponse,
    GeneralSettingsResponse, GeneralSettingsUpdate,
    FirmwareResponse, DeviceMode, AccountType, EventType,
    RoomAccessUpdate, RoomUpdate, RoomCreate, RoomResponse, GenerateConfigRequest, GenerateConfigResponse,
    FirmwareNetworkTargetsResponse,
    SetupResponse, HouseholdResponse, TriggerResponse, ExecutionStatus, AutomationLogResponse,
    AutomationScheduleContextResponse,
    DiyProjectCreate, DiyProjectDeleteRequest, DiyProjectResponse, BuildJobResponse, ConfigHistoryEntryResponse, JobStatus, SerialSessionResponse,
    ManagedUserResponse, DiyProjectUsageResponse, ProjectDeviceUsage,
    WifiCredentialCreate, WifiCredentialUpdate, WifiCredentialRevealRequest, WifiCredentialResponse, WifiCredentialSecretResponse,
    ConfigHistoryRenameRequest, ConfigHistoryDeleteRequest,
    InstalledExtensionResponse, ExternalDeviceCreate,
)
from .sql_models import (
    ApiKey, User, Device, Automation, DeviceHistory,
    Room, RoomPermission, BackupArchive, Household, HouseholdMembership, HouseholdRole,
    AuthStatus, ConnStatus, AutomationExecutionLog, DiyProject, DiyProjectConfig, BuildJob, SerialSession, SerialSessionStatus,
    SystemLog, SystemLogCategory as SqlSystemLogCategory, SystemLogSeverity as SqlSystemLogSeverity,
    WifiCredential, InstalledExtension, ExternalDevice,
)
from .database import (
    SessionLocal,
    get_db,
    is_config_history_deleted_payload,
    mark_config_history_deleted_payload,
    strip_internal_config_metadata,
)
from .auth import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    ACCESS_TOKEN_TYPE,
    ALGORITHM,
    API_KEY_PREFIX,
    REFRESH_TOKEN_EXPIRE_MINUTES,
    REFRESH_TOKEN_TYPE,
    SECRET_KEY,
    create_access_token,
    generate_api_key_credentials,
    is_api_key_token,
    parse_api_key_token,
    create_ota_token,
    create_refresh_token,
    get_password_hash,
    verify_api_key_secret,
    verify_ota_token,
    verify_password,
)
from .services.builder import (
    build_job_firmware_version,
    build_firmware_task,
    describe_network_target_change,
    get_firmware_template_status,
    get_durable_artifact_path,
    infer_firmware_network_targets,
    resolve_build_job_config_snapshot,
    resolve_webapp_transport,
    refresh_firmware_template_release,
    get_latest_firmware_revision,
)
from .services.device_registration import (
    build_pairing_queue_event_payload,
    build_pairing_request_event_payload,
    generate_detached_mac_address,
    is_mqtt_managed_device,
    mqtt_only_error,
    register_device_payload,
)
from .services.diy_validation import resolve_board_definition, validate_diy_config
from .services.user_management import resolve_household_id_for_user
from .services.provisioning import (
    build_project_firmware_identity,
    extract_project_secret_from_payload,
    stamp_project_secret,
    strip_project_secret_from_payload,
)
from .services.i2c_registry import I2CLibrary, get_i2c_catalog
from .services.extensions import (
    ExtensionManifestValidationError,
    get_manifest_device_schema,
    parse_extension_archive,
    persist_extension_archive,
    remove_extracted_extension_dir,
    validate_external_device_config,
)
from .services.extension_runtime_loader import (
    ExtensionRuntimeLoadError,
    clear_extension_runtime_cache,
    validate_extension_package_runtime,
)
from .services.external_runtime import (
    ExternalDeviceRuntimeError,
    ExternalDeviceRuntimeUnsupportedError,
    ExternalDeviceRuntimeValidationError,
    execute_external_device_command,
    probe_external_device_state,
    validate_external_device_command,
)
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
from .services.automation_devices import (
    attach_external_device_automation_metadata,
    build_external_device_state_payload,
    dispatch_external_device_automation_command,
    serialize_external_device_automation_pins,
)
from .services.command_ordering import command_ordering_manager

router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")
logger = logging.getLogger(__name__)
ACTIVE_BUILD_JOB_STATUSES = (
    JobStatus.queued,
    JobStatus.building,
    JobStatus.flashing,
)
DEFAULT_OTA_PUBLIC_SCHEME = "http"
DEFAULT_OTA_PUBLIC_PORT = 8000
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


def _attach_user_household_context(
    user: User,
    membership: Optional[HouseholdMembership],
    *,
    via_api_key: bool = False,
    api_key: Optional[ApiKey] = None,
) -> User:
    household_role = None
    household_id = None
    if membership is not None:
        household_id = membership.household_id
        if membership.role is not None:
            household_role = membership.role.value if hasattr(membership.role, "value") else str(membership.role)

    setattr(user, "current_household_id", household_id)
    setattr(user, "current_household_role", household_role)
    setattr(user, "authenticated_via_api_key", via_api_key)
    setattr(user, "current_api_key_id", api_key.key_id if api_key is not None else None)
    return user


def _serialize_api_key(api_key: ApiKey, *, plain_text_key: str | None = None) -> dict[str, Any]:
    payload = {
        "key_id": api_key.key_id,
        "label": api_key.label,
        "token_prefix": api_key.token_prefix,
        "created_at": _coerce_utc_api_datetime(api_key.created_at),
        "last_used_at": _coerce_utc_api_datetime(api_key.last_used_at),
        "revoked_at": _coerce_utc_api_datetime(api_key.revoked_at),
        "is_revoked": api_key.revoked_at is not None,
    }
    if plain_text_key is not None:
        payload["api_key"] = plain_text_key
    return payload


def _get_user_owned_api_key_or_404(db: Session, current_user: User, key_id: str) -> ApiKey:
    api_key = (
        db.query(ApiKey)
        .filter(ApiKey.key_id == key_id, ApiKey.user_id == current_user.user_id)
        .first()
    )
    if api_key is None:
        raise HTTPException(status_code=404, detail="API key not found")
    return api_key


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


def _utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


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


def _coerce_command_pin(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


def _build_mqtt_command_scope_key(device_id: str, command: dict[str, Any] | None) -> str | None:
    if not isinstance(command, dict):
        return None

    if str(command.get("kind") or "action").strip().lower() != "action":
        return None

    pin = _coerce_command_pin(command.get("pin"))
    if pin is None:
        return None

    return f"mqtt:{device_id}:pin:{pin}"


def _build_external_command_scope_key(device_id: str) -> str:
    return f"external:{device_id}"


def _drop_superseded_mqtt_command(
    db: Session,
    superseded_command_id: str | None,
) -> bool:
    if not superseded_command_id:
        return False

    command_ordering_manager.complete(superseded_command_id)
    pending_command = mqtt_manager.pending_commands.pop(superseded_command_id, None)
    if not isinstance(pending_command, dict):
        return False

    predicted_history_id = pending_command.get("predicted_state_history_id")
    if not isinstance(predicted_history_id, int):
        return False

    predicted_history = (
        db.query(DeviceHistory)
        .filter(
            DeviceHistory.id == predicted_history_id,
            DeviceHistory.event_type == EventType.state_change,
        )
        .first()
    )
    if predicted_history is None:
        return False

    db.delete(predicted_history)
    return True


def _persist_mqtt_command_artifacts_task(
    session_factory: sessionmaker,
    *,
    device_id: str,
    command: dict[str, Any],
    current_user_id: int,
    success: bool,
    predicted_state: dict[str, Any] | None,
) -> None:
    db = session_factory()
    try:
        event_type = EventType.command_requested if success else EventType.command_failed
        history = DeviceHistory(
            device_id=device_id,
            event_type=event_type,
            payload=str(command),
            changed_by=current_user_id,
        )
        db.add(history)

        predicted_history: DeviceHistory | None = None
        command_id = _trimmed_string(command.get("command_id")) if isinstance(command, dict) else None
        pending_command = mqtt_manager.pending_commands.get(command_id) if command_id else None
        if success and isinstance(predicted_state, dict) and pending_command is not None:
            predicted_history = DeviceHistory(
                device_id=device_id,
                event_type=EventType.state_change,
                payload=json.dumps(predicted_state),
                changed_by=current_user_id,
            )
            db.add(predicted_history)

        db.commit()

        if (
            predicted_history is not None
            and command_id is not None
            and command_id in mqtt_manager.pending_commands
        ):
            mqtt_manager.pending_commands[command_id]["predicted_state_history_id"] = predicted_history.id
    except Exception:
        db.rollback()
        logger.exception("Failed to persist MQTT command artifacts for device %s", device_id)
    finally:
        db.close()


def _get_runtime_firmware_network_state(request: Request) -> dict[str, object] | None:
    runtime_state = getattr(request.app.state, "firmware_network_state", None)
    return runtime_state if isinstance(runtime_state, dict) else None


def _stamp_project_network_targets(config: dict[str, Any], targets: dict[str, Any]) -> dict[str, Any]:
    stamped = dict(config)
    stamped["advertised_host"] = str(targets["advertised_host"])
    stamped["api_base_url"] = str(targets["api_base_url"])
    ota_api_base_url = _build_direct_ota_api_base_url(str(targets["advertised_host"]))
    if ota_api_base_url:
        stamped["ota_api_base_url"] = ota_api_base_url
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
    _latest_state_record, latest_state_payload = load_latest_device_state_payload(db, device.device_id)
    latest_state_payload = sanitize_physical_device_state_payload(
        latest_state_payload,
        device.pin_configurations,
    )
    pending_predicted_state = mqtt_manager.latest_pending_predicted_state(device.device_id)
    if pending_predicted_state is not None:
        latest_state_payload = sanitize_physical_device_state_payload(
            pending_predicted_state,
            device.pin_configurations,
        )
    setattr(device, "last_state", latest_state_payload)

    return device


def _build_job_reference_time(job: BuildJob, *, fallback: datetime) -> datetime:
    return normalize_build_job_timestamp(
        job.finished_at or job.updated_at or job.created_at,
        reference_time=fallback,
    )


def _device_has_recent_heartbeat(device: Device, *, reference_time: datetime) -> bool:
    if device.conn_status != ConnStatus.online or device.last_seen is None:
        return False
    return (
        reference_time - normalize_utc_naive_timestamp(device.last_seen, fallback=reference_time)
    ) <= DEVICE_HEARTBEAT_TIMEOUT


def _reconcile_stale_flashing_job(
    db: Session,
    job: BuildJob,
    *,
    reference_time: datetime,
    device: Device | None = None,
) -> bool:
    if job.status != JobStatus.flashing:
        return False

    bound_device = device
    if bound_device is None:
        bound_device = (
            db.query(Device)
            .filter(Device.provisioning_project_id == job.project_id)
            .first()
        )
    if bound_device is None:
        return False

    if _device_has_recent_heartbeat(bound_device, reference_time=reference_time):
        return False

    if (
        reference_time - _build_job_reference_time(job, fallback=reference_time)
    ) <= OTA_FLASHING_RECONCILIATION_TIMEOUT:
        return False

    last_seen = (
        normalize_utc_naive_timestamp(bound_device.last_seen, fallback=reference_time).isoformat()
        if bound_device.last_seen is not None
        else None
    )
    expected_version = build_job_firmware_version(job.id)
    job.status = JobStatus.flash_failed
    job.error_message = (
        f"OTA timeout/reconciliation: device went offline before reporting firmware '{expected_version}'."
        + (f" Last seen at {last_seen}." if last_seen else "")
    )
    job.finished_at = reference_time
    job.updated_at = reference_time
    logger.warning(
        "Marked OTA job %s as flash_failed after device %s stayed offline past the OTA timeout window.",
        job.id,
        bound_device.device_id,
    )
    return True


def _reconcile_stale_flashing_jobs(db: Session, *, reference_time: datetime) -> int:
    jobs = db.query(BuildJob).filter(BuildJob.status == JobStatus.flashing).all()
    if not jobs:
        return 0

    project_ids = {job.project_id for job in jobs}
    devices_by_project_id = {
        device.provisioning_project_id: device
        for device in db.query(Device)
        .filter(Device.provisioning_project_id.in_(project_ids))
        .all()
        if device.provisioning_project_id is not None
    }

    failed_count = 0
    for job in jobs:
        if _reconcile_stale_flashing_job(
            db,
            job,
            reference_time=reference_time,
            device=devices_by_project_id.get(job.project_id),
        ):
            failed_count += 1

    return failed_count


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
    reference_time = datetime.now(timezone.utc).replace(tzinfo=None)
    status_changed = False

    for device in devices:
        status_changed = _expire_device_if_stale(
            db,
            device,
            reference_time=reference_time,
        ) or status_changed

    ota_status_changed = _reconcile_stale_flashing_jobs(
        db,
        reference_time=reference_time,
    )

    if status_changed or ota_status_changed:
        db.commit()


def expire_stale_online_devices_once(
    *,
    session_factory: Optional[Callable[[], Session]] = None,
) -> int:
    db = (session_factory or SessionLocal)()
    try:
        devices = db.query(Device).filter(Device.conn_status == ConnStatus.online).all()

        reference_time = datetime.now(timezone.utc).replace(tzinfo=None)
        expired_count = 0

        for device in devices:
            if _expire_device_if_stale(db, device, reference_time=reference_time):
                expired_count += 1

        ota_failed_count = _reconcile_stale_flashing_jobs(
            db,
            reference_time=reference_time,
        )

        if expired_count or ota_failed_count:
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


def _resolve_build_artifact_path(job: BuildJob, artifact_name: Literal["firmware", "bootloader", "partitions", "boot_app0"]) -> Optional[str]:
    candidates: list[str] = []
    direct_path = _trimmed_string(job.artifact_path)
    if direct_path and artifact_name == "firmware":
        candidates.append(direct_path)

    try:
        candidates.append(get_durable_artifact_path(job.id, artifact_name))
    except ValueError:
        pass

    if direct_path:
        artifact_dir = os.path.dirname(direct_path)
        fallback_candidate = os.path.join(artifact_dir, f"{job.id}.{artifact_name}.bin")
        if fallback_candidate != direct_path:
            candidates.append(fallback_candidate)

    seen: set[str] = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        if os.path.exists(candidate):
            return candidate

    return None


def _trimmed_string(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_config_name(raw_value: Any, *, fallback_name: str) -> str:
    normalized = _trimmed_string(raw_value)
    if normalized:
        return normalized[:255]
    fallback = fallback_name.strip() or "Saved config"
    return fallback[:255]


def _normalize_staged_device_name(raw_value: Any, *, fallback_name: str) -> str:
    normalized = _trimmed_string(raw_value)
    if normalized:
        return normalized[:255]
    fallback = fallback_name.strip() or "E-Connect Node"
    return fallback[:255]


def _require_project_name(raw_value: Any, *, message: str) -> str:
    normalized = _trimmed_string(raw_value)
    if normalized:
        return normalized[:255]
    raise HTTPException(
        status_code=400,
        detail={"error": "validation", "message": message},
    )


def _build_direct_ota_api_base_url(advertised_host: str | None) -> Optional[str]:
    normalized_host = _trimmed_string(advertised_host)
    if not normalized_host:
        return None

    raw_scheme = os.getenv("FIRMWARE_OTA_PUBLIC_SCHEME", os.getenv("FIRMWARE_PUBLIC_SCHEME", DEFAULT_OTA_PUBLIC_SCHEME))
    scheme = raw_scheme.strip().lower() if isinstance(raw_scheme, str) else DEFAULT_OTA_PUBLIC_SCHEME
    if scheme not in {"http", "https"}:
        scheme = DEFAULT_OTA_PUBLIC_SCHEME

    raw_port = os.getenv("FIRMWARE_OTA_PUBLIC_PORT", os.getenv("MDNS_DISCOVERY_PORT", str(DEFAULT_OTA_PUBLIC_PORT)))
    try:
        port = int(str(raw_port).strip())
    except (TypeError, ValueError):
        port = DEFAULT_OTA_PUBLIC_PORT

    if ":" in normalized_host and not normalized_host.startswith("["):
        netloc = f"[{normalized_host}]:{port}"
    else:
        netloc = f"{normalized_host}:{port}"

    return f"{scheme}://{netloc}/api/v1"


def _public_config_payload(payload: Any) -> Optional[dict[str, Any]]:
    public_payload = strip_project_secret_from_payload(payload)
    if public_payload is None and isinstance(payload, dict):
        public_payload = dict(payload)
    sanitized_payload = strip_internal_config_metadata(public_payload)
    if sanitized_payload is None and isinstance(public_payload, dict):
        return dict(public_payload)
    return sanitized_payload


def _resolve_project_device_secret(project_id: str, *payloads: Any) -> str:
    for payload in payloads:
        persisted_secret = extract_project_secret_from_payload(payload)
        if persisted_secret:
            return persisted_secret

    _, derived_secret = build_project_firmware_identity(project_id)
    return derived_secret


def _build_job_response_model(
    job: BuildJob,
    *,
    ota_token: str | None = None,
    ota_download_url: str | None = None,
) -> BuildJobResponse:
    return BuildJobResponse(
        id=job.id,
        project_id=job.project_id,
        status=job.status,
        artifact_path=job.artifact_path,
        log_path=job.log_path,
        staged_project_config=_public_config_payload(job.staged_project_config),
        finished_at=job.finished_at,
        error_message=job.error_message,
        created_at=job.created_at,
        updated_at=job.updated_at,
        ota_token=ota_token,
        ota_download_url=ota_download_url,
        expected_firmware_version=build_job_firmware_version(job.id),
    )


def _resolve_project_bound_device_identity(
    project: DiyProject,
    *,
    fallback_device: Device | None = None,
) -> tuple[str, str]:
    if fallback_device is not None:
        return fallback_device.device_id, fallback_device.name

    payloads: list[dict[str, Any]] = []
    if isinstance(project.pending_config, dict):
        payloads.append(project.pending_config)
    if isinstance(project.config, dict):
        payloads.append(project.config)

    for payload in payloads:
        assigned_device_id = _trimmed_string(payload.get("assigned_device_id"))
        assigned_device_name = _trimmed_string(payload.get("assigned_device_name"))
        if assigned_device_id:
            return assigned_device_id, assigned_device_name or project.name

    resolved_device_id, _ = build_project_firmware_identity(
        project.id,
        _resolve_project_device_secret(project.id, project.pending_config, project.config),
    )
    return resolved_device_id, project.name


def _saved_config_public_payload(saved_config: DiyProjectConfig) -> dict[str, Any]:
    payload = _public_config_payload(saved_config.config) or {}
    stamped = dict(payload)
    stamped["config_id"] = saved_config.id
    stamped["config_name"] = saved_config.name
    stamped["assigned_device_id"] = saved_config.device_id
    stamped["board_profile"] = saved_config.board_profile
    if not _trimmed_string(stamped.get("assigned_device_name")):
        project_name = _trimmed_string(saved_config.project.name) if saved_config.project is not None else None
        stamped["assigned_device_name"] = project_name or saved_config.name
    if not _trimmed_string(stamped.get("saved_at")) and saved_config.created_at is not None:
        stamped["saved_at"] = saved_config.created_at.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return stamped


def _strip_legacy_build_pointer_keys(config_payload: dict[str, Any]) -> dict[str, Any]:
    normalized_payload = strip_internal_config_metadata(config_payload) or dict(config_payload)
    normalized_payload.pop("latest_build_job_id", None)
    normalized_payload.pop("latest_build_config_key", None)
    return normalized_payload


def _project_response_model(project: DiyProject) -> DiyProjectResponse:
    current_config_name = None
    if project.current_saved_config is not None:
        current_config_name = project.current_saved_config.name
    elif isinstance(project.config, dict):
        current_config_name = _trimmed_string(project.config.get("config_name"))

    return DiyProjectResponse(
        id=project.id,
        user_id=project.user_id,
        room_id=project.room_id,
        wifi_credential_id=project.wifi_credential_id,
        name=project.name,
        board_profile=project.board_profile,
        config_name=current_config_name,
        config=_public_config_payload(project.config),
        current_config_id=getattr(project, "current_config_id", None),
        pending_config=_public_config_payload(project.pending_config),
        pending_config_id=getattr(project, "pending_config_id", None),
        pending_build_job_id=project.pending_build_job_id,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


def _reconcile_project_pending_ota_state(
    db: Session,
    *,
    project: DiyProject,
    device: Device | None = None,
) -> bool:
    pending_job_id = _trimmed_string(project.pending_build_job_id)
    if pending_job_id is None:
        return False

    pending_job = (
        db.query(BuildJob)
        .filter(
            BuildJob.id == pending_job_id,
            BuildJob.project_id == project.id,
        )
        .first()
    )
    if pending_job is None or pending_job.status not in {JobStatus.flashing, JobStatus.flashed}:
        return False

    if device is None:
        device = (
            db.query(Device)
            .filter(Device.provisioning_project_id == project.id)
            .first()
        )

    reported_version = _trimmed_string(device.firmware_version if device is not None else None)
    if reported_version is None:
        return False

    previous_job_status = pending_job.status
    previous_pending_job_id = _trimmed_string(project.pending_build_job_id)
    previous_pending_config_id = _trimmed_string(getattr(project, "pending_config_id", None))

    _reconcile_ota_jobs(db, device, reported_version)
    db.flush()
    db.refresh(project)
    db.refresh(pending_job)

    return (
        pending_job.status != previous_job_status
        or _trimmed_string(project.pending_build_job_id) != previous_pending_job_id
        or _trimmed_string(getattr(project, "pending_config_id", None)) != previous_pending_config_id
    )


def _stamp_config_history_metadata(
    config: dict[str, Any],
    *,
    config_id: str,
    config_name: str,
    device_id: str,
    device_name: str,
    board_profile: str,
    saved_at: datetime,
) -> dict[str, Any]:
    stamped = dict(config)
    stamped["config_id"] = config_id
    stamped["config_name"] = config_name
    stamped["assigned_device_id"] = device_id
    stamped["assigned_device_name"] = device_name
    stamped["project_name"] = device_name
    stamped["board_profile"] = board_profile
    stamped["saved_at"] = saved_at.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return stamped


def _build_ota_download_url(api_base_url: str, job_id: str, token: str) -> str:
    normalized_base_url = api_base_url.strip().rstrip("/")
    query = urlencode({"token": token})
    return f"{normalized_base_url}/diy/ota/download/{job_id}/firmware.bin?{query}"


def _resolve_job_ota_download_url(job: BuildJob, token: str, request: Request | None = None) -> Optional[str]:
    snapshot = resolve_build_job_config_snapshot(job)
    ota_api_base_url = _trimmed_string(snapshot.get("ota_api_base_url") if isinstance(snapshot, dict) else None)
    if ota_api_base_url:
        return _build_ota_download_url(ota_api_base_url, job.id, token)

    advertised_host = _trimmed_string(snapshot.get("advertised_host") if isinstance(snapshot, dict) else None)
    if advertised_host:
        ota_api_base_url = _build_direct_ota_api_base_url(advertised_host)
        if ota_api_base_url:
            return _build_ota_download_url(ota_api_base_url, job.id, token)

    api_base_url = _trimmed_string(snapshot.get("api_base_url") if isinstance(snapshot, dict) else None)
    if api_base_url:
        return _build_ota_download_url(api_base_url, job.id, token)

    if request is None:
        return None

    advertised_host = _resolve_system_advertised_host(request)
    if advertised_host:
        ota_api_base_url = _build_direct_ota_api_base_url(advertised_host)
        if ota_api_base_url:
            return _build_ota_download_url(ota_api_base_url, job.id, token)

    try:
        targets = infer_firmware_network_targets(
            request.headers,
            request.url.scheme,
            _get_runtime_firmware_network_state(request),
        )
    except ValueError:
        return None

    return _build_ota_download_url(str(targets["api_base_url"]), job.id, token)


def _get_saved_config_for_project_device_or_404(
    db: Session,
    *,
    project: DiyProject,
    device_id: str,
    config_id: str,
) -> DiyProjectConfig:
    saved_config = (
        db.query(DiyProjectConfig)
        .filter(
            DiyProjectConfig.id == config_id,
            DiyProjectConfig.project_id == project.id,
            DiyProjectConfig.device_id == device_id,
            DiyProjectConfig.board_profile == project.board_profile,
        )
        .first()
    )
    if saved_config is None:
        raise HTTPException(status_code=404, detail="Config not found for this device")
    return saved_config


def _upsert_saved_config(
    db: Session,
    *,
    project: DiyProject,
    device_id: str,
    device_name: str,
    config_name: str,
    config_payload: dict[str, Any],
    existing_config: DiyProjectConfig | None = None,
    config_id: str | None = None,
    created_at: datetime | None = None,
    last_applied_at: datetime | None = None,
    update_in_place: bool = True,
) -> tuple[DiyProjectConfig, dict[str, Any]]:
    now = datetime.now(timezone.utc)
    target_id = existing_config.id if existing_config is not None else (config_id or str(uuid.uuid4()))
    normalized_payload = _strip_legacy_build_pointer_keys(config_payload)
    payload_device_name = _normalize_staged_device_name(
        normalized_payload.get("assigned_device_name"),
        fallback_name=device_name or _trimmed_string(normalized_payload.get("project_name")) or "E-Connect Node",
    )
    pending_saved_config = next(
        (
            item
            for item in db.new
            if isinstance(item, DiyProjectConfig) and getattr(item, "id", None) == target_id
        ),
        None,
    )
    if pending_saved_config is not None:
        existing_config = pending_saved_config
    stamped_payload = _stamp_config_history_metadata(
        normalized_payload,
        config_id=target_id,
        config_name=config_name,
        device_id=device_id,
        device_name=payload_device_name,
        board_profile=project.board_profile,
        saved_at=now,
    )

    saved_config = existing_config or db.query(DiyProjectConfig).filter(DiyProjectConfig.id == target_id).first()
    if saved_config is None:
        saved_config = DiyProjectConfig(
            id=target_id,
            project_id=project.id,
            device_id=device_id,
            board_profile=project.board_profile,
            name=config_name,
            config=stamped_payload,
            last_applied_at=last_applied_at,
        )
        if created_at is not None:
            saved_config.created_at = created_at
        db.add(saved_config)
    elif update_in_place:
        from sqlalchemy.orm.attributes import flag_modified
        saved_config.project_id = project.id
        saved_config.device_id = device_id
        saved_config.board_profile = project.board_profile
        saved_config.name = config_name
        saved_config.config = stamped_payload
        flag_modified(saved_config, "config")
        if last_applied_at is not None:
            saved_config.last_applied_at = last_applied_at

    return saved_config, stamped_payload


def _flush_new_saved_config_rows(db: Session, *saved_configs: DiyProjectConfig | None) -> None:
    # MariaDB enforces these foreign keys immediately, so new config-history rows
    # must exist before projects or build jobs point at them in the same transaction.
    if any(saved_config is not None and saved_config in db.new for saved_config in saved_configs):
        db.flush()


def _latest_builds_by_saved_config(db: Session, *, project_id: str) -> dict[str, BuildJob]:
    jobs = (
        db.query(BuildJob)
        .filter(BuildJob.project_id == project_id)
        .order_by(BuildJob.created_at.desc(), BuildJob.updated_at.desc(), BuildJob.id.desc())
        .all()
    )

    latest_jobs: dict[str, BuildJob] = {}
    for job in jobs:
        snapshot = resolve_build_job_config_snapshot(job)
        if is_config_history_deleted_payload(snapshot):
            continue
        resolved_config_id = _trimmed_string(getattr(job, "saved_config_id", None))
        if resolved_config_id is None:
            resolved_config_id = _trimmed_string(snapshot.get("config_id") if isinstance(snapshot, dict) else None)
        if resolved_config_id and resolved_config_id not in latest_jobs:
            latest_jobs[resolved_config_id] = job
    return latest_jobs


def _serialize_saved_config_entry(
    saved_config: DiyProjectConfig,
    *,
    project: DiyProject,
    latest_job: BuildJob | None = None,
) -> ConfigHistoryEntryResponse:
    payload = _saved_config_public_payload(saved_config)
    assigned_device_name = _trimmed_string(payload.get("assigned_device_name")) or saved_config.name
    assigned_device_id = _trimmed_string(payload.get("assigned_device_id")) or saved_config.device_id

    return ConfigHistoryEntryResponse(
        id=saved_config.id,
        project_id=saved_config.project_id,
        device_id=saved_config.device_id,
        board_profile=saved_config.board_profile,
        config_name=saved_config.name,
        assigned_device_id=assigned_device_id,
        assigned_device_name=assigned_device_name,
        created_at=saved_config.created_at,
        updated_at=saved_config.updated_at,
        last_applied_at=saved_config.last_applied_at,
        latest_build_job_id=latest_job.id if latest_job is not None else None,
        latest_build_status=latest_job.status if latest_job is not None else None,
        latest_build_finished_at=latest_job.finished_at if latest_job is not None else None,
        latest_build_error=latest_job.error_message if latest_job is not None else None,
        expected_firmware_version=build_job_firmware_version(latest_job.id) if latest_job is not None else None,
        is_pending=getattr(project, "pending_config_id", None) == saved_config.id,
        is_committed=getattr(project, "current_config_id", None) == saved_config.id,
        config=payload,
    )


def _ensure_project_current_saved_config(
    db: Session,
    *,
    project: DiyProject,
    fallback_device: Device | None = None,
    explicit_config_name: str | None = None,
) -> tuple[DiyProjectConfig, dict[str, Any]]:
    device_id, device_name = _resolve_project_bound_device_identity(project, fallback_device=fallback_device)
    existing_config = None
    if getattr(project, "current_config_id", None):
        existing_config = db.query(DiyProjectConfig).filter(DiyProjectConfig.id == project.current_config_id).first()

    base_payload = project.config if isinstance(project.config, dict) else {}
    config_name = _normalize_config_name(
        explicit_config_name or (base_payload.get("config_name") if isinstance(base_payload, dict) else None),
        fallback_name=device_name or project.name,
    )
    saved_config, stamped_payload = _upsert_saved_config(
        db,
        project=project,
        device_id=device_id,
        device_name=device_name,
        config_name=config_name,
        config_payload=base_payload,
        existing_config=existing_config,
        config_id=getattr(project, "current_config_id", None) or project.id,
    )
    _flush_new_saved_config_rows(db, saved_config)
    return saved_config, stamped_payload


def _materialize_saved_configs_for_project(
    db: Session,
    *,
    project: DiyProject,
    fallback_device: Device | None = None,
) -> bool:
    device_id, device_name = _resolve_project_bound_device_identity(project, fallback_device=fallback_device)
    changed = False

    if isinstance(project.config, dict):
        existing_current = None
        if getattr(project, "current_config_id", None):
            existing_current = db.query(DiyProjectConfig).filter(DiyProjectConfig.id == project.current_config_id).first()
        current_saved_config, current_payload = _upsert_saved_config(
            db,
            project=project,
            device_id=device_id,
            device_name=device_name,
            config_name=_normalize_config_name(project.config.get("config_name"), fallback_name=device_name),
            config_payload=dict(project.config),
            existing_config=existing_current,
            config_id=getattr(project, "current_config_id", None) or _trimmed_string(project.config.get("config_id")) or project.id,
            created_at=project.created_at,
        )
        _flush_new_saved_config_rows(db, current_saved_config)
        if getattr(project, "current_config_id", None) != current_saved_config.id:
            project.current_config_id = current_saved_config.id
            changed = True
        if project.config != current_payload:
            project.config = current_payload
            changed = True

    if isinstance(project.pending_config, dict):
        existing_pending = None
        if getattr(project, "pending_config_id", None):
            existing_pending = db.query(DiyProjectConfig).filter(DiyProjectConfig.id == project.pending_config_id).first()
        pending_saved_config, pending_payload = _upsert_saved_config(
            db,
            project=project,
            device_id=device_id,
            device_name=device_name,
            config_name=_normalize_config_name(project.pending_config.get("config_name"), fallback_name=device_name),
            config_payload=dict(project.pending_config),
            existing_config=existing_pending,
            config_id=(
                getattr(project, "pending_config_id", None)
                or _trimmed_string(project.pending_config.get("config_id"))
                or getattr(project, "pending_build_job_id", None)
                or str(uuid.uuid4())
            ),
            created_at=project.updated_at,
        )
        _flush_new_saved_config_rows(db, pending_saved_config)
        if getattr(project, "pending_config_id", None) != pending_saved_config.id:
            project.pending_config_id = pending_saved_config.id
            changed = True
        if project.pending_config != pending_payload:
            project.pending_config = pending_payload
            changed = True

    jobs = db.query(BuildJob).filter(BuildJob.project_id == project.id).all()
    for job in jobs:
        snapshot = resolve_build_job_config_snapshot(job)
        if not isinstance(snapshot, dict) or not snapshot:
            continue
        if is_config_history_deleted_payload(snapshot):
            if getattr(job, "saved_config_id", None) is not None:
                job.saved_config_id = None
                changed = True
            continue
        existing_config = None
        if getattr(job, "saved_config_id", None):
            existing_config = db.query(DiyProjectConfig).filter(DiyProjectConfig.id == job.saved_config_id).first()
        saved_config, _ = _upsert_saved_config(
            db,
            project=project,
            device_id=device_id,
            device_name=device_name,
            config_name=_normalize_config_name(snapshot.get("config_name"), fallback_name=device_name),
            config_payload=dict(snapshot),
            existing_config=existing_config,
            config_id=getattr(job, "saved_config_id", None) or _trimmed_string(snapshot.get("config_id")) or job.id,
            created_at=job.created_at,
            last_applied_at=job.finished_at if job.status == JobStatus.flashed else None,
        )
        _flush_new_saved_config_rows(db, saved_config)
        if getattr(job, "saved_config_id", None) != saved_config.id:
            job.saved_config_id = saved_config.id
            changed = True

    if changed:
        db.flush()
    return changed


def _rename_config_payload(payload: Any, *, config_name: str) -> tuple[Any, bool]:
    if isinstance(payload, dict):
        updated_payload = dict(payload)
        if updated_payload.get("config_name") == config_name:
            return payload, False
        updated_payload["config_name"] = config_name
        return updated_payload, True

    if isinstance(payload, str):
        try:
            decoded_payload = json.loads(payload)
        except json.JSONDecodeError:
            return payload, False
        if not isinstance(decoded_payload, dict):
            return payload, False
        if decoded_payload.get("config_name") == config_name:
            return payload, False
        decoded_payload["config_name"] = config_name
        return json.dumps(decoded_payload), True

    return payload, False


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
    device_scope: dict[str, Any] | None = None,
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


def _ensure_external_device_control_access(db: Session, current_user: User, device: ExternalDevice) -> None:
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


def _serialize_external_device_availability(device: ExternalDevice) -> dict[str, Any]:
    room_name = device.room.name if device.room is not None else None
    return {
        "device_id": device.device_id,
        "room_id": device.room_id,
        "room_name": room_name,
        "auth_status": device.auth_status,
        "conn_status": device.conn_status,
        "pairing_requested_at": None,
    }


def _serialize_external_device(device: ExternalDevice) -> dict[str, Any]:
    room_name = device.room.name if device.room is not None else None
    config = device.config if isinstance(device.config, dict) else {}
    extension_name = (
        device.installed_extension.name
        if device.installed_extension is not None
        else None
    )
    return {
        "device_id": device.device_id,
        "mac_address": "",
        "name": device.name,
        "mode": DeviceMode.library,
        "firmware_revision": None,
        "firmware_version": device.installed_extension.version if device.installed_extension is not None else None,
        "ip_address": config.get("ip_address"),
        "topic_pub": None,
        "topic_sub": None,
        "room_id": device.room_id,
        "room_name": room_name,
        "owner_id": device.owner_id,
        "auth_status": device.auth_status,
        "conn_status": device.conn_status,
        "last_seen": device.last_seen,
        "pairing_requested_at": None,
        "last_state": device.last_state,
        "provisioning_project_id": None,
        "board": None,
        "provider": device.provider,
        "extension_name": extension_name,
        "installed_extension_id": device.installed_extension_id,
        "device_schema_id": device.device_schema_id,
        "external_config": config,
        "schema_snapshot": device.schema_snapshot if isinstance(device.schema_snapshot, dict) else {},
        "is_external": True,
        "created_at": device.created_at,
        "updated_at": device.updated_at,
        "pin_configurations": serialize_external_device_automation_pins(device),
    }


def _serialize_extension_device_schema(schema: dict[str, Any]) -> dict[str, Any]:
    config_schema = schema.get("config_schema") if isinstance(schema.get("config_schema"), dict) else {}
    raw_fields = config_schema.get("fields") if isinstance(config_schema.get("fields"), list) else []
    config_fields = []
    for field in raw_fields:
        if not isinstance(field, dict):
            continue
        config_fields.append(
            {
                "key": str(field.get("key") or ""),
                "label": str(field.get("label") or ""),
                "type": str(field.get("type") or "string"),
                "required": bool(field.get("required", False)),
            }
        )

    display = schema.get("display") if isinstance(schema.get("display"), dict) else {}
    raw_capabilities = display.get("capabilities") if isinstance(display.get("capabilities"), list) else []
    capabilities = [
        str(capability).strip().lower()
        for capability in raw_capabilities
        if isinstance(capability, str) and capability.strip()
    ]
    raw_temperature_range = (
        display.get("temperature_range")
        if isinstance(display.get("temperature_range"), dict)
        else None
    )
    temperature_range = None
    if isinstance(raw_temperature_range, dict):
        min_kelvin = raw_temperature_range.get("min")
        max_kelvin = raw_temperature_range.get("max")
        if isinstance(min_kelvin, int) and isinstance(max_kelvin, int):
            temperature_range = {"min": min_kelvin, "max": max_kelvin}
    return {
        "schema_id": str(schema.get("schema_id") or ""),
        "name": str(schema.get("name") or ""),
        "default_name": str(schema.get("default_name") or schema.get("name") or ""),
        "description": schema.get("description"),
        "card_type": str(display.get("card_type") or "light"),
        "capabilities": capabilities,
        "temperature_range": temperature_range,
        "config_fields": config_fields,
    }


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

    return datetime.now(timezone.utc).replace(tzinfo=None)


def _persist_external_runtime_state(
    db: Session,
    device: ExternalDevice,
    *,
    state: dict[str, Any],
) -> None:
    _stage_external_runtime_state(device, state=state)
    db.add(device)
    db.commit()
    db.refresh(device)


def _stage_external_runtime_state(
    device: ExternalDevice,
    *,
    state: dict[str, Any],
) -> None:
    device.last_state = state
    device.last_seen = _coerce_runtime_reported_at(state.get("reported_at"))
    device.conn_status = ConnStatus.online


def _mark_external_device_offline(
    db: Session,
    device: ExternalDevice,
) -> None:
    _stage_external_device_offline(device)
    db.add(device)
    db.commit()
    db.refresh(device)


def _stage_external_device_offline(
    device: ExternalDevice,
) -> None:
    device.conn_status = ConnStatus.offline


def _canonicalize_external_runtime_state(value: Any) -> Any:
    if isinstance(value, dict):
        normalized: dict[str, Any] = {}
        for key in sorted(value):
            if key == "reported_at":
                continue
            normalized[key] = _canonicalize_external_runtime_state(value[key])
        return normalized

    if isinstance(value, list):
        return [_canonicalize_external_runtime_state(item) for item in value]

    return value


def _external_runtime_state_changed(
    previous_state: Any,
    next_state: Any,
) -> bool:
    return _canonicalize_external_runtime_state(previous_state) != _canonicalize_external_runtime_state(next_state)


def _build_automation_command_dispatcher(
    db: Session,
    *,
    physical_publish: Callable[[str, dict[str, Any]], bool],
    triggered_at: datetime | None = None,
) -> Callable[[str, dict[str, Any]], bool]:
    def dispatch(device_id: str, command: dict[str, Any]) -> bool:
        physical_device = db.query(Device).filter(Device.device_id == device_id).first()
        if physical_device is not None:
            return physical_publish(device_id, command)

        callback_time = triggered_at or datetime.now(timezone.utc).replace(tzinfo=None)

        def on_state_change(
            changed_device_id: str,
            current_payload: dict[str, Any],
            previous_payload: dict[str, Any] | None,
        ) -> None:
            process_state_event_for_automations(
                db,
                device_id=changed_device_id,
                state_payload=current_payload,
                previous_state_payload=previous_payload,
                publish_command=dispatch,
                triggered_at=callback_time,
            )

        return dispatch_external_device_automation_command(
            db,
            device_id=device_id,
            command=command,
            on_state_change=on_state_change,
        )

    return dispatch


def _execute_external_device_command_task(
    session_factory: sessionmaker,
    *,
    device_id: str,
    command: dict[str, Any],
) -> None:
    db = session_factory()
    command_id = str(command.get("command_id") or "")
    try:
        external_device = (
            db.query(ExternalDevice)
            .options(joinedload(ExternalDevice.installed_extension))
            .filter(ExternalDevice.device_id == device_id)
            .first()
        )
        if external_device is None:
            return

        if command_id and not command_ordering_manager.is_latest(command_id):
            return

        previous_state = external_device.last_state if isinstance(external_device.last_state, dict) else {}
        previous_payload = build_external_device_state_payload(external_device, state=previous_state)
        try:
            runtime_result = execute_external_device_command(external_device, command)
        except ExternalDeviceRuntimeValidationError as exc:
            if command_id and not command_ordering_manager.is_latest(command_id):
                return
            try:
                ws_manager.broadcast_device_event_sync(
                    "command_delivery",
                    external_device.device_id,
                    external_device.room_id,
                    {
                        "command_id": command_id,
                        "status": "failed",
                        "reason": str(exc),
                    },
                )
            except Exception:
                pass
            return
        except ExternalDeviceRuntimeUnsupportedError as exc:
            if command_id and not command_ordering_manager.is_latest(command_id):
                return
            try:
                ws_manager.broadcast_device_event_sync(
                    "command_delivery",
                    external_device.device_id,
                    external_device.room_id,
                    {
                        "command_id": command_id,
                        "status": "failed",
                        "reason": str(exc),
                    },
                )
            except Exception:
                pass
            return
        except ExternalDeviceRuntimeError as exc:
            if command_id and not command_ordering_manager.is_latest(command_id):
                return
            if exc.mark_offline:
                _mark_external_device_offline(db, external_device)
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

            try:
                ws_manager.broadcast_device_event_sync(
                    "command_delivery",
                    external_device.device_id,
                    external_device.room_id,
                    {
                        "command_id": command_id,
                        "status": "failed",
                        "reason": str(exc),
                    },
                )
            except Exception:
                pass
            return

        runtime_state = runtime_result.state if isinstance(runtime_result.state, dict) else {}
        if command_id and not command_ordering_manager.is_latest(command_id):
            return
        state_changed = _external_runtime_state_changed(previous_state, runtime_state)
        _persist_external_runtime_state(db, external_device, state=runtime_state)
        current_payload = build_external_device_state_payload(external_device, state=runtime_state)

        try:
            ws_manager.broadcast_device_event_sync(
                "device_state",
                external_device.device_id,
                external_device.room_id,
                runtime_state,
            )
            ws_manager.broadcast_device_event_sync(
                "command_delivery",
                external_device.device_id,
                external_device.room_id,
                {
                    "command_id": command_id,
                    "status": "acknowledged",
                },
            )
        except Exception:
            pass

        if state_changed:
            try:
                process_state_event_for_automations(
                    db,
                    device_id=external_device.device_id,
                    state_payload=current_payload,
                    previous_state_payload=previous_payload,
                    publish_command=_build_automation_command_dispatcher(
                        db,
                        physical_publish=mqtt_manager.publish_command,
                    ),
                    triggered_at=datetime.now(timezone.utc).replace(tzinfo=None),
                )
                db.commit()
            except Exception:
                logger.exception(
                    "Automation graph evaluation failed for external device command state %s",
                    external_device.device_id,
                )
    finally:
        if command_id:
            command_ordering_manager.complete(command_id)
        db.close()


def refresh_external_device_states_once(
    *,
    session_factory: Optional[Callable[[], Session]] = None,
) -> dict[str, int]:
    db = (session_factory or SessionLocal)()
    try:
        external_devices = (
            db.query(ExternalDevice)
            .options(joinedload(ExternalDevice.installed_extension))
            .filter(ExternalDevice.auth_status == AuthStatus.approved)
            .all()
        )
        stats = {"probed": 0, "online": 0, "offline": 0, "changed": 0}
        if not external_devices:
            return stats

        for external_device in external_devices:
            stats["probed"] += 1
            previous_status = external_device.conn_status
            previous_state = external_device.last_state if isinstance(external_device.last_state, dict) else {}
            previous_payload = build_external_device_state_payload(external_device, state=previous_state)

            try:
                runtime_result = probe_external_device_state(external_device)
            except ExternalDeviceRuntimeValidationError as exc:
                logger.debug(
                    "Skipping external-device poll for %s because the runtime config is invalid: %s",
                    external_device.device_id,
                    exc,
                )
                continue
            except ExternalDeviceRuntimeUnsupportedError:
                continue
            except ExternalDeviceRuntimeError as exc:
                if not exc.mark_offline:
                    continue
                if external_device.conn_status != ConnStatus.offline:
                    _mark_external_device_offline(db, external_device)
                    stats["offline"] += 1
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
                continue

            runtime_state = runtime_result.state if isinstance(runtime_result.state, dict) else {}
            if not runtime_state:
                continue

            state_changed = _external_runtime_state_changed(previous_state, runtime_state)
            _persist_external_runtime_state(db, external_device, state=runtime_state)
            current_payload = build_external_device_state_payload(external_device, state=runtime_state)

            if previous_status != ConnStatus.online:
                stats["online"] += 1
                try:
                    ws_manager.broadcast_device_event_sync(
                        "device_online",
                        external_device.device_id,
                        external_device.room_id,
                        runtime_state,
                    )
                except Exception:
                    pass

            if previous_status != ConnStatus.online or state_changed:
                if state_changed:
                    stats["changed"] += 1
                try:
                    ws_manager.broadcast_device_event_sync(
                        "device_state",
                        external_device.device_id,
                        external_device.room_id,
                        runtime_state,
                    )
                except Exception:
                    pass

            if state_changed:
                try:
                    process_state_event_for_automations(
                        db,
                        device_id=external_device.device_id,
                        state_payload=current_payload,
                        previous_state_payload=previous_payload,
                        publish_command=_build_automation_command_dispatcher(
                            db,
                            physical_publish=mqtt_manager.publish_command,
                        ),
                        triggered_at=datetime.now(timezone.utc).replace(tzinfo=None),
                    )
                    db.commit()
                except Exception:
                    logger.exception(
                        "Automation graph evaluation failed for external device poll state %s",
                        external_device.device_id,
                    )

        return stats
    finally:
        db.close()


def _serialize_installed_extension(
    extension: InstalledExtension,
    *,
    external_device_count: int = 0,
) -> dict[str, Any]:
    manifest = extension.manifest if isinstance(extension.manifest, dict) else {}
    device_schemas = manifest.get("device_schemas") if isinstance(manifest.get("device_schemas"), list) else []
    return {
        "extension_id": extension.extension_id,
        "manifest_version": extension.manifest_version,
        "name": extension.name,
        "version": extension.version,
        "author": extension.author,
        "description": extension.description,
        "provider_key": extension.provider_key,
        "provider_name": extension.provider_name,
        "package_runtime": extension.package_runtime,
        "package_entrypoint": extension.package_entrypoint,
        "package_root": extension.package_root,
        "archive_sha256": extension.archive_sha256,
        "manifest": manifest,
        "device_schemas": [
            _serialize_extension_device_schema(schema)
            for schema in device_schemas
            if isinstance(schema, dict)
        ],
        "external_device_count": external_device_count,
        "installed_at": extension.installed_at,
        "updated_at": extension.updated_at,
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
    credential: Optional[WifiCredential],
) -> dict[str, Any]:
    stamped = dict(config_payload or {})
    if credential is None:
        stamped["wifi_credential_id"] = None
        stamped.pop("wifi_ssid", None)
        stamped.pop("wifi_password", None)
        return stamped
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
def _authenticate_api_key_user(token: str, db: Session) -> User:
    credentials_exception = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": f'Bearer realm="api", error="invalid_token", error_description="invalid {API_KEY_PREFIX} token"'},
    )

    parsed = parse_api_key_token(token)
    if parsed is None:
        raise credentials_exception

    public_id, secret = parsed
    api_key = (
        db.query(ApiKey)
        .options(joinedload(ApiKey.user))
        .filter(ApiKey.key_id == public_id)
        .first()
    )
    if api_key is None or api_key.user is None or api_key.revoked_at is not None:
        raise credentials_exception
    if not verify_api_key_secret(secret, api_key.secret_hash):
        raise credentials_exception

    membership = _get_primary_membership(db, api_key.user)
    api_key.last_used_at = _utcnow_naive()
    db.add(api_key)
    db.commit()
    db.refresh(api_key)

    return _attach_user_household_context(api_key.user, membership, via_api_key=True, api_key=api_key)


async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    from jose import jwt, JWTError
    credentials_exception = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if is_api_key_token(token):
        return _authenticate_api_key_user(token, db)

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

    membership = None
    if token_data.household_id is not None:
        membership = (
            db.query(HouseholdMembership)
            .filter(
                HouseholdMembership.user_id == user.user_id,
                HouseholdMembership.household_id == token_data.household_id,
            )
            .first()
        )
    if membership is None:
        membership = _get_primary_membership(db, user)

    return _attach_user_household_context(user, membership)

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

    connected = await ws_manager.connect(websocket, user.user_id, acc_type_val, accessible_room_ids)
    if not connected:
        return

    try:
        while True:
            # We don't expect much client->server WS text, but we need to keep the loop
            # alive and wait for disconnects
            data = await websocket.receive_text()
            if data == "ping":
                try:
                    await websocket.send_text("pong")
                except RuntimeError:
                    break
    except WebSocketDisconnect:
        pass
    except RuntimeError:
        pass
    finally:
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


@router.get("/api-keys", response_model=List[ApiKeyResponse])
async def list_api_keys(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    api_keys = (
        db.query(ApiKey)
        .filter(ApiKey.user_id == current_user.user_id)
        .order_by(ApiKey.created_at.desc(), ApiKey.key_id.desc())
        .all()
    )
    return [_serialize_api_key(api_key) for api_key in api_keys]


@router.post("/api-keys", response_model=ApiKeyCreateResponse)
async def create_api_key(
    payload: ApiKeyCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    label = payload.label.strip()
    if not label:
        raise HTTPException(
            status_code=400,
            detail={"error": "validation", "message": "API key label is required."},
        )

    public_id, raw_api_key, token_prefix, secret_hash = generate_api_key_credentials()
    api_key = ApiKey(
        key_id=public_id,
        user_id=current_user.user_id,
        label=label,
        token_prefix=token_prefix,
        secret_hash=secret_hash,
    )
    db.add(api_key)
    db.commit()
    db.refresh(api_key)
    return _serialize_api_key(api_key, plain_text_key=raw_api_key)


@router.post("/api-keys/{key_id}/revoke", response_model=ApiKeyResponse)
async def revoke_api_key(
    key_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    api_key = _get_user_owned_api_key_or_404(db, current_user, key_id)
    if api_key.revoked_at is None:
        api_key.revoked_at = _utcnow_naive()
        db.add(api_key)
        db.commit()
        db.refresh(api_key)
    return _serialize_api_key(api_key)


@router.put("/users/me/layout", response_model=UserResponse)
async def update_layout(layout: dict[str, Any] = Body(...), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Update User's Dashboard Grid Layout.
    """
    from sqlalchemy.orm.attributes import flag_modified
    current_user.ui_layout = layout
    flag_modified(current_user, "ui_layout")
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


@router.get("/extensions", response_model=List[InstalledExtensionResponse])
async def list_installed_extensions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_account_admin_user),
):
    _get_current_household_or_404(db, current_user)
    extensions = (
        db.query(InstalledExtension)
        .order_by(InstalledExtension.name.asc(), InstalledExtension.version.desc())
        .all()
    )
    if not extensions:
        return []

    extension_ids = [extension.extension_id for extension in extensions]
    counts = {
        extension_id: count
        for extension_id, count in (
            db.query(
                ExternalDevice.installed_extension_id,
                func.count(ExternalDevice.device_id),
            )
            .filter(ExternalDevice.installed_extension_id.in_(extension_ids))
            .group_by(ExternalDevice.installed_extension_id)
            .all()
        )
    }
    return [
        _serialize_installed_extension(
            extension,
            external_device_count=int(counts.get(extension.extension_id, 0)),
        )
        for extension in extensions
    ]


@router.get("/extensions/{extension_id}", response_model=InstalledExtensionResponse)
async def get_installed_extension(
    extension_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_account_admin_user),
):
    _get_current_household_or_404(db, current_user)
    extension = (
        db.query(InstalledExtension)
        .filter(InstalledExtension.extension_id == extension_id)
        .first()
    )
    if extension is None:
        raise HTTPException(status_code=404, detail="Extension not found")

    external_device_count = (
        db.query(func.count(ExternalDevice.device_id))
        .filter(ExternalDevice.installed_extension_id == extension.extension_id)
        .scalar()
    ) or 0
    return _serialize_installed_extension(
        extension,
        external_device_count=int(external_device_count),
    )


@router.delete("/extensions/{extension_id}")
async def delete_installed_extension(
    extension_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_account_admin_user),
):
    _get_current_household_or_404(db, current_user)
    extension = (
        db.query(InstalledExtension)
        .filter(InstalledExtension.extension_id == extension_id)
        .first()
    )
    if extension is None:
        raise HTTPException(status_code=404, detail="Extension not found")

    external_device_count = (
        db.query(func.count(ExternalDevice.device_id))
        .filter(ExternalDevice.installed_extension_id == extension.extension_id)
        .scalar()
    ) or 0
    if external_device_count:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "conflict",
                "message": (
                    f"Cannot delete extension '{extension.name}' because it is used by "
                    f"{int(external_device_count)} external device(s)."
                ),
            },
        )

    archive_path_value = str(extension.archive_path or "").strip()
    archive_path = Path(archive_path_value) if archive_path_value else None
    version = str(extension.version or "").strip()
    archive_sha256 = str(extension.archive_sha256 or "").strip()

    db.delete(extension)
    db.commit()

    if version and archive_sha256:
        remove_extracted_extension_dir(
            extension_id=extension_id,
            version=version,
            archive_sha256=archive_sha256,
        )
    if archive_path is not None:
        archive_path.unlink(missing_ok=True)
    clear_extension_runtime_cache()

    return {"status": "deleted", "extension_id": extension_id}


@router.post("/extensions/upload", response_model=InstalledExtensionResponse)
async def upload_extension_zip(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_account_admin_user),
):
    _get_current_household_or_404(db, current_user)

    archive_bytes = await file.read()
    try:
        normalized_manifest, archive_metadata = parse_extension_archive(archive_bytes)
    except ExtensionManifestValidationError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": "validation", "message": str(exc)},
        ) from exc

    archive_path = persist_extension_archive(
        archive_bytes=archive_bytes,
        extension_id=normalized_manifest["extension_id"],
        version=normalized_manifest["version"],
        archive_sha256=archive_metadata["archive_sha256"],
    )
    try:
        validate_extension_package_runtime(
            extension_id=normalized_manifest["extension_id"],
            version=normalized_manifest["version"],
            archive_sha256=archive_metadata["archive_sha256"],
            archive_path=archive_path,
            package_root=archive_metadata.get("package_root"),
            manifest=normalized_manifest,
        )
    except ExtensionRuntimeLoadError as exc:
        archive_path.unlink(missing_ok=True)
        remove_extracted_extension_dir(
            extension_id=normalized_manifest["extension_id"],
            version=normalized_manifest["version"],
            archive_sha256=archive_metadata["archive_sha256"],
        )
        raise HTTPException(
            status_code=400,
            detail={"error": "validation", "message": str(exc)},
        ) from exc

    extension = (
        db.query(InstalledExtension)
        .filter(InstalledExtension.extension_id == normalized_manifest["extension_id"])
        .first()
    )
    if extension is None:
        extension = InstalledExtension(extension_id=normalized_manifest["extension_id"])
        db.add(extension)

    extension.manifest_version = normalized_manifest["manifest_version"]
    extension.name = normalized_manifest["name"]
    extension.version = normalized_manifest["version"]
    extension.author = normalized_manifest.get("author")
    extension.description = normalized_manifest["description"]
    extension.provider_key = normalized_manifest["provider"]["key"]
    extension.provider_name = normalized_manifest["provider"]["display_name"]
    extension.package_runtime = normalized_manifest["package"]["runtime"]
    extension.package_entrypoint = normalized_manifest["package"]["entrypoint"]
    extension.package_root = archive_metadata.get("package_root")
    extension.archive_path = str(archive_path)
    extension.archive_sha256 = archive_metadata["archive_sha256"]
    extension.manifest = normalized_manifest
    db.commit()
    db.refresh(extension)

    external_device_count = (
        db.query(func.count(ExternalDevice.device_id))
        .filter(ExternalDevice.installed_extension_id == extension.extension_id)
        .scalar()
    ) or 0
    return _serialize_installed_extension(
        extension,
        external_device_count=int(external_device_count),
    )


@router.get("/external-devices", response_model=List[DeviceResponse])
async def list_external_devices(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_account_admin_user),
):
    external_devices = _load_visible_external_devices(db, current_user, AuthStatus.approved)
    return [_serialize_external_device(device) for device in external_devices]


@router.post("/external-devices", response_model=DeviceResponse)
async def create_external_device(
    payload: ExternalDeviceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_account_admin_user),
):
    household = _get_current_household_or_404(db, current_user)
    extension = (
        db.query(InstalledExtension)
        .filter(InstalledExtension.extension_id == payload.installed_extension_id.strip())
        .first()
    )
    if extension is None:
        raise HTTPException(status_code=404, detail="Installed extension not found")

    manifest = extension.manifest if isinstance(extension.manifest, dict) else {}
    try:
        schema = get_manifest_device_schema(manifest, payload.device_schema_id.strip())
        normalized_config = validate_external_device_config(schema, payload.config)
    except ExtensionManifestValidationError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": "validation", "message": str(exc)},
        ) from exc

    room_id = payload.room_id
    if room_id is not None:
        room = _get_room_in_household_or_404(db, current_user, room_id)
        room_id = room.room_id

    requested_name = payload.name.strip() if isinstance(payload.name, str) else ""
    device_name = requested_name or str(schema.get("default_name") or schema.get("name") or extension.name)
    external_device = ExternalDevice(
        device_id=str(uuid.uuid4()),
        installed_extension_id=extension.extension_id,
        device_schema_id=str(schema["schema_id"]),
        household_id=household.household_id,
        room_id=room_id,
        owner_id=current_user.user_id,
        name=device_name[:255],
        provider=extension.provider_name,
        config=normalized_config,
        schema_snapshot=schema,
        auth_status=AuthStatus.approved,
        conn_status=ConnStatus.offline,
        last_state={"pin": 0, "value": 0, "brightness": 0},
    )
    db.add(external_device)
    db.commit()
    db.refresh(external_device)
    return _serialize_external_device(external_device)


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

    project_ids = [d.provisioning_project_id for d in devices if d.provisioning_project_id]
    if project_ids:
        from app.sql_models import DiyProject
        projects = db.query(DiyProject.id, DiyProject.board_profile).filter(DiyProject.id.in_(project_ids)).all()
        project_boards = {pid: board for pid, board in projects}
        for d in devices:
            if d.provisioning_project_id:
                setattr(d, "board", project_boards.get(d.provisioning_project_id))

    return [_attach_room_name(_attach_runtime_state(db, device)) for device in devices]


def _load_visible_external_devices(
    db: Session,
    current_user: User,
    requested_status: AuthStatus,
) -> list[ExternalDevice]:
    household_id = resolve_household_id_for_user(db, current_user)
    if household_id is None:
        return []

    query = (
        db.query(ExternalDevice)
        .filter(
            ExternalDevice.household_id == household_id,
            ExternalDevice.auth_status == requested_status,
        )
        .order_by(ExternalDevice.created_at.desc(), ExternalDevice.name.asc())
    )

    if not _is_room_admin(current_user):
        if requested_status != AuthStatus.approved:
            raise HTTPException(status_code=403, detail="Not authorized to view this device state")

        accessible_room_ids = _get_accessible_room_ids_for_user(db, current_user)
        if not accessible_room_ids:
            return []
        query = query.filter(ExternalDevice.room_id.in_(accessible_room_ids))

    return query.all()


def _get_external_device_in_household_or_404(
    db: Session,
    current_user: User,
    device_id: str,
) -> ExternalDevice:
    household_id = resolve_household_id_for_user(db, current_user)
    if household_id is None:
        raise HTTPException(status_code=404, detail="Device not found")

    query = db.query(ExternalDevice).filter(
        ExternalDevice.device_id == device_id,
        ExternalDevice.household_id == household_id,
    )

    if not _is_room_admin(current_user):
        accessible_room_ids = _get_accessible_room_ids_for_user(db, current_user)
        if not accessible_room_ids:
            raise HTTPException(status_code=404, detail="Device not found")
        query = query.filter(ExternalDevice.room_id.in_(accessible_room_ids))

    external_device = query.first()
    if external_device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    return external_device


def _automation_device_scope_for_user(db: Session, current_user: User) -> dict[str, Any]:
    visible_devices = _load_visible_devices(db, current_user, AuthStatus.approved)
    visible_external_devices = _load_visible_external_devices(db, current_user, AuthStatus.approved)
    scope: dict[str, Any] = {device.device_id: device for device in visible_devices}
    scope.update(
        {
            device.device_id: attach_external_device_automation_metadata(device)
            for device in visible_external_devices
        }
    )
    return scope


@router.get("/devices", response_model=List[Union[DeviceResponse, DeviceAvailabilityResponse]])
async def list_devices(
    auth_status: Optional[AuthStatus] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    requested_status = auth_status or AuthStatus.approved
    devices = _load_visible_devices(db, current_user, requested_status)
    external_devices = _load_visible_external_devices(db, current_user, requested_status)
    if _is_room_admin(current_user):
        return devices + [_serialize_external_device(device) for device in external_devices]
    return [
        *[_serialize_device_availability(device) for device in devices],
        *[_serialize_external_device_availability(device) for device in external_devices],
    ]


@router.get("/dashboard/devices", response_model=List[DeviceResponse])
async def list_dashboard_devices(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    devices = _load_visible_devices(db, current_user, AuthStatus.approved)
    external_devices = _load_visible_external_devices(db, current_user, AuthStatus.approved)
    return devices + [_serialize_external_device(device) for device in external_devices]

@router.get("/device/{device_id}", response_model=DeviceResponse)
async def get_device(device_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Get detailed information about a single device.
    """
    device = db.query(Device).filter(Device.device_id == device_id).first()
    if device is not None:
        _ensure_device_control_access(db, current_user, device)
        if device.provisioning_project_id:
            from app.sql_models import DiyProject
            project = db.query(DiyProject.id, DiyProject.board_profile).filter(DiyProject.id == device.provisioning_project_id).first()
            if project:
                setattr(device, "board", project.board_profile)
        return _attach_room_name(_attach_runtime_state(db, device))

    external_device = _get_external_device_in_household_or_404(db, current_user, device_id)
    _ensure_external_device_control_access(db, current_user, external_device)
    return _serialize_external_device(external_device)


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
    _materialize_saved_configs_for_project(db, project=project, fallback_device=device)

    if not isinstance(project.config, dict):
        project.config = {}
    else:
        project.config = _strip_legacy_build_pointer_keys(project.config)

    requested_config_id = _trimmed_string(config.get("config_id")) if isinstance(config, dict) else None
    source_config_id = _trimmed_string(config.get("source_config_id")) if isinstance(config, dict) else None
    create_new_config = bool(config.get("create_new_config")) if isinstance(config, dict) else False

    if requested_config_id and create_new_config:
        source_config_id = requested_config_id
        requested_config_id = None

    save_requires_password = requested_config_id is not None
    if save_requires_password:
        _require_current_user_password(
            current_user,
            config.get("password") if isinstance(config, dict) else None,
            missing_action="overwriting this saved board config",
            invalid_action="overwrite this saved board config",
        )

    target_saved_config = None
    source_saved_config = None
    if requested_config_id:
        target_saved_config = _get_saved_config_for_project_device_or_404(
            db,
            project=project,
            device_id=device.device_id,
            config_id=requested_config_id,
        )
        source_saved_config = target_saved_config
    elif source_config_id:
        source_saved_config = _get_saved_config_for_project_device_or_404(
            db,
            project=project,
            device_id=device.device_id,
            config_id=source_config_id,
        )
    elif getattr(project, "current_config_id", None):
        source_saved_config = db.query(DiyProjectConfig).filter(DiyProjectConfig.id == project.current_config_id).first()

    base_config = (
        dict(source_saved_config.config)
        if source_saved_config is not None and isinstance(source_saved_config.config, dict)
        else dict(project.config)
    )
    base_config = _strip_legacy_build_pointer_keys(base_config)
    requested_credential_id = config.get("wifi_credential_id") if isinstance(config, dict) else None
    wifi_credential_was_explicitly_set = isinstance(config, dict) and "wifi_credential_id" in config
    requested_pins = config.get("pins") if isinstance(config, dict) and "pins" in config else base_config.get("pins", [])
    current_config = dict(base_config)
    current_config["pins"] = requested_pins
    staged_device_name = _normalize_staged_device_name(
        config.get("assigned_device_name") if isinstance(config, dict) else None,
        fallback_name=(
            _trimmed_string(base_config.get("assigned_device_name"))
            or device.name
            or _trimmed_string(base_config.get("project_name"))
        ),
    )
    current_config["assigned_device_name"] = staged_device_name
    current_config["project_name"] = staged_device_name
    allow_empty_draft_save = isinstance(requested_pins, list) and len(requested_pins) == 0
    allow_legacy_wifi_fallback = not (
        wifi_credential_was_explicitly_set and requested_credential_id is None
    )
    board_definition = resolve_board_definition(project.board_profile)
    wifi_credential = _resolve_wifi_credential_for_payload(
        db,
        current_user,
        requested_credential_id=requested_credential_id,
        existing_credential_id=(
            None
            if wifi_credential_was_explicitly_set
            else (
                source_saved_config.config.get("wifi_credential_id")
                if source_saved_config is not None and isinstance(source_saved_config.config, dict)
                else project.wifi_credential_id
            )
        ),
        config_payload=current_config if allow_legacy_wifi_fallback else None,
        create_from_legacy=allow_legacy_wifi_fallback,
        required=not allow_empty_draft_save and board_definition.canonical_id != "jc3827w543",
        missing_message="Select a Wi-Fi credential before updating this board config.",
    )
    current_config = _stamp_wifi_credential_config(current_config, wifi_credential)

    validation_warnings = []
    if not allow_empty_draft_save:
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
    config_name = _normalize_config_name(
        config.get("config_name") if isinstance(config, dict) else None,
        fallback_name=(
            source_saved_config.name
            if source_saved_config is not None
            else device.name
        ),
    )
    prepared_config = stamp_project_secret(
        current_config,
        project.id,
        _resolve_project_device_secret(project.id, project.pending_config, project.config, current_config),
    )
    if not allow_empty_draft_save:
        prepared_config = _stamp_project_network_targets(prepared_config, targets)
    saved_config, prepared_config = _upsert_saved_config(
        db,
        project=project,
        device_id=device.device_id,
        device_name=staged_device_name,
        config_name=config_name,
        config_payload=prepared_config,
        existing_config=target_saved_config,
        update_in_place=True,
    )
    _flush_new_saved_config_rows(db, saved_config)
    if allow_empty_draft_save:
        db.commit()
        return {
            "status": "draft_saved",
            "config_id": saved_config.id,
            "message": "Empty config draft saved to history. Build and flash stay blocked until at least one GPIO is mapped and a saved Wi-Fi credential is selected.",
        }
    job_id = str(uuid.uuid4())

    # Trigger rebuild only after validation passes and no active job exists.
    job = BuildJob(
        id=job_id,
        project_id=project.id,
        status=JobStatus.queued,
        saved_config_id=saved_config.id,
        staged_project_config=prepared_config,
    )
    db.add(job)
    project.pending_config = prepared_config
    project.pending_config_id = saved_config.id
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
        "config_id": saved_config.id,
        "message": "Config history entry queued and build started. The current saved config stays active until the board reports the rebuilt firmware.",
    }


@router.post("/device/{device_id}/action/rebuild")
async def rebuild_device_firmware(
    device_id: str,
    config: dict,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user)
):
    """
    Trigger a firmware rebuild for a device using its currently committed configuration.
    """
    _require_current_user_password(
        current_user,
        config.get("password") if isinstance(config, dict) else None,
        missing_action="rebuilding firmware",
        invalid_action="rebuild firmware",
    )

    device = _get_device_in_household_or_404(db, current_user, device_id)
    if not device.provisioning_project_id:
        raise HTTPException(status_code=400, detail="Not a managed DIY device")

    project = _get_project_in_household_or_404(db, current_user, device.provisioning_project_id)
    
    from app.sql_models import DiyProjectConfig
    if not project.current_config_id:
        raise HTTPException(status_code=400, detail="No committed configuration found for this device")

    committed_config = db.query(DiyProjectConfig).filter(
        DiyProjectConfig.id == project.current_config_id
    ).first()
    
    if not committed_config:
        raise HTTPException(status_code=400, detail="Committed configuration not found in database")

    if project.pending_build_job_id:
        job = db.query(BuildJob).filter(BuildJob.id == project.pending_build_job_id).first()
        if job and job.status in {JobStatus.queued, JobStatus.building}:
            return {
                "status": "success",
                "job_id": job.id,
                "config_id": committed_config.id,
                "message": "Rebuild job already queued or building.",
            }
            
    import uuid
    job_id = str(uuid.uuid4())
    job = BuildJob(
        id=job_id,
        project_id=project.id,
        status=JobStatus.queued,
        saved_config_id=committed_config.id,
        staged_project_config=committed_config.config,
    )
    db.add(job)
    project.pending_config = committed_config.config
    project.pending_config_id = committed_config.id
    project.pending_build_job_id = job.id
    db.commit()
    db.refresh(job)

    background_tasks.add_task(
        build_firmware_task,
        job.id,
        [],
        _background_session_factory(db),
    )

    return {
        "status": "success",
        "job_id": job.id,
        "config_id": committed_config.id,
        "message": "Rebuild job queued.",
    }

@router.delete("/device/{device_id}")
async def delete_device(device_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    """
    Unpair a device from the dashboard while preserving its identity and freeing its MAC for future pairing.
    """
    try:
        device = _get_device_in_household_or_404(db, current_user, device_id)
    except HTTPException as exc:
        if exc.status_code != 404:
            raise
        device = None

    if device is not None:
        owner = db.query(User).filter(User.user_id == device.owner_id).first()
        device.mac_address = generate_detached_mac_address(db)
        device.auth_status = AuthStatus.pending
        device.conn_status = ConnStatus.offline
        device.ip_address = None
        device.pairing_requested_at = None
        _remove_device_widgets(owner, device.device_id)
        db.commit()
        _broadcast_pairing_queue_updated(device, reason="unpaired")
        return {"status": "unpaired", "detail": f"Device {device_id} removed from the dashboard and is ready to pair again."}

    external_device = _get_external_device_in_household_or_404(db, current_user, device_id)
    db.delete(external_device)
    db.commit()
    return {"status": "deleted", "detail": f"External device {device_id} removed from the dashboard."}

@router.post("/device/{device_id}/command")
async def send_command(
    device_id: str,
    command: dict,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Send a command to the device via MQTT and record the publish result.
    """
    command = dict(command or {})
    supplied_password = command.pop("password", None)
    current_user_id = current_user.user_id

    device = db.query(Device).filter(Device.device_id == device_id).first()
    if device is None:
        external_device = _get_external_device_in_household_or_404(db, current_user, device_id)
        _ensure_external_device_control_access(db, current_user, external_device)
        try:
            validate_external_device_command(external_device, command)
        except ExternalDeviceRuntimeValidationError as exc:
            raise HTTPException(
                status_code=400,
                detail={"error": "validation", "message": str(exc)},
            ) from exc
        except ExternalDeviceRuntimeUnsupportedError as exc:
            raise HTTPException(
                status_code=409,
                detail={"error": "unsupported", "message": str(exc)},
            ) from exc

        command_id = str(uuid.uuid4())
        command["command_id"] = command_id
        command_ordering_manager.activate(
            command_id=command_id,
            device_id=external_device.device_id,
            scope_key=_build_external_command_scope_key(external_device.device_id),
        )

        background_tasks.add_task(
            _execute_external_device_command_task,
            _background_session_factory(db),
            device_id=external_device.device_id,
            command=dict(command),
        )
        return {"status": "pending", "command_id": command_id, "message": "Command requested"}

    _ensure_device_control_access(db, current_user, device)

    # If this is an OTA command, mark the build job as flashing
    ota_job = None
    if command.get("action") == "ota" and command.get("job_id"):
        if not _is_room_admin(current_user):
            raise HTTPException(status_code=403, detail="Admin or Owner privileges required for OTA")
        _require_current_user_password(
            current_user,
            supplied_password,
            missing_action="sending this OTA update",
            invalid_action="send this OTA update",
        )
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

        artifact_path = _resolve_build_artifact_path(ota_job, "firmware")
        if not artifact_path or not os.path.exists(artifact_path):
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "conflict",
                    "message": "Firmware artifact is not available on this backend runtime. Rebuild on the current runtime before retrying OTA.",
                },
            )

        ota_token = create_ota_token(ota_job.id)
        ota_url = _resolve_job_ota_download_url(ota_job, ota_token, request)
        if not ota_url:
            raise HTTPException(
                status_code=500,
                detail="Failed to resolve an OTA download URL for this build job.",
            )

        ota_project = ota_job.project or _get_project_in_household_or_404(db, current_user, device.provisioning_project_id)

        # Security: Inject artifact MD5 and server signature into the OTA command
        try:
            with open(artifact_path, "rb") as f:
                firmware_bytes = f.read()
            firmware_md5 = hashlib.md5(firmware_bytes).hexdigest()
        except Exception:
            raise HTTPException(status_code=500, detail="Failed to read firmware artifact to generate signature.")

        secret_key = _resolve_project_device_secret(
            device.provisioning_project_id,
            ota_job.staged_project_config,
            getattr(ota_project, "pending_config", None),
            getattr(ota_project, "config", None),
        )
        signature_payload = (firmware_md5 + secret_key).encode("utf-8")
        signature = hashlib.md5(signature_payload).hexdigest()

        command["kind"] = "system"
        command["job_id"] = ota_job.id
        command["url"] = ota_url
        command["payload"] = ota_url
        command["ota_token"] = ota_token
        command["md5"] = firmware_md5
        command["signature"] = signature

        ota_job.status = JobStatus.flashing
        ota_job.error_message = None
        ota_job.finished_at = None
        ota_job.updated_at = _utcnow_naive()
        db.commit()

    _latest_state_record, previous_state = load_latest_device_state_payload(db, device.device_id)
    previous_state_snapshot = copy.deepcopy(previous_state) if isinstance(previous_state, dict) else None
    predicted_state = None
    if command.get("action") != "ota":
        predicted_state = build_predicted_mqtt_state(previous_state_snapshot, device.pin_configurations, command)
        target_pin = command.get("pin")
        target_pin_mode = next(
            (
                str(
                    getattr(getattr(pin_config, "mode", None), "value", getattr(pin_config, "mode", "")) or ""
                ).upper()
                for pin_config in (device.pin_configurations or [])
                if getattr(pin_config, "gpio_pin", None) == target_pin
            ),
            None,
        )
        if isinstance(predicted_state, dict):
            if predicted_state.get("pin") == target_pin and "value" in predicted_state:
                command["value"] = predicted_state["value"]
            else:
                predicted_pins = predicted_state.get("pins")
                if isinstance(predicted_pins, list):
                    matching_pin = next(
                        (
                            row
                            for row in predicted_pins
                            if isinstance(row, dict) and row.get("pin") == target_pin and "value" in row
                        ),
                        None,
                    )
                    if isinstance(matching_pin, dict):
                        command["value"] = matching_pin["value"]
        if target_pin_mode == "PWM" and isinstance(command.get("value"), (int, float)) and not isinstance(command.get("value"), bool):
            command["brightness"] = int(command["value"])
        else:
            command.pop("brightness", None)
        command.pop("power", None)

    command_id = str(uuid.uuid4())
    command["command_id"] = command_id

    # Publish via MQTT
    publish_command = (
        mqtt_manager.publish_command
        if command.get("action") == "ota"
        else mqtt_manager.enqueue_command
    )
    success = publish_command(device_id, command)

    # If the OTA publish failed entirely, revert the job out of flashing
    if not success and ota_job and ota_job.status == JobStatus.flashing:
        failure_time = _utcnow_naive()
        ota_job.status = JobStatus.flash_failed
        ota_job.error_message = "Failed to publish firmware download command over MQTT."
        ota_job.finished_at = failure_time
        ota_job.updated_at = failure_time
        db.commit()

    if command.get("action") == "ota":
        event_type = EventType.command_requested if success else EventType.command_failed
        history = DeviceHistory(
            device_id=device_id,
            event_type=event_type,
            payload=str(command),
            changed_by=current_user_id,
        )
        db.add(history)
        db.commit()

        if not success:
            return {"status": "failed", "message": "Failed to publish to MQTT broker"}
    else:
        if success:
            ordering_ticket = None
            scope_key = _build_mqtt_command_scope_key(device_id, command)
            if scope_key:
                ordering_ticket = command_ordering_manager.activate(
                    command_id=command_id,
                    device_id=device_id,
                    scope_key=scope_key,
                )
                removed_superseded_prediction = _drop_superseded_mqtt_command(
                    db,
                    ordering_ticket.superseded_command_id,
                )
                if removed_superseded_prediction:
                    db.commit()

            mqtt_manager.pending_commands[command_id] = {
                "device_id": device_id,
                "pin": command.get("pin"),
                "value": command.get("value"),
                "brightness": command.get("brightness"),
                "timestamp": datetime.now(timezone.utc).timestamp(),
                "command_id": command_id,
                "predicted_state_history_id": None,
                "predicted_state": copy.deepcopy(predicted_state) if isinstance(predicted_state, dict) else None,
                "command_scope": ordering_ticket.scope_key if ordering_ticket is not None else None,
                "sequence_number": ordering_ticket.sequence_number if ordering_ticket is not None else 0,
            }

        background_tasks.add_task(
            _persist_mqtt_command_artifacts_task,
            _background_session_factory(db),
            device_id=device_id,
            command=dict(command),
            current_user_id=current_user_id,
            success=success,
            predicted_state=copy.deepcopy(predicted_state) if isinstance(predicted_state, dict) else None,
        )

        if not success:
            return {"status": "failed", "message": "Failed to publish to MQTT broker"}

        if isinstance(predicted_state, dict):
            try:
                ws_manager.broadcast_device_event_sync(
                    "device_state",
                    device_id,
                    device.room_id,
                    predicted_state,
                )
            except Exception:
                pass

        async def check_command_timeout():
            await asyncio.sleep(5)
            if command_id in mqtt_manager.pending_commands:
                cmd = mqtt_manager.pending_commands.pop(command_id, None)
                if cmd:
                    command_ordering_manager.complete(command_id)
                    from app.database import SessionLocal
                    db_bg = SessionLocal()
                    try:
                        predicted_history_id = cmd.get("predicted_state_history_id")
                        if isinstance(predicted_history_id, int):
                            predicted_history = (
                                db_bg.query(DeviceHistory)
                                .filter(
                                    DeviceHistory.id == predicted_history_id,
                                    DeviceHistory.device_id == device_id,
                                    DeviceHistory.event_type == EventType.state_change,
                                )
                                .first()
                            )
                            if predicted_history is not None:
                                db_bg.delete(predicted_history)
                        db_bg.add(
                            DeviceHistory(
                                device_id=device_id,
                                event_type=EventType.command_failed,
                                payload=json.dumps({"command_id": command_id, "reason": "timeout"}),
                                changed_by=current_user_id,
                            )
                        )
                        db_bg.commit()
                    finally:
                        db_bg.close()
                    try:
                        ws_manager.broadcast_device_event_sync(
                            "device_state",
                            device_id,
                            device.room_id,
                            previous_state_snapshot,
                        )
                    except Exception:
                        pass
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

    return {
        "status": "pending",
        "command_id": command_id,
        "message": "Command requested",
        "last_state": predicted_state,
    }

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
    project_name = _require_project_name(
        project.name,
        message="Enter a project name before creating a device project.",
    )
    if project.room_id is None:
        raise HTTPException(
            status_code=400,
            detail={"error": "validation", "message": "Select a room before creating a device project."},
        )

    try:
        board_definition = resolve_board_definition(project.board_profile)
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"error": "validation", "message": str(e)})

    room = _get_room_in_household_or_404(db, current_user, project.room_id)
    wifi_credential_required = board_definition.canonical_id != "jc3827w543"
    wifi_credential = _resolve_wifi_credential_for_payload(
        db,
        current_user,
        requested_credential_id=project.wifi_credential_id,
        config_payload=project.config,
        create_from_legacy=True,
        required=wifi_credential_required,
        missing_message="Select a Wi-Fi credential before creating a device project.",
    )
    project_id = str(uuid.uuid4())
    stamped_config = _stamp_wifi_credential_config(project.config, wifi_credential)
    stamped_config = stamp_project_secret(stamped_config, project_id)
    new_project = DiyProject(
        id=project_id,
        user_id=current_user.user_id,
        room_id=room.room_id,
        wifi_credential_id=wifi_credential.id if wifi_credential is not None else None,
        name=project_name,
        board_profile=project.board_profile,
        config=stamped_config,
    )
    db.add(new_project)
    db.flush()
    current_saved_config, current_payload = _ensure_project_current_saved_config(
        db,
        project=new_project,
        explicit_config_name=project.config_name,
    )
    new_project.current_config_id = current_saved_config.id
    new_project.config = current_payload
    db.commit()
    db.refresh(new_project)
    return _project_response_model(new_project)

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
            "config_name": (
                p.current_saved_config.name
                if getattr(p, "current_saved_config", None) is not None
                else (_trimmed_string(p.config.get("config_name")) if isinstance(p.config, dict) else None)
            ),
            "config": _public_config_payload(p.config),
            "current_config_id": getattr(p, "current_config_id", None),
            "pending_config": _public_config_payload(p.pending_config),
            "pending_config_id": getattr(p, "pending_config_id", None),
            "pending_build_job_id": p.pending_build_job_id,
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
    project = _get_project_in_household_or_404(db, current_user, project_id)
    if _reconcile_project_pending_ota_state(db, project=project):
        db.commit()
        db.refresh(project)
    return _project_response_model(project)


@router.get("/diy/projects/{project_id}/config-history", response_model=List[ConfigHistoryEntryResponse])
async def list_project_config_history(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    project = _get_project_in_household_or_404(db, current_user, project_id)
    if _reconcile_project_pending_ota_state(db, project=project):
        db.commit()
        db.refresh(project)
    
    saved_configs = (
        db.query(DiyProjectConfig)
        .filter(
            DiyProjectConfig.project_id == project.id,
            DiyProjectConfig.board_profile == project.board_profile,
        )
        .order_by(DiyProjectConfig.updated_at.desc(), DiyProjectConfig.created_at.desc(), DiyProjectConfig.id.desc())
        .all()
    )
    latest_jobs = _latest_builds_by_saved_config(db, project_id=project.id)
    return [
        _serialize_saved_config_entry(saved_config, project=project, latest_job=latest_jobs.get(saved_config.id))
        for saved_config in saved_configs
    ]


@router.get("/device/{device_id}/configs", response_model=List[ConfigHistoryEntryResponse])
@router.get("/device/{device_id}/config-history", response_model=List[ConfigHistoryEntryResponse])
async def list_device_config_history(
    device_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    device = _get_device_in_household_or_404(db, current_user, device_id)
    if not device.provisioning_project_id:
        raise HTTPException(status_code=400, detail="Not a managed DIY device")

    project = _get_project_in_household_or_404(db, current_user, device.provisioning_project_id)
    if _materialize_saved_configs_for_project(db, project=project, fallback_device=device):
        db.commit()
        db.refresh(project)
    if _reconcile_project_pending_ota_state(db, project=project, device=device):
        db.commit()
        db.refresh(project)
    saved_configs = (
        db.query(DiyProjectConfig)
        .filter(
            DiyProjectConfig.project_id == project.id,
            DiyProjectConfig.device_id == device.device_id,
            DiyProjectConfig.board_profile == project.board_profile,
        )
        .order_by(DiyProjectConfig.updated_at.desc(), DiyProjectConfig.created_at.desc(), DiyProjectConfig.id.desc())
        .all()
    )
    latest_jobs = _latest_builds_by_saved_config(db, project_id=project.id)
    return [
        _serialize_saved_config_entry(saved_config, project=project, latest_job=latest_jobs.get(saved_config.id))
        for saved_config in saved_configs
    ]

@router.put("/device/{device_id}/configs/{config_id}/name")
@router.put("/device/{device_id}/config-history/{config_id}/name")
async def update_device_config_history_name(
    device_id: str,
    config_id: str,
    payload: ConfigHistoryRenameRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    device = _get_device_in_household_or_404(db, current_user, device_id)
    if not device.provisioning_project_id:
        raise HTTPException(status_code=400, detail="Not a managed DIY device")

    normalized_config_name = _trimmed_string(payload.config_name)
    if not normalized_config_name:
        raise HTTPException(
            status_code=400,
            detail={"error": "validation", "message": "Enter a config label before saving the rename."},
        )
    normalized_config_name = normalized_config_name[:255]

    project = _get_project_in_household_or_404(db, current_user, device.provisioning_project_id)
    if _materialize_saved_configs_for_project(db, project=project, fallback_device=device):
        db.commit()
        db.refresh(project)
    saved_config = _get_saved_config_for_project_device_or_404(
        db,
        project=project,
        device_id=device.device_id,
        config_id=config_id,
    )
    saved_config.name = normalized_config_name

    next_staged_config, changed = _rename_config_payload(
        saved_config.config,
        config_name=normalized_config_name,
    )
    if changed:
        saved_config.config = next_staged_config

    if isinstance(project.pending_config, dict):
        pending_config_id = _trimmed_string(project.pending_config.get("config_id"))
        if pending_config_id == saved_config.id or project.pending_config_id == saved_config.id:
            updated_pending_config = dict(project.pending_config)
            updated_pending_config["config_name"] = normalized_config_name
            project.pending_config = updated_pending_config

    if isinstance(project.config, dict):
        committed_config_id = _trimmed_string(project.config.get("config_id"))
        if committed_config_id == saved_config.id or project.current_config_id == saved_config.id:
            updated_committed_config = dict(project.config)
            updated_committed_config["config_name"] = normalized_config_name
            project.config = updated_committed_config

    config_jobs = (
        db.query(BuildJob)
        .filter(BuildJob.project_id == project.id, BuildJob.saved_config_id == saved_config.id)
        .all()
    )
    for job in config_jobs:
        renamed_snapshot, snapshot_changed = _rename_config_payload(job.staged_project_config, config_name=normalized_config_name)
        if snapshot_changed:
            job.staged_project_config = renamed_snapshot

    db.commit()
    return {"status": "ok", "config_name": normalized_config_name}

@router.delete("/device/{device_id}/configs/{config_id}")
@router.delete("/device/{device_id}/config-history/{config_id}")
async def delete_device_config_history(
    device_id: str,
    config_id: str,
    payload: Optional[ConfigHistoryDeleteRequest] = Body(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    device = _get_device_in_household_or_404(db, current_user, device_id)
    if not device.provisioning_project_id:
        raise HTTPException(status_code=400, detail="Not a managed DIY device")

    _require_current_user_password(
        current_user,
        payload.password if payload is not None else None,
        missing_action="deleting this saved config",
        invalid_action="delete this saved config",
    )

    project = _get_project_in_household_or_404(db, current_user, device.provisioning_project_id)
    if _materialize_saved_configs_for_project(db, project=project, fallback_device=device):
        db.commit()
        db.refresh(project)
    saved_config = _get_saved_config_for_project_device_or_404(
        db,
        project=project,
        device_id=device.device_id,
        config_id=config_id,
    )

    committed_config_id = (
        _trimmed_string(project.config.get("config_id"))
        if isinstance(project.config, dict)
        else None
    )
    pending_config_id = (
        _trimmed_string(project.pending_config.get("config_id"))
        if isinstance(project.pending_config, dict)
        else None
    )
    if saved_config.id in {getattr(project, "current_config_id", None), committed_config_id}:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "conflict",
                "message": "The current committed config cannot be deleted from history.",
            },
        )

    if saved_config.id in {getattr(project, "pending_config_id", None), pending_config_id}:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "conflict",
                "message": "The pending OTA config cannot be deleted from history.",
            },
        )

    active_job = (
        db.query(BuildJob)
        .filter(
            BuildJob.project_id == project.id,
            BuildJob.saved_config_id == saved_config.id,
            BuildJob.status.in_(ACTIVE_BUILD_JOB_STATUSES),
        )
        .first()
    )
    if active_job is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "conflict",
                "message": "This config is still referenced by an active build or OTA job.",
            },
        )

    config_jobs = (
        db.query(BuildJob)
        .filter(BuildJob.project_id == project.id, BuildJob.saved_config_id == saved_config.id)
        .all()
    )
    for job in config_jobs:
        job.saved_config_id = None
        deleted_snapshot, snapshot_changed = mark_config_history_deleted_payload(job.staged_project_config)
        if snapshot_changed:
            job.staged_project_config = deleted_snapshot

    db.delete(saved_config)
    db.commit()
    return {"status": "deleted", "id": config_id}

@router.put("/diy/projects/{project_id}", response_model=DiyProjectResponse)
async def update_diy_project(project_id: str, project_update: DiyProjectCreate, db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    project = _get_project_in_household_or_404(db, current_user, project_id)
    project_name = _require_project_name(
        project_update.name,
        message="Enter a project name before saving the device project.",
    )
    board_definition = resolve_board_definition(project.board_profile)
    if project_update.board_profile != project.board_profile:
        raise HTTPException(
            status_code=400,
            detail={"error": "validation", "message": "Cannot change the board profile of an existing project."},
        )
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
        required=board_definition.canonical_id != "jc3827w543",
        missing_message="Select a Wi-Fi credential before saving the device project.",
    )
    project.name = project_name
    project.board_profile = project_update.board_profile
    project.room_id = room.room_id
    project.wifi_credential_id = wifi_credential.id if wifi_credential is not None else None
    project.config = stamp_project_secret(
        _stamp_wifi_credential_config(project_update.config, wifi_credential),
        project.id,
        _resolve_project_device_secret(project.id, project.pending_config, project.config),
    )
    project.pending_config = None
    project.pending_config_id = None
    project.pending_build_job_id = None
    current_saved_config, current_payload = _ensure_project_current_saved_config(
        db,
        project=project,
        explicit_config_name=project_update.config_name,
    )
    project.current_config_id = current_saved_config.id
    project.config = current_payload
    db.commit()
    db.refresh(project)
    return _project_response_model(project)

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
        return _build_job_response_model(active_job)

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
    project.config = stamp_project_secret(
        project.config,
        project.id,
        _resolve_project_device_secret(project.id, project.pending_config, current_config),
    )
    current_saved_config, current_payload = _ensure_project_current_saved_config(db, project=project)
    current_saved_config.config = dict(project.config)
    current_saved_config.name = _normalize_config_name(
        project.config.get("config_name") if isinstance(project.config, dict) else None,
        fallback_name=current_saved_config.name or project.name,
    )
    project.current_config_id = current_saved_config.id
    project.config = current_payload = _stamp_config_history_metadata(
        dict(project.config),
        config_id=current_saved_config.id,
        config_name=current_saved_config.name,
        device_id=current_saved_config.device_id,
        device_name=_trimmed_string(current_payload.get("assigned_device_name")) or current_saved_config.name,
        board_profile=project.board_profile,
        saved_at=datetime.now(timezone.utc),
    )
    current_saved_config.config = dict(project.config)

    job_id = str(uuid.uuid4())
    job = BuildJob(
        id=job_id,
        project_id=project.id,
        saved_config_id=current_saved_config.id,
        status=JobStatus.queued,
        staged_project_config=dict(project.config),
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
    return _build_job_response_model(job)

@router.get("/diy/build/{job_id}", response_model=BuildJobResponse)
async def get_build_job(
    job_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    job = _get_build_job_in_household_or_404(db, current_user, job_id)
    if job.status == JobStatus.flashing:
        reference_time = datetime.now(timezone.utc).replace(tzinfo=None)
        device = (
            db.query(Device)
            .filter(Device.provisioning_project_id == job.project_id)
            .first()
        )
        original_status = job.status

        if device is not None and device.firmware_version:
            _reconcile_ota_jobs(db, device, device.firmware_version)
            db.flush()
            db.refresh(job)

        if job.status == JobStatus.flashing:
            _reconcile_stale_flashing_job(
                db,
                job,
                reference_time=reference_time,
                device=device,
            )

        if job.status != original_status:
            db.commit()
            db.refresh(job)

    # Inject an ephemeral OTA token upon successful access by owner
    job.ota_token = create_ota_token(job.id)
    job.ota_download_url = _resolve_job_ota_download_url(job, job.ota_token, request)
    return _build_job_response_model(job, ota_token=job.ota_token, ota_download_url=job.ota_download_url)

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
    artifact_name: Literal["firmware", "bootloader", "partitions", "boot_app0"],
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
    active_lock.released_at = datetime.now(timezone.utc).replace(tzinfo=None)
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
    current_utc = datetime.now(timezone.utc)
    retention_cutoff = current_utc.replace(tzinfo=None) - timedelta(days=SYSTEM_LOG_RETENTION_DAYS)
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
    started_at_utc = _coerce_utc_api_datetime(started_at) if isinstance(started_at, datetime) else None
    if started_at_utc is not None:
        uptime_seconds = max(0, int((current_utc - started_at_utc).total_seconds()))

    database_ready = getattr(request.app.state, "database_ready", True)
    database_status = "ok" if database_ready else "unavailable"
    mqtt_status = "connected" if mqtt_manager.connected else "disconnected"

    return SystemStatusResponse(
        overall_status=_calculate_system_overall_status(
            unread_alert_severities=[entry.severity for entry in unread_alert_entries],
        ),
        database_status=database_status,
        mqtt_status=mqtt_status,
        started_at=started_at_utc,
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
        latest_firmware_revision=get_latest_firmware_revision(),
    )


@router.get("/system/firmware-template", response_model=FirmwareTemplateStatusResponse)
async def get_system_firmware_template_status(
    admin: User = Depends(get_admin_user),
):
    return FirmwareTemplateStatusResponse(**get_firmware_template_status())


@router.post("/system/firmware-template/refresh", response_model=FirmwareTemplateStatusResponse)
async def refresh_system_firmware_template(
    admin: User = Depends(get_admin_user),
):
    return FirmwareTemplateStatusResponse(**refresh_firmware_template_release(force=True))


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
    retention_cutoff = _utcnow_naive() - timedelta(days=SYSTEM_LOG_RETENTION_DAYS)
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
        entry.read_at = _utcnow_naive()
        entry.read_by_user_id = admin.user_id
        db.commit()
        updated_count = 1

    return SystemLogAcknowledgeResponse(updated_count=updated_count)


@router.post("/system/logs/mark-all-read", response_model=SystemLogAcknowledgeResponse)
async def mark_all_system_logs_read(
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    retention_cutoff = _utcnow_naive() - timedelta(days=SYSTEM_LOG_RETENTION_DAYS)
    unread_alert_entries = (
        db.query(SystemLog)
        .filter(
            SystemLog.occurred_at >= retention_cutoff,
            SystemLog.severity.in_(SYSTEM_LOG_ALERT_SEVERITIES),
            SystemLog.is_read.is_(False),
        )
        .all()
    )

    read_at = _utcnow_naive()
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
    device.last_seen = datetime.now(timezone.utc).replace(tzinfo=None)

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
                publish_command=_build_automation_command_dispatcher(
                    db,
                    physical_publish=mqtt_manager.publish_command,
                ),
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
        publish_command=_build_automation_command_dispatcher(
            db,
            physical_publish=mqtt_manager.enqueue_command,
            triggered_at=datetime.now(timezone.utc).replace(tzinfo=None),
        ),
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
        "timestamp": str(datetime.now(timezone.utc).replace(tzinfo=None)),
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
