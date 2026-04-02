import importlib
import json
import sys

from sqlalchemy import text


def _reload_database_module():
    for module_name in ["app.sql_models", "app.database"]:
        sys.modules.pop(module_name, None)
    return importlib.import_module("app.database")


def test_database_url_uses_explicit_env(monkeypatch, tmp_path):
    explicit_db = tmp_path / "explicit.sqlite3"
    explicit_url = f"sqlite:///{explicit_db}"

    monkeypatch.setenv("DATABASE_URL", explicit_url)
    monkeypatch.delenv("LOCAL_DATABASE_PATH", raising=False)

    database_module = _reload_database_module()

    assert database_module.DATABASE_URL == explicit_url


def test_database_url_defaults_to_local_docker_mariadb(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "")

    database_module = _reload_database_module()

    assert database_module.DATABASE_URL == "mysql+pymysql://econnect:root_password@127.0.0.1:3306/e_connect_db"


def test_initialize_database_runs_cleanup_backfills_and_approval_drop(monkeypatch):
    database_module = _reload_database_module()
    call_order: list[str] = []

    monkeypatch.setattr(
        database_module.Base.metadata,
        "create_all",
        lambda bind: call_order.append("create_all"),
    )
    monkeypatch.setattr(
        database_module,
        "_ensure_additive_columns",
        lambda: call_order.append("ensure_additive_columns"),
    )
    monkeypatch.setattr(
        database_module,
        "_backfill_room_household_ids",
        lambda: call_order.append("backfill_room_household_ids"),
    )
    monkeypatch.setattr(
        database_module,
        "_backfill_project_wifi_credentials",
        lambda: call_order.append("backfill_project_wifi_credentials"),
    )
    monkeypatch.setattr(
        database_module,
        "_backfill_legacy_build_history_metadata",
        lambda: call_order.append("backfill_legacy_build_history_metadata"),
    )
    monkeypatch.setattr(
        database_module,
        "_cleanup_project_board_config_data",
        lambda: call_order.append("cleanup_project_board_config_data"),
    )
    monkeypatch.setattr(
        database_module,
        "_cleanup_legacy_user_approval_status",
        lambda: call_order.append("cleanup_legacy_user_approval_status"),
    )

    ok, error = database_module.initialize_database(max_attempts=1, retry_delay=0)

    assert ok is True
    assert error is None
    assert call_order == [
        "create_all",
        "ensure_additive_columns",
        "backfill_room_household_ids",
        "backfill_project_wifi_credentials",
        "backfill_legacy_build_history_metadata",
        "cleanup_project_board_config_data",
        "cleanup_legacy_user_approval_status",
    ]


def test_initialize_database_backfills_legacy_history_and_cleans_stale_board_config(monkeypatch, tmp_path):
    explicit_db = tmp_path / "legacy.sqlite3"
    explicit_url = f"sqlite:///{explicit_db}"

    monkeypatch.setenv("DATABASE_URL", explicit_url)
    monkeypatch.delenv("LOCAL_DATABASE_PATH", raising=False)

    database_module = _reload_database_module()
    sql_models = importlib.import_module("app.sql_models")
    database_module.Base.metadata.create_all(bind=database_module.engine)

    with database_module.engine.begin() as connection:
        connection.execute(text("ALTER TABLE users ADD COLUMN approval_status VARCHAR(8) NOT NULL DEFAULT 'approved'"))

    db = database_module.SessionLocal()
    project_id = "00000000-0000-0000-0000-000000000111"
    device_id = "00000000-0000-0000-0000-000000000222"
    legacy_job_id = "00000000-0000-0000-0000-000000000333"
    try:
        user = sql_models.User(
            username="admin",
            fullname="Admin",
            authentication="hashed",
            account_type=sql_models.AccountType.admin,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        household = sql_models.Household(name="Legacy Household")
        db.add(household)
        db.commit()
        db.refresh(household)

        membership = sql_models.HouseholdMembership(
            user_id=user.user_id,
            household_id=household.household_id,
            role=sql_models.HouseholdRole.owner,
        )
        room = sql_models.Room(
            name="Legacy Room",
            user_id=user.user_id,
            household_id=household.household_id,
        )
        db.add_all([membership, room])
        db.commit()
        db.refresh(room)

        legacy_missing_job_id = "00000000-0000-0000-0000-000000000999"
        project = sql_models.DiyProject(
            id=project_id,
            user_id=user.user_id,
            room_id=room.room_id,
            name="Legacy Config",
            board_profile="esp32-c3-super-mini",
            config={
                "project_name": "Legacy Config",
                "pins": [{"gpio_pin": 3, "mode": "PWM", "label": "LED GPIO3"}],
                "latest_build_job_id": legacy_missing_job_id,
                "latest_build_config_key": "stale-build-key",
            },
            pending_config={
                "pins": [{"gpio_pin": 4, "mode": "OUTPUT", "label": "Pending Relay"}],
                "latest_build_job_id": legacy_missing_job_id,
                "latest_build_config_key": "stale-build-key",
            },
            pending_build_job_id=legacy_missing_job_id,
        )
        db.add(project)
        db.commit()

        device = sql_models.Device(
            device_id=device_id,
            mac_address="00:11:22:33:44:55",
            name="Legacy Board",
            owner_id=user.user_id,
            room_id=room.room_id,
            mode=sql_models.DeviceMode.no_code,
            auth_status=sql_models.AuthStatus.approved,
            provisioning_project_id=project.id,
        )
        db.add(device)

        legacy_job = sql_models.BuildJob(
            id=legacy_job_id,
            project_id=project.id,
            status=sql_models.JobStatus.flash_failed,
            staged_project_config={
                "pins": [{"gpio_pin": 3, "mode": "PWM", "label": "LED GPIO3"}],
                "latest_build_job_id": legacy_missing_job_id,
                "latest_build_config_key": "stale-build-key",
            },
        )
        db.add(legacy_job)
        db.commit()
    finally:
        db.close()

    ok, error = database_module.initialize_database(max_attempts=1, retry_delay=0)

    assert ok is True
    assert error is None
    assert database_module._column_exists("users", "approval_status") is False

    db = database_module.SessionLocal()
    try:
        refreshed_project = db.query(sql_models.DiyProject).filter_by(id=project_id).one()
        refreshed_job = db.query(sql_models.BuildJob).filter_by(id=legacy_job_id).one()

        assert refreshed_project.pending_build_job_id is None
        assert refreshed_project.pending_config is None
        assert refreshed_project.config["config_name"] == "Legacy Board"
        assert refreshed_project.config["assigned_device_id"] == device_id
        assert refreshed_project.config["assigned_device_name"] == "Legacy Board"
        assert "latest_build_job_id" not in refreshed_project.config
        assert "latest_build_config_key" not in refreshed_project.config

        staged_snapshot = refreshed_job.staged_project_config
        if isinstance(staged_snapshot, str):
            staged_snapshot = json.loads(staged_snapshot)

        assert staged_snapshot["config_id"] == legacy_job_id
        assert staged_snapshot["config_name"] == "Legacy Board"
        assert staged_snapshot["assigned_device_id"] == device_id
        assert staged_snapshot["assigned_device_name"] == "Legacy Board"
        assert staged_snapshot["saved_at"]
        assert "latest_build_job_id" not in staged_snapshot
        assert "latest_build_config_key" not in staged_snapshot
    finally:
        db.close()
