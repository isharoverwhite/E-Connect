from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from typing import List
from .models import DeviceConfig
from .sql_models import Device
from .database import get_db

router = APIRouter()

@router.post("/config", response_model=DeviceConfig)
async def upload_config(config: DeviceConfig, db: Session = Depends(get_db)):
    """
    Receive configuration from the device (or manual upload).
    """
    # Check if device exists
    db_device = db.query(Device).filter(Device.uuid == config.device.uuid).first()
    
    if db_device:
        # Update existing
        db_device.name = config.device.name
        db_device.board = config.device.board
        db_device.mode = config.device.mode
        db_device.is_authorized = config.device.is_authorized
        db_device.version = config.device.version
        db_device.connectivity = config.connectivity.dict()
        db_device.hardware_config = config.hardware_config.dict()
    else:
        # Create new
        db_device = Device(
            uuid=config.device.uuid,
            name=config.device.name,
            board=config.device.board,
            mode=config.device.mode,
            is_authorized=config.device.is_authorized,
            version=config.device.version,
            created_at=config.device.created_at,
            connectivity=config.connectivity.dict(),
            hardware_config=config.hardware_config.dict()
        )
        db.add(db_device)
    
    db.commit()
    db.refresh(db_device)
    
    return config

@router.get("/devices", response_model=List[DeviceConfig])
async def list_devices(db: Session = Depends(get_db)):
    """
    List all registered devices.
    """
    devices = db.query(Device).all()
    return [
        DeviceConfig(
            device={
                "uuid": d.uuid,
                "name": d.name,
                "board": d.board,
                "mode": d.mode,
                "is_authorized": d.is_authorized,
                "version": d.version,
                "created_at": str(d.created_at)
            },
            connectivity=d.connectivity,
            hardware_config=d.hardware_config
        ) for d in devices
    ]

@router.get("/device/{uuid}", response_model=DeviceConfig)
async def get_device_config(uuid: str, db: Session = Depends(get_db)):
    d = db.query(Device).filter(Device.uuid == uuid).first()
    if not d:
        raise HTTPException(status_code=404, detail="Device not found")
    
    return DeviceConfig(
        device={
            "uuid": d.uuid,
            "name": d.name,
            "board": d.board,
            "mode": d.mode,
            "is_authorized": d.is_authorized,
            "version": d.version,
            "created_at": str(d.created_at)
        },
        connectivity=d.connectivity,
        hardware_config=d.hardware_config
    )
