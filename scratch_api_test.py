import os
import sys

server_dir = os.path.join(os.path.dirname(__file__), "server")
sys.path.append(server_dir)

from app.auth import create_access_token
from app.database import SessionLocal
from app.sql_models import User
import requests

db = SessionLocal()
user = db.query(User).filter_by(username="ryzen30xx").first()
token = create_access_token(data={"sub": user.username})

headers = {"Authorization": f"Bearer {token}"}
r2 = requests.get("http://127.0.0.1:8000/api/v1/weather/current", headers=headers)
print("Weather:", r2.status_code, r2.text)

r3 = requests.get("http://127.0.0.1:8000/api/v1/house-temperature/current", headers=headers)
print("House temp:", r3.status_code, r3.text)

