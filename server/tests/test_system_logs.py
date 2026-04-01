from datetime import datetime, timedelta

import app.api as api_module
import app.mqtt as mqtt_module
import main
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import close_all_sessions, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import get_password_hash
from app.database import Base, get_db
from app.services.system_logs import (
    SYSTEM_LOG_RETENTION_DAYS,
    create_system_log,
    prune_expired_system_logs,
    record_server_startup,
)
from app.sql_models import (
    AccountType,
    Household,
    HouseholdMembership,
    HouseholdRole,
    SystemLog,
    SystemLogCategory,
    SystemLogSeverity,
    User,
    UserApprovalStatus,
)


SQLALCHEMY_DATABASE_URL = "sqlite://"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


def setup_function():
    close_all_sessions()
    main.app.dependency_overrides[get_db] = override_get_db
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def teardown_function():
    main.app.dependency_overrides.clear()
    main.app.state.firmware_network_state = None
    main.app.state.firmware_network_audit = None
    main.app.state.server_started_at = None
    Base.metadata.drop_all(bind=engine)
    close_all_sessions()


def create_admin_user(username: str = "logs-admin", household_timezone: str | None = None) -> User:
    db = TestingSessionLocal()
    try:
        user = User(
            username=username,
            fullname="Logs Admin",
            authentication=get_password_hash("password"),
            approval_status=UserApprovalStatus.approved,
            account_type=AccountType.admin,
        )
        household = Household(name="Logs Household", timezone=household_timezone)
        db.add_all([user, household])
        db.commit()
        db.refresh(user)
        db.refresh(household)

        db.add(
            HouseholdMembership(
                user_id=user.user_id,
                household_id=household.household_id,
                role=HouseholdRole.owner,
            )
        )
        db.commit()
        db.refresh(user)
        return user
    finally:
        db.close()


def get_token(client: TestClient, username: str = "logs-admin") -> str:
    response = client.post(
        "/api/v1/auth/token",
        data={"username": username, "password": "password"},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def test_record_server_startup_marks_unclean_shutdown_when_previous_session_lacked_shutdown():
    db = TestingSessionLocal()
    try:
        create_system_log(
            db,
            occurred_at=datetime.utcnow() - timedelta(hours=1),
            event_code="server_started",
            message="Previous server start.",
            severity=SystemLogSeverity.info,
            category=SystemLogCategory.lifecycle,
        )
        db.commit()

        record_server_startup(
            db,
            occurred_at=datetime.utcnow(),
            advertised_host="192.168.1.25",
        )
        db.commit()

        event_codes = [
            row.event_code
            for row in db.query(SystemLog).order_by(SystemLog.id.asc()).all()
        ]
        assert event_codes[-2:] == [
            "server_unclean_shutdown_detected",
            "server_started",
        ]
    finally:
        db.close()


def test_prune_expired_system_logs_deletes_rows_older_than_retention():
    db = TestingSessionLocal()
    try:
        create_system_log(
            db,
            occurred_at=datetime.utcnow() - timedelta(days=SYSTEM_LOG_RETENTION_DAYS + 1),
            event_code="expired_entry",
            message="Expired entry",
        )
        create_system_log(
            db,
            occurred_at=datetime.utcnow(),
            event_code="recent_entry",
            message="Recent entry",
        )
        db.commit()

        deleted = prune_expired_system_logs(db, reference_time=datetime.utcnow())
        db.commit()

        remaining_codes = [row.event_code for row in db.query(SystemLog).all()]
        assert deleted == 1
        assert remaining_codes == ["recent_entry"]
    finally:
        db.close()


def test_system_status_and_logs_endpoints_return_recent_admin_view(monkeypatch):
    create_admin_user(household_timezone="Asia/Tokyo")

    db = TestingSessionLocal()
    try:
        create_system_log(
            db,
            occurred_at=datetime.utcnow() - timedelta(minutes=5),
            event_code="mqtt_disconnected",
            message="MQTT broker connection dropped.",
            severity=SystemLogSeverity.critical,
            category=SystemLogCategory.connectivity,
        )
        create_system_log(
            db,
            occurred_at=datetime.utcnow() - timedelta(days=SYSTEM_LOG_RETENTION_DAYS + 2),
            event_code="expired_entry",
            message="Should not appear in API list.",
            severity=SystemLogSeverity.info,
            category=SystemLogCategory.lifecycle,
        )
        db.commit()
    finally:
        db.close()

    monkeypatch.setattr(
        api_module,
        "collect_system_metrics",
        lambda: {
            "cpu_percent": 22.5,
            "memory_used": 1024,
            "memory_total": 2048,
            "storage_used": 4096,
            "storage_total": 8192,
        },
    )
    monkeypatch.setattr(api_module.mqtt_manager, "connected", False)
    with TestClient(main.app) as client:
        main.app.state.server_started_at = datetime.utcnow() - timedelta(minutes=15)
        main.app.state.database_ready = True
        main.app.state.firmware_network_state = {
            "source": "startup_auto",
            "targets": {
                "advertised_host": "192.168.1.44",
                "api_base_url": "http://192.168.1.44:3000/api/v1",
                "mqtt_broker": "192.168.1.44",
                "mqtt_port": 1883,
                "target_key": "192.168.1.44|http://192.168.1.44:3000/api/v1|192.168.1.44|1883",
            },
            "error": None,
        }
        token = get_token(client)

        status_response = client.get(
            "/api/v1/system/live-status",
            headers={"Authorization": f"Bearer {token}"},
        )
        logs_response = client.get(
            "/api/v1/system/logs",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert status_response.status_code == 200, status_response.text
    status_payload = status_response.json()
    assert status_payload["overall_status"] == "critical"
    assert status_payload["database_status"] == "ok"
    assert status_payload["mqtt_status"] == "disconnected"
    assert status_payload["advertised_host"] == "192.168.1.44"
    assert status_payload["active_alert_count"] == 1
    assert status_payload["effective_timezone"] == "Asia/Tokyo"
    assert status_payload["timezone_source"] == "setting"
    assert status_payload["current_server_time"].endswith("+09:00")
    assert status_payload["latest_alert_message"] == "MQTT broker connection dropped."
    assert status_payload["latest_alert_at"].endswith("+00:00") or status_payload["latest_alert_at"].endswith("Z")

    assert logs_response.status_code == 200, logs_response.text
    logs_payload = logs_response.json()
    assert logs_payload["total"] == 1
    assert logs_payload["effective_timezone"] == "Asia/Tokyo"
    assert logs_payload["timezone_source"] == "setting"
    assert logs_payload["current_server_time"].endswith("+09:00")
    assert [entry["event_code"] for entry in logs_payload["entries"]] == ["mqtt_disconnected"]
    assert logs_payload["entries"][0]["severity"] == "critical"
    assert logs_payload["entries"][0]["is_read"] is False
    assert logs_payload["entries"][0]["occurred_at"].endswith("+00:00") or logs_payload["entries"][0]["occurred_at"].endswith("Z")


def test_marking_alert_read_removes_it_from_active_status(monkeypatch):
    create_admin_user()

    db = TestingSessionLocal()
    try:
        create_system_log(
            db,
            occurred_at=datetime.utcnow() - timedelta(minutes=3),
            event_code="mqtt_disconnected",
            message="MQTT broker connection dropped.",
            severity=SystemLogSeverity.critical,
            category=SystemLogCategory.connectivity,
        )
        db.commit()
        alert_id = db.query(SystemLog).order_by(SystemLog.id.desc()).first().id
    finally:
        db.close()

    monkeypatch.setattr(
        api_module,
        "collect_system_metrics",
        lambda: {
            "cpu_percent": 22.5,
            "memory_used": 1024,
            "memory_total": 2048,
            "storage_used": 4096,
            "storage_total": 8192,
        },
    )
    monkeypatch.setattr(api_module.mqtt_manager, "connected", False)

    with TestClient(main.app) as client:
        main.app.state.server_started_at = datetime.utcnow() - timedelta(minutes=15)
        main.app.state.database_ready = True
        token = get_token(client)
        mark_response = client.post(
            f"/api/v1/system/logs/{alert_id}/read",
            headers={"Authorization": f"Bearer {token}"},
        )
        status_response = client.get(
            "/api/v1/system/live-status",
            headers={"Authorization": f"Bearer {token}"},
        )
        logs_response = client.get(
            "/api/v1/system/logs",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert mark_response.status_code == 200, mark_response.text
    assert mark_response.json()["updated_count"] == 1

    status_payload = status_response.json()
    assert status_payload["overall_status"] == "healthy"
    assert status_payload["active_alert_count"] == 0
    assert status_payload["latest_alert_message"] is None

    logs_payload = logs_response.json()
    assert logs_payload["entries"][0]["is_read"] is True
    assert logs_payload["entries"][0]["read_by_user_id"] is not None


def test_mark_all_reads_only_unread_alerts(monkeypatch):
    create_admin_user()

    db = TestingSessionLocal()
    try:
        create_system_log(
            db,
            occurred_at=datetime.utcnow() - timedelta(minutes=4),
            event_code="mqtt_disconnected",
            message="MQTT broker connection dropped.",
            severity=SystemLogSeverity.critical,
            category=SystemLogCategory.connectivity,
        )
        create_system_log(
            db,
            occurred_at=datetime.utcnow() - timedelta(minutes=2),
            event_code="runtime_target_warning",
            message="Runtime network target refresh reported a warning.",
            severity=SystemLogSeverity.warning,
            category=SystemLogCategory.health,
        )
        create_system_log(
            db,
            occurred_at=datetime.utcnow() - timedelta(minutes=1),
            event_code="server_started",
            message="Server startup completed.",
            severity=SystemLogSeverity.info,
            category=SystemLogCategory.lifecycle,
        )
        db.commit()
    finally:
        db.close()

    monkeypatch.setattr(
        api_module,
        "collect_system_metrics",
        lambda: {
            "cpu_percent": 10.0,
            "memory_used": 1024,
            "memory_total": 2048,
            "storage_used": 4096,
            "storage_total": 8192,
        },
    )
    monkeypatch.setattr(api_module.mqtt_manager, "connected", True)

    with TestClient(main.app) as client:
        main.app.state.server_started_at = datetime.utcnow() - timedelta(minutes=15)
        main.app.state.database_ready = True
        token = get_token(client)
        mark_response = client.post(
            "/api/v1/system/logs/mark-all-read",
            headers={"Authorization": f"Bearer {token}"},
        )
        status_response = client.get(
            "/api/v1/system/live-status",
            headers={"Authorization": f"Bearer {token}"},
        )
        logs_response = client.get(
            "/api/v1/system/logs",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert mark_response.status_code == 200, mark_response.text
    assert mark_response.json()["updated_count"] == 2

    status_payload = status_response.json()
    assert status_payload["overall_status"] == "healthy"
    assert status_payload["active_alert_count"] == 0

    logs_payload = logs_response.json()
    severities_by_event = {entry["event_code"]: entry for entry in logs_payload["entries"]}
    assert severities_by_event["mqtt_disconnected"]["is_read"] is True
    assert severities_by_event["runtime_target_warning"]["is_read"] is True
    assert severities_by_event["server_started"]["is_read"] is False


def test_unexpected_mqtt_disconnect_records_critical_alert(monkeypatch):
    manager = mqtt_module.MQTTClientManager()
    manager.connected = True
    captured: dict[str, object] = {}

    def fake_record_system_log(**kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(mqtt_module, "record_system_log", fake_record_system_log)

    class FailureReasonCode:
        is_failure = True

        def __str__(self) -> str:
            return "network_reset"

    manager.on_disconnect(manager.client, None, None, FailureReasonCode())

    assert manager.connected is False
    assert captured["event_code"] == "mqtt_disconnected"
    assert captured["message"] == "MQTT broker connection dropped."
    assert captured["severity"] == SystemLogSeverity.critical
    assert captured["category"] == SystemLogCategory.connectivity
