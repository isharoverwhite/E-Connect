import importlib
import sys
from pathlib import Path


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


def test_database_url_falls_back_to_local_sqlite(monkeypatch, tmp_path):
    fallback_db = tmp_path / "fallback.sqlite3"

    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("LOCAL_DATABASE_PATH", str(fallback_db))

    database_module = _reload_database_module()
    importlib.import_module("app.sql_models")

    ready, error = database_module.initialize_database(max_attempts=1, retry_delay=0)

    assert database_module.DATABASE_URL == f"sqlite:///{fallback_db}"
    assert ready is True
    assert error is None
    assert Path(fallback_db).exists()
