# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

from __future__ import annotations

import asyncio
import logging
import signal
import sys
from contextlib import suppress

from app.services.builder import resolve_runtime_firmware_network_state
from app.services.mdns import MdnsPublisher, resolve_mdns_registration_config


logger = logging.getLogger("discovery_mdns")


def _configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


async def _wait_for_shutdown() -> None:
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()

    def request_stop() -> None:
        stop_event.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        with suppress(NotImplementedError):
            loop.add_signal_handler(sig, request_stop)

    await stop_event.wait()


async def _run() -> int:
    runtime_state = resolve_runtime_firmware_network_state()
    try:
        config = resolve_mdns_registration_config(runtime_state)
    except ValueError as exc:
        logger.error("Discovery mDNS publisher disabled: %s", exc)
        return 1

    if config is None:
        runtime_error = None
        if isinstance(runtime_state, dict):
            candidate = runtime_state.get("error")
            if isinstance(candidate, str) and candidate.strip():
                runtime_error = candidate.strip()

        if runtime_error:
            logger.error("Discovery mDNS publisher could not determine a LAN IP automatically: %s", runtime_error)
        else:
            logger.error("Discovery mDNS publisher could not determine a LAN IP automatically.")
        return 1

    publisher = MdnsPublisher()
    try:
        await publisher.start(config)
    except Exception:
        logger.exception(
            "Discovery mDNS publisher failed for %s -> %s",
            config.hostname,
            ", ".join(config.addresses),
        )
        return 1

    logger.info(
        "Published mDNS alias %s -> %s (discovery %s, webapp %s)",
        config.hostname,
        ", ".join(config.addresses),
        config.discovery_port,
        config.webapp_port,
    )

    try:
        await _wait_for_shutdown()
    finally:
        await publisher.stop()
        logger.info("Stopped mDNS alias %s", config.hostname)

    return 0


def main() -> int:
    _configure_logging()
    return asyncio.run(_run())


if __name__ == "__main__":
    sys.exit(main())
