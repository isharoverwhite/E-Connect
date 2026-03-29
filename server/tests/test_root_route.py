from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
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


def test_root_route_is_not_exposed():
    with TestClient(app) as client:
        response = client.get("/")

    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


def test_health_route_remains_available():
    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["database"] == "overridden"
    assert response.json()["mqtt"] == "skipped"


def test_health_route_exposes_webapp_transport_from_runtime_network_targets():
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

    try:
        with TestClient(app) as client:
            response = client.get("/health")
    finally:
        app.state.firmware_network_state = None

    assert response.status_code == 200
    payload = response.json()
    assert payload["firmware_network"]["webapp_protocol"] == "https"
    assert payload["firmware_network"]["webapp_port"] == "3000"


def test_web_assistant_script_route_returns_jsonp_payload():
    with TestClient(app) as client:
        response = client.get("/web-assistant.js", params={"callback": "window.econnectDiscovery"})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/javascript")
    assert response.text.startswith("window.econnectDiscovery(")
    assert '"status": "ok"' in response.text
    assert '"database": "overridden"' in response.text


def test_web_assistant_script_route_rejects_invalid_callback():
    with TestClient(app) as client:
        response = client.get("/web-assistant.js", params={"callback": "alert(1)"})

    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid callback name"}
