import type { BoardProfile } from "../board-profiles";
import type { ProjectSyncState } from "../types";

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
    hasSelectedConfig: boolean;
    selectedConfigId: string | null;
    projectSyncState: ProjectSyncState;
    projectSyncMessage: string;
    onSelectConfig: (configId: string) => Promise<void>;
    onSaveConfig: () => Promise<void>;
    onSaveAsNewConfig: () => Promise<void>;
    onBack: () => void;
    onNext: () => void;
}

function formatTimestamp(value: string) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return "Unknown update time";
    }

    return new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(parsed);
}

export function Step2Configs({
    board,
    projectName,
    setProjectName,
    configs,
    configsLoading,
    configListError,
    hasSelectedConfig,
    selectedConfigId,
    projectSyncState,
    projectSyncMessage,
    onSelectConfig,
    onSaveConfig,
    onSaveAsNewConfig,
    onBack,
    onNext,
}: Step2ConfigsProps) {
    return (
        <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-2">
                <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
                    Choose a Saved Config
                </h1>
                <p className="text-lg text-slate-600 dark:text-slate-400">
                    Saved configs are grouped per board profile. Load one for {board.name} or create a new config before editing GPIO mappings.
                </p>
            </div>

            <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.9fr)]">
                <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
                    <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
                        <div>
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Board Config Library</h2>
                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                {configs.length === 1 ? "1 saved config" : `${configs.length} saved configs`} for {board.name}
                            </p>
                        </div>
                        <span className="rounded-full bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
                            {board.family}
                        </span>
                    </div>

                    {configsLoading ? (
                        <div className="flex min-h-52 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
                            Loading configs for this board...
                        </div>
                    ) : configListError ? (
                        <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                            {configListError}
                        </div>
                    ) : configs.length === 0 ? (
                        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center dark:border-slate-700 dark:bg-slate-900/60">
                            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                                <span className="material-symbols-outlined">inventory_2</span>
                            </div>
                            <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">
                                No saved configs for this board yet
                            </h3>
                            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
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
                                            : "border-slate-200 bg-slate-50 hover:border-primary/40 hover:bg-white dark:border-slate-800 dark:bg-slate-950/40 dark:hover:border-primary/50"
                                            }`}
                                    >
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                                                        {config.name}
                                                    </h3>
                                                    {isSelected ? (
                                                        <span className="rounded-full bg-primary px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
                                                            Active
                                                        </span>
                                                    ) : null}
                                                </div>
                                                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                                    Updated {formatTimestamp(config.updatedAt)}
                                                </p>
                                            </div>
                                            <div className="rounded-2xl bg-slate-100 px-3 py-2 text-right dark:bg-slate-800">
                                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                                    GPIO Maps
                                                </p>
                                                <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
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

                <aside className="flex flex-col gap-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
                    <div>
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Config Workspace</h2>
                        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                            Give this board config a clear name, then save it. Later the same board will show this config in the repair list automatically.
                        </p>
                    </div>

                    <label className="flex flex-col gap-2">
                        <span className="text-sm font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                            Config Name
                        </span>
                        <input
                            value={projectName}
                            onChange={(event) => setProjectName(event.target.value)}
                            className="w-full rounded-2xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-800 dark:bg-slate-950/60 dark:text-white"
                            placeholder={`${board.name} Relay Config`}
                        />
                    </label>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                            Sync Status
                        </p>
                        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
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
                                : hasSelectedConfig
                                    ? "Save Current Config"
                                    : "Create Config"}
                        </button>

                        {hasSelectedConfig ? (
                            <button
                                type="button"
                                onClick={() => void onSaveAsNewConfig()}
                                disabled={projectSyncState === "saving" || !projectName.trim()}
                                className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                                Save as New Config
                            </button>
                        ) : null}
                    </div>

                    <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-4 text-sm leading-6 text-slate-500 dark:border-slate-700 dark:text-slate-400">
                        {hasSelectedConfig
                            ? "This config is ready. Continue to pin mapping to edit the selected board setup."
                            : "Choose a saved config or create one first. Pin editing stays locked until this board has an active saved config."}
                    </div>
                </aside>
            </div>

            <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
                <button
                    type="button"
                    onClick={onBack}
                    className="rounded-2xl border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                    Back to Boards
                </button>
                <button
                    type="button"
                    onClick={onNext}
                    disabled={!hasSelectedConfig}
                    className="rounded-2xl bg-primary px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    Continue to Pin Mapping
                </button>
            </div>
        </div>
    );
}
