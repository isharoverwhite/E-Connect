# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

import bcrypt
import hashlib
import logging
import os
import secrets
from hmac import compare_digest
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
from jose import jwt

logger = logging.getLogger(__name__)

SECRET_KEY = os.getenv("SECRET_KEY", "econnect-dev-secret-change-me")
ALGORITHM = "HS256"
ACCESS_TOKEN_TYPE = "access"
REFRESH_TOKEN_TYPE = "refresh"
DEFAULT_ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 4
DEFAULT_REFRESH_TOKEN_EXPIRE_MINUTES = 60 * 4
API_KEY_PREFIX = "eak_"


def _load_positive_minutes(env_name: str, default_minutes: int) -> int:
    raw_minutes = os.getenv(env_name)
    if raw_minutes is None:
        return default_minutes

    try:
        minutes = int(raw_minutes)
        if minutes <= 0:
            raise ValueError
        return minutes
    except ValueError:
        logger.warning(
            "Invalid %s=%r. Falling back to %s minutes.",
            env_name,
            raw_minutes,
            default_minutes,
        )
        return default_minutes


ACCESS_TOKEN_EXPIRE_MINUTES = _load_positive_minutes(
    "ACCESS_TOKEN_EXPIRE_MINUTES",
    DEFAULT_ACCESS_TOKEN_EXPIRE_MINUTES,
)
REFRESH_TOKEN_EXPIRE_MINUTES = _load_positive_minutes(
    "REFRESH_TOKEN_EXPIRE_MINUTES",
    DEFAULT_REFRESH_TOKEN_EXPIRE_MINUTES,
)


def _encode_token(
    data: dict,
    *,
    token_type: str,
    expires_delta: Optional[timedelta] = None,
    expires_at: Optional[datetime] = None,
    persistent: bool = False,
) -> str:
    to_encode = data.copy()
    issued_at = datetime.now(timezone.utc)
    to_encode.update(
        {
            "type": token_type,
            "iat": issued_at,
            "jti": str(uuid.uuid4()),
            "keep_login": persistent,
        }
    )

    if not persistent:
        expire = expires_at
        if expire is None:
            expire = issued_at + expires_delta
        to_encode["exp"] = expire

    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def verify_password(plain_password, hashed_password):
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

def get_password_hash(password):
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def create_access_token(
    data: dict,
    expires_delta: Optional[timedelta] = None,
    *,
    expires_at: Optional[datetime] = None,
    persistent: bool = False,
):
    effective_delta = expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return _encode_token(
        data,
        token_type=ACCESS_TOKEN_TYPE,
        expires_delta=effective_delta,
        expires_at=expires_at,
        persistent=persistent,
    )


def create_refresh_token(
    data: dict,
    expires_delta: Optional[timedelta] = None,
    *,
    expires_at: Optional[datetime] = None,
    persistent: bool = False,
):
    effective_delta = expires_delta or timedelta(minutes=REFRESH_TOKEN_EXPIRE_MINUTES)
    return _encode_token(
        data,
        token_type=REFRESH_TOKEN_TYPE,
        expires_delta=effective_delta,
        expires_at=expires_at,
        persistent=persistent,
    )

def create_ota_token(job_id: str) -> str:
    """Create a short-lived token specifically for OTA downloads."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=60) # 1 hour
    to_encode = {"sub": job_id, "type": "ota", "exp": expire}
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def verify_ota_token(token: str) -> str | None:
    """Verify OTA token and return job_id."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "ota":
            return None
        return payload.get("sub")
    except jwt.JWTError:
        return None


def hash_api_key_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def verify_api_key_secret(secret: str, expected_hash: str) -> bool:
    return compare_digest(hash_api_key_secret(secret), expected_hash)


def build_api_key_token(public_id: str, secret: str) -> str:
    return f"{API_KEY_PREFIX}{public_id}.{secret}"


def is_api_key_token(token: str) -> bool:
    return isinstance(token, str) and token.startswith(API_KEY_PREFIX)


def parse_api_key_token(token: str) -> tuple[str, str] | None:
    if not is_api_key_token(token):
        return None

    token_body = token[len(API_KEY_PREFIX):]
    public_id, separator, secret = token_body.partition(".")
    if not separator or not public_id or not secret:
        return None
    return public_id, secret


def generate_api_key_credentials() -> tuple[str, str, str, str]:
    public_id = secrets.token_urlsafe(9)
    secret = secrets.token_urlsafe(32)
    api_key = build_api_key_token(public_id, secret)
    return public_id, api_key, f"{API_KEY_PREFIX}{public_id}", hash_api_key_secret(secret)
