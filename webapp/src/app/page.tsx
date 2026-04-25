/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchCurrentHouseTemperature, fetchCurrentWeather, fetchDashboardDevices, fetchDevices, fetchSystemLogs, markSystemLogRead, markAllSystemLogsRead, SystemLogEntry, fetchSystemStatus, SystemStatusResponse, CurrentWeatherResponse, HouseTemperatureResponse, updateHouseholdLocation } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { useLanguage } from "@/components/LanguageContext";
import { useToast } from "@/components/ToastContext";
import Sidebar from '@/components/Sidebar';
import HomeLocationPicker from "@/components/HomeLocationPicker";
import { DeviceConfig } from "@/types/device";
import { useWebSocket } from "@/hooks/useWebSocket";
import { DynamicDeviceCard, getCardMinHeight, getCardMinWidth } from "@/components/DeviceCard";
import DeviceScanConnectPanel from "@/components/DeviceScanConnectPanel";
import { isSystemLogAlertEntry } from "@/lib/system-log";
import { HomeLocation } from "@/lib/home-location";
import { fetchRooms, RoomRecord } from "@/lib/rooms";

const ADMIN_SUPPLEMENTAL_REFRESH_DEBOUNCE_MS = 750;
const WEATHER_LOCATION_MAX_LENGTH = 15;

type DashboardRefreshMode = "admin" | "full";
type AreaFilterOption = { id: string; label: string };
const DASHBOARD_CARD_MAX_WIDTH = 460;
const UNASSIGNED_AREA_ID = "unassigned";

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

function mergeDashboardRefreshMode(
  currentMode: DashboardRefreshMode | null,
  nextMode: DashboardRefreshMode,
): DashboardRefreshMode {
  if (currentMode === "full" || nextMode === "full") {
    return "full";
  }

  return "admin";
}

function getAreaFilterOption(device: DeviceConfig): AreaFilterOption {
  const trimmedRoomName = device.room_name?.trim();
  if (typeof device.room_id === "number") {
    return {
      id: `room:${device.room_id}`,
      label: trimmedRoomName && trimmedRoomName.length > 0 ? trimmedRoomName : `Area ${device.room_id}`,
    };
  }

  const fallbackLabel = trimmedRoomName && trimmedRoomName.length > 0 ? trimmedRoomName : "Unassigned";
  return {
    id: UNASSIGNED_AREA_ID,
    label: fallbackLabel,
  };
}

function getRoomAreaOption(room: RoomRecord): AreaFilterOption {
  const trimmedRoomName = room.name.trim();
  return {
    id: `room:${room.room_id}`,
    label: trimmedRoomName.length > 0 ? trimmedRoomName : `Area ${room.room_id}`,
  };
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
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/45 p-2 sm:p-4 backdrop-blur-sm">
      <div className="flex w-full max-w-5xl flex-col h-[95vh] sm:h-[85vh] max-h-[800px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="shrink-0 border-b border-slate-200 px-4 py-3 sm:px-5 sm:py-3 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <span className="material-icons-round text-2xl text-primary">home_pin</span>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Set home location</h2>
          </div>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden p-3 sm:p-5">
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

type WeatherVisualSize = "hero" | "inline";

function ClearSkySunIcon({ size, className = "" }: { size: WeatherVisualSize; className?: string }) {
  const containerClass = size === "hero" ? "h-10 w-10" : "h-5 w-5";
  const coreClass = size === "hero" ? "h-6 w-6" : "h-3 w-3";
  const coreShadowClass = size === "hero"
    ? "shadow-[0_0_12px_rgba(251,191,36,0.35)]"
    : "shadow-[0_0_10px_rgba(251,191,36,0.35)]";
  const longRayClass = size === "hero" ? "top-[-2px] h-[8px] w-[2px]" : "top-[-1px] h-[4px] w-[1.5px]";
  const shortRayClass = size === "hero" ? "top-[2px] h-[4px] w-[2px]" : "top-[1px] h-[2px] w-[1.5px]";
  const raysAnimationClass = "animate-weather-sun-rays";

  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center align-middle ${containerClass} ${className}`}>
      <span className={`absolute inset-0 ${raysAnimationClass}`}>
        {Array.from({ length: 12 }).map((_, index) => (
          <span
            key={`sun-ray-${index}`}
            className="absolute inset-0"
            style={{ transform: `rotate(${index * 30}deg)` }}
          >
            <span
              className={`absolute left-1/2 -translate-x-1/2 rounded-full bg-amber-300 ${index % 2 === 0 ? longRayClass : shortRayClass}`}
            />
          </span>
        ))}
      </span>
      <span className={`relative rounded-full bg-amber-400 ${coreClass} ${coreShadowClass}`} />
    </span>
  );
}

function ClearSkyMoonIcon({ size, className = "" }: { size: WeatherVisualSize; className?: string }) {
  if (size === "inline") {
    return (
      <span className={`material-icons-round inline-block shrink-0 align-middle text-[18px] leading-none animate-weather-moon ${className}`}>
        dark_mode
      </span>
    );
  }

  const containerClass = size === "hero" ? "h-10 w-10" : "h-5 w-5";
  const moonClass = size === "hero" ? "h-7 w-7" : "h-3.5 w-3.5";
  const cutoutClass = size === "hero" ? "left-[8px] top-[1px] h-6 w-6" : "left-[5px] top-[0.5px] h-3 w-3";
  const shadowClass = size === "hero"
    ? "shadow-[0_0_12px_rgba(226,232,240,0.22)]"
    : "shadow-[0_0_10px_rgba(226,232,240,0.2)]";

  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center align-middle ${containerClass} ${className}`}>
      <span className={`relative rounded-full bg-slate-200 dark:bg-slate-100 ${moonClass} ${shadowClass}`}>
        <span className={`absolute rounded-full bg-white dark:bg-slate-900 ${cutoutClass}`} />
      </span>
    </span>
  );
}

function renderWeatherIcon(weatherData: CurrentWeatherResponse | null, size: WeatherVisualSize) {
  if (!weatherData) {
    return (
      <span className={`material-symbols-rounded ${size === "hero" ? "text-6xl text-sky-500 dark:text-sky-400" : "text-sm mr-1"}`}>
        cloud
      </span>
    );
  }

  if (weatherData.weather_code === 0) {
    if (size === "hero") {
      return (
        <span className="material-icons-round text-6xl text-sky-500 dark:text-sky-400 group-hover:text-sky-600 dark:group-hover:text-sky-300 transition-colors">
          {weatherData.is_day === false ? "brightness_2" : "wb_sunny"}
        </span>
      );
    }

    return weatherData.is_day === false
      ? <ClearSkyMoonIcon size={size} className={size === "inline" ? "mr-1" : ""} />
      : <ClearSkySunIcon size={size} className={size === "inline" ? "mr-1" : ""} />;
  }

  if (size === "hero") {
    return (
      <span className="material-symbols-rounded text-6xl text-sky-500 dark:text-sky-400 group-hover:text-sky-600 dark:group-hover:text-sky-300 transition-colors">
        {weatherData.icon}
      </span>
    );
  }

  if (weatherData.icon === "rainy" && size === "inline") {
    return (
      <div className="relative mr-1 h-5 w-5 flex items-center justify-center">
        <span className="material-symbols-rounded text-sm animate-weather-cloud relative z-10">cloud</span>
        <div className="absolute top-[12px] left-1/2 -translate-x-1/2 flex items-center gap-[2px]">
          <div className="w-[1.5px] h-[6px] bg-sky-500 dark:bg-sky-400 rounded-full rotate-[15deg] animate-weather-rain-1" />
          <div className="w-[1.5px] h-[6px] bg-sky-500 dark:bg-sky-400 rounded-full rotate-[15deg] animate-weather-rain-2 mt-[2px]" />
          <div className="w-[1.5px] h-[6px] bg-sky-500 dark:bg-sky-400 rounded-full rotate-[15deg] animate-weather-rain-3" />
        </div>
      </div>
    );
  }

  return (
    <span
      className={`material-symbols-rounded text-sm mr-1 ${weatherData.icon === "cloud" ? "animate-weather-cloud inline-block" : ""}`}
    >
      {weatherData.icon}
    </span>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();
  const { showToast } = useToast();
  const [devices, setDevices] = useState<DeviceConfig[]>([]);
  const [rooms, setRooms] = useState<RoomRecord[]>([]);
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
  const [hasLoadedSystemLogs, setHasLoadedSystemLogs] = useState(false);
  const [weatherData, setWeatherData] = useState<CurrentWeatherResponse | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [houseTemperatureData, setHouseTemperatureData] = useState<HouseTemperatureResponse | null>(null);
  const [houseTemperatureLoading, setHouseTemperatureLoading] = useState(true);
  const [houseTemperatureError, setHouseTemperatureError] = useState<string | null>(null);
  const [homeLocationPromptOpen, setHomeLocationPromptOpen] = useState(false);
  const [isSavingHomeLocation, setIsSavingHomeLocation] = useState(false);
  const [selectedArea, setSelectedArea] = useState("all");
  const [showAreaMenu, setShowAreaMenu] = useState(false);
  const [areaSwipeDirection, setAreaSwipeDirection] = useState<"left" | "right">("right");
  const [hasAreaSwipeMotion, setHasAreaSwipeMotion] = useState(false);
  const [areaUnderlineStyle, setAreaUnderlineStyle] = useState({ x: 0, width: 0, opacity: 0 });
  const [windowWidth, setWindowWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  const notificationRef = useRef<HTMLDivElement>(null);
  const areaMenuRef = useRef<HTMLDivElement>(null);
  const areaTabsRowRef = useRef<HTMLDivElement>(null);
  const areaTabButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
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

      if (areaMenuRef.current && !areaMenuRef.current.contains(event.target as Node)) {
        setShowAreaMenu(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showNotifications]);

  useEffect(() => {
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
        setWeatherError(isMissingHomeLocation ? t("dashboard.set_home_location") : t("dashboard.weather_unavailable"));
        setWeatherData(null);
        if (isMissingHomeLocation) {
          setHomeLocationPromptOpen(true);
        } else if (!options?.silent) {
          showToast(t("dashboard.weather_unavailable"), "warning");
        }
      }
    } finally {
      if (!isCancelled()) {
        setWeatherLoading(false);
      }
    }
  }, [showToast, t]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void loadHomeWeather({ silent: true, isCancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, [loadHomeWeather, user]);

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
        setHouseTemperatureError(isMissingSource ? t("dashboard.set_source_board") : t("dashboard.house_temperature_unavailable"));
        if (!options?.silent && !isMissingSource) {
          showToast(t("dashboard.house_temperature_unavailable"), "warning");
        }
      }
    } finally {
      if (!isCancelled()) {
        setHouseTemperatureLoading(false);
      }
    }
  }, [showToast, t]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void loadHouseTemperature({ silent: true, isCancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, [loadHouseTemperature, user]);

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

  useEffect(() => {
    if (!isAdmin) {
      setPairingRequests([]);
      setSystemLogs([]);
      setHasLoadedSystemLogs(true);
      return;
    }

    setHasLoadedSystemLogs(false);
  }, [isAdmin]);

  const refreshDashboardDevices = useCallback(() => {
    return fetchDashboardDevices()
      .then((dashboardDevices) => {
        setDevices(dashboardDevices);
        hasLoadedInitialDashboardSnapshotRef.current = true;
      })
      .catch((error) => {
        console.error("Failed to load dashboard devices:", error);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const refreshRooms = useCallback(() => {
    return fetchRooms()
      .then((roomRecords) => {
        setRooms(roomRecords);
      })
      .catch((error) => {
        console.error("Failed to load rooms:", error);
      });
  }, []);

  const refreshPendingPairingRequests = useCallback(() => {
    if (!isAdmin) {
      setPairingRequests([]);
      return Promise.resolve();
    }

    return fetchDevices({ authStatus: "pending" })
      .then((pendingRequests) => {
        setPairingRequests((pendingRequests as DeviceConfig[]) || []);
      })
      .catch((error) => {
        console.error("Failed to load pending pairing requests:", error);
      });
  }, [isAdmin]);

  const refreshSystemAlerts = useCallback(() => {
    if (!isAdmin) {
      setSystemLogs([]);
      setHasLoadedSystemLogs(true);
      return Promise.resolve();
    }

    return fetchSystemLogs(undefined, 500)
      .then((logsRes) => {
        setSystemLogs(logsRes.entries);
      })
      .catch((error) => {
        console.error("Failed to load system logs:", error);
      })
      .finally(() => {
        setHasLoadedSystemLogs(true);
      });
  }, [isAdmin]);

  const refreshSystemStatus = useCallback(() => {
    return fetchSystemStatus()
      .then((statusRes) => {
        applySystemStatus(statusRes);
      })
      .catch((error) => {
        console.error("Failed to load system status:", error);
      });
  }, [applySystemStatus]);

  const loadFullDashboardData = useCallback(() => {
    const refreshes: Promise<unknown>[] = [
      refreshDashboardDevices(),
      refreshRooms(),
      refreshSystemStatus(),
    ];

    if (isAdmin) {
      refreshes.push(refreshPendingPairingRequests(), refreshSystemAlerts());
    }

    return Promise.allSettled(refreshes).then(() => undefined);
  }, [isAdmin, refreshDashboardDevices, refreshPendingPairingRequests, refreshRooms, refreshSystemAlerts, refreshSystemStatus]);

  const loadAdminSupplementalData = useCallback(() => {
    if (!isAdmin) {
      return Promise.resolve();
    }

    return Promise.allSettled([
      refreshPendingPairingRequests(),
      refreshSystemAlerts(),
      refreshSystemStatus(),
    ]).then(() => undefined);
  }, [isAdmin, refreshPendingPairingRequests, refreshSystemAlerts, refreshSystemStatus]);

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

        if (nextMode === "full" || !isAdmin) {
          await loadFullDashboardData();
        } else {
          await loadAdminSupplementalData();
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
    if (!user) return;
    void runDashboardRefresh("full");
  }, [runDashboardRefresh, user]);

  const isDeviceOnline = useCallback((d: DeviceConfig) => {
    return d.auth_status === "approved" && d.conn_status === "online";
  }, []);

  const approvedDevices = useMemo(
    () => devices.filter((device) => device.auth_status === "approved"),
    [devices],
  );
  const visibleApprovedDevices = useMemo(
    () => approvedDevices.filter((device) => device.show_on_dashboard !== false),
    [approvedDevices],
  );
  const onlineDevices = useMemo(() => approvedDevices.filter(isDeviceOnline), [approvedDevices, isDeviceOnline]);
  const offlineDevices = useMemo(
    () => approvedDevices.filter((device) => !isDeviceOnline(device)),
    [approvedDevices, isDeviceOnline],
  );

  const areaOptions = useMemo(() => {
    const seen = new Set<string>();
    const nextOptions: AreaFilterOption[] = [{ id: "all", label: t("dashboard.all") }];

    rooms
      .map(getRoomAreaOption)
      .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" }))
      .forEach((option) => {
        if (!seen.has(option.id)) {
          seen.add(option.id);
          nextOptions.push(option);
        }
      });

    if (visibleApprovedDevices.some((device) => typeof device.room_id !== "number")) {
      nextOptions.push({ id: UNASSIGNED_AREA_ID, label: t("dashboard.unassigned") });
    }

    return nextOptions;
  }, [visibleApprovedDevices, rooms, t]);

  useEffect(() => {
    if (!areaOptions.some((option) => option.id === selectedArea)) {
      setSelectedArea("all");
    }
  }, [areaOptions, selectedArea]);

  const visibleDevices = useMemo(() => {
    if (selectedArea === "all") {
      return visibleApprovedDevices;
    }

    return visibleApprovedDevices.filter((device) => getAreaFilterOption(device).id === selectedArea);
  }, [visibleApprovedDevices, selectedArea]);

  const selectedAreaLabel = useMemo(
    () => areaOptions.find((option) => option.id === selectedArea)?.label ?? t("dashboard.all"),
    [areaOptions, selectedArea, t],
  );

  useEffect(() => {
    const syncAreaUnderline = () => {
      const currentTab = areaTabButtonRefs.current[selectedArea];
      if (!areaTabsRowRef.current || !currentTab) {
        setAreaUnderlineStyle((current) => ({ ...current, opacity: 0 }));
        return;
      }

      setAreaUnderlineStyle({
        x: currentTab.offsetLeft,
        width: currentTab.offsetWidth,
        opacity: 1,
      });
    };

    const frameId = window.requestAnimationFrame(syncAreaUnderline);
    return () => window.cancelAnimationFrame(frameId);
  }, [selectedArea, areaOptions, windowWidth]);

  const areaPanelAnimationClass = hasAreaSwipeMotion
    ? areaSwipeDirection === "left"
      ? "animate-dashboard-area-swipe-left"
      : "animate-dashboard-area-swipe-right"
    : "";

  const onlineCount = onlineDevices.length;
  const weatherLocationName = weatherData?.location_name || "Home Weather";
  const houseTemperatureSourceName = houseTemperatureData?.device_name || "No source selected";
  const houseTemperatureSourceLabel = truncateLabel(houseTemperatureSourceName, WEATHER_LOCATION_MAX_LENGTH);
  const shouldOpenHouseTemperatureSettings = isAdmin && houseTemperatureError === t("dashboard.set_source_board");
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
  const alertsLoading = isAdmin && !hasLoadedSystemLogs;

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

    let greeting = t("dashboard.good_evening");
    if (currentHour >= 5 && currentHour < 12) {
      greeting = t("dashboard.good_morning");
    } else if (currentHour >= 12 && currentHour < 18) {
      greeting = t("dashboard.good_afternoon");
    }

    const name = user?.fullname || user?.username || "";
    return name ? `${greeting}, ${name}` : greeting;
  }, [serverTimezone, user, t]);

  const handleAreaSelection = useCallback((nextArea: string) => {
    if (nextArea === selectedArea) {
      setShowAreaMenu(false);
      return;
    }

    const currentIndex = areaOptions.findIndex((option) => option.id === selectedArea);
    const nextIndex = areaOptions.findIndex((option) => option.id === nextArea);
    setAreaSwipeDirection(nextIndex < currentIndex ? "left" : "right");
    setHasAreaSwipeMotion(true);
    setSelectedArea(nextArea);
    setShowAreaMenu(false);
  }, [areaOptions, selectedArea]);

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
                    <h3 className="font-semibold text-sm text-slate-800 dark:text-slate-100">{t("dashboard.notifications")}</h3>
                    {visibleNotifications.length > 0 && (
                      <button
                        onClick={() => void handleMarkAllNotificationsRead()}
                        disabled={markingAllNotifications}
                        className="text-xs font-medium text-slate-500 hover:text-primary transition-colors flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className={`material-icons-round text-[14px] ${markingAllNotifications ? "animate-spin" : ""}`}>
                          {markingAllNotifications ? "autorenew" : "mark_email_read"}
                        </span>
                        {t("dashboard.mark_all_read")}
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
                        <p>{t("dashboard.no_new_notifications")}</p>
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
                    {t("dashboard.view_activity_log")}
                  </a>
                </div>
              )}
            </div>
            {isAdmin ? (
              <button
                onClick={() => setIsScanModalOpen(true)}
                className="relative flex items-center bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-600 transition-all shadow-md hover:shadow-lg"
              >
                <span className="material-icons-round text-sm mr-2">wifi_tethering</span>
                {t("dashboard.scan_device")}
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
                {t("dashboard.non_admin_message")}
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-6 mb-8 md:grid-cols-2 lg:grid-cols-4">
              <div
                className="bg-surface-light dark:bg-surface-dark hover:bg-slate-50 dark:hover:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-500 shadow-sm hover:shadow-md relative overflow-hidden group transition-all duration-300"
              >
                <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-40 transition-all duration-300 transform group-hover:scale-110 group-hover:-translate-y-1">
                  {renderWeatherIcon(weatherData, "hero")}
                </div>
                <div className="relative z-10 transform group-hover:scale-[1.03] origin-left transition-transform duration-300">
                  <p
                    className="text-slate-500 dark:text-slate-400 text-sm font-medium"
                    title={weatherLocationName}
                  >
                    {t("dashboard.weather")}
                  </p>

                  {weatherLoading ? (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="material-symbols-rounded text-slate-400 animate-spin">autorenew</span>
                      <span className="text-sm text-slate-500">{t("dashboard.loading_weather")}</span>
                    </div>
                  ) : weatherError ? (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="material-symbols-rounded text-red-400 text-lg">error_outline</span>
                      <span className="text-sm text-slate-500">{weatherError}</span>
                    </div>
                  ) : weatherData ? (
                    <>
                      <h3 className="text-3xl font-bold text-slate-900 dark:text-white mt-2 flex items-start">
                        {Math.round(weatherData.temperature)}<span className="text-lg font-medium text-slate-500 mt-1">°C</span>
                      </h3>
                      <div className="mt-2 text-xs flex items-center font-medium text-slate-500 dark:text-slate-400">
                        {renderWeatherIcon(weatherData, "inline")}
                        {weatherData.description}
                      </div>
                      <p
                        className="mt-4 truncate text-xs text-slate-400 dark:text-slate-500"
                        title={weatherLocationName}
                      >
                        {weatherLocationName}
                      </p>
                    </>
                  ) : null}
                </div>
              </div>
              <div
                className={`bg-surface-light dark:bg-surface-dark hover:bg-slate-50 dark:hover:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-500 shadow-sm hover:shadow-md relative overflow-hidden group transition-all duration-300 ${
                  shouldOpenHouseTemperatureSettings
                    ? "cursor-pointer"
                    : ""
                }`}
                onClick={shouldOpenHouseTemperatureSettings ? () => router.push("/settings") : undefined}
                onKeyDown={shouldOpenHouseTemperatureSettings ? ((event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    router.push("/settings");
                  }
                }) : undefined}
                role={shouldOpenHouseTemperatureSettings ? "button" : undefined}
                tabIndex={shouldOpenHouseTemperatureSettings ? 0 : undefined}
              >
                <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-40 transition-all duration-300 transform group-hover:scale-110 group-hover:-translate-y-1">
                  <span className="material-icons-round text-6xl text-orange-500 dark:text-orange-400 group-hover:text-orange-600 dark:group-hover:text-orange-300 transition-colors">device_thermostat</span>
                </div>
                <div className="relative z-10 transform group-hover:scale-[1.03] origin-left transition-transform duration-300">
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">{t("dashboard.house_temperature")}</p>
                  <p className="mt-1 text-xs text-slate-400 dark:text-slate-500" title={houseTemperatureSourceName}>
                    {houseTemperatureSourceLabel}
                  </p>

                  {houseTemperatureLoading ? (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="material-icons-round text-slate-400 animate-spin">autorenew</span>
                      <span className="text-sm text-slate-500">{t("dashboard.loading_temperature")}</span>
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
                        <span className={`inline-flex items-center rounded-full px-2 py-1 font-medium ${houseTemperatureData.is_online
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                            : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                          }`}>
                          {houseTemperatureData.is_online ? t("dashboard.live") : t("dashboard.offline")}
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
                    <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">{t("dashboard.device_overview")}</p>
                    <div className="flex items-end gap-3 mt-2">
                      <h3 className="text-3xl font-bold text-slate-900 dark:text-white leading-none tracking-tight">{loading ? '--' : approvedDevices.length.toString().padStart(2, '0')}</h3>
                      <div className="flex flex-wrap items-center gap-2 pb-0.5 text-xs font-medium">
                        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-100 dark:bg-slate-800/50 rounded-md">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500"></span>
                          <span className="text-slate-600 dark:text-slate-300">{loading ? '-' : onlineCount} <span className="text-slate-500 dark:text-slate-400 font-normal">{t("devices.card.online")}</span></span>
                        </div>
                        <div className={`flex items-center gap-1.5 px-2 py-0.5 ${offlineDevices.length > 0 ? "bg-red-50 dark:bg-red-500/10" : "bg-slate-100 dark:bg-slate-800/50"} rounded-md`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${offlineDevices.length > 0 ? "bg-red-500 animate-[pulse_1.5s_ease-in-out_infinite]" : "bg-slate-300 dark:bg-slate-600"}`}></span>
                          <span className={`${offlineDevices.length > 0 ? "text-red-600 dark:text-red-400 font-semibold" : "text-slate-600 dark:text-slate-300"}`}>{loading ? '-' : offlineDevices.length} <span className={`${offlineDevices.length > 0 ? "text-red-500 dark:text-red-400/80" : "text-slate-500 dark:text-slate-400"} font-normal`}>{t("devices.card.offline")}</span></span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className={`mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs flex items-center font-medium ${outdatedDevices.length > 0 ? "text-green-600 dark:text-green-400 animate-[pulse_1.5s_ease-in-out_infinite]" : "text-slate-500 dark:text-slate-400"}`}>
                    <span className="material-icons-round text-sm mr-1">{outdatedDevices.length > 0 ? "system_update" : "trending_up"}</span>
                    {outdatedDevices.length > 0 ? (
                      <div className="flex items-center gap-1">
                        <span>{outdatedDevices.length} {outdatedDevices.length > 1 ? t('dashboard.updates') : t('dashboard.update')}</span>
                        <span className="material-icons-round text-[10px]">arrow_forward</span>
                        <span className="font-mono">{latestFirmwareRevision}</span>
                      </div>
                    ) : newThisWeek > 0 ? <span className="text-green-600 dark:text-green-400">{`+${newThisWeek} ${t("dashboard.new_this_week")}`}</span> : t("dashboard.up_to_date")}
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
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">{t("dashboard.system_alerts")}</p>
                  <h3 className="text-3xl font-bold text-slate-900 dark:text-white mt-2">{alertsLoading ? '--' : alertCount.toString().padStart(2, '0')}</h3>
                  <div className={`mt-2 text-xs flex items-center font-medium ${alertTextColor}`}>
                    <span className="material-icons-round text-sm mr-1">{highestSeverity !== 'none' ? 'priority_high' : 'check'}</span>
                    {alertCount > 0 ? `${alertCount} ${t("dashboard.unhandled_issues")}` : t("dashboard.all_clear")}
                  </div>
                </div>
              </div>
            </div>

            <div className="mb-8">
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{t("dashboard.areas_list")}</h2>
              </div>
              <div className="mb-5 flex items-end gap-4 border-b border-slate-200/80 pb-0 dark:border-slate-700/70" ref={areaMenuRef}>
                <div className="relative min-w-0 flex-1">
                  <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <div ref={areaTabsRowRef} className="relative flex min-w-max items-end gap-7 pr-10">
                    {areaOptions.map((option) => {
                    const isSelected = option.id === selectedArea;
                    return (
                      <button
                        key={option.id}
                        ref={(node) => {
                          areaTabButtonRefs.current[option.id] = node;
                        }}
                        type="button"
                        onClick={() => handleAreaSelection(option.id)}
                        className={`relative shrink-0 pb-3 text-[15px] font-medium transition-colors sm:text-base ${
                          isSelected
                            ? "text-slate-900 dark:text-white"
                            : "text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute bottom-0 left-0 h-0.5 rounded-full bg-slate-900 transition-[transform,width,opacity] duration-300 ease-out dark:bg-white"
                    style={{
                      width: `${areaUnderlineStyle.width}px`,
                      opacity: areaUnderlineStyle.opacity,
                      transform: `translateX(${areaUnderlineStyle.x}px)`,
                    }}
                  />
                </div>
                  </div>
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-background-light via-background-light/95 to-transparent dark:from-background-dark dark:via-background-dark/95"
                  />
                </div>
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowAreaMenu((current) => !current)}
                    className={`flex h-10 w-10 items-center justify-center pb-2 transition-colors ${
                      showAreaMenu
                        ? "text-slate-900 dark:text-white"
                        : "text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                    aria-label="Open areas list menu"
                    aria-expanded={showAreaMenu}
                  >
                    <span className="material-icons-round text-[20px]">menu</span>
                  </button>
                  {showAreaMenu ? (
                    <div className="absolute right-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
                      <div className="border-b border-slate-100 px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 dark:border-slate-800 dark:text-slate-500">
                        {t("dashboard.areas_list")}
                      </div>
                      <div className="max-h-80 overflow-y-auto p-2">
                        {areaOptions.map((option) => {
                          const isSelected = option.id === selectedArea;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => handleAreaSelection(option.id)}
                              className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                                isSelected
                                  ? "bg-primary/10 text-primary dark:bg-primary/15"
                                  : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
                              }`}
                            >
                              <span>{option.label}</span>
                              {isSelected ? <span className="material-icons-round text-[18px]">check</span> : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 transition-all duration-300 dark:border-slate-800 dark:bg-slate-900/40">
                <div key={selectedArea} className={areaPanelAnimationClass}>
                  {loading ? (
                    <div className="py-12 text-center text-slate-400">{t("dashboard.loading_devices")}</div>
                  ) : approvedDevices.length === 0 ? (
                    <div className="py-12 text-center text-slate-400">{t("dashboard.no_devices_found")}</div>
                  ) : visibleDevices.length === 0 ? (
                    <div className="py-12 text-center text-slate-400">
                      {selectedArea === "all" ? t("dashboard.no_devices_found") : `${t("dashboard.no_devices_found_in_area")} ${selectedAreaLabel}.`}
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-start gap-6">
                      {visibleDevices.map((config) => {
                        if (!("device_id" in config)) return null;
                        const c = config as DeviceConfig;
                        const cardMinWidth = getCardMinWidth(c);
                        const cardMinHeight = getCardMinHeight(c);
                        const cardMaxWidth = Math.max(cardMinWidth, DASHBOARD_CARD_MAX_WIDTH);
                        return (
                          <div
                            key={c.device_id}
                            className="flex w-full flex-none"
                            style={{
                              flexBasis: `${cardMinWidth}px`,
                              minWidth: `min(100%, ${cardMinWidth}px)`,
                              maxWidth: `min(100%, ${cardMaxWidth}px)`,
                              minHeight: `${cardMinHeight}px`,
                            }}
                          >
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
        </div>
      </main>
    </div>
  );
}
