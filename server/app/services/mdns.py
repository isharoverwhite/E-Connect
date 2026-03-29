from __future__ import annotations

from dataclasses import dataclass
import ipaddress
import os
import re
from contextlib import suppress
from typing import Mapping, Sequence
from urllib.parse import urlparse

from zeroconf import IPVersion, ServiceInfo
from zeroconf.asyncio import AsyncZeroconf


MDNS_HOSTNAME_ENV = "MDNS_HOSTNAME"
MDNS_ADVERTISED_IPS_ENV = "MDNS_ADVERTISED_IPS"
MDNS_DISCOVERY_PORT_ENV = "MDNS_DISCOVERY_PORT"
MDNS_WEBAPP_PORT_ENV = "MDNS_WEBAPP_PORT"
MDNS_DISCOVERY_SERVICE_NAME_ENV = "MDNS_DISCOVERY_SERVICE_NAME"
MDNS_WEBAPP_SERVICE_NAME_ENV = "MDNS_WEBAPP_SERVICE_NAME"

DEFAULT_DISCOVERY_PORT = 8000
DEFAULT_WEBAPP_PORT = 3000
DEFAULT_DISCOVERY_SERVICE_NAME = "E-Connect Discovery"
DEFAULT_WEBAPP_SERVICE_NAME = "E-Connect WebUI"
DISCOVERY_PATH = "/web-assistant.js"
HOSTNAME_LABEL_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")


@dataclass(frozen=True)
class MdnsRegistrationConfig:
    hostname: str
    addresses: tuple[str, ...]
    discovery_port: int
    webapp_port: int
    discovery_service_name: str
    webapp_service_name: str

    @property
    def fqdn(self) -> str:
        return f"{self.hostname}."


def _normalize_mdns_hostname(raw_value: str) -> str:
    normalized = raw_value.strip().lower().rstrip(".")
    if not normalized:
        raise ValueError(f"{MDNS_HOSTNAME_ENV} must not be empty when set.")

    labels = normalized.split(".")
    if len(labels) < 2:
        normalized = f"{normalized}.local"
        labels = normalized.split(".")

    if labels[-1] != "local":
        raise ValueError(f"{MDNS_HOSTNAME_ENV} must end with .local for multicast DNS publication.")

    for label in labels[:-1]:
        if not HOSTNAME_LABEL_PATTERN.fullmatch(label):
            raise ValueError(f"{MDNS_HOSTNAME_ENV} contains an invalid DNS label: {label!r}.")

    return normalized


def _extract_runtime_targets(runtime_state: Mapping[str, object] | None) -> Mapping[str, object] | None:
    if not isinstance(runtime_state, Mapping):
        return None
    targets = runtime_state.get("targets")
    if isinstance(targets, Mapping):
        return targets
    return None


def _extract_runtime_ip_candidates(runtime_state: Mapping[str, object] | None) -> list[str]:
    candidates: list[str] = []
    targets = _extract_runtime_targets(runtime_state)
    if not isinstance(targets, Mapping):
        return candidates

    for key in ("advertised_host", "mqtt_broker"):
        raw_value = targets.get(key)
        if not isinstance(raw_value, str):
            continue
        try:
            ipaddress.ip_address(raw_value.strip())
        except ValueError:
            continue
        candidates.append(raw_value.strip())

    api_base_url = targets.get("api_base_url")
    if isinstance(api_base_url, str) and api_base_url.strip():
        try:
            parsed = urlparse(api_base_url.strip())
        except ValueError:
            parsed = None
        hostname = parsed.hostname if parsed is not None else None
        if hostname:
            try:
                ipaddress.ip_address(hostname)
            except ValueError:
                pass
            else:
                candidates.append(hostname)

    unique_candidates: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        unique_candidates.append(candidate)

    return unique_candidates


def _parse_mdns_addresses(raw_value: str | None) -> list[str]:
    addresses: list[str] = []
    for entry in (raw_value or "").split(","):
        candidate = entry.strip()
        if not candidate:
            continue
        try:
            ipaddress.ip_address(candidate)
        except ValueError as exc:
            raise ValueError(f"{MDNS_ADVERTISED_IPS_ENV} contains an invalid IP address: {candidate!r}.") from exc
        addresses.append(candidate)

    unique_addresses: list[str] = []
    seen: set[str] = set()
    for address in addresses:
        if address in seen:
            continue
        seen.add(address)
        unique_addresses.append(address)

    return unique_addresses


def _resolve_port(env_name: str, default: int) -> int:
    raw_value = os.getenv(env_name, str(default)).strip()
    try:
        parsed = int(raw_value)
    except ValueError as exc:
        raise ValueError(f"{env_name} must be a valid TCP port number.") from exc

    if parsed < 1 or parsed > 65535:
        raise ValueError(f"{env_name} must be between 1 and 65535.")

    return parsed


def resolve_mdns_registration_config(runtime_state: Mapping[str, object] | None) -> MdnsRegistrationConfig | None:
    raw_hostname = os.getenv(MDNS_HOSTNAME_ENV, "").strip()
    if not raw_hostname:
        return None

    hostname = _normalize_mdns_hostname(raw_hostname)
    addresses = _parse_mdns_addresses(os.getenv(MDNS_ADVERTISED_IPS_ENV))
    if not addresses:
        addresses = _extract_runtime_ip_candidates(runtime_state)

    if not addresses:
        raise ValueError(
            f"{MDNS_ADVERTISED_IPS_ENV} must be set to one or more LAN IPs when the runtime firmware target does not expose an IP address."
        )

    targets = _extract_runtime_targets(runtime_state)
    default_webapp_port = DEFAULT_WEBAPP_PORT
    if isinstance(targets, Mapping):
        api_base_url = targets.get("api_base_url")
        if isinstance(api_base_url, str) and api_base_url.strip():
            try:
                parsed = urlparse(api_base_url.strip())
            except ValueError:
                parsed = None
            if parsed is not None and parsed.port is not None:
                default_webapp_port = parsed.port

    discovery_service_name = os.getenv(MDNS_DISCOVERY_SERVICE_NAME_ENV, DEFAULT_DISCOVERY_SERVICE_NAME).strip()
    webapp_service_name = os.getenv(MDNS_WEBAPP_SERVICE_NAME_ENV, DEFAULT_WEBAPP_SERVICE_NAME).strip()

    return MdnsRegistrationConfig(
        hostname=hostname,
        addresses=tuple(addresses),
        discovery_port=_resolve_port(MDNS_DISCOVERY_PORT_ENV, DEFAULT_DISCOVERY_PORT),
        webapp_port=_resolve_port(MDNS_WEBAPP_PORT_ENV, default_webapp_port),
        discovery_service_name=discovery_service_name or DEFAULT_DISCOVERY_SERVICE_NAME,
        webapp_service_name=webapp_service_name or DEFAULT_WEBAPP_SERVICE_NAME,
    )


def build_mdns_service_infos(config: MdnsRegistrationConfig) -> tuple[ServiceInfo, ServiceInfo]:
    packed_addresses = [ipaddress.ip_address(address).packed for address in config.addresses]

    discovery_service = ServiceInfo(
        "_http._tcp.local.",
        f"{config.discovery_service_name}._http._tcp.local.",
        addresses=packed_addresses,
        port=config.discovery_port,
        properties={"path": DISCOVERY_PATH},
        server=config.fqdn,
    )
    webapp_service = ServiceInfo(
        "_https._tcp.local.",
        f"{config.webapp_service_name}._https._tcp.local.",
        addresses=packed_addresses,
        port=config.webapp_port,
        properties={},
        server=config.fqdn,
    )

    return discovery_service, webapp_service


class MdnsPublisher:
    def __init__(self, zeroconf_factory=AsyncZeroconf):
        self._zeroconf_factory = zeroconf_factory
        self._zeroconf: AsyncZeroconf | None = None
        self._services: list[ServiceInfo] = []

    async def start(self, config: MdnsRegistrationConfig) -> Sequence[ServiceInfo]:
        if self._zeroconf is not None:
            return tuple(self._services)

        zeroconf = self._zeroconf_factory(ip_version=IPVersion.All)
        services = list(build_mdns_service_infos(config))
        try:
            for service in services:
                await zeroconf.async_register_service(service, allow_name_change=True)
        except Exception:
            for service in reversed(services):
                with suppress(Exception):
                    await zeroconf.async_unregister_service(service)
            await zeroconf.async_close()
            raise

        self._zeroconf = zeroconf
        self._services = services
        return tuple(self._services)

    async def stop(self) -> None:
        if self._zeroconf is None:
            return

        for service in reversed(self._services):
            with suppress(Exception):
                await self._zeroconf.async_unregister_service(service)
        await self._zeroconf.async_close()
        self._services = []
        self._zeroconf = None
