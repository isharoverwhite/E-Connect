# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

from fastapi import FastAPI
from fastapi import Request
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.responses import JSONResponse
from fastapi.responses import RedirectResponse
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
import asyncio
import base64
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
import ipaddress
import json
import logging
import os
from pathlib import Path
import re
from urllib.parse import urlparse
from app.api import (
    DEVICE_HEARTBEAT_TIMEOUT_SECONDS,
    expire_stale_online_devices_once,
    refresh_external_device_states_once,
    router as device_router,
)
from sqlalchemy.exc import OperationalError

from app.database import SessionLocal, check_database_connection, get_db, initialize_database
from app.mqtt import mqtt_manager
from app.ws_manager import manager as ws_manager
from app.services.builder import (
    audit_runtime_firmware_target_mismatches,
    consume_pending_firmware_template_notification,
    extract_runtime_firmware_network_targets,
    refresh_firmware_template_release,
    resolve_runtime_firmware_network_state,
    resolve_webapp_transport,
)
from app.services.automation_runtime import process_time_trigger_automations
from app.services.mdns import MdnsPublisher, resolve_mdns_registration_config
from app.services.system_metrics import collect_system_metrics
from app.services.system_logs import (
    prune_expired_system_logs,
    record_server_shutdown,
    record_server_startup,
    record_system_log,
)
from app.services.timezone_settings import apply_effective_timezone_context
from app.sql_models import Household, SystemLogCategory, SystemLogSeverity, User

logger = logging.getLogger(__name__)
STATIC_DIR = Path(__file__).resolve().parent / "static"
STALE_DEVICE_SWEEP_INTERVAL_SECONDS = max(1, min(DEVICE_HEARTBEAT_TIMEOUT_SECONDS, 2))
RUNTIME_NETWORK_REFRESH_INTERVAL_SECONDS = max(
    1.0,
    float(os.getenv("RUNTIME_NETWORK_REFRESH_INTERVAL_SECONDS", "5")),
)
SYSTEM_LOG_RETENTION_SWEEP_INTERVAL_SECONDS = max(
    60.0,
    float(os.getenv("SYSTEM_LOG_RETENTION_SWEEP_INTERVAL_SECONDS", "3600")),
)
FIRMWARE_TEMPLATE_REFRESH_INTERVAL_SECONDS = max(
    60.0,
    float(os.getenv("FIRMWARE_TEMPLATE_UPDATE_CHECK_SECONDS", "3600")),
)
AUTOMATION_TIME_TRIGGER_INTERVAL_SECONDS = max(
    5.0,
    min(60.0, float(os.getenv("AUTOMATION_TIME_TRIGGER_INTERVAL_SECONDS", "15"))),
)
EXTERNAL_DEVICE_POLL_INTERVAL_SECONDS = max(
    1.0,
    float(os.getenv("EXTERNAL_DEVICE_POLL_INTERVAL_SECONDS", "5")),
)
JSONP_CALLBACK_PATTERN = re.compile(r"^[A-Za-z_$][0-9A-Za-z_$.]*$")
DISCOVERY_BRIDGE_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")

def _using_overridden_database(app: FastAPI) -> bool:
    return get_db in app.dependency_overrides


def _should_refresh_runtime_network_state(runtime_state: object) -> bool:
    if not isinstance(runtime_state, dict):
        return True

    source = runtime_state.get("source")
    return not isinstance(source, str) or source.strip() == "startup_auto"


def _runtime_network_state_signature(runtime_state: object) -> tuple[str | None, str | None, str | None]:
    if not isinstance(runtime_state, dict):
        return None, None, None

    source = runtime_state.get("source")
    normalized_source = source.strip() if isinstance(source, str) and source.strip() else None

    targets = extract_runtime_firmware_network_targets(runtime_state)
    target_key = None
    if isinstance(targets, dict):
        raw_target_key = targets.get("target_key")
        if isinstance(raw_target_key, str) and raw_target_key.strip():
            target_key = raw_target_key.strip()

    error = runtime_state.get("error")
    normalized_error = error.strip() if isinstance(error, str) and error.strip() else None
    return normalized_source, target_key, normalized_error


def _refresh_runtime_network_state(app: FastAPI) -> dict[str, object] | None:
    current_state = getattr(app.state, "firmware_network_state", None)
    if not _should_refresh_runtime_network_state(current_state):
        return current_state if isinstance(current_state, dict) else None

    refreshed_state = resolve_runtime_firmware_network_state()
    current_signature = _runtime_network_state_signature(current_state)
    refreshed_signature = _runtime_network_state_signature(refreshed_state)
    if current_signature == refreshed_signature:
        if not isinstance(current_state, dict):
            app.state.firmware_network_state = refreshed_state
            mqtt_manager.set_runtime_network_state(refreshed_state)
        return refreshed_state

    previous_targets = extract_runtime_firmware_network_targets(current_state)
    next_targets = extract_runtime_firmware_network_targets(refreshed_state)

    app.state.firmware_network_state = refreshed_state
    mqtt_manager.set_runtime_network_state(refreshed_state)

    if getattr(app.state, "database_ready", False) and not _using_overridden_database(app):
        db = SessionLocal()
        try:
            app.state.firmware_network_audit = audit_runtime_firmware_target_mismatches(db, refreshed_state)
        finally:
            db.close()

    previous_target_key = previous_targets.get("target_key") if isinstance(previous_targets, dict) else None
    next_target_key = next_targets.get("target_key") if isinstance(next_targets, dict) else None
    if previous_target_key and next_target_key and previous_target_key != next_target_key:
        logger.info(
            "Runtime firmware targets changed automatically: %s -> %s",
            previous_target_key,
            next_target_key,
        )
        record_system_log(
            event_code="runtime_target_changed",
            message=f"Runtime network target changed from {previous_target_key} to {next_target_key}.",
            severity=SystemLogSeverity.info,
            category=SystemLogCategory.health,
            details={
                "previous_target_key": previous_target_key,
                "next_target_key": next_target_key,
            },
        )

    previous_error = current_signature[2]
    next_error = refreshed_signature[2]
    if previous_error != next_error and next_error:
        logger.warning("Runtime firmware target refresh warning: %s", next_error)
        record_system_log(
            event_code="runtime_target_warning",
            message="Runtime network target refresh reported a warning.",
            severity=SystemLogSeverity.warning,
            category=SystemLogCategory.health,
            details={
                "warning": next_error,
                "target_key": next_target_key,
            },
        )

    return refreshed_state


def _serialize_firmware_network_state(app: FastAPI) -> dict[str, str] | None:
    runtime_state = getattr(app.state, "firmware_network_state", None)
    if not isinstance(runtime_state, dict):
        return None

    payload: dict[str, str] = {}
    source = runtime_state.get("source")
    if isinstance(source, str) and source.strip():
        payload["source"] = source

    targets = extract_runtime_firmware_network_targets(runtime_state)
    if isinstance(targets, dict):
        for key in ("advertised_host", "api_base_url", "mqtt_broker", "target_key"):
            value = targets.get(key)
            if isinstance(value, str) and value.strip():
                payload[key] = value
        mqtt_port = targets.get("mqtt_port")
        if mqtt_port is not None:
            payload["mqtt_port"] = str(mqtt_port)
        webapp_transport = resolve_webapp_transport(targets.get("api_base_url"))
        payload["webapp_protocol"] = str(webapp_transport["webapp_protocol"])
        payload["webapp_port"] = str(webapp_transport["webapp_port"])

    error = runtime_state.get("error")
    if isinstance(error, str) and error.strip():
        payload["error"] = error

    audit = getattr(app.state, "firmware_network_audit", None)
    if isinstance(audit, dict):
        warning = audit.get("warning")
        if isinstance(warning, str) and warning.strip():
            payload["warning"] = warning
        for key in ("stale_project_count", "stale_device_count"):
            value = audit.get(key)
            if value is not None:
                payload[key] = str(value)

    return payload or None


def _serialize_discovery_webapp_transport(app: FastAPI) -> dict[str, str] | None:
    runtime_state = getattr(app.state, "firmware_network_state", None)
    if not isinstance(runtime_state, dict):
        default_transport = resolve_webapp_transport(None)
        return {
            "protocol": str(default_transport["webapp_protocol"]),
            "port": str(default_transport["webapp_port"]),
        }

    targets = extract_runtime_firmware_network_targets(runtime_state)
    if not isinstance(targets, dict):
        default_transport = resolve_webapp_transport(None)
        return {
            "protocol": str(default_transport["webapp_protocol"]),
            "port": str(default_transport["webapp_port"]),
        }

    webapp_transport = resolve_webapp_transport(targets.get("api_base_url"))
    return {
        "protocol": str(webapp_transport["webapp_protocol"]),
        "port": str(webapp_transport["webapp_port"]),
    }


def _record_pending_firmware_template_notification() -> None:
    pending_notification = consume_pending_firmware_template_notification()
    if pending_notification is None:
        return

    release_tag = str(pending_notification.get("release_tag") or "").strip()
    release_revision = str(pending_notification.get("release_revision") or "").strip() or None
    previous_release_tag = str(pending_notification.get("previous_release_tag") or "").strip() or None
    previous_revision = str(pending_notification.get("previous_revision") or "").strip() or None

    if release_revision:
        message = (
            f"New firmware release {release_tag} ({release_revision}) was downloaded automatically. "
            "Update your boards to apply it."
        )
    else:
        message = (
            f"New firmware release {release_tag} was downloaded automatically. "
            "Update your boards to apply it."
        )

    record_system_log(
        event_code="firmware_template_release_installed",
        message=message,
        severity=SystemLogSeverity.warning,
        category=SystemLogCategory.firmware,
        firmware_revision=release_revision,
        details={
            "release_tag": release_tag,
            "release_revision": release_revision,
            "previous_release_tag": previous_release_tag,
            "previous_revision": previous_revision,
            "installed_at": pending_notification.get("installed_at"),
            "source_repo": pending_notification.get("source_repo"),
        },
    )


def _set_app_timezone_context(app: FastAPI, context: dict[str, object]) -> None:
    app.state.server_timezone = context.get("effective_timezone")
    app.state.server_timezone_source = context.get("timezone_source")


def _normalize_discovery_server_ip(value: object) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None

    try:
        parsed_ip = ipaddress.ip_address(value.strip())
    except ValueError:
        return None

    if not isinstance(parsed_ip, ipaddress.IPv4Address):
        return None

    if parsed_ip.is_loopback or parsed_ip.is_unspecified or parsed_ip.is_link_local or parsed_ip.is_multicast:
        return None

    return str(parsed_ip)


def _resolve_discovery_server_ip(request: Request) -> str | None:
    runtime_state = getattr(request.app.state, "firmware_network_state", None)

    targets = extract_runtime_firmware_network_targets(runtime_state)
    if isinstance(targets, dict):
        for key in ("advertised_host", "mqtt_broker"):
            normalized_address = _normalize_discovery_server_ip(targets.get(key))
            if normalized_address is not None:
                return normalized_address

        api_base_url = targets.get("api_base_url")
        if isinstance(api_base_url, str) and api_base_url.strip():
            with suppress(ValueError):
                normalized_address = _normalize_discovery_server_ip(urlparse(api_base_url.strip()).hostname)
                if normalized_address is not None:
                    return normalized_address

    with suppress(Exception):
        mdns_config = resolve_mdns_registration_config(runtime_state)
        if mdns_config is not None:
            for address in mdns_config.addresses:
                normalized_address = _normalize_discovery_server_ip(address)
                if normalized_address is not None:
                    return normalized_address

    return _normalize_discovery_server_ip(request.url.hostname)


def _resolve_initialized_state(app: FastAPI) -> bool | None:
    session_provider = app.dependency_overrides.get(get_db, get_db)
    session_context = session_provider()

    try:
        db = next(session_context)
    except StopIteration:
        return None
    except Exception:
        logger.exception("Failed to open a database session for the discovery health payload")
        return None

    try:
        return db.query(User).count() > 0
    except Exception:
        logger.exception("Failed to determine server initialization state for discovery health")
        return None
    finally:
        with suppress(Exception):
            session_context.close()


def _build_health_payload(request: Request) -> tuple[dict[str, object], int]:
    webapp_transport = _serialize_discovery_webapp_transport(request.app)
    server_ip = _resolve_discovery_server_ip(request)
    if _using_overridden_database(request.app):
        payload: dict[str, object] = {
            "status": "ok",
            "database": "overridden",
            "mqtt": "skipped",
            "initialized": _resolve_initialized_state(request.app),
        }
        if server_ip is not None:
            payload["server_ip"] = server_ip
        if webapp_transport is not None:
            payload["webapp"] = webapp_transport
        return payload, 200

    database_ready, database_error = check_database_connection()
    request.app.state.database_ready = database_ready
    request.app.state.database_error = database_error

    if database_ready:
        payload = {
            "status": "ok",
            "database": "ok",
            "mqtt": "connected" if mqtt_manager.connected else "disconnected",
            "initialized": _resolve_initialized_state(request.app),
        }
        if server_ip is not None:
            payload["server_ip"] = server_ip
        if webapp_transport is not None:
            payload["webapp"] = webapp_transport
        return payload, 200

    payload = {
        "status": "degraded",
        "database": "unavailable",
        "mqtt": "connected" if mqtt_manager.connected else "disconnected",
        "initialized": None,
    }
    if server_ip is not None:
        payload["server_ip"] = server_ip
    if webapp_transport is not None:
        payload["webapp"] = webapp_transport

    return payload, 503


def _resolve_root_redirect_transport(app: FastAPI) -> tuple[str, int]:
    default_transport = resolve_webapp_transport(None)
    runtime_state = _serialize_firmware_network_state(app)
    protocol = str(default_transport["webapp_protocol"])
    port = int(default_transport["webapp_port"])

    if isinstance(runtime_state, dict):
        raw_protocol = str(runtime_state.get("webapp_protocol", "")).strip().lower()
        if raw_protocol in {"http", "https"}:
            protocol = raw_protocol

        raw_port = runtime_state.get("webapp_port")
        try:
            parsed_port = int(str(raw_port).strip()) if raw_port is not None else None
        except ValueError:
            parsed_port = None
        if parsed_port is not None and 1 <= parsed_port <= 65535:
            port = parsed_port

    return protocol, port


def _normalize_target_origin(target_origin: str) -> str:
    normalized_origin = target_origin.strip()
    if not normalized_origin:
        raise HTTPException(status_code=400, detail="Missing target origin")

    parsed_origin = urlparse(normalized_origin)
    if parsed_origin.scheme not in {"http", "https"} or not parsed_origin.netloc:
        raise HTTPException(status_code=400, detail="Invalid target origin")
    if parsed_origin.path not in {"", "/"} or parsed_origin.params or parsed_origin.query or parsed_origin.fragment:
        raise HTTPException(status_code=400, detail="Invalid target origin")

    return f"{parsed_origin.scheme}://{parsed_origin.netloc}"


def _format_redirect_netloc(hostname: str, port: int) -> str:
    if ":" in hostname and not hostname.startswith("["):
        return f"[{hostname}]:{port}"
    return f"{hostname}:{port}"


@asynccontextmanager
async def lifespan(app: FastAPI):
    stale_device_watchdog_task: asyncio.Task[None] | None = None
    system_metrics_watchdog_task: asyncio.Task[None] | None = None
    runtime_network_watchdog_task: asyncio.Task[None] | None = None
    system_log_retention_task: asyncio.Task[None] | None = None
    automation_time_trigger_task: asyncio.Task[None] | None = None
    external_device_watchdog_task: asyncio.Task[None] | None = None

    async def stale_device_watchdog() -> None:
        while True:
            await asyncio.sleep(STALE_DEVICE_SWEEP_INTERVAL_SECONDS)
            try:
                expire_stale_online_devices_once()
            except Exception:
                logger.exception("Stale-device watchdog sweep failed")

    async def system_metrics_watchdog() -> None:
        while True:
            await asyncio.sleep(1.0)
            try:
                payload = collect_system_metrics()
                await ws_manager.broadcast_system_event("system_metrics", payload)
            except Exception:
                logger.exception("System metrics watchdog failed")

    async def runtime_network_watchdog() -> None:
        while True:
            await asyncio.sleep(RUNTIME_NETWORK_REFRESH_INTERVAL_SECONDS)
            try:
                _refresh_runtime_network_state(app)
            except Exception:
                logger.exception("Runtime network watchdog failed")

    async def system_log_retention_watchdog() -> None:
        while True:
            await asyncio.sleep(SYSTEM_LOG_RETENTION_SWEEP_INTERVAL_SECONDS)
            if _using_overridden_database(app) or not getattr(app.state, "database_ready", False):
                continue

            db = SessionLocal()
            try:
                deleted = prune_expired_system_logs(db)
                if deleted:
                    db.commit()
                    logger.info("Pruned %s expired system log rows.", deleted)
                else:
                    db.rollback()
            except Exception:
                db.rollback()
                logger.exception("System log retention watchdog failed")
            finally:
                db.close()

    async def automation_time_trigger_watchdog() -> None:
        while True:
            await asyncio.sleep(AUTOMATION_TIME_TRIGGER_INTERVAL_SECONDS)
            if _using_overridden_database(app) or not getattr(app.state, "database_ready", False):
                continue

            db = SessionLocal()
            try:
                logs = process_time_trigger_automations(
                    db,
                    publish_command=mqtt_manager.publish_command,
                    reference_time=datetime.now(timezone.utc),
                )
                db.commit()
                if logs:
                    logger.info("Executed %s automation time trigger(s).", len(logs))
            except Exception:
                db.rollback()
                logger.exception("Automation time-trigger watchdog failed")
            finally:
                db.close()

    async def firmware_template_refresh_watchdog() -> None:
        if os.getenv("FIRMWARE_TEMPLATE_AUTO_UPDATE", "1").strip().lower() in {"0", "false", "no", "off"}:
            return
        while True:
            await asyncio.sleep(FIRMWARE_TEMPLATE_REFRESH_INTERVAL_SECONDS)
            if _using_overridden_database(app):
                continue
            try:
                refresh_firmware_template_release(force=False)
                if getattr(app.state, "database_ready", False):
                    _record_pending_firmware_template_notification()
            except Exception:
                logger.exception("Firmware template auto-refresh failed")

    async def external_device_watchdog() -> None:
        while True:
            await asyncio.sleep(EXTERNAL_DEVICE_POLL_INTERVAL_SECONDS)
            if _using_overridden_database(app) or not getattr(app.state, "database_ready", False):
                continue

            try:
                refresh_external_device_states_once(session_factory=SessionLocal)
            except Exception:
                logger.exception("External-device watchdog failed")

    app.state.database_ready = False
    app.state.database_error = None
    app.state.mdns_publisher = None
    app.state.mqtt_started = False
    _set_app_timezone_context(app, apply_effective_timezone_context())
    app.state.server_started_at = datetime.utcnow()
    app.state.firmware_network_state = resolve_runtime_firmware_network_state()
    app.state.firmware_network_audit = None
    mqtt_manager.set_runtime_network_state(app.state.firmware_network_state)
    firmware_network_state = _serialize_firmware_network_state(app)
    if firmware_network_state and "advertised_host" in firmware_network_state:
        logger.info(
            "Firmware provisioning host resolved at startup via %s: %s",
            firmware_network_state.get("source", "unknown"),
            firmware_network_state["advertised_host"],
        )
    elif firmware_network_state and "error" in firmware_network_state:
        logger.warning("Firmware provisioning host auto-detect unavailable: %s", firmware_network_state["error"])

    try:
        mdns_config = resolve_mdns_registration_config(app.state.firmware_network_state)
    except ValueError as exc:
        logger.warning("mDNS alias publication disabled: %s", exc)
    else:
        if mdns_config is not None:
            mdns_publisher = MdnsPublisher()
            try:
                await mdns_publisher.start(mdns_config)
            except Exception:
                logger.exception(
                    "mDNS alias publication failed for %s -> %s",
                    mdns_config.hostname,
                    ", ".join(mdns_config.addresses),
                )
            else:
                app.state.mdns_publisher = mdns_publisher
                logger.info(
                    "Published mDNS alias %s -> %s (discovery %s, webapp %s)",
                    mdns_config.hostname,
                    ", ".join(mdns_config.addresses),
                    mdns_config.discovery_port,
                    mdns_config.webapp_port,
                )

    if _using_overridden_database(app):
        logger.info("Skipping startup database initialization because get_db is overridden")
        app.state.database_ready = True
        yield
        return

    database_ready, database_error = initialize_database()
    app.state.database_ready = database_ready
    app.state.database_error = database_error

    if database_ready:
        try:
            refresh_firmware_template_release(force=False)
            _record_pending_firmware_template_notification()
        except Exception:
            logger.exception("Initial firmware template release refresh failed")
        db = SessionLocal()
        try:
            primary_household = (
                db.query(Household)
                .order_by(Household.household_id.asc())
                .first()
            )
            _set_app_timezone_context(
                app,
                apply_effective_timezone_context(household=primary_household),
            )
            app.state.firmware_network_audit = audit_runtime_firmware_target_mismatches(
                db,
                app.state.firmware_network_state,
            )
            deleted = prune_expired_system_logs(
                db,
                reference_time=app.state.server_started_at,
            )
            record_server_startup(
                db,
                occurred_at=app.state.server_started_at,
                advertised_host=firmware_network_state.get("advertised_host")
                if isinstance(firmware_network_state, dict)
                else None,
            )
            db.commit()
            if deleted:
                logger.info("Pruned %s expired system log rows at startup.", deleted)
        finally:
            db.close()
        audit_warning = getattr(app.state, "firmware_network_audit", {}).get("warning")
        if isinstance(audit_warning, str) and audit_warning.strip():
            logger.warning(audit_warning)
        try:
            initial_external_poll = refresh_external_device_states_once(session_factory=SessionLocal)
        except Exception:
            logger.exception("Initial external-device poll failed")
        else:
            if initial_external_poll.get("probed", 0):
                logger.info("Initial external-device poll complete: %s", initial_external_poll)

    mqtt_manager.start()
    app.state.mqtt_started = True
    stale_device_watchdog_task = asyncio.create_task(stale_device_watchdog())
    system_metrics_watchdog_task = asyncio.create_task(system_metrics_watchdog())
    runtime_network_watchdog_task = asyncio.create_task(runtime_network_watchdog())
    system_log_retention_task = asyncio.create_task(system_log_retention_watchdog())
    automation_time_trigger_task = asyncio.create_task(automation_time_trigger_watchdog())
    firmware_template_refresh_task = asyncio.create_task(firmware_template_refresh_watchdog())
    external_device_watchdog_task = asyncio.create_task(external_device_watchdog())
    app.state.stale_device_watchdog_started = True

    try:
        yield
    finally:
        if stale_device_watchdog_task is not None:
            stale_device_watchdog_task.cancel()
            with suppress(asyncio.CancelledError):
                await stale_device_watchdog_task
        if system_metrics_watchdog_task is not None:
            system_metrics_watchdog_task.cancel()
            with suppress(asyncio.CancelledError):
                await system_metrics_watchdog_task
        if runtime_network_watchdog_task is not None:
            runtime_network_watchdog_task.cancel()
            with suppress(asyncio.CancelledError):
                await runtime_network_watchdog_task
        if system_log_retention_task is not None:
            system_log_retention_task.cancel()
            with suppress(asyncio.CancelledError):
                await system_log_retention_task
        if automation_time_trigger_task is not None:
            automation_time_trigger_task.cancel()
            with suppress(asyncio.CancelledError):
                await automation_time_trigger_task
        if firmware_template_refresh_task is not None:
            firmware_template_refresh_task.cancel()
            with suppress(asyncio.CancelledError):
                await firmware_template_refresh_task
        if external_device_watchdog_task is not None:
            external_device_watchdog_task.cancel()
            with suppress(asyncio.CancelledError):
                await external_device_watchdog_task
        if getattr(app.state, "database_ready", False) and not _using_overridden_database(app):
            shutdown_runtime_state = _serialize_firmware_network_state(app)
            db = SessionLocal()
            try:
                record_server_shutdown(
                    db,
                    occurred_at=datetime.utcnow(),
                    advertised_host=shutdown_runtime_state.get("advertised_host")
                    if isinstance(shutdown_runtime_state, dict)
                    else None,
                )
                db.commit()
            except Exception:
                db.rollback()
                logger.exception("Failed to persist graceful shutdown system log")
            finally:
                db.close()
        mdns_publisher = getattr(app.state, "mdns_publisher", None)
        if isinstance(mdns_publisher, MdnsPublisher):
            await mdns_publisher.stop()
        if app.state.mqtt_started:
            mqtt_manager.stop()

app = FastAPI(title="E-Connect Server", lifespan=lifespan)

# Allow CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(device_router, prefix="/api/v1")

# CI/test environments may not ship any static assets; serve 404s instead of failing import-time.
app.mount("/static", StaticFiles(directory=STATIC_DIR, check_dir=False), name="static")

@app.exception_handler(OperationalError)
async def database_error_handler(request: Request, exc: OperationalError):
    request.app.state.database_ready = False
    request.app.state.database_error = str(getattr(exc, "orig", exc))
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Database is unavailable",
            "status": "degraded",
        },
    )

@app.get("/health")
def health_check(request: Request):
    payload, status_code = _build_health_payload(request)
    if status_code == 200:
        return payload
    return JSONResponse(status_code=status_code, content=payload)


@app.get("/")
def root_redirect(request: Request):
    hostname = request.url.hostname or "localhost"
    protocol, port = _resolve_root_redirect_transport(request.app)
    redirect_url = f"{protocol}://{_format_redirect_netloc(hostname, port)}{request.url.path}"
    if request.url.query:
        redirect_url = f"{redirect_url}?{request.url.query}"
    return RedirectResponse(url=redirect_url, status_code=307)


@app.get("/web-assistant.js")
def web_assistant_script(request: Request, callback: str):
    normalized_callback = callback.strip()
    if not normalized_callback or JSONP_CALLBACK_PATTERN.fullmatch(normalized_callback) is None:
        raise HTTPException(status_code=400, detail="Invalid callback name")

    payload, _status_code = _build_health_payload(request)
    javascript = f"{normalized_callback}({json.dumps(payload)});"
    return Response(content=javascript, media_type="application/javascript")


@app.get("/discovery-bridge")
def discovery_bridge(request: Request, target_origin: str, request_id: str):
    normalized_request_id = request_id.strip()
    if DISCOVERY_BRIDGE_REQUEST_ID_PATTERN.fullmatch(normalized_request_id) is None:
        raise HTTPException(status_code=400, detail="Invalid request id")

    normalized_target_origin = _normalize_target_origin(target_origin)
    payload, _status_code = _build_health_payload(request)
    message_payload = {
        "type": "econnect.discovery.bridge",
        "requestId": normalized_request_id,
        "host": request.url.hostname or "localhost",
        "payload": payload,
    }
    encoded_bridge_payload = base64.urlsafe_b64encode(json.dumps(message_payload).encode("utf-8")).decode("ascii")
    bridge_complete_url = f"{normalized_target_origin}/bridge-complete?bridge={encoded_bridge_payload}"
    html = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>E-Connect Discovery Bridge</title>
  </head>
  <body>
    <script>
      const messagePayload = {json.dumps(message_payload)};
      const targetOrigin = {json.dumps(normalized_target_origin)};
      const bridgeCompleteUrl = {json.dumps(bridge_complete_url)};

      function notifyOpener() {{
        try {{
          if (window.opener && !window.opener.closed) {{
            window.opener.postMessage(messagePayload, targetOrigin);
            return true;
          }}
        }} catch (_error) {{
          // Ignore cross-origin opener access failures and let the timeout close the bridge window.
        }}

        return false;
      }}

      notifyOpener();
      window.setTimeout(() => {{
        notifyOpener();
        window.location.replace(bridgeCompleteUrl);
      }}, 100);
      window.setTimeout(() => window.location.replace(bridgeCompleteUrl), 350);
    </script>
  </body>
</html>
"""
    return HTMLResponse(
        content=html,
        headers={
            "Cache-Control": "no-store",
        },
    )
