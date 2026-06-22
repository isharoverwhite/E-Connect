/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import { API_URL } from "./api";
import { getToken } from "./auth";

export interface RoomRecord {
    room_id: number;
    user_id: number;
    household_id?: number | null;
    name: string;
    allowed_user_ids?: number[];
    assigned_user_ids?: number[];
}

async function parseRoomError(response: Response) {
    const fallback = "Area request failed";

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

export async function fetchRooms(token?: string): Promise<RoomRecord[]> {
    const authToken = token ?? getToken();
    if (!authToken) {
        throw new Error("Missing session token. Please sign in again.");
    }

    const response = await fetch(`${API_URL}/rooms`, {
        headers: {
            Authorization: `Bearer ${authToken}`,
        },
        cache: "no-store",
    });

    if (!response.ok) {
        throw new Error(await parseRoomError(response));
    }

    return response.json();
}

export async function createRoom(
    payload: { name: string; allowed_user_ids?: number[] },
    token?: string,
): Promise<RoomRecord> {
    const authToken = token ?? getToken();
    if (!authToken) {
        throw new Error("Missing session token. Please sign in again.");
    }

    const response = await fetch(`${API_URL}/rooms`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error(await parseRoomError(response));
    }

    return response.json();
}

export async function updateRoomAccess(
    roomId: number,
    allowedUserIds: number[],
    token?: string,
): Promise<RoomRecord> {
    const authToken = token ?? getToken();
    if (!authToken) {
        throw new Error("Missing session token. Please sign in again.");
    }

    const response = await fetch(`${API_URL}/rooms/${roomId}/access`, {
        method: "PUT",
        headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ allowed_user_ids: allowedUserIds }),
    });

    if (!response.ok) {
        throw new Error(await parseRoomError(response));
    }

    return response.json();
}

export async function updateRoom(
    roomId: number,
    name: string,
    token?: string,
): Promise<RoomRecord> {
    const authToken = token ?? getToken();
    if (!authToken) {
        throw new Error("Missing session token. Please sign in again.");
    }

    const response = await fetch(`${API_URL}/rooms/${roomId}`, {
        method: "PUT",
        headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ name }),
    });

    if (!response.ok) {
        throw new Error(await parseRoomError(response));
    }

    return response.json();
}

export async function deleteRoom(
    roomId: number,
    token?: string,
): Promise<void> {
    const authToken = token ?? getToken();
    if (!authToken) {
        throw new Error("Missing session token. Please sign in again.");
    }

    const response = await fetch(`${API_URL}/rooms/${roomId}`, {
        method: "DELETE",
        headers: {
            Authorization: `Bearer ${authToken}`,
        },
    });

    if (!response.ok) {
        throw new Error(await parseRoomError(response));
    }
}
