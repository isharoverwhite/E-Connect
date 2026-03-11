import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from main import app
from app.database import Base, get_db
from app.sql_models import User, AccountType

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

def test_non_admin_cannot_create_user():
    # 1. Setup Admin
    client.post(
        "/api/v1/auth/initialserver",
        json={"fullname": "Admin", "username": "admin", "password": "password", "ui_layout": {}}
    )
    # 2. Login as Admin, Create User
    token_admin = client.post("/api/v1/auth/token", data={"username": "admin", "password": "password"}).json()["access_token"]
    client.post(
        "/api/v1/users",
        headers={"Authorization": f"Bearer {token_admin}"},
        json={"fullname": "User 1", "username": "user1", "password": "password123", "account_type": "child"}
    )
    
    # 3. Login as User
    token_user = client.post("/api/v1/auth/token", data={"username": "user1", "password": "password123"}).json()["access_token"]
    
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
