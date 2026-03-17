import bcrypt
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional
from jose import jwt

logger = logging.getLogger(__name__)

SECRET_KEY = os.getenv("SECRET_KEY", "econnect-dev-secret-change-me")
ALGORITHM = "HS256"
DEFAULT_ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 30


def _load_access_token_expire_minutes() -> int:
    raw_minutes = os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES")
    if raw_minutes is None:
        return DEFAULT_ACCESS_TOKEN_EXPIRE_MINUTES

    try:
        minutes = int(raw_minutes)
        if minutes <= 0:
            raise ValueError
        return minutes
    except ValueError:
        logger.warning(
            "Invalid ACCESS_TOKEN_EXPIRE_MINUTES=%r. Falling back to %s minutes.",
            raw_minutes,
            DEFAULT_ACCESS_TOKEN_EXPIRE_MINUTES,
        )
        return DEFAULT_ACCESS_TOKEN_EXPIRE_MINUTES


ACCESS_TOKEN_EXPIRE_MINUTES = _load_access_token_expire_minutes()

def verify_password(plain_password, hashed_password):
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

def get_password_hash(password):
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

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
