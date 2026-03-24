from datetime import datetime
import uuid
from unittest.mock import Mock, patch
from sqlalchemy.orm import Session

from app.sql_models import AuthStatus, ConnStatus, Device, HouseholdRole
from app.mqtt import build_pairing_rejected_ack_payload
from tests.conftest import client, TestingSessionLocal, _seed_household, _auth_headers, _create_room

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
