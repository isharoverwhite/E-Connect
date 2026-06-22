/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

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

function resolvePageWebSocketProtocol(): "ws" | "wss" | null {
  if (typeof window === "undefined") {
    return null;
  }

  if (window.location.protocol === "https:") {
    return "wss";
  }

  if (window.location.protocol === "http:") {
    return "ws";
  }

  return null;
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
  const wsProtocol = resolvePageWebSocketProtocol();
  if (!configuredValue) {
    return null;
  }

  if (configuredValue.startsWith("/")) {
    if (!wsProtocol || typeof window === "undefined") {
      warnOnce(
        `[ws] Ignoring NEXT_PUBLIC_WS_URL=${configuredValue} because the frontend is not running on an HTTP(S) origin.`,
      );
      return null;
    }

    return `${wsProtocol}://${window.location.host}${trimTrailingSlash(configuredValue)}`;
  }

  try {
    const url = new URL(configuredValue);
    if (!["ws:", "wss:"].includes(url.protocol)) {
      warnOnce(
        `[ws] Ignoring NEXT_PUBLIC_WS_URL=${configuredValue} because the frontend only allows relative paths or absolute ws:// / wss:// WebSocket origins.`,
      );
      return null;
    }

    if (typeof window !== "undefined" && window.location.protocol === "https:" && url.protocol !== "wss:") {
      warnOnce(
        `[ws] Ignoring NEXT_PUBLIC_WS_URL=${configuredValue} because an HTTPS page must not downgrade to ws://.`,
      );
      return null;
    }

    return trimTrailingSlash(url.toString());
  } catch {
    warnOnce(
      `[ws] Ignoring NEXT_PUBLIC_WS_URL=${configuredValue} because it is not a valid relative path or absolute ws:// / wss:// URL.`,
    );
    return null;
  }
}

export function resolveSameOriginWebSocketBaseUrl(): string | null {
  const wsProtocol = resolvePageWebSocketProtocol();
  if (typeof window === "undefined" || !wsProtocol) {
    warnOnce("[ws] Refusing to open a WebSocket channel because the frontend is not running on an HTTP(S) origin.");
    return null;
  }

  return `${wsProtocol}://${window.location.host}/api/v1/ws`;
}

export function buildProvisioningHeaders(): HeadersInit {
  if (typeof window === "undefined") {
    return {};
  }

  return {
    "X-EConnect-Origin": window.location.origin,
  };
}
