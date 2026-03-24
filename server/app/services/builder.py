import os
import shutil
import subprocess
import ipaddress
from datetime import datetime
from pathlib import Path
from typing import Callable, Mapping
from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.services.diy_validation import resolve_board_definition
from app.services.provisioning import build_project_firmware_identity
from app.sql_models import BuildJob, JobStatus, SerialSession, SerialSessionStatus
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


_BLOCKED_ADVERTISED_HOSTNAMES = {
    "localhost",
    "server",
    "mqtt",
    "db",
    "webapp",
}


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


def infer_firmware_network_targets(headers: Mapping[str, str], request_scheme: str) -> dict[str, str]:
    forwarded_host, forwarded_proto = _parse_forwarded_header(headers.get("forwarded"))
    candidates = [
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
            netloc, hostname, scheme = _parse_host_candidate(raw_value, default_scheme=default_scheme)
            _validate_advertised_hostname(hostname)
            return {
                "advertised_host": hostname,
                "api_base_url": f"{scheme}://{netloc.rstrip('/')}/api/v1",
            }
        except ValueError as exc:
            errors.append(f"{source}: {exc}")

    detail = (
        "Server could not infer a reachable host for firmware provisioning from the current request. "
        "Open the Web UI using the server LAN IP or a trusted reverse-proxy hostname, not localhost, "
        "127.0.0.1, or Docker-only names."
    )
    if errors:
        detail = f"{detail} Checked headers: {' | '.join(errors)}"
    raise ValueError(detail)


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
        advertised_host = config_json.get("advertised_host")
        if isinstance(advertised_host, str) and advertised_host.strip():
            normalized = advertised_host.strip()
            _validate_advertised_hostname(normalized)
            return normalized

        candidate = config_json.get("mqtt_broker")
        if isinstance(candidate, str) and candidate.strip():
            normalized = candidate.strip()
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


def write_generated_firmware_config(project, job_id: str, project_dir: str):
    config_json = project.config if isinstance(project.config, dict) else {}
    include_dir = os.path.join(project_dir, "include")
    os.makedirs(include_dir, exist_ok=True)

    device_id, secret_key = build_project_firmware_identity(project.id)
    project_name = str(config_json.get("project_name") or project.name or "E-Connect Node").strip()
    firmware_version = f"build-{job_id[:8]}"
    wifi_ssid = str(config_json.get("wifi_ssid") or "")
    wifi_password = str(config_json.get("wifi_password") or "")
    mqtt_broker = _resolve_mqtt_broker(config_json)
    mqtt_port = int(os.getenv("FIRMWARE_MQTT_PORT", os.getenv("MQTT_PORT", "1883")))
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
        write_generated_firmware_config(project, job_id, project_dir)

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
