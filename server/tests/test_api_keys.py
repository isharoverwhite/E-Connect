# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

import hashlib

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

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
    User,
)
from main import app


SQLALCHEMY_DATABASE_URL = "sqlite://"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)


def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db
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


def _api_key_headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}"}


def _seed_household(prefix: str = "api-key"):
    db = TestingSessionLocal()
    household = Household(name=f"{prefix.title()} House")
    admin = User(
        fullname="Admin User",
        username=f"admin-{prefix}",
        authentication="hashed-pass",
        account_type=AccountType.admin,
        ui_layout={},
    )
    member = User(
        fullname="Member User",
        username=f"member-{prefix}",
        authentication="hashed-pass",
        account_type=AccountType.parent,
        ui_layout={},
    )
    db.add_all([household, admin, member])
    db.commit()
    db.refresh(household)
    db.refresh(admin)
    db.refresh(member)

    db.add_all(
        [
            HouseholdMembership(household_id=household.household_id, user_id=admin.user_id, role=HouseholdRole.owner),
            HouseholdMembership(household_id=household.household_id, user_id=member.user_id, role=HouseholdRole.member),
        ]
    )
    db.commit()
    payload = (
        {"household_id": household.household_id},
        {"user_id": admin.user_id, "username": admin.username, "account_type": admin.account_type.value},
        {"user_id": member.user_id, "username": member.username, "account_type": member.account_type.value},
    )
    db.close()
    return payload


def _insert_device(*, device_id: str, name: str, room_id: int, owner_id: int):
    db = TestingSessionLocal()
    mac_suffix = hashlib.md5(device_id.encode("utf-8")).hexdigest()[:6].upper()
    device = Device(
        device_id=device_id,
        mac_address=f"AA:CC:EE:{mac_suffix[:2]}:{mac_suffix[2:4]}:{mac_suffix[4:6]}",
        name=name,
        room_id=room_id,
        owner_id=owner_id,
        auth_status=AuthStatus.approved,
        conn_status=ConnStatus.online,
    )
    db.add(device)
    db.commit()
    db.close()


def _create_room(headers: dict[str, str], *, name: str, allowed_user_ids: list[int] | None = None) -> dict:
    response = client.post(
        "/api/v1/rooms",
        headers=headers,
        json={"name": name, "allowed_user_ids": allowed_user_ids or []},
    )
    assert response.status_code == 200, response.text
    return response.json()


def setup_function():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def test_user_can_create_multiple_api_keys_and_revoke_one_independently():
    household, _admin, member = _seed_household(prefix="multi")
    member_headers = _auth_headers(
        member["username"],
        account_type=member["account_type"],
        household_id=household["household_id"],
        household_role=HouseholdRole.member.value,
    )

    first_response = client.post(
        "/api/v1/api-keys",
        headers=member_headers,
        json={"label": "Raycast desktop"},
    )
    assert first_response.status_code == 200, first_response.text
    first_key = first_response.json()
    assert first_key["api_key"].startswith("eak_")
    assert first_key["is_revoked"] is False

    second_response = client.post(
        "/api/v1/api-keys",
        headers=member_headers,
        json={"label": "Shortcut on iPhone"},
    )
    assert second_response.status_code == 200, second_response.text
    second_key = second_response.json()
    assert second_key["api_key"].startswith("eak_")
    assert second_key["key_id"] != first_key["key_id"]

    list_response = client.get("/api/v1/api-keys", headers=member_headers)
    assert list_response.status_code == 200, list_response.text
    listed = list_response.json()
    assert {entry["label"] for entry in listed} == {"Shortcut on iPhone", "Raycast desktop"}
    assert all("api_key" not in entry for entry in listed)

    profile_response = client.get("/api/v1/users/me", headers=_api_key_headers(first_key["api_key"]))
    assert profile_response.status_code == 200, profile_response.text
    assert profile_response.json()["username"] == member["username"]

    refreshed_list = client.get("/api/v1/api-keys", headers=member_headers)
    assert refreshed_list.status_code == 200, refreshed_list.text
    keyed_entries = {entry["key_id"]: entry for entry in refreshed_list.json()}
    assert keyed_entries[first_key["key_id"]]["last_used_at"] is not None
    assert keyed_entries[second_key["key_id"]]["last_used_at"] is None

    revoke_response = client.post(
        f"/api/v1/api-keys/{first_key['key_id']}/revoke",
        headers=member_headers,
    )
    assert revoke_response.status_code == 200, revoke_response.text
    assert revoke_response.json()["is_revoked"] is True

    revoked_profile_response = client.get("/api/v1/users/me", headers=_api_key_headers(first_key["api_key"]))
    assert revoked_profile_response.status_code == 401

    second_profile_response = client.get("/api/v1/users/me", headers=_api_key_headers(second_key["api_key"]))
    assert second_profile_response.status_code == 200, second_profile_response.text
    assert second_profile_response.json()["username"] == member["username"]


def test_member_api_key_inherits_room_and_device_permissions():
    household, admin, member = _seed_household(prefix="scope")
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

    _insert_device(
        device_id="device-living-api",
        name="Living Relay",
        room_id=living_room["room_id"],
        owner_id=admin["user_id"],
    )
    _insert_device(
        device_id="device-office-api",
        name="Office Relay",
        room_id=office_room["room_id"],
        owner_id=admin["user_id"],
    )

    create_key_response = client.post(
        "/api/v1/api-keys",
        headers=member_headers,
        json={"label": "Raycast member scope"},
    )
    assert create_key_response.status_code == 200, create_key_response.text
    api_key = create_key_response.json()["api_key"]
    api_headers = _api_key_headers(api_key)

    devices_response = client.get("/api/v1/devices", headers=api_headers)
    assert devices_response.status_code == 200, devices_response.text
    assert [device["device_id"] for device in devices_response.json()] == ["device-living-api"]
    assert "mac_address" not in devices_response.json()[0]

    allowed_command = client.post(
        "/api/v1/device/device-living-api/command",
        headers=api_headers,
        json={"power": True},
    )
    assert allowed_command.status_code == 200, allowed_command.text
    assert allowed_command.json()["status"] in {"pending", "failed"}

    forbidden_command = client.post(
        "/api/v1/device/device-office-api/command",
        headers=api_headers,
        json={"power": True},
    )
    assert forbidden_command.status_code == 403
