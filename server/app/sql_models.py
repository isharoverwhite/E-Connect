from sqlalchemy import Column, Integer, String, Boolean, JSON, DateTime, Text, ForeignKey, Enum, TIMESTAMP, UniqueConstraint
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

class UserApprovalStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    revoked = "revoked"

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
    approval_status = Column(Enum(UserApprovalStatus), default=UserApprovalStatus.approved, nullable=False)
    ui_layout = Column(JSON, comment='Lưu cấu hình Grid Layout cá nhân của từng user')
    created_at = Column(TIMESTAMP, server_default=func.now())

    rooms = relationship("Room", back_populates="user")
    devices = relationship("Device", back_populates="owner")
    automations = relationship("Automation", back_populates="creator")
    history_logs = relationship("DeviceHistory", back_populates="user")
    memberships = relationship("HouseholdMembership", back_populates="user", cascade="all, delete-orphan")

class Household(Base):
    __tablename__ = "households"

    household_id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
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
    script_code = Column(Text, nullable=False, comment='Mã nguồn Python')
    is_enabled = Column(Boolean, default=True)
    last_triggered = Column(DateTime, nullable=True)

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
    log_output = Column(Text, nullable=True, comment='Console output if any')
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

class DeviceHistory(Base):
    __tablename__ = "device_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    device_id = Column(String(36), ForeignKey("devices.device_id"), nullable=False)
    timestamp = Column(TIMESTAMP, server_default=func.now())
    event_type = Column(Enum(EventType), nullable=False)
    payload = Column(Text, comment='Dữ liệu thay đổi hoặc giá trị cảm biến')
    changed_by = Column(Integer, ForeignKey("users.user_id"), nullable=True, comment='User thực hiện thay đổi, NULL nếu do Automation')

    device = relationship("Device", back_populates="history")
    user = relationship("User", back_populates="history_logs")

# Legacy Firmware table support (optional, keeping for OTA feature)
class Firmware(Base):
    __tablename__ = "firmwares"

    id = Column(Integer, primary_key=True, index=True)
    version = Column(String(50))
    board = Column(String(100))
    filename = Column(String(255))
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())

class DiyProject(Base):
    __tablename__ = "diy_projects"

    id = Column(String(36), primary_key=True, comment='UUID cho project')
    user_id = Column(Integer, ForeignKey("users.user_id"), nullable=False)
    room_id = Column(Integer, ForeignKey("rooms.room_id"), nullable=True)
    wifi_credential_id = Column(Integer, ForeignKey("wifi_credentials.id"), nullable=True)
    name = Column(String(255), nullable=False)
    board_profile = Column(String(100), nullable=False)
    config = Column(JSON, nullable=True, comment='Lưu trữ toàn bộ JSON map cấu hình pins, wifi, mqtt')
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    owner = relationship("User")
    room = relationship("Room")
    wifi_credential = relationship("WifiCredential", back_populates="projects")
    build_jobs = relationship("BuildJob", back_populates="project", cascade="all, delete-orphan")

class BuildJob(Base):
    __tablename__ = "build_jobs"

    id = Column(String(36), primary_key=True, comment='UUID cho job')
    project_id = Column(String(36), ForeignKey("diy_projects.id"), nullable=False)
    status = Column(Enum(JobStatus), default=JobStatus.queued)
    artifact_path = Column(String(255), nullable=True, comment='Đường dẫn tới file .bin sau khi build thành công')
    log_path = Column(String(255), nullable=True, comment='Đường dẫn tới file log build')
    error_message = Column(Text, nullable=True, comment='Last error captured when build_failed')
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    finished_at = Column(DateTime, nullable=True, comment='UTC timestamp when build reached a terminal state')

    project = relationship("DiyProject", back_populates="build_jobs")

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
