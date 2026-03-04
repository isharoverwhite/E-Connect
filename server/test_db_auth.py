import asyncio
from app.database import SessionLocal
from app.sql_models import User
from app.auth import verify_password
import sys

db = SessionLocal()
user = db.query(User).filter(User.username == "ryzen30xx").first()
if not user:
    print("User not found!")
    sys.exit(1)

print("DB hash:", repr(user.authentication))
isValid = verify_password("admin123", user.authentication)
print("Is valid:", isValid)
