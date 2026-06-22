# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import DEVICE_HEARTBEAT_TIMEOUT, expire_stale_online_devices_once, mqtt_manager
from app.database import Base
from app.sql_models import (
    AccountType,
    AuthStatus,
    ConnStatus,
    Device,
    DeviceHistory,
    EventType,
    Household,
    HouseholdMembership,
    HouseholdRole,
    Room,
    SystemLog,
    SystemLogCategory,
    SystemLogSeverity,
    User,
)


SQLALCHEMY_DATABASE_URL = "sqlite://"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def setup_function():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    mqtt_manager._latest_device_runtime_cache.clear()
    mqtt_manager._latest_state_cache.clear()
    mqtt_manager._latest_state_sequence = 0


def _seed_device(*, last_seen: datetime) -> tuple[str, int]:
    db = TestingSessionLocal()
    try:
        household = Household(name="Heartbeat House")
        user = User(
            fullname="Heartbeat Admin",
            username=f"heartbeat-{uuid.uuid4()}",
            authentication="hashed-pass",
            account_type=AccountType.admin,
        )
        db.add_all([household, user])
        db.commit()
        db.refresh(household)
        db.refresh(user)

        membership = HouseholdMembership(
            household_id=household.household_id,
            user_id=user.user_id,
            role=HouseholdRole.owner,
        )
        room = Room(
            user_id=user.user_id,
            household_id=household.household_id,
            name="Heartbeat Area",
        )
        db.add_all([membership, room])
        db.commit()
        db.refresh(room)

        device_id = str(uuid.uuid4())
        device = Device(
            device_id=device_id,
            mac_address=f"AA:BB:CC:{device_id[:2]}:{device_id[2:4]}:{device_id[4:6]}",
            name="Heartbeat Device",
            room_id=room.room_id,
            owner_id=user.user_id,
            auth_status=AuthStatus.approved,
            conn_status=ConnStatus.online,
            last_seen=last_seen,
        )
        db.add(device)
        db.commit()

        return device_id, room.room_id
    finally:
        db.close()


def test_expire_stale_online_devices_once_marks_old_devices_offline(monkeypatch):
    stale_seen_at = datetime.now(timezone.utc) - DEVICE_HEARTBEAT_TIMEOUT - timedelta(seconds=1)
    device_id, room_id = _seed_device(last_seen=stale_seen_at)
    broadcast_mock = Mock()
    remember_connectivity_mock = Mock()
    monkeypatch.setattr("app.api.ws_manager.broadcast_device_event_sync", broadcast_mock)
    monkeypatch.setattr("app.api.mqtt_manager.remember_runtime_connectivity", remember_connectivity_mock)

    expired_count = expire_stale_online_devices_once(session_factory=TestingSessionLocal)

    assert expired_count == 1

    db = TestingSessionLocal()
    try:
        device = db.query(Device).filter(Device.device_id == device_id).one()
        assert device.conn_status == ConnStatus.offline

        history = (
            db.query(DeviceHistory)
            .filter(
                DeviceHistory.device_id == device_id,
                DeviceHistory.event_type == EventType.offline,
            )
            .all()
        )
        assert len(history) == 1

        system_logs = (
            db.query(SystemLog)
            .filter(
                SystemLog.device_id == device_id,
                SystemLog.event_code == "device_offline",
            )
            .all()
        )
        assert len(system_logs) == 1
        assert system_logs[0].category == SystemLogCategory.connectivity
        assert system_logs[0].severity == SystemLogSeverity.warning
    finally:
        db.close()

    broadcast_mock.assert_called_once_with(
        "device_offline",
        device_id,
        room_id,
        {"reason": "heartbeat_timeout"},
    )
    remember_connectivity_mock.assert_called_once()
    assert remember_connectivity_mock.call_args.args == (device_id,)
    assert remember_connectivity_mock.call_args.kwargs["conn_status"] == ConnStatus.offline


def test_expire_stale_online_devices_once_leaves_recent_devices_online(monkeypatch):
    device_id, _ = _seed_device(last_seen=datetime.now(timezone.utc))
    broadcast_mock = Mock()
    monkeypatch.setattr("app.api.ws_manager.broadcast_device_event_sync", broadcast_mock)

    expired_count = expire_stale_online_devices_once(session_factory=TestingSessionLocal)

    assert expired_count == 0

    db = TestingSessionLocal()
    try:
        device = db.query(Device).filter(Device.device_id == device_id).one()
        assert device.conn_status == ConnStatus.online

        history_count = (
            db.query(DeviceHistory)
            .filter(
                DeviceHistory.device_id == device_id,
                DeviceHistory.event_type == EventType.offline,
            )
            .count()
        )
        assert history_count == 0
    finally:
        db.close()

    broadcast_mock.assert_not_called()


def test_expire_stale_online_devices_once_prefers_fresh_runtime_activity(monkeypatch):
    stale_seen_at = datetime.now(timezone.utc) - DEVICE_HEARTBEAT_TIMEOUT - timedelta(seconds=1)
    device_id, _ = _seed_device(last_seen=stale_seen_at)
    broadcast_mock = Mock()
    monkeypatch.setattr("app.api.ws_manager.broadcast_device_event_sync", broadcast_mock)
    monkeypatch.setattr(
        "app.api.mqtt_manager.latest_device_runtime_metadata",
        lambda incoming_device_id: (
            {
                "conn_status": ConnStatus.online,
                "last_seen": datetime.now(timezone.utc),
            }
            if incoming_device_id == device_id
            else None
        ),
    )

    expired_count = expire_stale_online_devices_once(session_factory=TestingSessionLocal)

    assert expired_count == 0

    db = TestingSessionLocal()
    try:
        device = db.query(Device).filter(Device.device_id == device_id).one()
        assert device.conn_status == ConnStatus.online

        history_count = (
            db.query(DeviceHistory)
            .filter(
                DeviceHistory.device_id == device_id,
                DeviceHistory.event_type == EventType.offline,
            )
            .count()
        )
        assert history_count == 0
    finally:
        db.close()

    broadcast_mock.assert_not_called()
