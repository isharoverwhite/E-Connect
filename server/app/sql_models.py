from sqlalchemy import Column, Integer, String, Boolean, JSON, DateTime
from sqlalchemy.sql import func
from .database import Base

class Device(Base):
    __tablename__ = "devices"

    uuid = Column(String(100), primary_key=True, index=True)
    name = Column(String(255))
    board = Column(String(100))
    mode = Column(String(50), default="no-code")
    is_authorized = Column(Boolean, default=False)
    version = Column(String(50))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Storing complex nested structures as JSON for flexibility
    connectivity = Column(JSON)
    hardware_config = Column(JSON)
