/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { BOARD_PROFILES, BOARD_FAMILIES, type ChipFamily, type BoardProfile } from "../board-profiles";
import type { ProjectSyncState } from "../types";
import type { RoomRecord } from "@/lib/rooms";
import type { WifiCredentialRecord } from "@/lib/wifi-credentials";

const BOARD_IMAGE_MAP: Record<ChipFamily, string> = {
    "ESP32": "/boards/esp32.png",
    "ESP32-S2": "/boards/esp32-s2.png",
    "ESP32-S3": "/boards/esp32-s3.png",
    "ESP32-C2": "/boards/esp32-c2.png",
    "ESP32-C3": "/boards/esp32-c3.png",
    "ESP32-C5": "/boards/esp32-c5.png",
    "ESP32-C6": "/boards/esp32-c6.png",
    "ESP32-C61": "/boards/esp32-c61.png",
    "ESP32-H2": "/boards/esp32-h2.png",
    "ESP32-P4": "/boards/esp32-p4.png",
    "ESP8266": "/boards/esp8266.png",
    "JC3827W543": "/boards/jc3827w543.jpg",
};

interface Step1BoardProps {
    projectName: string;
    setProjectName: (val: string) => void;
    wifiCredentials: WifiCredentialRecord[];
    wifiCredentialsLoading: boolean;
    wifiCredentialsError: string;
    selectedWifiCredentialId: number | null;
    setSelectedWifiCredentialId: (value: number | null) => void;
    family: ChipFamily;
    setFamily: (val: ChipFamily) => void;
    setBoardId: (val: string) => void;
    onNext: () => void;
    familyOptions: typeof BOARD_PROFILES;
    board: BoardProfile;
    onSaveDraft: () => Promise<void>;
    projectSyncState: ProjectSyncState;
    projectSyncMessage: string;
    rooms: RoomRecord[];
    selectedRoomId: number | null;
    setSelectedRoomId: (value: number | null) => void;
    newRoomName: string;
    setNewRoomName: (value: string) => void;
    roomsLoading: boolean;
    roomError: string;
    creatingRoom: boolean;
    onCreateRoom: () => Promise<void>;
    cpuMhz: number | null;
    setCpuMhz: (val: number | null) => void;
    flashSize: string | null;
    setFlashSize: (val: string | null) => void;
    psramSize: string | null;
    setPsramSize: (val: string | null) => void;
}

export function Step1Board({
    projectName,
    setProjectName,
    wifiCredentials,
    wifiCredentialsLoading,
    wifiCredentialsError,
    selectedWifiCredentialId,
    setSelectedWifiCredentialId,
    family,
    setFamily,
    setBoardId,
    onNext,
    familyOptions,
    board,
    onSaveDraft,
    projectSyncState,
    projectSyncMessage,
    rooms,
    selectedRoomId,
    setSelectedRoomId,
    newRoomName,
    setNewRoomName,
    roomsLoading,
    roomError,
    creatingRoom,
    onCreateRoom,
    cpuMhz,
    setCpuMhz,
    flashSize,
    setFlashSize,
    psramSize,
    setPsramSize,
}: Step1BoardProps) {
    const totalGpios = [...board.leftPins, ...board.rightPins].filter((pin) => pin.gpio >= 0).length;
    const defaultCpu = board.defaultCpuMhz || (board.family.includes("C2") ? 120 : board.family.includes("H2") ? 96 : board.family.includes("C3") || board.family.includes("C6") ? 160 : 240);
    const defaultFlash = board.defaultFlashSize || "4MB";
    const defaultPsram = board.defaultPsram || "None";
    const isMasterBoard = board.id === "jc3827w543";
    const boardNeedsServerWifi = !isMasterBoard;
    const boardNeedsRoom = !isMasterBoard;

    const cpuOptions = useMemo(() => {
        let maxCpu = 240;
        if (board.family === "ESP32-P4") maxCpu = 400;
        else if (board.family.includes("H2")) maxCpu = 96;
        else if (board.family.includes("C2")) maxCpu = 120;
        else if (board.family.includes("C3") || board.family.includes("C6") || board.family === "ESP8266") maxCpu = 160;

        return [400, 240, 160, 120, 96, 80].filter(freq => freq <= maxCpu);
    }, [board.family]);

    const flashOptions = useMemo(() => {
        const allSizes = ["1MB", "2MB", "4MB", "8MB", "16MB", "32MB"];
        if (board.id === "esp01_1m") return ["1MB"];
        
        const defaultIndex = allSizes.indexOf(defaultFlash);
        return allSizes.slice(0, Math.max(1, defaultIndex + 1));
    }, [board.id, defaultFlash]);

    const psramOptions = useMemo(() => {
        const noPsramFamilies = ["ESP8266", "ESP32-C2", "ESP32-C3", "ESP32-C6", "ESP32-C61", "ESP32-H2", "ESP32-C5"];
        if (noPsramFamilies.includes(board.family)) {
            return ["None"];
        }

        const allSizes = ["None", "2MB", "4MB", "8MB", "16MB", "32MB"];
        if (board.defaultPsram && board.defaultPsram !== "None") {
            const defaultIndex = allSizes.indexOf(board.defaultPsram);
            return allSizes.slice(0, Math.max(1, defaultIndex + 1));
        }

        return allSizes;
    }, [board.family, board.defaultPsram]);
    
    useEffect(() => {
        if (boardNeedsServerWifi && !wifiCredentialsLoading && wifiCredentials.length > 0 && selectedWifiCredentialId === null) {
            setSelectedWifiCredentialId(wifiCredentials[0].id);
        }
    }, [boardNeedsServerWifi, wifiCredentialsLoading, wifiCredentials, selectedWifiCredentialId, setSelectedWifiCredentialId]);

    // Ensure selected values are within valid options when board changes
    useEffect(() => {
        if (cpuMhz && !cpuOptions.includes(cpuMhz)) {
            setCpuMhz(null);
        }
        if (flashSize && !flashOptions.includes(flashSize)) {
            setFlashSize(null);
        }
        if (psramSize && !psramOptions.includes(psramSize)) {
            setPsramSize(null);
        }
    }, [board.id, cpuOptions, flashOptions, psramOptions, cpuMhz, flashSize, psramSize, setCpuMhz, setFlashSize, setPsramSize]);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 mb-10">
                <label
                    htmlFor="diy-project-name"
                    className="block text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider"
                >
                    Project Name
                </label>
                <input
                    id="diy-project-name"
                    name="projectName"
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                    className="w-full rounded-xl border-2 border-border-light dark:border-border-dark bg-slate-50 dark:bg-slate-800/50 px-4 py-3 text-lg text-slate-900 dark:text-white outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-800 dark:bg-slate-900/50 dark:text-white"
                    placeholder="e.g. Kitchen Relay Node"
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
                <div
                    className={`flex flex-col gap-4 rounded-2xl border p-5 transition-colors ${
                        !boardNeedsServerWifi
                            ? "border-slate-200 bg-slate-50/50 dark:border-slate-800/50 dark:bg-slate-900/30"
                            : boardNeedsServerWifi && !wifiCredentialsLoading && wifiCredentials.length === 0
                            ? "border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"
                            : "border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark dark:border-slate-800 dark:bg-slate-900/50"
                    }`}
                >
                    <div>
                        <label
                            htmlFor="diy-wifi-credential-id"
                            className={`block text-sm font-bold uppercase tracking-wider ${
                                boardNeedsServerWifi && !wifiCredentialsLoading && wifiCredentials.length === 0
                                    ? "text-amber-700 dark:text-amber-400"
                                    : "text-slate-700 dark:text-slate-300"
                            }`}
                        >
                            {boardNeedsServerWifi ? "Wi-Fi Network (Required for initial boot)" : "On-device Wi-Fi Setup"}
                        </label>
                        <p
                            className={`mt-2 text-sm ${
                                boardNeedsServerWifi && !wifiCredentialsLoading && wifiCredentials.length === 0
                                    ? "text-amber-700 dark:text-amber-300/80"
                                    : "text-slate-500 dark:text-slate-400"
                            }`}
                        >
                            {boardNeedsServerWifi
                                ? "Select one of the admin-managed Wi-Fi credentials saved in Settings. The builder keeps the selected network with this project so rebuilds stay consistent."
                                : "The Master board scans for Wi-Fi and connects via its own touch screen. No credentials will be hardcoded in firmware."}
                        </p>
                    </div>

                    {!boardNeedsServerWifi ? (
                        <select
                            disabled
                            className="w-full rounded-xl border-2 border-slate-200 bg-slate-100 px-4 py-3 text-lg text-slate-500 outline-none dark:border-slate-800 dark:bg-slate-800/30 dark:text-slate-500 opacity-70 cursor-not-allowed"
                        >
                            <option>Configured on device screen</option>
                        </select>
                    ) : !wifiCredentialsLoading && wifiCredentials.length === 0 ? (
                        <Link 
                            href="/settings"
                            className="flex flex-col items-center justify-center rounded-xl border border-dashed border-amber-400 bg-white/50 dark:border-amber-500/50 dark:bg-slate-900/50 px-6 py-6 text-center hover:bg-white dark:hover:bg-slate-800 transition-colors"
                        >
                            <svg className="mb-3 h-10 w-10 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <h3 className="mb-2 text-base font-bold text-amber-800 dark:text-amber-300">No Wi-Fi Networks Configured</h3>
                            <p className="text-sm text-amber-700 dark:text-amber-200/80">
                                You must add at least one Wi-Fi network before you can build a device. Click here to go to the Settings page to add a Wi-Fi credential, then return here.
                            </p>
                        </Link>
                    ) : (
                        <select
                            id="diy-wifi-credential-id"
                            value={selectedWifiCredentialId ?? ""}
                            onChange={(event) =>
                                setSelectedWifiCredentialId(event.target.value ? Number(event.target.value) : null)
                            }
                            className="w-full rounded-xl border-2 border-border-light dark:border-border-dark bg-slate-50 dark:bg-slate-800/50 px-4 py-3 text-lg text-slate-900 dark:text-white outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-800 dark:bg-slate-900/50 dark:text-white"
                            disabled={wifiCredentialsLoading}
                        >
                            {wifiCredentialsLoading && (
                                <option value="">
                                    Loading saved Wi-Fi credentials...
                                </option>
                            )}
                            {wifiCredentials.map((credential) => (
                                <option key={credential.id} value={credential.id}>
                                    {credential.ssid}
                                </option>
                            ))}
                        </select>
                    )}

                    {wifiCredentialsError ? (
                        <p className="text-sm text-rose-600 dark:text-rose-300">{wifiCredentialsError}</p>
                    ) : null}
                </div>

                <div className={`flex flex-col gap-4 rounded-2xl border p-5 transition-colors ${
                    !boardNeedsRoom 
                        ? "border-slate-200 bg-slate-50/50 dark:border-slate-800/50 dark:bg-slate-900/30"
                        : "border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark dark:border-slate-800 dark:bg-slate-900/50"
                }`}>
                    <div>
                        <label
                            htmlFor="diy-room-id"
                            className="block text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider"
                        >
                            {boardNeedsRoom ? "Device Room" : "Master Hub (Global)"}
                        </label>
                        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                            {boardNeedsRoom 
                                ? "New devices must be assigned to a room before the server build can be approved and paired."
                                : "The Master board acts globally and does not need to be assigned to a specific room."}
                        </p>
                    </div>

                    {!boardNeedsRoom ? (
                        <select
                            disabled
                            className="w-full rounded-xl border-2 border-slate-200 bg-slate-100 px-4 py-3 text-lg text-slate-500 outline-none dark:border-slate-800 dark:bg-slate-800/30 dark:text-slate-500 opacity-70 cursor-not-allowed"
                        >
                            <option>No room required</option>
                        </select>
                    ) : (
                        <>
                            <select
                                id="diy-room-id"
                                value={selectedRoomId ?? ""}
                                onChange={(event) => setSelectedRoomId(event.target.value ? Number(event.target.value) : null)}
                                className="w-full rounded-xl border-2 border-border-light dark:border-border-dark bg-slate-50 dark:bg-slate-800/50 px-4 py-3 text-lg text-slate-900 dark:text-white outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-800 dark:bg-slate-900/50 dark:text-white"
                                disabled={roomsLoading}
                            >
                                <option value="">{roomsLoading ? "Loading rooms..." : "Select a room"}</option>
                                {rooms.map((room) => (
                                    <option key={room.room_id} value={room.room_id}>
                                        {room.name}
                                    </option>
                                ))}
                            </select>

                            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                                <input
                                    type="text"
                                    value={newRoomName}
                                    onChange={(event) => setNewRoomName(event.target.value)}
                                    className="w-full rounded-xl border-2 border-border-light dark:border-border-dark bg-slate-50 dark:bg-slate-800/50 px-4 py-3 text-base text-slate-900 dark:text-white outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-800 dark:bg-slate-900/50 dark:text-white"
                                    placeholder="Create a new room here"
                                />
                                <button
                                    type="button"
                                    onClick={() => void onCreateRoom()}
                                    disabled={creatingRoom || !newRoomName.trim()}
                                    className="rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {creatingRoom ? "Creating..." : "Create room"}
                                </button>
                            </div>

                            {roomError ? (
                                <p className="text-sm text-rose-600 dark:text-rose-300">{roomError}</p>
                            ) : null}
                        </>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                {BOARD_FAMILIES.map((item) => {
                    const isSelected = family === item.id;
                    return (
                        <div
                            key={item.id}
                            onClick={() => setFamily(item.id)}
                            className={`group relative flex flex-col gap-4 p-5 rounded-xl border-2 transition-all cursor-pointer ${isSelected
                                ? "border-primary bg-primary/5 dark:bg-primary/10"
                                : "border-border-light dark:border-border-dark dark:border-slate-800 bg-surface-light dark:bg-surface-dark dark:bg-slate-900/50 hover:border-primary/50"
                                }`}
                        >
                            <div className="w-full aspect-video bg-slate-200 dark:bg-slate-800 rounded-lg overflow-hidden relative">
                                <img
                                    alt={`${item.title} development MCU`}
                                    className={`w-full h-full object-contain transition-all duration-500 ${isSelected ? "scale-90 opacity-100 grayscale-0 drop-shadow-md" : "scale-125 opacity-60 grayscale group-hover:scale-90 group-hover:grayscale-0 group-hover:opacity-100 group-hover:drop-shadow-md"
                                        }`}
                                    src={BOARD_IMAGE_MAP[item.id] || BOARD_IMAGE_MAP["ESP32"]}
                                />
                            </div>
                            <div>
                                <h3 className="text-slate-900 dark:text-white dark:text-white text-lg font-bold mb-1">{item.title}</h3>
                                <p className="text-slate-500 dark:text-slate-400 dark:text-slate-400 text-sm mb-4 h-10">{item.subtitle}</p>
                                <div className="space-y-2 bg-slate-50 dark:bg-slate-800/50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-100 dark:border-slate-800">
                                    <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 dark:text-slate-300">
                                        <span className="material-symbols-outlined text-sm text-slate-400">memory</span>
                                        <span className="font-medium">{item.specs.core}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 dark:text-slate-300">
                                        <span className="material-symbols-outlined text-sm text-slate-400">speed</span>
                                        <span className="font-medium">{item.specs.clock}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 dark:text-slate-300">
                                        <span className="material-symbols-outlined text-sm text-slate-400">wifi</span>
                                        <span className="font-medium truncate" title={item.specs.wireless}>{item.specs.wireless}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="mt-2 mb-8">
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 dark:text-slate-300 uppercase tracking-wider mb-4">
                    Specific Board Profile
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {familyOptions.map((profile) => (
                        <button
                            key={profile.id}
                            onClick={() => setBoardId(profile.id)}
                            className={`w-full rounded-xl border-2 px-6 py-4 text-left transition ${board.id === profile.id
                                ? "border-primary bg-primary/5 dark:bg-primary/10 shadow-sm"
                                : "border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark hover:border-primary/50 dark:border-slate-800 dark:bg-slate-900/50"
                                }`}
                        >
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <p className="text-base font-bold text-slate-950 dark:text-white">{profile.name}</p>
                                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 dark:text-slate-400">{profile.description}</p>
                                </div>
                                {profile.demoFirmware ? (
                                    <span className="rounded-full bg-emerald-100 text-emerald-700 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] dark:bg-emerald-500/20 dark:text-emerald-300">
                                        Web flash
                                    </span>
                                ) : null}
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            <div className="mt-2 mb-8">
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 dark:text-slate-300 uppercase tracking-wider mb-4">
                    Detailed Board Config
                </label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-5 rounded-2xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark dark:border-slate-800 dark:bg-slate-900/50">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 dark:text-slate-400 uppercase tracking-wider mb-2">CPU Frequency</label>
                        <select
                            value={cpuMhz === null ? "" : cpuMhz}
                            onChange={(e) => setCpuMhz(e.target.value ? Number(e.target.value) : null)}
                            className="w-full rounded-xl border-2 border-border-light dark:border-border-dark bg-slate-50 dark:bg-slate-800/50 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-800 dark:bg-slate-900/50 dark:text-white"
                        >
                            <option value="">Default ({defaultCpu} MHz)</option>
                            {cpuOptions.map(freq => (
                                <option key={freq} value={freq}>{freq} MHz{freq === cpuOptions[0] ? " (Max Perf)" : freq === cpuOptions[cpuOptions.length - 1] ? " (Low Power)" : ""}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 dark:text-slate-400 uppercase tracking-wider mb-2">Flash Size</label>
                        <select
                            value={flashSize === null ? "" : flashSize}
                            onChange={(e) => setFlashSize(e.target.value || null)}
                            className="w-full rounded-xl border-2 border-border-light dark:border-border-dark bg-slate-50 dark:bg-slate-800/50 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-800 dark:bg-slate-900/50 dark:text-white"
                        >
                            <option value="">Default ({defaultFlash})</option>
                            {flashOptions.map(size => (
                                <option key={size} value={size}>{size}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 dark:text-slate-400 uppercase tracking-wider mb-2">PSRAM</label>
                        <select
                            value={psramSize === null ? "" : psramSize}
                            onChange={(e) => setPsramSize(e.target.value || null)}
                            className="w-full rounded-xl border-2 border-border-light dark:border-border-dark bg-slate-50 dark:bg-slate-800/50 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-800 dark:bg-slate-900/50 dark:text-white"
                            disabled={psramOptions.length === 1 && psramOptions[0] === "None"}
                        >
                            <option value="">Default ({defaultPsram})</option>
                            {psramOptions.map(size => (
                                <option key={size} value={size}>{size}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            <div className="flex flex-col md:flex-row items-center justify-between gap-6 p-6 rounded-xl bg-slate-100 dark:bg-slate-800 dark:bg-slate-900/80 border border-border-light dark:border-border-dark dark:border-slate-800">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-primary/10 rounded-full">
                        <span className="material-symbols-outlined text-primary">info</span>
                    </div>
                    <div>
                        <p className="text-slate-900 dark:text-white dark:text-white font-bold">Selected: {board.name}</p>
                        <p className="text-slate-500 dark:text-slate-400 dark:text-slate-400 text-xs">
                          {board.chipLabel} · {board.layoutLabel} · {board.serialBridge}
                        </p>
                        <p className="text-slate-500 dark:text-slate-400 dark:text-slate-400 text-xs mt-1">
                          GPIO Count: {totalGpios} pins · Default CPU: {defaultCpu} MHz · Flash: {defaultFlash} · PSRAM: {defaultPsram}
                        </p>
                        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500 dark:text-slate-400">
                            {projectSyncMessage}
                        </p>
                    </div>
                </div>
                <div className="flex gap-4 w-full md:w-auto">
                    <button
                        onClick={() => void onSaveDraft()}
                        disabled={projectSyncState === "saving"}
                        className="flex-1 md:flex-none px-6 py-3 rounded-lg border border-slate-300 dark:border-slate-600 dark:border-slate-700 text-slate-600 dark:text-slate-400 dark:text-slate-300 font-bold hover:bg-slate-200 dark:hover:bg-slate-800 transition-all disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {projectSyncState === "saving" ? "Saving..." : "Save Draft"}
                    </button>
                    <button
                        onClick={onNext}
                        disabled={(boardNeedsRoom && !selectedRoomId) || (boardNeedsServerWifi && !selectedWifiCredentialId)}
                        className="flex-1 md:flex-none px-8 py-3 rounded-lg bg-primary text-white font-bold shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <span>Next: Choose Config</span>
                        <span className="material-symbols-outlined text-sm">arrow_forward</span>
                    </button>
                </div>
            </div>
        </div>
    );
}

