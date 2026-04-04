import main
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.sql_models import User
from main import app


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
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def teardown_function():
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


def test_root_route_redirects_to_default_http_webapp_port(monkeypatch):
    monkeypatch.delenv("FIRMWARE_PUBLIC_BASE_URL", raising=False)
    monkeypatch.setenv("FIRMWARE_PUBLIC_SCHEME", "http")
    monkeypatch.setenv("FIRMWARE_PUBLIC_PORT", "3000")

    with TestClient(app) as client:
        response = client.get("/", follow_redirects=False, headers={"host": "econnect.local"})

    assert response.status_code == 307
    assert response.headers["location"] == "http://econnect.local:3000/"


def test_root_route_uses_runtime_webapp_transport_when_available(monkeypatch):
    monkeypatch.setenv("FIRMWARE_PUBLIC_BASE_URL", "https://econnect.local:3443")

    with TestClient(app) as client:
        response = client.get("/", follow_redirects=False, headers={"host": "econnect.local"})

    assert response.status_code == 307
    assert response.headers["location"] == "https://econnect.local:3443/"


def test_health_route_remains_available(monkeypatch):
    monkeypatch.delenv("MDNS_HOSTNAME", raising=False)
    monkeypatch.delenv("MDNS_ADVERTISED_IPS", raising=False)

    with TestClient(app) as client:
        app.state.firmware_network_state = None
        app.state.firmware_network_audit = None
        response = client.get("/health", headers={"host": "testserver"})

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["database"] == "overridden"
    assert response.json()["mqtt"] == "skipped"
    assert response.json()["initialized"] is False
    assert "server_ip" not in response.json()


def test_health_route_reports_initialized_after_first_user_exists():
    db = TestingSessionLocal()
    db.add(
        User(
            fullname="Admin",
            username="admin",
            authentication="hashed-password",
        )
    )
    db.commit()
    db.close()

    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["initialized"] is True


def test_health_route_exposes_webapp_transport_from_runtime_network_targets(monkeypatch):
    monkeypatch.delenv("MDNS_HOSTNAME", raising=False)
    monkeypatch.delenv("MDNS_ADVERTISED_IPS", raising=False)

    with TestClient(app) as client:
        app.state.firmware_network_state = {
            "source": "startup_auto",
            "targets": {
                "advertised_host": "192.168.8.44",
                "api_base_url": "https://192.168.8.44:3000/api/v1",
                "mqtt_broker": "192.168.8.44",
                "mqtt_port": 1883,
                "target_key": "192.168.8.44|https://192.168.8.44:3000/api/v1|192.168.8.44|1883",
            },
            "error": None,
        }
        app.state.firmware_network_audit = {
            "warning": "Sensitive runtime warning should stay private.",
            "stale_project_count": 2,
            "stale_device_count": 3,
        }

        try:
            response = client.get("/health")
        finally:
            app.state.firmware_network_state = None
            app.state.firmware_network_audit = None

    assert response.status_code == 200
    payload = response.json()
    assert payload["server_ip"] == "192.168.8.44"
    assert payload["webapp"]["protocol"] == "https"
    assert payload["webapp"]["port"] == "3000"
    assert "firmware_network" not in payload
    assert "error" not in payload
    assert "warning" not in payload
    assert "stale_project_count" not in payload
    assert "stale_device_count" not in payload


def test_refresh_runtime_network_state_updates_startup_auto_target(monkeypatch):
    refreshed_state = {
        "source": "startup_auto",
        "targets": {
            "advertised_host": "192.168.8.55",
            "api_base_url": "http://192.168.8.55:3000/api/v1",
            "mqtt_broker": "192.168.8.55",
            "mqtt_port": 1883,
            "target_key": "192.168.8.55|http://192.168.8.55:3000/api/v1|192.168.8.55|1883",
        },
        "error": None,
    }
    captured_states: list[dict[str, object]] = []
    monkeypatch.setattr(main, "resolve_runtime_firmware_network_state", lambda: refreshed_state)
    monkeypatch.setattr(main.mqtt_manager, "set_runtime_network_state", lambda state: captured_states.append(state))

    app.state.firmware_network_state = {
        "source": "startup_auto",
        "targets": {
            "advertised_host": "192.168.2.16",
            "api_base_url": "http://192.168.2.16:3000/api/v1",
            "mqtt_broker": "192.168.2.16",
            "mqtt_port": 1883,
            "target_key": "192.168.2.16|http://192.168.2.16:3000/api/v1|192.168.2.16|1883",
        },
        "error": None,
    }

    refreshed = main._refresh_runtime_network_state(app)

    assert refreshed == refreshed_state
    assert app.state.firmware_network_state == refreshed_state
    assert captured_states == [refreshed_state]
    app.state.firmware_network_state = None


def test_health_route_prefers_mdns_advertised_server_ip_when_runtime_target_uses_alias(monkeypatch):
    monkeypatch.setenv("MDNS_HOSTNAME", "econnect.local")
    monkeypatch.setenv("MDNS_ADVERTISED_IPS", "192.168.8.55")

    with TestClient(app) as client:
        app.state.firmware_network_state = {
            "source": "configured_env",
            "targets": {
                "advertised_host": "econnect.local",
                "api_base_url": "https://econnect.local:3000/api/v1",
                "mqtt_broker": "econnect.local",
                "mqtt_port": 1883,
                "target_key": "econnect.local|https://econnect.local:3000/api/v1|econnect.local|1883",
            },
            "error": None,
        }

        try:
            response = client.get("/health")
        finally:
            app.state.firmware_network_state = None

    assert response.status_code == 200
    assert response.json()["server_ip"] == "192.168.8.55"


def test_web_assistant_script_route_returns_jsonp_payload():
    with TestClient(app) as client:
        response = client.get("/web-assistant.js", params={"callback": "window.econnectDiscovery"})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/javascript")
    assert response.text.startswith("window.econnectDiscovery(")
    assert '"status": "ok"' in response.text
    assert '"database": "overridden"' in response.text
    assert '"initialized": false' in response.text


def test_web_assistant_script_route_rejects_invalid_callback():
    with TestClient(app) as client:
        response = client.get("/web-assistant.js", params={"callback": "alert(1)"})

    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid callback name"}
