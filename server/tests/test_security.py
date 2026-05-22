# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

import pyotp
import pytest
from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from main import app
from app.database import Base, get_db
from app.sql_models import User
import app.api as api_module

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

HOME_LOCATION = {
    "latitude": 21.0285,
    "longitude": 105.8542,
    "label": "Hanoi",
    "source": "manual_search",
}


@pytest.fixture(autouse=True)
def reset_db():
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _setup_server(username="admin", password="securepassword"):
    resp = client.post(
        "/api/v1/auth/initialserver",
        json={
            "fullname": "Admin",
            "username": username,
            "password": password,
            "language": "en",
            "home_location": HOME_LOCATION,
        },
    )
    assert resp.status_code == 200
    return resp.json()


def _login(username="admin", password="securepassword"):
    return client.post(
        "/api/v1/auth/token",
        data={"username": username, "password": password},
    )


def _auth_header(username="admin", password="securepassword"):
    resp = _login(username, password)
    assert resp.status_code == 200
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _get_user(db, username="admin") -> User:
    return db.query(User).filter(User.username == username).first()


# ---------------------------------------------------------------------------
# Login rate limiting
# ---------------------------------------------------------------------------

class TestLoginRateLimiting:
    def test_wrong_password_returns_401(self):
        _setup_server()
        resp = _login(password="wrongpassword")
        assert resp.status_code == 401

    def test_failed_attempts_accumulate(self):
        _setup_server()
        for _ in range(3):
            resp = _login(password="wrong")
            assert resp.status_code == 401

        db = TestingSessionLocal()
        user = _get_user(db)
        assert user.failed_login_attempts == 3
        db.close()

    def test_lockout_after_max_attempts(self):
        _setup_server()
        for _ in range(api_module._MAX_LOGIN_ATTEMPTS - 1):
            resp = _login(password="wrong")
            assert resp.status_code == 401

        # The 5th attempt triggers lockout
        resp = _login(password="wrong")
        assert resp.status_code == 429
        body = resp.json()["detail"]
        assert body["error"] == "account_locked"
        assert "locked_until" in body

    def test_locked_account_rejects_correct_password(self):
        _setup_server()
        for _ in range(api_module._MAX_LOGIN_ATTEMPTS):
            _login(password="wrong")

        resp = _login(password="securepassword")
        assert resp.status_code == 429

    def test_failed_counter_resets_on_success(self):
        _setup_server()
        for _ in range(3):
            _login(password="wrong")

        resp = _login(password="securepassword")
        assert resp.status_code == 200

        db = TestingSessionLocal()
        user = _get_user(db)
        assert user.failed_login_attempts == 0
        assert user.locked_until is None
        db.close()

    def test_lockout_expires_after_window(self):
        _setup_server()
        for _ in range(api_module._MAX_LOGIN_ATTEMPTS):
            _login(password="wrong")

        # Manually expire the lockout
        db = TestingSessionLocal()
        user = _get_user(db)
        user.locked_until = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=1)
        db.commit()
        db.close()

        resp = _login(password="securepassword")
        assert resp.status_code == 200

    def test_unknown_username_returns_401_not_429(self):
        _setup_server()
        resp = _login(username="ghost", password="wrong")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# TOTP setup + enable + disable
# ---------------------------------------------------------------------------

class TestTwoFactorAuth:
    def test_totp_status_disabled_by_default(self):
        _setup_server()
        headers = _auth_header()
        resp = client.get("/api/v1/auth/totp/status", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["enabled"] is False

    def test_totp_setup_returns_secret_and_uri(self):
        _setup_server()
        headers = _auth_header()
        resp = client.get("/api/v1/auth/totp/setup", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "secret" in data
        assert "provisioning_uri" in data
        assert "otpauth://totp/" in data["provisioning_uri"]
        assert data["secret"] in data["provisioning_uri"]

    def test_enable_totp_with_valid_code(self):
        _setup_server()
        headers = _auth_header()

        setup_resp = client.get("/api/v1/auth/totp/setup", headers=headers)
        secret = setup_resp.json()["secret"]

        code = pyotp.TOTP(secret).now()
        resp = client.post("/api/v1/auth/totp/enable", json={"code": code}, headers=headers)
        assert resp.status_code == 200
        assert resp.json()["enabled"] is True

        status_resp = client.get("/api/v1/auth/totp/status", headers=headers)
        assert status_resp.json()["enabled"] is True

    def test_enable_totp_with_invalid_code_returns_400(self):
        _setup_server()
        headers = _auth_header()
        client.get("/api/v1/auth/totp/setup", headers=headers)

        resp = client.post("/api/v1/auth/totp/enable", json={"code": "000000"}, headers=headers)
        assert resp.status_code == 400

    def test_enable_without_setup_returns_400(self):
        _setup_server()
        headers = _auth_header()
        resp = client.post("/api/v1/auth/totp/enable", json={"code": "123456"}, headers=headers)
        assert resp.status_code == 400

    def test_disable_totp_with_correct_password(self):
        _setup_server()
        headers = _auth_header()

        setup_resp = client.get("/api/v1/auth/totp/setup", headers=headers)
        secret = setup_resp.json()["secret"]
        code = pyotp.TOTP(secret).now()
        client.post("/api/v1/auth/totp/enable", json={"code": code}, headers=headers)

        resp = client.request(
            "DELETE",
            "/api/v1/auth/totp/disable",
            json={"password": "securepassword"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["enabled"] is False

    def test_disable_totp_with_wrong_password_returns_401(self):
        _setup_server()
        headers = _auth_header()

        setup_resp = client.get("/api/v1/auth/totp/setup", headers=headers)
        secret = setup_resp.json()["secret"]
        code = pyotp.TOTP(secret).now()
        client.post("/api/v1/auth/totp/enable", json={"code": code}, headers=headers)

        resp = client.request(
            "DELETE",
            "/api/v1/auth/totp/disable",
            json={"password": "wrongpass"},
            headers=headers,
        )
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# TOTP login flow
# ---------------------------------------------------------------------------

class TestTotpLoginFlow:
    def _enable_2fa(self, headers) -> str:
        """Enable 2FA and return the TOTP secret."""
        setup_resp = client.get("/api/v1/auth/totp/setup", headers=headers)
        secret = setup_resp.json()["secret"]
        code = pyotp.TOTP(secret).now()
        client.post("/api/v1/auth/totp/enable", json={"code": code}, headers=headers)
        return secret

    def test_login_with_2fa_returns_require_totp(self):
        _setup_server()
        headers = _auth_header()
        self._enable_2fa(headers)

        resp = _login()
        assert resp.status_code == 200
        data = resp.json()
        assert data["require_totp"] is True
        assert data["totp_token"] is not None
        assert data["access_token"] == ""

    def test_totp_verify_with_valid_code_issues_full_tokens(self):
        _setup_server()
        headers = _auth_header()
        secret = self._enable_2fa(headers)

        login_resp = _login()
        totp_token = login_resp.json()["totp_token"]
        code = pyotp.TOTP(secret).now()

        resp = client.post(
            "/api/v1/auth/totp/verify",
            json={"totp_token": totp_token, "code": code},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["access_token"] != ""
        assert data["require_totp"] is False

    def test_totp_verify_with_wrong_code_returns_401(self):
        _setup_server()
        headers = _auth_header()
        self._enable_2fa(headers)

        login_resp = _login()
        totp_token = login_resp.json()["totp_token"]

        resp = client.post(
            "/api/v1/auth/totp/verify",
            json={"totp_token": totp_token, "code": "000000"},
        )
        assert resp.status_code == 401

    def test_totp_verify_with_bogus_token_returns_401(self):
        _setup_server()
        resp = client.post(
            "/api/v1/auth/totp/verify",
            json={"totp_token": "not.a.real.token", "code": "123456"},
        )
        assert resp.status_code == 401

    def test_totp_verify_with_expired_token_returns_401(self):
        from app.auth import SECRET_KEY, ALGORITHM, TOTP_CHALLENGE_TOKEN_TYPE
        from jose import jwt

        _setup_server()
        headers = _auth_header()
        self._enable_2fa(headers)

        expired_payload = {
            "sub": "admin",
            "type": TOTP_CHALLENGE_TOKEN_TYPE,
            "keep_login": False,
            "exp": datetime.now(timezone.utc) - timedelta(minutes=1),
        }
        expired_token = jwt.encode(expired_payload, SECRET_KEY, algorithm=ALGORITHM)

        resp = client.post(
            "/api/v1/auth/totp/verify",
            json={"totp_token": expired_token, "code": "123456"},
        )
        assert resp.status_code == 401

    def test_regular_login_still_works_without_2fa(self):
        _setup_server()
        resp = _login()
        assert resp.status_code == 200
        assert resp.json()["require_totp"] is False
        assert resp.json()["access_token"] != ""
