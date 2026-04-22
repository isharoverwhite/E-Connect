# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

import hashlib
import io
import json
import socket
import sys
import zipfile
from pathlib import Path
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import close_all_sessions, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import refresh_external_device_states_once, router
from app.auth import get_password_hash
from app.database import Base, get_db
from app.mqtt import mqtt_manager
from app.services.command_ordering import command_ordering_manager
from app.services.extension_runtime_loader import clear_extension_runtime_cache, load_installed_extension_runtime
from app.services.external_runtime import (
    collect_yeelight_diagnostics,
    execute_external_device_command,
    probe_external_device_state,
)
from app.services.extensions import (
    EXTENSIONS_DATA_DIR,
    EXTENSION_EXTRACTED_DIR,
    EXTENSION_PACKAGES_DIR,
    ExtensionManifestValidationError,
    parse_extension_archive,
    resolve_extracted_extension_dir,
)
from app.sql_models import (
    AccountType,
    ConnStatus,
    ExternalDevice,
    Household,
    HouseholdMembership,
    HouseholdRole,
    InstalledExtension,
    User,
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


app = FastAPI()
app.include_router(router, prefix="/api/v1")
app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)
TEST_EXTENSION_VERSION = "1.0.0-test"
TEST_EXTENSION_FIXTURE_ROOT = Path(__file__).resolve().parent / "fixtures" / "Yeelight_control"
MULTI_CARD_EXTENSION_FIXTURE_ROOT = Path(__file__).resolve().parent / "fixtures" / "MultiCard_control"


def cleanup_test_extension_archives() -> None:
    packages_dir = EXTENSIONS_DATA_DIR / "packages"
    if packages_dir.exists():
        for archive_path in packages_dir.glob(f"*-{TEST_EXTENSION_VERSION}-*.zip"):
            if isinstance(archive_path, Path):
                archive_path.unlink(missing_ok=True)

    if EXTENSION_EXTRACTED_DIR.exists():
        import shutil

        for extracted_path in EXTENSION_EXTRACTED_DIR.glob(f"*-{TEST_EXTENSION_VERSION}-*"):
            if isinstance(extracted_path, Path) and extracted_path.is_dir():
                shutil.rmtree(extracted_path)


@pytest.fixture(autouse=True)
def setup_db():
    close_all_sessions()
    clear_extension_runtime_cache()
    cleanup_test_extension_archives()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    mqtt_manager.pending_commands.clear()
    command_ordering_manager.reset()
    yield
    close_all_sessions()
    clear_extension_runtime_cache()
    cleanup_test_extension_archives()
    mqtt_manager.pending_commands.clear()
    command_ordering_manager.reset()


def create_admin_user(username: str = "extension-admin") -> User:
    db = TestingSessionLocal()
    try:
        user = User(
            username=username,
            fullname="Extension Admin",
            authentication=get_password_hash("password"),
            account_type=AccountType.admin,
        )
        household = Household(name="Extension Household")
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
        return user
    finally:
        db.close()


def get_token(username: str = "extension-admin") -> str:
    response = client.post(
        "/api/v1/auth/token",
        data={"username": username, "password": "password"},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def create_room(token: str, *, name: str = "Living Area") -> dict[str, object]:
    response = client.post(
        "/api/v1/rooms",
        json={"name": name},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200, response.text
    return response.json()


def build_manifest() -> dict[str, object]:
    return {
        "manifest_version": "1.0",
        "extension_id": "yeelight_control",
        "name": "Yeelight Control",
        "version": TEST_EXTENSION_VERSION,
        "author": "econnect",
        "description": "Registers Yeelight LAN lights as external devices with capability-aware controls.",
        "provider": {
            "key": "yeelight",
            "display_name": "Yeelight",
        },
        "package": {
            "runtime": "python",
            "entrypoint": "main.py",
            "hooks": {
                "validate_command": "validate_command",
                "execute_command": "execute_command",
                "probe_state": "probe_state",
            },
        },
        "device_schemas": [
            {
                "schema_id": "yeelight_white_light",
                "device_type": "light",
                "name": "Yeelight White Light",
                "default_name": "Yeelight White Light",
                "description": "On/off and brightness control for white Yeelight lamps.",
                "display": {
                    "card_type": "light",
                    "capabilities": ["power", "brightness"],
                },
                "config_schema": {
                    "fields": [
                        {
                            "key": "ip_address",
                            "label": "IP Address",
                            "type": "string",
                            "required": True,
                        }
                    ]
                },
            },
            {
                "schema_id": "yeelight_ambient_light",
                "device_type": "light",
                "name": "Yeelight Ambient Light",
                "default_name": "Yeelight Ambient Light",
                "description": "Brightness plus tunable white control.",
                "display": {
                    "card_type": "light",
                    "capabilities": ["power", "brightness", "color_temperature"],
                    "temperature_range": {"min": 1700, "max": 6500},
                },
                "config_schema": {
                    "fields": [
                        {
                            "key": "ip_address",
                            "label": "IP Address",
                            "type": "string",
                            "required": True,
                        }
                    ]
                },
            },
            {
                "schema_id": "yeelight_color_light",
                "device_type": "light",
                "name": "Yeelight Color Light",
                "default_name": "Yeelight Color Light",
                "description": "Brightness plus RGB control.",
                "display": {
                    "card_type": "light",
                    "capabilities": ["power", "brightness", "rgb"],
                },
                "config_schema": {
                    "fields": [
                        {
                            "key": "ip_address",
                            "label": "IP Address",
                            "type": "string",
                            "required": True,
                        }
                    ]
                },
            },
        ],
    }


def build_multi_card_manifest() -> dict[str, object]:
    return {
        "manifest_version": "1.0",
        "extension_id": "demo_multicard_control",
        "name": "Demo Multi-Card Control",
        "version": TEST_EXTENSION_VERSION,
        "author": "econnect",
        "description": "Runtime-backed demo provider for switch, fan, and sensor extension hooks.",
        "provider": {
            "key": "demo_multicard",
            "display_name": "Demo Multi-Card",
        },
        "package": {
            "runtime": "python",
            "entrypoint": "main.py",
            "hooks": {
                "validate_command": "validate_command",
                "execute_command": "execute_command",
                "probe_state": "probe_state",
            },
        },
        "device_schemas": [
            {
                "schema_id": "smart_switch",
                "device_type": "switch",
                "name": "Smart Switch",
                "default_name": "Smart Switch",
                "description": "Binary switch control for provider-backed outlets or relays.",
                "display": {
                    "card_type": "switch",
                    "capabilities": ["power"],
                },
                "config_schema": {
                    "fields": [
                        {
                            "key": "ip_address",
                            "label": "IP Address",
                            "type": "string",
                            "required": True,
                        },
                        {
                            "key": "default_on",
                            "label": "Default On",
                            "type": "boolean",
                            "required": False,
                        },
                    ]
                },
            },
            {
                "schema_id": "ceiling_fan",
                "device_type": "fan",
                "name": "Ceiling Fan",
                "default_name": "Ceiling Fan",
                "description": "Fan power and speed control.",
                "display": {
                    "card_type": "fan",
                    "capabilities": ["power", "speed"],
                },
                "config_schema": {
                    "fields": [
                        {
                            "key": "ip_address",
                            "label": "IP Address",
                            "type": "string",
                            "required": True,
                        },
                        {
                            "key": "default_speed",
                            "label": "Default Speed",
                            "type": "number",
                            "required": False,
                        },
                    ]
                },
            },
            {
                "schema_id": "climate_sensor",
                "device_type": "sensor",
                "name": "Climate Sensor",
                "default_name": "Climate Sensor",
                "description": "Temperature and humidity telemetry.",
                "display": {
                    "card_type": "sensor",
                    "capabilities": ["temperature", "humidity", "value"],
                },
                "config_schema": {
                    "fields": [
                        {
                            "key": "ip_address",
                            "label": "IP Address",
                            "type": "string",
                            "required": True,
                        },
                        {
                            "key": "temperature",
                            "label": "Temperature",
                            "type": "number",
                            "required": False,
                        },
                        {
                            "key": "humidity",
                            "label": "Humidity",
                            "type": "number",
                            "required": False,
                        },
                        {
                            "key": "value",
                            "label": "Value",
                            "type": "number",
                            "required": False,
                        },
                        {
                            "key": "unit",
                            "label": "Unit",
                            "type": "string",
                            "required": False,
                        },
                        {
                            "key": "trend",
                            "label": "Trend",
                            "type": "string",
                            "required": False,
                        },
                    ]
                },
            },
        ],
    }


def build_extension_zip(
    manifest: dict[str, object] | None = None,
    *,
    root_folder: str | None = None,
    entrypoint_name: str = "main.py",
    fixture_root: Path | None = None,
) -> bytes:
    extension_source_root = fixture_root or TEST_EXTENSION_FIXTURE_ROOT
    if manifest is not None:
        manifest_payload = manifest
    elif extension_source_root == TEST_EXTENSION_FIXTURE_ROOT:
        manifest_payload = build_manifest()
    else:
        manifest_payload = json.loads((extension_source_root / "manifest.json").read_text(encoding="utf-8"))
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        prefix = f"{root_folder}/" if root_folder else ""
        archive.writestr(f"{prefix}manifest.json", json.dumps(manifest_payload))
        for source_path in sorted(extension_source_root.rglob("*")):
            if not source_path.is_file():
                continue
            if "__pycache__" in source_path.parts or source_path.name == "manifest.json":
                continue
            relative_path = source_path.relative_to(extension_source_root)
            target_name = entrypoint_name if relative_path.as_posix() == "main.py" else relative_path.as_posix()
            archive.writestr(f"{prefix}{target_name}", source_path.read_bytes())
    return buffer.getvalue()


def build_runtime_backed_extension(
    *,
    manifest: dict[str, object] | None = None,
    package_root: str | None = "Yeelight_control",
    fixture_root: Path | None = None,
) -> InstalledExtension:
    manifest_payload = manifest or build_manifest()
    archive_bytes = build_extension_zip(
        manifest_payload,
        root_folder=package_root,
        fixture_root=fixture_root,
    )
    archive_sha256 = hashlib.sha256(archive_bytes).hexdigest()
    archive_path = EXTENSION_PACKAGES_DIR / (
        f"{manifest_payload['extension_id']}-{manifest_payload['version']}-{archive_sha256[:12]}.zip"
    )
    archive_path.write_bytes(archive_bytes)

    provider = manifest_payload["provider"]
    package = manifest_payload["package"]
    return InstalledExtension(
        extension_id=str(manifest_payload["extension_id"]),
        manifest_version=str(manifest_payload["manifest_version"]),
        name=str(manifest_payload["name"]),
        version=str(manifest_payload["version"]),
        author=str(manifest_payload.get("author") or "") or None,
        description=str(manifest_payload["description"]),
        provider_key=str(provider["key"]),
        provider_name=str(provider["display_name"]),
        package_runtime=str(package["runtime"]),
        package_entrypoint=str(package["entrypoint"]),
        package_root=package_root,
        archive_path=str(archive_path),
        archive_sha256=archive_sha256,
        manifest=manifest_payload,
    )


def load_test_runtime_module(extension: InstalledExtension):
    runtime = load_installed_extension_runtime(extension)
    return sys.modules.get("yeelight_control", runtime.module)


def test_parse_extension_archive_rejects_legacy_manifest_shape():
    legacy_manifest = {
        "module_name": "Legacy Yeelight",
        "file_path": "main.py",
        "version": "1.0.0",
    }

    with pytest.raises(ExtensionManifestValidationError):
        parse_extension_archive(build_extension_zip(legacy_manifest))


def test_parse_extension_archive_defaults_device_type_from_card_type():
    manifest = build_manifest()
    for schema in manifest["device_schemas"]:
        if isinstance(schema, dict):
            schema.pop("device_type", None)

    normalized_manifest, _ = parse_extension_archive(build_extension_zip(manifest))

    assert normalized_manifest["device_schemas"][0]["device_type"] == "light"


def test_parse_extension_archive_accepts_switch_fan_and_sensor_card_types():
    normalized_manifest, _ = parse_extension_archive(build_extension_zip(build_multi_card_manifest()))

    schemas = {schema["schema_id"]: schema for schema in normalized_manifest["device_schemas"]}
    assert schemas["smart_switch"]["display"]["card_type"] == "switch"
    assert schemas["smart_switch"]["display"]["capabilities"] == ["power"]
    assert schemas["ceiling_fan"]["display"]["card_type"] == "fan"
    assert schemas["ceiling_fan"]["display"]["capabilities"] == ["power", "speed"]
    assert schemas["climate_sensor"]["display"]["card_type"] == "sensor"
    assert schemas["climate_sensor"]["display"]["capabilities"] == ["temperature", "humidity", "value"]


def test_parse_extension_archive_rejects_capability_not_supported_by_card_type():
    manifest = build_multi_card_manifest()
    schema = manifest["device_schemas"][0]
    assert isinstance(schema, dict)
    schema["display"] = {"card_type": "switch", "capabilities": ["power", "brightness"]}

    with pytest.raises(ExtensionManifestValidationError, match="unsupported capability 'brightness'"):
        parse_extension_archive(build_extension_zip(manifest))


def test_upload_extension_zip_persists_manifest_and_lists_it():
    create_admin_user()
    token = get_token()

    response = client.post(
        "/api/v1/extensions/upload",
        files={"file": ("yeelight.zip", build_extension_zip(root_folder="Yeelight_control"), "application/zip")},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["extension_id"] == "yeelight_control"
    assert payload["provider_name"] == "Yeelight"
    assert payload["package_root"] == "Yeelight_control"
    assert payload["device_schemas"][0]["schema_id"] == "yeelight_white_light"
    assert payload["device_schemas"][0]["device_type"] == "light"
    assert payload["device_schemas"][0]["capabilities"] == ["power", "brightness"]

    db = TestingSessionLocal()
    try:
        stored_extension = db.query(InstalledExtension).filter_by(extension_id="yeelight_control").one()
        assert stored_extension.package_entrypoint == "main.py"
        assert stored_extension.provider_name == "Yeelight"
        assert stored_extension.archive_sha256 == payload["archive_sha256"]
        extracted_dir = resolve_extracted_extension_dir(
            extension_id=stored_extension.extension_id,
            version=stored_extension.version,
            archive_sha256=stored_extension.archive_sha256,
        )
        assert extracted_dir.exists()
        assert (extracted_dir / "Yeelight_control" / "main.py").exists()
    finally:
        db.close()

    list_response = client.get(
        "/api/v1/extensions",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert list_response.status_code == 200, list_response.text
    assert len(list_response.json()) == 1


def test_load_installed_extension_runtime_uses_existing_extracted_package_when_archive_is_missing():
    create_admin_user()
    token = get_token()

    upload_response = client.post(
        "/api/v1/extensions/upload",
        files={"file": ("yeelight.zip", build_extension_zip(root_folder="Yeelight_control"), "application/zip")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert upload_response.status_code == 200, upload_response.text

    db = TestingSessionLocal()
    try:
        stored_extension = db.query(InstalledExtension).filter_by(extension_id="yeelight_control").one()
        archive_path = Path(stored_extension.archive_path)
        extracted_dir = resolve_extracted_extension_dir(
            extension_id=stored_extension.extension_id,
            version=stored_extension.version,
            archive_sha256=stored_extension.archive_sha256,
        )
        archive_path.unlink(missing_ok=True)
        clear_extension_runtime_cache()

        runtime = load_installed_extension_runtime(stored_extension)

        assert extracted_dir.exists()
        assert runtime.entrypoint_path == (extracted_dir / "Yeelight_control" / "main.py").resolve()
    finally:
        db.close()


def test_delete_installed_extension_removes_db_row_and_runtime_files():
    create_admin_user()
    token = get_token()

    upload_response = client.post(
        "/api/v1/extensions/upload",
        files={"file": ("yeelight.zip", build_extension_zip(root_folder="Yeelight_control"), "application/zip")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert upload_response.status_code == 200, upload_response.text
    payload = upload_response.json()

    db = TestingSessionLocal()
    try:
        stored_extension = db.query(InstalledExtension).filter_by(extension_id="yeelight_control").one()
        archive_path = Path(stored_extension.archive_path)
        extracted_dir = resolve_extracted_extension_dir(
            extension_id=stored_extension.extension_id,
            version=stored_extension.version,
            archive_sha256=stored_extension.archive_sha256,
        )
        assert archive_path.exists()
        assert extracted_dir.exists()
    finally:
        db.close()

    delete_response = client.delete(
        "/api/v1/extensions/yeelight_control",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert delete_response.status_code == 200, delete_response.text
    assert delete_response.json() == {"status": "deleted", "extension_id": "yeelight_control"}
    assert archive_path.exists() is False
    assert extracted_dir.exists() is False

    db = TestingSessionLocal()
    try:
        assert db.query(InstalledExtension).filter_by(extension_id="yeelight_control").first() is None
    finally:
        db.close()

    list_response = client.get(
        "/api/v1/extensions",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert list_response.status_code == 200, list_response.text
    assert list_response.json() == []


def test_delete_installed_extension_rejects_packages_still_used_by_external_devices():
    create_admin_user()
    token = get_token()

    upload_response = client.post(
        "/api/v1/extensions/upload",
        files={"file": ("yeelight.zip", build_extension_zip(), "application/zip")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert upload_response.status_code == 200, upload_response.text

    create_response = client.post(
        "/api/v1/external-devices",
        json={
            "installed_extension_id": "yeelight_control",
            "device_schema_id": "yeelight_white_light",
            "name": "Kitchen Yeelight",
            "config": {"ip_address": "192.168.1.55"},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_response.status_code == 200, create_response.text

    delete_response = client.delete(
        "/api/v1/extensions/yeelight_control",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert delete_response.status_code == 409, delete_response.text
    assert delete_response.json()["detail"]["error"] == "conflict"
    assert "Cannot delete extension" in delete_response.json()["detail"]["message"]

    db = TestingSessionLocal()
    try:
        assert db.query(InstalledExtension).filter_by(extension_id="yeelight_control").first() is not None
    finally:
        db.close()


def test_create_external_device_is_merged_into_device_read_models():
    create_admin_user()
    token = get_token()

    upload_response = client.post(
        "/api/v1/extensions/upload",
        files={"file": ("yeelight.zip", build_extension_zip(), "application/zip")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert upload_response.status_code == 200, upload_response.text

    create_response = client.post(
        "/api/v1/external-devices",
        json={
            "installed_extension_id": "yeelight_control",
            "device_schema_id": "yeelight_white_light",
            "name": "Kitchen Yeelight",
            "config": {"ip_address": "192.168.1.55"},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_response.status_code == 200, create_response.text
    device_payload = create_response.json()
    assert device_payload["is_external"] is True
    assert device_payload["provider"] == "Yeelight"
    assert device_payload["installed_extension_id"] == "yeelight_control"
    assert device_payload["external_config"] == {"ip_address": "192.168.1.55"}

    list_response = client.get(
        "/api/v1/external-devices",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert list_response.status_code == 200, list_response.text
    assert len(list_response.json()) == 1

    devices_response = client.get(
        "/api/v1/devices",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert devices_response.status_code == 200, devices_response.text
    assert devices_response.json()[0]["device_id"] == device_payload["device_id"]
    assert devices_response.json()[0]["is_external"] is True
    assert devices_response.json()[0]["device_type"] == "light"

    dashboard_response = client.get(
        "/api/v1/dashboard/devices",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert dashboard_response.status_code == 200, dashboard_response.text
    assert dashboard_response.json()[0]["device_id"] == device_payload["device_id"]
    assert dashboard_response.json()[0]["provider"] == "Yeelight"

    detail_response = client.get(
        f"/api/v1/device/{device_payload['device_id']}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert detail_response.status_code == 200, detail_response.text
    assert detail_response.json()["schema_snapshot"]["schema_id"] == "yeelight_white_light"
    assert detail_response.json()["device_type"] == "light"

    delete_response = client.delete(
        f"/api/v1/device/{device_payload['device_id']}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert delete_response.status_code == 200, delete_response.text
    assert delete_response.json()["status"] == "deleted"

    db = TestingSessionLocal()
    try:
        assert db.query(ExternalDevice).count() == 0
    finally:
        db.close()


def test_non_light_extension_schemas_are_serialized_with_runtime_pins():
    create_admin_user()
    token = get_token()
    manifest = build_multi_card_manifest()
    extension_id = str(manifest["extension_id"])

    upload_response = client.post(
        "/api/v1/extensions/upload",
        files={
            "file": (
                "multicard.zip",
                build_extension_zip(
                    manifest,
                    root_folder="MultiCard_control",
                    fixture_root=MULTI_CARD_EXTENSION_FIXTURE_ROOT,
                ),
                "application/zip",
            )
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert upload_response.status_code == 200, upload_response.text

    switch_create = client.post(
        "/api/v1/external-devices",
        json={
            "installed_extension_id": extension_id,
            "device_schema_id": "smart_switch",
            "name": "Utility Relay",
            "config": {"ip_address": "192.168.1.70"},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert switch_create.status_code == 200, switch_create.text

    fan_create = client.post(
        "/api/v1/external-devices",
        json={
            "installed_extension_id": extension_id,
            "device_schema_id": "ceiling_fan",
            "name": "Bedroom Fan",
            "config": {"ip_address": "192.168.1.71"},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert fan_create.status_code == 200, fan_create.text

    sensor_create = client.post(
        "/api/v1/external-devices",
        json={
            "installed_extension_id": extension_id,
            "device_schema_id": "climate_sensor",
            "name": "Hall Climate",
            "config": {"ip_address": "192.168.1.72"},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert sensor_create.status_code == 200, sensor_create.text

    devices_response = client.get(
        "/api/v1/devices",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert devices_response.status_code == 200, devices_response.text
    devices_by_name = {row["name"]: row for row in devices_response.json()}

    switch_device = devices_by_name["Utility Relay"]
    assert switch_device["device_type"] == "switch"
    assert {pin["gpio_pin"] for pin in switch_device["pin_configurations"]} == {0}

    fan_device = devices_by_name["Bedroom Fan"]
    assert fan_device["device_type"] == "fan"
    assert {pin["gpio_pin"] for pin in fan_device["pin_configurations"]} == {0, 2}
    assert fan_device["last_state"]["power"] == "off"
    assert fan_device["last_state"]["speed"] == 0

    sensor_device = devices_by_name["Hall Climate"]
    assert sensor_device["device_type"] == "sensor"
    assert {pin["gpio_pin"] for pin in sensor_device["pin_configurations"]} == {3, 4, 5}
    assert sensor_device["last_state"] == {}


def test_multicard_runtime_fan_speed_command_updates_state_via_real_extension_hooks():
    create_admin_user()
    token = get_token()
    room = create_room(token, name="Bedroom")
    manifest = build_multi_card_manifest()
    extension_id = str(manifest["extension_id"])

    upload_response = client.post(
        "/api/v1/extensions/upload",
        files={
            "file": (
                "multicard.zip",
                build_extension_zip(
                    manifest,
                    root_folder="MultiCard_control",
                    fixture_root=MULTI_CARD_EXTENSION_FIXTURE_ROOT,
                ),
                "application/zip",
            )
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert upload_response.status_code == 200, upload_response.text

    create_response = client.post(
        "/api/v1/external-devices",
        json={
            "installed_extension_id": extension_id,
            "device_schema_id": "ceiling_fan",
            "name": "Bedroom Fan",
            "room_id": room["room_id"],
            "config": {"ip_address": "192.168.1.71", "default_speed": 15},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_response.status_code == 200, create_response.text
    device_payload = create_response.json()

    command_response = client.post(
        f"/api/v1/device/{device_payload['device_id']}/command",
        json={"kind": "action", "pin": 0, "speed": 67},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert command_response.status_code == 200, command_response.text
    assert command_response.json()["status"] == "pending"

    db = TestingSessionLocal()
    try:
        stored_device = db.query(ExternalDevice).filter_by(device_id=device_payload["device_id"]).one()
        assert stored_device.conn_status == ConnStatus.online
        assert stored_device.last_state["power"] == "on"
        assert stored_device.last_state["value"] == 1
        assert stored_device.last_state["speed"] == 67
        assert stored_device.last_state["capabilities"] == ["power", "speed"]
        assert stored_device.last_seen is not None
    finally:
        db.close()


def test_refresh_external_device_states_once_uses_multicard_sensor_probe_hook():
    create_admin_user()
    token = get_token()
    manifest = build_multi_card_manifest()
    extension_id = str(manifest["extension_id"])

    upload_response = client.post(
        "/api/v1/extensions/upload",
        files={
            "file": (
                "multicard.zip",
                build_extension_zip(
                    manifest,
                    root_folder="MultiCard_control",
                    fixture_root=MULTI_CARD_EXTENSION_FIXTURE_ROOT,
                ),
                "application/zip",
            )
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert upload_response.status_code == 200, upload_response.text

    create_response = client.post(
        "/api/v1/external-devices",
        json={
            "installed_extension_id": extension_id,
            "device_schema_id": "climate_sensor",
            "name": "Hall Climate",
            "config": {
                "ip_address": "192.168.1.72",
                "temperature": 24.5,
                "humidity": 56,
                "value": 24.5,
                "unit": "C",
                "trend": "stable",
            },
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_response.status_code == 200, create_response.text
    device_payload = create_response.json()

    stats = refresh_external_device_states_once(session_factory=TestingSessionLocal)

    assert stats == {"probed": 1, "online": 1, "offline": 0, "changed": 1}

    db = TestingSessionLocal()
    try:
        stored_device = db.query(ExternalDevice).filter_by(device_id=device_payload["device_id"]).one()
        assert stored_device.conn_status == ConnStatus.online
        assert stored_device.last_state["temperature"] == 24.5
        assert stored_device.last_state["humidity"] == 56
        assert stored_device.last_state["value"] == 24.5
        assert stored_device.last_state["unit"] == "C"
        assert stored_device.last_state["trend"] == "stable"
        assert stored_device.last_state["capabilities"] == ["temperature", "humidity", "value"]
        assert stored_device.last_seen is not None
    finally:
        db.close()


def test_create_external_device_requires_schema_config_fields():
    create_admin_user()
    token = get_token()

    upload_response = client.post(
        "/api/v1/extensions/upload",
        files={"file": ("yeelight.zip", build_extension_zip(), "application/zip")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert upload_response.status_code == 200, upload_response.text

    create_response = client.post(
        "/api/v1/external-devices",
        json={
            "installed_extension_id": "yeelight_control",
            "device_schema_id": "yeelight_white_light",
            "name": "Broken Yeelight",
            "config": {},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_response.status_code == 400
    assert create_response.json()["detail"]["error"] == "validation"
    assert "ip_address" in create_response.json()["detail"]["message"]


def test_create_external_device_persists_selected_room():
    create_admin_user()
    token = get_token()
    room = create_room(token, name="Kitchen")

    upload_response = client.post(
        "/api/v1/extensions/upload",
        files={"file": ("yeelight.zip", build_extension_zip(), "application/zip")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert upload_response.status_code == 200, upload_response.text

    create_response = client.post(
        "/api/v1/external-devices",
        json={
            "installed_extension_id": "yeelight_control",
            "device_schema_id": "yeelight_white_light",
            "name": "Kitchen Yeelight",
            "room_id": room["room_id"],
            "config": {"ip_address": "192.168.1.55"},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_response.status_code == 200, create_response.text
    payload = create_response.json()
    assert payload["room_id"] == room["room_id"]
    assert payload["room_name"] == "Kitchen"

    db = TestingSessionLocal()
    try:
        stored_device = db.query(ExternalDevice).filter_by(device_id=payload["device_id"]).one()
        assert stored_device.room_id == room["room_id"]
    finally:
        db.close()


def test_external_device_command_executes_runtime_and_updates_state(monkeypatch):
    create_admin_user()
    token = get_token()
    room = create_room(token, name="Studio")

    upload_response = client.post(
        "/api/v1/extensions/upload",
        files={"file": ("yeelight.zip", build_extension_zip(), "application/zip")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert upload_response.status_code == 200, upload_response.text

    create_response = client.post(
        "/api/v1/external-devices",
        json={
            "installed_extension_id": "yeelight_control",
            "device_schema_id": "yeelight_white_light",
            "name": "Studio Bulb",
            "room_id": room["room_id"],
            "config": {"ip_address": "192.168.1.55"},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_response.status_code == 200, create_response.text
    device_payload = create_response.json()

    runtime_result = Mock()
    runtime_result.state = {
        "kind": "action",
        "pin": 0,
        "value": 1,
        "brightness": 191,
        "reported_at": "2026-04-04T08:40:00+00:00",
        "ip_address": "192.168.1.55",
    }
    monkeypatch.setattr("app.api.execute_external_device_command", Mock(return_value=runtime_result))
    ws_mock = Mock()
    monkeypatch.setattr("app.api.ws_manager.broadcast_device_event_sync", ws_mock)

    command_response = client.post(
        f"/api/v1/device/{device_payload['device_id']}/command",
        json={"kind": "action", "pin": 0, "brightness": 191},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert command_response.status_code == 200, command_response.text
    payload = command_response.json()
    assert payload["status"] == "pending"
    assert payload["command_id"]

    db = TestingSessionLocal()
    try:
        stored_device = db.query(ExternalDevice).filter_by(device_id=device_payload["device_id"]).one()
        assert stored_device.conn_status == ConnStatus.online
        assert stored_device.last_state["brightness"] == 191
        assert stored_device.last_state["value"] == 1
        assert stored_device.last_seen is not None
    finally:
        db.close()

    ws_mock.assert_any_call(
        "device_state",
        device_payload["device_id"],
        room["room_id"],
        runtime_result.state,
    )
    ws_mock.assert_any_call(
        "command_delivery",
        device_payload["device_id"],
        room["room_id"],
        {
            "command_id": payload["command_id"],
            "status": "acknowledged",
        },
    )


def test_external_device_command_task_drops_stale_result_when_newer_sequence_takes_over(monkeypatch):
    import app.api as api_module

    create_admin_user()
    token = get_token()
    room = create_room(token, name="Desk")

    upload_response = client.post(
        "/api/v1/extensions/upload",
        files={"file": ("yeelight.zip", build_extension_zip(), "application/zip")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert upload_response.status_code == 200, upload_response.text

    create_response = client.post(
        "/api/v1/external-devices",
        json={
            "installed_extension_id": "yeelight_control",
            "device_schema_id": "yeelight_white_light",
            "name": "Desk Bulb",
            "room_id": room["room_id"],
            "config": {"ip_address": "192.168.1.61"},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_response.status_code == 200, create_response.text
    device_payload = create_response.json()
    original_state = device_payload.get("last_state")

    runtime_result = Mock()
    runtime_result.state = {
        "kind": "action",
        "pin": 0,
        "value": 1,
        "brightness": 64,
        "reported_at": "2026-04-14T04:40:00+00:00",
        "ip_address": "192.168.1.61",
    }

    def fake_execute(external_device, command):
        command_ordering_manager.activate(
            command_id="cmd-2",
            device_id=external_device.device_id,
            scope_key=api_module._build_external_command_scope_key(external_device.device_id),
        )
        return runtime_result

    monkeypatch.setattr("app.api.execute_external_device_command", Mock(side_effect=fake_execute))
    ws_mock = Mock()
    monkeypatch.setattr("app.api.ws_manager.broadcast_device_event_sync", ws_mock)

    command_ordering_manager.activate(
        command_id="cmd-1",
        device_id=device_payload["device_id"],
        scope_key=api_module._build_external_command_scope_key(device_payload["device_id"]),
    )

    api_module._execute_external_device_command_task(
        TestingSessionLocal,
        device_id=device_payload["device_id"],
        command={"command_id": "cmd-1", "kind": "action", "pin": 0, "brightness": 64},
    )

    db = TestingSessionLocal()
    try:
        stored_device = db.query(ExternalDevice).filter_by(device_id=device_payload["device_id"]).one()
        assert stored_device.last_state == original_state
    finally:
        db.close()

    assert ws_mock.call_count == 0
    assert command_ordering_manager.get("cmd-1") is None
    assert command_ordering_manager.is_latest("cmd-2") is True


def test_external_device_command_accepts_color_temperature_for_legacy_color_schema(monkeypatch):
    create_admin_user()
    token = get_token()
    room = create_room(token, name="Bedroom")

    upload_response = client.post(
        "/api/v1/extensions/upload",
        files={"file": ("yeelight.zip", build_extension_zip(), "application/zip")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert upload_response.status_code == 200, upload_response.text

    create_response = client.post(
        "/api/v1/external-devices",
        json={
            "installed_extension_id": "yeelight_control",
            "device_schema_id": "yeelight_color_light",
            "name": "Bedroom Bulb",
            "room_id": room["room_id"],
            "config": {"ip_address": "192.168.1.88"},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_response.status_code == 200, create_response.text
    device_payload = create_response.json()

    runtime_result = Mock()
    runtime_result.state = {
        "kind": "action",
        "pin": 0,
        "value": 1,
        "brightness": 128,
        "color_temperature": 4300,
        "capabilities": ["power", "brightness", "rgb", "color_temperature"],
        "reported_at": "2026-04-04T09:05:00+00:00",
        "ip_address": "192.168.1.88",
    }
    monkeypatch.setattr("app.api.execute_external_device_command", Mock(return_value=runtime_result))

    command_response = client.post(
        f"/api/v1/device/{device_payload['device_id']}/command",
        json={"kind": "action", "pin": 0, "color_temperature": 4300},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert command_response.status_code == 200, command_response.text
    assert command_response.json()["status"] == "pending"

    db = TestingSessionLocal()
    try:
        stored_device = db.query(ExternalDevice).filter_by(device_id=device_payload["device_id"]).one()
        assert stored_device.last_state["color_temperature"] == 4300
        assert stored_device.last_state["capabilities"] == ["power", "brightness", "rgb", "color_temperature"]
    finally:
        db.close()


def test_external_device_command_failure_marks_device_offline(monkeypatch):
    create_admin_user()
    token = get_token()
    room = create_room(token, name="Hall")

    upload_response = client.post(
        "/api/v1/extensions/upload",
        files={"file": ("yeelight.zip", build_extension_zip(), "application/zip")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert upload_response.status_code == 200, upload_response.text

    create_response = client.post(
        "/api/v1/external-devices",
        json={
            "installed_extension_id": "yeelight_control",
            "device_schema_id": "yeelight_white_light",
            "name": "Hall Bulb",
            "room_id": room["room_id"],
            "config": {"ip_address": "192.168.1.60"},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_response.status_code == 200, create_response.text
    device_payload = create_response.json()

    from app.services.external_runtime import ExternalDeviceRuntimeError

    monkeypatch.setattr(
        "app.api.execute_external_device_command",
        Mock(side_effect=ExternalDeviceRuntimeError("Bulb offline", mark_offline=True)),
    )
    ws_mock = Mock()
    monkeypatch.setattr("app.api.ws_manager.broadcast_device_event_sync", ws_mock)

    command_response = client.post(
        f"/api/v1/device/{device_payload['device_id']}/command",
        json={"kind": "action", "pin": 0, "value": 1},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert command_response.status_code == 200, command_response.text
    payload = command_response.json()
    assert payload["status"] == "pending"
    assert payload["message"] == "Command requested"

    db = TestingSessionLocal()
    try:
        stored_device = db.query(ExternalDevice).filter_by(device_id=device_payload["device_id"]).one()
        assert stored_device.conn_status == ConnStatus.offline
    finally:
        db.close()

    ws_mock.assert_any_call(
        "command_delivery",
        device_payload["device_id"],
        room["room_id"],
        {
            "command_id": payload["command_id"],
            "status": "failed",
            "reason": "Bulb offline",
        },
    )
    offline_calls = [
        call.args
        for call in ws_mock.call_args_list
        if call.args[:3] == ("device_offline", device_payload["device_id"], room["room_id"])
    ]
    assert offline_calls
    assert isinstance(offline_calls[0][3], dict)
    assert "reported_at" in offline_calls[0][3]


def test_external_device_command_connection_failure_is_reported_as_offline_without_asgi_error(monkeypatch):
    create_admin_user()
    token = get_token()
    room = create_room(token, name="Lab")

    upload_response = client.post(
        "/api/v1/extensions/upload",
        files={"file": ("yeelight.zip", build_extension_zip(), "application/zip")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert upload_response.status_code == 200, upload_response.text

    create_response = client.post(
        "/api/v1/external-devices",
        json={
            "installed_extension_id": "yeelight_control",
            "device_schema_id": "yeelight_white_light",
            "name": "Lab Bulb",
            "room_id": room["room_id"],
            "config": {"ip_address": "192.168.1.77"},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_response.status_code == 200, create_response.text
    device_payload = create_response.json()

    def raise_host_down(*_args, **_kwargs):
        raise OSError("[Errno 64] Host is down")

    monkeypatch.setattr("app.services.external_runtime.socket.create_connection", raise_host_down)
    ws_mock = Mock()
    monkeypatch.setattr("app.api.ws_manager.broadcast_device_event_sync", ws_mock)

    command_response = client.post(
        f"/api/v1/device/{device_payload['device_id']}/command",
        json={"kind": "action", "pin": 0, "value": 1},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert command_response.status_code == 200, command_response.text
    payload = command_response.json()
    assert payload["status"] == "pending"

    db = TestingSessionLocal()
    try:
        stored_device = db.query(ExternalDevice).filter_by(device_id=device_payload["device_id"]).one()
        assert stored_device.conn_status == ConnStatus.offline
    finally:
        db.close()

    ws_mock.assert_any_call(
        "command_delivery",
        device_payload["device_id"],
        room["room_id"],
        {
            "command_id": payload["command_id"],
            "status": "failed",
            "reason": "Yeelight connection failed: [Errno 64] Host is down",
        },
    )
    offline_calls = [
        call.args
        for call in ws_mock.call_args_list
        if call.args[:3] == ("device_offline", device_payload["device_id"], room["room_id"])
    ]
    assert offline_calls
    assert offline_calls[0][3]["reason"] == "Yeelight connection failed: [Errno 64] Host is down"


def test_execute_external_device_command_ignores_async_notification_frames(monkeypatch):
    class FakeSocket:
        def __init__(self, responses: list[bytes]):
            self._responses = list(responses)
            self.sent_payloads: list[dict[str, object]] = []
            self.timeout = None
            self.closed = False

        def settimeout(self, timeout: int) -> None:
            self.timeout = timeout

        def sendall(self, payload: bytes) -> None:
            self.sent_payloads.append(json.loads(payload.decode("utf-8").strip()))

        def recv(self, _size: int) -> bytes:
            if self._responses:
                return self._responses.pop(0)
            return b""

        def close(self) -> None:
            self.closed = True

    fake_socket = FakeSocket(
        [
            b'{"method":"props","params":{"power":"on"}}\r\n{"id":1,"result":["ok"]}\r\n',
            b'{"method":"props","params":{"bright":"50"}}\r\n{"id":2,"result":["on","50","0","mono","0","0","2"]}\r\n',
        ]
    )

    monkeypatch.setattr(
        "app.services.external_runtime.socket.create_connection",
        lambda *_args, **_kwargs: fake_socket,
    )

    extension = build_runtime_backed_extension()
    device = ExternalDevice(
        provider="Yeelight",
        config={"ip_address": "192.168.1.55"},
        schema_snapshot={
            "display": {
                "card_type": "light",
                "capabilities": ["power", "brightness"],
            }
        },
    )
    device.installed_extension = extension

    execution = execute_external_device_command(device, {"kind": "action", "pin": 0, "brightness": 128})

    assert execution.state["value"] == 1
    assert execution.state["power"] == "on"
    assert execution.state["brightness"] == 128
    assert execution.state["ip_address"] == "192.168.1.55"
    assert execution.state["capabilities"] == ["power", "brightness"]
    assert [payload["method"] for payload in fake_socket.sent_payloads] == ["set_bright"]
    assert fake_socket.closed is False


def test_execute_external_device_command_supports_rgb_and_color_temperature(monkeypatch):
    class FakeSocket:
        def __init__(self, responses: list[bytes]):
            self._responses = list(responses)
            self.sent_payloads: list[dict[str, object]] = []

        def settimeout(self, _timeout: int) -> None:
            return None

        def sendall(self, payload: bytes) -> None:
            self.sent_payloads.append(json.loads(payload.decode("utf-8").strip()))

        def recv(self, _size: int) -> bytes:
            if self._responses:
                return self._responses.pop(0)
            return b""

        def close(self) -> None:
            return None

    rgb_socket = FakeSocket(
        [
            b'{"id":1,"result":["ok"]}\r\n',
            b'{"id":2,"result":["on","80","4200","16711680","color","0","0","1"]}\r\n',
        ]
    )
    monkeypatch.setattr(
        "app.services.external_runtime.socket.create_connection",
        lambda *_args, **_kwargs: rgb_socket,
    )

    extension = build_runtime_backed_extension()
    rgb_device = ExternalDevice(
        provider="Yeelight",
        config={"ip_address": "192.168.1.55"},
        schema_snapshot={
            "display": {
                "card_type": "light",
                "capabilities": ["power", "brightness", "rgb"],
            }
        },
    )
    rgb_device.installed_extension = extension

    rgb_execution = execute_external_device_command(
        rgb_device,
        {"kind": "action", "pin": 0, "rgb": {"r": 255, "g": 0, "b": 0}},
    )

    assert rgb_execution.state["rgb"] == {"r": 255, "g": 0, "b": 0}
    assert [payload["method"] for payload in rgb_socket.sent_payloads] == ["set_rgb"]

    temperature_socket = FakeSocket(
        [
            b'{"id":1,"result":["ok"]}\r\n',
            b'{"id":2,"result":["on","65","5000","0","mono","0","0","2"]}\r\n',
        ]
    )
    monkeypatch.setattr(
        "app.services.external_runtime.socket.create_connection",
        lambda *_args, **_kwargs: temperature_socket,
    )

    ambient_device = ExternalDevice(
        provider="Yeelight",
        config={"ip_address": "192.168.1.56"},
        schema_snapshot={
            "display": {
                "card_type": "light",
                "capabilities": ["power", "brightness", "color_temperature"],
                "temperature_range": {"min": 1700, "max": 6500},
            }
        },
    )
    ambient_device.installed_extension = extension

    ambient_execution = execute_external_device_command(
        ambient_device,
        {"kind": "action", "pin": 0, "color_temperature": 5000},
    )

    assert ambient_execution.state["color_temperature"] == 5000
    assert [payload["method"] for payload in temperature_socket.sent_payloads] == ["set_ct_abx"]


def test_execute_external_device_command_enriches_legacy_color_schema_with_tone(monkeypatch):
    class FakeSocket:
        def __init__(self, responses: list[bytes]):
            self._responses = list(responses)
            self.sent_payloads: list[dict[str, object]] = []

        def settimeout(self, _timeout: int) -> None:
            return None

        def sendall(self, payload: bytes) -> None:
            self.sent_payloads.append(json.loads(payload.decode("utf-8").strip()))

        def recv(self, _size: int) -> bytes:
            if self._responses:
                return self._responses.pop(0)
            return b""

        def close(self) -> None:
            return None

    fake_socket = FakeSocket(
        [
            b'{"id":1,"result":["ok"]}\r\n',
            b'{"id":2,"result":["on","70","4200","16711680","color","0","0","1"]}\r\n',
        ]
    )
    monkeypatch.setattr(
        "app.services.external_runtime.socket.create_connection",
        lambda *_args, **_kwargs: fake_socket,
    )

    extension = build_runtime_backed_extension()
    device = ExternalDevice(
        provider="Yeelight",
        device_schema_id="yeelight_color_light",
        config={"ip_address": "192.168.1.77"},
        schema_snapshot={
            "display": {
                "card_type": "light",
                "capabilities": ["power", "brightness", "rgb"],
            }
        },
    )
    device.installed_extension = extension

    execution = execute_external_device_command(
        device,
        {"kind": "action", "pin": 0, "rgb": {"r": 255, "g": 0, "b": 0}},
    )

    assert execution.state["color_temperature"] == 4000
    assert execution.state["capabilities"] == ["power", "brightness", "rgb", "color_temperature"]


def test_execute_external_device_command_powers_on_before_tone_when_last_state_is_off(monkeypatch):
    class FakeSocket:
        def __init__(self, responses: list[bytes]):
            self._responses = list(responses)
            self.sent_payloads: list[dict[str, object]] = []

        def settimeout(self, _timeout: int) -> None:
            return None

        def sendall(self, payload: bytes) -> None:
            self.sent_payloads.append(json.loads(payload.decode("utf-8").strip()))

        def recv(self, _size: int) -> bytes:
            if self._responses:
                return self._responses.pop(0)
            return b""

        def close(self) -> None:
            return None

    fake_socket = FakeSocket(
        [
            b'{"id":1,"result":["ok"]}\r\n',
            b'{"id":2,"result":["ok"]}\r\n',
            b'{"id":3,"result":["on","65","4200","0","mono","0","0","2"]}\r\n',
        ]
    )
    monkeypatch.setattr(
        "app.services.external_runtime.socket.create_connection",
        lambda *_args, **_kwargs: fake_socket,
    )

    extension = build_runtime_backed_extension()
    device = ExternalDevice(
        provider="Yeelight",
        config={"ip_address": "192.168.1.56"},
        last_state={"power": "off", "value": 0, "brightness": 0},
        schema_snapshot={
            "display": {
                "card_type": "light",
                "capabilities": ["power", "brightness", "color_temperature"],
                "temperature_range": {"min": 1700, "max": 6500},
            }
        },
    )
    device.installed_extension = extension

    execution = execute_external_device_command(
        device,
        {"kind": "action", "pin": 0, "color_temperature": 4200},
    )

    assert execution.state["color_temperature"] == 4200
    assert [payload["method"] for payload in fake_socket.sent_payloads] == ["set_power", "set_ct_abx"]


def test_probe_external_device_state_reads_actual_props(monkeypatch):
    class FakeSocket:
        def __init__(self, responses: list[bytes]):
            self._responses = list(responses)
            self.sent_payloads: list[dict[str, object]] = []

        def settimeout(self, _timeout: int) -> None:
            return None

        def sendall(self, payload: bytes) -> None:
            self.sent_payloads.append(json.loads(payload.decode("utf-8").strip()))

        def recv(self, _size: int) -> bytes:
            if self._responses:
                return self._responses.pop(0)
            return b""

        def close(self) -> None:
            return None

    fake_socket = FakeSocket(
        [
            b'{"id":1,"result":["on","50","4200","16711680","colorb","0","0","1"]}\r\n',
        ]
    )
    monkeypatch.setattr(
        "app.services.external_runtime.socket.create_connection",
        lambda *_args, **_kwargs: fake_socket,
    )

    extension = build_runtime_backed_extension()
    device = ExternalDevice(
        provider="Yeelight",
        config={"ip_address": "192.168.1.55"},
        schema_snapshot={
            "display": {
                "card_type": "light",
                "capabilities": ["power", "brightness", "rgb", "color_temperature"],
                "temperature_range": {"min": 1700, "max": 6500},
            }
        },
    )
    device.installed_extension = extension

    execution = probe_external_device_state(device)

    assert execution.state["power"] == "on"
    assert execution.state["brightness"] == 128
    assert execution.state["color_temperature"] == 4200
    assert execution.state["rgb"] == {"r": 255, "g": 0, "b": 0}
    assert [payload["method"] for payload in fake_socket.sent_payloads] == ["get_prop"]


def test_probe_external_device_state_does_not_fallback_to_discovery_when_tcp_connect_fails(monkeypatch):
    from app.services.external_runtime import ExternalDeviceRuntimeError

    def raise_host_down(*_args, **_kwargs):
        raise OSError("[Errno 64] Host is down")

    monkeypatch.setattr("app.services.external_runtime.socket.create_connection", raise_host_down)

    extension = build_runtime_backed_extension()
    device = ExternalDevice(
        provider="Yeelight",
        config={"ip_address": "192.168.1.88"},
        schema_snapshot={
            "display": {
                "card_type": "light",
                "capabilities": ["power", "brightness", "rgb", "color_temperature"],
                "temperature_range": {"min": 1700, "max": 6500},
            }
        },
    )
    device.installed_extension = extension
    runtime_module = load_test_runtime_module(extension)
    monkeypatch.setattr(
        runtime_module,
        "_discover_yeelight_metadata",
        lambda _host: {
            "model": "colorb",
            "support_methods": ["get_prop", "set_bright", "set_rgb", "set_ct_abx"],
            "power": "on",
            "bright": "45",
            "ct": "4200",
            "rgb": "16711680",
            "color_mode": "1",
        },
    )

    with pytest.raises(ExternalDeviceRuntimeError) as exc_info:
        probe_external_device_state(device)

    assert exc_info.value.mark_offline is True
    assert exc_info.value.connection_failed is True
    assert "Yeelight connection failed" in str(exc_info.value)


def test_execute_external_device_command_secondary_retry_no_longer_raises_name_error(monkeypatch):
    from app.services.external_runtime import ExternalDeviceRuntimeError

    class FakeSocket:
        def __init__(self, responses: list[bytes]):
            self._responses = list(responses)
            self.sent_payloads: list[dict[str, object]] = []

        def settimeout(self, _timeout: int) -> None:
            return None

        def sendall(self, payload: bytes) -> None:
            self.sent_payloads.append(json.loads(payload.decode("utf-8").strip()))

        def recv(self, _size: int) -> bytes:
            if self._responses:
                return self._responses.pop(0)
            return b""

        def close(self) -> None:
            return None

    fake_socket = FakeSocket(
        [
            b'{"id":1,"result":["ok"]}\r\n',
            b'{"id":2,"result":["ok"]}\r\n',
        ]
    )
    monkeypatch.setattr(
        "app.services.external_runtime.socket.create_connection",
        lambda *_args, **_kwargs: fake_socket,
    )
    probe_states = [
        {
            "kind": "action",
            "pin": 0,
            "value": 1,
            "brightness": 40,
            "power": "on",
            "provider": "Yeelight",
            "reported_at": "2026-04-04T09:30:00+00:00",
            "ip_address": "192.168.2.8",
            "model": "colorb",
            "color_mode": 2,
            "capabilities": ["power", "brightness", "color_temperature"],
            "color_temperature": 4200,
        },
        {
            "kind": "action",
            "pin": 0,
            "value": 1,
            "brightness": 115,
            "power": "on",
            "provider": "Yeelight",
            "reported_at": "2026-04-04T09:30:01+00:00",
            "ip_address": "192.168.2.8",
            "model": "colorb",
            "color_mode": 2,
            "capabilities": ["power", "brightness", "color_temperature"],
            "color_temperature": 4200,
        },
    ]
    reconciled_probe = Mock(side_effect=probe_states)

    extension = build_runtime_backed_extension()
    device = ExternalDevice(
        provider="Yeelight",
        config={"ip_address": "192.168.2.8"},
        schema_snapshot={
            "display": {
                "card_type": "light",
                "capabilities": ["power", "brightness"],
            }
        },
    )
    device.installed_extension = extension
    runtime_module = load_test_runtime_module(extension)
    timeout_error = runtime_module.ExtensionRuntimeError(
        "Yeelight LAN command 'set_bright' failed: timed out",
        mark_offline=True,
    )
    monkeypatch.setattr(
        runtime_module,
        "_execute_yeelight_command_direct",
        Mock(side_effect=timeout_error),
    )
    monkeypatch.setattr(
        runtime_module,
        "_discover_yeelight_metadata",
        lambda _host: {
            "model": "colorb",
            "support_methods": ["get_prop", "set_power", "set_bright"],
            "power": "on",
            "bright": "40",
            "ct": "4200",
            "rgb": "0",
            "color_mode": "2",
        },
    )
    monkeypatch.setattr(runtime_module, "_probe_yeelight_state", reconciled_probe)

    execution = execute_external_device_command(
        device,
        {"kind": "action", "pin": 0, "brightness": 115},
    )

    assert execution.state["brightness"] == 115
    assert [payload["method"] for payload in fake_socket.sent_payloads] == [
        "set_power",
        "set_bright",
    ]
    assert reconciled_probe.call_count == 2


def test_collect_yeelight_diagnostics_includes_discovery_and_timeout_trace(monkeypatch):
    class FakeLanSocket:
        def __init__(self) -> None:
            self.sent_payloads: list[dict[str, object]] = []
            self.timeout = None
            self.closed = False

        def settimeout(self, timeout: int) -> None:
            self.timeout = timeout

        def sendall(self, payload: bytes) -> None:
            self.sent_payloads.append(json.loads(payload.decode("utf-8").strip()))

        def recv(self, _size: int) -> bytes:
            raise TimeoutError("timed out")

        def close(self) -> None:
            self.closed = True

    class FakeDiscoverySocket:
        def __init__(self) -> None:
            self.timeout = None
            self.closed = False
            self.sent_packets: list[tuple[bytes, tuple[str, int]]] = []
            self._responses = [
                (
                    (
                        "HTTP/1.1 200 OK\r\n"
                        "Location: yeelight://192.168.2.8:55443\r\n"
                        "model: colorb\r\n"
                        "support: get_prop set_power set_bright set_ct_abx set_rgb\r\n"
                        "\r\n"
                    ).encode("utf-8"),
                    ("192.168.2.8", 49153),
                )
            ]

        def setsockopt(self, *_args) -> None:
            return None

        def settimeout(self, timeout: int) -> None:
            self.timeout = timeout

        def sendto(self, packet: bytes, address: tuple[str, int]) -> None:
            self.sent_packets.append((packet, address))

        def recvfrom(self, _size: int) -> tuple[bytes, tuple[str, int]]:
            if self._responses:
                return self._responses.pop(0)
            raise TimeoutError("timed out")

        def close(self) -> None:
            self.closed = True

    lan_socket = FakeLanSocket()
    discovery_socket = FakeDiscoverySocket()

    def fake_socket_factory(*args, **kwargs):
        if args[:3] == (socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP):
            return discovery_socket
        raise AssertionError(f"Unexpected socket args: {args}")

    monkeypatch.setattr(
        "app.services.external_runtime.socket.create_connection",
        lambda *_args, **_kwargs: lan_socket,
    )
    monkeypatch.setattr("app.services.external_runtime.socket.socket", fake_socket_factory)

    diagnostics = collect_yeelight_diagnostics("192.168.2.8")

    assert diagnostics["host"] == "192.168.2.8"
    assert diagnostics["discovery"]["model"] == "colorb"
    assert diagnostics["discovery"]["support_methods"] == [
        "get_prop",
        "set_power",
        "set_bright",
        "set_ct_abx",
        "set_rgb",
    ]
    assert lan_socket.sent_payloads[0]["method"] == "get_prop"
    event_names = [event["event"] for event in diagnostics["events"]]
    assert "discovery_match" in event_names
    assert "connect_ok" in event_names
    assert "send" in event_names
    assert "recv_timeout" in event_names
    assert "probe_error" in event_names
    assert discovery_socket.closed is True
    assert lan_socket.closed is False
    assert diagnostics["online"] is True
    assert diagnostics["control_transport"] == "tcp-no-ack"


def test_extension_runtime_reuses_per_host_session_after_late_reply(monkeypatch):
    class LateReplySocket:
        def __init__(self) -> None:
            self.timeout = None
            self.closed = False
            self.recv_calls = 0
            self.sent_payloads: list[dict[str, object]] = []

        def settimeout(self, timeout: int) -> None:
            self.timeout = timeout

        def sendall(self, payload: bytes) -> None:
            self.sent_payloads.append(json.loads(payload.decode("utf-8").strip()))

        def recv(self, _size: int) -> bytes:
            self.recv_calls += 1
            if self.recv_calls <= 3:
                raise TimeoutError("timed out")
            if self.recv_calls == 4:
                return b'{"id":1,"result":["on","60","4200","0","mono","0","0","2"]}\r\n'
            if self.recv_calls == 5:
                return b'{"id":2,"result":["on","60","4200","0","mono","0","0","2"]}\r\n'
            return b""

        def close(self) -> None:
            self.closed = True

    late_reply_socket = LateReplySocket()
    create_connection_calls = {"count": 0}

    extension = build_runtime_backed_extension()
    runtime_module = load_test_runtime_module(extension)

    def fake_create_connection(*_args, **_kwargs):
        create_connection_calls["count"] += 1
        return late_reply_socket

    monkeypatch.setattr(runtime_module.socket, "create_connection", fake_create_connection)
    monkeypatch.setattr(runtime_module, "_discover_yeelight_metadata", lambda _host: None)

    with pytest.raises(runtime_module.ExtensionRuntimeError) as exc_info:
        runtime_module._probe_yeelight_state(
            host="192.168.1.55",
            capabilities=("power", "brightness"),
        )
    assert "timed out" in str(exc_info.value)

    state = runtime_module._probe_yeelight_state(
        host="192.168.1.55",
        capabilities=("power", "brightness"),
    )

    assert create_connection_calls["count"] == 1
    assert [payload["id"] for payload in late_reply_socket.sent_payloads] == [1, 2]
    assert [payload["method"] for payload in late_reply_socket.sent_payloads] == ["get_prop", "get_prop"]
    assert state["power"] == "on"
    assert state["brightness"] == 153
    assert late_reply_socket.closed is False


def test_extension_runtime_uses_host_side_discovery_helper_when_udp_ssdp_is_blind(monkeypatch):
    class TimeoutLanSocket:
        def __init__(self) -> None:
            self.timeout = None

        def settimeout(self, timeout: int) -> None:
            self.timeout = timeout

        def sendall(self, _payload: bytes) -> None:
            return None

        def recv(self, _size: int) -> bytes:
            raise TimeoutError("timed out")

        def close(self) -> None:
            return None

    class BlindDiscoverySocket:
        def __init__(self) -> None:
            self.sent_packets: list[tuple[bytes, tuple[str, int]]] = []
            self.closed = False

        def setsockopt(self, *_args) -> None:
            return None

        def settimeout(self, _timeout: int) -> None:
            return None

        def sendto(self, packet: bytes, address: tuple[str, int]) -> None:
            self.sent_packets.append((packet, address))

        def recvfrom(self, _size: int) -> tuple[bytes, tuple[str, int]]:
            raise TimeoutError("timed out")

        def close(self) -> None:
            self.closed = True

    class FakeHelperResponse:
        def __init__(self, payload: dict[str, object]) -> None:
            self._payload = payload

        def __enter__(self) -> "FakeHelperResponse":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def read(self) -> bytes:
            return json.dumps(self._payload).encode("utf-8")

    timeout_lan_socket = TimeoutLanSocket()
    blind_discovery_socket = BlindDiscoverySocket()
    helper_requests: list[tuple[str, float]] = []

    extension = build_runtime_backed_extension()
    runtime_module = load_test_runtime_module(extension)

    monkeypatch.setattr(runtime_module.socket, "create_connection", lambda *_args, **_kwargs: timeout_lan_socket)
    monkeypatch.setattr(
        runtime_module.socket,
        "socket",
        lambda *_args, **_kwargs: blind_discovery_socket,
    )
    monkeypatch.setenv("ECONNECT_YEELIGHT_DISCOVERY_HELPER_URL", "http://helper.local:8915")

    def fake_urlopen(url: str, timeout: float):
        helper_requests.append((url, timeout))
        return FakeHelperResponse(
            {
                "model": "colorb",
                "support_methods": ["get_prop", "set_power", "set_bright", "set_ct_abx", "set_rgb"],
                "power": "on",
                "bright": "45",
                "ct": "4200",
                "rgb": "16711680",
                "color_mode": "1",
            }
        )

    monkeypatch.setattr(runtime_module.urllib.request, "urlopen", fake_urlopen)

    state = runtime_module._probe_yeelight_state(
        host="192.168.2.8",
        capabilities=("power", "brightness", "rgb", "color_temperature"),
    )

    assert helper_requests == [("http://helper.local:8915/yeelight/discover?host=192.168.2.8", 1.5)]
    assert blind_discovery_socket.closed is True
    assert blind_discovery_socket.sent_packets
    assert state["model"] == "colorb"
    assert state["power"] == "on"
    assert state["rgb"] == {"r": 255, "g": 0, "b": 0}


def test_refresh_external_device_states_once_marks_online_and_broadcasts_state(monkeypatch):
    create_admin_user()
    token = get_token()
    room = create_room(token, name="Office")

    upload_response = client.post(
        "/api/v1/extensions/upload",
        files={"file": ("yeelight.zip", build_extension_zip(), "application/zip")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert upload_response.status_code == 200, upload_response.text

    create_response = client.post(
        "/api/v1/external-devices",
        json={
            "installed_extension_id": "yeelight_control",
            "device_schema_id": "yeelight_color_light",
            "name": "Office Bulb",
            "room_id": room["room_id"],
            "config": {"ip_address": "192.168.1.99"},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_response.status_code == 200, create_response.text
    device_payload = create_response.json()

    runtime_result = Mock()
    runtime_result.state = {
        "kind": "action",
        "pin": 0,
        "value": 1,
        "brightness": 191,
        "power": "on",
        "provider": "Yeelight",
        "reported_at": "2026-04-04T12:00:00+00:00",
        "ip_address": "192.168.1.99",
        "model": "colorb",
        "color_mode": 1,
        "capabilities": ["power", "brightness", "rgb", "color_temperature"],
        "color_temperature": 4200,
        "rgb": {"r": 255, "g": 0, "b": 0},
    }
    monkeypatch.setattr("app.api.probe_external_device_state", Mock(return_value=runtime_result))
    ws_mock = Mock()
    monkeypatch.setattr("app.api.ws_manager.broadcast_device_event_sync", ws_mock)

    stats = refresh_external_device_states_once(session_factory=TestingSessionLocal)

    assert stats == {"probed": 1, "online": 1, "offline": 0, "changed": 1}

    db = TestingSessionLocal()
    try:
        stored_device = db.query(ExternalDevice).filter_by(device_id=device_payload["device_id"]).one()
        assert stored_device.conn_status == ConnStatus.online
        assert stored_device.last_state["brightness"] == 191
        assert stored_device.last_seen is not None
    finally:
        db.close()

    ws_mock.assert_any_call(
        "device_online",
        device_payload["device_id"],
        room["room_id"],
        runtime_result.state,
    )
    ws_mock.assert_any_call(
        "device_state",
        device_payload["device_id"],
        room["room_id"],
        runtime_result.state,
    )


def test_refresh_external_device_states_once_marks_offline_on_probe_error(monkeypatch):
    from app.services.external_runtime import ExternalDeviceRuntimeError

    create_admin_user()
    token = get_token()
    room = create_room(token, name="Hallway")

    upload_response = client.post(
        "/api/v1/extensions/upload",
        files={"file": ("yeelight.zip", build_extension_zip(), "application/zip")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert upload_response.status_code == 200, upload_response.text

    create_response = client.post(
        "/api/v1/external-devices",
        json={
            "installed_extension_id": "yeelight_control",
            "device_schema_id": "yeelight_white_light",
            "name": "Hallway Bulb",
            "room_id": room["room_id"],
            "config": {"ip_address": "192.168.1.100"},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_response.status_code == 200, create_response.text
    device_payload = create_response.json()

    db = TestingSessionLocal()
    try:
        stored_device = db.query(ExternalDevice).filter_by(device_id=device_payload["device_id"]).one()
        stored_device.conn_status = ConnStatus.online
        stored_device.last_state = {"kind": "action", "pin": 0, "value": 1, "brightness": 180}
        db.commit()
    finally:
        db.close()

    monkeypatch.setattr(
        "app.api.probe_external_device_state",
        Mock(side_effect=ExternalDeviceRuntimeError("Bulb offline", mark_offline=True)),
    )
    ws_mock = Mock()
    monkeypatch.setattr("app.api.ws_manager.broadcast_device_event_sync", ws_mock)

    stats = refresh_external_device_states_once(session_factory=TestingSessionLocal)

    assert stats == {"probed": 1, "online": 0, "offline": 1, "changed": 0}

    db = TestingSessionLocal()
    try:
        stored_device = db.query(ExternalDevice).filter_by(device_id=device_payload["device_id"]).one()
        assert stored_device.conn_status == ConnStatus.offline
    finally:
        db.close()

    offline_calls = [
        call.args
        for call in ws_mock.call_args_list
        if call.args[:3] == ("device_offline", device_payload["device_id"], room["room_id"])
    ]
    assert offline_calls
    assert offline_calls[0][3]["reason"] == "Bulb offline"


def test_refresh_external_device_states_once_skips_missing_runtime_package_without_crashing():
    create_admin_user()
    token = get_token()

    upload_response = client.post(
        "/api/v1/extensions/upload",
        files={"file": ("yeelight.zip", build_extension_zip(root_folder="Yeelight_control"), "application/zip")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert upload_response.status_code == 200, upload_response.text

    create_response = client.post(
        "/api/v1/external-devices",
        json={
            "installed_extension_id": "yeelight_control",
            "device_schema_id": "yeelight_white_light",
            "name": "Kitchen Yeelight",
            "config": {"ip_address": "192.168.1.55"},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_response.status_code == 200, create_response.text

    db = TestingSessionLocal()
    try:
        stored_extension = db.query(InstalledExtension).filter_by(extension_id="yeelight_control").one()
        Path(stored_extension.archive_path).unlink(missing_ok=True)
        extracted_dir = resolve_extracted_extension_dir(
            extension_id=stored_extension.extension_id,
            version=stored_extension.version,
            archive_sha256=stored_extension.archive_sha256,
        )
        if extracted_dir.exists():
            import shutil

            shutil.rmtree(extracted_dir)
    finally:
        db.close()

    clear_extension_runtime_cache()
    stats = refresh_external_device_states_once(session_factory=TestingSessionLocal)

    assert stats == {"probed": 1, "online": 0, "offline": 0, "changed": 0}


def test_execute_external_device_command_reconciles_direct_timeout_with_observed_state(monkeypatch):
    from app.services.external_runtime import ExternalDeviceRuntimeError

    extension = build_runtime_backed_extension()
    device = ExternalDevice(
        provider="Yeelight",
        config={"ip_address": "192.168.2.8"},
        schema_snapshot={
            "display": {
                "card_type": "light",
                "capabilities": ["power", "brightness", "rgb", "color_temperature"],
                "temperature_range": {"min": 1700, "max": 6500},
            }
        },
    )
    device.installed_extension = extension

    reconciled_probe = Mock(
        return_value={
            "kind": "action",
            "pin": 0,
            "value": 1,
            "brightness": 115,
            "power": "on",
            "provider": "Yeelight",
            "reported_at": "2026-04-04T09:30:00+00:00",
            "ip_address": "192.168.2.8",
            "model": "colorb",
            "color_mode": 1,
            "capabilities": ["power", "brightness", "rgb", "color_temperature"],
            "color_temperature": 4200,
            "rgb": {"r": 255, "g": 0, "b": 0},
        }
    )
    runtime_module = load_test_runtime_module(extension)
    timeout_error = runtime_module.ExtensionRuntimeError(
        "Yeelight LAN command 'set_bright' failed: timed out",
        mark_offline=True,
    )
    monkeypatch.setattr(
        runtime_module,
        "_execute_yeelight_command_direct",
        Mock(side_effect=timeout_error),
    )
    monkeypatch.setattr(
        runtime_module,
        "_discover_yeelight_metadata",
        lambda _host: {
            "model": "colorb",
            "support_methods": ["get_prop", "set_bright", "set_rgb", "set_ct_abx"],
            "power": "on",
            "bright": "45",
            "ct": "4200",
            "rgb": "16711680",
            "color_mode": "1",
        },
    )
    monkeypatch.setattr(runtime_module, "_probe_yeelight_state", reconciled_probe)

    execution = execute_external_device_command(
        device,
        {"kind": "action", "pin": 0, "brightness": 115},
    )

    assert execution.state["model"] == "colorb"
    assert execution.state["brightness"] == 115
    reconciled_probe.assert_called_once()
