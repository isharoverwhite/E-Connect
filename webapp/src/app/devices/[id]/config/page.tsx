"use client";

import { use, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  API_URL,
  fetchDevice,
  fetchRuntimeNetworkInfo,
  saveDeviceConfig,
  sendDeviceCommand,
} from "@/lib/api";
import { getToken } from "@/lib/auth";
import { arePinConfigurationsEquivalent, getActivePinConfigurations } from "@/lib/device-config";
import { fetchWifiCredentials, type WifiCredentialRecord } from "@/lib/wifi-credentials";
import { Step2Pins } from "@/features/diy/components/Step2Pins";
import type { BoardProfile } from "@/features/diy/board-profiles";
import { getBoardProfile, resolveBoardProfileId } from "@/features/diy/board-profiles";
import type { BuildJobStatus, PinMapping } from "@/features/diy/types";
import { validatePinMappings } from "@/features/diy/validation";
import { useWebSocket } from "@/hooks/useWebSocket";
import type { DeviceConfig, PinConfig } from "@/types/device";

interface DiyProjectResponse {
  config?: Record<string, unknown> | null;
  board_profile: string;
  name?: string;
  wifi_credential_id?: number | null;
}

interface BuildJobSnapshot {
  status: BuildJobStatus;
  ota_token?: string | null;
  error_message?: string | null;
  expected_firmware_version?: string | null;
}

const OTA_TERMINAL_STATUSES = new Set<BuildJobStatus>([
  "artifact_ready",
  "flashed",
  "build_failed",
  "flash_failed",
  "cancelled",
]);
const OTA_POLL_FINAL_STATUSES = new Set<BuildJobStatus>([
  "flashed",
  "build_failed",
  "flash_failed",
  "cancelled",
]);
const OTA_DEVICE_POLL_INTERVAL_MS = 2000;
const OTA_REDIRECT_DELAY_MS = 1800;
const OTA_ONLINE_FRESHNESS_GRACE_MS = 2000;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mapDevicePins(pinConfigurations: PinConfig[]): PinMapping[] {
  return pinConfigurations
    .map((pin) => ({
      gpio_pin: pin.gpio_pin,
      mode: pin.mode,
      function: pin.function,
      label: pin.label,
      extra_params: pin.extra_params ?? {},
    }))
    .sort((left, right) => left.gpio_pin - right.gpio_pin);
}

function mapProjectPins(projectConfig: Record<string, unknown> | null | undefined): PinMapping[] {
  const rawPins = Array.isArray(projectConfig?.pins) ? projectConfig.pins : [];
  const mappedPins: Array<PinMapping | null> = rawPins.map((pin) => {
    if (!pin || typeof pin !== "object") {
      return null;
    }

    const record = pin as Record<string, unknown>;
    const gpio =
      typeof record.gpio_pin === "number"
        ? record.gpio_pin
        : typeof record.gpio === "number"
          ? record.gpio
          : null;
    const mode = typeof record.mode === "string" ? record.mode : null;
    if (gpio === null || mode === null) {
      return null;
    }

    return {
      gpio_pin: gpio,
      mode: mode as PinMapping["mode"],
      function: typeof record.function === "string" ? record.function : undefined,
      label: typeof record.label === "string" ? record.label : undefined,
      extra_params:
        record.extra_params && typeof record.extra_params === "object"
          ? (record.extra_params as Record<string, unknown>)
          : null,
    };
  });

  return mappedPins
    .filter((pin): pin is PinMapping => pin !== null)
    .sort((left, right) => left.gpio_pin - right.gpio_pin);
}

function normalizePins(pins: PinMapping[]): PinMapping[] {
  return [...pins]
    .map((pin) => ({
      gpio_pin: pin.gpio_pin,
      mode: pin.mode,
      function: pin.function?.trim() || "",
      label: pin.label?.trim() || "",
      extra_params: pin.extra_params ?? null,
    }))
    .sort((left, right) => left.gpio_pin - right.gpio_pin);
}

function serializePins(pins: PinMapping[]): string {
  return JSON.stringify(normalizePins(pins));
}

function parseTimestamp(value?: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function isExpectedFirmwareVersion(
  device: DeviceConfig | null,
  expectedFirmwareVersion: string | null,
): boolean {
  if (!expectedFirmwareVersion) {
    return true;
  }

  return device?.firmware_version?.trim() === expectedFirmwareVersion;
}

function isDeviceBackOnlineAfterOta(
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

async function fetchBuildJob(jobId: string): Promise<BuildJobSnapshot> {
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

function buildReachableOtaUrl(apiBaseUrl: string, jobId: string, token: string): string {
  const otaUrl = new URL(apiBaseUrl);
  otaUrl.pathname = `/api/v1/diy/ota/download/${jobId}/firmware.bin`;
  otaUrl.search = new URLSearchParams({ token }).toString();
  return otaUrl.toString();
}

export default function DevicePinConfigurator({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { user } = useAuth();
  const resolvedParams = use(params);
  const deviceId = resolvedParams.id;
  const isAdmin = user?.account_type === "admin";

  const [device, setDevice] = useState<DeviceConfig | null>(null);
  const [project, setProject] = useState<DiyProjectResponse | null>(null);
  const [boardProfile, setBoardProfile] = useState<BoardProfile | null>(null);
  const [pins, setPins] = useState<PinMapping[]>([]);
  const [savedPins, setSavedPins] = useState<PinMapping[]>([]);
  const [wifiCredentials, setWifiCredentials] = useState<WifiCredentialRecord[]>([]);
  const [wifiCredentialsLoading, setWifiCredentialsLoading] = useState(true);
  const [wifiCredentialsError, setWifiCredentialsError] = useState<string | null>(null);
  const [selectedWifiCredentialId, setSelectedWifiCredentialId] = useState<number | null>(null);
  const [savedWifiCredentialId, setSavedWifiCredentialId] = useState<number | null>(null);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<BuildJobStatus | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [expectedFirmwareVersion, setExpectedFirmwareVersion] = useState<string | null>(null);
  const [otaModalOpen, setOtaModalOpen] = useState(false);
  const [sendingOta, setSendingOta] = useState(false);
  const [flashCompletedAt, setFlashCompletedAt] = useState<number | null>(null);
  const [boardOnlineAfterOta, setBoardOnlineAfterOta] = useState(false);
  const [otaStartingFirmwareVersion, setOtaStartingFirmwareVersion] = useState<string | null>(null);

  useWebSocket((event) => {
    if (!("device_id" in event) || event.device_id !== deviceId) {
      return;
    }

    const reportedAt =
      typeof event.payload?.reported_at === "string" ? event.payload.reported_at : null;
    const reportedFirmwareVersion =
      typeof event.payload?.firmware_version === "string" ? event.payload.firmware_version : null;
    const reportedFirmwareRevision =
      typeof event.payload?.firmware_revision === "string"
        ? event.payload.firmware_revision
        : null;

    setDevice((current) => {
      if (!current || current.device_id !== event.device_id) {
        return current;
      }

      if (event.type === "device_online") {
        return {
          ...current,
          conn_status: "online",
          firmware_revision: reportedFirmwareRevision ?? current.firmware_revision,
          firmware_version: reportedFirmwareVersion ?? current.firmware_version,
          last_seen: reportedAt ?? new Date().toISOString(),
        };
      }

      if (event.type === "device_offline") {
        return {
          ...current,
          conn_status: "offline",
        };
      }

      if (event.type === "device_state") {
        return {
          ...current,
          conn_status: "online",
          firmware_revision: reportedFirmwareRevision ?? current.firmware_revision,
          firmware_version: reportedFirmwareVersion ?? current.firmware_version,
          last_state: (event.payload ?? null) as DeviceConfig["last_state"],
          last_seen: reportedAt ?? new Date().toISOString(),
        };
      }

      if (event.type === "command_delivery") {
        return {
          ...current,
          last_delivery: (event.payload ?? null) as DeviceConfig["last_delivery"],
        };
      }

      return current;
    });
  });

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const init = async () => {
      setLoading(true);
      setError(null);

      try {
        const nextDevice = await fetchDevice(deviceId);
        if (!nextDevice) {
          throw new Error("Device not found");
        }
        if (!nextDevice.provisioning_project_id) {
          throw new Error("Pin configuration is only available for managed DIY devices.");
        }

        const token = getToken();
        if (!token) {
          throw new Error("Missing session token. Please sign in again.");
        }
        const projectResponse = await fetch(
          `${API_URL}/diy/projects/${nextDevice.provisioning_project_id}`,
          {
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );
        if (!projectResponse.ok) {
          throw new Error("Failed to load the linked DIY project");
        }

        const nextProject = (await projectResponse.json()) as DiyProjectResponse;
        const nextWifiCredentials = await fetchWifiCredentials(token);
        const resolvedBoardId =
          resolveBoardProfileId(nextProject.board_profile) ?? nextProject.board_profile;
        const nextBoardProfile = getBoardProfile(resolvedBoardId);
        if (!nextBoardProfile) {
          throw new Error(`Unknown board profile: ${nextProject.board_profile}`);
        }

        const nextPins = mapProjectPins(nextProject.config);
        const nextSavedPins =
          nextPins.length > 0 ? nextPins : mapDevicePins(getActivePinConfigurations(nextDevice));
        if (cancelled) {
          return;
        }

        setDevice(nextDevice);
        setProject(nextProject);
        setBoardProfile(nextBoardProfile);
        setWifiCredentials(nextWifiCredentials);
        setWifiCredentialsError(null);
        setWifiCredentialsLoading(false);
        setPins(nextSavedPins);
        setSavedPins(nextSavedPins);
        setSelectedWifiCredentialId(nextProject.wifi_credential_id ?? null);
        setSavedWifiCredentialId(nextProject.wifi_credential_id ?? null);
      } catch (nextError) {
        if (!cancelled) {
          setWifiCredentialsLoading(false);
          const message = getErrorMessage(nextError);
          setWifiCredentialsError(message);
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void init();

    return () => {
      cancelled = true;
    };
  }, [deviceId, isAdmin]);

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
        if (OTA_POLL_FINAL_STATUSES.has(snapshot.status) && interval !== null) {
          window.clearInterval(interval);
          interval = null;
        }
      } catch (nextError) {
        if (!cancelled) {
          setJobError(getErrorMessage(nextError));
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
  }, [jobId, otaModalOpen]);

  useEffect(() => {
    if (jobStatus !== "flashed") {
      return;
    }

    setFlashCompletedAt((current) => current ?? Date.now());
  }, [jobStatus]);

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

  useEffect(() => {
    if (
      !otaModalOpen ||
      jobStatus !== "flashed" ||
      flashCompletedAt === null ||
      boardOnlineAfterOta
    ) {
      return;
    }

    let cancelled = false;
    let interval: number | null = null;

    const pollDeviceStatus = async () => {
      const snapshot = await fetchDevice(deviceId);
      if (cancelled || !snapshot) {
        return;
      }

      setDevice(snapshot);
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
    deviceId,
    expectedFirmwareVersion,
    flashCompletedAt,
    jobStatus,
    otaModalOpen,
    otaStartingFirmwareVersion,
  ]);

  useEffect(() => {
    if (!otaModalOpen || jobStatus !== "flashed") {
      return;
    }

    if (boardOnlineAfterOta) {
      setStatusMessage("The board is back online. Returning to the dashboard...");
      return;
    }

    if (
      device?.conn_status === "online" &&
      expectedFirmwareVersion &&
      device.firmware_version &&
      device.firmware_version !== expectedFirmwareVersion
    ) {
      setStatusMessage(
        `The board is online again but still reports firmware ${device.firmware_version}. Waiting for ${expectedFirmwareVersion} before leaving this page.`,
      );
      return;
    }

    setStatusMessage(
      expectedFirmwareVersion
        ? `OTA update completed. Waiting for the board to reconnect on firmware ${expectedFirmwareVersion} before returning to the dashboard.`
        : "OTA update completed. Waiting for the board to reconnect and report online before returning to the dashboard.",
    );
  }, [boardOnlineAfterOta, device, expectedFirmwareVersion, jobStatus, otaModalOpen]);

  useEffect(() => {
    if (!boardOnlineAfterOta) {
      return;
    }

    const timeout = window.setTimeout(() => {
      router.push("/");
    }, OTA_REDIRECT_DELAY_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [boardOnlineAfterOta, router]);

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 dark:bg-slate-950">
        <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">
            <span className="material-icons-round text-4xl">admin_panel_settings</span>
          </div>
          <h1 className="mt-5 text-2xl font-semibold text-slate-900 dark:text-white">
            Admin access required
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
            Managed device reconfiguration is restricted to administrators because unsafe GPIO
            changes can damage connected hardware.
          </p>
          <button
            className="mt-6 rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-blue-600"
            onClick={() => router.push("/devices")}
            type="button"
          >
            Back to devices
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 dark:bg-slate-950">
        <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            Loading managed device configuration...
          </p>
        </div>
      </div>
    );
  }

  if (error || !device || !project || !boardProfile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 dark:bg-slate-950">
        <div className="w-full max-w-xl rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-sm dark:border-rose-500/20 dark:bg-slate-900">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 text-rose-500 dark:bg-rose-500/10 dark:text-rose-300">
            <span className="material-icons-round text-4xl">error</span>
          </div>
          <h1 className="mt-5 text-2xl font-semibold text-slate-900 dark:text-white">
            Unable to load this board config
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
            {error ?? "The linked managed DIY project could not be resolved."}
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              onClick={() => router.push("/devices")}
              type="button"
            >
              Back to devices
            </button>
            <button
              className="rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-blue-600"
              onClick={() => router.refresh()}
              type="button"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const validation = validatePinMappings(boardProfile, pins);
  const hasWifiCredentialSelection = selectedWifiCredentialId !== null;
  const canInitiateOta = jobStatus === "artifact_ready" || jobStatus === "flash_failed";
  if (!hasWifiCredentialSelection) {
    validation.errors.push("Select a saved Wi-Fi credential before rebuilding this board.");
  }
  const hasChanges =
    serializePins(pins) !== serializePins(savedPins) ||
    selectedWifiCredentialId !== savedWifiCredentialId;
  const pinPreview = {
    board_profile: project.board_profile,
    device_id: device.device_id,
    device_name: device.name,
    wifi_credential_id: selectedWifiCredentialId,
    pins: normalizePins(pins),
  };
  const activeBoardPinConfigurations = getActivePinConfigurations(device);
  const activeBoardPins = mapDevicePins(activeBoardPinConfigurations);
  const hasBoardReportedPins = activeBoardPinConfigurations.length > 0;
  const boardConfigInSync =
    hasBoardReportedPins &&
    arePinConfigurationsEquivalent(activeBoardPinConfigurations, savedPins);
  const activeFirmwareVersion = device.firmware_version?.trim() || null;
  const projectSyncState = isSaving ? "saving" : hasChanges ? "idle" : "saved";
  const statusMessageClassName =
    jobStatus === "flashed" && !boardOnlineAfterOta
      ? "rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-800 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200"
      : "rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200";

  const openConfirmModal = () => {
    if (isSaving || !hasChanges || validation.errors.length > 0) {
      return;
    }

    setStatusMessage(null);
    setConfirmError(null);
    setConfirmModalOpen(true);
  };

  const closeConfirmModal = () => {
    if (isSaving) {
      return;
    }

    setConfirmModalOpen(false);
    setConfirmPassword("");
    setConfirmError(null);
  };

  const exportConfig = async () => {
    const blob = new Blob([JSON.stringify(pinPreview, null, 2)], {
      type: "application/json",
    });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${device.device_id}-pin-config.json`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  const handleBuildSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setConfirmError(null);
    setStatusMessage(null);
    setIsSaving(true);

    try {
      const result = await saveDeviceConfig(device.device_id, {
        pins,
        password: confirmPassword,
        wifi_credential_id: selectedWifiCredentialId,
      });

      if (result.status !== "success" || !result.job_id) {
        throw new Error(result.message || "Failed to save configuration");
      }

      const nextSavedPins = normalizePins(pins);
      setSavedPins(nextSavedPins);
      setSavedWifiCredentialId(selectedWifiCredentialId);
      setProject((current) =>
        current
          ? {
              ...current,
              wifi_credential_id: selectedWifiCredentialId,
              config: {
                ...(current.config ?? {}),
                pins: nextSavedPins,
                wifi_credential_id: selectedWifiCredentialId,
              },
            }
          : current,
      );
      setConfirmModalOpen(false);
      setConfirmPassword("");
      setJobId(result.job_id);
      setJobStatus("queued");
      setJobError(null);
      setExpectedFirmwareVersion(null);
      setOtaModalOpen(true);
      setFlashCompletedAt(null);
      setBoardOnlineAfterOta(false);
      setOtaStartingFirmwareVersion(null);
      setStatusMessage(
        "Saved project config updated. The dashboard will keep following the board-reported active pin map until OTA finishes and the board reconnects on the new firmware.",
      );
    } catch (saveError) {
      setConfirmError(getErrorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const handleInitiateOta = async () => {
    if (!device || !jobId) {
      return;
    }

    setSendingOta(true);
    setJobError(null);
    setStatusMessage(null);
    setFlashCompletedAt(null);
    setBoardOnlineAfterOta(false);
    setOtaStartingFirmwareVersion(device.firmware_version?.trim() || null);

    try {
      const snapshot = await fetchBuildJob(jobId);
      if (!snapshot.ota_token) {
        throw new Error("Server did not provide an OTA token for this firmware build");
      }

      const runtimeNetwork = await fetchRuntimeNetworkInfo();
      const firmwareUrl = buildReachableOtaUrl(
        runtimeNetwork.api_base_url,
        jobId,
        snapshot.ota_token,
      );
      const commandResult = await sendDeviceCommand(device.device_id, {
        kind: "system",
        action: "ota",
        payload: firmwareUrl,
        url: firmwareUrl,
        job_id: jobId,
      });

      if (commandResult.status === "failed") {
        throw new Error(commandResult.message || "Failed to publish OTA command");
      }

      setJobStatus("flashing");
      setStatusMessage(
        "OTA command sent. Keep the board powered and on the same network until flashing completes.",
      );
    } catch (otaError) {
      setJobError(getErrorMessage(otaError));
    } finally {
      setSendingOta(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 overflow-hidden">
      <header className="border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 shrink-0 z-10 shadow-sm relative">
        <div className="flex flex-col gap-4 px-4 py-3 md:flex-row md:items-center md:justify-between w-full">
          <div className="flex items-center gap-3">
            <button
              className="rounded-full flex items-center justify-center p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition"
              onClick={() => router.push("/devices")}
              type="button"
            >
              <span className="material-icons-round text-[20px]">arrow_back</span>
            </button>
            <div className="flex flex-col justify-center">
              <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white leading-tight">
                {device.name}
              </h1>
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                <span className="material-icons-round text-[14px]">developer_board</span>
                <span>{boardProfile.name}</span>
                <span className="mx-1 text-slate-300 dark:text-slate-600">•</span>
                <span className="flex items-center gap-1">
                  <span className={`h-2 w-2 rounded-full ${device.conn_status === "online" ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-slate-400"}`} />
                  {device.conn_status === "online" ? "Online" : "Offline"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 md:justify-end">
            {/* Wi-Fi Selector in header */}
            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              <span className="material-icons-round text-[16px] text-slate-400">wifi</span>
              <select
                className="bg-transparent text-slate-900 dark:text-white outline-none w-[140px] appearance-none"
                disabled={wifiCredentialsLoading || isSaving || wifiCredentials.length === 0}
                value={selectedWifiCredentialId ?? ""}
                onChange={(event) =>
                  setSelectedWifiCredentialId(event.target.value ? Number(event.target.value) : null)
                }
              >
                <option value="">
                  {wifiCredentialsLoading
                    ? "Loading Wi-Fi..."
                    : wifiCredentials.length === 0
                      ? "No Wi-Fi credentials"
                      : "Select Wi-Fi..."}
                </option>
                {wifiCredentials.map((credential) => (
                  <option key={credential.id} value={credential.id}>
                    {credential.ssid}
                  </option>
                ))}
              </select>
              <span className="material-icons-round text-[14px] text-slate-400 pointer-events-none">expand_more</span>
            </div>

            <div
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wider ${
                hasChanges
                  ? "bg-amber-100/50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
                  : "bg-emerald-100/50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
              }`}
            >
              <span className="material-icons-round text-[14px]">
                {hasChanges ? "pending_actions" : "task_alt"}
              </span>
              {hasChanges ? "Unsaved" : "Saved"}
            </div>
            
            <button
              className="flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isSaving || !hasChanges || validation.errors.length > 0}
              onClick={openConfirmModal}
              type="button"
            >
              <span className="material-icons-round text-[16px]">how_to_reg</span>
              Rebuild
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col relative w-full overflow-hidden">
        <div className="absolute inset-0 flex flex-col">
          {/* Messages container - strictly bounded height if messages exist */}
          <div className="flex-shrink-0 flex flex-col px-4 pt-4 gap-2 empty:p-0">
            {statusMessage && (
              <section className={statusMessageClassName}>
                {statusMessage}
              </section>
            )}
            
            {wifiCredentialsError && (
              <p className="px-4 py-2 text-sm text-white bg-rose-600 rounded-lg shadow-sm">{wifiCredentialsError}</p>
            )}

            <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Active Board Config
                  </p>
                  <h2 className="mt-1 text-base font-semibold text-slate-900 dark:text-white">
                    {!hasBoardReportedPins
                      ? "Waiting for board-reported pin metadata"
                      : boardConfigInSync
                        ? "Board config matches the saved project config"
                        : "Board is still running a different pin map"}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                    {!hasBoardReportedPins
                      ? "This board has not reported a full pin map yet. Until it reconnects, the server cannot prove which GPIO roles are active on hardware."
                      : boardConfigInSync
                        ? "Dashboard controls are aligned with the same pin map currently saved on the server."
                        : "Dashboard/runtime behavior follows the board-reported pin map. Saved changes stay pending until OTA completes and the board reconnects on the rebuilt firmware."}
                  </p>
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${
                    !hasBoardReportedPins
                      ? "border border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                      : boardConfigInSync
                        ? "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
                        : "border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"
                  }`}
                >
                  {!hasBoardReportedPins ? "unknown" : boardConfigInSync ? "synced" : "drift"}
                </span>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-950">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    Board-reported pins
                  </p>
                  <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">
                    {hasBoardReportedPins ? `${activeBoardPins.length} active map(s)` : "No pin map yet"}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-950">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    Saved project pins
                  </p>
                  <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">
                    {savedPins.length} saved map(s)
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-950">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    Active firmware
                  </p>
                  <p className="mt-2 break-all font-mono text-sm text-slate-700 dark:text-slate-200">
                    {activeFirmwareVersion ?? "Unknown"}
                  </p>
                </div>
              </div>
            </section>

            {validation.errors.length > 0 && (
              <section className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 dark:border-rose-500/20 dark:bg-rose-500/10 shadow-sm flex items-center gap-3">
                <span className="material-icons-round text-rose-500 text-[20px]">report</span>
                <p className="text-sm text-rose-800 dark:text-rose-100 m-0">
                  <span className="font-semibold mr-1">Wiring errors:</span>
                  {validation.errors.join("; ")}
                </p>
              </section>
            )}

            {validation.warnings.length > 0 && (
              <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/20 dark:bg-amber-500/10 shadow-sm flex items-center gap-3">
                <span className="material-icons-round text-amber-500 text-[20px]">warning</span>
                <p className="text-sm text-amber-800 dark:text-amber-100 m-0">
                  <span className="font-semibold mr-1">Safety warnings:</span>
                  {validation.warnings.join("; ")}
                </p>
              </section>
            )}
          </div>

          <div className="flex-1 min-h-0 relative p-4 flex">
            <div className="w-full flex-1 flex shadow-[0_0_24px_rgba(0,0,0,0.02)] border border-slate-200 dark:border-slate-800 dark:bg-slate-900 rounded-2xl overflow-hidden min-h-0 bg-white">
              <Step2Pins
                board={boardProfile}
                boardPins={[...boardProfile.leftPins, ...boardProfile.rightPins]}
                configBusy={isSaving}
                nextLabel="Review & rebuild"
                onBack={() => router.push("/devices")}
                onExportConfig={exportConfig}
                onNext={openConfirmModal}
                pins={pins}
                projectName={device.name}
                projectSyncState={projectSyncState}
                selectedPinId={selectedPinId}
                setPins={setPins}
                setSelectedPinId={setSelectedPinId}
              />
            </div>
          </div>
        </div>
      </main>

      {confirmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <form onSubmit={(event) => void handleBuildSubmit(event)}>
              <input
                autoComplete="username"
                className="sr-only"
                name="account-username"
                readOnly
                tabIndex={-1}
                type="text"
                value={user?.username ?? ""}
              />
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-200">
                  <span className="material-icons-round text-[24px]">shield_lock</span>
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                    Confirm board reconfiguration
                  </h2>
                  <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">
                    You are about to rewrite the persisted GPIO mapping for{" "}
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      {device.name}
                    </span>
                    . Re-enter the password for{" "}
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      {user?.username ?? "the signed-in account"}
                    </span>{" "}
                    before the server accepts this safety-sensitive change.
                  </p>
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
                <div className="flex flex-wrap gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  <span>{pins.length} mapped pins</span>
                  <span>{validation.warnings.length} warnings</span>
                  <span>{boardProfile.name}</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  Continue only if the connected wiring matches the new pin roles. The rebuild will
                  start immediately after confirmation, and OTA remains optional until you send the
                  update command.
                </p>
              </div>

              {confirmError && (
                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
                  {confirmError}
                </div>
              )}

              <label className="mt-6 block text-sm font-medium text-slate-700 dark:text-slate-200">
                Account password
                <input
                  autoComplete="current-password"
                  autoFocus
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  id="device-config-password"
                  name="device-config-password"
                  onChange={(event) => {
                    setConfirmPassword(event.target.value);
                    if (confirmError) {
                      setConfirmError(null);
                    }
                  }}
                  placeholder="Enter your password"
                  type="password"
                  value={confirmPassword}
                />
              </label>

              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  disabled={isSaving}
                  onClick={closeConfirmModal}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isSaving}
                  type="submit"
                >
                  {isSaving ? "Confirming..." : "Confirm & rebuild"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {otaModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                  Firmware rebuild and OTA handoff
                </h2>
                <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">
                  The new GPIO mapping is saved. Wait for the firmware artifact, then trigger OTA
                  for this exact build job.
                </p>
              </div>
              <button
                className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                onClick={() => setOtaModalOpen(false)}
                type="button"
              >
                <span className="material-icons-round">close</span>
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  Build job
                </p>
                <p className="mt-2 break-all font-mono text-sm text-slate-700 dark:text-slate-200">
                  {jobId ?? "pending"}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  Current status
                </p>
                <p className="mt-2 font-mono text-sm text-slate-700 dark:text-slate-200">
                  {jobStatus ?? "queued"}
                </p>
              </div>
            </div>

            {(expectedFirmwareVersion || device?.firmware_version) && (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    Expected firmware
                  </p>
                  <p className="mt-2 break-all font-mono text-sm text-slate-700 dark:text-slate-200">
                    {expectedFirmwareVersion ?? "pending"}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    Device-reported firmware
                  </p>
                  <p className="mt-2 break-all font-mono text-sm text-slate-700 dark:text-slate-200">
                    {device?.firmware_version ?? "unknown"}
                  </p>
                </div>
              </div>
            )}

            <div className="mt-6 space-y-4">
              {jobStatus === "queued" && (
                <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-blue-500">
                    <span className="material-icons-round animate-spin text-[20px] leading-none">autorenew</span>
                  </span>
                  <p className="min-w-0 flex-1 leading-6 text-left">
                    Build job queued. The server will start compiling shortly.
                  </p>
                </div>
              )}

              {jobStatus === "building" && (
                <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200">
                  <span className="material-icons-round animate-spin">settings</span>
                  Building new firmware from the confirmed pin mapping.
                </div>
              )}

              {jobStatus === "artifact_ready" && (
                <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200">
                  <span className="material-icons-round">task_alt</span>
                  Artifact ready. You can now push the OTA update to the device.
                </div>
              )}

              {jobStatus === "flashing" && (
                <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200">
                  <span className="material-icons-round animate-bounce">system_update_alt</span>
                  OTA command sent. The device should be downloading and flashing the new firmware.
                </div>
              )}

              {jobStatus === "flashed" && (
                boardOnlineAfterOta ? (
                  <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center">
                      <span className="material-icons-round text-[20px] leading-none">task_alt</span>
                    </span>
                    <p className="min-w-0 flex-1 leading-6 text-left">
                      The board is back online with the new pin map. Returning to the dashboard now.
                    </p>
                  </div>
                ) : (
                  <div className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center">
                      <span className="material-icons-round animate-spin text-[20px] leading-none">autorenew</span>
                    </span>
                    <p className="min-w-0 flex-1 leading-6 text-left">
                      {expectedFirmwareVersion
                        ? `OTA finished. Waiting for the board to reconnect on ${expectedFirmwareVersion} before leaving this page.`
                        : "OTA finished. Waiting for the board to reconnect and report online before leaving this page."}
                    </p>
                  </div>
                )
              )}

              {jobStatus === "build_failed" && (
                <div className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
                  <span className="material-icons-round">error</span>
                  Firmware rebuild failed. Review the build error before retrying.
                </div>
              )}

              {jobStatus === "flash_failed" && (
                <div className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
                  <span className="material-icons-round">warning</span>
                  The device reported an OTA failure. Inspect the board, then retry this exact
                  artifact or rebuild if the config changed.
                </div>
              )}

              {jobError && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
                  {jobError}
                </div>
              )}
            </div>

            <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                onClick={() => {
                  if (boardOnlineAfterOta) {
                    router.push("/");
                    return;
                  }

                  setOtaModalOpen(false);
                }}
                type="button"
              >
                {boardOnlineAfterOta ? "Open dashboard now" : "Close"}
              </button>
              <button
                className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={sendingOta || !canInitiateOta}
                onClick={() => void handleInitiateOta()}
                type="button"
              >
                {sendingOta ? "Sending OTA..." : jobStatus === "flash_failed" ? "Retry OTA" : "Update via OTA"}
              </button>
            </div>

            {jobStatus && !OTA_TERMINAL_STATUSES.has(jobStatus) && (
              <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
                Keep this dialog open to monitor the current build and OTA handoff status.
              </p>
            )}

            {jobStatus === "flashed" && !boardOnlineAfterOta && (
              <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
                {expectedFirmwareVersion
                  ? `The dashboard redirect starts automatically after the board reports back online on ${expectedFirmwareVersion}.`
                  : "The dashboard redirect starts automatically as soon as the board reports back online."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
