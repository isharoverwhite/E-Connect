from app.database import SessionLocal
from app.models import Device

db = SessionLocal()
devices = db.query(Device).all()
for d in devices:
    print(f"Device: {d.name}, ID: {d.device_id}, Status: {d.conn_status}, Auth: {d.auth_status}")
