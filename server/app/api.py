from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, BackgroundTasks
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from typing import List, Optional, Any
import ast
import json
import shutil
import os
import uuid
from datetime import datetime, timedelta

from .mqtt import mqtt_manager

from .models import (
    UserCreate, UserResponse, Token, TokenData, InitialServerRequest,
    DeviceRegister, DeviceResponse, PinConfigCreate,
    AutomationCreate, AutomationResponse,
    DeviceHistoryCreate, DeviceHistoryResponse,
    FirmwareResponse, DeviceMode, AccountType, EventType,
    RoomCreate, RoomResponse, GenerateConfigRequest, GenerateConfigResponse,
    SetupResponse, HouseholdResponse, TriggerResponse, ExecutionStatus, AutomationLogResponse,
    DiyProjectCreate, DiyProjectResponse, BuildJobResponse, JobStatus, SerialSessionResponse
)
from .sql_models import (
    User, Device, PinConfiguration, Automation, DeviceHistory, 
    Firmware, Room, BackupArchive, Household, HouseholdMembership, HouseholdRole,
    AuthStatus, ConnStatus, AutomationExecutionLog, DiyProject, BuildJob, SerialSession, SerialSessionStatus
)
from .database import get_db
from .auth import verify_password, get_password_hash, create_access_token, SECRET_KEY, ALGORITHM
from .services.builder import build_firmware_task
from .services.diy_validation import validate_diy_config

router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")


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
        
    # Attach session household context dynamically for route handlers
    setattr(user, "current_household_id", token_data.household_id)
    setattr(user, "current_household_role", token_data.household_role)
    
    return user

async def get_admin_user(current_user: User = Depends(get_current_user)):
    if current_user.account_type != AccountType.admin and current_user.current_household_role != HouseholdRole.owner:
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
    import logging
    logger = logging.getLogger(__name__)
    
    if db.query(User).filter(User.username == user_data.username).first():
        raise HTTPException(status_code=400, detail="Username already registered")
        
    hashed_password = get_password_hash(user_data.password)
    
    # Extract explicitly via query to avoid SQLA caching issues
    admin_membership = db.query(HouseholdMembership).filter(HouseholdMembership.user_id == admin.user_id).first()
    admin_household_id = admin_membership.household_id if admin_membership else None
    
    print(f"DEBUG: admin.user_id = {admin.user_id}")
    print(f"DEBUG: admin_membership = {admin_membership}")
    print(f"DEBUG: admin_household_id = {admin_household_id}")
    
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
    if admin_household_id is not None:
        print(f"DEBUG: Creating membership for user {new_user.user_id} in household {admin_household_id}")
        membership = HouseholdMembership(
            household_id=admin_household_id,
            user_id=new_user.user_id,
            role=HouseholdRole.member
        )
        db.add(membership)
        db.commit()
    else:
        print("DEBUG: admin_household_id was None, skipped membership creation")
        
    return new_user

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
async def create_room(room: RoomCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    new_room = Room(name=room.name, user_id=current_user.user_id)
    db.add(new_room)
    db.commit()
    db.refresh(new_room)
    return new_room

@router.get("/rooms", response_model=List[RoomResponse])
async def list_rooms(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Room).filter(Room.user_id == current_user.user_id).all()


@router.post("/config", response_model=DeviceResponse)
async def register_device_handshake(
    payload: DeviceRegister, 
    db: Session = Depends(get_db)
):
    """
    Device Handshake: Register or Update Config.
    If device sends auth headers in future, verify here.
    For now, open handshake or simple ID checks.
    """
    
    # Check if device exists
    if payload.device_id:
        device = db.query(Device).filter(Device.device_id == payload.device_id).first()
    else:
        # Check by MAC address if ID not provided? Or just create new?
        # Use Case 6: Assign Random UUID
        device = db.query(Device).filter(Device.mac_address == payload.mac_address).first()
    
    # Default owner needs to be assigned. 
    # For handshake without user context, reject or assign to default admin?
    # Requirement says 'is_active' = false (pending approval).
    # We assign to first admin found if new? Or require 'owner_id' in payload?
    # The payload from ESP usually doesn't know owner_id.
    # Logic: Assign to the first admin found, set is_active=False.
    
    admin = db.query(User).filter(User.account_type == AccountType.admin).first()
    if not admin:
        # Fallback if no admin exists yet? Create temp pending?
        # For simplicity, ensure an admin exists or error
        pass # Allow creating without admin? No foreign key fails.
        if not admin:
             raise HTTPException(status_code=400, detail="System not initialized. No admin found.")

    if not device:
        # Create New Device
        new_uuid = payload.device_id if payload.device_id else str(uuid.uuid4())
        device = Device(
            device_id=new_uuid,
            mac_address=payload.mac_address,
            name=payload.name,
            owner_id=admin.user_id, # Assign to admin initially
            auth_status=AuthStatus.pending,
            conn_status=ConnStatus.online,
            mode=payload.mode,
            firmware_version=payload.firmware_version,
            last_seen=datetime.utcnow()
        )
        db.add(device)
        db.commit()
        db.refresh(device)
    else:
        # Update Existing
        device.name = payload.name
        device.firmware_version = payload.firmware_version
        device.mode = payload.mode
        device.last_seen = datetime.utcnow()
        # device.mac_address -> usually constant, but update if changed?
        
    # Handle Pin Configs (Re-write all)
    # Delete old
    db.query(PinConfiguration).filter(PinConfiguration.device_id == device.device_id).delete()
    
    # Add new
    for pin in payload.pins:
        db_pin = PinConfiguration(
            device_id=device.device_id,
            gpio_pin=pin.gpio_pin,
            mode=pin.mode,
            function=pin.function,
            label=pin.label,
            v_pin=pin.v_pin,
            extra_params=pin.extra_params
        )
        db.add(db_pin)
    
    db.commit()
    db.refresh(device)
    return device

@router.post("/device/{device_id}/approve")
async def approve_device(device_id: str, db: Session = Depends(get_db), admin: User = Depends(get_admin_user)):
    device = db.query(Device).filter(Device.device_id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    
    device.auth_status = AuthStatus.approved
    
    # Auto-provision widgets to admin's layout
    layout = admin.ui_layout or []
    if isinstance(layout, dict) and "widgets" in layout:
        widgets = layout["widgets"]
    elif isinstance(layout, list):
        widgets = layout
    else:
        widgets = []
        
    for pin in device.pin_configurations:
        widget_type = "text"
        if pin.mode == "OUTPUT":
            widget_type = "switch"
        elif pin.mode == "INPUT":
            widget_type = "status"
            
        widgets.append({
            "i": str(uuid.uuid4()),
            "x": 0, "y": 0, "w": 2, "h": 2,
            "type": widget_type,
            "deviceId": device_id,
            "pin": pin.gpio_pin,
            "label": pin.label or f"{pin.function or 'Pin'} {pin.gpio_pin}"
        })
        
    admin.ui_layout = widgets
    
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

@router.get("/devices", response_model=List[DeviceResponse])
async def list_devices(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Users see their own devices? Admin sees all?
    if current_user.account_type == AccountType.admin:
        devices = db.query(Device).all()
    else:
        devices = db.query(Device).filter(
            Device.owner_id == current_user.user_id,
            Device.auth_status == AuthStatus.approved
        ).all()

    return [_attach_runtime_state(db, device) for device in devices]

@router.delete("/device/{device_id}")
async def delete_device(device_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Delete a device and all its cascaded configuration/history.
    """
    device = db.query(Device).filter(Device.device_id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
        
    # Permission check: Only owner or admin can delete
    if device.owner_id != current_user.user_id and current_user.account_type != AccountType.admin:
        raise HTTPException(status_code=403, detail="Not authorized to delete this device")
        
    db.delete(device)
    db.commit()
    return {"status": "success", "detail": f"Device {device_id} deleted."}

@router.post("/device/{device_id}/command")
async def send_command(device_id: str, command: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Send a command to the device (Real-time).
    For now, this just logs the command as a History event 'state_change'
    In production, this would publish to MQTT or WebSocket.
    """
    device = db.query(Device).filter(Device.device_id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    
    # Permission check (Owner or Admin)
    if device.owner_id != current_user.user_id and current_user.account_type != AccountType.admin:
        raise HTTPException(status_code=403, detail="Not authorized")

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
    Get the most recent command sent to the device (Polling fallback).
    """
    cmd = db.query(DeviceHistory).filter(
        DeviceHistory.device_id == device_id, 
        DeviceHistory.event_type == EventType.state_change
    ).order_by(DeviceHistory.timestamp.desc()).first()
    
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

@router.post("/diy/projects", response_model=DiyProjectResponse)
async def create_diy_project(project: DiyProjectCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    new_project = DiyProject(
        id=str(uuid.uuid4()),
        user_id=current_user.user_id,
        name=project.name,
        board_profile=project.board_profile,
        config=project.config
    )
    db.add(new_project)
    db.commit()
    db.refresh(new_project)
    return new_project

@router.get("/diy/projects", response_model=List[DiyProjectResponse])
async def list_diy_projects(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(DiyProject).filter(DiyProject.user_id == current_user.user_id).all()

@router.get("/diy/projects/{project_id}", response_model=DiyProjectResponse)
async def get_diy_project(project_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    project = db.query(DiyProject).filter(DiyProject.id == project_id, DiyProject.user_id == current_user.user_id).first()
    if not project:
         raise HTTPException(status_code=404, detail="Project not found")
    return project

@router.put("/diy/projects/{project_id}", response_model=DiyProjectResponse)
async def update_diy_project(project_id: str, project_update: DiyProjectCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    project = db.query(DiyProject).filter(DiyProject.id == project_id, DiyProject.user_id == current_user.user_id).first()
    if not project:
         raise HTTPException(status_code=404, detail="Project not found")
    project.name = project_update.name
    project.board_profile = project_update.board_profile
    project.config = project_update.config
    db.commit()
    db.refresh(project)
    return project

@router.post("/diy/build", response_model=BuildJobResponse)
async def trigger_diy_build(project_id: str, background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    project = db.query(DiyProject).filter(DiyProject.id == project_id, DiyProject.user_id == current_user.user_id).first()
    if not project:
         raise HTTPException(status_code=404, detail="Project not found")

    _, validation_errors, validation_warnings = validate_diy_config(project.board_profile, project.config)
    if validation_errors:
         raise HTTPException(status_code=400, detail={"error": "validation", "messages": validation_errors})
         
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
async def get_build_job(job_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    job = db.query(BuildJob).join(DiyProject).filter(BuildJob.id == job_id, DiyProject.user_id == current_user.user_id).first()
    if not job:
         raise HTTPException(status_code=404, detail="Job not found")
    return job

@router.get("/diy/build/{job_id}/artifact")
async def get_build_artifact(job_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    job = db.query(BuildJob).join(DiyProject).filter(BuildJob.id == job_id, DiyProject.user_id == current_user.user_id).first()
    if not job:
         raise HTTPException(status_code=404, detail="Job not found")
         
    if job.status != JobStatus.artifact_ready or not job.artifact_path or not os.path.exists(job.artifact_path):
         raise HTTPException(status_code=400, detail="Artifact not ready or missing")
         
    return FileResponse(job.artifact_path, media_type='application/octet-stream', filename=f"firmware_{job_id}.bin")

@router.get("/diy/build/{job_id}/logs")
async def get_build_logs(job_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    job = db.query(BuildJob).join(DiyProject).filter(BuildJob.id == job_id, DiyProject.user_id == current_user.user_id).first()
    if not job:
         raise HTTPException(status_code=404, detail="Job not found")
         
    if not job.log_path or not os.path.exists(job.log_path):
         raise HTTPException(status_code=404, detail="Log missing")
         
    with open(job.log_path, "r") as f:
         return {"logs": f.read()}

@router.post("/serial/lock", response_model=SerialSessionResponse)
async def acquire_serial_lock(
    device_id: str = "generic",
    port: str = "default",
    job_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
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
async def get_serial_status(port: str = "default", db: Session = Depends(get_db)):
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
async def get_history(device_id: str, db: Session = Depends(get_db)):
    return db.query(DeviceHistory).filter(DeviceHistory.device_id == device_id).order_by(DeviceHistory.timestamp.desc()).limit(50).all()


@router.get("/device/{device_id}/export")
async def export_history_csv(device_id: str, db: Session = Depends(get_db)):
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
    
    # Capture output
    output_buffer = io.StringIO()
    old_stdout = sys.stdout
    sys.stdout = output_buffer
    
    status = ExecutionStatus.success
    error_msg = None
    
    try:
        # Minimal environment for the script
        local_env = {
            "device_id": None, # Provided if triggered via event
            "print": print,
        }
        exec(auto.script_code, {"__builtins__": {}}, local_env)
    except Exception as e:
        status = ExecutionStatus.failed
        error_msg = traceback.format_exc()
        # Fallback if too long
        if len(error_msg) > 1000:
            error_msg = error_msg[-1000:]
    finally:
        sys.stdout = old_stdout
        
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
async def create_device_backup(device_id: str, note: str, db: Session = Depends(get_db)):
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
async def restore_device_backup(device_id: str, archive_id: int, db: Session = Depends(get_db)):
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
