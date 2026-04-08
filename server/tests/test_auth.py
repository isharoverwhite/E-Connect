# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

import pytest
from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    ACCESS_TOKEN_TYPE,
    ALGORITHM,
    REFRESH_TOKEN_EXPIRE_MINUTES,
    REFRESH_TOKEN_TYPE,
    SECRET_KEY,
    create_access_token,
)
from main import app
from app.database import Base, get_db
from app.sql_models import User, AccountType

# Keep auth tests in memory to avoid workspace disk growth during CI.
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
            "account_type": "parent",
            "ui_layout": {}
        }
    )
    assert create_resp.status_code == 200
    data = create_resp.json()
    assert data["username"] == "child1"
    assert data["account_type"] == "parent"

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
        json={"fullname": "User 1", "username": "user1", "password": "password123", "account_type": "parent"}
    )
    assert create_resp.status_code == 200
    created_user = create_resp.json()

    # 3. Login as User
    login_resp = client.post("/api/v1/auth/token", data={"username": "user1", "password": "password123"})
    assert login_resp.status_code == 200
    token_user = login_resp.json()["access_token"]
    
    # 4. Try to create another user
    create_resp = client.post(
        "/api/v1/users",
        headers={"Authorization": f"Bearer {token_user}"},
        json={"fullname": "User 2", "username": "user2", "password": "password", "account_type": "parent"}
    )
    assert create_resp.status_code == 403
    assert create_resp.json()["detail"] == "Admin or Owner privileges required"

def test_unauthenticated_cannot_create_user():
    create_resp = client.post(
        "/api/v1/users",
        json={"fullname": "User 2", "username": "user2", "password": "password", "account_type": "parent"}
    )
    assert create_resp.status_code == 401


def test_admin_created_user_can_log_in_immediately():
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

    approved_login = client.post("/api/v1/auth/token", data={"username": "pending1", "password": "password123"})
    assert approved_login.status_code == 200


def test_deleted_user_cannot_access_authenticated_routes():
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

    user_login = client.post("/api/v1/auth/token", data={"username": "revoked1", "password": "password123"})
    assert user_login.status_code == 200
    user_token = user_login.json()["access_token"]

    revoke_resp = client.delete(
        f"/api/v1/users/{created['user_id']}",
        headers={"Authorization": f"Bearer {token_admin}"},
    )
    assert revoke_resp.status_code == 200

    login_again = client.post("/api/v1/auth/token", data={"username": "revoked1", "password": "password123"})
    assert login_again.status_code == 401
    assert login_again.json()["detail"] == "Incorrect username or password"

    me_resp = client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {user_token}"})
    assert me_resp.status_code == 401
    assert me_resp.json()["detail"] == "Could not validate credentials"

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


def test_login_returns_refresh_token_and_expiry_metadata():
    client.post(
        "/api/v1/auth/initialserver",
        json={"fullname": "Admin", "username": "admin", "password": "password", "ui_layout": {}}
    )

    login_resp = client.post(
        "/api/v1/auth/token",
        data={"username": "admin", "password": "password"}
    )

    assert login_resp.status_code == 200
    payload = login_resp.json()
    assert payload["token_type"] == "bearer"
    assert payload["keep_login"] is False
    assert payload["refresh_token"]
    assert payload["access_token_expires_at"] is not None
    assert payload["refresh_token_expires_at"] is not None

    access_claims = jwt.decode(payload["access_token"], SECRET_KEY, algorithms=[ALGORITHM])
    refresh_claims = jwt.decode(payload["refresh_token"], SECRET_KEY, algorithms=[ALGORITHM])

    assert access_claims["type"] == ACCESS_TOKEN_TYPE
    assert refresh_claims["type"] == REFRESH_TOKEN_TYPE

    access_expires_at = datetime.fromisoformat(payload["access_token_expires_at"].replace("Z", "+00:00"))
    refresh_expires_at = datetime.fromisoformat(payload["refresh_token_expires_at"].replace("Z", "+00:00"))
    now = datetime.now(timezone.utc)

    assert timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES - 1) <= (access_expires_at - now) <= timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES + 1)
    assert timedelta(minutes=REFRESH_TOKEN_EXPIRE_MINUTES - 1) <= (refresh_expires_at - now) <= timedelta(minutes=REFRESH_TOKEN_EXPIRE_MINUTES + 1)


def test_refresh_endpoint_rotates_non_persistent_session():
    client.post(
        "/api/v1/auth/initialserver",
        json={"fullname": "Admin", "username": "admin", "password": "password", "ui_layout": {}}
    )

    login_resp = client.post(
        "/api/v1/auth/token",
        data={"username": "admin", "password": "password"}
    )
    session = login_resp.json()

    refresh_resp = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": session["refresh_token"]},
    )

    assert refresh_resp.status_code == 200
    rotated = refresh_resp.json()
    assert rotated["keep_login"] is False
    assert rotated["access_token"] != session["access_token"]
    assert rotated["refresh_token"] != session["refresh_token"]

    me_resp = client.get(
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {rotated['access_token']}"},
    )
    assert me_resp.status_code == 200
    assert me_resp.json()["username"] == "admin"


def test_users_me_layout_update_persists_canvas_layout():
    client.post(
        "/api/v1/auth/initialserver",
        json={"fullname": "Admin", "username": "admin", "password": "password", "ui_layout": {}}
    )

    login_resp = client.post(
        "/api/v1/auth/token",
        data={"username": "admin", "password": "password"}
    )
    token = login_resp.json()["access_token"]
    layout = {
        "device-living": {"x": 12, "y": 24, "w": 320, "h": 180},
        "device-kitchen": {"x": 360, "y": 24, "w": 280, "h": 180},
    }

    update_resp = client.put(
        "/api/v1/users/me/layout",
        headers={"Authorization": f"Bearer {token}"},
        json=layout,
    )

    assert update_resp.status_code == 200
    assert update_resp.json()["ui_layout"] == layout

    me_resp = client.get(
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert me_resp.status_code == 200
    assert me_resp.json()["ui_layout"] == layout


def test_refresh_endpoint_rejects_access_token_payload():
    client.post(
        "/api/v1/auth/initialserver",
        json={"fullname": "Admin", "username": "admin", "password": "password", "ui_layout": {}}
    )

    login_resp = client.post(
        "/api/v1/auth/token",
        data={"username": "admin", "password": "password"}
    )

    refresh_resp = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": login_resp.json()["access_token"]},
    )

    assert refresh_resp.status_code == 401
    assert refresh_resp.json()["detail"]["error"] == "invalid_refresh_token"


def test_keep_login_returns_persistent_session_tokens():
    client.post(
        "/api/v1/auth/initialserver",
        json={"fullname": "Admin", "username": "admin", "password": "password", "ui_layout": {}}
    )

    login_resp = client.post(
        "/api/v1/auth/token",
        data={"username": "admin", "password": "password", "keep_login": "true"}
    )

    assert login_resp.status_code == 200
    payload = login_resp.json()
    assert payload["keep_login"] is True
    assert payload["access_token_expires_at"] is None
    assert payload["refresh_token_expires_at"] is None

    access_claims = jwt.get_unverified_claims(payload["access_token"])
    refresh_claims = jwt.get_unverified_claims(payload["refresh_token"])

    assert access_claims["type"] == ACCESS_TOKEN_TYPE
    assert refresh_claims["type"] == REFRESH_TOKEN_TYPE
    assert "exp" not in access_claims
    assert "exp" not in refresh_claims


def test_deleted_user_cannot_refresh_existing_session():
    client.post(
        "/api/v1/auth/initialserver",
        json={"fullname": "Admin", "username": "admin", "password": "password", "ui_layout": {}}
    )
    token_admin = client.post("/api/v1/auth/token", data={"username": "admin", "password": "password"}).json()["access_token"]

    create_resp = client.post(
        "/api/v1/users",
        headers={"Authorization": f"Bearer {token_admin}"},
        json={"fullname": "Revoked User", "username": "revoked2", "password": "password123", "account_type": "parent"}
    )
    created = create_resp.json()

    user_login = client.post(
        "/api/v1/auth/token",
        data={"username": "revoked2", "password": "password123"},
    )
    assert user_login.status_code == 200

    revoke_resp = client.delete(
        f"/api/v1/users/{created['user_id']}",
        headers={"Authorization": f"Bearer {token_admin}"},
    )
    assert revoke_resp.status_code == 200

    refresh_resp = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": user_login.json()["refresh_token"]},
    )
    assert refresh_resp.status_code == 401
    assert refresh_resp.json()["detail"]["error"] == "invalid_refresh_token"


def test_create_access_token_still_honors_explicit_override():
    token = create_access_token({"sub": "admin"}, expires_delta=timedelta(minutes=5))
    claims = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    expires_at = datetime.fromtimestamp(claims["exp"], tz=timezone.utc)
    remaining = expires_at - datetime.now(timezone.utc)

    assert timedelta(minutes=4) <= remaining <= timedelta(minutes=6)
