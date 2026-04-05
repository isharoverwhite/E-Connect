/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import { useState, useEffect } from "react";
import { API_URL, sendDeviceCommand } from "@/lib/api";
import { getToken } from "@/lib/auth";
import type { DeviceConfig } from "@/types/device";
import type { BuildJobStatus } from "@/features/diy/types";

export interface BuildJobSnapshot {
  status: BuildJobStatus;
  ota_token?: string | null;
  ota_download_url?: string | null;
  error_message?: string | null;
  expected_firmware_version?: string | null;
  staged_project_config?: Record<string, unknown> | null;
}

export const OTA_TERMINAL_STATUSES = new Set<BuildJobStatus>([
  "artifact_ready",
  "flashed",
  "build_failed",
  "flash_failed",
  "cancelled",
]);

export const OTA_POLL_FINAL_STATUSES = new Set<BuildJobStatus>([
  "flashed",
  "build_failed",
  "flash_failed",
  "cancelled",
]);

const OTA_DEVICE_POLL_INTERVAL_MS = 2000;
const OTA_ONLINE_FRESHNESS_GRACE_MS = 2000;

function parseTimestamp(value?: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function isExpectedFirmwareVersion(
  device: DeviceConfig | null,
  expectedFirmwareVersion: string | null,
): boolean {
  if (!expectedFirmwareVersion) {
    return true;
  }

  return device?.firmware_version?.trim() === expectedFirmwareVersion;
}

export function isDeviceBackOnlineAfterOta(
  device: DeviceConfig | null,
  flashedAt: number | null,
  expectedFirmwareVersion: string | null,
  otaStartingFirmwareVersion: string | null,
): boolean {
  if (!device || device.conn_status !== "online") {
    return false;
  }

  const reportedFirmwareVersion = device.firmware_version?.trim() || null;
  if (
    expectedFirmwareVersion &&
    reportedFirmwareVersion === expectedFirmwareVersion &&
    otaStartingFirmwareVersion !== expectedFirmwareVersion
  ) {
    return true;
  }

  if (flashedAt === null) {
    return false;
  }

  const lastSeenAt = parseTimestamp(device.last_seen);
  if (lastSeenAt === null) {
    return false;
  }

  return (
    lastSeenAt >= flashedAt - OTA_ONLINE_FRESHNESS_GRACE_MS &&
    isExpectedFirmwareVersion(device, expectedFirmwareVersion)
  );
}

export async function fetchBuildJob(jobId: string): Promise<BuildJobSnapshot> {
  const token = getToken();
  const response = await fetch(`${API_URL}/diy/build/${jobId}`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to load firmware build status");
  }

  return response.json();
}

export function buildReachableOtaUrl(apiBaseUrl: string, jobId: string, token: string): string {
  const otaUrl = new URL(apiBaseUrl);
  otaUrl.pathname = `/api/v1/diy/ota/download/${jobId}/firmware.bin`;
  otaUrl.search = new URLSearchParams({ token }).toString();
  return otaUrl.toString();
}

export interface UseOtaUpdateArgs {
  device: DeviceConfig | null;
  onDeviceUpdated?: (device: DeviceConfig) => void;
  fetchDeviceFn: (deviceId: string) => Promise<DeviceConfig | null>;
  onBuildJobUpdate?: (snapshot: BuildJobSnapshot) => void;
}

export function useOtaUpdate({ device, onDeviceUpdated, fetchDeviceFn, onBuildJobUpdate }: UseOtaUpdateArgs) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<BuildJobStatus | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [expectedFirmwareVersion, setExpectedFirmwareVersion] = useState<string | null>(null);
  const [otaModalOpen, setOtaModalOpen] = useState(false);
  const [sendingOta, setSendingOta] = useState(false);
  const [otaPassword, setOtaPassword] = useState("");
  const [otaActionError, setOtaActionError] = useState<string | null>(null);
  const [flashCompletedAt, setFlashCompletedAt] = useState<number | null>(null);
  const [boardOnlineAfterOta, setBoardOnlineAfterOta] = useState(false);
  const [otaStartingFirmwareVersion, setOtaStartingFirmwareVersion] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Poll Build Job
  useEffect(() => {
    if (!jobId || !otaModalOpen) {
      return;
    }

    let cancelled = false;
    let interval: number | null = null;

    const pollBuildJob = async () => {
      try {
        const snapshot = await fetchBuildJob(jobId);
        if (cancelled) {
          return;
        }

        setJobStatus(snapshot.status);
        setJobError(snapshot.error_message?.trim() || null);
        setExpectedFirmwareVersion(snapshot.expected_firmware_version?.trim() || null);
        
        onBuildJobUpdate?.(snapshot);

        if (OTA_POLL_FINAL_STATUSES.has(snapshot.status) && interval !== null) {
          window.clearInterval(interval);
          interval = null;
        }
      } catch (nextError) {
        if (!cancelled) {
          setJobError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      }
    };

    void pollBuildJob();
    interval = window.setInterval(() => {
      void pollBuildJob();
    }, 2000);

    return () => {
      cancelled = true;
      if (interval !== null) {
        window.clearInterval(interval);
      }
    };
  }, [jobId, otaModalOpen, onBuildJobUpdate]);

  // Handle flash completion timestamp
  useEffect(() => {
    if (jobStatus !== "flashed") {
      return;
    }
    setFlashCompletedAt((current) => current ?? Date.now());
  }, [jobStatus]);

  // Check if device is back online via properties from props
  useEffect(() => {
    if (jobStatus !== "flashed" || boardOnlineAfterOta) {
      return;
    }

    if (
      isDeviceBackOnlineAfterOta(
        device,
        flashCompletedAt,
        expectedFirmwareVersion,
        otaStartingFirmwareVersion,
      )
    ) {
      setBoardOnlineAfterOta(true);
    }
  }, [
    boardOnlineAfterOta,
    device,
    expectedFirmwareVersion,
    flashCompletedAt,
    jobStatus,
    otaStartingFirmwareVersion,
  ]);

  // Poll Device endpoint
  useEffect(() => {
    if (
      !otaModalOpen ||
      jobStatus !== "flashed" ||
      flashCompletedAt === null ||
      boardOnlineAfterOta ||
      !device
    ) {
      return;
    }

    let cancelled = false;
    let interval: number | null = null;

    const pollDeviceStatus = async () => {
      const snapshot = await fetchDeviceFn(device.device_id);
      if (cancelled || !snapshot) {
        return;
      }

      onDeviceUpdated?.(snapshot);
      if (
        isDeviceBackOnlineAfterOta(
          snapshot,
          flashCompletedAt,
          expectedFirmwareVersion,
          otaStartingFirmwareVersion,
        )
      ) {
        setBoardOnlineAfterOta(true);
        if (interval !== null) {
          window.clearInterval(interval);
          interval = null;
        }
      }
    };

    void pollDeviceStatus();
    interval = window.setInterval(() => {
      void pollDeviceStatus();
    }, OTA_DEVICE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (interval !== null) {
        window.clearInterval(interval);
      }
    };
  }, [
    boardOnlineAfterOta,
    device,
    expectedFirmwareVersion,
    flashCompletedAt,
    jobStatus,
    otaModalOpen,
    otaStartingFirmwareVersion,
    fetchDeviceFn,
    onDeviceUpdated
  ]);

  // Update Status message for flash completion
  useEffect(() => {
    if (!otaModalOpen || jobStatus !== "flashed") {
      return;
    }

    if (boardOnlineAfterOta) {
      setStatusMessage("The board is back online.");
      return;
    }

    if (
      device?.conn_status === "online" &&
      expectedFirmwareVersion &&
      device.firmware_version &&
      device.firmware_version !== expectedFirmwareVersion
    ) {
      setStatusMessage(
        `The board is online again but still reports firmware ${device.firmware_version}. Waiting for ${expectedFirmwareVersion}...`,
      );
      return;
    }

    setStatusMessage(
      expectedFirmwareVersion
        ? `OTA update completed. Waiting for the board to reconnect on firmware ${expectedFirmwareVersion}...`
        : "OTA update completed. Waiting for the board to reconnect and report online...",
    );
  }, [boardOnlineAfterOta, device, expectedFirmwareVersion, jobStatus, otaModalOpen]);

  const handleInitiateOta = async () => {
    if (!device || !jobId) {
      return;
    }

    setSendingOta(true);
    setJobError(null);
    setOtaActionError(null);
    setStatusMessage(null);
    setFlashCompletedAt(null);
    setBoardOnlineAfterOta(false);
    setOtaStartingFirmwareVersion(device.firmware_version?.trim() || null);

    try {
      const snapshot = await fetchBuildJob(jobId);
      if (!snapshot.ota_token) {
        throw new Error("Server did not provide an OTA token for this firmware build");
      }

      const stagedApiBaseUrl =
        snapshot.staged_project_config &&
          typeof snapshot.staged_project_config === "object" &&
          typeof snapshot.staged_project_config.api_base_url === "string"
          ? snapshot.staged_project_config.api_base_url
          : null;
      const firmwareUrl =
        snapshot.ota_download_url?.trim() ||
        (stagedApiBaseUrl ? buildReachableOtaUrl(stagedApiBaseUrl, jobId, snapshot.ota_token) : "");
      if (!firmwareUrl) {
        throw new Error("Server did not provide a reachable OTA download URL for this build");
      }
      const commandResult = await sendDeviceCommand(device.device_id, {
        kind: "system",
        action: "ota",
        payload: firmwareUrl,
        url: firmwareUrl,
        job_id: jobId,
        password: otaPassword,
      });

      if (commandResult.status === "failed") {
        throw new Error(commandResult.message || "Failed to publish OTA command");
      }

      setOtaPassword("");
      setJobStatus("flashing");
      setStatusMessage(
        "OTA command sent. Keep the board powered and on the same network until flashing completes.",
      );
    } catch (otaError) {
      setOtaActionError(otaError instanceof Error ? otaError.message : String(otaError));
    } finally {
      setSendingOta(false);
    }
  };

  const openPendingOtaModal = (pendingJobId: string) => {
    setOtaPassword("");
    setOtaActionError(null);
    setJobId(pendingJobId);
    setJobStatus(null);
    setJobError(null);
    setExpectedFirmwareVersion(null);
    setFlashCompletedAt(null);
    setBoardOnlineAfterOta(false);
    setOtaStartingFirmwareVersion(null);
    setOtaModalOpen(true);
  };

  return {
    jobId,
    setJobId,
    jobStatus,
    setJobStatus,
    jobError,
    setJobError,
    expectedFirmwareVersion,
    setExpectedFirmwareVersion,
    otaModalOpen,
    setOtaModalOpen,
    sendingOta,
    otaPassword,
    setOtaPassword,
    otaActionError,
    setOtaActionError,
    flashCompletedAt,
    setFlashCompletedAt,
    boardOnlineAfterOta,
    setBoardOnlineAfterOta,
    otaStartingFirmwareVersion,
    setOtaStartingFirmwareVersion,
    statusMessage,
    setStatusMessage,
    handleInitiateOta,
    openPendingOtaModal,
  };
}
