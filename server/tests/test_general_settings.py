# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

from __future__ import annotations

import json
import os
from datetime import datetime, timezone

import main
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import close_all_sessions, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import get_password_hash
from app import api as api_module
from app.database import Base, get_db
from app.sql_models import (
    AccountType,
    AuthStatus,
    ConnStatus,
    Device,
    DeviceHistory,
    DeviceMode,
    EventType,
    Automation,
    Household,
    HouseholdMembership,
    HouseholdRole,
    PinConfiguration,
    PinMode,
    Room,
    SystemLog,
    User,
)


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


def setup_function():
    os.environ.pop("E_CONNECT_TZ_ENV_FALLBACK", None)
    close_all_sessions()
    main.app.dependency_overrides[get_db] = override_get_db
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def teardown_function():
    os.environ.pop("E_CONNECT_TZ_ENV_FALLBACK", None)
    main.app.dependency_overrides.clear()
    main.app.state.server_started_at = None
    main.app.state.server_timezone = None
    main.app.state.server_timezone_source = None
    Base.metadata.drop_all(bind=engine)
    close_all_sessions()


def create_admin_user(*, username: str = "timezone-admin", household_timezone: str | None = None) -> tuple[User, Household]:
    db = TestingSessionLocal()
    try:
        user = User(
            username=username,
            fullname="Timezone Admin",
            authentication=get_password_hash("password"),
            account_type=AccountType.admin,
        )
        household = Household(name="Timezone Household", timezone=household_timezone)
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
        return user, household
    finally:
        db.close()


def get_token(client: TestClient, username: str = "timezone-admin") -> str:
    response = client.post(
        "/api/v1/auth/token",
        data={"username": username, "password": "password"},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def create_temperature_source_device(
    *,
    username: str = "timezone-admin",
    device_id: str = "house-temp-node",
    room_name: str = "Living Room",
    sensor_label: str = "Indoor Climate",
    temperature: float = 28.6,
    humidity: float = 63.2,
) -> Device:
    db = TestingSessionLocal()
    try:
        user = db.query(User).filter(User.username == username).one()
        household = db.query(Household).one()
        room = Room(name=room_name, user_id=user.user_id, household_id=household.household_id)
        db.add(room)
        db.commit()
        db.refresh(room)

        device = Device(
            device_id=device_id,
            mac_address="AA:BB:CC:DD:EE:FF",
            name="Living Room Climate Board",
            room_id=room.room_id,
            owner_id=user.user_id,
            auth_status=AuthStatus.approved,
            conn_status=ConnStatus.online,
            mode=DeviceMode.library,
            firmware_version="1.0.0",
            topic_pub="devices/house-temp-node/pub",
            topic_sub="devices/house-temp-node/sub",
            last_seen=datetime(2026, 4, 22, 5, 0, tzinfo=timezone.utc).replace(tzinfo=None),
        )
        db.add(device)
        db.commit()
        db.refresh(device)

        db.add(
            PinConfiguration(
                device_id=device.device_id,
                gpio_pin=4,
                mode=PinMode.INPUT,
                label=sensor_label,
                extra_params={"input_type": "dht", "dht_version": "DHT22"},
            )
        )
        db.add(
            DeviceHistory(
                device_id=device.device_id,
                event_type=EventType.state_change,
                payload=json.dumps(
                    {
                        "reported_at": "2026-04-22T05:00:00Z",
                        "pins": [
                            {
                                "pin": 4,
                                "temperature": temperature,
                                "humidity": humidity,
                            }
                        ],
                    }
                ),
            )
        )
        db.commit()
        db.refresh(device)
        return device
    finally:
        db.close()


def test_general_settings_surfaces_env_timezone_as_current_runtime_timezone(monkeypatch):
    monkeypatch.setenv("TZ", "Europe/Paris")
    create_admin_user()

    with TestClient(main.app) as client:
        token = get_token(client)
        response = client.get(
            "/api/v1/settings/general",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["configured_timezone"] is None
    assert payload["effective_timezone"] == "Europe/Paris"
    assert payload["timezone_source"] == "runtime"
    assert "env_timezone" not in payload
    assert "Asia/Ho_Chi_Minh" in payload["timezone_options"]
    assert main.app.state.server_timezone == "Europe/Paris"


def test_general_settings_uses_app_default_when_no_override_or_env(monkeypatch):
    monkeypatch.delenv("TZ", raising=False)
    create_admin_user()

    with TestClient(main.app) as client:
        token = get_token(client)
        response = client.get(
            "/api/v1/settings/general",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["configured_timezone"] is None
    assert payload["effective_timezone"] == "Asia/Ho_Chi_Minh"
    assert payload["timezone_source"] == "runtime"
    assert "env_timezone" not in payload


def test_update_general_settings_persists_override_and_beats_env(monkeypatch):
    monkeypatch.setenv("TZ", "Europe/Paris")
    create_admin_user()

    with TestClient(main.app) as client:
        token = get_token(client)
        response = client.put(
            "/api/v1/settings/general",
            headers={"Authorization": f"Bearer {token}"},
            json={"timezone": "Asia/Tokyo"},
        )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["configured_timezone"] == "Asia/Tokyo"
    assert payload["effective_timezone"] == "Asia/Tokyo"
    assert payload["timezone_source"] == "setting"
    assert "env_timezone" not in payload
    assert os.environ["TZ"] == "Asia/Tokyo"
    assert main.app.state.server_timezone == "Asia/Tokyo"
    assert main.app.state.server_timezone_source == "setting"

    db = TestingSessionLocal()
    try:
        household = db.query(Household).first()
        assert household is not None
        assert household.timezone == "Asia/Tokyo"

        latest_log = db.query(SystemLog).order_by(SystemLog.id.desc()).first()
        assert latest_log is not None
        assert latest_log.event_code == "server_timezone_updated"
        assert latest_log.details["effective_timezone"] == "Asia/Tokyo"
    finally:
        db.close()


def test_update_general_settings_persists_house_temperature_source(monkeypatch):
    monkeypatch.setenv("TZ", "Asia/Ho_Chi_Minh")
    create_admin_user()
    source_device = create_temperature_source_device()

    with TestClient(main.app) as client:
        token = get_token(client)
        response = client.put(
            "/api/v1/settings/general",
            headers={"Authorization": f"Bearer {token}"},
            json={"house_temperature_device_id": source_device.device_id},
        )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["house_temperature_device_id"] == source_device.device_id
    assert payload["house_temperature_device_name"] == "Living Room Climate Board"
    assert payload["effective_timezone"] == "Asia/Ho_Chi_Minh"

    db = TestingSessionLocal()
    try:
        household = db.query(Household).first()
        assert household is not None
        assert household.house_temperature_device_id == source_device.device_id

        latest_log = db.query(SystemLog).order_by(SystemLog.id.desc()).first()
        assert latest_log is not None
        assert latest_log.event_code == "house_temperature_source_updated"
        assert latest_log.details["device_id"] == source_device.device_id
    finally:
        db.close()


def test_house_temperature_endpoint_returns_selected_device_reading(monkeypatch):
    monkeypatch.setenv("TZ", "Asia/Ho_Chi_Minh")
    create_admin_user()
    db = TestingSessionLocal()
    try:
        household_id = db.query(Household.household_id).scalar()
    finally:
        db.close()
    source_device = create_temperature_source_device(temperature=29.4, humidity=58.1)

    db = TestingSessionLocal()
    try:
        stored_household = db.query(Household).filter(Household.household_id == household_id).one()
        stored_household.house_temperature_device_id = source_device.device_id
        db.add(stored_household)
        db.commit()
    finally:
        db.close()

    with TestClient(main.app) as client:
        token = get_token(client)
        response = client.get(
            "/api/v1/house-temperature/current",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["device_id"] == source_device.device_id
    assert payload["device_name"] == "Living Room Climate Board"
    assert payload["room_name"] == "Living Room"
    assert payload["source_label"] == "Indoor Climate"
    assert payload["temperature"] == pytest.approx(29.4)
    assert payload["humidity"] == pytest.approx(58.1)
    assert payload["status"] == "ok"
    assert payload["is_online"] is True


def test_update_general_settings_reschedules_time_trigger_automations(monkeypatch):
    monkeypatch.setenv("TZ", "Asia/Ho_Chi_Minh")
    create_admin_user(household_timezone="Asia/Ho_Chi_Minh")

    db = TestingSessionLocal()
    try:
        user = db.query(User).filter(User.username == "timezone-admin").one()
        household = db.query(Household).one()
        user_id = user.user_id
        household_id = household.household_id
    finally:
        db.close()

    db = TestingSessionLocal()
    try:
        db.add(
            Automation(
                creator_id=user_id,
                name="Morning Schedule",
                script_code=json.dumps(
                    {
                        "nodes": [
                            {
                                "id": "trigger-1",
                                "type": "trigger",
                                "kind": "time_schedule",
                                "config": {"hour": 7, "minute": 30, "weekdays": []},
                            },
                            {
                                "id": "action-1",
                                "type": "action",
                                "kind": "set_output",
                                "config": {"device_id": "relay-1", "pin": 12, "value": 1},
                            },
                        ],
                        "edges": [
                            {
                                "source_node_id": "trigger-1",
                                "source_port": "event_out",
                                "target_node_id": "action-1",
                                "target_port": "event_in",
                            }
                        ],
                    }
                ),
                is_enabled=True,
                schedule_type="time",
                timezone="Asia/Ho_Chi_Minh",
                schedule_hour=7,
                schedule_minute=30,
                schedule_weekdays=[],
                next_run_at=datetime(2026, 4, 2, 0, 30),
            )
        )
        db.commit()
    finally:
        db.close()

    fixed_now = datetime(2026, 4, 2, 0, 0, tzinfo=timezone.utc)

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            if tz is None:
                return fixed_now.replace(tzinfo=None)
            return fixed_now.astimezone(tz)

    monkeypatch.setattr(api_module, "datetime", FixedDateTime)

    with TestClient(main.app) as client:
        token = get_token(client)
        response = client.put(
            "/api/v1/settings/general",
            headers={"Authorization": f"Bearer {token}"},
            json={"timezone": "Asia/Tokyo"},
        )

    assert response.status_code == 200, response.text
    assert response.json()["effective_timezone"] == "Asia/Tokyo"

    db = TestingSessionLocal()
    try:
        refreshed_household = db.query(Household).filter(Household.household_id == household_id).first()
        assert refreshed_household is not None
        assert refreshed_household.timezone == "Asia/Tokyo"

        automation = db.query(Automation).filter(Automation.creator_id == user_id).one()
        assert automation.timezone == "Asia/Tokyo"
        assert automation.next_run_at == datetime(2026, 4, 2, 22, 30)
    finally:
        db.close()


def test_clearing_general_settings_override_falls_back_to_current_runtime_timezone(monkeypatch):
    monkeypatch.setenv("TZ", "Europe/Paris")
    create_admin_user(household_timezone="Asia/Tokyo")

    with TestClient(main.app) as client:
        token = get_token(client)
        response = client.put(
            "/api/v1/settings/general",
            headers={"Authorization": f"Bearer {token}"},
            json={"timezone": None},
        )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["configured_timezone"] is None
    assert payload["effective_timezone"] == "Europe/Paris"
    assert payload["timezone_source"] == "runtime"
    assert "env_timezone" not in payload
    assert os.environ["TZ"] == "Europe/Paris"

    db = TestingSessionLocal()
    try:
        household = db.query(Household).first()
        assert household is not None
        assert household.timezone is None
    finally:
        db.close()


def test_update_general_settings_rejects_unknown_timezone(monkeypatch):
    monkeypatch.setenv("TZ", "Asia/Ho_Chi_Minh")
    create_admin_user()

    with TestClient(main.app) as client:
        token = get_token(client)
        response = client.put(
            "/api/v1/settings/general",
            headers={"Authorization": f"Bearer {token}"},
            json={"timezone": "Mars/Olympus_Mons"},
        )

    assert response.status_code == 400, response.text
    payload = response.json()
    assert payload["detail"]["error"] == "validation"
    assert "valid IANA timezone" in payload["detail"]["message"]
