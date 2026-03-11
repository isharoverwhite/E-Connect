"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { getToken } from "@/lib/auth";
import { API_URL } from "@/lib/api";
import {
  BOARD_PROFILES,
  MODE_METADATA,
  getBoardFamily,
  getBoardProfile,
  resolveBoardProfileId,
  type BoardPin,
  type BoardProfile,
  type Esp32ChipFamily,
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
  { id: 2, label: "Pins" },
  { id: 3, label: "Review" },
  { id: 4, label: "Flash" },
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

interface SerializedDraft {
  projectId?: string;
  projectName?: string;
  family?: Esp32ChipFamily;
  boardId?: string;
  pins?: PinMapping[];
  flashSource?: FlashSource;
  serialPort?: string;
  wifiSsid?: string;
  wifiPassword?: string;
}

interface DiyProjectRecord {
  id: string;
  user_id: number;
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

interface SerialStatusRecord {
  locked: boolean;
  port: string;
  device_id?: string | null;
  user_id?: number | null;
  job_id?: string | null;
}

interface SerialSessionRecord {
  id: number;
  port: string;
  device_id?: string | null;
  build_job_id?: string | null;
  locked_by_user_id: number;
  status: "locked" | "released";
  created_at: string;
  released_at?: string | null;
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
    configKey: null,
    updatedAt: null,
    finishedAt: null,
    errorMessage: null,
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected request failure.";
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

function buildConfigKey(boardId: string, pins: PinMapping[]) {
  return JSON.stringify({
    boardId,
    pins: pins.map((mapping) => ({
      gpio_pin: mapping.gpio_pin,
      mode: mapping.mode,
      function: mapping.function ?? "",
      label: mapping.label ?? "",
    })),
  });
}

function createProjectPayload({
  board,
  projectName,
  flashSource,
  pins,
  serialPort,
  buildJobId,
  buildKey,
  wifiSsid,
  wifiPassword,
}: {
  board: BoardProfile;
  projectName: string;
  flashSource: FlashSource;
  pins: PinMapping[];
  serialPort: string;
  buildJobId: string | null;
  buildKey: string | null;
  wifiSsid: string;
  wifiPassword: string;
}) {
  const config: Record<string, unknown> = {
    schema_version: 1,
    project_name: projectName,
    family: board.family,
    board_id: board.id,
    flash_source: flashSource,
    serial_port: serialPort,
    pins: pins.map((mapping) => ({
      gpio_pin: mapping.gpio_pin,
      mode: mapping.mode,
      function: mapping.function ?? MODE_METADATA[mapping.mode].defaultFunction,
      label: mapping.label ?? `GPIO ${mapping.gpio_pin}`,
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
  useAuth();

  const [currentStep, setCurrentStep] = useState(1);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("Living Room Relay Node");
  const [wifiSsid, setWifiSsid] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [family, setFamily] = useState<Esp32ChipFamily>("ESP32-C3");
  const [boardId, setBoardId] = useState(DEFAULT_BOARD_ID);
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
  const [configBusy, setConfigBusy] = useState(false);
  const [projectSyncState, setProjectSyncState] = useState<ProjectSyncState>("loading");
  const [projectSyncMessage, setProjectSyncMessage] = useState("Loading server draft...");
  const [buildBusy, setBuildBusy] = useState(false);
  const [serverBuild, setServerBuild] = useState<ServerBuildState>(() => createEmptyBuildState());
  const [serialPort, setSerialPort] = useState(DEFAULT_SERIAL_PORT);
  const [serialBusy, setSerialBusy] = useState(false);
  const [serialLocked, setSerialLocked] = useState(false);
  const [serialJobId, setSerialJobId] = useState<string | null>(null);
  const [serialMessage, setSerialMessage] = useState("Reserve a port before opening the web flasher.");
  const [serialError, setSerialError] = useState<string | null>(null);

  const familyOptions = useMemo(
    () => BOARD_PROFILES.filter((profile) => profile.family === family),
    [family],
  );
  const board = getBoardProfile(boardId) ?? familyOptions[0] ?? BOARD_PROFILES[0];
  const boardPins = useMemo(() => [...board.leftPins, ...board.rightPins], [board]);
  const validation = validateMappings(board, pins);
  const currentBuildConfigKey = useMemo(() => buildConfigKey(board.id, pins), [board.id, pins]);
  const activeBuildJobId =
    serverBuild.configKey === currentBuildConfigKey ? serverBuild.jobId : null;
  const activeBuildKey =
    serverBuild.configKey === currentBuildConfigKey ? serverBuild.configKey : null;
  const projectPayload = useMemo(
    () =>
      createProjectPayload({
        board,
        projectName,
        flashSource,
        pins,
        serialPort,
        buildJobId: activeBuildJobId,
        buildKey: activeBuildKey,
        wifiSsid,
        wifiPassword,
      }),
    [activeBuildJobId, activeBuildKey, board, flashSource, pins, projectName, serialPort, wifiSsid, wifiPassword],
  );
  const projectPayloadJson = useMemo(() => JSON.stringify(projectPayload), [projectPayload]);
  const draftConfig = projectPayload.config as Record<string, unknown>;
  const serverBuildIsStale =
    flashSource === "server" &&
    Boolean(serverBuild.jobId) &&
    serverBuild.configKey !== null &&
    serverBuild.configKey !== currentBuildConfigKey;

  const lastSavedPayloadRef = useRef<string | null>(null);
  const latestBuildUrlRef = useRef<string | null>(null);
  const logPanelRef = useRef<HTMLDivElement | null>(null);
  const sseJobIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (serverBuild.artifactUrl === latestBuildUrlRef.current) {
      return;
    }

    if (latestBuildUrlRef.current) {
      URL.revokeObjectURL(latestBuildUrlRef.current);
    }

    latestBuildUrlRef.current = serverBuild.artifactUrl ?? null;
  }, [serverBuild.artifactUrl]);

  useEffect(() => {
    return () => {
      if (latestBuildUrlRef.current) {
        URL.revokeObjectURL(latestBuildUrlRef.current);
      }
    };
  }, []);

  const persistProject = useCallback(async (payloadJson: string) => {
    const token = getToken();
    if (!token) {
      setProjectSyncState("error");
      setProjectSyncMessage("Missing auth token. Sign in again before syncing DIY projects.");
      return null;
    }

    if (projectId && payloadJson === lastSavedPayloadRef.current) {
      return projectId;
    }

    setProjectSyncState("saving");
    setProjectSyncMessage(projectId ? "Saving server draft..." : "Creating server draft...");

    try {
      const response = await fetch(
        projectId ? `${API_URL}/diy/projects/${projectId}` : `${API_URL}/diy/projects`,
        {
          method: projectId ? "PUT" : "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: payloadJson,
        },
      );

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      const savedProject = (await response.json()) as DiyProjectRecord;
      lastSavedPayloadRef.current = payloadJson;
      setProjectId(savedProject.id);
      setProjectSyncState("saved");
      setProjectSyncMessage(`Server draft saved as ${savedProject.name}.`);
      return savedProject.id;
    } catch (error) {
      setProjectSyncState("error");
      setProjectSyncMessage(getErrorMessage(error));
      return null;
    }
  }, [projectId]);

  async function fetchBuildLogs(jobId: string, token: string) {
    const response = await fetch(`${API_URL}/diy/build/${jobId}/logs`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const payload = (await response.json()) as BuildLogsRecord;
    return payload.logs;
  }

  async function fetchBuildArtifact(jobId: string, token: string) {
    const response = await fetch(`${API_URL}/diy/build/${jobId}/artifact`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (response.status === 400 || response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const artifactBlob = await response.blob();
    return {
      url: URL.createObjectURL(artifactBlob),
      name: `firmware-${jobId}.bin`,
    };
  }

  const refreshBuildJob = useCallback(async (jobId: string, buildKey: string | null) => {
    const token = getToken();
    if (!token) {
      return;
    }

    try {
      const jobResponse = await fetch(`${API_URL}/diy/build/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      if (!jobResponse.ok) {
        throw new Error(await parseApiError(jobResponse));
      }

      const job = (await jobResponse.json()) as BuildJobRecord;
      // Always fetch logs so Refresh works regardless of terminal state
      const [logs, artifact] = await Promise.all([
        fetchBuildLogs(job.id, token).catch(() => null),
        job.status === "artifact_ready"
          ? fetchBuildArtifact(job.id, token).catch(() => null)
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
          configKey: buildKey,
          updatedAt: job.updated_at,
          finishedAt: job.finished_at ?? previous.finishedAt,
          errorMessage: job.error_message ?? previous.errorMessage,
        }));
      });
    } catch (error) {
      setServerBuild((previous) => ({
        ...previous,
        error: getErrorMessage(error),
      }));
    }
  }, []);

  const refreshSerialStatus = useCallback(async (options?: { silent?: boolean }) => {
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
          ? `Port ${payload.port} is reserved${payload.job_id ? ` for build ${shortId(payload.job_id)}` : ""}.`
          : `Port ${payload.port} is currently free.`,
      );
    } catch (error) {
      setSerialError(getErrorMessage(error));
    } finally {
      if (!options?.silent) {
        setSerialBusy(false);
      }
    }
  }, [serialPort]);

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
    const nextBuildKey = buildConfigKey(nextBoard.id, nextPins);
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
    setProjectName(
      typeof config.project_name === "string" && config.project_name.trim()
        ? config.project_name
        : project.name,
    );
    setFamily(nextBoard.family);
    setBoardId(nextBoard.id);
    setPins(nextPins);
    setFlashSource(nextFlashSource);
    setSerialPort(
      typeof config.serial_port === "string" && config.serial_port.trim()
        ? config.serial_port
        : DEFAULT_SERIAL_PORT,
    );
    setWifiSsid(typeof config.wifi_ssid === "string" ? config.wifi_ssid : "");
    setWifiPassword(typeof config.wifi_password === "string" ? config.wifi_password : "");
    setServerBuild({
      ...createEmptyBuildState(),
      jobId: savedBuildJobId,
      status: savedBuildJobId ? "queued" : "idle",
      configKey: savedBuildJobId ? savedBuildKey : null,
    });
    lastSavedPayloadRef.current = JSON.stringify(
      createProjectPayload({
        board: nextBoard,
        projectName:
          typeof config.project_name === "string" && config.project_name.trim()
            ? config.project_name
            : project.name,
        flashSource: nextFlashSource,
        pins: nextPins,
        serialPort:
          typeof config.serial_port === "string" && config.serial_port.trim()
            ? config.serial_port
            : DEFAULT_SERIAL_PORT,
        buildJobId: savedBuildJobId,
        buildKey: savedBuildJobId ? savedBuildKey : null,
        wifiSsid: typeof config.wifi_ssid === "string" ? config.wifi_ssid : "",
        wifiPassword: typeof config.wifi_password === "string" ? config.wifi_password : "",
      }),
    );
    setProjectSyncState("saved");
    setProjectSyncMessage(`Loaded server draft ${project.name}.`);

    if (savedBuildJobId) {
      void refreshBuildJob(savedBuildJobId, savedBuildKey);
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

  useEffect(() => {
    let cancelled = false;

    async function hydrateDraft() {
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
        setFamily(
          savedDraft.family && getBoardFamily(savedDraft.family)
            ? savedDraft.family
            : nextBoard.family,
        );
        setBoardId(nextBoard.id);
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
          setDraftLoaded(true);
          setProjectHydrated(true);
        }
        return;
      }

      setProjectSyncState("loading");
      setProjectSyncMessage("Loading DIY draft from server...");

      try {
        const response = await fetch(`${API_URL}/diy/projects`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(await parseApiError(response));
        }

        const projects = sortProjects((await response.json()) as DiyProjectRecord[]);
        const preferredProject = projects.find((project) => project.id === preferredProjectId) ?? projects[0];

        if (!cancelled && preferredProject) {
          await loadServerProject(preferredProject);
        } else if (!cancelled) {
          setProjectSyncState("idle");
          setProjectSyncMessage(
            savedDraft
              ? "Loaded local draft. It will sync to the server automatically."
              : "No server draft yet. Your first change will create one.",
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
    };
  }, [loadServerProject]);

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
        family,
        boardId,
        pins,
        flashSource,
        serialPort,
        wifiSsid,
        wifiPassword,
      } satisfies SerializedDraft),
    );
  }, [boardId, draftLoaded, family, flashSource, pins, projectId, projectName, serialPort, wifiSsid, wifiPassword]);

  useEffect(() => {
    if (!draftLoaded || !projectHydrated) {
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
      serverArtifactUrl: serverBuildIsStale ? null : serverBuild.artifactUrl,
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
    const url = `${API_URL}/diy/build/${jobId}/logs/stream?token=${encodeURIComponent(token)}`;
    // EventSource doesn't support custom headers; pass token as query param.
    // The backend currently validates via Depends(get_current_user) which reads the
    // Authorization header — so we fall back to polling for logs in that case.
    // We use fetch-based streaming via ReadableStream instead:
    let cancelled = false;

    const streamLogs = async () => {
      try {
        const response = await fetch(`${API_URL}/diy/build/${jobId}/logs/stream`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        if (!response.ok || !response.body) {
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

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
              cancelled = true;
              break;
            }
          }
        }
        reader.cancel();
      } catch {
        // Network/SSE failure — status polling already handles recovery
      }
    };

    void streamLogs();

    return () => {
      cancelled = true;
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

  const triggerServerBuild = async () => {
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
      setFlashSource("server");
      setServerBuild((previous) => ({
        ...previous,
        error: "Unable to save the DIY project before starting the server build.",
      }));
      return;
    }

    const token = getToken();
    if (!token) {
      return;
    }

    setBuildBusy(true);
    setFlashSource("server");
    setServerBuild({
      ...createEmptyBuildState(),
      status: "queued",
      warnings: validation.warnings,
      configKey: currentBuildConfigKey,
    });

    try {
      const response = await fetch(
        `${API_URL}/diy/build?project_id=${encodeURIComponent(ensuredProjectId)}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!response.ok) {
        throw new Error(await parseApiError(response));
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
      await refreshBuildJob(job.id, currentBuildConfigKey);
      await persistProject(
        JSON.stringify(
          createProjectPayload({
            board,
            projectName,
            flashSource: "server",
            pins,
            serialPort,
            buildJobId: job.id,
            buildKey: currentBuildConfigKey,
            wifiSsid,
            wifiPassword,
          }),
        ),
      );
    } catch (error) {
      setServerBuild((previous) => ({
        ...previous,
        status: "build_failed",
        error: getErrorMessage(error),
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

  const acquireSerialLock = async () => {
    if (!serialPort.trim()) {
      setSerialError("Enter a COM or tty port label before reserving the flasher.");
      return;
    }

    const token = getToken();
    if (!token) {
      return;
    }

    setSerialBusy(true);
    setSerialError(null);

    try {
      const params = new URLSearchParams({
        device_id: slugify(projectName || board.name) || "generic",
        port: serialPort.trim(),
      });

      if (flashSource === "server" && serverBuild.status === "artifact_ready" && activeBuildJobId) {
        params.set("job_id", activeBuildJobId);
      }

      const response = await fetch(`${API_URL}/serial/lock?${params.toString()}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      const payload = (await response.json()) as SerialSessionRecord;
      setSerialLocked(payload.status === "locked");
      setSerialJobId(payload.build_job_id ?? null);
      setSerialMessage(`Reserved ${payload.port} for flashing.`);
    } catch (error) {
      setSerialError(getErrorMessage(error));
    } finally {
      setSerialBusy(false);
    }
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
      setSerialMessage(`Released ${serialPort.trim()}.`);
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

    setProjectName("Living Room Relay Node");
    setFamily("ESP32-C3");
    setBoardId(DEFAULT_BOARD_ID);
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
    setSerialMessage("Reserve a port before opening the web flasher.");
    setSerialError(null);
    setEraseFirst(false);
    setCurrentStep(1);
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
  });

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
            style={{ width: `${(currentStep / 4) * 100}%` }}
          />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        {currentStep === 1 && (
          <Step1Board
            projectName={projectName}
            setProjectName={setProjectName}
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
            onBack={() => setCurrentStep(1)}
            onNext={() => setCurrentStep(3)}
          />
        )}

        {currentStep === 3 && (
          <Step3Validate
            validation={validation}
            pins={pins}
            isReady={validation.errors.length === 0}
            onBack={() => setCurrentStep(2)}
            onNext={() => setCurrentStep(4)}
          />
        )}

        {currentStep === 4 && (
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
            onAcquireSerialLock={acquireSerialLock}
            onReleaseSerialLock={releaseSerialLock}
            onRefreshSerialStatus={() => refreshSerialStatus()}
            onLogPanelRef={(el) => { logPanelRef.current = el; }}
            onBack={() => setCurrentStep(3)}
          />
        )}
      </main>
    </div>
  );
}

function validateMappings(board: BoardProfile, pins: PinMapping[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const knownPins = new Map<number, BoardPin>(
    [...board.leftPins, ...board.rightPins].map((pin) => [pin.gpio, pin]),
  );
  const usedLabels = new Map<string, number>();
  let i2cPins = 0;

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

    if (boardPin.reserved && mapping.mode !== "INPUT" && mapping.mode !== "ADC") {
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
  serverArtifactUrl,
  createFileUrl,
}: {
  board: BoardProfile;
  projectName: string;
  flashSource: FlashSource;
  uploadState: FirmwareUploadState;
  serverArtifactUrl: string | null;
  createFileUrl: (file: File) => string;
}): FlashManifest | null {
  if (flashSource === "server") {
    if (!serverArtifactUrl) {
      return null;
    }

    return {
      name: `${projectName || board.name} (${board.name})`,
      version: "server-build",
      builds: [
        {
          chipFamily: board.family,
          parts: [{ path: serverArtifactUrl, offset: APPLICATION_OFFSET }],
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

  if (!uploadState.bootloader || !uploadState.partitions || !uploadState.firmware) {
    return null;
  }

  return {
    name: `${projectName || board.name} (${board.name})`,
    version: "upload-bundle",
    builds: [
      {
        chipFamily: board.family,
        parts: [
          { path: createFileUrl(uploadState.bootloader), offset: 0 },
          { path: createFileUrl(uploadState.partitions), offset: 32768 },
          { path: createFileUrl(uploadState.firmware), offset: APPLICATION_OFFSET },
        ],
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

  if (!serialLocked) {
    return "Reserve the serial port before flashing so build and serial sessions cannot overlap.";
  }

  if (flashSource === "server") {
    if (serverBuildIsStale) {
      return "The GPIO mapping changed after the last server build. Rebuild before flashing.";
    }

    if (eraseFirst) {
      return "Server builds currently expose the application binary only. Turn off 'erase all flash' or switch to a full bundled/upload bundle.";
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
        : "Upload bootloader, partitions, and firmware binaries to build a flasher manifest.";
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
