import sys
import os
os.environ["DATABASE_URL"] = "mysql+pymysql://root:root_password@100.82.44.52:3306/e_connect_db"

from app.database import SessionLocal
from app.sql_models import User
from app.auth import get_password_hash
import sys

db = SessionLocal()
user = db.query(User).filter(User.username == "ryzen30xx").first()
if not user:
    print("User not found!")
    sys.exit(1)

new_hash = get_password_hash("admin123")
user.authentication = new_hash
db.commit()
print("Password updated successfully.")
