# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

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
from sqlalchemy.pool import StaticPool

from app.api import router
from app.api import _resolve_build_artifact_path
from app.database import Base, get_db
from app.sql_models import (
    AccountType,
    AuthStatus,
    ConnStatus,
    Device,
    DeviceHistory,
    DeviceMode,
    User,
    Household,
    HouseholdMembership,
    HouseholdRole,
    Room,
    DiyProject,
    DiyProjectConfig,
    BuildJob,
    JobStatus,
    EventType,
    PinConfiguration,
    PinMode,
    SerialSession,
    SerialSessionStatus,
    WifiCredential,
)
from app.auth import get_password_hash
from app.services.diy_validation import validate_diy_config
from app.services.provisioning import PRIVATE_DEVICE_SECRET_KEY

# Setup test DB
SQLALCHEMY_DATABASE_URL = "sqlite://"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
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

def create_test_user(
    db,
    username="testuser",
    *,
    account_type=AccountType.admin,
    household_role=HouseholdRole.owner,
):
    user = User(
        username=username,
        fullname="Test User",
        authentication=get_password_hash("password"),
        account_type=account_type,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    household = Household(name="Test Household")
    db.add(household)
    db.commit()
    db.refresh(household)
    
    membership = HouseholdMembership(
        user_id=user.user_id,
        household_id=household.household_id,
        role=household_role,
    )
    db.add(membership)
    
    room = Room(name="Test Area", user_id=user.user_id, household_id=household.household_id)
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


def create_test_diy_device(
    db,
    *,
    user: User,
    room: Room,
    device_id: str,
    mac_address: str,
    name: str,
    pin_configurations: list[dict[str, object]],
    last_state: dict[str, object] | None = None,
) -> Device:
    device = Device(
        device_id=device_id,
        mac_address=mac_address,
        name=name,
        mode=DeviceMode.no_code,
        auth_status=AuthStatus.approved,
        conn_status=ConnStatus.offline,
        owner_id=user.user_id,
        room_id=room.room_id,
        firmware_version="fake-board-test-1.0.0",
        ip_address="192.168.50.90",
        topic_pub=f"econnect/local/device/{device_id}/state",
        topic_sub=f"econnect/local/device/{device_id}/command",
    )
    db.add(device)
    db.flush()

    for pin in pin_configurations:
        db.add(
            PinConfiguration(
                device_id=device_id,
                gpio_pin=int(pin["gpio_pin"]),
                mode=pin["mode"],
                function=pin.get("function"),
                label=pin.get("label"),
                extra_params=pin.get("extra_params"),
            )
        )

    if last_state is not None:
        db.add(
            DeviceHistory(
                device_id=device_id,
                event_type=EventType.state_change,
                payload=json.dumps(last_state),
            )
        )

    db.commit()
    db.refresh(device)
    return device


def assert_custom_device_response_payload(
    payload: dict[str, object],
    *,
    device_id: str,
    name: str,
    expected_pin_rows: dict[int, dict[str, object]],
) -> None:
    assert payload["device_id"] == device_id
    assert payload["name"] == name
    assert payload["device_type"] == "custom"
    assert payload["is_external"] is False
    assert payload["mode"] == "no-code"
    assert payload["room_name"] == "Test Area"

    pin_configurations = payload["pin_configurations"]
    assert isinstance(pin_configurations, list)
    assert {pin["gpio_pin"] for pin in pin_configurations} == set(expected_pin_rows)

    last_state = payload["last_state"]
    assert isinstance(last_state, dict)
    assert last_state["kind"] == "state"

    rows = {row["pin"]: row for row in last_state["pins"]}
    assert set(rows) == set(expected_pin_rows)
    for pin_number, expected_row in expected_pin_rows.items():
        row = rows[pin_number]
        for key, expected_value in expected_row.items():
            assert row[key] == expected_value


@pytest.mark.parametrize(
    ("device_id", "mac_address", "name", "pin_configurations", "last_state", "expected_pin_rows"),
    [
        pytest.param(
            "custom-switch-regression",
            "02:00:00:00:10:01",
            "Custom Switch Regression",
            [
                {
                    "gpio_pin": 2,
                    "mode": PinMode.OUTPUT,
                    "function": "relay",
                    "label": "Test Relay",
                    "extra_params": {"active_level": 1},
                }
            ],
            {
                "kind": "state",
                "device_id": "custom-switch-regression",
                "applied": True,
                "pin": 2,
                "value": 1,
                "pins": [
                    {
                        "pin": 2,
                        "mode": "OUTPUT",
                        "function": "relay",
                        "label": "Test Relay",
                        "value": 1,
                    }
                ],
            },
            {
                2: {
                    "mode": "OUTPUT",
                    "function": "relay",
                    "value": 1,
                }
            },
            id="switch-board",
        ),
        pytest.param(
            "custom-fan-regression",
            "02:00:00:00:10:02",
            "Custom Fan Regression",
            [
                {
                    "gpio_pin": 3,
                    "mode": PinMode.PWM,
                    "function": "fan",
                    "label": "PWM Fan",
                    "extra_params": {
                        "min_value": 0,
                        "max_value": 255,
                        "input_type": "switch",
                        "switch_type": "momentary",
                    },
                },
                {
                    "gpio_pin": 0,
                    "mode": PinMode.INPUT,
                    "function": "tachometer",
                    "label": "Fan Tachometer",
                    "extra_params": {
                        "input_type": "tachometer",
                        "switch_type": "momentary",
                    },
                },
            ],
            {
                "kind": "state",
                "device_id": "custom-fan-regression",
                "applied": True,
                "pins": [
                    {
                        "pin": 0,
                        "mode": "INPUT",
                        "function": "tachometer",
                        "label": "Fan Tachometer",
                        "value": 2082,
                    },
                    {
                        "pin": 3,
                        "mode": "PWM",
                        "function": "fan",
                        "label": "PWM Fan",
                        "value": 180,
                        "brightness": 180,
                    },
                ],
            },
            {
                0: {
                    "mode": "INPUT",
                    "function": "tachometer",
                    "value": 2082,
                },
                3: {
                    "mode": "PWM",
                    "function": "fan",
                    "value": 180,
                },
            },
            id="fan-tach-board",
        ),
        pytest.param(
            "custom-dht-regression",
            "02:00:00:00:10:03",
            "Custom DHT Regression",
            [
                {
                    "gpio_pin": 4,
                    "mode": PinMode.INPUT,
                    "function": "climate",
                    "label": "DHT22 Climate",
                    "extra_params": {
                        "input_type": "dht",
                        "dht_version": "DHT22",
                    },
                }
            ],
            {
                "kind": "state",
                "device_id": "custom-dht-regression",
                "applied": True,
                "temperature": 24.5,
                "humidity": 61.6,
                "pins": [
                    {
                        "pin": 4,
                        "mode": "INPUT",
                        "function": "climate",
                        "label": "DHT22 Climate",
                        "temperature": 24.5,
                        "humidity": 61.6,
                        "value": 24.5,
                    }
                ],
            },
            {
                4: {
                    "mode": "INPUT",
                    "function": "climate",
                    "temperature": 24.5,
                    "humidity": 61.6,
                    "value": 24.5,
                }
            },
            id="dht22-board",
        ),
        pytest.param(
            "custom-pwm-slicer-regression",
            "02:00:00:00:10:04",
            "Custom PWM Slicer Regression",
            [
                {
                    "gpio_pin": 5,
                    "mode": PinMode.PWM,
                    "function": "dimmer",
                    "label": "PWM Slicer",
                    "extra_params": {
                        "min_value": 0,
                        "max_value": 255,
                    },
                }
            ],
            {
                "kind": "state",
                "device_id": "custom-pwm-slicer-regression",
                "applied": True,
                "pin": 5,
                "value": 128,
                "brightness": 128,
                "pins": [
                    {
                        "pin": 5,
                        "mode": "PWM",
                        "function": "dimmer",
                        "label": "PWM Slicer",
                        "value": 128,
                        "brightness": 128,
                    }
                ],
            },
            {
                5: {
                    "mode": "PWM",
                    "function": "dimmer",
                    "value": 128,
                }
            },
            id="pwm-only-board",
        ),
    ],
)
def test_custom_diy_boards_keep_custom_device_type_across_device_endpoints(
    device_id,
    mac_address,
    name,
    pin_configurations,
    last_state,
    expected_pin_rows,
):
    db = TestingSessionLocal()
    username = device_id.replace("-", "_")
    user, room = create_test_user(db, username=username)
    token = get_token(username=username)

    create_test_diy_device(
        db,
        user=user,
        room=room,
        device_id=device_id,
        mac_address=mac_address,
        name=name,
        pin_configurations=pin_configurations,
        last_state=last_state,
    )

    devices_response = client.get(
        "/api/v1/devices",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert devices_response.status_code == 200, devices_response.text
    device_payload = next(row for row in devices_response.json() if row["device_id"] == device_id)
    assert_custom_device_response_payload(
        device_payload,
        device_id=device_id,
        name=name,
        expected_pin_rows=expected_pin_rows,
    )

    dashboard_response = client.get(
        "/api/v1/dashboard/devices",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert dashboard_response.status_code == 200, dashboard_response.text
    dashboard_payload = next(row for row in dashboard_response.json() if row["device_id"] == device_id)
    assert_custom_device_response_payload(
        dashboard_payload,
        device_id=device_id,
        name=name,
        expected_pin_rows=expected_pin_rows,
    )

    detail_response = client.get(
        f"/api/v1/device/{device_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert detail_response.status_code == 200, detail_response.text
    assert_custom_device_response_payload(
        detail_response.json(),
        device_id=device_id,
        name=name,
        expected_pin_rows=expected_pin_rows,
    )


def test_wifi_credentials_are_masked_in_list_and_reveal_requires_password():
    db = TestingSessionLocal()
    _user, _room = create_test_user(db, username="wifi-admin")
    token = get_token(username="wifi-admin")

    create_response = client.post(
        "/api/v1/wifi-credentials",
        json={"ssid": "Office-2G", "password": "OfficePass123"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_response.status_code == 200, create_response.text
    credential_id = create_response.json()["id"]

    list_response = client.get(
        "/api/v1/wifi-credentials",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert list_response.status_code == 200, list_response.text
    payload = list_response.json()
    assert payload == [
        {
            "id": credential_id,
            "household_id": payload[0]["household_id"],
            "ssid": "Office-2G",
            "masked_password": "*************",
            "usage_count": 0,
            "created_at": payload[0]["created_at"],
            "updated_at": payload[0]["updated_at"],
        }
    ]

    wrong_reveal = client.post(
        f"/api/v1/wifi-credentials/{credential_id}/reveal",
        json={"password": "wrong-password"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert wrong_reveal.status_code == 403
    assert wrong_reveal.json()["detail"]["error"] == "invalid_password"

    reveal_response = client.post(
        f"/api/v1/wifi-credentials/{credential_id}/reveal",
        json={"password": "password"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert reveal_response.status_code == 200, reveal_response.text
    assert reveal_response.json() == {
        "id": credential_id,
        "ssid": "Office-2G",
        "password": "OfficePass123",
    }


def test_owner_role_without_admin_account_cannot_crud_wifi_credentials():
    db = TestingSessionLocal()
    user = User(
        username="owner-no-admin",
        fullname="Owner But Not Admin",
        authentication=get_password_hash("password"),
        account_type=AccountType.parent,
    )
    household = Household(name="Owner Household")
    db.add_all([user, household])
    db.commit()
    db.refresh(user)
    db.refresh(household)
    db.add(
        HouseholdMembership(
            user_id=user.user_id,
            household_id=household.household_id,
            role=HouseholdRole.owner,
        )
    )
    db.commit()

    token = get_token(username="owner-no-admin")

    list_response = client.get(
        "/api/v1/wifi-credentials",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert list_response.status_code == 403

    create_response = client.post(
        "/api/v1/wifi-credentials",
        json={"ssid": "ShouldFail", "password": "ShouldFail123"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_response.status_code == 403


def test_owner_role_without_admin_account_cannot_create_project_from_legacy_wifi_payload():
    db = TestingSessionLocal()
    _user, room = create_test_user(
        db,
        username="legacy-owner-no-admin",
        account_type=AccountType.parent,
        household_role=HouseholdRole.owner,
    )
    token = get_token(username="legacy-owner-no-admin")

    response = client.post(
        "/api/v1/diy/projects",
        json={
            "name": "Owner Legacy Project",
            "board_profile": "esp32-devkit-v1",
            "room_id": room.room_id,
            "config": {
                "wifi_ssid": "Owner-WiFi",
                "wifi_password": "OwnerPass123",
                "pins": [{"gpio": 2, "mode": "OUTPUT", "label": "LED"}],
            },
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == {
        "error": "validation",
        "message": "Select a Wi-Fi credential before creating a device project.",
    }
    assert db.query(WifiCredential).count() == 0


def test_create_project_creates_and_links_wifi_credential_from_legacy_payload():
    db = TestingSessionLocal()
    _user, room = create_test_user(db, username="legacy-project")
    token = get_token(username="legacy-project")

    response = client.post(
        "/api/v1/diy/projects",
        json={
            "name": "Legacy WiFi Project",
            "board_profile": "esp32-devkit-v1",
            "room_id": room.room_id,
            "config": {
                "wifi_ssid": "Builder-WiFi",
                "wifi_password": "BuilderPass123",
                "pins": [{"gpio": 2, "mode": "OUTPUT", "label": "LED"}],
            },
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200, response.text

    project_id = response.json()["id"]
    project = db.query(DiyProject).filter(DiyProject.id == project_id).first()
    assert project is not None
    assert project.wifi_credential_id is not None
    assert project.config["wifi_credential_id"] == project.wifi_credential_id
    assert project.current_config_id is not None
    saved_config = db.query(DiyProjectConfig).filter(DiyProjectConfig.id == project.current_config_id).first()
    assert saved_config is not None
    assert saved_config.project_id == project.id
    assert saved_config.config["config_id"] == saved_config.id
    assert project.config["config_id"] == saved_config.id
    credential = db.query(WifiCredential).filter(WifiCredential.id == project.wifi_credential_id).first()
    assert credential is not None
    assert credential.ssid == "Builder-WiFi"
    assert credential.password == "BuilderPass123"


def test_delete_wifi_credential_conflicts_when_in_use_by_project():
    db = TestingSessionLocal()
    _user, room = create_test_user(db, username="wifi-delete-conflict")
    token = get_token(username="wifi-delete-conflict")
    project_id = create_test_project(token, room.room_id, name="Delete Conflict Project")

    project = db.query(DiyProject).filter(DiyProject.id == project_id).first()
    assert project is not None
    assert project.wifi_credential_id is not None

    response = client.delete(
        f"/api/v1/wifi-credentials/{project.wifi_credential_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["error"] == "conflict"

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
        "language": "en",
        "home_location": {
            "latitude": 21.0285,
            "longitude": 105.8542,
            "label": "Hanoi",
            "source": "manual_search",
        },
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
    assert project.config["api_base_url"] == "http://192.168.50.10:3000/api/v1"
    assert project.config["mqtt_broker"] == "192.168.50.10"
    assert project.config["mqtt_port"] == 1883
    assert project.config["target_key"] == "192.168.50.10|http://192.168.50.10:3000/api/v1|192.168.50.10|1883"

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
    assert project.config["api_base_url"] == "http://192.168.50.10:3000/api/v1"
    assert project.config["mqtt_broker"] == "mqtt-lan.local"
    assert project.config["mqtt_port"] == 2883
    assert project.config["target_key"] == "192.168.50.10|http://192.168.50.10:3000/api/v1|mqtt-lan.local|2883"


def test_trigger_build_prefers_runtime_startup_target_over_localhost_request():
    db = TestingSessionLocal()
    _user, room = create_test_user(db, username="runtimestamppref")
    token = get_token(username="runtimestamppref")

    project_payload = {
        "name": "Runtime Target Node",
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

    app.state.firmware_network_state = {
        "source": "startup_auto",
        "targets": {
            "advertised_host": "192.168.8.4",
            "api_base_url": "https://192.168.8.4:3000/api/v1",
            "mqtt_broker": "192.168.8.4",
            "mqtt_port": 1883,
            "target_key": "192.168.8.4|https://192.168.8.4:3000/api/v1|192.168.8.4|1883",
        },
        "error": None,
    }

    try:
        with patch("app.api.build_firmware_task", return_value=None):
            response = client.post(
                f"/api/v1/diy/build?project_id={project_id}",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Host": "127.0.0.1:3000",
                },
            )
    finally:
        app.state.firmware_network_state = None

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
                "X-EConnect-Origin": "https://192.168.8.4:3443",
            },
        )

    assert response.status_code == 200, response.text
    project = db.query(DiyProject).filter(DiyProject.id == project_id).first()
    assert project is not None
    db.refresh(project)
    assert project.config["advertised_host"] == "192.168.8.4"
    assert project.config["api_base_url"] == "http://192.168.8.4:3000/api/v1"
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
            "X-EConnect-Origin": "https://192.168.8.4:3443",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["advertised_host"] == "192.168.8.4"
    assert payload["mqtt_broker"] == "192.168.8.4"
    assert payload["api_base_url"] == "http://192.168.8.4:3000/api/v1"
    assert payload["webapp_protocol"] == "https"
    assert payload["webapp_port"] == 3443
    assert payload["target_key"] == "192.168.8.4|http://192.168.8.4:3000/api/v1|192.168.8.4|1883"


def test_get_diy_network_targets_falls_back_when_host_storage_mount_is_missing(monkeypatch):
    db = TestingSessionLocal()
    create_test_user(db, username="networktargetsfallback")
    token = get_token(username="networktargetsfallback")
    monkeypatch.setenv("HOST_OS_ROOT", "/hostfs-missing-for-test")

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
    assert payload["storage_used"] >= 0
    assert payload["storage_total"] > 0


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
    assert payload["webapp_protocol"] == "https"
    assert payload["webapp_port"] == 3443
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
    assert payload["webapp_protocol"] == "https"
    assert payload["webapp_port"] == 3443
    assert payload["target_key"] == "192.168.8.44|https://192.168.8.44:3000/api/v1|mqtt-lan.local|2883"


def test_get_diy_network_targets_rejects_authenticated_non_admin_user():
    db = TestingSessionLocal()
    user, _room = create_test_user(
        db,
        username="networkviewer",
        account_type=AccountType.parent,
        household_role=HouseholdRole.member,
    )
    assert user.account_type.value == "parent"
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
    assert resolve_board_definition("dfrobot-beetle-esp32-c3").platformio_board == "dfrobot_beetle_esp32c3"
    assert resolve_board_definition("esp32-c6-devkitc-1").platformio_board == "esp32-c6-devkitc-1"


def test_validate_diy_config_uses_board_specific_c3_rules():
    from app.services.diy_validation import validate_diy_config

    wifi_config = {"wifi_ssid": "ssid", "wifi_password": "pass"}

    board, errors, warnings = validate_diy_config(
        "dfrobot-beetle-esp32-c3",
        {
            **wifi_config,
            "pins": [
                {"gpio": 10, "mode": "OUTPUT", "label": "Onboard LED"},
            ],
        },
    )
    assert board.canonical_id == "dfrobot-beetle-esp32-c3"
    assert errors == []
    assert warnings == []

    board, errors, _ = validate_diy_config(
        "esp32-c3-devkitm-1",
        {
            **wifi_config,
            "pins": [
                {"gpio": 20, "mode": "OUTPUT", "label": "UART RX"},
            ],
        },
    )
    assert board.canonical_id == "esp32-c3-devkitm-1"
    assert "Invalid config: GPIO 20 is reserved for esp32-c3-devkitm-1" in errors

    board, errors, warnings = validate_diy_config(
        "esp32-c3-super-mini",
        {
            **wifi_config,
            "pins": [
                {"gpio": 20, "mode": "OUTPUT", "label": "Reusable UART RX GPIO"},
            ],
        },
    )
    assert board.canonical_id == "esp32-c3-super-mini"
    assert errors == []
    assert warnings == []


def test_validate_diy_config_boot_sensitive_pins_warn_without_blocking():
    from app.services.diy_validation import validate_diy_config

    wifi_config = {"wifi_ssid": "ssid", "wifi_password": "pass"}
    cases = [
        ("esp32-devkit-v1", 0),
        ("esp32-c3-devkitm-1", 9),
        ("dfrobot-beetle-esp32-c3", 9),
        ("esp32-c2-reference", 8),
        ("esp32-c6-devkitc-1", 8),
        ("esp32-cam", 0),
        ("d1_mini", 2),
    ]

    for board_id, gpio in cases:
        board, errors, warnings = validate_diy_config(
            board_id,
            {
                **wifi_config,
                "pins": [
                    {"gpio": gpio, "mode": "OUTPUT", "label": f"GPIO {gpio}"},
                ],
            },
        )
        assert board.canonical_id
        assert errors == []
        assert any(f"GPIO {gpio}" in warning and "Disconnect anything attached" in warning for warning in warnings)

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


def test_collect_build_outputs_includes_full_bundle_for_non_jc_esp32(tmp_path, monkeypatch):
    import app.services.builder as builder

    build_dir = tmp_path / ".pio" / "build" / "esp32-c3-devkitm-1"
    build_dir.mkdir(parents=True)

    firmware_path = build_dir / "firmware.bin"
    bootloader_path = build_dir / "bootloader.bin"
    partitions_path = build_dir / "partitions.bin"
    fake_core_dir = tmp_path / ".platformio-core"
    boot_app0_path = fake_core_dir / "packages" / "framework-arduinoespressif32" / "tools" / "partitions" / "boot_app0.bin"
    boot_app0_path.parent.mkdir(parents=True)
    firmware_path.write_bytes(b"esp32-c3-firmware")
    bootloader_path.write_bytes(b"bootloader")
    partitions_path.write_bytes(b"partitions")
    boot_app0_path.write_bytes(b"boot-app0")

    monkeypatch.setattr(builder, "PLATFORMIO_CORE_DIR", str(fake_core_dir))

    outputs = builder.collect_build_outputs(str(tmp_path), "esp32-c3-devkitm-1")

    assert outputs == {
        "firmware": str(firmware_path),
        "bootloader": str(bootloader_path),
        "partitions": str(partitions_path),
        "boot_app0": str(boot_app0_path),
    }


def test_cleanup_job_build_outputs_removes_platformio_build_directory_only(tmp_path, monkeypatch):
    import app.services.builder as builder

    jobs_dir = tmp_path / "jobs"
    monkeypatch.setattr(builder, "JOBS_DIR", str(jobs_dir))

    job_id = str(uuid.uuid4())
    build_root = jobs_dir / job_id / ".pio" / "build"
    build_dir = build_root / "esp32dev"
    build_dir.mkdir(parents=True)
    (build_dir / "firmware.bin").write_bytes(b"firmware")

    workspace_file = jobs_dir / job_id / "platformio.ini"
    workspace_file.write_text("[env:esp32dev]\nboard = esp32dev\n")

    assert builder.cleanup_job_build_outputs(job_id) is True
    assert not build_root.exists()
    assert workspace_file.exists()


def test_resolve_build_artifact_path_keeps_firmware_and_part_paths_separate(tmp_path):
    from app.services.builder import get_durable_artifact_path

    job_id = str(uuid.uuid4())
    firmware_path = tmp_path / f"{job_id}.bin"
    firmware_path.write_bytes(b"firmware")

    bootloader_path = Path(get_durable_artifact_path(job_id, "bootloader"))
    partitions_path = Path(get_durable_artifact_path(job_id, "partitions"))
    boot_app0_path = Path(get_durable_artifact_path(job_id, "boot_app0"))
    for path, contents in (
        (bootloader_path, b"bootloader"),
        (partitions_path, b"partitions"),
        (boot_app0_path, b"boot_app0"),
    ):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(contents)

    job = BuildJob(id=job_id, artifact_path=str(firmware_path))

    assert _resolve_build_artifact_path(job, "firmware") == str(firmware_path)
    assert _resolve_build_artifact_path(job, "bootloader") == str(bootloader_path)
    assert _resolve_build_artifact_path(job, "partitions") == str(partitions_path)
    assert _resolve_build_artifact_path(job, "boot_app0") == str(boot_app0_path)



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
        PRIVATE_DEVICE_SECRET_KEY: "persisted-secret",
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
    assert '{ 2, "PWM", "pwm", "PWM Dimmer", 1, 20, 200, "", "", "", "", "switch", "momentary", "" }' in content, f"Missing PWM pin in: {content}"
    
    # Second pin config: I2C pin with SDA role, address 0x3C, library Wire
    assert '{ 4, "I2C", "i2c", "I2C Sensor", 1, 0, 255, "SDA", "0x3C", "Wire", "", "switch", "momentary", "" }' in content, f"Missing I2C pin in: {content}"
    assert '#define MQTT_BROKER "192.168.1.50"' in content
    assert '#define API_BASE_URL "http://192.168.1.50:3000/api/v1"' in content
    assert '#define ECONNECT_SECRET_KEY "persisted-secret"' in content


def test_firmware_revision_parser_reads_define(tmp_path):
    from app.services.firmware_template_repo import _read_firmware_revision

    template_dir = tmp_path / "firmware-template"
    (template_dir / "include").mkdir(parents=True, exist_ok=True)
    (template_dir / "include" / "firmware_revision.h").write_text(
        "\n".join(
            [
                "/* test firmware revision */",
                "#pragma once",
                '#define ECONNECT_FIRMWARE_REVISION "1.1.4"',
                "",
            ]
        ),
        encoding="utf-8",
    )

    assert _read_firmware_revision(template_dir) == "1.1.4"


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
    assert '{ 5, "PWM", "pwm", "Active Low PWM", 1, 255, 0, "", "", "", "", "switch", "momentary", "" }' in content


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

def test_create_project_invalid_board_profile():
    db = TestingSessionLocal()
    user, room = create_test_user(db, username="invalidboarduser")
    token = get_token("invalidboarduser")
    payload = {
        "name": "Invalid Board Project",
        "board_profile": "non-existent-board",
        "room_id": room.room_id,
        "wifi_credential_id": 1,
        "config": {"pins": []}
    }
    response = client.post("/api/v1/diy/projects", json=payload, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 400
    assert "Unsupported board profile" in response.json()["detail"]["message"]

def test_update_project_immutable_board_profile():
    db = TestingSessionLocal()
    user, room = create_test_user(db, username="immutableboarduser")
    token = get_token("immutableboarduser")
    
    # Create valid project first
    payload = {
        "name": "Mutable Project",
        "board_profile": "esp32-devkit-v1",
        "room_id": room.room_id,
        "config": {"pins": [], "wifi_ssid": "test", "wifi_password": "test"}
    }
    create_response = client.post("/api/v1/diy/projects", json=payload, headers={"Authorization": f"Bearer {token}"})
    assert create_response.status_code == 200
    project_id = create_response.json()["id"]

    # Try to update board profile
    update_payload = dict(payload)
    update_payload["board_profile"] = "esp8266-nodemcu-v2"
    
    update_response = client.put(f"/api/v1/diy/projects/{project_id}", json=update_payload, headers={"Authorization": f"Bearer {token}"})
    assert update_response.status_code == 400
    assert update_response.json()["detail"]["message"] == "Cannot change the board profile of an existing project."


def test_create_project_requires_explicit_project_name():
    db = TestingSessionLocal()
    _user, room = create_test_user(db, username="blankprojectname")
    token = get_token("blankprojectname")

    payload = {
        "name": "   ",
        "board_profile": "esp32-devkit-v1",
        "room_id": room.room_id,
        "config": {
            "pins": [],
            "wifi_ssid": "test",
            "wifi_password": "test",
        },
    }

    response = client.post("/api/v1/diy/projects", json=payload, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 400
    assert response.json()["detail"] == {
        "error": "validation",
        "message": "Enter a project name before creating a device project.",
    }


def test_update_project_requires_explicit_project_name():
    db = TestingSessionLocal()
    _user, room = create_test_user(db, username="blankupdateprojectname")
    token = get_token("blankupdateprojectname")

    payload = {
        "name": "Original Project",
        "board_profile": "esp32-devkit-v1",
        "room_id": room.room_id,
        "config": {
            "pins": [],
            "wifi_ssid": "test",
            "wifi_password": "test",
        },
    }
    create_response = client.post("/api/v1/diy/projects", json=payload, headers={"Authorization": f"Bearer {token}"})
    assert create_response.status_code == 200
    project_id = create_response.json()["id"]

    update_payload = {
        **payload,
        "name": "  ",
    }
    update_response = client.put(f"/api/v1/diy/projects/{project_id}", json=update_payload, headers={"Authorization": f"Bearer {token}"})
    assert update_response.status_code == 400
    assert update_response.json()["detail"] == {
        "error": "validation",
        "message": "Enter a project name before saving the device project.",
    }
