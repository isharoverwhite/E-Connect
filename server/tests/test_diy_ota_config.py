import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import uuid

from app.api import router
from app.database import Base, get_db
from app.sql_models import User, Household, HouseholdMembership, HouseholdRole, UserApprovalStatus, Room, DiyProject, BuildJob, JobStatus, Device, DeviceMode
from app.auth import get_password_hash, create_ota_token

# Setup test DB
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_diy_ota_config.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
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

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield

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
        "pins": [
            {"gpio": 2, "mode": "OUTPUT", "label": "LED"}
        ]
    }

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
        json={"pins": []},
        headers={"Authorization": f"Bearer {token}"}
    )

    assert res.status_code == 400
    assert "Not a managed DIY device" in res.json()["detail"]

def test_put_device_config_invalid_payload_does_not_persist_or_create_job():
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)

    response = client.post("/api/v1/auth/token", data={"username": "admin", "password": "password"})
    token = response.json()["access_token"]

    original_config = dict(project.config or {})
    res = client.put(
        f"/api/v1/device/{device.device_id}/config",
        json={"pins": []},
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

def test_send_command_ota_publish_success():
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)
    
    job_id = str(uuid.uuid4())
    job = BuildJob(id=job_id, project_id=project.id, status=JobStatus.artifact_ready)
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

def test_send_command_ota_publish_failure():
    db = TestingSessionLocal()
    user, room, project, device = create_test_data(db)
    
    job_id = str(uuid.uuid4())
    job = BuildJob(id=job_id, project_id=project.id, status=JobStatus.artifact_ready)
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
