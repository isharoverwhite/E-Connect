# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

import logging
import os

import psutil


logger = logging.getLogger(__name__)
_warned_storage_roots: set[str] = set()


def resolve_storage_root() -> str:
    raw_root = (os.getenv("HOST_OS_ROOT") or "/").strip() or "/"
    if raw_root == "/" or os.path.exists(raw_root):
        return raw_root

    if raw_root not in _warned_storage_roots:
        logger.warning(
            "HOST_OS_ROOT %s is unavailable; falling back to / for storage metrics.",
            raw_root,
        )
        _warned_storage_roots.add(raw_root)

    return "/"


def collect_system_metrics() -> dict[str, float | int]:
    memory = psutil.virtual_memory()
    storage = psutil.disk_usage(resolve_storage_root())
    return {
        "cpu_percent": psutil.cpu_percent(interval=None),
        "memory_used": memory.used,
        "memory_total": memory.total,
        "storage_used": storage.used,
        "storage_total": storage.total,
    }
