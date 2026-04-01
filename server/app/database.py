import logging
import os
import time

from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Load .env from the directory containing this file's parent (the project root)
server_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
env_path = os.path.join(server_root, '.env')
load_dotenv(dotenv_path=env_path)

DEFAULT_DATABASE_URL = "mysql+pymysql://econnect:root_password@127.0.0.1:3306/e_connect_db"

configured_database_url = os.getenv("DATABASE_URL")
DATABASE_URL = configured_database_url.strip() if configured_database_url else DEFAULT_DATABASE_URL

if DATABASE_URL == DEFAULT_DATABASE_URL:
    logger.info(
        "DATABASE_URL is not configured. Defaulting to Docker-backed local MariaDB at 127.0.0.1:3306/e_connect_db"
    )

engine_options = {"pool_pre_ping": True}

if DATABASE_URL.startswith("sqlite"):
    engine_options["connect_args"] = {"check_same_thread": False}
else:
    engine_options["pool_recycle"] = int(os.getenv("DATABASE_POOL_RECYCLE", "300"))
    engine_options["connect_args"] = {
        "connect_timeout": int(os.getenv("DATABASE_CONNECT_TIMEOUT", "15")),
        "read_timeout": int(os.getenv("DATABASE_READ_TIMEOUT", "120")),
        "write_timeout": int(os.getenv("DATABASE_WRITE_TIMEOUT", "120")),
    }

engine = create_engine(DATABASE_URL, **engine_options)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def _format_operational_error(exc: OperationalError) -> str:
    original_error = getattr(exc, "orig", None)
    return str(original_error or exc)

def check_database_connection():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True, None
    except SQLAlchemyError as exc:
        error_message = _format_operational_error(exc) if isinstance(exc, OperationalError) else str(exc)
        logger.warning("Database connectivity check failed: %s", error_message)
        return False, error_message

def _ensure_column(table_name: str, column_name: str, sqlite_definition: str, maria_definition: str):
    with engine.connect() as conn:
        if DATABASE_URL.startswith("sqlite"):
            existing_columns = conn.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
            if not any(column[1] == column_name for column in existing_columns):
                conn.execute(text(
                    f"ALTER TABLE {table_name} ADD COLUMN {column_name} {sqlite_definition}"
                ))
                conn.commit()
            return

        result = conn.execute(text(
            "SELECT COUNT(*) FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table_name AND COLUMN_NAME = :column_name"
        ), {"table_name": table_name, "column_name": column_name})
        if result.scalar() == 0:
            conn.execute(text(
                f"ALTER TABLE {table_name} ADD COLUMN {column_name} {maria_definition}"
            ))
            conn.commit()


def _ensure_additive_columns():
    """Additive column guard for backwards-compatible schema changes."""
    column_guards = [
        ("users", "approval_status", "VARCHAR(8) NOT NULL DEFAULT 'approved'", "VARCHAR(8) NOT NULL DEFAULT 'approved'"),
        ("build_jobs", "finished_at", "DATETIME", "DATETIME NULL"),
        ("build_jobs", "error_message", "TEXT", "TEXT NULL"),
        (
            "devices",
            "provisioning_project_id",
            "VARCHAR(36)",
            "VARCHAR(36) NULL COMMENT 'DIY project id used to derive secure firmware credentials'",
        ),
        (
            "devices",
            "ip_address",
            "VARCHAR(64)",
            "VARCHAR(64) NULL COMMENT 'Current LAN IP reported by the device'",
        ),
        (
            "devices",
            "firmware_revision",
            "VARCHAR(50)",
            "VARCHAR(50) NULL COMMENT 'Developer-managed firmware revision reported by the device'",
        ),
        (
            "devices",
            "pairing_requested_at",
            "DATETIME",
            "DATETIME NULL COMMENT 'UTC timestamp of the latest board-initiated pairing request awaiting admin action'",
        ),
        (
            "rooms",
            "household_id",
            "INTEGER",
            "INT NULL",
        ),
        (
            "households",
            "timezone",
            "VARCHAR(64)",
            "VARCHAR(64) NULL COMMENT 'IANA timezone override for server runtime behavior'",
        ),
        (
            "diy_projects",
            "room_id",
            "INTEGER",
            "INT NULL",
        ),
        (
            "diy_projects",
            "wifi_credential_id",
            "INTEGER",
            "INT NULL",
        ),
        (
            "automations",
            "schedule_type",
            "VARCHAR(16) NOT NULL DEFAULT 'manual'",
            "VARCHAR(16) NOT NULL DEFAULT 'manual'",
        ),
        (
            "automations",
            "timezone",
            "VARCHAR(64)",
            "VARCHAR(64) NULL",
        ),
        (
            "automations",
            "schedule_hour",
            "INTEGER",
            "INT NULL",
        ),
        (
            "automations",
            "schedule_minute",
            "INTEGER",
            "INT NULL",
        ),
        (
            "automations",
            "schedule_weekdays",
            "TEXT",
            "JSON NULL",
        ),
        (
            "automations",
            "next_run_at",
            "DATETIME",
            "DATETIME NULL",
        ),
        (
            "system_logs",
            "is_read",
            "BOOLEAN NOT NULL DEFAULT 0",
            "BOOLEAN NOT NULL DEFAULT 0",
        ),
        (
            "system_logs",
            "read_at",
            "DATETIME",
            "DATETIME NULL",
        ),
        (
            "system_logs",
            "read_by_user_id",
            "INTEGER",
            "INT NULL",
        ),
        (
            "automation_execution_logs",
            "trigger_source",
            "VARCHAR(16) NOT NULL DEFAULT 'manual'",
            "VARCHAR(16) NOT NULL DEFAULT 'manual'",
        ),
        (
            "automation_execution_logs",
            "scheduled_for",
            "DATETIME",
            "DATETIME NULL",
        ),
    ]

    for table_name, column_name, sqlite_definition, maria_definition in column_guards:
        try:
            _ensure_column(table_name, column_name, sqlite_definition, maria_definition)
        except Exception as exc:
            logger.warning(
                "Schema additive guard failed for %s.%s (non-fatal): %s",
                table_name,
                column_name,
                exc,
            )

    logger.info("Schema additive guards completed")


def _backfill_room_household_ids():
    with engine.connect() as conn:
        try:
            if DATABASE_URL.startswith("sqlite"):
                conn.execute(text(
                    """
                    UPDATE rooms
                    SET household_id = (
                        SELECT hm.household_id
                        FROM household_memberships hm
                        WHERE hm.user_id = rooms.user_id
                        ORDER BY hm.id ASC
                        LIMIT 1
                    )
                    WHERE household_id IS NULL
                    """
                ))
            else:
                conn.execute(text(
                    """
                    UPDATE rooms r
                    JOIN household_memberships hm
                      ON hm.user_id = r.user_id
                    SET r.household_id = hm.household_id
                    WHERE r.household_id IS NULL
                    """
                ))
            conn.commit()
        except Exception as exc:
            logger.warning("Room household backfill failed (non-fatal): %s", exc)


def _backfill_project_wifi_credentials():
    from .sql_models import DiyProject, HouseholdMembership, WifiCredential

    db = SessionLocal()
    try:
        projects = (
            db.query(DiyProject)
            .filter(DiyProject.wifi_credential_id.is_(None))
            .all()
        )
        changed = False

        for project in projects:
            config_json = project.config if isinstance(project.config, dict) else {}
            wifi_ssid = config_json.get("wifi_ssid")
            wifi_password = config_json.get("wifi_password")
            if not isinstance(wifi_ssid, str) or not wifi_ssid.strip():
                continue
            if not isinstance(wifi_password, str) or not wifi_password.strip():
                continue

            membership = (
                db.query(HouseholdMembership)
                .filter(HouseholdMembership.user_id == project.user_id)
                .order_by(HouseholdMembership.id.asc())
                .first()
            )
            if not membership:
                continue

            credential = (
                db.query(WifiCredential)
                .filter(
                    WifiCredential.household_id == membership.household_id,
                    WifiCredential.ssid == wifi_ssid.strip(),
                    WifiCredential.password == wifi_password,
                )
                .order_by(WifiCredential.id.asc())
                .first()
            )

            if credential is None:
                credential = WifiCredential(
                    household_id=membership.household_id,
                    ssid=wifi_ssid.strip(),
                    password=wifi_password,
                )
                db.add(credential)
                db.flush()

            project.wifi_credential_id = credential.id
            changed = True

        if changed:
            db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("DIY project Wi-Fi credential backfill failed (non-fatal): %s", exc)
    finally:
        db.close()


def initialize_database(max_attempts: int = 3, retry_delay: float = 1.0):
    last_error = None

    for attempt in range(1, max_attempts + 1):
        try:
            Base.metadata.create_all(bind=engine)
            _ensure_additive_columns()
            _backfill_room_household_ids()
            _backfill_project_wifi_credentials()
            logger.info("Database schema is ready")
            return True, None
        except SQLAlchemyError as exc:
            last_error = _format_operational_error(exc) if isinstance(exc, OperationalError) else str(exc)
            logger.warning(
                "Database initialization attempt %s/%s failed: %s",
                attempt,
                max_attempts,
                last_error,
            )
            if attempt < max_attempts:
                time.sleep(retry_delay)

    return False, last_error

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
