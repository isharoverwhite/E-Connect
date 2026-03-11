import os
import shutil
import subprocess
from datetime import datetime

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.services.diy_validation import resolve_board_definition
from app.sql_models import BuildJob, JobStatus

BUILD_BASE_DIR = os.getenv("BUILD_BASE_DIR", "/tmp/econnect_builds")
JOBS_DIR = os.path.join(BUILD_BASE_DIR, "jobs")
ARTIFACTS_DIR = os.path.join(BUILD_BASE_DIR, "artifacts")
LOGS_DIR = os.path.join(BUILD_BASE_DIR, "logs")
PLATFORMIO_CORE_DIR = os.getenv("PLATFORMIO_CORE_DIR", os.path.join(BUILD_BASE_DIR, ".platformio"))

for path in (BUILD_BASE_DIR, JOBS_DIR, ARTIFACTS_DIR, LOGS_DIR, PLATFORMIO_CORE_DIR):
    os.makedirs(path, exist_ok=True)


def generate_platformio_ini(board_profile: str, project_dir: str):
    board_definition = resolve_board_definition(board_profile)
    ini_content = f"""[env:{board_definition.platformio_board}]
platform = {board_definition.platform}
board = {board_definition.platformio_board}
framework = arduino
monitor_speed = 115200
"""
    with open(os.path.join(project_dir, "platformio.ini"), "w") as file:
        file.write(ini_content)


def generate_main_cpp(config_json: dict, project_dir: str):
    src_dir = os.path.join(project_dir, "src")
    os.makedirs(src_dir, exist_ok=True)

    pins = config_json.get("pins", []) if isinstance(config_json, dict) else []
    has_i2c = any((pin.get("mode") or "").upper() == "I2C" for pin in pins)
    i2c_pins = [pin.get("gpio", pin.get("gpio_pin")) for pin in pins if (pin.get("mode") or "").upper() == "I2C"]

    wifi_ssid = config_json.get("wifi_ssid") if isinstance(config_json, dict) else None
    wifi_password = config_json.get("wifi_password") if isinstance(config_json, dict) else None

    includes = "#include <Arduino.h>\n"
    if has_i2c:
        includes += "#include <Wire.h>\n"
    if wifi_ssid:
        includes += "#include <WiFi.h>\n"

    setup_lines = [
        "Serial.begin(115200);",
        'Serial.println("E-Connect DIY Firmware Booting...");',
    ]

    if wifi_ssid:
        setup_lines.append(f'WiFi.begin("{wifi_ssid}", "{wifi_password or ""}");')
        setup_lines.append(f'Serial.print("Connecting to Wi-Fi: {wifi_ssid}");')

    if len(i2c_pins) >= 2:
        setup_lines.append(f"Wire.begin({i2c_pins[0]}, {i2c_pins[1]});")

    for pin in pins:
        gpio = pin.get("gpio", pin.get("gpio_pin"))
        mode = (pin.get("mode") or "").upper()
        label = pin.get("label") or pin.get("function") or f"GPIO {gpio}"
        if not isinstance(gpio, int):
            continue

        if mode in {"OUTPUT", "PWM"}:
            setup_lines.append(f"pinMode({gpio}, OUTPUT); // {label}")
            setup_lines.append(f"digitalWrite({gpio}, LOW);")
        elif mode in {"INPUT", "ADC", "I2C"}:
            setup_lines.append(f"pinMode({gpio}, INPUT); // {label}")

    setup_body = "\n    ".join(setup_lines)
    cpp_content = f"""{includes}

void setup() {{
    {setup_body}
}}

void loop() {{
    // Generated firmware keeps the MCU alive while higher-level runtime is integrated.
    delay(1000);
}}
"""
    with open(os.path.join(src_dir, "main.cpp"), "w") as file:
        file.write(cpp_content)


import traceback
import logging

logger = logging.getLogger(__name__)

def build_firmware_task(job_id: str, warnings: list[str] | None = None):
    try:
        with open("/tmp/builder_debug.log", "a") as f:
            f.write(f"\\n--- Starting build_firmware_task for job_id={job_id} ---\\n")
        db: Session = SessionLocal()
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
            f.write(f"Directories created, generating ini and main.cpp.\\n")

        project = job.project
        generate_platformio_ini(project.board_profile, project_dir)
        generate_main_cpp(project.config or {}, project_dir)

        with open(log_path, "w") as log_file:
            log_file.write(f"--- Build started for job {job_id} at {datetime.utcnow().isoformat()} ---\\n")
            for warning in warnings or []:
                log_file.write(f"{warning}\\n")
            log_file.flush()

            with open("/tmp/builder_debug.log", "a") as f:
                f.write(f"Starting PIO subprocess.\\n")

            process = subprocess.Popen(
                ["pio", "run"],
                cwd=project_dir,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                env={**os.environ, "PLATFORMIO_CORE_DIR": PLATFORMIO_CORE_DIR},
            )
            process.wait()

        with open("/tmp/builder_debug.log", "a") as f:
            f.write(f"PIO subprocess completed with code {process.returncode}.\\n")

        if process.returncode == 0:
            firmware_bin = None
            pio_build_dir = os.path.join(project_dir, ".pio", "build")
            if os.path.exists(pio_build_dir):
                for root, _, files in os.walk(pio_build_dir):
                    if "firmware.bin" in files:
                        firmware_bin = os.path.join(root, "firmware.bin")
                        break

            if firmware_bin and os.path.exists(firmware_bin):
                durable_artifact_path = os.path.join(ARTIFACTS_DIR, f"{job_id}.bin")
                shutil.copy2(firmware_bin, durable_artifact_path)
                job.status = JobStatus.artifact_ready
                job.artifact_path = durable_artifact_path
                job.finished_at = datetime.utcnow()
                with open("/tmp/builder_debug.log", "a") as f:
                    f.write(f"Artifact successfully saved.\\n")
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
            fallback_log_path = job.log_path or os.path.join(LOGS_DIR, f"{job_id}.log")
            os.makedirs(os.path.dirname(fallback_log_path), exist_ok=True)
            with open(fallback_log_path, "a") as log_file:
                log_file.write(f"\nInternal Server Build Error: {str(exc)}\n")
            job.log_path = fallback_log_path
            job.status = JobStatus.build_failed
            job.updated_at = datetime.utcnow()
            db.commit()
    finally:
        db.close()
