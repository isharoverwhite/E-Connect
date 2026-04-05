# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

from app.services import mdns
from zeroconf._exceptions import NonUniqueNameException


def test_resolve_mdns_registration_config_uses_runtime_ip_targets(monkeypatch):
    monkeypatch.setenv("MDNS_HOSTNAME", "econnect.local")
    monkeypatch.delenv("MDNS_ADVERTISED_IPS", raising=False)
    monkeypatch.delenv("MDNS_DISCOVERY_PORT", raising=False)
    monkeypatch.delenv("MDNS_WEBAPP_PORT", raising=False)

    config = mdns.resolve_mdns_registration_config(
        {
            "targets": {
                "advertised_host": "192.168.2.65",
                "api_base_url": "https://192.168.2.65:3000/api/v1",
                "mqtt_broker": "192.168.2.65",
                "mqtt_port": 1883,
            }
        }
    )

    assert config is not None
    assert config.hostname == "econnect.local"
    assert config.addresses == ("192.168.2.65",)
    assert config.discovery_port == 8000
    assert config.webapp_port == 3443


def test_resolve_mdns_registration_config_uses_explicit_ips_without_runtime_state(monkeypatch):
    monkeypatch.setenv("MDNS_HOSTNAME", "econnect.local")
    monkeypatch.setenv("MDNS_ADVERTISED_IPS", "192.168.2.65")
    monkeypatch.delenv("MDNS_DISCOVERY_PORT", raising=False)
    monkeypatch.delenv("MDNS_WEBAPP_PORT", raising=False)

    config = mdns.resolve_mdns_registration_config(None)

    assert config is not None
    assert config.hostname == "econnect.local"
    assert config.addresses == ("192.168.2.65",)
    assert config.discovery_port == 8000
    assert config.webapp_port == 3443


def test_resolve_mdns_registration_config_prefers_explicit_ips(monkeypatch):
    monkeypatch.setenv("MDNS_HOSTNAME", "econnect.local")
    monkeypatch.setenv("MDNS_ADVERTISED_IPS", "192.168.2.65,192.168.2.66")
    monkeypatch.setenv("MDNS_WEBAPP_PORT", "3443")

    config = mdns.resolve_mdns_registration_config(
        {
            "targets": {
                "advertised_host": "192.168.2.65",
                "api_base_url": "https://192.168.2.65:3000/api/v1",
            }
        }
    )

    assert config is not None
    assert config.addresses == ("192.168.2.65", "192.168.2.66")
    assert config.webapp_port == 3443


def test_resolve_mdns_registration_config_rejects_non_local_hostname(monkeypatch):
    monkeypatch.setenv("MDNS_HOSTNAME", "econnect.internal")

    try:
        mdns.resolve_mdns_registration_config(None)
    except ValueError as exc:
        assert "must end with .local" in str(exc)
    else:
        raise AssertionError("Expected a ValueError for non-.local hostname")


def test_resolve_mdns_registration_config_requires_ip_when_runtime_target_is_alias(monkeypatch):
    monkeypatch.setenv("MDNS_HOSTNAME", "econnect.local")
    monkeypatch.delenv("MDNS_ADVERTISED_IPS", raising=False)

    try:
        mdns.resolve_mdns_registration_config(
            {
                "targets": {
                    "advertised_host": "econnect.local",
                    "api_base_url": "https://econnect.local:3000/api/v1",
                }
            }
        )
    except ValueError as exc:
        assert "MDNS_ADVERTISED_IPS" in str(exc)
    else:
        raise AssertionError("Expected a ValueError when no LAN IP is available")


class DummyAsyncZeroconf:
    def __init__(self, ip_version=None):
        self.ip_version = ip_version
        self.registered = []
        self.unregistered = []
        self.closed = False

    async def async_register_service(self, service, ttl=None, allow_name_change=False, cooperating_responders=False, strict=True):
        self.registered.append(
            {
                "service": service,
                "ttl": ttl,
                "allow_name_change": allow_name_change,
                "cooperating_responders": cooperating_responders,
                "strict": strict,
            }
        )

    async def async_unregister_service(self, service):
        self.unregistered.append(service)

    async def async_close(self):
        self.closed = True


def test_mdns_publisher_registers_and_stops_services():
    publisher = mdns.MdnsPublisher(zeroconf_factory=DummyAsyncZeroconf)
    config = mdns.MdnsRegistrationConfig(
        hostname="econnect.local",
        addresses=("192.168.2.65",),
        discovery_port=8000,
        webapp_port=3443,
        discovery_service_name="E-Connect Discovery",
        webapp_service_name="E-Connect WebUI",
    )

    import asyncio

    services = asyncio.run(publisher.start(config))

    assert len(services) == 2
    assert services[0].server == "econnect.local."
    assert services[0].port == 8000
    assert services[1].server == "econnect.local."
    assert services[1].port == 3443

    zeroconf = publisher._zeroconf
    assert zeroconf is not None
    assert len(zeroconf.registered) == 2
    assert all(entry["allow_name_change"] is True for entry in zeroconf.registered)
    assert zeroconf.registered[0]["service"].server == "econnect.local."
    assert zeroconf.registered[0]["service"].port == 8000
    assert zeroconf.registered[1]["service"].server == "econnect.local."
    assert zeroconf.registered[1]["service"].port == 3443

    asyncio.run(publisher.stop())

    assert len(zeroconf.unregistered) == 2
    assert zeroconf.closed is True


class DummyAsyncZeroconfNameConflict(DummyAsyncZeroconf):
    async def async_register_service(self, service, ttl=None, allow_name_change=False, cooperating_responders=False, strict=True):
        if not allow_name_change:
            raise NonUniqueNameException
        await super().async_register_service(
            service,
            ttl=ttl,
            allow_name_change=allow_name_change,
            cooperating_responders=cooperating_responders,
            strict=strict,
        )


def test_mdns_publisher_allows_service_name_change_when_name_exists():
    publisher = mdns.MdnsPublisher(zeroconf_factory=DummyAsyncZeroconfNameConflict)
    config = mdns.MdnsRegistrationConfig(
        hostname="econnect.local",
        addresses=("192.168.2.65",),
        discovery_port=8000,
        webapp_port=3443,
        discovery_service_name="E-Connect Discovery",
        webapp_service_name="E-Connect WebUI",
    )

    import asyncio

    services = asyncio.run(publisher.start(config))

    assert len(services) == 2

    zeroconf = publisher._zeroconf
    assert zeroconf is not None
    assert len(zeroconf.registered) == 2
    assert all(entry["allow_name_change"] is True for entry in zeroconf.registered)
