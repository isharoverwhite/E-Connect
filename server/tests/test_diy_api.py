import json
from pathlib import Path
from datetime import datetime, timedelta
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api import router
from app.database import Base, get_db
from app.sql_models import (
    User,
    Household,
    HouseholdMembership,
    HouseholdRole,
    UserApprovalStatus,
    Room,
    DiyProject,
    BuildJob,
    JobStatus,
    SerialSession,
    SerialSessionStatus,
)
from app.auth import get_password_hash

# Setup test DB
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_diy_api.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

from fastapi import FastAPI
app = FastAPI()
app.include_router(router, prefix="/api/v1")
app.dependency_overrides[get_db] = override_get_db

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield

def create_test_user(db, username="testuser"):
    user = User(
        username=username,
        fullname="Test User",
        authentication=get_password_hash("password"),
        approval_status=UserApprovalStatus.approved
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    household = Household(name="Test Household")
    db.add(household)
    db.commit()
    db.refresh(household)
    
    membership = HouseholdMembership(user_id=user.user_id, household_id=household.household_id, role=HouseholdRole.owner)
    db.add(membership)
    
    room = Room(name="Test Room", user_id=user.user_id, household_id=household.household_id)
    db.add(room)
    db.commit()
    db.refresh(room)
    
    return user, room

def get_token(username="testuser"):
    response = client.post(
        "/api/v1/auth/token",
        data={"username": username, "password": "password"}
    )
    return response.json()["access_token"]

def test_system_status():
    response = client.get("/api/v1/system/status")
    assert response.status_code == 200
    assert response.json()["initialized"] is False

def test_initial_server_setup():
    payload = {
        "fullname": "Master Admin",
        "username": "admin",
        "password": "securepassword",
        "householdName": "My Home",
        "ui_layout": {}
    }
    response = client.post("/api/v1/auth/initialserver", json=payload)
    assert response.status_code == 200
    assert response.json()["user"]["username"] == "admin"
    assert response.json()["household"]["name"] == "My Home"

def test_create_project_and_build():
    db = TestingSessionLocal()
    user, room = create_test_user(db)
    token = get_token()
    
    project_payload = {
        "name": "Test Node",
        "board_profile": "esp32",
        "room_id": room.room_id,
        "config": {
            "wifi_ssid": "SSID",
            "wifi_password": "PASS",
            "pins": [
                {"gpio": 2, "mode": "OUTPUT", "label": "LED"}
            ]
        }
    }
    response = client.post(
        "/api/v1/diy/projects",
        json=project_payload,
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    project_id = response.json()["id"]
    
    build_response = client.post(
        f"/api/v1/diy/build?project_id={project_id}",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert build_response.status_code == 200
    assert build_response.json()["status"] == "queued"

def test_i2c_catalog_api():
    db = TestingSessionLocal()
    create_test_user(db, username="i2cuser")
    token = get_token(username="i2cuser")
    
    response = client.get("/api/v1/diy/i2c/libraries", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    catalog = response.json()
    assert len(catalog) > 0
    assert any(lib["display_name"].startswith("BME280") for lib in catalog)

def test_create_project_with_pwm_range():
    db = TestingSessionLocal()
    user, room = create_test_user(db, username="pwmuser")
    token = get_token(username="pwmuser")
    
    project_payload = {
        "name": "PWM Light",
        "board_profile": "esp32-devkit-v1",
        "room_id": room.room_id,
        "config": {
            "wifi_ssid": "test",
            "wifi_password": "test",
            "pins": [
                {
                    "gpio": 2,
                    "mode": "PWM",
                    "label": "Dimmer",
                    "extra_params": {
                        "min_value": 20,
                        "max_value": 200
                    }
                }
            ]
        }
    }
    
    response = client.post(
        "/api/v1/diy/projects",
        json=project_payload,
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["config"]["pins"][0]["extra_params"]["min_value"] == 20
    assert data["config"]["pins"][0]["extra_params"]["max_value"] == 200

def test_create_project_with_i2c_metadata():
    db = TestingSessionLocal()
    user, room = create_test_user(db, username="i2cmeta")
    token = get_token(username="i2cmeta")
    
    project_payload = {
        "name": "I2C Sensor",
        "board_profile": "esp32-devkit-v1",
        "room_id": room.room_id,
        "config": {
            "wifi_ssid": "test",
            "wifi_password": "test",
            "pins": [
                {
                    "gpio": 21,
                    "mode": "I2C",
                    "extra_params": {
                        "i2c_role": "SDA",
                        "i2c_address": "0x77",
                        "i2c_library": "adafruit/Adafruit BME280 Library"
                    }
                },
                {
                    "gpio": 22,
                    "mode": "I2C",
                    "extra_params": {
                        "i2c_role": "SCL"
                    }
                }
            ]
        }
    }
    
    response = client.post(
        "/api/v1/diy/projects",
        json=project_payload,
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    data = response.json()
    pins = data["config"]["pins"]
    sda_pin = next(p for p in pins if p["extra_params"].get("i2c_role") == "SDA")
    assert sda_pin["extra_params"]["i2c_library"] == "adafruit/Adafruit BME280 Library"
    assert any(p["extra_params"].get("i2c_role") == "SCL" for p in pins)

def test_validate_diy_config_pwm_invalid_range():
    db = TestingSessionLocal()
    user, room = create_test_user(db, username="badpwm")
    token = get_token(username="badpwm")
    
    project_payload = {
        "name": "Bad PWM",
        "board_profile": "esp32-devkit-v1",
        "room_id": room.room_id,
        "config": {
            "wifi_ssid": "test",
            "wifi_password": "test",
            "pins": [
                {
                    "gpio": 2,
                    "mode": "PWM",
                    "extra_params": {
                        "min_value": 255,
                        "max_value": 0
                    }
                }
            ]
        }
    }
    
    save_resp = client.post("/api/v1/diy/projects", json=project_payload, headers={"Authorization": f"Bearer {token}"})
    project_id = save_resp.json()["id"]
    
    build_resp = client.post(f"/api/v1/diy/build?project_id={project_id}", headers={"Authorization": f"Bearer {token}"})
    assert build_resp.status_code == 400
    assert "PWM min_value (255) must be less than max_value (0)" in str(build_resp.json()["detail"])

def test_validate_diy_config_i2c_missing_pin():
    db = TestingSessionLocal()
    user, room = create_test_user(db, username="badi2c1")
    token = get_token(username="badi2c1")
    
    project_payload = {
        "name": "Bad I2C Missing Pin",
        "board_profile": "esp32-devkit-v1",
        "room_id": room.room_id,
        "config": {
            "wifi_ssid": "test",
            "wifi_password": "test",
            "pins": [
                {
                    "gpio": 21,
                    "mode": "I2C",
                    "extra_params": {
                        "i2c_role": "SDA"
                    }
                }
            ]
        }
    }
    
    save_resp = client.post("/api/v1/diy/projects", json=project_payload, headers={"Authorization": f"Bearer {token}"})
    project_id = save_resp.json()["id"]
    
    build_resp = client.post(f"/api/v1/diy/build?project_id={project_id}", headers={"Authorization": f"Bearer {token}"})
    assert build_resp.status_code == 400
    assert "I2C mode requires exactly one SDA pin and one SCL pin" in str(build_resp.json()["detail"])

def test_validate_diy_config_i2c_bad_address():
    db = TestingSessionLocal()
    user, room = create_test_user(db, username="badi2c2")
    token = get_token(username="badi2c2")
    
    project_payload = {
        "name": "Bad I2C Address",
        "board_profile": "esp32-devkit-v1",
        "room_id": room.room_id,
        "config": {
            "wifi_ssid": "test",
            "wifi_password": "test",
            "pins": [
                 {
                    "gpio": 21,
                    "mode": "I2C",
                    "extra_params": {
                        "i2c_role": "SDA",
                        "i2c_address": "0xG1"
                    }
                },
                {
                    "gpio": 22,
                    "mode": "I2C",
                    "extra_params": {
                        "i2c_role": "SCL"
                    }
                }
            ]
        }
    }
    
    save_resp = client.post("/api/v1/diy/projects", json=project_payload, headers={"Authorization": f"Bearer {token}"})
    project_id = save_resp.json()["id"]
    
    build_resp = client.post(f"/api/v1/diy/build?project_id={project_id}", headers={"Authorization": f"Bearer {token}"})
    assert build_resp.status_code == 400
    assert "I2C address must be a valid hex string" in str(build_resp.json()["detail"])

def test_mqtt_only_rest_block():
    db = TestingSessionLocal()
    user, room = create_test_user(db, username="mqttuser")
    token = get_token(username="mqttuser")
    
    from app.sql_models import Device, DeviceMode
    dev = Device(
        device_id="mqtt-node",
        mac_address="00:11:22:33:44:55",
        name="MQTT Node",
        mode=DeviceMode.library,
        auth_status="approved",
        owner_id=user.user_id,
        room_id=room.room_id,
        topic_pub="pub",
        topic_sub="sub"
    )
    db.add(dev)
    db.commit()
    
    response = client.post(
        "/api/v1/device/mqtt-node/history",
        json={"event_type": "online", "payload": "{\"kind\":\"state\"}"},
    )
    
    assert response.status_code == 409
    payload = response.json()["detail"]
    assert payload["error"] == "mqtt_only"

def test_resolve_board_definition_supports_explicit_esp8266_variants():
    from app.services.diy_validation import resolve_board_definition

    assert resolve_board_definition("esp8266").platformio_board == "nodemcuv2"
    assert resolve_board_definition("wemos-d1-mini").platformio_board == "d1_mini"
    assert resolve_board_definition("d1-mini-pro").platformio_board == "d1_mini_pro"
    assert resolve_board_definition("esp-01s").platformio_board == "esp01_1m"
    assert resolve_board_definition("esp12f").platformio_board == "esp12e"

    # Existing ESP32 alias resolution must remain intact.
    assert resolve_board_definition("esp32-c3-super-mini").platformio_board == "esp32-c3-devkitm-1"

def test_validate_diy_config_is_board_aware_for_esp8266():
    from app.services.diy_validation import validate_diy_config

    valid_config = {
        "wifi_ssid": "ssid",
        "wifi_password": "pass",
        "pins": [
            {"gpio": 16, "mode": "PWM", "label": "PWM Output"},
        ],
    }
    board, errors, warnings = validate_diy_config("d1_mini", valid_config)
    assert board.canonical_id == "d1_mini"
    assert errors == []
    assert warnings == []

    board, errors, _ = validate_diy_config("esp01_1m", valid_config)
    assert board.canonical_id == "esp01_1m"
    assert "Invalid config: GPIO 16 is not supported for esp01_1m" in errors

    reserved_uart_config = {
        "wifi_ssid": "ssid",
        "wifi_password": "pass",
        "pins": [
            {"gpio": 1, "mode": "OUTPUT", "label": "Unsafe TX"},
        ],
    }
    _, errors, _ = validate_diy_config("nodemcuv2", reserved_uart_config)
    assert "Invalid config: GPIO 1 is reserved for nodemcuv2" in errors

def test_builder_generates_esp8266_platformio_ini(tmp_path):
    from app.services.builder import generate_platformio_ini

    class MockProject:
        def __init__(self, config, board_profile):
            self.config = config
            self.board_profile = board_profile

    project = MockProject(
        config={
            "cpu_mhz": 80,
            "flash_size": "16MB",
            "psram_size": "None",
            "pins": [],
        },
        board_profile="d1_mini_pro",
    )

    generate_platformio_ini(project, str(tmp_path))

    content = (tmp_path / "platformio.ini").read_text()
    assert "[env:d1_mini_pro]" in content
    assert "platform = espressif8266" in content
    assert "board = d1_mini_pro" in content
    assert "board_upload.flash_size = 16MB" in content
    assert "ARDUINO_USB_MODE" not in content

def test_collect_build_outputs_supports_esp8266_firmware_only(tmp_path):
    from app.services.builder import collect_build_outputs

    build_dir = tmp_path / ".pio" / "build" / "d1_mini"
    build_dir.mkdir(parents=True)
    firmware_path = build_dir / "firmware.bin"
    firmware_path.write_bytes(b"esp8266-firmware")

    outputs = collect_build_outputs(str(tmp_path), "d1_mini")

    assert outputs == {"firmware": str(firmware_path)}

def test_list_diy_projects_matches_legacy_esp8266_aliases():
    db = TestingSessionLocal()
    user, room = create_test_user(db, username="legacyesp8266")
    token = get_token(username="legacyesp8266")

    legacy_project = DiyProject(
        id=str(uuid.uuid4()),
        user_id=user.user_id,
        room_id=room.room_id,
        name="Legacy ESP8266",
        board_profile="esp8266",
        config={
            "wifi_ssid": "ssid",
            "wifi_password": "pass",
            "pins": [{"gpio": 4, "mode": "OUTPUT", "label": "Legacy Relay"}],
        },
    )
    other_project = DiyProject(
        id=str(uuid.uuid4()),
        user_id=user.user_id,
        room_id=room.room_id,
        name="Other ESP8266",
        board_profile="d1_mini",
        config={
            "wifi_ssid": "ssid",
            "wifi_password": "pass",
            "pins": [{"gpio": 4, "mode": "OUTPUT", "label": "Other Relay"}],
        },
    )
    db.add_all([legacy_project, other_project])
    db.commit()

    response = client.get(
        "/api/v1/diy/projects?board_profile=nodemcuv2",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert [project["board_profile"] for project in payload] == ["esp8266"]

def test_builder_generates_correct_config(tmp_path):
    from app.services.builder import write_generated_firmware_config
    
    class MockProject:
        def __init__(self, id, name, config, board_profile):
            self.id = id
            self.name = name
            self.config = config
            self.board_profile = board_profile
    
    mock_config = {
        "wifi_ssid": "test_ssid",
        "wifi_password": "test_password",
        "pins": [
            {
                "gpio": 2,
                "mode": "PWM",
                "label": "PWM Dimmer",
                "extra_params": {
                    "min_value": 20,
                    "max_value": 200
                }
            },
            {
                "gpio": 4,
                "mode": "I2C",
                "label": "I2C Sensor",
                "extra_params": {
                    "i2c_role": "SDA",
                    "i2c_address": "0x3C",
                    "i2c_library": "Wire"
                }
            }
        ]
    }
    project = MockProject(id="test-proj-123", name="Test Project", config=mock_config, board_profile="esp32-devkit-v1")
    
    dest_dir = str(tmp_path)
    write_generated_firmware_config(project, "job-456", dest_dir)
    
    header_path = tmp_path / "include" / "generated_firmware_config.h"
    assert header_path.exists()
    
    content = header_path.read_text()
    
    # First pin config: PWM pin with min_value 20 and max_value 200
    assert '{ 2, "PWM", "pwm", "PWM Dimmer", 1, 20, 200, "", "", "" }' in content, f"Missing PWM pin in: {content}"
    
    # Second pin config: I2C pin with SDA role, address 0x3C, library Wire
    assert '{ 4, "I2C", "i2c", "I2C Sensor", 1, 0, 255, "SDA", "0x3C", "Wire" }' in content, f"Missing I2C pin in: {content}"


def test_release_project_serial_reservation_releases_same_user_lock():
    from app.services.builder import release_project_serial_reservation

    db = TestingSessionLocal()
    user, room = create_test_user(db, username="serialowner")

    project = DiyProject(
        id=str(uuid.uuid4()),
        user_id=user.user_id,
        room_id=room.room_id,
        name="Serial Release Project",
        board_profile="esp32",
        config={
            "wifi_ssid": "ssid",
            "wifi_password": "pass",
            "serial_port": "/dev/ttyUSB0",
            "pins": [{"gpio": 2, "mode": "OUTPUT", "label": "LED"}],
        },
    )
    db.add(project)
    db.commit()
    db.refresh(project)

    serial_session = SerialSession(
        port="/dev/ttyUSB0",
        device_id="serial-owner",
        locked_by_user_id=user.user_id,
        status=SerialSessionStatus.locked,
    )
    db.add(serial_session)
    db.commit()
    db.refresh(serial_session)

    released_port = release_project_serial_reservation(project, db)
    db.commit()
    db.refresh(serial_session)

    assert released_port == "/dev/ttyUSB0"
    assert serial_session.status == SerialSessionStatus.released
    assert serial_session.released_at is not None


def test_release_project_serial_reservation_ignores_other_user_lock():
    from app.services.builder import release_project_serial_reservation

    db = TestingSessionLocal()
    user, room = create_test_user(db, username="serialproject")
    other_user, _ = create_test_user(db, username="serialother")

    project = DiyProject(
        id=str(uuid.uuid4()),
        user_id=user.user_id,
        room_id=room.room_id,
        name="Busy Port Project",
        board_profile="esp32",
        config={
            "wifi_ssid": "ssid",
            "wifi_password": "pass",
            "serial_port": "/dev/ttyUSB0",
            "pins": [{"gpio": 2, "mode": "OUTPUT", "label": "LED"}],
        },
    )
    db.add(project)
    db.commit()
    db.refresh(project)

    serial_session = SerialSession(
        port="/dev/ttyUSB0",
        device_id="serial-other",
        locked_by_user_id=other_user.user_id,
        status=SerialSessionStatus.locked,
    )
    db.add(serial_session)
    db.commit()
    db.refresh(serial_session)

    released_port = release_project_serial_reservation(project, db)
    db.commit()
    db.refresh(serial_session)

    assert released_port is None
    assert serial_session.status == SerialSessionStatus.locked
    assert serial_session.released_at is None
