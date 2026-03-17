"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { fetchDevice, saveDeviceConfig, sendDeviceCommand, API_URL } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { Step2Pins } from "@/features/diy/components/Step2Pins";
import type { DeviceConfig, PinConfig } from "@/types/device";
import type { PinMapping, BuildJobStatus } from "@/features/diy/types";
import { BOARD_PROFILES, type BoardProfile } from "@/features/diy/board-profiles";

interface DiyProjectResponse {
    board_profile: string;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export default function DevicePinConfigurator({ params }: { params: Promise<{ id: string }> }) {
    const router = useRouter();
    const { user } = useAuth();
    const isAdmin = user?.account_type === "admin";
    // Unwrap the Next.js 16 params Promise
    const resolvedParams = use(params);
    const deviceId = resolvedParams.id;
    
    const [device, setDevice] = useState<DeviceConfig | null>(null);
    const [project, setProject] = useState<DiyProjectResponse | null>(null);
    const [boardProfile, setBoardProfile] = useState<BoardProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [pins, setPins] = useState<PinMapping[]>([]);
    const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    
    // OTA State
    const [jobId, setJobId] = useState<string | null>(null);
    const [jobStatus, setJobStatus] = useState<BuildJobStatus | null>(null);
    const [otaModalOpen, setOtaModalOpen] = useState(false);

    useEffect(() => {
        if (!isAdmin) return;
        let isMounted = true;

        const init = async () => {
            try {
                const dev = await fetchDevice(deviceId);
                if (!dev) throw new Error("Device not found");
                if (!dev.provisioning_project_id) {
                    throw new Error("Pin configuration is only available for DIY/No-Code devices that have a provisioning project.");
                }

                // Fetch the DIY project to get board profile
                const token = getToken();
                const res = await fetch(`${API_URL}/diy/projects/${dev.provisioning_project_id}`, {
                    headers: { "Authorization": `Bearer ${token}` }
                });
                if (!res.ok) throw new Error("Failed to load device project data");
                const projData = await res.json();
                
                const bp = BOARD_PROFILES.find((board) => board.id === projData.board_profile);
                if (!bp) throw new Error(`Unknown board profile: ${projData.board_profile}`);

                if (isMounted) {
                    setDevice(dev as DeviceConfig);
                    setProject(projData);
                    setBoardProfile(bp);
                    // Map Device PinConfigResponse to PinMapping[]
                    const mappedPins: PinMapping[] = dev.pin_configurations.map((pin: PinConfig) => ({
                        gpio_pin: pin.gpio_pin,
                        mode: pin.mode,
                        function: pin.function,
                        label: pin.label,
                        extra_params: pin.extra_params ?? {}
                    }));
                    setPins(mappedPins);
                }
            } catch (err) {
                if (isMounted) setError(getErrorMessage(err));
            } finally {
                if (isMounted) setLoading(false);
            }
        };
        init();
        return () => { isMounted = false; };
    }, [deviceId, isAdmin]);

    useEffect(() => {
        if (!jobId || !otaModalOpen) return;
        
        const interval = setInterval(async () => {
            try {
                const token = getToken();
                const res = await fetch(`${API_URL}/diy/build/${jobId}`, {
                    headers: { "Authorization": `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setJobStatus(data.status);
                    
                    // Do not stop polling when artifact_ready, stop only when flashed or failed
                    if (data.status === 'build_failed' || data.status === 'flashed' || data.status === 'flash_failed') {
                        clearInterval(interval);
                    }
                }
            } catch (e) {
                console.error("Failed to poll job", e);
            }
        }, 2000);
        return () => clearInterval(interval);
    }, [jobId, otaModalOpen]);

    if (!isAdmin) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 dark:bg-slate-950">
                <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">
                        <span className="material-icons-round text-4xl">admin_panel_settings</span>
                    </div>
                    <h1 className="mt-5 text-2xl font-semibold text-slate-900 dark:text-white">Admin access required</h1>
                    <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
                        Device configuration details are only available to administrators.
                    </p>
                    <button onClick={() => router.push("/devices")} className="mt-6 rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-blue-600">
                        Back to devices
                    </button>
                </div>
            </div>
        );
    }

    if (loading) return <div className="p-8 text-center bg-slate-50 dark:bg-slate-950 h-screen">Loading device config...</div>;
    if (error) return <div className="p-8 text-center text-red-500 bg-slate-50 dark:bg-slate-950 h-screen">{error}</div>;
    if (!device || !project || !boardProfile) return null;

    const handleDeploy = async () => {
        setIsSaving(true);
        try {
            const result = await saveDeviceConfig(device.device_id, { pins });
            if (result.status === "failed") {
                throw new Error(result.message || "Failed to save configuration");
            }
            setJobId(result.job_id || null);
            setJobStatus('queued');
            setOtaModalOpen(true);
        } catch (err) {
            alert("Failed to save config: " + getErrorMessage(err));
        } finally {
            setIsSaving(false);
        }
    };

    const handleInitiateOTA = async () => {
        if (!device || !jobId) return;
        try {
            // Get the job data, which now has the ota_token
            const token = getToken();
            const res = await fetch(`${API_URL}/diy/build/${jobId}`, {
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (!res.ok) throw new Error("Failed to get job token");
            const jobData = await res.json();
            
            if (!jobData.ota_token) throw new Error("Server did not provide an OTA token");

            const fwUrl = `${window.location.protocol}//${window.location.host}/api/v1/diy/ota/download/${jobId}/firmware.bin?token=${jobData.ota_token}`;
            const result = await sendDeviceCommand(device.device_id, {
                kind: "system",
                action: "ota",
                payload: fwUrl,
                url: fwUrl,
                job_id: jobId
            });
            if (result.status === "failed") {
                throw new Error(result.message || "Command failed");
            }
            // Keep the modal open so we can poll the flashing status
        } catch (err) {
            alert("Failed to send OTA command: " + getErrorMessage(err));
        }
    };

    return (
        <div className="flex flex-col h-screen bg-slate-50 dark:bg-slate-950 font-sans text-slate-900 dark:text-slate-100">
            {/* Header */}
            <header className="h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-6 shrink-0 z-20">
                <div className="flex items-center space-x-4">
                    <button onClick={() => router.push('/devices')} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
                        <span className="material-icons-round">arrow_back</span>
                    </button>
                    <div className="flex items-center space-x-2">
                        <span className="material-icons-round text-blue-600">developer_board</span>
                        <h1 className="font-semibold">{device.name} Config</h1>
                    </div>
                </div>

                <div className="flex items-center space-x-3">
                    <span className="text-xs font-medium text-slate-500 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-full flex items-center">
                        <span className={`w-2 h-2 rounded-full mr-2 ${device.conn_status === 'online' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-slate-400'}`}></span>
                        {device.conn_status}
                    </span>
                    <button 
                        onClick={handleDeploy}
                        disabled={isSaving}
                        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-medium shadow-sm flex items-center transition-colors">
                        {isSaving ? (
                            <span className="material-icons-round text-[18px] mr-1.5 animate-spin">refresh</span>
                        ) : (
                            <span className="material-icons-round text-[18px] mr-1.5">cloud_upload</span>
                        )}
                        Save & Deploy
                    </button>
                </div>
            </header>

            {/* Main Configurator Area: Reusing Step2Pins */}
            <div className="flex-1 flex overflow-hidden">
                <Step2Pins 
                    pins={pins}
                    setPins={setPins}
                    board={boardProfile}
                    boardPins={[...boardProfile.leftPins, ...boardProfile.rightPins]}
                    selectedPinId={selectedPinId}
                    setSelectedPinId={setSelectedPinId}
                    projectName={device.name}
                    draftConfig={{name: device.name, board_profile: project.board_profile}}
                    configBusy={isSaving}
                    projectSyncState="saved"
                    projectSyncMessage="Synced with device"
                    onExportConfig={async () => {}}
                    onNext={() => {}}
                    onBack={() => {}}
                />
            </div>

            {/* OTA Progress Modal */}
            {otaModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-md shadow-2xl border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-bold mb-4">Firmware Rebuild & OTA</h2>
                        <div className="space-y-4">
                            <p className="text-sm text-slate-600 dark:text-slate-300">
                                Status: <span className="font-mono font-bold">{jobStatus || "initializing..."}</span>
                            </p>
                            
                            {jobStatus === 'building' && (
                                <div className="flex items-center space-x-3 text-blue-600">
                                    <span className="material-icons-round animate-spin">settings</span>
                                    <span>Building new firmware...</span>
                                </div>
                            )}

                            {jobStatus === 'artifact_ready' && (
                                <div className="flex items-center space-x-3 text-green-600">
                                    <span className="material-icons-round">check_circle</span>
                                    <span>Build complete. Ready for OTA transfer.</span>
                                </div>
                            )}

                            {jobStatus === 'build_failed' && (
                                <div className="flex items-center space-x-3 text-red-600">
                                    <span className="material-icons-round">error</span>
                                    <span>Firmware build failed. Check server logs.</span>
                                </div>
                            )}

                            {jobStatus === 'flashing' && (
                                <div className="flex items-center space-x-3 text-blue-600">
                                    <span className="material-icons-round animate-bounce">system_update_alt</span>
                                    <span>Device is downloading firmware and flashing...</span>
                                </div>
                            )}

                            {jobStatus === 'flashed' && (
                                <div className="flex items-center space-x-3 text-green-600">
                                    <span className="material-icons-round">task_alt</span>
                                    <span>OTA update successful! Device will reboot shortly.</span>
                                </div>
                            )}

                            {jobStatus === 'flash_failed' && (
                                <div className="flex items-center space-x-3 text-red-600">
                                    <span className="material-icons-round">warning</span>
                                    <span>Device reported failure installing OTA.</span>
                                </div>
                            )}
                        </div>
                        
                        <div className="mt-8 flex justify-end space-x-3">
                            <button 
                                onClick={() => setOtaModalOpen(false)}
                                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
                            >
                                Close
                            </button>
                            <button
                                onClick={handleInitiateOTA}
                                disabled={jobStatus !== 'artifact_ready'}
                                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-xl disabled:opacity-50"
                            >
                                Send OTA Command
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
