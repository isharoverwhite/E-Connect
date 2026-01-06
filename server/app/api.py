from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from typing import List, Optional
import shutil
import os
import uuid
from datetime import datetime, timedelta

from .models import (
    UserCreate, UserResponse, Token, TokenData,
    DeviceRegister, DeviceResponse, PinConfigCreate,
    AutomationCreate, AutomationResponse,
    DeviceHistoryCreate, DeviceHistoryResponse,
    FirmwareResponse, DeviceMode, AccountType, EventType,
    RoomCreate, RoomResponse
)
from .sql_models import (
    User, Device, PinConfiguration, Automation, DeviceHistory, 
    Firmware, Room, BackupArchive
)
from .database import get_db
from .auth import verify_password, get_password_hash, create_access_token, SECRET_KEY, ALGORITHM

router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")

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
        role: str = payload.get("role")
        if username is None:
            raise credentials_exception
        token_data = TokenData(username=username, role=role)
    except JWTError:
        raise credentials_exception
    
    user = db.query(User).filter(User.username == token_data.username).first()
    if user is None:
        raise credentials_exception
    return user

async def get_admin_user(current_user: User = Depends(get_current_user)):
    if current_user.account_type != AccountType.admin:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return current_user

# --- Auth Endpoints ---

@router.post("/auth/register", response_model=UserResponse)
async def register(user: UserCreate, db: Session = Depends(get_db)):
    # Check if user exists
    if db.query(User).filter(User.username == user.username).first():
        raise HTTPException(status_code=400, detail="Username already registered")
    
    hashed_password = get_password_hash(user.password)
    
    # Auto-admin if first user (optional logic)
    role = user.account_type
    if db.query(User).count() == 0:
        role = AccountType.admin
        
    new_user = User(
        fullname=user.fullname,
        username=user.username,
        authentication=hashed_password,
        account_type=role,
        ui_layout=user.ui_layout
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
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
    
    access_token = create_access_token(
        data={"sub": user.username, "role": user.account_type.value}
    )
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/users/me", response_model=UserResponse)
async def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.put("/users/me/layout", response_model=UserResponse)
async def update_layout(layout: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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
            is_active=False,
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
    
    device.is_active = True
    db.commit()
    return {"status": "approved", "device_id": device_id}

@router.get("/devices", response_model=List[DeviceResponse])
async def list_devices(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Users see their own devices? Admin sees all?
    if current_user.account_type == AccountType.admin:
        return db.query(Device).all()
    else:
        return db.query(Device).filter(Device.owner_id == current_user.user_id).all()

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

    # Placeholder: Log state change
    history = DeviceHistory(
        device_id=device_id,
        event_type=EventType.state_change,
        payload=str(command),
        changed_by=current_user.user_id
    )
    db.add(history)
    db.commit()
    return {"status": "sent", "command": command}

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

@router.post("/automation/{automation_id}/trigger")
async def trigger_automation(automation_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """
    Manually trigger an automation script.
    Note: Real execution would happen in a sandboxed worker. This is a placeholder that updates timestamp.
    """
    auto = db.query(Automation).filter(Automation.id == automation_id, Automation.creator_id == user.user_id).first()
    if not auto:
        raise HTTPException(status_code=404, detail="Automation not found")
    
    # Placeholder execution logic
    auto.last_triggered = datetime.utcnow()
    db.commit()
    
    return {"status": "triggered", "message": f"Automation '{auto.name}' queued for execution."}

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
