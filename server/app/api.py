from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, BackgroundTasks, Query
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy import or_
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from typing import List, Optional, Any, Literal, Union
import ast
import json
import shutil
import os
import uuid
from datetime import datetime, timedelta
import anyio

from .mqtt import mqtt_manager

from .models import (
    UserCreate, UserResponse, Token, TokenData, InitialServerRequest,
    DeviceApprovalRequest, DeviceAvailabilityResponse, DeviceHandshakeResponse, DeviceRegister, DeviceResponse, PinConfigCreate,
    AutomationCreate, AutomationResponse,
    DeviceHistoryCreate, DeviceHistoryResponse,
    FirmwareResponse, DeviceMode, AccountType, EventType,
    RoomAccessUpdate, RoomCreate, RoomResponse, GenerateConfigRequest, GenerateConfigResponse,
    SetupResponse, HouseholdResponse, TriggerResponse, ExecutionStatus, AutomationLogResponse,
    DiyProjectCreate, DiyProjectResponse, BuildJobResponse, JobStatus, SerialSessionResponse,
    ManagedUserResponse, UserApprovalStatus
)
from .sql_models import (
    User, Device, Automation, DeviceHistory, 
    Firmware, Room, RoomPermission, BackupArchive, Household, HouseholdMembership, HouseholdRole,
    AuthStatus, ConnStatus, AutomationExecutionLog, DiyProject, BuildJob, SerialSession, SerialSessionStatus,
    UserApprovalStatus as SqlUserApprovalStatus
)
from .database import get_db
from .auth import verify_password, get_password_hash, create_access_token, SECRET_KEY, ALGORITHM
from .services.builder import build_firmware_task, get_durable_artifact_path
from .services.device_registration import (
    is_mqtt_managed_device,
    mqtt_only_error,
    register_device_payload,
)
from .services.diy_validation import validate_diy_config
from .services.user_management import ensure_temp_support_account, resolve_household_id_for_user
from .services.i2c_registry import I2CLibrary, get_i2c_catalog

router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")
ACTIVE_BUILD_JOB_STATUSES = (
    JobStatus.queued,
    JobStatus.building,
    JobStatus.flashing,
)
DEVICE_HEARTBEAT_TIMEOUT_SECONDS = max(
    5,
    int(os.getenv("DEVICE_HEARTBEAT_TIMEOUT_SECONDS", "75")),
)
DEVICE_HEARTBEAT_TIMEOUT = timedelta(seconds=DEVICE_HEARTBEAT_TIMEOUT_SECONDS)


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


def _raise_user_approval_error(status: SqlUserApprovalStatus):
    if status == SqlUserApprovalStatus.pending:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "approval_required",
                "message": "Account pending approval by an administrator.",
            },
        )

    raise HTTPException(
        status_code=403,
        detail={
            "error": "account_revoked",
            "message": "Account access has been revoked by an administrator.",
        },
    )


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
        .join(User, User.user_id == HouseholdMembership.user_id)
        .filter(
            HouseholdMembership.household_id == household_id,
            HouseholdMembership.user_id.in_(unique_ids),
            User.approval_status == SqlUserApprovalStatus.approved,
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
        account_type: str = payload.get("account_type")
        household_id: int = payload.get("household_id")
        household_role: str = payload.get("household_role")
        if username is None:
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
    if user.approval_status != SqlUserApprovalStatus.approved:
        _raise_user_approval_error(user.approval_status)
        
    # Attach session household context dynamically for route handlers
    setattr(user, "current_household_id", token_data.household_id)
    setattr(user, "current_household_role", token_data.household_role)
    
    return user

async def get_admin_user(current_user: User = Depends(get_current_user)):
    if not _is_room_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin or Owner privileges required")
    return current_user

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
        approval_status=SqlUserApprovalStatus.approved,
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

    ensure_temp_support_account(db)

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
        approval_status=SqlUserApprovalStatus.pending,
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


@router.post("/users/{user_id}/approve", response_model=ManagedUserResponse)
async def approve_user(user_id: int, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    membership = _get_managed_membership_or_404(db, admin, user_id)
    membership.user.approval_status = SqlUserApprovalStatus.approved
    db.commit()
    db.refresh(membership.user)
    return _serialize_managed_user(membership.user, membership)


@router.post("/users/{user_id}/revoke", response_model=ManagedUserResponse)
async def revoke_user(user_id: int, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    if user_id == admin.user_id:
        raise HTTPException(status_code=400, detail="You cannot revoke your own account")

    membership = _get_managed_membership_or_404(db, admin, user_id)
    membership.user.approval_status = SqlUserApprovalStatus.revoked
    db.commit()
    db.refresh(membership.user)
    return _serialize_managed_user(membership.user, membership)

@router.post("/auth/token", response_model=Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    # Check password against 'authentication' column
    if not user or not verify_password(form_data.password, user.authentication):
        raise HTTPException(
            status_code=401,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if user.approval_status != SqlUserApprovalStatus.approved:
        _raise_user_approval_error(user.approval_status)
        
    # Find active household membership for context binding
    membership = db.query(HouseholdMembership).filter(HouseholdMembership.user_id == user.user_id).first()
    household_id = membership.household_id if membership else None
    household_role = membership.role.value if membership else None
    
    access_token = create_access_token(
        data={
            "sub": user.username,
            "account_type": user.account_type.value,
            "household_id": household_id,
            "household_role": household_role
        }
    )
    return {"access_token": access_token, "token_type": "bearer"}

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


@router.post("/config", response_model=DeviceHandshakeResponse)
async def register_device_handshake(
    payload: DeviceRegister, 
    db: Session = Depends(get_db)
):
    """
    HTTP handshake remains available only for legacy discovery paths.
    MQTT-managed ESP32 firmware must register over MQTT.
    """
    if (
        payload.mode == DeviceMode.library
        or payload.project_id is not None
        or payload.secret_key is not None
    ):
        raise mqtt_only_error(
            "ESP32 registration must be published to the MQTT register topic."
        )

    result = register_device_payload(db, payload)
    db.commit()
    db.refresh(result.device)

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
    device = _get_device_or_404(db, device_id)
    room = _get_room_in_household_or_404(db, admin, payload.room_id)
    
    device.auth_status = AuthStatus.approved
    device.room_id = room.room_id
    owner = db.query(User).filter(User.user_id == device.owner_id).first()
    _sync_user_dashboard_widgets(owner or admin, device)
    
    db.commit()
    return {"status": "approved", "device_id": device_id}

@router.post("/device/{device_id}/reject")
async def reject_device(device_id: str, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    """
    Explicitly reject a pending device handshake so it does not appear in discovery.
    """
    device = db.query(Device).filter(Device.device_id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
        
    device.auth_status = AuthStatus.rejected
    db.commit()
    return {"status": "rejected"}

def _load_visible_devices(
    db: Session,
    current_user: User,
    requested_status: AuthStatus,
) -> list[Device]:
    query = db.query(Device).filter(Device.auth_status == requested_status)
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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user)
):
    """
    Update the pin configuration for a managed device and optionally trigger a rebuild.
    """
    device = _get_device_or_404(db, device_id)
    if not device.provisioning_project_id:
        raise HTTPException(status_code=400, detail="Not a managed DIY device")

    project = db.query(DiyProject).filter(DiyProject.id == device.provisioning_project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Associated DIY project not found")

    if not isinstance(project.config, dict):
        project.config = {}
    
    current_config = dict(project.config)
    current_config["pins"] = config.get("pins", [])
    
    project.config = current_config
    
    # We must also clear device.pin_configurations here so it reflects correctly,
    # or let the device update its pin configurations when it boots up.
    # The device sends its pin_configurations on mqtt handshake.
    # We will just rely on the database for `DiyProject` config.
    
    db.commit()

    # Trigger rebuild
    job = BuildJob(project_id=project.id, status=JobStatus.queued)
    db.add(job)
    db.commit()
    db.refresh(job)

    try:
        validate_diy_config(
            board_profile=project.board_profile,
            config_json=current_config
        )
    except Exception as e:
        job.status = JobStatus.failed
        job.logs = f"Validation failed: {str(e)}"
        db.commit()
        raise HTTPException(status_code=400, detail=str(e))

    build_firmware_task.delay(job.id, project.id)

    return {"status": "success", "job_id": job.id, "message": "Configuration saved and build started"}

@router.delete("/device/{device_id}")
async def delete_device(device_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    """
    Unpair a device from the dashboard while preserving its identity so it can be paired again.
    """
    device = _get_device_or_404(db, device_id)
        
    owner = db.query(User).filter(User.user_id == device.owner_id).first()
    device.auth_status = AuthStatus.pending
    _remove_device_widgets(owner, device.device_id)
    db.commit()
    return {"status": "unpaired", "detail": f"Device {device_id} removed from the dashboard and is ready to pair again."}

@router.post("/device/{device_id}/command")
async def send_command(device_id: str, command: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Send a command to the device via MQTT and record the publish result.
    """
    device = _get_device_or_404(db, device_id)
    _ensure_device_control_access(db, current_user, device)

    # Publish via MQTT
    success = mqtt_manager.publish_command(device_id, command)
    
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

    return {"status": "sent", "command": command}

@router.get("/device/{device_id}/command/latest")
async def get_latest_command(device_id: str, db: Session = Depends(get_db)):
    """
    Get the most recent command sent to the device.
    """
    device = _get_device_or_404(db, device_id)
    if is_mqtt_managed_device(device):
        raise mqtt_only_error(
            "MQTT-managed ESP32 devices do not support HTTP command polling."
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
async def generate_diy_config(request: GenerateConfigRequest, user: User = Depends(get_current_user)):
    """
    Generate device config JSON from board and pin mappings.
    """
    config = {
        "board": request.board,
        "wifi": {
            "ssid": request.wifi_ssid or "",
            "password": request.wifi_password or ""
        },
        "mqtt": {
            "broker": request.mqtt_broker or ""
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
    new_project = DiyProject(
        id=str(uuid.uuid4()),
        user_id=current_user.user_id,
        room_id=room.room_id,
        name=project.name,
        board_profile=project.board_profile,
        config=project.config
    )
    db.add(new_project)
    db.commit()
    db.refresh(new_project)
    return new_project

@router.get("/diy/projects", response_model=List[DiyProjectResponse])
async def list_diy_projects(
    board_profile: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    query = db.query(DiyProject).filter(DiyProject.user_id == current_user.user_id)
    if board_profile:
        query = query.filter(DiyProject.board_profile == board_profile)
    return query.order_by(DiyProject.updated_at.desc(), DiyProject.created_at.desc()).all()

@router.get("/diy/projects/{project_id}", response_model=DiyProjectResponse)
async def get_diy_project(project_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    project = db.query(DiyProject).filter(DiyProject.id == project_id, DiyProject.user_id == current_user.user_id).first()
    if not project:
         raise HTTPException(status_code=404, detail="Project not found")
    return project

@router.put("/diy/projects/{project_id}", response_model=DiyProjectResponse)
async def update_diy_project(project_id: str, project_update: DiyProjectCreate, db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    project = db.query(DiyProject).filter(DiyProject.id == project_id, DiyProject.user_id == current_user.user_id).first()
    if not project:
         raise HTTPException(status_code=404, detail="Project not found")
    if project_update.room_id is None:
        raise HTTPException(
            status_code=400,
            detail={"error": "validation", "message": "Select a room before saving the device project."},
        )
    room = _get_room_in_household_or_404(db, current_user, project_update.room_id)
    project.name = project_update.name
    project.board_profile = project_update.board_profile
    project.room_id = room.room_id
    project.config = project_update.config
    db.commit()
    db.refresh(project)
    return project

@router.post("/diy/build", response_model=BuildJobResponse)
async def trigger_diy_build(project_id: str, background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    project = (
        db.query(DiyProject)
        .filter(DiyProject.id == project_id, DiyProject.user_id == current_user.user_id)
        .with_for_update()
        .first()
    )
    if not project:
         raise HTTPException(status_code=404, detail="Project not found")
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

    job_id = str(uuid.uuid4())
    job = BuildJob(
        id=job_id,
        project_id=project.id,
        status=JobStatus.queued
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(build_firmware_task, job_id, validation_warnings)
    return job

@router.get("/diy/build/{job_id}", response_model=BuildJobResponse)
async def get_build_job(job_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    job = db.query(BuildJob).join(DiyProject).filter(BuildJob.id == job_id, DiyProject.user_id == current_user.user_id).first()
    if not job:
         raise HTTPException(status_code=404, detail="Job not found")
    return job

@router.get("/diy/build/{job_id}/artifact")
async def get_build_artifact(job_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    job = db.query(BuildJob).join(DiyProject).filter(BuildJob.id == job_id, DiyProject.user_id == current_user.user_id).first()
    if not job:
         raise HTTPException(status_code=404, detail="Job not found")
         
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
    job = db.query(BuildJob).join(DiyProject).filter(BuildJob.id == job_id, DiyProject.user_id == current_user.user_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    artifact_path = _resolve_build_artifact_path(job, artifact_name)
    if job.status != JobStatus.artifact_ready or not artifact_path or not os.path.exists(artifact_path):
        raise HTTPException(status_code=400, detail=f"{artifact_name} artifact not ready or missing")

    return FileResponse(
        artifact_path,
        media_type="application/octet-stream",
        filename=f"{artifact_name}_{job_id}.bin",
    )

@router.get("/diy/ota/download/{job_id}/firmware.bin")
async def get_ota_firmware(job_id: str, db: Session = Depends(get_db)):
    """
    Unauthenticated endpoint for ESP32 devices to download the firmware artifact over OTA.
    """
    job = db.query(BuildJob).filter(BuildJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    artifact_path = _resolve_build_artifact_path(job, "firmware")
    if job.status != JobStatus.artifact_ready or not artifact_path or not os.path.exists(artifact_path):
        raise HTTPException(status_code=400, detail="Artifact not ready or missing")

    return FileResponse(
        artifact_path,
        media_type="application/octet-stream",
        filename=f"firmware_{job_id}.bin",
    )

@router.get("/diy/build/{job_id}/logs")
async def get_build_logs(job_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    job = db.query(BuildJob).join(DiyProject).filter(BuildJob.id == job_id, DiyProject.user_id == current_user.user_id).first()
    if not job:
         raise HTTPException(status_code=404, detail="Job not found")
         
    if not job.log_path or not os.path.exists(job.log_path):
         return {"logs": ""}
         
    with open(job.log_path, "r") as f:
         return {"logs": f.read()}


import asyncio

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

    job = db.query(BuildJob).join(DiyProject).filter(
        BuildJob.id == job_id,
        DiyProject.user_id == current_user.user_id,
    ).first()

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

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
        build_job = (
            db.query(BuildJob)
            .join(DiyProject)
            .filter(BuildJob.id == job_id, DiyProject.user_id == current_user.user_id)
            .first()
        )
        if not build_job:
            raise HTTPException(status_code=404, detail="Job not found")
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
            "MQTT-managed ESP32 devices must publish telemetry to the MQTT state topic."
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

@router.post("/automation", response_model=AutomationResponse)
async def create_automation(auto: AutomationCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    new_auto = Automation(
        creator_id=user.user_id,
        name=auto.name,
        script_code=auto.script_code,
        is_enabled=auto.is_enabled
    )
    db.add(new_auto)
    db.commit()
    db.refresh(new_auto)
    return new_auto

@router.get("/automations", response_model=List[AutomationResponse])
async def list_automations(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.query(Automation).filter(Automation.creator_id == user.user_id).all()

import io
import sys
import traceback

@router.post("/automation/{automation_id}/trigger", response_model=TriggerResponse)
async def trigger_automation(automation_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """
    Manually trigger an automation script.
    Note: Real execution would happen in a sandboxed worker. This is a placeholder that updates timestamp.
    """
    auto = db.query(Automation).filter(Automation.id == automation_id, Automation.creator_id == user.user_id).first()
    if not auto:
        raise HTTPException(status_code=404, detail="Automation not found")
    
    # Execution logic
    auto.last_triggered = datetime.utcnow()
    
    # Capture output via custom print instead of global stdout hijacking
    output_buffer = io.StringIO()
    def custom_print(*args, **kwargs):
        kwargs['file'] = output_buffer
        print(*args, **kwargs)
    
    status = ExecutionStatus.success
    error_msg = None
    
    def run_script(code, env):
        exec(code, {}, env)

    try:
        local_env = {
            "device_id": None, # Provided if triggered via event
            "print": custom_print,
        }
        
        # Run in a separate thread to avoid blocking the event loop
        print(f"DEBUG: Starting automation script {auto.id} in thread")
        try:
            with anyio.fail_after(30):
                await anyio.to_thread.run_sync(run_script, auto.script_code, local_env)
            print(f"DEBUG: Automation script {auto.id} finished successfully")
        except (TimeoutError, anyio.get_cancelled_exc_class()):
            status = ExecutionStatus.failed
            error_msg = "Execution timed out after 30 seconds"
        except Exception:
            status = ExecutionStatus.failed
            error_msg = traceback.format_exc()
    except Exception as e:
        status = ExecutionStatus.failed
        error_msg = f"Setup error: {traceback.format_exc()}"
    finally:
        pass
        
    log_output = output_buffer.getvalue()
    if len(log_output) > 2000:
        log_output = log_output[:2000] + "...(truncated)"
    if not log_output:
        log_output = None
        
    execution_log = AutomationExecutionLog(
        automation_id=auto.id,
        triggered_at=auto.last_triggered,
        status=status,
        log_output=log_output,
        error_message=error_msg
    )
    
    db.add(execution_log)
    db.commit()
    db.refresh(execution_log)
    
    msg = f"Automation '{auto.name}' executed with status: {status.value}"
    return TriggerResponse(
        status=status,
        message=msg,
        log=AutomationLogResponse.model_validate(execution_log)
    )

# --- OTA (Simplified from previous) ---

@router.post("/ota/upload", response_model=FirmwareResponse)
async def upload_firmware(version: str, board: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    file_location = f"firmwares/{file.filename}"
    os.makedirs("firmwares", exist_ok=True)
    with open(file_location, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    fw = Firmware(version=version, board=board, filename=file.filename)
    db.add(fw)
    db.commit()
    db.refresh(fw)
    return fw

@router.get("/ota/latest/{board}", response_model=FirmwareResponse)
async def get_latest_firmware(board: str, db: Session = Depends(get_db)):
    fw = db.query(Firmware).filter(Firmware.board == board).order_by(Firmware.id.desc()).first()
    if not fw:
        raise HTTPException(status_code=404, detail="No firmware found")
    return fw

@router.get("/ota/download/{filename}")
async def download_firmware(filename: str):
    file_path = f"firmwares/{filename}"
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path, media_type='application/octet-stream', filename=filename)


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
        "automations": [{"name": a.name, "script": a.script_code} for a in automations]
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
