"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { getToken, removeToken } from "@/lib/auth";
import { API_URL } from "@/lib/api";
import { createRoom, fetchRooms, type RoomRecord } from "@/lib/rooms";
import {
  BOARD_PROFILES,
  MODE_METADATA,
  getBoardFamily,
  getBoardProfile,
  resolveBoardProfileId,
  type BoardPin,
  type BoardProfile,
  type ChipFamily,
} from "@/features/diy/board-profiles";
import {
  type BuildJobStatus,
  type FirmwareUploadState,
  type FlashManifest,
  type FlashSource,
  type PinMapping,
  type ProjectSyncState,
  type ServerBuildState,
  type ValidationResult,
  sanitizePins,
} from "@/features/diy/types";
import { Step1Board } from "@/features/diy/components/Step1Board";
import { Step2Configs, type SavedBoardConfigOption } from "@/features/diy/components/Step2Configs";
import { Step2Pins } from "@/features/diy/components/Step2Pins";
import { Step3Validate } from "@/features/diy/components/Step3Validate";
import { Step4Flash } from "@/features/diy/components/Step4Flash";

const FLASHER_SCRIPT =
  "https://unpkg.com/esp-web-tools@10.1.0/dist/web/install-button.js?module";
const DRAFT_STORAGE_KEY = "econnect:diy-svg-builder:v2";
const DEFAULT_BOARD_ID = "dfrobot-beetle-esp32-c3";
const DEFAULT_SERIAL_PORT = "browser-web-serial";
const APPLICATION_OFFSET = 65536;
const BUILD_POLL_INTERVAL_MS = 2000;
const WIZARD_STEPS = [
  { id: 1, label: "Boards" },
  { id: 2, label: "Configs" },
  { id: 3, label: "Pins" },
  { id: 4, label: "Review" },
  { id: 5, label: "Flash" },
] as const;
const TERMINAL_BUILD_STATES = new Set<BuildJobStatus>([
  "artifact_ready",
  "flashed",
  "build_failed",
  "flash_failed",
  "cancelled",
]);
const POLLING_BUILD_STATES = new Set<BuildJobStatus>([
  "draft_config",
  "validated",
  "queued",
  "building",
  "flashing",
]);
const ACTIVE_BUILD_STATES = new Set<BuildJobStatus>([
  "queued",
  "building",
  "flashing",
]);

interface SerializedDraft {
  projectId?: string;
  projectName?: string;
  roomId?: number | null;
  family?: ChipFamily;
  boardId?: string;
  pins?: PinMapping[];
  flashSource?: FlashSource;
  serialPort?: string;
  wifiSsid?: string;
  wifiPassword?: string;
  cpuMhz?: number | null;
  flashSize?: string | null;
  psramSize?: string | null;
}

interface DiyProjectRecord {
  id: string;
  user_id: number;
  room_id?: number | null;
  name: string;
  board_profile: string;
  config?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface BuildJobRecord {
  id: string;
  project_id: string;
  status: BuildJobStatus;
  artifact_path?: string | null;
  log_path?: string | null;
  finished_at?: string | null;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}

interface BuildLogsRecord {
  logs: string;
}

type ServerArtifactKind = "firmware" | "bootloader" | "partitions";

interface SerialStatusRecord {
  locked: boolean;
  port: string;
  device_id?: string | null;
  user_id?: number | null;
  job_id?: string | null;
}

function createEmptyBuildState(): ServerBuildState {
  return {
    jobId: null,
    status: "idle",
    logs: "",
    error: null,
    warnings: [],
    artifactUrl: null,
    artifactName: null,
    bootloaderUrl: null,
    partitionsUrl: null,
    configKey: null,
    updatedAt: null,
    finishedAt: null,
    errorMessage: null,
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected request failure.";
}

class ApiRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

async function parseApiError(response: Response) {
  const fallback = `Request failed with HTTP ${response.status}`;

  try {
    const payload = (await response.json()) as
      | { detail?: string | { error?: string; message?: string; messages?: string[] } }
      | { error?: string; message?: string; messages?: string[] };

    if ("detail" in payload && typeof payload.detail === "string") {
      return payload.detail;
    }

    const candidate = "detail" in payload ? payload.detail : payload;
    if (!candidate || typeof candidate === "string") {
      return candidate || fallback;
    }

    if ("messages" in candidate && Array.isArray(candidate.messages) && candidate.messages.length > 0) {
      return candidate.messages.join(" ");
    }

    if ("message" in candidate && candidate.message) {
      return candidate.message;
    }

    if ("error" in candidate && candidate.error) {
      return candidate.error;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

async function createApiRequestError(response: Response) {
  return new ApiRequestError(response.status, await parseApiError(response));
}

function isAuthApiRequestError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && (error.status === 401 || error.status === 403);
}

function buildConfigKey({
  boardId,
  projectName,
  roomId,
  pins,
  wifiSsid,
  wifiPassword,
  cpuMhz,
  flashSize,
  psramSize,
}: {
  boardId: string;
  projectName: string;
  roomId: number | null;
  pins: PinMapping[];
  wifiSsid: string;
  wifiPassword: string;
  cpuMhz: number | null;
  flashSize: string | null;
  psramSize: string | null;
}) {
  return JSON.stringify({
    boardId,
    cpuMhz,
    flashSize,
    psramSize,
    projectName: projectName.trim(),
    roomId,
    wifiSsid: wifiSsid.trim(),
    wifiPassword: wifiPassword.trim(),
    pins: pins.map((mapping) => ({
      gpio_pin: mapping.gpio_pin,
      mode: mapping.mode,
      function: mapping.function ?? "",
      label: mapping.label ?? "",
      extra_params: mapping.extra_params ?? undefined,
    })),
  });
}

function createProjectPayload({
  board,
  projectName,
  roomId,
  flashSource,
  pins,
  serialPort,
  buildJobId,
  buildKey,
  wifiSsid,
  wifiPassword,
  cpuMhz,
  flashSize,
  psramSize,
}: {
  board: BoardProfile;
  projectName: string;
  roomId: number | null;
  flashSource: FlashSource;
  pins: PinMapping[];
  serialPort: string;
  buildJobId: string | null;
  buildKey: string | null;
  wifiSsid: string;
  wifiPassword: string;
  cpuMhz: number | null;
  flashSize: string | null;
  psramSize: string | null;
}) {
  const config: Record<string, unknown> = {
    schema_version: 1,
    project_name: projectName,
    room_id: roomId,
    family: board.family,
    board_id: board.id,
    flash_source: flashSource,
    serial_port: serialPort,
    cpu_mhz: cpuMhz,
    flash_size: flashSize,
    psram_size: psramSize,
    pins: pins.map((mapping) => ({
      gpio_pin: mapping.gpio_pin,
      mode: mapping.mode,
      function: mapping.function ?? MODE_METADATA[mapping.mode].defaultFunction,
      label: mapping.label ?? `GPIO ${mapping.gpio_pin}`,
      extra_params: mapping.extra_params ?? undefined,
    })),
    wifi_ssid: wifiSsid,
    wifi_password: wifiPassword,
  };

  if (buildJobId && buildKey) {
    config.latest_build_job_id = buildJobId;
    config.latest_build_config_key = buildKey;
  }

  return {
    name: projectName.trim() || board.name,
    board_profile: board.id,
    room_id: roomId,
    config,
  };
}

function shortId(value: string | null | undefined) {
  return value ? value.slice(0, 8) : "n/a";
}

function sortProjects(projects: DiyProjectRecord[]) {
  return [...projects].sort((left, right) => {
    const leftTime = Date.parse(left.updated_at || left.created_at || "");
    const rightTime = Date.parse(right.updated_at || right.created_at || "");
    return rightTime - leftTime;
  });
}

function getProjectBoardId(project: DiyProjectRecord) {
  const config = (project.config ?? {}) as Record<string, unknown>;
  const rawBoardId =
    typeof config.board_id === "string"
      ? config.board_id
      : project.board_profile;
  return resolveBoardProfileId(rawBoardId) ?? project.board_profile;
}

function restoreDraftSnapshot(rawDraft: string | null) {
  if (!rawDraft) {
    return null;
  }

  try {
    return JSON.parse(rawDraft) as SerializedDraft;
  } catch (error) {
    console.warn("Failed to restore DIY builder draft:", error);
    return null;
  }
}

export default function DIYBuilderPage() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const isAdmin = user?.account_type === "admin";

  const [currentStep, setCurrentStep] = useState(1);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [boardConfigs, setBoardConfigs] = useState<DiyProjectRecord[]>([]);
  const [boardConfigsLoading, setBoardConfigsLoading] = useState(false);
  const [boardConfigsError, setBoardConfigsError] = useState("");
  const [projectName, setProjectName] = useState("Living Room Relay Node");
  const [roomId, setRoomId] = useState<number | null>(null);
  const [rooms, setRooms] = useState<RoomRecord[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomError, setRoomError] = useState("");
  const [newRoomName, setNewRoomName] = useState("");
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [wifiSsid, setWifiSsid] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [family, setFamily] = useState<ChipFamily>(
    () => getBoardProfile(DEFAULT_BOARD_ID)?.family ?? BOARD_PROFILES[0].family,
  );
  const [boardId, setBoardId] = useState(DEFAULT_BOARD_ID);
  const [cpuMhz, setCpuMhz] = useState<number | null>(null);
  const [flashSize, setFlashSize] = useState<string | null>(null);
  const [psramSize, setPsramSize] = useState<string | null>(null);
  const [pins, setPins] = useState<PinMapping[]>([]);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [flashSource, setFlashSource] = useState<FlashSource>("server");
  const [uploadState, setUploadState] = useState<FirmwareUploadState>({
    bootloader: null,
    partitions: null,
    firmware: null,
  });
  const [manifestUrl, setManifestUrl] = useState<string | null>(null);
  const [browserSupportsSerial, setBrowserSupportsSerial] = useState(false);
  const [eraseFirst, setEraseFirst] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [projectHydrated, setProjectHydrated] = useState(false);
  const hasHydratedRef = useRef(false);
  const serialArtifactRefreshRef = useRef<string | null>(null);
  const [configBusy, setConfigBusy] = useState(false);
  const [projectSyncState, setProjectSyncState] = useState<ProjectSyncState>("loading");
  const [projectSyncMessage, setProjectSyncMessage] = useState("Loading server draft...");
  const [buildBusy, setBuildBusy] = useState(false);
  const [serverBuild, setServerBuild] = useState<ServerBuildState>(() => createEmptyBuildState());
  const [serialPort, setSerialPort] = useState(DEFAULT_SERIAL_PORT);
  const [serialBusy, setSerialBusy] = useState(false);
  const [serialLocked, setSerialLocked] = useState(false);
  const [serialJobId, setSerialJobId] = useState<string | null>(null);
  const [serialMessage, setSerialMessage] = useState(
    "Successful server builds release this port automatically. Flash becomes available when the port is free.",
  );
  const [serialError, setSerialError] = useState<string | null>(null);

  const familyOptions = useMemo(
    () => BOARD_PROFILES.filter((profile) => profile.family === family),
    [family],
  );
  const board = getBoardProfile(boardId) ?? familyOptions[0] ?? BOARD_PROFILES[0];
  const boardPins = useMemo(() => [...board.leftPins, ...board.rightPins], [board]);
  const validation = validateMappings(board, pins, wifiSsid, wifiPassword);
  const currentBuildConfigKey = useMemo(
    () =>
      buildConfigKey({
        boardId: board.id,
        projectName,
        roomId,
        pins,
        wifiSsid,
        wifiPassword,
        cpuMhz,
        flashSize,
        psramSize,
      }),
    [board.id, pins, projectName, roomId, wifiPassword, wifiSsid, cpuMhz, flashSize, psramSize],
  );
  const activeBuildJobId =
    serverBuild.configKey === currentBuildConfigKey ? serverBuild.jobId : null;
  const activeBuildKey =
    serverBuild.configKey === currentBuildConfigKey ? serverBuild.configKey : null;
  const hasActiveServerBuild =
    Boolean(serverBuild.jobId) && ACTIVE_BUILD_STATES.has(serverBuild.status as BuildJobStatus);
  const projectPayload = useMemo(
    () =>
      createProjectPayload({
        board,
        projectName,
        roomId,
        flashSource,
        pins,
        serialPort,
        buildJobId: activeBuildJobId,
        buildKey: activeBuildKey,
        wifiSsid,
        wifiPassword,
        cpuMhz,
        flashSize,
        psramSize,
      }),
    [activeBuildJobId, activeBuildKey, board, flashSource, pins, projectName, roomId, serialPort, wifiSsid, wifiPassword, cpuMhz, flashSize, psramSize],
  );
  const projectPayloadJson = useMemo(() => JSON.stringify(projectPayload), [projectPayload]);
  const draftConfig = projectPayload.config as Record<string, unknown>;
  const serverBuildIsStale =
    flashSource === "server" &&
    Boolean(serverBuild.jobId) &&
    serverBuild.configKey !== null &&
    serverBuild.configKey !== currentBuildConfigKey;
  const serverBuildHasFullBundle = Boolean(
    serverBuild.artifactUrl && serverBuild.bootloaderUrl && serverBuild.partitionsUrl,
  );
  const boardConfigOptions = useMemo<SavedBoardConfigOption[]>(
    () =>
      boardConfigs.map((project) => {
        const config = (project.config ?? {}) as Record<string, unknown>;
        return {
          id: project.id,
          name: project.name,
          pinCount: Array.isArray(config.pins) ? config.pins.length : 0,
          createdAt: project.created_at,
          updatedAt: project.updated_at,
        };
      }),
    [boardConfigs],
  );
  const activeBoardConfigId = useMemo(
    () => (boardConfigs.some((project) => project.id === projectId) ? projectId : null),
    [boardConfigs, projectId],
  );

  const lastSavedPayloadRef = useRef<string | null>(null);
  const latestBoardConfigRequestRef = useRef(0);
  const latestBuildUrlsRef = useRef<{
    artifact: string | null;
    bootloader: string | null;
    partitions: string | null;
  }>({
    artifact: null,
    bootloader: null,
    partitions: null,
  });
  const logPanelRef = useRef<HTMLDivElement | null>(null);
  const sseJobIdRef = useRef<string | null>(null);
  const authRedirectTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const nextUrls = {
      artifact: serverBuild.artifactUrl,
      bootloader: serverBuild.bootloaderUrl,
      partitions: serverBuild.partitionsUrl,
    };
    const previousUrls = latestBuildUrlsRef.current;

    if (
      previousUrls.artifact === nextUrls.artifact &&
      previousUrls.bootloader === nextUrls.bootloader &&
      previousUrls.partitions === nextUrls.partitions
    ) {
      return;
    }

    [previousUrls.artifact, previousUrls.bootloader, previousUrls.partitions].forEach((url) => {
      if (url && !Object.values(nextUrls).includes(url)) {
        URL.revokeObjectURL(url);
      }
    });

    latestBuildUrlsRef.current = nextUrls;
  }, [serverBuild.artifactUrl, serverBuild.bootloaderUrl, serverBuild.partitionsUrl]);

  useEffect(() => {
    return () => {
      const previousUrls = latestBuildUrlsRef.current;
      [previousUrls.artifact, previousUrls.bootloader, previousUrls.partitions].forEach((url) => {
        if (url) {
          URL.revokeObjectURL(url);
        }
      });
      if (authRedirectTimeoutRef.current !== null) {
        window.clearTimeout(authRedirectTimeoutRef.current);
      }
    }
  }, []);

  const handleBuildAuthFailure = useCallback((error: ApiRequestError) => {
    const message =
      error.status === 401
        ? "Session expired. Sign in again before starting another server build."
        : "Your account is not authorized to use the server build flow.";

    setProjectSyncState("error");
    setProjectSyncMessage(message);
    setServerBuild((previous) => ({
      ...previous,
      error: message,
    }));

    if (error.status === 401) {
      removeToken();
      if (authRedirectTimeoutRef.current === null && typeof window !== "undefined") {
        authRedirectTimeoutRef.current = window.setTimeout(() => {
          authRedirectTimeoutRef.current = null;
          logout();
        }, 1200);
      }
    }
  }, [logout]);

  const refreshBoardConfigs = useCallback(async (targetBoardId: string = board.id) => {
    if (!isAdmin) {
      return;
    }

    const requestId = latestBoardConfigRequestRef.current + 1;
    latestBoardConfigRequestRef.current = requestId;

    const token = getToken();
    if (!token) {
      return;
    }

    setBoardConfigsLoading(true);
    setBoardConfigsError("");

    try {
      const response = await fetch(
        `${API_URL}/diy/projects?board_profile=${encodeURIComponent(targetBoardId)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );

      if (!response.ok) {
        throw await createApiRequestError(response);
      }

      const nextConfigs = sortProjects((await response.json()) as DiyProjectRecord[]);
      if (latestBoardConfigRequestRef.current === requestId) {
        setBoardConfigs(nextConfigs);
      }
    } catch (error) {
      if (isAuthApiRequestError(error)) {
        handleBuildAuthFailure(error);
        return;
      }

      if (latestBoardConfigRequestRef.current === requestId) {
        setBoardConfigsError(getErrorMessage(error));
      }
    } finally {
      if (latestBoardConfigRequestRef.current === requestId) {
        setBoardConfigsLoading(false);
      }
    }
  }, [board.id, handleBuildAuthFailure, isAdmin]);

  const persistProject = useCallback(async (
    payloadJson: string,
    options?: { forceCreate?: boolean },
  ) => {
    if (!roomId) {
      setProjectSyncState("idle");
      setProjectSyncMessage("Select a room before syncing this device project to the server.");
      return null;
    }

    const token = getToken();
    if (!token) {
      handleBuildAuthFailure(
        new ApiRequestError(401, "Missing auth token. Sign in again before syncing DIY projects."),
      );
      return null;
    }

    const targetProjectId = options?.forceCreate ? null : projectId;

    if (targetProjectId && payloadJson === lastSavedPayloadRef.current && !options?.forceCreate) {
      return targetProjectId;
    }

    setProjectSyncState("saving");
    setProjectSyncMessage(
      targetProjectId
        ? "Saving server draft..."
        : options?.forceCreate
          ? "Creating a new saved config..."
          : "Creating server draft...",
    );

    try {
      const response = await fetch(
        targetProjectId ? `${API_URL}/diy/projects/${targetProjectId}` : `${API_URL}/diy/projects`,
        {
          method: targetProjectId ? "PUT" : "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: payloadJson,
        },
      );

      if (!response.ok) {
        throw await createApiRequestError(response);
      }

      const savedProject = (await response.json()) as DiyProjectRecord;
      lastSavedPayloadRef.current = payloadJson;
      setProjectId(savedProject.id);
      setBoardConfigs((currentConfigs) =>
        getProjectBoardId(savedProject) === board.id
          ? sortProjects([
              savedProject,
              ...currentConfigs.filter((project) => project.id !== savedProject.id),
            ])
          : currentConfigs.filter((project) => project.id !== savedProject.id),
      );
      setProjectSyncState("saved");
      setProjectSyncMessage(
        options?.forceCreate
          ? `Saved new config ${savedProject.name}.`
          : `Server draft saved as ${savedProject.name}.`,
      );
      return savedProject.id;
    } catch (error) {
      setProjectSyncState("error");
      if (isAuthApiRequestError(error)) {
        handleBuildAuthFailure(error);
      } else {
        setProjectSyncMessage(getErrorMessage(error));
      }
      return null;
    }
  }, [board.id, handleBuildAuthFailure, projectId, roomId]);

  const loadRooms = useCallback(async (token: string) => {
    setRoomsLoading(true);
    setRoomError("");

    try {
      const nextRooms = await fetchRooms(token);
      setRooms(nextRooms);
      setRoomId((currentRoomId) => {
        if (currentRoomId && nextRooms.some((room) => room.room_id === currentRoomId)) {
          return currentRoomId;
        }
        return nextRooms[0]?.room_id ?? null;
      });
    } catch (error) {
      setRoomError(getErrorMessage(error));
    } finally {
      setRoomsLoading(false);
    }
  }, []);

  const handleCreateRoom = useCallback(async () => {
    const token = getToken();
    if (!token) {
      handleBuildAuthFailure(
        new ApiRequestError(401, "Missing auth token. Sign in again before creating a room."),
      );
      return;
    }

    if (!newRoomName.trim()) {
      setRoomError("Enter a room name before creating it.");
      return;
    }

    setCreatingRoom(true);
    setRoomError("");

    try {
      const createdRoom = await createRoom({ name: newRoomName.trim() }, token);
      setRooms((currentRooms) => [...currentRooms, createdRoom].sort((left, right) => left.name.localeCompare(right.name)));
      setRoomId(createdRoom.room_id);
      setNewRoomName("");
    } catch (error) {
      setRoomError(getErrorMessage(error));
    } finally {
      setCreatingRoom(false);
    }
  }, [handleBuildAuthFailure, newRoomName]);

  async function fetchBuildLogs(jobId: string, token: string) {
    const response = await fetch(`${API_URL}/diy/build/${jobId}/logs`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw await createApiRequestError(response);
    }

    const payload = (await response.json()) as BuildLogsRecord;
    return payload.logs;
  }

  async function fetchBuildArtifact(jobId: string, token: string, artifactKind: ServerArtifactKind) {
    const artifactPath =
      artifactKind === "firmware"
        ? `${API_URL}/diy/build/${jobId}/artifact`
        : `${API_URL}/diy/build/${jobId}/artifact/${artifactKind}`;
    const response = await fetch(artifactPath, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (response.status === 400 || response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw await createApiRequestError(response);
    }

    const artifactBlob = await response.blob();
    return {
      url: URL.createObjectURL(artifactBlob),
      name: `${artifactKind}-${jobId}.bin`,
    };
  }

  const refreshBuildJob = useCallback(
    async (jobId: string, buildKey: string | null, overridingFamily?: ChipFamily) => {
      const token = getToken();
      if (!token) {
        return;
      }

      try {
        const effectiveFamily = overridingFamily ?? board.family;
        const expectsFullBundle = effectiveFamily !== "ESP8266";
        const jobResponse = await fetch(`${API_URL}/diy/build/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      if (!jobResponse.ok) {
        throw await createApiRequestError(jobResponse);
      }

      const job = (await jobResponse.json()) as BuildJobRecord;
      // Always fetch logs so Refresh works regardless of terminal state
      const [logs, artifact, bootloader, partitions] = await Promise.all([
        fetchBuildLogs(job.id, token).catch(() => null),
        job.status === "artifact_ready"
          ? fetchBuildArtifact(job.id, token, "firmware").catch(() => null)
          : Promise.resolve(null),
        job.status === "artifact_ready" && expectsFullBundle
          ? fetchBuildArtifact(job.id, token, "bootloader").catch(() => null)
          : Promise.resolve(null),
        job.status === "artifact_ready" && expectsFullBundle
          ? fetchBuildArtifact(job.id, token, "partitions").catch(() => null)
          : Promise.resolve(null),
      ]);

      startTransition(() => {
        setServerBuild((previous) => ({
          ...previous,
          jobId: job.id,
          status: job.status,
          logs: logs ?? previous.logs,
          error:
            job.status === "build_failed"
              ? previous.error || "Server build failed. Inspect the build log below."
              : previous.error,
          artifactUrl: artifact?.url ?? previous.artifactUrl,
          artifactName: artifact?.name ?? previous.artifactName,
          bootloaderUrl: bootloader?.url ?? previous.bootloaderUrl,
          partitionsUrl: partitions?.url ?? previous.partitionsUrl,
          configKey: buildKey,
          updatedAt: job.updated_at,
          finishedAt: job.finished_at ?? previous.finishedAt,
          errorMessage: job.error_message ?? previous.errorMessage,
        }));
      });
    } catch (error) {
      if (isAuthApiRequestError(error)) {
        handleBuildAuthFailure(error);
        return;
      }
      setServerBuild((previous) => ({
        ...previous,
        error: getErrorMessage(error),
      }));
    }
  }, [board.family, handleBuildAuthFailure]);

  const refreshSerialStatus = useCallback(async (options?: { silent?: boolean; freeMessage?: string }) => {
    if (!isAdmin) {
      return;
    }

    const token = getToken();
    if (!token || !serialPort.trim()) {
      return;
    }

    if (!options?.silent) {
      setSerialBusy(true);
    }
    setSerialError(null);

    try {
      const response = await fetch(
        `${API_URL}/serial/status?port=${encodeURIComponent(serialPort.trim())}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      const payload = (await response.json()) as SerialStatusRecord;
      setSerialLocked(payload.locked);
      setSerialJobId(payload.job_id ?? null);
      setSerialMessage(
        payload.locked
          ? `Port ${payload.port} is currently busy${payload.job_id ? ` for build ${shortId(payload.job_id)}` : ""}. Release it before flashing.`
          : options?.freeMessage ?? `Port ${payload.port} is free for browser flashing.`,
      );
    } catch (error) {
      setSerialError(getErrorMessage(error));
    } finally {
      if (!options?.silent) {
        setSerialBusy(false);
      }
    }
  }, [isAdmin, serialPort]);

  const loadServerProject = useCallback(async (project: DiyProjectRecord) => {
    const config = (project.config ?? {}) as Record<string, unknown>;
    const rawBoardId =
      typeof config.board_id === "string"
        ? config.board_id
        : project.board_profile;
    const resolvedBoardId = resolveBoardProfileId(rawBoardId) ?? DEFAULT_BOARD_ID;
    const nextBoard = getBoardProfile(resolvedBoardId) ?? getBoardProfile(DEFAULT_BOARD_ID) ?? BOARD_PROFILES[0];
    const nextPins = sanitizePins(
      Array.isArray(config.pins) ? (config.pins as PinMapping[]) : [],
      MODE_METADATA,
    );
    const nextWifiSsid = typeof config.wifi_ssid === "string" ? config.wifi_ssid : "";
    const nextWifiPassword = typeof config.wifi_password === "string" ? config.wifi_password : "";
    const nextCpuMhz = typeof config.cpu_mhz === "number" ? config.cpu_mhz : null;
    const nextFlashSize = typeof config.flash_size === "string" ? config.flash_size : null;
    const nextPsramSize = typeof config.psram_size === "string" ? config.psram_size : null;
    const nextProjectName =
      typeof config.project_name === "string" && config.project_name.trim()
        ? config.project_name
        : project.name;
    const nextBuildKey = buildConfigKey({
      boardId: nextBoard.id,
      projectName: nextProjectName,
      roomId:
        typeof project.room_id === "number"
          ? project.room_id
          : typeof config.room_id === "number"
            ? config.room_id
            : null,
      pins: nextPins,
      wifiSsid: nextWifiSsid,
      wifiPassword: nextWifiPassword,
      cpuMhz: nextCpuMhz,
      flashSize: nextFlashSize,
      psramSize: nextPsramSize,
    });
    const savedBuildKey =
      typeof config.latest_build_config_key === "string" ? config.latest_build_config_key : null;
    const savedBuildJobId =
      typeof config.latest_build_job_id === "string" && savedBuildKey === nextBuildKey
        ? config.latest_build_job_id
        : null;
    const savedFlashSource =
      config.flash_source === "demo" || config.flash_source === "upload" || config.flash_source === "server"
        ? config.flash_source
        : "server";
    const nextFlashSource =
      savedFlashSource === "demo" && !nextBoard.demoFirmware ? "server" : savedFlashSource;

    setProjectId(project.id);
    setProjectName(nextProjectName);
    setRoomId(
      typeof project.room_id === "number"
        ? project.room_id
        : typeof config.room_id === "number"
          ? config.room_id
          : null,
    );
    setFamily(nextBoard.family);
    setBoardId(nextBoard.id);
    setPins(nextPins);
    setSelectedPinId(null);
    setCpuMhz(nextCpuMhz);
    setFlashSize(nextFlashSize);
    setPsramSize(nextPsramSize);
    setFlashSource(nextFlashSource);
    setSerialPort(
      typeof config.serial_port === "string" && config.serial_port.trim()
        ? config.serial_port
        : DEFAULT_SERIAL_PORT,
    );
    setWifiSsid(nextWifiSsid);
    setWifiPassword(nextWifiPassword);
    setServerBuild({
      ...createEmptyBuildState(),
      jobId: savedBuildJobId,
      status: savedBuildJobId ? "queued" : "idle",
      configKey: savedBuildJobId ? savedBuildKey : null,
    });
    lastSavedPayloadRef.current = JSON.stringify(
      createProjectPayload({
        board: nextBoard,
        projectName: nextProjectName,
        roomId:
          typeof project.room_id === "number"
            ? project.room_id
            : typeof config.room_id === "number"
              ? config.room_id
              : null,
        flashSource: nextFlashSource,
        pins: nextPins,
        serialPort:
          typeof config.serial_port === "string" && config.serial_port.trim()
            ? config.serial_port
            : DEFAULT_SERIAL_PORT,
        buildJobId: savedBuildJobId,
        buildKey: savedBuildJobId ? savedBuildKey : null,
        wifiSsid: nextWifiSsid,
        wifiPassword: nextWifiPassword,
        cpuMhz: nextCpuMhz,
        flashSize: nextFlashSize,
        psramSize: nextPsramSize,
      }),
    );
    setProjectSyncState("saved");
    setProjectSyncMessage(`Loaded saved config ${project.name}.`);
    setBoardConfigsError("");

    if (savedBuildJobId) {
      void refreshBuildJob(savedBuildJobId, savedBuildKey, nextBoard.family);
    }
  }, [refreshBuildJob]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (document.querySelector('script[data-esp-web-tools="true"]')) {
      return;
    }

    const script = document.createElement("script");
    script.type = "module";
    script.src = FLASHER_SCRIPT;
    script.dataset.espWebTools = "true";
    document.head.appendChild(script);

    return () => {
      script.remove();
    };
  }, []);

  const loadServerProjectRef = useRef(loadServerProject);
  loadServerProjectRef.current = loadServerProject;

  useEffect(() => {
    let cancelled = false;

    async function hydrateDraft() {
      if (!isAdmin) {
        setRoomsLoading(false);
        setDraftLoaded(true);
        setProjectHydrated(true);
        return;
      }

      if (hasHydratedRef.current) {
        return;
      }
      hasHydratedRef.current = true;

      if (typeof window === "undefined") {
        return;
      }

      setBrowserSupportsSerial("serial" in navigator);

      const savedDraft = restoreDraftSnapshot(window.localStorage.getItem(DRAFT_STORAGE_KEY));
      const preferredProjectId = savedDraft?.projectId ?? null;

      if (savedDraft) {
        const nextBoardId =
          savedDraft.boardId ? resolveBoardProfileId(savedDraft.boardId) ?? DEFAULT_BOARD_ID : DEFAULT_BOARD_ID;
        const nextBoard = getBoardProfile(nextBoardId) ?? getBoardProfile(DEFAULT_BOARD_ID) ?? BOARD_PROFILES[0];

        setProjectId(preferredProjectId);
        setProjectName(savedDraft.projectName || "Living Room Relay Node");
        setRoomId(typeof savedDraft.roomId === "number" ? savedDraft.roomId : null);
        setFamily(
          savedDraft.family && getBoardFamily(savedDraft.family)
            ? savedDraft.family
            : nextBoard.family,
        );
        setBoardId(nextBoard.id);
        setCpuMhz(typeof savedDraft.cpuMhz === "number" ? savedDraft.cpuMhz : null);
        setFlashSize(typeof savedDraft.flashSize === "string" ? savedDraft.flashSize : null);
        setPsramSize(typeof savedDraft.psramSize === "string" ? savedDraft.psramSize : null);
        setPins(Array.isArray(savedDraft.pins) ? sanitizePins(savedDraft.pins, MODE_METADATA) : []);
        setFlashSource(
          savedDraft.flashSource === "demo" && !nextBoard.demoFirmware
            ? "server"
            : savedDraft.flashSource ?? "server",
        );
        setSerialPort(savedDraft.serialPort || DEFAULT_SERIAL_PORT);
        setWifiSsid(savedDraft.wifiSsid || "");
        setWifiPassword(savedDraft.wifiPassword || "");
      }

      const token = getToken();
      if (!token) {
        if (!cancelled) {
          setProjectSyncState("error");
          setProjectSyncMessage("Missing auth token. Sign in again before syncing DIY projects.");
          setRoomsLoading(false);
          setDraftLoaded(true);
          setProjectHydrated(true);
        }
        return;
      }

      await loadRooms(token);

      setProjectSyncState("loading");
      setProjectSyncMessage("Loading DIY draft from server...");

      try {
        if (preferredProjectId) {
          const response = await fetch(`${API_URL}/diy/projects/${preferredProjectId}`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });

          if (response.status === 404) {
            if (!cancelled) {
              setProjectId(null);
              lastSavedPayloadRef.current = null;
              setProjectSyncState("idle");
              setProjectSyncMessage("Saved local draft loaded. Choose or create a board config to continue.");
            }
          } else {
            if (!response.ok) {
              throw new Error(await parseApiError(response));
            }

            const preferredProject = (await response.json()) as DiyProjectRecord;
            if (!cancelled) {
              await loadServerProjectRef.current(preferredProject);
            }
          }
        } else if (!cancelled) {
          setProjectSyncState("idle");
          setProjectSyncMessage(
            savedDraft
              ? "Saved local draft loaded. Choose or create a board config to continue."
              : "Choose a board, then load or create a saved config for it.",
          );
        }
      } catch (error) {
        if (!cancelled) {
          setProjectSyncState("error");
          setProjectSyncMessage(getErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setDraftLoaded(true);
          setProjectHydrated(true);
        }
      }
    }

    void hydrateDraft();

    return () => {
      cancelled = true;
      hasHydratedRef.current = false;
    };
  }, [isAdmin, loadRooms]);

  useEffect(() => {
    if (!draftLoaded || !projectHydrated || !isAdmin) {
      return;
    }

    void refreshBoardConfigs();
  }, [board.id, draftLoaded, isAdmin, projectHydrated, refreshBoardConfigs]);

  useEffect(() => {
    const nextOptions = BOARD_PROFILES.filter((profile) => profile.family === family);
    if (!nextOptions.some((profile) => profile.id === boardId)) {
      setBoardId(nextOptions[0]?.id ?? BOARD_PROFILES[0].id);
    }
  }, [family, boardId]);

  useEffect(() => {
    const validPins = new Set(boardPins.map((pin) => pin.gpio));
    setPins((previous) => previous.filter((mapping) => validPins.has(mapping.gpio_pin)));

    if (selectedPinId && !boardPins.some((pin) => pin.id === selectedPinId)) {
      setSelectedPinId(null);
    }

    if (!board.demoFirmware && flashSource === "demo") {
      setFlashSource("server");
    }
  }, [board.demoFirmware, boardPins, flashSource, selectedPinId]);

  useEffect(() => {
    if (!draftLoaded || typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
        JSON.stringify({
          projectId: projectId ?? undefined,
          projectName,
          roomId,
          family,
          boardId,
          pins,
        flashSource,
        serialPort,
        wifiSsid,
        wifiPassword,
      } satisfies SerializedDraft),
    );
  }, [boardId, draftLoaded, family, flashSource, pins, projectId, projectName, roomId, serialPort, wifiSsid, wifiPassword]);

  useEffect(() => {
    if (!draftLoaded || !projectHydrated) {
      return;
    }

    if (!projectId) {
      return;
    }

    const token = getToken();
    if (!token) {
      return;
    }

    if (projectId && projectPayloadJson === lastSavedPayloadRef.current) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void persistProject(projectPayloadJson);
    }, 700);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [draftLoaded, persistProject, projectHydrated, projectId, projectPayloadJson]);

  useEffect(() => {
    let manifestObjectUrl: string | null = null;
    const uploadObjectUrls: string[] = [];

    const manifest = buildFlashManifest({
      board,
      projectName,
      flashSource,
      uploadState,
      serverArtifactUrls: serverBuildIsStale
        ? null
        : {
            firmware: serverBuild.artifactUrl,
            bootloader: serverBuild.bootloaderUrl,
            partitions: serverBuild.partitionsUrl,
          },
      createFileUrl: (file) => {
        const url = URL.createObjectURL(file);
        uploadObjectUrls.push(url);
        return url;
      },
    });

    if (manifest) {
      manifestObjectUrl = URL.createObjectURL(
        new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
      );
      setManifestUrl(manifestObjectUrl);
    } else {
      setManifestUrl(null);
    }

    return () => {
      if (manifestObjectUrl) {
        URL.revokeObjectURL(manifestObjectUrl);
      }
      uploadObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [
    board,
    flashSource,
    projectName,
    serverBuild.artifactUrl,
    serverBuild.bootloaderUrl,
    serverBuild.partitionsUrl,
    serverBuildIsStale,
    uploadState,
  ]);

  useEffect(() => {
    if (!serverBuild.jobId) {
      return;
    }

    const buildStatus = serverBuild.status;
    if (
      buildStatus === "idle" ||
      TERMINAL_BUILD_STATES.has(buildStatus as BuildJobStatus) ||
      !POLLING_BUILD_STATES.has(buildStatus as BuildJobStatus)
    ) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshBuildJob(serverBuild.jobId ?? "", serverBuild.configKey ?? currentBuildConfigKey);
    }, BUILD_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [currentBuildConfigKey, refreshBuildJob, serverBuild.configKey, serverBuild.jobId, serverBuild.status]);

  // SSE log-streaming: open an EventSource during active builds for live log updates.
  // The existing status-poll remains the authority for status, finishedAt, errorMessage.
  useEffect(() => {
    const jobId = serverBuild.jobId;
    const buildStatus = serverBuild.status;

    if (
      !jobId ||
      buildStatus === "idle" ||
      TERMINAL_BUILD_STATES.has(buildStatus as BuildJobStatus) ||
      !POLLING_BUILD_STATES.has(buildStatus as BuildJobStatus)
    ) {
      return;
    }

    // Avoid reopening the same stream if jobId hasn't changed
    if (sseJobIdRef.current === jobId) {
      return;
    }

    const token = getToken();
    if (!token) {
      return;
    }

    sseJobIdRef.current = jobId;
    // EventSource doesn't support custom headers; pass token as query param.
    // The backend currently validates via Depends(get_current_user) which reads the
    // Authorization header — so we fall back to polling for logs in that case.
    // We use fetch-based streaming via ReadableStream instead:
    let cancelled = false;
    const controller = new AbortController();

    const streamLogs = async () => {
      try {
        const response = await fetch(`${API_URL}/diy/build/${jobId}/logs/stream`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let sawDoneEvent = false;

        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const text = line.slice(6);
              startTransition(() => {
                setServerBuild((prev) => ({ ...prev, logs: prev.logs + text + "\n" }));
              });
              // Auto-scroll to bottom
              if (logPanelRef.current) {
                logPanelRef.current.scrollTop = logPanelRef.current.scrollHeight;
              }
            } else if (line.startsWith("event: done")) {
              sawDoneEvent = true;
              cancelled = true;
              break;
            }
          }
        }

        if (!sawDoneEvent && cancelled) {
          await reader.cancel().catch(() => undefined);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        // Network/SSE failure — status polling already handles recovery
      }
    };

    void streamLogs();

    return () => {
      cancelled = true;
      controller.abort();
      sseJobIdRef.current = null;
    };
  }, [serverBuild.jobId, serverBuild.status]);

  useEffect(() => {
    if (!draftLoaded || !projectHydrated || !serialPort.trim()) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void refreshSerialStatus({ silent: true });
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [draftLoaded, projectHydrated, refreshSerialStatus, serialPort]);

  useEffect(() => {
    if (
      serverBuild.status !== "artifact_ready" ||
      !serverBuild.jobId ||
      serialArtifactRefreshRef.current === serverBuild.jobId ||
      !serialPort.trim()
    ) {
      return;
    }

    serialArtifactRefreshRef.current = serverBuild.jobId;
    void refreshSerialStatus({
      silent: true,
      freeMessage: `Build ${shortId(serverBuild.jobId)} is ready. Port ${serialPort.trim()} is free for browser flashing.`,
    });
  }, [refreshSerialStatus, serialPort, serverBuild.jobId, serverBuild.status]);

  const generateConfig = async () => {
    setConfigBusy(true);

    try {
      const blob = new Blob([JSON.stringify(draftConfig, null, 2)], {
        type: "application/json",
      });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `${slugify(projectName || board.name)}.config.json`;
      link.click();
      URL.revokeObjectURL(objectUrl);
    } finally {
      setConfigBusy(false);
    }
  };

  const saveProjectNow = useCallback(async () => {
    await persistProject(projectPayloadJson);
  }, [persistProject, projectPayloadJson]);

  const saveProjectAsNewConfig = useCallback(async () => {
    await persistProject(projectPayloadJson, { forceCreate: true });
  }, [persistProject, projectPayloadJson]);

  const loadBoardConfig = useCallback(async (configId: string) => {
    const selectedConfig = boardConfigs.find((project) => project.id === configId);
    if (!selectedConfig) {
      return;
    }

    await loadServerProject(selectedConfig);
  }, [boardConfigs, loadServerProject]);

  const triggerServerBuild = async () => {
    if (hasActiveServerBuild && serverBuild.jobId) {
      setFlashSource("server");
      setServerBuild((previous) => ({
        ...previous,
        error: null,
      }));
      setProjectSyncMessage(`Build ${shortId(serverBuild.jobId)} is already in progress.`);
      await refreshBuildJob(serverBuild.jobId, serverBuild.configKey ?? currentBuildConfigKey);
      return;
    }

    if (validation.errors.length > 0) {
      setFlashSource("server");
      setServerBuild((previous) => ({
        ...previous,
        error: "Fix the blocking GPIO validation errors before queueing a server build.",
      }));
      return;
    }

    const ensuredProjectId = await persistProject(projectPayloadJson);
    if (!ensuredProjectId) {
      return;
    }

    const token = getToken();
    if (!token) {
      handleBuildAuthFailure(
        new ApiRequestError(401, "Session expired. Sign in again before starting another server build."),
      );
      return;
    }

    setBuildBusy(true);
    setFlashSource("server");
    setServerBuild((previous) => ({
      ...previous,
      error: null,
      warnings: validation.warnings,
    }));

    try {
      const response = await fetch(
        `${API_URL}/diy/build?project_id=${encodeURIComponent(ensuredProjectId)}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!response.ok) {
        throw await createApiRequestError(response);
      }

      const job = (await response.json()) as BuildJobRecord;
      setServerBuild({
        ...createEmptyBuildState(),
        jobId: job.id,
        status: job.status,
        warnings: validation.warnings,
        configKey: currentBuildConfigKey,
        updatedAt: job.updated_at,
      });
      setProjectSyncState("saving");
      setProjectSyncMessage(`Build ${shortId(job.id)} queued on the server.`);
      setSerialMessage(
        `Build ${shortId(job.id)} queued. Port ${serialPort.trim() || DEFAULT_SERIAL_PORT} will be released automatically when the artifact is ready.`,
      );
      await refreshBuildJob(job.id, currentBuildConfigKey);
      await persistProject(
        JSON.stringify(
          createProjectPayload({
            board,
            projectName,
            roomId,
            flashSource: "server",
            pins,
            serialPort,
            buildJobId: job.id,
            buildKey: currentBuildConfigKey,
            wifiSsid,
            wifiPassword,
            cpuMhz,
            flashSize,
            psramSize,
          }),
        ),
      );
    } catch (error) {
      if (isAuthApiRequestError(error)) {
        handleBuildAuthFailure(error);
        return;
      }
      setServerBuild((previous) => ({
        ...previous,
        error: getErrorMessage(error),
        warnings: validation.warnings,
      }));
    } finally {
      setBuildBusy(false);
    }
  };

  const downloadServerArtifact = () => {
    if (!serverBuild.artifactUrl || !serverBuild.artifactName) {
      return;
    }

    const link = document.createElement("a");
    link.href = serverBuild.artifactUrl;
    link.download = serverBuild.artifactName;
    link.click();
  };

  const releaseSerialLock = async () => {
    if (!serialPort.trim()) {
      return;
    }

    const token = getToken();
    if (!token) {
      return;
    }

    setSerialBusy(true);
    setSerialError(null);

    try {
      const response = await fetch(
        `${API_URL}/serial/unlock?port=${encodeURIComponent(serialPort.trim())}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      setSerialLocked(false);
      setSerialJobId(null);
      setSerialMessage(`Released ${serialPort.trim()}. The browser flasher can claim it now.`);
    } catch (error) {
      setSerialError(getErrorMessage(error));
    } finally {
      setSerialBusy(false);
    }
  };

  const resetDraft = () => {
    if (!window.confirm("Reset the current SVG builder draft?")) {
      return;
    }

    const nextBoard = getBoardProfile(DEFAULT_BOARD_ID) ?? BOARD_PROFILES[0];
    setProjectId(null);
    setProjectName("Living Room Relay Node");
    setRoomId(rooms[0]?.room_id ?? null);
    setNewRoomName("");
    setRoomError("");
    setFamily(nextBoard.family);
    setBoardId(nextBoard.id);
    setPins([]);
    setSelectedPinId(null);
    setFlashSource("server");
    setUploadState({
      bootloader: null,
      partitions: null,
      firmware: null,
    });
    setServerBuild(createEmptyBuildState());
    setSerialPort(DEFAULT_SERIAL_PORT);
    setSerialLocked(false);
    setSerialJobId(null);
    setSerialMessage(
      "Successful server builds release this port automatically. Flash becomes available when the port is free.",
    );
    setSerialError(null);
    setEraseFirst(false);
    setCurrentStep(1);
    lastSavedPayloadRef.current = null;
    setProjectSyncState("idle");
    setProjectSyncMessage("Choose a board, then load or create a saved config for it.");
  };

  const flashLockedReason = getFlashLockedReason({
    validation,
    browserSupportsSerial,
    manifestUrl,
    flashSource,
    board,
    eraseFirst,
    serialLocked,
    serialPort,
    serverBuildStatus: serverBuild.status,
    serverBuildError: serverBuild.error,
    serverBuildIsStale,
    serverBuildHasFullBundle,
  });

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 dark:bg-slate-950">
        <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">
            <span className="material-symbols-outlined text-4xl">admin_panel_settings</span>
          </div>
          <h1 className="mt-5 text-2xl font-bold text-slate-900 dark:text-white">Admin access required</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
            Pairing, creating, and flashing new devices are reserved for administrators. You can still return to the dashboard to control rooms that were explicitly assigned to your account.
          </p>
          <button
            onClick={() => router.push("/devices")}
            className="mt-6 rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-blue-600"
          >
            Back to devices
          </button>
        </div>
      </div>
    );
  }

  if (!draftLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <p className="text-slate-500">Loading SVG builder...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 transition-colors dark:bg-[#0b1120] dark:text-slate-100">
      <header className="sticky top-0 z-30 w-full border-b border-slate-200 bg-white/80 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <span className="material-symbols-outlined">developer_board</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                IoT Configurator
              </h2>
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                SVG to server build pipeline
              </p>
            </div>
          </div>

          <nav className="hidden items-center gap-8 md:flex">
            {WIZARD_STEPS.map((step) => {
              const active = currentStep === step.id;
              const completed = currentStep > step.id;

              return (
                <div key={step.id} className="flex items-center gap-2">
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${active
                      ? "bg-primary text-white"
                      : completed
                        ? "bg-primary/10 text-primary"
                        : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
                      }`}
                  >
                    {step.id}
                  </span>
                  <span
                    className={`text-sm font-medium transition-colors ${active
                      ? "text-primary"
                      : completed
                        ? "text-slate-700 dark:text-slate-200"
                        : "text-slate-400 dark:text-slate-500"
                      }`}
                  >
                    {step.label}
                  </span>
                </div>
              );
            })}
          </nav>

          <div className="flex items-center gap-4">
            <div className="hidden flex-col items-end md:flex">
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
                Step {currentStep} of {WIZARD_STEPS.length}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {Math.round((currentStep / WIZARD_STEPS.length) * 100)}% complete
              </span>
            </div>
            <span className="hidden rounded-full border border-slate-200 bg-slate-50 px-3 py-1 font-mono text-xs font-bold uppercase tracking-widest text-slate-500 dark:border-slate-700 dark:bg-slate-800 sm:inline-block">
              {projectName || board.name}
            </span>
            <button
              onClick={resetDraft}
              className="p-2 text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-300"
              title="Restart setup"
            >
              <span className="material-symbols-outlined">restart_alt</span>
            </button>
            <button
              onClick={() => router.push("/devices")}
              className="p-2 text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-300"
              title="Close setup"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        <div className="h-1 w-full bg-slate-200 dark:bg-slate-800">
          <div
            className="h-full bg-primary transition-all duration-300 ease-in-out"
            style={{ width: `${(currentStep / WIZARD_STEPS.length) * 100}%` }}
          />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        {currentStep === 1 && (
          <Step1Board
            projectName={projectName}
            setProjectName={setProjectName}
            rooms={rooms}
            selectedRoomId={roomId}
            setSelectedRoomId={setRoomId}
            newRoomName={newRoomName}
            setNewRoomName={setNewRoomName}
            roomsLoading={roomsLoading}
            roomError={roomError}
            creatingRoom={creatingRoom}
            onCreateRoom={handleCreateRoom}
            cpuMhz={cpuMhz}
            setCpuMhz={setCpuMhz}
            flashSize={flashSize}
            setFlashSize={setFlashSize}
            psramSize={psramSize}
            setPsramSize={setPsramSize}
            wifiSsid={wifiSsid}
            setWifiSsid={setWifiSsid}
            wifiPassword={wifiPassword}
            setWifiPassword={setWifiPassword}
            family={family}
            setFamily={setFamily}
            board={board}
            setBoardId={setBoardId}
            familyOptions={familyOptions}
            onSaveDraft={saveProjectNow}
            projectSyncState={projectSyncState}
            projectSyncMessage={projectSyncMessage}
            onNext={() => setCurrentStep(2)}
          />
        )}

        {currentStep === 2 && (
          <Step2Configs
            board={board}
            projectName={projectName}
            setProjectName={setProjectName}
            configs={boardConfigOptions}
            configsLoading={boardConfigsLoading}
            configListError={boardConfigsError}
            hasSelectedConfig={Boolean(activeBoardConfigId)}
            selectedConfigId={activeBoardConfigId}
            projectSyncState={projectSyncState}
            projectSyncMessage={projectSyncMessage}
            onSelectConfig={loadBoardConfig}
            onSaveConfig={saveProjectNow}
            onSaveAsNewConfig={saveProjectAsNewConfig}
            onBack={() => setCurrentStep(1)}
            onNext={() => setCurrentStep(3)}
          />
        )}

        {currentStep === 3 && (
          <Step2Pins
            board={board}
            boardPins={boardPins}
            pins={pins}
            setPins={setPins}
            selectedPinId={selectedPinId}
            setSelectedPinId={setSelectedPinId}
            projectName={projectName}
            draftConfig={draftConfig}
            configBusy={configBusy}
            projectSyncState={projectSyncState}
            projectSyncMessage={projectSyncMessage}
            onExportConfig={generateConfig}
            onBack={() => setCurrentStep(2)}
            onNext={() => setCurrentStep(4)}
          />
        )}

        {currentStep === 4 && (
          <Step3Validate
            validation={validation}
            pins={pins}
            isReady={validation.errors.length === 0}
            onBack={() => setCurrentStep(3)}
            onNext={() => setCurrentStep(5)}
          />
        )}

        {currentStep === 5 && (
          <Step4Flash
            board={board}
            projectId={projectId}
            projectName={projectName}
            flashSource={flashSource}
            setFlashSource={setFlashSource}
            uploadState={uploadState}
            setUploadState={setUploadState}
            eraseFirst={eraseFirst}
            setEraseFirst={setEraseFirst}
            manifestUrl={manifestUrl}
            flashLockedReason={flashLockedReason}
            configBusy={configBusy}
            draftConfig={draftConfig}
            generateConfig={generateConfig}
            pinsLength={pins.length}
            projectSyncState={projectSyncState}
            projectSyncMessage={projectSyncMessage}
            serverBuild={serverBuild}
            buildBusy={buildBusy}
            hasActiveBuild={hasActiveServerBuild}
            onTriggerServerBuild={triggerServerBuild}
            onRefreshBuild={() => serverBuild.jobId ? refreshBuildJob(serverBuild.jobId, serverBuild.configKey ?? currentBuildConfigKey) : Promise.resolve()}
            onDownloadArtifact={downloadServerArtifact}
            serialPort={serialPort}
            setSerialPort={setSerialPort}
            serialBusy={serialBusy}
            serialLocked={serialLocked}
            serialJobId={serialJobId}
            serialMessage={serialMessage}
            serialError={serialError}
            onReleaseSerialLock={releaseSerialLock}
            onRefreshSerialStatus={() => refreshSerialStatus()}
            onLogPanelRef={(el) => { logPanelRef.current = el; }}
            onBack={() => setCurrentStep(4)}
          />
        )}
      </main>
    </div>
  );
}

function validateMappings(
  board: BoardProfile,
  pins: PinMapping[],
  wifiSsid: string,
  wifiPassword: string,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const knownPins = new Map<number, BoardPin>(
    [...board.leftPins, ...board.rightPins].map((pin) => [pin.gpio, pin]),
  );
  const usedLabels = new Map<string, number>();
  let i2cPins = 0;

  if (!wifiSsid.trim()) {
    errors.push("Enter the Wi-Fi SSID before building or flashing firmware.");
  }

  if (!wifiPassword.trim()) {
    errors.push("Enter the Wi-Fi password before building or flashing firmware.");
  }

  if (pins.length === 0) {
    errors.push("Map at least one GPIO before generating config or flashing firmware.");
  }

  for (const mapping of pins) {
    const boardPin = knownPins.get(mapping.gpio_pin);

    if (!boardPin) {
      errors.push(`GPIO ${mapping.gpio_pin} is not exposed by the selected board profile.`);
      continue;
    }

    if (!boardPin.capabilities.includes(mapping.mode)) {
      errors.push(`GPIO ${mapping.gpio_pin} does not support ${mapping.mode} on ${board.name}.`);
    }

    if (boardPin.inputOnly && mapping.mode !== "INPUT" && mapping.mode !== "ADC") {
      errors.push(`GPIO ${mapping.gpio_pin} is input-only and cannot drive outputs.`);
    }

    if (boardPin.reserved) {
      errors.push(
        `GPIO ${mapping.gpio_pin} is reserved or tightly coupled to boot / USB functions on ${board.name}.`,
      );
    }

    if (boardPin.bootSensitive && (mapping.mode === "OUTPUT" || mapping.mode === "PWM")) {
      warnings.push(
        `GPIO ${mapping.gpio_pin} is boot-sensitive. Confirm the connected circuit will not pull the line during reset.`,
      );
    }

    if (mapping.mode === "I2C") {
      i2cPins += 1;
    }

    const normalizedLabel = (mapping.label || "").trim().toLowerCase();
    if (normalizedLabel) {
      usedLabels.set(normalizedLabel, (usedLabels.get(normalizedLabel) ?? 0) + 1);
    }
  }

  if (i2cPins === 1) {
    errors.push("I2C needs both SDA and SCL. Map two I2C-capable pins before flashing.");
  }

  for (const [label, count] of usedLabels.entries()) {
    if (count > 1) {
      warnings.push(`The label "${label}" is used on multiple GPIOs. Rename them to avoid widget confusion.`);
    }
  }

  return { errors, warnings };
}

function buildFlashManifest({
  board,
  projectName,
  flashSource,
  uploadState,
  serverArtifactUrls,
  createFileUrl,
}: {
  board: BoardProfile;
  projectName: string;
  flashSource: FlashSource;
  uploadState: FirmwareUploadState;
  serverArtifactUrls: {
    firmware: string | null;
    bootloader: string | null;
    partitions: string | null;
  } | null;
  createFileUrl: (file: File) => string;
}): FlashManifest | null {
  const singleBinaryOffset = board.family === "ESP8266" ? 0 : APPLICATION_OFFSET;
  const requiresFullBundle = board.family !== "ESP8266";

  if (flashSource === "server") {
    if (!serverArtifactUrls?.firmware) {
      return null;
    }

    const serverParts =
      serverArtifactUrls.bootloader && serverArtifactUrls.partitions
        ? [
            { path: serverArtifactUrls.bootloader, offset: 0 },
            { path: serverArtifactUrls.partitions, offset: 32768 },
            { path: serverArtifactUrls.firmware, offset: APPLICATION_OFFSET },
          ]
        : [{ path: serverArtifactUrls.firmware, offset: singleBinaryOffset }];

    return {
      name: `${projectName || board.name} (${board.name})`,
      version: "server-build",
      builds: [
        {
          chipFamily: board.family,
          parts: serverParts,
        },
      ],
    };
  }

  if (flashSource === "demo") {
    if (!board.demoFirmware) {
      return null;
    }

    return {
      name: `${projectName || board.name} (${board.name})`,
      version: "local-demo",
      builds: [
        {
          chipFamily: board.family,
          parts: board.demoFirmware.parts.map((part) => ({
            path: part.path,
            offset: part.offset,
          })),
        },
      ],
    };
  }

  if (!uploadState.firmware) {
    return null;
  }

  if (requiresFullBundle && (!uploadState.bootloader || !uploadState.partitions)) {
    return null;
  }

  return {
    name: `${projectName || board.name} (${board.name})`,
    version: "upload-bundle",
    builds: [
      {
        chipFamily: board.family,
        parts: requiresFullBundle
          ? [
              { path: createFileUrl(uploadState.bootloader as File), offset: 0 },
              { path: createFileUrl(uploadState.partitions as File), offset: 32768 },
              { path: createFileUrl(uploadState.firmware), offset: APPLICATION_OFFSET },
            ]
          : [{ path: createFileUrl(uploadState.firmware), offset: singleBinaryOffset }],
      },
    ],
  };
}

function getFlashLockedReason({
  validation,
  browserSupportsSerial,
  manifestUrl,
  flashSource,
  board,
  eraseFirst,
  serialLocked,
  serialPort,
  serverBuildStatus,
  serverBuildError,
  serverBuildIsStale,
  serverBuildHasFullBundle,
}: {
  validation: ValidationResult;
  browserSupportsSerial: boolean;
  manifestUrl: string | null;
  flashSource: FlashSource;
  board: BoardProfile;
  eraseFirst: boolean;
  serialLocked: boolean;
  serialPort: string;
  serverBuildStatus: ServerBuildState["status"];
  serverBuildError: string | null;
  serverBuildIsStale: boolean;
  serverBuildHasFullBundle: boolean;
}) {
  if (validation.errors.length > 0) {
    return "Fix the blocking GPIO validation errors before the web flasher becomes available.";
  }

  if (!browserSupportsSerial) {
    return "This browser does not expose Web Serial. Use a current Chromium-based browser for ESP Web Tools.";
  }

  if (!serialPort.trim()) {
    return "Enter the target COM or tty port label first so the server can coordinate serial access.";
  }

  if (flashSource === "server") {
    if (serverBuildIsStale) {
      return "The GPIO mapping changed after the last server build. Rebuild before flashing.";
    }

    if (eraseFirst && !serverBuildHasFullBundle) {
      return board.family === "ESP8266"
        ? "ESP8266 server builds expose a single firmware.bin only. Leave 'erase all flash' disabled or provide a custom full bundle."
        : "Server builds currently expose the application binary only. Turn off 'erase all flash' or switch to a full bundled/upload bundle.";
    }

    if (serverBuildStatus !== "artifact_ready") {
      return serverBuildError || "Run the server build and wait for the artifact before flashing.";
    }
  }

  if (!manifestUrl) {
    return flashSource === "demo"
      ? `No demo manifest is available for ${board.name}. Switch to "Server build" or "Upload custom build".`
      : flashSource === "server"
        ? "The server build artifact is not ready yet."
        : board.family === "ESP8266"
          ? "Upload at least the firmware binary to build an ESP8266 flasher manifest."
          : "Upload bootloader, partitions, and firmware binaries to build a flasher manifest.";
  }

  if (serialLocked) {
    return "Release the active serial session before flashing so the browser can claim this port.";
  }

  return null;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}
