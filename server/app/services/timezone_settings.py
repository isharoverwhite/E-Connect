from __future__ import annotations

import json
import logging
import os
import time as time_module
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session

from app.sql_models import Household


logger = logging.getLogger(__name__)

DEFAULT_SERVER_TIMEZONE = "Asia/Ho_Chi_Minh"
TIMEZONE_ENV_VAR = "TZ"
TIMEZONE_ENV_FALLBACK_CACHE_VAR = "E_CONNECT_TZ_ENV_FALLBACK"
TIMEZONE_DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "wikipedia_timezones.json"


@lru_cache(maxsize=1)
def get_supported_timezones() -> tuple[str, ...]:
    payload = json.loads(TIMEZONE_DATA_PATH.read_text(encoding="utf-8"))
    raw_values = payload.get("canonical_timezones", [])
    if not isinstance(raw_values, list):
        raise ValueError("Invalid timezone data file: canonical_timezones must be a list")

    values = {
        str(value).strip()
        for value in raw_values
        if isinstance(value, str) and value.strip()
    }
    values.add(DEFAULT_SERVER_TIMEZONE)
    return tuple(sorted(values))


@lru_cache(maxsize=1)
def _supported_timezone_index() -> frozenset[str]:
    return frozenset(get_supported_timezones())


def normalize_supported_timezone(value: Any) -> str | None:
    if not isinstance(value, str):
        return None

    normalized = value.strip()
    if not normalized or normalized not in _supported_timezone_index():
        return None

    try:
        ZoneInfo(normalized)
    except ZoneInfoNotFoundError:
        logger.warning("Timezone %s is listed in data but not available in the runtime tz database", normalized)
        return None

    return normalized


def _cache_env_timezone_fallback() -> None:
    if TIMEZONE_ENV_FALLBACK_CACHE_VAR in os.environ:
        return

    raw_env_timezone = os.getenv(TIMEZONE_ENV_VAR)
    os.environ[TIMEZONE_ENV_FALLBACK_CACHE_VAR] = raw_env_timezone.strip() if isinstance(raw_env_timezone, str) else ""


def get_env_timezone() -> str | None:
    cached_value = os.getenv(TIMEZONE_ENV_FALLBACK_CACHE_VAR)
    if cached_value is not None:
        return normalize_supported_timezone(cached_value)

    return normalize_supported_timezone(os.getenv(TIMEZONE_ENV_VAR))


def resolve_effective_timezone_context(
    *,
    household: Household | None = None,
    db: Session | None = None,
    household_id: int | None = None,
) -> dict[str, str | None]:
    configured_timezone = None

    if household is None and db is not None and household_id is not None:
        household = (
            db.query(Household)
            .filter(Household.household_id == household_id)
            .first()
        )

    if household is not None:
        configured_timezone = normalize_supported_timezone(household.timezone)

    env_timezone = get_env_timezone()
    if configured_timezone:
        return {
            "configured_timezone": configured_timezone,
            "effective_timezone": configured_timezone,
            "timezone_source": "setting",
        }

    return {
        "configured_timezone": None,
        "effective_timezone": env_timezone or DEFAULT_SERVER_TIMEZONE,
        "timezone_source": "runtime",
    }


def apply_process_timezone(timezone_name: str) -> str:
    normalized = normalize_supported_timezone(timezone_name) or DEFAULT_SERVER_TIMEZONE
    _cache_env_timezone_fallback()
    os.environ[TIMEZONE_ENV_VAR] = normalized

    tzset = getattr(time_module, "tzset", None)
    if callable(tzset):
        tzset()

    return normalized


def apply_effective_timezone_context(
    *,
    household: Household | None = None,
    db: Session | None = None,
    household_id: int | None = None,
) -> dict[str, str | None]:
    context = resolve_effective_timezone_context(
        household=household,
        db=db,
        household_id=household_id,
    )
    context["effective_timezone"] = apply_process_timezone(str(context["effective_timezone"]))
    return context


def get_current_server_time(timezone_name: str) -> datetime:
    normalized = normalize_supported_timezone(timezone_name) or DEFAULT_SERVER_TIMEZONE
    return datetime.now(ZoneInfo(normalized))
