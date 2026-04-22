# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

from pydantic import BaseModel, Field, ConfigDict
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
    ui_layout: Optional[Any] = None

class UserCreate(UserBase):
    password: str = Field(..., min_length=8)

class UserResponse(UserBase):
    user_id: int
    created_at: Optional[datetime]

    model_config = ConfigDict(from_attributes=True)


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

    model_config = ConfigDict(from_attributes=True)


class HouseholdLocationBase(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    label: Optional[str] = Field(default=None, max_length=255)
    source: Literal["browser_geolocation", "manual_search", "manual_coordinates"] = "manual_search"


class HouseholdLocationCreate(HouseholdLocationBase):
    pass


class HouseholdLocationResponse(HouseholdLocationBase):
    id: int
    household_id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class SetupResponse(BaseModel):
    user: UserResponse
    household: HouseholdResponse
    home_location: HouseholdLocationResponse


class GeneralSettingsUpdate(BaseModel):
    timezone: Optional[str] = Field(default=None, max_length=64)
    house_temperature_device_id: Optional[str] = Field(default=None, max_length=36)


class GeneralSettingsResponse(BaseModel):
    household_id: int
    configured_timezone: Optional[str] = None
    effective_timezone: str
    timezone_source: Literal["setting", "runtime"]
    current_server_time: datetime
    timezone_options: List[str] = Field(default_factory=list)
    house_temperature_device_id: Optional[str] = None
    house_temperature_device_name: Optional[str] = None


class CurrentWeatherResponse(BaseModel):
    temperature: float
    weather_code: int
    description: str
    icon: str
    location_name: str
    latitude: float
    longitude: float
    is_day: Optional[bool] = None
    observed_at: Optional[str] = None


class HouseTemperatureResponse(BaseModel):
    device_id: str
    device_name: str
    room_name: Optional[str] = None
    source_label: Optional[str] = None
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    is_online: bool = False
    status: Literal["ok", "offline", "no_reading"]
    measured_at: Optional[datetime] = None


class InitialServerRequest(UserCreate):
    householdName: Optional[str] = None
    home_location: HouseholdLocationCreate


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


class ApiKeyCreateRequest(BaseModel):
    label: str = Field(..., min_length=1, max_length=120)


class ApiKeyResponse(BaseModel):
    key_id: str
    label: str
    token_prefix: str
    created_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None
    is_revoked: bool = False

    model_config = ConfigDict(from_attributes=True)


class ApiKeyCreateResponse(ApiKeyResponse):
    api_key: str

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

    model_config = ConfigDict(from_attributes=True)

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
    show_on_dashboard: bool = True

class DeviceCreate(DeviceBase):
    device_id: str # UUID from device
    pin_configurations: List[PinConfigCreate] = []

class DeviceVisibilityUpdate(BaseModel):
    show_on_dashboard: bool

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
    device_type: Optional[str] = None
    owner_id: int
    auth_status: AuthStatus
    conn_status: ConnStatus
    last_seen: Optional[datetime] = None
    pairing_requested_at: Optional[datetime] = None
    last_state: Optional[Dict[str, Any]] = None
    provisioning_project_id: Optional[str] = None
    board: Optional[str] = None
    provider: Optional[str] = None
    extension_name: Optional[str] = None
    installed_extension_id: Optional[str] = None
    device_schema_id: Optional[str] = None
    external_config: Optional[Dict[str, Any]] = None
    schema_snapshot: Optional[Dict[str, Any]] = None
    is_external: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    pin_configurations: List[PinConfigResponse] = []

    model_config = ConfigDict(from_attributes=True)


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
    
    model_config = ConfigDict(from_attributes=True)


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
    scheduled_for: Optional[datetime] = None
    log_output: Optional[str] = None
    error_message: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class AutomationResponse(AutomationCreate):
    id: int
    creator_id: int
    last_triggered: Optional[datetime]
    last_execution: Optional[AutomationLogResponse] = None
    schedule_type: Optional[str] = None
    timezone: Optional[str] = None
    schedule_hour: Optional[int] = None
    schedule_minute: Optional[int] = None
    schedule_weekdays: List[str] = Field(default_factory=list)
    next_run_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

class TriggerResponse(BaseModel):
    status: ExecutionStatus
    message: str
    log: Optional[AutomationLogResponse] = None


class AutomationScheduleContextResponse(BaseModel):
    effective_timezone: str
    timezone_source: Literal["setting", "runtime"]
    current_server_time: datetime

# --- History / Sensor Data ---
class DeviceHistoryCreate(BaseModel):
    event_type: EventType
    payload: str
    
class DeviceHistoryResponse(DeviceHistoryCreate):
    id: int
    device_id: str
    timestamp: datetime
    changed_by: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


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

    model_config = ConfigDict(from_attributes=True)


class SystemLogListResponse(BaseModel):
    entries: List[SystemLogResponse] = Field(default_factory=list)
    total: int = 0
    retention_days: int = 30
    effective_timezone: str
    timezone_source: Literal["setting", "runtime"]
    current_server_time: datetime
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
    effective_timezone: str
    timezone_source: Literal["setting", "runtime"]
    current_server_time: datetime
    latest_alert_at: Optional[datetime] = None
    latest_alert_message: Optional[str] = None
    latest_firmware_revision: Optional[str] = None


class FirmwareTemplateStatusResponse(BaseModel):
    source_repo: str
    auto_update_enabled: bool = True
    active_source: Literal["bundled", "release", "missing"]
    active_path: Optional[str] = None
    active_revision: Optional[str] = None
    active_release_tag: Optional[str] = None
    bundled_revision: Optional[str] = None
    installed_release_tag: Optional[str] = None
    latest_release_tag: Optional[str] = None
    latest_release_published_at: Optional[str] = None
    last_checked_at: Optional[str] = None
    last_install_at: Optional[str] = None
    update_available: bool = False
    last_error: Optional[str] = None


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
    config_name: Optional[str] = None
    config: Optional[Dict[str, Any]] = None

class DiyProjectCreate(DiyProjectBase):
    pass

class DiyProjectDeleteRequest(BaseModel):
    password: Optional[str] = None

class DiyProjectResponse(DiyProjectBase):
    id: str
    user_id: int
    current_config_id: Optional[str] = None
    pending_config: Optional[Dict[str, Any]] = None
    pending_config_id: Optional[str] = None
    pending_build_job_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ExtensionConfigField(BaseModel):
    key: str
    label: str
    type: Literal["string", "number", "boolean"]
    required: bool = False


class ExtensionTemperatureRangeResponse(BaseModel):
    min: int
    max: int


class ExtensionDeviceSchemaResponse(BaseModel):
    schema_id: str
    device_type: str
    name: str
    default_name: str
    description: Optional[str] = None
    card_type: Literal["light", "switch", "fan", "sensor"]
    capabilities: List[
        Literal["power", "brightness", "rgb", "color_temperature", "speed", "temperature", "humidity", "value"]
    ] = Field(default_factory=list)
    temperature_range: Optional[ExtensionTemperatureRangeResponse] = None
    config_fields: List[ExtensionConfigField] = Field(default_factory=list)


class InstalledExtensionResponse(BaseModel):
    extension_id: str
    manifest_version: str
    name: str
    version: str
    author: Optional[str] = None
    description: str
    provider_key: str
    provider_name: str
    package_runtime: str
    package_entrypoint: str
    package_root: Optional[str] = None
    archive_sha256: str
    manifest: Dict[str, Any] = Field(default_factory=dict)
    device_schemas: List[ExtensionDeviceSchemaResponse] = Field(default_factory=list)
    external_device_count: int = 0
    installed_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ExternalDeviceCreate(BaseModel):
    installed_extension_id: str = Field(..., min_length=1)
    device_schema_id: str = Field(..., min_length=1)
    name: Optional[str] = Field(default=None, max_length=255)
    room_id: Optional[int] = None
    config: Dict[str, Any] = Field(default_factory=dict)

class ProjectDeviceUsage(BaseModel):
    device_id: str
    name: str
    conn_status: ConnStatus
    auth_status: AuthStatus
    room_id: Optional[int] = None
    room_name: Optional[str] = None
    
    model_config = ConfigDict(from_attributes=True)

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
    staged_project_config: Optional[Dict[str, Any]] = None
    finished_at: Optional[datetime] = None
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    ota_token: Optional[str] = None
    ota_download_url: Optional[str] = None
    expected_firmware_version: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class ConfigHistoryEntryResponse(BaseModel):
    id: str
    project_id: str
    device_id: str
    board_profile: str
    config_name: str
    assigned_device_id: Optional[str] = None
    assigned_device_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    last_applied_at: Optional[datetime] = None
    latest_build_job_id: Optional[str] = None
    latest_build_status: Optional[JobStatus] = None
    latest_build_finished_at: Optional[datetime] = None
    latest_build_error: Optional[str] = None
    expected_firmware_version: Optional[str] = None
    is_pending: bool = False
    is_committed: bool = False
    config: Dict[str, Any] = Field(default_factory=dict)

class ConfigHistoryRenameRequest(BaseModel):
    config_name: str

class ConfigHistoryDeleteRequest(BaseModel):
    password: Optional[str] = None

class SerialSessionResponse(BaseModel):
    id: int
    port: str
    device_id: Optional[str] = None
    build_job_id: Optional[str] = None
    locked_by_user_id: int
    status: SerialSessionStatus
    created_at: datetime
    released_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

# --- Firmware (Legacy/OTA) ---
class FirmwareResponse(BaseModel):
    id: int
    version: str
    board: str
    filename: str
    uploaded_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SystemInfoResponse(BaseModel):
    cpu_percent: float
    memory_used: int
    memory_total: int
    ip_address: str
    os_name: str
