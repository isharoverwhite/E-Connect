export type DeviceInfo = {
  ip: string;
  database: string;
  mqtt: string;
  protocol?: string;
  port?: string;
  websiteStatus: "online" | "offline";
};

export type DiscoveryScriptPayload = {
  status?: string | null;
  database?: string | null;
  mqtt?: string | null;
  firmware_network?: FirmwareNetworkPayload | null;
};

type FirmwareNetworkPayload = {
  advertised_host?: string | null;
  api_base_url?: string | null;
  webapp_protocol?: string | null;
  webapp_port?: string | number | null;
};

export const DEFAULT_WEBAPP_PROTOCOL = "http";
export const DEFAULT_WEBAPP_PORT = "3000";
export const DISCOVERY_SCRIPT_PORT = "8000";
export const DISCOVERY_SCRIPT_PATH = "/web-assistant.js";
export const DISCOVERY_TIMEOUT_MS = 1500;
export const WEBSITE_PROBE_TIMEOUT_MS = 1500;
export const COMMON_HOST_ALIASES = [
  "econnect.local",
  "e-connect.local",
  "econnect-server.local",
];

function normalizeDiscoveryHost(value: string | null | undefined): string | null {
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
  firmwareNetwork?: FirmwareNetworkPayload | null,
): { protocol: string; port: string } {
  const backendProtocol = normalizeProtocol(firmwareNetwork?.webapp_protocol);
  const backendPort = normalizePort(firmwareNetwork?.webapp_port);

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

export function resolveDiscoveryHost(
  probedHost: string,
  firmwareNetwork?: FirmwareNetworkPayload | null,
): string {
  return (
    normalizeDiscoveryHost(firmwareNetwork?.advertised_host) ??
    normalizeDiscoveryHost(firmwareNetwork?.api_base_url) ??
    normalizeDiscoveryHost(probedHost) ??
    probedHost.trim()
  );
}

export function buildWebappBaseUrl(ip: string, protocol = DEFAULT_WEBAPP_PROTOCOL, port = DEFAULT_WEBAPP_PORT): string {
  const normalizedProtocol = normalizeProtocol(protocol) ?? DEFAULT_WEBAPP_PROTOCOL;
  const normalizedPort = normalizePort(port) ?? DEFAULT_WEBAPP_PORT;
  const portSegment =
    (normalizedProtocol === "http" && normalizedPort === "80") ||
    (normalizedProtocol === "https" && normalizedPort === "443")
      ? ""
      : `:${normalizedPort}`;

  return `${normalizedProtocol}://${ip}${portSegment}`;
}

export function buildDiscoveryScriptUrl(host: string, callbackName: string): string {
  const normalizedHost = host.trim();
  const normalizedCallback = encodeURIComponent(callbackName);
  return `http://${normalizedHost}:${DISCOVERY_SCRIPT_PORT}${DISCOVERY_SCRIPT_PATH}?callback=${normalizedCallback}`;
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
