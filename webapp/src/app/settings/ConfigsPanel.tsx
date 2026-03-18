"use client";

import { useEffect, useState, useMemo } from "react";
import { getToken } from "@/lib/auth";
import { API_URL } from "@/lib/api";
import { resolveBoardProfileId } from "@/features/diy/board-profiles";
import { SvgPinMapPreview } from "./SvgPinMapPreview";
import type { PinMapping } from "@/features/diy/types";

type ConnStatus = "online" | "offline";
type AuthStatus = "pending" | "approved";

export interface ProjectDeviceUsage {
    device_id: string;
    name: string;
    conn_status: ConnStatus;
    auth_status: AuthStatus;
    room_id?: number | null;
    room_name?: string | null;
}

export interface DiyProjectUsageResponse {
    id: string;
    user_id: number;
    room_id?: number | null;
    name: string;
    board_profile: string;
    config?: Record<string, unknown> | null;
    created_at: string;
    updated_at: string;
    usage_state: "unused" | "in_use";
    devices: ProjectDeviceUsage[];
}

export function ConfigsPanel() {
    const [configs, setConfigs] = useState<DiyProjectUsageResponse[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [selectedConfig, setSelectedConfig] = useState<DiyProjectUsageResponse | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const [searchQuery, setSearchQuery] = useState("");
    const [filterType, setFilterType] = useState<"all" | "in_use" | "unused">("all");

    async function loadConfigs() {
        const token = getToken();
        if (!token) {
            setError("Missing session token. Please sign in again.");
            setLoading(false);
            return;
        }

        setLoading(true);
        setError("");

        try {
            const response = await fetch(`${API_URL}/diy/projects`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!response.ok) {
                throw new Error(`Failed to fetch configs: ${response.statusText}`);
            }
            const data = await response.json();
            setConfigs(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load DIY configs");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadConfigs();
    }, []);

    async function handleDelete(config: DiyProjectUsageResponse) {
        if (config.usage_state === "in_use") {
            setError(`Cannot delete ${config.name} because it is in use.`);
            return;
        }
        
        const token = getToken();
        if (!token) return;

        setDeletingId(config.id);
        setError("");
        setNotice("");

        try {
            const response = await fetch(`${API_URL}/diy/projects/${config.id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!response.ok) {
                const errData = await response.json().catch(() => null);
                const msg = errData?.detail?.message || "Failed to delete config";
                throw new Error(msg);
            }
            setNotice(`Successfully deleted config: ${config.name}`);
            setConfigs(prev => prev.filter(c => c.id !== config.id));
            if (selectedConfig?.id === config.id) {
                setSelectedConfig(null);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Delete failed");
        } finally {
            setDeletingId(null);
        }
    }

    const filteredConfigs = useMemo(() => {
        return configs.filter(config => {
            const matchesSearch = config.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                                  config.board_profile.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesFilter = filterType === "all" || config.usage_state === filterType;
            return matchesSearch && matchesFilter;
        });
    }, [configs, searchQuery, filterType]);

    if (loading) {
        return (
            <div className="flex h-32 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="mb-4">
                <h2 className="text-xl flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                    Manage Saved Configs
                </h2>
                <p className="text-sm text-slate-500">View, search, and delete your DIY device configurations.</p>
            </div>

            {error && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                    {error}
                </div>
            )}
            {notice && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                    {notice}
                </div>
            )}

            <section className="flex flex-col md:flex-row gap-4 items-center justify-between">
                <div className="w-full md:max-w-md relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">search</span>
                    <input 
                        className="w-full pl-10 pr-4 py-2 bg-slate-100 dark:bg-slate-800 border-none rounded-lg focus:ring-2 focus:ring-primary text-sm dark:text-slate-100" 
                        placeholder="Search configurations..." 
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                </div>
                <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-2 md:pb-0">
                    <button onClick={() => setFilterType("all")} className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${filterType === "all" ? "bg-primary text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"}`}>All</button>
                    <button onClick={() => setFilterType("in_use")} className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${filterType === "in_use" ? "bg-primary text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"}`}>In Use</button>
                    <button onClick={() => setFilterType("unused")} className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${filterType === "unused" ? "bg-primary text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"}`}>Unused</button>
                </div>
            </section>

            {configs.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center dark:border-slate-800 dark:bg-slate-900/50">
                    <span className="material-symbols-outlined mb-2 text-4xl text-slate-400">inventory_2</span>
                    <h3 className="text-lg font-medium text-slate-900 dark:text-white">No configurations found</h3>
                    <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                        Build and save a DIY device configuration first.
                    </p>
                </div>
            ) : filteredConfigs.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center dark:border-slate-800 dark:bg-slate-900/50">
                    <span className="material-symbols-outlined mb-2 text-4xl text-slate-400">search_off</span>
                    <h3 className="text-lg font-medium text-slate-900 dark:text-white">No matching configurations</h3>
                    <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                        Try adjusting your search or filters.
                    </p>
                </div>
            ) : (
                <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredConfigs.map(config => (
                        <div 
                            key={config.id} 
                            onClick={() => setSelectedConfig(config)} 
                            className={`bg-white dark:bg-slate-900 border ${selectedConfig?.id === config.id ? 'border-primary ring-2 ring-primary/50' : 'border-slate-200 dark:border-slate-800'} p-5 rounded-lg flex flex-col gap-4 transition-all group cursor-pointer hover:border-primary/50 opacity-100`}
                        >
                            <div className="flex justify-between items-start">
                                <div className="space-y-1 max-w-[calc(100%-40px)]">
                                    <div className="flex items-center gap-2">
                                        <h3 className="font-bold text-lg truncate text-slate-900 dark:text-white" title={config.name}>{config.name}</h3>
                                        <span className={config.usage_state === "in_use" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full border border-emerald-500/20 whitespace-nowrap shrink-0" : "bg-slate-500/10 text-slate-600 dark:text-slate-400 text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full border border-slate-500/20 whitespace-nowrap shrink-0"}>
                                            {config.usage_state === "in_use" ? "In Use" : "Unused"}
                                        </span>
                                    </div>
                                    <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1">
                                        <span className="material-symbols-outlined text-[16px]">memory</span>
                                        {config.board_profile}
                                    </p>
                                </div>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); handleDelete(config); }}
                                    disabled={config.usage_state === "in_use" || deletingId === config.id}
                                    className={config.usage_state === "in_use" ? "text-slate-300 dark:text-slate-700 cursor-not-allowed group/info relative shrink-0 p-1" : "text-slate-400 hover:text-rose-500 transition-colors shrink-0 p-1 bg-transparent border-0 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-full"} 
                                    title={config.usage_state === "in_use" ? "Active configurations cannot be deleted" : "Delete unused config"}>
                                    <span className="material-symbols-outlined text-[20px] leading-none">{deletingId === config.id ? "hourglass_empty" : "delete"}</span>
                                    {config.usage_state === "in_use" && <span className="material-symbols-outlined absolute top-[-4px] right-[-4px] text-[12px] bg-slate-800 text-white rounded-full leading-none fill-icon">lock</span>}
                                </button>
                            </div>
                            
                            {config.usage_state === "in_use" ? (
                                <div className="flex items-center gap-3 py-3 px-4 bg-primary/5 dark:bg-primary/10 rounded-lg">
                                    <span className="text-sm font-medium text-primary">{config.devices.length} {config.devices.length === 1 ? 'Device' : 'Devices'} Connected</span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-3 py-3 px-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                                    <span className="text-sm text-slate-400 dark:text-slate-500 italic">No devices currently using this profile</span>
                                </div>
                            )}

                            <div className="flex justify-between items-center mt-auto pt-2 border-t border-slate-100 dark:border-slate-800">
                                <span className="text-xs text-slate-400">Created: {new Date(config.created_at).toLocaleDateString()}</span>
                                <button className="text-primary text-sm font-semibold flex items-center gap-1 hover:text-primary/80 transition-colors">
                                    Details <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                                </button>
                            </div>
                        </div>
                    ))}
                </section>
            )}

            {selectedConfig && (
                <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden shadow-xl mt-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                    <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/30">
                        <div>
                            <h2 className="text-lg font-bold text-slate-900 dark:text-white">{selectedConfig.name}</h2>
                            <p className="text-sm text-slate-500">Configuration Details & Associated Devices</p>
                        </div>
                        <button onClick={() => setSelectedConfig(null)} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 rounded-full transition-colors">
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>
                    
                    <div className="p-6 grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-8">
                        <div className="space-y-4">
                            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">Board Pin Mapping</h3>
                            <div className="mt-2 w-full max-h-[460px] overflow-y-auto custom-scrollbar border border-slate-200 dark:border-slate-800 rounded-lg">
                                <SvgPinMapPreview 
                                    boardId={
                                        resolveBoardProfileId(
                                            (selectedConfig.config?.board_id as string)
                                            || (selectedConfig.config?.board as string)
                                            || selectedConfig.board_profile,
                                        ) || "esp32-c3-super-mini"
                                    } 
                                    pins={(selectedConfig.config?.pins as PinMapping[]) || []} 
                                />
                            </div>
                            <div className="flex gap-2 mt-4">
                                <button 
                                    onClick={() => navigator.clipboard.writeText(JSON.stringify(selectedConfig.config, null, 2))} 
                                    className="flex-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                                >
                                    <span className="material-symbols-outlined text-[18px]">content_copy</span> Copy Raw JSON Config
                                </button>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">Associated Devices ({selectedConfig.devices.length})</h3>
                            {selectedConfig.devices.length === 0 ? (
                                <p className="text-sm text-slate-500 italic">No associated devices</p>
                            ) : (
                                <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                                    {selectedConfig.devices.map(device => (
                                        <div key={device.device_id} className={`flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-transparent hover:border-primary/30 transition-all ${device.conn_status === "offline" ? "opacity-75" : ""}`}>
                                            <div className="flex items-center gap-3 max-w-[60%]">
                                                <div className={`w-2 h-2 shrink-0 rounded-full ${device.conn_status === "online" ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-slate-400"}`}></div>
                                                <div className="truncate w-full text-slate-900 dark:text-white">
                                                    <p className="text-sm font-semibold truncate" title={device.name}>{device.name}</p>
                                                    <p className="text-[10px] text-slate-500 truncate" title={device.device_id}>ID: {device.device_id}</p>
                                                </div>
                                            </div>
                                            <div className="text-right flex flex-col items-end">
                                                <span className={`block text-[10px] font-bold uppercase ${device.auth_status === "pending" ? "text-amber-500" : "text-emerald-500"}`}>{device.auth_status}</span>
                                                <span className="text-[10px] text-slate-400 italic">{device.conn_status}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </section>
            )}
        </div>
    );
}
