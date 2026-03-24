from datetime import datetime
import uuid
from unittest.mock import Mock

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
    User,
    UserApprovalStatus,
)
from main import app


SQLALCHEMY_DATABASE_URL = "sqlite:///./test_reject_semantics.db"

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


def _seed_household(prefix: str = "reject"):
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


def _create_room(headers: dict[str, str], *, name: str, allowed_user_ids: list[int] | None = None) -> dict:
    response = client.post(
        "/api/v1/rooms",
        headers=headers,
        json={"name": name, "allowed_user_ids": allowed_user_ids or []},
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture(autouse=True)
def reset_state():
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)

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
    monkeypatch.setattr("app.api.mqtt_manager.publish_json", publish_mock)

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
