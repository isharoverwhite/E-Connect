from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Dict, Any
from datetime import datetime
from enum import Enum

# --- Enums ---
class AccountType(str, Enum):
    admin = "admin"
    parent = "parent"
    child = "child"

class HouseholdRole(str, Enum):
    owner = "owner"
    admin = "admin"
    member = "member"
    guest = "guest"

class AuthStatus(str, Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"

class ConnStatus(str, Enum):
    online = "online"
    offline = "offline"

class DeviceMode(str, Enum):
    no_code = "no-code"
    library = "library"

class PinMode(str, Enum):
    INPUT = "INPUT"
    OUTPUT = "OUTPUT"
    PWM = "PWM"
    ADC = "ADC"
    I2C = "I2C"

class EventType(str, Enum):
    state_change = "state_change"
    online = "online"
    offline = "offline"
    error = "error"
    command_requested = "command_requested"
    command_failed = "command_failed"

class JobStatus(str, Enum):
    draft_config = "draft_config"
    validated = "validated"
    queued = "queued"
    building = "building"
    artifact_ready = "artifact_ready"
    flashing = "flashing"
    flashed = "flashed"
    build_failed = "build_failed"
    flash_failed = "flash_failed"
    cancelled = "cancelled"

class SerialSessionStatus(str, Enum):
    locked = "locked"
    released = "released"

# --- User & Auth ---
class UserBase(BaseModel):
    fullname: str
    username: str = Field(..., min_length=3)
    account_type: AccountType = AccountType.parent
    ui_layout: Optional[Any] = None

class UserCreate(UserBase):
    password: str = Field(..., min_length=8)

class UserResponse(UserBase):
    user_id: int
    created_at: Optional[datetime]

    class Config:
        from_attributes = True

class HouseholdBase(BaseModel):
    name: str

class HouseholdCreate(HouseholdBase):
    pass

class HouseholdResponse(HouseholdBase):
    household_id: int
    created_at: Optional[datetime]

    class Config:
        from_attributes = True

class SetupResponse(BaseModel):
    user: UserResponse
    household: HouseholdResponse

class InitialServerRequest(UserCreate):
    householdName: Optional[str] = None


class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None
    account_type: Optional[str] = None
    household_id: Optional[int] = None
    household_role: Optional[str] = None

# --- Pin Configuration ---
class PinConfigCreate(BaseModel):
    gpio_pin: int
    mode: PinMode
    function: Optional[str] = None
    label: Optional[str] = None
    v_pin: Optional[int] = None
    extra_params: Optional[Dict[str, Any]] = None

class PinConfigResponse(PinConfigCreate):
    id: int
    device_id: str

    class Config:
        from_attributes = True

# --- Device ---
class DeviceBase(BaseModel):
    mac_address: str
    name: str
    mode: DeviceMode = DeviceMode.library
    firmware_version: Optional[str] = None
    topic_pub: Optional[str] = None
    topic_sub: Optional[str] = None

class DeviceCreate(DeviceBase):
    device_id: str # UUID from device
    pin_configurations: List[PinConfigCreate] = []

class DeviceRegister(BaseModel):
    # Payload from device during handshake
    device_id: Optional[str] = None
    mac_address: str
    name: str
    mode: DeviceMode = DeviceMode.library
    firmware_version: Optional[str] = None
    pins: List[PinConfigCreate] = []

class DeviceResponse(DeviceBase):
    device_id: str
    room_id: Optional[int] = None
    owner_id: int
    auth_status: AuthStatus
    conn_status: ConnStatus
    last_seen: Optional[datetime] = None
    last_state: Optional[Dict[str, Any]] = None
    pin_configurations: List[PinConfigResponse] = []

    class Config:
        from_attributes = True

# --- Room ---
class RoomCreate(BaseModel):
    name: str

class RoomResponse(RoomCreate):
    room_id: int
    user_id: int
    
    class Config:
        from_attributes = True

# --- Automation ---
class AutomationCreate(BaseModel):
    name: str
    script_code: str
    is_enabled: bool = True

class AutomationResponse(AutomationCreate):
    id: int
    creator_id: int
    last_triggered: Optional[datetime]

    class Config:
        from_attributes = True

class ExecutionStatus(str, Enum):
    success = "success"
    failed = "failed"

class AutomationLogResponse(BaseModel):
    id: int
    automation_id: int
    triggered_at: datetime
    status: ExecutionStatus
    log_output: Optional[str] = None
    error_message: Optional[str] = None

    class Config:
        from_attributes = True

class TriggerResponse(BaseModel):
    status: ExecutionStatus
    message: str
    log: Optional[AutomationLogResponse] = None

# --- History / Sensor Data ---
class DeviceHistoryCreate(BaseModel):
    event_type: EventType
    payload: str
    
class DeviceHistoryResponse(DeviceHistoryCreate):
    id: int
    device_id: str
    timestamp: datetime
    changed_by: Optional[int] = None

    class Config:
        from_attributes = True

# --- DIY Builder ---
class PinMappingItem(BaseModel):
    gpio_pin: int
    mode: PinMode
    function: Optional[str] = None
    label: Optional[str] = None

class GenerateConfigRequest(BaseModel):
    board: str
    pins: List[PinMappingItem]
    wifi_ssid: Optional[str] = None
    wifi_password: Optional[str] = None
    mqtt_broker: Optional[str] = None

class GenerateConfigResponse(BaseModel):
    status: str
    config: Dict[str, Any]

class DiyProjectBase(BaseModel):
    name: str
    board_profile: str
    config: Optional[Dict[str, Any]] = None

class DiyProjectCreate(DiyProjectBase):
    pass

class DiyProjectResponse(DiyProjectBase):
    id: str
    user_id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class BuildJobResponse(BaseModel):
    id: str
    project_id: str
    status: JobStatus
    artifact_path: Optional[str] = None
    log_path: Optional[str] = None
    finished_at: Optional[datetime] = None
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class SerialSessionResponse(BaseModel):
    id: int
    port: str
    device_id: Optional[str] = None
    build_job_id: Optional[str] = None
    locked_by_user_id: int
    status: SerialSessionStatus
    created_at: datetime
    released_at: Optional[datetime] = None

    class Config:
        from_attributes = True

# --- Firmware (Legacy/OTA) ---
class FirmwareResponse(BaseModel):
    id: int
    version: str
    board: str
    filename: str
    uploaded_at: datetime

    class Config:
        from_attributes = True
