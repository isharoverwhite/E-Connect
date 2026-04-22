# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

import logging
import os
import time
import json
import uuid
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
CONFIG_HISTORY_DELETED_AT_KEY = "_history_deleted_at"
INTERNAL_CONFIG_METADATA_KEYS = (CONFIG_HISTORY_DELETED_AT_KEY,)

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

def _table_exists(table_name: str) -> bool:
    with engine.connect() as conn:
        if DATABASE_URL.startswith("sqlite"):
            result = conn.execute(
                text("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = :table_name"),
                {"table_name": table_name},
            )
            return bool(result.scalar())

        result = conn.execute(
            text(
                "SELECT COUNT(*) FROM information_schema.TABLES "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table_name"
            ),
            {"table_name": table_name},
        )
        return bool(result.scalar())

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

def _index_exists(table_name: str, index_name: str) -> bool:
    with engine.connect() as conn:
        if DATABASE_URL.startswith("sqlite"):
            existing_indexes = conn.execute(text(f"PRAGMA index_list({table_name})")).fetchall()
            return any(index[1] == index_name for index in existing_indexes)

        result = conn.execute(
            text(
                "SELECT COUNT(*) FROM information_schema.STATISTICS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table_name AND INDEX_NAME = :index_name"
            ),
            {"table_name": table_name, "index_name": index_name},
        )
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

def _ensure_index(table_name: str, index_name: str, sqlite_sql: str, maria_sql: str) -> None:
    if _index_exists(table_name, index_name):
        return

    with engine.connect() as conn:
        conn.execute(text(sqlite_sql if DATABASE_URL.startswith("sqlite") else maria_sql))
        conn.commit()

def _drop_column_if_exists(table_name: str, column_name: str):
    if not _column_exists(table_name, column_name):
        return

    with engine.connect() as conn:
        conn.execute(text(f"ALTER TABLE {table_name} DROP COLUMN {column_name}"))
        conn.commit()

def _drop_table_if_exists(table_name: str) -> bool:
    if not _table_exists(table_name):
        return False

    with engine.connect() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS {table_name}"))
        conn.commit()
    return True

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

def strip_internal_config_metadata(payload):
    normalized = _decode_json_object(payload)
    if normalized is None:
        return None

    sanitized = dict(normalized)
    for internal_key in INTERNAL_CONFIG_METADATA_KEYS:
        sanitized.pop(internal_key, None)
    return sanitized

def is_config_history_deleted_payload(payload) -> bool:
    normalized = _decode_json_object(payload)
    if normalized is None:
        return False
    return _trimmed_string(normalized.get(CONFIG_HISTORY_DELETED_AT_KEY)) is not None

def mark_config_history_deleted_payload(payload, *, deleted_at: datetime | None = None):
    normalized = _decode_json_object(payload)
    if normalized is None:
        return payload, False

    existing_deleted_at = _trimmed_string(normalized.get(CONFIG_HISTORY_DELETED_AT_KEY))
    if existing_deleted_at is not None:
        return normalized, False

    updated = dict(normalized)
    updated[CONFIG_HISTORY_DELETED_AT_KEY] = _utc_isoformat(deleted_at or datetime.now(timezone.utc))
    return updated, True

def _config_name_fallback(project_name: str | None, device_name: str | None) -> str:
    return (device_name or project_name or "Saved config").strip() or "Saved config"


def _config_device_name_fallback(
    payload_device_name: str | None,
    project_name: str | None,
    device_name: str | None,
) -> str:
    return (payload_device_name or device_name or project_name or "E-Connect Node").strip() or "E-Connect Node"

def _resolve_project_binding_identity(project, device):
    project_name = _trimmed_string(getattr(project, "name", None)) if project is not None else None
    device_id = _trimmed_string(getattr(device, "device_id", None)) if device is not None else None
    device_name = _trimmed_string(getattr(device, "name", None)) if device is not None else None

    if device_id is None and project is not None:
        try:
            from .services.provisioning import build_project_firmware_identity, extract_project_secret_from_payload

            persisted_secret = None
            for payload in (
                getattr(project, "pending_config", None),
                getattr(project, "config", None),
            ):
                persisted_secret = extract_project_secret_from_payload(payload)
                if persisted_secret:
                    break

            device_id, _ = build_project_firmware_identity(project.id, persisted_secret)
        except Exception:
            device_id = None

    resolved_device_id = device_id or (_trimmed_string(getattr(project, "id", None)) if project is not None else None) or str(uuid.uuid4())
    resolved_device_name = device_name or _config_name_fallback(project_name, None)
    return resolved_device_id, resolved_device_name

def _normalize_saved_config_payload(
    payload,
    *,
    row_id: str,
    project,
    device,
    saved_at: datetime | None = None,
    preserve_internal_metadata: bool = False,
):
    normalized = _decode_json_object(payload) or {}
    changed = payload is None or not isinstance(payload, dict)

    for legacy_key in LEGACY_CONFIG_BUILD_POINTER_KEYS:
        if legacy_key in normalized:
            normalized.pop(legacy_key, None)
            changed = True

    if not preserve_internal_metadata:
        for internal_key in INTERNAL_CONFIG_METADATA_KEYS:
            if internal_key in normalized:
                normalized.pop(internal_key, None)
                changed = True

    if not _trimmed_string(normalized.get("config_id")):
        normalized["config_id"] = row_id
        changed = True

    project_name = _trimmed_string(getattr(project, "name", None)) if project is not None else None
    resolved_device_id, fallback_device_name = _resolve_project_binding_identity(project, device)
    resolved_device_name = _config_device_name_fallback(
        _trimmed_string(normalized.get("assigned_device_name")),
        _trimmed_string(normalized.get("project_name")) or project_name,
        fallback_device_name,
    )
    if not _trimmed_string(normalized.get("config_name")):
        normalized["config_name"] = _config_name_fallback(project_name, resolved_device_name)
        changed = True

    if _trimmed_string(normalized.get("assigned_device_id")) != resolved_device_id:
        normalized["assigned_device_id"] = resolved_device_id
        changed = True

    if _trimmed_string(normalized.get("assigned_device_name")) != resolved_device_name:
        normalized["assigned_device_name"] = resolved_device_name
        changed = True

    if _trimmed_string(normalized.get("project_name")) != resolved_device_name:
        normalized["project_name"] = resolved_device_name
        changed = True

    board_profile = _trimmed_string(getattr(project, "board_profile", None)) if project is not None else None
    if board_profile and _trimmed_string(normalized.get("board_profile")) != board_profile:
        normalized["board_profile"] = board_profile
        changed = True

    if not _trimmed_string(normalized.get("saved_at")):
        normalized_saved_at = _utc_isoformat(saved_at or datetime.now(timezone.utc))
        if normalized_saved_at:
            normalized["saved_at"] = normalized_saved_at
            changed = True

    return normalized, changed

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
    return _normalize_saved_config_payload(
        snapshot,
        row_id=job.id,
        project=project,
        device=device,
        saved_at=getattr(job, "created_at", None),
        preserve_internal_metadata=True,
    )

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
    resolved_device_name = _config_device_name_fallback(
        _trimmed_string(normalized.get("assigned_device_name")),
        _trimmed_string(normalized.get("project_name")) or project_name,
        device_name,
    )
    if not _trimmed_string(normalized.get("config_name")):
        normalized["config_name"] = _config_name_fallback(project_name, resolved_device_name)
        changed = True

    if device is not None:
        if not _trimmed_string(normalized.get("assigned_device_id")):
            normalized["assigned_device_id"] = device.device_id
            changed = True

    if _trimmed_string(normalized.get("assigned_device_name")) != resolved_device_name:
        normalized["assigned_device_name"] = resolved_device_name
        changed = True

    if _trimmed_string(normalized.get("project_name")) != resolved_device_name:
        normalized["project_name"] = resolved_device_name
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
            "show_on_dashboard",
            "BOOLEAN DEFAULT 1",
            "BOOLEAN NOT NULL DEFAULT 1 COMMENT 'Flag to show or hide the device on the dashboard'",
        ),
        (
            "external_devices",
            "show_on_dashboard",
            "BOOLEAN DEFAULT 1",
            "BOOLEAN NOT NULL DEFAULT 1 COMMENT 'Flag to show or hide the device on the dashboard'",
        ),
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
            "households",
            "house_temperature_device_id",
            "VARCHAR(36)",
            "VARCHAR(36) NULL COMMENT 'Selected physical device that feeds the household house-temperature dashboard block'",
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
            "current_config_id",
            "VARCHAR(36)",
            "VARCHAR(36) NULL",
        ),
        (
            "diy_projects",
            "pending_config_id",
            "VARCHAR(36)",
            "VARCHAR(36) NULL",
        ),
        (
            "diy_projects",
            "pending_build_job_id",
            "VARCHAR(36)",
            "VARCHAR(36) NULL",
        ),
        (
            "build_jobs",
            "saved_config_id",
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
                if getattr(project, "pending_config_id", None):
                    project.pending_config_id = None
                changed = True
                pending_job_id = None
            elif pending_job_id is None and project.pending_config is not None:
                project.pending_config = None
                if getattr(project, "pending_config_id", None):
                    project.pending_config_id = None
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

def _backfill_saved_project_configs():
    from .sql_models import BuildJob, Device, DiyProject, DiyProjectConfig, JobStatus

    def ensure_saved_config_row(
        *,
        row_id: str,
        project,
        device,
        payload,
        rows_by_id: dict[str, object],
        last_applied_at: datetime | None = None,
    ) -> bool:
        normalized_payload, payload_changed = _normalize_saved_config_payload(
            payload,
            row_id=row_id,
            project=project,
            device=device,
            saved_at=last_applied_at,
        )
        resolved_device_id, _ = _resolve_project_binding_identity(project, device)
        config_name = _trimmed_string(normalized_payload.get("config_name")) or _config_name_fallback(
            _trimmed_string(getattr(project, "name", None)),
            _trimmed_string(getattr(device, "name", None)) if device is not None else None,
        )

        row = rows_by_id.get(row_id)
        changed = payload_changed
        if row is None:
            row = DiyProjectConfig(
                id=row_id,
                project_id=project.id,
                device_id=resolved_device_id,
                board_profile=project.board_profile,
                name=config_name,
                config=normalized_payload,
                last_applied_at=last_applied_at,
            )
            db.add(row)
            rows_by_id[row_id] = row
            return True

        if row.project_id != project.id:
            row.project_id = project.id
            changed = True
        if row.device_id != resolved_device_id:
            row.device_id = resolved_device_id
            changed = True
        if row.board_profile != project.board_profile:
            row.board_profile = project.board_profile
            changed = True
        if row.name != config_name:
            row.name = config_name
            changed = True
        if row.config != normalized_payload:
            row.config = normalized_payload
            changed = True
        if last_applied_at and row.last_applied_at != last_applied_at:
            row.last_applied_at = last_applied_at
            changed = True
        return changed

    db = SessionLocal()
    try:
        projects = {project.id: project for project in db.query(DiyProject).all()}
        rows_by_id = {row.id: row for row in db.query(DiyProjectConfig).all()}
        devices_by_project = {}
        for device in db.query(Device).filter(Device.provisioning_project_id.isnot(None)).all():
            devices_by_project.setdefault(device.provisioning_project_id, []).append(device)

        changed = False

        for project in projects.values():
            linked_devices = devices_by_project.get(project.id, [])
            resolved_device = _resolve_project_device(
                project,
                linked_devices,
                preferred_payloads=(project.pending_config, project.config),
            )

            current_payload = _decode_json_object(project.config)
            if current_payload is not None:
                current_config_id = (
                    _trimmed_string(getattr(project, "current_config_id", None))
                    or _trimmed_string(current_payload.get("config_id"))
                    or project.id
                )
                if ensure_saved_config_row(
                    row_id=current_config_id,
                    project=project,
                    device=resolved_device,
                    payload=current_payload,
                    rows_by_id=rows_by_id,
                ):
                    changed = True
                normalized_current, current_payload_changed = _normalize_saved_config_payload(
                    current_payload,
                    row_id=current_config_id,
                    project=project,
                    device=resolved_device,
                )
                if current_payload_changed or project.config != normalized_current:
                    project.config = normalized_current
                    changed = True
                if getattr(project, "current_config_id", None) != current_config_id:
                    project.current_config_id = current_config_id
                    changed = True
            elif getattr(project, "current_config_id", None):
                project.current_config_id = None
                changed = True

            pending_payload = _decode_json_object(project.pending_config)
            if pending_payload is not None:
                pending_config_id = (
                    _trimmed_string(getattr(project, "pending_config_id", None))
                    or _trimmed_string(pending_payload.get("config_id"))
                    or _trimmed_string(getattr(project, "pending_build_job_id", None))
                    or str(uuid.uuid4())
                )
                if ensure_saved_config_row(
                    row_id=pending_config_id,
                    project=project,
                    device=resolved_device,
                    payload=pending_payload,
                    rows_by_id=rows_by_id,
                ):
                    changed = True
                normalized_pending, pending_payload_changed = _normalize_saved_config_payload(
                    pending_payload,
                    row_id=pending_config_id,
                    project=project,
                    device=resolved_device,
                )
                if pending_payload_changed or project.pending_config != normalized_pending:
                    project.pending_config = normalized_pending
                    changed = True
                if getattr(project, "pending_config_id", None) != pending_config_id:
                    project.pending_config_id = pending_config_id
                    changed = True
            elif getattr(project, "pending_config_id", None):
                project.pending_config_id = None
                changed = True

        for job in db.query(BuildJob).order_by(BuildJob.created_at.asc(), BuildJob.id.asc()).all():
            project = projects.get(job.project_id)
            if project is None:
                continue

            linked_devices = devices_by_project.get(project.id, [])
            resolved_device = _resolve_project_device(
                project,
                linked_devices,
                preferred_payloads=(
                    job.staged_project_config,
                    project.pending_config,
                    project.config,
                ),
            )
            snapshot = _decode_json_object(job.staged_project_config)
            if snapshot is None:
                continue
            if is_config_history_deleted_payload(snapshot):
                if getattr(job, "saved_config_id", None) is not None:
                    job.saved_config_id = None
                    changed = True
                continue

            row_id = (
                _trimmed_string(getattr(job, "saved_config_id", None))
                or _trimmed_string(snapshot.get("config_id"))
                or job.id
            )
            applied_at = job.finished_at if job.status == JobStatus.flashed else None
            if ensure_saved_config_row(
                row_id=row_id,
                project=project,
                device=resolved_device,
                payload=snapshot,
                rows_by_id=rows_by_id,
                last_applied_at=applied_at,
            ):
                changed = True
            if getattr(job, "saved_config_id", None) != row_id:
                job.saved_config_id = row_id
                changed = True

        if changed:
            db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("Saved DIY config backfill failed (non-fatal): %s", exc)
    finally:
        db.close()

def _cleanup_legacy_user_approval_status():
    try:
        _drop_column_if_exists("users", "approval_status")
    except Exception as exc:
        logger.warning("Legacy users.approval_status cleanup failed (non-fatal): %s", exc)


def _cleanup_legacy_unused_tables():
    for table_name in ("firmwares",):
        try:
            if _drop_table_if_exists(table_name):
                logger.info("Dropped legacy unused table %s", table_name)
        except Exception as exc:
            logger.warning("Legacy unused-table cleanup failed for %s (non-fatal): %s", table_name, exc)


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

def _ensure_runtime_indexes() -> None:
    if not _table_exists("device_history"):
        return

    _ensure_index(
        "device_history",
        "ix_device_history_device_event_timestamp_id",
        (
            "CREATE INDEX ix_device_history_device_event_timestamp_id "
            "ON device_history (device_id, event_type, timestamp, id)"
        ),
        (
            "CREATE INDEX ix_device_history_device_event_timestamp_id "
            "ON device_history (device_id, event_type, `timestamp`, id)"
        ),
    )


def initialize_database(max_attempts: int = 3, retry_delay: float = 1.0):
    last_error = None

    for attempt in range(1, max_attempts + 1):
        try:
            Base.metadata.create_all(bind=engine)
            _cleanup_legacy_unused_tables()
            _ensure_additive_columns()
            _ensure_runtime_indexes()
            _backfill_room_household_ids()
            _backfill_project_wifi_credentials()
            _backfill_legacy_build_history_metadata()
            _cleanup_project_board_config_data()
            _backfill_saved_project_configs()
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
