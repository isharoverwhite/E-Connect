"use client";

import { use, useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  API_URL,
  fetchDeviceConfigHistory,
  fetchDevice,
  saveDeviceConfig,
  sendDeviceCommand,
  renameDeviceConfigHistory,
  deleteDeviceConfigHistory,
  type DeviceConfigHistoryEntry,
} from "@/lib/api";
import { getToken } from "@/lib/auth";
import { getActivePinConfigurations } from "@/lib/device-config";
import { fetchWifiCredentials, type WifiCredentialRecord } from "@/lib/wifi-credentials";
import { Step2Pins } from "@/features/diy/components/Step2Pins";
import type { BoardProfile } from "@/features/diy/board-profiles";
import { getBoardProfile } from "@/features/diy/board-profiles";
import { resolveProjectBoardProfileId } from "@/features/diy/project-board";
import type { BuildJobStatus, PinMapping } from "@/features/diy/types";
import { validatePinMappings } from "@/features/diy/validation";
import { useWebSocket } from "@/hooks/useWebSocket";
import type { DeviceConfig, PinConfig } from "@/types/device";
import { useToast } from "@/components/ToastContext";

interface DiyProjectResponse {
  id: string;
  config?: Record<string, unknown> | null;
  pending_config?: Record<string, unknown> | null;
  pending_build_job_id?: string | null;
  board_profile: string;
  name?: string;
  wifi_credential_id?: number | null;
}

interface BuildJobSnapshot {
  status: BuildJobStatus;
  ota_token?: string | null;
  ota_download_url?: string | null;
  error_message?: string | null;
  expected_firmware_version?: string | null;
  staged_project_config?: Record<string, unknown> | null;
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
const EMPTY_CONFIG_VALIDATION_MESSAGE = "Map at least one GPIO before generating config or flashing firmware.";

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

function readConfigWifiCredentialId(
  projectConfig: Record<string, unknown> | null | undefined,
): number | null {
  const rawValue = projectConfig?.wifi_credential_id;
  return typeof rawValue === "number" ? rawValue : null;
}

function resolveCommittedWifiCredentialId(project: DiyProjectResponse): number | null {
  return project.wifi_credential_id ?? readConfigWifiCredentialId(project.config);
}

function readConfigName(projectConfig: Record<string, unknown> | null | undefined): string {
  const rawValue = projectConfig?.config_name;
  return typeof rawValue === "string" ? rawValue.trim() : "";
}

function readAssignedDeviceName(
  projectConfig: Record<string, unknown> | null | undefined,
  fallbackName: string,
): string {
  const assignedDeviceName = projectConfig?.assigned_device_name;
  if (typeof assignedDeviceName === "string" && assignedDeviceName.trim()) {
    return assignedDeviceName.trim();
  }

  const projectName = projectConfig?.project_name;
  if (typeof projectName === "string" && projectName.trim()) {
    return projectName.trim();
  }

  return fallbackName.trim() || "E-Connect Node";
}

function normalizeAssignedDeviceName(value: string, fallbackName: string): string {
  const normalized = value.trim();
  if (normalized) {
    return normalized.slice(0, 255);
  }
  return (fallbackName.trim() || "E-Connect Node").slice(0, 255);
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

function parseTimestamp(value?: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function serializePins(pins: PinMapping[]): string {
  return JSON.stringify(normalizePins(pins));
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

function formatHistoryTime(value?: string | null): string {
  if (!value) {
    return "Unknown time";
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(parsed));
}

function shortJobId(value: string): string {
  return value.slice(0, 8);
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
  const [pendingPins, setPendingPins] = useState<PinMapping[] | null>(null);
  const [wifiCredentials, setWifiCredentials] = useState<WifiCredentialRecord[]>([]);
  const [wifiCredentialsLoading, setWifiCredentialsLoading] = useState(true);
  const [wifiCredentialsError, setWifiCredentialsError] = useState<string | null>(null);
  const [selectedWifiCredentialId, setSelectedWifiCredentialId] = useState<number | null>(null);
  const [savedWifiCredentialId, setSavedWifiCredentialId] = useState<number | null>(null);
  const [pendingWifiCredentialId, setPendingWifiCredentialId] = useState<number | null>(null);
  const [savedConfigName, setSavedConfigName] = useState("");
  const [assignedDeviceName, setAssignedDeviceName] = useState("");
  const [assignedDeviceNameInput, setAssignedDeviceNameInput] = useState("");
  const [editingAssignedDeviceName, setEditingAssignedDeviceName] = useState(false);
  const [pendingBuildJobId, setPendingBuildJobId] = useState<string | null>(null);
  const [configHistory, setConfigHistory] = useState<DeviceConfigHistoryEntry[]>([]);
  const [editingConfigId, setEditingConfigId] = useState<string | null>(null);
  const [editingConfigName, setEditingConfigName] = useState("");
  const [isRenamingConfig, setIsRenamingConfig] = useState(false);
  const [deleteTargetConfig, setDeleteTargetConfig] = useState<DeviceConfigHistoryEntry | null>(null);
  const [deleteConfigPassword, setDeleteConfigPassword] = useState("");
  const [deleteConfigError, setDeleteConfigError] = useState<string | null>(null);
  const [isDeletingConfig, setIsDeletingConfig] = useState(false);
  const { showToast } = useToast();
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [isHistorySidebarOpen, setIsHistorySidebarOpen] = useState(false);
  const [isHistoryHintVisible, setIsHistoryHintVisible] = useState(true);
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
  const [otaPassword, setOtaPassword] = useState("");
  const [otaActionError, setOtaActionError] = useState<string | null>(null);
  const [flashCompletedAt, setFlashCompletedAt] = useState<number | null>(null);
  const [boardOnlineAfterOta, setBoardOnlineAfterOta] = useState(false);
  const [otaStartingFirmwareVersion, setOtaStartingFirmwareVersion] = useState<string | null>(null);
  const [loadedConfigId, setLoadedConfigId] = useState<string | null>(null);
  const [saveMode, setSaveMode] = useState<"update" | "clone">("update");
  const [isNewConfigDraft, setIsNewConfigDraft] = useState(false);
  const confirmFormRef = useRef<HTMLFormElement | null>(null);
  const saveShortcutStateRef = useRef({
    confirmModalOpen: false,
    hasChanges: false,
    hasPendingActivation: false,
    getSaveBlockingMessage: () => null as string | null,
    openConfirmModal: () => { },
  });

  const handleSaveShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented) {
      return;
    }

    const isSaveShortcut = (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "s";
    if (!isSaveShortcut) {
      return;
    }

    event.preventDefault();

    const currentShortcutState = saveShortcutStateRef.current;
    if (currentShortcutState.confirmModalOpen) {
      const blockingMessage = currentShortcutState.hasChanges
        ? currentShortcutState.getSaveBlockingMessage()
        : null;
      if (blockingMessage) {
        showToast(blockingMessage, "error");
        return;
      }
      confirmFormRef.current?.requestSubmit();
      return;
    }

    if (currentShortcutState.hasChanges) {
      currentShortcutState.openConfirmModal();
      return;
    }

    if (currentShortcutState.hasPendingActivation) {
      showToast("No unsaved changes. Open OTA Status to continue with the pending build.", "info");
      return;
    }

    showToast("No config changes to save.", "info");
  });

  useEffect(() => {
    window.addEventListener("keydown", handleSaveShortcut);

    return () => {
      window.removeEventListener("keydown", handleSaveShortcut);
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsHistoryHintVisible(false);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, []);

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
        const projectResponsePromise = fetch(`${API_URL}/diy/projects/${nextDevice.provisioning_project_id}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const wifiCredentialsPromise = fetchWifiCredentials(token);
        const configHistoryPromise = fetchDeviceConfigHistory(deviceId);

        const projectResponse = await projectResponsePromise;
        if (!projectResponse.ok) {
          throw new Error("Failed to load the linked DIY project");
        }

        const nextProject = (await projectResponse.json()) as DiyProjectResponse;
        const [nextWifiCredentials, nextConfigHistory] = await Promise.all([
          wifiCredentialsPromise,
          configHistoryPromise,
        ]);
        const committedConfig = nextProject.config;
        const desiredConfig = nextProject.pending_config ?? nextProject.config;
        const resolvedBoardId =
          resolveProjectBoardProfileId({
            ...nextProject,
            config: desiredConfig ?? committedConfig,
          }) ?? nextProject.board_profile;
        const nextBoardProfile = getBoardProfile(resolvedBoardId);
        if (!nextBoardProfile) {
          throw new Error(`Unknown board profile: ${nextProject.board_profile}`);
        }

        const nextPins = mapProjectPins(desiredConfig);
        const nextCommittedPins = mapProjectPins(committedConfig);
        const nextActivePins = mapDevicePins(getActivePinConfigurations(nextDevice));
        const nextDesiredPins =
          nextPins.length > 0
            ? nextPins
            : nextCommittedPins.length > 0
              ? nextCommittedPins
              : validatePinMappings(nextBoardProfile, nextActivePins).errors.length === 0
                ? nextActivePins
                : [];
        const nextSavedPins =
          nextCommittedPins.length > 0
            ? nextCommittedPins
            : validatePinMappings(nextBoardProfile, nextActivePins).errors.length === 0
              ? nextActivePins
              : [];
        const nextSavedWifiCredentialId = resolveCommittedWifiCredentialId(nextProject);
        const nextPendingWifiCredentialId = readConfigWifiCredentialId(nextProject.pending_config);
        const nextSelectedWifiCredentialId =
          nextPendingWifiCredentialId ?? nextSavedWifiCredentialId;
        if (cancelled) {
          return;
        }
        const nextSavedConfigName = readConfigName(committedConfig) || nextProject.name || nextDevice.name;
        const nextAssignedDeviceName = readAssignedDeviceName(
          desiredConfig ?? committedConfig,
          nextDevice.name,
        );

        let loadedId: string | null = null;
        if (desiredConfig && typeof desiredConfig.config_id === "string") {
          loadedId = desiredConfig.config_id;
        } else if (committedConfig && typeof committedConfig.config_id === "string") {
          loadedId = committedConfig.config_id;
        }

        setDevice(nextDevice);
        setProject(nextProject);
        setBoardProfile(nextBoardProfile);
        setWifiCredentials(nextWifiCredentials);
        setWifiCredentialsError(null);
        setWifiCredentialsLoading(false);
        setPins(nextDesiredPins);
        setSavedPins(nextSavedPins);
        setPendingPins(nextProject.pending_config ? nextPins : null);
        setSelectedWifiCredentialId(nextSelectedWifiCredentialId);
        setSavedWifiCredentialId(nextSavedWifiCredentialId);
        setPendingWifiCredentialId(nextProject.pending_config ? nextPendingWifiCredentialId : null);
        setSavedConfigName(nextSavedConfigName);
        setAssignedDeviceName(nextAssignedDeviceName);
        setAssignedDeviceNameInput(nextAssignedDeviceName);
        setEditingAssignedDeviceName(false);
        setPendingBuildJobId(nextProject.pending_build_job_id ?? null);
        setJobId(nextProject.pending_build_job_id ?? null);
        setConfigHistory(nextConfigHistory);
        setLoadedConfigId(loadedId);
        setIsNewConfigDraft(false);
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
        setConfigHistory((current) =>
          current.map((entry) =>
            entry.id === jobId
              ? {
                ...entry,
                status: snapshot.status,
                error_message: snapshot.error_message?.trim() || null,
                expected_firmware_version: snapshot.expected_firmware_version?.trim() || null,
                config:
                  snapshot.staged_project_config && typeof snapshot.staged_project_config === "object"
                    ? snapshot.staged_project_config
                    : entry.config,
              }
              : entry,
          ),
        );
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

  const loadedConfigEntry = loadedConfigId
    ? configHistory.find((entry) => entry.id === loadedConfigId) ?? null
    : null;
  const isWifiConfigValid = selectedWifiCredentialId !== null && wifiCredentials.some((c) => c.id === selectedWifiCredentialId);
  const wifiErrorText = wifiCredentialsLoading
    ? null
    : wifiCredentials.length === 0
      ? "No Wi-Fi credentials. Go to Settings to add."
      : selectedWifiCredentialId === null
        ? "Please select a Wi-Fi network"
        : !wifiCredentials.some(c => c.id === selectedWifiCredentialId)
          ? "Previously connected Wi-Fi is no longer in database"
          : null;
  const canInitiateOta = jobStatus === "artifact_ready" || jobStatus === "flash_failed";
  const hasPendingActivation = pendingPins !== null || pendingBuildJobId !== null;
  const baselinePins = loadedConfigEntry ? mapProjectPins(loadedConfigEntry.config) : pendingPins ?? savedPins;
  const baselineWifiCredentialId = loadedConfigEntry
    ? readConfigWifiCredentialId(loadedConfigEntry.config)
    : hasPendingActivation
      ? pendingWifiCredentialId
      : savedWifiCredentialId;
  const effectiveAssignedDeviceName = normalizeAssignedDeviceName(
    editingAssignedDeviceName ? assignedDeviceNameInput : assignedDeviceName,
    device.name,
  );
  const baselineAssignedDeviceName = loadedConfigEntry
    ? readAssignedDeviceName(
      loadedConfigEntry.config,
      loadedConfigEntry.assigned_device_name ?? device.name,
    )
    : readAssignedDeviceName(
      hasPendingActivation ? project.pending_config : project.config,
      device.name,
    );
  const hasChanges =
    isNewConfigDraft ||
    serializePins(pins) !== serializePins(baselinePins) ||
    selectedWifiCredentialId !== baselineWifiCredentialId ||
    effectiveAssignedDeviceName !== baselineAssignedDeviceName;
  const isEmptyDraftState =
    pins.length === 0 &&
    validation.errors.includes(EMPTY_CONFIG_VALIDATION_MESSAGE);
  const visibleValidationErrors = isEmptyDraftState
    ? validation.errors.filter((error) => error !== EMPTY_CONFIG_VALIDATION_MESSAGE)
    : validation.errors;
  const isDraftOnlySave = pins.length === 0;
  const saveRequiresPassword = Boolean(loadedConfigId && !isDraftOnlySave && saveMode === "update");
  const saveBlockingMessage =
    visibleValidationErrors.length > 0
      ? "Resolve the wiring errors before saving this configuration."
      : !isDraftOnlySave && !isWifiConfigValid
        ? "Select a valid Wi-Fi credential before saving this configuration."
        : null;
  const draftCardLabel = savedConfigName.trim() || "New Config";

  const activeBoardPinConfigurations = getActivePinConfigurations(device);
  const activeBoardPins = mapDevicePins(activeBoardPinConfigurations);
  const hasBoardReportedPins = activeBoardPinConfigurations.length > 0;

  const activeFirmwareVersion = device.firmware_version?.trim() || null;
  const projectSyncState = isSaving ? "saving" : hasChanges ? "idle" : hasPendingActivation ? "pending_ota" : "saved";

  const getSaveBlockingMessage = () => {
    return saveBlockingMessage;
  };

  const openPendingOtaModal = () => {
    if (!pendingBuildJobId) {
      return;
    }

    setOtaPassword("");
    setOtaActionError(null);
    setJobId(pendingBuildJobId);
    setJobStatus(null);
    setJobError(null);
    setExpectedFirmwareVersion(null);
    setFlashCompletedAt(null);
    setBoardOnlineAfterOta(false);
    setOtaStartingFirmwareVersion(null);
    setOtaModalOpen(true);
  };

  const startAssignedDeviceNameEdit = () => {
    if (isSaving) {
      return;
    }

    setAssignedDeviceNameInput(effectiveAssignedDeviceName);
    setEditingAssignedDeviceName(true);
  };

  const commitAssignedDeviceNameEdit = () => {
    const nextAssignedDeviceName = normalizeAssignedDeviceName(
      assignedDeviceNameInput,
      assignedDeviceName || device.name,
    );
    setAssignedDeviceName(nextAssignedDeviceName);
    setAssignedDeviceNameInput(nextAssignedDeviceName);
    setEditingAssignedDeviceName(false);
  };

  const cancelAssignedDeviceNameEdit = () => {
    setAssignedDeviceNameInput(assignedDeviceName || device.name);
    setEditingAssignedDeviceName(false);
  };

  const openConfirmModal = () => {
    if (isSaving || !hasChanges) {
      return;
    }

    const blockingMessage = getSaveBlockingMessage();
    if (blockingMessage) {
      showToast(blockingMessage, "error");
      return;
    }

    if (editingAssignedDeviceName) {
      const nextAssignedDeviceName = normalizeAssignedDeviceName(
        assignedDeviceNameInput,
        assignedDeviceName || device.name,
      );
      setAssignedDeviceName(nextAssignedDeviceName);
      setAssignedDeviceNameInput(nextAssignedDeviceName);
      setEditingAssignedDeviceName(false);
    }

    setStatusMessage(null);
    setConfirmPassword("");
    setConfirmError(null);
    setConfirmModalOpen(true);
  };

  const openDeleteConfigModal = (entry: DeviceConfigHistoryEntry) => {
    if (entry.is_committed) {
      showToast("The current committed config cannot be deleted.", "error");
      return;
    }
    if (entry.is_pending) {
      showToast("Finish or clear the pending OTA config before deleting it.", "error");
      return;
    }

    setDeleteTargetConfig(entry);
    setDeleteConfigPassword("");
    setDeleteConfigError(null);
  };

  const closeDeleteConfigModal = () => {
    if (isDeletingConfig) {
      return;
    }

    setDeleteTargetConfig(null);
    setDeleteConfigPassword("");
    setDeleteConfigError(null);
  };

  const closeConfirmModal = () => {
    if (isSaving) {
      return;
    }

    setConfirmModalOpen(false);
    setConfirmPassword("");
    setConfirmError(null);
  };

  saveShortcutStateRef.current.confirmModalOpen = confirmModalOpen;
  saveShortcutStateRef.current.hasChanges = hasChanges;
  saveShortcutStateRef.current.hasPendingActivation = hasPendingActivation;
  saveShortcutStateRef.current.getSaveBlockingMessage = getSaveBlockingMessage;
  saveShortcutStateRef.current.openConfirmModal = openConfirmModal;

  const handleBuildSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setConfirmError(null);
    setStatusMessage(null);
    setIsSaving(true);

    try {
      const blockingMessage = getSaveBlockingMessage();
      if (blockingMessage) {
        throw new Error(blockingMessage);
      }

      const nextConfigName = savedConfigName.trim() || device.name;
      const nextAssignedDeviceName = effectiveAssignedDeviceName;
      const saveParams: Parameters<typeof saveDeviceConfig>[1] = {
        pins,
        wifi_credential_id: selectedWifiCredentialId,
        config_name: nextConfigName,
        assigned_device_name: nextAssignedDeviceName,
      };
      if (saveRequiresPassword) {
        saveParams.password = confirmPassword;
      }

      if (loadedConfigId) {
        if (isDraftOnlySave) {
          saveParams.source_config_id = loadedConfigId;
          saveParams.create_new_config = true;
        } else if (saveMode === "update") {
          saveParams.config_id = loadedConfigId;
        } else if (saveMode === "clone") {
          saveParams.source_config_id = loadedConfigId;
          saveParams.create_new_config = true;
        }
      }

      const result = await saveDeviceConfig(device.device_id, saveParams);
      const nextNormalizedPins = normalizePins(pins);
      const nextConfigId = result.config_id || result.job_id;
      const nextUpdatedAt = new Date().toISOString();

      if (result.status === "draft_saved" && nextConfigId) {
        setConfigHistory((current) => {
          const existingEntry = current.find((entry) => entry.id === nextConfigId);
          const nextEntry: DeviceConfigHistoryEntry = {
            id: nextConfigId,
            project_id: project.id,
            device_id: device.device_id,
            board_profile: boardProfile.id,
            config_name: nextConfigName,
            assigned_device_id: device.device_id,
            assigned_device_name: nextAssignedDeviceName,
            created_at: existingEntry?.created_at ?? nextUpdatedAt,
            updated_at: nextUpdatedAt,
            last_applied_at: null,
            latest_build_job_id: null,
            latest_build_status: null,
            latest_build_finished_at: null,
            latest_build_error: null,
            expected_firmware_version: null,
            is_pending: false,
            is_committed: false,
            config: {
              config_id: nextConfigId,
              config_name: nextConfigName,
              assigned_device_id: device.device_id,
              assigned_device_name: nextAssignedDeviceName,
              project_name: nextAssignedDeviceName,
              board_profile: boardProfile.id,
              pins: nextNormalizedPins,
              wifi_credential_id: selectedWifiCredentialId,
            },
          };
          return [nextEntry, ...current.filter((entry) => entry.id !== nextConfigId)];
        });
        setLoadedConfigId(nextConfigId);
        setSaveMode("update");
        setIsNewConfigDraft(false);
        setAssignedDeviceName(nextAssignedDeviceName);
        setAssignedDeviceNameInput(nextAssignedDeviceName);
        setConfirmModalOpen(false);
        setConfirmPassword("");
        setJobId(null);
        setJobStatus(null);
        setJobError(null);
        setExpectedFirmwareVersion(null);
        setOtaModalOpen(false);
        setFlashCompletedAt(null);
        setBoardOnlineAfterOta(false);
        setOtaStartingFirmwareVersion(null);
        setStatusMessage(
          result.message ??
          "Empty config draft saved to history. Build and flash stay blocked until at least one GPIO is mapped and a saved Wi-Fi credential is selected.",
        );
        showToast("Configuration draft saved", "success");
        return;
      }

      if (result.status !== "success" || !result.job_id) {
        throw new Error(result.message || "Failed to save configuration");
      }

      if (!nextConfigId) {
        throw new Error("Saved config did not return an id");
      }

      const nextPendingPins = nextNormalizedPins;
      setPendingPins(nextPendingPins);
      setPendingWifiCredentialId(selectedWifiCredentialId);
      setPendingBuildJobId(result.job_id);
      setProject((current) =>
        current
          ? {
            ...current,
            pending_build_job_id: result.job_id,
            pending_config: {
              ...(current.pending_config ?? current.config ?? {}),
              config_id: nextConfigId,
              config_name: nextConfigName,
              assigned_device_id: device.device_id,
              assigned_device_name: nextAssignedDeviceName,
              project_name: nextAssignedDeviceName,
              pins: nextPendingPins,
              wifi_credential_id: selectedWifiCredentialId,
            },
          }
          : current,
      );
      setConfigHistory((current) => {
        const existingEntry = current.find((entry) => entry.id === nextConfigId);
        const nextEntry: DeviceConfigHistoryEntry = {
          id: nextConfigId,
          project_id: project.id,
          device_id: device.device_id,
          board_profile: boardProfile.id,
          config_name: nextConfigName,
          assigned_device_id: device.device_id,
          assigned_device_name: nextAssignedDeviceName,
          created_at: existingEntry?.created_at ?? nextUpdatedAt,
          updated_at: nextUpdatedAt,
          last_applied_at: null,
          latest_build_job_id: result.job_id,
          latest_build_status: "queued",
          latest_build_finished_at: null,
          latest_build_error: null,
          expected_firmware_version: `build-${result.job_id!.slice(0, 8)}`,
          is_pending: true,
          is_committed: false,
          config: {
            ...(project.pending_config ?? project.config ?? {}),
            config_id: nextConfigId,
            config_name: nextConfigName,
            assigned_device_id: device.device_id,
            assigned_device_name: nextAssignedDeviceName,
            project_name: nextAssignedDeviceName,
            pins: nextPendingPins,
            wifi_credential_id: selectedWifiCredentialId,
          },
        };
        return [
          nextEntry,
          ...current
            .filter((entry) => entry.id !== nextConfigId)
            .map((entry) => ({
              ...entry,
              is_pending: false,
            })),
        ];
      });
      setLoadedConfigId(nextConfigId);
      setSaveMode("update");
      setIsNewConfigDraft(false);
      setAssignedDeviceName(nextAssignedDeviceName);
      setAssignedDeviceNameInput(nextAssignedDeviceName);
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
        result.message ??
        "Staged config queued. The board keeps using the current committed config until it reconnects on the rebuilt firmware.",
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
      setOtaActionError(getErrorMessage(otaError));
    } finally {
      setSendingOta(false);
    }
  };

  const loadConfigFromHistory = (entry: DeviceConfigHistoryEntry) => {
    const nextPins = mapProjectPins(entry.config);
    const nextAssignedDeviceName = readAssignedDeviceName(
      entry.config,
      entry.assigned_device_name ?? device.name,
    );
    setPins(nextPins);
    setSelectedPinId(null);
    setSelectedWifiCredentialId(readConfigWifiCredentialId(entry.config));
    setSavedConfigName(readConfigName(entry.config) || entry.config_name);
    setAssignedDeviceName(nextAssignedDeviceName);
    setAssignedDeviceNameInput(nextAssignedDeviceName);
    setEditingAssignedDeviceName(false);
    setLoadedConfigId(entry.id);
    setSaveMode("update");
    setIsNewConfigDraft(false);
    setStatusMessage(
      nextPins.length === 0
        ? `Loaded empty config ${entry.config_name} (${shortJobId(entry.id)}). Build and flash stay blocked until you map at least one GPIO.`
        : `Loaded config ${entry.config_name} (${shortJobId(entry.id)}) into the editor.`,
    );
  };

  const openOtaStatusForHistory = (entry: DeviceConfigHistoryEntry) => {
    setOtaPassword("");
    setOtaActionError(null);
    setJobId(entry.latest_build_job_id || entry.id);
    setJobStatus((entry.latest_build_status ?? "queued") as BuildJobStatus);
    setJobError(entry.latest_build_error || null);
    setExpectedFirmwareVersion(entry.expected_firmware_version || null);
    setFlashCompletedAt(entry.latest_build_finished_at ? new Date(entry.latest_build_finished_at).getTime() : null);
    setBoardOnlineAfterOta(false);
    setOtaStartingFirmwareVersion(device?.firmware_version || null);
    setOtaModalOpen(true);
  };

  const handleRenameConfig = async (jobId: string) => {
    if (!device) return;
    if (isRenamingConfig) return;

    const nextConfigName = editingConfigName.trim();
    if (!nextConfigName) {
      setEditingConfigId(null);
      return;
    }

    const renamedEntry = configHistory.find((entry) => entry.id === jobId);
    if (renamedEntry && renamedEntry.config_name.trim() === nextConfigName) {
      setEditingConfigId(null);
      return;
    }

    const shouldUpdateCommittedConfig = renamedEntry?.is_committed ?? false;
    const shouldUpdatePendingConfig =
      (renamedEntry?.is_pending ?? false) || project?.pending_build_job_id === jobId;

    try {
      setIsRenamingConfig(true);
      await renameDeviceConfigHistory(device.device_id, jobId, nextConfigName);
      setConfigHistory((current) =>
        current.map((entry) =>
          entry.id === jobId
            ? {
              ...entry,
              config_name: nextConfigName,
              config: {
                ...entry.config,
                config_name: nextConfigName,
              },
            }
            : entry,
        ),
      );
      setProject((current) => {
        if (!current) return current;

        let changed = false;
        const nextProject: DiyProjectResponse = { ...current };

        if (shouldUpdatePendingConfig && current.pending_config) {
          nextProject.pending_config = {
            ...current.pending_config,
            config_name: nextConfigName,
          };
          changed = true;
        }

        if (shouldUpdateCommittedConfig && current.config) {
          nextProject.config = {
            ...current.config,
            config_name: nextConfigName,
          };
          changed = true;
        }

        return changed ? nextProject : current;
      });
      if (shouldUpdateCommittedConfig) {
        setSavedConfigName(nextConfigName);
      }
      showToast("Configuration name updated", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to rename configuration", "error");
    } finally {
      setIsRenamingConfig(false);
      setEditingConfigId(null);
    }
  };

  const handleDeleteConfig = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!device || !deleteTargetConfig) {
      return;
    }

    setDeleteConfigError(null);
    setIsDeletingConfig(true);

    try {
      await deleteDeviceConfigHistory(device.device_id, deleteTargetConfig.id, deleteConfigPassword);
      setConfigHistory((current) => current.filter((entry) => entry.id !== deleteTargetConfig.id));

      if (loadedConfigId === deleteTargetConfig.id) {
        setLoadedConfigId(null);
        setSaveMode("clone");
        setIsNewConfigDraft(true);
        setStatusMessage(
          `Deleted config ${deleteTargetConfig.config_name}. The editor keeps its values as an unsaved draft.`,
        );
      } else {
        setStatusMessage(`Deleted config ${deleteTargetConfig.config_name} from history.`);
      }

      setDeleteTargetConfig(null);
      setDeleteConfigPassword("");
      showToast("Configuration deleted", "success");
    } catch (deleteError) {
      setDeleteConfigError(getErrorMessage(deleteError));
    } finally {
      setIsDeletingConfig(false);
    }
  };

  const handleNewConfig = () => {
    const nextAssignedDeviceName = effectiveAssignedDeviceName || device.name;
    setPins([]);
    setSelectedWifiCredentialId(null);
    setSavedConfigName("New Config");
    setAssignedDeviceName(nextAssignedDeviceName);
    setAssignedDeviceNameInput(nextAssignedDeviceName);
    setEditingAssignedDeviceName(false);
    setSelectedPinId(null);
    setLoadedConfigId(null);
    setSaveMode("clone");
    setIsNewConfigDraft(true);
    setStatusMessage("Started a new empty configuration.");
  };

  return (
    <div className="h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 overflow-hidden">
      <header className="border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 shrink-0 z-10 shadow-sm relative flex flex-col">
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
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2">
                  {editingAssignedDeviceName ? (
                    <input
                      autoFocus
                      className="min-w-[180px] rounded-lg border border-blue-500 bg-white px-2.5 py-1 text-lg font-bold tracking-tight text-slate-900 outline-none ring-2 ring-blue-500/10 dark:bg-slate-950 dark:text-white"
                      maxLength={255}
                      onBlur={commitAssignedDeviceNameEdit}
                      onChange={(event) => setAssignedDeviceNameInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitAssignedDeviceNameEdit();
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelAssignedDeviceNameEdit();
                        }
                      }}
                      placeholder="Device name"
                      type="text"
                      value={assignedDeviceNameInput}
                    />
                  ) : (
                    <>
                      <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white leading-tight mr-1">
                        {effectiveAssignedDeviceName}
                      </h1>
                      <button
                        className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-800 dark:hover:text-blue-400"
                        onClick={startAssignedDeviceNameEdit}
                        title="Edit staged device name"
                        type="button"
                      >
                        <span className="material-icons-round text-[16px]">edit</span>
                      </button>
                    </>
                  )}
                </div>
                {hasPendingActivation && pendingBuildJobId && !otaModalOpen && (
                  <button
                    className="flex items-center gap-1.5 rounded-full bg-blue-100/60 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-200 transition dark:bg-blue-500/20 dark:text-blue-300 dark:hover:bg-blue-500/30"
                    onClick={openPendingOtaModal}
                    type="button"
                  >
                    <span className="material-icons-round text-[14px]">system_update_alt</span>
                    Pending OTA
                  </button>
                )}

                {/* Inline alerts */}
                {statusMessage && (
                  <span className={`px-2 py-0.5 text-[11px] font-medium border rounded-full max-w-[200px] truncate ${jobStatus === "flashed" && !boardOnlineAfterOta
                      ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200"
                      : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200"
                    }`} title={statusMessage}>
                    {statusMessage}
                  </span>
                )}

                {wifiCredentialsError && (
                  <span className="flex items-center gap-1 rounded-full bg-rose-100/50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20 max-w-[150px] cursor-help" title={wifiCredentialsError}>
                    <span className="material-icons-round text-[12px] flex-shrink-0">wifi_off</span>
                    <span className="truncate">Wi-Fi Error</span>
                  </span>
                )}

                {isEmptyDraftState && (
                  <span className="flex items-center gap-1 rounded-full bg-sky-100/50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 border border-sky-200 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/20 cursor-help" title="Empty configuration. Save to history allowed, but build and flash stay blocked.">
                    <span className="material-icons-round text-[12px]">info</span>
                    Empty Config
                  </span>
                )}

                {visibleValidationErrors.length > 0 && (
                  <span className="flex items-center gap-1 rounded-full bg-rose-100/50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20 cursor-help" title={visibleValidationErrors.join("; ")}>
                    <span className="material-icons-round text-[12px]">report</span>
                    {visibleValidationErrors.length} Errors
                  </span>
                )}

                {validation.warnings.length > 0 && (
                  <span className="flex items-center gap-1 rounded-full bg-amber-100/50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20 cursor-help" title={validation.warnings.join("; ")}>
                    <span className="material-icons-round text-[12px]">warning</span>
                    {validation.warnings.length} Warnings
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                <span className="material-icons-round text-[14px]">developer_board</span>
                <span>{boardProfile.name}</span>
                <span className="mx-1 text-slate-300 dark:text-slate-600">•</span>
                <span className="flex items-center gap-1">
                  <span className={`h-2 w-2 rounded-full ${device.conn_status === "online" ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-slate-400"}`} />
                  {device.conn_status === "online" ? "Online" : "Offline"}
                </span>
                <span className="mx-1 text-slate-300 dark:text-slate-600">•</span>
                <span>{activeFirmwareVersion ? `v${activeFirmwareVersion}` : "Unknown FW"}</span>
                <span className="mx-1 text-slate-300 dark:text-slate-600">•</span>
                <span>{hasBoardReportedPins ? `${activeBoardPins.length} mapped` : "No pin map"}</span>
              </div>
              {effectiveAssignedDeviceName !== device.name && (
                <div className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-blue-600 dark:text-blue-300">
                  <span className="material-icons-round text-[13px]">edit_note</span>
                  <span>
                    Live board still reports {device.name}. This staged name applies only after the rebuilt firmware is flashed.
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 md:justify-end">
            {/* Wi-Fi Selector in header */}
            <div
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                !wifiCredentialsLoading && !isWifiConfigValid
                  ? "border-red-500 bg-red-50 text-red-700 dark:border-red-500/50 dark:bg-red-900/30 dark:text-red-400"
                  : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300"
              }`}
              title={wifiErrorText ?? undefined}
            >
              <span className={`material-icons-round text-[16px] ${!wifiCredentialsLoading && !isWifiConfigValid ? "text-red-500 dark:text-red-400" : "text-slate-400"}`}>wifi</span>
              <select
                className="bg-transparent text-current outline-none w-[140px] appearance-none"
                disabled={wifiCredentialsLoading || isSaving || wifiCredentials.length === 0}
                id="device-config-wifi-credential"
                name="device-config-wifi-credential"
                value={selectedWifiCredentialId ?? ""}
                onChange={(event) =>
                  setSelectedWifiCredentialId(event.target.value ? Number(event.target.value) : null)
                }
              >
                {wifiCredentialsLoading && <option value="">Loading Wi-Fi...</option>}
                {!wifiCredentialsLoading && wifiCredentials.length === 0 && (
                  <option value="">No records. Go to Settings ↗</option>
                )}
                {!wifiCredentialsLoading && wifiCredentials.length > 0 && selectedWifiCredentialId === null && (
                  <option value="" disabled className="hidden">Missing WiFi Config</option>
                )}
                {!wifiCredentialsLoading && wifiCredentials.length > 0 && selectedWifiCredentialId !== null && !wifiCredentials.some(c => c.id === selectedWifiCredentialId) && (
                  <option value={selectedWifiCredentialId} disabled className="hidden">Deleted Network</option>
                )}
                {wifiCredentials.map((credential) => (
                  <option key={credential.id} value={credential.id}>
                    {credential.ssid}
                  </option>
                ))}
              </select>
              <span className={`material-icons-round text-[14px] pointer-events-none ${!wifiCredentialsLoading && !isWifiConfigValid ? "text-red-400 dark:text-red-500" : "text-slate-400"}`}>expand_more</span>
            </div>

            <div
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wider ${hasChanges
                  ? "bg-amber-100/50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
                  : hasPendingActivation
                    ? "bg-blue-100/50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
                    : "bg-emerald-100/50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                }`}
            >
              <span className="material-icons-round text-[14px]">
                {hasChanges ? "pending_actions" : hasPendingActivation ? "system_update_alt" : "task_alt"}
              </span>
              {hasChanges ? "Unsaved" : hasPendingActivation ? "Pending OTA" : "Saved"}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 flex relative w-full overflow-hidden bg-slate-50 dark:bg-slate-950">
        {/* Left Sidebar: Config History */}
        <div
          className={`flex-shrink-0 flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-all duration-300 ease-in-out relative z-20 ${isHistorySidebarOpen ? "w-[300px] md:w-[350px]" : "w-0 overflow-hidden border-r-0"
            }`}
        >
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 h-[60px]">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Config History
            </h2>
            <button
              className="flex items-center justify-center rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-blue-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-blue-400"
              onClick={handleNewConfig}
              title="Create new empty configuration"
            >
              <span className="material-icons-round text-[16px]">add</span>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 custom-scrollbar">
            {isNewConfigDraft && (
              <article className="flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3.5 dark:border-blue-500/20 dark:bg-blue-500/10">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                      {draftCardLabel}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      {pins.length === 0 ? "Empty draft in the current editor" : "Draft in the current editor"}
                    </p>
                  </div>
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-blue-700 dark:bg-blue-500/20 dark:text-blue-200">
                    draft
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  <p>{pins.length} mapped pins</p>
                  <p>
                    {pins.length === 0
                      ? "You can save this empty draft now. Select Wi-Fi later when you are ready to rebuild."
                      : selectedWifiCredentialId === null
                        ? "Select a saved Wi-Fi credential before rebuilding."
                        : "Wi-Fi credential attached and ready to save."}
                  </p>
                </div>
                <div className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-[11px] text-blue-700 dark:border-blue-500/20 dark:bg-slate-900 dark:text-blue-200">
                  Press <span className="font-semibold">Ctrl+S / Cmd+S</span> or use the main save action below the board to write this draft to the database.
                </div>
              </article>
            )}

            {configHistory.length === 0 && !isNewConfigDraft ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 text-center mt-4">
                No saved configs found.
              </p>
            ) : (
              configHistory.map((entry) => (
                <article
                  key={entry.id}
                  className="group flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700/50 dark:bg-slate-950/50 transition hover:bg-slate-100 dark:hover:bg-slate-900"
                >
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-start justify-between w-full gap-2 overflow-hidden">
                      {editingConfigId === entry.id ? (
                        <input
                          type="text"
                          value={editingConfigName}
                          onChange={(e) => setEditingConfigName(e.target.value)}
                          onBlur={() => handleRenameConfig(entry.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRenameConfig(entry.id);
                            if (e.key === "Escape") setEditingConfigId(null);
                          }}
                          autoFocus
                          disabled={isRenamingConfig}
                          className="text-sm font-semibold text-slate-900 dark:text-white bg-transparent border-b border-blue-500 outline-none flex-1 min-w-0"
                        />
                      ) : (
                        <p
                          className="truncate text-sm font-semibold text-slate-900 dark:text-white cursor-text hover:text-blue-600 dark:hover:text-blue-400 flex-1 min-w-0 transition-colors"
                          onClick={() => {
                            setEditingConfigName(entry.config_name);
                            setEditingConfigId(entry.id);
                          }}
                          title="Click to rename"
                        >
                          {entry.config_name}
                        </p>
                      )}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider shrink-0 ${entry.latest_build_status === "artifact_ready" || entry.latest_build_status === "flashed"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                            : entry.latest_build_status === "flash_failed" || entry.latest_build_status === "build_failed"
                              ? "bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-200"
                              : "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200"
                          }`}
                      >
                        {entry.latest_build_status || "saved"}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                      ID {shortJobId(entry.id)}
                    </span>
                  </div>

                  <div className="flex flex-col gap-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    <p>{formatHistoryTime(entry.created_at)}</p>
                    {entry.is_committed && (
                      <p className="font-medium text-emerald-600 dark:text-emerald-400 mt-1">
                        Current committed
                      </p>
                    )}
                    {entry.is_pending && (
                      <p className="font-medium text-blue-600 dark:text-blue-400 mt-1">
                        Pending OTA
                      </p>
                    )}
                    {entry.latest_build_error && (
                      <p className="text-rose-600 dark:text-rose-400 truncate mt-1" title={entry.latest_build_error}>
                        {entry.latest_build_error}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mt-1 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <button
                      className="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      onClick={() => loadConfigFromHistory(entry)}
                      type="button"
                    >
                      Load
                    </button>
                    <button
                      className="flex-1 rounded-lg bg-blue-600 px-2 py-1.5 text-[11px] font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!entry.latest_build_job_id || entry.latest_build_status === "build_failed" || entry.latest_build_status === "cancelled"}
                      onClick={() => openOtaStatusForHistory(entry)}
                      type="button"
                    >
                      OTA Status
                    </button>
                    {!entry.is_committed && !entry.is_pending && (
                      <button
                        className="rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-rose-600 transition hover:bg-rose-50 dark:border-rose-500/20 dark:bg-slate-800 dark:text-rose-300 dark:hover:bg-rose-500/10"
                        onClick={() => openDeleteConfigModal(entry)}
                        title="Delete this saved config"
                        type="button"
                      >
                        <span className="material-icons-round text-[16px] leading-none">delete</span>
                      </button>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
        </div>

        {/* Main Board Area */}
        <div className="flex-1 flex flex-col relative w-full overflow-hidden">
          <div className="absolute top-1/2 -translate-y-1/2 left-0 z-20">
            <button
              onMouseEnter={() => setIsHistoryHintVisible(true)}
              onMouseLeave={() => setIsHistoryHintVisible(false)}
              onClick={() => setIsHistorySidebarOpen(!isHistorySidebarOpen)}
              className={`flex h-12 shrink-0 items-center rounded-r-xl border border-l-0 border-slate-200 shadow-sm backdrop-blur transition-all duration-300 overflow-hidden ${isHistorySidebarOpen
                  ? "w-8 justify-center bg-slate-100 text-slate-400 dark:border-slate-700 dark:bg-slate-800/90 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
                  : isHistoryHintVisible
                    ? "w-[280px] justify-start pl-3 bg-white text-slate-900 border-primary/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white shadow-md z-30"
                    : "w-10 justify-center bg-white/90 text-slate-500 hover:w-11 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800/90 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white"
                }`}
              title={isHistorySidebarOpen ? "Close config history" : "Open config history"}
            >
              <span className={`material-icons-round text-[20px] shrink-0 ${!isHistorySidebarOpen && isHistoryHintVisible ? "mr-3 text-primary dark:text-blue-400" : ""}`}>
                history
              </span>
              {!isHistorySidebarOpen && (
                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 block text-sm font-medium ${isHistoryHintVisible ? 'max-w-[240px] opacity-100' : 'max-w-0 opacity-0'}`}>
                  This is a list of firmware history
                </span>
              )}
            </button>
          </div>

          <div className="absolute inset-0 flex flex-col">
            <div className="flex-1 min-h-0 relative p-4 flex">
              <div className="w-full flex-1 flex shadow-[0_0_24px_rgba(0,0,0,0.02)] border border-slate-200 dark:border-slate-800 dark:bg-slate-900 rounded-2xl overflow-hidden min-h-0 bg-white">
                <Step2Pins
                  board={boardProfile}
                  boardPins={[...boardProfile.leftPins, ...boardProfile.rightPins]}
                  nextDisabled={isSaving || (hasChanges ? saveBlockingMessage !== null : isEmptyDraftState || !hasPendingActivation)}
                  nextLabel={
                    hasChanges
                      ? isDraftOnlySave
                        ? "Save draft"
                        : "Review & rebuild"
                      : isEmptyDraftState
                        ? "Map pins to rebuild"
                        : hasPendingActivation
                          ? "Open OTA status"
                          : "Up to date"
                  }
                  onBack={() => router.push("/devices")}
                  onNext={() => {
                    if (hasChanges) {
                      openConfirmModal();
                    } else if (hasPendingActivation && pendingBuildJobId) {
                      openPendingOtaModal();
                    } else {
                      openConfirmModal();
                    }
                  }}
                  pins={pins}
                  projectName={effectiveAssignedDeviceName}
                  projectSyncState={projectSyncState}
                  selectedPinId={selectedPinId}
                  setPins={setPins}
                  setSelectedPinId={setSelectedPinId}
                />
              </div>
            </div>
          </div>
        </div>
      </main>


      {confirmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <form onSubmit={(event) => void handleBuildSubmit(event)} ref={confirmFormRef}>
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
                    {isDraftOnlySave
                      ? "Save empty configuration draft"
                      : saveRequiresPassword
                        ? "Confirm overwrite and rebuild"
                        : "Review and rebuild"}
                  </h2>
                  <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">
                    {isDraftOnlySave ? (
                      <>
                        You are about to save an empty config draft for{" "}
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          {device.name}
                        </span>
                        . This save does not require your account password. No build or OTA job will
                        start until at least one GPIO is mapped and a saved Wi-Fi credential is selected.
                      </>
                    ) : saveRequiresPassword ? (
                      <>
                        You are about to overwrite the loaded saved config for{" "}
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          {device.name}
                        </span>
                        . Re-enter the password for{" "}
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          {user?.username ?? "the signed-in account"}
                        </span>{" "}
                        before the server accepts this overwrite and queues a rebuild.
                      </>
                    ) : (
                      <>
                        You are about to save a new config history entry for{" "}
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          {device.name}
                        </span>
                        . This save does not require your account password. The rebuild can start
                        immediately, but OTA dispatch will ask for your password later before the
                        board is told to flash the new firmware.
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
                <div className="flex flex-wrap gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  <span>{pins.length} mapped pins</span>
                  <span>{validation.warnings.length} warnings</span>
                  <span>{boardProfile.name}</span>
                  <span>{(savedConfigName || device.name).slice(0, 28)}</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {isDraftOnlySave
                    ? "This draft will be saved to config history only. It will not create a build artifact, change the committed config, or unlock OTA until you add at least one valid GPIO mapping."
                    : saveRequiresPassword
                      ? "Continue only if you intend to overwrite this saved config entry directly. The rebuild will start immediately after confirmation, but the current committed config stays in place until OTA succeeds and the board reconnects on the rebuilt firmware."
                      : "This will save a distinct config history entry and start a rebuild without asking for your password. The committed config stays in place until OTA succeeds, and the OTA handoff itself will still require your password."}
                </p>
              </div>

              {loadedConfigId && !isDraftOnlySave && (
                <div className="mt-6 flex flex-col gap-3">
                  <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-900">
                    <input
                      checked={saveMode === "update"}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-600"
                      name="saveMode"
                      onChange={() => setSaveMode("update")}
                      type="radio"
                    />
                    <div>
                      <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        Update existing configuration
                      </div>
                      <div className="text-sm text-slate-500 dark:text-slate-400">
                        Overwrite the history entry you loaded directly
                      </div>
                    </div>
                  </label>
                  <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-900">
                    <input
                      checked={saveMode === "clone"}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-600"
                      name="saveMode"
                      onChange={() => setSaveMode("clone")}
                      type="radio"
                    />
                    <div>
                      <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        Create a new configuration
                      </div>
                      <div className="text-sm text-slate-500 dark:text-slate-400">
                        Save a distinct copy to tracking history
                      </div>
                    </div>
                  </label>
                </div>
              )}

              {confirmError && (
                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
                  {confirmError}
                </div>
              )}

              {saveRequiresPassword && (
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
              )}

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
                  {isSaving
                    ? isDraftOnlySave
                      ? "Saving..."
                      : saveRequiresPassword
                        ? "Confirming..."
                        : "Saving..."
                    : isDraftOnlySave
                      ? "Save draft"
                      : saveRequiresPassword
                        ? "Confirm & rebuild"
                        : "Save & rebuild"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTargetConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <form onSubmit={(event) => void handleDeleteConfig(event)}>
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
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-200">
                  <span className="material-icons-round text-[24px]">delete_forever</span>
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                    Delete saved configuration
                  </h2>
                  <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">
                    Delete <span className="font-semibold text-slate-700 dark:text-slate-200">{deleteTargetConfig.config_name}</span> from config history. Build-job snapshots stay preserved, but this saved config label will be removed from the sidebar.
                  </p>
                </div>
              </div>

              {deleteConfigError && (
                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
                  {deleteConfigError}
                </div>
              )}

              <label className="mt-6 block text-sm font-medium text-slate-700 dark:text-slate-200">
                Account password
                <input
                  autoComplete="current-password"
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  id="delete-config-password"
                  name="delete-config-password"
                  onChange={(event) => {
                    setDeleteConfigPassword(event.target.value);
                    if (deleteConfigError) {
                      setDeleteConfigError(null);
                    }
                  }}
                  placeholder="Enter your password"
                  type="password"
                  value={deleteConfigPassword}
                />
              </label>

              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  disabled={isDeletingConfig}
                  onClick={closeDeleteConfigModal}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="rounded-2xl bg-rose-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-rose-600/20 transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isDeletingConfig}
                  type="submit"
                >
                  {isDeletingConfig ? "Deleting..." : "Delete config"}
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
                  This build is staging a newer GPIO mapping. Wait for the firmware artifact, then
                  trigger OTA for this exact build job. The committed config stays unchanged until
                  the board reports the new firmware.
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
                    Target Firmware
                  </p>
                  <p className="mt-2 break-all font-mono text-sm text-slate-700 dark:text-slate-200">
                    {expectedFirmwareVersion ?? "pending"}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    Board-reported Firmware
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

              {canInitiateOta && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    OTA authorization
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    Enter your account password before the dashboard sends the OTA update command to the board.
                  </p>
                  <label className="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-200">
                    Account password
                    <input
                      autoComplete="current-password"
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      id="device-ota-password"
                      name="device-ota-password"
                      onChange={(event) => {
                        setOtaPassword(event.target.value);
                        if (otaActionError) {
                          setOtaActionError(null);
                        }
                      }}
                      placeholder="Enter your password"
                      type="password"
                      value={otaPassword}
                    />
                  </label>
                </div>
              )}

              {otaActionError && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
                  {otaActionError}
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

                  setOtaPassword("");
                  setOtaActionError(null);
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
