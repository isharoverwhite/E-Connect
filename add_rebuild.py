import re
with open("webapp/src/lib/api.ts", "r") as f:
    text = f.read()

func = """
export const rebuildFirmware = async (
  deviceId: string
): Promise<{ status: string; job_id: string; config_id: number; message: string }> => {
  const response = await fetch(`${API_BASE_URL}/device/${deviceId}/action/rebuild`, {
    method: "POST",
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.detail || "Failed to trigger firmware rebuild");
  }
  return response.json();
};
"""

if "rebuildFirmware" not in text:
    text = text + "\n" + func
    with open("webapp/src/lib/api.ts", "w") as f:
        f.write(text)
    print("Added rebuildFirmware to api.ts")
