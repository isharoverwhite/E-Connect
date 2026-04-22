# Copyright (c) 2026 Dinh Trung Kien. All rights reserved.

from __future__ import annotations

import json
import os

from multicard_control import execute_command as execute_multicard_command
from multicard_control import probe_state as probe_multicard_state
from multicard_control import validate_command as validate_multicard_command


def run_probe() -> int:
    target_host = os.getenv("MULTICARD_HOST", "").strip()
    if not target_host:
        print("Set MULTICARD_HOST to probe the demo provider fixture.")
        return 1

    card_type = os.getenv("MULTICARD_CARD_TYPE", "fan").strip().lower() or "fan"
    snapshot = probe_multicard_state(
        {
            "device_schema_id": "ceiling_fan" if card_type == "fan" else "climate_sensor",
            "config": {
                "ip_address": target_host,
                "default_speed": 35,
                "temperature": 24.5,
                "humidity": 56,
                "value": 24.5,
                "unit": "C",
                "trend": "stable",
            },
            "schema_snapshot": {
                "display": {
                    "card_type": card_type,
                    "capabilities": (
                        ["power", "speed"]
                        if card_type == "fan"
                        else ["temperature", "humidity", "value"]
                    ),
                }
            },
            "last_state": {},
        }
    )

    print(json.dumps(snapshot, indent=2, sort_keys=True))
    return 0


def validate_command(device: dict[str, object], command: dict[str, object]) -> None:
    validate_multicard_command(device, command)


def execute_command(device: dict[str, object], command: dict[str, object]) -> dict[str, object]:
    return execute_multicard_command(device, command)


def probe_state(device: dict[str, object]) -> dict[str, object]:
    return probe_multicard_state(device)


if __name__ == "__main__":
    raise SystemExit(run_probe())
