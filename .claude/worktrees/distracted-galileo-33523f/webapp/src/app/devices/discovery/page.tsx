/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import { useRouter } from "next/navigation";

import DeviceScanConnectPanel from "@/components/DeviceScanConnectPanel";

export default function DeviceDiscovery() {
  const router = useRouter();

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans text-slate-800 dark:bg-slate-950 dark:text-slate-200">
      <aside className="hidden w-20 flex-col items-center border-r border-slate-200 bg-white py-6 dark:border-slate-800 dark:bg-slate-900 md:flex">
        <div className="mb-8 flex h-10 w-10 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600 dark:border-blue-800 dark:bg-blue-900/30">
          <span className="material-icons-round text-2xl">hub</span>
        </div>
        <nav className="flex flex-col space-y-4">
          <button
            onClick={() => router.push("/devices")}
            className="flex h-12 w-12 items-center justify-center rounded-xl text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <span className="material-icons-round">arrow_back</span>
          </button>
          <button
            onClick={() => router.push("/settings")}
            className="flex h-12 w-12 items-center justify-center rounded-xl text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            title="Settings"
          >
            <span className="material-icons-round">settings</span>
          </button>
        </nav>
      </aside>

      <main className="relative flex flex-1 items-center justify-center overflow-hidden p-6">
        <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center opacity-40 dark:opacity-20">
          <div className="absolute h-[800px] w-[800px] animate-[ping_4s_cubic-bezier(0,0,0.2,1)_infinite] rounded-full border border-blue-200 dark:border-blue-800/30"></div>
          <div className="absolute h-[600px] w-[600px] animate-[ping_4s_cubic-bezier(0,0,0.2,1)_infinite_1s] rounded-full border border-blue-300 dark:border-blue-700/40"></div>
          <div className="absolute h-[400px] w-[400px] animate-[ping_4s_cubic-bezier(0,0,0.2,1)_infinite_2s] rounded-full border border-blue-400 dark:border-blue-600/50"></div>
        </div>

        <div className="relative z-10 w-full max-w-xl">
          <DeviceScanConnectPanel onClose={() => router.push("/devices")} />
        </div>
      </main>
    </div>
  );
}
