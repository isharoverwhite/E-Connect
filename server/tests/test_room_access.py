import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.auth import create_access_token
from app.database import Base, get_db
from app.sql_models import (
    AccountType,
    AuthStatus,
    ConnStatus,
    Device,
    Household,
    HouseholdMembership,
    HouseholdRole,
    RoomPermission,
    User,
    UserApprovalStatus,
)
from main import app


SQLALCHEMY_DATABASE_URL = "sqlite:///./test_room_access.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)


def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


client = TestClient(app)


def _issue_token(username: str, *, account_type: str, household_id: int, household_role: str) -> str:
    return create_access_token(
        {
            "sub": username,
            "account_type": account_type,
            "household_id": household_id,
            "household_role": household_role,
        }
    )


def _auth_headers(username: str, *, account_type: str, household_id: int, household_role: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {_issue_token(username, account_type=account_type, household_id=household_id, household_role=household_role)}"
    }


def _seed_household():
    db = TestingSessionLocal()
    household = Household(name="Room Access House")
    admin = User(
        fullname="Admin User",
        username="admin-room",
        authentication="hashed-pass",
        account_type=AccountType.admin,
        approval_status=UserApprovalStatus.approved,
        ui_layout={},
    )
    member = User(
        fullname="Member User",
        username="member-room",
        authentication="hashed-pass",
        account_type=AccountType.parent,
        approval_status=UserApprovalStatus.approved,
        ui_layout={},
    )
    observer = User(
        fullname="Observer User",
        username="observer-room",
        authentication="hashed-pass",
        account_type=AccountType.parent,
        approval_status=UserApprovalStatus.approved,
        ui_layout={},
    )
    db.add_all([household, admin, member, observer])
    db.commit()
    db.refresh(household)
    db.refresh(admin)
    db.refresh(member)
    db.refresh(observer)

    db.add_all(
        [
            HouseholdMembership(household_id=household.household_id, user_id=admin.user_id, role=HouseholdRole.owner),
            HouseholdMembership(household_id=household.household_id, user_id=member.user_id, role=HouseholdRole.member),
            HouseholdMembership(household_id=household.household_id, user_id=observer.user_id, role=HouseholdRole.member),
        ]
    )
    db.commit()
    payload = (
        {"household_id": household.household_id},
        {"user_id": admin.user_id, "username": admin.username, "account_type": admin.account_type.value},
        {"user_id": member.user_id, "username": member.username, "account_type": member.account_type.value},
        {"user_id": observer.user_id, "username": observer.username, "account_type": observer.account_type.value},
    )
    db.close()

    return payload


def _insert_device(*, device_id: str, name: str, room_id: int, owner_id: int):
    db = TestingSessionLocal()
    device = Device(
        device_id=device_id,
        mac_address=f"AA:BB:CC:{device_id[-2:]}:{device_id[-2:]}:{device_id[-2:]}",
        name=name,
        room_id=room_id,
        owner_id=owner_id,
        auth_status=AuthStatus.approved,
        conn_status=ConnStatus.online,
    )
    db.add(device)
    db.commit()
    db.close()


def _room_permission_ids(room_id: int) -> set[int]:
    db = TestingSessionLocal()
    permissions = db.query(RoomPermission).filter(RoomPermission.room_id == room_id).all()
    permission_ids = {permission.user_id for permission in permissions}
    db.close()
    return permission_ids


def _create_room(headers: dict[str, str], *, name: str, allowed_user_ids: list[int] | None = None) -> dict:
    response = client.post(
        "/api/v1/rooms",
        headers=headers,
        json={"name": name, "allowed_user_ids": allowed_user_ids or []},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _create_project(headers: dict[str, str], *, room_id: int) -> None:
    response = client.post(
        "/api/v1/diy/projects",
        headers=headers,
        json={
            "name": "Unauthorized Project",
            "board_profile": "dfrobot-beetle-esp32-c3",
            "room_id": room_id,
            "config": {
                "wifi_ssid": "Builder-WiFi",
                "wifi_password": "BuilderPass123",
                "pins": [{"gpio": 2, "mode": "OUTPUT", "function": "relay"}],
            },
        },
    )
    return response


def _approve_device_response(headers: dict[str, str], *, device_id: str, room_id: int):
    return client.post(
        f"/api/v1/device/{device_id}/approve",
        headers=headers,
        json={"room_id": room_id},
    )


@pytest.fixture(autouse=True)
def reset_state():
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    app.dependency_overrides.clear()


def test_room_access_filters_devices_and_commands(monkeypatch):
    monkeypatch.setattr("app.api.mqtt_manager.publish_command", lambda *_args, **_kwargs: True)

    household, admin, member, observer = _seed_household()
    admin_headers = _auth_headers(
        admin["username"],
        account_type=admin["account_type"],
        household_id=household["household_id"],
        household_role=HouseholdRole.owner.value,
    )
    member_headers = _auth_headers(
        member["username"],
        account_type=member["account_type"],
        household_id=household["household_id"],
        household_role=HouseholdRole.member.value,
    )

    living_room = _create_room(admin_headers, name="Living Room", allowed_user_ids=[member["user_id"]])
    office_room = _create_room(admin_headers, name="Office")

    assert _room_permission_ids(living_room["room_id"]) == {admin["user_id"], member["user_id"]}
    assert _room_permission_ids(office_room["room_id"]) == {admin["user_id"]}

    _insert_device(device_id="device-living", name="Living Relay", room_id=living_room["room_id"], owner_id=admin["user_id"])
    _insert_device(device_id="device-office", name="Office Relay", room_id=office_room["room_id"], owner_id=admin["user_id"])

    rooms_response = client.get("/api/v1/rooms", headers=member_headers)
    assert rooms_response.status_code == 200
    assert [room["name"] for room in rooms_response.json()] == ["Living Room"]

    devices_response = client.get("/api/v1/devices", headers=member_headers)
    assert devices_response.status_code == 200
    assert [device["device_id"] for device in devices_response.json()] == ["device-living"]
    assert "mac_address" not in devices_response.json()[0]
    assert "pin_configurations" not in devices_response.json()[0]

    dashboard_devices_response = client.get("/api/v1/dashboard/devices", headers=member_headers)
    assert dashboard_devices_response.status_code == 200
    assert dashboard_devices_response.json()[0]["device_id"] == "device-living"
    assert dashboard_devices_response.json()[0]["mac_address"].startswith("AA:BB:CC:")

    command_response = client.post(
        "/api/v1/device/device-living/command",
        headers=member_headers,
        json={"power": True},
    )
    assert command_response.status_code == 200
    assert command_response.json()["status"] == "sent"

    forbidden_command = client.post(
        "/api/v1/device/device-office/command",
        headers=member_headers,
        json={"power": True},
    )
    assert forbidden_command.status_code == 403

    pending_response = client.get("/api/v1/devices?auth_status=pending", headers=member_headers)
    assert pending_response.status_code == 403

    observer_headers = _auth_headers(
        observer["username"],
        account_type=observer["account_type"],
        household_id=household["household_id"],
        household_role=HouseholdRole.member.value,
    )
    observer_devices = client.get("/api/v1/devices", headers=observer_headers)
    assert observer_devices.status_code == 200
    assert observer_devices.json() == []


def test_non_admin_cannot_create_project_delete_device_or_pair():
    household, admin, member, _observer = _seed_household()
    admin_headers = _auth_headers(
        admin["username"],
        account_type=admin["account_type"],
        household_id=household["household_id"],
        household_role=HouseholdRole.owner.value,
    )
    member_headers = _auth_headers(
        member["username"],
        account_type=member["account_type"],
        household_id=household["household_id"],
        household_role=HouseholdRole.member.value,
    )

    room = _create_room(admin_headers, name="Kitchen")
    _insert_device(device_id="device-kitchen", name="Kitchen Relay", room_id=room["room_id"], owner_id=admin["user_id"])

    project_response = _create_project(member_headers, room_id=room["room_id"])
    assert project_response.status_code == 403

    delete_response = client.delete("/api/v1/device/device-kitchen", headers=member_headers)
    assert delete_response.status_code == 403

    pair_response = _approve_device_response(
        member_headers,
        device_id="device-kitchen",
        room_id=room["room_id"],
    )
    assert pair_response.status_code == 403
