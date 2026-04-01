"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchDashboardDevices, fetchDevices, sendDeviceCommand } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import Sidebar from '@/components/Sidebar';
import { DeviceConfig, DeviceStatePin, DeviceStateSnapshot } from "@/types/device";
import { useWebSocket } from "@/hooks/useWebSocket";

export default function Dashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const [devices, setDevices] = useState<DeviceConfig[]>([]);
  const [pairingRequests, setPairingRequests] = useState<DeviceConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNotifications, setShowNotifications] = useState(false);
  const [dismissedNotifIds, setDismissedNotifIds] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("dismissedNotifs");
        if (saved) return new Set(JSON.parse(saved));
      } catch {}
    }
    return new Set<string>();
  });
  const isAdmin = user?.account_type === "admin";
  async function syncDashboardData() {
    const [dashboardDevices, pendingRequests] = await Promise.all([
      fetchDashboardDevices(),
      isAdmin ? fetchDevices({ authStatus: "pending" }) : Promise.resolve([]),
    ]);
    setDevices(dashboardDevices);
    setPairingRequests((pendingRequests as DeviceConfig[]) || []);
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
        const [dashboardDevices, pendingRequests] = await Promise.all([
          fetchDashboardDevices(),
          isAdmin ? fetchDevices({ authStatus: "pending" }) : Promise.resolve([]),
        ]);
        if (cancelled) {
          return;
        }
        setDevices(dashboardDevices);
        setPairingRequests((pendingRequests as DeviceConfig[]) || []);
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
  const onlineCount = devices.filter(isDeviceOnline).length;
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const newThisWeek = devices.filter(d => d.created_at && new Date(d.created_at) > oneWeekAgo).length;

  const offlineDevices = devices.filter(d => !isDeviceOnline(d) && d.auth_status === "approved");

  const allNotifications = useMemo(() => {
    const notifs: Array<{ id: string; type: 'offline'; device: DeviceConfig }> = [];
    offlineDevices.forEach(dev => {
      notifs.push({
        id: `offline-${dev.device_id}-${dev.last_seen || ''}`,
        type: 'offline' as const,
        device: dev,
      });
    });
    return notifs;
  }, [offlineDevices]);

  const visibleNotifications = allNotifications.filter(n => !dismissedNotifIds.has(n.id));
  const alertCount = visibleNotifications.length;

  const handleClearAll = async () => {
    const newDismissed = new Set(dismissedNotifIds);
    for (const n of allNotifications) {
      newDismissed.add(n.id);
    }
    setDismissedNotifIds(newDismissed);
    try { localStorage.setItem('dismissedNotifs', JSON.stringify(Array.from(newDismissed))); } catch {}
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
                onClick={() => setShowNotifications(!showNotifications)}
              >
                <span className="material-icons-round">notifications</span>
                {alertCount > 0 && (
                  <span className="absolute top-1.5 right-2 flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500 border border-white dark:border-slate-900"></span>
                  </span>
                )}
              </button>

              {showNotifications && (
                <div className="absolute right-0 top-full mt-3 w-80 sm:w-96 bg-surface-light dark:bg-surface-dark rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/50 backdrop-blur-sm">
                    <h3 className="font-semibold text-sm text-slate-800 dark:text-slate-100">Notifications</h3>
                    {visibleNotifications.length > 0 && (
                      <button
                        onClick={handleClearAll}
                        className="text-xs font-medium text-slate-500 hover:text-red-500 transition-colors flex items-center gap-1"
                      >
                        <span className="material-icons-round text-[14px]">delete_sweep</span>
                        Clear all
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
                      visibleNotifications.map(notif => {
                          return (
                            <div key={notif.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 border-b border-slate-100 dark:border-slate-700/50 transition-colors group">
                              <div className="flex gap-3">
                                <div className="flex-shrink-0 mt-1">
                                  <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center text-red-500 dark:text-red-400 group-hover:bg-red-200 dark:group-hover:bg-red-900/40 transition-colors">
                                    <span className="material-icons-round text-lg">wifi_off</span>
                                  </div>
                                </div>
                                <div className="flex-1">
                                  <div className="flex justify-between items-start mb-1">
                                    <p className="text-sm font-medium text-slate-900 dark:text-white mt-1">{notif.device.name} Offline</p>
                                    <button
                                      onClick={() => {
                                        setDismissedNotifIds(prev => {
                                          const next = new Set(prev);
                                          next.add(notif.id);
                                          try { localStorage.setItem('dismissedNotifs', JSON.stringify(Array.from(next))); } catch {}
                                          return next;
                                        });
                                      }}
                                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 opacity-0 group-hover:opacity-100 transition-opacity rounded-full hover:bg-slate-100 dark:hover:bg-slate-700"
                                      title="Dismiss"
                                    >
                                      <span className="material-icons-round text-sm">close</span>
                                    </button>
                                  </div>
                                  <p className="text-xs text-slate-500 dark:text-slate-400">Connection lost to {notif.device.board || 'Device'}.</p>
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
                  <div className="mt-2 text-xs text-green-600 dark:text-green-400 flex items-center font-medium">
                    <span className="material-icons-round text-sm mr-1">trending_up</span>
                    {newThisWeek > 0 ? `+${newThisWeek} New this week` : 'Up to date'}
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
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Quick Controls</h2>
                <div className="flex space-x-2">
                  <button className="flex items-center px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
                    <span className="material-icons-round text-sm mr-2">tune</span> Customize
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {loading ? (
                  <div className="col-span-full py-12 text-center text-slate-400">Loading devices...</div>
                ) : approvedDevices.length === 0 ? (
                  <div className="col-span-full py-12 text-center text-slate-400">No devices found.</div>
                ) : (
                  approvedDevices.map((config) => (
                    <DynamicDeviceCard key={config.device_id} config={config} isOnline={isDeviceOnline(config)} />
                  ))
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

function getStatePins(state: DeviceStateSnapshot | null | undefined): DeviceStatePin[] {
  if (!Array.isArray(state?.pins)) {
    return [];
  }

  return state.pins.filter((pin): pin is DeviceStatePin => typeof pin?.pin === "number");
}

function getStatePin(state: DeviceStateSnapshot | null | undefined, gpioPin?: number | null): DeviceStatePin | null {
  if (!state) {
    return null;
  }

  if (typeof gpioPin === "number") {
    const matchedPin = getStatePins(state).find((pin) => pin.pin === gpioPin);
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
    return getStatePins(state)[0] ?? null;
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

function DynamicDeviceCard({ config, isOnline }: { config: DeviceConfig, isOnline: boolean }) {
  const [requestPending, setRequestPending] = useState(false);
  const [pendingCmdId, setPendingCmdId] = useState<string | null>(null);
  const [optimisticToggleState, setOptimisticToggleState] = useState<boolean | null>(null);
  const [optimisticSliderValue, setOptimisticSliderValue] = useState<number | null>(null);

  const pwmPin = config.pin_configurations?.find((p) => p.mode === 'PWM');
  const outputPin = config.pin_configurations?.find((p) => p.mode === 'OUTPUT');
  const analogPin = config.pin_configurations?.find((p) => p.mode === 'ADC');
  const i2cPin = config.pin_configurations?.find((p) => p.mode === 'I2C');

  const pwmMin = pwmPin?.extra_params?.min_value ?? 0;
  const pwmMax = pwmPin?.extra_params?.max_value ?? 255;
  const pwmRangeMin = Math.min(pwmMin, pwmMax);
  const pwmRangeMax = Math.max(pwmMin, pwmMax);
  const pwmRangeLabel = pwmMin > pwmMax ? `${pwmMin} -> ${pwmMax}` : `${pwmMin}-${pwmMax}`;
  const pwmSliderStyle = pwmMin > pwmMax ? { direction: "rtl" as const } : undefined;
  const controlPin = outputPin ?? pwmPin;
  const primaryState = getStatePin(config.last_state);
  const analogState = getStatePin(config.last_state, analogPin?.gpio_pin);
  const baselineToggleState = getBinaryState(config.last_state, controlPin?.gpio_pin);
  const baselineSliderValue = getBrightnessState(config.last_state, pwmPin?.gpio_pin, pwmMin);
  const deliveryForPendingCommand = Boolean(
    config.last_delivery && pendingCmdId && config.last_delivery.command_id === pendingCmdId
  );
  const failedPendingCommand =
    deliveryForPendingCommand && config.last_delivery?.status === "failed";
  const toggleTargetMatched =
    optimisticToggleState !== null && baselineToggleState === optimisticToggleState;
  const sliderTargetMatched =
    optimisticSliderValue !== null && baselineSliderValue === optimisticSliderValue;
  const commandStateSynced =
    (optimisticToggleState === null || toggleTargetMatched) &&
    (optimisticSliderValue === null || sliderTargetMatched);
  const keepOptimisticState =
    pendingCmdId !== null && !failedPendingCommand && !commandStateSynced;
  const pending =
    requestPending || (pendingCmdId !== null && !deliveryForPendingCommand && !commandStateSynced);
  const toggleLoading =
    optimisticToggleState !== null && !toggleTargetMatched && !failedPendingCommand;
  const toggleState = baselineToggleState;
  const sliderValue = keepOptimisticState
    ? optimisticSliderValue ?? baselineSliderValue
    : baselineSliderValue;

  const handleToggle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = e.target.checked;
    const targetPin = outputPin || pwmPin;
    if (!targetPin) return;

    setRequestPending(true);
    setPendingCmdId(null);
    setOptimisticToggleState(isChecked);
    setOptimisticSliderValue(!isChecked && (pwmPin || config.provider) ? 0 : null);
    try {
      const payload = { kind: "action", pin: targetPin.gpio_pin, value: isChecked ? 1 : 0 };
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
    const targetPin = pwmPin || outputPin;
    if (!targetPin && !config.provider) return;

    setRequestPending(true);
    setPendingCmdId(null);
    setOptimisticToggleState(null);
    setOptimisticSliderValue(rawValue);
    try {
      const payload = { kind: "action", pin: targetPin?.gpio_pin || 0, brightness: rawValue };
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

  const nameLower = config.name.toLowerCase();

  // I2C SENSOR CARD
  if (i2cPin) {
    const libName = i2cPin.extra_params?.i2c_library || "I2C Device";
    const isSensor = !i2cPin.extra_params?.i2c_library?.includes("SSD1306") && !i2cPin.extra_params?.i2c_library?.includes("MCP23017");

    return (
      <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-orange-100 dark:border-orange-900/30 p-5 shadow-sm hover:shadow-md transition-shadow">
        <div className="flex justify-between items-start mb-2">
          <div className="h-10 w-10 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 flex items-center justify-center">
            <span className="material-icons-round">{isSensor ? 'Settings_input_component' : 'view_quilt'}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-bold text-orange-500 uppercase tracking-tight">I2C · {i2cPin.extra_params?.i2c_address}</span>
            <span className="text-[9px] text-slate-400">ID: {config.device_id.split('-')[0]}</span>
          </div>
        </div>
        <h3 className="text-base font-semibold text-slate-900 dark:text-white mt-2 truncate" title={config.name}>{config.name}</h3>
        <p className="text-xs text-slate-500 mb-3 truncate" title={libName}>{libName}</p>

        <div className="flex items-center gap-4">
          <div className="flex-1">
             <span className="text-2xl font-bold text-slate-800 dark:text-white">
               {getNumericStateValue(primaryState?.value) ?? "--"}
             </span>
             <span className="text-sm text-slate-500 ml-1">{primaryState?.unit || ''}</span>
          </div>
          {isOnline && <span className="text-[10px] text-green-500 font-medium bg-green-500/10 px-2 py-0.5 rounded-full">Live</span>}
        </div>

        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center text-[10px] text-slate-400">
           <span className="flex items-center gap-1">
             <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'}`}></span>
             {isOnline ? 'Connected' : 'Offline'}
           </span>
           <span>Bus: SDA={config.pin_configurations?.find(p => p.extra_params?.i2c_role === 'SDA')?.gpio_pin} SCL={config.pin_configurations?.find(p => p.extra_params?.i2c_role === 'SCL')?.gpio_pin}</span>
        </div>
      </div>
    );
  }
  // EXTENSION CARD
  if (config.provider) {
    return (
      <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-indigo-100 dark:border-indigo-900/50 p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
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
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Brightness</label>
            <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">{sliderValue}</span>
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
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800 pt-3">
          <span className="flex items-center text-indigo-600 dark:text-indigo-400 font-medium">Source: {config.provider}</span>
        </div>
      </div>
    );
  }

  // SENSOR CARD (Temp/Humidity)
  if (nameLower.includes('temp') || nameLower.includes('humidity') || analogPin) {
    const isTemp = nameLower.includes('temp');
    return (
      <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm hover:shadow-md transition-shadow">
        <div className="flex justify-between items-start mb-2">
          <div className={`h-10 w-10 rounded-full ${isTemp ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'} flex items-center justify-center`}>
            <span className="material-icons-round">{isTemp ? 'thermostat' : 'water_drop'}</span>
          </div>
          <span className="text-xs font-mono text-slate-400">Updated 1m ago</span>
        </div>
        <h3 className="text-base font-semibold text-slate-900 dark:text-white mt-2 truncate" title={config.name}>{config.name}</h3>
        <p className="text-xs text-slate-500 mb-3 truncate" title={config.board || 'Multi-sensor Node'}>{config.board || 'Multi-sensor Node'}</p>
        <div className="flex items-baseline space-x-1">
          <span className="text-3xl font-bold text-slate-800 dark:text-white">
            {getNumericStateValue(analogState?.value) ?? getNumericStateValue(primaryState?.value) ?? '--'}
          </span>
          <span className="text-lg font-medium text-slate-500">{isTemp ? '°C' : '%'}</span>
        </div>
        <div className={`mt-3 text-xs flex items-center ${isTemp ? 'text-green-600 dark:text-green-400' : 'text-slate-500 dark:text-slate-400'}`}>
          <span className="material-icons-round text-sm mr-1">{isTemp ? 'arrow_drop_up' : 'remove'}</span>
          {analogState?.trend || primaryState?.trend || 'Stable'}
        </div>
      </div>
    );
  }

  // GARAGE OFFLINE
  if (nameLower.includes('garage') && !isOnline) {
    return (
      <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm hover:shadow-md transition-shadow border-l-4 border-l-red-500">
        <div className="flex justify-between items-start mb-4">
          <div className="h-10 w-10 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400">
            <span className="material-icons-round">garage</span>
          </div>
          <button className="text-slate-400 hover:text-primary"><span className="material-icons-round">refresh</span></button>
        </div>
        <h3 className="text-base font-semibold text-slate-900 dark:text-white truncate" title={config.name}>{config.name}</h3>
        <p className="text-xs text-slate-500 mb-4 truncate" title={config.board || 'Device'}>{config.board || 'Device'}</p>
        <div className="flex items-center justify-between text-xs text-red-500 dark:text-red-400 border-t border-slate-100 dark:border-slate-800 pt-3 font-medium">
          <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-red-500 mr-2"></span>Offline</span>
          <span>Check Power</span>
        </div>
      </div>
    );
  }

  // DIMMER CARD
  if (pwmPin || nameLower.includes('lamp') || nameLower.includes('dimmer')) {
    return (
      <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm hover:shadow-md transition-shadow">
        <div className="flex justify-between items-start mb-2">
          <div className="h-10 w-10 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center text-yellow-600 dark:text-yellow-400">
            <span className="material-icons-round">lightbulb</span>
          </div>
          <DeviceToggle
            checked={toggleState}
            disabled={pending || !isOnline}
            id={`dim-${config.device_id}`}
            loading={toggleLoading}
            onChange={handleToggle}
          />
        </div>
        <div className="mb-5">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white truncate" title={config.name}>{config.name}</h3>
          <p className="text-xs text-slate-500 truncate" title={config.board || 'Dimmer'}>{config.board || 'Dimmer'}</p>
        </div>
        <div className="mb-4">
          <div className="flex justify-between items-end mb-2">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Brightness ({pwmRangeLabel})</label>
            <span className="text-xs font-bold text-primary">{sliderValue}</span>
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
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800 pt-3">
          <span className="flex items-center">
            {isOnline ? <span className="w-2 h-2 rounded-full bg-green-500 mr-2"></span> : <span className="w-2 h-2 rounded-full bg-red-500 mr-2"></span>}
            {isOnline ? 'Online' : 'Offline'}
          </span>
          <span className="text-xs text-slate-400">12W</span>
        </div>
      </div>
    );
  }

  // SWITCH / DEFAULT
  const Icon = nameLower.includes('lock') ? 'lock' : 'wb_incandescent';
  const colorClass = nameLower.includes('lock') ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400';
  const statusRight = toggleLoading
    ? 'Updating...'
    : nameLower.includes('lock')
      ? (toggleState ? 'Locked' : 'Unlocked')
      : (toggleState ? 'On' : 'Off');

  return (
    <div className={`bg-surface-light dark:bg-surface-dark rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm hover:shadow-md transition-shadow ${nameLower.includes('lock') ? '' : 'opacity-90'}`}>
      <div className="flex justify-between items-start mb-4">
        <div className={`h-10 w-10 rounded-full flex items-center justify-center ${colorClass}`}>
          <span className="material-icons-round">{Icon}</span>
        </div>
        <DeviceToggle
          checked={toggleState}
          disabled={pending || !isOnline}
          id={`sw-${config.device_id}`}
          loading={toggleLoading}
          onChange={handleToggle}
        />
      </div>
      <h3 className="text-base font-semibold text-slate-900 dark:text-white truncate" title={config.name}>{config.name}</h3>
      <p className="text-xs text-slate-500 mb-4 truncate" title={config.board || 'Device'}>{config.board || 'Device'}</p>
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800 pt-3">
        <span className="flex items-center">
          {isOnline ? <span className="w-2 h-2 rounded-full bg-green-500 mr-2"></span> : <span className="w-2 h-2 rounded-full bg-red-500 mr-2"></span>}
          {isOnline ? 'Online' : 'Offline'}
        </span>
        <span>{statusRight}</span>
      </div>
    </div>
  );
}
