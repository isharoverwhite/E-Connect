"use client";

import { use, useCallback, useEffect, useState, FormEvent } from "react";
import Link from "next/link";

import Sidebar from "@/components/Sidebar";
import { useToast } from "@/components/ToastContext";
import {
    createExternalDevice,
    fetchExtension,
    InstalledExtension,
    InstalledExtensionSchema,
} from "@/lib/api";
import { fetchRooms, RoomRecord } from "@/lib/rooms";

type SchemaDialogState = {
    schema: InstalledExtensionSchema;
} | null;

type ConfigDraft = Record<string, string | number | boolean>;

const CAPABILITY_LABELS: Record<string, string> = {
    power: "Power",
    brightness: "Brightness",
    rgb: "RGB",
    color_temperature: "Tone",
};

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

export default function ExtensionDetailView({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { showToast } = useToast();

    const [extension, setExtension] = useState<InstalledExtension | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [rooms, setRooms] = useState<RoomRecord[]>([]);
    const [roomsLoading, setRoomsLoading] = useState(true);
    const [roomsError, setRoomsError] = useState<string | null>(null);

    const [schemaDialog, setSchemaDialog] = useState<SchemaDialogState>(null);
    const [deviceName, setDeviceName] = useState("");
    const [configDraft, setConfigDraft] = useState<ConfigDraft>({});
    const [selectedRoomId, setSelectedRoomId] = useState<string>("");
    const [createError, setCreateError] = useState<string | null>(null);
    const [isCreatingDevice, setIsCreatingDevice] = useState(false);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchExtension(id);
            setExtension(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load extension");
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    useEffect(() => {
        let cancelled = false;

        const loadRooms = async () => {
            setRoomsLoading(true);
            setRoomsError(null);
            try {
                const data = await fetchRooms();
                if (cancelled) return;
                setRooms(data);
            } catch (nextError) {
                if (cancelled) return;
                setRoomsError(nextError instanceof Error ? nextError.message : "Failed to load rooms");
            } finally {
                if (!cancelled) setRoomsLoading(false);
            }
        };

        void loadRooms();
        return () => {
            cancelled = true;
        };
    }, []);

    const openCreateDeviceDialog = (schema: InstalledExtensionSchema) => {
        setSchemaDialog({ schema });
        setDeviceName(schema.default_name);
        setConfigDraft(buildInitialConfig(schema));
        setSelectedRoomId("");
        setCreateError(null);
    };

    const closeCreateDeviceDialog = () => {
        setSchemaDialog(null);
        setDeviceName("");
        setConfigDraft({});
        setSelectedRoomId("");
        setCreateError(null);
        setIsCreatingDevice(false);
    };

    const updateConfigValue = (key: string, value: string | number | boolean) => {
        setConfigDraft((previous) => ({ ...previous, [key]: value }));
    };

    const handleCreateDevice = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!schemaDialog || !extension) return;

        setIsCreatingDevice(true);
        setCreateError(null);
        try {
            const normalizedConfig = Object.fromEntries(
                Object.entries(configDraft).filter(([, value]) => {
                    if (value === "") return false;
                    if (typeof value === "number" && Number.isNaN(value)) return false;
                    return true;
                }),
            );
            await createExternalDevice({
                installed_extension_id: extension.extension_id,
                device_schema_id: schemaDialog.schema.schema_id,
                name: deviceName.trim() || schemaDialog.schema.default_name,
                room_id: selectedRoomId ? Number(selectedRoomId) : null,
                config: normalizedConfig,
            });
            showToast("External device created. It will now appear in Dashboard.", "success");
            closeCreateDeviceDialog();
            
            void loadData();
        } catch (nextError) {
            setCreateError(nextError instanceof Error ? nextError.message : "Failed to create external device");
            setIsCreatingDevice(false);
        }
    };

    return (
        <div className="flex min-h-screen bg-background-light font-sans text-slate-800 dark:bg-background-dark dark:text-slate-200">
            <Sidebar />

            <main className="flex min-w-0 flex-1 flex-col">
                <header className="sticky top-0 z-10 flex h-16 flex-shrink-0 items-center border-b border-slate-200 bg-surface-light px-6 shadow-sm dark:border-slate-700 dark:bg-surface-dark gap-4">
                    <Link
                        href="/extensions"
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100/80 text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900 dark:bg-surface-container-low dark:text-slate-400 dark:hover:bg-surface-container dark:hover:text-white"
                        title="Back to Extensions"
                    >
                        <span className="material-icons-round text-[20px]">arrow_back</span>
                    </Link>
                    <div className="flex flex-col justify-center min-w-0">
                        <h1 className="truncate text-xl font-bold tracking-tight text-slate-900 dark:text-white leading-tight">
                            {extension ? extension.name : "Extension Details"}
                        </h1>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto p-6 md:p-8 bg-slate-50 dark:bg-[#0a0a0c]">
                    <div className="mx-auto max-w-6xl">
                        {loading ? (
                            <div className="flex justify-center py-20">
                                <span className="material-icons-round animate-spin text-4xl text-slate-300 dark:text-slate-700">
                                    progress_activity
                                </span>
                            </div>
                        ) : error ? (
                            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                                {error}
                            </div>
                        ) : extension ? (
                            <div className="space-y-6">
                                <div className="overflow-hidden rounded-[24px] bg-slate-100 dark:bg-surface-container-low">
                                    <div className="p-8 pb-6">
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <div className="mb-4 inline-flex items-center gap-2">
                                                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-slate-600 dark:bg-surface-container-highest dark:text-slate-300">
                                                        <span className="material-icons-round text-[16px]">extension</span>
                                                    </span>
                                                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                                                        {extension.provider_name}
                                                    </span>
                                                </div>
                                                <h2 className="text-[32px] font-bold leading-tight tracking-tight text-slate-900 dark:text-white">
                                                    {extension.name}
                                                </h2>
                                                <div className="mt-3 flex items-center gap-3">
                                                    <span className="rounded-full bg-slate-200/50 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-surface-container-highest dark:text-slate-300">
                                                        v{extension.version}
                                                    </span>
                                                    <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                                                        <span className={`h-1.5 w-1.5 rounded-full ${extension.external_device_count > 0 ? "bg-primary" : "bg-slate-400 dark:bg-slate-600"}`}></span>
                                                        {extension.external_device_count} currently active device{extension.external_device_count !== 1 ? "s" : ""}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="px-8 pb-8 pt-2">
                                        <p className="text-sm text-slate-600 dark:text-slate-300">
                                            {extension.description}
                                        </p>
                                    </div>

                                    <div className="flex border-t border-slate-200 dark:border-white/5 flex-col md:flex-row">
                                        <div className="flex-1 p-6 text-center border-b md:border-b-0 md:border-r border-slate-200 dark:border-white/5">
                                            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">UUID</p>
                                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-white truncate" title={extension.extension_id}>{extension.extension_id}</p>
                                        </div>
                                        <div className="flex-1 p-6 text-center border-b md:border-b-0 md:border-r border-slate-200 dark:border-white/5">
                                            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">Runtime</p>
                                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-white">{extension.package_runtime}</p>
                                        </div>
                                        <div className="flex-1 p-6 text-center">
                                            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">Entrypoint</p>
                                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-white truncate" title={extension.package_entrypoint}>{extension.package_entrypoint}</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-10">
                                    <div className="mb-4 flex items-center justify-between">
                                        <h3 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                                            Available Device Schemas
                                        </h3>
                                        <span className="rounded-full bg-slate-200/50 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-surface-container-highest dark:text-slate-300">
                                            {extension.device_schemas.length} Schema{extension.device_schemas.length === 1 ? "" : "s"}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                                        {extension.device_schemas.map((schema) => (
                                            <div
                                                key={schema.schema_id}
                                                className="group relative flex flex-col justify-between overflow-hidden rounded-[20px] bg-white transition-colors hover:bg-slate-50 dark:bg-surface-container-low dark:hover:bg-surface-container"
                                            >
                                                <div className="p-6">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <h4 className="text-base font-bold text-slate-900 dark:text-white">{schema.name}</h4>
                                                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:bg-white/10 dark:text-slate-300">
                                                            {schema.card_type}
                                                        </span>
                                                    </div>
                                                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 min-h-12">
                                                        {schema.description || "No description provided for this schema."}
                                                    </p>

                                                    <div className="mt-4 flex flex-wrap gap-2">
                                                        {(schema.capabilities ?? []).map((capability) => (
                                                            <span
                                                                key={`${schema.schema_id}-${capability}`}
                                                                className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
                                                            >
                                                                {CAPABILITY_LABELS[capability] ?? capability}
                                                            </span>
                                                        ))}
                                                        {schema.config_fields.length > 0 ? (
                                                            schema.config_fields.map((field) => (
                                                                <span
                                                                    key={field.key}
                                                                    className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 dark:border-white/5 dark:bg-black/20 dark:text-slate-300"
                                                                >
                                                                    {field.label}
                                                                </span>
                                                            ))
                                                        ) : (
                                                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 dark:border-white/5 dark:bg-black/20 dark:text-slate-400">
                                                                Zero-config
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="border-t border-slate-100 bg-slate-50/50 p-4 dark:border-white/5 dark:bg-black/10">
                                                    <button
                                                        onClick={() => openCreateDeviceDialog(schema)}
                                                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-600"
                                                    >
                                                        <span className="material-icons-round text-[18px]">add</span>
                                                        Create Device
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>

                {schemaDialog && extension ? (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-sm">
                        <div className="w-full max-w-xl rounded-[24px] border border-slate-200 bg-white shadow-xl dark:border-slate-700/50 dark:bg-surface-container-low">
                            <div className="flex items-center justify-between border-b border-slate-100 p-6 dark:border-white/5">
                                <div>
                                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">Create external device</h2>
                                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                        {extension.name} / <span className="font-medium text-slate-700 dark:text-slate-200">{schemaDialog.schema.name}</span>
                                    </p>
                                </div>
                                <button
                                    onClick={closeCreateDeviceDialog}
                                    className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-surface-container-high dark:hover:text-slate-300"
                                >
                                    <span className="material-icons-round text-[20px]">close</span>
                                </button>
                            </div>

                            <form className="space-y-5 p-6" onSubmit={handleCreateDevice}>
                                <div>
                                    <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Device name</label>
                                    <input
                                        value={deviceName}
                                        onChange={(event) => setDeviceName(event.target.value)}
                                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700/50 dark:bg-surface-container-highest dark:text-slate-100"
                                        placeholder={schemaDialog.schema.default_name}
                                    />
                                </div>

                                <div>
                                    <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Room assignment</label>
                                    <select
                                        value={selectedRoomId}
                                        onChange={(event) => setSelectedRoomId(event.target.value)}
                                        disabled={roomsLoading}
                                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700/50 dark:bg-surface-container-highest dark:text-slate-100"
                                    >
                                        <option value="">{roomsLoading ? "Loading rooms..." : "Unassigned"}</option>
                                        {rooms.map((room) => (
                                            <option key={room.room_id} value={room.room_id}>
                                                {room.name}
                                            </option>
                                        ))}
                                    </select>
                                    {roomsError ? (
                                        <p className="mt-2 text-sm text-rose-600 dark:text-rose-300">{roomsError}</p>
                                    ) : rooms.length === 0 && !roomsLoading ? (
                                        <p className="mt-2 text-sm text-amber-700 dark:text-amber-200">
                                            No rooms exist yet. The device can be created unassigned and moved later from the room management flow.
                                        </p>
                                    ) : null}
                                </div>

                                {schemaDialog.schema.config_fields.map((field) => (
                                    <div key={field.key}>
                                        <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                                            {field.label}
                                            {field.required ? <span className="ml-1 text-rose-500">*</span> : null}
                                        </label>

                                        {field.type === "boolean" ? (
                                            <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm dark:border-slate-700/50">
                                                <input
                                                    type="checkbox"
                                                    checked={Boolean(configDraft[field.key])}
                                                    onChange={(event) => updateConfigValue(field.key, event.target.checked)}
                                                    className="rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600 dark:bg-slate-700"
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
                                                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700/50 dark:bg-surface-container-highest dark:text-slate-100"
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

                                <div className="flex justify-end gap-3 pt-2">
                                    <button
                                        type="button"
                                        onClick={closeCreateDeviceDialog}
                                        className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-surface-container-high"
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
                                                Create Device
                                            </>
                                        )}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                ) : null}

            </main>
        </div>
    );
}
