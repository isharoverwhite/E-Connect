import io
import json
import zipfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import close_all_sessions, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import router
from app.auth import get_password_hash
from app.database import Base, get_db
from app.services.extensions import ExtensionManifestValidationError, parse_extension_archive
from app.sql_models import (
    AccountType,
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


@pytest.fixture(autouse=True)
def setup_db():
    close_all_sessions()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    close_all_sessions()


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


def build_manifest() -> dict[str, object]:
    return {
        "manifest_version": "1.0",
        "extension_id": "yeelight_control",
        "name": "Yeelight Control",
        "version": "1.0.0",
        "author": "experience",
        "description": "Registers Yeelight bulbs as external devices.",
        "provider": {
            "key": "yeelight",
            "display_name": "Yeelight",
        },
        "package": {
            "runtime": "python",
            "entrypoint": "main.py",
        },
        "device_schemas": [
            {
                "schema_id": "yeelight_bulb",
                "name": "Yeelight Bulb",
                "default_name": "Yeelight Bulb",
                "description": "Dimmable Wi-Fi bulb",
                "display": {"card_type": "light"},
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
            }
        ],
    }


def build_extension_zip(
    manifest: dict[str, object] | None = None,
    *,
    root_folder: str | None = None,
    entrypoint_name: str = "main.py",
) -> bytes:
    manifest_payload = manifest or build_manifest()
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        prefix = f"{root_folder}/" if root_folder else ""
        archive.writestr(f"{prefix}manifest.json", json.dumps(manifest_payload))
        archive.writestr(f"{prefix}{entrypoint_name}", "print('extension entrypoint')")
    return buffer.getvalue()


def test_parse_extension_archive_rejects_legacy_manifest_shape():
    legacy_manifest = {
        "module_name": "Legacy Yeelight",
        "file_path": "main.py",
        "version": "1.0.0",
    }

    with pytest.raises(ExtensionManifestValidationError):
        parse_extension_archive(build_extension_zip(legacy_manifest))


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
    assert payload["device_schemas"][0]["schema_id"] == "yeelight_bulb"

    db = TestingSessionLocal()
    try:
        stored_extension = db.query(InstalledExtension).filter_by(extension_id="yeelight_control").one()
        assert stored_extension.package_entrypoint == "main.py"
        assert stored_extension.provider_name == "Yeelight"
        assert stored_extension.archive_sha256 == payload["archive_sha256"]
    finally:
        db.close()

    list_response = client.get(
        "/api/v1/extensions",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert list_response.status_code == 200, list_response.text
    assert len(list_response.json()) == 1


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
            "device_schema_id": "yeelight_bulb",
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
    assert detail_response.json()["schema_snapshot"]["schema_id"] == "yeelight_bulb"

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
            "device_schema_id": "yeelight_bulb",
            "name": "Broken Yeelight",
            "config": {},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_response.status_code == 400
    assert create_response.json()["detail"]["error"] == "validation"
    assert "ip_address" in create_response.json()["detail"]["message"]
