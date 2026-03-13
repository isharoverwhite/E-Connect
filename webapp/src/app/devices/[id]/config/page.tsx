"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";

export default function DevicePinConfigurator() {
    const router = useRouter();
    const { user } = useAuth();
    const isAdmin = user?.account_type === "admin";

    // Mock State for the visual editor
    const [selectedNode, setSelectedNode] = useState<{ id: string, name: string, type: 'trigger' | 'action' } | null>(null);

    if (!isAdmin) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 dark:bg-slate-950">
                <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">
                        <span className="material-icons-round text-4xl">admin_panel_settings</span>
                    </div>
                    <h1 className="mt-5 text-2xl font-semibold text-slate-900 dark:text-white">Admin access required</h1>
                    <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
                        Device configuration details are only available to administrators. Non-admin accounts can only monitor online and offline status from the devices overview and control rooms assigned by an administrator.
                    </p>
                    <button
                        onClick={() => router.push("/devices")}
                        className="mt-6 rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-blue-600"
                    >
                        Back to devices
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-screen bg-slate-50 dark:bg-slate-950 font-sans text-slate-900 dark:text-slate-100 selection:bg-blue-200">
            {/* Minimal Header */}
            <header className="h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-col md:flex-row items-center justify-between px-6 shrink-0 z-20">
                <div className="flex items-center w-full md:w-auto mb-2 md:mb-0">
                    <button onClick={() => router.push('/devices')} className="mr-3 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
                        <span className="material-icons-round">arrow_back</span>
                    </button>
                    <div className="flex items-center space-x-2">
                        <span className="material-icons-round text-blue-600">developer_board</span>
                        <h1 className="font-semibold px-2 py-1 rounded bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer outline-none focus:ring-2 focus:ring-blue-500 transition-colors inline-block min-w-[200px]" contentEditable suppressContentEditableWarning>
                            Living Room Sensor Node
                        </h1>
                    </div>
                </div>

                <div className="flex items-center space-x-3 w-full md:w-auto justify-between md:justify-end">
                    <span className="text-xs font-medium text-slate-500 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-full flex items-center">
                        <span className="w-2 h-2 rounded-full bg-green-500 mr-2 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span> Connected
                    </span>
                    <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium shadow-sm flex items-center transition-colors">
                        <span className="material-icons-round text-[18px] mr-1.5">save</span> Deploy Config
                    </button>
                </div>
            </header>

            {/* Main Configurator Area */}
            <div className="flex-1 flex overflow-hidden lg:flex-row flex-col">

                {/* Node Library Sidebar */}
                <aside className="w-full lg:w-72 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col shrink-0 lg:max-h-full max-h-[40vh] z-10">
                    <div className="p-4 border-b border-slate-100 dark:border-slate-800">
                        <div className="relative">
                            <span className="material-icons-round absolute left-3 top-2.5 text-slate-400 text-[20px]">search</span>
                            <input type="text" placeholder="Search physical components..." className="w-full bg-slate-100 dark:bg-slate-800 border-none rounded-lg py-2 pl-10 pr-4 text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow" />
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-6">

                        {/* Sensors Category */}
                        <div>
                            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 px-1">Inputs / Sensors</h3>
                            <div className="space-y-2">
                                <div className="p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center cursor-grab hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-sm transition-all group">
                                    <div className="w-8 h-8 rounded-lg bg-orange-100 dark:bg-orange-900/40 text-orange-600 flex items-center justify-center mr-3 shrink-0">
                                        <span className="material-icons-round text[20px]">thermostat</span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">Analog Temp Sensor</p>
                                        <p className="text-[10px] text-slate-500">Requires 1 Analog Pin</p>
                                    </div>
                                    <span className="material-icons-round text-slate-300 group-hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity">drag_indicator</span>
                                </div>

                                <div className="p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center cursor-grab hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-sm transition-all group">
                                    <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600 flex items-center justify-center mr-3 shrink-0">
                                        <span className="material-icons-round text-[20px]">sensors</span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">PIR Motion Array</p>
                                        <p className="text-[10px] text-slate-500">Digital Input (Interrupt)</p>
                                    </div>
                                    <span className="material-icons-round text-slate-300 group-hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity">drag_indicator</span>
                                </div>
                            </div>
                        </div>

                        {/* Outputs Category */}
                        <div>
                            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 px-1">Outputs / Actuators</h3>
                            <div className="space-y-2">
                                <div className="p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center cursor-grab hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-sm transition-all group">
                                    <div className="w-8 h-8 rounded-lg bg-yellow-100 dark:bg-yellow-900/40 text-yellow-600 flex items-center justify-center mr-3 shrink-0">
                                        <span className="material-icons-round text-[20px]">lightbulb</span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">LED Strip (PWM)</p>
                                        <p className="text-[10px] text-slate-500">Requires 1 PWM Pin</p>
                                    </div>
                                    <span className="material-icons-round text-slate-300 group-hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity">drag_indicator</span>
                                </div>

                                <div className="p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center cursor-grab hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-sm transition-all group">
                                    <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/40 text-purple-600 flex items-center justify-center mr-3 shrink-0">
                                        <span className="material-icons-round text-[20px]">toggle_on</span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">5V Relay Module</p>
                                        <p className="text-[10px] text-slate-500">Digital Output (HIGH/LOW)</p>
                                    </div>
                                    <span className="material-icons-round text-slate-300 group-hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity">drag_indicator</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </aside>

                {/* Canvas Workspace */}
                <div className="flex-1 relative bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEiIGZpbGw9IiNjYmQ1ZTEiLz48L3N2Zz4=')] dark:bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEiIGZpbGw9IiMzMzQxNTUiLz48L3N2Zz4=')] overflow-hidden">

                    {/* Floating Controls */}
                    <div className="absolute bottom-6 right-6 flex flex-col space-y-2 z-10 bg-white/50 dark:bg-slate-900/50 backdrop-blur rounded-xl p-1 border border-slate-200/50 dark:border-slate-800/50">
                        <button className="w-10 h-10 flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 rounded-lg shadow-sm transition-colors">
                            <span className="material-icons-round">add</span>
                        </button>
                        <button className="w-10 h-10 flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 rounded-lg shadow-sm transition-colors">
                            <span className="material-icons-round text-[20px]">explore</span>
                        </button>
                        <button className="w-10 h-10 flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 rounded-lg shadow-sm transition-colors">
                            <span className="material-icons-round">remove</span>
                        </button>
                    </div>

                    {/* Infinite Canvas Area */}
                    <div className="absolute inset-0 cursor-move">

                        {/* Center Microcontroller Graphic */}
                        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                            <div className="relative">
                                {/* Simulated Board Outline */}
                                <div className="w-[280px] h-[160px] bg-slate-900 rounded-xl border-4 border-slate-800 shadow-[0_0_40px_rgba(0,0,0,0.2)] flex flex-col justify-between p-4 z-0">
                                    <div className="flex justify-between w-full">
                                        <div className="w-10 h-10 bg-slate-800 rounded-full border-2 border-slate-700 flex items-center justify-center"><div className="w-4 h-4 bg-slate-900 rounded-full"></div></div>
                                        {/* ESP Chip styling */}
                                        <div className="w-16 h-16 bg-[#2a2d36] border object-cover border-slate-700 rounded flex items-center justify-center shadow-inner relative overflow-hidden">
                                            <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                                            <span className="text-[8px] text-slate-500 font-mono tracking-widest font-bold">ESP32-S3</span>
                                        </div>
                                    </div>
                                    <div className="text-center w-full pb-1">
                                        <div className="inline-flex space-x-2">
                                            <div className="w-2 h-4 bg-slate-800 rounded-sm"></div>
                                            <div className="w-4 h-4 bg-slate-700 border border-slate-600 rounded flex items-center justify-center text-[6px] text-slate-400">RST</div>
                                        </div>
                                    </div>
                                </div>

                                {/* Top Pins */}
                                <div className="absolute -top-4 w-full flex justify-between px-6 z-10 pointer-events-none">
                                    {[32, 33, 25, 26, 27, 14, 12, 13].map((pin) => (
                                        <div key={pin} className="flex flex-col items-center pointer-events-auto group">
                                            <div className={`w-3 h-5 rounded-sm shadow-sm transition-colors cursor-crosshair ${pin === 14 ? 'bg-orange-400' : 'bg-slate-300 dark:bg-slate-600 hover:bg-blue-400'}`}></div>
                                            <span className="text-[10px] font-mono font-bold text-slate-600 dark:text-slate-400 mt-1">D{pin}</span>
                                        </div>
                                    ))}
                                </div>

                                {/* Bottom Pins */}
                                <div className="absolute -bottom-4 w-full flex justify-between px-6 z-10 pointer-events-none">
                                    {[15, 2, 0, 4, 16, 17, 5, 18].map((pin) => (
                                        <div key={pin} className="flex flex-col items-center pointer-events-auto group">
                                            <span className="text-[10px] font-mono font-bold text-slate-600 dark:text-slate-400 mb-1">D{pin}</span>
                                            <div className={`w-3 h-5 rounded-sm shadow-sm transition-colors cursor-crosshair ${pin === 2 ? 'bg-purple-500' : 'bg-slate-300 dark:bg-slate-600 hover:bg-blue-400'}`}></div>
                                        </div>
                                    ))}
                                </div>

                            </div>
                        </div>

                        {/* Placed Component 1: Temp Sensor */}
                        <div className="absolute top-[20%] left-[30%]" onClick={() => setSelectedNode({ id: '1', name: 'Ambient Temp', type: 'trigger' })}>
                            <div className={`bg-white dark:bg-slate-800 border-2 rounded-xl p-3 shadow-lg flex items-center w-48 transition-colors cursor-pointer ${selectedNode?.id === '1' ? 'border-blue-500 shadow-blue-500/20' : 'border-slate-200 dark:border-slate-700'}`}>
                                <div className="w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-600 flex items-center justify-center mr-3">
                                    <span className="material-icons-round text-sm">thermostat</span>
                                </div>
                                <div>
                                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Ambient Temp</h4>
                                    <p className="text-[10px] text-slate-500 font-mono">Analog In: D14</p>
                                </div>
                                {/* Connection Point */}
                                <div className="absolute top-1/2 -right-3 -translate-y-1/2 w-4 h-4 bg-orange-400 rounded-full border-2 border-white dark:border-slate-800 shadow-sm"></div>
                            </div>
                        </div>

                        {/* Placed Component 2: Relay */}
                        <div className="absolute bottom-[25%] right-[25%]" onClick={() => setSelectedNode({ id: '2', name: 'Main Power Relay', type: 'action' })}>
                            <div className={`bg-white dark:bg-slate-800 border-2 rounded-xl p-3 shadow-lg flex items-center w-48 transition-colors cursor-pointer ${selectedNode?.id === '2' ? 'border-blue-500 shadow-blue-500/20' : 'border-slate-200 dark:border-slate-700'}`}>
                                {/* Connection Point */}
                                <div className="absolute top-1/2 -left-3 -translate-y-1/2 w-4 h-4 bg-purple-500 rounded-full border-2 border-white dark:border-slate-800 shadow-sm"></div>
                                <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-600 flex items-center justify-center mr-3 ml-2">
                                    <span className="material-icons-round text-sm">toggle_on</span>
                                </div>
                                <div>
                                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white truncate">Main Power Relay</h4>
                                    <p className="text-[10px] text-slate-500 font-mono">Digital Out: D2</p>
                                </div>
                            </div>
                        </div>

                        {/* Rendering SVG connections (mockup) */}
                        <svg className="absolute inset-0 w-full h-full pointer-events-none z-[-1]">
                            {/* Path from Temp to D14 */}
                            <path d="M 580 250 Q 640 250 640 400 T 700 450" fill="none" stroke="#fb923c" strokeWidth="3" strokeDasharray="6 4" className="animate-[dash_1s_linear_infinite]" />
                            {/* Path from Relay to D2 */}
                            <path d="M 850 560 Q 800 560 800 480 T 730 480" fill="none" stroke="#a855f7" strokeWidth="3" strokeDasharray="6 4" className="animate-[dash_1s_linear_infinite]" />
                        </svg>
                        <style dangerouslySetInnerHTML={{
                            __html: `
                            @keyframes dash {
                                to { stroke-dashoffset: -10; }
                            }
                        `}} />

                    </div>
                </div>

                {/* Configuration Inspector Sidebar */}
                {selectedNode && (
                    <aside className="w-full lg:w-80 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col shrink-0 z-20 shadow-[-4px_0_15px_-3px_rgba(0,0,0,0.1)] absolute lg:relative right-0 h-full">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50">
                            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200">Component Config</h2>
                            <button onClick={() => setSelectedNode(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                                <span className="material-icons-round text-sm">close</span>
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-5">
                            <div className="mb-6 flex justify-center">
                                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-inner ${selectedNode.type === 'trigger' ? 'bg-orange-50 text-orange-600' : 'bg-purple-50 text-purple-600'}`}>
                                    <span className="material-icons-round text-3xl">{selectedNode.type === 'trigger' ? 'thermostat' : 'toggle_on'}</span>
                                </div>
                            </div>

                            <form className="space-y-4">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Component Name</label>
                                    <input type="text" defaultValue={selectedNode.name} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white shadow-sm ring-1 ring-slate-200 dark:ring-slate-700 focus:ring-2 focus:ring-blue-500 outline-none" />
                                </div>

                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Assigned Pin</label>
                                    <select defaultValue={selectedNode.type === 'trigger' ? 'D14' : 'D2'} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white shadow-sm ring-1 ring-slate-200 dark:ring-slate-700 focus:ring-2 focus:ring-blue-500 outline-none appearance-none">
                                        <option value="D2">D2 (Digital/PWM)</option>
                                        <option value="D14">D14 (Analog/Digital)</option>
                                        <option value="D15">D15 (Analog/Digital)</option>
                                    </select>
                                </div>

                                <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                                    <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-3 block">Advanced Settings</h4>

                                    {selectedNode.type === 'trigger' && (
                                        <>
                                            <div className="flex items-center justify-between mb-3">
                                                <span className="text-sm text-slate-600 dark:text-slate-400">Read Interval (ms)</span>
                                                <input type="number" defaultValue={1000} className="w-20 bg-slate-50 dark:bg-slate-800 rounded px-2 py-1 text-sm text-center border-none ring-1 ring-slate-200 dark:ring-slate-700" />
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm text-slate-600 dark:text-slate-400">Smoothing Factor</span>
                                                <input type="number" step="0.1" defaultValue={0.5} className="w-16 bg-slate-50 dark:bg-slate-800 rounded px-2 py-1 text-sm text-center border-none ring-1 ring-slate-200 dark:ring-slate-700" />
                                            </div>
                                        </>
                                    )}

                                    {selectedNode.type === 'action' && (
                                        <>
                                            <div className="flex items-center justify-between mb-3">
                                                <span className="text-sm text-slate-600 dark:text-slate-400">Invert Logic</span>
                                                <div className="relative inline-block w-8 align-middle select-none transition duration-200 ease-in">
                                                    <input type="checkbox" name="toggle" id="toggle" className="toggle-checkbox absolute block w-4 h-4 rounded-full bg-white border-4 appearance-none cursor-pointer checked:right-0 checked:border-blue-500 right-4 border-slate-300 transition-all duration-300" />
                                                    <label htmlFor="toggle" className="toggle-label block overflow-hidden h-4 rounded-full bg-slate-300 cursor-pointer"></label>
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm text-slate-600 dark:text-slate-400">Initial State</span>
                                                <select className="bg-slate-50 dark:bg-slate-800 rounded px-2 py-1 text-sm text-center border-none ring-1 ring-slate-200 dark:ring-slate-700 appearance-none">
                                                    <option>LOW</option>
                                                    <option>HIGH</option>
                                                </select>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </form>
                        </div>
                        <div className="p-4 border-t border-slate-200 dark:border-slate-800">
                            <button className="w-full py-2 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 text-sm font-semibold rounded-lg transition-colors border border-red-100 dark:border-red-900/50 flex items-center justify-center">
                                <span className="material-icons-round text-[16px] mr-1.5">delete_outline</span> Remove Component
                            </button>
                        </div>
                    </aside>
                )}

            </div>
        </div>
    );
}
