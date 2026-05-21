# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.
"""
Shared FastAPI dependencies and auth helpers extracted from api.py.
These are imported by api.py and will be imported by domain router modules
as the router split progresses.
"""

from typing import Optional, Any
from datetime import datetime, timedelta, timezone
import datetime as stdlib_datetime

from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session, joinedload

from .database import get_db
from .sql_models import (
    User, HouseholdMembership, Household, ApiKey, HouseholdRole, AccountType,
)
from .models import Token, TokenData
from .auth import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    ACCESS_TOKEN_TYPE,
    ALGORITHM,
    API_KEY_PREFIX,
    REFRESH_TOKEN_EXPIRE_MINUTES,
    REFRESH_TOKEN_TYPE,
    SECRET_KEY,
    create_access_token,
    create_refresh_token,
    is_api_key_token,
    parse_api_key_token,
    verify_api_key_secret,
    verify_password,
)
from .services.user_management import resolve_household_id_for_user

# ---------------------------------------------------------------------------
# OAuth2 scheme
# ---------------------------------------------------------------------------

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")

# ---------------------------------------------------------------------------
# Tiny shared utilities
# ---------------------------------------------------------------------------


def _utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ---------------------------------------------------------------------------
# Auth session helpers
# ---------------------------------------------------------------------------


def _get_primary_membership(db: Session, user: User) -> Optional[HouseholdMembership]:
    return (
        db.query(HouseholdMembership)
        .filter(HouseholdMembership.user_id == user.user_id)
        .order_by(HouseholdMembership.id.asc())
        .first()
    )


def _build_user_session_payload(user: User, membership: Optional[HouseholdMembership]) -> dict[str, Any]:
    household_role = None
    if membership and membership.role is not None:
        household_role = membership.role.value if hasattr(membership.role, "value") else str(membership.role)

    return {
        "sub": user.username,
        "account_type": user.account_type.value if hasattr(user.account_type, "value") else str(user.account_type),
        "household_id": membership.household_id if membership else None,
        "household_role": household_role,
    }


def _issue_user_session_tokens(
    user: User,
    membership: Optional[HouseholdMembership],
    *,
    keep_login: bool,
) -> Token:
    issued_at = stdlib_datetime.datetime.now(timezone.utc)
    access_expires_at = None
    refresh_expires_at = None

    if not keep_login:
        access_expires_at = issued_at + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        refresh_expires_at = issued_at + timedelta(minutes=REFRESH_TOKEN_EXPIRE_MINUTES)

    payload = _build_user_session_payload(user, membership)
    access_token = create_access_token(
        data=payload,
        expires_at=access_expires_at,
        persistent=keep_login,
    )
    refresh_token = create_refresh_token(
        data=payload,
        expires_at=refresh_expires_at,
        persistent=keep_login,
    )

    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        access_token_expires_at=access_expires_at,
        refresh_token_expires_at=refresh_expires_at,
        keep_login=keep_login,
    )


def _attach_user_household_context(
    user: User,
    membership: Optional[HouseholdMembership],
    *,
    via_api_key: bool = False,
    api_key: Optional[ApiKey] = None,
) -> User:
    household_role = None
    household_id = None
    if membership is not None:
        household_id = membership.household_id
        if membership.role is not None:
            household_role = membership.role.value if hasattr(membership.role, "value") else str(membership.role)

    setattr(user, "current_household_id", household_id)
    setattr(user, "current_household_role", household_role)
    setattr(user, "authenticated_via_api_key", via_api_key)
    setattr(user, "current_api_key_id", api_key.key_id if api_key is not None else None)
    return user


def _authenticate_api_key_user(token: str, db: Session) -> User:
    credentials_exception = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": f'Bearer realm="api", error="invalid_token", error_description="invalid {API_KEY_PREFIX} token"'},
    )

    parsed = parse_api_key_token(token)
    if parsed is None:
        raise credentials_exception

    public_id, secret = parsed
    api_key = (
        db.query(ApiKey)
        .options(joinedload(ApiKey.user))
        .filter(ApiKey.key_id == public_id)
        .first()
    )
    if api_key is None or api_key.user is None or api_key.revoked_at is not None:
        raise credentials_exception
    if not verify_api_key_secret(secret, api_key.secret_hash):
        raise credentials_exception

    membership = _get_primary_membership(db, api_key.user)
    api_key.last_used_at = _utcnow_naive()
    db.add(api_key)
    db.commit()
    db.refresh(api_key)

    return _attach_user_household_context(api_key.user, membership, via_api_key=True, api_key=api_key)


# ---------------------------------------------------------------------------
# FastAPI auth dependencies
# ---------------------------------------------------------------------------


async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    from jose import jwt, JWTError
    credentials_exception = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if is_api_key_token(token):
        return _authenticate_api_key_user(token, db)

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        token_type: Optional[str] = payload.get("type")
        account_type: str = payload.get("account_type")
        household_id: int = payload.get("household_id")
        household_role: str = payload.get("household_role")
        if username is None or token_type not in (None, ACCESS_TOKEN_TYPE):
            raise credentials_exception
        token_data = TokenData(
            username=username,
            account_type=account_type,
            household_id=household_id,
            household_role=household_role
        )
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.username == token_data.username).first()
    if user is None:
        raise credentials_exception

    membership = None
    if token_data.household_id is not None:
        membership = (
            db.query(HouseholdMembership)
            .filter(
                HouseholdMembership.user_id == user.user_id,
                HouseholdMembership.household_id == token_data.household_id,
            )
            .first()
        )
    if membership is None:
        membership = _get_primary_membership(db, user)

    return _attach_user_household_context(user, membership)


# ---------------------------------------------------------------------------
# Cross-cutting role helpers (used by all domain routers)
# ---------------------------------------------------------------------------


def _normalize_household_role(user: User) -> Optional[str]:
    role = getattr(user, "current_household_role", None)
    if hasattr(role, "value"):
        return role.value
    if isinstance(role, str):
        return role
    return None


def _is_room_admin(user: User) -> bool:
    current_household_role = _normalize_household_role(user)
    return user.account_type == AccountType.admin or current_household_role in {
        HouseholdRole.owner.value,
        HouseholdRole.admin.value,
    }


async def get_admin_user(current_user: User = Depends(get_current_user)):
    if not _is_room_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin or Owner privileges required")
    return current_user


async def get_account_admin_user(current_user: User = Depends(get_current_user)):
    if current_user.account_type != AccountType.admin:
        raise HTTPException(status_code=403, detail="Admin account required")
    return current_user


def _get_current_household_or_404(db: Session, current_user: User) -> Household:
    household_id = resolve_household_id_for_user(db, current_user)
    if household_id is None:
        raise HTTPException(status_code=404, detail="Household not found")

    household = (
        db.query(Household)
        .filter(Household.household_id == household_id)
        .first()
    )
    if not household:
        raise HTTPException(status_code=404, detail="Household not found")
    return household
