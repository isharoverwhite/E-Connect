from __future__ import annotations

import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo


def normalize_utc_naive_timestamp(value: datetime | None, *, fallback: datetime) -> datetime:
    if value is None:
        return fallback
    if getattr(value, "tzinfo", None) is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _runtime_local_timezone():
    tz_name = os.getenv("TZ")
    if tz_name:
        try:
            return ZoneInfo(tz_name)
        except Exception:
            pass
    return datetime.now().astimezone().tzinfo or timezone.utc


def normalize_build_job_timestamp(value: datetime | None, *, reference_time: datetime) -> datetime:
    normalized_utc = normalize_utc_naive_timestamp(value, fallback=reference_time)
    if value is None or getattr(value, "tzinfo", None) is not None:
        return normalized_utc

    # MariaDB server-default timestamps are stored in the DB's local timezone,
    # while runtime-written timestamps are stored as UTC-naive datetimes.
    # Prefer whichever interpretation is closest to the current UTC reference.
    local_tz = _runtime_local_timezone()
    normalized_local = value.replace(tzinfo=local_tz).astimezone(timezone.utc).replace(tzinfo=None)
    if abs(normalized_local - reference_time) < abs(normalized_utc - reference_time):
        return normalized_local
    return normalized_utc
