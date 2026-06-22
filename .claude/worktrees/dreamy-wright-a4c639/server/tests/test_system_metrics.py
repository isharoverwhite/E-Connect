# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

from types import SimpleNamespace

from app.services import system_metrics


def test_collect_system_metrics_falls_back_to_root_when_host_mount_is_missing(monkeypatch):
    monkeypatch.setenv("HOST_OS_ROOT", "/hostfs-missing-for-test")
    monkeypatch.setattr(system_metrics.os.path, "exists", lambda path: False)
    monkeypatch.setattr(system_metrics.psutil, "cpu_percent", lambda interval=None: 12.5)
    monkeypatch.setattr(
        system_metrics.psutil,
        "virtual_memory",
        lambda: SimpleNamespace(used=1024, total=2048),
    )
    disk_paths: list[str] = []

    def fake_disk_usage(path: str) -> SimpleNamespace:
        disk_paths.append(path)
        return SimpleNamespace(used=4096, total=8192)

    monkeypatch.setattr(system_metrics.psutil, "disk_usage", fake_disk_usage)

    metrics = system_metrics.collect_system_metrics()

    assert disk_paths == ["/"]
    assert metrics == {
        "cpu_percent": 12.5,
        "memory_used": 1024,
        "memory_total": 2048,
        "storage_used": 4096,
        "storage_total": 8192,
    }
