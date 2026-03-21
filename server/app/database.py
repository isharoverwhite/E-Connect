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

DEFAULT_SQLITE_PATH = os.getenv(
    "LOCAL_DATABASE_PATH",
    os.path.join(server_root, "db.sqlite3"),
)
DEFAULT_DATABASE_URL = f"sqlite:///{DEFAULT_SQLITE_PATH}"

configured_database_url = os.getenv("DATABASE_URL")
DATABASE_URL = configured_database_url.strip() if configured_database_url else DEFAULT_DATABASE_URL

if DATABASE_URL == DEFAULT_DATABASE_URL:
    default_sqlite_dir = os.path.dirname(DEFAULT_SQLITE_PATH)
    if default_sqlite_dir:
        os.makedirs(default_sqlite_dir, exist_ok=True)
    logger.info("DATABASE_URL is not configured. Falling back to local SQLite at %s", DEFAULT_SQLITE_PATH)

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
            "diy_projects",
            "room_id",
            "INTEGER",
            "INT NULL",
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


def initialize_database(max_attempts: int = 3, retry_delay: float = 1.0):
    last_error = None

    for attempt in range(1, max_attempts + 1):
        try:
            Base.metadata.create_all(bind=engine)
            _ensure_additive_columns()
            _backfill_room_household_ids()
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
