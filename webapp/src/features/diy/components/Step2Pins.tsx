import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import type { PinMode } from "@/types/device";
import { getToken } from "@/lib/auth";
import { type BoardPin, type BoardProfile } from "../board-profiles";
import { type PinMapping, PIN_FILL, type ProjectSyncState, type I2CLibrary } from "../types";

export interface Step2PinsProps {
    pins: PinMapping[];
    setPins: React.Dispatch<React.SetStateAction<PinMapping[]>>;
    board: BoardProfile;
    boardPins: BoardPin[];
    selectedPinId: string | null;
    setSelectedPinId: React.Dispatch<React.SetStateAction<string | null>>;
    projectName: string;
    configBusy: boolean;
    projectSyncState: ProjectSyncState;
    onExportConfig: () => Promise<void>;
    onNext: () => void;
    onBack: () => void;
    nextLabel?: string;
    nextDisabled?: boolean;
    backLabel?: string;
    exportLabel?: string;
}

export function Step2Pins({
    pins,
    setPins,
    board,
    boardPins,
    selectedPinId,
    setSelectedPinId,
    projectName,
    configBusy,
    projectSyncState,
    onExportConfig,
    onNext,
    onBack,
    nextLabel = "Validate Wiring",
    nextDisabled = false,
    backLabel = "Back",
    exportLabel = "Save JSON",
}: Step2PinsProps) {
    const [i2cCatalog, setI2cCatalog] = useState<I2CLibrary[]>([]);
    const [showClearConfirm, setShowClearConfirm] = useState(false);
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";

    useEffect(() => {
        const fetchCatalog = async () => {
            try {
                const token = getToken();
                const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
                const response = await fetch("/api/v1/diy/i2c/libraries", { headers });
                if (!response.ok) throw new Error("Failed to fetch library catalog");
                const data = await response.json();
                setI2cCatalog(data);
            } catch (err) {
                console.error("Failed to load I2C catalog", err);
            }
        };
        void fetchCatalog();
    }, []);

    const handlePinSelection = (pin: BoardPin) => {
        setSelectedPinId(pin.id);
        setTimeout(() => {
            const element = document.getElementById(`pin-config-${pin.id}`);
            if (element) {
                element.scrollIntoView({ behavior: "smooth", block: "center" });
            }
        }, 50); // slight delay to ensure UI picks up the active state
    };

    const handleI2CAutoPairing = (currentPin: BoardPin): PinMapping[] => {
        const defaults = board.i2cDefaults;
        if (!defaults) return [];

        const isSdaDefault = currentPin.gpio === defaults.sda;
        const isSclDefault = currentPin.gpio === defaults.scl;

        let otherGpio: number | undefined;
        if (isSdaDefault) otherGpio = defaults.scl;
        else if (isSclDefault) otherGpio = defaults.sda;
        else {
            // Find another pin that supports I2C
            otherGpio = boardPins.find(p => p.gpio !== currentPin.gpio && p.capabilities.includes("I2C"))?.gpio;
        }

        if (otherGpio === undefined) return [];

        const otherPin = boardPins.find(p => p.gpio === otherGpio);
        if (!otherPin) return [];

        const currentRole = isSdaDefault ? "SDA" : isSclDefault ? "SCL" : "SDA";
        const otherRole = currentRole === "SDA" ? "SCL" : "SDA";

        const currentMapping: PinMapping = {
            gpio_pin: currentPin.gpio,
            mode: "I2C",
            function: "i2c",
            label: `${projectName.split(" ")[0] || "Node"} ${currentPin.label}`,
            extra_params: { i2c_role: currentRole, i2c_address: "0x3C" }
        };

        const otherMapping: PinMapping = {
            gpio_pin: otherPin.gpio,
            mode: "I2C",
            function: "i2c",
            label: `${projectName.split(" ")[0] || "Node"} ${otherPin.label}`,
            extra_params: { i2c_role: otherRole }
        };

        return [currentMapping, otherMapping];
    };

    const handleModeChange = (pin: BoardPin, mode: PinMode | "none") => {
        const existingMappings = pins.filter(p => p.gpio_pin !== pin.gpio);
        
        // If changing FROM I2C, clear the pair
        const wasI2C = pins.find(p => p.gpio_pin === pin.gpio)?.mode === "I2C";
        let nextPins = existingMappings;
        
        if (wasI2C) {
            // Find the other I2C pin and clear it too
            const otherI2C = pins.find(p => p.mode === "I2C" && p.gpio_pin !== pin.gpio);
            if (otherI2C) {
                nextPins = nextPins.filter(p => p.gpio_pin !== otherI2C.gpio_pin);
            }
        }

        if (mode === "none") {
            setPins(nextPins.sort((a, b) => a.gpio_pin - b.gpio_pin));
            return;
        }

        if (mode === "I2C") {
            const pair = handleI2CAutoPairing(pin);
            if (pair.length === 2) {
                // Remove both from nextPins if they exist to avoid duplicates
                const pairGpios = pair.map(p => p.gpio_pin);
                const filtered = nextPins.filter(p => !pairGpios.includes(p.gpio_pin));
                setPins([...filtered, ...pair].sort((a, b) => a.gpio_pin - b.gpio_pin));
                return;
            }
        }

        // Standard mode change
        const existing = pins.find(p => p.gpio_pin === pin.gpio);
        const newLabel = existing?.label || `${projectName.split(" ")[0] || "Node"} ${pin.label}`;

        const nextMapping: PinMapping = {
            gpio_pin: pin.gpio,
            mode,
            function: existing?.function || "",
            label: newLabel,
            extra_params:
                mode === "OUTPUT"
                    ? { active_level: existing?.extra_params?.active_level ?? 1, subtype: "on_off" }
                    : mode === "PWM"
                    ? { min_value: existing?.extra_params?.min_value ?? 0, max_value: existing?.extra_params?.max_value ?? 255, subtype: "pwm" }
                    : null,
        };

        setPins([...nextPins, nextMapping].sort((a, b) => a.gpio_pin - b.gpio_pin));
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

    const handleExtraParamChange = (pin: BoardPin, params: Partial<NonNullable<PinMapping['extra_params']>>) => {
        setPins((previous) => {
            const existing = previous.find((mapping) => mapping.gpio_pin === pin.gpio);
            if (!existing) {
                return previous;
            }

            const nextMapping: PinMapping = {
                ...existing,
                extra_params: {
                    ...(existing.extra_params ?? {}),
                    ...params,
                } as PinMapping['extra_params'],
            };

            return [...previous.filter((mapping) => mapping.gpio_pin !== pin.gpio), nextMapping].sort(
                (left, right) => left.gpio_pin - right.gpio_pin,
            );
        });
    };

    const handleI2CLibraryChange = (libraryName: string, libraryAddress?: string) => {
        setPins((previous) => {
            const nextPins = previous.map((mapping) => {
                if (mapping.mode === "I2C") {
                    return {
                        ...mapping,
                        extra_params: {
                            ...(mapping.extra_params ?? {}),
                            i2c_library: libraryName,
                            ...(libraryAddress ? { i2c_address: libraryAddress } : {}),
                        } as PinMapping['extra_params'],
                    };
                }
                return mapping;
            });
            return nextPins.sort((a, b) => a.gpio_pin - b.gpio_pin);
        });
    };

    const clearAll = () => {
        setShowClearConfirm(true);
    };

    const confirmClearAll = () => {
        setPins([]);
        setSelectedPinId(null);
        setShowClearConfirm(false);
    };


    const totalRows = Math.max(board.leftPins.length, board.rightPins.length);
    const boardHeight = Math.max(420, totalRows * 34 + 120);
    const svgHeight = boardHeight + 120;
    const top = 110;
    const bottom = boardHeight - 70;
    const gap = totalRows === 1 ? 0 : (bottom - top) / (totalRows - 1);

    return (
        <div className="flex flex-col md:flex-row h-full w-full bg-slate-50 text-slate-700 dark:text-slate-300 border-t border-border-light dark:border-border-dark overflow-hidden">
            {/* Left Sidebar: Pin List & Config */}
            <div className="w-full md:w-[350px] lg:w-[420px] flex-shrink-0 flex flex-col h-[40vh] md:h-full bg-surface-light dark:bg-surface-dark border-b md:border-b-0 md:border-r border-border-light dark:border-border-dark z-10 shadow-[4px_0_24px_rgba(0,0,0,0.05)] text-slate-800 dark:text-slate-200">
                {/* Header inside sidebar */}
                <div className="p-6 border-b border-border-light dark:border-border-dark flex-shrink-0">
                    <h1 className="text-slate-900 dark:text-white text-2xl font-bold tracking-tight">Pin Configuration</h1>
                    <p className="text-slate-500 dark:text-slate-400 text-xs mt-1 leading-5">Assign hardware roles to the available GPIO pins for {board.name}.</p>
                </div>

                {/* Scrollable list */}
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar flex flex-col gap-4">
                    <div className="flex items-center justify-between pl-1 pr-1 mb-1">
                        <span className="text-xs font-bold uppercase tracking-widest text-blue-600">GPIO Pins</span>
                        <button onClick={clearAll} className="text-slate-400 hover:text-slate-600 dark:text-slate-400 transition-colors text-[10px] uppercase font-bold tracking-wider">Reset All</button>
                    </div>

                    {boardPins.filter(pin => pin.capabilities.length > 0 && !(pin.reserved || pin.bootSensitive)).map(pin => {
                        const assignment = pins.find(p => p.gpio_pin === pin.gpio);
                        const isSelected = selectedPinId === pin.id;

                        return (
                            <div key={pin.id} id={`pin-config-${pin.id}`} className={`flex flex-col gap-2 p-3 rounded-lg border transition-colors cursor-default ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 shadow-[0_0_12px_rgba(37,99,235,0.1)]' : 'bg-white dark:bg-slate-800/80 border-border-light dark:border-border-dark hover:border-slate-300 dark:hover:border-slate-600'}`} onClick={() => setSelectedPinId(pin.id)}>
                                <div className="flex justify-between items-center px-1">
                                    <p className={`text-xs font-bold tracking-wider ${isSelected ? 'text-blue-600' : 'text-slate-600 dark:text-slate-400'}`}>
                                        <span className="uppercase">{pin.label}</span> <span className="text-[10px] opacity-70">(GPIO {pin.gpio})</span>
                                    </p>
                                    {pin.bootSensitive && (
                                        <span className="text-[10px] text-amber-600 font-bold uppercase tracking-widest bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">Boot</span>
                                    )}
                                </div>

                                <div className="flex gap-2.5 mt-1">
                                    <div className="relative flex-1">
                                        <label htmlFor={`pin-mode-${pin.gpio}`} className="sr-only">
                                            {pin.label} mode
                                        </label>
                                        <select
                                            id={`pin-mode-${pin.gpio}`}
                                            name={`pin-mode-${pin.gpio}`}
                                            aria-label={`${pin.label} mode`}
                                            value={assignment?.mode === 'PWM' ? 'OUTPUT' : (assignment?.mode || "none")}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                handleModeChange(pin, val as PinMode | "none");
                                            }}
                                            className={`w-full bg-white dark:bg-slate-900 border rounded text-sm py-2.5 pl-9 pr-4 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 appearance-none cursor-pointer outline-none transition-colors ${assignment ? 'text-blue-600 dark:text-blue-400 font-medium border-blue-300 dark:border-blue-700' : 'text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700'}`}
                                        >
                                            <option value="none">Disabled</option>
                                            {Array.from(new Set(pin.capabilities.map(cap => cap === "PWM" ? "OUTPUT" : cap))).map(cap => (
                                                <option key={cap} value={cap}>{cap === 'OUTPUT' ? 'Output' : cap}</option>
                                            ))}
                                        </select>
                                        <span className={`material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] ${assignment ? 'text-blue-600' : 'text-slate-400'}`}>
                                            {assignment?.mode === 'OUTPUT' || assignment?.mode === 'PWM' ? 'lightbulb' : assignment?.mode === 'INPUT' ? 'radio_button_checked' : assignment?.mode === 'ADC' ? 'sensors' : assignment?.mode === 'I2C' ? 'cable' : 'block'}
                                        </span>
                                        <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none text-sm">expand_more</span>
                                    </div>

                                    {assignment && (
                                        <div className="relative flex-1">
                                            <label htmlFor={`pin-function-${pin.gpio}`} className="sr-only">
                                                {pin.label} function
                                            </label>
                                            <input
                                                id={`pin-function-${pin.gpio}`}
                                                name={`pin-function-${pin.gpio}`}
                                                aria-label={`${pin.label} function`}
                                                value={assignment.function || ""}
                                                onChange={(e) => handleFunctionChange(pin, e.target.value)}
                                                placeholder="Function (e.g. relay)"
                                                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded text-sm text-slate-700 dark:text-slate-300 py-2.5 px-3 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                                            />
                                        </div>
                                    )}
                                </div>

                                {(assignment?.mode === "OUTPUT" || assignment?.mode === "PWM") && (
                                    <div className="mt-2 rounded bg-slate-50 dark:bg-slate-800/40 border border-border-light dark:border-border-dark p-2.5">
                                        <div className="flex flex-col gap-3">
                                            <div className="flex items-center justify-between">
                                                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                                                    Control Type
                                                </p>
                                                <div className="flex gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            handleModeChange(pin, "OUTPUT");
                                                        }}
                                                        className={`rounded px-2.5 py-1 text-[10px] uppercase font-bold tracking-wider transition-colors ${
                                                            assignment.mode === "OUTPUT"
                                                                ? "bg-blue-100 text-blue-700 border border-blue-200"
                                                                : "bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-border-light dark:border-border-dark hover:text-slate-700 dark:text-slate-300"
                                                        }`}
                                                    >
                                                        On/Off
                                                    </button>
                                                    {pin.capabilities.includes("PWM") && (
                                                        <button
                                                            type="button"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                handleModeChange(pin, "PWM");
                                                            }}
                                                            className={`rounded px-2.5 py-1 text-[10px] uppercase font-bold tracking-wider transition-colors ${
                                                                assignment.mode === "PWM"
                                                                    ? "bg-blue-100 text-blue-700 border border-blue-200"
                                                                    : "bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-border-light dark:border-border-dark hover:text-slate-700 dark:text-slate-300"
                                                            }`}
                                                        >
                                                            PWM
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {assignment.mode === "OUTPUT" && (
                                                <div className="flex items-center justify-between">
                                                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                                                        Active Level
                                                    </p>
                                                    <div className="flex gap-1">
                                                        {[1, 0].map((level) => {
                                                            const activeLevel = assignment.extra_params?.active_level ?? 1;
                                                            const isActive = activeLevel === level;
                                                            return (
                                                                <button
                                                                    key={level}
                                                                    type="button"
                                                                    onClick={(event) => {
                                                                        event.stopPropagation();
                                                                        handleExtraParamChange(pin, { active_level: level as 0 | 1 });
                                                                    }}
                                                                    className={`rounded px-2.5 py-1 text-[10px] uppercase font-bold tracking-wider transition-colors ${
                                                                        isActive
                                                                            ? "bg-blue-100 text-blue-700 border border-blue-200"
                                                                            : "bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-border-light dark:border-border-dark hover:text-slate-700 dark:text-slate-300"
                                                                    }`}
                                                                >
                                                                    {level === 1 ? "HIGH" : "LOW"}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {assignment?.mode === "PWM" && (
                                    <div className="mt-2 rounded bg-slate-50 dark:bg-slate-800/40 border border-border-light dark:border-border-dark p-2.5">
                                        <div className="flex flex-col gap-2.5">
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                                                Output Map (0-255)
                                            </p>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="flex flex-col gap-1">
                                                    <label htmlFor={`pin-pwm-min-${pin.gpio}`} className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">Min</label>
                                                    <input
                                                        id={`pin-pwm-min-${pin.gpio}`}
                                                        name={`pin-pwm-min-${pin.gpio}`}
                                                        type="number"
                                                        min="0"
                                                        max="255"
                                                        value={assignment.extra_params?.min_value ?? 0}
                                                        onChange={(e) => handleExtraParamChange(pin, { min_value: parseInt(e.target.value) || 0 })}
                                                        className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded py-1 px-2 text-xs outline-none focus:border-blue-500"
                                                    />
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <label htmlFor={`pin-pwm-max-${pin.gpio}`} className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">Max</label>
                                                    <input
                                                        id={`pin-pwm-max-${pin.gpio}`}
                                                        name={`pin-pwm-max-${pin.gpio}`}
                                                        type="number"
                                                        min="0"
                                                        max="255"
                                                        value={assignment.extra_params?.max_value ?? 255}
                                                        onChange={(e) => handleExtraParamChange(pin, { max_value: parseInt(e.target.value) || 0 })}
                                                        className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded py-1 px-2 text-xs outline-none focus:border-blue-500"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {assignment?.mode === "I2C" && (
                                    <div className="mt-2 rounded bg-slate-50 dark:bg-slate-800/40 border border-border-light dark:border-border-dark p-2.5 flex flex-col gap-3">
                                        <div className="flex items-center justify-between">
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Bus Role</p>
                                            <div className="flex gap-1">
                                                {["SDA", "SCL"].map((role) => {
                                                    const currentRole = assignment.extra_params?.i2c_role ?? "SDA";
                                                    const isActive = currentRole === role;
                                                    return (
                                                        <button
                                                            key={role}
                                                            type="button"
                                                            disabled={true} // Auto-assigned roles
                                                            className={`rounded px-2.5 py-1 text-[10px] uppercase font-bold tracking-wider transition-colors ${
                                                                isActive
                                                                    ? "bg-blue-100 text-blue-700 border border-blue-200"
                                                                    : "bg-white text-slate-400 border border-border-light dark:border-border-dark opacity-50"
                                                            }`}
                                                        >
                                                            {role}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="flex flex-col gap-1">
                                                <label htmlFor={`pin-i2c-address-${pin.gpio}`} className="text-[10px] text-slate-500 dark:text-slate-400 font-medium tracking-tight">I2C Address</label>
                                                <input
                                                    id={`pin-i2c-address-${pin.gpio}`}
                                                    name={`pin-i2c-address-${pin.gpio}`}
                                                    type="text"
                                                    placeholder="0x3C"
                                                    value={assignment.extra_params?.i2c_address ?? ""}
                                                    onChange={(e) => handleExtraParamChange(pin, { i2c_address: e.target.value })}
                                                    className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded py-1.5 px-2 text-xs font-mono uppercase outline-none focus:border-blue-500"
                                                />
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                <label htmlFor={`pin-i2c-library-${pin.gpio}`} className="text-[10px] text-slate-500 dark:text-slate-400 font-medium tracking-tight whitespace-nowrap overflow-hidden text-ellipsis">Adafruit Lib</label>
                                                <select
                                                    id={`pin-i2c-library-${pin.gpio}`}
                                                    name={`pin-i2c-library-${pin.gpio}`}
                                                    value={assignment.extra_params?.i2c_library ?? ""}
                                                    onChange={(e) => {
                                                        const lib = i2cCatalog.find(l => l.name === e.target.value);
                                                        handleI2CLibraryChange(
                                                            e.target.value,
                                                            lib?.default_address
                                                        );
                                                    }}
                                                    className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded py-1.5 px-2 text-xs appearance-none outline-none focus:border-blue-500"
                                                >
                                                    <option value="">Custom...</option>
                                                    {i2cCatalog.map(lib => (
                                                        <option key={lib.name} value={lib.name}>{lib.display_name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Footer buttons / Deployment */}
                <div className="p-4 border-t border-border-light dark:border-border-dark bg-slate-50 dark:bg-slate-900/40 flex-shrink-0 space-y-3">
                    <div className="flex items-center justify-between bg-white dark:bg-slate-800 border border-border-light dark:border-border-dark p-2.5 rounded text-xs select-none">
                        <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-sm text-blue-600">description</span>
                            <span className="font-mono text-slate-600 dark:text-slate-400 font-medium">device_config.json</span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${projectSyncState === 'saved' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800'}`}>
                            {formatSyncState(projectSyncState)}
                        </span>
                    </div>

                    <div className="mt-1 flex items-center justify-between text-[11px] px-1 text-slate-500 dark:text-slate-400">
                        <span className="flex items-center gap-1.5 font-medium tracking-wide">
                            <div className={`w-1.5 h-1.5 rounded-full ${pins.length > 0 ? "bg-blue-600 shadow-[0_0_6px_rgba(37,99,235,0.6)]" : "bg-slate-300"}`}></div>
                            {pins.length > 0 ? `${pins.length} active maps` : "Awaiting assignment"}
                        </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-4">
                        <button onClick={onBack} className="bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-800 dark:text-slate-200 rounded py-2 text-xs font-bold uppercase tracking-widest transition-colors shadow-sm">
                            {backLabel}
                        </button>
                        <button onClick={() => void onExportConfig()} disabled={configBusy} className="bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-800 dark:text-slate-200 rounded py-2 text-xs font-bold uppercase tracking-widest transition-colors disabled:opacity-50 shadow-sm">
                            {configBusy ? "Wait..." : exportLabel}
                        </button>
                    </div>

                    <button
                        onClick={onNext}
                        disabled={nextDisabled}
                        className={`w-full font-black py-3 rounded text-sm uppercase tracking-widest shadow-sm transition-colors active:shadow-none flex items-center justify-center gap-2 mt-1 ${nextDisabled ? 'bg-slate-300 text-slate-500 cursor-not-allowed dark:bg-slate-700 dark:text-slate-500' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
                    >
                        <span className="material-symbols-outlined text-[18px]">bolt</span>
                        {nextLabel}
                    </button>
                </div>
            </div>

            {/* Right Workspace - SVG Board Area */}
            <div className="flex-[2] relative flex flex-col bg-slate-50 dark:bg-slate-900 overflow-hidden">
                <div className="absolute inset-0 bg-slate-50 dark:bg-slate-900 bg-[linear-gradient(rgba(203,213,225,0.4)_1px,transparent_1px),linear-gradient(90deg,rgba(203,213,225,0.4)_1px,transparent_1px)] dark:bg-[linear-gradient(rgba(51,65,85,0.4)_1px,transparent_1px),linear-gradient(90deg,rgba(51,65,85,0.4)_1px,transparent_1px)] bg-[size:32px_32px]"></div>
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_transparent_0%,_#f8fafc_80%)] dark:bg-[radial-gradient(circle_at_center,_transparent_0%,_#0f172a_80%)]"></div>

                {/* SVG Visual Board */}
                <div className="relative flex-1 w-full h-[55vh] md:h-[50vh] xl:h-full overflow-hidden custom-scrollbar group">
                    <TransformWrapper
                        initialScale={1}
                        minScale={0.2}
                        maxScale={4}
                        centerOnInit={true}
                        wheel={{ step: 0.1 }}
                    >
                        {({ zoomIn, zoomOut, resetTransform }) => (
                            <>
                                <div className="absolute bottom-6 left-6 flex flex-col gap-1 z-20 bg-white/80 dark:bg-slate-800/80 backdrop-blur-md p-1.5 rounded-lg shadow-sm border border-border-light dark:border-border-dark">
                                    <button onClick={() => zoomIn()} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-600 dark:text-slate-300 transition-colors" title="Zoom In">
                                        <span className="material-symbols-outlined text-[20px]">zoom_in</span>
                                    </button>
                                    <div className="h-px bg-border-light dark:bg-border-dark mx-1"></div>
                                    <button onClick={() => zoomOut()} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-600 dark:text-slate-300 transition-colors" title="Zoom Out">
                                        <span className="material-symbols-outlined text-[20px]">zoom_out</span>
                                    </button>
                                    <div className="h-px bg-border-light dark:bg-border-dark mx-1"></div>
                                    <button onClick={() => resetTransform()} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-600 dark:text-slate-300 transition-colors" title="Reset View">
                                        <span className="material-symbols-outlined text-[20px]">fit_screen</span>
                                    </button>
                                </div>

                                <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-full !h-full flex items-center justify-center p-8">
                                    <svg
                                        viewBox={`0 0 720 ${svgHeight}`}
                                        className="max-h-full max-w-full origin-center"
                                        role="img"
                                        aria-label={`${board.name} SVG GPIO mapping`}
                                    >
                        <defs>
                            <linearGradient id="boardShell" x1="0%" x2="100%" y1="0%" y2="100%">
                                <stop offset="0%" stopColor={isDark ? "#1e293b" : "#f1f5f9"} />
                                <stop offset="100%" stopColor={isDark ? "#334155" : "#e2e8f0"} />
                            </linearGradient>
                            <linearGradient id="chipShell" x1="0%" x2="100%" y1="0%" y2="100%">
                                <stop offset="0%" stopColor={isDark ? "#0f172a" : "#334155"} />
                                <stop offset="100%" stopColor={isDark ? "#1e293b" : "#1e293b"} />
                            </linearGradient>
                            <filter id="neon-glow" x="-50%" y="-50%" width="200%" height="200%">
                                <feGaussianBlur stdDeviation="3" result="blur" />
                                <feComposite in="SourceGraphic" in2="blur" operator="over" />
                            </filter>
                        </defs>

                        {board.id === 'esp32-c3-super-mini' ? (
                            <g id="super-mini-artwork" transform="translate(190, 50)">
                                <rect x="0" y="0" width="340" height={boardHeight} rx="12" fill="url(#boardShell)" stroke={isDark ? "#475569" : "#cbd5e1"} strokeWidth="4" />

                                {/* USB-C Connector */}
                                <path d="M 130 -10 L 210 -10 L 210 0 L 130 0 Z" fill={isDark ? "#475569" : "#94a3b8"} stroke="#cbd5e1" strokeWidth="2" />
                                <path d="M 140 -20 L 200 -20 L 200 -10 L 140 -10 Z" fill="#475569" />

                                {/* Antenna Trace */}
                                <path d="M 120 20 L 220 20 M 120 30 L 250 30 M 120 40 L 220 40" stroke="#bda25c" strokeWidth="4" fill="none" opacity="0.6" />

                                {/* Buttons */}
                                <rect x="80" y="60" width="16" height="24" fill={isDark ? "#cbd5e1" : "#64748b"} rx="2" stroke="#94a3b8" strokeWidth="1" />
                                <rect x="244" y="60" width="16" height="24" fill={isDark ? "#cbd5e1" : "#64748b"} rx="2" stroke="#94a3b8" strokeWidth="1" />

                                {/* Text V1601 */}
                                <text x="170" y="110" fill={isDark ? "#475569" : "#94a3b8"} fontSize="14" fontFamily="monospace" textAnchor="middle">V1601</text>

                                {/* ESP32-C3 Label */}
                                <rect x="110" y="130" width="120" height="24" fill="url(#chipShell)" rx="2" stroke={isDark ? "#94a3b8" : "#475569"} strokeWidth="2" />
                                <text x="170" y="147" fill={isDark ? "#475569" : "#94a3b8"} fontSize="16" fontWeight="bold" fontFamily="monospace" textAnchor="middle">ESP32-C3</text>

                                {/* Built-in LED */}
                                <circle cx="280" cy="170" r="5" fill="#3b82f6" filter="url(#neon-glow)" />
                                <text x="280" y="190" fill="#3b82f6" fontSize="10" textAnchor="middle" fontWeight="bold">LED (8)</text>

                                {/* Trace */}
                                <path d={`M 340 ${gap * 3 + 60} Q 280 ${gap * 3 + 60} 280 176`} stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="4,4" fill="none" opacity="0.4" />
                            </g>
                        ) : (
                            <>
                                <rect x="190" y="50" width="340" height={boardHeight} rx="24" fill="url(#boardShell)" stroke={isDark ? "#475569" : "#cbd5e1"} strokeWidth="4" />
                                <rect x="260" y="150" width="200" height="180" rx="16" fill="url(#chipShell)" stroke={isDark ? "#94a3b8" : "#475569"} strokeWidth="2" />

                                <text x="360" y="234" fill={isDark ? "#cbd5e1" : "#64748b"} textAnchor="middle" fontSize="22" fontWeight="800" letterSpacing="0.1em">
                                    {board.family}
                                </text>
                                <text x="360" y="260" fill={isDark ? "#475569" : "#94a3b8"} textAnchor="middle" fontSize="12" fontFamily="monospace" letterSpacing="0.1em">
                                    {board.chipLabel}
                                </text>
                            </>
                        )}

                        {board.leftPins.map((pin, index) =>
                            renderSvgPin({
                                pin, index, totalRows, side: "left", boardHeight,
                                isSelected: selectedPinId === pin.id,
                                assignment: pins.find((mapping) => mapping.gpio_pin === pin.gpio),
                                onSelect: handlePinSelection,
                                isDark: isDark,
                            })
                        )}
                        {board.rightPins.map((pin, index) =>
                            renderSvgPin({
                                pin, index, totalRows, side: "right", boardHeight,
                                isSelected: selectedPinId === pin.id,
                                assignment: pins.find((mapping) => mapping.gpio_pin === pin.gpio),
                                onSelect: handlePinSelection,
                                isDark: isDark,
                            })
                        )}
                    </svg>
                                </TransformComponent>
                            </>
                        )}
                    </TransformWrapper>
                </div>

                {/* Overlaid UI on Top-Left */}
                <div className="absolute top-6 left-6 flex gap-3 pointer-events-none z-10">
                    <LegendItem color="bg-yellow-500/80 shadow-[0_0_8px_rgba(234,179,8,0.4)]" label="Available" />
                    <LegendItem color="bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" label="Mapped" />
                    <LegendItem color="bg-[#00F2FF] shadow-[0_0_12px_#00F2FF]" label="Selected" />
                    <LegendItem color="bg-slate-700" label="Reserved" />
                </div>

                {/* Overlaid Label on Bottom-Right */}
                <div className="absolute bottom-6 right-6 bg-white/90 dark:bg-slate-800/90 backdrop-blur border border-border-light dark:border-border-dark px-3 py-2 rounded shadow-xl text-xs text-slate-500 dark:text-slate-400 font-mono flex items-center gap-2 pointer-events-none">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_6px_rgba(16,185,129,0.5)]"></span>
                    <span className="opacity-70">PROFILE:</span> <span className="text-slate-900 dark:text-white font-bold">{board.name}</span>
                </div>

                {/* Overlaid Pin Info Board on Top-Right */}
                {selectedPinId && (() => {
                    const selPin = boardPins.find(p => p.id === selectedPinId);
                    if (!selPin) return null;
                    const assignment = pins.find(p => p.gpio_pin === selPin.gpio);
                    return (
                        <div className="absolute top-6 right-6 bg-white/95 dark:bg-slate-800/95 backdrop-blur border border-border-light dark:border-border-dark px-5 py-4 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.1)] text-slate-600 dark:text-slate-400 min-w-[240px] pointer-events-none z-20">
                            <div className="flex justify-between items-start mb-2">
                                <h3 className="text-slate-900 dark:text-white font-black text-lg tracking-tight uppercase">{selPin.label}</h3>
                                <span className="text-blue-600 font-mono font-bold text-[10px] bg-blue-50 px-2 py-0.5 rounded border border-blue-200">GPIO {selPin.gpio}</span>
                            </div>
                            <div className="flex flex-col gap-2 mt-4">
                                <div className="flex justify-between text-xs">
                                    <span className="text-slate-400 uppercase tracking-widest font-bold text-[10px]">Status</span>
                                    <span className={assignment ? "text-emerald-600 font-bold" : "text-amber-500 font-bold"}>{assignment ? "MAPPED" : "AVAILABLE"}</span>
                                </div>
                                {assignment && (
                                    <>
                                        <div className="flex justify-between text-xs">
                                            <span className="text-slate-400 uppercase tracking-widest font-bold text-[10px]">Mode</span>
                                            <span className="text-slate-800 dark:text-slate-200 font-mono font-bold">{assignment.mode}</span>
                                        </div>
                                        {assignment.function && (
                                        <div className="flex justify-between text-xs">
                                            <span className="text-slate-400 uppercase tracking-widest font-bold text-[10px]">Function</span>
                                            <span className="text-slate-800 dark:text-slate-200 font-mono">{assignment.function}</span>
                                        </div>
                                        )}
                                    </>
                                )}
                                <div className="flex flex-col gap-1.5 mt-2 pt-2 border-t border-border-light dark:border-border-dark">
                                    <span className="text-slate-400 uppercase tracking-widest font-bold text-[10px]">Capabilities</span>
                                    <div className="flex flex-wrap gap-1">
                                        {selPin.capabilities.length > 0 ? selPin.capabilities.map(cap => (
                                            <span key={cap} className="text-[9px] bg-slate-100 border border-border-light dark:border-border-dark px-1.5 py-0.5 rounded text-slate-500 dark:text-slate-400 uppercase font-mono">{cap}</span>
                                        )) : <span className="text-[10px] text-slate-400 italic">None</span>}
                                    </div>
                                </div>
                                {selPin.bootSensitive && (
                                    <div className="mt-2 text-amber-600 text-[10px] bg-amber-50 border border-amber-200 px-2 py-1.5 rounded flex items-center gap-1.5">
                                        <span className="material-symbols-outlined text-[14px]">warning</span>
                                        <span className="font-bold uppercase tracking-wider">Boot Sensitive</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })()}
            </div>

            {/* Clear All Confirmation Modal */}
            {showClearConfirm && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowClearConfirm(false)}></div>
                    <div className="flex flex-col gap-6 w-full max-w-sm relative z-10 transition-all duration-200">
                        <div className="p-6 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 rounded-xl shadow-[0_0_40px_rgba(0,0,0,0.2)] dark:shadow-[0_0_40px_rgba(0,0,0,0.5)] border border-border-light dark:border-border-dark mx-auto w-full">
                            <div className="flex flex-col items-center text-center">
                                <div className="w-14 h-14 flex items-center justify-center rounded-full bg-red-50 border border-red-100 text-red-500 mb-4">
                                    <svg fill="none" height="28" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="28" xmlns="http://www.w3.org/2000/svg">
                                        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path>
                                        <path d="M12 9v4"></path>
                                        <path d="M12 17h.01"></path>
                                    </svg>
                                </div>
                                <h3 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white uppercase">Clear All Assignments?</h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 mb-6 leading-relaxed">Are you sure you want to remove all configured pin assignments? This action cannot be undone.</p>
                                <div className="flex w-full gap-3">
                                    <button
                                        onClick={confirmClearAll}
                                        className="flex-1 px-4 py-3 bg-red-50 dark:bg-red-900/20 hover:bg-red-600 text-red-600 dark:text-red-400 hover:text-white text-xs font-bold uppercase tracking-wider rounded transition-colors border border-red-200 dark:border-red-900 hover:border-red-600"
                                    >
                                        Clear All
                                    </button>
                                    <button
                                        onClick={() => setShowClearConfirm(false)}
                                        className="flex-1 px-4 py-3 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 text-xs font-bold uppercase tracking-wider rounded transition-colors border border-slate-300 dark:border-slate-700"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function formatSyncState(value: ProjectSyncState) {
    return value.replace(/_/g, " ");
}

function LegendItem({ color, label }: { color: string; label: string }) {
    return (
        <div className="flex items-center gap-2 rounded-2xl border border-border-light dark:border-border-dark bg-white px-3 py-2 text-sm text-slate-600 dark:text-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
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
    isDark,
}: {
    pin: BoardPin;
    index: number;
    totalRows: number;
    side: "left" | "right";
    boardHeight: number;
    isSelected: boolean;
    assignment?: PinMapping;
    onSelect: (pin: BoardPin) => void;
    isDark: boolean;
}) {
    const top = 110;
    const bottom = boardHeight - 70;
    const gap = totalRows === 1 ? 0 : (bottom - top) / (totalRows - 1);
    const y = top + gap * index;
    const isReserved = pin.reserved || pin.bootSensitive || pin.capabilities.length === 0;
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
            role={isReserved ? undefined : "button"}
            tabIndex={isReserved ? undefined : 0}
            onClick={isReserved ? undefined : () => onSelect(pin)}
            onKeyDown={isReserved ? undefined : (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(pin);
                }
            }}
            className={`group ${isReserved ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
        >
            <line x1={stemStart} x2={stemEnd} y1={y} y2={y} stroke={isDark ? "#94a3b8" : "#475569"} strokeWidth="3" />
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
                fill={assignment ? (isDark ? "#f8fafc" : "#0f172a") : (isDark ? "#94a3b8" : "#64748b")}
                textAnchor={anchor}
                fontSize="14"
                fontWeight="700"
            >
                {pin.label}
            </text>
            <text
                x={mappingTextX}
                y={y + 24}
                fill={assignment ? (isDark ? "#60a5fa" : "#2563eb") : (isDark ? "#475569" : "#94a3b8")}
                textAnchor={anchor}
                fontSize="11"
                fontFamily="monospace"
            >
                {assignment ? `${assignment.mode} · ${assignment.label || `GPIO ${pin.gpio}`}` : `GPIO ${pin.gpio}`}
            </text>
        </g>
    );
}
