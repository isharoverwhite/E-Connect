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

class UserApprovalStatus(str, Enum):
    pending = "pending"
    approved = "approved"
    revoked = "revoked"

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


class SystemLogSeverity(str, Enum):
    info = "info"
    warning = "warning"
    error = "error"
    critical = "critical"


class SystemLogCategory(str, Enum):
    lifecycle = "lifecycle"
    connectivity = "connectivity"
    firmware = "firmware"
    health = "health"

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


class AutomationNodeType(str, Enum):
    trigger = "trigger"
    condition = "condition"
    action = "action"


class AutomationTriggerSource(str, Enum):
    manual = "manual"
    device_state = "device_state"
    schedule = "schedule"


class AutomationGraphNode(BaseModel):
    id: str = Field(..., min_length=1)
    type: AutomationNodeType
    kind: str = Field(..., min_length=1)
    label: Optional[str] = None
    config: Dict[str, Any] = Field(default_factory=dict)


class AutomationGraphEdge(BaseModel):
    source_node_id: str = Field(..., min_length=1)
    source_port: str = Field(..., min_length=1)
    target_node_id: str = Field(..., min_length=1)
    target_port: str = Field(..., min_length=1)


class AutomationGraph(BaseModel):
    nodes: List[AutomationGraphNode] = Field(default_factory=list)
    edges: List[AutomationGraphEdge] = Field(default_factory=list)

# --- User & Auth ---
class UserBase(BaseModel):
    fullname: str
    username: str = Field(..., min_length=3)
    account_type: AccountType = AccountType.parent
    approval_status: UserApprovalStatus = UserApprovalStatus.pending
    ui_layout: Optional[Any] = None

class UserCreate(UserBase):
    password: str = Field(..., min_length=8)

class UserResponse(UserBase):
    user_id: int
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


class ManagedUserResponse(UserResponse):
    household_role: Optional[HouseholdRole] = None

class HouseholdBase(BaseModel):
    name: str

class HouseholdCreate(HouseholdBase):
    pass

class HouseholdResponse(HouseholdBase):
    household_id: int
    created_at: Optional[datetime]
    timezone: Optional[str] = None

    class Config:
        from_attributes = True

class SetupResponse(BaseModel):
    user: UserResponse
    household: HouseholdResponse


class GeneralSettingsUpdate(BaseModel):
    timezone: Optional[str] = Field(default=None, max_length=64)


class GeneralSettingsResponse(BaseModel):
    household_id: int
    configured_timezone: Optional[str] = None
    effective_timezone: str
    timezone_source: Literal["setting", "runtime"]
    current_server_time: datetime
    timezone_options: List[str] = Field(default_factory=list)

class InitialServerRequest(UserCreate):
    householdName: Optional[str] = None


class Token(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None
    token_type: str
    access_token_expires_at: Optional[datetime] = None
    refresh_token_expires_at: Optional[datetime] = None
    keep_login: bool = False


class RefreshTokenRequest(BaseModel):
    refresh_token: str

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
    firmware_revision: Optional[str] = None
    firmware_version: Optional[str] = None
    ip_address: Optional[str] = None
    topic_pub: Optional[str] = None
    topic_sub: Optional[str] = None

class DeviceCreate(DeviceBase):
    device_id: str # UUID from device
    pin_configurations: List[PinConfigCreate] = []

class DeviceRegister(BaseModel):
    # Payload from device during handshake
    device_id: Optional[str] = None
    project_id: Optional[str] = None
    secret_key: Optional[str] = None
    force_pairing_request: bool = False
    mac_address: Optional[str] = None
    name: Optional[str] = None
    mode: DeviceMode = DeviceMode.library
    firmware_revision: Optional[str] = None
    firmware_version: Optional[str] = None
    ip_address: Optional[str] = None
    pins: List[PinConfigCreate] = []

class DeviceResponse(DeviceBase):
    device_id: str
    room_id: Optional[int] = None
    room_name: Optional[str] = None
    owner_id: int
    auth_status: AuthStatus
    conn_status: ConnStatus
    last_seen: Optional[datetime] = None
    pairing_requested_at: Optional[datetime] = None
    last_state: Optional[Dict[str, Any]] = None
    provisioning_project_id: Optional[str] = None
    pin_configurations: List[PinConfigResponse] = []

    class Config:
        from_attributes = True


class DeviceAvailabilityResponse(BaseModel):
    device_id: str
    room_id: Optional[int] = None
    room_name: Optional[str] = None
    auth_status: AuthStatus
    conn_status: ConnStatus
    pairing_requested_at: Optional[datetime] = None


class DeviceHandshakeResponse(DeviceResponse):
    secret_verified: bool = False
    project_id: Optional[str] = None

# --- Room ---
class RoomCreate(BaseModel):
    name: str
    allowed_user_ids: List[int] = Field(default_factory=list)


class RoomAccessUpdate(BaseModel):
    allowed_user_ids: List[int] = Field(default_factory=list)

class RoomUpdate(BaseModel):
    name: str

class RoomResponse(RoomCreate):
    room_id: int
    user_id: int
    household_id: Optional[int] = None
    assigned_user_ids: List[int] = Field(default_factory=list)
    
    class Config:
        from_attributes = True


class DeviceApprovalRequest(BaseModel):
    room_id: int

# --- Automation ---
class AutomationCreate(BaseModel):
    name: str
    is_enabled: bool = True
    graph: AutomationGraph


class AutomationUpdate(AutomationCreate):
    pass

class ExecutionStatus(str, Enum):
    success = "success"
    failed = "failed"

class AutomationLogResponse(BaseModel):
    id: int
    automation_id: int
    triggered_at: datetime
    status: ExecutionStatus
    trigger_source: AutomationTriggerSource = AutomationTriggerSource.manual
    log_output: Optional[str] = None
    error_message: Optional[str] = None

    class Config:
        from_attributes = True


class AutomationResponse(AutomationCreate):
    id: int
    creator_id: int
    last_triggered: Optional[datetime]
    last_execution: Optional[AutomationLogResponse] = None

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


class SystemLogResponse(BaseModel):
    id: int
    occurred_at: datetime
    severity: SystemLogSeverity
    category: SystemLogCategory
    event_code: str
    message: str
    device_id: Optional[str] = None
    firmware_version: Optional[str] = None
    firmware_revision: Optional[str] = None
    details: Optional[Dict[str, Any]] = None
    is_read: bool = False
    read_at: Optional[datetime] = None
    read_by_user_id: Optional[int] = None

    class Config:
        from_attributes = True


class SystemLogListResponse(BaseModel):
    entries: List[SystemLogResponse] = Field(default_factory=list)
    total: int = 0
    retention_days: int = 30
    oldest_occurred_at: Optional[datetime] = None
    latest_occurred_at: Optional[datetime] = None


class SystemStatusResponse(BaseModel):
    overall_status: Literal["healthy", "warning", "critical"]
    database_status: str
    mqtt_status: str
    started_at: Optional[datetime] = None
    uptime_seconds: int = 0
    advertised_host: Optional[str] = None
    cpu_percent: float = 0.0
    memory_used: int = 0
    memory_total: int = 0
    storage_used: int = 0
    storage_total: int = 0
    retention_days: int = 30
    active_alert_count: int = 0
    latest_alert_at: Optional[datetime] = None
    latest_alert_message: Optional[str] = None


class SystemLogAcknowledgeResponse(BaseModel):
    updated_count: int = 0

# --- DIY Builder ---
class PinMappingItem(BaseModel):
    gpio_pin: int
    mode: PinMode
    function: Optional[str] = None
    label: Optional[str] = None

class GenerateConfigRequest(BaseModel):
    board: str
    pins: List[PinMappingItem]
    wifi_credential_id: Optional[int] = None
    wifi_ssid: Optional[str] = None
    wifi_password: Optional[str] = None
    mqtt_broker: Optional[str] = None

class GenerateConfigResponse(BaseModel):
    status: str
    config: Dict[str, Any]

class FirmwareNetworkTargetsResponse(BaseModel):
    advertised_host: str
    api_base_url: str
    mqtt_broker: str
    mqtt_port: int
    webapp_protocol: str
    webapp_port: int
    target_key: str
    warning: Optional[str] = None
    stale_project_count: int = 0
    stale_device_count: int = 0
    cpu_percent: float = 0.0
    memory_used: int = 0
    memory_total: int = 0
    storage_used: int = 0
    storage_total: int = 0

class DiyProjectBase(BaseModel):
    name: str
    board_profile: str
    room_id: Optional[int] = None
    wifi_credential_id: Optional[int] = None
    config: Optional[Dict[str, Any]] = None

class DiyProjectCreate(DiyProjectBase):
    pass

class DiyProjectDeleteRequest(BaseModel):
    password: Optional[str] = None

class DiyProjectResponse(DiyProjectBase):
    id: str
    user_id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class ProjectDeviceUsage(BaseModel):
    device_id: str
    name: str
    conn_status: ConnStatus
    auth_status: AuthStatus
    room_id: Optional[int] = None
    room_name: Optional[str] = None
    
    class Config:
        from_attributes = True

class DiyProjectUsageResponse(DiyProjectResponse):
    usage_state: Literal["unused", "in_use"]
    devices: List[ProjectDeviceUsage] = []


class WifiCredentialBase(BaseModel):
    ssid: str = Field(..., min_length=1)


class WifiCredentialCreate(WifiCredentialBase):
    password: str = Field(..., min_length=1)


class WifiCredentialUpdate(WifiCredentialCreate):
    pass


class WifiCredentialRevealRequest(BaseModel):
    password: Optional[str] = None


class WifiCredentialResponse(WifiCredentialBase):
    id: int
    household_id: int
    masked_password: str
    usage_count: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class WifiCredentialSecretResponse(WifiCredentialBase):
    id: int
    password: str

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
    ota_token: Optional[str] = None
    expected_firmware_version: Optional[str] = None

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


class SystemInfoResponse(BaseModel):
    cpu_percent: float
    memory_used: int
    memory_total: int
    ip_address: str
    os_name: str
