from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class PinRule:
    capabilities: frozenset[str]
    reserved: bool = False
    boot_sensitive: bool = False


@dataclass(frozen=True)
class BoardDefinition:
    canonical_id: str
    platformio_board: str
    platform: str
    pins: dict[int, PinRule]


def _pin_rule(
    capabilities: list[str],
    *,
    reserved: bool = False,
    boot_sensitive: bool = False,
) -> PinRule:
    return PinRule(
        capabilities=frozenset(capabilities),
        reserved=reserved,
        boot_sensitive=boot_sensitive,
    )


IO = ["INPUT", "OUTPUT", "PWM"]
IO_ADC = ["INPUT", "OUTPUT", "PWM", "ADC"]
INPUT_ADC = ["INPUT", "ADC"]
ADC_ONLY = ["ADC"]
I2C_IO = ["INPUT", "OUTPUT", "I2C"]


def _esp8266_shared_pins(*, include_adc: bool) -> dict[int, PinRule]:
    pins = {
        0: _pin_rule(IO, boot_sensitive=True),
        1: _pin_rule(IO, reserved=True),
        2: _pin_rule(IO, boot_sensitive=True),
        3: _pin_rule(IO, reserved=True),
        4: _pin_rule(I2C_IO),
        5: _pin_rule(I2C_IO),
        12: _pin_rule(IO),
        13: _pin_rule(IO),
        14: _pin_rule(IO),
        15: _pin_rule(IO, boot_sensitive=True),
        16: _pin_rule(IO),
    }
    if include_adc:
        pins[17] = _pin_rule(ADC_ONLY)
    return pins


BOARD_DEFINITIONS: dict[str, BoardDefinition] = {
    "esp32": BoardDefinition(
        canonical_id="esp32",
        platformio_board="esp32dev",
        platform="espressif32",
        pins={
            0: _pin_rule(IO_ADC, reserved=True, boot_sensitive=True),
            2: _pin_rule(IO_ADC, boot_sensitive=True),
            4: _pin_rule(IO_ADC, boot_sensitive=True),
            5: _pin_rule(IO, boot_sensitive=True),
            12: _pin_rule(IO, boot_sensitive=True),
            13: _pin_rule(IO),
            14: _pin_rule(IO, boot_sensitive=True),
            15: _pin_rule(IO, boot_sensitive=True),
            16: _pin_rule(IO),
            17: _pin_rule(IO),
            18: _pin_rule(IO),
            19: _pin_rule(IO),
            21: _pin_rule(I2C_IO),
            22: _pin_rule(I2C_IO),
            23: _pin_rule(IO),
            25: _pin_rule(IO_ADC),
            26: _pin_rule(IO_ADC),
            27: _pin_rule(IO_ADC),
            32: _pin_rule(IO_ADC),
            33: _pin_rule(IO_ADC),
            34: _pin_rule(INPUT_ADC),
            35: _pin_rule(INPUT_ADC),
            36: _pin_rule(INPUT_ADC),
            39: _pin_rule(INPUT_ADC),
        },
    ),
    "esp32-c3": BoardDefinition(
        canonical_id="esp32-c3",
        platformio_board="esp32-c3-devkitm-1",
        platform="espressif32",
        pins={
            0: _pin_rule(IO_ADC, boot_sensitive=True),
            1: _pin_rule(IO_ADC),
            2: _pin_rule(IO_ADC),
            3: _pin_rule(IO_ADC),
            4: _pin_rule(IO_ADC),
            5: _pin_rule(IO_ADC),
            6: _pin_rule(I2C_IO),
            7: _pin_rule(I2C_IO),
            8: _pin_rule(IO, boot_sensitive=True),
            9: _pin_rule(IO, reserved=True, boot_sensitive=True),
            10: _pin_rule(IO, reserved=True),
            18: _pin_rule(IO),
            19: _pin_rule(IO),
            20: _pin_rule(IO, reserved=True),
            21: _pin_rule(IO, reserved=True),
        },
    ),
    "esp32-s2": BoardDefinition(
        canonical_id="esp32-s2",
        platformio_board="esp32-s2-saola-1",
        platform="espressif32",
        pins={
            1: _pin_rule(IO),
            2: _pin_rule(IO_ADC),
            3: _pin_rule(IO_ADC),
            4: _pin_rule(IO_ADC),
            5: _pin_rule(IO_ADC),
            6: _pin_rule(IO_ADC),
            7: _pin_rule(IO_ADC),
            8: _pin_rule(IO_ADC),
            9: _pin_rule(IO_ADC),
            10: _pin_rule(IO_ADC),
            11: _pin_rule(IO_ADC),
            12: _pin_rule(IO_ADC),
            13: _pin_rule(IO_ADC),
            14: _pin_rule(IO_ADC),
            15: _pin_rule(IO_ADC),
            16: _pin_rule(I2C_IO),
            17: _pin_rule(I2C_IO),
            18: _pin_rule(IO, reserved=True),
            19: _pin_rule(IO, reserved=True),
        },
    ),
    "esp32-s3": BoardDefinition(
        canonical_id="esp32-s3",
        platformio_board="esp32-s3-devkitc-1",
        platform="espressif32",
        pins={
            3: _pin_rule(IO),
            4: _pin_rule(IO),
            5: _pin_rule(IO),
            6: _pin_rule(IO),
            7: _pin_rule(IO),
            8: _pin_rule(IO),
            9: _pin_rule(IO),
            10: _pin_rule(IO),
            11: _pin_rule(IO),
            12: _pin_rule(IO),
            13: _pin_rule(IO),
            14: _pin_rule(IO),
            15: _pin_rule(IO),
            16: _pin_rule(IO),
            17: _pin_rule(IO),
            18: _pin_rule(IO, reserved=True),
            21: _pin_rule(IO_ADC),
            46: _pin_rule(["INPUT"], reserved=True),
            47: _pin_rule(IO),
            48: _pin_rule(IO),
        },
    ),
    "esp32-c2": BoardDefinition(
        canonical_id="esp32-c2",
        platformio_board="esp32-c2-devkitm-1",
        platform="espressif32",
        pins={
            0: _pin_rule(IO_ADC, reserved=True, boot_sensitive=True),
            1: _pin_rule(IO),
            2: _pin_rule(IO),
            3: _pin_rule(IO_ADC),
            4: _pin_rule(I2C_IO),
            5: _pin_rule(I2C_IO),
            6: _pin_rule(IO),
            7: _pin_rule(IO),
            8: _pin_rule(IO),
            10: _pin_rule(IO_ADC),
        },
    ),
    "nodemcuv2": BoardDefinition(
        canonical_id="nodemcuv2",
        platformio_board="nodemcuv2",
        platform="espressif8266",
        pins=_esp8266_shared_pins(include_adc=True),
    ),
    "d1_mini": BoardDefinition(
        canonical_id="d1_mini",
        platformio_board="d1_mini",
        platform="espressif8266",
        pins=_esp8266_shared_pins(include_adc=True),
    ),
    "d1_mini_pro": BoardDefinition(
        canonical_id="d1_mini_pro",
        platformio_board="d1_mini_pro",
        platform="espressif8266",
        pins=_esp8266_shared_pins(include_adc=True),
    ),
    "esp01_1m": BoardDefinition(
        canonical_id="esp01_1m",
        platformio_board="esp01_1m",
        platform="espressif8266",
        pins={
            0: _pin_rule(IO, boot_sensitive=True),
            1: _pin_rule(IO, reserved=True),
            2: _pin_rule(IO, boot_sensitive=True),
            3: _pin_rule(IO, reserved=True),
        },
    ),
    "esp12e": BoardDefinition(
        canonical_id="esp12e",
        platformio_board="esp12e",
        platform="espressif8266",
        pins=_esp8266_shared_pins(include_adc=True),
    ),
}


BOARD_ALIASES = {
    "esp32": "esp32",
    "esp32-devkit-v1": "esp32",
    "esp32-wrover-kit": "esp32",
    "esp32-cam": "esp32",
    "esp32-c3": "esp32-c3",
    "esp32-c3-devkitm-1": "esp32-c3",
    "esp32-c3-super-mini": "esp32-c3",
    "dfrobot-beetle-esp32-c3": "esp32-c3",
    "esp32-s2": "esp32-s2",
    "esp32-s2-saola-1": "esp32-s2",
    "esp32-s3": "esp32-s3",
    "esp32-s3-devkitc-1": "esp32-s3",
    "esp32-s3-zero": "esp32-s3",
    "esp32-c2": "esp32-c2",
    "esp32-c2-devkitm-1": "esp32-c2",
    "esp8266": "nodemcuv2",
    "esp8266-nodemcu": "nodemcuv2",
    "nodemcu": "nodemcuv2",
    "nodemcu-v2": "nodemcuv2",
    "nodemcu-v3": "nodemcuv2",
    "nodemcuv2": "nodemcuv2",
    "node-mcu-v2-v3": "nodemcuv2",
    "d1-mini": "d1_mini",
    "wemos-d1-mini": "d1_mini",
    "d1_mini": "d1_mini",
    "d1-mini-pro": "d1_mini_pro",
    "wemos-d1-mini-pro": "d1_mini_pro",
    "d1_mini_pro": "d1_mini_pro",
    "esp-01": "esp01_1m",
    "esp-01s": "esp01_1m",
    "esp01": "esp01_1m",
    "esp01-1m": "esp01_1m",
    "esp01_1m": "esp01_1m",
    "esp-12e": "esp12e",
    "esp-12f": "esp12e",
    "esp12e": "esp12e",
    "esp12f": "esp12e",
}


def _normalize_board_key(value: str) -> str:
    return value.strip().lower().replace("_", "-")


def resolve_board_definition(board_profile: str) -> BoardDefinition:
    normalized = _normalize_board_key(board_profile)

    if normalized in BOARD_ALIASES:
        return BOARD_DEFINITIONS[BOARD_ALIASES[normalized]]

    if "d1-mini-pro" in normalized:
        return BOARD_DEFINITIONS["d1_mini_pro"]
    if "d1-mini" in normalized:
        return BOARD_DEFINITIONS["d1_mini"]
    if "esp-01" in normalized:
        return BOARD_DEFINITIONS["esp01_1m"]
    if "esp-12" in normalized:
        return BOARD_DEFINITIONS["esp12e"]
    if "esp8266" in normalized or "nodemcu" in normalized:
        return BOARD_DEFINITIONS["nodemcuv2"]
    if "c3" in normalized:
        return BOARD_DEFINITIONS["esp32-c3"]
    if "s3" in normalized:
        return BOARD_DEFINITIONS["esp32-s3"]
    if "s2" in normalized:
        return BOARD_DEFINITIONS["esp32-s2"]
    if "c2" in normalized:
        return BOARD_DEFINITIONS["esp32-c2"]
    if "esp32" in normalized:
        return BOARD_DEFINITIONS["esp32"]

    raise ValueError(f"Unsupported board profile: {board_profile}")


def validate_diy_config(board_profile: str, config: dict[str, Any] | None) -> tuple[BoardDefinition, list[str], list[str]]:
    board = resolve_board_definition(board_profile)

    if not config or not isinstance(config, dict):
        return board, ["Invalid config: missing project configuration"], []

    pins = config.get("pins")
    if not isinstance(pins, list) or not pins:
        return board, ["Invalid config: missing pins"], []

    errors: list[str] = []
    warnings: list[str] = []
    used_pins: set[int] = set()
    i2c_role_counts = {"SDA": 0, "SCL": 0}

    wifi_ssid = config.get("wifi_ssid")
    wifi_password = config.get("wifi_password")
    if not isinstance(wifi_ssid, str) or not wifi_ssid.strip():
        errors.append("Invalid config: wifi_ssid is required before building firmware")
    if not isinstance(wifi_password, str) or not wifi_password.strip():
        errors.append("Invalid config: wifi_password is required before building firmware")

    for index, pin in enumerate(pins, start=1):
        if not isinstance(pin, dict):
            errors.append(f"Invalid config: pin entry #{index} must be an object")
            continue

        raw_gpio = pin.get("gpio", pin.get("gpio_pin"))
        raw_mode = pin.get("mode")

        if not isinstance(raw_gpio, int):
            errors.append(f"Invalid config: pin entry #{index} is missing a numeric gpio")
            continue

        if not isinstance(raw_mode, str):
            errors.append(f"Invalid config: GPIO {raw_gpio} is missing a mode")
            continue

        mode = raw_mode.upper()
        if raw_gpio in used_pins:
            errors.append(f"Invalid config: GPIO {raw_gpio} is assigned more than once")
            continue
        used_pins.add(raw_gpio)

        rule = board.pins.get(raw_gpio)
        if rule is None:
            errors.append(f"Invalid config: GPIO {raw_gpio} is not supported for {board.canonical_id}")
            continue

        if rule.reserved:
            errors.append(f"Invalid config: GPIO {raw_gpio} is reserved for {board.canonical_id}")
            continue

        if mode not in rule.capabilities:
            errors.append(
                f"Invalid config: GPIO {raw_gpio} does not support mode {mode} on {board.canonical_id}"
            )
            continue

        if rule.boot_sensitive:
            warnings.append(f"Warning: GPIO {raw_gpio} is boot-sensitive on {board.canonical_id}")

        raw_extra_params = pin.get("extra_params")
        if raw_extra_params is not None and not isinstance(raw_extra_params, dict):
            errors.append(f"Invalid config: GPIO {raw_gpio} extra_params must be an object")
            continue

        extra_params = raw_extra_params or {}

        if mode == "OUTPUT" and isinstance(raw_extra_params, dict):
            active_level = extra_params.get("active_level")
            if active_level is not None and active_level not in (0, 1):
                errors.append(f"Invalid config: GPIO {raw_gpio} active_level must be 0 or 1")
                continue

        if mode == "PWM":
            min_val = extra_params.get("min_value")
            max_val = extra_params.get("max_value")
            
            # Default to 0 and 255 if not provided, for validation purposes
            if min_val is None:
                min_val = 0
            if max_val is None:
                max_val = 255
                
            if not isinstance(min_val, int) or not (0 <= min_val <= 255):
                errors.append(f"Invalid config: GPIO {raw_gpio} PWM min_value must be 0-255, got {min_val}")
            
            if not isinstance(max_val, int) or not (0 <= max_val <= 255):
                errors.append(f"Invalid config: GPIO {raw_gpio} PWM max_value must be 0-255, got {max_val}")
                
            if isinstance(min_val, int) and isinstance(max_val, int) and min_val >= max_val:
                errors.append(f"Invalid config: GPIO {raw_gpio} PWM min_value ({min_val}) must be less than max_value ({max_val})")

        if mode == "I2C":
            role = extra_params.get("i2c_role")
            if role == "SDA":
                i2c_role_counts["SDA"] += 1
            elif role == "SCL":
                i2c_role_counts["SCL"] += 1
            else:
                errors.append(f"Invalid config: GPIO {raw_gpio} I2C role must be SDA or SCL")
            
            address = extra_params.get("i2c_address")
            if address:
                try:
                    int(address, 16)
                except (ValueError, TypeError):
                    errors.append(f"Invalid config: GPIO {raw_gpio} I2C address must be a valid hex string (e.g. 0x3C)")

    if any(count > 0 for count in i2c_role_counts.values()):
        if i2c_role_counts["SDA"] != 1 or i2c_role_counts["SCL"] != 1:
            errors.append("Invalid config: I2C mode requires exactly one SDA pin and one SCL pin")

    return board, errors, warnings
