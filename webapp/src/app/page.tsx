/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchCurrentHouseTemperature, fetchCurrentWeather, fetchDashboardDevices, fetchDevices, fetchSystemLogs, markSystemLogRead, markAllSystemLogsRead, SystemLogEntry, fetchSystemStatus, SystemStatusResponse, CurrentWeatherResponse, HouseTemperatureResponse, updateHouseholdLocation } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/ToastContext";
import Sidebar from '@/components/Sidebar';
import HomeLocationPicker from "@/components/HomeLocationPicker";
import { DeviceConfig } from "@/types/device";
import { useWebSocket } from "@/hooks/useWebSocket";
import { DynamicDeviceCard, getCardMinHeight, getCardMinWidth } from "@/components/DeviceCard";
import { Rnd } from "react-rnd";
import DeviceScanConnectPanel from "@/components/DeviceScanConnectPanel";
import { isSystemLogAlertEntry } from "@/lib/system-log";
import { HomeLocation } from "@/lib/home-location";

type CanvasLayout = { x: number; y: number; w: number; h: number };
const DEFAULT_CARD_WIDTH = 320;
const DEFAULT_CARD_HEIGHT = 350;
const CANVAS_GRID_STEP = 20;
const CANVAS_COLLISION_GAP = CANVAS_GRID_STEP;
const ADMIN_SUPPLEMENTAL_REFRESH_DEBOUNCE_MS = 750;
const WEATHER_LOCATION_MAX_LENGTH = 15;

type DashboardRefreshMode = "admin" | "full";

function snapCanvasCoordinate(value: number) {
  return Math.max(0, Math.round(value / CANVAS_GRID_STEP) * CANVAS_GRID_STEP);
}

function truncateLabel(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trimEnd()}...`;
}

function formatHouseClimateValue(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }

  return Math.round(value).toString();
}

function snapCanvasSize(value: number, minimum: number) {
  return Math.max(minimum, Math.ceil(value / CANVAS_GRID_STEP) * CANVAS_GRID_STEP);
}

function normalizeCanvasLayouts(layout: unknown): Record<string, CanvasLayout> {
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
    return {};
  }

  const source = layout as Record<string, unknown>;
  // Ignore legacy widget payloads; the desktop canvas only understands device-id keyed card bounds.
  if (Array.isArray(source.widgets)) {
    return {};
  }

  const normalized: Record<string, CanvasLayout> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key.includes(":") || !value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const candidate = value as Record<string, unknown>;
    if (
      "deviceId" in candidate ||
      "pin" in candidate ||
      "type" in candidate ||
      "label" in candidate
    ) {
      continue;
    }

    if (
      typeof candidate.x !== "number" ||
      !Number.isFinite(candidate.x) ||
      typeof candidate.y !== "number" ||
      !Number.isFinite(candidate.y)
    ) {
      continue;
    }

    const normalizedWidth =
      typeof candidate.w === "number" && Number.isFinite(candidate.w)
        ? snapCanvasSize(Math.max(200, candidate.w), 200)
        : DEFAULT_CARD_WIDTH;
    const normalizedHeight =
      typeof candidate.h === "number" && Number.isFinite(candidate.h)
        ? snapCanvasSize(Math.max(130, candidate.h), 130)
        : DEFAULT_CARD_HEIGHT;

    normalized[key] = {
      x: snapCanvasCoordinate(candidate.x),
      y: snapCanvasCoordinate(candidate.y),
      w: normalizedWidth,
      h: normalizedHeight,
    };
  }

  return normalized;
}

function getCanvasUsableWidth(windowWidth: number): number {
  return Math.max(DEFAULT_CARD_WIDTH, windowWidth - (windowWidth < 1024 ? 0 : 256) - 48);
}

function mergeDashboardRefreshMode(
  currentMode: DashboardRefreshMode | null,
  nextMode: DashboardRefreshMode,
): DashboardRefreshMode {
  if (currentMode === "full" || nextMode === "full") {
    return "full";
  }

  return "admin";
}

function rectsOverlap(
  rect1: { x: number; y: number; w: number; h: number },
  rect2: { x: number; y: number; w: number; h: number },
) {
  return (
    rect1.x < rect2.x + rect2.w + CANVAS_COLLISION_GAP &&
    rect1.x + rect1.w + CANVAS_COLLISION_GAP > rect2.x &&
    rect1.y < rect2.y + rect2.h + CANVAS_COLLISION_GAP &&
    rect1.y + rect1.h + CANVAS_COLLISION_GAP > rect2.y
  );
}

function getSortedUniqueCanvasOffsets(values: number[]) {
  return Array.from(
    new Set(values.filter((value) => Number.isFinite(value)).map((value) => snapCanvasCoordinate(value))),
  ).sort((left, right) => left - right);
}

function findFirstCanvasSlot(
  occupiedRects: CanvasLayout[],
  width: number,
  height: number,
  maxUsableWidth: number,
): CanvasLayout {
  const nextWidth = snapCanvasSize(Math.min(width, maxUsableWidth), Math.min(200, maxUsableWidth));
  const nextHeight = snapCanvasSize(height, height);
  if (occupiedRects.length === 0) {
    return { x: 0, y: 0, w: nextWidth, h: nextHeight };
  }

  const candidateRows = getSortedUniqueCanvasOffsets([
    0,
    ...occupiedRects.flatMap((rect) => [rect.y, rect.y + rect.h + CANVAS_COLLISION_GAP]),
  ]);

  for (const rowY of candidateRows) {
    const rowCandidates = getSortedUniqueCanvasOffsets([
      0,
      ...occupiedRects
        .filter(
          (rect) =>
            rowY < rect.y + rect.h + CANVAS_COLLISION_GAP &&
            rowY + nextHeight + CANVAS_COLLISION_GAP > rect.y,
        )
        .map((rect) => rect.x + rect.w + CANVAS_COLLISION_GAP),
    ]);

    for (const candidateX of rowCandidates) {
      if (candidateX + nextWidth > maxUsableWidth) {
        continue;
      }

      const candidateRect = { x: candidateX, y: rowY, w: nextWidth, h: nextHeight };
      if (!occupiedRects.some((rect) => rectsOverlap(candidateRect, rect))) {
        return candidateRect;
      }
    }
  }

  const lowestEdge = occupiedRects.reduce((max, rect) => Math.max(max, rect.y + rect.h), 0);
  return {
    x: 0,
    y: lowestEdge > 0 ? snapCanvasCoordinate(lowestEdge + CANVAS_COLLISION_GAP) : 0,
    w: nextWidth,
    h: nextHeight,
  };
}

function DashboardCanvasPreviewCard({
  config,
  isOnline,
}: {
  config: DeviceConfig;
  isOnline: boolean;
}) {
  const roomName = (config as DeviceConfig & { room_name?: string | null }).room_name || "Unassigned room";
  const pinCount = config.pin_configurations.length;
  const modeLabel = config.provider
    ? config.provider
    : config.mode.replace("-", " ");

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-slate-300 bg-white/95 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/95">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{config.name}</div>
          <div className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{roomName}</div>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${
            isOnline
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
              : "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${isOnline ? "bg-emerald-500" : "bg-rose-500"}`} />
          {isOnline ? "Online" : "Offline"}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/80">
          <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">Controls</div>
          <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{pinCount}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/80">
          <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">Source</div>
          <div className="mt-1 truncate text-sm font-medium text-slate-900 dark:text-white">{modeLabel}</div>
        </div>
      </div>

      <div className="mt-4 flex flex-1 flex-col overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50/70 px-3 py-3 dark:border-slate-700 dark:bg-slate-800/40">
        <div className="text-[11px] flex-none uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">Editor Preview</div>
        <div className="mt-3 flex-1 overflow-y-auto min-h-0 space-y-2 pr-1 custom-scrollbar">
          {Array.from({ length: Math.min(3, Math.max(1, pinCount || 1)) }).map((_, index) => (
            <div
              key={`${config.device_id}-preview-${index}`}
              className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900/80"
            >
              <div className="h-2 w-24 rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-2 w-10 rounded bg-slate-200 dark:bg-slate-700" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HomeLocationSetupPrompt({
  isOpen,
  onConfirm,
  isSaving,
}: {
  isOpen: boolean;
  onConfirm: (location: HomeLocation) => Promise<void>;
  isSaving: boolean;
}) {
  const [homeLocation, setHomeLocation] = useState<HomeLocation | null>(null);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="flex items-start gap-3">
            <span className="material-icons-round mt-0.5 text-2xl text-primary">home_pin</span>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Set home location</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                This server was initialized before home weather existed. Choose the house location once so weather follows the home, not this browser.
              </p>
            </div>
          </div>
        </div>

        <div className="max-h-[82vh] overflow-y-auto p-5">
          <HomeLocationPicker
            isOpen={isOpen}
            selectedLocation={homeLocation}
            onLocationChange={setHomeLocation}
            title="Confirm home location"
            description="Allow location access, search manually, or drag the marker to the exact house position before saving."
            isSaving={isSaving}
            labels={{
              noneDescription: "Allow browser location access, search manually, or drag the marker on the map.",
              dragHint: "Drag the marker or click anywhere on the map to place the home exactly where this server lives.",
            }}
            actions={(
              <button
                type="button"
                onClick={() => homeLocation ? void onConfirm(homeLocation) : null}
                disabled={isSaving || !homeLocation}
                className="flex w-full items-center justify-center rounded-lg bg-primary py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-600 disabled:opacity-70"
              >
                {isSaving ? <span className="material-icons-round animate-spin">refresh</span> : "Confirm home location"}
              </button>
            )}
          />
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const { showToast } = useToast();
  const [devices, setDevices] = useState<DeviceConfig[]>([]);
  const [pairingRequests, setPairingRequests] = useState<DeviceConfig[]>([]);
  const [systemLogs, setSystemLogs] = useState<SystemLogEntry[]>([]);
  const [latestFirmwareRevision, setLatestFirmwareRevision] = useState<string | null>(null);
  const [serverTimezone, setServerTimezone] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [showNotifications, setShowNotifications] = useState(false);
  const [mountDropdown, setMountDropdown] = useState(false);
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [markingAllNotifications, setMarkingAllNotifications] = useState(false);
  const [markingNotificationIds, setMarkingNotificationIds] = useState<Set<number>>(new Set());
  const [notificationError, setNotificationError] = useState("");
  const [weatherData, setWeatherData] = useState<CurrentWeatherResponse | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [houseTemperatureData, setHouseTemperatureData] = useState<HouseTemperatureResponse | null>(null);
  const [houseTemperatureLoading, setHouseTemperatureLoading] = useState(true);
  const [houseTemperatureError, setHouseTemperatureError] = useState<string | null>(null);
  const [homeLocationPromptOpen, setHomeLocationPromptOpen] = useState(false);
  const [isSavingHomeLocation, setIsSavingHomeLocation] = useState(false);
  const notificationRef = useRef<HTMLDivElement>(null);
  const dashboardRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const queuedDashboardRefreshModeRef = useRef<DashboardRefreshMode | null>(null);
  const adminRefreshTimeoutRef = useRef<number | null>(null);
  const hasLoadedInitialDashboardSnapshotRef = useRef(false);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) {
        if (showNotifications) {
          setShowNotifications(false);
          setTimeout(() => setMountDropdown(false), 300);
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showNotifications]);
  
  const [isCustomizeMode, setIsCustomizeMode] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [canvasLayouts, setCanvasLayouts] = useState<Record<string, CanvasLayout>>({});
  const [isSavingLayout, setIsSavingLayout] = useState(false);
  const [saveLayoutSuccess, setSaveLayoutSuccess] = useState(false);

  useEffect(() => {
    const serverLayouts = normalizeCanvasLayouts(user?.ui_layout);
    if (Object.keys(serverLayouts).length > 0) {
      setCanvasLayouts(serverLayouts);
    } else if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("dashboardCanvasLayout");
        if (saved) {
          const savedLayouts = normalizeCanvasLayouts(JSON.parse(saved));
          setCanvasLayouts(savedLayouts);
          if (Object.keys(savedLayouts).length === 0) {
            localStorage.removeItem("dashboardCanvasLayout");
          }
        } else {
          setCanvasLayouts({});
        }
      } catch {
        setCanvasLayouts({});
      }
    } else {
      setCanvasLayouts({});
    }

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "dashboardCanvasLayout" && e.newValue) {
        try {
          const savedLayouts = normalizeCanvasLayouts(JSON.parse(e.newValue));
          setCanvasLayouts(savedLayouts);
          if (Object.keys(savedLayouts).length === 0) {
            localStorage.removeItem("dashboardCanvasLayout");
          }
        } catch {
          setCanvasLayouts({});
        }
      }
    };
    
    if (typeof window !== "undefined") {
      window.addEventListener("storage", handleStorageChange);
      return () => window.removeEventListener("storage", handleStorageChange);
    }
  }, [user]);

  const [windowWidth, setWindowWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const loadHomeWeather = useCallback(async (options?: { silent?: boolean; isCancelled?: () => boolean }) => {
    const isCancelled = options?.isCancelled ?? (() => false);
    setWeatherLoading(true);
    try {
      const data = await fetchCurrentWeather();
      if (!isCancelled()) {
        setWeatherData(data);
        setWeatherError(null);
      }
    } catch (error) {
      if (!isCancelled()) {
        const message = error instanceof Error ? error.message : "";
        const isMissingHomeLocation = message.toLowerCase().includes("home location");
        setWeatherError(isMissingHomeLocation ? "Set home location" : "Weather unavailable");
        setWeatherData(null);
        if (isMissingHomeLocation) {
          setHomeLocationPromptOpen(true);
        } else if (!options?.silent) {
          showToast("Weather is unavailable right now.", "warning");
        }
      }
    } finally {
      if (!isCancelled()) {
        setWeatherLoading(false);
      }
    }
  }, [showToast]);

  useEffect(() => {
    let cancelled = false;
    void loadHomeWeather({ silent: true, isCancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, [loadHomeWeather]);

  const loadHouseTemperature = useCallback(async (options?: { silent?: boolean; isCancelled?: () => boolean }) => {
    const isCancelled = options?.isCancelled ?? (() => false);
    setHouseTemperatureLoading(true);
    try {
      const data = await fetchCurrentHouseTemperature();
      if (!isCancelled()) {
        setHouseTemperatureData(data);
        setHouseTemperatureError(null);
      }
    } catch (error) {
      if (!isCancelled()) {
        const message = error instanceof Error ? error.message : "";
        const isMissingSource = message.toLowerCase().includes("temperature source");
        setHouseTemperatureData(null);
        setHouseTemperatureError(isMissingSource ? "Set source board" : "House temperature unavailable");
        if (!options?.silent && !isMissingSource) {
          showToast("House temperature is unavailable right now.", "warning");
        }
      }
    } finally {
      if (!isCancelled()) {
        setHouseTemperatureLoading(false);
      }
    }
  }, [showToast]);

  useEffect(() => {
    let cancelled = false;
    void loadHouseTemperature({ silent: true, isCancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, [loadHouseTemperature]);

  const handleConfirmHomeLocation = async (location: HomeLocation) => {
    setIsSavingHomeLocation(true);
    try {
      await updateHouseholdLocation({
        latitude: location.latitude,
        longitude: location.longitude,
        label: location.label,
        source: location.source,
      });
      setHomeLocationPromptOpen(false);
      showToast("Home location saved. Weather now follows your house.", "success");
      await loadHomeWeather({ silent: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save home location";
      showToast(message, "error");
    } finally {
      setIsSavingHomeLocation(false);
    }
  };

  const isMobile = windowWidth < 1024;
  const enableDesktopCanvasEditor = true;

  const saveCanvasLayout = async () => {
    setIsSavingLayout(true);
    const layout = normalizeCanvasLayouts(persistedCanvasLayout);
    setCanvasLayouts(layout);
    
    // Attempt saving to DB if possible
    try {
      const { updateUiLayout } = await import("@/lib/api");
      await updateUiLayout(layout);
    } catch (e) {
      console.warn("Failed to sync layout to server", e);
    }
    
    localStorage.setItem("dashboardCanvasLayout", JSON.stringify(layout));
    
    setIsSavingLayout(false);
    setSaveLayoutSuccess(true);
    
    setTimeout(() => {
      setSaveLayoutSuccess(false);
      setIsCustomizeMode(false);
    }, 800);
  };

  const resetCanvasLayout = async () => {
    try {
      const { updateUiLayout } = await import("@/lib/api");
      await updateUiLayout({});
    } catch (e) {
      console.warn("Failed to clear layout on server", e);
    }
    localStorage.removeItem("dashboardCanvasLayout");
    setCanvasLayouts({});
    setLayoutVersion(v => v + 1);
    setIsCustomizeMode(false);
  };

  const isAdmin = user?.account_type === "admin";
  const applySystemStatus = useCallback((statusRes: SystemStatusResponse | null) => {
    if (!statusRes) {
      return;
    }

    setLatestFirmwareRevision(statusRes.latest_firmware_revision || null);
    if (statusRes.effective_timezone) {
      setServerTimezone(statusRes.effective_timezone);
    }
  }, []);

  const loadFullDashboardData = useCallback(async () => {
    const [dashboardDevices, pendingRequests, logsRes, statusRes] = await Promise.all([
      fetchDashboardDevices(),
      isAdmin ? fetchDevices({ authStatus: "pending" }) : Promise.resolve([]),
      isAdmin ? fetchSystemLogs(undefined, 500) : Promise.resolve({ entries: [] }),
      fetchSystemStatus().catch(() => null),
    ]);

    setDevices(dashboardDevices);
    setPairingRequests((pendingRequests as DeviceConfig[]) || []);
    if (isAdmin) {
      setSystemLogs(logsRes.entries);
    }
    applySystemStatus(statusRes);
    hasLoadedInitialDashboardSnapshotRef.current = true;
  }, [applySystemStatus, isAdmin]);

  const loadAdminSupplementalData = useCallback(async () => {
    if (!isAdmin) {
      return;
    }

    const [pendingRequests, logsRes, statusRes] = await Promise.all([
      fetchDevices({ authStatus: "pending" }),
      fetchSystemLogs(undefined, 500),
      fetchSystemStatus().catch(() => null),
    ]);

    setPairingRequests((pendingRequests as DeviceConfig[]) || []);
    setSystemLogs(logsRes.entries);
    applySystemStatus(statusRes);
  }, [applySystemStatus, isAdmin]);

  const runDashboardRefresh = useCallback((mode: DashboardRefreshMode) => {
    if (mode === "full" && adminRefreshTimeoutRef.current !== null) {
      window.clearTimeout(adminRefreshTimeoutRef.current);
      adminRefreshTimeoutRef.current = null;
    }

    if (dashboardRefreshPromiseRef.current) {
      queuedDashboardRefreshModeRef.current = mergeDashboardRefreshMode(
        queuedDashboardRefreshModeRef.current,
        mode,
      );
      return dashboardRefreshPromiseRef.current;
    }

    const refreshPromise = (async () => {
      let nextMode: DashboardRefreshMode | null = mode;

      // Coalesce realtime bursts so admin pages do not fan out overlapping refresh batches.
      while (nextMode) {
        queuedDashboardRefreshModeRef.current = null;

        try {
          if (nextMode === "full" || !isAdmin) {
            await loadFullDashboardData();
          } else {
            await loadAdminSupplementalData();
          }
        } catch (error) {
          console.error(
            nextMode === "full" ? "Failed to sync dashboard data:" : "Failed to refresh admin dashboard data:",
            error,
          );
        } finally {
          setLoading(false);
        }

        nextMode = queuedDashboardRefreshModeRef.current;
      }
    })().finally(() => {
      dashboardRefreshPromiseRef.current = null;
      queuedDashboardRefreshModeRef.current = null;
    });

    dashboardRefreshPromiseRef.current = refreshPromise;
    return refreshPromise;
  }, [isAdmin, loadAdminSupplementalData, loadFullDashboardData]);

  const scheduleAdminSupplementalRefresh = useCallback(() => {
    if (!isAdmin) {
      return;
    }

    if (adminRefreshTimeoutRef.current !== null) {
      window.clearTimeout(adminRefreshTimeoutRef.current);
    }

    adminRefreshTimeoutRef.current = window.setTimeout(() => {
      adminRefreshTimeoutRef.current = null;
      void runDashboardRefresh("admin");
    }, ADMIN_SUPPLEMENTAL_REFRESH_DEBOUNCE_MS);
  }, [isAdmin, runDashboardRefresh]);

  useEffect(() => {
    return () => {
      if (adminRefreshTimeoutRef.current !== null) {
        window.clearTimeout(adminRefreshTimeoutRef.current);
        adminRefreshTimeoutRef.current = null;
      }
    };
  }, []);



  useWebSocket((event) => {
    if ((event.type === "pairing_requested" || event.type === "pairing_queue_updated") && isAdmin) {
      scheduleAdminSupplementalRefresh();
      return;
    }

    if (!("device_id" in event)) {
      return;
    }

    const hasKnownDevice = devices.some((device) => device.device_id === event.device_id);

    if (
      (event.type === "device_online" || event.type === "device_state") &&
      !hasKnownDevice
    ) {
      if (!hasLoadedInitialDashboardSnapshotRef.current) {
        return;
      }
      void runDashboardRefresh("full");
      return;
    }

    startTransition(() => {
      setDevices((prev) => {
        let didChange = false;

        const next = prev.map((device): DeviceConfig => {
          if (device.device_id !== event.device_id) {
            return device;
          }

          didChange = true;

          if (event.type === "device_online") {
            const reportedAt =
              typeof event.payload?.reported_at === "string" ? event.payload.reported_at : null;
            return {
              ...device,
              conn_status: "online",
              last_seen: reportedAt ?? device.last_seen,
            };
          }
          if (event.type === "device_offline") {
            return { ...device, conn_status: "offline" };
          }
          if (event.type === "device_state") {
            const reportedAt =
              typeof event.payload?.reported_at === "string" ? event.payload.reported_at : null;
            return {
              ...device,
              conn_status: "online",
              last_state: (event.payload ?? null) as DeviceConfig["last_state"],
              last_seen: reportedAt ?? device.last_seen,
            };
          }
          if (event.type === "command_delivery") {
            return {
              ...device,
              last_delivery: (event.payload ?? null) as DeviceConfig["last_delivery"],
            };
          }

          return device;
        });

        return didChange ? next : prev;
      });
    });

    if (event.type === "device_offline" && isAdmin) {
      scheduleAdminSupplementalRefresh();
    }
  });

  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      if (!cancelled) {
        void runDashboardRefresh("full");
      }
    }, 50);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [runDashboardRefresh]);

  const isDeviceOnline = (d: DeviceConfig) => {
    return d.auth_status === "approved" && d.conn_status === "online";
  };

  const approvedDevices = devices.filter((device) => device.auth_status === "approved" && device.show_on_dashboard !== false);
  const onlineDevices = approvedDevices.filter(isDeviceOnline);
  const offlineDevices = approvedDevices.filter((d) => !isDeviceOnline(d));

  const onlineCount = onlineDevices.length;
  const hasCustomLayout = approvedDevices.some((device) => Boolean(canvasLayouts[device.device_id]));
  const weatherLocationName = weatherData?.location_name || "Home Weather";
  const weatherLocationLabel = truncateLabel(weatherLocationName, WEATHER_LOCATION_MAX_LENGTH);
  const houseTemperatureSourceName = houseTemperatureData?.device_name || "No source selected";
  const houseTemperatureSourceLabel = truncateLabel(houseTemperatureSourceName, WEATHER_LOCATION_MAX_LENGTH);
  const shouldUseCanvas = enableDesktopCanvasEditor && isMounted && !isMobile;
  const canvasUsableWidth = useMemo(() => getCanvasUsableWidth(windowWidth), [windowWidth]);
  const cardHeights = useMemo(
    () =>
      new Map(
        approvedDevices.map((device) => {
          const minHeight = getCardMinHeight(device);
          return [device.device_id, snapCanvasSize(minHeight, minHeight)];
        }),
      ),
    [approvedDevices],
  );

  const cardWidths = useMemo(
    () =>
      new Map(
        approvedDevices.map((device) => {
          const minWidth = getCardMinWidth(device);
          return [device.device_id, snapCanvasSize(minWidth, minWidth)];
        }),
      ),
    [approvedDevices],
  );
  
  const computedLayouts = useMemo(() => {
    if (!shouldUseCanvas) {
      return {};
    }

    const computed: Record<string, CanvasLayout> = {};
    const normalizedSavedLayouts = approvedDevices.reduce<Record<string, CanvasLayout>>((acc, device) => {
      const savedLayout = canvasLayouts[device.device_id];
      if (!savedLayout) {
        return acc;
      }

      const estimatedHeight = cardHeights.get(device.device_id) ?? DEFAULT_CARD_HEIGHT;
      const estimatedWidth = cardWidths.get(device.device_id) ?? DEFAULT_CARD_WIDTH;
      acc[device.device_id] = {
        x:
          typeof savedLayout.x === "number" && !Number.isNaN(savedLayout.x)
            ? snapCanvasCoordinate(savedLayout.x)
            : 0,
        y:
          typeof savedLayout.y === "number" && !Number.isNaN(savedLayout.y)
            ? snapCanvasCoordinate(savedLayout.y)
            : 0,
        w:
          typeof savedLayout.w === "number" && Number.isFinite(savedLayout.w)
            ? snapCanvasSize(Math.max(estimatedWidth, savedLayout.w), estimatedWidth)
            : estimatedWidth,
        h:
          typeof savedLayout.h === "number" && Number.isFinite(savedLayout.h)
            ? snapCanvasSize(Math.max(estimatedHeight, savedLayout.h), estimatedHeight)
            : estimatedHeight,
      };
      return acc;
    }, {});

    for (const device of approvedDevices) {
      const savedLayout = normalizedSavedLayouts[device.device_id];
      if (savedLayout) {
        computed[device.device_id] = savedLayout;
      }
    }

    for (const device of approvedDevices) {
      const deviceId = device.device_id;
      if (computed[deviceId]) {
        continue;
      }

      const estimatedHeight = cardHeights.get(deviceId) ?? DEFAULT_CARD_HEIGHT;
      const estimatedWidth = cardWidths.get(deviceId) ?? DEFAULT_CARD_WIDTH;
      computed[deviceId] = findFirstCanvasSlot(
        Object.values(computed),
        estimatedWidth,
        estimatedHeight,
        canvasUsableWidth,
      );
    }

    return computed;
  }, [approvedDevices, canvasLayouts, canvasUsableWidth, cardHeights, cardWidths, shouldUseCanvas]);
  const persistedCanvasLayout = useMemo(() => {
    if (!shouldUseCanvas) {
      return canvasLayouts;
    }

    return approvedDevices.reduce<Record<string, CanvasLayout>>((acc, device) => {
      const layout = computedLayouts[device.device_id];
      if (layout) {
        acc[device.device_id] = layout;
      }
      return acc;
    }, {});
  }, [approvedDevices, canvasLayouts, computedLayouts, shouldUseCanvas]);
  const canvasContentHeight = useMemo(() => {
    if (!shouldUseCanvas || approvedDevices.length === 0) {
      return 0;
    }

    const lowestCardEdge = approvedDevices.reduce((max, config) => {
      if (!("device_id" in config)) {
        return max;
      }

      const c = config as DeviceConfig;
      const fallbackHeight = cardHeights.get(c.device_id) ?? DEFAULT_CARD_HEIGHT;
      const fallbackWidth = cardWidths.get(c.device_id) ?? DEFAULT_CARD_WIDTH;
      const layout = computedLayouts[c.device_id] || { x: 0, y: 0, w: fallbackWidth, h: fallbackHeight };
      return Math.max(max, layout.y + layout.h);
    }, 10);

    return lowestCardEdge + (isCustomizeMode ? 400 : 20);
  }, [approvedDevices, cardHeights, cardWidths, computedLayouts, isCustomizeMode, shouldUseCanvas]);
  const hasCanvasOverlap = useCallback(
    (deviceId: string, nextRect: CanvasLayout) => {
      for (const [id, bounds] of Object.entries(computedLayouts)) {
        if (id === deviceId) {
          continue;
        }
        if (rectsOverlap(nextRect, bounds)) {
          return true;
        }
      }
      return false;
    },
    [computedLayouts],
  );
  const outdatedDevices = useMemo(() => {
    if (!latestFirmwareRevision || devices.length === 0) return [];
    return devices.filter(d => !!d.firmware_revision && d.firmware_revision !== latestFirmwareRevision);
  }, [devices, latestFirmwareRevision]);
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const newThisWeek = devices.filter(d => d.created_at && new Date(d.created_at) > oneWeekAgo).length;

  const visibleNotifications = useMemo(() => {
    return systemLogs.filter((entry) => isSystemLogAlertEntry(entry) && !entry.is_read);
  }, [systemLogs]);

  const alertCount = visibleNotifications.length;

  const highestSeverity = useMemo(() => {
    if (visibleNotifications.length === 0) return 'none';
    if (visibleNotifications.some(n => n.severity === 'critical')) return 'critical';
    if (visibleNotifications.some(n => n.severity === 'error')) return 'error';
    if (visibleNotifications.some(n => n.severity === 'warning')) return 'warning';
    return 'info';
  }, [visibleNotifications]);

  const alertIconColor = highestSeverity === 'critical' || highestSeverity === 'error' ? 'text-red-500 dark:group-hover:text-red-400' :
                         highestSeverity === 'warning' ? 'text-orange-500 dark:group-hover:text-orange-400' :
                         highestSeverity === 'info' ? 'text-blue-500 dark:group-hover:text-blue-400' :
                         'text-green-500 dark:group-hover:text-green-400';

  const alertTextColor = highestSeverity === 'critical' || highestSeverity === 'error' ? 'text-red-500 dark:text-red-400' :
                         highestSeverity === 'warning' ? 'text-orange-500 dark:text-orange-400' :
                         highestSeverity === 'info' ? 'text-blue-500 dark:text-blue-400' :
                         'text-green-500 dark:text-green-400';
  
  const alertCardIcon = highestSeverity === 'critical' || highestSeverity === 'error' ? 'report' :
                        highestSeverity === 'warning' ? 'warning' :
                        highestSeverity === 'info' ? 'info' :
                        'check_circle';

  const alertCardDynamicClasses = highestSeverity === 'critical' || highestSeverity === 'error'
    ? "animate-[pulse_1s_ease-in-out_infinite] border-red-500 dark:border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.4)] dark:shadow-[0_0_15px_rgba(248,113,113,0.3)] bg-red-50 dark:bg-red-900/20 focus:outline-none focus:ring-2 focus:ring-red-500"
    : highestSeverity === 'warning'
    ? "border-slate-200 dark:border-slate-700 shadow-sm hover:border-orange-300 dark:hover:border-orange-500 hover:shadow-[0_0_15px_rgba(249,115,22,0.2)] dark:hover:shadow-[0_0_15px_rgba(251,146,60,0.15)] hover:bg-orange-50 dark:hover:bg-orange-900/10 focus:outline-none focus:ring-2 focus:ring-orange-500"
    : highestSeverity === 'info'
    ? "border-slate-200 dark:border-slate-700 shadow-sm hover:border-blue-300 dark:hover:border-blue-500 hover:shadow-[0_0_15px_rgba(59,130,246,0.2)] dark:hover:shadow-[0_0_15px_rgba(96,165,250,0.15)] hover:bg-blue-50 dark:hover:bg-blue-900/10 focus:outline-none focus:ring-2 focus:ring-blue-500"
    : "border-slate-200 dark:border-slate-700 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-500 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-green-500";

  const toggleDropdown = () => {
    if (showNotifications) {
      setShowNotifications(false);
      setTimeout(() => setMountDropdown(false), 300);
    } else {
      setMountDropdown(true);
      setTimeout(() => setShowNotifications(true), 10);
    }
  };

  const handleMarkAllNotificationsRead = async () => {
    if (!isAdmin || markingAllNotifications || visibleNotifications.length === 0) {
      return;
    }

    setNotificationError("");
    setMarkingAllNotifications(true);

    try {
      await markAllSystemLogsRead();
      // Wait for slide-out animation to finish
      await new Promise(r => setTimeout(r, 300));
      setSystemLogs((prev) =>
        prev.map((entry) =>
          isSystemLogAlertEntry(entry) && !entry.is_read
            ? { ...entry, is_read: true }
            : entry,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to mark all alerts as read";
      setNotificationError(message);
    } finally {
      setMarkingAllNotifications(false);
    }
  };

  const handleSingleNotifClick = async (notif: SystemLogEntry) => {
    if (!isAdmin) {
      return;
    }

    if (!notif.is_read) {
      setNotificationError("");
      setMarkingNotificationIds((current) => new Set(current).add(notif.id));

      try {
        await markSystemLogRead(notif.id);
        
        // Wait for slide-out animation to finish
        await new Promise(r => setTimeout(r, 300));
        
        setSystemLogs((prev) => prev.map((entry) => (
          entry.id === notif.id ? { ...entry, is_read: true } : entry
        )));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to mark alert as read";
        setNotificationError(message);
        return;
      } finally {
        setMarkingNotificationIds((current) => {
          const next = new Set(current);
          next.delete(notif.id);
          return next;
        });
      }
    }
    router.push("/logs?view=alerts");
  };

  const greetingText = useMemo(() => {
    let currentHour = new Date().getHours();
    if (serverTimezone) {
      try {
        const timeString = new Intl.DateTimeFormat('en-US', {
            timeZone: serverTimezone,
            hour: '2-digit',
            hour12: false
        }).format(new Date());
        currentHour = parseInt(timeString, 10);
      } catch {
        // Fallback to local time if timezone string is invalid
      }
    }

    let greeting = "Good evening";
    if (currentHour >= 5 && currentHour < 12) {
        greeting = "Good morning";
    } else if (currentHour >= 12 && currentHour < 18) {
        greeting = "Good afternoon";
    }

    const name = user?.fullname || user?.username || "";
    return name ? `${greeting}, ${name}` : greeting;
  }, [serverTimezone, user]);

  return (
    <div className="bg-background-light dark:bg-background-dark text-slate-800 dark:text-slate-200 font-sans h-screen flex overflow-hidden selection:bg-primary selection:text-white">
      {isAdmin && isScanModalOpen ? (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div
            className="absolute inset-0"
            onClick={() => setIsScanModalOpen(false)}
          />
          <div className="relative z-10 w-full max-w-xl">
            <DeviceScanConnectPanel onClose={() => setIsScanModalOpen(false)} />
          </div>
        </div>
      ) : null}

      {homeLocationPromptOpen ? (
        <HomeLocationSetupPrompt
          isOpen={homeLocationPromptOpen}
          isSaving={isSavingHomeLocation}
          onConfirm={handleConfirmHomeLocation}
        />
      ) : null}

      <Sidebar />

      <main className="flex-1 flex flex-col min-w-0 relative">
        <header className="h-16 bg-surface-light dark:bg-surface-dark border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-6 shadow-sm z-30">
          <h1 className="text-lg font-semibold text-slate-800 dark:text-white capitalize truncate pr-4">{greetingText}</h1>
          <div className="flex items-center space-x-4">
            <div className="relative group" ref={notificationRef}>
              <button
                className="w-10 h-10 flex items-center justify-center text-primary bg-blue-50 dark:bg-blue-500/10 rounded-full transition-colors relative outline-none ring-2 ring-blue-100 dark:ring-blue-900/30"
                onClick={toggleDropdown}
              >
                <span className="material-icons-round">notifications</span>
                {alertCount > 0 && (
                  <span className="absolute top-1.5 right-2 flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500 border border-white dark:border-slate-900"></span>
                  </span>
                )}
              </button>

              {mountDropdown && (
                <div 
                  className={`absolute right-0 top-full mt-3 w-80 sm:w-96 bg-surface-light dark:bg-surface-dark rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden z-50 transition-all duration-300 ease-out origin-top-right transform ${showNotifications ? 'scale-100 opacity-100 translate-y-0' : 'scale-90 opacity-0 -translate-y-2'}`}
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/50 backdrop-blur-sm">
                    <h3 className="font-semibold text-sm text-slate-800 dark:text-slate-100">Notifications</h3>
                    {visibleNotifications.length > 0 && (
                      <button
                        onClick={() => void handleMarkAllNotificationsRead()}
                        disabled={markingAllNotifications}
                        className="text-xs font-medium text-slate-500 hover:text-primary transition-colors flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className={`material-icons-round text-[14px] ${markingAllNotifications ? "animate-spin" : ""}`}>
                          {markingAllNotifications ? "autorenew" : "mark_email_read"}
                        </span>
                        Mark all read
                      </button>
                    )}
                  </div>
                  {notificationError ? (
                    <div className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                      {notificationError}
                    </div>
                  ) : null}
                  <div className="max-h-[32rem] overflow-y-auto">
                    {visibleNotifications.length === 0 ? (
                      <div className="p-8 text-center text-sm text-slate-500 flex flex-col items-center justify-center">
                        <span className="material-icons-round text-4xl text-slate-300 dark:text-slate-600 mb-2">notifications_off</span>
                        <p>No new notifications</p>
                      </div>
                    ) : (
                      visibleNotifications.map((notif) => {
                          const isMarking = markingNotificationIds.has(notif.id);
                          const severityColor = notif.severity === 'info' ? 'text-sky-500 bg-sky-100 dark:bg-sky-500/10 dark:text-sky-400' :
                                                notif.severity === 'warning' ? 'text-amber-500 bg-amber-100 dark:bg-amber-500/10 dark:text-amber-400' :
                                                notif.severity === 'error' ? 'text-rose-500 bg-rose-100 dark:bg-rose-500/10 dark:text-rose-400' :
                                                'text-red-500 bg-red-100 dark:bg-red-500/10 dark:text-red-400';
                          const icon = notif.severity === 'info' ? 'info' :
                                       notif.severity === 'warning' ? 'warning' :
                                       notif.severity === 'error' ? 'error' : 'report';
                          return (
                            <div key={notif.id} 
                              className={`p-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 border-b border-slate-100 dark:border-slate-700/50 cursor-pointer relative transition-all duration-300 ease-in-out ${(isMarking || markingAllNotifications) ? 'opacity-0 -translate-x-full pointer-events-none' : 'opacity-100 translate-x-0'}`}
                              onClick={() => void handleSingleNotifClick(notif)}
                            >
                              <div className="flex gap-3">
                                <div className="flex-shrink-0 mt-1">
                                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${severityColor}`}>
                                    <span className="material-icons-round text-lg">{icon}</span>
                                  </div>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex justify-between items-start mb-1">
                                    <p className="text-sm text-slate-900 flex items-center gap-2 dark:text-white mt-1 font-bold capitalize">
                                      {notif.category}
                                      <span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span>
                                    </p>
                                    {isMarking ? <span className="material-icons-round animate-spin text-sm text-slate-400">autorenew</span> : null}
                                  </div>
                                  <p className="text-xs break-all sm:break-words text-slate-700 dark:text-slate-300 font-medium">{notif.message}</p>
                                  <p className="text-[10px] text-slate-400 mt-1">{new Date(notif.occurred_at).toLocaleString()}</p>
                                </div>
                              </div>
                            </div>
                          );
                      })
                    )}
                  </div>
                  <a className="block w-full text-center py-2 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-700 text-xs font-medium text-slate-500 hover:text-primary transition-colors" href="/logs">
                    View Activity Log
                  </a>
                </div>
              )}
            </div>
            {isAdmin ? (
              <button
                onClick={() => setIsScanModalOpen(true)}
                className="relative flex items-center bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-600 transition-all shadow-md hover:shadow-lg"
              >
                <span className="material-icons-round text-sm mr-2">radar</span>
                Scan Device
                {pairingRequests.length > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 border-2 border-white dark:border-slate-800"></span>
                  </span>
                )}
              </button>
            ) : null}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
          <div className="max-w-7xl mx-auto w-full">
            {!isAdmin ? (
              <div className="mb-6 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
                Only devices in rooms assigned by an administrator appear here. Pairing and device-management actions stay hidden for non-admin accounts.
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-6 mb-8 md:grid-cols-2 lg:grid-cols-4">
              <div
                className="bg-surface-light dark:bg-surface-dark hover:bg-slate-50 dark:hover:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-500 shadow-sm hover:shadow-md relative overflow-hidden group transition-all duration-300"
              >
                <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-40 transition-all duration-300 transform group-hover:scale-110 group-hover:-translate-y-1">
                  <span className="material-icons-round text-6xl text-sky-500 dark:text-sky-400 group-hover:text-sky-600 dark:group-hover:text-sky-300 transition-colors">{weatherData?.icon || 'wb_cloudy'}</span>
                </div>
                <div className="relative z-10 transform group-hover:scale-[1.03] origin-left transition-transform duration-300">
                  <p
                    className="text-slate-500 dark:text-slate-400 text-sm font-medium"
                    title={weatherLocationName}
                  >
                    {weatherLocationLabel}
                  </p>
                  
                  {weatherLoading ? (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="material-icons-round text-slate-400 animate-spin">autorenew</span>
                      <span className="text-sm text-slate-500">Loading weather...</span>
                    </div>
                  ) : weatherError ? (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="material-icons-round text-red-400 text-lg">error_outline</span>
                      <span className="text-sm text-slate-500">{weatherError}</span>
                    </div>
                  ) : weatherData ? (
                    <>
                      <h3 className="text-3xl font-bold text-slate-900 dark:text-white mt-2 flex items-start">
                        {Math.round(weatherData.temperature)}<span className="text-lg font-medium text-slate-500 mt-1">°C</span>
                      </h3>
                      <div className="mt-2 text-xs flex items-center font-medium text-slate-500 dark:text-slate-400">
                        <span className="material-icons-round text-sm mr-1">{weatherData.icon}</span>
                        {weatherData.description}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
              <div
                className={`bg-surface-light dark:bg-surface-dark hover:bg-slate-50 dark:hover:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-500 shadow-sm hover:shadow-md relative overflow-hidden group transition-all duration-300 ${isAdmin ? "cursor-pointer" : ""}`}
                onClick={isAdmin ? () => router.push("/settings") : undefined}
                onKeyDown={isAdmin ? ((event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    router.push("/settings");
                  }
                }) : undefined}
                role={isAdmin ? "button" : undefined}
                tabIndex={isAdmin ? 0 : undefined}
              >
                <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-40 transition-all duration-300 transform group-hover:scale-110 group-hover:-translate-y-1">
                  <span className="material-icons-round text-6xl text-orange-500 dark:text-orange-400 group-hover:text-orange-600 dark:group-hover:text-orange-300 transition-colors">device_thermostat</span>
                </div>
                <div className="relative z-10 transform group-hover:scale-[1.03] origin-left transition-transform duration-300">
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">House Temperature</p>
                  <p className="mt-1 text-xs text-slate-400 dark:text-slate-500" title={houseTemperatureSourceName}>
                    {houseTemperatureSourceLabel}
                  </p>

                  {houseTemperatureLoading ? (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="material-icons-round text-slate-400 animate-spin">autorenew</span>
                      <span className="text-sm text-slate-500">Loading temperature...</span>
                    </div>
                  ) : houseTemperatureError ? (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="material-icons-round text-red-400 text-lg">error_outline</span>
                      <span className="text-sm text-slate-500">{houseTemperatureError}</span>
                    </div>
                  ) : houseTemperatureData ? (
                    <>
                      <h3 className="text-3xl font-bold text-slate-900 dark:text-white mt-2 flex items-center">
                        <span className="flex items-start">
                          {formatHouseClimateValue(houseTemperatureData.temperature)}<span className="text-xl font-medium text-slate-500 mt-1 ml-0.5">°C</span>
                        </span>
                        {houseTemperatureData.humidity != null && (
                          <>
                            <span className="text-3xl font-light text-slate-300 dark:text-slate-600 mx-3">/</span>
                            <span className="flex items-start text-slate-700 dark:text-slate-300">
                              {formatHouseClimateValue(houseTemperatureData.humidity)}<span className="text-xl font-medium text-slate-500 mt-1 ml-0.5">%</span>
                            </span>
                          </>
                        )}
                      </h3>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className={`inline-flex items-center rounded-full px-2 py-1 font-medium ${
                          houseTemperatureData.is_online
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                            : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                        }`}>
                          {houseTemperatureData.is_online ? "Live" : "Offline"}
                        </span>
                        {houseTemperatureData.source_label ? <span>{houseTemperatureData.source_label}</span> : null}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
              <div
                className="bg-surface-light dark:bg-surface-dark hover:bg-slate-50 dark:hover:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-500 shadow-sm hover:shadow-md relative overflow-hidden group transition-all duration-300 cursor-pointer"
                onClick={() => router.push("/devices")}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    router.push("/devices");
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-40 transition-all duration-300 transform group-hover:scale-110 group-hover:-translate-y-1">
                  <span className="material-icons-round text-6xl text-indigo-500 dark:text-indigo-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors">devices</span>
                </div>
                <div className="relative z-10 transform group-hover:scale-[1.03] origin-left transition-transform duration-300">
                  <div>
                    <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">Device Overview</p>
                    <div className="flex items-end gap-3 mt-2">
                      <h3 className="text-3xl font-bold text-slate-900 dark:text-white leading-none tracking-tight">{loading ? '--' : devices.length.toString().padStart(2, '0')}</h3>
                      <div className="flex flex-wrap items-center gap-2 pb-0.5 text-xs font-medium">
                        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-100 dark:bg-slate-800/50 rounded-md">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500"></span>
                          <span className="text-slate-600 dark:text-slate-300">{loading ? '-' : onlineCount} <span className="text-slate-500 dark:text-slate-400 font-normal">On</span></span>
                        </div>
                        <div className={`flex items-center gap-1.5 px-2 py-0.5 ${offlineDevices.length > 0 ? "bg-red-50 dark:bg-red-500/10" : "bg-slate-100 dark:bg-slate-800/50"} rounded-md`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${offlineDevices.length > 0 ? "bg-red-500 animate-[pulse_1.5s_ease-in-out_infinite]" : "bg-slate-300 dark:bg-slate-600"}`}></span>
                          <span className={`${offlineDevices.length > 0 ? "text-red-600 dark:text-red-400 font-semibold" : "text-slate-600 dark:text-slate-300"}`}>{loading ? '-' : offlineDevices.length} <span className={`${offlineDevices.length > 0 ? "text-red-500 dark:text-red-400/80" : "text-slate-500 dark:text-slate-400"} font-normal`}>Off</span></span>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className={`mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs flex items-center font-medium ${outdatedDevices.length > 0 ? "text-green-600 dark:text-green-400 animate-[pulse_1.5s_ease-in-out_infinite]" : "text-slate-500 dark:text-slate-400"}`}>
                    <span className="material-icons-round text-sm mr-1">{outdatedDevices.length > 0 ? "system_update" : "trending_up"}</span>
                    {outdatedDevices.length > 0 ? (
                        <div className="flex items-center gap-1">
                            <span>{outdatedDevices.length} update{outdatedDevices.length > 1 ? 's' : ''}</span>
                            <span className="material-icons-round text-[10px]">arrow_forward</span>
                            <span className="font-mono">{latestFirmwareRevision}</span>
                        </div>
                    ) : newThisWeek > 0 ? <span className="text-green-600 dark:text-green-400">{`+${newThisWeek} New this week`}</span> : 'Up to date'}
                  </div>
                </div>
              </div>
              <div
                className={`bg-surface-light dark:bg-surface-dark p-6 rounded-xl border relative overflow-hidden group transition-all duration-300 cursor-pointer ${alertCardDynamicClasses}`}
                onClick={() => router.push("/logs?view=alerts")}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    router.push("/logs?view=alerts");
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-40 transition-all duration-300 transform group-hover:scale-110 group-hover:-translate-y-1">
                  <span className={`material-icons-round text-6xl ${alertIconColor} ${(highestSeverity === 'critical' || highestSeverity === 'error' || highestSeverity === 'warning') ? 'animate-[pulse_2s_ease-in-out_infinite]' : ''} transition-colors`}>{alertCardIcon}</span>
                </div>
                <div className="relative z-10 transform group-hover:scale-[1.03] origin-left transition-transform duration-300">
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">System Alerts</p>
                  <h3 className="text-3xl font-bold text-slate-900 dark:text-white mt-2">{loading ? '--' : alertCount.toString().padStart(2, '0')}</h3>
                  <div className={`mt-2 text-xs flex items-center font-medium ${alertTextColor}`}>
                    <span className="material-icons-round text-sm mr-1">{highestSeverity !== 'none' ? 'priority_high' : 'check'}</span>
                    {alertCount > 0 ? `${alertCount} unhandled issues` : 'All clear'}
                  </div>
                </div>
              </div>
            </div>

            <div className="mb-8">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Device Dashboard</h2>
                <div className="flex space-x-2">
                  {!isMobile && (
                    isCustomizeMode ? (
                      <>
                        <button 
                          onClick={resetCanvasLayout} 
                          disabled={isSavingLayout || saveLayoutSuccess}
                          className="flex items-center px-3 py-1.5 border border-red-300 dark:border-red-600 rounded bg-white dark:bg-slate-800 shadow-sm text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <span className="material-icons-round text-[16px] mr-1.5">restart_alt</span> Reset
                        </button>
                        <button 
                          onClick={saveCanvasLayout} 
                          disabled={isSavingLayout || saveLayoutSuccess}
                          className={`flex items-center justify-center w-[140px] flex-none px-3 py-1.5 text-white rounded shadow-sm text-sm font-medium transition-colors duration-300 ${saveLayoutSuccess ? 'bg-green-500 hover:bg-green-600' : 'bg-primary hover:bg-blue-600'} disabled:opacity-80 disabled:cursor-not-allowed`}
                        >
                          <span className={`material-icons-round flex-none text-[16px] mr-1.5 ${isSavingLayout ? "animate-spin" : ""}`}>
                            {isSavingLayout ? "autorenew" : saveLayoutSuccess ? "check_circle" : "save"}
                          </span> 
                          <span className="flex-none">{isSavingLayout ? "Saving..." : saveLayoutSuccess ? "Saved!" : "Save Layout"}</span>
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setIsCustomizeMode(true)}
                        className="flex items-center rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        <span className="material-icons-round text-[16px] mr-1.5">tune</span> Customize
                      </button>
                    )
                  )}
                </div>
              </div>
              <div className={`relative w-full rounded-xl transition-all duration-300 ${shouldUseCanvas ? `h-[600px] lg:h-[800px] overflow-auto canvas-dot-bg ${isCustomizeMode ? 'bg-slate-100 dark:bg-slate-800/80 border-2 border-dashed border-primary/50' : 'bg-slate-50/50 dark:bg-slate-900/50'}` : 'h-auto min-h-[400px] bg-transparent overflow-visible'}`}>
                {loading ? (
                  <div className="py-12 text-center text-slate-400">Loading devices...</div>
                ) : approvedDevices.length === 0 ? (
                  <div className="py-12 text-center text-slate-400">No devices found.</div>
                ) : shouldUseCanvas ? (
                  <div style={{ minHeight: `${canvasContentHeight}px`, minWidth: "100%", position: "relative" }}>
                    {approvedDevices.map((config) => {
                      if (!("device_id" in config)) return null;
                      const c = config as DeviceConfig;
                      const cardHeight = cardHeights.get(c.device_id) ?? DEFAULT_CARD_HEIGHT;
                      const cardWidth = cardWidths.get(c.device_id) ?? DEFAULT_CARD_WIDTH;
                      const layout = computedLayouts[c.device_id] || { x: 0, y: 0, w: cardWidth, h: cardHeight };
                      const cardContents = isCustomizeMode ? (
                        <DashboardCanvasPreviewCard config={c} isOnline={isDeviceOnline(c)} />
                      ) : (
                        <DynamicDeviceCard config={c} isOnline={isDeviceOnline(c)} />
                      );

                      if (!isCustomizeMode) {
                        return (
                          <div
                            key={c.device_id}
                            className="absolute transition-shadow"
                            style={{
                              left: `${layout.x}px`,
                              top: `${layout.y}px`,
                              width: `${layout.w}px`,
                              height: `${layout.h}px`,
                            }}
                          >
                            <div className="h-full w-full">{cardContents}</div>
                          </div>
                        );
                      }

                      return (
                      <Rnd
                        key={`${c.device_id}-${layoutVersion}`}
                        size={{
                          width: layout.w,
                          height: layout.h,
                        }}
                        position={{ x: layout.x, y: layout.y }}
                        onDragStop={(_event, data) => {
                          const nextX = snapCanvasCoordinate(data.x);
                          const nextY = snapCanvasCoordinate(data.y);
                          const newRect = { x: nextX, y: nextY, w: layout.w, h: layout.h };
                          if (!hasCanvasOverlap(c.device_id, newRect)) {
                            setCanvasLayouts((prev) => ({
                              ...prev,
                              [c.device_id]: { ...layout, x: nextX, y: nextY },
                            }));
                          } else {
                            setLayoutVersion((value) => value + 1);
                          }
                        }}
                        onResizeStop={(_event, _direction, ref, _delta, position) => {
                          const parsedW = parseInt(ref.style.width, 10);
                          const parsedH = parseInt(ref.style.height, 10);
                          const nextX = snapCanvasCoordinate(position.x);
                          const nextY = snapCanvasCoordinate(position.y);
                          const newW = Number.isNaN(parsedW) ? layout.w : snapCanvasSize(Math.max(parsedW, cardWidth), cardWidth);
                          const newH = Number.isNaN(parsedH) ? layout.h : snapCanvasSize(Math.max(parsedH, cardHeight), cardHeight);
                          
                          const newRect = {
                              x: nextX,
                              y: nextY,
                              w: newW,
                              h: newH
                          };

                          if (!hasCanvasOverlap(c.device_id, newRect)) {
                            setCanvasLayouts((prev) => ({ 
                              ...prev, 
                              [c.device_id]: { 
                                x: nextX, 
                                y: nextY, 
                                w: newW, 
                                h: newH 
                              } 
                            }));
                          } else {
                            setLayoutVersion((value) => value + 1);
                          }
                        }}
                        disableDragging={!isCustomizeMode}
                        enableResizing={isCustomizeMode}
                        dragGrid={[CANVAS_GRID_STEP, CANVAS_GRID_STEP]}
                        resizeGrid={[CANVAS_GRID_STEP, CANVAS_GRID_STEP]}
                        minWidth={cardWidth}
                        minHeight={cardHeight}
                        bounds="parent"
                        className="z-50 cursor-grab rounded-xl shadow-xl ring-2 ring-primary ring-offset-2 ring-offset-transparent transition-shadow active:cursor-grabbing"
                      >
                        <div className="pointer-events-none h-full w-full">
                          {cardContents}
                        </div>
                      </Rnd>
                    );
                  })}
                </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 p-1">
                    {approvedDevices.map((config) => {
                      if (!("device_id" in config)) return null;
                      const c = config as DeviceConfig;
                      return (
                        <div key={c.device_id} className="w-full flex h-full">
                          <div className="w-full h-full">
                            <DynamicDeviceCard config={c} isOnline={isDeviceOnline(c)} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
