import uuid
from app.database import SessionLocal
from app.sql_models import Device, User
from app.models import AuthStatus

db = SessionLocal()
device = db.query(Device).filter(Device.device_id == 'd6eff742-db5a-4574-97cb-689e836ecca4').first()
admin = db.query(User).filter(User.user_id == 1).first()

if device and admin:
    device.auth_status = AuthStatus.approved
    
    layout = admin.ui_layout or []
    if isinstance(layout, dict) and "widgets" in layout:
        widgets = layout["widgets"]
    elif isinstance(layout, list):
        widgets = layout
    else:
        widgets = []
        
    for pin in device.pin_configurations:
        widget_type = "text"
        if pin.mode.value == "OUTPUT":
            widget_type = "switch"
        elif pin.mode.value == "INPUT":
            widget_type = "status"
            
        widgets.append({
            "i": str(uuid.uuid4()),
            "x": 0, "y": 0, "w": 2, "h": 2,
            "type": widget_type,
            "deviceId": device.device_id,
            "pin": pin.gpio_pin,
            "label": pin.label or f"{pin.function or 'Pin'} {pin.gpio_pin}"
        })
        
    admin.ui_layout = widgets
    db.commit()
    print("Device approved and widgets mapped!")
else:
    print("Device or Admin not found")
