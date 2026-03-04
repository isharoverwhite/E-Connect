import type { BoardProfile } from "../board-profiles";
import type { FirmwareUploadState } from "../types";

export interface Step4FlashProps {
    board: BoardProfile;
    projectName: string;
    flashSource: "demo" | "upload";
    setFlashSource: React.Dispatch<React.SetStateAction<"demo" | "upload">>;
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
}

function toHex(value: number) {
    return `0x${value.toString(16).toUpperCase()}`;
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
    return (
        <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{label}</span>
            <div className="relative">
                <input
                    type="file"
                    accept=".bin"
                    onChange={(event) => onChange(event.target.files?.[0] ?? null)}
                    className="w-full text-sm text-slate-500 dark:text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 dark:file:bg-primary/20 dark:file:text-primary/90 transition-all cursor-pointer border border-slate-200 dark:border-slate-800 rounded-xl p-2 bg-slate-50 dark:bg-slate-900/50"
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">
                    {file ? `${(file.size / 1024).toFixed(1)} KB` : "Max 4MB"}
                </div>
            </div>
        </div>
    );
}

export function Step4Flash({
    board,
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
}: Step4FlashProps) {
    return (
        <div className="flex flex-col gap-8 max-w-[960px] mx-auto w-full">
            <div className="flex flex-col gap-2">
                <h1 className="text-slate-900 dark:text-slate-100 text-3xl font-bold">Flash Firmware</h1>
                <p className="text-slate-600 dark:text-slate-400 text-sm">Upload configuration and firmware to your {board.name}.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left Column - Configuration & Binary setup */}
                <div className="flex flex-col gap-6">
                    <div className="rounded-xl border border-slate-200 bg-slate-900 overflow-hidden shadow-lg dark:border-slate-800">
                        <div className="flex justify-between items-center p-4 border-b border-slate-800 bg-slate-950">
                            <div className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full bg-rose-500"></span>
                                <span className="w-3 h-3 rounded-full bg-amber-500"></span>
                                <span className="w-3 h-3 rounded-full bg-green-500"></span>
                                <span className="ml-2 text-xs font-mono text-slate-500 uppercase tracking-wider">{projectName || "device"}.json</span>
                            </div>
                            <button
                                onClick={generateConfig}
                                disabled={configBusy || pinsLength === 0}
                                className="px-4 py-1.5 rounded bg-primary/20 text-primary text-xs font-bold uppercase tracking-wider hover:bg-primary/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                            >
                                <span className="material-symbols-outlined text-sm">{configBusy ? "autorenew" : "download"}</span>
                                {configBusy ? "Generating" : "Export JSON"}
                            </button>
                        </div>
                        <pre className="p-6 text-sm font-mono text-emerald-400 bg-slate-900 max-h-[300px] overflow-auto custom-scrollbar">
                            <code>{JSON.stringify(draftConfig, null, 2)}</code>
                        </pre>
                    </div>

                    <div className="flex flex-col gap-6 bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
                        <h3 className="font-bold text-slate-900 dark:text-white text-lg">Firmware Source</h3>
                        <div className="flex gap-2 p-1 bg-slate-100 dark:bg-slate-950 rounded-xl">
                            {board.demoFirmware && (
                                <button
                                    onClick={() => setFlashSource("demo")}
                                    className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${flashSource === "demo" ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}
                                >
                                    Bundled Demo
                                </button>
                            )}
                            <button
                                onClick={() => setFlashSource("upload")}
                                className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${flashSource === "upload" ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}
                            >
                                Upload Custom Build
                            </button>
                        </div>

                        {flashSource === "demo" && board.demoFirmware && (
                            <div className="flex flex-col gap-4">
                                <div className="flex items-start gap-4 p-4 rounded-xl bg-primary/5 dark:bg-primary/10 border border-primary/20">
                                    <span className="material-symbols-outlined text-primary mt-1">firmware</span>
                                    <div className="flex flex-col">
                                        <h4 className="font-bold text-slate-900 dark:text-white mb-1">{board.demoFirmware.title}</h4>
                                        {board.demoFirmware.notes.map((note, i) => (
                                            <p key={i} className="text-sm text-slate-600 dark:text-slate-400">{note}</p>
                                        ))}
                                    </div>
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 p-4 font-mono text-sm text-slate-600 dark:text-slate-400 space-y-2">
                                    {board.demoFirmware.parts.map((part) => (
                                        <div key={part.path} className="flex justify-between items-center border-b border-slate-200 dark:border-slate-800 pb-2 last:border-0 last:pb-0">
                                            <span className="text-slate-700 dark:text-slate-300">{part.label}</span>
                                            <span className="font-semibold">{toHex(part.offset)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {flashSource === "upload" && (
                            <div className="flex flex-col gap-5">
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

                {/* Right Column - Install button and console */}
                <div className="flex flex-col gap-6">
                    <div className="bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col gap-6">
                        <h3 className="font-bold text-slate-900 dark:text-white text-lg">Web Flasher</h3>

                        <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 text-sm text-slate-600 dark:text-slate-400">
                            <p className="mb-2">Ensure your ESP32 is connected via USB. The browser will request permission to access the serial port.</p>
                            <label className="flex items-center gap-3 mt-4 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={eraseFirst}
                                    onChange={(event) => setEraseFirst(event.target.checked)}
                                    className="w-5 h-5 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-700 dark:bg-slate-900 cursor-pointer"
                                />
                                <span className="font-medium text-slate-700 dark:text-slate-300">Erase all flash before installing</span>
                            </label>
                        </div>

                        {flashLockedReason ? (
                            <div className="p-4 rounded-xl bg-rose-50 text-rose-600 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20 text-sm font-medium flex gap-3 items-start">
                                <span className="material-symbols-outlined text-rose-500">warning</span>
                                <p>{flashLockedReason}</p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-4">
                                <div className="p-6 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl flex items-center justify-center">
                                    <esp-web-install-button
                                        manifest={manifestUrl ?? undefined}
                                        erase-first={eraseFirst ? "true" : undefined}
                                    />
                                </div>
                                {manifestUrl && (
                                    <a
                                        href={manifestUrl}
                                        download="manifest.json"
                                        className="text-xs text-center text-slate-500 hover:text-primary transition-colors hover:underline"
                                    >
                                        Download Generated Manifest (Local Dev Only)
                                    </a>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="pt-6 border-t border-slate-200 dark:border-slate-800 flex justify-start">
                <button onClick={onBack} className="px-6 py-2.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                    Back to Validation
                </button>
            </div>
        </div>
    );
}
