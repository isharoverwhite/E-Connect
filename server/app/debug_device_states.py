from pathlib import Path
import sys

SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.append(str(SERVER_ROOT))

from app.database import SessionLocal
from app.sql_models import Device


def main() -> None:
    db = SessionLocal()
    try:
        devices = db.query(Device).all()
        for device in devices:
            print(f"{device.device_id}: {device.name} -> {device.last_state}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
