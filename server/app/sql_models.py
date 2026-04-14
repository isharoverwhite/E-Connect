# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

from sqlalchemy import Column, Integer, String, Boolean, JSON, DateTime, Text, ForeignKey, Enum, TIMESTAMP, UniqueConstraint, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base
import enum

class AccountType(str, enum.Enum):
    admin = "admin"
    parent = "parent"
    child = "child"

class HouseholdRole(str, enum.Enum):
    owner = "owner"
    admin = "admin"
    member = "member"
    guest = "guest"

class AuthStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"

class ConnStatus(str, enum.Enum):
    online = "online"
    offline = "offline"

class DeviceMode(str, enum.Enum):
    no_code = "no-code"
    library = "library"
    portableDashboard = "portableDashboard"

class PinMode(str, enum.Enum):
    INPUT = "INPUT"
    OUTPUT = "OUTPUT"
    PWM = "PWM"
    ADC = "ADC"
    I2C = "I2C"

class EventType(str, enum.Enum):
    state_change = "state_change"
    online = "online"
    offline = "offline"
    error = "error"
    command_requested = "command_requested"
    command_failed = "command_failed"


class SystemLogSeverity(str, enum.Enum):
    info = "info"
    warning = "warning"
    error = "error"
    critical = "critical"


class SystemLogCategory(str, enum.Enum):
    lifecycle = "lifecycle"
    connectivity = "connectivity"
    firmware = "firmware"
    health = "health"
    automation = "automation"

class JobStatus(str, enum.Enum):
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

class User(Base):
    __tablename__ = "users"

    user_id = Column(Integer, primary_key=True, autoincrement=True)
    fullname = Column(String(255), nullable=False)
    username = Column(String(100), nullable=False, unique=True)
    authentication = Column(String(255), nullable=False) # hashed_password
    account_type = Column(Enum(AccountType), default=AccountType.parent)
    ui_layout = Column(JSON, comment='Lưu cấu hình Grid Layout cá nhân của từng user')
    created_at = Column(TIMESTAMP, server_default=func.now())

    rooms = relationship("Room", back_populates="user")
    devices = relationship("Device", back_populates="owner")
    automations = relationship("Automation", back_populates="creator")
    history_logs = relationship("DeviceHistory", back_populates="user")
    memberships = relationship("HouseholdMembership", back_populates="user", cascade="all, delete-orphan")
    api_keys = relationship("ApiKey", back_populates="user", cascade="all, delete-orphan")

class Household(Base):
    __tablename__ = "households"

    household_id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    timezone = Column(String(64), nullable=True, comment="IANA timezone override for server runtime behavior")
    created_at = Column(TIMESTAMP, server_default=func.now())

    memberships = relationship("HouseholdMembership", back_populates="household", cascade="all, delete-orphan")
    rooms = relationship("Room", back_populates="household")
    wifi_credentials = relationship("WifiCredential", back_populates="household", cascade="all, delete-orphan")

class HouseholdMembership(Base):
    __tablename__ = "household_memberships"

    id = Column(Integer, primary_key=True, autoincrement=True)
    household_id = Column(Integer, ForeignKey("households.household_id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.user_id"), nullable=False)
    role = Column(Enum(HouseholdRole), default=HouseholdRole.member)
    joined_at = Column(TIMESTAMP, server_default=func.now())

    household = relationship("Household", back_populates="memberships")
    user = relationship("User", back_populates="memberships")


class ApiKey(Base):
    __tablename__ = "api_keys"

    key_id = Column(String(64), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.user_id"), nullable=False, index=True)
    label = Column(String(120), nullable=False)
    token_prefix = Column(String(80), nullable=False, unique=True)
    secret_hash = Column(String(64), nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now())
    last_used_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="api_keys")

class Room(Base):
    __tablename__ = "rooms"

    room_id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.user_id"), nullable=False)
    household_id = Column(Integer, ForeignKey("households.household_id"), nullable=True)
    name = Column(String(255), nullable=False)

    user = relationship("User", back_populates="rooms")
    household = relationship("Household", back_populates="rooms")
    devices = relationship("Device", back_populates="room")
    permissions = relationship("RoomPermission", back_populates="room", cascade="all, delete-orphan")


class RoomPermission(Base):
    __tablename__ = "room_permissions"
    __table_args__ = (UniqueConstraint("room_id", "user_id", name="uq_room_permissions_room_user"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    room_id = Column(Integer, ForeignKey("rooms.room_id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.user_id"), nullable=False)
    can_control = Column(Boolean, nullable=False, default=True)
    granted_at = Column(TIMESTAMP, server_default=func.now())

    room = relationship("Room", back_populates="permissions")
    user = relationship("User")

class Device(Base):
    __tablename__ = "devices"

    device_id = Column(String(36), primary_key=True, comment='UUID v4 duy nhất')
    mac_address = Column(String(17), nullable=False, unique=True)
    name = Column(String(255), nullable=False)
    room_id = Column(Integer, ForeignKey("rooms.room_id"))
    owner_id = Column(Integer, ForeignKey("users.user_id"), nullable=False)
    
    auth_status = Column(Enum(AuthStatus), default=AuthStatus.pending, comment='Lifecycle authorization status')
    conn_status = Column(Enum(ConnStatus), default=ConnStatus.offline, comment='Realtime MQTT heartbeat state')
    
    mode = Column(Enum(DeviceMode), default=DeviceMode.library)
    firmware_revision = Column(String(50), nullable=True, comment='Developer-managed firmware revision reported by the device')
    firmware_version = Column(String(50))
    ip_address = Column(String(64), nullable=True, comment='Current LAN IP reported by the device')
    last_seen = Column(DateTime, nullable=True)
    pairing_requested_at = Column(
        DateTime,
        nullable=True,
        comment="UTC timestamp of the latest board-initiated pairing request awaiting admin action",
    )
    topic_pub = Column(String(255), comment='MQTT Publish Topic')
    topic_sub = Column(String(255), comment='MQTT Subscribe Topic')
    provisioning_project_id = Column(String(36), nullable=True, comment='DIY project id used to derive secure firmware credentials')

    room = relationship("Room", back_populates="devices")
    owner = relationship("User", back_populates="devices")
    pin_configurations = relationship("PinConfiguration", back_populates="device", cascade="all, delete-orphan")
    backup_archives = relationship("BackupArchive", back_populates="device", cascade="all, delete-orphan")
    history = relationship("DeviceHistory", back_populates="device", cascade="all, delete-orphan")

class PinConfiguration(Base):
    __tablename__ = "pin_configurations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    device_id = Column(String(36), ForeignKey("devices.device_id"), nullable=False)
    gpio_pin = Column(Integer, nullable=False)
    mode = Column(Enum(PinMode), nullable=False)
    function = Column(String(100), comment='VD: Light, TempSensor, Fan')
    label = Column(String(255))
    v_pin = Column(Integer, comment='Virtual Pin để map lên dashboard')
    extra_params = Column(JSON, comment='Lưu các thông số phụ như PWM frequency, ADC resolution')

    device = relationship("Device", back_populates="pin_configurations")

class Automation(Base):
    __tablename__ = "automations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    creator_id = Column(Integer, ForeignKey("users.user_id"), nullable=False)
    name = Column(String(255), nullable=False)
    script_code = Column(Text, nullable=False, comment="Legacy storage column containing serialized automation graph JSON")
    is_enabled = Column(Boolean, default=True)
    schedule_type = Column(String(16), nullable=False, default="manual")
    timezone = Column(String(64), nullable=True, comment="Legacy schedule metadata retained for compatibility")
    schedule_hour = Column(Integer, nullable=True)
    schedule_minute = Column(Integer, nullable=True)
    schedule_weekdays = Column(JSON, nullable=True, comment="Legacy schedule metadata retained for compatibility")
    last_triggered = Column(DateTime, nullable=True)
    next_run_at = Column(DateTime, nullable=True, comment="Legacy schedule metadata retained for compatibility")

    creator = relationship("User", back_populates="automations")
    logs = relationship("AutomationExecutionLog", back_populates="automation", cascade="all, delete-orphan")

class ExecutionStatus(str, enum.Enum):
    success = "success"
    failed = "failed"

class AutomationExecutionLog(Base):
    __tablename__ = "automation_execution_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    automation_id = Column(Integer, ForeignKey("automations.id"), nullable=False)
    triggered_at = Column(TIMESTAMP, server_default=func.now())
    status = Column(Enum(ExecutionStatus), nullable=False)
    trigger_source = Column(String(16), nullable=False, default="manual")
    scheduled_for = Column(DateTime, nullable=True, comment="Legacy schedule metadata retained for compatibility")
    log_output = Column(Text, nullable=True, comment="Serialized evaluation and action summary for the graph execution")
    error_message = Column(Text, nullable=True, comment='Exception details if failed')

    automation = relationship("Automation", back_populates="logs")

class BackupArchive(Base):
    __tablename__ = "backup_archives"

    id = Column(Integer, primary_key=True, autoincrement=True)
    device_id = Column(String(36), ForeignKey("devices.device_id"), nullable=False)
    backup_at = Column(TIMESTAMP, server_default=func.now())
    full_config_snapshot = Column(JSON, nullable=False, comment='Snapshot trọn gói: UUID + Pin Map + Settings')
    note = Column(String(255))

    device = relationship("Device", back_populates="backup_archives")


class WifiCredential(Base):
    __tablename__ = "wifi_credentials"

    id = Column(Integer, primary_key=True, autoincrement=True)
    household_id = Column(Integer, ForeignKey("households.household_id"), nullable=False)
    ssid = Column(String(255), nullable=False)
    password = Column(String(255), nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    household = relationship("Household", back_populates="wifi_credentials")
    projects = relationship("DiyProject", back_populates="wifi_credential")


class InstalledExtension(Base):
    __tablename__ = "installed_extensions"

    extension_id = Column(String(120), primary_key=True)
    manifest_version = Column(String(16), nullable=False)
    name = Column(String(255), nullable=False)
    version = Column(String(64), nullable=False)
    author = Column(String(255), nullable=True)
    description = Column(Text, nullable=False)
    provider_key = Column(String(120), nullable=False)
    provider_name = Column(String(255), nullable=False)
    package_runtime = Column(String(32), nullable=False, default="python")
    package_entrypoint = Column(String(255), nullable=False)
    package_root = Column(String(255), nullable=True)
    archive_path = Column(String(512), nullable=False)
    archive_sha256 = Column(String(64), nullable=False)
    manifest = Column(JSON, nullable=False)
    installed_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    external_devices = relationship("ExternalDevice", back_populates="installed_extension")


class ExternalDevice(Base):
    __tablename__ = "external_devices"

    device_id = Column(String(36), primary_key=True, comment="UUID v4 for one external device instance")
    installed_extension_id = Column(
        String(120),
        ForeignKey("installed_extensions.extension_id"),
        nullable=False,
        index=True,
    )
    device_schema_id = Column(String(120), nullable=False)
    household_id = Column(Integer, ForeignKey("households.household_id"), nullable=False, index=True)
    room_id = Column(Integer, ForeignKey("rooms.room_id"), nullable=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.user_id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    provider = Column(String(255), nullable=False)
    config = Column(JSON, nullable=True)
    schema_snapshot = Column(JSON, nullable=False)
    auth_status = Column(Enum(AuthStatus), nullable=False, default=AuthStatus.approved, index=True)
    conn_status = Column(Enum(ConnStatus), nullable=False, default=ConnStatus.offline, index=True)
    last_state = Column(JSON, nullable=True)
    last_seen = Column(DateTime, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    installed_extension = relationship("InstalledExtension", back_populates="external_devices")
    household = relationship("Household")
    room = relationship("Room")
    owner = relationship("User")

class DeviceHistory(Base):
    __tablename__ = "device_history"
    __table_args__ = (
        Index(
            "ix_device_history_device_event_timestamp_id",
            "device_id",
            "event_type",
            "timestamp",
            "id",
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    device_id = Column(String(36), ForeignKey("devices.device_id"), nullable=False)
    timestamp = Column(TIMESTAMP, server_default=func.now())
    event_type = Column(Enum(EventType), nullable=False)
    payload = Column(Text, comment='Dữ liệu thay đổi hoặc giá trị cảm biến')
    changed_by = Column(Integer, ForeignKey("users.user_id"), nullable=True, comment='User thực hiện thay đổi, NULL nếu do Automation')

    device = relationship("Device", back_populates="history")
    user = relationship("User", back_populates="history_logs")


class SystemLog(Base):
    __tablename__ = "system_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    occurred_at = Column(TIMESTAMP, server_default=func.now(), nullable=False, index=True)
    severity = Column(Enum(SystemLogSeverity), nullable=False, default=SystemLogSeverity.info, index=True)
    category = Column(Enum(SystemLogCategory), nullable=False, default=SystemLogCategory.health, index=True)
    event_code = Column(String(64), nullable=False, index=True)
    message = Column(String(512), nullable=False)
    device_id = Column(String(36), ForeignKey("devices.device_id"), nullable=True, index=True)
    firmware_version = Column(String(64), nullable=True)
    firmware_revision = Column(String(64), nullable=True)
    details = Column(JSON, nullable=True)
    is_read = Column(Boolean, nullable=False, default=False)
    read_at = Column(DateTime, nullable=True)
    read_by_user_id = Column(Integer, ForeignKey("users.user_id"), nullable=True, index=True)

    device = relationship("Device")
    read_by_user = relationship("User", foreign_keys=[read_by_user_id])

class DiyProject(Base):
    __tablename__ = "diy_projects"

    id = Column(String(36), primary_key=True, comment='UUID cho project')
    user_id = Column(Integer, ForeignKey("users.user_id"), nullable=False)
    room_id = Column(Integer, ForeignKey("rooms.room_id"), nullable=True)
    wifi_credential_id = Column(Integer, ForeignKey("wifi_credentials.id"), nullable=True)
    name = Column(String(255), nullable=False)
    board_profile = Column(String(100), nullable=False)
    config = Column(JSON, nullable=True, comment='Lưu trữ toàn bộ JSON map cấu hình pins, wifi, mqtt')
    current_config_id = Column(String(36), ForeignKey("diy_project_configs.id", use_alter=True), nullable=True, comment='Saved config currently treated as active for the board')
    pending_config = Column(JSON, nullable=True, comment='Latest staged config waiting for OTA success before it becomes current')
    pending_config_id = Column(String(36), ForeignKey("diy_project_configs.id", use_alter=True), nullable=True, comment='Saved config linked to the latest staged OTA config')
    pending_build_job_id = Column(String(36), nullable=True, comment='Build job id for the latest staged OTA config')
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    owner = relationship("User")
    room = relationship("Room")
    wifi_credential = relationship("WifiCredential", back_populates="projects")
    build_jobs = relationship("BuildJob", back_populates="project", cascade="all, delete-orphan")
    saved_configs = relationship(
        "DiyProjectConfig",
        back_populates="project",
        cascade="all, delete-orphan",
        foreign_keys="DiyProjectConfig.project_id",
    )
    current_saved_config = relationship(
        "DiyProjectConfig",
        foreign_keys=[current_config_id],
        post_update=True,
    )
    pending_saved_config = relationship(
        "DiyProjectConfig",
        foreign_keys=[pending_config_id],
        post_update=True,
    )

class DiyProjectConfig(Base):
    __tablename__ = "diy_project_configs"

    id = Column(String(36), primary_key=True, comment='UUID cho config đã lưu của một board/project')
    project_id = Column(String(36), ForeignKey("diy_projects.id"), nullable=False)
    device_id = Column(String(36), nullable=False, comment='UUID thiết bị được bind với config này')
    board_profile = Column(String(100), nullable=False)
    name = Column(String(255), nullable=False)
    config = Column(JSON, nullable=True, comment='Saved config payload for builder/reconfiguration flows')
    last_applied_at = Column(DateTime, nullable=True, comment='UTC timestamp when this config most recently became active on hardware')
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    project = relationship("DiyProject", back_populates="saved_configs", foreign_keys=[project_id])
    build_jobs = relationship("BuildJob", back_populates="saved_config")

class BuildJob(Base):
    __tablename__ = "build_jobs"

    id = Column(String(36), primary_key=True, comment='UUID cho job')
    project_id = Column(String(36), ForeignKey("diy_projects.id"), nullable=False)
    saved_config_id = Column(String(36), ForeignKey("diy_project_configs.id"), nullable=True, comment='Saved config row used to produce this build')
    status = Column(Enum(JobStatus), default=JobStatus.queued)
    artifact_path = Column(String(255), nullable=True, comment='Đường dẫn tới file .bin sau khi build thành công')
    log_path = Column(String(255), nullable=True, comment='Đường dẫn tới file log build')
    staged_project_config = Column(JSON, nullable=True, comment='Immutable config snapshot compiled for this build job')
    error_message = Column(Text, nullable=True, comment='Last error captured when build_failed')
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    finished_at = Column(DateTime, nullable=True, comment='UTC timestamp when build reached a terminal state')

    project = relationship("DiyProject", back_populates="build_jobs")
    saved_config = relationship("DiyProjectConfig", back_populates="build_jobs")

class SerialSessionStatus(str, enum.Enum):
    locked = "locked"
    released = "released"

class SerialSession(Base):
    __tablename__ = "serial_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    port = Column(String(255), nullable=False, default="default")
    device_id = Column(String(255), nullable=True)
    build_job_id = Column(String(36), ForeignKey("build_jobs.id"), nullable=True)
    locked_by_user_id = Column(Integer, ForeignKey("users.user_id"), nullable=False)
    status = Column(Enum(SerialSessionStatus), nullable=False, default=SerialSessionStatus.locked)
    created_at = Column(TIMESTAMP, server_default=func.now())
    released_at = Column(DateTime, nullable=True)

    locked_by = relationship("User")
    build_job = relationship("BuildJob")
