from app.database import SessionLocal
from app.sql_models import User, HouseholdMembership

db = SessionLocal()
print("Total Users:", db.query(User).count())
for u in db.query(User).all():
    print("User:", u.user_id, u.username)

print("Total Memberships:", db.query(HouseholdMembership).count())
for m in db.query(HouseholdMembership).all():
    print("Mem:", m.id, m.user_id, m.household_id, m.role)
