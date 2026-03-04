from app.database import SessionLocal
from app.sql_models import User
from app.auth import get_password_hash

db = SessionLocal()
admin = db.query(User).filter(User.username == 'admin').first()
if admin:
    admin.authentication = get_password_hash("password123")
    db.commit()
    print("Password reset to password123")
else:
    print("Admin not found")
