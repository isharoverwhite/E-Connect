import re

with open("webapp/src/app/devices/[id]/config/page.tsx", "r") as f:
    text = f.read()

# 1. Add imports
text = re.sub(
    r'import { useWebSocket } from "@/hooks/useWebSocket";',
    r'import { useWebSocket } from "@/hooks/useWebSocket";\nimport { useOtaUpdate } from "@/hooks/useOtaUpdate";\nimport { OtaUpdateModal } from "@/components/OtaUpdateModal";',
    text
)

# 2. Replace State declarations
state_regex = re.compile(r'const \[jobId, setJobId\].*?const \[statusMessage, setStatusMessage\] = useState<string \| null>\(null\);', re.DOTALL)
text = state_regex.sub('const otaState = useOtaUpdate({ device, fetchDeviceFn: fetchDevice, onDeviceUpdated: setDevice, onBuildJobUpdate: handleBuildJobUpdated });\n  const { jobId, jobStatus, expectedFirmwareVersion, setExpectedFirmwareVersion, setOtaModalOpen, openPendingOtaModal } = otaState;', text)

# 3. Replace useEffects & logic
# We need to drop all the useEffects related to OTA. They are grouped together.
# Let's find "const handleSaveShortcut" and delete everything before it up to the state definitions.
# Let's be manual with regex.
# Actually, the user already saw it work! So I'll just use the old commit! Wait!
