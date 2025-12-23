from pydantic import BaseModel
from typing import List, Optional, Literal

class Connectivity(BaseModel):
    protocol: str = "mqtt"
    broker: str
    port: int = 1883
    secure: bool = False

class PinConfig(BaseModel):
    pin: int
    mode: Literal["OUTPUT", "INPUT", "PWM", "ANALOG"]
    type: Literal["DIGITAL", "ANALOG"]
    function: str  # e.g., "SWITCH", "SENSOR"
    label: str
    v_pin: Optional[int] = None
    init: Optional[str] = "LOW"

class HardwareConfig(BaseModel):
    pins: List[PinConfig] = []

class DeviceInfo(BaseModel):
    uuid: str
    name: str
    board: str
    mode: str = "no-code"
    is_authorized: bool = False
    version: str = "1.0.0"
    created_at: str

class DeviceConfig(BaseModel):
    device: DeviceInfo
    connectivity: Connectivity
    hardware_config: HardwareConfig
