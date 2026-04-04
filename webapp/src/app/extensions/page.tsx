"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import Sidebar from "@/components/Sidebar";
import { useToast } from "@/components/ToastContext";
import {
    createExternalDevice,
    fetchInstalledExtensions,
    InstalledExtension,
    InstalledExtensionSchema,
    uploadExtensionZip,
} from "@/lib/api";

type SchemaDialogState = {
    extension: InstalledExtension;
    schema: InstalledExtensionSchema;
} | null;

type ConfigDraft = Record<string, string | number | boolean>;

function buildInitialConfig(schema: InstalledExtensionSchema): ConfigDraft {
    const draft: ConfigDraft = {};
    for (const field of schema.config_fields) {
        if (field.type === "boolean") {
            draft[field.key] = false;
        } else {
            draft[field.key] = "";
        }
    }
    return draft;
}

export default function ExtensionsLibrary() {
    const { showToast } = useToast();
    const [activeTab, setActiveTab] = useState<"installed" | "discover">("installed");
    const [extensions, setExtensions] = useState<InstalledExtension[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [schemaDialog, setSchemaDialog] = useState<SchemaDialogState>(null);
    const [deviceName, setDeviceName] = useState("");
    const [configDraft, setConfigDraft] = useState<ConfigDraft>({});
    const [createError, setCreateError] = useState<string | null>(null);
    const [isCreatingDevice, setIsCreatingDevice] = useState(false);

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

    const openCreateDeviceDialog = (extension: InstalledExtension, schema: InstalledExtensionSchema) => {
        setSchemaDialog({ extension, schema });
        setDeviceName(schema.default_name);
        setConfigDraft(buildInitialConfig(schema));
        setCreateError(null);
    };

    const closeCreateDeviceDialog = () => {
        setSchemaDialog(null);
        setDeviceName("");
        setConfigDraft({});
        setCreateError(null);
        setIsCreatingDevice(false);
    };

    const updateConfigValue = (key: string, value: string | number | boolean) => {
        setConfigDraft((previous) => ({ ...previous, [key]: value }));
    };

    const handleCreateDevice = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!schemaDialog) {
            return;
        }

        setIsCreatingDevice(true);
        setCreateError(null);
        try {
            const normalizedConfig = Object.fromEntries(
                Object.entries(configDraft).filter(([, value]) => {
                    if (value === "") {
                        return false;
                    }
                    if (typeof value === "number" && Number.isNaN(value)) {
                        return false;
                    }
                    return true;
                }),
            );
            await createExternalDevice({
                installed_extension_id: schemaDialog.extension.extension_id,
                device_schema_id: schemaDialog.schema.schema_id,
                name: deviceName.trim() || schemaDialog.schema.default_name,
                config: normalizedConfig,
            });
            setExtensions((previous) =>
                previous.map((item) =>
                    item.extension_id === schemaDialog.extension.extension_id
                        ? { ...item, external_device_count: item.external_device_count + 1 }
                        : item,
                ),
            );
            closeCreateDeviceDialog();
            showToast("External device created. It will now appear in Devices and Dashboard.", "success");
        } catch (nextError) {
            const message = nextError instanceof Error ? nextError.message : "Failed to create external device";
            setCreateError(message);
            setIsCreatingDevice(false);
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
                                    This slice stores validated package metadata and external-device schemas only. Runtime sandbox execution is still out of scope.
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

                {schemaDialog ? (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-sm">
                        <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
                            <div className="flex items-center justify-between border-b border-slate-100 p-6 dark:border-slate-800">
                                <div>
                                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">Create external device</h2>
                                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                        {schemaDialog.extension.name} / {schemaDialog.schema.name}
                                    </p>
                                </div>
                                <button
                                    onClick={closeCreateDeviceDialog}
                                    className="rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                                >
                                    <span className="material-icons-round">close</span>
                                </button>
                            </div>

                            <form className="space-y-5 p-6" onSubmit={handleCreateDevice}>
                                <div>
                                    <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Device name</label>
                                    <input
                                        value={deviceName}
                                        onChange={(event) => setDeviceName(event.target.value)}
                                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                        placeholder={schemaDialog.schema.default_name}
                                    />
                                </div>

                                {schemaDialog.schema.config_fields.map((field) => (
                                    <div key={field.key}>
                                        <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                                            {field.label}
                                            {field.required ? <span className="ml-1 text-rose-500">*</span> : null}
                                        </label>

                                        {field.type === "boolean" ? (
                                            <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm dark:border-slate-700">
                                                <input
                                                    type="checkbox"
                                                    checked={Boolean(configDraft[field.key])}
                                                    onChange={(event) => updateConfigValue(field.key, event.target.checked)}
                                                />
                                                <span className="text-slate-700 dark:text-slate-200">Enabled</span>
                                            </label>
                                        ) : (
                                            <input
                                                value={String(configDraft[field.key] ?? "")}
                                                type={field.type === "number" ? "number" : "text"}
                                                onChange={(event) =>
                                                    updateConfigValue(
                                                        field.key,
                                                        field.type === "number"
                                                            ? event.target.value === ""
                                                                ? ""
                                                                : Number(event.target.value)
                                                            : event.target.value,
                                                    )
                                                }
                                                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                                placeholder={field.type === "number" ? "0" : field.label}
                                            />
                                        )}
                                    </div>
                                ))}

                                {createError ? (
                                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                                        {createError}
                                    </div>
                                ) : null}

                                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
                                    The device will be created immediately but starts offline until a trusted extension runtime is added.
                                </div>

                                <div className="flex justify-end gap-3">
                                    <button
                                        type="button"
                                        onClick={closeCreateDeviceDialog}
                                        className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isCreatingDevice}
                                        className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {isCreatingDevice ? (
                                            <>
                                                <span className="material-icons-round mr-2 animate-spin text-[18px]">progress_activity</span>
                                                Creating...
                                            </>
                                        ) : (
                                            <>
                                                <span className="material-icons-round mr-2 text-[18px]">add_circle</span>
                                                Create device
                                            </>
                                        )}
                                    </button>
                                </div>
                            </form>
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
                                            <section
                                                key={extension.extension_id}
                                                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
                                            >
                                                <div className="border-b border-slate-100 bg-gradient-to-r from-slate-900 to-slate-800 p-6 text-white dark:border-slate-800">
                                                    <div className="flex items-start justify-between gap-4">
                                                        <div>
                                                            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-200">
                                                                {extension.provider_name}
                                                            </p>
                                                            <h2 className="mt-2 text-2xl font-bold">{extension.name}</h2>
                                                            <p className="mt-2 max-w-2xl text-sm text-slate-200">{extension.description}</p>
                                                        </div>
                                                        <div className="rounded-xl bg-white/10 px-3 py-2 text-right text-xs backdrop-blur">
                                                            <div className="font-semibold">{extension.version}</div>
                                                            <div className="mt-1 text-slate-300">
                                                                {extension.external_device_count} device{extension.external_device_count === 1 ? "" : "s"}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="space-y-5 p-6">
                                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                                        <InfoPill label="Extension ID" value={extension.extension_id} />
                                                        <InfoPill label="Runtime" value={extension.package_runtime} />
                                                        <InfoPill label="Entrypoint" value={extension.package_entrypoint} />
                                                    </div>

                                                    <div>
                                                        <div className="mb-3 flex items-center justify-between">
                                                            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                                                Device Schemas
                                                            </h3>
                                                            <span className="text-xs text-slate-500 dark:text-slate-400">
                                                                {extension.device_schemas.length} available
                                                            </span>
                                                        </div>

                                                        <div className="space-y-3">
                                                            {extension.device_schemas.map((schema) => (
                                                                <div
                                                                    key={schema.schema_id}
                                                                    className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                                                                >
                                                                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                                                        <div className="min-w-0 flex-1">
                                                                            <div className="flex flex-wrap items-center gap-2">
                                                                                <h4 className="font-semibold text-slate-900 dark:text-white">{schema.name}</h4>
                                                                                <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300">
                                                                                    {schema.card_type}
                                                                                </span>
                                                                            </div>
                                                                            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                                                                {schema.description || "No schema description provided."}
                                                                            </p>
                                                                            <div className="mt-3 flex flex-wrap gap-2">
                                                                                {schema.config_fields.length > 0 ? (
                                                                                    schema.config_fields.map((field) => (
                                                                                        <span
                                                                                            key={field.key}
                                                                                            className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300"
                                                                                        >
                                                                                            {field.label} · {field.type}
                                                                                            {field.required ? " · required" : ""}
                                                                                        </span>
                                                                                    ))
                                                                                ) : (
                                                                                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                                                                                        No extra config fields
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                        </div>

                                                                        <button
                                                                            onClick={() => openCreateDeviceDialog(extension, schema)}
                                                                            className="inline-flex shrink-0 items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
                                                                        >
                                                                            <span className="material-icons-round mr-2 text-[18px]">add_circle</span>
                                                                            Create device
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            </section>
                                        ))}
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                                <div className="max-w-2xl">
                                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-600 dark:text-amber-400">
                                        Marketplace unavailable
                                    </p>
                                    <h2 className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">Discover remains out of scope for this slice</h2>
                                    <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
                                        This implementation adds admin-controlled ZIP upload, manifest validation, installed package storage, and external device creation. Public marketplace browsing is intentionally still disabled.
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

function InfoPill({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/50">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</p>
            <p className="mt-2 truncate text-sm font-medium text-slate-800 dark:text-slate-100">{value}</p>
        </div>
    );
}
