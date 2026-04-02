import logging
import os
import time
import json
from datetime import datetime, timezone

from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Load .env from the directory containing this file's parent (the project root)
server_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
env_path = os.path.join(server_root, '.env')
load_dotenv(dotenv_path=env_path)

DEFAULT_DATABASE_URL = "mysql+pymysql://econnect:root_password@127.0.0.1:3306/e_connect_db"

configured_database_url = os.getenv("DATABASE_URL")
DATABASE_URL = configured_database_url.strip() if configured_database_url else DEFAULT_DATABASE_URL

if DATABASE_URL == DEFAULT_DATABASE_URL:
    logger.info(
        "DATABASE_URL is not configured. Defaulting to Docker-backed local MariaDB at 127.0.0.1:3306/e_connect_db"
    )

engine_options = {"pool_pre_ping": True}

if DATABASE_URL.startswith("sqlite"):
    engine_options["connect_args"] = {"check_same_thread": False}
else:
    engine_options["pool_recycle"] = int(os.getenv("DATABASE_POOL_RECYCLE", "300"))
    engine_options["connect_args"] = {
        "connect_timeout": int(os.getenv("DATABASE_CONNECT_TIMEOUT", "15")),
        "read_timeout": int(os.getenv("DATABASE_READ_TIMEOUT", "120")),
        "write_timeout": int(os.getenv("DATABASE_WRITE_TIMEOUT", "120")),
    }

engine = create_engine(DATABASE_URL, **engine_options)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()
LEGACY_CONFIG_BUILD_POINTER_KEYS = ("latest_build_job_id", "latest_build_config_key")

def _format_operational_error(exc: OperationalError) -> str:
    original_error = getattr(exc, "orig", None)
    return str(original_error or exc)

def check_database_connection():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True, None
    except SQLAlchemyError as exc:
        error_message = _format_operational_error(exc) if isinstance(exc, OperationalError) else str(exc)
        logger.warning("Database connectivity check failed: %s", error_message)
        return False, error_message

def _column_exists(table_name: str, column_name: str) -> bool:
    with engine.connect() as conn:
        if DATABASE_URL.startswith("sqlite"):
            existing_columns = conn.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
            return any(column[1] == column_name for column in existing_columns)

        result = conn.execute(text(
            "SELECT COUNT(*) FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table_name AND COLUMN_NAME = :column_name"
        ), {"table_name": table_name, "column_name": column_name})
        return bool(result.scalar())

def _ensure_column(table_name: str, column_name: str, sqlite_definition: str, maria_definition: str):
    with engine.connect() as conn:
        if DATABASE_URL.startswith("sqlite"):
            if not _column_exists(table_name, column_name):
                conn.execute(text(
                    f"ALTER TABLE {table_name} ADD COLUMN {column_name} {sqlite_definition}"
                ))
                conn.commit()
            return

        if not _column_exists(table_name, column_name):
            conn.execute(text(
                f"ALTER TABLE {table_name} ADD COLUMN {column_name} {maria_definition}"
            ))
            conn.commit()

def _drop_column_if_exists(table_name: str, column_name: str):
    if not _column_exists(table_name, column_name):
        return

    with engine.connect() as conn:
        conn.execute(text(f"ALTER TABLE {table_name} DROP COLUMN {column_name}"))
        conn.commit()

def _trimmed_string(value):
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None

def _decode_json_object(value):
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except json.JSONDecodeError:
            return None
        if isinstance(decoded, dict):
            return dict(decoded)
    return None

def _utc_isoformat(value):
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    if not isinstance(value, datetime):
        return None
    timestamp = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    return timestamp.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def _config_name_fallback(project_name: str | None, device_name: str | None) -> str:
    return (device_name or project_name or "Saved config").strip() or "Saved config"

def _resolve_project_device(project, linked_devices, *, preferred_payloads):
    candidate_ids = []
    candidate_names = []
    for payload in preferred_payloads:
        payload_json = _decode_json_object(payload)
        if not payload_json:
            continue
        candidate_id = _trimmed_string(payload_json.get("assigned_device_id")) or _trimmed_string(payload_json.get("device_id"))
        if candidate_id:
            candidate_ids.append(candidate_id)
        candidate_name = _trimmed_string(payload_json.get("assigned_device_name"))
        if candidate_name:
            candidate_names.append(candidate_name)

    for candidate_id in candidate_ids:
        matched = next((device for device in linked_devices if device.device_id == candidate_id), None)
        if matched is not None:
            return matched

    for candidate_name in candidate_names:
        matched = next((device for device in linked_devices if device.name == candidate_name), None)
        if matched is not None:
            return matched

    project_name = _trimmed_string(getattr(project, "name", None))
    if project_name:
        matched = next((device for device in linked_devices if _trimmed_string(device.name) == project_name), None)
        if matched is not None:
            return matched

    if len(linked_devices) == 1:
        return linked_devices[0]

    return linked_devices[0] if linked_devices else None

def _normalize_build_history_snapshot(snapshot, *, job, project, device):
    normalized = _decode_json_object(snapshot) or {}
    changed = snapshot is None or not isinstance(snapshot, dict)

    for legacy_key in LEGACY_CONFIG_BUILD_POINTER_KEYS:
        if legacy_key in normalized:
            normalized.pop(legacy_key, None)
            changed = True

    if not _trimmed_string(normalized.get("config_id")):
        normalized["config_id"] = job.id
        changed = True

    project_name = _trimmed_string(getattr(project, "name", None)) if project is not None else None
    device_name = _trimmed_string(getattr(device, "name", None)) if device is not None else None
    if not _trimmed_string(normalized.get("config_name")):
        normalized["config_name"] = _config_name_fallback(project_name, device_name)
        changed = True

    if device is not None:
        if not _trimmed_string(normalized.get("assigned_device_id")):
            normalized["assigned_device_id"] = device.device_id
            changed = True
        if not _trimmed_string(normalized.get("assigned_device_name")):
            normalized["assigned_device_name"] = device.name
            changed = True

    if not _trimmed_string(normalized.get("saved_at")):
        saved_at = _utc_isoformat(getattr(job, "created_at", None))
        if saved_at:
            normalized["saved_at"] = saved_at
            changed = True

    return normalized, changed

def _normalize_project_config_payload(payload, *, project, device, valid_job_ids, fallback_job_id=None):
    payload_json = _decode_json_object(payload)
    if payload_json is None:
        return payload, False

    normalized = dict(payload_json)
    changed = False
    referenced_job_id = _trimmed_string(normalized.get("latest_build_job_id"))
    if referenced_job_id is None and "latest_build_config_key" in normalized:
        normalized.pop("latest_build_config_key", None)
        changed = True
    elif referenced_job_id and referenced_job_id not in valid_job_ids:
        for legacy_key in LEGACY_CONFIG_BUILD_POINTER_KEYS:
            if legacy_key in normalized:
                normalized.pop(legacy_key, None)
                changed = True

    project_name = _trimmed_string(getattr(project, "name", None)) if project is not None else None
    device_name = _trimmed_string(getattr(device, "name", None)) if device is not None else None
    if not _trimmed_string(normalized.get("config_name")):
        normalized["config_name"] = _config_name_fallback(project_name, device_name)
        changed = True

    if device is not None:
        if not _trimmed_string(normalized.get("assigned_device_id")):
            normalized["assigned_device_id"] = device.device_id
            changed = True
        if not _trimmed_string(normalized.get("assigned_device_name")):
            normalized["assigned_device_name"] = device.name
            changed = True

    if fallback_job_id and not _trimmed_string(normalized.get("config_id")):
        normalized["config_id"] = fallback_job_id
        changed = True

    if changed:
        return normalized, True
    return payload_json, False

def _ensure_additive_columns():
    """Additive column guard for backwards-compatible schema changes."""
    column_guards = [
        ("build_jobs", "finished_at", "DATETIME", "DATETIME NULL"),
        ("build_jobs", "error_message", "TEXT", "TEXT NULL"),
        ("build_jobs", "staged_project_config", "TEXT", "JSON NULL"),
        (
            "devices",
            "provisioning_project_id",
            "VARCHAR(36)",
            "VARCHAR(36) NULL COMMENT 'DIY project id used to derive secure firmware credentials'",
        ),
        (
            "devices",
            "ip_address",
            "VARCHAR(64)",
            "VARCHAR(64) NULL COMMENT 'Current LAN IP reported by the device'",
        ),
        (
            "devices",
            "firmware_revision",
            "VARCHAR(50)",
            "VARCHAR(50) NULL COMMENT 'Developer-managed firmware revision reported by the device'",
        ),
        (
            "devices",
            "pairing_requested_at",
            "DATETIME",
            "DATETIME NULL COMMENT 'UTC timestamp of the latest board-initiated pairing request awaiting admin action'",
        ),
        (
            "rooms",
            "household_id",
            "INTEGER",
            "INT NULL",
        ),
        (
            "households",
            "timezone",
            "VARCHAR(64)",
            "VARCHAR(64) NULL COMMENT 'IANA timezone override for server runtime behavior'",
        ),
        (
            "diy_projects",
            "room_id",
            "INTEGER",
            "INT NULL",
        ),
        (
            "diy_projects",
            "wifi_credential_id",
            "INTEGER",
            "INT NULL",
        ),
        (
            "diy_projects",
            "pending_config",
            "TEXT",
            "JSON NULL",
        ),
        (
            "diy_projects",
            "pending_build_job_id",
            "VARCHAR(36)",
            "VARCHAR(36) NULL",
        ),
        (
            "automations",
            "schedule_type",
            "VARCHAR(16) NOT NULL DEFAULT 'manual'",
            "VARCHAR(16) NOT NULL DEFAULT 'manual'",
        ),
        (
            "automations",
            "timezone",
            "VARCHAR(64)",
            "VARCHAR(64) NULL",
        ),
        (
            "automations",
            "schedule_hour",
            "INTEGER",
            "INT NULL",
        ),
        (
            "automations",
            "schedule_minute",
            "INTEGER",
            "INT NULL",
        ),
        (
            "automations",
            "schedule_weekdays",
            "TEXT",
            "JSON NULL",
        ),
        (
            "automations",
            "next_run_at",
            "DATETIME",
            "DATETIME NULL",
        ),
        (
            "system_logs",
            "is_read",
            "BOOLEAN NOT NULL DEFAULT 0",
            "BOOLEAN NOT NULL DEFAULT 0",
        ),
        (
            "system_logs",
            "read_at",
            "DATETIME",
            "DATETIME NULL",
        ),
        (
            "system_logs",
            "read_by_user_id",
            "INTEGER",
            "INT NULL",
        ),
        (
            "automation_execution_logs",
            "trigger_source",
            "VARCHAR(16) NOT NULL DEFAULT 'manual'",
            "VARCHAR(16) NOT NULL DEFAULT 'manual'",
        ),
        (
            "automation_execution_logs",
            "scheduled_for",
            "DATETIME",
            "DATETIME NULL",
        ),
    ]

    for table_name, column_name, sqlite_definition, maria_definition in column_guards:
        try:
            _ensure_column(table_name, column_name, sqlite_definition, maria_definition)
        except Exception as exc:
            logger.warning(
                "Schema additive guard failed for %s.%s (non-fatal): %s",
                table_name,
                column_name,
                exc,
            )

    logger.info("Schema additive guards completed")

def _backfill_legacy_build_history_metadata():
    from .sql_models import BuildJob, Device, DiyProject

    db = SessionLocal()
    try:
        projects = {project.id: project for project in db.query(DiyProject).all()}
        devices_by_project = {}
        for device in db.query(Device).filter(Device.provisioning_project_id.isnot(None)).all():
            devices_by_project.setdefault(device.provisioning_project_id, []).append(device)

        changed = False
        for job in db.query(BuildJob).order_by(BuildJob.created_at.asc(), BuildJob.id.asc()).all():
            project = projects.get(job.project_id)
            linked_devices = devices_by_project.get(job.project_id, [])
            resolved_device = _resolve_project_device(
                project,
                linked_devices,
                preferred_payloads=(
                    job.staged_project_config,
                    getattr(project, "pending_config", None) if project is not None else None,
                    getattr(project, "config", None) if project is not None else None,
                ),
            )
            normalized_snapshot, snapshot_changed = _normalize_build_history_snapshot(
                job.staged_project_config,
                job=job,
                project=project,
                device=resolved_device,
            )
            if snapshot_changed:
                job.staged_project_config = normalized_snapshot
                changed = True

        if changed:
            db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("Legacy build history metadata backfill failed (non-fatal): %s", exc)
    finally:
        db.close()

def _cleanup_project_board_config_data():
    from .sql_models import BuildJob, Device, DiyProject

    db = SessionLocal()
    try:
        projects = db.query(DiyProject).all()
        valid_job_ids_by_project = {}
        for project_id, job_id in db.query(BuildJob.project_id, BuildJob.id).all():
            valid_job_ids_by_project.setdefault(project_id, set()).add(job_id)

        devices_by_project = {}
        for device in db.query(Device).filter(Device.provisioning_project_id.isnot(None)).all():
            devices_by_project.setdefault(device.provisioning_project_id, []).append(device)

        changed = False
        for project in projects:
            valid_job_ids = valid_job_ids_by_project.get(project.id, set())
            resolved_device = _resolve_project_device(
                project,
                devices_by_project.get(project.id, []),
                preferred_payloads=(project.pending_config, project.config),
            )

            normalized_config, config_changed = _normalize_project_config_payload(
                project.config,
                project=project,
                device=resolved_device,
                valid_job_ids=valid_job_ids,
            )
            if config_changed:
                project.config = normalized_config
                changed = True

            pending_job_id = _trimmed_string(project.pending_build_job_id)
            if pending_job_id and pending_job_id not in valid_job_ids:
                project.pending_build_job_id = None
                project.pending_config = None
                changed = True
                pending_job_id = None
            elif pending_job_id is None and project.pending_config is not None:
                project.pending_config = None
                changed = True

            if pending_job_id:
                normalized_pending_config, pending_changed = _normalize_project_config_payload(
                    project.pending_config,
                    project=project,
                    device=resolved_device,
                    valid_job_ids=valid_job_ids,
                    fallback_job_id=pending_job_id,
                )
                if pending_changed:
                    project.pending_config = normalized_pending_config
                    changed = True

        if changed:
            db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("Board config cleanup failed (non-fatal): %s", exc)
    finally:
        db.close()

def _cleanup_legacy_user_approval_status():
    try:
        _drop_column_if_exists("users", "approval_status")
    except Exception as exc:
        logger.warning("Legacy users.approval_status cleanup failed (non-fatal): %s", exc)


def _backfill_room_household_ids():
    with engine.connect() as conn:
        try:
            if DATABASE_URL.startswith("sqlite"):
                conn.execute(text(
                    """
                    UPDATE rooms
                    SET household_id = (
                        SELECT hm.household_id
                        FROM household_memberships hm
                        WHERE hm.user_id = rooms.user_id
                        ORDER BY hm.id ASC
                        LIMIT 1
                    )
                    WHERE household_id IS NULL
                    """
                ))
            else:
                conn.execute(text(
                    """
                    UPDATE rooms r
                    JOIN household_memberships hm
                      ON hm.user_id = r.user_id
                    SET r.household_id = hm.household_id
                    WHERE r.household_id IS NULL
                    """
                ))
            conn.commit()
        except Exception as exc:
            logger.warning("Room household backfill failed (non-fatal): %s", exc)


def _backfill_project_wifi_credentials():
    from .sql_models import DiyProject, HouseholdMembership, WifiCredential

    db = SessionLocal()
    try:
        projects = (
            db.query(DiyProject)
            .filter(DiyProject.wifi_credential_id.is_(None))
            .all()
        )
        changed = False

        for project in projects:
            config_json = project.config if isinstance(project.config, dict) else {}
            wifi_ssid = config_json.get("wifi_ssid")
            wifi_password = config_json.get("wifi_password")
            if not isinstance(wifi_ssid, str) or not wifi_ssid.strip():
                continue
            if not isinstance(wifi_password, str) or not wifi_password.strip():
                continue

            membership = (
                db.query(HouseholdMembership)
                .filter(HouseholdMembership.user_id == project.user_id)
                .order_by(HouseholdMembership.id.asc())
                .first()
            )
            if not membership:
                continue

            credential = (
                db.query(WifiCredential)
                .filter(
                    WifiCredential.household_id == membership.household_id,
                    WifiCredential.ssid == wifi_ssid.strip(),
                    WifiCredential.password == wifi_password,
                )
                .order_by(WifiCredential.id.asc())
                .first()
            )

            if credential is None:
                credential = WifiCredential(
                    household_id=membership.household_id,
                    ssid=wifi_ssid.strip(),
                    password=wifi_password,
                )
                db.add(credential)
                db.flush()

            project.wifi_credential_id = credential.id
            changed = True

        if changed:
            db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("DIY project Wi-Fi credential backfill failed (non-fatal): %s", exc)
    finally:
        db.close()


def initialize_database(max_attempts: int = 3, retry_delay: float = 1.0):
    last_error = None

    for attempt in range(1, max_attempts + 1):
        try:
            Base.metadata.create_all(bind=engine)
            _ensure_additive_columns()
            _backfill_room_household_ids()
            _backfill_project_wifi_credentials()
            _backfill_legacy_build_history_metadata()
            _cleanup_project_board_config_data()
            _cleanup_legacy_user_approval_status()
            logger.info("Database schema is ready")
            return True, None
        except SQLAlchemyError as exc:
            last_error = _format_operational_error(exc) if isinstance(exc, OperationalError) else str(exc)
            logger.warning(
                "Database initialization attempt %s/%s failed: %s",
                attempt,
                max_attempts,
                last_error,
            )
            if attempt < max_attempts:
                time.sleep(retry_delay)

    return False, last_error

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
