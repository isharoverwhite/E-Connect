import importlib
import sys


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
