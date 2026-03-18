import os
import shutil
import socket
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Callable

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.services.diy_validation import resolve_board_definition
from app.services.provisioning import build_project_firmware_identity
from app.sql_models import BuildJob, JobStatus
from app.services.i2c_registry import find_library_by_name

BUILD_BASE_DIR = os.getenv("BUILD_BASE_DIR", "/tmp/econnect_builds")
JOBS_DIR = os.path.join(BUILD_BASE_DIR, "jobs")
ARTIFACTS_DIR = os.path.join(BUILD_BASE_DIR, "artifacts")
LOGS_DIR = os.path.join(BUILD_BASE_DIR, "logs")
PLATFORMIO_CORE_DIR = os.getenv("PLATFORMIO_CORE_DIR", os.path.join(BUILD_BASE_DIR, ".platformio"))
FIRMWARE_TEMPLATE_DIR = Path(__file__).resolve().parents[3] / "firmware" / "firmware"
ARTIFACT_FILENAMES = {
    "firmware": "{job_id}.bin",
    "bootloader": "{job_id}.bootloader.bin",
    "partitions": "{job_id}.partitions.bin",
}

for path in (BUILD_BASE_DIR, JOBS_DIR, ARTIFACTS_DIR, LOGS_DIR, PLATFORMIO_CORE_DIR):
    os.makedirs(path, exist_ok=True)


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
        return candidate.strip()

    for env_name in ("FIRMWARE_API_BASE_URL", "DIY_API_BASE_URL", "PUBLIC_API_BASE_URL"):
        env_value = os.getenv(env_name, "").strip()
        if env_value:
            return env_value

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("8.8.8.8", 80))
            lan_ip = probe.getsockname()[0]
        api_port = os.getenv("FIRMWARE_API_PORT", os.getenv("PORT", "8000")).strip() or "8000"
        return f"http://{lan_ip}:{api_port}/api/v1"
    except OSError:
        return None


def write_generated_firmware_config(project, job_id: str, project_dir: str):
    config_json = project.config if isinstance(project.config, dict) else {}
    include_dir = os.path.join(project_dir, "include")
    os.makedirs(include_dir, exist_ok=True)

    device_id, secret_key = build_project_firmware_identity(project.id)
    project_name = str(config_json.get("project_name") or project.name or "E-Connect Node").strip()
    firmware_version = f"build-{job_id[:8]}"
    wifi_ssid = str(config_json.get("wifi_ssid") or "")
    wifi_password = str(config_json.get("wifi_password") or "")
    mqtt_broker = str(config_json.get("mqtt_broker") or os.getenv("FIRMWARE_MQTT_BROKER") or os.getenv("MQTT_BROKER", "broker.emqx.io"))
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
