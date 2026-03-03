from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from app.api import router as device_router
from app.database import engine, Base
from app.mqtt import mqtt_manager

# Create tables
Base.metadata.create_all(bind=engine)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    mqtt_manager.start()
    yield
    # Shutdown
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

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def read_root():
    return {"message": "Welcome to E-Connect Server"}

@app.get("/health")
def health_check():
    return {"status": "ok"}
