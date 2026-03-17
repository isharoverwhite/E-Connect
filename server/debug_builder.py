from app.services.builder import write_generated_firmware_config
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
        {"gpio": 2, "mode": "PWM", "label": "PWM Dimmer", "extra_params": {"min_value": 20, "max_value": 1000}},
        {"gpio": 4, "mode": "I2C", "label": "I2C Sensor", "extra_params": {"i2c_role": "SDA", "i2c_address": "0x3C", "i2c_library": "Wire"}}
    ]
}
project = MockProject(id="test-proj-123", name="Test Project", config=mock_config, board_profile="esp32")
import tempfile, os
with tempfile.TemporaryDirectory() as d:
    write_generated_firmware_config(project, "job-456", d)
    with open(os.path.join(d, "include", "generated_firmware_config.h"), "r") as f:
        print(f.read())
