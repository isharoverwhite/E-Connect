/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import type { BoardProfile } from "../board-profiles";
import type {
    FlashSource,
    ProjectSyncState,
    ServerBuildState,
} from "../types";
import {
    boardRequiresFullFlashBundle,
    getFullBundleBootloaderOffset,
    getSingleBinaryOffset,
} from "../flash-manifest";
import { formatServerTimestamp } from "@/lib/server-time";
import { useLanguage } from "@/components/LanguageContext";

export interface Step4FlashProps {
    board: BoardProfile;
    projectId: string | null;
    projectName: string;
    flashSource: FlashSource;
    setFlashSource: React.Dispatch<React.SetStateAction<FlashSource>>;
    eraseFirst: boolean;
    setEraseFirst: React.Dispatch<React.SetStateAction<boolean>>;
    manifestUrl: string | null;
    flashLockedReason: string | null;
    configBusy: boolean;
    draftConfig: Record<string, unknown>;
    generateConfig: () => Promise<void>;
    onBack: () => void;
    pinsLength: number;
    projectSyncState: ProjectSyncState;
    projectSyncMessage: string;
    serverBuild: ServerBuildState;
    firmwareTargetHost: string | null;
    firmwareTargetMqttBroker: string | null;
    firmwareTargetMqttPort: number | null;
    buildBusy: boolean;
    hasActiveBuild: boolean;
    onTriggerServerBuild: () => Promise<void>;
    onRefreshBuild: () => Promise<void>;
    onDownloadArtifact: () => void;
    serialPort: string;
    setSerialPort: React.Dispatch<React.SetStateAction<string>>;
    serialBusy: boolean;
    serialLocked: boolean;
    serialJobId: string | null;
    serialMessage: string;
    serialError: string | null;
    webFlasherResetKey: number;
    onSetWebFlasherElement: (element: HTMLElement | null) => void;
    onOpenWebFlasher: () => void;
    onReleaseSerialLock: () => Promise<void>;
    onRefreshSerialStatus: () => Promise<void>;
    onLogPanelRef?: (element: HTMLDivElement | null) => void;
    onOpenDevices: () => void;
    flasherClosed: boolean;
    timezone?: string | null;
}

function toHex(value: number) {
    return `0x${value.toString(16).toUpperCase()}`;
}

function formatStatusLabel(value: ProjectSyncState | ServerBuildState["status"], t: (key: string) => string) {
    return t(`diy.step4flash.pill.${value}`) || value.replace(/_/g, " ");
}

function getPillStyles(value: ProjectSyncState | ServerBuildState["status"]) {
    switch (value) {
        case "saved":
        case "artifact_ready":
        case "flashed":
            return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300";
        case "pending_ota":
            return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300";
        case "error":
        case "build_failed":
        case "flash_failed":
        case "cancelled":
            return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300";
        case "saving":
        case "queued":
        case "building":
        case "validated":
        case "draft_config":
        case "flashing":
            return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300";
        default:
            return "border-border-light dark:border-border-dark bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300";
    }
}

function getReadinessThemeStyles(theme: "blue" | "green" | "red") {
    switch (theme) {
        case "green":
            return {
                text: "text-emerald-500",
                bg: "bg-emerald-500",
            };
        case "red":
            return {
                text: "text-rose-500",
                bg: "bg-rose-500",
            };
        case "blue":
        default:
            return {
                text: "text-primary",
                bg: "bg-primary",
            };
    }
}

function SourceButton({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            className={`flex-1 rounded-lg py-2.5 text-sm font-bold transition-all ${
                active
                    ? "bg-surface-light dark:bg-surface-dark text-slate-900 dark:text-white shadow-sm dark:bg-slate-900 dark:text-white"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-300"
            }`}
        >
            {children}
        </button>
    );
}

export function Step4Flash({

    board,
    projectId,
    projectName,
    flashSource,
    setFlashSource,
    eraseFirst,
    setEraseFirst,
    manifestUrl,
    flashLockedReason,
    configBusy,
    draftConfig,
    generateConfig,
    onBack,
    pinsLength,
    projectSyncState,
    projectSyncMessage,
    serverBuild,
    firmwareTargetHost,
    firmwareTargetMqttBroker,
    firmwareTargetMqttPort,
    buildBusy,
    hasActiveBuild,
    onTriggerServerBuild,
    onRefreshBuild,
    onDownloadArtifact,
    serialPort,
    setSerialPort,
    serialBusy,
    serialLocked,
    serialJobId,
    serialMessage,
    serialError,
    webFlasherResetKey,
    onSetWebFlasherElement,
    onOpenWebFlasher,
    onReleaseSerialLock,
    onRefreshSerialStatus,
    onLogPanelRef,
    onOpenDevices,
    flasherClosed,
    timezone,
}: Step4FlashProps) {
    const { t } = useLanguage();
    const previewLines = JSON.stringify(draftConfig, null, 2).split("\n");
    const readiness = getReadinessModel({
        t,
        board,
        flashSource,
        manifestUrl,
        flashLockedReason,
        serverBuildStatus: serverBuild.status,
    });
    const themeStyles = getReadinessThemeStyles(readiness.theme);
    const buildActionLabel = buildBusy
        ? t("diy.step4flash.build.queueing")
        : hasActiveBuild
            ? t("diy.step4flash.build.in_progress")
            : t("diy.step4flash.build.start");

    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-primary font-semibold text-sm uppercase tracking-wider">
                    <span>{t("diy.step4flash.step_label")}</span>
                    <span className="h-px w-8 bg-primary"></span>
                </div>
                <h1 className="text-slate-900 dark:text-white dark:text-white text-4xl font-black leading-tight tracking-tight">{t("diy.step4flash.title")}</h1>
                <p className="text-slate-500 dark:text-slate-400 dark:text-slate-400 text-lg">{t("diy.step4flash.desc")}</p>
            </div>

            <div className="rounded-xl border border-border-light dark:border-border-dark dark:border-slate-800 bg-surface-light dark:bg-surface-dark dark:bg-slate-900/50 p-6 shadow-sm">
                <div className="flex flex-col gap-6">
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${getPillStyles(serverBuild.status)}`}>
                                    {formatStatusLabel(serverBuild.status, t)}
                                </span>
                                <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${getPillStyles(projectSyncState)}`}>
                                    {formatStatusLabel(projectSyncState, t)}
                                </span>
                                {projectId && (
                                    <span className="rounded-full border border-border-light dark:border-border-dark px-3 py-1 font-mono text-[11px] text-slate-500 dark:text-slate-400 dark:border-slate-800 dark:text-slate-400">
                                        {t("diy.step4flash.lbl.project").replace("{id}", projectId.slice(0, 8))}
                                    </span>
                                )}
                                {serverBuild.jobId && (
                                    <span className="rounded-full border border-border-light dark:border-border-dark px-3 py-1 font-mono text-[11px] text-slate-500 dark:text-slate-400 dark:border-slate-800 dark:text-slate-400">
                                        {t("diy.step4flash.lbl.job").replace("{id}", serverBuild.jobId.slice(0, 8))}
                                    </span>
                                )}
                            </div>
                            <p className="text-slate-900 dark:text-white dark:text-white text-base font-semibold">
                                {readiness.headline}
                            </p>
                            <p className="text-sm text-slate-500 dark:text-slate-400 dark:text-slate-400">
                                {readiness.detail}
                            </p>
                            {serverBuild.updatedAt && (
                                <p className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-400">
                                    {t("diy.step4flash.lbl.last_update")} {formatServerTimestamp(serverBuild.updatedAt, {
                                        fallback: t("diy.step4flash.lbl.unknown_time"),
                                        options: {
                                            year: "numeric",
                                            month: "short",
                                            day: "numeric",
                                            hour: "2-digit",
                                            minute: "2-digit",
                                        },
                                        timezone,
                                    })}
                                </p>
                            )}
                        </div>
                        <p className={`text-3xl font-black leading-none transition-colors duration-500 ${themeStyles.text}`}>{readiness.progress}%</p>
                    </div>

                    <div className="w-full h-3 bg-slate-100 dark:bg-slate-800 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all duration-500 ease-out ${themeStyles.bg}`}
                            style={{ width: `${readiness.progress}%` }}
                        ></div>
                    </div>

                    <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-slate-500 dark:text-slate-400 dark:text-slate-400 flex items-center gap-2">
                            <span className="material-symbols-outlined text-sm">memory</span>
                            {readiness.subline}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400 dark:text-slate-400">{projectSyncMessage}</span>
                    </div>
                </div>
            </div>

            {/* Stage 1: Build & Config */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr]">
                <div className="flex flex-col gap-6 min-w-0">
                    <div className="rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white dark:text-white">{t("diy.step4flash.lbl.fw_source")}</h3>
                                <p className="text-slate-500 text-sm mb-4">
                                    {t("diy.step4flash.lbl.fw_source_desc")}
                                </p>
                            </div>
                            <button
                                onClick={() => void generateConfig()}
                                disabled={configBusy}
                                className="inline-flex items-center gap-2 rounded-lg border border-border-light dark:border-border-dark px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-400 transition-colors hover:bg-slate-100 dark:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                                <span className="material-symbols-outlined text-base">download</span>
                                {configBusy ? t("diy.step4flash.build.queueing") : t("diy.step4flash.build.export")}
                            </button>
                        </div>

                        <div className="flex gap-2 rounded-xl bg-slate-100 dark:bg-slate-800 p-1 dark:bg-slate-950">
                            <SourceButton active={flashSource === "server"} onClick={() => setFlashSource("server")}>
                                {t("diy.step4flash.source.server")}
                            </SourceButton>
                            {board.demoFirmware && (
                                <SourceButton active={flashSource === "demo"} onClick={() => setFlashSource("demo")}>
                                    {t("diy.step4flash.source.demo")}
                                </SourceButton>
                            )}
                        </div>
                    </div>

                    <div className="mt-5">
                        {flashSource === "server" && (
                            <div className="flex flex-col gap-4 rounded-2xl border border-border-light dark:border-border-dark bg-slate-50 dark:bg-slate-800/50 p-5 dark:border-slate-800 dark:bg-slate-950">
                                <div className="space-y-2">
                                    <h3 className="text-lg font-medium text-slate-800">{t("diy.step4flash.server_build.title")}</h3>
                                    <p className="text-sm text-slate-500">
                                        {t("diy.step4flash.server_build.desc")}
                                    </p>
                                </div>

                                <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-200">
                                    <h4 className="font-medium text-slate-800 mb-2">{t("diy.step4flash.server_build.runtime_targets")}</h4>
                                    <div className="mt-2 grid gap-3 md:grid-cols-2">
                                        <div>
                                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700 dark:text-sky-300">
                                                {t("diy.step4flash.server_build.api_host")}
                                            </p>
                                            <p className="mt-1 font-mono text-xs uppercase tracking-[0.18em]">
                                                {firmwareTargetHost ?? t("diy.step4flash.lbl.detecting")}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700 dark:text-sky-300">
                                                {t("diy.step4flash.server_build.mqtt_broker")}
                                            </p>
                                            <p className="mt-1 font-mono text-xs uppercase tracking-[0.18em]">
                                                {firmwareTargetMqttBroker ?? firmwareTargetHost ?? t("diy.step4flash.lbl.detecting")}
                                                {firmwareTargetMqttPort ? `:${firmwareTargetMqttPort}` : ""}
                                            </p>
                                        </div>
                                    </div>
                                    <p className="text-sm text-amber-800 mt-1">
                                        {t("diy.step4flash.server_build.warning")}
                                    </p>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={onTriggerServerBuild}
                                        disabled={buildBusy || hasActiveBuild || pinsLength === 0 || projectSyncState === "saving"}
                                        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <span className="material-symbols-outlined text-base">
                                            {buildBusy || hasActiveBuild ? "autorenew" : "construction"}
                                        </span>
                                        {buildActionLabel}
                                    </button>
                                    <button
                                        onClick={onRefreshBuild}
                                        disabled={!serverBuild.jobId}
                                        className="inline-flex items-center gap-2 rounded-lg border border-border-light dark:border-border-dark px-4 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-400 transition-colors hover:bg-slate-100 dark:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
                                    >
                                        <span className="material-symbols-outlined text-base">sync</span>
                                        {t("diy.step4flash.btn.refresh")}
                                    </button>
                                    <button
                                        onClick={onDownloadArtifact}
                                        disabled={!serverBuild.artifactUrl}
                                        className="inline-flex items-center gap-2 rounded-lg border border-border-light dark:border-border-dark px-4 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-400 transition-colors hover:bg-slate-100 dark:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
                                    >
                                        <span className="material-symbols-outlined text-base">download</span>
                                        {t("diy.step4flash.btn.download")}
                                    </button>
                                </div>

                                {serverBuild.warnings.length > 0 && (
                                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                                        <div className="mb-2 flex items-center gap-2 font-semibold">
                                            <span className="material-symbols-outlined text-base">report</span>
                                            {t("diy.step4flash.lbl.warnings")}
                                        </div>
                                        {serverBuild.warnings.map((warning) => (
                                            <p key={warning}>{warning}</p>
                                        ))}
                                    </div>
                                )}

                                {serverBuild.error && (
                                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                                        <div className="flex items-start gap-3">
                                            <span className="material-symbols-outlined text-rose-500">warning</span>
                                            <p>{serverBuild.error}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {flashSource === "demo" && board.demoFirmware && (
                            <div className="flex flex-col gap-4 rounded-2xl border border-border-light dark:border-border-dark bg-slate-50 dark:bg-slate-800/50 p-5 dark:border-slate-800 dark:bg-slate-950">
                                <div className="flex items-start gap-3">
                                    <span className="material-symbols-outlined mt-1 text-primary">firmware</span>
                                    <div>
                                        <h4 className="font-bold text-slate-900 dark:text-white dark:text-white">{board.demoFirmware.title}</h4>
                                        {board.demoFirmware.notes.map((note) => (
                                            <p key={note} className="mt-1 text-sm text-slate-600 dark:text-slate-400 dark:text-slate-400">
                                                {note}
                                            </p>
                                        ))}
                                    </div>
                                </div>
                                <div className="space-y-2 rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark p-4 font-mono text-sm text-slate-600 dark:text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                                    {board.demoFirmware.parts.map((part) => (
                                        <div
                                            key={part.path}
                                            className="flex items-center justify-between border-b border-border-light dark:border-border-dark pb-2 last:border-0 last:pb-0 dark:border-slate-800"
                                        >
                                            <span className="text-slate-700 dark:text-slate-300 dark:text-slate-300">{part.label}</span>
                                            <span className="font-semibold">{toHex(part.offset)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                    </div>
                    </div>
                </div>
                <div className="flex flex-col gap-6 min-w-0">
                    <div className="rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white dark:text-white">{t("diy.step4flash.lbl.build_config")}</h3>
                            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 dark:text-slate-400">
                                {t("diy.step4flash.build_config.desc")}
                            </p>
                        </div>
                        <span className="rounded-full border border-border-light dark:border-border-dark px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 dark:border-slate-800 dark:text-slate-400">
                            {projectName || board.name}
                        </span>
                    </div>
                    <div className="mt-5 rounded-xl border border-border-light dark:border-border-dark bg-[#1e1e1e] dark:border-slate-800 overflow-hidden">
                        <div className="flex items-center justify-between border-b border-[#333] bg-[#252526] px-4 py-2">
                            <span className="text-xs font-mono text-gray-400 flex items-center gap-2">
                                <span className="material-symbols-outlined text-sm text-yellow-500">description</span>
                                device_config.json
                            </span>
                            <span className="text-[10px] text-gray-500 uppercase font-semibold">{t("diy.step4flash.lbl.read_only")}</span>
                        </div>
                        <div className="max-h-[340px] overflow-auto p-4">
                            <pre className="font-mono text-xs leading-6 text-slate-200 whitespace-pre-wrap">
                                {previewLines.join("\n")}
                            </pre>
                        </div>
                    </div>
                    </div>
                </div>
            </div>

            <div className="w-full min-w-0 lg:mt-2 lg:-mx-2 lg:w-[calc(100%+16px)]">
                <div className="rounded-xl border border-border-light dark:border-border-dark bg-slate-950 overflow-hidden shadow-2xl dark:border-slate-800">
                    <div className="bg-slate-900 px-4 py-2 border-b border-slate-800 flex items-center justify-between">
                        <div className="flex gap-1.5">
                            <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/40"></div>
                            <div className="w-3 h-3 rounded-full bg-amber-500/20 border border-amber-500/40"></div>
                            <div className="w-3 h-3 rounded-full bg-emerald-500/20 border border-emerald-500/40"></div>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono uppercase tracking-widest">
                                {t("diy.step4flash.console.title")}
                            </span>
                            <button
                                onClick={onRefreshBuild}
                                disabled={!serverBuild.jobId}
                                className="text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {t("diy.step4flash.btn.refresh")}
                            </button>
                        </div>
                    </div>

                    {serverBuild.status === "artifact_ready" && (
                        <div className="flex items-center gap-2 border-b border-emerald-800/40 bg-emerald-950/60 px-4 py-2 text-xs font-semibold text-emerald-300">
                            <span className="material-symbols-outlined text-base text-emerald-400">check_circle</span>
                            <span className="font-medium">{t("diy.step4flash.console.success")}</span>
                        </div>
                    )}
                    {serverBuild.status === "build_failed" && (
                        <div className="flex items-start gap-2 border-b border-rose-800/40 bg-rose-950/60 px-4 py-2 text-xs font-semibold text-rose-300">
                            <span className="material-symbols-outlined text-base text-rose-400">error</span>
                            <span>
                                <span className="font-medium">{t("diy.step4flash.console.failed")}</span>
                                <span className="text-slate-400 text-xs ml-2">{t("diy.step4flash.console.inspect_log")}</span>
                                {serverBuild.errorMessage && <div className="mt-1">{serverBuild.errorMessage}</div>}
                            </span>
                        </div>
                    )}
                    {(serverBuild.status === "building" || serverBuild.status === "queued") && (
                        <div className="flex items-center gap-2 border-b border-amber-800/40 bg-amber-950/40 px-4 py-2 text-xs font-semibold text-amber-300">
                            <span className="material-symbols-outlined animate-spin text-base text-amber-400">progress_activity</span>
                            {serverBuild.status === "queued" ? t("diy.step4flash.console.queued") : t("diy.step4flash.console.in_progress")}
                        </div>
                    )}

                    <div
                        ref={onLogPanelRef}
                        className="h-[520px] overflow-y-auto p-4 font-mono text-sm bg-black/40"
                    >
                        <pre className="whitespace-pre-wrap text-slate-300">
                            {serverBuild.logs || t("diy.step4flash.console.empty_logs")}
                        </pre>
                    </div>
                    <div className="border-t border-slate-800 px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                        {board.family === "ESP8266"
                            ? t("diy.step4flash.console.esp8266_info").replace("{offset}", toHex(getSingleBinaryOffset(board)))
                            : boardRequiresFullFlashBundle(board)
                                ? t("diy.step4flash.console.esp32_info").replace("{bootloader_offset}", toHex(getFullBundleBootloaderOffset(board)))
                                : t("diy.step4flash.console.other_info").replace("{offset}", toHex(getSingleBinaryOffset(board)))}
                    </div>
                    </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr] mt-2">
                <div className="flex flex-col gap-6 min-w-0">
                    <div className="rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
                    <div className="flex flex-col gap-2">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white dark:text-white">{t("diy.step4flash.lbl.serial_coordination")}</h3>
                        <p className="text-sm text-slate-500 mb-4">
                            {t("diy.step4flash.serial.desc")}
                        </p>
                    </div>

                    <label htmlFor="serial-port-label" className="mt-5 flex flex-col gap-2">
                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 dark:text-slate-300">{t("diy.step4flash.lbl.port_label")}</span>
                        <input
                            id="serial-port-label"
                            name="serialPort"
                            value={serialPort}
                            onChange={(event) => setSerialPort(event.target.value)}
                            placeholder="/dev/ttyUSB0 or COM3"
                            className="rounded-xl border border-border-light dark:border-border-dark bg-slate-50 dark:bg-slate-800/50 px-4 py-3 text-sm text-slate-700 dark:text-slate-300 outline-none transition-colors focus:border-primary dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                        />
                    </label>

                    <div className="mt-4 flex flex-wrap gap-2">
                        <button
                            onClick={onRefreshSerialStatus}
                            disabled={serialBusy}
                            className="inline-flex items-center gap-2 rounded-lg border border-border-light dark:border-border-dark px-4 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-400 transition-colors hover:bg-slate-100 dark:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                            <span className="material-symbols-outlined text-base">sync</span>
                            {t("diy.step4flash.serial.refresh")}
                        </button>
                        <button
                            onClick={onReleaseSerialLock}
                            disabled={serialBusy || !serialLocked}
                            className="inline-flex items-center gap-2 rounded-lg border border-border-light dark:border-border-dark px-4 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-400 transition-colors hover:bg-slate-100 dark:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                            <span className="material-symbols-outlined text-base">lock_open</span>
                            {t("diy.step4flash.serial.release")}
                        </button>
                    </div>

                    <div className={`mt-4 rounded-xl border p-4 text-sm ${
                        serialLocked
                            ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
                    }`}>
                        <p className="font-semibold">{serialLocked ? t("diy.step4flash.serial.busy") : t("diy.step4flash.serial.free")}</p>
                        <p className="mt-1">{serialMessage}</p>
                        {serialJobId && (
                            <p className="mt-2 font-mono text-xs uppercase tracking-[0.18em]">
                                {t("diy.step4flash.lbl.job").replace("{id}", serialJobId.slice(0, 8))}
                            </p>
                        )}
                    </div>

                    {serialError && (
                        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                            <div className="flex items-start gap-3">
                                <span className="material-symbols-outlined text-rose-500">warning</span>
                                <p>{serialError}</p>
                            </div>
                        </div>
                    )}
                    </div>
                </div>
                <div className="flex flex-col gap-6 min-w-0">
                    <div className="rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white dark:text-white">{t("diy.step4flash.lbl.web_flasher")}</h3>
                    <div className="mt-4 rounded-xl border border-border-light dark:border-border-dark bg-slate-50 dark:bg-slate-800/50 p-4 text-sm text-slate-600 dark:text-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                        <p className="text-sm text-slate-500 mb-4">
                            {t("diy.step4flash.flasher.desc")}
                        </p>
                        <label htmlFor="erase-all-flash" className="mt-4 flex cursor-pointer items-center gap-3">
                            <input
                                id="erase-all-flash"
                                name="eraseAllFlash"
                                type="checkbox"
                                checked={eraseFirst}
                                onChange={(event) => setEraseFirst(event.target.checked)}
                                className="h-5 w-5 cursor-pointer rounded border-slate-300 dark:border-slate-600 text-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900"
                            />
                            <span className="font-medium text-slate-700 dark:text-slate-300 dark:text-slate-300">
                                {t("diy.step4flash.lbl.erase_first")}
                            </span>
                        </label>
                    </div>

                    {flashLockedReason ? (
                        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400">
                            <div className="flex items-start gap-3">
                                <span className="material-symbols-outlined text-rose-500">warning</span>
                                <p>{flashLockedReason}</p>
                            </div>
                        </div>
                    ) : (
                        <div className="mt-4 flex flex-col gap-4">
                            <div className="flex flex-col items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-6 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                                <button
                                    onClick={onOpenWebFlasher}
                                    className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
                                >
                                    <span className="material-symbols-outlined text-base">usb</span>
                                    {t("diy.step4flash.btn.open_flasher")}
                                </button>
                                <p className="text-xs text-slate-400 mt-4 flex items-start">
                                    <span className="material-symbols-outlined text-sm mr-1.5 flex-shrink-0 mt-0.5">info</span>
                                    <span>{t("diy.step4flash.flasher.remount_info")}</span>
                                </p>
                                <div className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0" aria-hidden="true">
                                    <esp-web-install-button
                                        key={webFlasherResetKey}
                                        ref={onSetWebFlasherElement}
                                        manifest={manifestUrl ?? undefined}
                                        erase-first={eraseFirst ? "true" : undefined}
                                    />
                                </div>
                            </div>
                            {manifestUrl && (
                                <a
                                    href={manifestUrl}
                                    download="manifest.json"
                                    className="text-center text-xs text-slate-500 dark:text-slate-400 transition-colors hover:text-primary hover:underline"
                                >
                                    {t("diy.step4flash.btn_download_manifest")}
                                </a>
                            )}
                        </div>
                    )}
                    </div>
                </div>
            </div>

            <div className={`flex ${flasherClosed ? "justify-between" : "justify-start"} border-t border-border-light dark:border-border-dark pt-6 dark:border-slate-800`}>
                <button
                    onClick={onBack}
                    className="rounded-lg border border-border-light dark:border-border-dark px-6 py-2.5 font-bold text-slate-600 dark:text-slate-400 transition-colors hover:bg-slate-100 dark:bg-slate-800 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                    {t("diy.step4flash.btn_back_validation")}
                </button>

                {flasherClosed && (
                    <button
                        onClick={onOpenDevices}
                        className="flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 font-bold text-white shadow-sm transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 dark:focus:ring-offset-slate-900"
                    >
                        {t("diy.step4flash.btn_open_devices")}
                        <span className="material-symbols-outlined text-sm">arrow_forward</span>
                    </button>
                )}
            </div>
        </div>
    );
}

function getReadinessModel({
    t,
    board,
    flashSource,
    manifestUrl,
    flashLockedReason,
    serverBuildStatus,
}: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    t: (key: string, options?: any) => string;
    board: BoardProfile;
    flashSource: FlashSource;
    manifestUrl: string | null;
    flashLockedReason: string | null;
    serverBuildStatus: ServerBuildState["status"];
}) {
    if (serverBuildStatus === "flashed") {
        return {
            progress: 100,
            theme: "green" as const,
            headline: t("diy.step4flash.readiness.flashed.headline"),
            detail: t("diy.step4flash.readiness.flashed.detail"),
            subline: t("diy.step4flash.readiness.flashed.subline"),
        };
    }

    if (flashSource === "server") {
        switch (serverBuildStatus) {
            case "queued":
            case "draft_config":
            case "validated":
                return {
                    progress: 32,
                    theme: "blue" as const,
                    headline: t("diy.step4flash.readiness.queued.headline"),
                    detail: t("diy.step4flash.readiness.queued.detail"),
                    subline: t("diy.step4flash.readiness.queued.subline"),
                };
            case "building":
                return {
                    progress: 64,
                    theme: "blue" as const,
                    headline: t("diy.step4flash.readiness.building.headline"),
                    detail: t("diy.step4flash.readiness.building.detail"),
                    subline: t("diy.step4flash.readiness.building.subline"),
                };
            case "artifact_ready":
                if (manifestUrl && !flashLockedReason) {
                    return {
                        progress: 100,
                        theme: "green" as const,
                        headline: t("diy.step4flash.readiness.ready.headline"),
                        detail: t("diy.step4flash.readiness.ready.detail"),
                        subline: t("diy.step4flash.readiness.ready.subline"),
                    };
                }

                return {
                    progress: 82,
                    theme: "blue" as const,
                    headline: t("diy.step4flash.readiness.artifact.headline"),
                    detail: flashLockedReason || t("diy.step4flash.readiness.artifact.detail"),
                    subline: boardRequiresFullFlashBundle(board)
                        ? t("diy.step4flash.readiness.artifact.subline_full")
                        : t("diy.step4flash.readiness.artifact.subline_binary").replace("{offset}", toHex(getSingleBinaryOffset(board))),
                };
            case "build_failed":
            case "flash_failed":
            case "cancelled":
                return {
                    progress: 18,
                    theme: "red" as const,
                    headline: t("diy.step4flash.readiness.error.headline"),
                    detail: flashLockedReason || t("diy.step4flash.readiness.error.detail2"),
                    subline: t("diy.step4flash.readiness.error.subline"),
                };
            default:
                break;
        }
    }

    if (manifestUrl && !flashLockedReason) {
        return {
            progress: 100,
            theme: "green" as const,
            headline: t("diy.step4flash.readiness.ready.headline"),
            detail: t("diy.step4flash.readiness.ready.detail2"),
            subline: t("diy.step4flash.readiness.ready.subline2"),
        };
    }

    if (manifestUrl) {
        return {
            progress: 76,
            theme: "blue" as const,
            headline: t("diy.step4flash.readiness.prepared.headline"),
            detail: flashLockedReason || t("diy.step4flash.readiness.prepared.detail"),
            subline: t("diy.step4flash.readiness.prepared.subline"),
        };
    }

    return {
        progress: 22,
        theme: "blue" as const,
        headline: t("diy.step4flash.readiness.not_ready.headline"),
        detail: flashLockedReason || t("diy.step4flash.readiness.not_ready.detail"),
        subline: t("diy.step4flash.readiness.not_ready.subline"),
    };
}
