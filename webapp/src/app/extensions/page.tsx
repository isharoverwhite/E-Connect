"use client";

import { useState } from "react";

import Image from "next/image";
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
                                {/* Extension Card 1 */}
                                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
                                    <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="flex items-center space-x-4">
                                            <div className="w-12 h-12 bg-blue-50 dark:bg-slate-800 rounded-xl flex items-center justify-center border border-blue-100 dark:border-slate-700">
                                                <Image src="https://cdn.worldvectorlogo.com/logos/home-assistant.svg" alt="Home Assistant" width={32} height={32} className="opacity-90" />
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-slate-900 dark:text-white">Home Assistant Connect</h3>
                                                <p className="text-xs text-slate-500">v1.2.4 • Official</p>
                                            </div>
                                        </div>
                                        <div className="relative inline-block w-10 align-middle select-none transition duration-200 ease-in">
                                            <input type="checkbox" name="toggle1" id="toggle1" className="toggle-checkbox absolute block w-5 h-5 rounded-full bg-white border-4 appearance-none cursor-pointer checked:right-0 checked:border-blue-500 right-0 border-slate-300 transition-all duration-300" defaultChecked />
                                            <label htmlFor="toggle1" className="toggle-label block overflow-hidden h-5 rounded-full bg-blue-500 cursor-pointer"></label>
                                        </div>
                                    </div>
                                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-6 line-clamp-2">
                                        Bridges E-Connect devices to your local Home Assistant instance via auto-discovery MQTT.
                                    </p>
                                    <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800">
                                        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1.5 animate-pulse"></span> Running
                                        </span>
                                        <button className="text-slate-400 hover:text-primary transition-colors">
                                            <span className="material-icons-round text-lg">settings</span>
                                        </button>
                                    </div>
                                </div>

                                {/* Extension Card 2 */}
                                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
                                    <div className="absolute top-0 left-0 w-1 h-full bg-slate-300 dark:bg-slate-700"></div>
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="flex items-center space-x-4">
                                            <div className="w-12 h-12 bg-slate-50 dark:bg-slate-800 rounded-xl flex items-center justify-center border border-slate-100 dark:border-slate-700">
                                                <span className="material-icons-round text-yellow-500 text-2xl">sunny</span>
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-slate-900 dark:text-white">Weather Aware</h3>
                                                <p className="text-xs text-slate-500">v0.9.1 • Community</p>
                                            </div>
                                        </div>
                                        <div className="relative inline-block w-10 align-middle select-none transition duration-200 ease-in">
                                            <input type="checkbox" name="toggle2" id="toggle2" className="toggle-checkbox absolute block w-5 h-5 rounded-full bg-white border-4 appearance-none cursor-pointer checked:right-0 checked:border-blue-500 right-5 border-slate-300 transition-all duration-300" />
                                            <label htmlFor="toggle2" className="toggle-label block overflow-hidden h-5 rounded-full bg-slate-300 cursor-pointer"></label>
                                        </div>
                                    </div>
                                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-6 line-clamp-2">
                                        Provides OpenWeatherMap data as virtual sensor nodes for automation triggers.
                                    </p>
                                    <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800">
                                        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                            Stopped
                                        </span>
                                        <div className="flex space-x-2">
                                            <button className="text-slate-400 hover:text-primary transition-colors">
                                                <span className="material-icons-round text-lg">settings</span>
                                            </button>
                                            <button className="text-slate-400 hover:text-red-500 transition-colors">
                                                <span className="material-icons-round text-lg">delete</span>
                                            </button>
                                        </div>
                                    </div>
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
                                    {/* Discover Row 1 */}
                                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 flex items-center justify-between hover:border-blue-300 dark:hover:border-blue-700 transition-colors group">
                                        <div className="flex items-center space-x-5">
                                            <div className="w-16 h-16 bg-[#ff9900]/10 rounded-xl flex items-center justify-center text-[#ff9900]">
                                                <span className="material-icons-round text-3xl">cloud</span>
                                            </div>
                                            <div>
                                                <h4 className="text-base font-bold text-slate-900 dark:text-white mb-1">AWS IoT Core Sync</h4>
                                                <div className="flex items-center text-xs text-slate-500 mb-1 space-x-3">
                                                    <span className="flex items-center"><span className="material-icons-round text-[14px] text-yellow-400 mr-1">star</span> 4.9</span>
                                                    <span>By AmazonWebServices</span>
                                                    <span className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">Verified</span>
                                                </div>
                                                <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-1 max-w-xl">
                                                    Bi-directional state synchronization with your AWS IoT Core shadow documents.
                                                </p>
                                            </div>
                                        </div>
                                        <button className="w-24 bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 font-medium py-2 rounded-lg transition-colors border border-slate-200 dark:border-slate-700 group-hover:border-blue-200 dark:group-hover:border-slate-600">
                                            Install
                                        </button>
                                    </div>

                                    {/* Discover Row 2 */}
                                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 flex items-center justify-between hover:border-blue-300 dark:hover:border-blue-700 transition-colors group">
                                        <div className="flex items-center space-x-5">
                                            <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center text-purple-600">
                                                <span className="material-icons-round text-3xl">hub</span>
                                            </div>
                                            <div>
                                                <h4 className="text-base font-bold text-slate-900 dark:text-white mb-1">Matter Bridge Provider</h4>
                                                <div className="flex items-center text-xs text-slate-500 mb-1 space-x-3">
                                                    <span className="flex items-center"><span className="material-icons-round text-[14px] text-yellow-400 mr-1">star</span> 4.6</span>
                                                    <span>By jsmith_dev</span>
                                                </div>
                                                <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-1 max-w-xl">
                                                    Expose your connected legacy devices as a seamless Matter bridge to Apple Home and Google Home.
                                                </p>
                                            </div>
                                        </div>
                                        <button className="w-24 bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 font-medium py-2 rounded-lg transition-colors border border-slate-200 dark:border-slate-700 group-hover:border-blue-200 dark:group-hover:border-slate-600">
                                            Install
                                        </button>
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
