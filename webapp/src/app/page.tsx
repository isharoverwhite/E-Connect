"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchDashboardDevices, fetchDevices, fetchSystemLogs, markSystemLogRead, markAllSystemLogsRead, SystemLogEntry, fetchSystemStatus } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import Sidebar from '@/components/Sidebar';
import { DeviceConfig } from "@/types/device";
import { useWebSocket } from "@/hooks/useWebSocket";
import { DynamicDeviceCard, getCardMinHeight } from "@/components/DeviceCard";
import { Rnd } from "react-rnd";
import DeviceScanConnectPanel from "@/components/DeviceScanConnectPanel";

type CanvasLayout = { x: number; y: number; w: number | string; h: number | string };

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
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
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

  const [windowWidth, setWindowWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMounted(true);
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const isMobile = windowWidth < 1024;
  const hasCustomLayout = Object.keys(canvasLayouts).length > 0;
  // Use canvas if we are customizing, or if we have a custom layout AND we are not on mobile
  const shouldUseCanvas = isMounted && (isCustomizeMode || (hasCustomLayout && !isMobile));

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
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Device Dashboard</h2>
                <div className="flex space-x-2">
                  {!isMobile && (
                    isCustomizeMode ? (
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
                  <div style={{ minHeight: `${Math.max(10, ...approvedDevices.map((config, idx) => {
                    if (!("device_id" in config)) return 0;
                    const c = config as DeviceConfig;
                    const layout = canvasLayouts[c.device_id] || { y: Math.floor(idx / 3) * 220, h: 350 };
                    return layout.y + (typeof layout.h === 'number' ? layout.h : 350);
                  })) + (isCustomizeMode ? 400 : 20)}px`, minWidth: "100%", position: "relative" }}>
                    {approvedDevices.map((config, index) => {
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
                        dragGrid={[20, 20]}
                        resizeGrid={[20, 20]}
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

