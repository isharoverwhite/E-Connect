import urllib.request
import json
import urllib.error
import sys
import os
from dotenv import load_dotenv

sys.path.append('server')
load_dotenv('server/.env')

from app.database import SessionLocal
from app.sql_models import User
from app.auth import create_access_token
import app.models as models

db = SessionLocal()
admin_user = db.query(User).filter(User.username == "admin").first()
if not admin_user:
    admin_user = db.query(User).first()

TOKEN = create_access_token(data={"sub": admin_user.username, "account_type": admin_user.account_type.value, "household_id": 1, "household_role": "owner"})
DEVICE_ID = "02e9f993-9457-42de-bf73-1a782c41c346"

def make_request(url, method="POST", data=None):
    headers = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
    try:
        if data:
            data = json.dumps(data).encode('utf-8')
        req = urllib.request.Request(url, headers=headers, method=method, data=data)
        with urllib.request.urlopen(req) as response:
            print(f"{method} {url} - Status: {response.status}")
            print(response.read().decode())
    except urllib.error.HTTPError as e:
        print(f"HTTPError: {e.code} - {e.read().decode()}")

print("Approving device...")
make_request(f"http://192.168.2.26:8000/api/v1/device/{DEVICE_ID}/approve", method="POST")

print("\nSending command to turn ON pin 8...")
cmd_payload = {"kind": "action", "pin": 8, "value": 1}
make_request(f"http://192.168.2.26:8000/api/v1/device/{DEVICE_ID}/command", method="POST", data=cmd_payload)
