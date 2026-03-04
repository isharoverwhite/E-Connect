import sys
sys.path.append('server')
import os
from dotenv import load_dotenv

load_dotenv('server/.env')

from app.database import SessionLocal
from app.sql_models import Device

db = SessionLocal()
devices = db.query(Device).all()

count = 0
for d in devices:
    if d.mode not in ['no-code', 'library']:
        print(f"Deleting invalid device {d.device_id}, mode was {d.mode}")
        db.delete(d)
        count += 1

db.commit()
print(f"Deleted {count} invalid devices")
