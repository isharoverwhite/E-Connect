from __future__ import annotations

import ast
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Mapping
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from ..models import ExecutionStatus
from ..sql_models import (
    AuthStatus,
    Automation,
    AutomationExecutionLog,
    Device,
    DeviceHistory,
    ExecutionStatus as SqlExecutionStatus,
    EventType,
    HouseholdMembership,
    PinMode,
    User,
)
from .timezone_settings import DEFAULT_SERVER_TIMEZONE, normalize_supported_timezone

TRIGGER_PORT = "event_out"
FLOW_INPUT_PORT = "event_in"
CONDITION_PASS_PORT = "pass_out"
TIME_TRIGGER_KIND = "time_schedule"
TIME_TRIGGER_SCHEDULE_TYPE = "time"
SUPPORTED_TRIGGER_SOURCES = ("manual", "device_state", "schedule")
SUPPORTED_NODE_TYPES = ("trigger", "condition", "action")
SUPPORTED_TRIGGER_KINDS = ("device_state", "device_value", "device_on_off_event", TIME_TRIGGER_KIND)
SUPPORTED_CONDITION_KINDS = ("state_equals", "numeric_compare")
SUPPORTED_ACTION_KINDS = ("set_output", "set_value")
SUPPORTED_COMPARISON_OPERATORS = ("gt", "gte", "lt", "lte", "between")
EXPECTED_BINARY_VALUES = {"on", "off"}
SET_OUTPUT_VALUES = {0, 1}
NUMERIC_TRIGGER_FUNCTION_KEYWORDS = ("temp", "temperature", "hum", "humidity", "moisture", "analog", "sensor")
BINARY_TRIGGER_FUNCTION_KEYWORDS = ("switch", "btn", "button", "relay", "contact", "pir", "motion")
SUPPORTED_TIME_TRIGGER_WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
TIME_TRIGGER_WEEKDAY_INDEX = {value: index for index, value in enumerate(SUPPORTED_TIME_TRIGGER_WEEKDAYS)}


class AutomationGraphValidationError(ValueError):
    def __init__(self, message: str, *, code: str = "validation") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


def _enum_value(value: object, *, default: str) -> str:
    if value is None:
        return default
    if hasattr(value, "value"):
        return str(getattr(value, "value"))
    return str(value)


def _decode_history_payload(payload: str | None) -> dict[str, Any] | None:
    if not payload:
        return None

    try:
        decoded = json.loads(payload)
        return decoded if isinstance(decoded, dict) else None
    except json.JSONDecodeError:
        try:
            decoded = ast.literal_eval(payload)
            return decoded if isinstance(decoded, dict) else None
        except (ValueError, SyntaxError):
            return None


def _normalize_text(value: object, *, field_name: str) -> str:
    if hasattr(value, "value"):
        value = getattr(value, "value")
    normalized = str(value or "").strip()
    if not normalized:
        raise AutomationGraphValidationError(f"{field_name} is required.")
    return normalized


def _normalize_int(value: object, *, field_name: str) -> int:
    if isinstance(value, bool):
        raise AutomationGraphValidationError(f"{field_name} must be an integer.")
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise AutomationGraphValidationError(f"{field_name} must be an integer.") from exc


def _normalize_number(value: object, *, field_name: str) -> float:
    if isinstance(value, bool):
        raise AutomationGraphValidationError(f"{field_name} must be numeric.")
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise AutomationGraphValidationError(f"{field_name} must be numeric.") from exc


def _normalize_binary_state(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value > 0
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"on", "true", "1", "high"}:
            return True
        if normalized in {"off", "false", "0", "low"}:
            return False
    return None


def _coerce_utc_datetime(value: datetime | None) -> datetime:
    current = value or datetime.now(timezone.utc)
    if current.tzinfo is None:
        return current.replace(tzinfo=timezone.utc)
    return current.astimezone(timezone.utc)


def _normalize_time_trigger_weekdays(value: object) -> list[str]:
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        raise AutomationGraphValidationError("Time trigger weekdays must be an array.")

    normalized: list[str] = []
    for raw_value in value:
        if not isinstance(raw_value, str):
            raise AutomationGraphValidationError("Time trigger weekdays must contain weekday strings.")
        weekday = raw_value.strip().lower()
        if weekday not in TIME_TRIGGER_WEEKDAY_INDEX:
            raise AutomationGraphValidationError(
                "Time trigger weekdays must use: mon, tue, wed, thu, fri, sat, or sun."
            )
        if weekday not in normalized:
            normalized.append(weekday)
    return normalized


def _effective_timezone_name(value: object) -> str:
    return normalize_supported_timezone(value) or DEFAULT_SERVER_TIMEZONE


def _time_trigger_zoneinfo(value: object) -> ZoneInfo:
    return ZoneInfo(_effective_timezone_name(value))


def _pin_mode_value(pin_config: object) -> str:
    return _enum_value(getattr(pin_config, "mode", None), default="").upper()


def _pin_function_text(pin_config: object) -> str:
    return str(getattr(pin_config, "function", "") or "").strip().lower()


def _pin_matches_function_keywords(pin_config: object, keywords: tuple[str, ...]) -> bool:
    function_text = _pin_function_text(pin_config)
    return any(keyword in function_text for keyword in keywords)


def _pin_supports_numeric_trigger(pin_config: object) -> bool:
    pin_mode = _pin_mode_value(pin_config)
    return pin_mode in {PinMode.ADC.value, PinMode.PWM.value} or _pin_matches_function_keywords(
        pin_config,
        NUMERIC_TRIGGER_FUNCTION_KEYWORDS,
    )


def _pin_supports_binary_trigger(pin_config: object) -> bool:
    pin_mode = _pin_mode_value(pin_config)
    return pin_mode in {PinMode.INPUT.value, PinMode.OUTPUT.value} or _pin_matches_function_keywords(
        pin_config,
        BINARY_TRIGGER_FUNCTION_KEYWORDS,
    )


def _normalize_graph_payload(raw_graph: object) -> dict[str, Any]:
    if hasattr(raw_graph, "model_dump"):
        dumped = getattr(raw_graph, "model_dump")(mode="json")
        if not isinstance(dumped, dict):
            raise AutomationGraphValidationError("Automation graph must be a JSON object.")
        graph = dumped
    elif isinstance(raw_graph, Mapping):
        graph = dict(raw_graph)
    elif isinstance(raw_graph, str):
        try:
            decoded = json.loads(raw_graph)
        except json.JSONDecodeError as exc:
            raise AutomationGraphValidationError("Automation graph must be valid JSON.") from exc
        if not isinstance(decoded, dict):
            raise AutomationGraphValidationError("Automation graph must be a JSON object.")
        graph = decoded
    else:
        raise AutomationGraphValidationError("Automation graph must be a JSON object.")

    nodes = graph.get("nodes")
    edges = graph.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        raise AutomationGraphValidationError("Automation graph must include nodes and edges arrays.")

    return {"nodes": nodes, "edges": edges}


def _normalize_trigger_config(kind: str, config: Mapping[str, Any]) -> dict[str, Any]:
    if kind == TIME_TRIGGER_KIND:
        hour = _normalize_int(config.get("hour"), field_name="Trigger hour")
        minute = _normalize_int(config.get("minute"), field_name="Trigger minute")
        if not 0 <= hour <= 23:
            raise AutomationGraphValidationError("Trigger hour must be between 0 and 23.")
        if not 0 <= minute <= 59:
            raise AutomationGraphValidationError("Trigger minute must be between 0 and 59.")
        return {
            "hour": hour,
            "minute": minute,
            "weekdays": _normalize_time_trigger_weekdays(config.get("weekdays")),
        }

    return {
        "device_id": _normalize_text(config.get("device_id"), field_name="Trigger device_id"),
        "pin": _normalize_int(config.get("pin"), field_name="Trigger pin"),
    }


def _normalize_condition_config(kind: str, config: Mapping[str, Any]) -> dict[str, Any]:
    normalized = {
        "device_id": _normalize_text(config.get("device_id"), field_name="Condition device_id"),
        "pin": _normalize_int(config.get("pin"), field_name="Condition pin"),
    }
    if kind == "state_equals":
        expected = _normalize_text(config.get("expected"), field_name="Condition expected").lower()
        if expected not in EXPECTED_BINARY_VALUES:
            raise AutomationGraphValidationError("state_equals conditions require expected to be 'on' or 'off'.")
        normalized["expected"] = expected
        return normalized

    operator = _normalize_text(config.get("operator"), field_name="Condition operator").lower()
    if operator not in SUPPORTED_COMPARISON_OPERATORS:
        raise AutomationGraphValidationError(
            "numeric_compare conditions require operator to be one of gt, gte, lt, lte, or between."
        )

    value = _normalize_number(config.get("value"), field_name="Condition value")
    normalized["operator"] = operator
    normalized["value"] = value
    if operator == "between":
        secondary_value = _normalize_number(config.get("secondary_value"), field_name="Condition secondary_value")
        lower = min(value, secondary_value)
        upper = max(value, secondary_value)
        normalized["value"] = lower
        normalized["secondary_value"] = upper
    return normalized


def _normalize_action_config(kind: str, config: Mapping[str, Any]) -> dict[str, Any]:
    normalized = {
        "device_id": _normalize_text(config.get("device_id"), field_name="Action device_id"),
        "pin": _normalize_int(config.get("pin"), field_name="Action pin"),
    }
    if kind == "set_output":
        value = _normalize_int(config.get("value"), field_name="Action value")
        if value not in SET_OUTPUT_VALUES:
            raise AutomationGraphValidationError("set_output actions require value 0 or 1.")
        normalized["value"] = value
        return normalized

    normalized["value"] = _normalize_number(config.get("value"), field_name="Action value")
    return normalized


def _normalize_graph_node(node: object) -> dict[str, Any]:
    if not isinstance(node, Mapping):
        raise AutomationGraphValidationError("Each graph node must be an object.")

    node_id = _normalize_text(node.get("id"), field_name="Node id")
    node_type = _normalize_text(node.get("type"), field_name="Node type").lower()
    if node_type not in SUPPORTED_NODE_TYPES:
        raise AutomationGraphValidationError(f"Unsupported node type '{node_type}'.")

    kind = _normalize_text(node.get("kind"), field_name=f"{node_type} node kind").lower()
    config = node.get("config")
    if config is None:
        config = {}
    if not isinstance(config, Mapping):
        raise AutomationGraphValidationError(f"Node '{node_id}' config must be an object.")

    if node_type == "trigger":
        if kind not in SUPPORTED_TRIGGER_KINDS:
            raise AutomationGraphValidationError(f"Unsupported trigger kind '{kind}'.")
        normalized_config = _normalize_trigger_config(kind, config)
    elif node_type == "condition":
        if kind not in SUPPORTED_CONDITION_KINDS:
            raise AutomationGraphValidationError(f"Unsupported condition kind '{kind}'.")
        normalized_config = _normalize_condition_config(kind, config)
    else:
        if kind not in SUPPORTED_ACTION_KINDS:
            raise AutomationGraphValidationError(f"Unsupported action kind '{kind}'.")
        normalized_config = _normalize_action_config(kind, config)

    label = node.get("label")
    normalized_label = str(label).strip() if isinstance(label, str) and label.strip() else None
    return {
        "id": node_id,
        "type": node_type,
        "kind": kind,
        "label": normalized_label,
        "config": normalized_config,
    }


def _normalize_graph_edge(edge: object, *, node_ids: set[str]) -> dict[str, Any]:
    if not isinstance(edge, Mapping):
        raise AutomationGraphValidationError("Each graph edge must be an object.")

    source_node_id = _normalize_text(edge.get("source_node_id"), field_name="Edge source_node_id")
    target_node_id = _normalize_text(edge.get("target_node_id"), field_name="Edge target_node_id")
    source_port = _normalize_text(edge.get("source_port"), field_name="Edge source_port")
    target_port = _normalize_text(edge.get("target_port"), field_name="Edge target_port")

    if source_node_id not in node_ids or target_node_id not in node_ids:
        raise AutomationGraphValidationError("Edges must reference existing nodes.")

    return {
        "source_node_id": source_node_id,
        "source_port": source_port,
        "target_node_id": target_node_id,
        "target_port": target_port,
    }


def _validate_device_bindings(normalized_graph: dict[str, Any], *, device_scope: Mapping[str, Device] | None) -> None:
    if device_scope is None:
        return

    for node in normalized_graph["nodes"]:
        config = node["config"]
        if node["type"] == "trigger" and node["kind"] == TIME_TRIGGER_KIND:
            continue

        device_id = config.get("device_id")
        device = device_scope.get(device_id)
        if device is None:
            raise AutomationGraphValidationError(f"Automation references device '{device_id}' outside your visible scope.")

        pin = config.get("pin")
        if pin is None:
            continue

        pin_config = next((row for row in device.pin_configurations if row.gpio_pin == pin), None)
        if pin_config is None:
            raise AutomationGraphValidationError(
                f"Automation references GPIO {pin} on device '{device.name}', but that pin is not configured."
            )

        if node["type"] == "trigger":
            if node["kind"] == "device_value" and not _pin_supports_numeric_trigger(pin_config):
                raise AutomationGraphValidationError(
                    f"device_value triggers require a numeric-capable pin. Device '{device.name}' GPIO {pin} is not configured for numeric telemetry."
                )
            if node["kind"] == "device_on_off_event" and not _pin_supports_binary_trigger(pin_config):
                raise AutomationGraphValidationError(
                    f"device_on_off_event triggers require a boolean-like pin. Device '{device.name}' GPIO {pin} is not configured for on/off events."
                )
            continue

        if node["type"] != "action":
            continue

        pin_mode = _enum_value(pin_config.mode, default="")
        if node["kind"] == "set_output" and pin_mode != PinMode.OUTPUT.value:
            raise AutomationGraphValidationError(
                f"set_output actions require an OUTPUT pin. Device '{device.name}' GPIO {pin} is {pin_mode or 'unknown'}."
            )
        if node["kind"] == "set_value" and pin_mode != PinMode.PWM.value:
            raise AutomationGraphValidationError(
                f"set_value actions require a PWM pin. Device '{device.name}' GPIO {pin} is {pin_mode or 'unknown'}."
            )


def normalize_automation_graph(
    raw_graph: object,
    *,
    device_scope: Mapping[str, Device] | None = None,
) -> dict[str, Any]:
    graph = _normalize_graph_payload(raw_graph)
    nodes = [_normalize_graph_node(node) for node in graph["nodes"]]
    node_ids = [node["id"] for node in nodes]
    if len(node_ids) != len(set(node_ids)):
        raise AutomationGraphValidationError("Graph node ids must be unique.")

    node_by_id = {node["id"]: node for node in nodes}
    edges = [_normalize_graph_edge(edge, node_ids=set(node_by_id)) for edge in graph["edges"]]

    unique_edges: set[tuple[str, str, str, str]] = set()
    outgoing: dict[str, list[dict[str, Any]]] = {node_id: [] for node_id in node_by_id}
    incoming_count: dict[str, int] = {node_id: 0 for node_id in node_by_id}

    for edge in edges:
        key = (
            edge["source_node_id"],
            edge["source_port"],
            edge["target_node_id"],
            edge["target_port"],
        )
        if key in unique_edges:
            raise AutomationGraphValidationError("Duplicate graph edges are not allowed.")
        unique_edges.add(key)

        source_node = node_by_id[edge["source_node_id"]]
        target_node = node_by_id[edge["target_node_id"]]
        if source_node["type"] == "trigger":
            if edge["source_port"] != TRIGGER_PORT:
                raise AutomationGraphValidationError("Trigger nodes must emit from port 'event_out'.")
        elif source_node["type"] == "condition":
            if edge["source_port"] != CONDITION_PASS_PORT:
                raise AutomationGraphValidationError("Condition nodes must emit from port 'pass_out'.")
        else:
            raise AutomationGraphValidationError("Action nodes cannot have outgoing edges.")

        if target_node["type"] not in {"condition", "action"} or edge["target_port"] != FLOW_INPUT_PORT:
            raise AutomationGraphValidationError("Edges must connect into a condition/action 'event_in' port.")

        outgoing[edge["source_node_id"]].append(edge)
        incoming_count[edge["target_node_id"]] += 1

    trigger_nodes = [node for node in nodes if node["type"] == "trigger"]
    action_nodes = [node for node in nodes if node["type"] == "action"]
    if len(trigger_nodes) != 1:
        raise AutomationGraphValidationError("Automation graphs require exactly one trigger node.")
    if not action_nodes:
        raise AutomationGraphValidationError("Automation graphs require at least one action node.")

    trigger_node = trigger_nodes[0]
    if not outgoing[trigger_node["id"]]:
        raise AutomationGraphValidationError("The trigger node must connect to at least one downstream node.")

    for node in nodes:
        node_id = node["id"]
        if node["type"] == "trigger":
            if incoming_count[node_id] != 0:
                raise AutomationGraphValidationError("Trigger nodes cannot have incoming edges.")
            continue

        if incoming_count[node_id] != 1:
            raise AutomationGraphValidationError(
                f"Node '{node_id}' must have exactly one incoming edge to avoid ambiguous graph joins."
            )

        if node["type"] == "condition" and not outgoing[node_id]:
            raise AutomationGraphValidationError(f"Condition node '{node_id}' must connect to a downstream node.")
        if node["type"] == "action" and outgoing[node_id]:
            raise AutomationGraphValidationError(f"Action node '{node_id}' cannot connect to downstream nodes.")

    visited: set[str] = set()
    stack: set[str] = set()

    def dfs(node_id: str) -> None:
        if node_id in stack:
            raise AutomationGraphValidationError("Automation graphs must be acyclic.")
        if node_id in visited:
            return

        stack.add(node_id)
        for edge in outgoing[node_id]:
            dfs(edge["target_node_id"])
        stack.remove(node_id)
        visited.add(node_id)

    dfs(trigger_node["id"])
    if visited != set(node_by_id):
        unreachable = sorted(set(node_by_id) - visited)
        raise AutomationGraphValidationError(
            f"Every node must be reachable from the trigger. Unreachable nodes: {', '.join(unreachable)}."
        )

    normalized_graph = {"nodes": nodes, "edges": edges}
    _validate_device_bindings(normalized_graph, device_scope=device_scope)
    return normalized_graph


def deserialize_automation_graph(raw_graph: object) -> dict[str, Any]:
    return normalize_automation_graph(raw_graph, device_scope=None)


def serialize_graph_for_storage(graph: Mapping[str, Any]) -> str:
    return json.dumps(graph, separators=(",", ":"), ensure_ascii=True)


def serialize_execution_log(log: AutomationExecutionLog) -> dict[str, Any]:
    return {
        "id": log.id,
        "automation_id": log.automation_id,
        "triggered_at": log.triggered_at,
        "status": _enum_value(log.status, default=ExecutionStatus.failed.value),
        "trigger_source": _enum_value(log.trigger_source, default="manual"),
        "scheduled_for": log.scheduled_for,
        "log_output": log.log_output,
        "error_message": log.error_message,
    }


def _latest_execution_log(automation: Automation) -> AutomationExecutionLog | None:
    logs = list(getattr(automation, "logs", []) or [])
    if not logs:
        return None
    return max(
        logs,
        key=lambda row: (
            row.triggered_at or datetime.min,
            row.id or 0,
        ),
    )


def serialize_automation(automation: Automation) -> dict[str, Any]:
    graph = {"nodes": [], "edges": []}
    try:
        graph = deserialize_automation_graph(getattr(automation, "script_code", None))
    except AutomationGraphValidationError:
        pass

    latest_log = _latest_execution_log(automation)
    return {
        "id": automation.id,
        "creator_id": automation.creator_id,
        "name": automation.name,
        "is_enabled": automation.is_enabled,
        "graph": graph,
        "last_triggered": automation.last_triggered,
        "last_execution": serialize_execution_log(latest_log) if latest_log is not None else None,
        "schedule_type": automation.schedule_type,
        "timezone": automation.timezone,
        "schedule_hour": automation.schedule_hour,
        "schedule_minute": automation.schedule_minute,
        "schedule_weekdays": list(automation.schedule_weekdays or []),
        "next_run_at": automation.next_run_at,
    }


def extract_time_trigger_config(normalized_graph: Mapping[str, Any]) -> dict[str, Any] | None:
    trigger_node = next((node for node in normalized_graph.get("nodes", []) if node.get("type") == "trigger"), None)
    if trigger_node is None or trigger_node.get("kind") != TIME_TRIGGER_KIND:
        return None
    config = trigger_node.get("config")
    return dict(config) if isinstance(config, Mapping) else None


def compute_next_time_trigger_run(
    trigger_config: Mapping[str, Any],
    *,
    timezone_name: str,
    reference_time: datetime | None = None,
) -> datetime | None:
    tzinfo = _time_trigger_zoneinfo(timezone_name)
    current_utc = _coerce_utc_datetime(reference_time)
    current_local_minute = current_utc.astimezone(tzinfo).replace(second=0, microsecond=0)
    weekdays = {
        weekday
        for weekday in trigger_config.get("weekdays", [])
        if isinstance(weekday, str) and weekday in TIME_TRIGGER_WEEKDAY_INDEX
    }
    hour = int(trigger_config["hour"])
    minute = int(trigger_config["minute"])

    for offset in range(0, 8):
        candidate_date = (current_local_minute + timedelta(days=offset)).date()
        if weekdays and SUPPORTED_TIME_TRIGGER_WEEKDAYS[candidate_date.weekday()] not in weekdays:
            continue

        candidate_local = datetime(
            candidate_date.year,
            candidate_date.month,
            candidate_date.day,
            hour,
            minute,
            tzinfo=tzinfo,
        )
        if candidate_local < current_local_minute:
            continue
        return candidate_local.astimezone(timezone.utc).replace(tzinfo=None)

    return None


def sync_automation_schedule_projection(
    automation: Automation,
    normalized_graph: Mapping[str, Any],
    *,
    effective_timezone: str,
    reference_time: datetime | None = None,
) -> Automation:
    trigger_config = extract_time_trigger_config(normalized_graph)
    if trigger_config is None:
        automation.schedule_type = "manual"
        automation.timezone = None
        automation.schedule_hour = None
        automation.schedule_minute = None
        automation.schedule_weekdays = []
        automation.next_run_at = None
        return automation

    timezone_name = _effective_timezone_name(effective_timezone)
    automation.schedule_type = TIME_TRIGGER_SCHEDULE_TYPE
    automation.timezone = timezone_name
    automation.schedule_hour = int(trigger_config["hour"])
    automation.schedule_minute = int(trigger_config["minute"])
    automation.schedule_weekdays = list(trigger_config.get("weekdays", []))
    automation.next_run_at = compute_next_time_trigger_run(
        trigger_config,
        timezone_name=timezone_name,
        reference_time=reference_time,
    )
    return automation


def refresh_time_trigger_automations_for_household(
    db: Session,
    *,
    household_id: int,
    effective_timezone: str,
    reference_time: datetime | None = None,
) -> int:
    automations = (
        db.query(Automation)
        .join(User, User.user_id == Automation.creator_id)
        .join(HouseholdMembership, HouseholdMembership.user_id == User.user_id)
        .filter(HouseholdMembership.household_id == household_id)
        .order_by(Automation.id.asc())
        .all()
    )

    refreshed = 0
    for automation in automations:
        try:
            normalized_graph = deserialize_automation_graph(automation.script_code)
        except AutomationGraphValidationError:
            continue

        sync_automation_schedule_projection(
            automation,
            normalized_graph,
            effective_timezone=effective_timezone,
            reference_time=reference_time,
        )
        db.add(automation)
        refreshed += 1

    return refreshed


def _load_latest_state_payloads(db: Session, device_ids: set[str]) -> dict[str, dict[str, Any]]:
    payloads: dict[str, dict[str, Any]] = {}
    for device_id in device_ids:
        latest_state = (
            db.query(DeviceHistory)
            .filter(
                DeviceHistory.device_id == device_id,
                DeviceHistory.event_type == EventType.state_change,
            )
            .order_by(DeviceHistory.timestamp.desc(), DeviceHistory.id.desc())
            .first()
        )
        decoded = _decode_history_payload(latest_state.payload if latest_state else None)
        if decoded is not None:
            payloads[device_id] = decoded
    return payloads


def _load_previous_state_payload(
    db: Session,
    device_id: str,
    *,
    current_payload: Mapping[str, Any] | None = None,
) -> dict[str, Any] | None:
    recent_states = (
        db.query(DeviceHistory)
        .filter(
            DeviceHistory.device_id == device_id,
            DeviceHistory.event_type == EventType.state_change,
        )
        .order_by(DeviceHistory.timestamp.desc(), DeviceHistory.id.desc())
        .limit(2)
        .all()
    )
    if not recent_states:
        return None

    latest_payload = _decode_history_payload(recent_states[0].payload)
    if latest_payload is None:
        return None

    if current_payload is not None and latest_payload == dict(current_payload):
        if len(recent_states) < 2:
            return None
        return _decode_history_payload(recent_states[1].payload)

    return latest_payload


def _extract_pin_snapshot(state_payload: Mapping[str, Any] | None, pin: int) -> dict[str, Any] | None:
    if not isinstance(state_payload, Mapping):
        return None

    pins = state_payload.get("pins")
    if isinstance(pins, list):
        for row in pins:
            if isinstance(row, Mapping) and row.get("pin") == pin:
                return dict(row)

    if state_payload.get("pin") == pin:
        return {
            "pin": pin,
            "value": state_payload.get("value"),
            "brightness": state_payload.get("brightness"),
        }

    return None


def _state_trigger_value_changed(
    trigger_kind: str,
    *,
    current_snapshot: Mapping[str, Any] | None,
    previous_snapshot: Mapping[str, Any] | None,
) -> bool:
    if previous_snapshot is None:
        return True

    if trigger_kind == "device_value":
        current_value = _extract_numeric_value(current_snapshot)
        previous_value = _extract_numeric_value(previous_snapshot)
    else:
        current_value = _extract_binary_value(current_snapshot)
        previous_value = _extract_binary_value(previous_snapshot)

    if current_value is None:
        return False
    if previous_value is None:
        return True
    return current_value != previous_value


def _extract_numeric_value(snapshot: Mapping[str, Any] | None) -> float | None:
    if not isinstance(snapshot, Mapping):
        return None
    for key in ("brightness", "value"):
        value = snapshot.get(key)
        if isinstance(value, bool):
            return 1.0 if value else 0.0
        if isinstance(value, (int, float)):
            return float(value)
    return None


def _extract_binary_value(snapshot: Mapping[str, Any] | None) -> bool | None:
    if not isinstance(snapshot, Mapping):
        return None
    actual = _normalize_binary_state(snapshot.get("brightness"))
    if actual is not None:
        return actual
    return _normalize_binary_state(snapshot.get("value"))


def _evaluate_condition_node(
    node: Mapping[str, Any],
    *,
    state_payloads: Mapping[str, dict[str, Any]],
) -> tuple[bool, str]:
    config = node["config"]
    device_id = config["device_id"]
    pin = config["pin"]
    snapshot = _extract_pin_snapshot(state_payloads.get(device_id), pin)

    if snapshot is None:
        return False, f"{node['id']}: no live state for {device_id} GPIO {pin}"

    if node["kind"] == "state_equals":
        actual = _normalize_binary_state(snapshot.get("brightness"))
        if actual is None:
            actual = _normalize_binary_state(snapshot.get("value"))
        if actual is None:
            return False, f"{node['id']}: GPIO {pin} is not a boolean-like state"
        expected = config["expected"] == "on"
        result = actual == expected
        return result, f"{node['id']}: GPIO {pin} expected {config['expected']} -> {str(result).lower()}"

    numeric_value = _extract_numeric_value(snapshot)
    if numeric_value is None:
        return False, f"{node['id']}: GPIO {pin} is not numeric"

    operator = config["operator"]
    target_value = float(config["value"])
    if operator == "gt":
        result = numeric_value > target_value
    elif operator == "gte":
        result = numeric_value >= target_value
    elif operator == "lt":
        result = numeric_value < target_value
    elif operator == "lte":
        result = numeric_value <= target_value
    else:
        secondary_value = float(config["secondary_value"])
        result = target_value <= numeric_value <= secondary_value

    return result, f"{node['id']}: GPIO {pin} {operator} check with {numeric_value} -> {str(result).lower()}"


def _dispatch_action(
    db: Session,
    *,
    node: Mapping[str, Any],
    publish_command: Callable[[str, dict[str, Any]], bool],
    device_lookup: Mapping[str, Device],
) -> tuple[bool, str]:
    config = node["config"]
    device_id = config["device_id"]
    device = device_lookup.get(device_id)
    if device is None:
        return False, f"{node['id']}: target device '{device_id}' is missing"
    if device.auth_status != AuthStatus.approved:
        return False, f"{node['id']}: target device '{device.name}' is not approved"

    command: dict[str, Any] = {
        "kind": "action",
        "pin": config["pin"],
        "command_id": str(uuid.uuid4()),
    }
    if node["kind"] == "set_output":
        command["value"] = int(config["value"])
        human_action = "on" if int(config["value"]) else "off"
    else:
        numeric_value = config["value"]
        if float(numeric_value).is_integer():
            numeric_value = int(numeric_value)
        command["brightness"] = numeric_value
        human_action = str(numeric_value)

    success = publish_command(device_id, command)
    db.add(
        DeviceHistory(
            device_id=device_id,
            event_type=EventType.command_requested if success else EventType.command_failed,
            payload=json.dumps(command),
            changed_by=None,
        )
    )

    action_summary = f"{node['id']}: {device.name} GPIO {config['pin']} -> {human_action}"
    if success:
        return True, action_summary
    return False, f"{action_summary} (MQTT publish failed)"


def _evaluate_graph_execution(
    db: Session,
    *,
    automation: Automation,
    normalized_graph: Mapping[str, Any],
    trigger_source: str,
    state_payloads: Mapping[str, dict[str, Any]],
    device_lookup: Mapping[str, Device],
    publish_command: Callable[[str, dict[str, Any]], bool],
    triggered_at: datetime | None = None,
    scheduled_for: datetime | None = None,
) -> AutomationExecutionLog:
    if trigger_source not in SUPPORTED_TRIGGER_SOURCES:
        raise AutomationGraphValidationError(f"Unsupported trigger source '{trigger_source}'.")

    node_by_id = {node["id"]: node for node in normalized_graph["nodes"]}
    outgoing: dict[str, list[dict[str, Any]]] = {node_id: [] for node_id in node_by_id}
    for edge in normalized_graph["edges"]:
        outgoing[edge["source_node_id"]].append(edge)

    trigger_node = next(node for node in normalized_graph["nodes"] if node["type"] == "trigger")
    evaluation_summaries: list[str] = []
    action_summaries: list[str] = []
    failures: list[str] = []
    executed_actions: set[str] = set()

    def walk(node_id: str) -> None:
        for edge in outgoing[node_id]:
            target = node_by_id[edge["target_node_id"]]
            if target["type"] == "condition":
                passed, summary = _evaluate_condition_node(target, state_payloads=state_payloads)
                evaluation_summaries.append(summary)
                if passed:
                    walk(target["id"])
                else:
                    failures.append(summary)
            elif target["type"] == "action":
                if target["id"] in executed_actions:
                    continue
                success, summary = _dispatch_action(
                    db,
                    node=target,
                    publish_command=publish_command,
                    device_lookup=device_lookup,
                )
                action_summaries.append(summary)
                executed_actions.add(target["id"])
                if not success:
                    failures.append(summary)

    walk(trigger_node["id"])
    status = ExecutionStatus.success if action_summaries and not failures else ExecutionStatus.failed
    if not action_summaries:
        error_message = "No action applied because no branch passed all conditions."
    elif failures:
        error_message = "; ".join(failures)
    else:
        error_message = None

    automation.last_triggered = triggered_at or datetime.now(timezone.utc).replace(tzinfo=None)
    log_payload = {
        "evaluations": evaluation_summaries,
        "actions": action_summaries,
    }
    execution_log = AutomationExecutionLog(
        automation_id=automation.id,
        triggered_at=automation.last_triggered,
        status=SqlExecutionStatus.success if status == ExecutionStatus.success else SqlExecutionStatus.failed,
        trigger_source=trigger_source,
        scheduled_for=scheduled_for,
        log_output=json.dumps(log_payload, ensure_ascii=True),
        error_message=error_message,
    )
    db.add(execution_log)
    db.flush()
    return execution_log


def _is_condition_miss_noop(log: AutomationExecutionLog) -> bool:
    if _enum_value(log.status, default=ExecutionStatus.failed.value) != ExecutionStatus.failed.value:
        return False
    if log.error_message != "No action applied because no branch passed all conditions.":
        return False

    payload = _decode_history_payload(log.log_output)
    if not isinstance(payload, Mapping):
        return False

    actions = payload.get("actions")
    evaluations = payload.get("evaluations")
    if not isinstance(actions, list) or actions:
        return False
    if not isinstance(evaluations, list) or not evaluations:
        return False

    return all(isinstance(summary, str) and summary.endswith("-> false") for summary in evaluations)


def trigger_automation_manually(
    db: Session,
    *,
    automation: Automation,
    publish_command: Callable[[str, dict[str, Any]], bool],
    device_scope: Mapping[str, Device] | None = None,
    triggered_at: datetime | None = None,
) -> AutomationExecutionLog:
    normalized_graph = normalize_automation_graph(
        automation.script_code,
        device_scope=device_scope,
    )
    referenced_device_ids = {
        node["config"]["device_id"]
        for node in normalized_graph["nodes"]
        if "device_id" in node["config"]
    }
    device_lookup = dict(device_scope or {})
    if referenced_device_ids:
        runtime_devices = (
            db.query(Device)
            .filter(Device.device_id.in_(sorted(referenced_device_ids)))
            .all()
        )
        device_lookup.update({device.device_id: device for device in runtime_devices})

    state_payloads = _load_latest_state_payloads(db, referenced_device_ids)
    return _evaluate_graph_execution(
        db,
        automation=automation,
        normalized_graph=normalized_graph,
        trigger_source="manual",
        state_payloads=state_payloads,
        device_lookup=device_lookup,
        publish_command=publish_command,
        triggered_at=triggered_at,
    )


def _trigger_matches_state_event(
    normalized_graph: Mapping[str, Any],
    *,
    device_id: str,
    state_payload: Mapping[str, Any],
    previous_state_payload: Mapping[str, Any] | None = None,
) -> bool:
    trigger_node = next(node for node in normalized_graph["nodes"] if node["type"] == "trigger")
    if trigger_node["kind"] == TIME_TRIGGER_KIND:
        return False
    config = trigger_node["config"]
    if config["device_id"] != device_id:
        return False
    current_snapshot = _extract_pin_snapshot(state_payload, config["pin"])
    if current_snapshot is None:
        return False
    if trigger_node["kind"] == "device_value":
        previous_snapshot = _extract_pin_snapshot(previous_state_payload, config["pin"])
        return _state_trigger_value_changed(
            trigger_node["kind"],
            current_snapshot=current_snapshot,
            previous_snapshot=previous_snapshot,
        )
    if trigger_node["kind"] == "device_on_off_event":
        previous_snapshot = _extract_pin_snapshot(previous_state_payload, config["pin"])
        return _state_trigger_value_changed(
            trigger_node["kind"],
            current_snapshot=current_snapshot,
            previous_snapshot=previous_snapshot,
        )
    return True


def process_state_event_for_automations(
    db: Session,
    *,
    device_id: str,
    state_payload: Mapping[str, Any],
    publish_command: Callable[[str, dict[str, Any]], bool],
    triggered_at: datetime | None = None,
) -> list[AutomationExecutionLog]:
    execution_logs: list[AutomationExecutionLog] = []
    db.flush()
    previous_state_payload = _load_previous_state_payload(
        db,
        device_id,
        current_payload=state_payload,
    )
    enabled_automations = (
        db.query(Automation)
        .filter(Automation.is_enabled.is_(True))
        .order_by(Automation.id.asc())
        .all()
    )

    for automation in enabled_automations:
        try:
            normalized_graph = deserialize_automation_graph(automation.script_code)
        except AutomationGraphValidationError:
            continue

        if not _trigger_matches_state_event(
            normalized_graph,
            device_id=device_id,
            state_payload=state_payload,
            previous_state_payload=previous_state_payload,
        ):
            continue

        referenced_device_ids = {
            node["config"]["device_id"]
            for node in normalized_graph["nodes"]
            if "device_id" in node["config"]
        }
        state_payloads = _load_latest_state_payloads(db, referenced_device_ids)
        state_payloads[device_id] = dict(state_payload)
        device_lookup = {
            device.device_id: device
            for device in db.query(Device).filter(Device.device_id.in_(sorted(referenced_device_ids))).all()
        }
        previous_last_triggered = automation.last_triggered
        execution_log = _evaluate_graph_execution(
            db,
            automation=automation,
            normalized_graph=normalized_graph,
            trigger_source="device_state",
            state_payloads=state_payloads,
            device_lookup=device_lookup,
            publish_command=publish_command,
            triggered_at=triggered_at,
        )
        if _is_condition_miss_noop(execution_log):
            db.delete(execution_log)
            automation.last_triggered = previous_last_triggered
            db.add(automation)
            continue

        execution_logs.append(execution_log)

    return execution_logs


def process_time_trigger_automations(
    db: Session,
    *,
    publish_command: Callable[[str, dict[str, Any]], bool],
    reference_time: datetime | None = None,
) -> list[AutomationExecutionLog]:
    execution_logs: list[AutomationExecutionLog] = []
    current_utc = _coerce_utc_datetime(reference_time)
    current_minute_utc = current_utc.replace(second=0, microsecond=0)
    current_minute_naive = current_minute_utc.replace(tzinfo=None)

    enabled_automations = (
        db.query(Automation)
        .filter(
            Automation.is_enabled.is_(True),
            Automation.schedule_type == TIME_TRIGGER_SCHEDULE_TYPE,
            Automation.next_run_at.isnot(None),
            Automation.next_run_at <= current_minute_naive,
        )
        .order_by(Automation.next_run_at.asc(), Automation.id.asc())
        .all()
    )

    for automation in enabled_automations:
        try:
            normalized_graph = deserialize_automation_graph(automation.script_code)
        except AutomationGraphValidationError:
            continue

        trigger_config = extract_time_trigger_config(normalized_graph)
        timezone_name = _effective_timezone_name(automation.timezone)

        if trigger_config is None:
            sync_automation_schedule_projection(
                automation,
                normalized_graph,
                effective_timezone=timezone_name,
                reference_time=current_utc,
            )
            db.add(automation)
            continue

        scheduled_for = automation.next_run_at
        if scheduled_for is None:
            sync_automation_schedule_projection(
                automation,
                normalized_graph,
                effective_timezone=timezone_name,
                reference_time=current_utc,
            )
            db.add(automation)
            continue

        if scheduled_for < current_minute_naive:
            automation.next_run_at = compute_next_time_trigger_run(
                trigger_config,
                timezone_name=timezone_name,
                reference_time=current_minute_utc + timedelta(minutes=1),
            )
            db.add(automation)
            continue

        referenced_device_ids = {
            node["config"]["device_id"]
            for node in normalized_graph["nodes"]
            if "device_id" in node["config"]
        }
        state_payloads = _load_latest_state_payloads(db, referenced_device_ids)
        device_lookup = {
            device.device_id: device
            for device in db.query(Device).filter(Device.device_id.in_(sorted(referenced_device_ids))).all()
        }
        execution_logs.append(
            _evaluate_graph_execution(
                db,
                automation=automation,
                normalized_graph=normalized_graph,
                trigger_source="schedule",
                state_payloads=state_payloads,
                device_lookup=device_lookup,
                publish_command=publish_command,
                triggered_at=current_utc.replace(tzinfo=None),
                scheduled_for=scheduled_for,
            )
        )
        automation.next_run_at = compute_next_time_trigger_run(
            trigger_config,
            timezone_name=timezone_name,
            reference_time=current_minute_utc + timedelta(minutes=1),
        )
        db.add(automation)

    return execution_logs
