from datetime import datetime, timedelta

import app.api as api_module
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


def create_admin_user(username: str = "logs-admin") -> User:
    db = TestingSessionLocal()
    try:
        user = User(
            username=username,
            fullname="Logs Admin",
            authentication=get_password_hash("password"),
            approval_status=UserApprovalStatus.approved,
            account_type=AccountType.admin,
        )
        household = Household(name="Logs Household")
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
    create_admin_user()

    db = TestingSessionLocal()
    try:
        create_system_log(
            db,
            occurred_at=datetime.utcnow() - timedelta(minutes=5),
            event_code="mqtt_disconnected",
            message="MQTT broker connection dropped.",
            severity=SystemLogSeverity.warning,
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
    assert status_payload["overall_status"] == "warning"
    assert status_payload["database_status"] == "ok"
    assert status_payload["mqtt_status"] == "disconnected"
    assert status_payload["advertised_host"] == "192.168.1.44"
    assert status_payload["active_alert_count"] == 1
    assert status_payload["latest_alert_message"] == "MQTT broker connection dropped."

    assert logs_response.status_code == 200, logs_response.text
    logs_payload = logs_response.json()
    assert logs_payload["total"] == 1
    assert [entry["event_code"] for entry in logs_payload["entries"]] == ["mqtt_disconnected"]
