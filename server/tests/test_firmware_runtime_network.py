from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.services import builder
from app.sql_models import AuthStatus, Device, DeviceMode, DiyProject


SQLALCHEMY_DATABASE_URL = "sqlite://"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def setup_function():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def test_resolve_runtime_firmware_network_state_autodetects_startup_ip(monkeypatch):
    monkeypatch.delenv("FIRMWARE_PUBLIC_BASE_URL", raising=False)
    monkeypatch.delenv("FIRMWARE_PUBLIC_PORT", raising=False)
    monkeypatch.delenv("FIRMWARE_PUBLIC_SCHEME", raising=False)
    monkeypatch.delenv("FIRMWARE_MQTT_BROKER", raising=False)
    monkeypatch.delenv("FIRMWARE_MQTT_PORT", raising=False)
    monkeypatch.setattr(builder, "_detect_runtime_advertised_host", lambda: "192.168.8.4")
    monkeypatch.setattr(builder, "_is_running_in_docker", lambda: False)

    state = builder.resolve_runtime_firmware_network_state()

    assert state["source"] == "startup_auto"
    assert state["error"] is None
    assert state["targets"] == {
        "advertised_host": "192.168.8.4",
        "api_base_url": "http://192.168.8.4:3000/api/v1",
        "mqtt_broker": "192.168.8.4",
        "mqtt_port": 1883,
        "target_key": "192.168.8.4|http://192.168.8.4:3000/api/v1|192.168.8.4|1883",
    }


def test_resolve_runtime_firmware_network_state_uses_public_mqtt_override(monkeypatch):
    monkeypatch.delenv("FIRMWARE_PUBLIC_BASE_URL", raising=False)
    monkeypatch.delenv("FIRMWARE_PUBLIC_PORT", raising=False)
    monkeypatch.delenv("FIRMWARE_PUBLIC_SCHEME", raising=False)
    monkeypatch.setenv("FIRMWARE_MQTT_BROKER", "mqtt-lan.local")
    monkeypatch.setenv("FIRMWARE_MQTT_PORT", "2883")
    monkeypatch.setattr(builder, "_detect_runtime_advertised_host", lambda: "192.168.8.4")
    monkeypatch.setattr(builder, "_is_running_in_docker", lambda: False)

    state = builder.resolve_runtime_firmware_network_state()

    assert state["targets"] == {
        "advertised_host": "192.168.8.4",
        "api_base_url": "http://192.168.8.4:3000/api/v1",
        "mqtt_broker": "mqtt-lan.local",
        "mqtt_port": 2883,
        "target_key": "192.168.8.4|http://192.168.8.4:3000/api/v1|mqtt-lan.local|2883",
    }


def test_resolve_runtime_firmware_network_state_ignores_internal_mqtt_broker_env(monkeypatch):
    monkeypatch.delenv("FIRMWARE_PUBLIC_BASE_URL", raising=False)
    monkeypatch.delenv("FIRMWARE_PUBLIC_PORT", raising=False)
    monkeypatch.delenv("FIRMWARE_PUBLIC_SCHEME", raising=False)
    monkeypatch.delenv("FIRMWARE_MQTT_BROKER", raising=False)
    monkeypatch.setenv("MQTT_BROKER", "192.168.2.90")
    monkeypatch.setattr(builder, "_detect_runtime_advertised_host", lambda: "192.168.8.4")
    monkeypatch.setattr(builder, "_is_running_in_docker", lambda: False)

    state = builder.resolve_runtime_firmware_network_state()

    assert state["targets"] == {
        "advertised_host": "192.168.8.4",
        "api_base_url": "http://192.168.8.4:3000/api/v1",
        "mqtt_broker": "192.168.8.4",
        "mqtt_port": 1883,
        "target_key": "192.168.8.4|http://192.168.8.4:3000/api/v1|192.168.8.4|1883",
    }


def test_resolve_runtime_firmware_network_state_warns_for_docker_bridge(monkeypatch):
    monkeypatch.delenv("FIRMWARE_PUBLIC_BASE_URL", raising=False)
    monkeypatch.delenv("FIRMWARE_PUBLIC_PORT", raising=False)
    monkeypatch.delenv("FIRMWARE_PUBLIC_SCHEME", raising=False)
    monkeypatch.setattr(builder, "_detect_runtime_advertised_host", lambda: "172.19.0.4")
    monkeypatch.setattr(builder, "_is_running_in_docker", lambda: True)

    state = builder.resolve_runtime_firmware_network_state()

    assert state["source"] == "startup_auto"
    assert state["targets"] is None
    assert state["error"] is not None
    assert "network_mode: host" in state["error"]
    assert "172.19.0.4" in state["error"]


def test_infer_firmware_network_targets_can_fallback_to_request_when_runtime_state_has_warning(monkeypatch):
    monkeypatch.delenv("FIRMWARE_MQTT_BROKER", raising=False)
    monkeypatch.delenv("FIRMWARE_MQTT_PORT", raising=False)
    runtime_state = {
        "source": "startup_auto",
        "targets": None,
        "error": "Startup auto-detect unavailable in Docker bridge mode.",
    }

    targets = builder.infer_firmware_network_targets(
        {"host": "192.168.1.50:3000"},
        "https",
        runtime_state,
    )

    assert targets == {
        "advertised_host": "192.168.1.50",
        "api_base_url": "http://192.168.1.50:3000/api/v1",
        "mqtt_broker": "192.168.1.50",
        "mqtt_port": 1883,
        "target_key": "192.168.1.50|http://192.168.1.50:3000/api/v1|192.168.1.50|1883",
    }


def test_infer_firmware_network_targets_normalizes_https_companion_origin_to_http_lan_transport(monkeypatch):
    monkeypatch.delenv("FIRMWARE_PUBLIC_BASE_URL", raising=False)
    monkeypatch.delenv("FIRMWARE_MQTT_BROKER", raising=False)
    monkeypatch.delenv("FIRMWARE_MQTT_PORT", raising=False)

    targets = builder.infer_firmware_network_targets(
        {"x-econnect-origin": "https://192.168.1.50:3443"},
        "https",
        {"source": "startup_auto", "targets": None, "error": "Docker bridge fallback."},
    )

    assert targets == {
        "advertised_host": "192.168.1.50",
        "api_base_url": "http://192.168.1.50:3000/api/v1",
        "mqtt_broker": "192.168.1.50",
        "mqtt_port": 1883,
        "target_key": "192.168.1.50|http://192.168.1.50:3000/api/v1|192.168.1.50|1883",
    }


def test_resolve_webapp_transport_reads_protocol_and_port_from_api_base_url():
    assert builder.resolve_webapp_transport("https://192.168.1.45:3000/api/v1") == {
        "webapp_protocol": "https",
        "webapp_port": 3000,
    }


def test_resolve_webapp_transport_defaults_to_http_3000_when_backend_has_no_value():
    assert builder.resolve_webapp_transport(None) == {
        "webapp_protocol": "http",
        "webapp_port": 3000,
    }


def test_describe_runtime_firmware_mismatch_requires_manual_reflash():
    mismatch = builder.describe_runtime_firmware_mismatch(
        {
            "firmware_network": {
                "api_base_url": "https://192.168.2.16:3000/api/v1",
                "mqtt_broker": "192.168.2.16",
                "mqtt_port": 1883,
            }
        },
        {
            "advertised_host": "192.168.8.4",
            "api_base_url": "https://192.168.8.4:3000/api/v1",
            "mqtt_broker": "mqtt-lan.local",
            "mqtt_port": 2883,
        },
    )

    assert mismatch is not None
    assert "Manual reflash is required" in mismatch
    assert "192.168.2.16" in mismatch
    assert "mqtt-lan.local:2883" in mismatch


def test_audit_runtime_firmware_target_mismatches_flags_stale_projects():
    db = TestingSessionLocal()
    try:
        db.add(
            DiyProject(
                id="project-stale-001",
                user_id=1,
                room_id=None,
                name="Kitchen Node",
                board_profile="esp32",
                config={
                    "advertised_host": "192.168.2.16",
                    "api_base_url": "https://192.168.2.16:3000/api/v1",
                    "mqtt_broker": "192.168.2.16",
                    "mqtt_port": 1883,
                },
            )
        )
        db.add(
            Device(
                device_id="device-stale-001",
                mac_address="AA:BB:CC:11:22:33",
                name="Kitchen Board",
                owner_id=1,
                room_id=None,
                mode=DeviceMode.no_code,
                auth_status=AuthStatus.approved,
                provisioning_project_id="project-stale-001",
            )
        )
        db.commit()

        audit = builder.audit_runtime_firmware_target_mismatches(
            db,
            {
                "source": "startup_auto",
                "targets": {
                    "advertised_host": "192.168.8.4",
                    "api_base_url": "https://192.168.8.4:3000/api/v1",
                    "mqtt_broker": "mqtt-lan.local",
                    "mqtt_port": 2883,
                },
                "error": None,
            },
        )
    finally:
        db.close()

    assert audit["stale_project_count"] == 1
    assert audit["stale_device_count"] == 1
    assert audit["warning"] is not None
    stale_project = audit["stale_projects"][0]
    assert stale_project["project_id"] == "project-stale-001"
    assert stale_project["approved_device_ids"] == ["device-stale-001"]


def test_audit_runtime_firmware_target_mismatches_flags_legacy_host_only_projects():
    db = TestingSessionLocal()
    try:
        db.add(
            DiyProject(
                id="project-legacy-001",
                user_id=1,
                room_id=None,
                name="Legacy Kitchen Node",
                board_profile="esp32",
                config={
                    "advertised_host": "192.168.2.16",
                },
            )
        )
        db.add(
            Device(
                device_id="device-legacy-001",
                mac_address="AA:BB:CC:44:55:66",
                name="Legacy Kitchen Board",
                owner_id=1,
                room_id=None,
                mode=DeviceMode.no_code,
                auth_status=AuthStatus.approved,
                provisioning_project_id="project-legacy-001",
            )
        )
        db.commit()

        audit = builder.audit_runtime_firmware_target_mismatches(
            db,
            {
                "source": "startup_auto",
                "targets": {
                    "advertised_host": "192.168.8.4",
                    "api_base_url": "https://192.168.8.4:3000/api/v1",
                    "mqtt_broker": "mqtt-lan.local",
                    "mqtt_port": 2883,
                },
                "error": None,
            },
        )
    finally:
        db.close()

    assert audit["stale_project_count"] == 1
    stale_project = audit["stale_projects"][0]
    assert stale_project["project_id"] == "project-legacy-001"
    assert stale_project["previous_targets"]["advertised_host"] == "192.168.2.16"
    assert stale_project["previous_targets"]["mqtt_broker"] == "192.168.2.16"
    assert stale_project["approved_device_ids"] == ["device-legacy-001"]
