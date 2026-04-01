from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.sql_models import (
    SystemLog,
    SystemLogCategory,
    SystemLogSeverity,
)


logger = logging.getLogger(__name__)

SYSTEM_LOG_RETENTION_DAYS = max(1, int(os.getenv("SYSTEM_LOG_RETENTION_DAYS", "30")))
SYSTEM_LOG_RETENTION = timedelta(days=SYSTEM_LOG_RETENTION_DAYS)
SYSTEM_START_EVENT_CODE = "server_started"
SYSTEM_SHUTDOWN_EVENT_CODE = "server_shutdown"
SYSTEM_UNCLEAN_EVENT_CODE = "server_unclean_shutdown_detected"
SYSTEM_LOG_ALERT_SEVERITIES = (
    SystemLogSeverity.warning,
    SystemLogSeverity.error,
    SystemLogSeverity.critical,
)


def _normalize_details(details: Any) -> dict[str, Any] | None:
    if details is None:
        return None

    if isinstance(details, dict):
        normalized: dict[str, Any] = {}
        for key, value in details.items():
            normalized[str(key)] = _normalize_detail_value(value)
        return normalized

    return {"value": _normalize_detail_value(details)}


def _normalize_detail_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _normalize_detail_value(inner) for key, inner in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_normalize_detail_value(inner) for inner in value]
    return str(value)


def create_system_log(
    db: Session,
    *,
    event_code: str,
    message: str,
    severity: SystemLogSeverity = SystemLogSeverity.info,
    category: SystemLogCategory = SystemLogCategory.health,
    device_id: str | None = None,
    firmware_version: str | None = None,
    firmware_revision: str | None = None,
    details: Any = None,
    occurred_at: datetime | None = None,
) -> SystemLog:
    entry = SystemLog(
        occurred_at=occurred_at or datetime.utcnow(),
        severity=severity,
        category=category,
        event_code=event_code.strip(),
        message=message.strip(),
        device_id=device_id,
        firmware_version=firmware_version,
        firmware_revision=firmware_revision,
        details=_normalize_details(details),
    )
    db.add(entry)
    return entry


def record_system_log(
    *,
    event_code: str,
    message: str,
    severity: SystemLogSeverity = SystemLogSeverity.info,
    category: SystemLogCategory = SystemLogCategory.health,
    device_id: str | None = None,
    firmware_version: str | None = None,
    firmware_revision: str | None = None,
    details: Any = None,
    occurred_at: datetime | None = None,
) -> bool:
    db = SessionLocal()
    try:
        create_system_log(
            db,
            event_code=event_code,
            message=message,
            severity=severity,
            category=category,
            device_id=device_id,
            firmware_version=firmware_version,
            firmware_revision=firmware_revision,
            details=details,
            occurred_at=occurred_at,
        )
        db.commit()
        return True
    except Exception:
        db.rollback()
        logger.exception("Failed to persist system log %s", event_code)
        return False
    finally:
        db.close()


def prune_expired_system_logs(
    db: Session,
    *,
    reference_time: datetime | None = None,
) -> int:
    cutoff = (reference_time or datetime.utcnow()) - SYSTEM_LOG_RETENTION
    deleted = (
        db.query(SystemLog)
        .filter(SystemLog.occurred_at < cutoff)
        .delete(synchronize_session=False)
    )
    return int(deleted or 0)


def record_server_startup(
    db: Session,
    *,
    occurred_at: datetime | None = None,
    advertised_host: str | None = None,
) -> None:
    event_time = occurred_at or datetime.utcnow()
    latest_lifecycle_event = (
        db.query(SystemLog)
        .filter(SystemLog.category == SystemLogCategory.lifecycle)
        .order_by(SystemLog.occurred_at.desc(), SystemLog.id.desc())
        .first()
    )

    if latest_lifecycle_event and latest_lifecycle_event.event_code != SYSTEM_SHUTDOWN_EVENT_CODE:
        create_system_log(
            db,
            occurred_at=event_time,
            severity=SystemLogSeverity.critical,
            category=SystemLogCategory.lifecycle,
            event_code=SYSTEM_UNCLEAN_EVENT_CODE,
            message="Previous server session ended unexpectedly. Possible power loss or hard stop.",
            details={
                "previous_event_code": latest_lifecycle_event.event_code,
                "previous_event_at": latest_lifecycle_event.occurred_at,
            },
        )

    create_system_log(
        db,
        occurred_at=event_time,
        severity=SystemLogSeverity.info,
        category=SystemLogCategory.lifecycle,
        event_code=SYSTEM_START_EVENT_CODE,
        message="Server startup completed.",
        details={
            "advertised_host": advertised_host,
            "retention_days": SYSTEM_LOG_RETENTION_DAYS,
        },
    )


def record_server_shutdown(
    db: Session,
    *,
    occurred_at: datetime | None = None,
    advertised_host: str | None = None,
) -> None:
    create_system_log(
        db,
        occurred_at=occurred_at or datetime.utcnow(),
        severity=SystemLogSeverity.info,
        category=SystemLogCategory.lifecycle,
        event_code=SYSTEM_SHUTDOWN_EVENT_CODE,
        message="Server shutdown completed.",
        details={"advertised_host": advertised_host},
    )
