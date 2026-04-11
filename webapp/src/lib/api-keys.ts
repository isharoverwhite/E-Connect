/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import { API_URL } from "./api";
import { getToken } from "./auth";

export interface ApiKeyRecord {
  key_id: string;
  label: string;
  token_prefix: string;
  created_at?: string | null;
  last_used_at?: string | null;
  revoked_at?: string | null;
  is_revoked: boolean;
}

export interface ApiKeyCreatePayload {
  label: string;
}

export interface ApiKeyCreateResult extends ApiKeyRecord {
  api_key: string;
}

async function parseApiKeyError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as {
      detail?: string | { message?: string; error?: string };
    };

    if (typeof payload.detail === "string") {
      return payload.detail;
    }

    if (payload.detail?.message) {
      return payload.detail.message;
    }

    if (payload.detail?.error) {
      return payload.detail.error;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function requireToken(token?: string): string {
  const authToken = token ?? getToken();
  if (!authToken) {
    throw new Error("Missing session token. Please sign in again.");
  }
  return authToken;
}

export async function fetchApiKeys(token?: string): Promise<ApiKeyRecord[]> {
  const authToken = requireToken(token);
  const response = await fetch(`${API_URL}/api-keys`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await parseApiKeyError(response, "Failed to load API keys"));
  }

  return response.json();
}

export async function createApiKey(
  payload: ApiKeyCreatePayload,
  token?: string,
): Promise<ApiKeyCreateResult> {
  const authToken = requireToken(token);
  const response = await fetch(`${API_URL}/api-keys`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await parseApiKeyError(response, "Failed to create API key"));
  }

  return response.json();
}

export async function revokeApiKey(keyId: string, token?: string): Promise<ApiKeyRecord> {
  const authToken = requireToken(token);
  const response = await fetch(`${API_URL}/api-keys/${encodeURIComponent(keyId)}/revoke`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(await parseApiKeyError(response, "Failed to revoke API key"));
  }

  return response.json();
}
