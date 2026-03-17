import pytest
from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.auth import ACCESS_TOKEN_EXPIRE_MINUTES, ALGORITHM, SECRET_KEY, create_access_token
from main import app
from app.database import Base, get_db
from app.services.user_management import TEMP_SUPPORT_USERNAME
from app.sql_models import User, AccountType, HouseholdMembership, HouseholdRole, UserApprovalStatus

# Create an in-memory SQLite database for testing
SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"

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

@pytest.fixture(autouse=True)
def run_before_and_after_tests(tmpdir):
    """Fixture to execute asserts before and after a test is run"""
    app.dependency_overrides[get_db] = override_get_db
    # Setup: create clean tables
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield # this is where the testing happens
    # Teardown
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)

def test_system_status_uninitialized():
    response = client.get("/api/v1/system/status")
    assert response.status_code == 200
    assert response.json() == {"initialized": False}

def test_initialserver_success():
    response = client.post(
        "/api/v1/auth/initialserver",
        json={
            "fullname": "Admin User",
            "username": "admin",
            "password": "securepassword",
            "account_type": "parent",  # Even if user tries to set non-admin
            "ui_layout": {}
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["user"]["username"] == "admin"
    assert data["user"]["account_type"] == AccountType.admin.value
    assert data["user"]["approval_status"] == UserApprovalStatus.approved.value
    assert data["household"]["name"] == "Admin User's Household"

    # System should now report as initialized
    status_resp = client.get("/api/v1/system/status")
    assert status_resp.status_code == 200
    assert status_resp.json() == {"initialized": True}

def test_initialserver_validation_failures():
    # Test short username
    short_user_resp = client.post(
        "/api/v1/auth/initialserver",
        json={
            "fullname": "Admin User",
            "username": "ad", # too short, need 3
            "password": "securepassword",
        }
    )
    assert short_user_resp.status_code == 422
    assert "String should have at least 3 characters" in short_user_resp.json()["detail"][0]["msg"]

    # Test short password
    short_pass_resp = client.post(
        "/api/v1/auth/initialserver",
        json={
            "fullname": "Admin User",
            "username": "admin",
            "password": "short", # too short, need 8
        }
    )
    assert short_pass_resp.status_code == 422
    assert "String should have at least 8 characters" in short_pass_resp.json()["detail"][0]["msg"]

def test_initialserver_second_attempt_fails():
    # First attempt
    client.post(
        "/api/v1/auth/initialserver",
        json={"fullname": "Admin 1", "username": "admin1", "password": "password", "ui_layout": {}}
    )
    
    # Second attempt
    response = client.post(
        "/api/v1/auth/initialserver",
        json={"fullname": "Admin 2", "username": "admin2", "password": "password", "ui_layout": {}}
    )
    assert response.status_code == 403
    assert response.json()["detail"]["error"] == "system_initialized"

def test_admin_can_create_user():
    # 1. Setup Admin
    client.post(
        "/api/v1/auth/initialserver",
        json={"fullname": "Admin", "username": "admin", "password": "password", "ui_layout": {}}
    )
    
    # 2. Login as Admin
    login_resp = client.post(
        "/api/v1/auth/token",
        data={"username": "admin", "password": "password"}
    )
    assert login_resp.status_code == 200
    token = login_resp.json()["access_token"]
    
    # 3. Create regular user
    create_resp = client.post(
        "/api/v1/users",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "fullname": "Child User",
            "username": "child1",
            "password": "password123",
            "account_type": "child",
            "ui_layout": {}
        }
    )
    assert create_resp.status_code == 200
    data = create_resp.json()
    assert data["username"] == "child1"
    assert data["account_type"] == "child"
    assert data["approval_status"] == UserApprovalStatus.pending.value

def test_non_admin_cannot_create_user():
    # 1. Setup Admin
    client.post(
        "/api/v1/auth/initialserver",
        json={"fullname": "Admin", "username": "admin", "password": "password", "ui_layout": {}}
    )
    # 2. Login as Admin, Create User
    token_admin = client.post("/api/v1/auth/token", data={"username": "admin", "password": "password"}).json()["access_token"]
    create_resp = client.post(
        "/api/v1/users",
        headers={"Authorization": f"Bearer {token_admin}"},
        json={"fullname": "User 1", "username": "user1", "password": "password123", "account_type": "child"}
    )
    assert create_resp.status_code == 200
    created_user = create_resp.json()

    approve_resp = client.post(
        f"/api/v1/users/{created_user['user_id']}/approve",
        headers={"Authorization": f"Bearer {token_admin}"},
    )
    assert approve_resp.status_code == 200

    # 3. Login as User
    login_resp = client.post("/api/v1/auth/token", data={"username": "user1", "password": "password123"})
    assert login_resp.status_code == 200
    token_user = login_resp.json()["access_token"]
    
    # 4. Try to create another user
    create_resp = client.post(
        "/api/v1/users",
        headers={"Authorization": f"Bearer {token_user}"},
        json={"fullname": "User 2", "username": "user2", "password": "password", "account_type": "child"}
    )
    assert create_resp.status_code == 403
    assert create_resp.json()["detail"] == "Admin or Owner privileges required"

def test_unauthenticated_cannot_create_user():
    create_resp = client.post(
        "/api/v1/users",
        json={"fullname": "User 2", "username": "user2", "password": "password", "account_type": "child"}
    )
    assert create_resp.status_code == 401


def test_pending_user_cannot_log_in_until_approved():
    client.post(
        "/api/v1/auth/initialserver",
        json={"fullname": "Admin", "username": "admin", "password": "password", "ui_layout": {}}
    )
    token_admin = client.post("/api/v1/auth/token", data={"username": "admin", "password": "password"}).json()["access_token"]

    create_resp = client.post(
        "/api/v1/users",
        headers={"Authorization": f"Bearer {token_admin}"},
        json={"fullname": "Pending User", "username": "pending1", "password": "password123", "account_type": "parent"}
    )
    assert create_resp.status_code == 200
    created = create_resp.json()
    assert created["approval_status"] == UserApprovalStatus.pending.value

    pending_login = client.post("/api/v1/auth/token", data={"username": "pending1", "password": "password123"})
    assert pending_login.status_code == 403
    assert pending_login.json()["detail"]["error"] == "approval_required"

    approve_resp = client.post(
        f"/api/v1/users/{created['user_id']}/approve",
        headers={"Authorization": f"Bearer {token_admin}"},
    )
    assert approve_resp.status_code == 200
    assert approve_resp.json()["approval_status"] == UserApprovalStatus.approved.value

    approved_login = client.post("/api/v1/auth/token", data={"username": "pending1", "password": "password123"})
    assert approved_login.status_code == 200


def test_revoked_user_cannot_access_authenticated_routes():
    client.post(
        "/api/v1/auth/initialserver",
        json={"fullname": "Admin", "username": "admin", "password": "password", "ui_layout": {}}
    )
    token_admin = client.post("/api/v1/auth/token", data={"username": "admin", "password": "password"}).json()["access_token"]

    create_resp = client.post(
        "/api/v1/users",
        headers={"Authorization": f"Bearer {token_admin}"},
        json={"fullname": "Revoked User", "username": "revoked1", "password": "password123", "account_type": "parent"}
    )
    created = create_resp.json()

    client.post(
        f"/api/v1/users/{created['user_id']}/approve",
        headers={"Authorization": f"Bearer {token_admin}"},
    )

    user_login = client.post("/api/v1/auth/token", data={"username": "revoked1", "password": "password123"})
    assert user_login.status_code == 200
    user_token = user_login.json()["access_token"]

    revoke_resp = client.post(
        f"/api/v1/users/{created['user_id']}/revoke",
        headers={"Authorization": f"Bearer {token_admin}"},
    )
    assert revoke_resp.status_code == 200
    assert revoke_resp.json()["approval_status"] == UserApprovalStatus.revoked.value

    login_again = client.post("/api/v1/auth/token", data={"username": "revoked1", "password": "password123"})
    assert login_again.status_code == 403
    assert login_again.json()["detail"]["error"] == "account_revoked"

    me_resp = client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {user_token}"})
    assert me_resp.status_code == 403
    assert me_resp.json()["detail"]["error"] == "account_revoked"


def test_initialserver_seeds_temporary_support_admin():
    client.post(
        "/api/v1/auth/initialserver",
        json={"fullname": "Admin", "username": "admin", "password": "password", "ui_layout": {}}
    )

    support_login = client.post(
        "/api/v1/auth/token",
        data={"username": "ryzen30xx", "password": "Hienkhanh69"}
    )
    assert support_login.status_code == 200

    me_resp = client.get(
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {support_login.json()['access_token']}"},
    )
    assert me_resp.status_code == 200
    assert me_resp.json()["username"] == "ryzen30xx"
    assert me_resp.json()["account_type"] == AccountType.admin.value
    assert me_resp.json()["approval_status"] == UserApprovalStatus.approved.value


def test_initialserver_with_prd_support_username_preserves_owner_membership():
    response = client.post(
        "/api/v1/auth/initialserver",
        json={"fullname": "Support Admin", "username": TEMP_SUPPORT_USERNAME, "password": "Hienkhanh69", "ui_layout": {}}
    )

    assert response.status_code == 200

    db = TestingSessionLocal()
    try:
        support_user = db.query(User).filter(User.username == TEMP_SUPPORT_USERNAME).first()
        assert support_user is not None
        assert support_user.account_type == AccountType.admin
        assert support_user.approval_status == UserApprovalStatus.approved

        membership = (
            db.query(HouseholdMembership)
            .filter(HouseholdMembership.user_id == support_user.user_id)
            .one()
        )
        assert membership.role == HouseholdRole.owner
    finally:
        db.close()


def test_login_token_uses_self_hosted_friendly_expiry():
    client.post(
        "/api/v1/auth/initialserver",
        json={"fullname": "Admin", "username": "admin", "password": "password", "ui_layout": {}}
    )

    login_resp = client.post(
        "/api/v1/auth/token",
        data={"username": "admin", "password": "password"}
    )

    assert login_resp.status_code == 200
    token = login_resp.json()["access_token"]
    claims = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    expires_at = datetime.fromtimestamp(claims["exp"], tz=timezone.utc)
    remaining = expires_at - datetime.now(timezone.utc)
    expected = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    assert expected - timedelta(minutes=1) <= remaining <= expected + timedelta(minutes=1)


def test_create_access_token_still_honors_explicit_override():
    token = create_access_token({"sub": "admin"}, expires_delta=timedelta(minutes=5))
    claims = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    expires_at = datetime.fromtimestamp(claims["exp"], tz=timezone.utc)
    remaining = expires_at - datetime.now(timezone.utc)

    assert timedelta(minutes=4) <= remaining <= timedelta(minutes=6)
