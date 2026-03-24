from fastapi import FastAPI
from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import logging
from pathlib import Path
from app.api import router as device_router
from sqlalchemy.exc import OperationalError

from app.database import SessionLocal, check_database_connection, get_db, initialize_database
from app.mqtt import mqtt_manager
from app.services.user_management import ensure_temp_support_account

logger = logging.getLogger(__name__)
STATIC_DIR = Path(__file__).resolve().parent / "static"

def _using_overridden_database(app: FastAPI) -> bool:
    return get_db in app.dependency_overrides

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.database_ready = False
    app.state.database_error = None
    app.state.mqtt_started = False

    if _using_overridden_database(app):
        logger.info("Skipping startup database initialization because get_db is overridden")
        app.state.database_ready = True
        yield
        return

    database_ready, database_error = initialize_database()
    app.state.database_ready = database_ready
    app.state.database_error = database_error

    if database_ready:
        db = SessionLocal()
        try:
            ensure_temp_support_account(db)
        finally:
            db.close()

    mqtt_manager.start()
    app.state.mqtt_started = True

    try:
        yield
    finally:
        if app.state.mqtt_started:
            mqtt_manager.stop()

app = FastAPI(title="E-Connect Server", lifespan=lifespan)

# Allow CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(device_router, prefix="/api/v1")

# CI/test environments may not ship any static assets; serve 404s instead of failing import-time.
app.mount("/static", StaticFiles(directory=STATIC_DIR, check_dir=False), name="static")

@app.exception_handler(OperationalError)
async def database_error_handler(request: Request, exc: OperationalError):
    request.app.state.database_ready = False
    request.app.state.database_error = str(getattr(exc, "orig", exc))
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Database is unavailable",
            "status": "degraded",
        },
    )

@app.get("/")
def read_root():
    return {"message": "Welcome to E-Connect Server"}

@app.get("/health")
def health_check(request: Request):
    if _using_overridden_database(request.app):
        return {"status": "ok", "database": "overridden", "mqtt": "skipped"}

    database_ready, database_error = check_database_connection()
    request.app.state.database_ready = database_ready
    request.app.state.database_error = database_error

    if database_ready:
        return {
            "status": "ok",
            "database": "ok",
            "mqtt": "connected" if mqtt_manager.connected else "disconnected",
        }

    return JSONResponse(
        status_code=503,
        content={
            "status": "degraded",
            "database": "unavailable",
            "mqtt": "connected" if mqtt_manager.connected else "disconnected",
            "error": database_error,
        },
    )
