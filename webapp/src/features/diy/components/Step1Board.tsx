import { BOARD_PROFILES, BOARD_FAMILIES, type Esp32ChipFamily, type BoardProfile } from "../board-profiles";
import type { ProjectSyncState } from "../types";

interface Step1BoardProps {
    projectName: string;
    setProjectName: (val: string) => void;
    wifiSsid: string;
    setWifiSsid: (val: string) => void;
    wifiPassword: string;
    setWifiPassword: (val: string) => void;
    family: Esp32ChipFamily;
    setFamily: (val: Esp32ChipFamily) => void;
    setBoardId: (val: string) => void;
    onNext: () => void;
    familyOptions: typeof BOARD_PROFILES;
    board: BoardProfile;
    onSaveDraft: () => Promise<void>;
    projectSyncState: ProjectSyncState;
    projectSyncMessage: string;
}

export function Step1Board({
    projectName,
    setProjectName,
    wifiSsid,
    setWifiSsid,
    wifiPassword,
    setWifiPassword,
    family,
    setFamily,
    setBoardId,
    onNext,
    familyOptions,
    board,
    onSaveDraft,
    projectSyncState,
    projectSyncMessage,
}: Step1BoardProps) {
    // Use the HTML from step1.html for the board grid.
    // We'll map the family options to the board selection cards.
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
                    className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-lg text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-800 dark:bg-slate-900/50 dark:text-white"
                    placeholder="e.g. Kitchen Relay Node"
                />
            </div>

            <div className="flex flex-col gap-4 mb-10">
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    Wi-Fi Configuration (Required for initial boot)
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input
                        type="text"
                        name="wifiSsid"
                        value={wifiSsid}
                        onChange={(event) => setWifiSsid(event.target.value)}
                        className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-lg text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-800 dark:bg-slate-900/50 dark:text-white"
                        placeholder="Wi-Fi SSID"
                    />
                    <input
                        type="password"
                        name="wifiPassword"
                        value={wifiPassword}
                        onChange={(event) => setWifiPassword(event.target.value)}
                        className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-lg text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-800 dark:bg-slate-900/50 dark:text-white"
                        placeholder="Wi-Fi Password"
                    />
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
                                : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 hover:border-primary/50"
                                }`}
                        >
                            {isSelected && (
                                <div className="absolute top-4 right-4">
                                    <span className="material-symbols-outlined text-primary">check_circle</span>
                                </div>
                            )}
                            <div className="w-full aspect-video bg-slate-200 dark:bg-slate-800 rounded-lg overflow-hidden relative">
                                <div
                                    className={`absolute inset-0 bg-gradient-to-br from-primary/20 to-transparent ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-50"
                                        } transition-opacity`}
                                ></div>
                                <img
                                    alt={`${item.title} development board`}
                                    className={`w-full h-full object-cover transition-all ${isSelected ? "mix-blend-overlay opacity-80" : "opacity-60 grayscale group-hover:grayscale-0"
                                        }`}
                                    src={
                                        item.id === "ESP32"
                                            ? "https://lh3.googleusercontent.com/aida-public/AB6AXuA_p3OvNzRNesXG8SNFSsPb8Gh-g7NlMMVUgP9hMRjruU8It8IIpd11OxvJFi8gpGOpWZdGHtks1EhOOfyqk50E6L0jB_sNHut9ZWFJHZFWry_l97rzMpkxU4zo_D6zdcf_V1VHlRJHXuRZvXfnlMgtD5OHvfZTKKmh5uIGHG03DzoklRjBj0GpBypVJZ2qbKvchJ9UYy2xV9c7ynfwd5YJHV1tEVZXrsR4zIm8miZQWfoVq3JdOE_1swzjz2DE7GRBMU_dyE4FUR0q"
                                            : item.id === "ESP32-C3"
                                                ? "https://lh3.googleusercontent.com/aida-public/AB6AXuBjC2Z1TssOAUSFdpoDAQ0LHw5UDlT1ATAhnFUWULNrEZ5g3p614lX668M8BsK3rsdBBhwlH6drb0e2Aht74j4M75FQpUKM8iA0M23VAiX07Vgq3w8Zm-Iwdx_U0D-CAqP1rosHEs837CIpBsmJ6oJ2ohZyeF0lO36HWI3JvuYMpRk4o6M5Hzrq5t8XxK7bkaHJgVhtRIuFyre5lOgBXWx1pFfglvQeBaU9_IbAF0cS22_mNC7SILNpSKP7o_-HVyZXQDw7bb-3Esl7"
                                                : "https://lh3.googleusercontent.com/aida-public/AB6AXuDcFLEFpd_Ew_Byza8Y7bPDlqUrJ_TUMcx3JgmcVZUpJGNI7dFmWUDp_wS_zy1jyb4ITvW4xfTcylrp4PWd82TMZ0KcvA15NTctJuqGhAv8OLNDMYkmhLyyw8onPsGaMrzAaqHoxPBhu5zwOsyfyjRyhLJSU9gCh7ipU0YAH4qKY40De8PL3ZGFOmzlNJajXWl-1ribLqOSHERGyaQiVOEKoAQsnn-rWYqlcGmlgAGdVac-JMoFJTUwBwF-FJyQIjFyqG67_8ViTC1w"
                                    }
                                />
                            </div>
                            <div>
                                <h3 className="text-slate-900 dark:text-white text-lg font-bold mb-1">{item.title}</h3>
                                <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">{item.subtitle}</p>
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                                        <span className="material-symbols-outlined text-sm">memory</span>
                                        <span>{item.id === "ESP32" ? "Dual-core Xtensa® LX6" : item.id === "ESP32-C3" ? "Single-core RISC-V" : "AI Vector Instructions"}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="mt-2 mb-8">
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-4">
                    Specific Board Profile
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {familyOptions.map((profile) => (
                        <button
                            key={profile.id}
                            onClick={() => setBoardId(profile.id)}
                            className={`w-full rounded-xl border-2 px-6 py-4 text-left transition ${board.id === profile.id
                                ? "border-primary bg-primary/5 dark:bg-primary/10 shadow-sm"
                                : "border-slate-200 bg-white hover:border-primary/50 dark:border-slate-800 dark:bg-slate-900/50"
                                }`}
                        >
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <p className="text-base font-bold text-slate-950 dark:text-white">{profile.name}</p>
                                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{profile.description}</p>
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

            <div className="flex flex-col md:flex-row items-center justify-between gap-6 p-6 rounded-xl bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-primary/10 rounded-full">
                        <span className="material-symbols-outlined text-primary">info</span>
                    </div>
                    <div>
                        <p className="text-slate-900 dark:text-white font-bold">Selected: {board.name}</p>
                        <p className="text-slate-500 dark:text-slate-400 text-xs">{board.layoutLabel} · {board.serialBridge}</p>
                        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                            {projectSyncMessage}
                        </p>
                    </div>
                </div>
                <div className="flex gap-4 w-full md:w-auto">
                    <button
                        onClick={() => void onSaveDraft()}
                        disabled={projectSyncState === "saving"}
                        className="flex-1 md:flex-none px-6 py-3 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold hover:bg-slate-200 dark:hover:bg-slate-800 transition-all disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {projectSyncState === "saving" ? "Saving..." : "Save Draft"}
                    </button>
                    <button
                        onClick={onNext}
                        className="flex-1 md:flex-none px-8 py-3 rounded-lg bg-primary text-white font-bold shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all flex items-center justify-center gap-2"
                    >
                        <span>Next: Configure Pins</span>
                        <span className="material-symbols-outlined text-sm">arrow_forward</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
