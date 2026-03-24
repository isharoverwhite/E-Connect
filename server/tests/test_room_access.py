import uuid
from datetime import datetime
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.auth import create_access_token
from app.database import Base, get_db
from app.services.provisioning import build_project_firmware_identity
from app.sql_models import (
    AccountType,
    AuthStatus,
    BuildJob,
    ConnStatus,
    Device,
    DiyProject,
    Household,
    HouseholdMembership,
    HouseholdRole,
    JobStatus,
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


def _seed_household(prefix: str = "room"):
    db = TestingSessionLocal()
    household = Household(name=f"{prefix.title()} Access House")
    admin = User(
        fullname="Admin User",
        username=f"admin-{prefix}",
        authentication="hashed-pass",
        account_type=AccountType.admin,
        approval_status=UserApprovalStatus.approved,
        ui_layout={},
    )
    member = User(
        fullname="Member User",
        username=f"member-{prefix}",
        authentication="hashed-pass",
        account_type=AccountType.parent,
        approval_status=UserApprovalStatus.approved,
        ui_layout={},
    )
    observer = User(
        fullname="Observer User",
        username=f"observer-{prefix}",
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


def _insert_household_admin(*, household_id: int, prefix: str) -> dict[str, object]:
    db = TestingSessionLocal()
    admin = User(
        fullname=f"{prefix.title()} Admin",
        username=f"{prefix}-admin",
        authentication="hashed-pass",
        account_type=AccountType.admin,
        approval_status=UserApprovalStatus.approved,
        ui_layout={},
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    db.add(
        HouseholdMembership(
            household_id=household_id,
            user_id=admin.user_id,
            role=HouseholdRole.admin,
        )
    )
    db.commit()
    payload = {
        "user_id": admin.user_id,
        "username": admin.username,
        "account_type": admin.account_type.value,
    }
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


def _insert_diy_project(*, user_id: int, room_id: int) -> dict[str, str]:
    db = TestingSessionLocal()
    project_id = str(uuid.uuid4())
    project = DiyProject(
        id=project_id,
        user_id=user_id,
        room_id=room_id,
        name="Recovery Project",
        board_profile="esp32-devkit-v1",
        config={"pins": []},
    )
    db.add(project)
    db.commit()
    db.close()
    device_id, secret_key = build_project_firmware_identity(project_id)
    return {"project_id": project_id, "device_id": device_id, "secret_key": secret_key}


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
    assert command_response.json()["status"] == "pending"
    assert "command_id" in command_response.json()

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


def test_unpair_stays_hidden_until_board_requests_pairing_again():
    household, admin, _member, _observer = _seed_household()
    admin_headers = _auth_headers(
        admin["username"],
        account_type=admin["account_type"],
        household_id=household["household_id"],
        household_role=HouseholdRole.owner.value,
    )

    room = _create_room(admin_headers, name="Workshop")
    project = _insert_diy_project(user_id=admin["user_id"], room_id=room["room_id"])

    handshake_payload = {
        "device_id": project["device_id"],
        "project_id": project["project_id"],
        "secret_key": project["secret_key"],
        "mac_address": "AA:BB:CC:11:22:33",
        "name": "Workshop Controller",
        "mode": "no-code",
        "firmware_version": "build-12345678",
        "pins": [],
    }

    first_handshake = client.post("/api/v1/config", json=handshake_payload)
    assert first_handshake.status_code == 200, first_handshake.text
    assert first_handshake.json()["auth_status"] == "approved"

    delete_response = client.delete(
        f"/api/v1/device/{project['device_id']}",
        headers=admin_headers,
    )
    assert delete_response.status_code == 200, delete_response.text

    pending_after_unpair = client.get(
        "/api/v1/devices?auth_status=pending",
        headers=admin_headers,
    )
    assert pending_after_unpair.status_code == 200
    assert pending_after_unpair.json() == []

    second_handshake = client.post("/api/v1/config", json=handshake_payload)
    assert second_handshake.status_code == 200, second_handshake.text
    assert second_handshake.json()["auth_status"] == "pending"
    assert second_handshake.json()["pairing_requested_at"] is not None

    pending_after_retry = client.get(
        "/api/v1/devices?auth_status=pending",
        headers=admin_headers,
    )
    assert pending_after_retry.status_code == 200
    pending_devices = pending_after_retry.json()
    assert len(pending_devices) == 1
    assert pending_devices[0]["device_id"] == project["device_id"]
    assert pending_devices[0]["pairing_requested_at"] is not None


def test_approve_device_broadcasts_pairing_queue_refresh(monkeypatch):
    household, admin, _member, _observer = _seed_household(prefix="approvews")
    admin_headers = _auth_headers(
        admin["username"],
        account_type=admin["account_type"],
        household_id=household["household_id"],
        household_role=HouseholdRole.owner.value,
    )

    room = _create_room(admin_headers, name="Approve Lab")
    device_id = str(uuid.uuid4())
    db = TestingSessionLocal()
    device = Device(
        device_id=device_id,
        mac_address="AA:BB:CC:DD:EE:22",
        name="Approve Board",
        room_id=None,
        owner_id=admin["user_id"],
        auth_status=AuthStatus.pending,
        conn_status=ConnStatus.online,
        pairing_requested_at=datetime.utcnow(),
    )
    db.add(device)
    db.commit()
    db.close()

    ws_mock = Mock()
    monkeypatch.setattr("app.api.ws_manager.broadcast_device_event_sync", ws_mock)

    approve_response = _approve_device_response(
        admin_headers,
        device_id=device_id,
        room_id=room["room_id"],
    )
    assert approve_response.status_code == 200, approve_response.text
    assert approve_response.json()["status"] == "approved"

    db = TestingSessionLocal()
    approved_device = db.query(Device).filter(Device.device_id == device_id).first()
    assert approved_device is not None
    db.refresh(approved_device)
    assert approved_device.auth_status == AuthStatus.approved
    assert approved_device.pairing_requested_at is None
    assert approved_device.room_id == room["room_id"]
    db.close()

    ws_mock.assert_called_once()
    event_type, ws_device_id, ws_room_id, payload = ws_mock.call_args.args
    assert event_type == "pairing_queue_updated"
    assert ws_device_id == device_id
    assert ws_room_id is None
    assert payload["reason"] == "approved"
    assert payload["auth_status"] == "approved"
    assert payload["pairing_requested_at"] is None


def test_reject_device_forwards_rejection_and_hides_pending_device(monkeypatch):
    household, admin, _member, _observer = _seed_household()
    admin_headers = _auth_headers(
        admin["username"],
        account_type=admin["account_type"],
        household_id=household["household_id"],
        household_role=HouseholdRole.owner.value,
    )

    room = _create_room(admin_headers, name="Reject Lab")
    device_id = str(uuid.uuid4())
    db = TestingSessionLocal()
    device = Device(
        device_id=device_id,
        mac_address="AA:BB:CC:DD:EE:11",
        name="Rejected Board",
        room_id=room["room_id"],
        owner_id=admin["user_id"],
        auth_status=AuthStatus.pending,
        conn_status=ConnStatus.online,
        pairing_requested_at=datetime.utcnow(),
    )
    db.add(device)
    db.commit()
    db.close()

    publish_mock = Mock(return_value=True)
    ws_mock = Mock()
    monkeypatch.setattr("app.api.mqtt_manager.publish_json", publish_mock)
    monkeypatch.setattr("app.api.ws_manager.broadcast_device_event_sync", ws_mock)

    reject_response = client.post(
        f"/api/v1/device/{device_id}/reject",
        headers=admin_headers,
    )
    assert reject_response.status_code == 200, reject_response.text
    assert reject_response.json()["status"] == "rejected"

    db = TestingSessionLocal()
    rejected_device = db.query(Device).filter(Device.device_id == device_id).first()
    assert rejected_device is not None
    db.refresh(rejected_device)
    assert rejected_device.auth_status == AuthStatus.rejected
    assert rejected_device.pairing_requested_at is None
    db.close()

    pending_after_reject = client.get(
        "/api/v1/devices?auth_status=pending",
        headers=admin_headers,
    )
    assert pending_after_reject.status_code == 200
    assert pending_after_reject.json() == []

    publish_mock.assert_called_once()
    topic, payload = publish_mock.call_args.args[:2]
    assert topic.endswith("/state/ack")
    assert payload["status"] == "pairing_rejected"
    assert payload["reason"] == "admin_rejected"
    assert payload["auth_status"] == "rejected"

    ws_mock.assert_called_once()
    event_type, ws_device_id, ws_room_id, ws_payload = ws_mock.call_args.args
    assert event_type == "pairing_queue_updated"
    assert ws_device_id == device_id
    assert ws_room_id is None
    assert ws_payload["reason"] == "rejected"
    assert ws_payload["auth_status"] == "rejected"
    assert ws_payload["pairing_requested_at"] is None


def test_unpair_device_broadcasts_pairing_queue_refresh(monkeypatch):
    household, admin, _member, _observer = _seed_household(prefix="unpairws")
    admin_headers = _auth_headers(
        admin["username"],
        account_type=admin["account_type"],
        household_id=household["household_id"],
        household_role=HouseholdRole.owner.value,
    )

    room = _create_room(admin_headers, name="Unpair Lab")
    device_id = "device-unpair-ws"
    _insert_device(
        device_id=device_id,
        name="Unpair Board",
        room_id=room["room_id"],
        owner_id=admin["user_id"],
    )

    ws_mock = Mock()
    monkeypatch.setattr("app.api.ws_manager.broadcast_device_event_sync", ws_mock)

    delete_response = client.delete(
        f"/api/v1/device/{device_id}",
        headers=admin_headers,
    )
    assert delete_response.status_code == 200, delete_response.text
    assert delete_response.json()["status"] == "unpaired"

    db = TestingSessionLocal()
    unpaired_device = db.query(Device).filter(Device.device_id == device_id).first()
    assert unpaired_device is not None
    db.refresh(unpaired_device)
    assert unpaired_device.auth_status == AuthStatus.pending
    assert unpaired_device.pairing_requested_at is None
    db.close()

    ws_mock.assert_called_once()
    event_type, ws_device_id, ws_room_id, payload = ws_mock.call_args.args
    assert event_type == "pairing_queue_updated"
    assert ws_device_id == device_id
    assert ws_room_id is None
    assert payload["reason"] == "unpaired"
    assert payload["auth_status"] == "pending"
    assert payload["pairing_requested_at"] is None


def test_force_pairing_request_keeps_unknown_secure_device_pending():
    household, admin, _member, _observer = _seed_household()
    admin_headers = _auth_headers(
        admin["username"],
        account_type=admin["account_type"],
        household_id=household["household_id"],
        household_role=HouseholdRole.owner.value,
    )

    room = _create_room(admin_headers, name="Recovery Lab")
    project = _insert_diy_project(user_id=admin["user_id"], room_id=room["room_id"])

    handshake_payload = {
        "device_id": project["device_id"],
        "project_id": project["project_id"],
        "secret_key": project["secret_key"],
        "force_pairing_request": True,
        "mac_address": "AA:BB:CC:44:55:66",
        "name": "Recovered Board",
        "mode": "no-code",
        "firmware_version": "build-repair",
        "pins": [],
    }

    response = client.post("/api/v1/config", json=handshake_payload)
    assert response.status_code == 200, response.text
    assert response.json()["auth_status"] == "pending"
    assert response.json()["pairing_requested_at"] is not None

    pending_after_recovery = client.get(
        "/api/v1/devices?auth_status=pending",
        headers=admin_headers,
    )
    assert pending_after_recovery.status_code == 200
    pending_devices = pending_after_recovery.json()
    assert len(pending_devices) == 1
    assert pending_devices[0]["device_id"] == project["device_id"]


def test_same_household_admin_can_manage_project_and_build_job():
    household, admin, member, _observer = _seed_household()
    co_admin = _insert_household_admin(
        household_id=household["household_id"],
        prefix="coadmin",
    )
    admin_headers = _auth_headers(
        admin["username"],
        account_type=admin["account_type"],
        household_id=household["household_id"],
        household_role=HouseholdRole.owner.value,
    )
    co_admin_headers = _auth_headers(
        co_admin["username"],
        account_type=co_admin["account_type"],
        household_id=household["household_id"],
        household_role=HouseholdRole.admin.value,
    )

    room = _create_room(admin_headers, name="Builder Lab")
    project = _insert_diy_project(user_id=member["user_id"], room_id=room["room_id"])

    project_response = client.get(
        f"/api/v1/diy/projects/{project['project_id']}",
        headers=co_admin_headers,
    )
    assert project_response.status_code == 200, project_response.text
    assert project_response.json()["id"] == project["project_id"]

    update_response = client.put(
        f"/api/v1/diy/projects/{project['project_id']}",
        headers=co_admin_headers,
        json={
            "name": "Updated Recovery Project",
            "board_profile": "esp32-devkit-v1",
            "room_id": room["room_id"],
            "config": {"pins": []},
        },
    )
    assert update_response.status_code == 200, update_response.text
    assert update_response.json()["name"] == "Updated Recovery Project"

    db = TestingSessionLocal()
    job_id = str(uuid.uuid4())
    db.add(BuildJob(id=job_id, project_id=project["project_id"], status=JobStatus.queued))
    db.commit()
    db.close()

    job_response = client.get(
        f"/api/v1/diy/build/{job_id}",
        headers=co_admin_headers,
    )
    assert job_response.status_code == 200, job_response.text
    assert job_response.json()["project_id"] == project["project_id"]
    assert job_response.json()["ota_token"]


def test_foreign_household_admin_cannot_mutate_device_or_project():
    household, admin, _member, _observer = _seed_household()
    admin_headers = _auth_headers(
        admin["username"],
        account_type=admin["account_type"],
        household_id=household["household_id"],
        household_role=HouseholdRole.owner.value,
    )
    foreign_household, foreign_admin, _foreign_member, _foreign_observer = _seed_household(prefix="foreign")
    foreign_headers = _auth_headers(
        foreign_admin["username"],
        account_type=foreign_admin["account_type"],
        household_id=foreign_household["household_id"],
        household_role=HouseholdRole.owner.value,
    )

    room = _create_room(admin_headers, name="Scoped Lab")
    project = _insert_diy_project(user_id=admin["user_id"], room_id=room["room_id"])
    _insert_device(
        device_id=project["device_id"],
        name="Scoped Board",
        room_id=room["room_id"],
        owner_id=admin["user_id"],
    )

    db = TestingSessionLocal()
    device = db.query(Device).filter(Device.device_id == project["device_id"]).first()
    assert device is not None
    device.provisioning_project_id = project["project_id"]
    db.commit()
    db.close()

    delete_response = client.delete(
        f"/api/v1/device/{project['device_id']}",
        headers=foreign_headers,
    )
    assert delete_response.status_code == 404

    config_response = client.put(
        f"/api/v1/device/{project['device_id']}/config",
        headers=foreign_headers,
        json={"pins": [{"gpio": 2, "mode": "OUTPUT", "label": "LED"}]},
    )
    assert config_response.status_code == 404

    project_response = client.get(
        f"/api/v1/diy/projects/{project['project_id']}",
        headers=foreign_headers,
    )
    assert project_response.status_code == 404
