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
from contextlib import asynccontextmanager, suppress
import json
import logging
from pathlib import Path
import re
from urllib.parse import urlparse
from app.api import DEVICE_HEARTBEAT_TIMEOUT_SECONDS, expire_stale_online_devices_once, router as device_router
from sqlalchemy.exc import OperationalError

from app.database import SessionLocal, check_database_connection, get_db, initialize_database
from app.mqtt import mqtt_manager
from app.services.builder import (
    audit_runtime_firmware_target_mismatches,
    extract_runtime_firmware_network_targets,
    resolve_runtime_firmware_network_state,
    resolve_webapp_transport,
)
from app.services.mdns import MdnsPublisher, resolve_mdns_registration_config
from app.services.user_management import ensure_temp_support_account

logger = logging.getLogger(__name__)
STATIC_DIR = Path(__file__).resolve().parent / "static"
STALE_DEVICE_SWEEP_INTERVAL_SECONDS = max(1, min(DEVICE_HEARTBEAT_TIMEOUT_SECONDS, 2))
JSONP_CALLBACK_PATTERN = re.compile(r"^[A-Za-z_$][0-9A-Za-z_$.]*$")
DISCOVERY_BRIDGE_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")

def _using_overridden_database(app: FastAPI) -> bool:
    return get_db in app.dependency_overrides


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


def _build_health_payload(request: Request) -> tuple[dict[str, object], int]:
    firmware_network_state = _serialize_firmware_network_state(request.app)
    if _using_overridden_database(request.app):
        payload: dict[str, object] = {"status": "ok", "database": "overridden", "mqtt": "skipped"}
        if firmware_network_state is not None:
            payload["firmware_network"] = firmware_network_state
        return payload, 200

    database_ready, database_error = check_database_connection()
    request.app.state.database_ready = database_ready
    request.app.state.database_error = database_error

    if database_ready:
        payload = {
            "status": "ok",
            "database": "ok",
            "mqtt": "connected" if mqtt_manager.connected else "disconnected",
        }
        if firmware_network_state is not None:
            payload["firmware_network"] = firmware_network_state
        return payload, 200

    payload = {
        "status": "degraded",
        "database": "unavailable",
        "mqtt": "connected" if mqtt_manager.connected else "disconnected",
        "error": database_error,
    }
    if firmware_network_state is not None:
        payload["firmware_network"] = firmware_network_state

    return payload, 503


def _resolve_root_redirect_transport(app: FastAPI) -> tuple[str, int]:
    runtime_state = _serialize_firmware_network_state(app)
    protocol = "http"
    port = 3000

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

    async def stale_device_watchdog() -> None:
        while True:
            await asyncio.sleep(STALE_DEVICE_SWEEP_INTERVAL_SECONDS)
            try:
                expire_stale_online_devices_once()
            except Exception:
                logger.exception("Stale-device watchdog sweep failed")

    app.state.database_ready = False
    app.state.database_error = None
    app.state.mdns_publisher = None
    app.state.mqtt_started = False
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
        db = SessionLocal()
        try:
            ensure_temp_support_account(db)
            app.state.firmware_network_audit = audit_runtime_firmware_target_mismatches(
                db,
                app.state.firmware_network_state,
            )
        finally:
            db.close()
        audit_warning = getattr(app.state, "firmware_network_audit", {}).get("warning")
        if isinstance(audit_warning, str) and audit_warning.strip():
            logger.warning(audit_warning)

    mqtt_manager.start()
    app.state.mqtt_started = True
    stale_device_watchdog_task = asyncio.create_task(stale_device_watchdog())
    app.state.stale_device_watchdog_started = True

    try:
        yield
    finally:
        if stale_device_watchdog_task is not None:
            stale_device_watchdog_task.cancel()
            with suppress(asyncio.CancelledError):
                await stale_device_watchdog_task
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
        window.close();
      }}, 100);
      window.setTimeout(() => window.close(), 350);
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
