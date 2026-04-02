import ipaddress
import json
import os
import shutil
import subprocess
import socket
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Mapping
from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.services.diy_validation import resolve_board_definition
from app.services.provisioning import build_project_firmware_identity, extract_project_secret_from_payload
from app.sql_models import AuthStatus, BuildJob, Device, DiyProject, JobStatus, SerialSession, SerialSessionStatus
from app.services.i2c_registry import find_library_by_name

BUILD_BASE_DIR = os.getenv("BUILD_BASE_DIR", "/tmp/econnect_builds")
JOBS_DIR = os.path.join(BUILD_BASE_DIR, "jobs")
ARTIFACTS_DIR = os.path.join(BUILD_BASE_DIR, "artifacts")
LOGS_DIR = os.path.join(BUILD_BASE_DIR, "logs")
PLATFORMIO_CORE_DIR = os.getenv("PLATFORMIO_CORE_DIR", os.path.join(BUILD_BASE_DIR, ".platformio"))
FIRMWARE_TEMPLATE_DIR = Path(__file__).resolve().parents[2] / "firmware_template"
ARTIFACT_FILENAMES = {
    "firmware": "{job_id}.bin",
    "bootloader": "{job_id}.bootloader.bin",
    "partitions": "{job_id}.partitions.bin",
}

for path in (BUILD_BASE_DIR, JOBS_DIR, ARTIFACTS_DIR, LOGS_DIR, PLATFORMIO_CORE_DIR):
    os.makedirs(path, exist_ok=True)


def build_job_firmware_version(job_id: str) -> str:
    return f"build-{job_id[:8]}"


_BLOCKED_ADVERTISED_HOSTNAMES = {
    "localhost",
    "server",
    "mqtt",
    "db",
    "webapp",
}
_FIRMWARE_PUBLIC_BASE_URL_ENV = "FIRMWARE_PUBLIC_BASE_URL"
_FIRMWARE_PUBLIC_PORT_ENV = "FIRMWARE_PUBLIC_PORT"
_FIRMWARE_PUBLIC_SCHEME_ENV = "FIRMWARE_PUBLIC_SCHEME"
_FIRMWARE_MQTT_BROKER_ENV = "FIRMWARE_MQTT_BROKER"
_FIRMWARE_MQTT_PORT_ENV = "FIRMWARE_MQTT_PORT"
_DEFAULT_WEBAPP_PROTOCOL = "http"
_DEFAULT_WEBAPP_PORT = 3000
_HTTPS_COMPANION_PORT = 3443
_DEFAULT_FIRMWARE_PUBLIC_PORT = "3000"
_DEFAULT_FIRMWARE_PUBLIC_SCHEME = "http"
_DEFAULT_MQTT_PORT = "1883"
_COMMON_DOCKER_BRIDGE_SUBNETS = tuple(
    ipaddress.ip_network(cidr)
    for cidr in (
        "172.17.0.0/16",
        "172.18.0.0/16",
        "172.19.0.0/16",
        "172.20.0.0/16",
        "172.21.0.0/16",
        "172.22.0.0/16",
        "172.23.0.0/16",
        "172.24.0.0/16",
        "172.25.0.0/16",
        "172.26.0.0/16",
        "172.27.0.0/16",
        "172.28.0.0/16",
        "172.29.0.0/16",
        "172.30.0.0/16",
        "172.31.0.0/16",
        "192.168.65.0/24",
    )
)


def _first_header_value(value: str | None) -> str | None:
    if not value:
        return None
    first = value.split(",", 1)[0].strip()
    return first or None


def _parse_forwarded_header(value: str | None) -> tuple[str | None, str | None]:
    first = _first_header_value(value)
    if not first:
        return None, None

    host = None
    proto = None
    for part in first.split(";"):
        key, separator, raw_value = part.partition("=")
        if not separator:
            continue
        normalized_key = key.strip().lower()
        normalized_value = raw_value.strip().strip('"')
        if normalized_key == "host" and normalized_value:
            host = normalized_value
        elif normalized_key == "proto" and normalized_value:
            proto = normalized_value.lower()

    return host, proto


def _parse_host_candidate(raw_value: str, *, default_scheme: str) -> tuple[str, str, str]:
    candidate = raw_value.strip()
    parsed = urlsplit(candidate if "://" in candidate else f"//{candidate}", scheme=default_scheme)
    netloc = parsed.netloc or parsed.path
    hostname = parsed.hostname
    scheme = parsed.scheme or default_scheme

    if not netloc or not hostname:
        raise ValueError(f"Could not parse host value '{raw_value}'.")

    return netloc, hostname.strip().lower(), scheme


def _validate_advertised_hostname(hostname: str) -> None:
    normalized = hostname.strip().lower().rstrip(".")
    if normalized in _BLOCKED_ADVERTISED_HOSTNAMES:
        raise ValueError(f"Host '{hostname}' is a Docker-local service name and is not reachable from the board.")

    try:
        ip = ipaddress.ip_address(normalized)
    except ValueError:
        return

    if ip.is_loopback:
        raise ValueError(f"Host '{hostname}' is loopback and is not reachable from the board.")
    if ip.is_unspecified:
        raise ValueError(f"Host '{hostname}' is unspecified and is not reachable from the board.")
    if ip.is_link_local:
        raise ValueError(f"Host '{hostname}' is link-local and is not stable for firmware provisioning.")
    if ip.is_multicast:
        raise ValueError(f"Host '{hostname}' is multicast and cannot be used as the server address.")


def _resolve_configured_public_network_targets() -> dict[str, str] | None:
    configured_base_url = os.getenv(_FIRMWARE_PUBLIC_BASE_URL_ENV)
    if not configured_base_url or not configured_base_url.strip():
        return None

    raw_value = configured_base_url.strip()
    netloc, hostname, scheme = _parse_host_candidate(raw_value, default_scheme="https")
    _validate_advertised_hostname(hostname)
    return build_firmware_network_targets(
        hostname,
        f"{scheme}://{netloc.rstrip('/')}/api/v1",
        mqtt_broker=_resolve_runtime_mqtt_broker(hostname),
        mqtt_port=_resolve_runtime_mqtt_port(),
    )


def _normalize_firmware_public_scheme() -> str:
    candidate = os.getenv(_FIRMWARE_PUBLIC_SCHEME_ENV, _DEFAULT_FIRMWARE_PUBLIC_SCHEME).strip().lower()
    if candidate not in {"http", "https"}:
        raise ValueError(
            f"{_FIRMWARE_PUBLIC_SCHEME_ENV} must be http or https when {_FIRMWARE_PUBLIC_BASE_URL_ENV} is unset."
        )
    return candidate


def _resolve_firmware_public_port() -> int:
    raw_value = os.getenv(_FIRMWARE_PUBLIC_PORT_ENV, _DEFAULT_FIRMWARE_PUBLIC_PORT).strip()
    try:
        port = int(raw_value)
    except ValueError as exc:
        raise ValueError(f"{_FIRMWARE_PUBLIC_PORT_ENV} must be a valid TCP port number.") from exc

    if port <= 0 or port > 65535:
        raise ValueError(f"{_FIRMWARE_PUBLIC_PORT_ENV} must be between 1 and 65535.")

    return port


def _normalize_tcp_port(raw_value: object, *, env_name: str) -> int:
    candidate = str(raw_value).strip()
    try:
        port = int(candidate)
    except ValueError as exc:
        raise ValueError(f"{env_name} must be a valid TCP port number.") from exc

    if port <= 0 or port > 65535:
        raise ValueError(f"{env_name} must be between 1 and 65535.")

    return port


def _resolve_runtime_mqtt_port() -> int:
    raw_value = os.getenv(_FIRMWARE_MQTT_PORT_ENV, os.getenv("MQTT_PORT", _DEFAULT_MQTT_PORT))
    return _normalize_tcp_port(raw_value, env_name=_FIRMWARE_MQTT_PORT_ENV)


def _format_runtime_netloc(hostname: str, port: int) -> str:
    if ":" in hostname and not hostname.startswith("["):
        return f"[{hostname}]:{port}"
    return f"{hostname}:{port}"


def _format_runtime_host(hostname: str) -> str:
    if ":" in hostname and not hostname.startswith("["):
        return f"[{hostname}]"
    return hostname


def _format_api_base_url(hostname: str, scheme: str, port: int | None) -> str:
    if port is None:
        netloc = _format_runtime_host(hostname)
    else:
        netloc = _format_runtime_netloc(hostname, port)
    return f"{scheme}://{netloc}/api/v1"


def _resolve_runtime_mqtt_broker(advertised_host: str) -> str:
    candidate = os.getenv(_FIRMWARE_MQTT_BROKER_ENV)
    if candidate and candidate.strip():
        try:
            _, hostname, _ = _parse_host_candidate(candidate.strip(), default_scheme="mqtt")
            _validate_advertised_hostname(hostname)
            return hostname
        except ValueError:
            pass

    return advertised_host


def _normalize_request_derived_transport(hostname: str, scheme: str, port: int | None) -> tuple[str, int | None]:
    normalized_scheme = scheme.strip().lower()
    normalized_port = port

    # Boards should use the standard LAN HTTP origin for OTA downloads even
    # when the browser is temporarily using the secure companion transport.
    if normalized_scheme == "https" and normalized_port in {_DEFAULT_WEBAPP_PORT, _HTTPS_COMPANION_PORT}:
        return _DEFAULT_WEBAPP_PROTOCOL, _DEFAULT_WEBAPP_PORT

    return normalized_scheme, normalized_port


def _build_request_derived_firmware_targets(raw_value: str, *, default_scheme: str) -> dict[str, object]:
    candidate = raw_value.strip()
    parsed = urlsplit(candidate if "://" in candidate else f"//{candidate}", scheme=default_scheme)
    netloc = parsed.netloc or parsed.path
    hostname = parsed.hostname
    scheme = parsed.scheme or default_scheme

    if not netloc or not hostname:
        raise ValueError(f"Could not parse host value '{raw_value}'.")

    normalized_host = hostname.strip().lower()
    _validate_advertised_hostname(normalized_host)

    try:
        parsed_port = parsed.port
    except ValueError as exc:
        raise ValueError(f"Could not parse host value '{raw_value}'.") from exc

    normalized_scheme, normalized_port = _normalize_request_derived_transport(
        normalized_host,
        scheme,
        parsed_port,
    )

    return build_firmware_network_targets(
        normalized_host,
        _format_api_base_url(normalized_host, normalized_scheme, normalized_port),
        mqtt_broker=_resolve_runtime_mqtt_broker(normalized_host),
        mqtt_port=_resolve_runtime_mqtt_port(),
    )


def build_firmware_target_key(targets: Mapping[str, object]) -> str:
    return "|".join(
        [
            str(targets.get("advertised_host", "")).strip(),
            str(targets.get("api_base_url", "")).strip(),
            str(targets.get("mqtt_broker", "")).strip(),
            str(targets.get("mqtt_port", "")).strip(),
        ]
    )


def build_firmware_network_targets(
    advertised_host: str,
    api_base_url: str,
    *,
    mqtt_broker: str | None = None,
    mqtt_port: int | None = None,
) -> dict[str, object]:
    normalized_host = advertised_host.strip().lower()
    _validate_advertised_hostname(normalized_host)

    normalized_api_base_url = api_base_url.strip().rstrip("/")
    _, parsed_api_host, _ = _parse_host_candidate(normalized_api_base_url, default_scheme="http")
    _validate_advertised_hostname(parsed_api_host)

    normalized_mqtt_broker = (mqtt_broker or "").strip().lower() or normalized_host
    _validate_advertised_hostname(normalized_mqtt_broker)

    normalized_mqtt_port = mqtt_port if mqtt_port is not None else _resolve_runtime_mqtt_port()
    normalized_mqtt_port = _normalize_tcp_port(normalized_mqtt_port, env_name=_FIRMWARE_MQTT_PORT_ENV)

    targets: dict[str, object] = {
        "advertised_host": normalized_host,
        "api_base_url": normalized_api_base_url,
        "mqtt_broker": normalized_mqtt_broker,
        "mqtt_port": normalized_mqtt_port,
    }
    targets["target_key"] = build_firmware_target_key(targets)
    return targets


def resolve_webapp_transport(api_base_url: str | None) -> dict[str, object]:
    protocol = _DEFAULT_WEBAPP_PROTOCOL
    port = _DEFAULT_WEBAPP_PORT

    if not isinstance(api_base_url, str) or not api_base_url.strip():
        return {
            "webapp_protocol": protocol,
            "webapp_port": port,
        }

    candidate = api_base_url.strip()
    parsed = urlsplit(candidate if "://" in candidate else f"//{candidate}", scheme=protocol)

    if parsed.scheme in {"http", "https"}:
        protocol = parsed.scheme

    try:
        parsed_port = parsed.port
    except ValueError:
        parsed_port = None

    if parsed_port is not None:
        port = parsed_port

    return {
        "webapp_protocol": protocol,
        "webapp_port": port,
    }


def coerce_firmware_network_targets(raw_targets: Mapping[str, object] | None) -> dict[str, object] | None:
    if not isinstance(raw_targets, Mapping):
        return None

    api_base_url = raw_targets.get("api_base_url")
    if not isinstance(api_base_url, str) or not api_base_url.strip():
        return None

    normalized_api_base_url = api_base_url.strip().rstrip("/")
    _, parsed_api_host, _ = _parse_host_candidate(normalized_api_base_url, default_scheme="http")
    _validate_advertised_hostname(parsed_api_host)

    advertised_host = raw_targets.get("advertised_host")
    if isinstance(advertised_host, str) and advertised_host.strip():
        normalized_host = advertised_host.strip().lower()
        _validate_advertised_hostname(normalized_host)
    else:
        normalized_host = parsed_api_host

    mqtt_broker = raw_targets.get("mqtt_broker")
    normalized_mqtt_broker = normalized_host
    if isinstance(mqtt_broker, str) and mqtt_broker.strip():
        normalized_mqtt_broker = mqtt_broker.strip().lower()
        _validate_advertised_hostname(normalized_mqtt_broker)

    raw_mqtt_port = raw_targets.get("mqtt_port", _resolve_runtime_mqtt_port())
    normalized_mqtt_port = _normalize_tcp_port(raw_mqtt_port, env_name=_FIRMWARE_MQTT_PORT_ENV)

    return build_firmware_network_targets(
        normalized_host,
        normalized_api_base_url,
        mqtt_broker=normalized_mqtt_broker,
        mqtt_port=normalized_mqtt_port,
    )


def extract_runtime_firmware_network_targets(
    runtime_state: Mapping[str, object] | None,
) -> dict[str, object] | None:
    if not isinstance(runtime_state, Mapping):
        return None

    raw_targets = runtime_state.get("targets")
    if not isinstance(raw_targets, Mapping):
        return None

    return coerce_firmware_network_targets(raw_targets)


def _format_firmware_target_summary(targets: Mapping[str, object]) -> str:
    advertised_host = str(targets.get("advertised_host", "")).strip()
    mqtt_broker = str(targets.get("mqtt_broker", "")).strip()
    mqtt_port = str(targets.get("mqtt_port", "")).strip()
    return f"server {advertised_host} / MQTT {mqtt_broker}:{mqtt_port}"


def _collect_runtime_ip_candidates() -> list[str]:
    candidates: list[str] = []

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            candidate = sock.getsockname()[0]
            if candidate:
                candidates.append(candidate)
    except OSError:
        pass

    try:
        hostname = socket.gethostname().strip()
        infos = socket.getaddrinfo(hostname or None, None, type=socket.SOCK_STREAM)
    except OSError:
        infos = []

    for family, _, _, _, sockaddr in infos:
        if family not in {socket.AF_INET, socket.AF_INET6}:
            continue
        candidate = sockaddr[0]
        if candidate:
            candidates.append(candidate)

    unique_candidates: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        normalized = candidate.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        unique_candidates.append(normalized)

    return unique_candidates


def _detect_runtime_advertised_host() -> str | None:
    for candidate in _collect_runtime_ip_candidates():
        try:
            _validate_advertised_hostname(candidate)
        except ValueError:
            continue
        return candidate

    return None


def _is_running_in_docker() -> bool:
    if Path("/.dockerenv").exists():
        return True

    try:
        cgroup = Path("/proc/1/cgroup").read_text(encoding="utf-8")
    except OSError:
        return False

    return "docker" in cgroup or "containerd" in cgroup


def _looks_like_docker_bridge_ip(hostname: str) -> bool:
    try:
        parsed = ipaddress.ip_address(hostname)
    except ValueError:
        return False

    if not isinstance(parsed, ipaddress.IPv4Address):
        return False

    return any(parsed in subnet for subnet in _COMMON_DOCKER_BRIDGE_SUBNETS)


def resolve_runtime_firmware_network_state() -> dict[str, object]:
    configured_targets = _resolve_configured_public_network_targets()
    if configured_targets is not None:
        return {
            "source": "configured_env",
            "targets": configured_targets,
            "error": None,
        }

    detected_host = _detect_runtime_advertised_host()
    if not detected_host:
        return {
            "source": "startup_auto",
            "targets": None,
            "error": (
                "Server startup could not auto-detect a reachable LAN host for firmware provisioning. "
                f"Open the Web UI from the server LAN/public origin or set {_FIRMWARE_PUBLIC_BASE_URL_ENV} explicitly."
            ),
        }

    if _is_running_in_docker() and _looks_like_docker_bridge_ip(detected_host):
        return {
            "source": "startup_auto",
            "targets": None,
            "error": (
                f"Server startup detected container address {detected_host}, not the host LAN IP. "
                "If you run Docker and want automatic firmware IP handling on startup, configure the relevant containers "
                "with `network_mode: host` so the server sees the real host interfaces, or set "
                f"{_FIRMWARE_PUBLIC_BASE_URL_ENV} explicitly."
            ),
        }

    try:
        scheme = _normalize_firmware_public_scheme()
        port = _resolve_firmware_public_port()
    except ValueError as exc:
        return {
            "source": "startup_auto",
            "targets": None,
            "error": str(exc),
        }

    netloc = _format_runtime_netloc(detected_host, port)
    return {
        "source": "startup_auto",
        "targets": build_firmware_network_targets(
            detected_host,
            f"{scheme}://{netloc}/api/v1",
            mqtt_broker=_resolve_runtime_mqtt_broker(detected_host),
            mqtt_port=_resolve_runtime_mqtt_port(),
        ),
        "error": None,
    }


def _extract_runtime_network_error(runtime_state: Mapping[str, object] | None) -> str | None:
    if not isinstance(runtime_state, Mapping):
        return None

    raw_error = runtime_state.get("error")
    if isinstance(raw_error, str) and raw_error.strip():
        return raw_error.strip()

    return None


def _extract_previous_advertised_host(config: Mapping[str, object] | None) -> str | None:
    if not isinstance(config, Mapping):
        return None

    candidate = config.get("advertised_host")
    if isinstance(candidate, str) and candidate.strip():
        return candidate.strip()

    api_base_url = config.get("api_base_url")
    if isinstance(api_base_url, str) and api_base_url.strip():
        try:
            _, hostname, _ = _parse_host_candidate(api_base_url.strip(), default_scheme="http")
        except ValueError:
            return None
        return hostname

    return None


def _coerce_legacy_firmware_network_targets(
    raw_targets: Mapping[str, object] | None,
    reference_targets: Mapping[str, object] | None,
) -> dict[str, object] | None:
    if not isinstance(raw_targets, Mapping):
        return None

    legacy_host = _extract_previous_advertised_host(raw_targets)
    normalized_reference_targets = coerce_firmware_network_targets(reference_targets)
    if legacy_host is None or normalized_reference_targets is None:
        return None

    reference_api_base_url = str(normalized_reference_targets["api_base_url"]).strip()
    parsed_reference = urlsplit(reference_api_base_url)
    api_scheme = parsed_reference.scheme or "http"
    api_path = parsed_reference.path.rstrip("/") or "/api/v1"
    if parsed_reference.port is not None:
        api_netloc = _format_runtime_netloc(legacy_host, parsed_reference.port)
    else:
        api_netloc = _format_runtime_host(legacy_host)
    api_base_url = f"{api_scheme}://{api_netloc}{api_path}"

    mqtt_broker = legacy_host
    raw_mqtt_broker = raw_targets.get("mqtt_broker")
    if isinstance(raw_mqtt_broker, str) and raw_mqtt_broker.strip():
        mqtt_broker = raw_mqtt_broker.strip()

    raw_mqtt_port = raw_targets.get("mqtt_port", normalized_reference_targets["mqtt_port"])
    mqtt_port = _normalize_tcp_port(raw_mqtt_port, env_name=_FIRMWARE_MQTT_PORT_ENV)

    return build_firmware_network_targets(
        legacy_host,
        api_base_url,
        mqtt_broker=mqtt_broker,
        mqtt_port=mqtt_port,
    )


def describe_network_target_change(
    config: Mapping[str, object] | None,
    next_targets: Mapping[str, object],
) -> str | None:
    previous_targets = coerce_firmware_network_targets(config)
    normalized_next_targets = coerce_firmware_network_targets(next_targets)
    if previous_targets is None:
        previous_targets = _coerce_legacy_firmware_network_targets(config, normalized_next_targets)
    if previous_targets is None or normalized_next_targets is None:
        return None

    if previous_targets["target_key"] == normalized_next_targets["target_key"]:
        return None

    return (
        "Firmware network target changed from "
        f"{_format_firmware_target_summary(previous_targets)} to "
        f"{_format_firmware_target_summary(normalized_next_targets)}. "
        "Boards flashed with older artifacts keep using the old server/MQTT target and will not appear in Discovery "
        "until they are rebuilt and reflashed from this server."
    )


def infer_firmware_network_targets(
    headers: Mapping[str, str],
    request_scheme: str,
    runtime_state: Mapping[str, object] | None = None,
) -> dict[str, object]:
    configured_targets = _resolve_configured_public_network_targets()
    if configured_targets is not None:
        return configured_targets

    runtime_targets = extract_runtime_firmware_network_targets(runtime_state)
    if runtime_targets is not None:
        return runtime_targets

    forwarded_host, forwarded_proto = _parse_forwarded_header(headers.get("forwarded"))
    candidates = [
        (
            "X-EConnect-Origin",
            _first_header_value(headers.get("x-econnect-origin")),
            request_scheme,
        ),
        (
            "X-Forwarded-Host",
            _first_header_value(headers.get("x-forwarded-host")),
            _first_header_value(headers.get("x-forwarded-proto")) or request_scheme,
        ),
        (
            "Forwarded",
            forwarded_host,
            forwarded_proto or request_scheme,
        ),
        (
            "Origin",
            headers.get("origin"),
            request_scheme,
        ),
        (
            "Referer",
            headers.get("referer"),
            request_scheme,
        ),
        (
            "Host",
            headers.get("host"),
            request_scheme,
        ),
    ]

    errors: list[str] = []
    for source, raw_value, default_scheme in candidates:
        if not raw_value:
            continue

        try:
            return _build_request_derived_firmware_targets(raw_value, default_scheme=default_scheme)
        except ValueError as exc:
            errors.append(f"{source}: {exc}")

    detail = (
        "Server could not infer a reachable host for firmware provisioning from the current request. "
        "Open the Web UI using the server LAN IP or a trusted reverse-proxy hostname, not localhost, "
        "127.0.0.1, or Docker-only names. If operators must access the Web UI through localhost, "
        f"set {_FIRMWARE_PUBLIC_BASE_URL_ENV} to the server LAN/public origin so firmware builds keep a reachable host."
    )
    runtime_error = _extract_runtime_network_error(runtime_state)
    if runtime_error:
        detail = f"{runtime_error} {detail}"
    if errors:
        detail = f"{detail} Checked headers: {' | '.join(errors)}"
    raise ValueError(detail)


def extract_reported_firmware_network_targets(
    payload: Mapping[str, object] | None,
) -> dict[str, object] | None:
    if not isinstance(payload, Mapping):
        return None

    raw_network = payload.get("firmware_network")
    if not isinstance(raw_network, Mapping):
        return None

    return coerce_firmware_network_targets(raw_network)


def describe_runtime_firmware_mismatch(
    payload: Mapping[str, object] | None,
    current_targets: Mapping[str, object] | None,
) -> str | None:
    reported_targets = extract_reported_firmware_network_targets(payload)
    normalized_current_targets = coerce_firmware_network_targets(current_targets)
    if reported_targets is None or normalized_current_targets is None:
        return None

    if reported_targets["target_key"] == normalized_current_targets["target_key"]:
        return None

    return (
        "Firmware network target mismatch. Board still reports "
        f"{_format_firmware_target_summary(reported_targets)}, but the running backend now advertises "
        f"{_format_firmware_target_summary(normalized_current_targets)}. Manual reflash is required."
    )


def audit_runtime_firmware_target_mismatches(
    db: Session,
    runtime_state: Mapping[str, object] | None,
) -> dict[str, object]:
    current_targets = extract_runtime_firmware_network_targets(runtime_state)
    audit: dict[str, object] = {
        "current_targets": current_targets,
        "stale_projects": [],
        "stale_project_count": 0,
        "stale_device_count": 0,
        "warning": None,
    }
    if current_targets is None:
        return audit

    stale_projects: list[dict[str, object]] = []
    stale_device_count = 0

    for project in db.query(DiyProject).order_by(DiyProject.name.asc(), DiyProject.id.asc()).all():
        project_config = project.config if isinstance(project.config, Mapping) else None
        previous_targets = coerce_firmware_network_targets(project_config)
        if previous_targets is None:
            previous_targets = _coerce_legacy_firmware_network_targets(project_config, current_targets)
        if previous_targets is None:
            continue
        if previous_targets["target_key"] == current_targets["target_key"]:
            continue

        linked_devices = (
            db.query(Device)
            .filter(Device.provisioning_project_id == project.id)
            .order_by(Device.name.asc(), Device.device_id.asc())
            .all()
        )
        device_ids = [device.device_id for device in linked_devices]
        approved_device_ids = [
            device.device_id
            for device in linked_devices
            if device.auth_status == AuthStatus.approved
        ]
        stale_device_count += len(device_ids)
        stale_projects.append(
            {
                "project_id": project.id,
                "project_name": project.name,
                "previous_targets": previous_targets,
                "current_targets": current_targets,
                "device_ids": device_ids,
                "approved_device_ids": approved_device_ids,
                "device_count": len(device_ids),
            }
        )

    audit["stale_projects"] = stale_projects
    audit["stale_project_count"] = len(stale_projects)
    audit["stale_device_count"] = stale_device_count
    if stale_projects:
        audit["warning"] = (
            f"Server startup found {len(stale_projects)} DIY project(s) and {stale_device_count} linked board(s) "
            "with stale server/MQTT firmware targets. Manual reflash is required before those boards can pair "
            "against the current runtime target."
        )
    return audit


def release_project_serial_reservation(project, db: Session) -> str | None:
    config_json = project.config if isinstance(project.config, dict) else {}
    configured_port = config_json.get("serial_port")
    if not isinstance(configured_port, str) or not configured_port.strip():
        return None

    active_lock = (
        db.query(SerialSession)
        .filter(
            SerialSession.port == configured_port.strip(),
            SerialSession.locked_by_user_id == project.user_id,
            SerialSession.status == SerialSessionStatus.locked,
        )
        .order_by(SerialSession.created_at.desc())
        .first()
    )
    if not active_lock:
        return None

    active_lock.status = SerialSessionStatus.released
    active_lock.released_at = datetime.utcnow()
    return configured_port.strip()


def generate_platformio_ini(project, project_dir: str):
    board_definition = resolve_board_definition(project.board_profile)
    config_json = project.config if isinstance(project.config, dict) else {}
    
    cpu_mhz = config_json.get("cpu_mhz")
    flash_size = config_json.get("flash_size")
    psram_size = config_json.get("psram_size")

    build_flags: list[str] = []
    if board_definition.canonical_id in {"esp32-c2", "esp32-c3", "esp32-s2", "esp32-s3"}:
        build_flags.extend([
            "-D ARDUINO_USB_MODE=1",
            "-D ARDUINO_USB_CDC_ON_BOOT=1",
        ])

    board_config_lines = []
    if isinstance(cpu_mhz, int) and cpu_mhz > 0:
        board_config_lines.append(f"board_build.f_cpu = {cpu_mhz}000000L")
        
    if isinstance(flash_size, str) and flash_size.upper().endswith("MB"):
        board_config_lines.append(f"board_upload.flash_size = {flash_size.upper()}")
        
    if isinstance(psram_size, str):
        if psram_size.upper() != "NONE" and psram_size.upper() != "":
            build_flags.append("-D BOARD_HAS_PSRAM")
            if board_definition.canonical_id == "esp32":
                build_flags.append("-mfix-esp32-psram-cache-issue")

    lib_deps = [
        "knolleary/PubSubClient@^2.8",
        "bblanchon/ArduinoJson@^6.21.3",
    ]

    # Add dynamic I2C library dependencies
    raw_pins = config_json.get("pins", [])
    seen_libs = set()
    for pin in raw_pins if isinstance(raw_pins, list) else []:
        if str(pin.get("mode")).upper() == "I2C":
            extra = pin.get("extra_params")
            if isinstance(extra, dict):
                lib_name = extra.get("i2c_library")
                if lib_name and lib_name not in seen_libs:
                    lib_info = find_library_by_name(lib_name)
                    if lib_info:
                        lib_deps.extend(lib_info.pio_lib_deps)
                        seen_libs.add(lib_name)

    build_flags_block = "\n".join(f"    {flag}" for flag in build_flags) if build_flags else ""
    board_configs_block = "\n".join(board_config_lines) + "\n" if board_config_lines else ""
    lib_deps_block = "\n".join(f"    {lib}" for lib in lib_deps)
    
    ini_content = f"""[env:{board_definition.platformio_board}]
platform = {board_definition.platform}
board = {board_definition.platformio_board}
framework = arduino
monitor_speed = 115200
{board_configs_block}build_flags =
{build_flags_block}
lib_deps =
{lib_deps_block}
"""
    with open(os.path.join(project_dir, "platformio.ini"), "w") as file:
        file.write(ini_content)


def copy_firmware_template(project_dir: str):
    if not FIRMWARE_TEMPLATE_DIR.exists():
        raise FileNotFoundError(f"Firmware template directory is missing: {FIRMWARE_TEMPLATE_DIR}")

    shutil.copytree(
        FIRMWARE_TEMPLATE_DIR,
        project_dir,
        dirs_exist_ok=True,
        ignore=shutil.ignore_patterns(".pio", ".vscode", "__pycache__", "*.pyc"),
    )


def get_durable_artifact_path(job_id: str, artifact_name: str) -> str:
    filename_template = ARTIFACT_FILENAMES.get(artifact_name)
    if not filename_template:
        raise ValueError(f"Unsupported artifact name: {artifact_name}")
    return os.path.join(ARTIFACTS_DIR, filename_template.format(job_id=job_id))


def _escape_c_string(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _resolve_api_base_url(config_json: dict) -> str | None:
    candidate = config_json.get("api_base_url") if isinstance(config_json, dict) else None
    if isinstance(candidate, str) and candidate.strip():
        normalized = candidate.strip().rstrip("/")
        _, hostname, _ = _parse_host_candidate(normalized, default_scheme="http")
        _validate_advertised_hostname(hostname)
        return normalized

    return None


def _resolve_mqtt_broker(config_json: dict) -> str:
    if isinstance(config_json, dict):
        candidate = config_json.get("mqtt_broker")
        if isinstance(candidate, str) and candidate.strip():
            normalized = candidate.strip().lower()
            _validate_advertised_hostname(normalized)
            return normalized

        advertised_host = config_json.get("advertised_host")
        if isinstance(advertised_host, str) and advertised_host.strip():
            normalized = advertised_host.strip().lower()
            _validate_advertised_hostname(normalized)
            return normalized

        api_base_url = config_json.get("api_base_url")
        if isinstance(api_base_url, str) and api_base_url.strip():
            _, hostname, _ = _parse_host_candidate(api_base_url.strip(), default_scheme="http")
            _validate_advertised_hostname(hostname)
            return hostname

    raise ValueError(
        "Missing reachable server host in project config. Re-open the DIY builder from the server LAN address and start the build again."
    )


def _resolve_mqtt_port(config_json: dict) -> int:
    if isinstance(config_json, dict):
        candidate = config_json.get("mqtt_port")
        if candidate is not None:
            return _normalize_tcp_port(candidate, env_name=_FIRMWARE_MQTT_PORT_ENV)

    return _resolve_runtime_mqtt_port()


def _resolve_project_wifi_credentials(
    project,
    *,
    config_json: Mapping[str, Any] | None = None,
) -> tuple[str, str]:
    payload = config_json if isinstance(config_json, Mapping) else None
    if payload is None:
        payload = project.config if isinstance(project.config, dict) else {}

    wifi_ssid = str(payload.get("wifi_ssid") or "").strip()
    wifi_password = str(payload.get("wifi_password") or "")
    if wifi_ssid and wifi_password:
        return wifi_ssid, wifi_password

    credential = getattr(project, "wifi_credential", None)
    if credential is not None:
        wifi_ssid = str(getattr(credential, "ssid", "") or "").strip()
        wifi_password = str(getattr(credential, "password", "") or "")
        if wifi_ssid and wifi_password:
            return wifi_ssid, wifi_password

    config_json = project.config if isinstance(project.config, dict) else {}
    wifi_ssid = str(config_json.get("wifi_ssid") or "").strip()
    wifi_password = str(config_json.get("wifi_password") or "")
    return wifi_ssid, wifi_password


def resolve_build_job_config_snapshot(job: BuildJob) -> dict[str, Any]:
    if isinstance(job.staged_project_config, dict):
        return dict(job.staged_project_config)
    if isinstance(job.staged_project_config, str):
        try:
            decoded_snapshot = json.loads(job.staged_project_config)
        except json.JSONDecodeError:
            decoded_snapshot = None
        if isinstance(decoded_snapshot, dict):
            return dict(decoded_snapshot)

    project = job.project
    if (
        project is not None
        and project.pending_build_job_id == job.id
        and isinstance(project.pending_config, dict)
    ):
        return dict(project.pending_config)

    if project is not None and isinstance(project.config, dict):
        return dict(project.config)

    return {}


def promote_build_job_project_config(job: BuildJob) -> bool:
    project = job.project
    if project is None or not isinstance(job.staged_project_config, dict):
        return False

    staged_config = dict(job.staged_project_config)
    project.config = staged_config

    staged_wifi_credential_id = staged_config.get("wifi_credential_id")
    if isinstance(staged_wifi_credential_id, int):
        project.wifi_credential_id = staged_wifi_credential_id

    if project.pending_build_job_id == job.id:
        project.pending_config = None
        project.pending_build_job_id = None

    return True


def write_generated_firmware_config(
    project,
    job_id: str,
    project_dir: str,
    *,
    config_override: Mapping[str, Any] | None = None,
):
    config_json = (
        dict(config_override)
        if isinstance(config_override, Mapping)
        else project.config if isinstance(project.config, dict) else {}
    )
    include_dir = os.path.join(project_dir, "include")
    os.makedirs(include_dir, exist_ok=True)

    persisted_secret = extract_project_secret_from_payload(config_json)
    if persisted_secret is None and isinstance(project.config, dict):
        persisted_secret = extract_project_secret_from_payload(project.config)
    device_id, secret_key = build_project_firmware_identity(project.id, persisted_secret)
    project_name = str(config_json.get("project_name") or project.name or "E-Connect Node").strip()
    firmware_version = build_job_firmware_version(job_id)
    wifi_ssid, wifi_password = _resolve_project_wifi_credentials(project, config_json=config_json)
    mqtt_broker = _resolve_mqtt_broker(config_json)
    mqtt_port = _resolve_mqtt_port(config_json)
    mqtt_namespace = str(os.getenv("FIRMWARE_MQTT_NAMESPACE", os.getenv("MQTT_NAMESPACE", "local")))
    api_base_url = _resolve_api_base_url(config_json)

    pin_rows: list[str] = []
    raw_pins = config_json.get("pins", [])
    for pin in raw_pins if isinstance(raw_pins, list) else []:
        gpio = pin.get("gpio", pin.get("gpio_pin"))
        mode = str(pin.get("mode") or "").upper()
        if not isinstance(gpio, int) or not mode:
            continue

        function_name = str(pin.get("function") or mode.lower())
        label = str(pin.get("label") or f"GPIO {gpio}")
        raw_extra_params = pin.get("extra_params")
        
        # Default values
        active_level = 1
        pwm_min = 0
        pwm_max = 255
        i2c_role = ""
        i2c_address = ""
        i2c_library = ""

        if isinstance(raw_extra_params, dict):
            # Output / PWM
            candidate_level = raw_extra_params.get("active_level")
            if candidate_level in (0, 1):
                active_level = int(candidate_level)
            
            p_min = raw_extra_params.get("min_value")
            if isinstance(p_min, int):
                pwm_min = p_min
            
            p_max = raw_extra_params.get("max_value")
            if isinstance(p_max, int):
                pwm_max = p_max
            
            # I2C
            i2c_role = str(raw_extra_params.get("i2c_role") or "")
            i2c_address = str(raw_extra_params.get("i2c_address") or "")
            i2c_library = str(raw_extra_params.get("i2c_library") or "")

        pin_rows.append(
            f'    {{ {gpio}, "{_escape_c_string(mode)}", "{_escape_c_string(function_name)}", "{_escape_c_string(label)}", {active_level}, {pwm_min}, {pwm_max}, "{_escape_c_string(i2c_role)}", "{_escape_c_string(i2c_address)}", "{_escape_c_string(i2c_library)}" }}'
        )

    api_base_url_block = ""
    if api_base_url:
        api_base_url_block = f'#define API_BASE_URL "{_escape_c_string(api_base_url)}"\n'

    pin_rows_block = ",\n".join(pin_rows)

    header_content = f"""#pragma once

struct EConnectPinConfig {{
  int gpio;
  const char *mode;
  const char *function_name;
  const char *label;
  int active_level;
  int pwm_min;
  int pwm_max;
  const char *i2c_role;
  const char *i2c_address;
  const char *i2c_library;
}};

#define ECONNECT_HAS_PIN_CONFIGS 1
#define ECONNECT_PROJECT_ID "{project.id}"
#define ECONNECT_DEVICE_ID "{device_id}"
#define ECONNECT_SECRET_KEY "{secret_key}"
#define ECONNECT_DEVICE_NAME "{_escape_c_string(project_name)}"
#define ECONNECT_FIRMWARE_VERSION "{firmware_version}"
#define ECONNECT_BOARD_PROFILE "{_escape_c_string(project.board_profile)}"
#define WIFI_SSID "{_escape_c_string(wifi_ssid)}"
#define WIFI_PASS "{_escape_c_string(wifi_password)}"
#define MQTT_BROKER "{_escape_c_string(mqtt_broker)}"
#define MQTT_PORT {mqtt_port}
#define MQTT_NAMESPACE "{_escape_c_string(mqtt_namespace)}"
{api_base_url_block}static const EConnectPinConfig ECONNECT_PIN_CONFIGS[] = {{
{pin_rows_block}
}};
"""

    with open(os.path.join(include_dir, "generated_firmware_config.h"), "w") as file:
        file.write(header_content)


def collect_build_outputs(project_dir: str, board_profile: str) -> dict[str, str]:
    board_definition = resolve_board_definition(board_profile)
    env_build_dir = Path(project_dir) / ".pio" / "build" / board_definition.platformio_board
    outputs: dict[str, str] = {}

    candidates = {
        "firmware": env_build_dir / "firmware.bin",
        "bootloader": env_build_dir / "bootloader.bin",
        "partitions": env_build_dir / "partitions.bin",
    }
    for artifact_name, candidate in candidates.items():
        if candidate.exists():
            outputs[artifact_name] = str(candidate)

    if "firmware" not in outputs:
        for root, _, files in os.walk(Path(project_dir) / ".pio" / "build"):
            if "firmware.bin" in files:
                outputs["firmware"] = os.path.join(root, "firmware.bin")
                break

    return outputs


def copy_durable_artifacts(job_id: str, outputs: dict[str, str]) -> dict[str, str]:
    copied_paths: dict[str, str] = {}
    for artifact_name, source_path in outputs.items():
        destination_path = get_durable_artifact_path(job_id, artifact_name)
        shutil.copy2(source_path, destination_path)
        copied_paths[artifact_name] = destination_path
    return copied_paths


import traceback
import logging

logger = logging.getLogger(__name__)

def build_firmware_task(
    job_id: str,
    warnings: list[str] | None = None,
    session_factory: Callable[[], Session] = SessionLocal,
):
    try:
        with open("/tmp/builder_debug.log", "a") as f:
            f.write(f"\\n--- Starting build_firmware_task for job_id={job_id} ---\\n")
        db: Session = session_factory()
        with open("/tmp/builder_debug.log", "a") as f:
            f.write(f"DB session created.\\n")
    except Exception as e:
        with open("/tmp/builder_debug.log", "a") as f:
            f.write(f"Initial setup failed: {e}\\n{traceback.format_exc()}\\n")
        return

    try:
        job = db.query(BuildJob).filter(BuildJob.id == job_id).first()
        if not job:
            with open("/tmp/builder_debug.log", "a") as f:
                f.write(f"Job not found.\\n")
            return

        with open("/tmp/builder_debug.log", "a") as f:
            f.write(f"Job found: {job.id}, updating status to building.\\n")
            
        job.status = JobStatus.building
        db.commit()

        project_dir = os.path.join(JOBS_DIR, job_id)
        os.makedirs(project_dir, exist_ok=True)

        log_path = os.path.join(LOGS_DIR, f"{job_id}.log")
        job.log_path = log_path
        job.artifact_path = None
        db.commit()

        with open("/tmp/builder_debug.log", "a") as f:
            f.write("Preparing firmware template workspace.\\n")

        project = job.project
        copy_firmware_template(project_dir)
        generate_platformio_ini(project, project_dir)
        build_config = resolve_build_job_config_snapshot(job)
        write_generated_firmware_config(
            project,
            job_id,
            project_dir,
            config_override=build_config,
        )

        with open(log_path, "w") as log_file:
            log_file.write(f"--- Build started for job {job_id} at {datetime.utcnow().isoformat()} ---\\n")
            for warning in warnings or []:
                log_file.write(f"{warning}\\n")
            log_file.flush()

            with open("/tmp/builder_debug.log", "a") as f:
                f.write(f"Starting PIO subprocess.\\n")

            import shutil
            import sys
            
            pio_cmd = ["pio"]
            if not shutil.which("pio"):
                candidate1 = os.path.join(os.path.dirname(sys.executable), "pio")
                candidate2 = os.path.join(os.path.dirname(sys.argv[0]), "pio")
                if os.path.exists(candidate1):
                    pio_cmd = [candidate1]
                elif os.path.exists(candidate2):
                    pio_cmd = [candidate2]
                else:
                    pio_cmd = [sys.executable, "-m", "platformio"]

            process = subprocess.Popen(
                pio_cmd + ["run"],
                cwd=project_dir,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                env={**os.environ, "PLATFORMIO_CORE_DIR": PLATFORMIO_CORE_DIR},
            )
            process.wait()

        with open("/tmp/builder_debug.log", "a") as f:
            f.write(f"PIO subprocess completed with code {process.returncode}.\\n")

        if process.returncode == 0:
            build_outputs = collect_build_outputs(project_dir, project.board_profile)

            if "firmware" in build_outputs:
                durable_artifacts = copy_durable_artifacts(job_id, build_outputs)
                job.status = JobStatus.artifact_ready
                job.artifact_path = durable_artifacts["firmware"]
                job.finished_at = datetime.utcnow()
                released_port = release_project_serial_reservation(project, db)
                if released_port:
                    with open(log_path, "a") as log_file:
                        log_file.write(
                            f"Released serial reservation for {released_port} so browser flashing can proceed.\\n"
                        )
                with open("/tmp/builder_debug.log", "a") as f:
                    artifact_names = ", ".join(sorted(durable_artifacts.keys()))
                    f.write(f"Artifacts successfully saved: {artifact_names}.\\n")
            else:
                job.status = JobStatus.build_failed
                job.finished_at = datetime.utcnow()
                job.error_message = "firmware.bin not found after successful compilation."
                with open(log_path, "a") as log_file:
                    log_file.write("\\nError: firmware.bin not found after successful compilation.\\n")
                with open("/tmp/builder_debug.log", "a") as f:
                    f.write(f"Artifact missing.\\n")
        else:
            # Extract last meaningful error line from the log for the error_message field
            last_error_line = ""
            try:
                with open(log_path, "r") as _lf:
                    lines = [l.strip() for l in _lf.readlines() if l.strip()]
                    for line in reversed(lines):
                        if any(kw in line.lower() for kw in ("error", "failed", "exception")):
                            last_error_line = line[:512]
                            break
                    if not last_error_line and lines:
                        last_error_line = lines[-1][:512]
            except Exception:
                pass
            job.status = JobStatus.build_failed
            job.finished_at = datetime.utcnow()
            job.error_message = last_error_line or "PlatformIO returned a non-zero exit code."
            with open("/tmp/builder_debug.log", "a") as f:
                f.write(f"Build failed.\\n")

        job.updated_at = datetime.utcnow()
        db.commit()

    except Exception as exc:
        db.rollback()
        job = db.query(BuildJob).filter(BuildJob.id == job_id).first()
        if job:
            failure_timestamp = datetime.utcnow()
            error_message = str(exc).strip() or exc.__class__.__name__
            fallback_log_path = job.log_path or os.path.join(LOGS_DIR, f"{job_id}.log")
            os.makedirs(os.path.dirname(fallback_log_path), exist_ok=True)
            with open(fallback_log_path, "a") as log_file:
                log_file.write(f"\nInternal Server Build Error: {error_message}\n")
            job.log_path = fallback_log_path
            job.status = JobStatus.build_failed
            job.finished_at = failure_timestamp
            job.updated_at = failure_timestamp
            job.error_message = error_message
            db.commit()
    finally:
        db.close()
