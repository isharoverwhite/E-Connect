// Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.
"use client";

import { useWebSocket } from "@/hooks/useWebSocket";
import { useToast } from "@/components/ToastContext";
import { useAuth } from "@/components/AuthProvider";

export function AppEventListener() {
  const { user } = useAuth();
  const { showToast } = useToast();

  useWebSocket((event) => {
    if (!user) return;

    if (event.type === "automation_fired") {
      const { automation_name, status } = event.payload;
      if (status === "success") {
        showToast(`Automation '${automation_name}' triggered successfully`, "success");
      }
      return;
    }

    if (event.type === "device_offline") {
      const deviceName =
        typeof event.payload?.device_name === "string" && event.payload.device_name
          ? event.payload.device_name
          : event.device_id;
      showToast(`Device '${deviceName}' went offline`, "warning");
      return;
    }
  });

  return null;
}
