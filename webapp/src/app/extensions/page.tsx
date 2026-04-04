"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import Sidebar from "@/components/Sidebar";
import { useToast } from "@/components/ToastContext";
import {
    deleteInstalledExtension,
    fetchInstalledExtensions,
    InstalledExtension,
    uploadExtensionZip,
} from "@/lib/api";



export default function ExtensionsLibrary() {
    const { showToast } = useToast();
    const [activeTab, setActiveTab] = useState<"installed" | "discover">("installed");
    const [extensions, setExtensions] = useState<InstalledExtension[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [deletingExtensionId, setDeletingExtensionId] = useState<string | null>(null);

    const loadExtensions = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchInstalledExtensions();
            setExtensions(data);
        } catch (nextError) {
            const message = nextError instanceof Error ? nextError.message : "Failed to load installed extensions";
            setError(message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadExtensions();
    }, [loadExtensions]);

    const installedCountLabel = useMemo(() => {
        if (extensions.length === 1) {
            return "1 installed package";
        }
        return `${extensions.length} installed packages`;
    }, [extensions.length]);

    const resetUploadState = () => {
        setSelectedFile(null);
        setIsUploadModalOpen(false);
        setIsUploading(false);
    };

    const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
        setSelectedFile(event.target.files?.[0] ?? null);
    };

    const handleUpload = async () => {
        if (!selectedFile) {
            showToast("Choose a ZIP file before uploading.", "warning");
            return;
        }

        setIsUploading(true);
        try {
            const uploaded = await uploadExtensionZip(selectedFile);
            setExtensions((previous) => {
                const next = previous.filter((item) => item.extension_id !== uploaded.extension_id);
                return [uploaded, ...next].sort((left, right) => left.name.localeCompare(right.name));
            });
            resetUploadState();
            showToast(`Installed ${uploaded.name} ${uploaded.version}.`, "success");
        } catch (nextError) {
            const message = nextError instanceof Error ? nextError.message : "Failed to upload extension ZIP";
            showToast(message, "error");
            setIsUploading(false);
        }
    };

    const handleDeleteExtension = async (extension: InstalledExtension) => {
        if (extension.external_device_count > 0) {
            showToast("Delete linked external devices before removing this package.", "warning");
            return;
        }


        showToast(`Deleting "${extension.name}" v${extension.version}...`, "info", 2000);
        setDeletingExtensionId(extension.extension_id);
        try {
            await deleteInstalledExtension(extension.extension_id);
            setExtensions((previous) => previous.filter((item) => item.extension_id !== extension.extension_id));
            showToast(`Deleted ${extension.name} ${extension.version}.`, "success");
        } catch (nextError) {
            const message = nextError instanceof Error ? nextError.message : "Failed to delete installed extension";
            showToast(message, "error");
        } finally {
            setDeletingExtensionId(null);
        }
    };


    return (
        <div className="flex min-h-screen bg-background-light font-sans text-slate-800 dark:bg-background-dark dark:text-slate-200">
            <Sidebar />

            <main className="flex min-w-0 flex-1 flex-col">
                <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-slate-200 bg-surface-light px-6 shadow-sm dark:border-slate-700 dark:bg-surface-dark">
                    <div>
                        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Extensions</h1>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{installedCountLabel}</p>
                    </div>

                    <button
                        onClick={() => setIsUploadModalOpen(true)}
                        className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-600"
                    >
                        <span className="material-icons-round mr-2 text-[18px]">upload_file</span>
                        Install via ZIP
                    </button>
                </header>

                {isUploadModalOpen ? (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-sm">
                        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
                            <div className="flex items-center justify-between border-b border-slate-100 p-6 dark:border-slate-800">
                                <div>
                                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">Install extension ZIP</h2>
                                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                        Upload a metadata package with a valid manifest v1.
                                    </p>
                                </div>
                                <button
                                    onClick={resetUploadState}
                                    className="rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                                >
                                    <span className="material-icons-round">close</span>
                                </button>
                            </div>

                            <div className="space-y-4 p-6">
                                <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 px-6 py-10 text-center transition-colors hover:border-blue-400 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60">
                                    <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-500 dark:bg-blue-900/30">
                                        <span className="material-icons-round text-3xl">cloud_upload</span>
                                    </span>
                                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                        {selectedFile ? selectedFile.name : "Choose a ZIP file"}
                                    </span>
                                    <span className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                        ZIP must contain a valid `manifest.json` and declared Python entrypoint.
                                    </span>
                                    <input className="hidden" type="file" accept=".zip,application/zip" onChange={handleFileChange} />
                                </label>

                                <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-100">
                                    Installed extensions now run from the uploaded ZIP package and extracted server runtime files only.
                                </div>

                                <div className="flex justify-end gap-3">
                                    <button
                                        onClick={resetUploadState}
                                        className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => void handleUpload()}
                                        disabled={isUploading || !selectedFile}
                                        className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {isUploading ? (
                                            <>
                                                <span className="material-icons-round mr-2 animate-spin text-[18px]">progress_activity</span>
                                                Uploading...
                                            </>
                                        ) : (
                                            <>
                                                <span className="material-icons-round mr-2 text-[18px]">inventory_2</span>
                                                Install package
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null}



                <div className="flex-1 overflow-y-auto p-6 md:p-8">
                    <div className="mx-auto max-w-6xl">
                        <div className="mb-8 flex border-b border-slate-200 dark:border-slate-700">
                            {[
                                { key: "installed" as const, label: "Installed packages" },
                                { key: "discover" as const, label: "Marketplace" },
                            ].map((tab) => (
                                <button
                                    key={tab.key}
                                    onClick={() => setActiveTab(tab.key)}
                                    className={`relative mr-8 pb-4 text-sm font-medium transition-colors ${
                                        activeTab === tab.key
                                            ? "text-primary"
                                            : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                                    }`}
                                >
                                    {tab.label}
                                    {activeTab === tab.key ? (
                                        <span className="absolute bottom-0 left-0 h-0.5 w-full rounded-full bg-primary" />
                                    ) : null}
                                </button>
                            ))}
                        </div>

                        {activeTab === "installed" ? (
                            <>
                                {loading ? (
                                    <div className="flex min-h-[280px] items-center justify-center rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                                        <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                                            <span className="material-icons-round animate-spin text-lg">progress_activity</span>
                                            Loading installed extensions...
                                        </div>
                                    </div>
                                ) : error ? (
                                    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <h3 className="font-semibold">Failed to load extensions</h3>
                                                <p className="mt-1">{error}</p>
                                            </div>
                                            <button
                                                onClick={() => void loadExtensions()}
                                                className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-100 dark:border-rose-500/30 dark:bg-transparent dark:text-rose-200"
                                            >
                                                Retry
                                            </button>
                                        </div>
                                    </div>
                                ) : extensions.length === 0 ? (
                                    <div className="rounded-2xl border-2 border-dashed border-slate-200 py-16 text-center dark:border-slate-800">
                                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-50 text-slate-400 dark:bg-slate-800/60">
                                            <span className="material-icons-round text-3xl">extension_off</span>
                                        </div>
                                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">No extensions installed</h3>
                                        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
                                            Upload the first extension ZIP to register a provider package and create external devices from its schemas.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                                        {extensions.map((extension) => (
                                            <article
                                                key={extension.extension_id}
                                                className="group relative flex flex-col justify-between overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-sm transition-all hover:border-slate-300 hover:shadow-md dark:border-slate-800 dark:bg-surface-dark dark:hover:border-slate-700 dark:hover:bg-slate-800/50"
                                            >
                                                <div className="p-8 pb-6">
                                                    <div className="flex items-start justify-between gap-4">
                                                        <div>
                                                            <div className="mb-4 inline-flex items-center gap-2">
                                                                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                                                    <span className="material-icons-round text-[16px]">extension</span>
                                                                </span>
                                                                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                                                                    {extension.provider_name}
                                                                </span>
                                                            </div>
                                                            <h2 className="text-[28px] font-bold tracking-tight text-slate-900 dark:text-white leading-tight">
                                                                {extension.name}
                                                            </h2>
                                                            <div className="mt-3 flex items-center gap-3">
                                                                <span className="rounded-full bg-slate-200/50 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                                                    v{extension.version}
                                                                </span>
                                                                <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                                                                    <span className={`h-1.5 w-1.5 rounded-full ${extension.external_device_count > 0 ? "bg-primary" : "bg-slate-400 dark:bg-slate-600"}`}></span>
                                                                    {extension.external_device_count} device{extension.external_device_count !== 1 ? "s" : ""}
                                                                </span>
                                                            </div>
                                                            {extension.description && (
                                                                <p className="mt-4 text-sm text-slate-500 dark:text-slate-400 line-clamp-2">
                                                                    {extension.description}
                                                                </p>
                                                            )}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => void handleDeleteExtension(extension)}
                                                            disabled={deletingExtensionId === extension.extension_id || extension.external_device_count > 0}
                                                            title={
                                                                extension.external_device_count > 0
                                                                    ? "Delete linked external devices before removing this package."
                                                                    : `Delete ${extension.name}`
                                                            }
                                                            className="inline-flex shrink-0 items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition-colors hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200 dark:hover:bg-rose-500/20 dark:disabled:border-slate-700 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
                                                        >
                                                            <span className={`material-icons-round text-[16px] ${deletingExtensionId === extension.extension_id ? "animate-spin" : ""}`}>
                                                                {deletingExtensionId === extension.extension_id ? "progress_activity" : "delete"}
                                                            </span>
                                                            {deletingExtensionId === extension.extension_id ? "Deleting" : "Delete"}
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="px-8 pb-8 pt-4">
                                                    {extension.external_device_count > 0 ? (
                                                        <p className="mb-3 text-xs text-amber-700 dark:text-amber-300">
                                                            Remove linked external devices before deleting this package.
                                                        </p>
                                                    ) : null}
                                                    <Link
                                                        href={`/extensions/${extension.extension_id}`}
                                                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500"
                                                    >
                                                        View Details
                                                        <span className="material-icons-round text-[18px]">arrow_forward</span>
                                                    </Link>
                                                </div>
                                            </article>
                                        ))}
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                                <div className="max-w-2xl">
                                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-600 dark:text-blue-400">
                                        Coming soon
                                    </p>
                                    <h2 className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">Extension Marketplace</h2>
                                    <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
                                        We&apos;re building a public marketplace for you to easily discover and install community-created extensions. Stay tuned!
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}
