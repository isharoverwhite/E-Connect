import json
import os
from pathlib import Path
from datetime import datetime, timedelta
import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import close_all_sessions, sessionmaker

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

LAN_BASE_URL = "http://192.168.1.25:3000"
client = TestClient(app, base_url=LAN_BASE_URL)

@pytest.fixture(autouse=True)
def setup_db():
    close_all_sessions()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    close_all_sessions()

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


def create_test_project(token: str, room_id: int, *, name: str = "Test Project") -> str:
    response = client.post(
        "/api/v1/diy/projects",
        json={
            "name": name,
            "board_profile": "esp32-devkit-v1",
            "room_id": room_id,
            "config": {
                "wifi_ssid": "test-ssid",
                "wifi_password": "test-password",
                "pins": [{"gpio": 2, "mode": "OUTPUT", "label": "LED"}],
            },
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]

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


def test_delete_project_requires_password_confirmation():
    db = TestingSessionLocal()
    _user, room = create_test_user(db, username="delete-missing-password")
    token = get_token(username="delete-missing-password")
    project_id = create_test_project(token, room.room_id, name="Delete Missing Password")

    response = client.request(
        "DELETE",
        f"/api/v1/diy/projects/{project_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "error": "validation",
        "message": "Enter your account password before deleting this board config.",
    }
    assert db.query(DiyProject).filter(DiyProject.id == project_id).first() is not None


def test_delete_project_rejects_incorrect_password():
    db = TestingSessionLocal()
    _user, room = create_test_user(db, username="delete-wrong-password")
    token = get_token(username="delete-wrong-password")
    project_id = create_test_project(token, room.room_id, name="Delete Wrong Password")

    response = client.request(
        "DELETE",
        f"/api/v1/diy/projects/{project_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"password": "not-the-right-password"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == {
        "error": "invalid_password",
        "message": "Incorrect password. Enter the password for the signed-in account to delete this board config.",
    }
    assert db.query(DiyProject).filter(DiyProject.id == project_id).first() is not None


def test_delete_project_succeeds_with_current_user_password():
    db = TestingSessionLocal()
    _user, room = create_test_user(db, username="delete-correct-password")
    token = get_token(username="delete-correct-password")
    project_id = create_test_project(token, room.room_id, name="Delete Correct Password")

    response = client.request(
        "DELETE",
        f"/api/v1/diy/projects/{project_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"password": "password"},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"status": "deleted", "id": project_id}
    assert db.query(DiyProject).filter(DiyProject.id == project_id).first() is None

def test_trigger_build_stamps_reachable_server_host_into_project_config():
    db = TestingSessionLocal()
    _user, room = create_test_user(db, username="networkstamp")
    token = get_token(username="networkstamp")

    project_payload = {
        "name": "Stamped Node",
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
    create_response = client.post(
        "/api/v1/diy/projects",
        json=project_payload,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_response.status_code == 200
    project_id = create_response.json()["id"]

    with patch("app.api.build_firmware_task", return_value=None):
        build_response = client.post(
            f"/api/v1/diy/build?project_id={project_id}",
            headers={
                "Authorization": f"Bearer {token}",
                "X-Forwarded-Host": "192.168.50.10:3000",
                "X-Forwarded-Proto": "https",
            },
        )

    assert build_response.status_code == 200, build_response.text

    project = db.query(DiyProject).filter(DiyProject.id == project_id).first()
    assert project is not None
    db.refresh(project)
    assert project.config["advertised_host"] == "192.168.50.10"
    assert project.config["api_base_url"] == "https://192.168.50.10:3000/api/v1"
    assert project.config["mqtt_broker"] == "192.168.50.10"
    assert project.config["mqtt_port"] == 1883
    assert project.config["target_key"] == "192.168.50.10|https://192.168.50.10:3000/api/v1|192.168.50.10|1883"

def test_trigger_build_rejects_localhost_request_host():
    db = TestingSessionLocal()
    _user, room = create_test_user(db, username="badhost")
    token = get_token(username="badhost")

    project_payload = {
        "name": "Bad Host Node",
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
    create_response = client.post(
        "/api/v1/diy/projects",
        json=project_payload,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_response.status_code == 200
    project_id = create_response.json()["id"]

    response = client.post(
        f"/api/v1/diy/build?project_id={project_id}",
        headers={
            "Authorization": f"Bearer {token}",
            "Host": "127.0.0.1:3000",
        },
    )

    assert response.status_code == 400
    payload = response.json()["detail"]
    assert payload["error"] == "validation"
    assert "reachable host" in payload["message"]


def test_trigger_build_stamps_distinct_public_mqtt_target(monkeypatch):
    db = TestingSessionLocal()
    _user, room = create_test_user(db, username="mqttoverride")
    token = get_token(username="mqttoverride")

    project_payload = {
        "name": "MQTT Override Node",
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
    create_response = client.post(
        "/api/v1/diy/projects",
        json=project_payload,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_response.status_code == 200
    project_id = create_response.json()["id"]

    monkeypatch.setenv("FIRMWARE_MQTT_BROKER", "mqtt-lan.local")
    monkeypatch.setenv("FIRMWARE_MQTT_PORT", "2883")

    with patch("app.api.build_firmware_task", return_value=None):
        response = client.post(
            f"/api/v1/diy/build?project_id={project_id}",
            headers={
                "Authorization": f"Bearer {token}",
                "X-Forwarded-Host": "192.168.50.10:3000",
                "X-Forwarded-Proto": "https",
            },
        )

    assert response.status_code == 200, response.text
    project = db.query(DiyProject).filter(DiyProject.id == project_id).first()
    assert project is not None
    db.refresh(project)
    assert project.config["advertised_host"] == "192.168.50.10"
    assert project.config["api_base_url"] == "https://192.168.50.10:3000/api/v1"
    assert project.config["mqtt_broker"] == "mqtt-lan.local"
    assert project.config["mqtt_port"] == 2883
    assert project.config["target_key"] == "192.168.50.10|https://192.168.50.10:3000/api/v1|mqtt-lan.local|2883"


def test_trigger_build_prefers_configured_public_base_url_over_localhost_request(monkeypatch):
    db = TestingSessionLocal()
    _user, room = create_test_user(db, username="publicbase")
    token = get_token(username="publicbase")

    project_payload = {
        "name": "Public Base Node",
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
    create_response = client.post(
        "/api/v1/diy/projects",
        json=project_payload,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_response.status_code == 200
    project_id = create_response.json()["id"]

    monkeypatch.setenv("FIRMWARE_PUBLIC_BASE_URL", "https://192.168.8.4:3000")

    with patch("app.api.build_firmware_task", return_value=None):
        response = client.post(
            f"/api/v1/diy/build?project_id={project_id}",
            headers={
                "Authorization": f"Bearer {token}",
                "Host": "127.0.0.1:3000",
            },
        )

    assert response.status_code == 200, response.text
    project = db.query(DiyProject).filter(DiyProject.id == project_id).first()
    assert project is not None
    db.refresh(project)
    assert project.config["advertised_host"] == "192.168.8.4"
    assert project.config["api_base_url"] == "https://192.168.8.4:3000/api/v1"
    assert project.config["mqtt_broker"] == "192.168.8.4"
    assert project.config["mqtt_port"] == 1883


def test_trigger_build_prefers_browser_origin_header_over_internal_proxy_host():
    db = TestingSessionLocal()
    _user, room = create_test_user(db, username="browserorigin")
    token = get_token(username="browserorigin")

    project_payload = {
        "name": "Browser Origin Node",
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
    create_response = client.post(
        "/api/v1/diy/projects",
        json=project_payload,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_response.status_code == 200
    project_id = create_response.json()["id"]

    with patch("app.api.build_firmware_task", return_value=None):
        response = client.post(
            f"/api/v1/diy/build?project_id={project_id}",
            headers={
                "Authorization": f"Bearer {token}",
                "Host": "server:8000",
                "X-EConnect-Origin": "https://192.168.8.4:3000",
            },
        )

    assert response.status_code == 200, response.text
    project = db.query(DiyProject).filter(DiyProject.id == project_id).first()
    assert project is not None
    db.refresh(project)
    assert project.config["advertised_host"] == "192.168.8.4"
    assert project.config["api_base_url"] == "https://192.168.8.4:3000/api/v1"
    assert project.config["mqtt_broker"] == "192.168.8.4"
    assert project.config["mqtt_port"] == 1883


def test_get_diy_network_targets_uses_browser_origin_header():
    db = TestingSessionLocal()
    create_test_user(db, username="networktargets")
    token = get_token(username="networktargets")

    response = client.get(
        "/api/v1/diy/network-targets",
        headers={
            "Authorization": f"Bearer {token}",
            "Host": "server:8000",
            "X-EConnect-Origin": "https://192.168.8.4:3000",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["advertised_host"] == "192.168.8.4"
    assert payload["mqtt_broker"] == "192.168.8.4"
    assert payload["api_base_url"] == "https://192.168.8.4:3000/api/v1"
    assert payload["target_key"] == "192.168.8.4|https://192.168.8.4:3000/api/v1|192.168.8.4|1883"


def test_get_diy_network_targets_prefers_runtime_startup_target_over_localhost_request():
    db = TestingSessionLocal()
    create_test_user(db, username="runtimehost")
    token = get_token(username="runtimehost")

    app.state.firmware_network_state = {
        "source": "startup_auto",
        "targets": {
            "advertised_host": "192.168.8.44",
            "api_base_url": "https://192.168.8.44:3000/api/v1",
        },
        "error": None,
    }

    try:
        response = client.get(
            "/api/v1/diy/network-targets",
            headers={
                "Authorization": f"Bearer {token}",
                "Host": "127.0.0.1:3000",
            },
        )
    finally:
        app.state.firmware_network_state = None

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["advertised_host"] == "192.168.8.44"
    assert payload["mqtt_broker"] == "192.168.8.44"
    assert payload["api_base_url"] == "https://192.168.8.44:3000/api/v1"
    assert payload["target_key"] == "192.168.8.44|https://192.168.8.44:3000/api/v1|192.168.8.44|1883"


def test_get_diy_network_targets_includes_startup_audit_warning():
    db = TestingSessionLocal()
    create_test_user(db, username="runtimewarning")
    token = get_token(username="runtimewarning")

    app.state.firmware_network_state = {
        "source": "startup_auto",
        "targets": {
            "advertised_host": "192.168.8.44",
            "api_base_url": "https://192.168.8.44:3000/api/v1",
            "mqtt_broker": "mqtt-lan.local",
            "mqtt_port": 2883,
        },
        "error": None,
    }
    app.state.firmware_network_audit = {
        "warning": "Server startup found stale firmware targets. Manual reflash is required.",
        "stale_project_count": 2,
        "stale_device_count": 3,
    }

    try:
        response = client.get(
            "/api/v1/diy/network-targets",
            headers={
                "Authorization": f"Bearer {token}",
                "Host": "127.0.0.1:3000",
            },
        )
    finally:
        app.state.firmware_network_state = None
        app.state.firmware_network_audit = None

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["warning"] == "Server startup found stale firmware targets. Manual reflash is required."
    assert payload["stale_project_count"] == 2
    assert payload["stale_device_count"] == 3
    assert payload["mqtt_broker"] == "mqtt-lan.local"
    assert payload["mqtt_port"] == 2883
    assert payload["target_key"] == "192.168.8.44|https://192.168.8.44:3000/api/v1|mqtt-lan.local|2883"


def test_get_diy_network_targets_rejects_authenticated_non_admin_user():
    db = TestingSessionLocal()
    user, _room = create_test_user(db, username="networkviewer")
    assert user.account_type.value == "parent"
    membership = (
        db.query(HouseholdMembership)
        .filter(HouseholdMembership.user_id == user.user_id)
        .first()
    )
    assert membership is not None
    membership.role = HouseholdRole.member
    db.commit()
    token = get_token(username="networkviewer")

    app.state.firmware_network_state = {
        "source": "startup_auto",
        "targets": {
            "advertised_host": "192.168.8.55",
            "api_base_url": "https://192.168.8.55:3000/api/v1",
        },
        "error": None,
    }

    try:
        response = client.get(
            "/api/v1/diy/network-targets",
            headers={
                "Authorization": f"Bearer {token}",
                "Host": "127.0.0.1:3000",
            },
        )
    finally:
        app.state.firmware_network_state = None

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "Admin or Owner privileges required"


def test_trigger_build_rejects_invalid_configured_public_base_url(monkeypatch):
    db = TestingSessionLocal()
    _user, room = create_test_user(db, username="badpublicbase")
    token = get_token(username="badpublicbase")

    project_payload = {
        "name": "Bad Public Base Node",
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
    create_response = client.post(
        "/api/v1/diy/projects",
        json=project_payload,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_response.status_code == 200
    project_id = create_response.json()["id"]

    monkeypatch.setenv("FIRMWARE_PUBLIC_BASE_URL", "http://localhost:3000")

    response = client.post(
        f"/api/v1/diy/build?project_id={project_id}",
        headers={
            "Authorization": f"Bearer {token}",
            "Host": "127.0.0.1:3000",
        },
    )

    assert response.status_code == 400
    payload = response.json()["detail"]
    assert payload["error"] == "validation"
    assert "loopback" in payload["message"] or "Docker-local" in payload["message"]

def test_describe_network_target_change_requires_rebuild_for_new_server_ip():
    from app.services.builder import describe_network_target_change

    warning = describe_network_target_change(
        {"advertised_host": "192.168.2.16"},
        {"advertised_host": "192.168.8.4", "api_base_url": "https://192.168.8.4:3000/api/v1"},
    )

    assert warning is not None
    assert "192.168.2.16" in warning
    assert "192.168.8.4" in warning
    assert "rebuilt and reflashed" in warning
    assert "Discovery" in warning

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

def test_validate_diy_config_pwm_reverse_range_allowed():
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

    with patch("app.api.build_firmware_task", return_value=None):
        build_resp = client.post(f"/api/v1/diy/build?project_id={project_id}", headers={"Authorization": f"Bearer {token}"})
    assert build_resp.status_code == 200
    assert build_resp.json()["status"] == "queued"

def test_validate_diy_config_pwm_equal_range_invalid():
    db = TestingSessionLocal()
    user, room = create_test_user(db, username="badpwm-equal")
    token = get_token(username="badpwm-equal")

    project_payload = {
        "name": "Bad PWM Equal",
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
                        "max_value": 255
                    }
                }
            ]
        }
    }

    save_resp = client.post("/api/v1/diy/projects", json=project_payload, headers={"Authorization": f"Bearer {token}"})
    project_id = save_resp.json()["id"]

    build_resp = client.post(f"/api/v1/diy/build?project_id={project_id}", headers={"Authorization": f"Bearer {token}"})
    assert build_resp.status_code == 400
    assert "PWM min_value (255) must differ from max_value (255)" in str(build_resp.json()["detail"])

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
        "advertised_host": "192.168.1.50",
        "api_base_url": "http://192.168.1.50:3000/api/v1",
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
    assert '#define MQTT_BROKER "192.168.1.50"' in content
    assert '#define API_BASE_URL "http://192.168.1.50:3000/api/v1"' in content


def test_firmware_template_declares_developer_managed_revision():
    header_path = Path(__file__).resolve().parents[1] / "firmware_template" / "include" / "firmware_revision.h"
    content = header_path.read_text()

    assert '#define ECONNECT_FIRMWARE_REVISION "1.0.0"' in content


def test_builder_uses_distinct_stamped_public_mqtt_target(tmp_path):
    from app.services.builder import write_generated_firmware_config

    class MockProject:
        def __init__(self, id, name, config, board_profile):
            self.id = id
            self.name = name
            self.config = config
            self.board_profile = board_profile

    project = MockProject(
        id="test-proj-456",
        name="MQTT Override Project",
        board_profile="esp32-devkit-v1",
        config={
            "advertised_host": "192.168.1.50",
            "api_base_url": "https://192.168.1.50:3000/api/v1",
            "mqtt_broker": "mqtt-lan.local",
            "mqtt_port": 2883,
            "wifi_ssid": "test_ssid",
            "wifi_password": "test_password",
            "pins": [{"gpio": 2, "mode": "OUTPUT", "label": "LED"}],
        },
    )

    write_generated_firmware_config(project, "job-789", str(tmp_path))

    header_path = tmp_path / "include" / "generated_firmware_config.h"
    content = header_path.read_text()
    assert '#define MQTT_BROKER "mqtt-lan.local"' in content
    assert "#define MQTT_PORT 2883" in content


def test_builder_preserves_descending_pwm_range(tmp_path):
    from app.services.builder import write_generated_firmware_config

    class MockProject:
        def __init__(self, id, name, config, board_profile):
            self.id = id
            self.name = name
            self.config = config
            self.board_profile = board_profile

    project = MockProject(
        id="test-proj-invert",
        name="Inverted PWM",
        board_profile="esp32-devkit-v1",
        config={
            "advertised_host": "192.168.1.60",
            "wifi_ssid": "test_ssid",
            "wifi_password": "test_password",
            "pins": [
                {
                    "gpio": 5,
                    "mode": "PWM",
                    "label": "Active Low PWM",
                    "extra_params": {
                        "min_value": 255,
                        "max_value": 0,
                    },
                }
            ],
        },
    )

    write_generated_firmware_config(project, "job-invert", str(tmp_path))

    header_path = tmp_path / "include" / "generated_firmware_config.h"
    assert header_path.exists()
    content = header_path.read_text()
    assert '{ 5, "PWM", "pwm", "Active Low PWM", 1, 255, 0, "", "", "" }' in content


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
