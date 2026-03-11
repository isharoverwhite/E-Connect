from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from main import app
from app.auth import create_access_token
from app.database import Base, get_db
from app.sql_models import (
    AccountType,
    BuildJob,
    Household,
    HouseholdMembership,
    HouseholdRole,
    JobStatus,
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


def _create_project(headers: dict[str, str], *, board_profile: str = "dfrobot-beetle-esp32-c3", config: dict | None = None) -> str:
    response = client.post(
        "/api/v1/diy/projects",
        headers=headers,
        json={
            "name": "DIY Node",
            "board_profile": board_profile,
            "config": config or {"pins": [{"gpio": 2, "mode": "OUTPUT", "function": "relay"}]},
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
    log_path = artifact_dir / f"{job_id}.log"
    artifact_path.write_bytes(b"firmware-bytes")
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
    project_id = _create_project(headers)

    build_response = client.post(f"/api/v1/diy/build?project_id={project_id}", headers=headers)
    assert build_response.status_code == 200, build_response.text
    job_id = build_response.json()["id"]

    job_response = client.get(f"/api/v1/diy/build/{job_id}", headers=headers)
    assert job_response.status_code == 200
    assert job_response.json()["status"] == "artifact_ready"

    artifact_response = client.get(f"/api/v1/diy/build/{job_id}/artifact", headers=headers)
    assert artifact_response.status_code == 200
    assert artifact_response.content == b"firmware-bytes"

    logs_response = client.get(f"/api/v1/diy/build/{job_id}/logs", headers=headers)
    assert logs_response.status_code == 200
    assert "builder-finished" in logs_response.json()["logs"]


def test_diy_build_rejects_reserved_pin():
    user = _seed_user("validator")
    headers = _auth_headers(user)
    project_id = _create_project(
        headers,
        board_profile="esp32-c3-devkitm-1",
        config={"pins": [{"gpio": 9, "mode": "OUTPUT", "function": "relay"}]},
    )

    build_response = client.post(f"/api/v1/diy/build?project_id={project_id}", headers=headers)
    assert build_response.status_code == 400
    payload = build_response.json()["detail"]
    assert payload["error"] == "validation"
    assert any("reserved" in message for message in payload["messages"])


def test_serial_lock_is_persisted_and_conflicts_by_port(monkeypatch):
    monkeypatch.setattr("app.api.build_firmware_task", _fake_builder)
    owner = _seed_user("owner")
    other = _seed_user("other")
    owner_headers = _auth_headers(owner)
    other_headers = _auth_headers(other)

    project_id = _create_project(owner_headers)
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
