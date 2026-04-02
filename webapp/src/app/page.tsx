"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchDashboardDevices, fetchDevices, sendDeviceCommand, fetchSystemLogs, markSystemLogRead, markAllSystemLogsRead, SystemLogEntry, fetchSystemStatus } from "@/lib/api";
import { getActivePinConfigurations, getStatePins as readStatePins } from "@/lib/device-config";
import { useAuth } from "@/components/AuthProvider";
import Sidebar from '@/components/Sidebar';
import { DeviceConfig, DeviceStatePin, DeviceStateSnapshot, PinConfig } from "@/types/device";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Rnd } from "react-rnd";

type CanvasLayout = { x: number; y: number; w: number | string; h: number | string };

const getCardMinHeight = (config: DeviceConfig) => {
  if (config.provider) {
    return 210; // Extension Card
  }
  
  const pins = getActivePinConfigurations(config);
  if (pins.length === 0) return 130; // empty state
  
  let h = 100; // Base: Header (~80px) + bottom padding (~20px)
  let i2c = false;
  
  for (const p of pins) {
    if (p.mode === 'I2C') {
      if (!i2c) {
        h += 55;
        i2c = true;
      }
    } else if (p.mode === 'PWM') {
      h += 75; // PWM slider UI takes more vertical space
    } else {
      h += 55; // Standard toggle/status row
    }
  }
  return Math.ceil(h * 1.05);
};

export default function Dashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const [devices, setDevices] = useState<DeviceConfig[]>([]);
  const [pairingRequests, setPairingRequests] = useState<DeviceConfig[]>([]);
  const [systemLogs, setSystemLogs] = useState<SystemLogEntry[]>([]);
  const [latestFirmwareRevision, setLatestFirmwareRevision] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNotifications, setShowNotifications] = useState(false);
  const [mountDropdown, setMountDropdown] = useState(false);
  const [filterStatus, setFilterStatus] = useState<"all" | "online" | "offline">("all");
  const [isClearing, setIsClearing] = useState(false);
  const [clearingItemIds, setClearingItemIds] = useState<Set<string>>(new Set());
  const [dismissedNotifIds, setDismissedNotifIds] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("dismissedNotifs");
        if (saved) return new Set(JSON.parse(saved));
      } catch {}
    }
    return new Set<string>();
  });
  
  const [isCustomizeMode, setIsCustomizeMode] = useState(false);
  const [canvasLayouts, setCanvasLayouts] = useState<Record<string, CanvasLayout>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("dashboardCanvasLayout");
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return {};
  });

  const saveCanvasLayout = () => {
    localStorage.setItem("dashboardCanvasLayout", JSON.stringify(canvasLayouts));
    setIsCustomizeMode(false);
  };

  const resetCanvasLayout = () => {
    localStorage.removeItem("dashboardCanvasLayout");
    setCanvasLayouts({});
    setIsCustomizeMode(false);
  };

  const isAdmin = user?.account_type === "admin";
  async function syncDashboardData() {
    const [dashboardDevices, pendingRequests, logsRes, statusRes] = await Promise.all([
      fetchDashboardDevices(),
      isAdmin ? fetchDevices({ authStatus: "pending" }) : Promise.resolve([]),
      isAdmin ? fetchSystemLogs(undefined, 50) : Promise.resolve({ entries: [] }),
      isAdmin ? fetchSystemStatus() : Promise.resolve(null),
    ]);
    setDevices(dashboardDevices);
    setPairingRequests((pendingRequests as DeviceConfig[]) || []);
    if (isAdmin) setSystemLogs(logsRes.entries);
    if (statusRes) setLatestFirmwareRevision(statusRes.latest_firmware_revision || null);
    setLoading(false);
  }



  const { isConnected } = useWebSocket((event) => {
    if ((event.type === "pairing_requested" || event.type === "pairing_queue_updated") && isAdmin) {
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

    setDevices((prev) => {
      return prev.map((device) => {
        if (device.device_id === event.device_id) {
          if (event.type === "device_online") {
            return {
              ...device,
              conn_status: "online",
              last_seen: (event.payload?.reported_at as string) || new Date().toISOString(),
            };
          }
          if (event.type === "device_offline") {
            return { ...device, conn_status: "offline" };
          }
          if (event.type === "device_state") {
            return {
              ...device,
              conn_status: "online",
              runtime_state: event.payload,
              last_state: (event.payload ?? null) as DeviceConfig["last_state"],
              last_seen: (event.payload?.reported_at as string) || new Date().toISOString(),
            };
          }
          if (event.type === "command_delivery") {
            return {
              ...device,
              last_delivery: (event.payload ?? null) as DeviceConfig["last_delivery"],
            };
          }
        }
        return device;
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
          isAdmin ? fetchSystemLogs(undefined, 50) : Promise.resolve({ entries: [] }),
          isAdmin ? fetchSystemStatus() : Promise.resolve(null),
        ]);
        if (cancelled) {
          return;
        }
        setDevices(dashboardDevices);
        setPairingRequests((pendingRequests as DeviceConfig[]) || []);
        if (isAdmin) setSystemLogs(logsRes.entries);
        if (statusRes) setLatestFirmwareRevision(statusRes.latest_firmware_revision || null);
        setLoading(false);
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
  const outdatedDevices = useMemo(() => {
    if (!latestFirmwareRevision || devices.length === 0) return [];
    return devices.filter(d => !!d.firmware_revision && d.firmware_revision !== latestFirmwareRevision);
  }, [devices, latestFirmwareRevision]);
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const newThisWeek = devices.filter(d => d.created_at && new Date(d.created_at) > oneWeekAgo).length;

  const visibleNotifications = useMemo(() => {
    return systemLogs.filter(n => !dismissedNotifIds.has(n.id.toString()));
  }, [systemLogs, dismissedNotifIds]);

  const alertCount = visibleNotifications.filter(n => !n.is_read).length;

  const toggleDropdown = () => {
    if (showNotifications) {
      setShowNotifications(false);
      setTimeout(() => setMountDropdown(false), 200);
    } else {
      setMountDropdown(true);
      setTimeout(() => setShowNotifications(true), 10);
    }
  };

  const handleClearAll = async () => {
    setIsClearing(true);
    setTimeout(async () => {
      const newDismissed = new Set(dismissedNotifIds);
      for (const n of visibleNotifications) {
        newDismissed.add(n.id.toString());
      }
      setDismissedNotifIds(newDismissed);
      try { localStorage.setItem('dismissedNotifs', JSON.stringify(Array.from(newDismissed))); } catch {}

      setSystemLogs(prev => prev.map(n => ({...n, is_read: true})));
      try { await markAllSystemLogsRead(); } catch {}
      setIsClearing(false);
    }, 400); // Wait for slide out animation
  };

  const handleSingleNotifClick = async (notif: SystemLogEntry) => {
    if (!notif.is_read) {
       setSystemLogs(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
       try { await markSystemLogRead(notif.id); } catch {}
    }
    router.push("/logs?view=alerts");
  };

  return (
    <div className="bg-background-light dark:bg-background-dark text-slate-800 dark:text-slate-200 font-sans h-screen flex overflow-hidden selection:bg-primary selection:text-white">
      <Sidebar />

      <main className="flex-1 flex flex-col min-w-0 relative">
        <header className="h-16 bg-surface-light dark:bg-surface-dark border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-6 shadow-sm z-30">
          <h1 className="text-lg font-semibold text-slate-800 dark:text-white">IoT Home Control</h1>
          <div className="flex items-center space-x-4">
            <div className="relative group">
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
                  className={`absolute right-0 top-full mt-3 w-80 sm:w-96 bg-surface-light dark:bg-surface-dark rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden z-50 transition-all duration-200 origin-top-right transform ${showNotifications ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/50 backdrop-blur-sm">
                    <h3 className="font-semibold text-sm text-slate-800 dark:text-slate-100">Notifications</h3>
                    {visibleNotifications.length > 0 && (
                      <button
                        onClick={handleClearAll}
                        className="text-xs font-medium text-slate-500 hover:text-red-500 transition-colors flex items-center gap-1"
                      >
                        <span className="material-icons-round text-[14px]">done_all</span>
                        Make all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-[32rem] overflow-y-auto">
                    {visibleNotifications.length === 0 ? (
                      <div className="p-8 text-center text-sm text-slate-500 flex flex-col items-center justify-center">
                        <span className="material-icons-round text-4xl text-slate-300 dark:text-slate-600 mb-2">notifications_off</span>
                        <p>No new notifications</p>
                      </div>
                    ) : (
                      visibleNotifications.map((notif, idx) => {
                          const isUnread = !notif.is_read;
                          const severityColor = notif.severity === 'info' ? 'text-sky-500 bg-sky-100 dark:bg-sky-500/10 dark:text-sky-400' :
                                                notif.severity === 'warning' ? 'text-amber-500 bg-amber-100 dark:bg-amber-500/10 dark:text-amber-400' :
                                                notif.severity === 'error' ? 'text-rose-500 bg-rose-100 dark:bg-rose-500/10 dark:text-rose-400' :
                                                'text-red-500 bg-red-100 dark:bg-red-500/10 dark:text-red-400';
                          const icon = notif.severity === 'info' ? 'info' :
                                       notif.severity === 'warning' ? 'warning' :
                                       notif.severity === 'error' ? 'error' : 'report';
                          return (
                            <div key={notif.id} 
                              className={`p-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 border-b border-slate-100 dark:border-slate-700/50 group/notif cursor-pointer relative transition-all duration-400 ease-in-out ${isClearing || clearingItemIds.has(notif.id.toString()) ? 'opacity-0 -translate-x-full' : 'opacity-100 translate-x-0'}`}
                              style={{ transitionDelay: isClearing ? `${idx * 40}ms` : '0ms' }}
                              onClick={() => handleSingleNotifClick(notif)}
                            >
                              <div className="flex gap-3">
                                <div className="flex-shrink-0 mt-1">
                                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${severityColor}`}>
                                    <span className="material-icons-round text-lg">{icon}</span>
                                  </div>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex justify-between items-start mb-1">
                                    <p className={`text-sm text-slate-900 flex items-center gap-2 dark:text-white mt-1 capitalize ${isUnread ? 'font-bold' : 'font-medium'}`}>
                                      {notif.category}
                                      {isUnread && <span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span>}
                                    </p>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setClearingItemIds(prev => {
                                          const next = new Set(prev);
                                          next.add(notif.id.toString());
                                          return next;
                                        });
                                        setTimeout(() => {
                                          setDismissedNotifIds(prev => {
                                            const next = new Set(prev);
                                            next.add(notif.id.toString());
                                            try { localStorage.setItem('dismissedNotifs', JSON.stringify(Array.from(next))); } catch {}
                                            return next;
                                          });
                                          setClearingItemIds(prev => {
                                            const next = new Set(prev);
                                            next.delete(notif.id.toString());
                                            return next;
                                          });
                                        }, 400);
                                      }}
                                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 opacity-0 group-hover/notif:opacity-100 transition-opacity rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 flex-shrink-0 ml-2"
                                      title="Dismiss"
                                    >
                                      <span className="material-icons-round text-sm">close</span>
                                    </button>
                                  </div>
                                  <p className={`text-xs break-all sm:break-words ${isUnread ? 'text-slate-700 dark:text-slate-300 font-medium' : 'text-slate-500 dark:text-slate-400'}`}>{notif.message}</p>
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
                onClick={() => router.push("/devices/discovery")}
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
              <div className="bg-surface-light dark:bg-surface-dark hover:bg-slate-50 dark:hover:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-500 shadow-sm hover:shadow-md relative overflow-hidden group transition-all duration-300 cursor-pointer">
                <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-40 transition-all duration-300 transform group-hover:scale-110 group-hover:-translate-y-1">
                  <span className="material-icons-round text-6xl text-red-500 dark:group-hover:text-red-400 transition-colors">wifi_off</span>
                </div>
                <div className="relative z-10 transform group-hover:scale-[1.03] origin-left transition-transform duration-300">
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">Offline</p>
                  <h3 className="text-3xl font-bold text-slate-900 dark:text-white mt-2">{loading ? '--' : offlineDevices.length.toString().padStart(2, '0')}</h3>
                  <div className="mt-2 text-xs text-red-500 dark:text-red-400 flex items-center font-medium">
                    {offlineDevices.length > 0 ? "Needs attention" : "All online"}
                  </div>
                </div>
              </div>
              <div
                className="bg-surface-light dark:bg-surface-dark hover:bg-slate-50 dark:hover:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-500 shadow-sm hover:shadow-md relative overflow-hidden group transition-all duration-300 cursor-pointer"
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
                  <span className="material-icons-round text-6xl text-orange-500 dark:group-hover:text-orange-400 transition-colors">warning</span>
                </div>
                <div className="relative z-10 transform group-hover:scale-[1.03] origin-left transition-transform duration-300">
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">System Alerts</p>
                  <h3 className="text-3xl font-bold text-slate-900 dark:text-white mt-2">{loading ? '--' : alertCount.toString().padStart(2, '0')}</h3>
                  <div className="mt-2 text-xs text-orange-500 dark:text-orange-400 flex items-center font-medium">
                    <span className="material-icons-round text-sm mr-1">priority_high</span>
                    {alertCount > 0 ? `${alertCount} unhandled issues` : 'All clear'}
                  </div>
                </div>
              </div>
            </div>

            <div className="mb-8">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Canvas Panel</h2>
                <div className="flex space-x-2">
                  {isCustomizeMode ? (
                    <>
                      <button onClick={resetCanvasLayout} className="flex items-center px-3 py-1.5 border border-red-300 dark:border-red-600 rounded bg-white dark:bg-slate-800 shadow-sm text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors">
                        <span className="material-icons-round text-[16px] mr-1.5">restart_alt</span> Reset
                      </button>
                      <button onClick={saveCanvasLayout} className="flex items-center px-3 py-1.5 bg-primary text-white rounded shadow-sm text-sm font-medium hover:bg-blue-600 transition-colors">
                        <span className="material-icons-round text-[16px] mr-1.5">save</span> Save Layout
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setIsCustomizeMode(true)} className="flex items-center px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors bg-white dark:bg-slate-800 shadow-sm font-medium">
                      <span className="material-icons-round text-[16px] mr-1.5">tune</span> Customize
                    </button>
                  )}
                </div>
              </div>
              <div className={`relative min-h-[600px] w-full rounded-xl transition-colors duration-300 overflow-hidden ${isCustomizeMode ? 'bg-slate-100 dark:bg-slate-800/80 border-2 border-dashed border-primary/50' : ''}`}>
                {loading ? (
                  <div className="py-12 text-center text-slate-400">Loading devices...</div>
                ) : approvedDevices.length === 0 ? (
                  <div className="py-12 text-center text-slate-400">No devices found.</div>
                ) : (
                  approvedDevices.map((config, index) => {
                    if (!("device_id" in config)) return null;
                    const c = config as DeviceConfig;
                    const layout = canvasLayouts[c.device_id] || { x: (index % 3) * 340, y: Math.floor(index / 3) * 220, w: 320, h: "auto" };
                    return (
                      <Rnd
                        key={c.device_id}
                        size={{ width: layout.w, height: layout.h }}
                        position={{ x: layout.x, y: layout.y }}
                        onDragStop={(e, d) => {
                          setCanvasLayouts(prev => ({ ...prev, [c.device_id]: { ...layout, x: d.x, y: d.y } }));
                        }}
                        onResizeStop={(e, direction, ref, delta, position) => {
                          setCanvasLayouts(prev => ({ 
                            ...prev, 
                            [c.device_id]: { 
                              x: position.x, 
                              y: position.y, 
                              w: parseInt(ref.style.width, 10), 
                              h: parseInt(ref.style.height, 10) 
                            } 
                          }));
                        }}
                        disableDragging={!isCustomizeMode}
                        enableResizing={isCustomizeMode}
                        minWidth={200}
                        minHeight={getCardMinHeight(c)}
                        bounds="parent"
                        className={`transition-shadow ${isCustomizeMode ? "z-50 shadow-2xl ring-2 ring-primary cursor-move rounded-xl bg-white dark:bg-surface-dark" : "z-10"}`}
                      >
                        <div className={`w-full h-full ${isCustomizeMode ? 'pointer-events-none' : ''}`}>
                          <DynamicDeviceCard config={c} isOnline={isDeviceOnline(c)} />
                        </div>
                      </Rnd>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function DeviceToggle({
  id,
  checked,
  disabled,
  loading,
  onChange,
}: {
  id: string;
  checked: boolean;
  disabled: boolean;
  loading: boolean;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const trackClass = loading
    ? "bg-sky-100 border-sky-400 dark:bg-sky-900/40 dark:border-sky-600"
    : checked
      ? "bg-primary border-primary/70"
      : "bg-slate-300 border-slate-300 dark:bg-slate-600 dark:border-slate-600";

  return (
    <div className="flex flex-col items-end gap-1">
      <label
        className={`relative inline-flex h-6 w-11 items-center ${
          disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer"
        }`}
        htmlFor={id}
      >
        <input
          checked={checked}
          className="sr-only"
          disabled={disabled}
          id={id}
          onChange={onChange}
          type="checkbox"
          aria-busy={loading}
        />
        <span
          className={`absolute inset-0 rounded-full border transition-colors duration-300 ${
            loading ? "animate-pulse" : ""
          } ${trackClass}`}
        />
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full border border-slate-200 bg-white shadow-sm transition-all duration-300 ${
            checked ? "translate-x-5" : "translate-x-0"
          } ${loading ? "opacity-0" : ""}`}
        />
        {loading ? (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky-600 border-t-transparent dark:border-sky-300" />
          </span>
        ) : null}
      </label>
      {loading ? (
        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-sky-600 dark:text-sky-300">
          Syncing...
        </span>
      ) : null}
    </div>
  );
}

function getStatePin(state: DeviceStateSnapshot | null | undefined, gpioPin?: number | null): DeviceStatePin | null {
  if (!state) {
    return null;
  }

  if (typeof gpioPin === "number") {
    const matchedPin = readStatePins(state).find((pin) => pin.pin === gpioPin);
    if (matchedPin) {
      return matchedPin;
    }
  }

  if (typeof state.pin === "number" && (gpioPin == null || state.pin === gpioPin)) {
    return {
      pin: state.pin,
      value: state.value,
      brightness: state.brightness,
      trend: state.trend,
      unit: state.unit,
    };
  }

  if (gpioPin == null) {
    return readStatePins(state)[0] ?? null;
  }

  return null;
}

function getNumericStateValue(value: number | boolean | undefined): number | null {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "number") {
    return value;
  }
  return null;
}

function getBinaryState(state: DeviceStateSnapshot | null | undefined, gpioPin?: number | null): boolean {
  const pinState = getStatePin(state, gpioPin);
  const numericValue = getNumericStateValue(pinState?.value);
  if (numericValue !== null) {
    return numericValue !== 0;
  }
  if (typeof pinState?.brightness === "number") {
    return pinState.brightness > 0;
  }
  return false;
}

function getBrightnessState(
  state: DeviceStateSnapshot | null | undefined,
  gpioPin: number | null | undefined,
  fallback: number,
): number {
  const pinState = getStatePin(state, gpioPin);
  if (typeof pinState?.brightness === "number") {
    return pinState.brightness;
  }
  const numericValue = getNumericStateValue(pinState?.value);
  if (numericValue !== null) {
    return numericValue;
  }
  return fallback;
}

function PinControlItem({ config, pin, isOnline }: { config: DeviceConfig, pin: PinConfig, isOnline: boolean }) {
  const [requestPending, setRequestPending] = useState(false);
  const [pendingCmdId, setPendingCmdId] = useState<string | null>(null);
  const [optimisticToggleState, setOptimisticToggleState] = useState<boolean | null>(null);
  const [optimisticSliderValue, setOptimisticSliderValue] = useState<number | null>(null);

  const deliveryForPendingCommand = Boolean(
    config.last_delivery && pendingCmdId && config.last_delivery.command_id === pendingCmdId
  );
  const failedPendingCommand =
    deliveryForPendingCommand && config.last_delivery?.status === "failed";

  const pwmMin = pin.extra_params?.min_value ?? 0;
  const pwmMax = pin.extra_params?.max_value ?? 255;
  const pwmRangeMin = Math.min(pwmMin, pwmMax);
  const pwmRangeMax = Math.max(pwmMin, pwmMax);
  const pwmSliderStyle = pwmMin > pwmMax ? { direction: "rtl" as const } : undefined;

  const pinState = getStatePin(config.last_state, pin.mode === 'I2C' ? null : pin.gpio_pin);
  const baselineToggleState = getBinaryState(config.last_state, pin.gpio_pin);
  const baselineSliderValue = getBrightnessState(config.last_state, pin.gpio_pin, pwmMin);

  const toggleTargetMatched =
    optimisticToggleState !== null && baselineToggleState === optimisticToggleState;
  const sliderTargetMatched =
    optimisticSliderValue !== null && baselineSliderValue === optimisticSliderValue;
  const commandStateSynced =
    (optimisticToggleState === null || toggleTargetMatched) &&
    (optimisticSliderValue === null || sliderTargetMatched);

  const pending = requestPending || (pendingCmdId !== null && !deliveryForPendingCommand && !commandStateSynced);
  const toggleLoading = optimisticToggleState !== null && !toggleTargetMatched && !failedPendingCommand;
  const sliderLoading = optimisticSliderValue !== null && !sliderTargetMatched && !failedPendingCommand;

  const toggleState = optimisticToggleState !== null ? optimisticToggleState : baselineToggleState;
  const sliderValue = optimisticSliderValue !== null ? optimisticSliderValue : baselineSliderValue;

  useEffect(() => {
    if ((optimisticToggleState !== null || optimisticSliderValue !== null) && commandStateSynced) {
      const timer = window.setTimeout(() => {
        setOptimisticToggleState(null);
        setOptimisticSliderValue(null);
        setPendingCmdId(null);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [commandStateSynced, optimisticToggleState, optimisticSliderValue]);

  useEffect(() => {
    if (deliveryForPendingCommand || failedPendingCommand) {
      const timer = window.setTimeout(() => {
        setOptimisticToggleState(null);
        setOptimisticSliderValue(null);
        setPendingCmdId(null);
      }, failedPendingCommand ? 0 : 500);
      return () => window.clearTimeout(timer);
    }
  }, [deliveryForPendingCommand, failedPendingCommand]);

  useEffect(() => {
    if (pendingCmdId !== null) {
      const timer = window.setTimeout(() => {
        setOptimisticToggleState(null);
        setOptimisticSliderValue(null);
        setPendingCmdId(null);
      }, 3000);
      return () => window.clearTimeout(timer);
    }
  }, [pendingCmdId]);

  const handleToggle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = e.target.checked;
    setRequestPending(true);
    setPendingCmdId(null);
    setOptimisticToggleState(isChecked);
    
    if (pin.mode === 'PWM') {
      setOptimisticSliderValue(!isChecked ? pwmMin : (sliderValue === pwmMin ? pwmMax : sliderValue));
    }
    
    try {
      const payload: { kind: string; pin: number; value: number; brightness?: number } = { kind: "action", pin: pin.gpio_pin, value: isChecked ? 1 : 0 };
      if (pin.mode === 'PWM' && isChecked && sliderValue === pwmMin) {
        payload.brightness = pwmMax;
      }
      const response = await sendDeviceCommand(config.device_id, payload);
      setRequestPending(false);
      if (response && response.status === "failed") {
        setOptimisticToggleState(null);
        setOptimisticSliderValue(null);
      } else {
        setPendingCmdId(response?.command_id || null);
      }
    } catch {
      setRequestPending(false);
      setOptimisticToggleState(null);
      setOptimisticSliderValue(null);
    }
  };

  const handleSliderCommit = async (rawValue: number) => {
    setRequestPending(true);
    setPendingCmdId(null);
    setOptimisticToggleState(null);
    setOptimisticSliderValue(rawValue);
    try {
      const payload = { kind: "action", pin: pin.gpio_pin, brightness: rawValue };
      const response = await sendDeviceCommand(config.device_id, payload);
      setRequestPending(false);
      if (response && response.status === "failed") {
        setOptimisticSliderValue(null);
      } else {
        setPendingCmdId(response?.command_id || null);
      }
    } catch {
      setRequestPending(false);
      setOptimisticSliderValue(null);
    }
  };

  const label = pin.function || pin.label || `${pin.mode} Pin ${pin.gpio_pin}`;

  if (pin.mode === 'OUTPUT') {
    return (
      <div className="flex justify-between items-center py-3 border-t border-slate-100 dark:border-slate-800/50">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
        <DeviceToggle
          checked={toggleState}
          disabled={pending || !isOnline}
          id={`pin-${config.device_id}-${pin.gpio_pin}`}
          loading={toggleLoading}
          onChange={handleToggle}
        />
      </div>
    );
  }

  if (pin.mode === 'PWM') {
    return (
      <div className="py-3 border-t border-slate-100 dark:border-slate-800/50">
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
          <div className="flex items-center gap-3">
             <span className="text-xs font-bold text-primary">
               {sliderLoading && <span className="text-[10px] uppercase font-normal text-primary/70 mr-1 animate-pulse">Syncing...</span>}
               {sliderValue}
             </span>
             <DeviceToggle
                checked={toggleState}
                disabled={pending || !isOnline}
                id={`pin-toggle-${config.device_id}-${pin.gpio_pin}`}
                loading={toggleLoading}
                onChange={handleToggle}
             />
          </div>
        </div>
        <input
          type="range"
          className="w-full accent-primary h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer"
          min={pwmRangeMin}
          max={pwmRangeMax}
          value={sliderValue}
          disabled={pending || !isOnline}
          style={pwmSliderStyle}
          onChange={(e) => setOptimisticSliderValue(parseInt(e.target.value))}
          onMouseUp={(e) => void handleSliderCommit(parseInt(e.currentTarget.value))}
          onTouchEnd={(e) => void handleSliderCommit(parseInt(e.currentTarget.value))}
        />
      </div>
    );
  }

  if (pin.mode === 'ADC' || pin.mode === 'INPUT') {
    const inputType = pin.extra_params?.input_type;
    const isSwitch = inputType === "switch";
    const isTach = inputType === "tachometer";
    const numValue = getNumericStateValue(pinState?.value);
    
    let displayValue: React.ReactNode = numValue ?? '--';
    let unit = pinState?.unit;

    if (isSwitch) {
      displayValue = numValue === 1 ? 'ON' : (numValue === 0 ? 'OFF' : '--');
    } else if (isTach) {
      unit = unit || "RPM";
    }

    return (
      <div className="flex justify-between items-center py-3 border-t border-slate-100 dark:border-slate-800/50">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
        <div className="flex items-baseline space-x-1">
          <span className={`text-lg font-bold ${isSwitch && numValue === 1 ? 'text-green-600 dark:text-green-400' : 'text-slate-800 dark:text-white'}`}>
            {displayValue}
          </span>
          {unit && <span className="text-xs font-medium text-slate-500 ml-1">{unit}</span>}
        </div>
      </div>
    );
  }

  if (pin.mode === 'I2C') {
    return (
      <div className="py-3 border-t border-slate-100 dark:border-slate-800/50">
        <div className="flex justify-between items-center">
          <div className="flex flex-col">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
            <span className="text-[10px] text-slate-400">I2C &middot; {pin.extra_params?.i2c_address || 'Auto'}</span>
          </div>
          <div className="flex items-baseline space-x-1">
            <span className="text-lg font-bold text-slate-800 dark:text-white">
              {getNumericStateValue(pinState?.value) ?? '--'}
            </span>
            {pinState?.unit && <span className="text-xs font-medium text-slate-500">{pinState.unit}</span>}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function ExtensionCard({ config, isOnline }: { config: DeviceConfig, isOnline: boolean }) {
  const [requestPending, setRequestPending] = useState(false);
  const [pendingCmdId, setPendingCmdId] = useState<string | null>(null);
  const [optimisticToggleState, setOptimisticToggleState] = useState<boolean | null>(null);
  const [optimisticSliderValue, setOptimisticSliderValue] = useState<number | null>(null);

  const deliveryForPendingCommand = Boolean(
    config.last_delivery && pendingCmdId && config.last_delivery.command_id === pendingCmdId
  );
  const failedPendingCommand =
    deliveryForPendingCommand && config.last_delivery?.status === "failed";

  const baselineToggleState = getBinaryState(config.last_state);
  const baselineSliderValue = getBrightnessState(config.last_state, null, 0);

  const toggleTargetMatched =
    optimisticToggleState !== null && baselineToggleState === optimisticToggleState;
  const sliderTargetMatched =
    optimisticSliderValue !== null && baselineSliderValue === optimisticSliderValue;
  const commandStateSynced =
    (optimisticToggleState === null || toggleTargetMatched) &&
    (optimisticSliderValue === null || sliderTargetMatched);

  const pending = requestPending || (pendingCmdId !== null && !deliveryForPendingCommand && !commandStateSynced);
  const toggleLoading = optimisticToggleState !== null && !toggleTargetMatched && !failedPendingCommand;
  const sliderLoading = optimisticSliderValue !== null && !sliderTargetMatched && !failedPendingCommand;

  const toggleState = optimisticToggleState !== null ? optimisticToggleState : baselineToggleState;
  const sliderValue = optimisticSliderValue !== null ? optimisticSliderValue : baselineSliderValue;

  useEffect(() => {
    if ((optimisticToggleState !== null || optimisticSliderValue !== null) && commandStateSynced) {
      const timer = window.setTimeout(() => {
        setOptimisticToggleState(null);
        setOptimisticSliderValue(null);
        setPendingCmdId(null);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [commandStateSynced, optimisticToggleState, optimisticSliderValue]);

  useEffect(() => {
    if (deliveryForPendingCommand || failedPendingCommand) {
      const timer = window.setTimeout(() => {
        setOptimisticToggleState(null);
        setOptimisticSliderValue(null);
        setPendingCmdId(null);
      }, failedPendingCommand ? 0 : 500);
      return () => window.clearTimeout(timer);
    }
  }, [deliveryForPendingCommand, failedPendingCommand]);

  useEffect(() => {
    if (pendingCmdId !== null) {
      const timer = window.setTimeout(() => {
        setOptimisticToggleState(null);
        setOptimisticSliderValue(null);
        setPendingCmdId(null);
      }, 3000);
      return () => window.clearTimeout(timer);
    }
  }, [pendingCmdId]);

  const handleToggle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = e.target.checked;
    setRequestPending(true);
    setPendingCmdId(null);
    setOptimisticToggleState(isChecked);
    setOptimisticSliderValue(!isChecked ? 0 : null);
    try {
      const payload = { kind: "action", pin: 0, value: isChecked ? 1 : 0 };
      const response = await sendDeviceCommand(config.device_id, payload);
      setRequestPending(false);
      if (response && response.status === "failed") {
        setOptimisticToggleState(null);
        setOptimisticSliderValue(null);
      } else {
        setPendingCmdId(response?.command_id || null);
      }
    } catch {
      setRequestPending(false);
      setOptimisticToggleState(null);
      setOptimisticSliderValue(null);
    }
  };

  const handleSliderCommit = async (rawValue: number) => {
    setRequestPending(true);
    setPendingCmdId(null);
    setOptimisticToggleState(null);
    setOptimisticSliderValue(rawValue);
    try {
      const payload = { kind: "action", pin: 0, brightness: rawValue };
      const response = await sendDeviceCommand(config.device_id, payload);
      setRequestPending(false);
      if (response && response.status === "failed") {
        setOptimisticSliderValue(null);
      } else {
        setPendingCmdId(response?.command_id || null);
      }
    } catch {
      setRequestPending(false);
      setOptimisticSliderValue(null);
    }
  };

  return (
    <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-indigo-100 dark:border-indigo-900/50 p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-y-auto w-full h-full flex flex-col">
      <div className="absolute top-0 right-0">
        <div className="bg-indigo-500 text-white text-[10px] px-2 py-1 rounded-bl-lg rounded-tr text-xs font-bold flex items-center shadow-sm z-20">
          <span className="material-icons-round text-[14px] mr-1">extension</span> EXT
        </div>
      </div>
      <div className="flex justify-between items-start mb-2 mt-1">
        <div className="h-10 w-10 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
          <span className="material-icons-round">wb_incandescent</span>
        </div>
        <DeviceToggle
          checked={toggleState}
          disabled={pending || !isOnline}
          id={`ext-${config.device_id}`}
          loading={toggleLoading}
          onChange={handleToggle}
        />
      </div>
      <div className="mb-5">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white truncate" title={config.name}>{config.name}</h3>
        <p className="text-xs text-slate-500 truncate" title="Extension Device">Extension Device</p>
      </div>
      <div className="mb-4">
        <div className="flex justify-between items-end mb-2">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            Brightness
            {sliderLoading && <span className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />}
          </label>
          <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
            {sliderLoading && <span className="text-[10px] tracking-wide text-indigo-500/80 animate-pulse font-normal uppercase">Syncing...</span>}
            {sliderValue}
          </span>
        </div>
        <input
          type="range"
          className="w-full accent-primary h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer"
          min={0}
          max={255}
          value={sliderValue}
          disabled={pending || !isOnline}
          onChange={(e) => setOptimisticSliderValue(parseInt(e.target.value))}
          onMouseUp={(e) => void handleSliderCommit(parseInt(e.currentTarget.value))}
          onTouchEnd={(e) => void handleSliderCommit(parseInt(e.currentTarget.value))}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800 pt-3">
        <span className="flex items-center text-indigo-600 dark:text-indigo-400 font-medium">Source: {config.provider}</span>
      </div>
    </div>
  );
}

function DynamicDeviceCard({ config, isOnline }: { config: DeviceConfig, isOnline: boolean }) {
  if (config.provider) {
    return <ExtensionCard config={config} isOnline={isOnline} />;
  }

  const activePinConfigurations = getActivePinConfigurations(config);
  
  const displayPins = [];
  let hasI2C = false;
  for (const p of activePinConfigurations) {
    if (p.mode === 'I2C') {
      if (!hasI2C) {
        displayPins.push(p);
        hasI2C = true;
      }
    } else {
      displayPins.push(p);
    }
  }

  return (
    <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-y-auto w-full h-full flex flex-col">
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1 min-w-0 pr-4">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white truncate" title={config.name}>{config.name}</h3>
          <p className="text-xs text-slate-500 truncate" title={config.board || 'Device'}>{config.board || 'Device'}</p>
        </div>
        <span className="flex items-center text-xs text-slate-500 flex-shrink-0">
          <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'} mr-1`}></span>
          {isOnline ? 'Online' : 'Offline'}
        </span>
      </div>
      
      <div className="flex flex-col mt-2">
        {displayPins.length === 0 ? (
           <div className="py-4 text-xs text-slate-400 text-center border-t border-slate-100 dark:border-slate-800/50">No pins configured</div>
        ) : (
           displayPins.map(pin => (
             <PinControlItem key={pin.gpio_pin} config={config} pin={pin} isOnline={isOnline} />
           ))
        )}
      </div>
    </div>
  );
}
