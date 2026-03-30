import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from main import app
from app.database import Base, get_db
from app.auth import create_access_token
from app.sql_models import User, Household, HouseholdMembership, HouseholdRole, AccountType, Automation, AutomationExecutionLog, ExecutionStatus

# Keep automation tests in memory to avoid workspace disk growth during CI.
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

client = TestClient(app)

@pytest.fixture(autouse=True)
def override_dependencies():
    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.clear()

@pytest.fixture(scope="module")
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    
    # Create test user
    user = User(
        fullname="Test User",
        username="testuser",
        authentication="hashed_pass",
        account_type=AccountType.admin
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    household = Household(name="Test Household")
    db.add(household)
    db.commit()
    
    membership = HouseholdMembership(
        household_id=household.household_id,
        user_id=user.user_id,
        role=HouseholdRole.owner
    )
    db.add(membership)
    
    # Create valid automation
    auto1 = Automation(
        creator_id=user.user_id,
        name="Print Happy",
        script_code="print('Hello World')\nresult=1+1"
    )
    # Create failing automation
    auto2 = Automation(
        creator_id=user.user_id,
        name="Crash",
        script_code="print('Gonna crash')\n1/0"
    )
    
    db.add(auto1)
    db.add(auto2)
    db.commit()
    
    yield {"user": user, "auto1_id": auto1.id, "auto2_id": auto2.id}
    
    # Teardown
    Base.metadata.drop_all(bind=engine)

def _auth_headers(user: User) -> dict[str, str]:
    token = create_access_token(
        {
            "sub": user.username,
            "account_type": user.account_type.value,
            "household_id": 1,
            "household_role": "owner",
        }
    )
    return {"Authorization": f"Bearer {token}"}


def test_trigger_is_blocked_without_sandbox(setup_db):
    user = setup_db["user"]
    auto_id = setup_db["auto1_id"]

    response = client.post(
        f"/api/v1/automation/{auto_id}/trigger",
        headers=_auth_headers(user),
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "failed"
    assert "log" in data
    assert data["log"]["status"] == "failed"
    assert "sandbox" in data["message"].lower()
    assert "sandbox" in data["log"]["error_message"].lower()
    assert "Execution skipped by policy" in data["log"]["log_output"]
    assert "Hello World" not in data["log"]["log_output"]


def test_trigger_records_blocked_execution_log(setup_db):
    user = setup_db["user"]
    auto_id = setup_db["auto2_id"]

    response = client.post(
        f"/api/v1/automation/{auto_id}/trigger",
        headers=_auth_headers(user),
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "failed"
    assert data["log"]["status"] == "failed"
    assert "sandbox" in data["log"]["error_message"].lower()
    assert "Gonna crash" not in data["log"]["log_output"]
    assert "ZeroDivisionError" not in data["log"]["error_message"]

    db = TestingSessionLocal()
    try:
        log = (
            db.query(AutomationExecutionLog)
            .filter(AutomationExecutionLog.automation_id == auto_id)
            .order_by(AutomationExecutionLog.id.desc())
            .first()
        )
        assert log is not None
        assert log.status == ExecutionStatus.failed
        assert "sandbox" in (log.error_message or "").lower()
    finally:
        db.close()

def test_trigger_not_found(setup_db):
    user = setup_db["user"]

    response = client.post(
        f"/api/v1/automation/999/trigger",
        headers=_auth_headers(user),
    )

    assert response.status_code == 404
    data = response.json()
    assert "not found" in data["detail"].lower()
