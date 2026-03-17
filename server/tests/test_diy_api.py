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
from app.sql_models import User, Household, HouseholdMembership, HouseholdRole, UserApprovalStatus, Room, DiyProject, BuildJob, JobStatus
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
