import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import api as api_module
from app.auth import create_access_token
from app.database import Base, get_db
from app.services.automation_runtime import process_state_event_for_automations
from app.sql_models import (
    AccountType,
    AuthStatus,
    Automation,
    AutomationExecutionLog,
    ConnStatus,
    Device,
    DeviceHistory,
    EventType,
    ExecutionStatus,
    Household,
    HouseholdMembership,
    HouseholdRole,
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
        db.add_all([source_device, target_device, dimmer_device])
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
            ]
        )
        db.commit()

        yield {
            "user": user,
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
            "numeric_graph": {
                "nodes": [
                    {
                        "id": "trigger-1",
                        "type": "trigger",
                        "kind": "device_state",
                        "config": {"device_id": "source-device", "pin": 4},
                    },
                    {
                        "id": "condition-1",
                        "type": "condition",
                        "kind": "numeric_compare",
                        "config": {
                            "device_id": "source-device",
                            "pin": 4,
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


def test_create_automation_persists_graph_contract(seeded_context):
    user = seeded_context["user"]

    response = client.post(
        "/api/v1/automation",
        headers=_auth_headers(user),
        json={
            "name": "Switch Mirror",
            "is_enabled": True,
            "graph": seeded_context["graph"],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "Switch Mirror"
    assert payload["graph"]["nodes"][0]["kind"] == "device_state"
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
    assert "Action nodes cannot have outgoing edges." in payload["detail"]["message"]


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

    monkeypatch.setattr(api_module.mqtt_manager, "publish_command", fake_publish)

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


def test_process_state_event_runs_enabled_automation(monkeypatch, seeded_context):
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
            device_id="source-device",
            state_payload={"pins": [{"pin": 4, "value": 42}]},
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
