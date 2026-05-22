# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.
"""Google Home Smart Home integration — OAuth2 authorization server + Smart Home fulfillment webhook."""

import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.auth import ALGORITHM, SECRET_KEY, verify_password
from app.database import get_db
from app.deps import get_admin_user, get_current_user
from app.sql_models import (
    GoogleHomeAuthCode,
    GoogleHomeConfig,
    GoogleHomeLinkedUser,
    User,
)
from app.services.google_home_service import (
    execute_google_command,
    get_effective_client_id,
    get_effective_client_secret,
    is_google_home_configured,
    query_device_states,
    request_sync_for_user,
    sync_devices_for_user,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/google", tags=["google-home"])

AUTH_CODE_TTL_SECONDS = 300
ACCESS_TOKEN_TTL_SECONDS = 3600
REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30  # 30 days


def _create_google_home_access_token(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "type": "google_home_access",
        "iat": now,
        "exp": now + timedelta(seconds=ACCESS_TOKEN_TTL_SECONDS),
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _create_google_home_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def _verify_google_home_access_token(token: str) -> int | None:
    """Decode and validate a Google Home access token. Returns user_id or None."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "google_home_access":
            return None
        sub = payload.get("sub")
        return int(sub) if sub is not None else None
    except (JWTError, ValueError):
        return None


def _get_user_for_fulfillment(authorization: str | None, db: Session) -> User:
    """Authenticate the Google-provided Bearer token and return the linked user."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization")

    token = authorization[7:]
    user_id = _verify_google_home_access_token(token)
    if user_id is None:
        # Also try refresh token lookup
        linked = db.query(GoogleHomeLinkedUser).filter(
            GoogleHomeLinkedUser.access_token == token
        ).first()
        if linked is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        user_id = linked.user_id

    user = db.query(User).filter(User.user_id == user_id).first()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# ─── OAuth2 Authorization Endpoint ──────────────────────────────────────────

_AUTH_FORM_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Link E-Connect to Google Home</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; }}
    body {{ font-family: system-ui, sans-serif; background: #f1f5f9; display: flex;
           align-items: center; justify-content: center; min-height: 100vh; margin: 0; }}
    .card {{ background: #fff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,.12);
             padding: 40px; width: 100%; max-width: 400px; }}
    .logo {{ display: flex; align-items: center; gap: 10px; margin-bottom: 24px; }}
    .logo svg {{ width: 36px; height: 36px; }}
    h1 {{ font-size: 1.4rem; font-weight: 700; margin: 0 0 6px; color: #0f172a; }}
    p {{ color: #64748b; font-size: .9rem; margin: 0 0 24px; }}
    label {{ display: block; font-size: .85rem; font-weight: 600; color: #374151; margin-bottom: 4px; }}
    input {{ width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px;
             font-size: .95rem; outline: none; transition: border-color .2s; }}
    input:focus {{ border-color: #6366f1; }}
    .error {{ color: #ef4444; font-size: .85rem; margin-bottom: 16px; }}
    button {{ width: 100%; padding: 12px; background: #6366f1; color: #fff; border: none;
              border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer;
              margin-top: 8px; transition: background .2s; }}
    button:hover {{ background: #4f46e5; }}
    .field {{ margin-bottom: 16px; }}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="36" height="36" rx="10" fill="#6366f1"/>
        <path d="M10 18a8 8 0 1 1 16 0 8 8 0 0 1-16 0Z" fill="#fff" fill-opacity=".2"/>
        <path d="M18 10v8l5 3" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <span style="font-weight:800;font-size:1.2rem;color:#0f172a">E-Connect</span>
    </div>
    <h1>Link to Google Home</h1>
    <p>Sign in with your E-Connect account to allow Google Home to control your devices.</p>
    {error}
    <form method="POST" action="/api/v1/google/auth">
      <input type="hidden" name="response_type" value="{response_type}"/>
      <input type="hidden" name="client_id" value="{client_id}"/>
      <input type="hidden" name="redirect_uri" value="{redirect_uri}"/>
      <input type="hidden" name="state" value="{state}"/>
      <input type="hidden" name="scope" value="{scope}"/>
      <div class="field">
        <label for="username">Username</label>
        <input id="username" name="username" type="text" autocomplete="username"
               value="{username_hint}" required placeholder="Enter your username"/>
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password"
               required placeholder="Enter your password"/>
      </div>
      <button type="submit">Sign In &amp; Authorize</button>
    </form>
  </div>
</body>
</html>"""


@router.get("/auth", response_class=HTMLResponse)
async def google_oauth_auth_get(
    request: Request,
    response_type: str = "",
    client_id: str = "",
    redirect_uri: str = "",
    state: str = "",
    scope: str = "",
    login_hint: str = "",
    error: str = "",
):
    if not is_google_home_configured():
        return HTMLResponse("<h1>Google Home integration is not configured on this server.</h1>", status_code=503)

    if client_id != get_effective_client_id():
        return HTMLResponse("<h1>Invalid client_id</h1>", status_code=400)

    error_html = f'<p class="error">{error}</p>' if error else ""
    return HTMLResponse(
        _AUTH_FORM_HTML.format(
            response_type=response_type,
            client_id=client_id,
            redirect_uri=redirect_uri,
            state=state,
            scope=scope,
            username_hint=login_hint,
            error=error_html,
        )
    )


@router.post("/auth", response_class=HTMLResponse)
async def google_oauth_auth_post(
    request: Request,
    db: Session = Depends(get_db),
    response_type: str = Form(""),
    client_id: str = Form(""),
    redirect_uri: str = Form(""),
    state: str = Form(""),
    scope: str = Form(""),
    username: str = Form(""),
    password: str = Form(""),
):
    if not is_google_home_configured():
        raise HTTPException(status_code=503, detail="Google Home not configured")

    if client_id != get_effective_client_id():
        raise HTTPException(status_code=400, detail="Invalid client_id")

    def _show_error(msg: str) -> HTMLResponse:
        error_html = f'<p class="error">{msg}</p>'
        return HTMLResponse(
            _AUTH_FORM_HTML.format(
                response_type=response_type,
                client_id=client_id,
                redirect_uri=redirect_uri,
                state=state,
                scope=scope,
                username_hint=username,
                error=error_html,
            ),
            status_code=401,
        )

    user = db.query(User).filter(User.username == username.strip()).first()
    if user is None or not verify_password(password, user.authentication):
        return _show_error("Invalid username or password.")

    code = secrets.token_urlsafe(32)
    auth_code = GoogleHomeAuthCode(
        code=code,
        user_id=user.user_id,
        redirect_uri=redirect_uri,
        client_id=client_id,
        expires_at=(datetime.now(timezone.utc) + timedelta(seconds=AUTH_CODE_TTL_SECONDS)).replace(tzinfo=None),
    )
    db.add(auth_code)
    db.commit()

    separator = "&" if "?" in redirect_uri else "?"
    redirect_url = f"{redirect_uri}{separator}code={code}&state={state}"
    return RedirectResponse(url=redirect_url, status_code=302)


# ─── OAuth2 Token Endpoint ────────────────────────────────────────────────────

@router.post("/token")
async def google_oauth_token(
    request: Request,
    db: Session = Depends(get_db),
    grant_type: str = Form(""),
    code: str = Form(""),
    redirect_uri: str = Form(""),
    client_id: str = Form(""),
    client_secret: str = Form(""),
    refresh_token: str = Form(""),
):
    if not is_google_home_configured():
        raise HTTPException(status_code=503, detail="Google Home not configured")

    if client_id != get_effective_client_id() or client_secret != get_effective_client_secret():
        raise HTTPException(status_code=401, detail="Invalid client credentials")

    if grant_type == "authorization_code":
        auth_code = (
            db.query(GoogleHomeAuthCode)
            .filter(
                GoogleHomeAuthCode.code == code,
                GoogleHomeAuthCode.client_id == client_id,
                GoogleHomeAuthCode.redirect_uri == redirect_uri,
                GoogleHomeAuthCode.used.is_(False),
            )
            .first()
        )
        if auth_code is None:
            raise HTTPException(status_code=400, detail="Invalid authorization code")

        now_naive = datetime.now(timezone.utc).replace(tzinfo=None)
        if auth_code.expires_at < now_naive:
            raise HTTPException(status_code=400, detail="Authorization code expired")

        auth_code.used = True
        db.commit()

        user_id = auth_code.user_id
        access_token = _create_google_home_access_token(user_id)
        new_refresh_token = _create_google_home_refresh_token()
        agent_user_id = f"econnect-user-{user_id}"

        existing_link = db.query(GoogleHomeLinkedUser).filter(
            GoogleHomeLinkedUser.user_id == user_id
        ).first()
        if existing_link:
            existing_link.access_token = access_token
            existing_link.refresh_token = new_refresh_token
            existing_link.agent_user_id = agent_user_id
        else:
            db.add(
                GoogleHomeLinkedUser(
                    user_id=user_id,
                    agent_user_id=agent_user_id,
                    access_token=access_token,
                    refresh_token=new_refresh_token,
                )
            )
        db.commit()

        return {
            "access_token": access_token,
            "token_type": "Bearer",
            "expires_in": ACCESS_TOKEN_TTL_SECONDS,
            "refresh_token": new_refresh_token,
        }

    if grant_type == "refresh_token":
        linked = db.query(GoogleHomeLinkedUser).filter(
            GoogleHomeLinkedUser.refresh_token == refresh_token
        ).first()
        if linked is None:
            raise HTTPException(status_code=400, detail="Invalid refresh token")

        new_access_token = _create_google_home_access_token(linked.user_id)
        linked.access_token = new_access_token
        db.commit()

        return {
            "access_token": new_access_token,
            "token_type": "Bearer",
            "expires_in": ACCESS_TOKEN_TTL_SECONDS,
        }

    raise HTTPException(status_code=400, detail="Unsupported grant_type")


# ─── Smart Home Fulfillment Webhook ──────────────────────────────────────────

@router.post("/fulfillment")
async def google_fulfillment(
    request: Request,
    db: Session = Depends(get_db),
):
    authorization = request.headers.get("Authorization")
    user = _get_user_for_fulfillment(authorization, db)

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    request_id = str(body.get("requestId") or uuid.uuid4())
    inputs: list[dict[str, Any]] = body.get("inputs") if isinstance(body.get("inputs"), list) else []

    if not inputs:
        raise HTTPException(status_code=400, detail="No inputs provided")

    intent = str(inputs[0].get("intent") or "")
    payload_in = inputs[0].get("payload") if isinstance(inputs[0].get("payload"), dict) else {}

    if intent == "action.devices.SYNC":
        devices = sync_devices_for_user(db, user)
        agent_user_id = f"econnect-user-{user.user_id}"
        return {
            "requestId": request_id,
            "payload": {
                "agentUserId": agent_user_id,
                "devices": devices,
            },
        }

    if intent == "action.devices.QUERY":
        device_ids: list[str] = [
            d["id"] for d in (payload_in.get("devices") or []) if isinstance(d, dict) and d.get("id")
        ]
        states = query_device_states(db, user, device_ids)
        return {
            "requestId": request_id,
            "payload": {"devices": states},
        }

    if intent == "action.devices.EXECUTE":
        commands_in: list[dict[str, Any]] = payload_in.get("commands") if isinstance(payload_in.get("commands"), list) else []
        results: list[dict[str, Any]] = []
        for cmd_block in commands_in:
            device_ids = [
                d["id"] for d in (cmd_block.get("devices") or []) if isinstance(d, dict) and d.get("id")
            ]
            execution: list[dict[str, Any]] = cmd_block.get("execution") if isinstance(cmd_block.get("execution"), list) else []
            cmd_results = execute_google_command(db, user, device_ids, execution)
            results.extend(cmd_results)
        return {
            "requestId": request_id,
            "payload": {"commands": results},
        }

    if intent == "action.devices.DISCONNECT":
        linked = db.query(GoogleHomeLinkedUser).filter(
            GoogleHomeLinkedUser.user_id == user.user_id
        ).first()
        if linked:
            db.delete(linked)
            db.commit()
        return {"requestId": request_id}

    raise HTTPException(status_code=400, detail=f"Unknown intent: {intent}")


# ─── Status & Management Endpoints ───────────────────────────────────────────

@router.get("/status")
async def google_home_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    linked = db.query(GoogleHomeLinkedUser).filter(
        GoogleHomeLinkedUser.user_id == current_user.user_id
    ).first()
    return {
        "configured": is_google_home_configured(),
        "linked": linked is not None,
        "agent_user_id": linked.agent_user_id if linked else None,
        "linked_at": linked.linked_at.isoformat() if linked and linked.linked_at else None,
    }


@router.delete("/unlink")
async def google_home_unlink(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    linked = db.query(GoogleHomeLinkedUser).filter(
        GoogleHomeLinkedUser.user_id == current_user.user_id
    ).first()
    if linked is None:
        raise HTTPException(status_code=404, detail="Account not linked to Google Home")
    db.delete(linked)
    db.commit()
    return {"ok": True}


@router.post("/request-sync")
async def google_home_request_sync(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    linked = db.query(GoogleHomeLinkedUser).filter(
        GoogleHomeLinkedUser.user_id == current_user.user_id
    ).first()
    if linked is None:
        raise HTTPException(status_code=404, detail="Account not linked to Google Home")
    success = await request_sync_for_user(linked.agent_user_id)
    return {"ok": success}


# ─── Admin Config Endpoints ───────────────────────────────────────────────────

def _mask_secret(value: str | None) -> str | None:
    """Return a masked version of a secret — keep first 4 chars, replace rest."""
    if not value:
        return None
    visible = value[:4]
    return visible + "•" * min(16, max(4, len(value) - 4))


@router.get("/config")
async def get_google_home_config(
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    """Return current Google Home config (secrets masked). Admin only."""
    row = db.query(GoogleHomeConfig).first()
    return {
        "client_id": row.client_id if row else None,
        "client_secret_masked": _mask_secret(row.client_secret if row else None),
        "project_id": row.project_id if row else None,
        "service_account_configured": bool(row and row.service_account_json),
        "updated_at": row.updated_at.isoformat() if row and row.updated_at else None,
    }


@router.put("/config")
async def update_google_home_config(
    payload: dict,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    """Upsert Google Home integration credentials. Admin only.

    Accepts any subset of: client_id, client_secret, project_id, service_account_json.
    Pass an empty string to clear a field.
    """
    row = db.query(GoogleHomeConfig).first()
    if row is None:
        row = GoogleHomeConfig()
        db.add(row)

    if "client_id" in payload:
        row.client_id = str(payload["client_id"]).strip() or None
    if "client_secret" in payload:
        raw_secret = str(payload["client_secret"]).strip()
        if raw_secret and not raw_secret.startswith("•"):
            row.client_secret = raw_secret or None
    if "project_id" in payload:
        row.project_id = str(payload["project_id"]).strip() or None
    if "service_account_json" in payload:
        raw_sa = str(payload["service_account_json"]).strip()
        if raw_sa:
            row.service_account_json = raw_sa
        elif "clear_service_account" in payload and payload["clear_service_account"]:
            row.service_account_json = None

    db.commit()
    return {
        "ok": True,
        "client_id": row.client_id,
        "client_secret_masked": _mask_secret(row.client_secret),
        "project_id": row.project_id,
        "service_account_configured": bool(row.service_account_json),
    }
