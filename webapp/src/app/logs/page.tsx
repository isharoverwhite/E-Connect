import Sidebar from "@/components/Sidebar";

export default function LogsPage() {
    return (
        <div className="flex bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 h-screen font-sans overflow-hidden font-sans selection:bg-blue-600 selection:text-white transition-colors duration-300">
            <Sidebar />

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
