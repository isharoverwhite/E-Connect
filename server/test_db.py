from app.database import SessionLocal
from app.sql_models import HouseholdMembership

db = SessionLocal()
mem = db.query(HouseholdMembership).filter(HouseholdMembership.user_id == 1).first()
print("Membership:", mem)
if mem:
    print("Household ID:", mem.household_id)
else:
    print("None found!")
