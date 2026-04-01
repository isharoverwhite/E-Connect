"use client";

import { useState } from "react";

import Sidebar from "@/components/Sidebar";

export default function ExtensionsLibrary() {
    const [activeTab, setActiveTab] = useState<'installed' | 'discover'>('installed');
    const [isUploading, setIsUploading] = useState(false);

    return (
        <div className="flex bg-background-light dark:bg-background-dark text-slate-800 dark:text-slate-200 min-h-screen font-sans">

            {/* Shared Sidebar Component */}
            <Sidebar />

            {/* Main Content Area */}
            <main className="flex-1 flex flex-col min-w-0">

                {/* Header */}
                <header className="h-16 bg-surface-light dark:bg-surface-dark border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-6 shrink-0 z-10 sticky top-0">
                    <div className="flex items-center">
                        <button className="md:hidden mr-4 text-slate-500 hover:text-slate-900 dark:hover:text-white transition">
                            <span className="material-icons-round">menu</span>
                        </button>
                        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Extensions</h1>
                    </div>

                    <button
                        onClick={() => setIsUploading(true)}
                        className="bg-primary hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition-colors flex items-center"
                    >
                        <span className="material-icons-round text-[18px] mr-2">upload_file</span> Install via ZIP
                    </button>
                </header>

                {/* Upload Modal Overlay */}
                {isUploading && (
                    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 w-full max-w-md animate-in zoom-in-95 duration-200">
                            <div className="flex justify-between items-center p-6 border-b border-slate-100 dark:border-slate-800">
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Upload Extension</h3>
                                <button onClick={() => setIsUploading(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                                    <span className="material-icons-round">close</span>
                                </button>
                            </div>
                            <div className="p-6">
                                <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-8 flex flex-col items-center justify-center text-center hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:border-blue-500 transition-colors cursor-pointer group">
                                    <div className="w-16 h-16 bg-blue-50 dark:bg-blue-900/30 rounded-full flex items-center justify-center text-blue-500 mb-4 group-hover:scale-110 transition-transform">
                                        <span className="material-icons-round text-3xl">cloud_upload</span>
                                    </div>
                                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Click to upload or drag ZIP file here</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">Must contain a valid manifest.json file.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Page Content */}
                <div className="flex-1 overflow-y-auto p-6 md:p-8">
                    <div className="max-w-6xl mx-auto">

                        {/* Tabs */}
                        <div className="flex border-b border-slate-200 dark:border-slate-700 mb-8 space-x-8">
                            <button
                                onClick={() => setActiveTab('installed')}
                                className={`pb-4 text-sm font-medium transition-colors relative ${activeTab === 'installed' ? 'text-primary' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                            >
                                Installed Integrations
                                {activeTab === 'installed' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-primary rounded-t-full"></div>}
                            </button>
                            <button
                                onClick={() => setActiveTab('discover')}
                                className={`pb-4 text-sm font-medium transition-colors relative ${activeTab === 'discover' ? 'text-primary' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                            >
                                Discover Marketplace
                                {activeTab === 'discover' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-primary rounded-t-full"></div>}
                            </button>
                        </div>

                        {activeTab === 'installed' && (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                <div className="col-span-full py-12 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                                    <div className="w-16 h-16 bg-slate-50 dark:bg-slate-800/50 rounded-full flex items-center justify-center text-slate-400 mx-auto mb-4">
                                        <span className="material-icons-round text-3xl">extension_off</span>
                                    </div>
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">No extensions installed</h3>
                                    <p className="text-slate-500 mt-1 max-w-sm mx-auto">You haven&apos;t installed any extensions yet. Check out the Discover tab.</p>
                                </div>
                            </div>
                        )}

                        {activeTab === 'discover' && (
                            <div>
                                {/* Search & Filter Banner */}
                                <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl p-8 text-white mb-8 shadow-lg">
                                    <h2 className="text-2xl font-bold mb-2">Enhance your ecosystem</h2>
                                    <p className="text-blue-100 mb-6 max-w-xl">Browse community plugins. Want to build your own? Read the Pro Code extension SDK documentation.</p>
                                    <div className="relative max-w-2xl">
                                        <span className="material-icons-round absolute left-4 top-3.5 text-slate-400">search</span>
                                        <input type="text" placeholder="Search extensions..." className="w-full bg-white rounded-xl py-3 pl-12 pr-4 text-slate-900 outline-none shadow-sm focus:ring-4 focus:ring-blue-500/30" />
                                    </div>
                                </div>

                                <div className="flex justify-between items-end mb-6">
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">Trending Extensions</h3>
                                    <div className="flex space-x-2">
                                        <button className="px-3 py-1.5 text-sm font-medium bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-white rounded-lg">All</button>
                                        <button className="px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">Cloud Sync</button>
                                        <button className="px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">Virtual Devices</button>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div className="py-12 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                                        <p className="text-slate-500">No extensions available in the marketplace right now.</p>
                                    </div>
                                </div>
                            </div>
                        )}

                    </div>
                </div>

            </main>
        </div>
    );
}
