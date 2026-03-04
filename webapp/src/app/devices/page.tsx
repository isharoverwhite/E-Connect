"use client";

import { useState, useEffect } from "react";
import { fetchDevices, deleteDevice } from "@/lib/api";
import { DeviceConfig } from "@/types/device";
import { useAuth } from "@/components/AuthProvider";
import Link from "next/link";

export default function DevicesPage() {
    const { user, logout } = useAuth();
    const [devices, setDevices] = useState<DeviceConfig[]>([]);
    const [loading, setLoading] = useState(true);
    const [isDeleting, setIsDeleting] = useState<string | null>(null);

    async function loadDevices() {
        const data = await fetchDevices();
        setDevices(data);
        setLoading(false);
    }

    const handleRefresh = () => {
        setLoading(true);
        void loadDevices();
    };

    useEffect(() => {
        let cancelled = false;

        void fetchDevices().then((data) => {
            if (cancelled) {
                return;
            }
            setDevices(data);
            setLoading(false);
        });

        return () => {
            cancelled = true;
        };
    }, []);

    const handleDelete = async (deviceId: string, deviceName: string) => {
        if (!window.confirm(`Are you sure you want to delete "${deviceName}"? This action cannot be undone.`)) {
            return;
        }

        setIsDeleting(deviceId);
        const success = await deleteDevice(deviceId);

        if (success) {
            setDevices(prev => prev.filter(d => d.device_id !== deviceId));
        } else {
            alert("Failed to delete device. You might not have permission.");
        }
        setIsDeleting(null);
    };

    return (
        <div className="flex h-screen w-full bg-background-light dark:bg-background-dark overflow-hidden font-sans text-slate-800 dark:text-slate-200 selection:bg-primary selection:text-white transition-colors duration-300">
            {/* Sidebar - Reused from Dashboard */}
            <aside className="w-64 bg-surface-light dark:bg-surface-dark border-r border-slate-200 dark:border-slate-700 flex flex-col justify-between hidden md:flex z-20 shadow-lg">
                <div>
                    <div className="h-16 flex items-center px-6 border-b border-slate-200 dark:border-slate-700">
                        <span className="material-icons-round text-primary mr-2 text-3xl">hub</span>
                        <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">E-Connect</span>
                    </div>

                    <nav className="p-4 space-y-1">
                        <Link href="/" className="flex items-center px-4 py-3 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors">
                            <span className="material-icons-round mr-3">dashboard</span>
                            Dashboard
                        </Link>
                        <Link href="/devices" className="flex items-center px-4 py-3 bg-primary/10 text-primary font-medium rounded-lg transition-colors">
                            <span className="material-icons-round mr-3">devices_other</span>
                            Devices
                        </Link>
                        <Link href="/automation" className="flex items-center px-4 py-3 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors">
                            <span className="material-icons-round mr-3">precision_manufacturing</span>
                            Automation
                        </Link>
                        <Link href="/logs" className="flex items-center px-4 py-3 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors">
                            <span className="material-icons-round mr-3">analytics</span>
                            Logs & Stats
                        </Link>
                        <Link href="/extensions" className="flex items-center px-4 py-3 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors">
                            <span className="material-icons-round mr-3">extension</span>
                            Extensions
                        </Link>
                    </nav>
                </div>

                <div className="p-4 border-t border-slate-200 dark:border-slate-700">
                    <Link href="/settings" className="flex items-center px-4 py-3 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors mb-2">
                        <span className="material-icons-round mr-3">settings</span>
                        Settings
                    </Link>
                    <div className="flex items-center px-4 py-3 justify-between group">
                        <div className="flex items-center">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary to-purple-500 flex items-center justify-center text-white font-bold text-xs uppercase">
                                {user?.fullname?.substring(0, 2) || 'EC'}
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

            {/* Main Content */}
            <main className="flex-1 flex flex-col min-w-0 relative">
                <header className="h-16 bg-surface-light dark:bg-surface-dark border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-6 shadow-sm z-30">
                    <h1 className="text-lg font-semibold text-slate-800 dark:text-white">Device Management</h1>

                    <div className="flex gap-3">
                        <Link href="/devices/diy" className="flex items-center bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-600 transition-all shadow-md hover:shadow-lg">
                            <span className="material-icons-round text-sm mr-2">hardware</span>
                            SVG Builder
                        </Link>
                        <Link href="/devices/discovery" className="flex items-center bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-all shadow-sm">
                            <span className="material-icons-round text-sm mr-2">wifi_tethering</span>
                            Discover New
                        </Link>
                        <button onClick={handleRefresh} className="flex items-center bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-600 transition-all shadow-md hover:shadow-lg">
                            <span className="material-icons-round text-sm mr-2">refresh</span>
                            Refresh
                        </button>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto p-6 scroll-smooth bg-slate-50/50 dark:bg-background-dark">
                    <div className="max-w-7xl mx-auto w-full">

                        {/* Page Header Info */}
                        <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center">
                            <div>
                                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Your Ecosystem</h2>
                                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Manage and configure all connected nodes within your network.</p>
                            </div>
                            <div className="mt-4 sm:mt-0 text-sm font-medium text-slate-600 dark:text-slate-300">
                                Total: {loading ? "..." : devices.length} Devices
                            </div>
                        </div>

                        {loading ? (
                            <div className="w-full flex justify-center py-20">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                            </div>
                        ) : devices.length === 0 ? (
                            <div className="text-center py-20 bg-surface-light dark:bg-surface-dark rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm border-dashed">
                                <div className="w-16 h-16 bg-blue-50 dark:bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <span className="material-icons-round text-primary text-3xl">router</span>
                                </div>
                                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">No devices found</h3>
                                <p className="text-slate-500 dark:text-slate-400 text-sm max-w-sm mx-auto mb-6">Start with the SVG builder for ESP32-family boards or use discovery for already provisioned nodes.</p>
                                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                                    <Link href="/devices/diy" className="flex items-center justify-center bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-600 transition-all shadow-md hover:shadow-lg min-w-44">
                                        <span className="material-icons-round text-sm mr-2">hardware</span>
                                        Configure via SVG
                                    </Link>
                                    <Link href="/devices/discovery" className="flex items-center justify-center bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-all shadow-sm min-w-44">
                                        <span className="material-icons-round text-sm mr-2">wifi_tethering</span>
                                        Discover Existing Device
                                    </Link>
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {devices.map((dev) => {
                                    const isOnline = dev.conn_status === "online";
                                    const modeColor = dev.mode === 'no-code' ? 'text-purple-500 bg-purple-50 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/20' : 'text-blue-500 bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20';

                                    return (
                                        <div key={dev.device_id} className="bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden hover:shadow-md transition-shadow group flex flex-col">
                                            {/* Card Header */}
                                            <div className="p-5 flex items-start justify-between border-b border-slate-100 dark:border-slate-700/50">
                                                <div className="flex items-center gap-3 w-full">
                                                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isOnline ? 'bg-primary/10 text-primary' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
                                                        <span className="material-icons-round">{dev.mode === 'no-code' ? 'extension' : 'developer_board'}</span>
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <h3 className="font-semibold text-slate-900 dark:text-white truncate" title={dev.name}>{dev.name}</h3>
                                                        <div className="flex items-center mt-1">
                                                            <span className={`w-2 h-2 rounded-full mr-1.5 ${isOnline ? 'bg-green-500' : 'bg-red-400'}`}></span>
                                                            <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{isOnline ? 'Online' : 'Offline'}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Card Body Specs */}
                                            <div className="p-5 flex-1 text-sm space-y-3">
                                                <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-700/50 pb-2 border-dashed">
                                                    <span className="text-slate-500 dark:text-slate-400"><span className="material-icons-round text-xs align-text-bottom mr-1">fingerprint</span> MAC</span>
                                                    <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{dev.mac_address || "N/A"}</span>
                                                </div>
                                                <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-700/50 pb-2 border-dashed">
                                                    <span className="text-slate-500 dark:text-slate-400"><span className="material-icons-round text-xs align-text-bottom mr-1">settings_ethernet</span> Mode</span>
                                                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${modeColor} tracking-wide`}>
                                                        {dev.mode}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-slate-500 dark:text-slate-400"><span className="material-icons-round text-xs align-text-bottom mr-1">memory</span> Pins Used</span>
                                                    <span className="text-slate-700 dark:text-slate-300 font-medium">{dev.pin_configurations?.length || 0} Maps</span>
                                                </div>
                                            </div>

                                            {/* Action Buttons */}
                                            <div className="bg-slate-50 dark:bg-slate-800/50 p-3 grid grid-cols-2 gap-2 border-t border-slate-100 dark:border-slate-700">
                                                <Link
                                                    href={`/devices/${dev.device_id}/config`}
                                                    className="flex items-center justify-center py-2 px-3 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-slate-600 transition-colors shadow-sm"
                                                >
                                                    <span className="material-icons-round text-sm mr-1.5 text-blue-500">app_registration</span> Configure
                                                </Link>

                                                <button
                                                    onClick={() => handleDelete(dev.device_id, dev.name)}
                                                    disabled={isDeleting === dev.device_id}
                                                    className="flex items-center justify-center py-2 px-3 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 hover:border-red-200 dark:hover:border-red-500/30 transition-colors shadow-sm disabled:opacity-50"
                                                >
                                                    {isDeleting === dev.device_id ? (
                                                        <span className="material-icons-round text-sm animate-spin">refresh</span>
                                                    ) : (
                                                        <><span className="material-icons-round text-sm mr-1.5">delete_outline</span> Remove</>
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}
