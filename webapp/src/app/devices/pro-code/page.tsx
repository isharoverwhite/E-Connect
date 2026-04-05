/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";

export default function ProCodePairing() {
    const [copied, setCopied] = useState(false);
    const router = useRouter();
    const { user } = useAuth();
    const isAdmin = user?.account_type === "admin";

    const deviceToken = "ec_node_9f8b7a6c5d4e3f2a1b0c";
    const authCode = `#include <EConnect.h>

void setup() {
  Serial.begin(115200);
  
  // Initialize E-Connect Pro Node
  EConnect.begin(
    "YOUR_WIFI_SSID", 
    "YOUR_WIFI_PASS",
    "living-room-sensor" // Device ID
  );
  
  // Set Auth Token generated from dashboard
  EConnect.setAuthToken("${deviceToken}");
  
  // Configure Hardware
  EConnect.addPin(14, PIN_MODE_ANALOG, "Temp Sensor");
  EConnect.addPin(2, PIN_MODE_OUTPUT, "Main Relay");
}

void loop() {
  EConnect.loop();
  
  // Your custom logic here
  int temp = analogRead(14);
  EConnect.publishState("temperature", temp);
  
  delay(1000);
}`;

    const handleCopy = () => {
        navigator.clipboard.writeText(authCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (!isAdmin) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background-light px-6 text-slate-800 dark:bg-background-dark dark:text-slate-100">
                <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl dark:border-slate-700 dark:bg-slate-900">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                        <span className="material-icons-round text-3xl">admin_panel_settings</span>
                    </div>
                    <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Admin access required</h1>
                    <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
                        Only administrators can provision or pair new devices from the pro-code flow.
                    </p>
                    <button
                        onClick={() => router.push("/devices")}
                        className="mt-6 inline-flex items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-medium text-white shadow-lg transition hover:bg-blue-600"
                    >
                        Back to devices
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex bg-background-dark text-slate-200 min-h-screen font-sans selection:bg-blue-500/30 selection:text-white">

            {/* Minimal Navigation */}
            <aside className="w-16 border-r border-[#1e293b] flex flex-col items-center py-6 shrink-0 bg-[#0b1120]">
                <button onClick={() => router.push('/devices')} className="w-10 h-10 rounded-xl bg-[#1e293b] text-slate-300 hover:text-white flex items-center justify-center transition focus:ring-2 focus:ring-blue-500 mb-8 shadow-sm">
                    <span className="material-icons-round text-xl">arrow_back</span>
                </button>
                <div className="w-8 h-8 rounded text-slate-500 hover:text-slate-300 flex items-center justify-center cursor-pointer transition mb-4">
                    <span className="material-icons-round">library_books</span>
                </div>
                <div className="w-8 h-8 rounded text-slate-500 hover:text-slate-300 flex items-center justify-center cursor-pointer transition">
                    <span className="material-icons-round">help_outline</span>
                </div>
            </aside>

            {/* Main Content Areas */}
            <main className="flex-1 flex flex-col lg:flex-row min-w-0">

                {/* Information Panel */}
                <div className="w-full lg:w-[450px] p-8 lg:p-12 overflow-y-auto border-b lg:border-b-0 lg:border-r border-[#1e293b] bg-[#0f172a] shrink-0">
                    <div className="inline-flex items-center px-2 py-1 rounded bg-blue-500/10 text-blue-400 text-xs font-bold uppercase tracking-wider mb-6 border border-blue-500/20">
                        Pro SDK Provisioning
                    </div>

                    <h1 className="text-3xl font-extrabold text-white mb-2 font-mono tracking-tight">E-Connect C++</h1>
                    <p className="text-slate-400 text-sm mb-8 leading-relaxed">
                        Manually pair a microprocessor using our lightweight native SDK. Ideal for complex edge-logic, custom sensor arrays, or existing firmware integration.
                    </p>

                    <div className="space-y-6">
                        {/* Step 1 */}
                        <div className="relative pl-8">
                            <div className="absolute left-0 top-1 w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center text-[10px] font-bold text-white shadow-[0_0_10px_rgba(37,99,235,0.5)]">1</div>
                            <h3 className="font-semibold text-white mb-1">Install Library</h3>
                            <p className="text-sm text-slate-400 mb-3">Add the E-Connect core library to your PlatformIO or Arduino IDE environment.</p>
                            <div className="bg-[#1e293b] p-3 rounded-lg border border-[#334155] font-mono text-xs text-slate-300 flex justify-between items-center group">
                                <code>pio lib install \&quot;quot;E-Connect Core\&quot;quot;</code>
                                <span className="material-icons-round text-sm text-slate-500 group-hover:text-white cursor-pointer transition">content_copy</span>
                            </div>
                        </div>

                        {/* Step 2 */}
                        <div className="relative pl-8">
                            <div className="absolute left-0 top-1 w-5 h-5 rounded-full bg-slate-700 flex items-center justify-center text-[10px] font-bold text-white">2</div>
                            <h3 className="font-semibold text-white mb-1">Flash Firmware</h3>
                            <p className="text-sm text-slate-400">Copy the generated template on the right into your `main.cpp` and flash it to the board via USB or OTA.</p>
                        </div>

                        {/* Step 3 */}
                        <div className="relative pl-8">
                            <div className="absolute left-0 top-1 w-5 h-5 rounded-full bg-slate-700 flex items-center justify-center text-[10px] font-bold text-white">3</div>
                            <h3 className="font-semibold text-white mb-1">Verify Connection</h3>
                            <p className="text-sm text-slate-400">The device will securely authenticate using the generated token and appear in your dashboard instantly.</p>
                        </div>
                    </div>

                    <div className="mt-12 p-5 bg-orange-500/10 border border-orange-500/20 rounded-xl relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-20 group-hover:opacity-40 transition-opacity">
                            <span className="material-icons-round text-orange-400 text-5xl">vpn_key</span>
                        </div>
                        <h4 className="font-semibold text-orange-400 mb-1 text-sm relative z-10">Secret Token</h4>
                        <p className="text-xs text-slate-400 mb-3 relative z-10 w-4/5">Keep your auth token secure. Never commit this token to public repositories.</p>
                        <div className="bg-[#0f172a] px-3 py-2 rounded border border-[#1e293b] font-mono text-xs text-orange-300 flex items-center justify-between relative z-10">
                            <span className="truncate mr-2">{deviceToken}</span>
                            <span className="material-icons-round text-[16px] text-slate-500 hover:text-orange-400 cursor-pointer transition">content_copy</span>
                        </div>
                    </div>
                </div>

                {/* Code Window */}
                <div className="flex-1 flex flex-col bg-[#0d1117] relative">
                    {/* Fake Window Header */}
                    <div className="h-12 bg-[#161b22] border-b border-[#30363d] flex items-center justify-between px-4 shrink-0">
                        <div className="flex space-x-2">
                            <div className="w-3 h-3 rounded-full bg-[#ff5f56]"></div>
                            <div className="w-3 h-3 rounded-full bg-[#ffbd2e]"></div>
                            <div className="w-3 h-3 rounded-full bg-[#27c93f]"></div>
                        </div>
                        <div className="text-xs font-mono text-slate-400 flex items-center">
                            <span className="material-icons-round text-[14px] mr-1">folder_open</span> src/main.cpp
                        </div>
                        <div className="w-16"></div> {/* Spacer for center alignment */}
                    </div>

                    {/* Editor actions */}
                    <div className="absolute top-16 right-6 z-10 flex space-x-2">
                        <button
                            onClick={handleCopy}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium font-mono border transition-all flex items-center shadow-sm ${copied ? 'bg-green-500/20 border-green-500 text-green-400' : 'bg-[#161b22] border-[#30363d] text-slate-300 hover:border-slate-500 hover:text-white'}`}
                        >
                            <span className="material-icons-round text-[14px] mr-1.5">{copied ? 'check' : 'content_copy'}</span>
                            {copied ? 'Copied!' : 'Copy Template'}
                        </button>
                    </div>

                    {/* Code Container */}
                    <div className="flex-1 overflow-auto p-6 text-sm leading-loose">
                        <pre className="font-mono"><code className="text-slate-300">
                            <span className="text-[#89929b]">{`// Provisioning Template Generated for Living Room Sensor`}</span>

                            <span className="text-[#f78166] font-bold">#include</span> <span className="text-[#a5d6ff]">{`<EConnect.h>`}</span>

                            <span className="text-[#ff7b72] font-semibold">void</span> <span className="text-[#d2a8ff] font-semibold">setup</span>() {'{'}
                            <span className="text-[#79c0ff]">Serial</span>.<span className="text-[#d2a8ff]">begin</span>(<span className="text-[#79c0ff]">115200</span>);

                            <span className="text-[#89929b]">{`// Initialize E-Connect Pro Node`}</span>
                            <span className="text-[#79c0ff]">EConnect</span>.<span className="text-[#d2a8ff]">begin</span>(
                            <span className="text-[#a5d6ff]">&quot;YOUR_WIFI_SSID&quot;</span>,
                            <span className="text-[#a5d6ff]">&quot;YOUR_WIFI_PASS&quot;</span>,
                            <span className="text-[#a5d6ff]">&quot;living-room-sensor&quot;</span> <span className="text-[#89929b]">{`// Device ID`}</span>
                            );

                            <span className="text-[#89929b]">{`// Set Auth Token generated from dashboard`}</span>
                            <span className="text-[#79c0ff]">EConnect</span>.<span className="text-[#d2a8ff]">setAuthToken</span>(<span className="text-[#a5d6ff]">&quot;{deviceToken}&quot;</span>);

                            <span className="text-[#89929b]">{`// Configure Hardware`}</span>
                            <span className="text-[#79c0ff]">EConnect</span>.<span className="text-[#d2a8ff]">addPin</span>(<span className="text-[#79c0ff]">14</span>, <span className="text-[#79c0ff]">PIN_MODE_ANALOG</span>, <span className="text-[#a5d6ff]">&quot;Temp Sensor&quot;</span>);
                            <span className="text-[#79c0ff]">EConnect</span>.<span className="text-[#d2a8ff]">addPin</span>(<span className="text-[#79c0ff]">2</span>, <span className="text-[#79c0ff]">PIN_MODE_OUTPUT</span>, <span className="text-[#a5d6ff]">&quot;Main Relay&quot;</span>);
                            {'}'}

                            <span className="text-[#ff7b72] font-semibold">void</span> <span className="text-[#d2a8ff] font-semibold">loop</span>() {'{'}
                            <span className="text-[#79c0ff]">EConnect</span>.<span className="text-[#d2a8ff]">loop</span>();

                            <span className="text-[#89929b]">{`// Your custom logic here`}</span>
                            <span className="text-[#ff7b72] font-semibold">int</span> temp = <span className="text-[#d2a8ff]">analogRead</span>(<span className="text-[#79c0ff]">14</span>);
                            <span className="text-[#79c0ff]">EConnect</span>.<span className="text-[#d2a8ff]">publishState</span>(<span className="text-[#a5d6ff]">&quot;temperature&quot;</span>, temp);

                            <span className="text-[#d2a8ff]">delay</span>(<span className="text-[#79c0ff]">1000</span>);
                            {'}'}
                        </code></pre>
                    </div>
                </div>

            </main>
        </div>
    );
}
