"use client";

import { useRouter } from "next/navigation";

export default function LogsPage() {
    const router = useRouter();

    return (
        <div className="flex bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 h-screen font-sans overflow-hidden font-sans selection:bg-blue-600 selection:text-white transition-colors duration-300">
            {/* Sidebar */}
            <aside className="w-64 bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 flex flex-col hidden md:flex z-20 shadow-lg">
                <div className="h-16 flex items-center px-6 border-b border-slate-200 dark:border-slate-800">
                    <span className="material-icons-round text-blue-600 mr-2 text-3xl">hub</span>
                    <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">E-Connect</span>
                </div>
                <div className="flex-1 overflow-y-auto py-4">
                    <nav className="px-4 space-y-1">
                        <button onClick={() => router.push('/')} className="w-full flex items-center px-4 py-3 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors text-left">
                            <span className="material-icons-round mr-3">dashboard</span> Dashboard
                        </button>
                        <button onClick={() => router.push('/devices')} className="w-full flex items-center px-4 py-3 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors text-left">
                            <span className="material-icons-round mr-3">devices_other</span> Devices
                        </button>
                        <button onClick={() => router.push('/automation')} className="w-full flex items-center px-4 py-3 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors text-left">
                            <span className="material-icons-round mr-3">precision_manufacturing</span> Automation
                        </button>
                        <button className="w-full flex items-center px-4 py-3 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium rounded-lg text-left">
                            <span className="material-icons-round mr-3">analytics</span> Logs & Stats
                        </button>
                        <button onClick={() => router.push('/extensions')} className="w-full flex items-center px-4 py-3 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors text-left">
                            <span className="material-icons-round mr-3">extension</span> Extensions
                        </button>
                    </nav>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
                <div className="p-8">
                    <h1 className="text-2xl font-bold mb-6">Logs & Stats</h1>
                    <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-8 flex flex-col items-center justify-center text-center">
                        <span className="material-icons-round text-4xl text-slate-400 mb-4">analytics</span>
                        <h2 className="text-xl font-semibold mb-2 text-slate-900 dark:text-white">System Analytics</h2>
                        <p className="text-slate-500 max-w-md">Detailed logs, metrics, and network statistics will appear here. This module is currently under development.</p>
                    </div>
                </div>
            </main>
        </div>
    );
}
