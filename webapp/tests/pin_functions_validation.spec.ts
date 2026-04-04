import { test, expect } from '@playwright/test';
import { isNumericPin, isSwitchPin } from '../src/lib/automation-utils';

test.describe('Pin Function Logic Validation', () => {
  test('isNumericPin correctly validates triggers based on mode and function keywords', () => {
    // By predefined modes
    expect(isNumericPin({ mode: 'ADC' })).toBe(true);
    expect(isNumericPin({ mode: 'PWM' })).toBe(true);
    expect(isNumericPin({ mode: 'DHT22' })).toBe(true);
    expect(isNumericPin({ mode: 'I2C' })).toBe(false);

    // By function strings matching NUMERIC_TRIGGER_FUNCTION_KEYWORDS equivalent
    expect(isNumericPin({ mode: 'I2C', function: 'temperature_sensor' })).toBe(true);
    expect(isNumericPin({ mode: 'I2C', function: 'Analog probe' })).toBe(true);
    expect(isNumericPin({ mode: 'UART', function: 'moisture' })).toBe(true);

    // Should not match
    expect(isNumericPin({ mode: 'I2C', function: 'led_display' })).toBe(false);
    expect(isNumericPin({ mode: 'UART', function: null })).toBe(false);
    expect(isNumericPin(undefined)).toBe(false);
  });

  test('isSwitchPin correctly validates triggers based on mode and function keywords', () => {
    // By predefined modes
    expect(isSwitchPin({ mode: 'INPUT' })).toBe(true);
    expect(isSwitchPin({ mode: 'OUTPUT' })).toBe(true);
    expect(isSwitchPin({ mode: 'I2C' })).toBe(false);

    // By function strings matching BINARY_TRIGGER_FUNCTION_KEYWORDS equivalent
    expect(isSwitchPin({ mode: 'I2C', function: 'smart_relay' })).toBe(true);
    expect(isSwitchPin({ mode: 'I2C', function: 'motion_sensor' })).toBe(true);
    expect(isSwitchPin({ mode: 'UART', function: 'BUTTON' })).toBe(true);

    // Should not match
    expect(isSwitchPin({ mode: 'I2C', function: 'led_display' })).toBe(false);
    expect(isSwitchPin({ mode: 'UART', function: null })).toBe(false);
    expect(isSwitchPin(undefined)).toBe(false);
  });
});
