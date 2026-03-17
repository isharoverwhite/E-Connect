import json
from pathlib import Path
from datetime import datetime, timedelta
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from main import app
from app.auth import create_access_token
from app.database import Base, get_db
from app.mqtt import mqtt_manager
from app.services import builder as builder_service
from app.services.provisioning import build_project_firmware_identity
from app.sql_models import (
    AccountType,
    AuthStatus,
    BuildJob,
    ConnStatus,
    Device,
    DeviceHistory,
    DeviceMode,
    DiyProject,
    EventType,
    Household,
    HouseholdMembership,
    HouseholdRole,
    JobStatus,
    PinConfiguration,
    Room,
    RoomPermission,
    SerialSession,
    SerialSessionStatus,
    User,
)


SQLALCHEMY_DATABASE_URL = "sqlite:///./test_diy_api.db"

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


def _issue_token(username: str, account_type: str = "admin", household_id: int = 1, household_role: str = "owner") -> str:
    return create_access_token(
        {
            "sub": username,
            "account_type": account_type,
            "household_id": household_id,
            "household_role": household_role,
        }
    )


def _seed_user(username: str, *, role: HouseholdRole = HouseholdRole.owner) -> User:
    db = TestingSessionLocal()
    user = User(
        fullname=username.title(),
        username=username,
        authentication="hashed-pass",
        account_type=AccountType.admin,
    )
    household = Household(name=f"{username}-house")
    db.add_all([user, household])
    db.commit()
    db.refresh(user)
    db.refresh(household)

    membership = HouseholdMembership(
        household_id=household.household_id,
        user_id=user.user_id,
        role=role,
    )
    db.add(membership)
    db.commit()
    db.refresh(user)
    db.close()
    return user


def _auth_headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {_issue_token(user.username, user.account_type.value)}"}


def _create_room(user: User, name: str = "Lab") -> int:
    db = TestingSessionLocal()
    membership = db.query(HouseholdMembership).filter(HouseholdMembership.user_id == user.user_id).first()
    assert membership is not None

    room = Room(name=name, user_id=user.user_id, household_id=membership.household_id)
    db.add(room)
    db.flush()
    db.add(RoomPermission(room_id=room.room_id, user_id=user.user_id, can_control=True))
    db.commit()
    room_id = room.room_id
    db.close()
    return room_id


def _create_project(
    headers: dict[str, str],
    *,
    room_id: int,
    board_profile: str = "dfrobot-beetle-esp32-c3",
    config: dict | None = None,
) -> str:
    response = client.post(
        "/api/v1/diy/projects",
        headers=headers,
        json={
            "name": "DIY Node",
            "board_profile": board_profile,
            "room_id": room_id,
            "config": config or {
                "wifi_ssid": "Builder-WiFi",
                "wifi_password": "BuilderPass123",
                "pins": [{"gpio": 2, "mode": "OUTPUT", "function": "relay"}],
            },
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


def _fake_builder(job_id: str, warnings: list[str] | None = None):
    db = TestingSessionLocal()
    job = db.query(BuildJob).filter(BuildJob.id == job_id).first()
    assert job is not None

    artifact_dir = Path("server/tests/tmp_artifacts")
    artifact_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = artifact_dir / f"{job_id}.bin"
    bootloader_path = artifact_dir / f"{job_id}.bootloader.bin"
    partitions_path = artifact_dir / f"{job_id}.partitions.bin"
    log_path = artifact_dir / f"{job_id}.log"
    artifact_path.write_bytes(b"firmware-bytes")
    bootloader_path.write_bytes(b"bootloader-bytes")
    partitions_path.write_bytes(b"partitions-bytes")
    log_path.write_text("\n".join(["builder-started", *(warnings or []), "builder-finished"]))

    job.status = JobStatus.artifact_ready
    job.artifact_path = str(artifact_path)
    job.log_path = str(log_path)
    db.commit()
    db.close()


@pytest.fixture(autouse=True)
def reset_state():
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    artifact_dir = Path("server/tests/tmp_artifacts")
    if artifact_dir.exists():
        for item in artifact_dir.iterdir():
            item.unlink()
    yield
    app.dependency_overrides.clear()


def test_diy_build_happy_path(monkeypatch):
    monkeypatch.setattr("app.api.build_firmware_task", _fake_builder)
    user = _seed_user("builder")
    headers = _auth_headers(user)
    project_id = _create_project(headers, room_id=_create_room(user))

    build_response = client.post(f"/api/v1/diy/build?project_id={project_id}", headers=headers)
    assert build_response.status_code == 200, build_response.text
    job_id = build_response.json()["id"]

    job_response = client.get(f"/api/v1/diy/build/{job_id}", headers=headers)
    assert job_response.status_code == 200
    assert job_response.json()["status"] == "artifact_ready"

    artifact_response = client.get(f"/api/v1/diy/build/{job_id}/artifact", headers=headers)
    assert artifact_response.status_code == 200
    assert artifact_response.content == b"firmware-bytes"

    bootloader_response = client.get(f"/api/v1/diy/build/{job_id}/artifact/bootloader", headers=headers)
    assert bootloader_response.status_code == 200
    assert bootloader_response.content == b"bootloader-bytes"

    partitions_response = client.get(f"/api/v1/diy/build/{job_id}/artifact/partitions", headers=headers)
    assert partitions_response.status_code == 200
    assert partitions_response.content == b"partitions-bytes"

    logs_response = client.get(f"/api/v1/diy/build/{job_id}/logs", headers=headers)
    assert logs_response.status_code == 200
    assert "builder-finished" in logs_response.json()["logs"]


def test_diy_projects_can_be_filtered_by_board_profile():
    user = _seed_user("config-library")
    headers = _auth_headers(user)
    room_id = _create_room(user)

    db = TestingSessionLocal()
    assert db.query(DiyProject).count() == 0
    db.close()

    c3_project_id = _create_project(
        headers,
        room_id=room_id,
        board_profile="dfrobot-beetle-esp32-c3",
    )
    esp32_project_id = _create_project(
        headers,
        room_id=room_id,
        board_profile="esp32-devkit-v1",
    )

    db = TestingSessionLocal()
    assert db.query(DiyProject).count() == 2
    assert (
        db.query(DiyProject)
        .filter(DiyProject.board_profile == "dfrobot-beetle-esp32-c3")
        .count()
        == 1
    )
    db.close()

    response = client.get(
        "/api/v1/diy/projects?board_profile=dfrobot-beetle-esp32-c3",
        headers=headers,
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["id"] == c3_project_id
    assert payload[0]["board_profile"] == "dfrobot-beetle-esp32-c3"

    response = client.get(
        "/api/v1/diy/projects?board_profile=esp32-devkit-v1",
        headers=headers,
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["id"] == esp32_project_id
    assert payload[0]["board_profile"] == "esp32-devkit-v1"


@pytest.mark.parametrize("status", [JobStatus.queued, JobStatus.building, JobStatus.flashing])
def test_diy_build_reuses_existing_active_job(monkeypatch, status: JobStatus):
    monkeypatch.setattr("app.api.build_firmware_task", lambda *_args, **_kwargs: None)
    user = _seed_user("retry-safe")
    headers = _auth_headers(user)
    project_id = _create_project(headers, room_id=_create_room(user))
    existing_job_id = str(uuid.uuid4())

    db = TestingSessionLocal()
    db.add(
        BuildJob(
            id=existing_job_id,
            project_id=project_id,
            status=status,
        )
    )
    db.commit()
    db.close()

    build_response = client.post(f"/api/v1/diy/build?project_id={project_id}", headers=headers)
    assert build_response.status_code == 200, build_response.text
    assert build_response.json()["id"] == existing_job_id
    assert build_response.json()["status"] == status.value

    db = TestingSessionLocal()
    jobs = db.query(BuildJob).filter(BuildJob.project_id == project_id).all()
    assert len(jobs) == 1
    assert jobs[0].id == existing_job_id
    assert jobs[0].status == status
    db.close()


def test_diy_build_rejects_reserved_pin():
    user = _seed_user("validator")
    headers = _auth_headers(user)
    project_id = _create_project(
        headers,
        room_id=_create_room(user),
        board_profile="esp32-c3-devkitm-1",
        config={
            "wifi_ssid": "Builder-WiFi",
            "wifi_password": "BuilderPass123",
            "pins": [{"gpio": 9, "mode": "OUTPUT", "function": "relay"}],
        },
    )

    build_response = client.post(f"/api/v1/diy/build?project_id={project_id}", headers=headers)
    assert build_response.status_code == 400
    payload = build_response.json()["detail"]
    assert payload["error"] == "validation"
    assert any("reserved" in message for message in payload["messages"])


def test_diy_build_rejects_missing_wifi_credentials():
    user = _seed_user("wifi-validator")
    headers = _auth_headers(user)
    project_id = _create_project(
        headers,
        room_id=_create_room(user),
        config={"wifi_ssid": "", "wifi_password": "", "pins": [{"gpio": 2, "mode": "OUTPUT", "function": "relay"}]},
    )

    build_response = client.post(f"/api/v1/diy/build?project_id={project_id}", headers=headers)
    assert build_response.status_code == 400
    payload = build_response.json()["detail"]
    assert payload["error"] == "validation"
    assert any("wifi_ssid" in message for message in payload["messages"])
    assert any("wifi_password" in message for message in payload["messages"])


def test_diy_build_rejects_invalid_output_active_level():
    user = _seed_user("active-level-validator")
    headers = _auth_headers(user)
    project_id = _create_project(
        headers,
        room_id=_create_room(user),
        config={
            "wifi_ssid": "Builder-WiFi",
            "wifi_password": "BuilderPass123",
            "pins": [
                {
                    "gpio": 2,
                    "mode": "OUTPUT",
                    "function": "relay",
                    "extra_params": {"active_level": 2},
                }
            ],
        },
    )

    build_response = client.post(f"/api/v1/diy/build?project_id={project_id}", headers=headers)
    assert build_response.status_code == 400
    payload = build_response.json()["detail"]
    assert payload["error"] == "validation"
    assert any("active_level" in message for message in payload["messages"])


def test_serial_lock_is_persisted_and_conflicts_by_port(monkeypatch):
    monkeypatch.setattr("app.api.build_firmware_task", _fake_builder)
    owner = _seed_user("owner")
    other = _seed_user("other")
    owner_headers = _auth_headers(owner)
    other_headers = _auth_headers(other)

    project_id = _create_project(owner_headers, room_id=_create_room(owner))
    build_response = client.post(f"/api/v1/diy/build?project_id={project_id}", headers=owner_headers)
    assert build_response.status_code == 200
    job_id = build_response.json()["id"]

    lock_response = client.post(
        f"/api/v1/serial/lock?device_id=device-1&port=COM3&job_id={job_id}",
        headers=owner_headers,
    )
    assert lock_response.status_code == 200, lock_response.text
    assert lock_response.json()["status"] == "locked"

    status_response = client.get("/api/v1/serial/status?port=COM3", headers=owner_headers)
    assert status_response.status_code == 200
    assert status_response.json()["locked"] is True
    assert status_response.json()["job_id"] == job_id

    conflict_response = client.post(
        "/api/v1/serial/lock?device_id=device-2&port=COM3",
        headers=other_headers,
    )
    assert conflict_response.status_code == 409

    unlock_response = client.post("/api/v1/serial/unlock?port=COM3", headers=owner_headers)
    assert unlock_response.status_code == 200

    db = TestingSessionLocal()
    sessions = db.query(SerialSession).all()
    assert len(sessions) == 1
    assert sessions[0].status == SerialSessionStatus.released
    db.close()


def test_builder_exception_persists_terminal_failure_metadata(monkeypatch, tmp_path):
    user = _seed_user("builder-failure")
    project_id = str(uuid.uuid4())
    job_id = str(uuid.uuid4())

    db = TestingSessionLocal()
    project = DiyProject(
        id=project_id,
        user_id=user.user_id,
        name="Failure Case",
        board_profile="esp32-c3-super-mini",
        config={
            "wifi_ssid": "Builder-WiFi",
            "wifi_password": "BuilderPass123",
            "pins": [{"gpio": 8, "mode": "OUTPUT", "function": "LED"}],
        },
    )
    job = BuildJob(
        id=job_id,
        project_id=project_id,
        status=JobStatus.queued,
    )
    db.add_all([project, job])
    db.commit()
    db.close()

    jobs_dir = tmp_path / "jobs"
    artifacts_dir = tmp_path / "artifacts"
    logs_dir = tmp_path / "logs"
    for directory in (jobs_dir, artifacts_dir, logs_dir):
        directory.mkdir(parents=True, exist_ok=True)

    def _raise_builder_exception(*_args, **_kwargs):
        raise RuntimeError("synthetic builder failure")

    monkeypatch.setattr(builder_service, "SessionLocal", TestingSessionLocal)
    monkeypatch.setattr(builder_service, "JOBS_DIR", str(jobs_dir))
    monkeypatch.setattr(builder_service, "ARTIFACTS_DIR", str(artifacts_dir))
    monkeypatch.setattr(builder_service, "LOGS_DIR", str(logs_dir))
    monkeypatch.setattr(builder_service, "generate_platformio_ini", _raise_builder_exception)

    builder_service.build_firmware_task(job_id)

    db = TestingSessionLocal()
    persisted_job = db.query(BuildJob).filter(BuildJob.id == job_id).first()
    assert persisted_job is not None
    assert persisted_job.status == JobStatus.build_failed
    assert persisted_job.finished_at is not None
    assert persisted_job.updated_at is not None
    assert persisted_job.error_message == "synthetic builder failure"
    assert persisted_job.log_path is not None

    log_path = Path(persisted_job.log_path)
    assert log_path.exists()
    assert "Internal Server Build Error: synthetic builder failure" in log_path.read_text()
    db.close()


def test_generated_firmware_config_includes_output_active_level(tmp_path):
    project = DiyProject(
        id=str(uuid.uuid4()),
        user_id=1,
        name="Reverse Relay",
        board_profile="esp32-c3-devkitm-1",
        config={
            "project_name": "Reverse Relay",
            "wifi_ssid": "Builder-WiFi",
            "wifi_password": "BuilderPass123",
            "pins": [
                {
                    "gpio": 2,
                    "mode": "OUTPUT",
                    "function": "relay",
                    "label": "Relay Output",
                    "extra_params": {"active_level": 0},
                }
            ],
        },
    )

    builder_service.write_generated_firmware_config(project, "abcd1234-job", str(tmp_path))

    header_path = tmp_path / "include" / "generated_firmware_config.h"
    assert header_path.exists()
    header_contents = header_path.read_text()
    assert 'int active_level;' in header_contents
    assert '{ 2, "OUTPUT", "relay", "Relay Output", 0 }' in header_contents


def test_list_devices_marks_stale_heartbeat_offline_once():
    owner = _seed_user("heartbeat-stale")
    headers = _auth_headers(owner)
    device_id = str(uuid.uuid4())

    db = TestingSessionLocal()
    db.add(
        Device(
            device_id=device_id,
            mac_address="AA:BB:CC:DD:EE:01",
            name="Stale Heartbeat Node",
            owner_id=owner.user_id,
            auth_status=AuthStatus.approved,
            conn_status=ConnStatus.online,
            mode=DeviceMode.library,
            last_seen=datetime.utcnow() - timedelta(seconds=180),
        )
    )
    db.commit()
    db.close()

    first_response = client.get("/api/v1/devices", headers=headers)
    assert first_response.status_code == 200
    assert first_response.json()[0]["conn_status"] == "offline"

    second_response = client.get("/api/v1/devices", headers=headers)
    assert second_response.status_code == 200
    assert second_response.json()[0]["conn_status"] == "offline"

    db = TestingSessionLocal()
    device = db.query(Device).filter(Device.device_id == device_id).first()
    offline_events = (
        db.query(DeviceHistory)
        .filter(
            DeviceHistory.device_id == device_id,
            DeviceHistory.event_type == EventType.offline,
        )
        .all()
    )
    assert device is not None
    assert device.conn_status == ConnStatus.offline
    assert len(offline_events) == 1
    assert "heartbeat_timeout" in offline_events[0].payload
    db.close()


def test_list_devices_keeps_recent_heartbeat_online():
    owner = _seed_user("heartbeat-fresh")
    headers = _auth_headers(owner)
    device_id = str(uuid.uuid4())

    db = TestingSessionLocal()
    db.add(
        Device(
            device_id=device_id,
            mac_address="AA:BB:CC:DD:EE:02",
            name="Fresh Heartbeat Node",
            owner_id=owner.user_id,
            auth_status=AuthStatus.approved,
            conn_status=ConnStatus.online,
            mode=DeviceMode.library,
            last_seen=datetime.utcnow() - timedelta(seconds=15),
        )
    )
    db.commit()
    db.close()

    response = client.get("/api/v1/devices", headers=headers)
    assert response.status_code == 200
    assert response.json()[0]["conn_status"] == "online"

    db = TestingSessionLocal()
    offline_event_count = (
        db.query(DeviceHistory)
        .filter(
            DeviceHistory.device_id == device_id,
            DeviceHistory.event_type == EventType.offline,
        )
        .count()
    )
    assert offline_event_count == 0
    db.close()


def test_delete_device_unpairs_and_hides_from_default_list():
    owner = _seed_user("unpair-owner")
    headers = _auth_headers(owner)
    device_id = str(uuid.uuid4())

    db = TestingSessionLocal()
    owner_record = db.query(User).filter(User.user_id == owner.user_id).first()
    owner_record.ui_layout = [{"i": "widget-1", "deviceId": device_id, "pin": 2, "label": "Relay"}]
    db.add(
        Device(
            device_id=device_id,
            mac_address="AA:BB:CC:DD:EE:03",
            name="Re-pairable Node",
            owner_id=owner.user_id,
            auth_status=AuthStatus.approved,
            conn_status=ConnStatus.online,
            mode=DeviceMode.library,
            last_seen=datetime.utcnow(),
        )
    )
    db.commit()
    db.close()

    remove_response = client.delete(f"/api/v1/device/{device_id}", headers=headers)
    assert remove_response.status_code == 200, remove_response.text
    assert remove_response.json()["status"] == "unpaired"

    default_list_response = client.get("/api/v1/devices", headers=headers)
    assert default_list_response.status_code == 200
    assert default_list_response.json() == []

    pending_list_response = client.get("/api/v1/devices?auth_status=pending", headers=headers)
    assert pending_list_response.status_code == 200
    assert len(pending_list_response.json()) == 1
    assert pending_list_response.json()[0]["device_id"] == device_id

    db = TestingSessionLocal()
    device = db.query(Device).filter(Device.device_id == device_id).first()
    owner_record = db.query(User).filter(User.user_id == owner.user_id).first()
    assert device is not None
    assert device.auth_status == AuthStatus.pending
    assert owner_record.ui_layout == []
    db.close()


def test_approve_device_restores_widgets_to_device_owner():
    owner = _seed_user("pair-owner")
    approver = _seed_user("pair-admin")
    owner_headers = _auth_headers(owner)
    approver_headers = _auth_headers(approver)
    device_id = str(uuid.uuid4())
    room_id = _create_room(approver, "Pairing Room")

    db = TestingSessionLocal()
    db.add(
        Device(
            device_id=device_id,
            mac_address="AA:BB:CC:DD:EE:04",
            name="Pair Again Node",
            owner_id=owner.user_id,
            auth_status=AuthStatus.pending,
            conn_status=ConnStatus.online,
            mode=DeviceMode.library,
            last_seen=datetime.utcnow(),
        )
    )
    db.add(
        PinConfiguration(
            device_id=device_id,
            gpio_pin=2,
            mode="OUTPUT",
            function="relay",
            label="Relay Output",
        )
    )
    db.commit()
    db.close()

    default_list_before = client.get("/api/v1/devices", headers=owner_headers)
    assert default_list_before.status_code == 200
    assert default_list_before.json() == []

    pending_list_before = client.get("/api/v1/devices?auth_status=pending", headers=owner_headers)
    assert pending_list_before.status_code == 200
    assert len(pending_list_before.json()) == 1

    approve_response = client.post(
        f"/api/v1/device/{device_id}/approve",
        headers=approver_headers,
        json={"room_id": room_id},
    )
    assert approve_response.status_code == 200, approve_response.text
    assert approve_response.json()["status"] == "approved"

    default_list_after = client.get("/api/v1/devices", headers=owner_headers)
    assert default_list_after.status_code == 200
    assert len(default_list_after.json()) == 1
    assert default_list_after.json()[0]["device_id"] == device_id

    db = TestingSessionLocal()
    device = db.query(Device).filter(Device.device_id == device_id).first()
    owner_record = db.query(User).filter(User.user_id == owner.user_id).first()
    approver_record = db.query(User).filter(User.user_id == approver.user_id).first()
    assert device is not None
    assert device.auth_status == AuthStatus.approved
    assert device.room_id == room_id
    assert isinstance(owner_record.ui_layout, list)
    assert any(widget["deviceId"] == device_id for widget in owner_record.ui_layout)
    assert not approver_record.ui_layout
    db.close()


def test_mqtt_registration_auto_approves_project_device_and_provisions_dashboard(monkeypatch):
    owner = _seed_user("secure-builder")
    headers = _auth_headers(owner)
    project_id = _create_project(
        headers,
        room_id=_create_room(owner),
        config={
            "project_name": "Kitchen Relay",
            "wifi_ssid": "Builder-WiFi",
            "wifi_password": "BuilderPass123",
            "pins": [
                {
                    "gpio": 2,
                    "mode": "OUTPUT",
                    "function": "relay",
                    "label": "Kitchen Relay",
                    "extra_params": {"active_level": 0},
                },
                {"gpio": 3, "mode": "ADC", "function": "temperature", "label": "Temperature"},
            ],
        },
    )
    device_id, secret_key = build_project_firmware_identity(project_id)
    published_messages: list[tuple[str, dict]] = []

    monkeypatch.setattr("app.mqtt.SessionLocal", TestingSessionLocal)
    monkeypatch.setattr(
        mqtt_manager,
        "publish_json",
        lambda topic, payload, **_kwargs: published_messages.append((topic, payload)) or True,
    )

    ack_payload = mqtt_manager.process_registration_message(
        device_id,
        json.dumps(
            {
                "device_id": device_id,
                "project_id": project_id,
                "secret_key": secret_key,
                "mac_address": "AA:BB:CC:DD:EE:FF",
                "name": "Kitchen Relay",
                "mode": "library",
                "firmware_version": "build-test",
                "ip_address": "192.168.2.55",
                "pins": [
                    {
                        "gpio_pin": 2,
                        "mode": "OUTPUT",
                        "function": "relay",
                        "label": "Kitchen Relay",
                        "extra_params": {"active_level": 0},
                    },
                    {
                        "gpio_pin": 3,
                        "mode": "ADC",
                        "function": "temperature",
                        "label": "Temperature",
                    },
                ],
            }
        ),
    )

    assert ack_payload["status"] == "ok"
    assert ack_payload["secret_verified"] is True
    assert ack_payload["project_id"] == project_id
    assert ack_payload["auth_status"] == "approved"
    assert published_messages == [
        (
            mqtt_manager.registration_ack_topic(device_id),
            ack_payload,
        )
    ]

    db = TestingSessionLocal()
    device = db.query(Device).filter(Device.device_id == device_id).first()
    owner_record = db.query(User).filter(User.user_id == owner.user_id).first()
    assert device is not None
    assert device.auth_status == AuthStatus.approved
    assert device.owner_id == owner.user_id
    assert device.provisioning_project_id == project_id
    assert device.ip_address == "192.168.2.55"
    assert len(device.pin_configurations) == 2
    relay_pin = next(pin for pin in device.pin_configurations if pin.gpio_pin == 2)
    assert relay_pin.extra_params["active_level"] == 0
    assert isinstance(owner_record.ui_layout, list)
    assert any(widget["deviceId"] == device_id for widget in owner_record.ui_layout)
    db.close()


def test_mqtt_registration_rejects_secret_mismatch(monkeypatch):
    owner = _seed_user("secure-failure")
    headers = _auth_headers(owner)
    project_id = _create_project(headers, room_id=_create_room(owner))
    device_id, _ = build_project_firmware_identity(project_id)
    published_messages: list[tuple[str, dict]] = []

    monkeypatch.setattr("app.mqtt.SessionLocal", TestingSessionLocal)
    monkeypatch.setattr(
        mqtt_manager,
        "publish_json",
        lambda topic, payload, **_kwargs: published_messages.append((topic, payload)) or True,
    )

    ack_payload = mqtt_manager.process_registration_message(
        device_id,
        json.dumps(
            {
                "device_id": device_id,
                "project_id": project_id,
                "secret_key": "wrong-secret",
                "mac_address": "AA:BB:CC:00:11:22",
                "name": "Compromised Node",
                "mode": "library",
                "firmware_version": "build-test",
                "pins": [
                    {
                        "gpio_pin": 2,
                        "mode": "OUTPUT",
                        "function": "relay",
                        "label": "Relay",
                    }
                ],
            }
        ),
    )

    assert ack_payload["status"] == "error"
    assert ack_payload["error"] == "unauthorized_device"
    assert published_messages == [
        (
            mqtt_manager.registration_ack_topic(device_id),
            ack_payload,
        )
    ]

    db = TestingSessionLocal()
    assert db.query(Device).count() == 0
    db.close()


def test_http_config_rejects_library_devices_forcing_mqtt_registration():
    owner = _seed_user("http-block")
    headers = _auth_headers(owner)
    project_id = _create_project(headers, room_id=_create_room(owner))
    device_id, secret_key = build_project_firmware_identity(project_id)

    response = client.post(
        "/api/v1/config",
        json={
            "device_id": device_id,
            "project_id": project_id,
            "secret_key": secret_key,
            "mac_address": "AA:BB:CC:12:34:56",
            "name": "HTTP Blocked Node",
            "mode": "library",
            "firmware_version": "build-test",
            "pins": [{"gpio_pin": 2, "mode": "OUTPUT", "function": "relay", "label": "Relay"}],
        },
    )

    assert response.status_code == 409
    payload = response.json()["detail"]
    assert payload["error"] == "mqtt_only"


def test_http_history_rejects_mqtt_managed_devices():
    user = _seed_user("history-block")

    db = TestingSessionLocal()
    db.add(
        Device(
            device_id="mqtt-history-device",
            mac_address="AA:BB:CC:66:77:88",
            name="MQTT History Device",
            owner_id=user.user_id,
            auth_status=AuthStatus.approved,
            conn_status=ConnStatus.online,
            mode=DeviceMode.library,
            topic_pub="econnect/local/device/mqtt-history-device/state",
            topic_sub="econnect/local/device/mqtt-history-device/command",
        )
    )
    db.commit()
    db.close()

    response = client.post(
        "/api/v1/device/mqtt-history-device/history",
        json={"event_type": "online", "payload": "{\"kind\":\"state\"}"},
    )

    assert response.status_code == 409
    payload = response.json()["detail"]
    assert payload["error"] == "mqtt_only"
