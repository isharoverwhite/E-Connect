"use client";

import { useState } from "react";

export default function AutomationEditor() {
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    return (
        <div className="flex bg-background-light dark:bg-background-dark text-slate-800 dark:text-slate-200 h-screen font-sans overflow-hidden font-sans selection:bg-primary selection:text-white transition-colors duration-300">
            {/* Sidebar */}
            <aside className="w-64 bg-surface-light dark:bg-surface-dark border-r border-slate-200 dark:border-slate-700 flex flex-col hidden md:flex z-20 shadow-lg">
                <div className="h-16 flex items-center px-6 border-b border-slate-200 dark:border-slate-700">
                    <span className="material-icons-round text-primary mr-2 text-3xl">hub</span>
                    <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">E-Connect</span>
                </div>
                <div className="flex-1 overflow-y-auto py-4">
                    <nav className="px-4 space-y-1">
                        <a href="/" className="flex items-center px-4 py-3 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors">
                            <span className="material-icons-round mr-3">dashboard</span> Dashboard
                        </a>
                        <a href="/devices" className="flex items-center px-4 py-3 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors">
                            <span className="material-icons-round mr-3">devices_other</span> Devices
                        </a>
                        <a href="/automation" className="flex items-center px-4 py-3 bg-primary/10 text-primary font-medium rounded-lg">
                            <span className="material-icons-round mr-3">precision_manufacturing</span> Automation
                        </a>
                        <a href="/logs" className="flex items-center px-4 py-3 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors">
                            <span className="material-icons-round mr-3">analytics</span> Logs & Stats
                        </a>
                        <a href="/extensions" className="flex items-center px-4 py-3 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors">
                            <span className="material-icons-round mr-3">extension</span> Extensions
                        </a>
                    </nav>

                    {/* Scripts List */}
                    <div className="mt-8 px-8">
                        <h3 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4">Your Scripts</h3>
                        <div className="space-y-2">
                            <button className="flex items-center w-full text-left text-sm font-medium text-slate-900 dark:text-white  group">
                                <span className="material-icons-round text-lg text-primary mr-2">description</span>
                                Auto_Lights.js
                                <span className="material-icons-round text-sm ml-auto opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition border-slate-200">delete</span>
                            </button>
                            <button className="flex items-center w-full text-left text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition group">
                                <span className="material-icons-round text-lg text-slate-400 mr-2">description</span>
                                Security_Alert.py
                                <span className="material-icons-round text-sm ml-auto opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition">delete</span>
                            </button>
                            <button className="flex items-center w-full text-left text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition group">
                                <span className="material-icons-round text-lg text-slate-400 mr-2">description</span>
                                Temp_Control.js
                                <span className="material-icons-round text-sm ml-auto opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition">delete</span>
                            </button>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Workspace */}
            <main className="flex-1 flex flex-col min-w-0">
                {/* Header */}
                <header className="h-16 bg-surface-light dark:bg-surface-dark border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-6 z-10 shrink-0">
                    <div className="flex items-center">
                        <button className="md:hidden mr-4 text-slate-500 hover:text-slate-900 dark:hover:text-white">
                            <span className="material-icons-round">menu</span>
                        </button>
                        <h1 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center">
                            Auto_Lights.js <span className="ml-3 px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-green-100 text-green-700 border border-green-200">Active</span>
                        </h1>
                    </div>
                    <div className="flex items-center space-x-3">
                        <span className="text-xs text-slate-500 dark:text-slate-400 hidden sm:inline-block mr-2">Saved 2 mins ago</span>
                        <button className="p-2 text-slate-500 hover:text-primary bg-slate-100 dark:bg-slate-800 rounded-lg transition-colors" title="Format Document">
                            <span className="material-icons-round text-[20px]">format_align_left</span>
                        </button>
                        <button className="p-2 text-slate-500 hover:text-red-500 bg-slate-100 dark:bg-slate-800 rounded-lg transition-colors group" title="Stop Script">
                            <span className="material-icons-round text-[20px] group-hover:animate-pulse">stop_circle</span>
                        </button>
                        <button className="px-4 py-2 bg-primary hover:bg-blue-600 text-white text-sm font-medium rounded-lg shadow flex items-center transition-colors">
                            <span className="material-icons-round text-[18px] mr-2">play_arrow</span>
                            Run
                        </button>
                    </div>
                </header>

                {/* Editor Area */}
                <div className="flex-1 flex overflow-hidden">
                    {/* Code Editor (Simulated) */}
                    <div className="flex-1 flex flex-col bg-slate-50 dark:bg-[#0f111a] relative border-r border-slate-200 dark:border-slate-800">
                        {/* Editor Tabs */}
                        <div className="flex bg-slate-200/50 dark:bg-[#1a1d27] border-b border-slate-200 dark:border-[#2b2f3d] shrink-0 overflow-x-auto no-scrollbar">
                            <div className="px-4 py-2 border-r border-slate-200 dark:border-[#2b2f3d] bg-white dark:bg-[#0f111a] text-sm text-primary border-t-2 border-t-primary flex items-center min-w-fit">
                                <span className="material-symbols-outlined text-sm mr-2 text-yellow-500">javascript</span>
                                Auto_Lights.js
                                <span className="material-icons-round text-[14px] ml-3 text-slate-400 hover:text-slate-700 cursor-pointer">close</span>
                            </div>
                            <div className="px-4 py-2 border-r border-slate-200 dark:border-[#2b2f3d] text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#1f222e] flex items-center cursor-pointer transition min-w-fit">
                                <span className="material-symbols-outlined text-sm mr-2 text-blue-400">terminal</span>
                                Security_Alert.py
                            </div>
                            <button className="px-3 py-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><span className="material-icons-round text-sm">add</span></button>
                        </div>

                        {/* Code Container */}
                        <div className="flex-1 overflow-auto bg-slate-50 dark:bg-[#0f111a] font-mono text-sm leading-relaxed p-4 selection:bg-blue-200 dark:selection:bg-blue-900/50 text-slate-800 dark:text-slate-300">
                            <pre><code><span className="text-purple-600 dark:text-[#c792ea] italic">import</span> {'{'} Board, Led, Sensor {'}'} <span className="text-purple-600 dark:text-[#c792ea] italic">from</span> <span className="text-green-600 dark:text-[#c3e88d]">'@e-connect/core'</span>;
                                <span className="text-purple-600 dark:text-[#c792ea] italic">import</span> {'{'} Time {'}'} <span className="text-purple-600 dark:text-[#c792ea] italic">from</span> <span className="text-green-600 dark:text-[#c3e88d]">'@e-connect/utils'</span>;

                                <span className="text-slate-500 dark:text-[#697098]">/*
                                    * Automatically turn on living room lights when motion is detected
                                    * and it is after sunset.
                                    */</span>

                                <span className="text-blue-600 dark:text-[#82aaff] italic">const</span> board = <span className="text-blue-600 dark:text-[#82aaff] italic">new</span> <span className="text-yellow-600 dark:text-[#ffcb6b]">Board</span>({'}'}
                                id: <span className="text-green-600 dark:text-[#c3e88d]">'living-room-node-1'</span>
                                {'}'});

                                <span className="text-blue-600 dark:text-[#82aaff] italic">const</span> motionSensor = <span className="text-blue-600 dark:text-[#82aaff] italic">new</span> <span className="text-yellow-600 dark:text-[#ffcb6b]">Sensor</span>({'{}'} pin: <span className="text-orange-500 dark:text-[#f78c6c]">14</span>, type: <span className="text-green-600 dark:text-[#c3e88d]">'PIR'</span> {'}'});
                                <span className="text-blue-600 dark:text-[#82aaff] italic">const</span> mainLight = <span className="text-blue-600 dark:text-[#82aaff] italic">new</span> <span className="text-yellow-600 dark:text-[#ffcb6b]">Led</span>({'{}'} pin: <span className="text-orange-500 dark:text-[#f78c6c]">2</span>, pwm: <span className="text-orange-500 dark:text-[#f78c6c]">true</span> {'}'});

                                board.on(<span className="text-green-600 dark:text-[#c3e88d]">'ready'</span>, () =&gt; {'{'}
                                <span className="text-blue-500 dark:text-[#89ddff]">console</span>.<span className="text-blue-600 dark:text-[#82aaff]">log</span>(<span className="text-green-600 dark:text-[#c3e88d]">'Board connected. Waiting for motion...'</span>);

                                motionSensor.on(<span className="text-green-600 dark:text-[#c3e88d]">'change'</span>, (value) =&gt; {'{'}
                                <span className="text-purple-600 dark:text-[#c792ea] italic">if</span> (value === <span className="text-orange-500 dark:text-[#f78c6c]">1</span>) {'{'}
                                <span className="text-purple-600 dark:text-[#c792ea] italic">if</span> (Time.<span className="text-blue-600 dark:text-[#82aaff]">isAfterSunset</span>()) {'{'}
                                mainLight.<span className="text-blue-600 dark:text-[#82aaff]">brightness</span>(<span className="text-orange-500 dark:text-[#f78c6c]">100</span>);
                                <span className="text-blue-500 dark:text-[#89ddff]">console</span>.<span className="text-blue-600 dark:text-[#82aaff]">log</span>(<span className="text-green-600 dark:text-[#c3e88d]">'Motion detected. Lights ON.'</span>);

                                <span className="text-blue-600 dark:text-[#82aaff] italic">setTimeout</span>(() =&gt; {'{'}
                                mainLight.<span className="text-blue-600 dark:text-[#82aaff]">off</span>();
                                <span className="text-blue-500 dark:text-[#89ddff]">console</span>.<span className="text-blue-600 dark:text-[#82aaff]">log</span>(<span className="text-green-600 dark:text-[#c3e88d]">'Timeout reached. Lights OFF.'</span>);
                                {'}'}, <span className="text-orange-500 dark:text-[#f78c6c]">300000</span>); <span className="text-slate-500 dark:text-[#697098]">// 5 minutes</span>
                                {'}'}
                                {'}'}
                                {'}'});
                                {'}'});</code></pre>
                        </div>
                    </div>

                    {/* Console & Tools Panel (Right Side) */}
                    <div className="w-80 bg-surface-light dark:bg-surface-dark flex flex-col hidden lg:flex border-l border-slate-200 dark:border-slate-700 shrink-0">
                        {/* Panel Tabs */}
                        <div className="flex bg-slate-50 dark:bg-[#1a1d27] border-b border-slate-200 dark:border-slate-700 shrink-0">
                            <div className="flex-1 text-center py-2 border-b-2 border-primary text-sm font-medium text-primary cursor-pointer">Console Output</div>
                            <div className="flex-1 text-center py-2 text-sm font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer">Variables</div>
                        </div>

                        {/* Terminal Area */}
                        <div className="flex-1 bg-terminal-bg p-4 overflow-y-auto font-mono text-xs text-slate-300">
                            <div className="text-green-400">[14:22:01] Script Engine Started...</div>
                            <div className="text-slate-400">[14:22:02] Connecting to MQTT broker tcp://100.82.44.52:1883</div>
                            <div className="text-blue-400">[14:22:03] Connected. Subscribing to node/living-room-node-1/#</div>
                            <div className="text-yellow-400">[14:22:05] Board connected. Waiting for motion...</div>
                            <div className="text-slate-500 my-2">-- Idle for 2 hours --</div>
                            <div className="text-blue-200">[16:45:12] Motion detected! (Pin 14 HIGH)</div>
                            <div className="text-slate-400">[16:45:12] Check: Time.isAfterSunset() == true</div>
                            <div className="text-green-400">[16:45:12] Executing mainLight.brightness(100)</div>
                            <div className="text-yellow-400">[16:45:12] Motion detected. Lights ON.</div>
                            <div className="animate-pulse mt-2 inline-block relative pr-2 border-r-[6px] border-slate-400">&nbsp;</div>
                        </div>

                        {/* Status Bar */}
                        <div className="h-10 bg-slate-800 dark:bg-slate-900 border-t border-slate-700 flex items-center justify-between px-3 text-[11px] text-slate-400 shrink-0">
                            <div className="flex items-center space-x-3">
                                <span className="flex items-center"><span className="material-icons-round text-[12px] text-green-400 mr-1">check_circle</span> Node CLI Ready</span>
                                <span className="flex items-center"><span className="material-icons-round text-[12px] mr-1">network_ping</span> 14ms</span>
                            </div>
                            <div className="flex items-center space-x-2">
                                <span>UTF-8</span>
                                <span>JavaScript</span>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
