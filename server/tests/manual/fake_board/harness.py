#!/usr/bin/env python3
# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

"""Standalone fake board simulator for MQTT pairing and remote command testing.

The script exposes a small local dashboard so you can:
- connect a fake board to the MQTT broker used by the E-Connect server
- publish pairing/register payloads that match the current backend contract
- approve, reject, and unpair the board through the server REST API
- send remote commands from the server and inspect what the fake board receives
- publish state and OTA status events for happy-path and failure-path checks

Run:
    python3 server/tests/manual/fake_board/harness.py

Then open:
    http://127.0.0.1:8765
"""

from __future__ import annotations

import argparse
import html
import json
import os
import threading
import time
import uuid
from collections import deque
from copy import deepcopy
from dataclasses import asdict, dataclass, field
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib import error, parse, request

try:
    import paho.mqtt.client as mqtt
except ImportError as exc:  # pragma: no cover - import guard for manual usage
    raise SystemExit(
        "Missing dependency 'paho-mqtt'. Install server requirements first: "
        "pip install -r server/requirements.txt"
    ) from exc


DEFAULT_PINS = [
    {
        "gpio_pin": 2,
        "mode": "OUTPUT",
        "function": "relay",
        "label": "Test Relay",
        "extra_params": {"active_level": 1},
    }
]

DEFAULT_COMMAND = {
    "kind": "action",
    "pin": 2,
    "value": 1,
}

BOARD_PRESETS: dict[str, dict[str, Any]] = {
    "dht22-sensor": {
        "label": "DHT22 Sensor Board",
        "description": "Single INPUT pin that publishes DHT22 temperature and humidity telemetry.",
        "device_name": "Fake DHT22 Sensor Board",
        "pins": [
            {
                "gpio_pin": 4,
                "mode": "INPUT",
                "function": "climate",
                "label": "DHT22 Climate",
                "extra_params": {
                    "input_type": "dht",
                    "dht_version": "DHT22",
                },
            }
        ],
        "command": {
            "kind": "action",
            "pin": 4,
            "value": 1,
        },
    },
    "pwm-fan-tach": {
        "label": "PWM Fan + Tach Board",
        "description": "PWM fan output paired with an INPUT tachometer pin that reports RPM-like values.",
        "device_name": "Fake PWM Fan Tach Board",
        "pins": [
            {
                "gpio_pin": 3,
                "mode": "PWM",
                "function": "fan",
                "label": "PWM Fan",
                "extra_params": {
                    "min_value": 0,
                    "max_value": 255,
                    "input_type": "switch",
                    "switch_type": "momentary",
                },
            },
            {
                "gpio_pin": 0,
                "mode": "INPUT",
                "function": "tachometer",
                "label": "Fan Tachometer",
                "extra_params": {
                    "input_type": "tachometer",
                    "switch_type": "momentary",
                },
            },
        ],
        "command": {
            "kind": "action",
            "pin": 3,
            "brightness": 180,
        },
    },
    "switch-board": {
        "label": "Switch Board",
        "description": "Single OUTPUT relay/switch board for discovery, approve, and on-off command testing.",
        "device_name": "Fake Switch Board",
        "pins": deepcopy(DEFAULT_PINS),
        "command": deepcopy(DEFAULT_COMMAND),
    },
    "pwm-slicer": {
        "label": "PWM Slicer Board",
        "description": "Single PWM output board for slider-like dimmer or value-control test flows.",
        "device_name": "Fake PWM Slicer Board",
        "pins": [
            {
                "gpio_pin": 5,
                "mode": "PWM",
                "function": "dimmer",
                "label": "PWM Slicer",
                "extra_params": {
                    "min_value": 0,
                    "max_value": 255,
                },
            }
        ],
        "command": {
            "kind": "action",
            "pin": 5,
            "brightness": 128,
        },
    },
}

CUSTOM_BOARD_PRESET = "custom"


def utc_timestamp() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def generate_device_id() -> str:
    return f"fake-board-{uuid.uuid4().hex[:8]}"


def generate_mac_address() -> str:
    raw = uuid.uuid4().hex[:12].upper()
    octets = [raw[index : index + 2] for index in range(0, 12, 2)]
    first_octet = f"{int(octets[0], 16) | 0x02:02X}"
    return ":".join([first_octet, *octets[1:]])


def dump_json(value: Any) -> str:
    return json.dumps(value, indent=2, ensure_ascii=True, sort_keys=True)


def load_json_object(raw: str, *, field_name: str) -> dict[str, Any]:
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} must be a JSON object.")
    return value


def load_json_array(raw: str, *, field_name: str) -> list[dict[str, Any]]:
    value = json.loads(raw)
    if not isinstance(value, list):
        raise ValueError(f"{field_name} must be a JSON array.")
    rows = [row for row in value if isinstance(row, dict)]
    if len(rows) != len(value):
        raise ValueError(f"{field_name} must contain only JSON objects.")
    return rows


def coerce_int(value: Any, default: int) -> int:
    if isinstance(value, bool):
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def coerce_float(value: Any, default: float) -> float:
    if isinstance(value, bool):
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def list_board_presets() -> list[dict[str, str]]:
    presets = [
        {
            "id": CUSTOM_BOARD_PRESET,
            "label": "Custom JSON",
            "description": "Keep the current pins_json and command_json as-is.",
        }
    ]
    for preset_id, preset in BOARD_PRESETS.items():
        presets.append(
            {
                "id": preset_id,
                "label": str(preset["label"]),
                "description": str(preset["description"]),
            }
        )
    return presets


def apply_board_preset(settings: "Settings", preset_id: str) -> bool:
    preset = BOARD_PRESETS.get(preset_id)
    settings.board_preset = preset_id if preset else CUSTOM_BOARD_PRESET
    if not preset:
        return False

    settings.device_name = str(preset.get("device_name") or settings.device_name)
    settings.mode = str(preset.get("mode") or settings.mode or "no-code")
    settings.pins_json = dump_json(deepcopy(preset["pins"]))
    settings.command_json = dump_json(deepcopy(preset["command"]))
    return True


@dataclass
class Settings:
    server_base_url: str = field(default_factory=lambda: os.getenv("FAKE_BOARD_SERVER_URL", "http://127.0.0.1:8000"))
    mqtt_broker: str = field(default_factory=lambda: os.getenv("MQTT_BROKER", "127.0.0.1"))
    mqtt_port: int = field(default_factory=lambda: int(os.getenv("MQTT_PORT", "1883")))
    mqtt_namespace: str = field(default_factory=lambda: os.getenv("MQTT_NAMESPACE", "local"))
    dashboard_host: str = field(default_factory=lambda: os.getenv("FAKE_BOARD_DASHBOARD_HOST", "127.0.0.1"))
    dashboard_port: int = field(default_factory=lambda: int(os.getenv("FAKE_BOARD_DASHBOARD_PORT", "8765")))
    username: str = ""
    password: str = ""
    room_id: str = ""
    room_name: str = "Fake Board Lab"
    device_id: str = field(default_factory=generate_device_id)
    mac_address: str = field(default_factory=generate_mac_address)
    device_name: str = "Fake Board Test Node"
    mode: str = "no-code"
    firmware_version: str = "fake-board-test-1.0.0"
    project_id: str = ""
    secret_key: str = ""
    ip_address: str = "192.168.50.90"
    board_preset: str = CUSTOM_BOARD_PRESET
    pins_json: str = field(default_factory=lambda: dump_json(DEFAULT_PINS))
    command_json: str = field(default_factory=lambda: dump_json(DEFAULT_COMMAND))


class FakeBoardHarness:
    """Tracks fake board state and brokers the dashboard actions."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self._lock = threading.RLock()
        self._condition = threading.Condition(self._lock)
        self._mqtt_client: mqtt.Client | None = None
        self._mqtt_connected = False
        self._token = ""
        self._secure_pairing_verified = False
        self._command_enabled = False
        self._last_action = "Ready"
        self._last_http_result: dict[str, Any] = {}
        self._last_pairing_ack: dict[str, Any] = {}
        self._last_state_ack: dict[str, Any] = {}
        self._last_state_payload: dict[str, Any] = {}
        self._last_command_payload: dict[str, Any] = {}
        self._last_device_snapshot: dict[str, Any] = {}
        self._last_collection_label = ""
        self._last_collection: Any = []
        self._rooms: list[dict[str, Any]] = []
        self._logs: deque[str] = deque(maxlen=160)
        self._pairing_ack_counter = 0
        self._state_ack_counter = 0
        self._command_counter = 0
        self._runtime_pins: dict[int, dict[str, Any]] = {}
        self._rebuild_runtime_pins_locked()
        self.log("Harness initialized. Save settings or trigger an action to begin.")

    def log(self, message: str) -> None:
        line = f"[{utc_timestamp()}] {message}"
        with self._condition:
            self._logs.appendleft(line)
            self._condition.notify_all()
        print(line)

    def shutdown(self) -> None:
        self.disconnect_mqtt()
        self.log("Harness shutdown complete.")

    def update_settings(self, form: dict[str, list[str]]) -> None:
        with self._condition:
            old_identity = (
                self.settings.mqtt_broker,
                self.settings.mqtt_port,
                self.settings.mqtt_namespace,
                self.settings.device_id,
            )

            def first(key: str, default: str = "") -> str:
                return form.get(key, [default])[0].strip()

            self.settings.server_base_url = first("server_base_url", self.settings.server_base_url).rstrip("/")
            self.settings.mqtt_broker = first("mqtt_broker", self.settings.mqtt_broker)
            self.settings.mqtt_namespace = first("mqtt_namespace", self.settings.mqtt_namespace)
            self.settings.username = first("username", self.settings.username)
            self.settings.password = first("password", self.settings.password)
            self.settings.room_id = first("room_id", self.settings.room_id)
            self.settings.room_name = first("room_name", self.settings.room_name)
            self.settings.device_id = first("device_id", self.settings.device_id)
            self.settings.mac_address = first("mac_address", self.settings.mac_address)
            self.settings.device_name = first("device_name", self.settings.device_name)
            self.settings.mode = first("mode", self.settings.mode or "no-code") or "no-code"
            self.settings.firmware_version = first("firmware_version", self.settings.firmware_version)
            self.settings.project_id = first("project_id", self.settings.project_id)
            self.settings.secret_key = first("secret_key", self.settings.secret_key)
            self.settings.ip_address = first("ip_address", self.settings.ip_address)
            self.settings.board_preset = first("board_preset", self.settings.board_preset) or CUSTOM_BOARD_PRESET
            self.settings.pins_json = form.get("pins_json", [self.settings.pins_json])[0].strip() or self.settings.pins_json
            self.settings.command_json = form.get("command_json", [self.settings.command_json])[0].strip() or self.settings.command_json

            mqtt_port_raw = first("mqtt_port", str(self.settings.mqtt_port))
            try:
                self.settings.mqtt_port = int(mqtt_port_raw)
            except ValueError:
                self.log(f"Ignoring invalid MQTT port '{mqtt_port_raw}'.")

            try:
                parsed_pins = load_json_array(self.settings.pins_json, field_name="pins_json")
            except ValueError as exc:
                self.log(f"pins_json validation error: {exc}")
            else:
                self.settings.pins_json = dump_json(parsed_pins)
                self._rebuild_runtime_pins_locked(parsed_pins)

            try:
                parsed_command = load_json_object(self.settings.command_json, field_name="command_json")
            except ValueError as exc:
                self.log(f"command_json validation error: {exc}")
            else:
                self.settings.command_json = dump_json(parsed_command)

            new_identity = (
                self.settings.mqtt_broker,
                self.settings.mqtt_port,
                self.settings.mqtt_namespace,
                self.settings.device_id,
            )
            reconnect_needed = self._mqtt_connected and old_identity != new_identity

        if reconnect_needed:
            self.log("MQTT topic identity changed. Reconnecting to refresh subscriptions.")
            self.disconnect_mqtt()
            self.connect_mqtt()

    def _rebuild_runtime_pins_locked(self, parsed_pins: list[dict[str, Any]] | None = None) -> None:
        if parsed_pins is None:
            try:
                parsed_pins = load_json_array(self.settings.pins_json, field_name="pins_json")
            except ValueError:
                parsed_pins = DEFAULT_PINS
                self.settings.pins_json = dump_json(parsed_pins)

        runtime: dict[int, dict[str, Any]] = {}
        for pin in parsed_pins:
            gpio = int(pin.get("gpio_pin", -1))
            if gpio < 0:
                continue
            extra = pin.get("extra_params") if isinstance(pin.get("extra_params"), dict) else {}
            mode = str(pin.get("mode", "OUTPUT")).upper()
            input_type = str(extra.get("input_type") or "").strip().lower()
            pwm_min = coerce_int(extra.get("min_value"), 0)
            pwm_max = coerce_int(extra.get("max_value"), 255)
            runtime[gpio] = {
                "pin": gpio,
                "mode": mode,
                "function": str(pin.get("function", "")),
                "label": str(pin.get("label", f"Pin {gpio}")),
                "value": 0,
                "brightness": 0,
                "temperature": round(24.5 + (gpio % 4) * 0.8, 1),
                "humidity": round(52.0 + (gpio % 5) * 2.4, 1),
                "active_level": coerce_int(extra.get("active_level"), 1),
                "pwm_min": pwm_min,
                "pwm_max": pwm_max,
                "extra_params": deepcopy(extra),
                "input_type": input_type,
            }
            if mode == "PWM" and runtime[gpio]["pwm_min"] > runtime[gpio]["pwm_max"]:
                runtime[gpio]["brightness"] = runtime[gpio]["pwm_min"]
            if mode == "INPUT" and input_type == "switch":
                runtime[gpio]["value"] = 0
            if mode == "INPUT" and input_type == "tachometer":
                runtime[gpio]["value"] = 0
        self._runtime_pins = runtime

    def _mqtt_topic(self, *suffix: str, device_id: str | None = None) -> str:
        resolved_device_id = device_id or self.settings.device_id
        return "/".join(
            ["econnect", self.settings.mqtt_namespace, "device", resolved_device_id, *suffix]
        )

    def _first_pin(self) -> int:
        if not self._runtime_pins:
            return 2
        return next(iter(self._runtime_pins))

    def _first_command_pin_locked(self) -> int | None:
        for pin_state in self._runtime_pins.values():
            if str(pin_state.get("mode", "")).upper() in {"OUTPUT", "PWM"}:
                return int(pin_state["pin"])
        return None

    def _primary_pwm_pin_locked(self) -> dict[str, Any] | None:
        for pin_state in self._runtime_pins.values():
            if str(pin_state.get("mode", "")).upper() == "PWM":
                return pin_state
        return None

    def _tachometer_value_locked(self, pin_state: dict[str, Any]) -> int:
        primary_pwm = self._primary_pwm_pin_locked()
        if not primary_pwm:
            return coerce_int(pin_state.get("value"), 0)

        pwm_min = coerce_int(primary_pwm.get("pwm_min"), 0)
        pwm_max = coerce_int(primary_pwm.get("pwm_max"), 255)
        brightness = coerce_int(primary_pwm.get("brightness"), 0)
        pwm_off = pwm_min if pwm_min > pwm_max else 0
        if coerce_int(primary_pwm.get("value"), 0) == 0 or brightness == pwm_off:
            return 0

        span = max(1, abs(pwm_max - pwm_min))
        normalized = abs(brightness - pwm_off) / span
        return int(600 + normalized * 2100)

    def _build_state_row_locked(self, pin_state: dict[str, Any]) -> dict[str, Any]:
        row: dict[str, Any] = {
            "pin": int(pin_state["pin"]),
            "mode": str(pin_state["mode"]).upper(),
            "function": pin_state.get("function"),
            "label": pin_state.get("label"),
            "extra_params": deepcopy(pin_state.get("extra_params") or {}),
        }

        mode = row["mode"]
        input_type = str(pin_state.get("input_type") or "").lower()
        if mode == "PWM":
            row["value"] = coerce_int(pin_state.get("value"), 0)
            row["brightness"] = coerce_int(pin_state.get("brightness"), 0)
            row["restore_value"] = row["brightness"]
            row["datatype"] = "number"
            return row

        if mode == "OUTPUT":
            row["value"] = coerce_int(pin_state.get("value"), 0)
            row["datatype"] = "boolean"
            return row

        if input_type == "dht":
            row["temperature"] = round(coerce_float(pin_state.get("temperature"), 25.0), 1)
            row["humidity"] = round(coerce_float(pin_state.get("humidity"), 55.0), 1)
            row["value"] = row["temperature"]
            row["datatype"] = "number"
            return row

        if input_type == "tachometer":
            row["value"] = self._tachometer_value_locked(pin_state)
            row["unit"] = "RPM"
            row["datatype"] = "number"
            return row

        row["value"] = coerce_int(pin_state.get("value"), 0)
        row["datatype"] = "boolean" if input_type == "switch" or mode == "INPUT" else "number"
        return row

    def _create_mqtt_client(self) -> mqtt.Client:
        client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"fake-board-{self.settings.device_id}-{uuid.uuid4().hex[:6]}",
        )
        client.on_connect = self._on_mqtt_connect
        client.on_disconnect = self._on_mqtt_disconnect
        client.on_message = self._on_mqtt_message
        return client

    def _subscribe_board_topics(self, client: mqtt.Client) -> None:
        topics = [
            self._mqtt_topic("register", "ack"),
            self._mqtt_topic("state", "ack"),
            self._mqtt_topic("command"),
        ]
        for topic in topics:
            client.subscribe(topic, qos=1)
            self.log(f"Subscribed to {topic}")

    def _on_mqtt_connect(self, client, _userdata, _flags, reason_code, _properties=None) -> None:
        failure = getattr(reason_code, "is_failure", False)
        reason = int(reason_code) if hasattr(reason_code, "__int__") else reason_code
        with self._condition:
            self._mqtt_connected = not failure and reason == 0
            self._condition.notify_all()

        if self._mqtt_connected:
            self.log(
                f"MQTT connected to {self.settings.mqtt_broker}:{self.settings.mqtt_port} "
                f"in namespace '{self.settings.mqtt_namespace}'."
            )
            self._subscribe_board_topics(client)
            return

        self.log(f"MQTT connection failed with reason {reason!r}.")

    def _on_mqtt_disconnect(self, _client, _userdata, _disconnect_flags, reason_code, _properties=None) -> None:
        with self._condition:
            self._mqtt_connected = False
            self._condition.notify_all()

        reason = int(reason_code) if hasattr(reason_code, "__int__") else reason_code
        self.log(f"MQTT disconnected with reason {reason!r}.")

    def _on_mqtt_message(self, _client, _userdata, msg) -> None:
        payload_text = msg.payload.decode("utf-8", errors="replace")
        try:
            payload = json.loads(payload_text)
        except json.JSONDecodeError:
            payload = {"raw": payload_text}

        topic = msg.topic
        self.log(f"MQTT << {topic} {payload_text}")

        if topic.endswith("/register/ack"):
            self._handle_registration_ack(payload)
            return
        if topic.endswith("/state/ack"):
            self._handle_state_ack(payload)
            return
        if topic.endswith("/command"):
            self._handle_command(payload)

    def _handle_registration_ack(self, payload: dict[str, Any]) -> None:
        with self._condition:
            self._pairing_ack_counter += 1
            self._last_pairing_ack = payload
            self._secure_pairing_verified = bool(
                payload.get("status") == "ok" and payload.get("secret_verified")
            )
            self._command_enabled = payload.get("status") == "ok"

            assigned_device_id = payload.get("device_id")
            if isinstance(assigned_device_id, str) and assigned_device_id and assigned_device_id != self.settings.device_id:
                old_device_id = self.settings.device_id
                self.settings.device_id = assigned_device_id
                self.log(f"Server reassigned device id from {old_device_id} to {assigned_device_id}.")
                if self._mqtt_client and self._mqtt_connected:
                    self._subscribe_board_topics(self._mqtt_client)

            self._condition.notify_all()

        self.log(
            "Pairing ack status="
            f"{payload.get('status')} auth_status={payload.get('auth_status')} "
            f"secret_verified={payload.get('secret_verified')}"
        )

    def _handle_state_ack(self, payload: dict[str, Any]) -> None:
        with self._condition:
            self._state_ack_counter += 1
            self._last_state_ack = payload
            if payload.get("status") == "re_pair_required":
                self._secure_pairing_verified = False
                self._command_enabled = False
            self._condition.notify_all()
        self.log(f"State ack received: {payload.get('status', 'unknown')}")

    def _handle_command(self, payload: dict[str, Any]) -> None:
        with self._condition:
            self._command_counter += 1
            self._last_command_payload = payload
            self._condition.notify_all()

        if not self._command_enabled:
            self.log("Ignoring remote command because the board has not completed registration yet.")
            return

        kind = payload.get("kind")
        if kind == "system" and payload.get("action") == "ota":
            self.log("Simulating OTA status callback for the received system command.")
            self.publish_state_payload(
                {
                    "event": "ota_status",
                    "job_id": payload.get("job_id"),
                    "status": payload.get("simulate_status", "success"),
                    "message": payload.get("simulate_message", "Fake board completed OTA test flow."),
                }
            )
            return

        applied = False
        with self._condition:
            default_pin = self._first_command_pin_locked()
            pin = int(payload.get("pin", default_pin if default_pin is not None else self._first_pin()))
            pin_state = self._runtime_pins.get(pin)
            if pin_state:
                mode = str(pin_state["mode"]).upper()
                value = payload.get("value")
                brightness = payload.get("brightness")
                if mode == "OUTPUT" and value is not None:
                    pin_state["value"] = 0 if int(value) == 0 else 1
                    pin_state["brightness"] = 255 if pin_state["value"] else 0
                    applied = True
                elif mode == "PWM":
                    pwm_min = int(pin_state.get("pwm_min", 0))
                    pwm_max = int(pin_state.get("pwm_max", 255))
                    pwm_off = pwm_min if pwm_min > pwm_max else 0
                    pwm_lower = min(pwm_min, pwm_max)
                    pwm_upper = max(pwm_min, pwm_max)
                    if brightness is not None:
                        next_brightness = max(pwm_lower, min(pwm_upper, int(brightness)))
                        pin_state["brightness"] = next_brightness
                        pin_state["value"] = 0 if next_brightness == pwm_off else 1
                        applied = True
                    elif value is not None:
                        pin_state["value"] = 0 if int(value) == 0 else 1
                        pin_state["brightness"] = pwm_off if pin_state["value"] == 0 else pwm_max
                        applied = True
                elif value is not None:
                    pin_state["value"] = int(value)
                    applied = True

        self.publish_state(applied=applied)

    def _wait_for(self, predicate, timeout: float = 2.0) -> bool:
        deadline = time.monotonic() + timeout
        with self._condition:
            while time.monotonic() < deadline:
                if predicate():
                    return True
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                self._condition.wait(timeout=min(0.2, remaining))
        return predicate()

    def connect_mqtt(self) -> None:
        with self._condition:
            if self._mqtt_connected:
                self._last_action = "MQTT already connected"
                self.log(self._last_action)
                return

        client = self._create_mqtt_client()
        try:
            client.connect(self.settings.mqtt_broker, self.settings.mqtt_port, keepalive=60)
            client.loop_start()
        except Exception as exc:
            self._last_action = f"MQTT connect failed: {exc}"
            self.log(self._last_action)
            return

        with self._condition:
            self._mqtt_client = client

        if self._wait_for(lambda: self._mqtt_connected, timeout=3.0):
            self._last_action = "MQTT connected"
        else:
            self._last_action = "MQTT connect timed out"
            self.log(self._last_action)

    def disconnect_mqtt(self) -> None:
        client = None
        with self._condition:
            client = self._mqtt_client
            self._mqtt_client = None

        if client:
            try:
                client.loop_stop()
                client.disconnect()
            except Exception as exc:
                self.log(f"MQTT disconnect raised: {exc}")

        with self._condition:
            self._mqtt_connected = False
            self._condition.notify_all()
        self._last_action = "MQTT disconnected"

    def _publish_raw(self, topic: str, payload_text: str) -> bool:
        with self._condition:
            client = self._mqtt_client
            connected = self._mqtt_connected
        if not client or not connected:
            self.log("Cannot publish over MQTT because the client is not connected.")
            return False

        info = client.publish(topic, payload_text, qos=1)
        try:
            info.wait_for_publish(timeout=2.0)
        except TypeError:
            info.wait_for_publish()

        published = bool(info.is_published()) or info.rc == mqtt.MQTT_ERR_SUCCESS
        if published:
            self.log(f"MQTT >> {topic} {payload_text}")
        else:
            self.log(f"Publish failed for topic {topic}")
        return published

    def publish_state(self, *, applied: bool) -> None:
        pins = []
        with self._condition:
            for pin in self._runtime_pins.values():
                pins.append(self._build_state_row_locked(pin))

        payload: dict[str, Any] = {
            "kind": "state",
            "device_id": self.settings.device_id,
            "applied": applied,
            "firmware_version": self.settings.firmware_version,
            "ip_address": self.settings.ip_address,
            "pins": pins,
        }

        if len(pins) == 1:
            for field in ("pin", "value", "brightness", "temperature", "humidity", "restore_value", "unit", "datatype"):
                if field in pins[0]:
                    payload[field] = pins[0][field]

        self.publish_state_payload(payload)

    def publish_state_payload(self, payload: dict[str, Any]) -> None:
        if self._publish_raw(self._mqtt_topic("state"), json.dumps(payload)):
            with self._condition:
                self._last_state_payload = payload
            self._last_action = "State payload published"

    def _build_registration_payload(
        self,
        *,
        force_pairing: bool = False,
        invalid_secret: bool = False,
    ) -> dict[str, Any]:
        pins = load_json_array(self.settings.pins_json, field_name="pins_json")
        payload: dict[str, Any] = {
            "device_id": self.settings.device_id,
            "force_pairing_request": force_pairing,
            "mac_address": self.settings.mac_address,
            "ip_address": self.settings.ip_address,
            "name": self.settings.device_name,
            "mode": self.settings.mode,
            "firmware_version": self.settings.firmware_version,
            "pins": pins,
        }

        if self.settings.project_id:
            payload["project_id"] = self.settings.project_id
        if self.settings.secret_key or invalid_secret:
            payload["secret_key"] = (
                f"{self.settings.secret_key}-invalid"
                if invalid_secret and self.settings.secret_key
                else self.settings.secret_key or "invalid-secret"
            )

        return payload

    def register_board(self, *, force_pairing: bool = False, invalid_secret: bool = False, malformed: bool = False) -> None:
        with self._condition:
            ack_counter = self._pairing_ack_counter

        if malformed:
            payload_text = '{"broken": true'
            if self._publish_raw(self._mqtt_topic("register"), payload_text):
                self._last_action = "Malformed register payload published"
            return

        try:
            payload = self._build_registration_payload(
                force_pairing=force_pairing,
                invalid_secret=invalid_secret,
            )
        except ValueError as exc:
            self._last_action = f"Cannot register board: {exc}"
            self.log(self._last_action)
            return

        if not self._publish_raw(self._mqtt_topic("register"), json.dumps(payload)):
            self._last_action = "Register publish failed"
            return

        if self._wait_for(lambda: self._pairing_ack_counter > ack_counter, timeout=3.0):
            self._last_action = "Register flow completed with pairing ack"
        else:
            self._last_action = "Register publish succeeded but pairing ack timed out"
            self.log(self._last_action)

        if self._token:
            self.fetch_device_snapshot()

    def register_board_http(self, *, force_pairing: bool = False, invalid_secret: bool = False) -> None:
        try:
            payload = self._build_registration_payload(
                force_pairing=force_pairing,
                invalid_secret=invalid_secret,
            )
        except ValueError as exc:
            self._last_action = f"Cannot register board over HTTP: {exc}"
            self.log(self._last_action)
            return

        response = self._request_json(
            "POST",
            "/api/v1/config",
            payload=payload,
        )
        if response["ok"]:
            data = response["data"] if isinstance(response["data"], dict) else {}
            with self._condition:
                self._last_pairing_ack = data
                self._last_http_result = response
                self._secure_pairing_verified = bool(data.get("secret_verified"))
                self._command_enabled = bool(data.get("auth_status") == "approved" or data.get("secret_verified"))
            self._last_action = "HTTP register succeeded"
            self.log(
                "HTTP register succeeded. Device should be visible on "
                "/devices/discovery when auth_status is pending."
            )
            if self._token:
                if data.get("auth_status") == "pending":
                    self.list_pending_devices()
                else:
                    self.fetch_device_snapshot()
            if data.get("auth_status") == "approved":
                self.log(
                    "This device id is already approved on the server. Use HTTP Force Re-pair "
                    "or Generate Fresh Identity if you want it to appear in discovery."
                )
            return

        self._store_http_result(response, "HTTP register failed")

    def login(self) -> None:
        if not self.settings.username or not self.settings.password:
            self._last_action = "Login requires username and password."
            self.log(self._last_action)
            return

        response = self._request_form(
            "POST",
            "/api/v1/auth/token",
            {
                "username": self.settings.username,
                "password": self.settings.password,
            },
        )
        if response["ok"]:
            token = response["data"].get("access_token", "")
            with self._condition:
                self._token = token
                self._last_http_result = response
            self._last_action = "Login succeeded"
            self.log(self._last_action)
            self.list_rooms()
            return

        self._store_http_result(response, "Login failed")

    def list_rooms(self) -> None:
        response = self._request_json("GET", "/api/v1/rooms", auth=True)
        if response["ok"]:
            data = response["data"] if isinstance(response["data"], list) else []
            with self._condition:
                self._rooms = data
                self._last_collection_label = "Areas"
                self._last_collection = data
                self._last_http_result = response
            self._last_action = f"Loaded {len(data)} area(s)"
            self.log(self._last_action)
            return
        self._store_http_result(response, "Loading areas failed")

    def _ensure_room(self) -> int | None:
        room_id_text = self.settings.room_id.strip()
        if room_id_text:
            try:
                return int(room_id_text)
            except ValueError:
                self.log(f"Ignoring invalid area id '{room_id_text}'.")

        self.list_rooms()
        for room in self._rooms:
            if room.get("name") == self.settings.room_name:
                room_id = int(room["room_id"])
                self.settings.room_id = str(room_id)
                return room_id

        if not self.settings.room_name:
            self.log("Approve requires an area id or area name.")
            return None

        response = self._request_json(
            "POST",
            "/api/v1/rooms",
            auth=True,
            payload={"name": self.settings.room_name, "allowed_user_ids": []},
        )
        if response["ok"]:
            data = response["data"]
            room_id = int(data["room_id"])
            self.settings.room_id = str(room_id)
            self._rooms.append(data)
            self._last_collection_label = "Areas"
            self._last_collection = self._rooms
            self._last_http_result = response
            self.log(f"Created area '{self.settings.room_name}' ({room_id}).")
            return room_id

        self._store_http_result(response, "Create area failed")
        return None

    def approve_device(self) -> None:
        room_id = self._ensure_room()
        if room_id is None:
            self._last_action = "Approve skipped because no area could be resolved"
            return

        response = self._request_json(
            "POST",
            f"/api/v1/device/{parse.quote(self.settings.device_id)}/approve",
            auth=True,
            payload={"room_id": room_id},
        )
        if response["ok"]:
            self._last_action = "Device approved"
            self._store_http_result(response)
            self.fetch_device_snapshot()
            self.list_dashboard_devices()
            return
        self._store_http_result(response, "Approve failed")

    def reject_device(self) -> None:
        response = self._request_json(
            "POST",
            f"/api/v1/device/{parse.quote(self.settings.device_id)}/reject",
            auth=True,
        )
        if response["ok"]:
            self._last_action = "Device rejected"
            self._store_http_result(response)
            self.list_pending_devices()
            return
        self._store_http_result(response, "Reject failed")

    def unpair_device(self) -> None:
        response = self._request_json(
            "DELETE",
            f"/api/v1/device/{parse.quote(self.settings.device_id)}",
            auth=True,
        )
        if response["ok"]:
            self._last_action = "Device unpaired"
            self._store_http_result(response)
            self.fetch_device_snapshot()
            return
        self._store_http_result(response, "Unpair failed")

    def fetch_device_snapshot(self) -> None:
        response = self._request_json(
            "GET",
            f"/api/v1/device/{parse.quote(self.settings.device_id)}",
            auth=True,
        )
        if response["ok"]:
            data = response["data"] if isinstance(response["data"], dict) else {}
            with self._condition:
                self._last_device_snapshot = data
                self._last_http_result = response
            self._last_action = "Loaded device snapshot"
            self.log(self._last_action)
            return
        self._store_http_result(response, "Load device snapshot failed")

    def list_pending_devices(self) -> None:
        response = self._request_json(
            "GET",
            "/api/v1/devices?auth_status=pending",
            auth=True,
        )
        if response["ok"]:
            data = response["data"] if isinstance(response["data"], list) else []
            with self._condition:
                self._last_collection_label = "Pending devices"
                self._last_collection = data
                self._last_http_result = response
            self._last_action = f"Loaded {len(data)} pending device(s)"
            self.log(self._last_action)
            return
        self._store_http_result(response, "Load pending devices failed")

    def list_dashboard_devices(self) -> None:
        response = self._request_json(
            "GET",
            "/api/v1/dashboard/devices",
            auth=True,
        )
        if response["ok"]:
            data = response["data"] if isinstance(response["data"], list) else []
            with self._condition:
                self._last_collection_label = "Dashboard devices"
                self._last_collection = data
                self._last_http_result = response
            self._last_action = f"Loaded {len(data)} dashboard device(s)"
            self.log(self._last_action)
            return
        self._store_http_result(response, "Load dashboard devices failed")

    def check_command_policy(self) -> None:
        response = self._request_json(
            "GET",
            f"/api/v1/device/{parse.quote(self.settings.device_id)}/command/latest",
        )
        if response["ok"]:
            self._store_http_result(response, "Loaded latest command policy")
            return
        self._store_http_result(response, "Latest command policy check failed")

    def send_server_command(self, payload: dict[str, Any]) -> None:
        with self._condition:
            command_counter = self._command_counter
        response = self._request_json(
            "POST",
            f"/api/v1/device/{parse.quote(self.settings.device_id)}/command",
            auth=True,
            payload=payload,
        )
        if response["ok"]:
            self._store_http_result(response, "Remote command submitted")
            self._wait_for(lambda: self._command_counter > command_counter, timeout=2.5)
            self.fetch_device_snapshot()
            return
        self._store_http_result(response, "Remote command failed")

    def send_quick_command(self, value: int) -> None:
        with self._condition:
            command_pin = self._first_command_pin_locked()
        if command_pin is None:
            self._last_action = "Quick command skipped because no OUTPUT or PWM pin is configured."
            self.log(self._last_action)
            return

        payload = {
            "kind": "action",
            "pin": command_pin,
            "value": value,
        }
        self.send_server_command(payload)

    def send_custom_command(self) -> None:
        try:
            payload = load_json_object(self.settings.command_json, field_name="command_json")
        except ValueError as exc:
            self._last_action = f"Cannot send custom command: {exc}"
            self.log(self._last_action)
            return
        self.send_server_command(payload)

    def clear_logs(self) -> None:
        with self._condition:
            self._logs.clear()
            self._logs.appendleft(f"[{utc_timestamp()}] Logs cleared.")
        self._last_action = "Logs cleared"

    def apply_selected_board_preset(self) -> None:
        preset_id = (self.settings.board_preset or CUSTOM_BOARD_PRESET).strip() or CUSTOM_BOARD_PRESET
        if preset_id == CUSTOM_BOARD_PRESET:
            self._last_action = "Preset selector left in custom JSON mode."
            self.log(self._last_action)
            return

        with self._condition:
            applied = apply_board_preset(self.settings, preset_id)
            if applied:
                self._rebuild_runtime_pins_locked()
                self._last_state_payload = {}
                self._last_command_payload = {}
                self._last_device_snapshot = {}

        if not applied:
            self._last_action = f"Unknown board preset '{preset_id}'"
            self.log(self._last_action)
            return

        preset_label = str(BOARD_PRESETS[preset_id]["label"])
        self._last_action = f"Applied board preset: {preset_label}"
        self.log(
            f"{self._last_action}. Re-register or publish heartbeat to expose the new fake board shape."
        )

    def generate_fresh_identity(self) -> None:
        with self._condition:
            self.settings.device_id = generate_device_id()
            self.settings.mac_address = generate_mac_address()
            self._secure_pairing_verified = False
            self._command_enabled = False
            self._last_pairing_ack = {}
            self._last_state_ack = {}
            self._last_command_payload = {}
            self._last_device_snapshot = {}
            self._last_collection = []
            self._last_collection_label = ""
        self._last_action = "Generated fresh device identity"
        self.log(
            f"{self._last_action}: {self.settings.device_id} / {self.settings.mac_address}"
        )

    def acknowledge_settings(self) -> None:
        self._last_action = "Settings saved"
        self.log(self._last_action)

    def reset_transient_state(self) -> None:
        with self._condition:
            self._secure_pairing_verified = False
            self._command_enabled = False
            self._last_pairing_ack = {}
            self._last_state_ack = {}
            self._last_state_payload = {}
            self._last_command_payload = {}
            self._last_device_snapshot = {}
            self._last_collection = []
            self._last_collection_label = ""
            self._last_http_result = {}
            self._pairing_ack_counter = 0
            self._state_ack_counter = 0
            self._command_counter = 0
            self._rebuild_runtime_pins_locked()
        self._last_action = "Transient state reset"
        self.log(self._last_action)

    def handle_action(self, action: str) -> None:
        actions = {
            "save_settings": self.acknowledge_settings,
            "apply_board_preset": self.apply_selected_board_preset,
            "generate_identity": self.generate_fresh_identity,
            "mqtt_connect": self.connect_mqtt,
            "mqtt_disconnect": self.disconnect_mqtt,
            "login": self.login,
            "list_rooms": self.list_rooms,
            "register_normal": self.register_board,
            "register_force_pair": lambda: self.register_board(force_pairing=True),
            "register_invalid_secret": lambda: self.register_board(invalid_secret=True),
            "register_malformed": lambda: self.register_board(malformed=True),
            "register_http_normal": self.register_board_http,
            "register_http_force_pair": lambda: self.register_board_http(force_pairing=True),
            "register_http_invalid_secret": lambda: self.register_board_http(invalid_secret=True),
            "publish_state_ok": lambda: self.publish_state(applied=True),
            "publish_state_fail": lambda: self.publish_state(applied=False),
            "approve_device": self.approve_device,
            "reject_device": self.reject_device,
            "unpair_device": self.unpair_device,
            "list_pending_devices": self.list_pending_devices,
            "list_dashboard_devices": self.list_dashboard_devices,
            "fetch_device": self.fetch_device_snapshot,
            "latest_command_policy": self.check_command_policy,
            "remote_on": lambda: self.send_quick_command(1),
            "remote_off": lambda: self.send_quick_command(0),
            "remote_custom": self.send_custom_command,
            "clear_logs": self.clear_logs,
            "reset_transient": self.reset_transient_state,
        }

        handler = actions.get(action)
        if not handler:
            self._last_action = f"Unknown action '{action}'"
            self.log(self._last_action)
            return

        handler()

    def _request_form(self, method: str, path: str, form_payload: dict[str, str]) -> dict[str, Any]:
        data = parse.urlencode(form_payload).encode("utf-8")
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        return self._request(method, path, data=data, headers=headers)

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        auth: bool = False,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        headers = {}
        data = None
        if auth:
            if not self._token:
                result = {
                    "ok": False,
                    "status": None,
                    "data": {"error": "missing_token", "message": "Login first."},
                }
                self._store_http_result(result, "Action requires login")
                return result
            headers["Authorization"] = f"Bearer {self._token}"
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        return self._request(method, path, data=data, headers=headers)

    def _request(
        self,
        method: str,
        path: str,
        *,
        data: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        url = f"{self.settings.server_base_url.rstrip('/')}{path}"
        req = request.Request(url, method=method, data=data, headers=headers or {})
        try:
            with request.urlopen(req, timeout=8.0) as response:
                body = response.read().decode("utf-8")
                parsed_body = json.loads(body) if body else {}
                return {"ok": True, "status": response.status, "data": parsed_body, "url": url}
        except error.HTTPError as exc:
            body = exc.read().decode("utf-8")
            try:
                parsed_body = json.loads(body) if body else {}
            except json.JSONDecodeError:
                parsed_body = {"raw": body}
            return {"ok": False, "status": exc.code, "data": parsed_body, "url": url}
        except Exception as exc:
            return {
                "ok": False,
                "status": None,
                "data": {"error": type(exc).__name__, "message": str(exc)},
                "url": url,
            }

    def _store_http_result(self, response: dict[str, Any], success_message: str | None = None) -> None:
        with self._condition:
            self._last_http_result = response
        if response.get("ok"):
            self._last_action = success_message or "HTTP request succeeded"
            self.log(f"{self._last_action}: {response['status']} {response['url']}")
            return
        self._last_action = success_message or "HTTP request failed"
        self.log(
            f"{self._last_action}: status={response.get('status')} "
            f"detail={dump_json(response.get('data', {}))}"
        )

    def snapshot(self) -> dict[str, Any]:
        with self._condition:
            return {
                "settings": asdict(self.settings),
                "mqtt_connected": self._mqtt_connected,
                "secure_pairing_verified": self._secure_pairing_verified,
                "command_enabled": self._command_enabled,
                "has_token": bool(self._token),
                "last_action": self._last_action,
                "last_http_result": self._last_http_result,
                "last_pairing_ack": self._last_pairing_ack,
                "last_state_ack": self._last_state_ack,
                "last_state_payload": self._last_state_payload,
                "last_command_payload": self._last_command_payload,
                "last_device_snapshot": self._last_device_snapshot,
                "last_collection_label": self._last_collection_label,
                "last_collection": self._last_collection,
                "rooms": self._rooms,
                "logs": list(self._logs),
                "runtime_pins": list(self._runtime_pins.values()),
                "board_presets": list_board_presets(),
            }

    def render_dashboard(self) -> str:
        state = self.snapshot()
        settings = state["settings"]

        def esc(value: Any) -> str:
            return html.escape("" if value is None else str(value), quote=True)

        def pretty(value: Any) -> str:
            if not value:
                return "{}" if isinstance(value, dict) else "[]"
            return html.escape(dump_json(value))

        def badge(label: str, active: bool) -> str:
            css_class = "badge badge-ok" if active else "badge badge-muted"
            return f'<span class="{css_class}">{html.escape(label)}</span>'

        room_options = []
        for room in state["rooms"]:
            room_id = str(room.get("room_id", ""))
            selected = " selected" if room_id == settings["room_id"] else ""
            room_options.append(
                f'<option value="{esc(room_id)}"{selected}>{esc(room.get("name", room_id))}</option>'
            )
        room_options_html = "".join(room_options) or '<option value="">No areas loaded yet</option>'
        preset_options = []
        for preset in state["board_presets"]:
            preset_id = str(preset["id"])
            selected = " selected" if preset_id == settings["board_preset"] else ""
            preset_options.append(
                f'<option value="{esc(preset_id)}"{selected}>{esc(preset["label"])}</option>'
            )
        preset_options_html = "".join(preset_options)
        active_preset = next(
            (preset for preset in state["board_presets"] if preset["id"] == settings["board_preset"]),
            state["board_presets"][0],
        )

        return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Fake Board Pairing + Remote Dashboard</title>
  <style>
    :root {{
      --bg: #07131a;
      --panel: rgba(9, 25, 33, 0.9);
      --panel-border: rgba(118, 196, 170, 0.22);
      --text: #e9fbf4;
      --muted: #8cb7aa;
      --accent: #76c4aa;
      --accent-2: #f3b562;
      --danger: #ff8a80;
      --shadow: 0 20px 60px rgba(0, 0, 0, 0.28);
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      min-height: 100vh;
      font-family: "SF Pro Display", "Segoe UI Variable Text", "Avenir Next", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(118, 196, 170, 0.2), transparent 34%),
        radial-gradient(circle at top right, rgba(243, 181, 98, 0.18), transparent 28%),
        linear-gradient(160deg, #02070a 0%, #07131a 35%, #0d2128 100%);
    }}
    .shell {{
      width: min(1400px, calc(100vw - 32px));
      margin: 24px auto 40px;
    }}
    .hero {{
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
      margin-bottom: 20px;
    }}
    .hero h1 {{
      margin: 0 0 8px;
      font-size: clamp(28px, 5vw, 44px);
      line-height: 1;
      letter-spacing: -0.03em;
    }}
    .hero p {{
      margin: 0;
      max-width: 760px;
      color: var(--muted);
      line-height: 1.55;
    }}
    .chips {{
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 14px;
    }}
    .badge {{
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 8px 12px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.02em;
      border: 1px solid transparent;
    }}
    .badge-ok {{
      background: rgba(118, 196, 170, 0.16);
      color: #c7fff0;
      border-color: rgba(118, 196, 170, 0.35);
    }}
    .badge-muted {{
      background: rgba(255, 255, 255, 0.07);
      color: #c9d8d4;
      border-color: rgba(255, 255, 255, 0.08);
    }}
    .panel-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 16px;
    }}
    .panel {{
      background: var(--panel);
      border: 1px solid var(--panel-border);
      border-radius: 22px;
      padding: 18px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(16px);
    }}
    .panel-wide {{
      grid-column: 1 / -1;
    }}
    .panel h2 {{
      margin: 0 0 10px;
      font-size: 18px;
      letter-spacing: 0.02em;
    }}
    .panel p {{
      margin: 0 0 14px;
      color: var(--muted);
      line-height: 1.5;
    }}
    .stack {{
      display: grid;
      gap: 12px;
    }}
    .field-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }}
    label {{
      display: grid;
      gap: 6px;
      font-size: 13px;
      color: var(--muted);
      font-weight: 600;
    }}
    input, select, textarea {{
      width: 100%;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: rgba(255, 255, 255, 0.06);
      color: var(--text);
      padding: 12px 14px;
      font: inherit;
      outline: none;
    }}
    textarea {{
      min-height: 220px;
      resize: vertical;
      font-family: "SF Mono", "JetBrains Mono", Consolas, monospace;
      font-size: 13px;
      line-height: 1.45;
    }}
    select option {{
      color: #0b1720;
    }}
    .actions {{
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }}
    button {{
      border: 0;
      border-radius: 999px;
      padding: 12px 16px;
      color: #041015;
      background: linear-gradient(135deg, var(--accent) 0%, #a8f7dc 100%);
      font: inherit;
      font-weight: 800;
      letter-spacing: 0.02em;
      cursor: pointer;
    }}
    button.secondary {{
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.12) 100%);
      color: var(--text);
      border: 1px solid rgba(255, 255, 255, 0.12);
    }}
    button.warn {{
      background: linear-gradient(135deg, var(--accent-2) 0%, #ffdca4 100%);
    }}
    button.danger {{
      background: linear-gradient(135deg, #ff8a80 0%, #ffc6c2 100%);
    }}
    .kpi-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
    }}
    .kpi {{
      border-radius: 16px;
      padding: 14px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.06);
    }}
    .kpi strong {{
      display: block;
      font-size: 13px;
      color: var(--muted);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }}
    .kpi span {{
      font-size: 16px;
      font-weight: 800;
    }}
    pre {{
      margin: 0;
      padding: 16px;
      border-radius: 18px;
      background: rgba(0, 0, 0, 0.28);
      border: 1px solid rgba(255, 255, 255, 0.08);
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: "SF Mono", "JetBrains Mono", Consolas, monospace;
      font-size: 12px;
      line-height: 1.45;
    }}
    .split {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 12px;
    }}
    .hint {{
      margin-top: 12px;
      padding: 12px 14px;
      border-radius: 16px;
      background: rgba(243, 181, 98, 0.1);
      border: 1px solid rgba(243, 181, 98, 0.18);
      color: #f6d6a3;
      font-size: 13px;
      line-height: 1.5;
    }}
    @media (max-width: 720px) {{
      .hero {{
        flex-direction: column;
      }}
    }}
  </style>
</head>
<body>
  <div class="shell">
    <div class="hero">
      <div>
        <h1>Fake Board Test Rig</h1>
        <p>
          Standalone harness for the current E-Connect MQTT register/state/command contract.
          Leave <code>project_id</code> and <code>secret_key</code> empty to test the pending-pair path,
          or fill them to exercise secure provisioning and invalid-secret scenarios.
        </p>
        <div class="chips">
          {badge("MQTT connected" if state["mqtt_connected"] else "MQTT offline", state["mqtt_connected"])}
          {badge("Auth token ready" if state["has_token"] else "Login required", state["has_token"])}
          {badge("Secure pairing verified" if state["secure_pairing_verified"] else "Pairing not verified", state["secure_pairing_verified"])}
          {badge("Remote commands enabled" if state["command_enabled"] else "Remote commands blocked", state["command_enabled"])}
        </div>
      </div>
      <div class="panel" style="min-width: 280px;">
        <h2>Last Action</h2>
        <p>{esc(state["last_action"])}</p>
        <div class="actions">
          <button class="secondary" type="submit" form="dashboard-form" name="action" value="save_settings">Save Settings</button>
          <button class="secondary" type="submit" form="dashboard-form" name="action" value="fetch_device">Reload Device</button>
          <button class="danger" type="submit" form="dashboard-form" name="action" value="clear_logs">Clear Logs</button>
        </div>
      </div>
    </div>

    <form id="dashboard-form" method="post" action="/action">
      <div class="panel-grid">
        <section class="panel panel-wide">
          <h2>Connection Settings</h2>
          <p>Every button submission sends the current form values, so you can edit settings and trigger a test step immediately.</p>
          <div class="field-grid">
            <label>Server Base URL
              <input name="server_base_url" value="{esc(settings["server_base_url"])}" />
            </label>
            <label>MQTT Broker
              <input name="mqtt_broker" value="{esc(settings["mqtt_broker"])}" />
            </label>
            <label>MQTT Port
              <input name="mqtt_port" value="{esc(settings["mqtt_port"])}" />
            </label>
            <label>MQTT Namespace
              <input name="mqtt_namespace" value="{esc(settings["mqtt_namespace"])}" />
            </label>
            <label>Username
              <input name="username" value="{esc(settings["username"])}" />
            </label>
            <label>Password
              <input type="password" name="password" value="{esc(settings["password"])}" />
            </label>
            <label>Area ID
              <input name="room_id" value="{esc(settings["room_id"])}" />
            </label>
            <label>Area Name
              <input name="room_name" value="{esc(settings["room_name"])}" />
            </label>
            <label>Known Areas
              <select disabled>{room_options_html}</select>
            </label>
          </div>
          <div class="actions" style="margin-top: 14px;">
            <button type="submit" name="action" value="login">Login</button>
            <button class="secondary" type="submit" name="action" value="list_rooms">Load Areas</button>
            <button class="secondary" type="submit" name="action" value="generate_identity">Generate Fresh Identity</button>
            <button type="submit" name="action" value="mqtt_connect">Connect MQTT</button>
            <button class="secondary" type="submit" name="action" value="mqtt_disconnect">Disconnect MQTT</button>
            <button class="danger" type="submit" name="action" value="reset_transient">Reset Transient State</button>
          </div>
        </section>

        <section class="panel">
          <h2>Board Presets</h2>
          <p>Load one of the canned fake board shapes for sensor, fan, switch, or PWM slider testing, or stay in custom JSON mode.</p>
          <label>Preset
            <select name="board_preset">{preset_options_html}</select>
          </label>
          <div class="actions" style="margin-top: 14px;">
            <button type="submit" name="action" value="apply_board_preset">Apply Preset</button>
          </div>
          <div class="hint">
            <strong>Active preset:</strong> {esc(active_preset["label"])}<br />
            {esc(active_preset["description"])}
          </div>
          <div class="hint">
            <strong>Multi-board tip:</strong> launch another harness with a different
            <code>--dashboard-port</code> and <code>--board-preset</code> if you want several fake boards online at once.
          </div>
        </section>

        <section class="panel">
          <h2>Board Identity</h2>
          <div class="field-grid">
            <label>Device ID
              <input name="device_id" value="{esc(settings["device_id"])}" />
            </label>
            <label>MAC Address
              <input name="mac_address" value="{esc(settings["mac_address"])}" />
            </label>
            <label>Device Name
              <input name="device_name" value="{esc(settings["device_name"])}" />
            </label>
            <label>Mode
              <input name="mode" value="{esc(settings["mode"])}" />
            </label>
            <label>Firmware Version
              <input name="firmware_version" value="{esc(settings["firmware_version"])}" />
            </label>
            <label>Reported IP
              <input name="ip_address" value="{esc(settings["ip_address"])}" />
            </label>
            <label>Provisioning Project ID
              <input name="project_id" value="{esc(settings["project_id"])}" />
            </label>
            <label>Secret Key
              <input name="secret_key" value="{esc(settings["secret_key"])}" />
            </label>
          </div>
        </section>

        <section class="panel">
          <h2>Pairing Scenarios</h2>
          <p>Use MQTT registration for full transport testing. Use HTTP registration as a discovery fallback when the web dashboard cannot scan because the MQTT path is not lined up yet.</p>
          <div class="actions">
            <button type="submit" name="action" value="register_normal">Register Normal</button>
            <button class="warn" type="submit" name="action" value="register_force_pair">Force Re-pair</button>
            <button class="warn" type="submit" name="action" value="register_invalid_secret">Invalid Secret</button>
            <button class="danger" type="submit" name="action" value="register_malformed">Malformed Register</button>
            <button type="submit" name="action" value="register_http_normal">Register via HTTP</button>
            <button class="warn" type="submit" name="action" value="register_http_force_pair">HTTP Force Re-pair</button>
            <button class="warn" type="submit" name="action" value="register_http_invalid_secret">HTTP Invalid Secret</button>
            <button type="submit" name="action" value="approve_device">Approve Device</button>
            <button class="warn" type="submit" name="action" value="reject_device">Reject Device</button>
            <button class="danger" type="submit" name="action" value="unpair_device">Unpair Device</button>
            <button class="secondary" type="submit" name="action" value="list_pending_devices">List Pending</button>
            <button class="secondary" type="submit" name="action" value="list_dashboard_devices">List Dashboard</button>
          </div>
          <div class="hint">
            <strong>Quick note:</strong> if Area ID is empty, the dashboard will reuse or create
            the area named <code>{esc(settings["room_name"])}</code> during approval.
          </div>
          <div class="hint">
            <strong>Discovery fallback:</strong> if the main webapp stays on "Scanning Network", click
            <code>Register via HTTP</code>, then open the real discovery page and click <code>Rescan Network</code>.
            If the same board was already approved before, use <code>HTTP Force Re-pair</code> or
            <code>Generate Fresh Identity</code> first so the device returns to <code>pending</code>.
          </div>
        </section>

        <section class="panel">
          <h2>Remote + State Tests</h2>
          <p>The quick buttons target the first OUTPUT or PWM pin from <code>pins_json</code>. Custom JSON goes through the server <code>/device/{{id}}/command</code> endpoint.</p>
          <div class="actions">
            <button type="submit" name="action" value="publish_state_ok">Publish Heartbeat</button>
            <button class="warn" type="submit" name="action" value="publish_state_fail">Publish Failure State</button>
            <button type="submit" name="action" value="remote_on">Remote ON</button>
            <button class="secondary" type="submit" name="action" value="remote_off">Remote OFF</button>
            <button type="submit" name="action" value="remote_custom">Send Custom Command</button>
            <button class="secondary" type="submit" name="action" value="latest_command_policy">Check Command Policy</button>
          </div>
        </section>

        <section class="panel panel-wide">
          <h2>Editable JSON Payloads</h2>
          <div class="split">
            <label>Pins JSON
              <textarea name="pins_json">{html.escape(settings["pins_json"])}</textarea>
            </label>
            <label>Custom Command JSON
              <textarea name="command_json">{html.escape(settings["command_json"])}</textarea>
            </label>
          </div>
        </section>

        <section class="panel panel-wide">
          <h2>Current Snapshot</h2>
          <div class="kpi-grid" style="margin-bottom: 14px;">
            <div class="kpi"><strong>Device ID</strong><span>{esc(settings["device_id"])}</span></div>
            <div class="kpi"><strong>Preset</strong><span>{esc(active_preset["label"])}</span></div>
            <div class="kpi"><strong>MQTT Namespace</strong><span>{esc(settings["mqtt_namespace"])}</span></div>
            <div class="kpi"><strong>Runtime Pins</strong><span>{len(state["runtime_pins"])}</span></div>
            <div class="kpi"><strong>Areas Cached</strong><span>{len(state["rooms"])}</span></div>
          </div>
          <div class="split">
            <div>
              <h2 style="margin-top: 0;">Last Pairing Ack</h2>
              <pre>{pretty(state["last_pairing_ack"])}</pre>
            </div>
            <div>
              <h2 style="margin-top: 0;">Last State Ack</h2>
              <pre>{pretty(state["last_state_ack"])}</pre>
            </div>
            <div>
              <h2 style="margin-top: 0;">Last State Payload</h2>
              <pre>{pretty(state["last_state_payload"])}</pre>
            </div>
            <div>
              <h2 style="margin-top: 0;">Last Command Payload</h2>
              <pre>{pretty(state["last_command_payload"])}</pre>
            </div>
            <div>
              <h2 style="margin-top: 0;">Last Device Snapshot</h2>
              <pre>{pretty(state["last_device_snapshot"])}</pre>
            </div>
            <div>
              <h2 style="margin-top: 0;">Last HTTP Result</h2>
              <pre>{pretty(state["last_http_result"])}</pre>
            </div>
          </div>
          <div class="hint" style="margin-top: 14px;">
            <strong>Collection view:</strong> {esc(state["last_collection_label"] or "No collection loaded yet")}
          </div>
          <pre style="margin-top: 12px;">{pretty(state["last_collection"])}</pre>
        </section>

        <section class="panel panel-wide">
          <h2>Activity Log</h2>
          <pre>{html.escape("\\n".join(state["logs"]))}</pre>
        </section>
      </div>
    </form>
  </div>
</body>
</html>
"""


def build_handler(harness: FakeBoardHarness):
    class DashboardHandler(BaseHTTPRequestHandler):
        def _send_body(self, body: bytes, *, content_type: str) -> None:
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def do_HEAD(self) -> None:  # noqa: N802
            if self.path == "/":
                body = harness.render_dashboard().encode("utf-8")
                self._send_body(body, content_type="text/html; charset=utf-8")
                return

            if self.path == "/snapshot.json":
                body = json.dumps(harness.snapshot(), indent=2).encode("utf-8")
                self._send_body(body, content_type="application/json; charset=utf-8")
                return

            if self.path == "/favicon.ico":
                self.send_response(HTTPStatus.NO_CONTENT)
                self.end_headers()
                return

            self.send_error(HTTPStatus.NOT_FOUND, "Not found")

        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/":
                body = harness.render_dashboard().encode("utf-8")
                self._send_body(body, content_type="text/html; charset=utf-8")
                return

            if self.path == "/snapshot.json":
                body = json.dumps(harness.snapshot(), indent=2).encode("utf-8")
                self._send_body(body, content_type="application/json; charset=utf-8")
                return

            if self.path == "/favicon.ico":
                self.send_response(HTTPStatus.NO_CONTENT)
                self.end_headers()
                return

            self.send_error(HTTPStatus.NOT_FOUND, "Not found")

        def do_POST(self) -> None:  # noqa: N802
            if self.path != "/action":
                self.send_error(HTTPStatus.NOT_FOUND, "Not found")
                return

            length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(length).decode("utf-8")
            form = parse.parse_qs(raw_body, keep_blank_values=True)
            harness.update_settings(form)
            action = form.get("action", ["save_settings"])[0]
            harness.handle_action(action)

            self.send_response(HTTPStatus.SEE_OTHER)
            self.send_header("Location", "/")
            self.end_headers()

        def log_message(self, _format: str, *_args: Any) -> None:
            return

    return DashboardHandler


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fake MQTT board with local test dashboard.")
    parser.add_argument("--server-base-url", default=os.getenv("FAKE_BOARD_SERVER_URL", "http://127.0.0.1:8000"))
    parser.add_argument("--mqtt-broker", default=os.getenv("MQTT_BROKER", "127.0.0.1"))
    parser.add_argument("--mqtt-port", type=int, default=int(os.getenv("MQTT_PORT", "1883")))
    parser.add_argument("--mqtt-namespace", default=os.getenv("MQTT_NAMESPACE", "local"))
    parser.add_argument("--dashboard-host", default=os.getenv("FAKE_BOARD_DASHBOARD_HOST", "127.0.0.1"))
    parser.add_argument("--dashboard-port", type=int, default=int(os.getenv("FAKE_BOARD_DASHBOARD_PORT", "8765")))
    parser.add_argument(
        "--board-preset",
        choices=[CUSTOM_BOARD_PRESET, *sorted(BOARD_PRESETS)],
        default=os.getenv("FAKE_BOARD_PRESET", CUSTOM_BOARD_PRESET),
        help="Optional canned fake board shape to load on startup.",
    )
    parser.add_argument("--device-id")
    parser.add_argument("--device-name")
    parser.add_argument("--mac-address")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    settings = Settings(
        server_base_url=args.server_base_url,
        mqtt_broker=args.mqtt_broker,
        mqtt_port=args.mqtt_port,
        mqtt_namespace=args.mqtt_namespace,
        dashboard_host=args.dashboard_host,
        dashboard_port=args.dashboard_port,
    )
    if args.board_preset != CUSTOM_BOARD_PRESET:
        apply_board_preset(settings, args.board_preset)
    else:
        settings.board_preset = CUSTOM_BOARD_PRESET

    if args.device_id:
        settings.device_id = args.device_id
    if args.device_name:
        settings.device_name = args.device_name
    if args.mac_address:
        settings.mac_address = args.mac_address

    harness = FakeBoardHarness(settings)
    server = ThreadingHTTPServer(
        (settings.dashboard_host, settings.dashboard_port),
        build_handler(harness),
    )

    url = f"http://{settings.dashboard_host}:{settings.dashboard_port}"
    harness.log(f"Dashboard listening at {url}")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        harness.log("Keyboard interrupt received. Stopping dashboard.")
    finally:
        server.server_close()
        harness.shutdown()


if __name__ == "__main__":
    main()
