const warnedMessages = new Set<string>();

function warnOnce(message: string) {
  if (warnedMessages.has(message)) {
    return;
  }

  warnedMessages.add(message);
  console.warn(message);
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

export function resolvePublicApiBaseUrl(rawValue?: string): string {
  const configuredValue = rawValue?.trim();
  if (!configuredValue) {
    return "/api/v1";
  }

  if (configuredValue.startsWith("/")) {
    return trimTrailingSlash(configuredValue);
  }

  try {
    const url = new URL(configuredValue);
    if (url.protocol !== "https:") {
      warnOnce(
        `[https] Ignoring NEXT_PUBLIC_API_URL=${configuredValue} because the frontend only allows relative paths or absolute https:// API origins.`,
      );
      return "/api/v1";
    }

    return trimTrailingSlash(url.toString());
  } catch {
    warnOnce(
      `[https] Ignoring NEXT_PUBLIC_API_URL=${configuredValue} because it is not a valid relative path or absolute https:// URL.`,
    );
    return "/api/v1";
  }
}

export function resolvePublicWebSocketBaseUrl(rawValue?: string): string | null {
  const configuredValue = rawValue?.trim();
  if (!configuredValue) {
    return null;
  }

  if (configuredValue.startsWith("/")) {
    if (typeof window === "undefined" || window.location.protocol !== "https:") {
      warnOnce(
        `[https] Ignoring NEXT_PUBLIC_WS_URL=${configuredValue} because the frontend only opens WebSocket connections from an HTTPS origin.`,
      );
      return null;
    }

    return `wss://${window.location.host}${trimTrailingSlash(configuredValue)}`;
  }

  try {
    const url = new URL(configuredValue);
    if (url.protocol !== "wss:") {
      warnOnce(
        `[https] Ignoring NEXT_PUBLIC_WS_URL=${configuredValue} because the frontend only allows relative paths or absolute wss:// WebSocket origins.`,
      );
      return null;
    }

    return trimTrailingSlash(url.toString());
  } catch {
    warnOnce(
      `[https] Ignoring NEXT_PUBLIC_WS_URL=${configuredValue} because it is not a valid relative path or absolute wss:// URL.`,
    );
    return null;
  }
}

export function resolveSameOriginWebSocketBaseUrl(): string | null {
  if (typeof window === "undefined" || window.location.protocol !== "https:") {
    warnOnce("[https] Refusing to open an insecure ws:// channel because the frontend is HTTPS-only.");
    return null;
  }

  return `wss://${window.location.host}/api/v1/ws`;
}

export function buildProvisioningHeaders(): HeadersInit {
  if (typeof window === "undefined") {
    return {};
  }

  return {
    "X-EConnect-Origin": window.location.origin,
  };
}
