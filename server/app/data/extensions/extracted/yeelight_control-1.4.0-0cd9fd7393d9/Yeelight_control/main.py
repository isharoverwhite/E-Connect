from __future__ import annotations

import json
import os

from yeelight_control import execute_command as execute_yeelight_command
from yeelight_control import probe_state as probe_yeelight_state
from yeelight_control import validate_command as validate_yeelight_command


def run_probe() -> int:
    target_host = os.getenv("YEELIGHT_HOST", "").strip()
    if not target_host:
        print("Set YEELIGHT_HOST to probe a lamp over the LAN control port.")
        return 1

    snapshot = probe_yeelight_state(
        {
            "config": {"ip_address": target_host},
            "schema_snapshot": {
                "display": {
                    "card_type": "light",
                    "capabilities": ["power", "brightness", "rgb", "color_temperature"],
                    "temperature_range": {"min": 1700, "max": 6500},
                }
            },
            "last_state": {},
        }
    )

    print(json.dumps(snapshot, indent=2, sort_keys=True))
    return 0


def validate_command(device: dict[str, object], command: dict[str, object]) -> None:
    validate_yeelight_command(device, command)


def execute_command(device: dict[str, object], command: dict[str, object]) -> dict[str, object]:
    return execute_yeelight_command(device, command)


def probe_state(device: dict[str, object]) -> dict[str, object]:
    return probe_yeelight_state(device)


if __name__ == "__main__":
    raise SystemExit(run_probe())
