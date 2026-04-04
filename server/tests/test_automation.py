import json
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import api as api_module
from app.auth import create_access_token
from app.database import Base, get_db
from app.services.automation_runtime import process_state_event_for_automations, process_time_trigger_automations
from app.sql_models import (
    AccountType,
    AuthStatus,
    Automation,
    AutomationExecutionLog,
    ConnStatus,
    Device,
    DeviceHistory,
    EventType,
    ExternalDevice,
    ExecutionStatus,
    Household,
    HouseholdMembership,
    HouseholdRole,
    InstalledExtension,
    PinConfiguration,
    PinMode,
    User,
)
from main import app

SQLALCHEMY_DATABASE_URL = "sqlite://"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)

client = TestClient(app)


def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def override_dependencies():
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def seeded_context():
    db = TestingSessionLocal()
    try:
        user = User(
            fullname="Automation Tester",
            username="automation-user",
            authentication="hashed_pass",
            account_type=AccountType.admin,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        household = Household(name="Automation Household")
        db.add(household)
        db.commit()
        db.refresh(household)

        membership = HouseholdMembership(
            household_id=household.household_id,
            user_id=user.user_id,
            role=HouseholdRole.owner,
        )
        db.add(membership)

        source_device = Device(
            device_id="source-device",
            mac_address="AA:BB:CC:DD:EE:01",
            name="Source Sensor",
            owner_id=user.user_id,
            auth_status=AuthStatus.approved,
            conn_status=ConnStatus.online,
            mode="library",
        )
        target_device = Device(
            device_id="target-device",
            mac_address="AA:BB:CC:DD:EE:02",
            name="Target Relay",
            owner_id=user.user_id,
            auth_status=AuthStatus.approved,
            conn_status=ConnStatus.online,
            mode="library",
        )
        dimmer_device = Device(
            device_id="dimmer-device",
            mac_address="AA:BB:CC:DD:EE:03",
            name="Target Dimmer",
            owner_id=user.user_id,
            auth_status=AuthStatus.approved,
            conn_status=ConnStatus.online,
            mode="library",
        )
        sensor_device = Device(
            device_id="sensor-device",
            mac_address="AA:BB:CC:DD:EE:04",
            name="Temperature Sensor",
            owner_id=user.user_id,
            auth_status=AuthStatus.approved,
            conn_status=ConnStatus.online,
            mode="library",
        )
        db.add_all([source_device, target_device, dimmer_device, sensor_device])
        db.commit()

        db.add_all(
            [
                PinConfiguration(
                    device_id="source-device",
                    gpio_pin=4,
                    mode=PinMode.INPUT,
                    function="switch",
                    label="Wall Switch",
                ),
                PinConfiguration(
                    device_id="target-device",
                    gpio_pin=12,
                    mode=PinMode.OUTPUT,
                    function="relay",
                    label="Relay Output",
                ),
                PinConfiguration(
                    device_id="dimmer-device",
                    gpio_pin=13,
                    mode=PinMode.PWM,
                    function="dimmer",
                    label="Dimmer Output",
                ),
                PinConfiguration(
                    device_id="sensor-device",
                    gpio_pin=34,
                    mode=PinMode.ADC,
                    function="temperature_sensor",
                    label="Temperature Probe",
                ),
            ]
        )
        db.commit()

        yield {
            "user": user,
            "household": household,
            "graph": {
                "nodes": [
                    {
                        "id": "trigger-1",
                        "type": "trigger",
                        "kind": "device_state",
                        "label": "Switch State",
                        "config": {"device_id": "source-device", "pin": 4},
                    },
                    {
                        "id": "condition-1",
                        "type": "condition",
                        "kind": "state_equals",
                        "label": "Switch Is On",
                        "config": {"device_id": "source-device", "pin": 4, "expected": "on"},
                    },
                    {
                        "id": "action-1",
                        "type": "action",
                        "kind": "set_output",
                        "label": "Turn Relay On",
                        "config": {"device_id": "target-device", "pin": 12, "value": 1},
                    },
                ],
                "edges": [
                    {
                        "source_node_id": "trigger-1",
                        "source_port": "event_out",
                        "target_node_id": "condition-1",
                        "target_port": "event_in",
                    },
                    {
                        "source_node_id": "condition-1",
                        "source_port": "pass_out",
                        "target_node_id": "action-1",
                        "target_port": "event_in",
                    },
                ],
            },
            "on_off_graph": {
                "nodes": [
                    {
                        "id": "trigger-1",
                        "type": "trigger",
                        "kind": "device_on_off_event",
                        "label": "Switch Event",
                        "config": {"device_id": "source-device", "pin": 4},
                    },
                    {
                        "id": "condition-1",
                        "type": "condition",
                        "kind": "state_equals",
                        "label": "Switch Is On",
                        "config": {"device_id": "source-device", "pin": 4, "expected": "on"},
                    },
                    {
                        "id": "action-1",
                        "type": "action",
                        "kind": "set_output",
                        "label": "Turn Relay On",
                        "config": {"device_id": "target-device", "pin": 12, "value": 1},
                    },
                ],
                "edges": [
                    {
                        "source_node_id": "trigger-1",
                        "source_port": "event_out",
                        "target_node_id": "condition-1",
                        "target_port": "event_in",
                    },
                    {
                        "source_node_id": "condition-1",
                        "source_port": "pass_out",
                        "target_node_id": "action-1",
                        "target_port": "event_in",
                    },
                ],
            },
            "numeric_graph": {
                "nodes": [
                    {
                        "id": "trigger-1",
                        "type": "trigger",
                        "kind": "device_value",
                        "config": {"device_id": "sensor-device", "pin": 34},
                    },
                    {
                        "id": "condition-1",
                        "type": "condition",
                        "kind": "numeric_compare",
                        "config": {
                            "device_id": "sensor-device",
                            "pin": 34,
                            "operator": "gt",
                            "value": 30,
                        },
                    },
                    {
                        "id": "action-1",
                        "type": "action",
                        "kind": "set_value",
                        "config": {"device_id": "dimmer-device", "pin": 13, "value": 180},
                    },
                ],
                "edges": [
                    {
                        "source_node_id": "trigger-1",
                        "source_port": "event_out",
                        "target_node_id": "condition-1",
                        "target_port": "event_in",
                    },
                    {
                        "source_node_id": "condition-1",
                        "source_port": "pass_out",
                        "target_node_id": "action-1",
                        "target_port": "event_in",
                    },
                ],
            },
            "time_graph": {
                "nodes": [
                    {
                        "id": "trigger-1",
                        "type": "trigger",
                        "kind": "time_schedule",
                        "label": "Morning Trigger",
                        "config": {"hour": 7, "minute": 30, "weekdays": []},
                    },
                    {
                        "id": "condition-1",
                        "type": "condition",
                        "kind": "state_equals",
                        "label": "Switch Is On",
                        "config": {"device_id": "source-device", "pin": 4, "expected": "on"},
                    },
                    {
                        "id": "action-1",
                        "type": "action",
                        "kind": "set_output",
                        "label": "Turn Relay On",
                        "config": {"device_id": "target-device", "pin": 12, "value": 1},
                    },
                ],
                "edges": [
                    {
                        "source_node_id": "trigger-1",
                        "source_port": "event_out",
                        "target_node_id": "condition-1",
                        "target_port": "event_in",
                    },
                    {
                        "source_node_id": "condition-1",
                        "source_port": "pass_out",
                        "target_node_id": "action-1",
                        "target_port": "event_in",
                    },
                ],
            },
        }
    finally:
        db.close()


def _auth_headers(user: User) -> dict[str, str]:
    token = create_access_token(
        {
            "sub": user.username,
            "account_type": user.account_type.value,
            "household_id": 1,
            "household_role": "owner",
        }
    )
    return {"Authorization": f"Bearer {token}"}


def _create_automation_record(graph: dict, *, creator_id: int, name: str = "Automation") -> int:
    db = TestingSessionLocal()
    try:
        automation = Automation(
            creator_id=creator_id,
            name=name,
            script_code=json.dumps(graph),
            is_enabled=True,
        )
        db.add(automation)
        db.commit()
        db.refresh(automation)
        return automation.id
    finally:
        db.close()


def _create_external_device(
    *,
    user_id: int,
    household_id: int,
    device_id: str = "external-light",
    name: str = "External Light",
    capabilities: list[str] | None = None,
    last_state: dict | None = None,
) -> str:
    db = TestingSessionLocal()
    try:
        extension = InstalledExtension(
            extension_id="yeelight_control",
            manifest_version="1.0",
            name="Yeelight LAN Lights",
            version="1.4.0",
            author="Experience",
            description="Yeelight external runtime",
            provider_key="yeelight",
            provider_name="Yeelight",
            package_runtime="python",
            package_entrypoint="main.py",
            package_root="Yeelight_control",
            archive_path="/tmp/yeelight_control-1.4.0.zip",
            archive_sha256="test-sha",
            manifest={"device_schemas": []},
        )
        db.merge(extension)
        db.flush()

        external_device = ExternalDevice(
            device_id=device_id,
            installed_extension_id="yeelight_control",
            device_schema_id="yeelight_color_light",
            household_id=household_id,
            owner_id=user_id,
            name=name,
            provider="yeelight",
            auth_status=AuthStatus.approved,
            conn_status=ConnStatus.online,
            schema_snapshot={
                "display": {
                    "card_type": "light",
                    "capabilities": capabilities or ["power", "brightness"],
                }
            },
            last_state=last_state or {"value": 1, "brightness": 180, "power": "on"},
        )
        db.merge(external_device)
        db.commit()
        return device_id
    finally:
        db.close()


def test_create_automation_persists_graph_contract(seeded_context):
    user = seeded_context["user"]

    response = client.post(
        "/api/v1/automation",
        headers=_auth_headers(user),
        json={
            "name": "Switch Mirror",
            "is_enabled": True,
            "graph": seeded_context["on_off_graph"],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "Switch Mirror"
    assert payload["graph"]["nodes"][0]["kind"] == "device_on_off_event"
    assert payload["last_execution"] is None

    db = TestingSessionLocal()
    try:
        stored = db.query(Automation).filter(Automation.creator_id == user.user_id).one()
        assert json.loads(stored.script_code)["edges"][1]["source_port"] == "pass_out"
        assert stored.schedule_type == "manual"
        assert stored.schedule_hour is None
        assert stored.next_run_at is None
    finally:
        db.close()


def test_update_automation_persists_graph_contract(seeded_context):
    user = seeded_context["user"]
    automation_id = _create_automation_record(
        seeded_context["graph"],
        creator_id=user.user_id,
        name="Editable Automation",
    )

    response = client.put(
        f"/api/v1/automation/{automation_id}",
        headers=_auth_headers(user),
        json={
            "name": "Updated Numeric Rule",
            "is_enabled": False,
            "graph": seeded_context["numeric_graph"],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "Updated Numeric Rule"
    assert payload["is_enabled"] is False
    assert payload["graph"]["nodes"][0]["kind"] == "device_value"
    assert payload["graph"]["nodes"][1]["kind"] == "numeric_compare"
    assert "script_code" not in payload

    db = TestingSessionLocal()
    try:
        stored = db.query(Automation).filter(Automation.id == automation_id).one()
        assert stored.is_enabled is False
        assert json.loads(stored.script_code)["nodes"][2]["kind"] == "set_value"
        assert stored.schedule_type == "manual"
        assert stored.next_run_at is None
    finally:
        db.close()


def test_create_automation_persists_time_trigger_projection(seeded_context):
    user = seeded_context["user"]

    response = client.post(
        "/api/v1/automation",
        headers=_auth_headers(user),
        json={
            "name": "Morning Schedule",
            "is_enabled": True,
            "graph": seeded_context["time_graph"],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["graph"]["nodes"][0]["kind"] == "time_schedule"
    assert payload["schedule_type"] == "time"
    assert payload["timezone"] == "Asia/Ho_Chi_Minh"
    assert payload["schedule_hour"] == 7
    assert payload["schedule_minute"] == 30
    assert payload["schedule_weekdays"] == []
    assert payload["next_run_at"] is not None

    db = TestingSessionLocal()
    try:
        stored = db.query(Automation).filter(Automation.creator_id == user.user_id).one()
        assert stored.schedule_type == "time"
        assert stored.timezone == "Asia/Ho_Chi_Minh"
        assert stored.schedule_hour == 7
        assert stored.schedule_minute == 30
        assert stored.next_run_at is not None
    finally:
        db.close()


def test_delete_automation_removes_rule_and_execution_logs(seeded_context):
    user = seeded_context["user"]
    automation_id = _create_automation_record(
        seeded_context["graph"],
        creator_id=user.user_id,
        name="Disposable Automation",
    )

    db = TestingSessionLocal()
    try:
        db.add(
            AutomationExecutionLog(
                automation_id=automation_id,
                status=ExecutionStatus.failed,
                trigger_source="manual",
                error_message="Smoke failure",
            )
        )
        db.commit()
    finally:
        db.close()

    response = client.delete(
        f"/api/v1/automation/{automation_id}",
        headers=_auth_headers(user),
    )

    assert response.status_code == 200
    assert response.json() == {"message": "Automation deleted."}

    db = TestingSessionLocal()
    try:
        assert db.query(Automation).filter(Automation.id == automation_id).first() is None
        assert (
            db.query(AutomationExecutionLog)
            .filter(AutomationExecutionLog.automation_id == automation_id)
            .count()
            == 0
        )
    finally:
        db.close()


def test_create_automation_rejects_invalid_graph(seeded_context):
    user = seeded_context["user"]
    invalid_graph = {
        "nodes": seeded_context["graph"]["nodes"],
        "edges": [
            *seeded_context["graph"]["edges"],
            {
                "source_node_id": "action-1",
                "source_port": "event_out",
                "target_node_id": "trigger-1",
                "target_port": "event_in",
            },
        ],
    }

    response = client.post(
        "/api/v1/automation",
        headers=_auth_headers(user),
        json={
            "name": "Broken Graph",
            "is_enabled": True,
            "graph": invalid_graph,
        },
    )

    assert response.status_code == 400
    payload = response.json()
    assert payload["detail"]["error"] == "validation"
    assert "Edges must connect into a condition/action 'event_in' port" in payload["detail"]["message"]


def test_create_automation_rejects_invalid_trigger_mode_for_pin(seeded_context):
    user = seeded_context["user"]
    db = TestingSessionLocal()
    try:
        from app.sql_models import PinConfiguration, PinMode
        db.add(
            PinConfiguration(
                device_id="sensor-device",
                gpio_pin=15,
                mode=PinMode.I2C,
                function="i2c",
                label="I2C SCL",
            )
        )
        db.commit()
    finally:
        db.close()

    invalid_graph = {
        "nodes": [
            {
                "id": "trigger-1",
                "type": "trigger",
                "kind": "device_on_off_event",
                "config": {"device_id": "sensor-device", "pin": 15},
            },
            {
                "id": "condition-1",
                "type": "condition",
                "kind": "numeric_compare",
                "config": {"device_id": "sensor-device", "pin": 15, "operator": "gt", "value": 30},
            },
            {
                "id": "action-1",
                "type": "action",
                "kind": "set_value",
                "config": {"device_id": "dimmer-device", "pin": 13, "value": 180},
            },
        ],
        "edges": seeded_context["numeric_graph"]["edges"],
    }

    response = client.post(
        "/api/v1/automation",
        headers=_auth_headers(user),
        json={
            "name": "Invalid Trigger Mode",
            "is_enabled": True,
            "graph": invalid_graph,
        },
    )

    assert response.status_code == 400, f"Expected 400 but got {response.status_code}. Response: {response.json()}"
    payload = response.json()
    assert payload["detail"]["error"] == "validation"
    assert "device_on_off_event triggers require a boolean-like pin" in payload["detail"]["message"]


def test_create_automation_rejects_invalid_time_trigger_weekday(seeded_context):
    user = seeded_context["user"]
    invalid_graph = {
        "nodes": [
            {
                "id": "trigger-1",
                "type": "trigger",
                "kind": "time_schedule",
                "config": {"hour": 7, "minute": 30, "weekdays": ["funday"]},
            },
            *seeded_context["graph"]["nodes"][1:],
        ],
        "edges": seeded_context["graph"]["edges"],
    }

    response = client.post(
        "/api/v1/automation",
        headers=_auth_headers(user),
        json={
            "name": "Broken Schedule",
            "is_enabled": True,
            "graph": invalid_graph,
        },
    )

    assert response.status_code == 400
    payload = response.json()
    assert payload["detail"]["error"] == "validation"
    assert "Time trigger weekdays must use" in payload["detail"]["message"]


def test_automation_openapi_exposes_graph_contract():
    response = client.get("/openapi.json")

    assert response.status_code == 200
    spec = response.json()
    for schema_name in ("AutomationCreate", "AutomationUpdate", "AutomationResponse"):
        schema = spec["components"]["schemas"][schema_name]
        assert "graph" in schema["properties"]
        assert "script_code" not in schema["properties"]

    create_schema = spec["components"]["schemas"]["AutomationCreate"]
    update_schema = spec["components"]["schemas"]["AutomationUpdate"]
    assert create_schema["required"] == ["name", "graph"]
    assert update_schema["required"] == ["name", "graph"]


def test_list_automations_accepts_legacy_schedule_logs(seeded_context):
    user = seeded_context["user"]
    automation_id = _create_automation_record(
        seeded_context["graph"],
        creator_id=user.user_id,
        name="Legacy Schedule Automation",
    )

    db = TestingSessionLocal()
    try:
        db.add(
            AutomationExecutionLog(
                automation_id=automation_id,
                status=ExecutionStatus.success,
                trigger_source="schedule",
                log_output=json.dumps({"actions": ["legacy run"]}),
            )
        )
        db.commit()
    finally:
        db.close()

    response = client.get(
        "/api/v1/automations",
        headers=_auth_headers(user),
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["graph"]["nodes"][0]["kind"] == "device_state"
    assert payload[0]["last_execution"]["trigger_source"] == "schedule"


def test_schedule_context_returns_effective_server_timezone(seeded_context):
    user = seeded_context["user"]
    db = TestingSessionLocal()
    try:
        household = db.query(Household).first()
        assert household is not None
        household.timezone = "Asia/Tokyo"
        db.add(household)
        db.commit()
    finally:
        db.close()

    response = client.get(
        "/api/v1/automation/schedule-context",
        headers=_auth_headers(user),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["effective_timezone"] == "Asia/Tokyo"
    assert payload["timezone_source"] == "setting"
    assert isinstance(payload["current_server_time"], str)


def test_system_time_context_returns_effective_server_timezone(seeded_context):
    user = seeded_context["user"]
    db = TestingSessionLocal()
    try:
        household = db.query(Household).first()
        assert household is not None
        household.timezone = "Asia/Tokyo"
        db.add(household)
        db.commit()
    finally:
        db.close()

    response = client.get(
        "/api/v1/system/time-context",
        headers=_auth_headers(user),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["effective_timezone"] == "Asia/Tokyo"
    assert payload["timezone_source"] == "setting"
    assert isinstance(payload["current_server_time"], str)


def test_list_devices_includes_external_automation_pin_configurations(seeded_context):
    user = seeded_context["user"]
    household = seeded_context["household"]
    external_device_id = _create_external_device(
        user_id=user.user_id,
        household_id=household.household_id,
    )

    response = client.get(
        "/api/v1/devices",
        headers=_auth_headers(user),
    )

    assert response.status_code == 200
    payload = response.json()
    external_device = next(item for item in payload if item["device_id"] == external_device_id)
    pins = {row["gpio_pin"]: row for row in external_device["pin_configurations"]}
    assert pins[0]["mode"] == "OUTPUT"
    assert pins[0]["function"] == "switch"
    assert pins[1]["mode"] == "PWM"
    assert pins[1]["function"] == "brightness"


def test_manual_trigger_uses_persisted_external_device_switch_state(seeded_context, monkeypatch):
    user = seeded_context["user"]
    household = seeded_context["household"]
    external_device_id = _create_external_device(
        user_id=user.user_id,
        household_id=household.household_id,
        last_state={"value": 1, "brightness": 180, "power": "on"},
    )
    automation_id = _create_automation_record(
        {
            "nodes": [
                {
                    "id": "trigger-1",
                    "type": "trigger",
                    "kind": "time_schedule",
                    "config": {"hour": 7, "minute": 30, "weekdays": []},
                },
                {
                    "id": "condition-1",
                    "type": "condition",
                    "kind": "state_equals",
                    "config": {"device_id": external_device_id, "pin": 0, "expected": "on"},
                },
                {
                    "id": "action-1",
                    "type": "action",
                    "kind": "set_output",
                    "config": {"device_id": "target-device", "pin": 12, "value": 1},
                },
            ],
            "edges": [
                {
                    "source_node_id": "trigger-1",
                    "source_port": "event_out",
                    "target_node_id": "condition-1",
                    "target_port": "event_in",
                },
                {
                    "source_node_id": "condition-1",
                    "source_port": "pass_out",
                    "target_node_id": "action-1",
                    "target_port": "event_in",
                },
            ],
        },
        creator_id=user.user_id,
        name="External Switch Condition",
    )
    enqueue_calls: list[tuple[str, dict]] = []

    def fake_enqueue(device_id: str, command: dict) -> bool:
        enqueue_calls.append((device_id, command))
        return True

    monkeypatch.setattr(api_module.mqtt_manager, "enqueue_command", fake_enqueue)

    response = client.post(
        f"/api/v1/automation/{automation_id}/trigger",
        headers=_auth_headers(user),
    )

    assert response.status_code == 200
    assert response.json()["status"] == "success"
    assert len(enqueue_calls) == 1
    assert enqueue_calls[0][0] == "target-device"
    assert enqueue_calls[0][1]["value"] == 1


def test_process_state_event_runs_enabled_automation_for_external_device_value_trigger(seeded_context):
    user = seeded_context["user"]
    household = seeded_context["household"]
    external_device_id = _create_external_device(
        user_id=user.user_id,
        household_id=household.household_id,
        last_state={"value": 0, "brightness": 0, "power": "off"},
    )
    automation_id = _create_automation_record(
        {
            "nodes": [
                {
                    "id": "trigger-1",
                    "type": "trigger",
                    "kind": "device_value",
                    "config": {"device_id": external_device_id, "pin": 1},
                },
                {
                    "id": "condition-1",
                    "type": "condition",
                    "kind": "numeric_compare",
                    "config": {"device_id": external_device_id, "pin": 1, "operator": "gt", "value": 100},
                },
                {
                    "id": "action-1",
                    "type": "action",
                    "kind": "set_output",
                    "config": {"device_id": "target-device", "pin": 12, "value": 1},
                },
            ],
            "edges": [
                {
                    "source_node_id": "trigger-1",
                    "source_port": "event_out",
                    "target_node_id": "condition-1",
                    "target_port": "event_in",
                },
                {
                    "source_node_id": "condition-1",
                    "source_port": "pass_out",
                    "target_node_id": "action-1",
                    "target_port": "event_in",
                },
            ],
        },
        creator_id=user.user_id,
        name="External Value Trigger",
    )
    published_commands: list[tuple[str, dict]] = []

    def fake_publish(device_id: str, command: dict) -> bool:
        published_commands.append((device_id, command))
        return True

    db = TestingSessionLocal()
    try:
        logs = process_state_event_for_automations(
            db,
            device_id=external_device_id,
            state_payload={"pins": [{"pin": 1, "value": 180, "brightness": 180}]},
            previous_state_payload={"pins": [{"pin": 1, "value": 0, "brightness": 0}]},
            publish_command=fake_publish,
        )
        db.commit()
    finally:
        db.close()

    assert len(logs) == 1
    assert logs[0].automation_id == automation_id
    assert published_commands
    assert published_commands[0][0] == "target-device"
    assert published_commands[0][1]["value"] == 1


def test_manual_trigger_dispatches_external_device_value_action(monkeypatch, seeded_context):
    user = seeded_context["user"]
    household = seeded_context["household"]
    external_device_id = _create_external_device(
        user_id=user.user_id,
        household_id=household.household_id,
    )
    automation_id = _create_automation_record(
        {
            "nodes": [
                {
                    "id": "trigger-1",
                    "type": "trigger",
                    "kind": "time_schedule",
                    "config": {"hour": 7, "minute": 30, "weekdays": []},
                },
                {
                    "id": "condition-1",
                    "type": "condition",
                    "kind": "state_equals",
                    "config": {"device_id": "source-device", "pin": 4, "expected": "on"},
                },
                {
                    "id": "action-1",
                    "type": "action",
                    "kind": "set_value",
                    "config": {"device_id": external_device_id, "pin": 1, "value": 200},
                },
            ],
            "edges": [
                {
                    "source_node_id": "trigger-1",
                    "source_port": "event_out",
                    "target_node_id": "condition-1",
                    "target_port": "event_in",
                },
                {
                    "source_node_id": "condition-1",
                    "source_port": "pass_out",
                    "target_node_id": "action-1",
                    "target_port": "event_in",
                },
            ],
        },
        creator_id=user.user_id,
        name="External Value Action",
    )
    dispatched: list[tuple[str, dict]] = []

    def fake_dispatch(db, *, device_id: str, command: dict, on_state_change=None) -> bool:
        dispatched.append((device_id, command))
        return True

    monkeypatch.setattr(api_module, "dispatch_external_device_automation_command", fake_dispatch)

    db = TestingSessionLocal()
    try:
        db.add(
            DeviceHistory(
                device_id="source-device",
                event_type=EventType.state_change,
                payload=json.dumps({"pins": [{"pin": 4, "value": 1}]}),
            )
        )
        db.commit()
    finally:
        db.close()

    response = client.post(
        f"/api/v1/automation/{automation_id}/trigger",
        headers=_auth_headers(user),
    )

    assert response.status_code == 200
    assert response.json()["status"] == "success"
    assert dispatched
    assert dispatched[0][0] == external_device_id
    assert dispatched[0][1]["pin"] == 1
    assert dispatched[0][1]["brightness"] == 200


def test_manual_trigger_executes_graph_and_records_log(monkeypatch, seeded_context):
    user = seeded_context["user"]
    automation_id = _create_automation_record(
        seeded_context["graph"],
        creator_id=user.user_id,
        name="Manual Trigger",
    )
    published_commands: list[tuple[str, dict]] = []

    def fake_publish(device_id: str, command: dict) -> bool:
        published_commands.append((device_id, command))
        return True

    monkeypatch.setattr(api_module.mqtt_manager, "enqueue_command", fake_publish)

    db = TestingSessionLocal()
    try:
        db.add(
            DeviceHistory(
                device_id="source-device",
                event_type=EventType.state_change,
                payload=json.dumps({"pins": [{"pin": 4, "value": 1}]}),
            )
        )
        db.commit()
    finally:
        db.close()

    response = client.post(
        f"/api/v1/automation/{automation_id}/trigger",
        headers=_auth_headers(user),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "success"
    assert payload["log"]["trigger_source"] == "manual"
    assert published_commands
    assert published_commands[0][0] == "target-device"
    assert published_commands[0][1]["pin"] == 12
    assert published_commands[0][1]["value"] == 1

    db = TestingSessionLocal()
    try:
        log = (
            db.query(AutomationExecutionLog)
            .filter(AutomationExecutionLog.automation_id == automation_id)
            .order_by(AutomationExecutionLog.id.desc())
            .first()
        )
        assert log is not None
        assert log.status == ExecutionStatus.success
        log_payload = json.loads(log.log_output or "{}")
        assert log_payload["actions"]

        command_history = (
            db.query(DeviceHistory)
            .filter(
                DeviceHistory.device_id == "target-device",
                DeviceHistory.event_type == EventType.command_requested,
            )
            .order_by(DeviceHistory.id.desc())
            .first()
        )
        assert command_history is not None
        assert command_history.changed_by is None
    finally:
        db.close()


def test_manual_trigger_uses_enqueue_command(monkeypatch, seeded_context):
    user = seeded_context["user"]
    automation_id = _create_automation_record(
        seeded_context["graph"],
        creator_id=user.user_id,
        name="Manual Trigger Enqueue",
    )
    enqueue_calls: list[tuple[str, dict]] = []

    def fake_enqueue(device_id: str, command: dict) -> bool:
        enqueue_calls.append((device_id, command))
        return True

    def fail_publish(*args, **kwargs):
        raise AssertionError("Manual automation trigger should use enqueue_command")

    monkeypatch.setattr(api_module.mqtt_manager, "enqueue_command", fake_enqueue)
    monkeypatch.setattr(api_module.mqtt_manager, "publish_command", fail_publish)

    db = TestingSessionLocal()
    try:
        db.add(
            DeviceHistory(
                device_id="source-device",
                event_type=EventType.state_change,
                payload=json.dumps({"pins": [{"pin": 4, "value": 1}]}),
            )
        )
        db.commit()
    finally:
        db.close()

    response = client.post(
        f"/api/v1/automation/{automation_id}/trigger",
        headers=_auth_headers(user),
    )

    assert response.status_code == 200
    assert enqueue_calls
    assert enqueue_calls[0][0] == "target-device"
    assert enqueue_calls[0][1]["pin"] == 12
    assert enqueue_calls[0][1]["value"] == 1


def test_process_state_event_runs_enabled_automation_for_device_value_trigger(monkeypatch, seeded_context):
    user = seeded_context["user"]
    automation_id = _create_automation_record(
        seeded_context["numeric_graph"],
        creator_id=user.user_id,
        name="Numeric Trigger",
    )
    published_commands: list[tuple[str, dict]] = []

    def fake_publish(device_id: str, command: dict) -> bool:
        published_commands.append((device_id, command))
        return True

    db = TestingSessionLocal()
    try:
        logs = process_state_event_for_automations(
            db,
            device_id="sensor-device",
            state_payload={"pins": [{"pin": 34, "value": 42}]},
            publish_command=fake_publish,
        )
        db.commit()
    finally:
        db.close()

    assert len(logs) == 1
    assert logs[0].automation_id == automation_id
    assert logs[0].trigger_source == "device_state"
    assert published_commands
    assert published_commands[0][0] == "dimmer-device"
    assert published_commands[0][1]["brightness"] == 180

    db = TestingSessionLocal()
    try:
        history = (
            db.query(DeviceHistory)
            .filter(
                DeviceHistory.device_id == "dimmer-device",
                DeviceHistory.event_type == EventType.command_requested,
            )
            .order_by(DeviceHistory.id.desc())
            .first()
        )
        assert history is not None

        log = (
            db.query(AutomationExecutionLog)
            .filter(AutomationExecutionLog.automation_id == automation_id)
            .order_by(AutomationExecutionLog.id.desc())
            .first()
        )
        assert log is not None
        assert log.status == ExecutionStatus.success
    finally:
        db.close()


def test_process_state_event_ignores_duplicate_numeric_snapshot(seeded_context):
    user = seeded_context["user"]
    automation_id = _create_automation_record(
        seeded_context["numeric_graph"],
        creator_id=user.user_id,
        name="Numeric Trigger Deduped",
    )
    published_commands: list[tuple[str, dict]] = []

    def fake_publish(device_id: str, command: dict) -> bool:
        published_commands.append((device_id, command))
        return True

    payload = {"pins": [{"pin": 34, "value": 42}]}

    db = TestingSessionLocal()
    try:
        db.add(
            DeviceHistory(
                device_id="sensor-device",
                event_type=EventType.state_change,
                payload=json.dumps(payload),
            )
        )
        db.flush()
        first_logs = process_state_event_for_automations(
            db,
            device_id="sensor-device",
            state_payload=payload,
            publish_command=fake_publish,
        )
        db.commit()

        db.add(
            DeviceHistory(
                device_id="sensor-device",
                event_type=EventType.state_change,
                payload=json.dumps(payload),
            )
        )
        db.flush()
        second_logs = process_state_event_for_automations(
            db,
            device_id="sensor-device",
            state_payload=payload,
            publish_command=fake_publish,
        )
        db.commit()
    finally:
        db.close()

    assert len(first_logs) == 1
    assert second_logs == []
    assert len(published_commands) == 1

    db = TestingSessionLocal()
    try:
        logs = (
            db.query(AutomationExecutionLog)
            .filter(AutomationExecutionLog.automation_id == automation_id)
            .order_by(AutomationExecutionLog.id.asc())
            .all()
        )
        assert len(logs) == 1
        assert logs[0].status == ExecutionStatus.success
    finally:
        db.close()


def test_process_state_event_runs_enabled_automation_for_on_off_trigger(monkeypatch, seeded_context):
    user = seeded_context["user"]
    automation_id = _create_automation_record(
        seeded_context["on_off_graph"],
        creator_id=user.user_id,
        name="Switch Event Trigger",
    )
    published_commands: list[tuple[str, dict]] = []

    def fake_publish(device_id: str, command: dict) -> bool:
        published_commands.append((device_id, command))
        return True

    db = TestingSessionLocal()
    try:
        logs = process_state_event_for_automations(
            db,
            device_id="source-device",
            state_payload={"pins": [{"pin": 4, "value": 1}]},
            publish_command=fake_publish,
        )
        db.commit()
    finally:
        db.close()

    assert len(logs) == 1
    assert logs[0].automation_id == automation_id
    assert logs[0].trigger_source == "device_state"
    assert published_commands
    assert published_commands[0][0] == "target-device"
    assert published_commands[0][1]["value"] == 1


def test_process_state_event_ignores_duplicate_on_off_snapshot(seeded_context):
    user = seeded_context["user"]
    automation_id = _create_automation_record(
        seeded_context["on_off_graph"],
        creator_id=user.user_id,
        name="Switch Event Trigger Deduped",
    )
    published_commands: list[tuple[str, dict]] = []

    def fake_publish(device_id: str, command: dict) -> bool:
        published_commands.append((device_id, command))
        return True

    payload = {"pins": [{"pin": 4, "value": 1}]}

    db = TestingSessionLocal()
    try:
        db.add(
            DeviceHistory(
                device_id="source-device",
                event_type=EventType.state_change,
                payload=json.dumps(payload),
            )
        )
        db.flush()
        first_logs = process_state_event_for_automations(
            db,
            device_id="source-device",
            state_payload=payload,
            publish_command=fake_publish,
        )
        db.commit()

        db.add(
            DeviceHistory(
                device_id="source-device",
                event_type=EventType.state_change,
                payload=json.dumps(payload),
            )
        )
        db.flush()
        second_logs = process_state_event_for_automations(
            db,
            device_id="source-device",
            state_payload=payload,
            publish_command=fake_publish,
        )
        db.commit()
    finally:
        db.close()

    assert len(first_logs) == 1
    assert second_logs == []
    assert len(published_commands) == 1

    db = TestingSessionLocal()
    try:
        logs = (
            db.query(AutomationExecutionLog)
            .filter(AutomationExecutionLog.automation_id == automation_id)
            .order_by(AutomationExecutionLog.id.asc())
            .all()
        )
        assert len(logs) == 1
        assert logs[0].status == ExecutionStatus.success
    finally:
        db.close()


def test_process_state_event_ignores_follow_up_noop_after_self_target_change(seeded_context):
    user = seeded_context["user"]
    automation_id = _create_automation_record(
        {
            "nodes": [
                {
                    "id": "trigger-1",
                    "type": "trigger",
                    "kind": "device_value",
                    "config": {"device_id": "dimmer-device", "pin": 13},
                },
                {
                    "id": "condition-1",
                    "type": "condition",
                    "kind": "numeric_compare",
                    "config": {
                        "device_id": "dimmer-device",
                        "pin": 13,
                        "operator": "lte",
                        "value": 0,
                    },
                },
                {
                    "id": "action-1",
                    "type": "action",
                    "kind": "set_value",
                    "config": {"device_id": "dimmer-device", "pin": 13, "value": 180},
                },
            ],
            "edges": [
                {
                    "source_node_id": "trigger-1",
                    "source_port": "event_out",
                    "target_node_id": "condition-1",
                    "target_port": "event_in",
                },
                {
                    "source_node_id": "condition-1",
                    "source_port": "pass_out",
                    "target_node_id": "action-1",
                    "target_port": "event_in",
                },
            ],
        },
        creator_id=user.user_id,
        name="Self Target Guard",
    )
    published_commands: list[tuple[str, dict]] = []

    def fake_publish(device_id: str, command: dict) -> bool:
        published_commands.append((device_id, command))
        return True

    initial_payload = {"pins": [{"pin": 13, "value": 0, "brightness": 0}]}
    follow_up_payload = {"pins": [{"pin": 13, "value": 1, "brightness": 180}]}

    db = TestingSessionLocal()
    try:
        db.add(
            DeviceHistory(
                device_id="dimmer-device",
                event_type=EventType.state_change,
                payload=json.dumps(initial_payload),
            )
        )
        db.flush()
        first_logs = process_state_event_for_automations(
            db,
            device_id="dimmer-device",
            state_payload=initial_payload,
            publish_command=fake_publish,
        )
        db.commit()

        db.add(
            DeviceHistory(
                device_id="dimmer-device",
                event_type=EventType.state_change,
                payload=json.dumps(follow_up_payload),
            )
        )
        db.flush()
        second_logs = process_state_event_for_automations(
            db,
            device_id="dimmer-device",
            state_payload=follow_up_payload,
            publish_command=fake_publish,
        )
        db.commit()
    finally:
        db.close()

    assert len(first_logs) == 1
    assert first_logs[0].status == ExecutionStatus.success
    assert second_logs == []
    assert len(published_commands) == 1

    db = TestingSessionLocal()
    try:
        logs = (
            db.query(AutomationExecutionLog)
            .filter(AutomationExecutionLog.automation_id == automation_id)
            .order_by(AutomationExecutionLog.id.asc())
            .all()
        )
        assert len(logs) == 1
        assert logs[0].status == ExecutionStatus.success
    finally:
        db.close()


def test_process_time_trigger_runs_enabled_automation_once_per_scheduled_minute(seeded_context, monkeypatch):
    user = seeded_context["user"]
    fixed_now = datetime(2026, 4, 2, 0, 0, tzinfo=timezone.utc)

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            if tz is None:
                return fixed_now.replace(tzinfo=None)
            return fixed_now.astimezone(tz)

    monkeypatch.setattr(api_module, "datetime", FixedDateTime)

    response = client.post(
        "/api/v1/automation",
        headers=_auth_headers(user),
        json={
            "name": "Scheduled Trigger",
            "is_enabled": True,
            "graph": seeded_context["time_graph"],
        },
    )
    assert response.status_code == 200
    automation_id = response.json()["id"]
    published_commands: list[tuple[str, dict]] = []

    def fake_publish(device_id: str, command: dict) -> bool:
        published_commands.append((device_id, command))
        return True

    db = TestingSessionLocal()
    try:
        db.add(
            DeviceHistory(
                device_id="source-device",
                event_type=EventType.state_change,
                payload=json.dumps({"pins": [{"pin": 4, "value": 1}]}),
            )
        )
        db.commit()

        first_logs = process_time_trigger_automations(
            db,
            publish_command=fake_publish,
            reference_time=datetime(2026, 4, 2, 0, 30, tzinfo=timezone.utc),
        )
        db.commit()

        second_logs = process_time_trigger_automations(
            db,
            publish_command=fake_publish,
            reference_time=datetime(2026, 4, 2, 0, 30, tzinfo=timezone.utc),
        )
        db.commit()
    finally:
        db.close()

    assert len(first_logs) == 1
    assert first_logs[0].automation_id == automation_id
    assert first_logs[0].trigger_source == "schedule"
    assert first_logs[0].scheduled_for == datetime(2026, 4, 2, 0, 30)
    assert second_logs == []
    assert len(published_commands) == 1
    assert published_commands[0][0] == "target-device"
    assert published_commands[0][1]["value"] == 1

    db = TestingSessionLocal()
    try:
        log = (
            db.query(AutomationExecutionLog)
            .filter(AutomationExecutionLog.automation_id == automation_id)
            .order_by(AutomationExecutionLog.id.desc())
            .first()
        )
        assert log is not None
        assert log.trigger_source == "schedule"
        assert log.scheduled_for == datetime(2026, 4, 2, 0, 30)

        automation = db.query(Automation).filter(Automation.id == automation_id).one()
        assert automation.next_run_at is not None
        assert automation.next_run_at > datetime(2026, 4, 2, 0, 30)
    finally:
        db.close()
