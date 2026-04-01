import pytest
from datetime import datetime
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import close_all_sessions, sessionmaker
from sqlalchemy.pool import StaticPool
import json
import uuid

from app.api import router
from app.database import Base, get_db
from app.sql_models import AuthStatus, User, Household, HouseholdMembership, HouseholdRole, UserApprovalStatus, Room, DiyProject, BuildJob, JobStatus, Device, DeviceMode, PinConfiguration, WifiCredential
from app.auth import get_password_hash, create_ota_token

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


def _write_test_artifact(tmp_path, job_id: str) -> str:
    artifact_path = tmp_path / f"{job_id}.bin"
    artifact_path.write_bytes(b"test-firmware-image")
    return str(artifact_path)

@pytest.fixture(autouse=True)
def setup_db():
    close_all_sessions()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    close_all_sessions()

def create_test_data(db):
    user = User(
        username="admin",
        fullname="Admin",
        authentication=get_password_hash("password"),
        approval_status=UserApprovalStatus.approved,
        account_type="admin"
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

    project = DiyProject(
        id=str(uuid.uuid4()),
        user_id=user.user_id,
        room_id=room.room_id,
        name="Test OTA Node",
        board_profile="esp32",
        config={"wifi_ssid": "test", "wifi_password": "test"}
    )
    db.add(project)
    db.commit()

    device = Device(
        device_id=str(uuid.uuid4()),
        mac_address="00:11:22:33:EE:FF",
        name="OTA Device",
        mode=DeviceMode.no_code,
        auth_status="approved",
        owner_id=user.user_id,
        room_id=room.room_id,
        provisioning_project_id=project.id
    )
    db.add(device)
    db.commit()

    return user, room, project, device

def test_put_device_config_success():
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)
    
    # get token
    response = client.post("/api/v1/auth/token", data={"username": "admin", "password": "password"})
    token = response.json()["access_token"]

    payload = {
        "password": "password",
        "pins": [
            {"gpio": 2, "mode": "OUTPUT", "label": "LED"}
        ]
    }

    with patch("app.api.build_firmware_task", return_value=None):
        res = client.put(
            f"/api/v1/device/{device.device_id}/config",
            json=payload,
            headers={"Authorization": f"Bearer {token}"}
        )

    if res.status_code != 200:
        print("Response:", res.json())
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert "job_id" in data

    # Verify build job was created with UUID
    job_id = data["job_id"]
    job = db.query(BuildJob).filter(BuildJob.id == job_id).first()
    assert job is not None
    assert job.status == JobStatus.queued

    db.refresh(project)
    assert project.config["advertised_host"] == "192.168.1.25"
    assert project.config["api_base_url"] == "http://192.168.1.25:3000/api/v1"
    assert project.config["mqtt_broker"] == "192.168.1.25"
    assert project.config["mqtt_port"] == 1883
    assert project.config["target_key"] == "192.168.1.25|http://192.168.1.25:3000/api/v1|192.168.1.25|1883"
    assert project.config["pins"] == [{"gpio": 2, "mode": "OUTPUT", "label": "LED"}]

    db.refresh(device)
    assert len(device.pin_configurations) == 0

    db.refresh(user)
    assert not user.ui_layout


def test_put_device_config_preserves_board_reported_pin_map_until_reconnect():
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)

    db.add(
        PinConfiguration(
            device_id=device.device_id,
            gpio_pin=8,
            mode="PWM",
            label="Active Dimmer",
            extra_params={"min_value": 0, "max_value": 255},
        )
    )
    user.ui_layout = [
        {
            "i": f"{device.device_id}:8:0",
            "x": 0,
            "y": 0,
            "w": 2,
            "h": 2,
            "type": "dimmer",
            "deviceId": device.device_id,
            "pin": 8,
            "label": "Active Dimmer",
        }
    ]
    db.commit()

    response = client.post("/api/v1/auth/token", data={"username": "admin", "password": "password"})
    token = response.json()["access_token"]

    payload = {
        "password": "password",
        "pins": [
            {"gpio": 2, "mode": "OUTPUT", "label": "Desired Relay"}
        ]
    }

    with patch("app.api.build_firmware_task", return_value=None):
        res = client.put(
            f"/api/v1/device/{device.device_id}/config",
            json=payload,
            headers={"Authorization": f"Bearer {token}"}
        )

    assert res.status_code == 200, res.text

    db.refresh(project)
    assert project.config["pins"] == [{"gpio": 2, "mode": "OUTPUT", "label": "Desired Relay"}]

    db.refresh(device)
    assert len(device.pin_configurations) == 1
    assert device.pin_configurations[0].gpio_pin == 8
    assert device.pin_configurations[0].mode == "PWM"
    assert device.pin_configurations[0].label == "Active Dimmer"

    db.refresh(user)
    assert user.ui_layout[0]["pin"] == 8
    assert user.ui_layout[0]["label"] == "Active Dimmer"

def test_put_device_config_prefers_forwarded_host_for_firmware_target():
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)

    response = client.post("/api/v1/auth/token", data={"username": "admin", "password": "password"})
    token = response.json()["access_token"]

    payload = {
        "password": "password",
        "pins": [
            {"gpio": 2, "mode": "OUTPUT", "label": "LED"}
        ]
    }

    with patch("app.api.build_firmware_task", return_value=None):
        res = client.put(
            f"/api/v1/device/{device.device_id}/config",
            json=payload,
            headers={
                "Authorization": f"Bearer {token}",
                "X-Forwarded-Host": "smart-home.local:8443",
                "X-Forwarded-Proto": "https",
            },
        )

    assert res.status_code == 200, res.text
    db.refresh(project)
    assert project.config["advertised_host"] == "smart-home.local"
    assert project.config["api_base_url"] == "https://smart-home.local:8443/api/v1"
    assert project.config["mqtt_broker"] == "smart-home.local"
    assert project.config["mqtt_port"] == 1883

def test_put_device_config_normalizes_secure_companion_origin_to_http_lan_transport():
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)

    response = client.post("/api/v1/auth/token", data={"username": "admin", "password": "password"})
    token = response.json()["access_token"]

    payload = {
        "password": "password",
        "pins": [
            {"gpio": 2, "mode": "OUTPUT", "label": "LED"}
        ]
    }

    with patch("app.api.build_firmware_task", return_value=None):
        res = client.put(
            f"/api/v1/device/{device.device_id}/config",
            json=payload,
            headers={
                "Authorization": f"Bearer {token}",
                "Host": "server:8000",
                "X-EConnect-Origin": "https://192.168.8.4:3443",
            },
        )

    assert res.status_code == 200, res.text
    db.refresh(project)
    assert project.config["advertised_host"] == "192.168.8.4"
    assert project.config["api_base_url"] == "http://192.168.8.4:3000/api/v1"
    assert project.config["mqtt_broker"] == "192.168.8.4"
    assert project.config["mqtt_port"] == 1883

def test_put_device_config_rejects_docker_local_host():
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)

    response = client.post("/api/v1/auth/token", data={"username": "admin", "password": "password"})
    token = response.json()["access_token"]

    res = client.put(
        f"/api/v1/device/{device.device_id}/config",
        json={"password": "password", "pins": [{"gpio": 2, "mode": "OUTPUT", "label": "LED"}]},
        headers={
            "Authorization": f"Bearer {token}",
            "Host": "server:8000",
        },
    )

    assert res.status_code == 400
    payload = res.json()["detail"]
    assert payload["error"] == "validation"
    assert "reachable host" in payload["message"]


def test_get_build_job_includes_expected_firmware_version():
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)

    response = client.post("/api/v1/auth/token", data={"username": "admin", "password": "password"})
    token = response.json()["access_token"]

    job_id = str(uuid.uuid4())
    job = BuildJob(id=job_id, project_id=project.id, status=JobStatus.artifact_ready)
    db.add(job)
    db.commit()

    res = client.get(
        f"/api/v1/diy/build/{job_id}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert res.status_code == 200, res.text
    payload = res.json()
    assert payload["id"] == job_id
    assert payload["expected_firmware_version"] == f"build-{job_id[:8]}"

def test_put_device_config_invalid_not_diy():
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)
    
    # remove project ID
    device.provisioning_project_id = None
    db.commit()

    response = client.post("/api/v1/auth/token", data={"username": "admin", "password": "password"})
    token = response.json()["access_token"]

    res = client.put(
        f"/api/v1/device/{device.device_id}/config",
        json={"password": "password", "pins": []},
        headers={"Authorization": f"Bearer {token}"}
    )

    assert res.status_code == 400
    assert "Not a managed DIY device" in res.json()["detail"]

def test_put_device_config_requires_account_password():
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)

    response = client.post("/api/v1/auth/token", data={"username": "admin", "password": "password"})
    token = response.json()["access_token"]

    res = client.put(
        f"/api/v1/device/{device.device_id}/config",
        json={"pins": [{"gpio": 2, "mode": "OUTPUT", "label": "LED"}]},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert res.status_code == 400
    assert res.json()["detail"]["error"] == "validation"
    assert res.json()["detail"]["message"] == "Enter your account password before updating this board config."
    assert db.query(BuildJob).filter(BuildJob.project_id == project.id).count() == 0

def test_put_device_config_rejects_wrong_account_password():
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)

    response = client.post("/api/v1/auth/token", data={"username": "admin", "password": "password"})
    token = response.json()["access_token"]

    res = client.put(
        f"/api/v1/device/{device.device_id}/config",
        json={
            "password": "wrong-password",
            "pins": [{"gpio": 2, "mode": "OUTPUT", "label": "LED"}],
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    assert res.status_code == 403
    assert res.json()["detail"]["error"] == "invalid_password"
    assert (
        res.json()["detail"]["message"]
        == "Incorrect password. Enter the password for the signed-in account to update this board config."
    )
    assert db.query(BuildJob).filter(BuildJob.project_id == project.id).count() == 0

def test_put_device_config_updates_selected_wifi_credential():
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)

    wifi_credential = WifiCredential(
        household_id=room.household_id,
        ssid="Workshop-WiFi",
        password="WorkshopPass456",
    )
    db.add(wifi_credential)
    db.commit()
    db.refresh(wifi_credential)

    response = client.post("/api/v1/auth/token", data={"username": "admin", "password": "password"})
    token = response.json()["access_token"]

    payload = {
        "password": "password",
        "wifi_credential_id": wifi_credential.id,
        "pins": [
            {"gpio": 2, "mode": "OUTPUT", "label": "LED"}
        ]
    }

    with patch("app.api.build_firmware_task", return_value=None):
        res = client.put(
            f"/api/v1/device/{device.device_id}/config",
            json=payload,
            headers={"Authorization": f"Bearer {token}"}
        )

    assert res.status_code == 200, res.text
    db.refresh(project)
    assert project.wifi_credential_id == wifi_credential.id
    assert project.config["wifi_credential_id"] == wifi_credential.id
    assert project.config["wifi_ssid"] == "Workshop-WiFi"
    assert project.config["wifi_password"] == "WorkshopPass456"
    job = db.query(BuildJob).filter(BuildJob.project_id == project.id).one()
    assert job.status == JobStatus.queued

def test_put_device_config_invalid_payload_does_not_persist_or_create_job():
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)

    response = client.post("/api/v1/auth/token", data={"username": "admin", "password": "password"})
    token = response.json()["access_token"]

    original_config = dict(project.config or {})
    res = client.put(
        f"/api/v1/device/{device.device_id}/config",
        json={"password": "password", "pins": []},
        headers={"Authorization": f"Bearer {token}"}
    )

    assert res.status_code == 400

    db.refresh(project)
    assert project.config == original_config
    assert db.query(BuildJob).filter(BuildJob.project_id == project.id).count() == 0

def test_put_device_config_conflicts_with_active_job():
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)

    active_job = BuildJob(id=str(uuid.uuid4()), project_id=project.id, status=JobStatus.building)
    db.add(active_job)
    db.commit()

    response = client.post("/api/v1/auth/token", data={"username": "admin", "password": "password"})
    token = response.json()["access_token"]

    payload = {
        "password": "password",
        "pins": [
            {"gpio": 2, "mode": "OUTPUT", "label": "LED"}
        ]
    }

    res = client.put(
        f"/api/v1/device/{device.device_id}/config",
        json=payload,
        headers={"Authorization": f"Bearer {token}"}
    )

    assert res.status_code == 409
    assert res.json()["detail"]["error"] == "conflict"

def test_ota_download_unauthenticated_not_ready():
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)

    job_id = str(uuid.uuid4())
    job = BuildJob(id=job_id, project_id=project.id, status=JobStatus.building)
    db.add(job)
    db.commit()

    # Request without token should fail validation (422)
    res_no_token = client.get(f"/api/v1/diy/ota/download/{job_id}/firmware.bin")
    assert res_no_token.status_code == 422

    # Request with invalid token should fail auth (401)
    res_invalid_token = client.get(f"/api/v1/diy/ota/download/{job_id}/firmware.bin?token=invalid_token")
    assert res_invalid_token.status_code == 401

    # Request with valid token but job not ready should fail (400)
    valid_token = create_ota_token(job_id)
    res = client.get(f"/api/v1/diy/ota/download/{job_id}/firmware.bin?token={valid_token}")
    
    # Should say artifact not ready
    assert res.status_code == 400
    assert "Artifact not ready" in res.json()["detail"]


from unittest.mock import patch


def test_legacy_ota_endpoints_are_locked():
    upload_res = client.post(
        "/api/v1/ota/upload?version=1.0.0&board=esp32",
        files={"file": ("firmware.bin", b"firmware", "application/octet-stream")},
    )
    assert upload_res.status_code == 410
    assert upload_res.json()["detail"]["error"] == "disabled"

    latest_res = client.get("/api/v1/ota/latest/esp32")
    assert latest_res.status_code == 410
    assert latest_res.json()["detail"]["error"] == "disabled"

    download_res = client.get("/api/v1/ota/download/firmware.bin")
    assert download_res.status_code == 410
    assert download_res.json()["detail"]["error"] == "disabled"

def test_send_command_ota_publish_success(tmp_path):
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)
    
    job_id = str(uuid.uuid4())
    job = BuildJob(
        id=job_id,
        project_id=project.id,
        status=JobStatus.artifact_ready,
        artifact_path=_write_test_artifact(tmp_path, job_id),
    )
    db.add(job)
    db.commit()

    response = client.post("/api/v1/auth/token", data={"username": "admin", "password": "password"})
    token = response.json()["access_token"]

    payload = {"action": "ota", "job_id": job_id, "url": "http://test"}

    with patch('app.api.mqtt_manager.publish_command', return_value=True):
        res = client.post(
            f"/api/v1/device/{device.device_id}/command",
            json=payload,
            headers={"Authorization": f"Bearer {token}"}
        )
    
    assert res.status_code == 200
    db.refresh(job)
    assert job.status == JobStatus.flashing

def test_send_command_ota_publish_failure(tmp_path):
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)
    
    job_id = str(uuid.uuid4())
    job = BuildJob(
        id=job_id,
        project_id=project.id,
        status=JobStatus.artifact_ready,
        artifact_path=_write_test_artifact(tmp_path, job_id),
    )
    db.add(job)
    db.commit()

    response = client.post("/api/v1/auth/token", data={"username": "admin", "password": "password"})
    token = response.json()["access_token"]

    payload = {"action": "ota", "job_id": job_id, "url": "http://test"}

    with patch('app.api.mqtt_manager.publish_command', return_value=False):
        res = client.post(
            f"/api/v1/device/{device.device_id}/command",
            json=payload,
            headers={"Authorization": f"Bearer {token}"}
        )
    
    db.refresh(job)
    assert job.status == JobStatus.flash_failed
    assert "Failed to publish" in job.error_message

def test_send_command_ota_retry_after_flash_failed_reuses_artifact(tmp_path):
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)

    job_id = str(uuid.uuid4())
    failed_at = datetime.utcnow()
    job = BuildJob(
        id=job_id,
        project_id=project.id,
        status=JobStatus.flash_failed,
        artifact_path=_write_test_artifact(tmp_path, job_id),
        error_message="HTTP timeout",
        finished_at=failed_at,
    )
    db.add(job)
    db.commit()

    response = client.post("/api/v1/auth/token", data={"username": "admin", "password": "password"})
    token = response.json()["access_token"]

    payload = {"action": "ota", "job_id": job_id, "url": "http://test"}

    with patch("app.api.mqtt_manager.publish_command", return_value=True):
        res = client.post(
            f"/api/v1/device/{device.device_id}/command",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )

    assert res.status_code == 200, res.text
    db.refresh(job)
    assert job.status == JobStatus.flashing
    assert job.error_message is None
    assert job.finished_at is None

def test_send_command_ota_rejects_wrong_project_job():
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)

    other_project = DiyProject(
        id=str(uuid.uuid4()),
        user_id=user.user_id,
        room_id=room.room_id,
        name="Other Project",
        board_profile="esp32",
        config={"wifi_ssid": "test", "wifi_password": "test", "pins": [{"gpio": 2, "mode": "OUTPUT", "label": "LED"}]},
    )
    db.add(other_project)
    db.commit()

    job_id = str(uuid.uuid4())
    wrong_job = BuildJob(id=job_id, project_id=other_project.id, status=JobStatus.artifact_ready)
    db.add(wrong_job)
    db.commit()

    response = client.post("/api/v1/auth/token", data={"username": "admin", "password": "password"})
    token = response.json()["access_token"]

    payload = {"action": "ota", "job_id": job_id, "url": "http://test"}
    res = client.post(
        f"/api/v1/device/{device.device_id}/command",
        json=payload,
        headers={"Authorization": f"Bearer {token}"}
    )

    assert res.status_code == 400
    assert "does not belong to the target device" in res.json()["detail"]

def test_mqtt_process_ota_status():
    from app.mqtt import MQTTClientManager
    import json
    from unittest.mock import MagicMock
    
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)

    job_id = str(uuid.uuid4())
    job = BuildJob(id=job_id, project_id=project.id, status=JobStatus.flashing)
    db.add(job)
    db.commit()

    mgr = MQTTClientManager()
    
    # Mock db to prevent .close() from destroying our test db connection
    db_mock = MagicMock(wraps=db)
    db_mock.close = MagicMock()

    # simulate success
    payload_success = json.dumps({"event": "ota_status", "job_id": job_id, "status": "success"})
    
    # Hack the db session in MQTT manager just for this test
    with patch('app.mqtt.SessionLocal', return_value=db_mock):
        mgr.process_state_message(device.device_id, payload_success)
    
    db.refresh(job)
    assert job.status == JobStatus.flashed

    # setup another job for failure
    job2_id = str(uuid.uuid4())
    job2 = BuildJob(id=job2_id, project_id=project.id, status=JobStatus.flashing)
    db.add(job2)
    db.commit()

    # simulate failure
    payload_fail = json.dumps({"event": "ota_status", "job_id": job2_id, "status": "failed", "message": "HTTP error"})
    with patch('app.mqtt.SessionLocal', return_value=db_mock):
        mgr.process_state_message(device.device_id, payload_fail)

    db.refresh(job2)
    assert job2.status == JobStatus.flash_failed
    assert job2.error_message == "HTTP error"


def test_mqtt_state_multi_pin_payload_acknowledges_pending_command():
    from app.mqtt import MQTTClientManager
    from unittest.mock import MagicMock

    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)

    mgr = MQTTClientManager()
    mgr.pending_commands["cmd-1"] = {
        "device_id": device.device_id,
        "pin": 2,
        "value": 1,
        "brightness": None,
        "timestamp": datetime.utcnow().timestamp(),
        "command_id": "cmd-1",
    }

    db_mock = MagicMock(wraps=db)
    db_mock.close = MagicMock()

    payload = json.dumps(
        {
            "kind": "state",
            "device_id": device.device_id,
            "applied": True,
            "pins": [
                {"pin": 2, "mode": "OUTPUT", "label": "LED", "value": 1},
                {"pin": 8, "mode": "PWM", "label": "Dimmer", "value": 0, "brightness": 0},
            ],
        }
    )

    with patch("app.mqtt.SessionLocal", return_value=db_mock), \
         patch("app.mqtt.ws_manager.broadcast_device_event_sync") as broadcast_sync:
        mgr.process_state_message(device.device_id, payload)

    assert "cmd-1" not in mgr.pending_commands
    broadcast_sync.assert_any_call(
        "command_delivery",
        device.device_id,
        None,
        {
            "command_id": "cmd-1",
            "status": "acknowledged",
            "reason": "state_match",
        },
    )


def test_mqtt_state_unknown_device_requests_repair():
    from app.mqtt import MQTTClientManager
    from unittest.mock import MagicMock

    db = TestingSessionLocal()
    mgr = MQTTClientManager()
    mgr.publish_json = MagicMock(return_value=True)
    db_mock = MagicMock(wraps=db)
    db_mock.close = MagicMock()

    payload = json.dumps({"kind": "state", "device_id": "missing-device"})
    with patch('app.mqtt.SessionLocal', return_value=db_mock):
        mgr.process_state_message("missing-device", payload)

    mgr.publish_json.assert_called_once()
    topic, ack_payload = mgr.publish_json.call_args.args[:2]
    assert topic == mgr.state_ack_topic("missing-device")
    assert ack_payload["status"] == "re_pair_required"
    assert ack_payload["reason"] == "unknown_device"


def test_mqtt_enqueue_command_skips_wait_for_publish():
    from app.mqtt import MQTTClientManager
    from unittest.mock import MagicMock

    mgr = MQTTClientManager()
    mgr.publish_json = MagicMock(return_value=True)
    payload = {"kind": "action", "pin": 3, "value": 1}

    assert mgr.enqueue_command("device-123", payload) is True
    mgr.publish_json.assert_called_once_with(
        mgr.command_topic("device-123"),
        payload,
        wait_for_publish=False,
    )


def test_mqtt_state_automation_dispatch_uses_enqueue_command():
    from app.mqtt import MQTTClientManager
    from unittest.mock import MagicMock

    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)

    mgr = MQTTClientManager()
    mgr.publish_json = MagicMock(return_value=True)
    db_mock = MagicMock(wraps=db)
    db_mock.close = MagicMock()

    def fake_process_state_event_for_automations(
        db_arg,
        *,
        device_id,
        state_payload,
        publish_command,
        triggered_at=None,
    ):
        assert device_id == device.device_id
        assert publish_command(
            device_id,
            {"kind": "action", "pin": 2, "value": 1},
        )
        return []

    payload = json.dumps({"pins": [{"pin": 2, "value": 1}]})
    with patch("app.mqtt.SessionLocal", return_value=db_mock):
        with patch(
            "app.mqtt.process_state_event_for_automations",
            side_effect=fake_process_state_event_for_automations,
        ):
            mgr.process_state_message(device.device_id, payload)

    mgr.publish_json.assert_called_once_with(
        mgr.command_topic(device.device_id),
        {"kind": "action", "pin": 2, "value": 1},
        wait_for_publish=False,
    )


def test_mqtt_state_hidden_pending_device_requests_repair():
    from app.mqtt import MQTTClientManager
    from unittest.mock import MagicMock

    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)
    device.auth_status = AuthStatus.pending
    db.commit()

    mgr = MQTTClientManager()
    mgr.publish_json = MagicMock(return_value=True)

    db_mock = MagicMock(wraps=db)
    db_mock.close = MagicMock()

    payload = json.dumps({"kind": "state", "device_id": device.device_id})
    with patch('app.mqtt.SessionLocal', return_value=db_mock):
        mgr.process_state_message(device.device_id, payload)

    mgr.publish_json.assert_called_once()
    topic, ack_payload = mgr.publish_json.call_args.args[:2]
    assert topic == mgr.state_ack_topic(device.device_id)
    assert ack_payload["status"] == "re_pair_required"
    assert ack_payload["reason"] == "not_approved"
    assert ack_payload["auth_status"] == "pending"


def test_mqtt_state_active_pending_device_stays_waiting_for_approval():
    from app.mqtt import MQTTClientManager
    from unittest.mock import MagicMock

    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)
    device.auth_status = AuthStatus.pending
    device.pairing_requested_at = datetime.utcnow()
    db.commit()

    mgr = MQTTClientManager()
    mgr.publish_json = MagicMock(return_value=True)

    db_mock = MagicMock(wraps=db)
    db_mock.close = MagicMock()

    payload = json.dumps({"kind": "state", "device_id": device.device_id})
    with patch('app.mqtt.SessionLocal', return_value=db_mock):
        mgr.process_state_message(device.device_id, payload)

    mgr.publish_json.assert_called_once()
    topic, ack_payload = mgr.publish_json.call_args.args[:2]
    assert topic == mgr.state_ack_topic(device.device_id)
    assert ack_payload["status"] == "awaiting_approval"
    assert ack_payload["reason"] == "active_pairing_request"
    assert ack_payload["auth_status"] == "pending"
    assert ack_payload["pairing_requested_at"] is not None


def test_mqtt_state_firmware_network_mismatch_requires_manual_reflash():
    from app.mqtt import MQTTClientManager
    from unittest.mock import MagicMock

    db = TestingSessionLocal()
    _user, _room, _project, device = create_test_data(db)

    mgr = MQTTClientManager()
    mgr.publish_json = MagicMock(return_value=True)
    mgr.set_runtime_network_state(
        {
            "source": "startup_auto",
            "targets": {
                "advertised_host": "192.168.8.4",
                "api_base_url": "https://192.168.8.4:3000/api/v1",
                "mqtt_broker": "mqtt-lan.local",
                "mqtt_port": 2883,
            },
            "error": None,
        }
    )

    db_mock = MagicMock(wraps=db)
    db_mock.close = MagicMock()

    payload = json.dumps(
        {
            "kind": "state",
            "device_id": device.device_id,
            "firmware_network": {
                "api_base_url": "https://192.168.2.16:3000/api/v1",
                "mqtt_broker": "192.168.2.16",
                "mqtt_port": 1883,
            },
        }
    )
    with patch("app.mqtt.SessionLocal", return_value=db_mock):
        mgr.process_state_message(device.device_id, payload)

    mgr.publish_json.assert_called_once()
    topic, ack_payload = mgr.publish_json.call_args.args[:2]
    assert topic == mgr.state_ack_topic(device.device_id)
    assert ack_payload["status"] == "manual_reflash_required"
    assert ack_payload["reason"] == "firmware_network_mismatch"
    assert ack_payload["runtime_network"]["mqtt_broker"] == "mqtt-lan.local"
    assert ack_payload["runtime_network"]["mqtt_port"] == 2883
    assert "Manual reflash is required" in ack_payload["message"]


def test_mqtt_state_rejected_device_reports_pairing_rejected():
    from app.mqtt import MQTTClientManager
    from unittest.mock import MagicMock

    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)
    device.auth_status = AuthStatus.rejected
    db.commit()

    mgr = MQTTClientManager()
    mgr.publish_json = MagicMock(return_value=True)

    db_mock = MagicMock(wraps=db)
    db_mock.close = MagicMock()

    payload = json.dumps({"kind": "state", "device_id": device.device_id})
    with patch('app.mqtt.SessionLocal', return_value=db_mock):
        mgr.process_state_message(device.device_id, payload)

    mgr.publish_json.assert_called_once()
    topic, ack_payload = mgr.publish_json.call_args.args[:2]
    assert topic == mgr.state_ack_topic(device.device_id)
    assert ack_payload["status"] == "pairing_rejected"
    assert ack_payload["reason"] == "admin_rejected"
    assert ack_payload["auth_status"] == "rejected"


def test_mqtt_register_firmware_network_mismatch_requires_manual_reflash():
    from app.mqtt import MQTTClientManager
    from unittest.mock import MagicMock

    db = TestingSessionLocal()
    _user, _room, _project, device = create_test_data(db)

    mgr = MQTTClientManager()
    mgr.publish_json = MagicMock(return_value=True)
    mgr.set_runtime_network_state(
        {
            "source": "startup_auto",
            "targets": {
                "advertised_host": "192.168.8.4",
                "api_base_url": "https://192.168.8.4:3000/api/v1",
                "mqtt_broker": "mqtt-lan.local",
                "mqtt_port": 2883,
            },
            "error": None,
        }
    )

    payload = json.dumps(
        {
            "device_id": device.device_id,
            "mac_address": device.mac_address,
            "name": device.name,
            "mode": "no-code",
            "firmware_version": "build-old1234",
            "firmware_network": {
                "api_base_url": "https://192.168.2.16:3000/api/v1",
                "mqtt_broker": "192.168.2.16",
                "mqtt_port": 1883,
            },
        }
    )

    ack_payload = mgr.process_registration_message(device.device_id, payload)

    mgr.publish_json.assert_called_once()
    topic, published_payload = mgr.publish_json.call_args.args[:2]
    assert topic == mgr.registration_ack_topic(device.device_id)
    assert ack_payload == published_payload
    assert ack_payload["status"] == "manual_reflash_required"
    assert ack_payload["reason"] == "firmware_network_mismatch"
    assert ack_payload["runtime_network"]["advertised_host"] == "192.168.8.4"
    assert ack_payload["runtime_network"]["mqtt_broker"] == "mqtt-lan.local"


def test_mqtt_register_success_ack_can_exceed_legacy_512_byte_parser_budget():
    from app.mqtt import MQTTClientManager
    from unittest.mock import MagicMock

    db = TestingSessionLocal()
    _user, _room, project, device = create_test_data(db)

    mgr = MQTTClientManager()
    mgr.publish_json = MagicMock(return_value=True)
    long_host = "smart-home-lab-bridge-bridge-bridge-bridge-bridge-bridge-gateway.local"
    long_mqtt_broker = f"mqtt-{long_host}"
    long_api_base = f"https://{long_host}:3000/api/v1"
    mgr.set_runtime_network_state(
        {
            "source": "startup_auto",
            "targets": {
                "advertised_host": long_host,
                "api_base_url": long_api_base,
                "mqtt_broker": long_mqtt_broker,
                "mqtt_port": 2883,
                "target_key": f"{long_host}|{long_api_base}|{long_mqtt_broker}|2883",
            },
            "error": None,
        }
    )

    db_mock = MagicMock(wraps=db)
    db_mock.close = MagicMock()
    payload = json.dumps(
        {
            "device_id": device.device_id,
            "project_id": project.id,
            "secret_key": "test-secret",
            "mac_address": device.mac_address,
            "name": device.name,
            "mode": "no-code",
            "firmware_version": "build-ack51201",
            "pins": [],
            "firmware_network": {
                "api_base_url": long_api_base,
                "mqtt_broker": long_mqtt_broker,
                "mqtt_port": 2883,
            },
        }
    )

    with patch("app.mqtt.SessionLocal", return_value=db_mock), patch(
        "app.services.device_registration.verify_project_secret",
        return_value=True,
    ):
        ack_payload = mgr.process_registration_message(device.device_id, payload)

    serialized_ack = json.dumps(ack_payload)
    mgr.publish_json.assert_called_once()
    topic, published_payload = mgr.publish_json.call_args.args[:2]
    assert topic == mgr.registration_ack_topic(device.device_id)
    assert ack_payload == published_payload
    assert ack_payload["status"] == "ok"
    assert ack_payload["secret_verified"] is True
    assert ack_payload["runtime_network"]["advertised_host"] == long_host
    assert len(serialized_ack) > 512


def test_mqtt_register_rejects_trusted_mac_mismatch_without_overwriting_identity():
    from app.mqtt import MQTTClientManager
    from unittest.mock import MagicMock

    db = TestingSessionLocal()
    _user, _room, project, device = create_test_data(db)

    mgr = MQTTClientManager()
    mgr.publish_json = MagicMock(return_value=True)
    db_mock = MagicMock(wraps=db)
    db_mock.close = MagicMock()

    payload = json.dumps(
        {
            "device_id": device.device_id,
            "project_id": project.id,
            "secret_key": "test-secret",
            "mac_address": "AA:BB:CC:99:88:77",
            "name": device.name,
            "mode": "no-code",
            "firmware_version": "build-lockmac01",
            "pins": [],
        }
    )

    with patch("app.mqtt.SessionLocal", return_value=db_mock), patch(
        "app.services.device_registration.verify_project_secret",
        return_value=True,
    ):
        ack_payload = mgr.process_registration_message(device.device_id, payload)

    mgr.publish_json.assert_called_once()
    topic, published_payload = mgr.publish_json.call_args.args[:2]
    assert topic == mgr.registration_ack_topic(device.device_id)
    assert ack_payload == published_payload
    assert ack_payload["status"] == "error"
    assert ack_payload["error"] == "unauthorized_device"
    assert "Trusted MAC address mismatch" in ack_payload["message"]

    db.refresh(device)
    assert device.mac_address == "00:11:22:33:EE:FF"
    assert device.name == "OTA Device"


def test_mqtt_reconcile_ota_success():
    from app.mqtt import MQTTClientManager
    import json
    from unittest.mock import MagicMock
    from datetime import datetime, timedelta
    
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)
    
    job_id = str(uuid.uuid4())
    job = BuildJob(id=job_id, project_id=project.id, status=JobStatus.flashing)
    job.updated_at = datetime.utcnow() - timedelta(seconds=10)
    db.add(job)
    device.provisioning_project_id = project.id
    db.commit()

    mgr = MQTTClientManager()
    db_mock = MagicMock(wraps=db)
    db_mock.close = MagicMock()

    expected_version = f"build-{job_id[:8]}"
    payload = json.dumps({"firmware_version": expected_version})
    
    with patch('app.mqtt.SessionLocal', return_value=db_mock):
        mgr.process_state_message(device.device_id, payload)
        
    db.refresh(job)
    assert job.status == JobStatus.flashed


def test_mqtt_state_persists_reported_firmware_revision():
    from app.mqtt import MQTTClientManager
    from unittest.mock import MagicMock

    db = TestingSessionLocal()
    _user, _room, _project, device = create_test_data(db)

    mgr = MQTTClientManager()
    db_mock = MagicMock(wraps=db)
    db_mock.close = MagicMock()

    payload = json.dumps(
        {
            "firmware_revision": "1.0.0",
            "firmware_version": "build-new1234",
        }
    )

    with patch("app.mqtt.SessionLocal", return_value=db_mock):
        mgr.process_state_message(device.device_id, payload)

    db.refresh(device)
    assert device.firmware_revision == "1.0.0"
    assert device.firmware_version == "build-new1234"


def test_mqtt_reconcile_ota_mismatch_recent():
    from app.mqtt import MQTTClientManager
    import json
    from unittest.mock import MagicMock
    from datetime import datetime, timedelta
    
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)
    
    job_id = str(uuid.uuid4())
    job = BuildJob(id=job_id, project_id=project.id, status=JobStatus.flashing)
    job.updated_at = datetime.utcnow() - timedelta(seconds=30) # under 60s
    db.add(job)
    device.provisioning_project_id = project.id
    db.commit()

    mgr = MQTTClientManager()
    db_mock = MagicMock(wraps=db)
    db_mock.close = MagicMock()

    payload = json.dumps({"firmware_version": "build-old1234"})
    
    with patch('app.mqtt.SessionLocal', return_value=db_mock):
        mgr.process_state_message(device.device_id, payload)
        
    db.refresh(job)
    # Should still be flashing because it hasn't been 60 seconds
    assert job.status == JobStatus.flashing


def test_mqtt_reconcile_ota_mismatch_stale():
    from app.mqtt import MQTTClientManager
    import json
    from unittest.mock import MagicMock
    from datetime import datetime, timedelta
    
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)
    
    job_id = str(uuid.uuid4())
    job = BuildJob(id=job_id, project_id=project.id, status=JobStatus.flashing)
    job.updated_at = datetime.utcnow() - timedelta(seconds=90) # over 60s
    db.add(job)
    device.provisioning_project_id = project.id
    db.commit()

    mgr = MQTTClientManager()
    db_mock = MagicMock(wraps=db)
    db_mock.close = MagicMock()

    payload = json.dumps({"firmware_version": "build-old1234"})
    
    with patch('app.mqtt.SessionLocal', return_value=db_mock):
        mgr.process_state_message(device.device_id, payload)
        
    db.refresh(job)
    # Should be rolled back to flash_failed because 90s > 60s threshold
    assert job.status == JobStatus.flash_failed
    assert "OTA timeout/reconciliation" in job.error_message


def test_mqtt_state_recent_flashed_job_mismatch_fails_immediately():
    from app.mqtt import MQTTClientManager
    import json
    from unittest.mock import MagicMock
    from datetime import datetime, timedelta

    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)

    job_id = str(uuid.uuid4())
    job = BuildJob(id=job_id, project_id=project.id, status=JobStatus.flashed)
    job.finished_at = datetime.utcnow() - timedelta(seconds=5)
    job.updated_at = job.finished_at
    db.add(job)
    device.provisioning_project_id = project.id
    db.commit()

    mgr = MQTTClientManager()
    db_mock = MagicMock(wraps=db)
    db_mock.close = MagicMock()

    payload = json.dumps({"firmware_version": "build-old1234"})

    with patch('app.mqtt.SessionLocal', return_value=db_mock):
        mgr.process_state_message(device.device_id, payload)

    db.refresh(job)
    assert job.status == JobStatus.flash_failed
    assert "OTA verification failed" in job.error_message


def test_mqtt_register_reconcile_ota_success():
    from app.mqtt import MQTTClientManager
    import json
    from unittest.mock import MagicMock
    from datetime import datetime, timedelta
    
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)
    
    job_id = str(uuid.uuid4())
    job = BuildJob(id=job_id, project_id=project.id, status=JobStatus.flashing)
    job.updated_at = datetime.utcnow() - timedelta(seconds=10)
    db.add(job)
    device.provisioning_project_id = project.id
    db.commit()

    mgr = MQTTClientManager()
    db_mock = MagicMock(wraps=db)
    db_mock.close = MagicMock()

    expected_version = f"build-{job_id[:8]}"
    payload = json.dumps({
        "device_id": device.device_id,
        "mac_address": device.mac_address,
        "name": device.name,
        "firmware_version": expected_version
    })
    
    with patch('app.mqtt.SessionLocal', return_value=db_mock), \
         patch('app.services.device_registration.verify_project_secret', return_value=True):
        mgr.process_registration_message(device.device_id, payload)
        
    db.refresh(job)
    assert job.status == JobStatus.flashed


def test_mqtt_register_reconcile_ota_mismatch_recent():
    from app.mqtt import MQTTClientManager
    import json
    from unittest.mock import MagicMock
    from datetime import datetime, timedelta
    
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)
    
    job_id = str(uuid.uuid4())
    job = BuildJob(id=job_id, project_id=project.id, status=JobStatus.flashing)
    job.updated_at = datetime.utcnow() - timedelta(seconds=30) # under 60s
    db.add(job)
    device.provisioning_project_id = project.id
    db.commit()

    mgr = MQTTClientManager()
    db_mock = MagicMock(wraps=db)
    db_mock.close = MagicMock()

    payload = json.dumps({
        "device_id": device.device_id,
        "mac_address": device.mac_address,
        "name": device.name,
        "firmware_version": "build-old1234"
    })
    with patch('app.mqtt.SessionLocal', return_value=db_mock), \
         patch('app.services.device_registration.verify_project_secret', return_value=True):
        mgr.process_registration_message(device.device_id, payload)
        
    db.refresh(job)
    assert job.status == JobStatus.flashing


def test_mqtt_register_reconcile_ota_mismatch_stale():
    from app.mqtt import MQTTClientManager
    import json
    from unittest.mock import MagicMock
    from datetime import datetime, timedelta
    
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)
    
    job_id = str(uuid.uuid4())
    job = BuildJob(id=job_id, project_id=project.id, status=JobStatus.flashing)
    job.updated_at = datetime.utcnow() - timedelta(seconds=90) # over 60s
    db.add(job)
    device.provisioning_project_id = project.id
    db.commit()

    mgr = MQTTClientManager()
    db_mock = MagicMock(wraps=db)
    db_mock.close = MagicMock()

    payload = json.dumps({
        "device_id": device.device_id,
        "mac_address": device.mac_address,
        "name": device.name,
        "firmware_version": "build-old1234"
    })
    with patch('app.mqtt.SessionLocal', return_value=db_mock), \
         patch('app.services.device_registration.verify_project_secret', return_value=True):
        mgr.process_registration_message(device.device_id, payload)
        
    db.refresh(job)
    assert job.status == JobStatus.flash_failed
    assert "OTA timeout/reconciliation" in job.error_message


def test_mqtt_register_recent_flashed_job_keeps_board_reported_pin_map_on_old_firmware():
    from app.mqtt import MQTTClientManager
    import json
    from unittest.mock import MagicMock
    from datetime import datetime, timedelta

    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)

    job_id = str(uuid.uuid4())
    job = BuildJob(id=job_id, project_id=project.id, status=JobStatus.flashed)
    job.finished_at = datetime.utcnow() - timedelta(seconds=5)
    job.updated_at = job.finished_at
    db.add(job)
    device.provisioning_project_id = project.id
    db.commit()

    mgr = MQTTClientManager()
    db_mock = MagicMock(wraps=db)
    db_mock.close = MagicMock()

    payload = json.dumps({
        "device_id": device.device_id,
        "mac_address": device.mac_address,
        "name": device.name,
        "mode": "no-code",
        "firmware_version": "build-old1234",
        "pins": [{"gpio_pin": 2, "mode": "OUTPUT", "label": "Old Relay"}],
    })

    with patch('app.mqtt.SessionLocal', return_value=db_mock), \
         patch('app.services.device_registration.verify_project_secret', return_value=True):
        mgr.process_registration_message(device.device_id, payload)

    db.refresh(job)
    db.refresh(device)
    assert job.status == JobStatus.flash_failed
    assert "OTA verification failed" in job.error_message
    assert len(device.pin_configurations) == 1
    assert device.pin_configurations[0].gpio_pin == 2
    assert device.pin_configurations[0].mode == "OUTPUT"
    assert device.pin_configurations[0].label == "Old Relay"
