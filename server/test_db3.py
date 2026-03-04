from app.database import engine, Base
from app.sql_models import Device, PinConfiguration
Base.metadata.drop_all(bind=engine, tables=[PinConfiguration.__table__, Device.__table__])
Base.metadata.create_all(bind=engine, tables=[Device.__table__, PinConfiguration.__table__])
print("Recreated devices table")
