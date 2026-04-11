/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import type { BoardProfile } from "../board-profiles";
import type { ProjectSyncState } from "../types";
import { formatServerTimestamp } from "@/lib/server-time";

export interface SavedBoardConfigOption {
    id: string;
    name: string;
    pinCount: number;
    createdAt: string;
    updatedAt: string;
}

interface Step2ConfigsProps {
    board: BoardProfile;
    projectName: string;
    setProjectName: (value: string) => void;
    configs: SavedBoardConfigOption[];
    configsLoading: boolean;
    configListError: string;
    hasSavedConfig: boolean;
    canContinue: boolean;
    selectedConfigId: string | null;
    selectedConfigMode: "saved" | "template" | null;
    projectSyncState: ProjectSyncState;
    projectSyncMessage: string;
    onSelectConfig: (configId: string) => Promise<void>;
    onSaveConfig: () => Promise<void>;
    onSaveAsNewConfig: () => Promise<void>;
    onBack: () => void;
    onNext: () => Promise<void>;
    timezone?: string | null;
}

function formatTimestamp(value: string, timezone?: string | null) {
    return formatServerTimestamp(value, {
        fallback: "Unknown update time",
        locale: "en",
        options: {
            dateStyle: "medium",
            timeStyle: "short",
        },
        timezone,
    });
}

export function Step2Configs({
    board,
    projectName,
    setProjectName,
    configs,
    configsLoading,
    configListError,
    hasSavedConfig,
    canContinue,
    selectedConfigId,
    selectedConfigMode,
    projectSyncState,
    projectSyncMessage,
    onSelectConfig,
    onSaveConfig,
    onSaveAsNewConfig,
    onBack,
    onNext,
    timezone,
}: Step2ConfigsProps) {
    return (
        <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-2">
                <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white dark:text-slate-100">
                    Choose a Saved Config
                </h1>
                <p className="text-lg text-slate-600 dark:text-slate-400 dark:text-slate-400">
                    Saved configs stay scoped to the board profile they were created for. Load one for {board.name} as a template or create a brand-new config before editing GPIO mappings.
                </p>
            </div>

            <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.9fr)]">
                <section className="rounded-3xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
                    <div className="flex items-start justify-between gap-4 border-b border-border-light dark:border-border-dark pb-4 dark:border-slate-800">
                        <div>
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white dark:text-white">Board Config Library</h2>
                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 dark:text-slate-400">
                                {configs.length === 1 ? "1 saved config" : `${configs.length} saved configs`} for {board.name}
                            </p>
                        </div>
                        <span className="rounded-full bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
                            {board.family}
                        </span>
                    </div>

                    {configsLoading ? (
                        <div className="flex min-h-52 items-center justify-center text-sm text-slate-500 dark:text-slate-400 dark:text-slate-400">
                            Loading configs for this board...
                        </div>
                    ) : configListError ? (
                        <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                            {configListError}
                        </div>
                    ) : configs.length === 0 ? (
                        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 px-6 py-10 text-center dark:border-slate-700 dark:bg-slate-900/60">
                            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                                <span className="material-symbols-outlined">inventory_2</span>
                            </div>
                            <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white dark:text-white">
                                No saved configs for this board yet
                            </h3>
                            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400 dark:text-slate-400">
                                Name the config on the right, then save it. It will appear here for future repair, reuse, and editing.
                            </p>
                        </div>
                    ) : (
                        <div className="mt-6 grid gap-4">
                            {configs.map((config) => {
                                const isSelected = config.id === selectedConfigId;
                                return (
                                    <button
                                        key={config.id}
                                        type="button"
                                        onClick={() => void onSelectConfig(config.id)}
                                        className={`rounded-2xl border p-5 text-left transition ${isSelected
                                            ? "border-primary bg-primary/5 shadow-sm dark:bg-primary/10"
                                            : "border-border-light dark:border-border-dark bg-slate-50 dark:bg-slate-800/50 hover:border-primary/40 hover:bg-surface-light dark:bg-surface-dark dark:border-slate-800 dark:bg-slate-950/40 dark:hover:border-primary/50"
                                            }`}
                                    >
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <h3 className="text-base font-semibold text-slate-900 dark:text-white dark:text-white">
                                                        {config.name}
                                                    </h3>
                                                    {isSelected ? (
                                                        <span className="rounded-full bg-primary px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
                                                            {selectedConfigMode === "template" ? "Template" : "Active"}
                                                        </span>
                                                    ) : null}
                                                </div>
                                                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 dark:text-slate-400">
                                                    Updated {formatTimestamp(config.updatedAt, timezone)}
                                                </p>
                                            </div>
                                            <div className="rounded-2xl bg-slate-100 dark:bg-slate-800 px-3 py-2 text-right dark:bg-slate-800">
                                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 dark:text-slate-400">
                                                    GPIO Maps
                                                </p>
                                                <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white dark:text-white">
                                                    {config.pinCount}
                                                </p>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </section>

                <aside className="flex flex-col gap-6 rounded-3xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
                    <div>
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white dark:text-white">Config Workspace</h2>
                        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400 dark:text-slate-400">
                            Every new device must be saved under an explicit config name. Loading a library item copies it into this workspace as a template until you save the new config.
                        </p>
                    </div>

                    <label className="flex flex-col gap-2">
                        <span className="text-sm font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 dark:text-slate-300">
                            Config Name
                        </span>
                        <input
                            value={projectName}
                            onChange={(event) => setProjectName(event.target.value)}
                            className="w-full rounded-2xl border-2 border-border-light dark:border-border-dark bg-slate-50 dark:bg-slate-800/50 px-4 py-3 text-base text-slate-900 dark:text-white outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-800 dark:bg-slate-950/60 dark:text-white"
                            placeholder={`${board.name} Relay Config`}
                        />
                    </label>

                    <div className="rounded-2xl border border-border-light dark:border-border-dark bg-slate-50 dark:bg-slate-800/50 p-4 dark:border-slate-800 dark:bg-slate-950/50">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 dark:text-slate-400">
                            Sync Status
                        </p>
                        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400 dark:text-slate-300">
                            {projectSyncMessage}
                        </p>
                    </div>

                    <div className="grid gap-3">
                        <button
                            type="button"
                            onClick={() => void onSaveConfig()}
                            disabled={projectSyncState === "saving" || !projectName.trim()}
                            className="rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {projectSyncState === "saving"
                                ? "Saving..."
                                : hasSavedConfig
                                    ? "Save Current Config"
                                    : "Create Config"}
                        </button>

                        {hasSavedConfig ? (
                            <button
                                type="button"
                                onClick={() => void onSaveAsNewConfig()}
                                disabled={projectSyncState === "saving" || !projectName.trim()}
                                className="rounded-2xl border border-slate-300 dark:border-slate-600 px-5 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 transition hover:bg-slate-100 dark:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                                Save as New Config
                            </button>
                        ) : null}
                    </div>

                    <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 px-4 py-4 text-sm leading-6 text-slate-500 dark:text-slate-400 dark:border-slate-700 dark:text-slate-400">
                        {selectedConfigMode === "saved"
                            ? "This config is ready. Continue to pin mapping to edit the selected board setup."
                            : selectedConfigMode === "template"
                                ? "This template can be cloned into the current project when you continue, or you can create it now to save the clone first."
                                : "Choose a saved config template or create one first. Pin editing stays locked until this board has an active saved config."}
                    </div>
                </aside>
            </div>

            <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
                <button
                    type="button"
                    onClick={onBack}
                    className="rounded-2xl border border-slate-300 dark:border-slate-600 px-6 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 transition hover:bg-slate-100 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                    Back to Boards
                </button>
                <button
                    type="button"
                    onClick={() => void onNext()}
                    disabled={!canContinue || projectSyncState === "saving"}
                    className="rounded-2xl bg-primary px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    Continue to Pin Mapping
                </button>
            </div>
        </div>
    );
}
