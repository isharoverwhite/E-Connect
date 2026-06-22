/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useLanguage } from "@/components/LanguageContext";
import { getToken } from "@/lib/auth";
import { API_URL, fetchProjectConfigHistory, type DeviceConfigHistoryEntry } from "@/lib/api";
import { getProjectBoardProfileLabel, getProjectBoardTypeLabel, resolveProjectBoardProfileId } from "@/features/diy/project-board";
import { SvgPinMapPreview } from "./SvgPinMapPreview";
import type { PinMapping } from "@/features/diy/types";
import { formatServerTimestamp } from "@/lib/server-time";
import { motion, AnimatePresence } from "framer-motion";

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

export function ConfigsPanel({ timezone }: { timezone?: string | null }) {
    const { user } = useAuth();
    const { t } = useLanguage();
    const [configs, setConfigs] = useState<DiyProjectUsageResponse[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [selectedConfig, setSelectedConfig] = useState<DiyProjectUsageResponse | null>(null);
    const [selectedConfigHistory, setSelectedConfigHistory] = useState<DeviceConfigHistoryEntry[]>([]);
    const [activeHistoryVersion, setActiveHistoryVersion] = useState<DeviceConfigHistoryEntry | null>(null);
    const [historyLoading, setHistoryLoading] = useState(false);
    
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<DiyProjectUsageResponse | null>(null);
    const [deletePassword, setDeletePassword] = useState("");
    const [deleteModalError, setDeleteModalError] = useState("");

    const [searchQuery, setSearchQuery] = useState("");
    const [filterType, setFilterType] = useState<"all" | "in_use" | "unused">("all");

    useEffect(() => {
        if (!selectedConfig) {
            setSelectedConfigHistory([]);
            setActiveHistoryVersion(null);
            return;
        }
        
        let isCancelled = false;
        setHistoryLoading(true);
        fetchProjectConfigHistory(selectedConfig.id)
            .then(history => {
                if (isCancelled) return;
                setSelectedConfigHistory(history);
                if (history.length > 0) {
                    setActiveHistoryVersion(history[0]);
                } else {
                    setActiveHistoryVersion(null);
                }
            })
            .catch(err => console.error("Failed to fetch project history", err))
            .finally(() => {
                if (!isCancelled) setHistoryLoading(false);
            });
            
        return () => { isCancelled = true; };
    }, [selectedConfig]);

    async function loadConfigs() {
        const token = getToken();
        if (!token) {
            setError(t("settings.error.missing_token"));
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
            setError(err instanceof Error ? err.message : t("settings.error.load_configs"));
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadConfigs();
    }, []);

    function openDeleteModal(config: DiyProjectUsageResponse) {
        if (config.usage_state === "in_use") {
            setError(t("settings.error.delete_in_use").replace("{name}", config.name));
            return;
        }

        setDeleteTarget(config);
        setDeletePassword("");
        setDeleteModalError("");
        setError("");
        setNotice("");
    }

    function closeDeleteModal(force = false) {
        if (deletingId && !force) {
            return;
        }

        setDeleteTarget(null);
        setDeletePassword("");
        setDeleteModalError("");
    }

    async function handleDelete() {
        const config = deleteTarget;
        if (!config) {
            return;
        }

        if (!deletePassword.trim()) {
            setDeleteModalError(t("settings.error.delete_password_req"));
            return;
        }

        const token = getToken();
        if (!token) return;

        setDeletingId(config.id);
        setDeleteModalError("");

        try {
            const response = await fetch(`${API_URL}/diy/projects/${config.id}`, {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ password: deletePassword }),
            });
            if (!response.ok) {
                const errData = await response.json().catch(() => null);
                const msg = errData?.detail?.message || t("settings.error.delete_config");
                throw new Error(msg);
            }
            setNotice(t("settings.toast.config_deleted").replace("{name}", config.name));
            setConfigs(prev => prev.filter(c => c.id !== config.id));
            if (selectedConfig?.id === config.id) {
                setSelectedConfig(null);
            }
            closeDeleteModal(true);
        } catch (err) {
            setDeleteModalError(err instanceof Error ? err.message : t("settings.error.delete_config"));
        } finally {
            setDeletingId(null);
        }
    }

    const filteredConfigs = useMemo(() => {
        return configs.filter(config => {
            const boardTypeLabel = getProjectBoardTypeLabel(config).toLowerCase();
            const boardProfileLabel = getProjectBoardProfileLabel(config).toLowerCase();
            const matchesSearch = config.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                  boardTypeLabel.includes(searchQuery.toLowerCase()) ||
                                  boardProfileLabel.includes(searchQuery.toLowerCase()) ||
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
                    {t("settings.configs.title")}
                </h2>
                <p className="text-sm text-slate-500">{t("settings.configs.desc")}</p>
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
                        autoComplete="off"
                        className="w-full pl-10 pr-4 py-2 bg-slate-100 dark:bg-slate-800 border-none rounded-lg focus:ring-2 focus:ring-primary text-sm dark:text-slate-100" 
                        id="config-search"
                        name="config-search"
                        placeholder={t("settings.configs.search_placeholder")} 
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                </div>
                <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-2 md:pb-0">
                    <button onClick={() => setFilterType("all")} className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${filterType === "all" ? "bg-primary text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"}`}>{t("settings.configs.filter_all")}</button>
                    <button onClick={() => setFilterType("in_use")} className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${filterType === "in_use" ? "bg-primary text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"}`}>{t("settings.configs.filter_in_use")}</button>
                    <button onClick={() => setFilterType("unused")} className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${filterType === "unused" ? "bg-primary text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"}`}>{t("settings.configs.filter_unused")}</button>
                </div>
            </section>

            {configs.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center dark:border-slate-800 dark:bg-slate-900/50">
                    <span className="material-symbols-outlined mb-2 text-4xl text-slate-400">inventory_2</span>
                    <h3 className="text-lg font-medium text-slate-900 dark:text-white">{t("settings.configs.empty_title")}</h3>
                    <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                        {t("settings.configs.empty_desc")}
                    </p>
                </div>
            ) : filteredConfigs.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center dark:border-slate-800 dark:bg-slate-900/50">
                    <span className="material-symbols-outlined mb-2 text-4xl text-slate-400">search_off</span>
                    <h3 className="text-lg font-medium text-slate-900 dark:text-white">{t("settings.configs.no_match_title")}</h3>
                    <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                        {t("settings.configs.no_match_desc")}
                    </p>
                </div>
            ) : (
                <motion.div layout transition={{ type: "spring", stiffness: 350, damping: 30 }} className="flex flex-col lg:flex-row gap-6 items-start">
                    {/* Side Menu / Grid Menu */}
                    <motion.aside 
                        layout
                        transition={{ type: "spring", stiffness: 350, damping: 30 }}
                        className={`w-full shrink-0 ${selectedConfig ? 'lg:w-80 grid grid-cols-1 gap-3 max-h-[80vh] overflow-y-auto custom-scrollbar pr-2 pb-4' : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'}`}
                    >
                        <AnimatePresence>
                            {filteredConfigs.map(config => {
                                const boardTypeLabel = getProjectBoardTypeLabel(config);
                                const boardProfileLabel = getProjectBoardProfileLabel(config);
                                const isSelected = selectedConfig?.id === config.id;

                                return (
                                        <motion.div 
                                            layout
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            transition={{ type: "spring", stiffness: 350, damping: 30 }}
                                            key={config.id} 
                                            onClick={() => setSelectedConfig(config)} 
                                            className={`bg-white dark:bg-slate-900 border transition-colors cursor-pointer hover:border-primary/50 flex flex-col overflow-hidden ${selectedConfig ? 'p-4 rounded-lg gap-3' : 'p-5 rounded-lg gap-4'} ${isSelected ? 'border-primary ring-1 ring-primary/50 shadow-sm bg-primary/5 dark:bg-primary/10' : 'border-slate-200 dark:border-slate-800'}`}
                                        >
                                            <motion.div layout="position" className="flex justify-between items-start gap-2">
                                                <div className={`space-y-1 max-w-[calc(100%-40px)]`}>
                                                    <div className="flex items-center gap-2">
                                                        <motion.h3 layout="position" className={`font-bold truncate text-slate-900 dark:text-white ${selectedConfig ? 'text-sm' : 'text-lg'}`} title={config.name}>{config.name}</motion.h3>
                                                        <motion.span layout="position" className={config.usage_state === "in_use" ? `bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-full border border-emerald-500/20 whitespace-nowrap shrink-0 ${selectedConfig ? 'text-[9px]' : 'text-[10px]'}` : `bg-slate-500/10 text-slate-600 dark:text-slate-400 uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-full border border-slate-500/20 whitespace-nowrap shrink-0 ${selectedConfig ? 'text-[9px]' : 'text-[10px]'}`}>
                                                            {config.usage_state === "in_use" ? t("settings.configs.status_in_use") : t("settings.configs.status_unused")}
                                                        </motion.span>
                                                    </div>
                                                    <motion.p layout="position" className={`text-slate-500 dark:text-slate-400 flex items-center gap-1 ${selectedConfig ? 'text-xs' : 'text-sm'}`}>
                                                        <span className="material-symbols-outlined text-[14px]">memory</span>
                                                        <span className="truncate" title={boardTypeLabel}>{boardTypeLabel}</span>
                                                    </motion.p>
                                                    {!selectedConfig && (
                                                        <motion.p layout="position" className="text-xs text-slate-400 dark:text-slate-500">
                                                            {t("settings.configs.card_profile").replace("{profile}", boardProfileLabel)}
                                                        </motion.p>
                                                    )}
                                            </div>
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); openDeleteModal(config); }}
                                                disabled={config.usage_state === "in_use" || deletingId === config.id}
                                                className={config.usage_state === "in_use" ? "text-slate-300 dark:text-slate-700 cursor-not-allowed shrink-0 p-1" : "text-slate-400 hover:text-rose-500 transition-colors shrink-0 p-1 bg-transparent border-0 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-full"}
                                                title={config.usage_state === "in_use" ? t("settings.configs.active_cannot_delete") : t("settings.configs.btn_delete_unused")}>
                                                {config.usage_state === "in_use" ? (
                                                    <span className="material-symbols-outlined text-[16px] leading-none">lock</span>
                                                ) : (
                                                    <span className="material-symbols-outlined text-[16px] leading-none">{deletingId === config.id ? "hourglass_empty" : "delete"}</span>
                                                )}
                                            </button>
                                        </motion.div>
                                        
                                        {!selectedConfig && (
                                            <>
                                                {config.usage_state === "in_use" ? (
                                                    <div className="flex items-center gap-3 py-3 px-4 bg-primary/5 dark:bg-primary/10 rounded-lg">
                                                        <span className="text-sm font-medium text-primary">
                                                            {config.devices.length === 1 ? t("settings.configs.assigned_count_single") : t("settings.configs.assigned_count_plural").replace("{count}", config.devices.length.toString())}
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-3 py-3 px-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                                                        <span className="text-sm text-slate-400 dark:text-slate-500 italic">{t("settings.configs.no_boards_assigned")}</span>
                                                    </div>
                                                )}

                                                <div className="flex justify-between items-center mt-auto pt-2 border-t border-slate-100 dark:border-slate-800">
                                                    <span className="text-xs text-slate-400">{t("settings.configs.created_date").replace("{date}", formatServerTimestamp(config.created_at, {
                                                        fallback: "Unknown date",
                                                        options: {
                                                            year: "numeric",
                                                            month: "short",
                                                            day: "numeric",
                                                        },
                                                        timezone,
                                                    }))}</span>
                                                    <button className="text-primary text-sm font-semibold flex items-center gap-1 hover:text-primary/80 transition-colors">
                                                        {t("settings.configs.btn_details")} <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>
                    </motion.aside>

                    {/* Details Panel */}
                    <AnimatePresence>
                        {selectedConfig && (
                            <motion.div 
                                layout
                                style={{ originX: 0, originY: 0.5 }}
                                initial={{ opacity: 0, scale: 0.5, width: "0%" }}
                                animate={{ opacity: 1, scale: 1, width: "100%" }}
                                exit={{ opacity: 0, scale: 0.5, width: "0%" }}
                                transition={{ type: "spring", stiffness: 350, damping: 30 }}
                                className="flex-1 w-full overflow-hidden"
                            >
                                <AnimatePresence mode="wait">
                                    <motion.div 
                                        key={selectedConfig.id}
                                        initial={{ opacity: 0, scale: 0.96 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.96 }}
                                        transition={{ duration: 0.15, ease: "easeInOut" }}
                                        className="w-full h-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden shadow-xl min-w-[300px]"
                                    >
                                        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/30">
                                        <div>
                                            <h2 className="text-lg font-bold text-slate-900 dark:text-white">{selectedConfig.name}</h2>
                                            <p className="text-sm text-slate-500">{t("settings.configs.modal_desc")}</p>
                                        </div>
                                        <button onClick={() => setSelectedConfig(null)} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 rounded-full transition-colors">
                                            <span className="material-symbols-outlined">close</span>
                                        </button>
                                    </div>
                                    
                                    <div className="p-6 grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-8">
                                        <div className="space-y-4">
                                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/40">
                                                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{t("settings.configs.modal_board_type")}</p>
                                                    <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{getProjectBoardTypeLabel(selectedConfig)}</p>
                                                </div>
                                                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/40">
                                                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{t("settings.configs.modal_board_profile")}</p>
                                                    <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{getProjectBoardProfileLabel(selectedConfig)}</p>
                                                </div>
                                                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/40">
                                                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{t("settings.configs.modal_assigned_boards")}</p>
                                                    <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{selectedConfig.devices.length}</p>
                                                </div>
                                            </div>
                                            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">{t("settings.configs.modal_versions_mapping")}</h3>
                                            <div className="mt-2 flex flex-col sm:flex-row border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden bg-white dark:bg-slate-950">
                                                {/* Left Side: History List */}
                                                <div className="w-full sm:w-[240px] shrink-0 border-b sm:border-b-0 sm:border-r border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 h-[300px] sm:h-[460px] flex flex-col">
                                                    <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
                                                        <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-500">{t("settings.configs.modal_history").replace("{count}", selectedConfigHistory.length.toString())}</h4>
                                                    </div>
                                                    <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2 custom-scrollbar">
                                                        {historyLoading ? (
                                                            <div className="text-sm text-center py-4 text-slate-500 animate-pulse">{t("settings.configs.loading_history")}</div>
                                                        ) : selectedConfigHistory.length === 0 ? (
                                                            <div className="text-sm text-center py-4 text-slate-500">{t("settings.configs.no_history")}</div>
                                                        ) : selectedConfigHistory.map(entry => {
                                                            const isActive = activeHistoryVersion?.id === entry.id;
                                                            return (
                                                                <button
                                                                    key={entry.id}
                                                                    onClick={() => setActiveHistoryVersion(entry)}
                                                                    className={`text-left p-2.5 rounded-lg border transition-all text-sm flex flex-col gap-1 w-full ${isActive ? 'bg-primary/5 border-primary/30 ring-1 ring-primary/20' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-primary/20'}`}
                                                                >
                                                                    <div className="font-semibold text-slate-900 dark:text-white truncate pr-2 w-full">{entry.config_name}</div>
                                                                    <div className="text-[10px] text-slate-500 flex justify-between items-center w-full">
                                                                        <span>{formatServerTimestamp(entry.created_at, { options: { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }, timezone })}</span>
                                                                        <span className={`${entry.latest_build_status === "build_failed" || entry.latest_build_status === "flash_failed" ? "bg-rose-500/10 text-rose-500" : entry.latest_build_status === "artifact_ready" || entry.latest_build_status === "flashed" ? "bg-emerald-500/10 text-emerald-500" : "bg-blue-500/10 text-blue-500"} uppercase font-bold text-[8px] tracking-wider px-1.5 py-0.5 rounded-full shrink-0`}>{entry.latest_build_status || t("settings.configs.history_saved")}</span>
                                                                    </div>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                                
                                                {/* Right Side: SVG Preview */}
                                                <div className="flex-1 h-[460px] overflow-y-auto custom-scrollbar relative p-4 bg-white dark:bg-slate-900 flex flex-col">
                                                    {activeHistoryVersion ? (
                                                        <div className="flex-1 w-full">
                                                            <SvgPinMapPreview 
                                                                boardId={resolveProjectBoardProfileId(selectedConfig) || "esp32-c3-super-mini"}
                                                                pins={(activeHistoryVersion.config?.pins as PinMapping[]) || []} 
                                                            />
                                                        </div>
                                                    ) : (
                                                        <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                                                            <span className="material-symbols-outlined text-[32px]">touch_app</span>
                                                            <p className="text-sm">{t("settings.configs.select_version")}</p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                
                                        <div className="space-y-4">
                                            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">{t("settings.configs.assigned_boards_count").replace("{count}", selectedConfig.devices.length.toString())}</h3>
                                            {selectedConfig.devices.length === 0 ? (
                                                <p className="text-sm text-slate-500 italic">{t("settings.configs.no_boards_assigned")}</p>
                                            ) : (
                                                <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                                                    {selectedConfig.devices.map(device => (
                                                        <div key={device.device_id} className={`flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-transparent hover:border-primary/30 transition-all ${device.conn_status === "offline" ? "opacity-75" : ""}`}>
                                                            <div className="flex items-center gap-3 max-w-[60%]">
                                                                <div className={`w-2 h-2 shrink-0 rounded-full ${device.conn_status === "online" ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-slate-400"}`}></div>
                                                                <div className="truncate w-full text-slate-900 dark:text-white">
                                                                    <p className="text-sm font-semibold truncate" title={device.name}>{device.name}</p>
                                                                    <p className="text-[10px] text-slate-500 truncate" title={device.device_id}>{t("settings.configs.device_id").replace("{id}", device.device_id)}</p>
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
                                    </motion.div>
                                </AnimatePresence>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.div>
            )}

            {deleteTarget && (
                <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
                        onClick={() => closeDeleteModal()}
                    />

                    <form
                        className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
                        onSubmit={(event) => {
                            event.preventDefault();
                            void handleDelete();
                        }}
                    >
                        <input
                            autoComplete="username"
                            className="sr-only"
                            name="delete-config-username"
                            readOnly
                            tabIndex={-1}
                            type="text"
                            value={user?.username ?? ""}
                        />

                        <div className="flex items-start gap-4">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-500 dark:bg-rose-500/10">
                                <span className="material-symbols-outlined text-[24px]">shield_lock</span>
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t("settings.configs.delete_title")}</h3>
                                <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                                    {(() => {
                                        const template = t("settings.configs.delete_desc");
                                        const parts = template.split(/({username}|{name})/g);
                                        return parts.map((part, i) => {
                                            if (part === "{username}") {
                                                return <span key={i} className="font-semibold text-slate-700 dark:text-slate-200">{user?.username ?? "the signed-in account"}</span>;
                                            }
                                            if (part === "{name}") {
                                                return <span key={i} className="font-semibold text-slate-700 dark:text-slate-200">{deleteTarget.name}</span>;
                                            }
                                            return part;
                                        });
                                    })()}
                                </p>
                            </div>
                        </div>

                        {deleteModalError && (
                            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                                {deleteModalError}
                            </div>
                        )}

                        <label className="mt-6 block text-sm font-medium text-slate-700 dark:text-slate-200">
                            {t("settings.configs.delete_password_label")}
                            <input
                                autoFocus
                                autoComplete="current-password"
                                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                id="delete-config-password"
                                name="delete-config-password"
                                onChange={(event) => {
                                    setDeletePassword(event.target.value);
                                    if (deleteModalError) {
                                        setDeleteModalError("");
                                    }
                                }}
                                placeholder={t("settings.configs.delete_password_placeholder")}
                                type="password"
                                value={deletePassword}
                            />
                        </label>

                        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                            <button
                                className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                                disabled={deletingId === deleteTarget.id}
                                onClick={() => closeDeleteModal()}
                                type="button"
                            >
                                {t("settings.configs.btn_cancel")}
                            </button>
                            <button
                                className="rounded-xl bg-rose-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-rose-500/20 transition hover:bg-rose-600 disabled:opacity-50"
                                disabled={deletingId === deleteTarget.id}
                                type="submit"
                            >
                                {deletingId === deleteTarget.id ? t("settings.configs.btn_deleting") : t("settings.configs.btn_delete")}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}
