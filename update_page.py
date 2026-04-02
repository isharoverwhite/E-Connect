import re

with open("webapp/src/app/devices/page.tsx", "r") as f:
    text = f.read()

# 1. Imports
imports = """
import { rebuildFirmware, fetchDevice } from "@/lib/api";
import { OtaUpdateModal } from "@/components/OtaUpdateModal";
import { useOtaUpdate } from "@/hooks/useOtaUpdate";
"""
text = text.replace('import { useWebSocket } from "@/hooks/useWebSocket";', 'import { useWebSocket } from "@/hooks/useWebSocket";\n' + imports)

# 2. State and logic
logic = """
    const [latestFirmwareRevision, setLatestFirmwareRevision] = useState<string | null>(null);

    const [deviceForOta, setDeviceForOta] = useState<DeviceConfig | null>(null);
    const otaState = useOtaUpdate({
        device: deviceForOta,
        fetchDeviceFn: fetchDevice,
        onDeviceUpdated: (updated) => {
            if (updated) setDeviceForOta({ ...deviceForOta, ...updated });
        },
        onBuildJobUpdate: () => {}
    });

    const handleUpdateFirmware = async (deviceId: string) => {
        try {
            const devConfig = await fetchDevice(deviceId);
            if (!devConfig) throw new Error("Could not fetch device config");
            setDeviceForOta(devConfig);
            const res = await rebuildFirmware(deviceId);
            devConfig.pending_build_job_id = res.job_id;
            otaState.openPendingOtaModal(res.job_id);
        } catch (err: any) {
            showToast(err.message || "Failed to rebuild config", "error");
        }
    };
"""
text = text.replace('const [latestFirmwareRevision, setLatestFirmwareRevision] = useState<string | null>(null);', logic)

# 3. Add modal to the DOM
modal_jsx = """
            {deviceForOta && otaState.otaModalOpen && (
                <OtaUpdateModal
                    device={deviceForOta}
                    otaState={otaState}
                    onClose={() => {
                        otaState.setOtaModalOpen(false);
                        setDeviceForOta(null);
                    }}
                />
            )}
            <Sidebar />
"""
text = text.replace('<Sidebar />', modal_jsx)

# 4. Add the button in renderAdminDeviceCard
btn_jsx = """
                    {device.provisioning_project_id && latestFirmwareRevision && device.firmware_revision !== latestFirmwareRevision ? (
                        <button
                            onClick={() => handleUpdateFirmware(device.device_id)}
                            className="flex items-center justify-center rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20"
                            title={`Update available: ${latestFirmwareRevision}`}
                        >
                            <span className="material-icons-round mr-1.5 text-sm">system_update_alt</span>
                            Update FW
                        </button>
                    ) : (
                        <div className="flex items-center justify-center rounded border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-medium text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500 cursor-not-allowed">
                            <span className="material-icons-round mr-1.5 text-sm">check_circle</span>
                            Up to date
                        </div>
                    )}

                    <button
"""
text = text.replace('<button\n                        onClick={() => handleDeleteClick(device.device_id, device.name)}', btn_jsx)

# Wait, `grid-cols-2` might not be enough anymore. Let's change grid-cols-2 to grid-cols-3
text = text.replace('grid-cols-2 gap-2 border-t', 'grid-cols-3 gap-2 border-t')


with open("webapp/src/app/devices/page.tsx", "w") as f:
    f.write(text)

