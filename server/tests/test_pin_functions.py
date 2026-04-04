import pytest
from app.models import PinMode
from app.services.automation_runtime import (
    _pin_supports_numeric_trigger,
    _pin_supports_binary_trigger,
    _pin_matches_function_keywords,
    NUMERIC_TRIGGER_FUNCTION_KEYWORDS,
    BINARY_TRIGGER_FUNCTION_KEYWORDS
)

class DummyPinConfig:
    def __init__(self, mode, function=None):
        self.mode = mode
        self.function = function

def test_pin_matches_function_keywords():
    assert _pin_matches_function_keywords(DummyPinConfig(PinMode.I2C, function="temperature_sensor"), NUMERIC_TRIGGER_FUNCTION_KEYWORDS)
    assert _pin_matches_function_keywords(DummyPinConfig(PinMode.I2C, function="smart_switch"), BINARY_TRIGGER_FUNCTION_KEYWORDS)
    assert not _pin_matches_function_keywords(DummyPinConfig(PinMode.I2C, function="display"), NUMERIC_TRIGGER_FUNCTION_KEYWORDS)
    assert not _pin_matches_function_keywords(DummyPinConfig(PinMode.I2C, function=None), BINARY_TRIGGER_FUNCTION_KEYWORDS)
    # Check that it handles integer functions gracefully (if unexpected)
    assert not _pin_matches_function_keywords(DummyPinConfig(PinMode.I2C, function=123), NUMERIC_TRIGGER_FUNCTION_KEYWORDS)

def test_pin_supports_numeric_trigger():
    # Base modes that always support numeric
    assert _pin_supports_numeric_trigger(DummyPinConfig(mode=PinMode.ADC))
    assert _pin_supports_numeric_trigger(DummyPinConfig(mode=PinMode.PWM))
    assert _pin_supports_numeric_trigger(DummyPinConfig(mode=PinMode.INPUT))
    
    # Modes that rely on function matching
    assert _pin_supports_numeric_trigger(DummyPinConfig(mode=PinMode.I2C, function="analog_sensor"))
    assert _pin_supports_numeric_trigger(DummyPinConfig(mode=PinMode.I2C, function="temp_probe"))
    assert not _pin_supports_numeric_trigger(DummyPinConfig(mode=PinMode.I2C, function="led_display"))

def test_pin_supports_binary_trigger():
    # Base modes that always support binary
    assert _pin_supports_binary_trigger(DummyPinConfig(mode=PinMode.INPUT))
    assert _pin_supports_binary_trigger(DummyPinConfig(mode=PinMode.OUTPUT))
    
    # Modes that rely on function matching
    assert _pin_supports_binary_trigger(DummyPinConfig(mode=PinMode.I2C, function="smart_relay"))
    assert _pin_supports_binary_trigger(DummyPinConfig(mode=PinMode.I2C, function="motion_sensor"))
    assert not _pin_supports_binary_trigger(DummyPinConfig(mode=PinMode.I2C, function="led_display"))
