# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime, timezone

from ..database import get_db
from ..models import (
    AutomationCreate,
    AutomationResponse,
    AutomationUpdate,
    AutomationScheduleContextResponse,
    TriggerResponse,
    ExecutionStatus,
    AutomationLogResponse,
)
from ..sql_models import Automation, User
from ..services.automation_runtime import (
    resolve_effective_timezone_context,
    serialize_automation,
    serialize_execution_log,
    trigger_automation_manually,
)

router = APIRouter()


# These will be injected by api.py via dependency forwarding
def _get_deps():
    """Import shared dependencies from parent api module to avoid circular imports."""
    from ..api import (
        get_current_user,
        _get_current_household_or_404,
        _serialize_time_context_response,
        _automation_device_scope_for_user,
        _get_user_automation,
        _apply_automation_payload,
        _automation_response_model,
        _automation_log_response_model,
        _build_automation_command_dispatcher,
    )
    from ..mqtt import mqtt_manager
    return {
        "get_current_user": get_current_user,
        "_get_current_household_or_404": _get_current_household_or_404,
        "_serialize_time_context_response": _serialize_time_context_response,
        "_automation_device_scope_for_user": _automation_device_scope_for_user,
        "_get_user_automation": _get_user_automation,
        "_apply_automation_payload": _apply_automation_payload,
        "_automation_response_model": _automation_response_model,
        "_automation_log_response_model": _automation_log_response_model,
        "_build_automation_command_dispatcher": _build_automation_command_dispatcher,
        "mqtt_manager": mqtt_manager,
    }


@router.get("/automation/schedule-context", response_model=AutomationScheduleContextResponse)
async def get_automation_schedule_context(
    db: Session = Depends(get_db),
    user: User = Depends(lambda: None),
):
    deps = _get_deps()
    get_current_user = deps["get_current_user"]
    _get_current_household_or_404 = deps["_get_current_household_or_404"]
    _serialize_time_context_response = deps["_serialize_time_context_response"]

    household = _get_current_household_or_404(db, user)
    timezone_context = resolve_effective_timezone_context(household=household)
    return _serialize_time_context_response(timezone_context)


@router.post("/automation", response_model=AutomationResponse)
async def create_automation(
    auto: AutomationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(lambda: None),
):
    deps = _get_deps()
    _get_current_household_or_404 = deps["_get_current_household_or_404"]
    _automation_device_scope_for_user = deps["_automation_device_scope_for_user"]
    _apply_automation_payload = deps["_apply_automation_payload"]
    _automation_response_model = deps["_automation_response_model"]

    new_auto = Automation(creator_id=user.user_id)
    device_scope = _automation_device_scope_for_user(db, user)
    household = _get_current_household_or_404(db, user)
    timezone_context = resolve_effective_timezone_context(household=household)
    _apply_automation_payload(
        new_auto,
        auto,
        device_scope=device_scope,
        effective_timezone=str(timezone_context["effective_timezone"]),
    )
    db.add(new_auto)
    db.commit()
    db.refresh(new_auto)
    return _automation_response_model(new_auto)


@router.get("/automations", response_model=List[AutomationResponse])
async def list_automations(
    db: Session = Depends(get_db),
    user: User = Depends(lambda: None),
):
    deps = _get_deps()
    _automation_response_model = deps["_automation_response_model"]

    automations = (
        db.query(Automation)
        .filter(Automation.creator_id == user.user_id)
        .order_by(Automation.id.asc())
        .all()
    )
    return [_automation_response_model(automation) for automation in automations]


@router.put("/automation/{automation_id}", response_model=AutomationResponse)
async def update_automation(
    automation_id: int,
    payload: AutomationUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(lambda: None),
):
    deps = _get_deps()
    _get_user_automation = deps["_get_user_automation"]
    _automation_device_scope_for_user = deps["_automation_device_scope_for_user"]
    _get_current_household_or_404 = deps["_get_current_household_or_404"]
    _apply_automation_payload = deps["_apply_automation_payload"]
    _automation_response_model = deps["_automation_response_model"]

    automation = _get_user_automation(db, automation_id, user)
    device_scope = _automation_device_scope_for_user(db, user)
    household = _get_current_household_or_404(db, user)
    timezone_context = resolve_effective_timezone_context(household=household)
    _apply_automation_payload(
        automation,
        payload,
        device_scope=device_scope,
        effective_timezone=str(timezone_context["effective_timezone"]),
    )
    db.commit()
    db.refresh(automation)
    return _automation_response_model(automation)


@router.delete("/automation/{automation_id}", response_model=dict)
async def delete_automation(
    automation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(lambda: None),
):
    deps = _get_deps()
    _get_user_automation = deps["_get_user_automation"]

    automation = _get_user_automation(db, automation_id, user)
    db.delete(automation)
    db.commit()
    return {"message": "Automation deleted."}


@router.post("/automation/{automation_id}/trigger", response_model=TriggerResponse)
async def trigger_automation(
    automation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(lambda: None),
):
    """
    Manually trigger a saved automation graph against the latest persisted device state.
    """
    deps = _get_deps()
    _get_user_automation = deps["_get_user_automation"]
    _automation_device_scope_for_user = deps["_automation_device_scope_for_user"]
    _build_automation_command_dispatcher = deps["_build_automation_command_dispatcher"]
    _automation_log_response_model = deps["_automation_log_response_model"]
    mqtt_manager = deps["mqtt_manager"]

    auto = _get_user_automation(db, automation_id, user)
    device_scope = _automation_device_scope_for_user(db, user)
    execution_log = trigger_automation_manually(
        db,
        automation=auto,
        publish_command=_build_automation_command_dispatcher(
            db,
            physical_publish=mqtt_manager.enqueue_command,
            triggered_at=datetime.now(timezone.utc).replace(tzinfo=None),
        ),
        device_scope=device_scope,
        triggered_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.commit()
    db.refresh(auto)
    db.refresh(execution_log)
    raw_status = execution_log.status.value if hasattr(execution_log.status, "value") else str(execution_log.status)
    success = raw_status == ExecutionStatus.success.value
    if success:
        msg = f"Automation '{auto.name}' executed successfully."
        response_status = ExecutionStatus.success
    else:
        msg = execution_log.error_message or f"Automation '{auto.name}' did not apply any action."
        response_status = ExecutionStatus.failed
    return TriggerResponse(
        status=response_status,
        message=msg,
        log=_automation_log_response_model(execution_log),
    )
