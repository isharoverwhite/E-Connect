import type { BoardProfile } from "../board-profiles";
import type {
    FirmwareUploadState,
    FlashSource,
    ProjectSyncState,
    ServerBuildState,
} from "../types";

export interface Step4FlashProps {
    board: BoardProfile;
    projectId: string | null;
    projectName: string;
    flashSource: FlashSource;
    setFlashSource: React.Dispatch<React.SetStateAction<FlashSource>>;
    uploadState: FirmwareUploadState;
    setUploadState: React.Dispatch<React.SetStateAction<FirmwareUploadState>>;
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
    onAcquireSerialLock: () => Promise<void>;
    onReleaseSerialLock: () => Promise<void>;
    onRefreshSerialStatus: () => Promise<void>;
    onLogPanelRef?: (element: HTMLDivElement | null) => void;
}

function toHex(value: number) {
    return `0x${value.toString(16).toUpperCase()}`;
}

function formatStatusLabel(value: ProjectSyncState | ServerBuildState["status"]) {
    return value.replace(/_/g, " ");
}

function getPillStyles(value: ProjectSyncState | ServerBuildState["status"]) {
    switch (value) {
        case "saved":
        case "artifact_ready":
        case "flashed":
            return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300";
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
            return "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300";
    }
}

function FirmwareFileInput({
    label,
    file,
    onChange,
}: {
    label: string;
    file: File | null;
    onChange: (file: File | null) => void;
}) {
    const inputId = `firmware-file-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

    return (
        <div className="flex flex-col gap-2">
            <label htmlFor={inputId} className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                {label}
            </label>
            <div className="relative">
                <input
                    id={inputId}
                    name={inputId}
                    type="file"
                    accept=".bin"
                    onChange={(event) => onChange(event.target.files?.[0] ?? null)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2 text-sm text-slate-500 transition-all file:mr-4 file:rounded-full file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary hover:file:bg-primary/20 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400 dark:file:bg-primary/20 dark:file:text-primary/90"
                />
                <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                    {file ? `${(file.size / 1024).toFixed(1)} KB` : "Max 4MB"}
                </div>
            </div>
        </div>
    );
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
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white"
                    : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
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
    uploadState,
    setUploadState,
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
    onAcquireSerialLock,
    onReleaseSerialLock,
    onRefreshSerialStatus,
    onLogPanelRef,
}: Step4FlashProps) {
    const previewLines = JSON.stringify(draftConfig, null, 2).split("\n");
    const readiness = getReadinessModel({
        flashSource,
        manifestUrl,
        flashLockedReason,
        serverBuildStatus: serverBuild.status,
        serialLocked,
    });
    const buildActionLabel = buildBusy
        ? "Queueing..."
        : hasActiveBuild
            ? "Build in Progress"
            : "Build on Server";

    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-primary font-semibold text-sm uppercase tracking-wider">
                    <span>Step 4 of 4</span>
                    <span className="h-px w-8 bg-primary"></span>
                </div>
                <h1 className="text-slate-900 dark:text-white text-4xl font-black leading-tight tracking-tight">
                    Flash Firmware
                </h1>
                <p className="text-slate-500 dark:text-slate-400 text-lg">
                    The SVG pin map is already persisted as a build config. From here we build the firmware, reserve serial access, and hand off a safe manifest to the browser flasher.
                </p>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-6 shadow-sm">
                <div className="flex flex-col gap-6">
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${getPillStyles(serverBuild.status)}`}>
                                    {formatStatusLabel(serverBuild.status)}
                                </span>
                                <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${getPillStyles(projectSyncState)}`}>
                                    {formatStatusLabel(projectSyncState)}
                                </span>
                                {projectId && (
                                    <span className="rounded-full border border-slate-200 px-3 py-1 font-mono text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
                                        project {projectId.slice(0, 8)}
                                    </span>
                                )}
                                {serverBuild.jobId && (
                                    <span className="rounded-full border border-slate-200 px-3 py-1 font-mono text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
                                        job {serverBuild.jobId.slice(0, 8)}
                                    </span>
                                )}
                            </div>
                            <p className="text-slate-900 dark:text-white text-base font-semibold">
                                {readiness.headline}
                            </p>
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                {readiness.detail}
                            </p>
                            {serverBuild.updatedAt && (
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    Last build update: {new Date(serverBuild.updatedAt).toLocaleString()}
                                </p>
                            )}
                        </div>
                        <p className="text-primary text-3xl font-black leading-none">{readiness.progress}%</p>
                    </div>

                    <div className="w-full h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
                            style={{ width: `${readiness.progress}%` }}
                        ></div>
                    </div>

                    <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-slate-500 dark:text-slate-400 flex items-center gap-2">
                            <span className="material-symbols-outlined text-sm">memory</span>
                            {readiness.subline}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400">{projectSyncMessage}</span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.92fr_1.08fr]">
                <div className="flex flex-col gap-6">
                    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
                        <div className="flex flex-col gap-3">
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">Firmware Source</h3>
                                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                                        Choose how this project should supply firmware to the Web Serial handoff.
                                    </p>
                                </div>
                                <button
                                    onClick={() => void generateConfig()}
                                    disabled={configBusy}
                                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
                                >
                                    <span className="material-symbols-outlined text-base">download</span>
                                    {configBusy ? "Exporting..." : "Export Config"}
                                </button>
                            </div>

                            <div className="flex gap-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-950">
                                <SourceButton active={flashSource === "server"} onClick={() => setFlashSource("server")}>
                                    Server Build
                                </SourceButton>
                                {board.demoFirmware && (
                                    <SourceButton active={flashSource === "demo"} onClick={() => setFlashSource("demo")}>
                                        Bundled Demo
                                    </SourceButton>
                                )}
                                <SourceButton active={flashSource === "upload"} onClick={() => setFlashSource("upload")}>
                                    Upload Custom Build
                                </SourceButton>
                            </div>
                        </div>

                        <div className="mt-5">
                            {flashSource === "server" && (
                                <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950">
                                    <div className="space-y-2">
                                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                            Build the current GPIO mapping on the server
                                        </p>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">
                                            The server compiles the current SVG mapping into a `.bin` artifact and exposes logs plus a traceable job id.
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
                                            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
                                        >
                                            <span className="material-symbols-outlined text-base">sync</span>
                                            Refresh
                                        </button>
                                        <button
                                            onClick={onDownloadArtifact}
                                            disabled={!serverBuild.artifactUrl}
                                            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
                                        >
                                            <span className="material-symbols-outlined text-base">download</span>
                                            Download .bin
                                        </button>
                                    </div>

                                    {serverBuild.warnings.length > 0 && (
                                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                                            <div className="mb-2 flex items-center gap-2 font-semibold">
                                                <span className="material-symbols-outlined text-base">report</span>
                                                Validation warnings
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
                                <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950">
                                    <div className="flex items-start gap-3">
                                        <span className="material-symbols-outlined mt-1 text-primary">firmware</span>
                                        <div>
                                            <h4 className="font-bold text-slate-900 dark:text-white">{board.demoFirmware.title}</h4>
                                            {board.demoFirmware.notes.map((note) => (
                                                <p key={note} className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                                                    {note}
                                                </p>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 font-mono text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                                        {board.demoFirmware.parts.map((part) => (
                                            <div
                                                key={part.path}
                                                className="flex items-center justify-between border-b border-slate-200 pb-2 last:border-0 last:pb-0 dark:border-slate-800"
                                            >
                                                <span className="text-slate-700 dark:text-slate-300">{part.label}</span>
                                                <span className="font-semibold">{toHex(part.offset)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {flashSource === "upload" && (
                                <div className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950">
                                    <FirmwareFileInput
                                        label="Bootloader (.bin)"
                                        file={uploadState.bootloader}
                                        onChange={(file) => setUploadState((previous) => ({ ...previous, bootloader: file }))}
                                    />
                                    <FirmwareFileInput
                                        label="Partitions (.bin)"
                                        file={uploadState.partitions}
                                        onChange={(file) => setUploadState((previous) => ({ ...previous, partitions: file }))}
                                    />
                                    <FirmwareFileInput
                                        label="Firmware App (.bin)"
                                        file={uploadState.firmware}
                                        onChange={(file) => setUploadState((previous) => ({ ...previous, firmware: file }))}
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
                        <div className="flex flex-col gap-2">
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Serial Coordination</h3>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                Reserve the USB serial port before flashing so build jobs and browser serial sessions never compete for the same device.
                            </p>
                        </div>

                        <label htmlFor="serial-port-label" className="mt-5 flex flex-col gap-2">
                            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Port label</span>
                            <input
                                id="serial-port-label"
                                name="serialPort"
                                value={serialPort}
                                onChange={(event) => setSerialPort(event.target.value)}
                                placeholder="/dev/ttyUSB0 or COM3"
                                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition-colors focus:border-primary dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                            />
                        </label>

                        <div className="mt-4 flex flex-wrap gap-2">
                            <button
                                onClick={onAcquireSerialLock}
                                disabled={serialBusy}
                                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <span className="material-symbols-outlined text-base">
                                    {serialBusy ? "autorenew" : "usb"}
                                </span>
                                {serialBusy ? "Updating..." : serialLocked ? "Renew Lock" : "Reserve Port"}
                            </button>
                            <button
                                onClick={onRefreshSerialStatus}
                                disabled={serialBusy}
                                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                                <span className="material-symbols-outlined text-base">sync</span>
                                Refresh Status
                            </button>
                            <button
                                onClick={onReleaseSerialLock}
                                disabled={serialBusy || !serialLocked}
                                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                                <span className="material-symbols-outlined text-base">lock_open</span>
                                Release
                            </button>
                        </div>

                        <div className={`mt-4 rounded-xl border p-4 text-sm ${
                            serialLocked
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
                                : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
                        }`}>
                            <p className="font-semibold">{serialLocked ? "Port reserved" : "Port not reserved"}</p>
                            <p className="mt-1">{serialMessage}</p>
                            {serialJobId && (
                                <p className="mt-2 font-mono text-xs uppercase tracking-[0.18em]">
                                    build {serialJobId.slice(0, 8)}
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

                    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Web Flasher</h3>
                        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                            <p className="mb-2">
                                Ensure your ESP32 is connected via USB. The browser asks for serial permission only after the server-side guardrails confirm the manifest and port reservation are safe.
                            </p>
                            <label htmlFor="erase-all-flash" className="mt-4 flex cursor-pointer items-center gap-3">
                                <input
                                    id="erase-all-flash"
                                    name="eraseAllFlash"
                                    type="checkbox"
                                    checked={eraseFirst}
                                    onChange={(event) => setEraseFirst(event.target.checked)}
                                    className="h-5 w-5 cursor-pointer rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900"
                                />
                                <span className="font-medium text-slate-700 dark:text-slate-300">
                                    Erase all flash before installing
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
                                <div className="flex items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 p-6 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                                    <esp-web-install-button
                                        manifest={manifestUrl ?? undefined}
                                        erase-first={eraseFirst ? "true" : undefined}
                                    />
                                </div>
                                {manifestUrl && (
                                    <a
                                        href={manifestUrl}
                                        download="manifest.json"
                                        className="text-center text-xs text-slate-500 transition-colors hover:text-primary hover:underline"
                                    >
                                        Download Generated Manifest
                                    </a>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex flex-col gap-6">
                    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/50">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Build Config</h3>
                                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                                    This is the exported JSON generated from the SVG mapping and stored on the server as the build source of truth.
                                </p>
                            </div>
                            <span className="rounded-full border border-slate-200 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:border-slate-800 dark:text-slate-400">
                                {projectName || board.name}
                            </span>
                        </div>
                        <div className="mt-5 rounded-xl border border-slate-200 bg-[#1e1e1e] dark:border-slate-800 overflow-hidden">
                            <div className="flex items-center justify-between border-b border-[#333] bg-[#252526] px-4 py-2">
                                <span className="text-xs font-mono text-gray-400 flex items-center gap-2">
                                    <span className="material-symbols-outlined text-sm text-yellow-500">description</span>
                                    device_config.json
                                </span>
                                <span className="text-[10px] text-gray-500 uppercase font-semibold">Read Only</span>
                            </div>
                            <div className="max-h-[340px] overflow-auto p-4">
                                <pre className="font-mono text-xs leading-6 text-slate-200 whitespace-pre-wrap">
                                    {previewLines.join("\n")}
                                </pre>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-950 overflow-hidden shadow-2xl dark:border-slate-800">
                        <div className="bg-slate-900 px-4 py-2 border-b border-slate-800 flex items-center justify-between">
                            <div className="flex gap-1.5">
                                <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/40"></div>
                                <div className="w-3 h-3 rounded-full bg-amber-500/20 border border-amber-500/40"></div>
                                <div className="w-3 h-3 rounded-full bg-emerald-500/20 border border-emerald-500/40"></div>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="text-[10px] text-slate-500 font-mono uppercase tracking-widest">
                                    Console Output
                                </span>
                                <button
                                    onClick={onRefreshBuild}
                                    disabled={!serverBuild.jobId}
                                    className="text-xs font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Refresh
                                </button>
                            </div>
                        </div>

                        {/* Status banner strip */}
                        {serverBuild.status === "artifact_ready" && (
                            <div className="flex items-center gap-2 border-b border-emerald-800/40 bg-emerald-950/60 px-4 py-2 text-xs font-semibold text-emerald-300">
                                <span className="material-symbols-outlined text-base text-emerald-400">check_circle</span>
                                Build succeeded — .bin artifact is ready for download.
                            </div>
                        )}
                        {serverBuild.status === "build_failed" && (
                            <div className="flex items-start gap-2 border-b border-rose-800/40 bg-rose-950/60 px-4 py-2 text-xs font-semibold text-rose-300">
                                <span className="material-symbols-outlined text-base text-rose-400">error</span>
                                <span>
                                    Build failed.
                                    {serverBuild.errorMessage
                                        ? ` ${serverBuild.errorMessage}`
                                        : " Inspect the log below for details."}
                                </span>
                            </div>
                        )}
                        {(serverBuild.status === "building" || serverBuild.status === "queued") && (
                            <div className="flex items-center gap-2 border-b border-amber-800/40 bg-amber-950/40 px-4 py-2 text-xs font-semibold text-amber-300">
                                <span className="material-symbols-outlined animate-spin text-base text-amber-400">progress_activity</span>
                                {serverBuild.status === "queued" ? "Build queued on server…" : "Build in progress — logs are streaming live…"}
                            </div>
                        )}

                        <div
                            ref={onLogPanelRef}
                            className="h-[520px] overflow-y-auto p-4 font-mono text-sm bg-black/40"
                        >
                            <pre className="whitespace-pre-wrap text-slate-300">
                                {serverBuild.logs ||
                                    "Build logs will stream here after the server build starts.\n\nUse this console to inspect PlatformIO output, warnings, and generated artifact status."}
                            </pre>
                        </div>
                        <div className="border-t border-slate-800 px-4 py-3 text-xs text-slate-500">
                            Server builds currently expose the application binary at {toHex(65536)}.
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex justify-start border-t border-slate-200 pt-6 dark:border-slate-800">
                <button
                    onClick={onBack}
                    className="rounded-lg border border-slate-200 px-6 py-2.5 font-bold text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                    Back to Validation
                </button>
            </div>
        </div>
    );
}

function getReadinessModel({
    flashSource,
    manifestUrl,
    flashLockedReason,
    serverBuildStatus,
    serialLocked,
}: {
    flashSource: FlashSource;
    manifestUrl: string | null;
    flashLockedReason: string | null;
    serverBuildStatus: ServerBuildState["status"];
    serialLocked: boolean;
}) {
    if (serverBuildStatus === "flashed") {
        return {
            progress: 100,
            headline: "Flash completed",
            detail: "The server artifact has already been flashed successfully.",
            subline: "Firmware handoff complete",
        };
    }

    if (flashSource === "server") {
        switch (serverBuildStatus) {
            case "queued":
            case "draft_config":
            case "validated":
                return {
                    progress: 32,
                    headline: "Build queued on the server",
                    detail: "The persisted SVG config has been accepted and is waiting for compilation.",
                    subline: "Waiting for PlatformIO worker",
                };
            case "building":
                return {
                    progress: 64,
                    headline: "Building firmware on the server",
                    detail: "The current GPIO config is being converted into firmware and durable artifacts.",
                    subline: "Compiling generated code",
                };
            case "artifact_ready":
                if (serialLocked && manifestUrl && !flashLockedReason) {
                    return {
                        progress: 100,
                        headline: "Ready for web flashing",
                        detail: "Artifact, manifest, and serial reservation are all in place. You can open the browser flasher below.",
                        subline: "Guardrails satisfied",
                    };
                }

                return {
                    progress: 82,
                    headline: "Artifact ready",
                    detail: flashLockedReason || "The `.bin` artifact is ready. Reserve the serial port to unlock browser flashing.",
                    subline: "Binary ready at 0x10000",
                };
            case "build_failed":
            case "flash_failed":
            case "cancelled":
                return {
                    progress: 18,
                    headline: "Action required",
                    detail: flashLockedReason || "Inspect the build log, adjust the config, then retry the server build.",
                    subline: "Build pipeline blocked",
                };
            default:
                break;
        }
    }

    if (manifestUrl && serialLocked && !flashLockedReason) {
        return {
            progress: 100,
            headline: "Ready for web flashing",
            detail: "The selected firmware bundle is ready and the serial port is reserved.",
            subline: "Manifest and port ready",
        };
    }

    if (manifestUrl) {
        return {
            progress: 76,
            headline: "Firmware bundle prepared",
            detail: flashLockedReason || "Reserve the serial port to continue to the browser flasher.",
            subline: "Waiting for serial coordination",
        };
    }

    return {
        progress: 22,
        headline: "Prepare the firmware bundle",
        detail: flashLockedReason || "Choose a source, export the config if needed, then build or upload firmware.",
        subline: "No flashable manifest yet",
    };
}
