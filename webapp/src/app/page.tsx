/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchDashboardDevices, fetchDevices, fetchSystemLogs, markSystemLogRead, markAllSystemLogsRead, SystemLogEntry, fetchSystemStatus } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import Sidebar from '@/components/Sidebar';
import { DeviceConfig } from "@/types/device";
import { useWebSocket } from "@/hooks/useWebSocket";
import { DynamicDeviceCard, getCardMinHeight } from "@/components/DeviceCard";
import { Rnd } from "react-rnd";
import DeviceScanConnectPanel from "@/components/DeviceScanConnectPanel";
import { isSystemLogAlertEntry } from "@/lib/system-log";

type CanvasLayout = { x: number; y: number; w: number | string; h: number | string };

export default function Dashboard() {
  const { user } = useAuth();
  const router = useRouter();
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
  const notificationRef = useRef<HTMLDivElement>(null);

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
    if (user && user.ui_layout && typeof user.ui_layout === "object") {
      setCanvasLayouts(user.ui_layout as Record<string, CanvasLayout>);
    } else if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("dashboardCanvasLayout");
        if (saved) setCanvasLayouts(JSON.parse(saved));
      } catch {}
    }

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "dashboardCanvasLayout" && e.newValue) {
        try {
          setCanvasLayouts(JSON.parse(e.newValue));
        } catch {}
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

  const isMobile = windowWidth < 1024;
  const hasCustomLayout = Object.keys(canvasLayouts).length > 0;
  // Use canvas if we are customizing, or if we have a custom layout AND we are not on mobile
  const shouldUseCanvas = isMounted && (isCustomizeMode || (hasCustomLayout && !isMobile));

  const saveCanvasLayout = async () => {
    setIsSavingLayout(true);
    const layout = { ...canvasLayouts };
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
  const syncDashboardData = useCallback(async () => {
    const [dashboardDevices, pendingRequests, logsRes, statusRes] = await Promise.all([
      fetchDashboardDevices(),
      isAdmin ? fetchDevices({ authStatus: "pending" }) : Promise.resolve([]),
      isAdmin ? fetchSystemLogs(undefined, 500) : Promise.resolve({ entries: [] }),
      fetchSystemStatus().catch(() => null),
    ]);

    startTransition(() => {
      setDevices(dashboardDevices);
      setPairingRequests((pendingRequests as DeviceConfig[]) || []);
      if (isAdmin) {
        setSystemLogs(logsRes.entries);
      }
      if (statusRes) {
        setLatestFirmwareRevision(statusRes.latest_firmware_revision || null);
        if (statusRes.effective_timezone) {
          setServerTimezone(statusRes.effective_timezone);
        }
      }
      setLoading(false);
    });
  }, [isAdmin]);



  const { isConnected } = useWebSocket((event) => {
    if ((event.type === "pairing_requested" || event.type === "pairing_queue_updated" || event.type === "device_offline") && isAdmin) {
      void syncDashboardData();
      return;
    }

    if (!("device_id" in event)) {
      return;
    }

    if (
      (event.type === "device_online" || event.type === "device_state") &&
      !devices.some((device) => device.device_id === event.device_id)
    ) {
      void syncDashboardData();
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
  });

  useEffect(() => {
    let cancelled = false;
    // Debounce the fetch slightly to prevent rapid double-fetching if WS connects instantly
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        const [dashboardDevices, pendingRequests, logsRes, statusRes] = await Promise.all([
          fetchDashboardDevices(),
          isAdmin ? fetchDevices({ authStatus: "pending" }) : Promise.resolve([]),
          isAdmin ? fetchSystemLogs(undefined, 500) : Promise.resolve({ entries: [] }),
          fetchSystemStatus().catch(() => null),
        ]);
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setDevices(dashboardDevices);
          setPairingRequests((pendingRequests as DeviceConfig[]) || []);
          if (isAdmin) {
            setSystemLogs(logsRes.entries);
          }
          if (statusRes) {
            setLatestFirmwareRevision(statusRes.latest_firmware_revision || null);
            if (statusRes.effective_timezone) {
              setServerTimezone(statusRes.effective_timezone);
            }
          }
          setLoading(false);
        });
      })();
    }, 50);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [isAdmin, isConnected]);

  const isDeviceOnline = (d: DeviceConfig) => {
    return d.auth_status === "approved" && d.conn_status === "online";
  };

  const approvedDevices = devices.filter((device) => device.auth_status === "approved");
  const onlineDevices = approvedDevices.filter(isDeviceOnline);
  const offlineDevices = approvedDevices.filter((d) => !isDeviceOnline(d));

  const onlineCount = onlineDevices.length;
  
  const computedLayouts = useMemo(() => {
    const computed: Record<string, CanvasLayout> = {};

    const getEstimatedH = (device: DeviceConfig) => {
      return getCardMinHeight(device);
    };

    const doesOverlap = (rect1: {x: number, y: number, w: number, h: number}, rect2: {x: number, y: number, w: number, h: number}) => {
      const gap = 20;
      return rect1.x < rect2.x + rect2.w + gap &&
             rect1.x + rect1.w + gap > rect2.x &&
             rect1.y < rect2.y + rect2.h + gap &&
             rect1.y + rect1.h + gap > rect2.y;
    };

    const deviceMap = new Map<string, DeviceConfig>();
    for (const d of approvedDevices) {
      if ("device_id" in d) {
        deviceMap.set(d.device_id, d as DeviceConfig);
      }
    }

    for (let i = 0; i < approvedDevices.length; i++) {
        if (!("device_id" in approvedDevices[i])) continue;
        const c = approvedDevices[i] as DeviceConfig;
        const deviceId = c.device_id;
        
        if (canvasLayouts[deviceId]) {
            const l = canvasLayouts[deviceId];
            computed[deviceId] = {
                x: typeof l.x === 'number' && !Number.isNaN(l.x) ? l.x : 0,
                y: typeof l.y === 'number' && !Number.isNaN(l.y) ? l.y : 0,
                w: (typeof l.w === 'number' && Number.isNaN(l.w)) ? 320 : (l.w || 320),
                h: (typeof l.h === 'number' && Number.isNaN(l.h)) ? "auto" : (l.h || "auto")
            };
        } else {
            let prevId;
            for (let j = i - 1; j >= 0; j--) {
                if ("device_id" in approvedDevices[j]) {
                    prevId = (approvedDevices[j] as DeviceConfig).device_id;
                    break;
                }
            }
                
            let startX = 0;
            let startY = 0;
            
            if (prevId && computed[prevId]) {
                const prev = computed[prevId];
                const prevW = typeof prev.w === 'number' ? prev.w : 320;
                startX = prev.x + prevW + 20;
                startY = prev.y;
            }

            let placed = false;
            let currentX = startX;
            let currentY = startY;
            const newW = 320;
            const newH = getEstimatedH(c);

            while (!placed) {
                if (currentX + newW > windowWidth && currentX > 0) {
                    currentX = 0;
                    currentY += 20;
                    continue;
                }
                
                let collision = null;
                const testRect = { x: currentX, y: currentY, w: newW, h: newH };
                
                for (const key in computed) {
                   const other = computed[key];
                   const otherDevice = deviceMap.get(key);
                   const otherRect = {
                       x: other.x,
                       y: other.y,
                       w: typeof other.w === 'number' ? other.w : 320,
                       h: typeof other.h === 'number' ? other.h : (otherDevice ? getEstimatedH(otherDevice) : 350)
                   };
                   if (doesOverlap(testRect, otherRect)) {
                       collision = otherRect;
                       break; // found a collision
                   }
                }
                
                if (collision) {
                    currentX = collision.x + collision.w + 20;
                } else {
                    placed = true;
                }
            }
            
            computed[deviceId] = { x: currentX, y: currentY, w: newW, h: "auto" };
        }
    }
    return computed;
  }, [approvedDevices, canvasLayouts, windowWidth]);
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

  const offlineCardDynamicClasses = offlineDevices.length > 0
    ? "animate-[pulse_1s_ease-in-out_infinite] border-red-500 dark:border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.4)] dark:shadow-[0_0_15px_rgba(248,113,113,0.3)] bg-red-50 dark:bg-red-900/20 focus:outline-none focus:ring-2 focus:ring-red-500"
    : "border-slate-200 dark:border-slate-700 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-500 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-green-500";

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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <div className="bg-surface-light dark:bg-surface-dark hover:bg-slate-50 dark:hover:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-500 shadow-sm hover:shadow-md relative overflow-hidden group transition-all duration-300 cursor-pointer">
                <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-40 transition-all duration-300 transform group-hover:scale-110 group-hover:-translate-y-1">
                  <span className="material-icons-round text-6xl text-slate-500 dark:group-hover:text-slate-400 transition-colors">router</span>
                </div>
                <div className="relative z-10 transform group-hover:scale-[1.03] origin-left transition-transform duration-300">
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">Total Devices</p>
                  <h3 className="text-3xl font-bold text-slate-900 dark:text-white mt-2">{loading ? '--' : devices.length.toString().padStart(2, '0')}</h3>
                  <div className={`mt-2 text-xs flex items-center font-medium ${outdatedDevices.length > 0 ? "text-green-600 dark:text-green-400 animate-[pulse_1.5s_ease-in-out_infinite]" : "text-slate-500 dark:text-slate-400"}`}>
                    <span className="material-icons-round text-sm mr-1">{outdatedDevices.length > 0 ? "system_update" : "trending_up"}</span>
                    {outdatedDevices.length > 0 ? (
                        <div className="flex items-center gap-1">
                            <span>{outdatedDevices.length} devices update</span>
                            <span className="material-icons-round text-[10px]">arrow_forward</span>
                            <span className="font-mono">{latestFirmwareRevision}</span>
                        </div>
                    ) : newThisWeek > 0 ? <span className="text-green-600 dark:text-green-400">{`+${newThisWeek} New this week`}</span> : 'Up to date'}
                  </div>
                </div>
              </div>
              <div className="bg-surface-light dark:bg-surface-dark hover:bg-slate-50 dark:hover:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-500 shadow-sm hover:shadow-md relative overflow-hidden group transition-all duration-300 cursor-pointer">
                <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-40 transition-all duration-300 transform group-hover:scale-110 group-hover:-translate-y-1">
                  <span className="material-icons-round text-6xl text-green-500 dark:group-hover:text-green-400 transition-colors">wifi</span>
                </div>
                <div className="relative z-10 transform group-hover:scale-[1.03] origin-left transition-transform duration-300">
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">Online</p>
                  <h3 className="text-3xl font-bold text-slate-900 dark:text-white mt-2">{loading ? '--' : onlineCount.toString().padStart(2, '0')}</h3>
                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center">
                    Stable connection
                  </div>
                </div>
              </div>
              <div className={`bg-surface-light dark:bg-surface-dark p-6 rounded-xl border relative overflow-hidden group transition-all duration-300 cursor-pointer ${offlineCardDynamicClasses}`}>
                <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-40 transition-all duration-300 transform group-hover:scale-110 group-hover:-translate-y-1">
                  <span className={`material-icons-round text-6xl ${offlineDevices.length > 0 ? "text-red-500 dark:group-hover:text-red-400 animate-[pulse_2s_ease-in-out_infinite]" : "text-green-500 dark:group-hover:text-green-400"} transition-colors`}>wifi_off</span>
                </div>
                <div className="relative z-10 transform group-hover:scale-[1.03] origin-left transition-transform duration-300">
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">Offline</p>
                  <h3 className="text-3xl font-bold text-slate-900 dark:text-white mt-2">{loading ? '--' : offlineDevices.length.toString().padStart(2, '0')}</h3>
                  <div className={`mt-2 text-xs flex items-center font-medium ${offlineDevices.length > 0 ? "text-red-500 dark:text-red-400" : "text-green-500 dark:text-green-400"}`}>
                    {offlineDevices.length > 0 ? "Needs attention" : "All online"}
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
                      <button onClick={() => setIsCustomizeMode(true)} className="flex items-center px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors bg-white dark:bg-slate-800 shadow-sm font-medium">
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
                  <div style={{ minHeight: `${Math.max(10, ...approvedDevices.map((config) => {
                    if (!("device_id" in config)) return 0;
                    const c = config as DeviceConfig;
                    const layout = computedLayouts[c.device_id] || { y: 0, h: 350 };
                    return layout.y + (typeof layout.h === 'number' ? layout.h : 350);
                  })) + (isCustomizeMode ? 400 : 20)}px`, minWidth: "100%", position: "relative" }}>
                    {approvedDevices.map((config) => {
                      if (!("device_id" in config)) return null;
                      const c = config as DeviceConfig;
                      const layout = computedLayouts[c.device_id] || { x: 0, y: 0, w: 320, h: "auto" };
                      return (
                      <Rnd
                        key={`${c.device_id}-${layoutVersion}`}
                        size={{ width: layout.w, height: layout.h }}
                        position={{ x: layout.x, y: layout.y }}
                        onDragStop={(e, d) => {
                          const newRect = { x: d.x, y: d.y, w: typeof layout.w === 'number' ? layout.w : 320, h: typeof layout.h === 'number' ? layout.h : getCardMinHeight(c) };
                          let hasOverlap = false;

                          const checkOverlap = (rect1: {x: number, y: number, w: number, h: number}, rect2: {x: number, y: number, w: number, h: number}) => {
                            const gap = 20;
                            return rect1.x < rect2.x + rect2.w + gap &&
                                  rect1.x + rect1.w + gap > rect2.x &&
                                  rect1.y < rect2.y + rect2.h + gap &&
                                  rect1.y + rect1.h + gap > rect2.y;
                          };

                          for (const [id, bounds] of Object.entries(computedLayouts)) {
                              if (id === c.device_id) continue;
                              const otherDevice = approvedDevices.find((dev) => 'device_id' in dev && dev.device_id === id) as DeviceConfig;
                              const otherRect = {
                                  x: bounds.x,
                                  y: bounds.y,
                                  w: typeof bounds.w === 'number' ? bounds.w : 320,
                                  h: typeof bounds.h === 'number' ? bounds.h : (otherDevice ? getCardMinHeight(otherDevice) : 350)
                              };
                              if (checkOverlap(newRect, otherRect)) {
                                  hasOverlap = true;
                                  break;
                              }
                          }

                          if (!hasOverlap) {
                            setCanvasLayouts(prev => ({ ...prev, [c.device_id]: { ...layout, x: d.x, y: d.y } }));
                          } else {
                            setLayoutVersion(v => v + 1);
                          }
                        }}
                        onResizeStop={(e, direction, ref, delta, position) => {
                          const parsedW = parseInt(ref.style.width, 10);
                          const parsedH = parseInt(ref.style.height, 10);
                          const newW = Number.isNaN(parsedW) ? layout.w : parsedW;
                          const newH = Number.isNaN(parsedH) ? layout.h : parsedH;
                          
                          const newRect = {
                              x: position.x,
                              y: position.y,
                              w: typeof newW === 'number' ? newW : 320,
                              h: typeof newH === 'number' ? newH : getCardMinHeight(c)
                          };

                          let hasOverlap = false;
                          const checkOverlap = (rect1: {x: number, y: number, w: number, h: number}, rect2: {x: number, y: number, w: number, h: number}) => {
                            const gap = 20;
                            return rect1.x < rect2.x + rect2.w + gap &&
                                  rect1.x + rect1.w + gap > rect2.x &&
                                  rect1.y < rect2.y + rect2.h + gap &&
                                  rect1.y + rect1.h + gap > rect2.y;
                          };

                          for (const [id, bounds] of Object.entries(computedLayouts)) {
                              if (id === c.device_id) continue;
                              const otherDevice = approvedDevices.find((dev) => 'device_id' in dev && dev.device_id === id) as DeviceConfig;
                              const otherRect = {
                                  x: bounds.x,
                                  y: bounds.y,
                                  w: typeof bounds.w === 'number' ? bounds.w : 320,
                                  h: typeof bounds.h === 'number' ? bounds.h : (otherDevice ? getCardMinHeight(otherDevice) : 350)
                              };
                              if (checkOverlap(newRect, otherRect)) {
                                  hasOverlap = true;
                                  break;
                              }
                          }

                          if (!hasOverlap) {
                            setCanvasLayouts(prev => ({ 
                              ...prev, 
                              [c.device_id]: { 
                                x: position.x, 
                                y: position.y, 
                                w: newW, 
                                h: newH 
                              } 
                            }));
                          } else {
                            setLayoutVersion(v => v + 1);
                          }
                        }}
                        disableDragging={!isCustomizeMode}
                        enableResizing={isCustomizeMode}
                        dragGrid={[20, 20]}
                        resizeGrid={[20, 20]}
                        minWidth={200}
                        minHeight={getCardMinHeight(c)}
                        bounds="parent"
                        className={`transition-shadow ${isCustomizeMode ? "z-50 shadow-xl ring-2 ring-primary ring-offset-2 ring-offset-transparent cursor-move rounded-xl" : "z-10"}`}
                      >
                        <div className={`w-full h-full ${isCustomizeMode ? 'pointer-events-none' : ''}`}>
                          <DynamicDeviceCard config={c} isOnline={isDeviceOnline(c)} />
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
