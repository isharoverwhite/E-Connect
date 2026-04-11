# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

import shutil
import tarfile
from datetime import datetime, timezone
from pathlib import Path

import app.api as api_module
import main
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import close_all_sessions, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import get_password_hash
from app.database import Base, get_db
from app.services import builder
from app.services import firmware_template_repo
from app.sql_models import AccountType, Household, HouseholdMembership, HouseholdRole, User


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
    Base.metadata.drop_all(bind=engine)
    close_all_sessions()


def create_admin_user(username: str = "firmware-admin") -> None:
    db = TestingSessionLocal()
    try:
        user = User(
            username=username,
            fullname="Firmware Admin",
            authentication=get_password_hash("password"),
            account_type=AccountType.admin,
        )
        household = Household(name="Firmware Household", timezone="Asia/Ho_Chi_Minh")
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
    finally:
        db.close()


def get_token(client: TestClient, username: str = "firmware-admin") -> str:
    response = client.post(
        "/api/v1/auth/token",
        data={"username": username, "password": "password"},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def configure_template_paths(monkeypatch, tmp_path: Path) -> tuple[Path, Path, Path]:
    install_root = tmp_path / "firmware-template"
    current_dir = install_root / "current"
    state_file = install_root / "state.json"

    monkeypatch.setattr(firmware_template_repo, "FIRMWARE_TEMPLATE_INSTALL_ROOT", install_root)
    monkeypatch.setattr(firmware_template_repo, "FIRMWARE_TEMPLATE_CURRENT_DIR", current_dir)
    monkeypatch.setattr(firmware_template_repo, "FIRMWARE_TEMPLATE_STATE_FILE", state_file)
    return install_root, current_dir, state_file


def create_template_dir(root: Path, revision: str, *, marker: str) -> None:
    (root / "include").mkdir(parents=True, exist_ok=True)
    (root / "src").mkdir(parents=True, exist_ok=True)
    (root / "platformio.ini").write_text(f"; {marker}\n", encoding="utf-8")
    (root / "include" / "firmware_revision.h").write_text(
        "\n".join(
            [
                "/* test firmware revision */",
                "#pragma once",
                f'#define ECONNECT_FIRMWARE_REVISION "{revision}"',
                "",
            ]
        ),
        encoding="utf-8",
    )
    (root / "src" / "main.cpp").write_text(f"// {marker}\n", encoding="utf-8")


def build_release_archive(source_dir: Path, archive_path: Path, *, prefix: str) -> None:
    with tarfile.open(archive_path, "w:gz") as archive:
        for path in sorted(source_dir.rglob("*")):
            archive.add(path, arcname=str(Path(prefix) / path.relative_to(source_dir)))


def test_get_latest_firmware_revision_prefers_installed_release(monkeypatch, tmp_path):
    _, current_dir, _ = configure_template_paths(monkeypatch, tmp_path)
    create_template_dir(current_dir, "2.0.0", marker="installed")

    assert builder.get_latest_firmware_revision() == "2.0.0"

def test_get_latest_firmware_revision_returns_none_when_missing(monkeypatch, tmp_path):
    configure_template_paths(monkeypatch, tmp_path)

    assert builder.get_latest_firmware_revision() is None


def test_copy_firmware_template_prefers_installed_release_template(monkeypatch, tmp_path):
    _, current_dir, _ = configure_template_paths(monkeypatch, tmp_path)
    create_template_dir(current_dir, "2.0.0", marker="installed")
    monkeypatch.setenv("FIRMWARE_TEMPLATE_AUTO_UPDATE", "0")

    destination = tmp_path / "workspace"
    builder.copy_firmware_template(str(destination))

    assert (destination / "src" / "main.cpp").read_text(encoding="utf-8") == "// installed\n"
    assert (destination / "include" / "firmware_revision.h").read_text(encoding="utf-8").find("2.0.0") != -1


def test_refresh_firmware_template_release_installs_latest_release(monkeypatch, tmp_path):
    install_root, current_dir, _ = configure_template_paths(monkeypatch, tmp_path)

    release_source_dir = tmp_path / "release-source"
    create_template_dir(release_source_dir, "2.0.0", marker="release")
    archive_path = tmp_path / "firmware-release.tar.gz"
    build_release_archive(release_source_dir, archive_path, prefix="econnectrelease-firmware-abcdef")

    monkeypatch.setattr(
        firmware_template_repo,
        "_fetch_latest_release_metadata",
        lambda: {
            "tag_name": "v2.0.0",
            "tarball_url": "https://example.test/firmware-v2.0.0.tar.gz",
            "html_url": "https://github.com/econnectrelease/firmware/releases/tag/v2.0.0",
            "published_at": "2026-04-10T16:00:00Z",
        },
    )
    monkeypatch.setattr(
        firmware_template_repo,
        "_download_release_tarball",
        lambda url, destination: shutil.copy2(archive_path, destination),
    )

    status = firmware_template_repo.refresh_firmware_template_release(force=True)

    assert status["active_source"] == "release"
    assert status["bundled_revision"] is None
    assert status["installed_release_tag"] == "v2.0.0"
    assert status["active_revision"] == "2.0.0"
    assert status["update_available"] is False
    assert current_dir.exists()
    assert (current_dir / "src" / "main.cpp").read_text(encoding="utf-8") == "// release\n"
    assert (install_root / "state.json").exists()


def test_refresh_firmware_template_release_sets_pending_notification(monkeypatch, tmp_path):
    configure_template_paths(monkeypatch, tmp_path)

    release_source_dir = tmp_path / "release-source"
    create_template_dir(release_source_dir, "2.0.0", marker="release")
    archive_path = tmp_path / "firmware-release.tar.gz"
    build_release_archive(release_source_dir, archive_path, prefix="econnectrelease-firmware-abcdef")

    monkeypatch.setattr(
        firmware_template_repo,
        "_fetch_latest_release_metadata",
        lambda: {
            "tag_name": "v2.0.0",
            "tarball_url": "https://example.test/firmware-v2.0.0.tar.gz",
            "html_url": "https://github.com/econnectrelease/firmware/releases/tag/v2.0.0",
            "published_at": "2026-04-10T16:00:00Z",
        },
    )
    monkeypatch.setattr(
        firmware_template_repo,
        "_download_release_tarball",
        lambda url, destination: shutil.copy2(archive_path, destination),
    )

    firmware_template_repo.refresh_firmware_template_release(force=True)

    payload = firmware_template_repo.consume_pending_firmware_template_notification()
    assert payload is not None
    assert payload["release_tag"] == "v2.0.0"
    assert payload["release_revision"] == "2.0.0"
    assert payload["source_repo"] == "econnectrelease/firmware"
    assert firmware_template_repo.consume_pending_firmware_template_notification() is None


def test_refresh_firmware_template_endpoint_returns_status(monkeypatch):
    create_admin_user()
    expected_status = {
        "source_repo": "econnectrelease/firmware",
        "auto_update_enabled": True,
        "active_source": "release",
        "active_path": "/data/firmware-template/current",
        "active_revision": "1.1.4",
        "active_release_tag": "v1.1.4",
        "bundled_revision": None,
        "installed_release_tag": "v1.1.4",
        "latest_release_tag": "v1.1.4",
        "latest_release_published_at": "2026-04-10T16:00:00Z",
        "last_checked_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "last_install_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "update_available": False,
        "last_error": None,
    }
    monkeypatch.setattr(api_module, "refresh_firmware_template_release", lambda force=True: expected_status)

    with TestClient(main.app) as client:
        token = get_token(client)
        response = client.post(
            "/api/v1/system/firmware-template/refresh",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["source_repo"] == "econnectrelease/firmware"
    assert payload["active_source"] == "release"
    assert payload["installed_release_tag"] == "v1.1.4"


def test_main_records_pending_firmware_template_notification_as_warning(monkeypatch):
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        main,
        "consume_pending_firmware_template_notification",
        lambda: {
            "release_tag": "v2.0.0",
            "release_revision": "2.0.0",
            "previous_release_tag": "v1.1.4",
            "previous_revision": "1.1.4",
            "installed_at": "2026-04-10T16:00:00Z",
            "source_repo": "econnectrelease/firmware",
        },
    )
    monkeypatch.setattr(main, "record_system_log", lambda **kwargs: captured.update(kwargs) or True)

    main._record_pending_firmware_template_notification()

    assert captured["event_code"] == "firmware_template_release_installed"
    assert captured["severity"] == main.SystemLogSeverity.warning
    assert captured["category"] == main.SystemLogCategory.firmware
    assert "Update your boards to apply it." in str(captured["message"])
