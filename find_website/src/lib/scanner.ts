/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

export type DeviceInfo = {
  displayHost: string;
  launchHost: string;
  probeHost: string;
  advertisedHost?: string | null;
  database: string;
  mqtt: string;
  initialized: boolean | null;
  protocol?: string;
  port?: string;
  websiteStatus: "online" | "offline";
};

export type DiscoveryScriptPayload = {
  status?: string | null;
  database?: string | null;
  mqtt?: string | null;
  initialized?: boolean | null;
  server_ip?: string | null;
  webapp?: DiscoveryWebappPayload | null;
  firmware_network?: FirmwareNetworkPayload | null;
};

type DiscoveryWebappPayload = {
  protocol?: string | null;
  port?: string | number | null;
};

type FirmwareNetworkPayload = {
  advertised_host?: string | null;
  api_base_url?: string | null;
  webapp_protocol?: string | null;
  webapp_port?: string | number | null;
};

export type WebappTransport = {
  protocol: string;
  port: string;
};

export const DEFAULT_WEBAPP_PROTOCOL = "http";
export const DEFAULT_WEBAPP_PORT = "3000";
export const DISCOVERY_SCRIPT_PORT = "8000";
export const DISCOVERY_SCRIPT_PATH = "/web-assistant.js";
export const DISCOVERY_BRIDGE_PATH = "/discovery-bridge";
export const DISCOVERY_BRIDGE_STORAGE_KEY = "econnect.discovery.bridge";
export const DISCOVERY_HEALTH_PATH = "/health";
export const DISCOVERY_TIMEOUT_MS = 1500;
export const ALIAS_DISCOVERY_TIMEOUT_MS = 4000;
export const ALIAS_DISCOVERY_RETRY_COUNT = 1;
export const WEBSITE_PROBE_TIMEOUT_MS = 1500;
export const DISCOVERY_BRIDGE_TIMEOUT_MS = 4500;
export const EARLY_PRIORITY_HOST_LIMIT = 80;
export const COMMON_HOST_ALIASES = [
  "econnect.local",
  "e-connect.local",
  "econnect-server.local",
];
export const EARLY_PRIORITY_SUBNETS = [
  "192.168.1",
  "192.168.0",
  "192.168.2",
];

export function resolveDiscoveryAttemptBudget(host: string): { timeoutMs: number; attempts: number } {
  const normalizedHost = host.trim().toLowerCase();
  if (COMMON_HOST_ALIASES.includes(normalizedHost) || normalizedHost.endsWith(".local")) {
    return {
      timeoutMs: ALIAS_DISCOVERY_TIMEOUT_MS,
      attempts: ALIAS_DISCOVERY_RETRY_COUNT,
    };
  }

  return {
    timeoutMs: DISCOVERY_TIMEOUT_MS,
    attempts: 1,
  };
}

export function normalizeDiscoveryHost(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const rawValue = value.trim();

  try {
    if (rawValue.includes("://")) {
      const hostname = new URL(rawValue).hostname.trim().toLowerCase();
      return hostname || null;
    }

    const hostname = new URL(`http://${rawValue}`).hostname.trim().toLowerCase();
    return hostname || null;
  } catch {
    return null;
  }
}

function isPrivateIpv4Host(hostname: string): boolean {
  const octets = hostname.split(".").map((segment) => Number.parseInt(segment, 10));
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  if (octets[0] === 10 || octets[0] === 127) {
    return true;
  }

  if (octets[0] === 192 && octets[1] === 168) {
    return true;
  }

  return octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31;
}

export function extractPrivateIpv4DiscoveryHost(value: string | null | undefined): string | null {
  const hostname = normalizeDiscoveryHost(value);
  if (!hostname || !isPrivateIpv4Host(hostname)) {
    return null;
  }

  return hostname;
}

export function isLikelyPrivateDiscoveryHost(value: string | null | undefined): boolean {
  const hostname = normalizeDiscoveryHost(value);
  if (!hostname) {
    return false;
  }

  return hostname === "localhost" || hostname.endsWith(".local") || isPrivateIpv4Host(hostname);
}

export function resolvePrivateIpv4SubnetPrefix(value: string | null | undefined): string | null {
  const hostname = normalizeDiscoveryHost(value);
  if (!hostname || !isPrivateIpv4Host(hostname)) {
    return null;
  }

  const octets = hostname.split(".");
  return octets.length === 4 ? `${octets[0]}.${octets[1]}.${octets[2]}` : null;
}

function normalizeProtocol(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "http" || normalized === "https") {
    return normalized;
  }
  return null;
}

function normalizePort(value: string | number | null | undefined): string | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535) {
    return String(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    return null;
  }

  return String(parsed);
}

export function resolveWebappTransport(
  webapp?: DiscoveryWebappPayload | null,
  firmwareNetwork?: FirmwareNetworkPayload | null,
): WebappTransport {
  const backendProtocol = normalizeProtocol(webapp?.protocol) ?? normalizeProtocol(firmwareNetwork?.webapp_protocol);
  const backendPort = normalizePort(webapp?.port) ?? normalizePort(firmwareNetwork?.webapp_port);

  if (backendProtocol && backendPort) {
    return {
      protocol: backendProtocol,
      port: backendPort,
    };
  }

  if (typeof firmwareNetwork?.api_base_url === "string" && firmwareNetwork.api_base_url.trim()) {
    try {
      const rawApiBaseUrl = firmwareNetwork.api_base_url.trim();
      const parsedUrl = new URL(
        rawApiBaseUrl.includes("://") ? rawApiBaseUrl : `${DEFAULT_WEBAPP_PROTOCOL}://${rawApiBaseUrl}`,
      );

      return {
        protocol: backendProtocol ?? normalizeProtocol(parsedUrl.protocol.replace(":", "")) ?? DEFAULT_WEBAPP_PROTOCOL,
        port: backendPort ?? normalizePort(parsedUrl.port) ?? DEFAULT_WEBAPP_PORT,
      };
    } catch {
      // Fall through to the safe scanner defaults below.
    }
  }

  return {
    protocol: backendProtocol ?? DEFAULT_WEBAPP_PROTOCOL,
    port: backendPort ?? DEFAULT_WEBAPP_PORT,
  };
}

function appendWebappTransportCandidate(candidates: WebappTransport[], candidate: WebappTransport): void {
  if (
    candidates.some(
      (existing) => existing.protocol === candidate.protocol && existing.port === candidate.port,
    )
  ) {
    return;
  }

  candidates.push(candidate);
}

export function resolveWebappProbeTransports(
  webapp?: DiscoveryWebappPayload | null,
  firmwareNetwork?: FirmwareNetworkPayload | null,
  options?: { securePage?: boolean; probeHost?: string | null },
): WebappTransport[] {
  const primaryTransport = resolveWebappTransport(webapp, firmwareNetwork);
  const candidates: WebappTransport[] = [];
  const securePage = options?.securePage === true;
  const looksPrivateLanTarget =
    isLikelyPrivateDiscoveryHost(options?.probeHost) ||
    isLikelyPrivateDiscoveryHost(firmwareNetwork?.api_base_url) ||
    isLikelyPrivateDiscoveryHost(firmwareNetwork?.advertised_host);

  // Legacy deployments can still advertise https://<lan-host>:3000 even though the
  // compose WebUI now serves plain HTTP on 3000 and keeps HTTPS on a companion port.
  if (
    securePage &&
    looksPrivateLanTarget &&
    primaryTransport.protocol === "https" &&
    primaryTransport.port === DEFAULT_WEBAPP_PORT
  ) {
    appendWebappTransportCandidate(candidates, {
      protocol: DEFAULT_WEBAPP_PROTOCOL,
      port: DEFAULT_WEBAPP_PORT,
    });
  }

  appendWebappTransportCandidate(candidates, primaryTransport);

  return candidates;
}

export function resolveDiscoveryHost(
  probedHost: string,
  firmwareNetwork?: FirmwareNetworkPayload | null,
  serverIp?: string | null,
): string {
  return (
    resolveDiscoveryLanHost(probedHost, firmwareNetwork, serverIp) ??
    normalizeDiscoveryHost(firmwareNetwork?.advertised_host) ??
    normalizeDiscoveryHost(firmwareNetwork?.api_base_url) ??
    normalizeDiscoveryHost(probedHost) ??
    probedHost.trim()
  );
}

export function resolveDiscoveryLanHost(
  probedHost: string,
  firmwareNetwork?: FirmwareNetworkPayload | null,
  serverIp?: string | null,
): string | null {
  return (
    extractPrivateIpv4DiscoveryHost(serverIp) ??
    extractPrivateIpv4DiscoveryHost(firmwareNetwork?.api_base_url) ??
    extractPrivateIpv4DiscoveryHost(firmwareNetwork?.advertised_host) ??
    extractPrivateIpv4DiscoveryHost(probedHost)
  );
}

export function resolveDiscoveryAliasHost(
  probedHost: string,
  firmwareNetwork?: FirmwareNetworkPayload | null,
): string | null {
  const candidates = [
    normalizeDiscoveryHost(firmwareNetwork?.advertised_host),
    normalizeDiscoveryHost(firmwareNetwork?.api_base_url),
    normalizeDiscoveryHost(probedHost),
  ];

  for (const candidate of candidates) {
    if (candidate && !isPrivateIpv4Host(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function buildWebappBaseUrl(host: string, protocol = DEFAULT_WEBAPP_PROTOCOL, port = DEFAULT_WEBAPP_PORT): string {
  const normalizedProtocol = normalizeProtocol(protocol) ?? DEFAULT_WEBAPP_PROTOCOL;
  const normalizedPort = normalizePort(port) ?? DEFAULT_WEBAPP_PORT;
  const portSegment =
    (normalizedProtocol === "http" && normalizedPort === "80") ||
    (normalizedProtocol === "https" && normalizedPort === "443")
      ? ""
      : `:${normalizedPort}`;

  return `${normalizedProtocol}://${host}${portSegment}`;
}

export function buildDiscoveryScriptUrl(host: string, callbackName: string): string {
  const normalizedHost = host.trim();
  // Use an explicit window-qualified JSONP callback so the server response does not
  // depend on the browser creating a bare global identifier for dynamic callbacks.
  const normalizedCallback = encodeURIComponent(`window.${callbackName}`);
  return `http://${normalizedHost}:${DISCOVERY_SCRIPT_PORT}${DISCOVERY_SCRIPT_PATH}?callback=${normalizedCallback}`;
}

export function buildDiscoveryBridgeUrl(host: string, targetOrigin: string, requestId: string): string {
  const normalizedHost = host.trim();
  const normalizedTargetOrigin = encodeURIComponent(targetOrigin.trim());
  const normalizedRequestId = encodeURIComponent(requestId.trim());
  return `http://${normalizedHost}:${DISCOVERY_SCRIPT_PORT}${DISCOVERY_BRIDGE_PATH}?target_origin=${normalizedTargetOrigin}&request_id=${normalizedRequestId}`;
}

export function isDiscoveryPayloadCandidate(payload: unknown): payload is DiscoveryScriptPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as Record<string, unknown>;
  return candidate.status === "ok" || candidate.status === "degraded";
}

// Danh sách các subnet phổ biến của các dòng Modem/Router
export const COMMON_SUBNETS = [
  // Phổ biến nhất (VNPT, Viettel, FPT, TP-Link, Tenda, Linksys)
  "192.168.1",
  "192.168.0",
  "10.0.0",
  // Mesh & Router đời mới
  "192.168.68",  // TP-Link Deco Mesh
  "192.168.50",  // Asus Router đời mới
  "192.168.31",  // Xiaomi Router
  "192.168.88",  // MikroTik
  // Các Modem nhà mạng chuyên biệt (ZTE, Huawei GPON, Viettel)
  "192.168.100", 
  "192.168.8",
  "192.168.2",   // Belkin / Một số thiết bị cũ
  // Dải 10.x.x.x
  "10.10.10"
];

export const generateSubnetIps = (subnetPrefix: string): string[] => {
  const ips: string[] = [];
  for (let i = 1; i < 255; i++) {
    ips.push(`${subnetPrefix}.${i}`);
  }
  return ips;
};

export function buildCandidateHosts(preferredHosts: string[]): string[] {
  const preferredHostSet = new Set(preferredHosts.map((host) => host.trim()).filter(Boolean));
  const discoveredHosts: string[] = [];
  const discoveredHostSet = new Set<string>();

  const pushHost = (host: string) => {
    if (preferredHostSet.has(host) || discoveredHostSet.has(host)) {
      return;
    }

    discoveredHostSet.add(host);
    discoveredHosts.push(host);
  };

  const hotSubnets = COMMON_SUBNETS.filter((subnet) => EARLY_PRIORITY_SUBNETS.includes(subnet));
  const remainingSubnets = COMMON_SUBNETS.filter((subnet) => !EARLY_PRIORITY_SUBNETS.includes(subnet));

  // Interleave the hottest subnets so .0/.1/.2-style home LANs all get an early pass.
  for (let hostIndex = 1; hostIndex <= EARLY_PRIORITY_HOST_LIMIT; hostIndex += 1) {
    for (const subnet of hotSubnets) {
      pushHost(`${subnet}.${hostIndex}`);
    }
  }

  for (const subnet of hotSubnets) {
    for (let hostIndex = EARLY_PRIORITY_HOST_LIMIT + 1; hostIndex < 255; hostIndex += 1) {
      pushHost(`${subnet}.${hostIndex}`);
    }
  }

  for (const subnet of remainingSubnets) {
    for (const host of generateSubnetIps(subnet)) {
      pushHost(host);
    }
  }

  return discoveredHosts;
}
