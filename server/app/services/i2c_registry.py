from typing import List, Optional, Dict, Any
from pydantic import BaseModel

class I2CLibrary(BaseModel):
    name: str
    display_name: str
    category: str # sensor, display, actuator, io-expander
    description: str
    default_address: Optional[str] = None
    pio_lib_deps: List[str] = []
    supported_channels: List[str] = ["SDA", "SCL"]
    is_writable: bool = False
    versions: Optional[List[str]] = None

I2C_CATALOG: List[I2CLibrary] = [
    I2CLibrary(
        name="adafruit/Adafruit BME280 Library",
        display_name="BME280 Temperature/Humidity/Pressure",
        category="sensor",
        description="Precision sensor for measuring temperature, humidity, and barometric pressure.",
        default_address="0x77",
        pio_lib_deps=["adafruit/Adafruit BME280 Library@^2.2.4", "adafruit/Adafruit Unified Sensor@^1.1.14"],
        is_writable=False
    ),
    I2CLibrary(
        name="adafruit/Adafruit AHTX0",
        display_name="AHT20/AHT10 Temperature & Humidity",
        category="sensor",
        description="Reliable and low-cost temperature and humidity sensor.",
        default_address="0x38",
        pio_lib_deps=["adafruit/Adafruit AHTX0@^2.0.5"],
        is_writable=False,
        versions=["AHT20", "AHT10", "AHTX0"]
    ),
    I2CLibrary(
        name="adafruit/Adafruit SSD1306",
        display_name="SSD1306 OLED Display (128x64/128x32)",
        category="display",
        description="Monochrome OLED graphic display based on SSD1306 driver.",
        default_address="0x3C",
        pio_lib_deps=["adafruit/Adafruit SSD1306@^2.5.9", "adafruit/Adafruit GFX Library@^1.11.9"],
        is_writable=True
    ),
    I2CLibrary(
        name="adafruit/Adafruit MCP23017 Arduino Library",
        display_name="MCP23017 I2C Port Expander",
        category="io-expander",
        description="16-bit I/O expander with serial interface.",
        default_address="0x20",
        pio_lib_deps=["adafruit/Adafruit MCP23017 Arduino Library@^2.3.2"],
        is_writable=True
    ),
    I2CLibrary(
        name="adafruit/Adafruit TSL2591 Library",
        display_name="TSL2591 High Dynamic Range Digital Light Sensor",
        category="sensor",
        description="Very high dynamic range light sensor, ideal for a wide range of light conditions.",
        default_address="0x29",
        pio_lib_deps=["adafruit/Adafruit TSL2591 Library@^1.4.5"],
        is_writable=False
    )
]

def get_i2c_catalog() -> List[I2CLibrary]:
    return I2C_CATALOG

def find_library_by_name(name: str) -> Optional[I2CLibrary]:
    for lib in I2C_CATALOG:
        if lib.name == name:
            return lib
    return None
