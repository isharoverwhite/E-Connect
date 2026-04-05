/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import { API_URL } from "./api";
import { getToken } from "./auth";
import {
  AutomationRecord,
  GraphAutomationPayload,
  AutomationMutationPayload,
  TriggerResult,
  AutomationScheduleContext,
} from "@/types/automation";

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: string | { message?: string }; message?: string };
    if (typeof payload.detail === "string" && payload.detail.trim()) return payload.detail;
    if (payload.detail && typeof payload.detail === "object" && typeof payload.detail.message === "string") {
      return payload.detail.message;
    }
    if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
  } catch {
    // Ignore invalid JSON bodies and fall back to status-based messaging.
  }
  return `${fallback}: ${response.status}`;
}

export async function fetchAutomations(): Promise<AutomationRecord[]> {
  const res = await fetch(`${API_URL}/automations`, { cache: "no-store", headers: authHeaders() });
  if (!res.ok) throw new Error(await readApiError(res, "Failed to load automations"));
  return res.json();
}

export async function createAutomation(payload: GraphAutomationPayload): Promise<AutomationRecord> {
  const res = await fetch(`${API_URL}/automation`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readApiError(res, "Create failed"));
  return res.json();
}

export async function updateAutomation(id: number, payload: AutomationMutationPayload): Promise<AutomationRecord> {
  const res = await fetch(`${API_URL}/automation/${id}`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readApiError(res, "Update failed"));
  return res.json();
}

export async function deleteAutomation(id: number): Promise<{ message: string }> {
  const res = await fetch(`${API_URL}/automation/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readApiError(res, "Delete failed"));
  return res.json();
}

export async function triggerAutomation(id: number): Promise<TriggerResult> {
  const res = await fetch(`${API_URL}/automation/${id}/trigger`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readApiError(res, "Trigger failed"));
  return res.json();
}

export async function fetchAutomationScheduleContext(): Promise<AutomationScheduleContext> {
  const res = await fetch(`${API_URL}/automation/schedule-context`, {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readApiError(res, "Failed to load server time context"));
  return res.json();
}
