"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DeviceConfig } from "@/types/device";
import { API_URL } from "@/lib/api";

export default function DeviceDiscovery() {
    const [scanState, setScanState] = useState<'idle' | 'scanning' | 'found'>('scanning');
    const [pendingDevices, setPendingDevices] = useState<DeviceConfig[]>([]);
    const [approving, setApproving] = useState(false);
    const router = useRouter();

    useEffect(() => {
        // Fetch pending devices
        async function fetchPending() {
            try {
                const token = localStorage.getItem("econnect_token");
                const res = await fetch(`${API_URL}/devices`, {
                    headers: { "Authorization": `Bearer ${token}` }
                });
                if (res.ok) {
                    const data: DeviceConfig[] = await res.json();
                    const inactive = data.filter((d) => d.auth_status === "pending");
                    if (inactive.length > 0) {
                        setPendingDevices(inactive as DeviceConfig[]);
                        setScanState('found');
                    } else if (scanState === 'scanning') {
                        setTimeout(() => setScanState('idle'), 3000);
                    }
                }
            } catch (e) {
                console.error("Failed to fetch devices", e);
                if (scanState === 'scanning') setScanState('idle');
            }
        }
        fetchPending();
    }, [scanState]);

    const approveDevice = async (deviceId: string) => {
        setApproving(true);
        try {
            const token = localStorage.getItem("econnect_token");
            const res = await fetch(`${API_URL}/device/${deviceId}/approve`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (res.ok) {
                router.push("/");
            } else {
                alert("Failed to approve device.");
            }
        } catch (e) {
            console.error(e);
        } finally {
            setApproving(false);
        }
    };

    return (
        <div className="flex bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 min-h-screen font-sans">
            {/* Sidebar Placeholder (Minimized for pairing focus) */}
            <aside className="w-20 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col items-center py-6 hidden md:flex z-20">
                <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 mb-8 border border-blue-100 dark:border-blue-800">
                    <span className="material-icons-round text-2xl">hub</span>
                </div>
                <nav className="flex flex-col space-y-4">
                    <button onClick={() => router.push('/')} className="w-12 h-12 rounded-xl text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-all">
                        <span className="material-icons-round">arrow_back</span>
                    </button>
                    <button className="w-12 h-12 rounded-xl text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-all" title="Settings">
                        <span className="material-icons-round">settings</span>
                    </button>
                </nav>
            </aside>

            {/* Main Discovery Area */}
            <main className="flex-1 flex items-center justify-center p-6 relative overflow-hidden">

                {/* Background Radar Animation (Only active when scanning) */}
                {scanState === 'scanning' && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-40 dark:opacity-20 z-0">
                        <div className="absolute w-[800px] h-[800px] rounded-full border border-blue-200 dark:border-blue-800/30 scale-0 animate-[ping_4s_cubic-bezier(0,0,0.2,1)_infinite]"></div>
                        <div className="absolute w-[600px] h-[600px] rounded-full border border-blue-300 dark:border-blue-700/40 scale-0 animate-[ping_4s_cubic-bezier(0,0,0.2,1)_infinite_1s]"></div>
                        <div className="absolute w-[400px] h-[400px] rounded-full border border-blue-400 dark:border-blue-600/50 scale-0 animate-[ping_4s_cubic-bezier(0,0,0.2,1)_infinite_2s]"></div>
                    </div>
                )}

                {/* Pairing Modal Card */}
                <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-[0_20px_50px_-12px_rgba(0,0,0,0.1)] dark:shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5)] border border-slate-100 dark:border-slate-800 z-10 overflow-hidden relative transition-all duration-500 transform translate-y-0 opacity-100">

                    {/* Header */}
                    <div className="px-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between pb-4 pt-6 bg-slate-50/50 dark:bg-slate-900/50 backdrop-blur-md">
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center">
                            {scanState === 'scanning' ? (
                                <><span className="material-icons-round text-blue-500 mr-2 animate-spin-slow">radar</span> Scanning Network</>
                            ) : (
                                <><span className="material-icons-round text-green-500 mr-2">check_circle</span> Device Found</>
                            )}
                        </h2>
                        <button onClick={() => router.push('/')} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                            <span className="material-icons-round">close</span>
                        </button>
                    </div>

                    {/* Content Area */}
                    <div className="p-6">

                        {/* Scanning State */}
                        {scanState === 'scanning' && (
                            <div className="text-center py-8">
                                <div className="relative w-24 h-24 mx-auto mb-6">
                                    <div className="absolute inset-0 bg-blue-100 dark:bg-blue-900/40 rounded-full animate-ping opacity-75"></div>
                                    <div className="relative w-24 h-24 bg-white dark:bg-slate-800 rounded-full flex items-center justify-center border-4 border-blue-50 dark:border-slate-700 z-10 shadow-sm">
                                        <span className="material-icons-round text-4xl text-blue-500 animate-pulse">wifi_tethering</span>
                                    </div>
                                </div>
                                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-2">Looking for E-Connect Devices...</h3>
                                <p className="text-sm text-slate-500 dark:text-slate-400">Ensure your new device is powered on and in pairing mode (LED blinking blue).</p>

                                <div className="mt-8 flex justify-center">
                                    <button
                                        onClick={() => setScanState('idle')}
                                        className="text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 px-4 py-2 rounded-lg transition-colors border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
                                    >
                                        Cancel Scan
                                    </button>
                                </div>
                            </div>
                        )}
                        {/* Found State */}
                        {scanState === 'found' && pendingDevices.length > 0 && (
                            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">

                                {/* Device Visual / Icon */}
                                <div className="flex justify-center mb-6">
                                    <div className="relative group">
                                        <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full blur opacity-25 group-hover:opacity-40 transition duration-1000 group-hover:duration-200"></div>
                                        <div className="relative w-24 h-24 bg-white dark:bg-slate-800 rounded-full flex flex-col items-center justify-center border-2 border-blue-100 dark:border-slate-700 shadow-md">
                                            <span className="material-icons-round text-4xl text-slate-700 dark:text-slate-300">developer_board</span>
                                            <span className="absolute bottom-2 right-2 w-4 h-4 bg-green-500 border-2 border-white dark:border-slate-800 rounded-full"></span>
                                        </div>
                                    </div>
                                </div>

                                <div className="text-center mb-6">
                                    <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 mb-3 border border-blue-200/50 dark:border-blue-800/50">
                                        Pending Approval
                                    </div>
                                    <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">{pendingDevices[0].name || "Unknown Device"}</h3>
                                    <p className="text-sm text-slate-500 dark:text-slate-400">UUID: {pendingDevices[0].device_id}</p>
                                </div>

                                {/* Quick Details Card */}
                                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 mb-6 border border-slate-100 dark:border-slate-700/50">
                                    <div className="flex justify-between items-center mb-3 pb-3 border-b border-slate-200 dark:border-slate-700/50">
                                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">MAC Address</span>
                                        <span className="text-sm font-mono text-slate-700 dark:text-slate-300">{pendingDevices[0].mac_address || "N/A"}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Board Mode</span>
                                        <div className="flex items-center text-sm font-semibold text-slate-700 dark:text-slate-300">
                                            {pendingDevices[0].mode || "LIBRARY"}
                                        </div>
                                    </div>
                                </div>

                                {/* Setup Actions */}
                                <div className="space-y-3">
                                    <button
                                        onClick={() => approveDevice(pendingDevices[0].device_id)}
                                        disabled={approving}
                                        className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 px-4 rounded-xl shadow-[0_4px_14px_0_rgba(37,99,235,0.39)] transition-all flex items-center justify-center group"
                                    >
                                        <span className="material-icons-round mr-2">verified</span>
                                        {approving ? "Approving..." : "Approve & Provision Widgets"}
                                    </button>

                                    <button onClick={() => setScanState('idle')} className="w-full bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium py-3 px-4 rounded-xl border border-slate-200 dark:border-slate-700 transition-colors flex items-center justify-center">
                                        Ignore
                                    </button>
                                </div>

                            </div>
                        )}

                        {/* Idle/Error State */}
                        {scanState === 'idle' && (
                            <div className="text-center py-8">
                                <span className="material-icons-round text-5xl text-slate-300 dark:text-slate-600 mb-4">search_off</span>
                                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-2">No New Devices</h3>
                                <div className="flex flex-col gap-3 mt-4 w-full">
                                    <button onClick={() => setScanState('scanning')} className="w-full bg-blue-100 text-blue-700 px-6 py-3 rounded-lg font-medium shadow-sm hover:bg-blue-200 transition-colors flex items-center justify-center">
                                        <span className="material-icons-round mr-2">search</span> Rescan Network
                                    </button>
                                    <button onClick={() => router.push('/devices/diy')} className="w-full bg-primary text-white px-6 py-3 rounded-lg font-medium shadow-sm hover:bg-blue-600 transition-colors flex items-center justify-center">
                                        <span className="material-icons-round mr-2">memory</span> Create DIY Firmware
                                    </button>
                                </div>
                            </div>
                        )}

                    </div>

                    {/* Bottom Status Bar */}
                    <div className="bg-slate-50 dark:bg-slate-900/80 px-6 py-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-400 dark:text-slate-500 font-medium flex justify-between items-center">
                        <span className="flex items-center"><span className="material-icons-round text-[14px] text-green-500 mr-1.5">shield</span> Secure Local Provisioning</span>
                        <span>mDNS Broadcast</span>
                    </div>
                </div>

            </main>
        </div>
    );
}
