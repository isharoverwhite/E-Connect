import type { PinMode } from "@/types/device";
import { type BoardPin, type BoardProfile } from "../board-profiles";
import { type PinMapping, PIN_FILL, type ProjectSyncState } from "../types";

export interface Step2PinsProps {
    pins: PinMapping[];
    setPins: React.Dispatch<React.SetStateAction<PinMapping[]>>;
    board: BoardProfile;
    boardPins: BoardPin[];
    selectedPinId: string | null;
    setSelectedPinId: React.Dispatch<React.SetStateAction<string | null>>;
    projectName: string;
    draftConfig: Record<string, unknown>;
    configBusy: boolean;
    projectSyncState: ProjectSyncState;
    projectSyncMessage: string;
    onExportConfig: () => Promise<void>;
    onNext: () => void;
    onBack: () => void;
}

export function Step2Pins({
    pins,
    setPins,
    board,
    boardPins,
    selectedPinId,
    setSelectedPinId,
    projectName,
    draftConfig,
    configBusy,
    projectSyncState,
    projectSyncMessage,
    onExportConfig,
    onNext,
    onBack,
}: Step2PinsProps) {
    const handlePinSelection = (pin: BoardPin) => {
        setSelectedPinId(pin.id);
    };

    const handleModeChange = (pin: BoardPin, mode: PinMode) => {
        // Find and update or insert
        const existing = pins.find(p => p.gpio_pin === pin.gpio);
        const newLabel = existing?.label || `${projectName.split(" ")[0] || "Node"} ${pin.label}`;

        const nextMapping: PinMapping = {
            gpio_pin: pin.gpio,
            mode,
            function: existing?.function || "",
            label: newLabel,
        };

        setPins((previous) =>
            [...previous.filter((mapping) => mapping.gpio_pin !== pin.gpio), nextMapping].sort(
                (left, right) => left.gpio_pin - right.gpio_pin,
            ),
        );
    };

    const handleFunctionChange = (pin: BoardPin, functionName: string) => {
        setPins((previous) => {
            const existing = previous.find(p => p.gpio_pin === pin.gpio);
            if (!existing) return previous;
            const newMapping = { ...existing, function: functionName };
            return [...previous.filter((mapping) => mapping.gpio_pin !== pin.gpio), newMapping].sort(
                (left, right) => left.gpio_pin - right.gpio_pin,
            );
        });
    };

    const clearAll = () => {
        if (confirm("Are you sure you want to clear all pin assignments?")) {
            setPins([]);
            setSelectedPinId(null);
        }
    };


    const totalRows = Math.max(board.leftPins.length, board.rightPins.length);
    const boardHeight = Math.max(420, totalRows * 34 + 120);
    const svgHeight = boardHeight + 120;
    const top = 110;
    const bottom = boardHeight - 70;
    const gap = totalRows === 1 ? 0 : (bottom - top) / (totalRows - 1);
    const previewLines = JSON.stringify(draftConfig, null, 2).split("\n");

    return (
        <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-2">
                <h1 className="text-slate-900 dark:text-slate-100 text-4xl font-extrabold tracking-tight">Configure Pins</h1>
                <p className="text-slate-600 dark:text-slate-400 text-lg">Assign specific roles and functions to the available GPIO pins for {board.name}.</p>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
                {/* Left pane - SVG Board */}
                <div className="xl:col-span-7 flex flex-col gap-6">
                    <div className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
                        <h3 className="text-slate-900 dark:text-slate-100 text-xl font-bold mb-6 flex items-center gap-2">
                            <span className="material-symbols-outlined text-primary">grid_view</span>
                            Visual Pinout Diagram
                        </h3>

                        <div className="relative w-full rounded-lg flex items-center justify-center overflow-hidden group bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.08),_transparent_45%),linear-gradient(180deg,#0b1120_0%,#111827_100%)] p-6 shadow-inner dark:border-slate-800">
                            <svg
                                viewBox={`0 0 720 ${svgHeight}`}
                                className="w-full"
                                role="img"
                                aria-label={`${board.name} SVG GPIO mapping board`}
                            >
                                <defs>
                                    <linearGradient id="boardShell" x1="0%" x2="100%" y1="0%" y2="100%">
                                        <stop offset="0%" stopColor="#1e293b" />
                                        <stop offset="100%" stopColor="#0f172a" />
                                    </linearGradient>
                                    <linearGradient id="chipShell" x1="0%" x2="100%" y1="0%" y2="100%">
                                        <stop offset="0%" stopColor="#334155" />
                                        <stop offset="100%" stopColor="#0f172a" />
                                    </linearGradient>
                                    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                                        <feGaussianBlur stdDeviation="3" result="blur" />
                                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                                    </filter>
                                </defs>

                                {board.id === 'esp32-c3-super-mini' ? (
                                    <g id="super-mini-artwork" transform="translate(190, 50)">
                                        <rect x="0" y="0" width="340" height={boardHeight} rx="12" fill="#151515" stroke="#333333" strokeWidth="4" />

                                        {/* USB-C Connector */}
                                        <path d="M 130 -10 L 210 -10 L 210 0 L 130 0 Z" fill="#a0a0a0" stroke="#666" strokeWidth="2" />
                                        <path d="M 140 -20 L 200 -20 L 200 -10 L 140 -10 Z" fill="#111" />

                                        {/* Antenna Trace */}
                                        <path d="M 120 20 L 220 20 M 120 30 L 250 30 M 120 40 L 220 40" stroke="#bda25c" strokeWidth="4" fill="none" />

                                        {/* Buttons */}
                                        <rect x="80" y="60" width="16" height="24" fill="#333" rx="2" />
                                        <rect x="244" y="60" width="16" height="24" fill="#333" rx="2" />

                                        {/* Text V1601 */}
                                        <text x="170" y="120" fill="#666" fontSize="14" fontFamily="monospace" textAnchor="middle">V1601</text>

                                        {/* ESP32-C3 Label */}
                                        <rect x="110" y="140" width="120" height="24" fill="#fff" rx="2" />
                                        <text x="170" y="157" fill="#000" fontSize="16" fontWeight="bold" fontFamily="monospace" textAnchor="middle">ESP32-C3</text>

                                        {/* Super Mini Label */}
                                        <rect x="110" y="180" width="120" height="24" fill="#fff" rx="2" />
                                        <text x="170" y="197" fill="#000" fontSize="16" fontWeight="bold" fontFamily="monospace" textAnchor="middle">Super Mini</text>

                                        {/* Built-in LED */}
                                        <circle cx="280" cy="180" r="6" fill="#3498db" filter="url(#glow)" />
                                        <text x="280" y="200" fill="#3498db" fontSize="12" textAnchor="middle" fontWeight="bold">LED (Pin 8)</text>

                                        {/* Highlight Path connecting LED to Pin 8 (index 3 on right -> y = gap * 3) */}
                                        <path d={`M 340 ${gap * 3 + 60} Q 280 ${gap * 3 + 60} 280 186`} stroke="#3498db" strokeWidth="2" strokeDasharray="4,4" fill="none" opacity="0.6" />

                                        <text
                                            x="170"
                                            y={boardHeight + 20}
                                            fill="#64748b"
                                            textAnchor="middle"
                                            fontSize="12"
                                            fontFamily="monospace"
                                        >
                                            Click a pin to configure its role
                                        </text>
                                    </g>
                                ) : (
                                    <>
                                        <rect
                                            x="190"
                                            y="50"
                                            width="340"
                                            height={boardHeight}
                                            rx="40"
                                            fill="#1e293b"
                                            stroke="#334155"
                                            strokeWidth="4"
                                        />
                                        <rect
                                            x="260"
                                            y="150"
                                            width="200"
                                            height="180"
                                            rx="20"
                                            fill="#334155"
                                            stroke="#475569"
                                            strokeWidth="2"
                                        />
                                        <text
                                            x="360"
                                            y="220"
                                            fill="#e2e8f0"
                                            textAnchor="middle"
                                            fontSize="18"
                                            fontWeight="700"
                                        >
                                            {board.family}
                                        </text>
                                        <text
                                            x="360"
                                            y="254"
                                            fill="#94a3b8"
                                            textAnchor="middle"
                                            fontSize="14"
                                            fontFamily="monospace"
                                        >
                                            {board.chipLabel}
                                        </text>
                                        <text
                                            x="360"
                                            y={boardHeight + 20}
                                            fill="#64748b"
                                            textAnchor="middle"
                                            fontSize="12"
                                            fontFamily="monospace"
                                        >
                                            Click a pin to configure its role
                                        </text>
                                    </>
                                )}

                                {board.leftPins.map((pin, index) =>
                                    renderSvgPin({
                                        pin,
                                        index,
                                        totalRows,
                                        side: "left",
                                        boardHeight,
                                        isSelected: selectedPinId === pin.id,
                                        assignment: pins.find((mapping) => mapping.gpio_pin === pin.gpio),
                                        onSelect: handlePinSelection,
                                    })
                                )}
                                {board.rightPins.map((pin, index) =>
                                    renderSvgPin({
                                        pin,
                                        index,
                                        totalRows,
                                        side: "right",
                                        boardHeight,
                                        isSelected: selectedPinId === pin.id,
                                        assignment: pins.find((mapping) => mapping.gpio_pin === pin.gpio),
                                        onSelect: handlePinSelection,
                                    })
                                )}
                            </svg>

                            <div className="absolute bottom-4 right-4 bg-background-dark/80 backdrop-blur-md border border-slate-700 px-3 py-1.5 rounded-lg text-xs text-slate-300">
                                Model: {board.name}
                            </div>
                        </div>

                        <div className="mt-5 grid gap-3 sm:grid-cols-4">
                            <LegendItem color="bg-yellow-400" label="Available GPIO" />
                            <LegendItem color="bg-green-500" label="Mapped pin" />
                            <LegendItem color="bg-blue-500" label="Selected pin" />
                            <LegendItem color="bg-slate-400" label="Reserved" />
                        </div>
                    </div>

                    <div className="flex items-center justify-between bg-primary/10 border border-primary/20 p-4 rounded-xl">
                        <div className="flex items-center gap-3">
                            <span className="material-symbols-outlined text-primary">info</span>
                            <p className="text-sm text-slate-700 dark:text-slate-300">Unassigned pins will default to High-Z state.</p>
                        </div>
                        <button onClick={clearAll} className="text-primary text-sm font-bold hover:underline">Clear All</button>
                    </div>
                </div>

                {/* Right pane - Pin Assignments */}
                <div className="xl:col-span-5 flex flex-col gap-4">
                    <div className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
                        <div className="mb-6 flex items-center justify-between gap-4">
                            <div>
                                <h3 className="text-slate-900 dark:text-slate-100 text-xl font-bold">Pin Assignment</h3>
                                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                    Click a pad on the SVG board, then assign its role and label here.
                                </p>
                            </div>
                            <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${getSyncStyles(projectSyncState)}`}>
                                {formatSyncState(projectSyncState)}
                            </span>
                        </div>
                        <div className="flex flex-col gap-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                            {boardPins.filter(pin => pin.capabilities.length > 0 && !pin.reserved).map(pin => {
                                const assignment = pins.find(p => p.gpio_pin === pin.gpio);
                                const isSelected = selectedPinId === pin.id;

                                return (
                                    <div key={pin.id} className={`flex flex-col gap-2 p-2 rounded-lg transition-colors ${isSelected ? 'bg-primary/5 border border-primary/20' : ''}`} onClick={() => setSelectedPinId(pin.id)}>
                                        <div className="flex justify-between items-center px-1">
                                            <label className={`text-xs font-bold uppercase tracking-widest ${isSelected ? 'text-primary' : 'text-slate-500 dark:text-slate-400'}`}>
                                                {pin.label} (GPIO {pin.gpio})
                                            </label>
                                            {pin.bootSensitive && (
                                                <span className="text-[10px] text-amber-500 font-bold uppercase tracking-widest bg-amber-500/10 px-2 py-0.5 rounded">Boot</span>
                                            )}
                                        </div>

                                        <div className="flex gap-2">
                                            <div className="relative flex-1">
                                                <select
                                                    id={`pin-mode-${pin.gpio}`}
                                                    name={`pin-mode-${pin.gpio}`}
                                                    aria-label={`${pin.label} mode`}
                                                    value={assignment?.mode || "none"}
                                                    onChange={(e) => {
                                                        if (e.target.value === "none") {
                                                            setPins(prev => prev.filter(p => p.gpio_pin !== pin.gpio));
                                                        } else {
                                                            handleModeChange(pin, e.target.value as PinMode);
                                                        }
                                                    }}
                                                    className={`w-full bg-slate-100 dark:bg-slate-800 border-none rounded-lg text-sm text-slate-900 dark:text-slate-100 py-3 pl-10 pr-4 focus:ring-2 focus:ring-primary appearance-none cursor-pointer ${assignment ? 'font-medium text-primary' : ''}`}
                                                >
                                                    <option value="none">Disabled</option>
                                                    {pin.capabilities.map(cap => (
                                                        <option key={cap} value={cap}>{cap}</option>
                                                    ))}
                                                </select>
                                                <span className={`material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-xl ${assignment ? 'text-primary' : 'text-slate-400'}`}>
                                                    {assignment?.mode === 'OUTPUT' || assignment?.mode === 'PWM' ? 'lightbulb' : assignment?.mode === 'INPUT' ? 'radio_button_checked' : assignment?.mode === 'ADC' ? 'sensors' : assignment?.mode === 'I2C' ? 'cable' : 'block'}
                                                </span>
                                                <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none text-sm">expand_more</span>
                                            </div>

                                            {assignment && (
                                                <div className="relative flex-1">
                                                    <input
                                                        id={`pin-function-${pin.gpio}`}
                                                        name={`pin-function-${pin.gpio}`}
                                                        aria-label={`${pin.label} function`}
                                                        value={assignment.function || ""}
                                                        onChange={(e) => handleFunctionChange(pin, e.target.value)}
                                                        placeholder="Function (e.g. relay)"
                                                        className="w-full bg-slate-100 dark:bg-slate-800 border-none rounded-lg text-sm text-slate-900 dark:text-slate-100 py-3 px-4 focus:ring-2 focus:ring-primary"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="bg-[#1e1e1e] rounded-xl shadow-lg border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col min-h-[360px]">
                        <div className="flex items-center justify-between px-4 py-2 bg-[#252526] border-b border-[#333]">
                            <span className="text-xs font-mono text-gray-400 flex items-center gap-2">
                                <span className="material-symbols-rounded text-sm text-yellow-500">description</span>
                                device_config.json
                            </span>
                            <span className="text-[10px] text-gray-500 uppercase font-semibold">Read Only</span>
                        </div>
                        <div className="flex-1 relative font-mono text-xs overflow-auto code-scroll p-4 leading-6">
                            <div className="absolute left-0 top-4 bottom-0 w-8 text-right pr-2 text-gray-600 select-none">
                                {previewLines.map((_, index) => (
                                    <div key={index}>{index + 1}</div>
                                ))}
                            </div>
                            <pre className="pl-8 whitespace-pre-wrap text-slate-200">{previewLines.join("\n")}</pre>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900/50 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Deployment</h3>
                        <div className="space-y-3">
                            <button
                                onClick={onNext}
                                className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white py-3 rounded-lg font-medium transition-all shadow-md shadow-blue-500/20"
                            >
                                <span className="material-symbols-rounded">checklist</span>
                                Validate Wiring
                            </button>
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    onClick={() => void onExportConfig()}
                                    disabled={configBusy}
                                    className="flex items-center justify-center gap-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 py-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <span className="material-symbols-rounded text-sm">save</span>
                                    {configBusy ? "Exporting..." : "Save JSON"}
                                </button>
                                <button
                                    onClick={onBack}
                                    className="flex items-center justify-center gap-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 py-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors"
                                >
                                    <span className="material-symbols-rounded text-sm">arrow_back</span>
                                    Back
                                </button>
                            </div>
                        </div>
                        <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800">
                            <div className="flex items-center gap-3 mb-2">
                                <div className={`w-2 h-2 rounded-full ${projectSyncState === "saved" ? "bg-green-500" : projectSyncState === "saving" ? "bg-amber-500" : "bg-slate-300 dark:bg-slate-600"}`}></div>
                                <span className="text-xs text-slate-600 dark:text-slate-400 flex-1">{projectSyncMessage}</span>
                                {projectSyncState === "saved" && (
                                    <span className="material-symbols-rounded text-green-500 text-sm">check</span>
                                )}
                            </div>
                            <div className="flex items-center gap-3">
                                <div className={`w-2 h-2 rounded-full ${pins.length > 0 ? "bg-primary" : "bg-slate-300 dark:bg-slate-600"}`}></div>
                                <span className="text-xs text-slate-400 dark:text-slate-500 flex-1">
                                    {pins.length > 0 ? `${pins.length} pin mappings ready for validation` : "Waiting for at least one SVG pin assignment"}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function formatSyncState(value: ProjectSyncState) {
    return value.replace(/_/g, " ");
}

function getSyncStyles(value: ProjectSyncState) {
    switch (value) {
        case "saved":
            return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300";
        case "saving":
            return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300";
        case "error":
            return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300";
        default:
            return "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300";
    }
}

function LegendItem({ color, label }: { color: string; label: string }) {
    return (
        <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
            <span className={`h-3 w-3 rounded-full ${color}`}></span>
            {label}
        </div>
    );
}

function renderSvgPin({
    pin,
    index,
    totalRows,
    side,
    boardHeight,
    isSelected,
    assignment,
    onSelect,
}: {
    pin: BoardPin;
    index: number;
    totalRows: number;
    side: "left" | "right";
    boardHeight: number;
    isSelected: boolean;
    assignment?: PinMapping;
    onSelect: (pin: BoardPin) => void;
}) {
    const top = 110;
    const bottom = boardHeight - 70;
    const gap = totalRows === 1 ? 0 : (bottom - top) / (totalRows - 1);
    const y = top + gap * index;
    const isReserved = pin.reserved || pin.bootSensitive;
    const fill = isSelected
        ? PIN_FILL.selected
        : assignment
            ? PIN_FILL.assigned
            : isReserved
                ? PIN_FILL.reserved
                : PIN_FILL.idle;

    const stemStart = side === "left" ? 188 : 532;
    const stemEnd = side === "left" ? 154 : 566;
    const pinX = side === "left" ? 130 : 566;
    const labelX = side === "left" ? 112 : 608;
    const mappingTextX = side === "left" ? 94 : 626;
    const anchor = side === "left" ? "end" : "start";

    return (
        <g
            key={pin.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(pin)}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(pin);
                }
            }}
            className="cursor-pointer group"
        >
            <line x1={stemStart} x2={stemEnd} y1={y} y2={y} stroke="#475569" strokeWidth="3" />
            <rect
                x={pinX}
                y={y - 11}
                width="28"
                height="22"
                rx="6"
                fill={fill}
                stroke={isSelected ? "#bfdbfe" : "transparent"}
                strokeWidth="3"
                className="transition-colors group-hover:stroke-slate-400"
            />
            <text
                x={labelX}
                y={y + 5}
                fill={assignment ? "#f8fafc" : "#cbd5e1"}
                textAnchor={anchor}
                fontSize="14"
                fontWeight="700"
            >
                {pin.label}
            </text>
            <text
                x={mappingTextX}
                y={y + 24}
                fill={assignment ? "#93c5fd" : "#64748b"}
                textAnchor={anchor}
                fontSize="11"
                fontFamily="monospace"
            >
                {assignment ? `${assignment.mode} · ${assignment.label || `GPIO ${pin.gpio}`}` : `GPIO ${pin.gpio}`}
            </text>
        </g>
    );
}
