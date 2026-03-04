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
        "connect_timeout": int(os.getenv("DATABASE_CONNECT_TIMEOUT", "5")),
        "read_timeout": int(os.getenv("DATABASE_READ_TIMEOUT", "5")),
        "write_timeout": int(os.getenv("DATABASE_WRITE_TIMEOUT", "5")),
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

def initialize_database(max_attempts: int = 3, retry_delay: float = 1.0):
    last_error = None

    for attempt in range(1, max_attempts + 1):
        try:
            Base.metadata.create_all(bind=engine)
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
