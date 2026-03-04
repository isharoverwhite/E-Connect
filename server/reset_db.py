import os
import sys
from sqlalchemy import text

# Add the server directory to pythonpath so app can be imported
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.database import engine, Base
from app import sql_models

print("Disabling foreign key checks and dropping all tables...")
with engine.begin() as conn:
    conn.execute(text("SET FOREIGN_KEY_CHECKS = 0;"))
    Base.metadata.drop_all(bind=conn)
    conn.execute(text("SET FOREIGN_KEY_CHECKS = 1;"))
    
print("Creating all tables...")
Base.metadata.create_all(bind=engine)
print("Database reset complete.")
