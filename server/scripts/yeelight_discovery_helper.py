# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

from __future__ import annotations

import json
import logging
import os
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit


DISCOVERY_HOST = "239.255.255.250"
DISCOVERY_PORT = 1982
DISCOVERY_TIMEOUT_SECONDS = float(os.getenv("ECONNECT_YEELIGHT_DISCOVERY_TIMEOUT_SECONDS", "1.0"))
DISCOVERY_ATTEMPTS = max(1, int(os.getenv("ECONNECT_YEELIGHT_DISCOVERY_ATTEMPTS", "2")))
HELPER_BIND_HOST = os.getenv("ECONNECT_YEELIGHT_DISCOVERY_HELPER_HOST", "0.0.0.0").strip() or "0.0.0.0"
HELPER_PORT = int(os.getenv("ECONNECT_YEELIGHT_DISCOVERY_HELPER_PORT", "8915"))

logger = logging.getLogger("yeelight_discovery_helper")


class _Handler(BaseHTTPRequestHandler):
    server_version = "YeelightDiscoveryHelper/1.0"

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlsplit(self.path)
        if parsed.path == "/health":
            self._write_json(200, {"status": "ok"})
            return

        if parsed.path != "/yeelight/discover":
            self._write_json(404, {"detail": "Not found"})
            return

        raw_host = parse_qs(parsed.query).get("host", [""])[0].strip()
        if not raw_host:
            self._write_json(400, {"detail": "Missing required query parameter: host"})
            return

        metadata = discover_yeelight(raw_host)
        if metadata is None:
            self._write_json(404, {"detail": "Yeelight discovery reply not found", "host": raw_host})
            return
        self._write_json(200, metadata)

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        logger.info("%s - %s", self.address_string(), format % args)

    def _write_json(self, status: int, payload: dict[str, object]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def discover_yeelight(host: str) -> dict[str, object] | None:
    message = "\r\n".join(
        [
            "M-SEARCH * HTTP/1.1",
            f"HOST: {DISCOVERY_HOST}:{DISCOVERY_PORT}",
            'MAN: "ssdp:discover"',
            "ST: wifi_bulb",
            "",
            "",
        ]
    ).encode("utf-8")

    discovery_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    try:
        discovery_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        discovery_socket.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
        discovery_socket.settimeout(DISCOVERY_TIMEOUT_SECONDS)
        for _ in range(DISCOVERY_ATTEMPTS):
            discovery_socket.sendto(message, (DISCOVERY_HOST, DISCOVERY_PORT))
            try:
                while True:
                    packet, addr = discovery_socket.recvfrom(4096)
                    if addr[0] != host:
                        continue
                    return parse_discovery_packet(packet)
            except TimeoutError:
                continue
    except OSError as exc:
        logger.warning("Host-side Yeelight discovery failed for host=%s: %s", host, exc)
    finally:
        discovery_socket.close()
    return None


def parse_discovery_packet(packet: bytes) -> dict[str, object]:
    metadata: dict[str, object] = {}
    for line in packet.decode("utf-8", errors="replace").split("\r\n"):
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        metadata[key.strip().lower()] = value.strip()
    support = metadata.get("support")
    if isinstance(support, str):
        metadata["support_methods"] = [method for method in support.split(" ") if method]
    return metadata


def main() -> int:
    logging.basicConfig(
        level=os.getenv("ECONNECT_YEELIGHT_DISCOVERY_HELPER_LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s | %(message)s",
    )
    server = ThreadingHTTPServer((HELPER_BIND_HOST, HELPER_PORT), _Handler)
    logger.info("Starting Yeelight discovery helper on %s:%s", HELPER_BIND_HOST, HELPER_PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Stopping Yeelight discovery helper")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
