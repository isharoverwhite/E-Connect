/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import { useEffect } from "react";
import { DISCOVERY_BRIDGE_STORAGE_KEY } from "@/lib/scanner";

type BridgeCompleteClientProps = {
  encodedBridgePayload?: string;
};

export function BridgeCompleteClient({ encodedBridgePayload }: BridgeCompleteClientProps) {
  useEffect(() => {
    if (!encodedBridgePayload) {
      return;
    }

    try {
      window.localStorage.setItem(DISCOVERY_BRIDGE_STORAGE_KEY, encodedBridgePayload);
    } catch {
      // Ignore storage failures and still try to close the helper window.
    }

    window.setTimeout(() => {
      window.close();
    }, 50);
  }, [encodedBridgePayload]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-900">
      <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold">Returning to E-Connect Scan</h1>
        <p className="mt-3 text-sm text-slate-500">
          The local discovery bridge is handing control back to the public scanner.
        </p>
      </div>
    </div>
  );
}
