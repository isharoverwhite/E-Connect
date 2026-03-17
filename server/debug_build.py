import tempfile
from app.services.builder import copy_firmware_template, write_generated_firmware_config, generate_platformio_ini

class MockProject:
    def __init__(self, id, name, config, board_profile):
        self.id = id
        self.name = name
        self.config = config
        self.board_profile = board_profile

mock_config = {
    "wifi_ssid": "test_ssid",
    "wifi_password": "test_password",
    "pins": [
        {"gpio": 2, "mode": "PWM", "label": "PWM Dimmer", "extra_params": {"min_value": 20, "max_value": 200}},
        {"gpio": 4, "mode": "PWM", "label": "PWM Light", "extra_params": {"min_value": 0, "max_value": 255}},
        {"gpio": 21, "mode": "I2C", "label": "I2C Sensor", "extra_params": {"i2c_role": "SDA", "i2c_address": "0x3C", "i2c_library": "Wire"}},
        {"gpio": 22, "mode": "I2C", "label": "I2C Sensor", "extra_params": {"i2c_role": "SCL", "i2c_address": "0x3C", "i2c_library": "Wire"}}
    ]
}
project = MockProject(id="test-proj-123", name="Test Project", config=mock_config, board_profile="esp32-c3-devkitm-1")

d = tempfile.mkdtemp()
print(f"Working in {d}")
copy_firmware_template(d)
generate_platformio_ini(project, d)
write_generated_firmware_config(project, "job-123", d)
with open("latest_build_dir.txt", "w") as f:
    f.write(d)
