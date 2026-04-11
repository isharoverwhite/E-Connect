# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

from __future__ import annotations

import json
import logging
import os
import shutil
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


logger = logging.getLogger(__name__)

BUILD_BASE_DIR = Path(os.getenv("BUILD_BASE_DIR", "/tmp/econnect_builds"))
FIRMWARE_TEMPLATE_REPO = os.getenv("FIRMWARE_TEMPLATE_REPO", "econnectrelease/firmware").strip()
FIRMWARE_TEMPLATE_API_BASE_URL = os.getenv("FIRMWARE_TEMPLATE_API_BASE_URL", "https://api.github.com").rstrip("/")
FIRMWARE_TEMPLATE_INSTALL_ROOT = Path(
    os.getenv(
        "FIRMWARE_TEMPLATE_INSTALL_ROOT",
        str(BUILD_BASE_DIR.parent / "firmware-template"),
    )
)
FIRMWARE_TEMPLATE_CURRENT_DIR = FIRMWARE_TEMPLATE_INSTALL_ROOT / "current"
FIRMWARE_TEMPLATE_STATE_FILE = FIRMWARE_TEMPLATE_INSTALL_ROOT / "state.json"
FIRMWARE_TEMPLATE_HTTP_TIMEOUT_SECONDS = max(
    1.0,
    float(os.getenv("FIRMWARE_TEMPLATE_HTTP_TIMEOUT_SECONDS", "15")),
)
FIRMWARE_TEMPLATE_UPDATE_CHECK_SECONDS = max(
    60,
    int(os.getenv("FIRMWARE_TEMPLATE_UPDATE_CHECK_SECONDS", "3600")),
)
GITHUB_API_VERSION = os.getenv("FIRMWARE_TEMPLATE_GITHUB_API_VERSION", "2026-03-10").strip() or "2026-03-10"

_REQUIRED_TEMPLATE_FILES = (
    "platformio.ini",
    "include/firmware_revision.h",
    "src/main.cpp",
)


def _bool_env(name: str, default: str = "1") -> bool:
    raw_value = os.getenv(name, default).strip().lower()
    return raw_value not in {"0", "false", "no", "off"}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _serialize_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_datetime(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    normalized = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _sanitize_release_tag(tag: str) -> str:
    return "".join(ch if ch.isalnum() or ch in {"-", "_", "."} else "_" for ch in tag.strip())


def _read_firmware_revision(template_dir: Path) -> str | None:
    revision_file = template_dir / "include" / "firmware_revision.h"
    if not revision_file.exists():
        return None

    try:
        with revision_file.open("r", encoding="utf-8") as handle:
            for line in handle:
                if "ECONNECT_FIRMWARE_REVISION" not in line:
                    continue
                parts = line.strip().split()
                if len(parts) >= 3 and parts[1] == "ECONNECT_FIRMWARE_REVISION":
                    return parts[2].strip('"')
    except OSError:
        logger.exception("Failed to read firmware revision from %s", revision_file)
        return None

    return None


def _is_valid_template_dir(template_dir: Path) -> bool:
    return all((template_dir / relative_path).exists() for relative_path in _REQUIRED_TEMPLATE_FILES)


def _ensure_install_root() -> None:
    FIRMWARE_TEMPLATE_INSTALL_ROOT.mkdir(parents=True, exist_ok=True)


def _load_state() -> dict[str, Any]:
    if not FIRMWARE_TEMPLATE_STATE_FILE.exists():
        return {}

    try:
        with FIRMWARE_TEMPLATE_STATE_FILE.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        logger.exception("Failed to load firmware template state from %s", FIRMWARE_TEMPLATE_STATE_FILE)
        return {}

    return payload if isinstance(payload, dict) else {}


def _save_state(state: Mapping[str, Any]) -> None:
    _ensure_install_root()
    temp_path = FIRMWARE_TEMPLATE_STATE_FILE.with_suffix(".tmp")
    payload = dict(state)
    with temp_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
    os.replace(temp_path, FIRMWARE_TEMPLATE_STATE_FILE)


def _build_status(state: Mapping[str, Any] | None = None) -> dict[str, Any]:
    payload = dict(state or {})
    installed_release_tag = payload.get("installed_release_tag")
    latest_release_tag = payload.get("latest_release_tag")

    active_dir: Path | None = FIRMWARE_TEMPLATE_CURRENT_DIR if _is_valid_template_dir(FIRMWARE_TEMPLATE_CURRENT_DIR) else None
    active_source = "release" if active_dir else "missing"
    active_revision = _read_firmware_revision(active_dir) if active_dir else None

    return {
        "source_repo": FIRMWARE_TEMPLATE_REPO,
        "auto_update_enabled": _bool_env("FIRMWARE_TEMPLATE_AUTO_UPDATE", "1"),
        "active_source": active_source,
        "active_path": str(active_dir) if active_dir else None,
        "active_revision": active_revision,
        "active_release_tag": installed_release_tag if active_source == "release" else None,
        "bundled_revision": None,
        "installed_release_tag": installed_release_tag if isinstance(installed_release_tag, str) and installed_release_tag.strip() else None,
        "latest_release_tag": latest_release_tag if isinstance(latest_release_tag, str) and latest_release_tag.strip() else None,
        "latest_release_published_at": payload.get("latest_release_published_at"),
        "last_checked_at": payload.get("last_checked_at"),
        "last_install_at": payload.get("last_install_at"),
        "last_error": payload.get("last_error"),
        "update_available": bool(
            isinstance(latest_release_tag, str)
            and latest_release_tag.strip()
            and latest_release_tag != installed_release_tag
        ),
    }


def _build_pending_notification(state: Mapping[str, Any]) -> dict[str, Any] | None:
    pending_release_tag = state.get("pending_notification_release_tag")
    if not isinstance(pending_release_tag, str) or not pending_release_tag.strip():
        return None

    payload: dict[str, Any] = {
        "release_tag": pending_release_tag.strip(),
        "release_revision": state.get("pending_notification_release_revision"),
        "previous_release_tag": state.get("pending_notification_previous_release_tag"),
        "previous_revision": state.get("pending_notification_previous_revision"),
        "installed_at": state.get("pending_notification_installed_at"),
        "source_repo": FIRMWARE_TEMPLATE_REPO,
    }
    return payload


def _build_github_request(url: str) -> Request:
    return Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "econnect-server-firmware-template-updater",
            "X-GitHub-Api-Version": GITHUB_API_VERSION,
        },
    )


def _fetch_latest_release_metadata() -> dict[str, Any] | None:
    if not FIRMWARE_TEMPLATE_REPO:
        return None

    url = f"{FIRMWARE_TEMPLATE_API_BASE_URL}/repos/{FIRMWARE_TEMPLATE_REPO}/releases/latest"
    try:
        with urlopen(_build_github_request(url), timeout=FIRMWARE_TEMPLATE_HTTP_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        if exc.code == 404:
            return None
        raise
    except URLError:
        raise

    if not isinstance(payload, dict):
        raise ValueError("Unexpected GitHub release response payload.")

    tag_name = str(payload.get("tag_name") or "").strip()
    tarball_url = str(payload.get("tarball_url") or "").strip()
    if not tag_name or not tarball_url:
        raise ValueError("GitHub latest release payload is missing tag_name or tarball_url.")

    return {
        "tag_name": tag_name,
        "tarball_url": tarball_url,
        "html_url": str(payload.get("html_url") or "").strip() or None,
        "published_at": str(payload.get("published_at") or "").strip() or None,
    }


def _download_release_tarball(url: str, destination: Path) -> None:
    with urlopen(_build_github_request(url), timeout=FIRMWARE_TEMPLATE_HTTP_TIMEOUT_SECONDS) as response:
        with destination.open("wb") as handle:
            shutil.copyfileobj(response, handle)


def _extract_release_tarball(archive_path: Path, destination_dir: Path) -> None:
    with tarfile.open(archive_path, mode="r:*") as archive:
        for member in archive.getmembers():
            if not member.name:
                continue
            relative_parts = Path(member.name).parts[1:]
            if not relative_parts:
                continue

            target_path = destination_dir.joinpath(*relative_parts)
            if member.isdir():
                target_path.mkdir(parents=True, exist_ok=True)
                continue

            if not member.isfile():
                continue

            target_path.parent.mkdir(parents=True, exist_ok=True)
            source_handle = archive.extractfile(member)
            if source_handle is None:
                continue
            with source_handle, target_path.open("wb") as destination_handle:
                shutil.copyfileobj(source_handle, destination_handle)


def _install_extracted_template(staging_dir: Path) -> None:
    if not _is_valid_template_dir(staging_dir):
        raise ValueError("Downloaded firmware template release is missing required files.")

    _ensure_install_root()
    backup_dir = FIRMWARE_TEMPLATE_INSTALL_ROOT / "current.previous"
    if backup_dir.exists():
        shutil.rmtree(backup_dir)
    if FIRMWARE_TEMPLATE_CURRENT_DIR.exists():
        os.replace(FIRMWARE_TEMPLATE_CURRENT_DIR, backup_dir)
    os.replace(staging_dir, FIRMWARE_TEMPLATE_CURRENT_DIR)
    if backup_dir.exists():
        shutil.rmtree(backup_dir, ignore_errors=True)


def _should_check_remote(state: Mapping[str, Any], *, force: bool) -> bool:
    if force:
        return True
    if not _bool_env("FIRMWARE_TEMPLATE_AUTO_UPDATE", "1"):
        return False

    last_checked_at = _parse_datetime(state.get("last_checked_at"))
    if last_checked_at is None:
        return True

    age_seconds = (_utcnow() - last_checked_at).total_seconds()
    return age_seconds >= FIRMWARE_TEMPLATE_UPDATE_CHECK_SECONDS


def refresh_firmware_template_release(*, force: bool = False) -> dict[str, Any]:
    state = _load_state()
    if not _should_check_remote(state, force=force):
        return _build_status(state)

    now = _utcnow()
    try:
        release_metadata = _fetch_latest_release_metadata()
    except Exception as exc:
        logger.warning("Firmware template release check failed: %s", exc)
        state["last_checked_at"] = _serialize_datetime(now)
        state["last_error"] = str(exc)
        _save_state(state)
        return _build_status(state)

    state["last_checked_at"] = _serialize_datetime(now)
    state["last_error"] = None

    if release_metadata is None:
        state["latest_release_tag"] = None
        state["latest_release_published_at"] = None
        _save_state(state)
        return _build_status(state)

    latest_release_tag = release_metadata["tag_name"]
    state["latest_release_tag"] = latest_release_tag
    state["latest_release_published_at"] = release_metadata["published_at"]
    previous_release_tag = state.get("installed_release_tag")
    previous_revision = state.get("installed_revision")

    if (
        state.get("installed_release_tag") == latest_release_tag
        and _is_valid_template_dir(FIRMWARE_TEMPLATE_CURRENT_DIR)
    ):
        _save_state(state)
        return _build_status(state)

    _ensure_install_root()
    with tempfile.TemporaryDirectory(
        prefix="econnect-firmware-template-",
        dir=FIRMWARE_TEMPLATE_INSTALL_ROOT,
    ) as temp_dir:
        temp_path = Path(temp_dir)
        archive_path = temp_path / "firmware-template.tar.gz"
        staging_dir = temp_path / f"release-{_sanitize_release_tag(latest_release_tag)}"
        staging_dir.mkdir(parents=True, exist_ok=True)

        try:
            _download_release_tarball(release_metadata["tarball_url"], archive_path)
            _extract_release_tarball(archive_path, staging_dir)
            installed_revision = _read_firmware_revision(staging_dir)
            _install_extracted_template(staging_dir)
        except Exception as exc:
            logger.warning("Firmware template install failed for %s: %s", latest_release_tag, exc)
            state["last_error"] = str(exc)
            _save_state(state)
            return _build_status(state)

    state["installed_release_tag"] = latest_release_tag
    installed_at = _serialize_datetime(_utcnow())
    state["last_install_at"] = installed_at
    if installed_revision:
        state["installed_revision"] = installed_revision
    else:
        state.pop("installed_revision", None)
    if previous_release_tag != latest_release_tag:
        state["pending_notification_release_tag"] = latest_release_tag
        state["pending_notification_release_revision"] = installed_revision
        state["pending_notification_previous_release_tag"] = previous_release_tag
        state["pending_notification_previous_revision"] = previous_revision
        state["pending_notification_installed_at"] = installed_at
    _save_state(state)
    return _build_status(state)


def resolve_firmware_template_directory(*, check_for_updates: bool = True) -> Path:
    if check_for_updates:
        refresh_firmware_template_release()

    if _is_valid_template_dir(FIRMWARE_TEMPLATE_CURRENT_DIR):
        return FIRMWARE_TEMPLATE_CURRENT_DIR

    state = _load_state()
    last_error = state.get("last_error")
    last_error_hint = f" Last error: {last_error}" if isinstance(last_error, str) and last_error.strip() else ""
    raise FileNotFoundError(
        "Firmware template is not installed yet. "
        f"Expected required files under: {FIRMWARE_TEMPLATE_CURRENT_DIR}.{last_error_hint}"
    )


def get_latest_firmware_revision() -> str | None:
    try:
        template_dir = resolve_firmware_template_directory(check_for_updates=False)
    except FileNotFoundError:
        return None
    return _read_firmware_revision(template_dir)


def get_firmware_template_status(*, force_check: bool = False) -> dict[str, Any]:
    if force_check:
        return refresh_firmware_template_release(force=True)
    return _build_status(_load_state())


def consume_pending_firmware_template_notification() -> dict[str, Any] | None:
    state = _load_state()
    payload = _build_pending_notification(state)
    if payload is None:
        return None

    for key in (
        "pending_notification_release_tag",
        "pending_notification_release_revision",
        "pending_notification_previous_release_tag",
        "pending_notification_previous_revision",
        "pending_notification_installed_at",
    ):
        state.pop(key, None)
    _save_state(state)
    return payload
