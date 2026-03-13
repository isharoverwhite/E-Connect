"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { fetchDashboardDevices, sendDeviceCommand } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { DeviceConfig } from "@/types/device";

export default function Dashboard() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [devices, setDevices] = useState<DeviceConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNotifications, setShowNotifications] = useState(false);
  const isAdmin = user?.account_type === "admin";

  useEffect(() => {
    let active = true;

    async function load() {
      const data = await fetchDashboardDevices();
      if (!active) return;
      setDevices(data);
      setLoading(false);
    }

    load();

    const intervalId = window.setInterval(load, 3000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const isDeviceOnline = (d: DeviceConfig) => {
    return d.auth_status === "approved" && d.conn_status === "online";
  };

  const approvedDevices = devices.filter((device) => device.auth_status === "approved");
  const onlineCount = devices.filter(isDeviceOnline).length;
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const newThisWeek = devices.filter(d => d.created_at && new Date(d.created_at) > oneWeekAgo).length;

  const offlineDevices = devices.filter(d => !isDeviceOnline(d) && d.auth_status === "approved");
  const alertCount = offlineDevices.length;

  return (
    <div className="bg-background-light dark:bg-background-dark text-slate-800 dark:text-slate-200 font-sans h-screen flex overflow-hidden selection:bg-primary selection:text-white">
      <aside className="w-64 bg-surface-light dark:bg-surface-dark border-r border-slate-200 dark:border-slate-700 flex flex-col justify-between hidden md:flex z-20 shadow-lg">
        <div>
          <div className="h-16 flex items-center px-6 border-b border-slate-200 dark:border-slate-700">
            <span className="material-icons-round text-primary mr-2 text-3xl">hub</span>
            <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">E-Connect</span>
          </div>
          <nav className="p-4 space-y-1">
            <a className="flex items-center px-4 py-3 bg-primary/10 text-primary font-medium rounded-lg" href="#">
              <span className="material-icons-round mr-3">dashboard</span>
              Dashboard
            </a>
            <a className="flex items-center px-4 py-3 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors" href="/devices">
              <span className="material-icons-round mr-3">devices_other</span>
              Devices
            </a>
            <a className="flex items-center px-4 py-3 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors" href="/automation">
              <span className="material-icons-round mr-3">precision_manufacturing</span>
              Automation
            </a>
            <a className="flex items-center px-4 py-3 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors" href="/logs">
              <span className="material-icons-round mr-3">analytics</span>
              Logs & Stats
            </a>
            <a className="flex items-center px-4 py-3 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors" href="/extensions">
              <span className="material-icons-round mr-3">extension</span>
              Extensions
            </a>
          </nav>
        </div>
        <div className="p-4 border-t border-slate-200 dark:border-slate-700">
          <a className="flex items-center px-4 py-3 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors mb-2" href="/settings">
            <span className="material-icons-round mr-3">settings</span>
            Settings
          </a>
          <div className="flex items-center px-4 py-3 justify-between group">
            <div className="flex items-center">
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary to-purple-500 flex items-center justify-center text-white font-bold text-xs uppercase">
                {user?.fullname?.substring(0, 2) || 'AD'}
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-slate-900 dark:text-white">{user?.fullname || 'Admin User'}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 capitalize">{user?.account_type || 'Master Node'}</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all p-2 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10"
              title="Logout"
            >
              <span className="material-icons-round text-[18px]">logout</span>
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 relative">
        <header className="h-16 bg-surface-light dark:bg-surface-dark border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-6 shadow-sm z-30">
          <h1 className="text-lg font-semibold text-slate-800 dark:text-white">IoT Home Control</h1>
          <div className="flex items-center space-x-4">
            <div className="relative group">
              <button
                className="p-2 text-primary bg-blue-50 dark:bg-blue-500/10 rounded-full transition-colors relative outline-none ring-2 ring-blue-100 dark:ring-blue-900/30"
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
                    <button className="text-xs font-medium text-primary hover:text-blue-600 transition-colors">Mark all read</button>
                  </div>
                  <div className="max-h-[32rem] overflow-y-auto">
                    {isAdmin ? (
                      <div className="p-4 bg-blue-50/40 dark:bg-blue-900/10 border-b border-slate-100 dark:border-slate-700/50">
                        <div className="flex gap-3">
                          <div className="flex-shrink-0 mt-1">
                            <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-600/20 flex items-center justify-center text-blue-600 dark:text-blue-400">
                              <span className="material-icons-round text-lg">sensors</span>
                            </div>
                          </div>
                          <div className="flex-1">
                            <div className="flex justify-between items-start mb-1">
                              <p className="text-sm font-semibold text-slate-900 dark:text-white">New Device Found</p>
                              <span className="text-[10px] font-bold tracking-wide text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-500/20 px-1.5 py-0.5 rounded uppercase">New</span>
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">Pending devices are available in discovery when a node handshakes with this instance.</p>
                            <div className="flex gap-2">
                              <button
                                onClick={() => router.push("/devices/discovery")}
                                className="flex-1 bg-primary hover:bg-blue-600 text-white text-xs font-medium py-1.5 px-3 rounded shadow-sm transition-colors flex items-center justify-center gap-1"
                              >
                                <span className="material-icons-round text-sm">link</span> Pair Now
                              </button>
                              <button className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600 text-xs font-medium py-1.5 px-3 rounded transition-colors">
                                Ignore
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    {offlineDevices.slice(0, 3).map(dev => (
                      <div key={dev.device_id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 border-b border-slate-100 dark:border-slate-700/50 transition-colors cursor-pointer group">
                        <div className="flex gap-3">
                          <div className="flex-shrink-0 mt-1">
                            <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center text-red-500 dark:text-red-400 group-hover:bg-red-200 dark:group-hover:bg-red-900/40 transition-colors">
                              <span className="material-icons-round text-lg">wifi_off</span>
                            </div>
                          </div>
                          <div className="flex-1">
                            <div className="flex justify-between items-center mb-1">
                              <p className="text-sm font-medium text-slate-900 dark:text-white">{dev.name} Offline</p>
                              <span className="text-xs text-slate-400">Recent</span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Connection lost to {dev.board || 'Device'}.</p>
                          </div>
                        </div>
                      </div>
                    ))}
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
                className="flex items-center bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-600 transition-all shadow-md hover:shadow-lg"
              >
                <span className="material-icons-round text-sm mr-2">add</span>
                Add Device
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
              <div className="bg-surface-light dark:bg-surface-dark p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm relative overflow-hidden group">
                <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <span className="material-icons-round text-6xl text-slate-500">router</span>
                </div>
                <div className="relative z-10">
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">Total Devices</p>
                  <h3 className="text-3xl font-bold text-slate-900 dark:text-white mt-2">{loading ? '--' : devices.length.toString().padStart(2, '0')}</h3>
                  <div className="mt-2 text-xs text-green-600 dark:text-green-400 flex items-center font-medium">
                    <span className="material-icons-round text-sm mr-1">trending_up</span>
                    {newThisWeek > 0 ? `+${newThisWeek} New this week` : 'Up to date'}
                  </div>
                </div>
              </div>
              <div className="bg-surface-light dark:bg-surface-dark p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm relative overflow-hidden group">
                <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <span className="material-icons-round text-6xl text-green-500">wifi</span>
                </div>
                <div className="relative z-10">
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">Online</p>
                  <h3 className="text-3xl font-bold text-slate-900 dark:text-white mt-2">{loading ? '--' : onlineCount.toString().padStart(2, '0')}</h3>
                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center">
                    Stable connection
                  </div>
                </div>
              </div>
              <div className="bg-surface-light dark:bg-surface-dark p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm relative overflow-hidden group">
                <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <span className="material-icons-round text-6xl text-red-500">wifi_off</span>
                </div>
                <div className="relative z-10">
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">Offline</p>
                  <h3 className="text-3xl font-bold text-slate-900 dark:text-white mt-2">{loading ? '--' : offlineDevices.length.toString().padStart(2, '0')}</h3>
                  <div className="mt-2 text-xs text-red-500 dark:text-red-400 flex items-center font-medium">
                    {offlineDevices.length > 0 ? "Needs attention" : "All online"}
                  </div>
                </div>
              </div>
              <div className="bg-surface-light dark:bg-surface-dark p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm relative overflow-hidden group">
                <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <span className="material-icons-round text-6xl text-orange-500">warning</span>
                </div>
                <div className="relative z-10">
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

function DynamicDeviceCard({ config, isOnline }: { config: DeviceConfig, isOnline: boolean }) {
  const [pending, setPending] = useState(false);
  const [toggleState, setToggleState] = useState(Boolean(config.last_state?.value));
  const [sliderValue, setSliderValue] = useState(Number(config.last_state?.brightness || 0));

  useEffect(() => {
    setToggleState(Boolean(config.last_state?.value));
    setSliderValue(Number(config.last_state?.brightness || 0));
  }, [config.last_state?.value, config.last_state?.brightness]);

  const pwmPin = config.pin_configurations?.find((p) => p.mode === 'PWM');
  const outputPin = config.pin_configurations?.find((p) => p.mode === 'OUTPUT');
  const analogPin = config.pin_configurations?.find((p) => p.mode === 'ADC');

  const handleToggle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = e.target.checked;
    const targetPin = outputPin || pwmPin;
    if (!targetPin) return;

    setPending(true);
    try {
      const payload = { kind: "action", pin: targetPin.gpio_pin, value: isChecked ? 1 : 0 };
      const response = await sendDeviceCommand(config.device_id, payload);
      if (response && response.status === "failed") {
        setToggleState(!isChecked);
      } else {
        setToggleState(isChecked);
      }
    } catch {
      setToggleState(!isChecked);
    } finally {
      setPending(false);
    }
  };

  const handleSliderCommit = async (nextValue: number) => {
    const targetPin = outputPin || pwmPin;
    if (!targetPin && !config.provider) return; // If extension, still allow

    setPending(true);
    try {
      const payload = { kind: "action", pin: targetPin?.gpio_pin || 0, brightness: nextValue };
      await sendDeviceCommand(config.device_id, payload);
    } catch {
      // ignore
    } finally {
      setPending(false);
    }
  };

  const nameLower = config.name.toLowerCase();

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
          <div className="relative inline-block w-10 mr-2 align-middle select-none transition duration-200 ease-in mt-1">
            <input checked={toggleState} onChange={handleToggle} disabled={pending || !isOnline} className="toggle-checkbox absolute block w-5 h-5 rounded-full bg-white border-4 appearance-none cursor-pointer checked:right-0 checked:bg-primary right-5 border-slate-300 transition-all duration-300" id={`ext-${config.device_id}`} type="checkbox" />
            <label className="toggle-label block overflow-hidden h-5 rounded-full bg-slate-300 cursor-pointer checked:bg-primary" htmlFor={`ext-${config.device_id}`}></label>
          </div>
        </div>
        <div className="mb-5">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white truncate" title={config.name}>{config.name}</h3>
          <p className="text-xs text-slate-500 truncate" title="Extension Device">Extension Device</p>
        </div>
        <div className="mb-4">
          <div className="flex justify-between items-end mb-2">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Brightness</label>
            <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">{sliderValue}%</span>
          </div>
          <input
            type="range"
            className="w-full accent-primary h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer"
            min="0"
            max="100"
            value={sliderValue}
            disabled={pending || !isOnline}
            onChange={(e) => setSliderValue(parseInt(e.target.value))}
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
          <span className="text-3xl font-bold text-slate-800 dark:text-white">{config.last_state?.value ?? '--'}</span>
          <span className="text-lg font-medium text-slate-500">{isTemp ? '°C' : '%'}</span>
        </div>
        <div className={`mt-3 text-xs flex items-center ${isTemp ? 'text-green-600 dark:text-green-400' : 'text-slate-500 dark:text-slate-400'}`}>
          <span className="material-icons-round text-sm mr-1">{isTemp ? 'arrow_drop_up' : 'remove'}</span>
          {config.last_state?.trend || 'Stable'}
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
          <div className="relative inline-block w-10 mr-2 align-middle select-none transition duration-200 ease-in">
            <input checked={toggleState} onChange={handleToggle} disabled={pending || !isOnline} className="toggle-checkbox absolute block w-5 h-5 rounded-full bg-white border-4 appearance-none cursor-pointer checked:right-0 checked:bg-primary right-5 border-slate-300 transition-all duration-300" id={`dim-${config.device_id}`} type="checkbox" />
            <label className="toggle-label block overflow-hidden h-5 rounded-full bg-slate-300 cursor-pointer checked:bg-primary" htmlFor={`dim-${config.device_id}`}></label>
          </div>
        </div>
        <div className="mb-5">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white truncate" title={config.name}>{config.name}</h3>
          <p className="text-xs text-slate-500 truncate" title={config.board || 'Dimmer'}>{config.board || 'Dimmer'}</p>
        </div>
        <div className="mb-4">
          <div className="flex justify-between items-end mb-2">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Brightness</label>
            <span className="text-xs font-bold text-primary">{sliderValue}%</span>
          </div>
          <input
            type="range"
            className="w-full accent-primary h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer"
            min="0"
            max="100"
            value={sliderValue}
            disabled={pending || !isOnline}
            onChange={(e) => setSliderValue(parseInt(e.target.value))}
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
  const statusRight = nameLower.includes('lock') ? (toggleState ? 'Locked' : 'Unlocked') : (toggleState ? 'On' : 'Off');

  return (
    <div className={`bg-surface-light dark:bg-surface-dark rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm hover:shadow-md transition-shadow ${nameLower.includes('lock') ? '' : 'opacity-90'}`}>
      <div className="flex justify-between items-start mb-4">
        <div className={`h-10 w-10 rounded-full flex items-center justify-center ${colorClass}`}>
          <span className="material-icons-round">{Icon}</span>
        </div>
        <div className="relative inline-block w-10 mr-2 align-middle select-none transition duration-200 ease-in">
          <input checked={toggleState} onChange={handleToggle} disabled={pending || !isOnline} className="toggle-checkbox absolute block w-5 h-5 rounded-full bg-white border-4 appearance-none cursor-pointer checked:right-0 checked:bg-primary right-5 border-slate-300 transition-all duration-300" id={`sw-${config.device_id}`} type="checkbox" />
          <label className="toggle-label block overflow-hidden h-5 rounded-full bg-slate-300 cursor-pointer checked:bg-primary" htmlFor={`sw-${config.device_id}`}></label>
        </div>
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
