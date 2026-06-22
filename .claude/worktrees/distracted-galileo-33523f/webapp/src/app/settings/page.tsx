/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import { FormEvent, useEffect, useEffectEvent, useState } from "react";


import { useAuth } from "@/components/AuthProvider";
import {
    ManagedUser,
    adminCreateUser,
    fetchManagedUsers,
    getToken,
    deleteManagedUser,
    promoteManagedUser,
} from "@/lib/auth";
import {
    GeneralSettingsResponse,
    fetchDashboardDevices,
    fetchGeneralSettings,
    updateGeneralSettings,
} from "@/lib/api";
import { hasDhtSensor } from "@/lib/device-config";
import { DeviceConfig } from "@/types/device";
import { formatServerTimestamp } from "@/lib/server-time";
import {
    RoomRecord,
    createRoom,
    fetchRooms,
    updateRoom,
    deleteRoom,
    updateRoomAccess,
} from "@/lib/rooms";
import Sidebar from "@/components/Sidebar";
import { ApiKeysPanel } from "./ApiKeysPanel";
import { ConfigsPanel } from "./ConfigsPanel";
import { WifiCredentialsPanel } from "./WifiCredentialsPanel";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useToast } from "@/components/ToastContext";
import { useLanguage } from "@/components/LanguageContext";
import ConfirmModal from "@/components/ConfirmModal";

function formatAccountTypeLabel(accountType?: string | null) {
    return accountType === "admin" ? "admin" : "user";
}

function formatTimezoneSourceLabel(settings: GeneralSettingsResponse | null, t: (key: string) => string): string {
    if (!settings) {
        return t("settings.timezone.source.unknown");
    }

    if (settings.timezone_source === "setting") {
        return t("settings.timezone.source.saved");
    }
    return t("settings.timezone.source.runtime");
}

function formatServerTimePreview(value?: string | null, timezone?: string | null): string {
    return formatServerTimestamp(value, {
        fallback: "Unknown",
        options: {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            timeZoneName: "short",
        },
        timezone,
    });
}

type SettingsPanel = "general" | "apiKeys" | "users" | "rooms" | "wifi" | "configs";
type AccountType = ManagedUser["account_type"];
type TemperatureSourceOption = {
    device_id: string;
    name: string;
    room_name?: string | null;
    board?: string | null;
};

export default function SettingsPage() {
    const { user } = useAuth();
    const { showToast } = useToast();
    const { t, language, setLanguage } = useLanguage();
    const isAdmin = user?.account_type === "admin";

    const [activePanel, setActivePanel] = useState<SettingsPanel>("general");
    const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
    const [usersLoading, setUsersLoading] = useState(true);
    const [usersError, setUsersError] = useState("");
    const [rooms, setRooms] = useState<RoomRecord[]>([]);
    const [roomsLoading, setRoomsLoading] = useState(true);
    const [roomsError, setRoomsError] = useState("");
    const [generalSettings, setGeneralSettings] = useState<GeneralSettingsResponse | null>(null);
    const [generalSettingsLoading, setGeneralSettingsLoading] = useState(true);
    const [generalSettingsError, setGeneralSettingsError] = useState("");
    const [timezoneDraft, setTimezoneDraft] = useState("");
    const [timezoneSaving, setTimezoneSaving] = useState(false);
    const [houseTemperatureDeviceDraft, setHouseTemperatureDeviceDraft] = useState("");
    const [temperatureSourceOptions, setTemperatureSourceOptions] = useState<TemperatureSourceOption[]>([]);
    const [temperatureSourceLoading, setTemperatureSourceLoading] = useState(true);
    const [temperatureSourceError, setTemperatureSourceError] = useState("");
    const [temperatureSourceSaving, setTemperatureSourceSaving] = useState(false);
    const [roomFormName, setRoomFormName] = useState("");
    const [createRoomNameError, setCreateRoomNameError] = useState("");
    const [userFormErrors, setUserFormErrors] = useState<Record<string, string>>({});
    const [editingRoomId, setEditingRoomId] = useState<number | null>(null);
    const [editingRoomName, setEditingRoomName] = useState("");
    const [roomSubmitting, setRoomSubmitting] = useState(false);
    const [hoverToExpandSidebar, setHoverToExpandSidebar] = useState(() => {
        if (typeof window !== "undefined") {
            const stored = localStorage.getItem("hoverToExpandSidebar");
            if (stored !== null) return stored === "true";
        }
        return true; // Default enabled
    });
    const [roomActionId, setRoomActionId] = useState<number | null>(null);
    const [deleteRoomTarget, setDeleteRoomTarget] = useState<RoomRecord | null>(null);
    const [isCreatingArea, setIsCreatingArea] = useState(false);
    const [notice, setNotice] = useState("");
    const [submitError, setSubmitError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [actionUserId, setActionUserId] = useState<number | null>(null);
    const [revokeModalTarget, setRevokeModalTarget] = useState<ManagedUser | null>(null);
    const [promoteModalTarget, setPromoteModalTarget] = useState<ManagedUser | null>(null);
    const [devices, setDevices] = useState<DeviceConfig[]>([]);
    const [formState, setFormState] = useState({
        fullname: "",
        username: "",
        password: "",
        account_type: "parent" as AccountType,
    });
    const assignableUsers = managedUsers.filter((entry) => entry.account_type !== "admin");

    useEffect(() => {
        setActivePanel("general");
    }, [isAdmin]);

    async function loadManagedUsers() {
        if (!isAdmin) {
            setManagedUsers([]);
            setUsersLoading(false);
            return;
        }

        const token = getToken();
        if (!token) {
            setUsersError(t("settings.error.missing_token"));
            setUsersLoading(false);
            return;
        }

        setUsersLoading(true);
        setUsersError("");

        try {
            const data = await fetchManagedUsers(token);
            setManagedUsers(data);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to load user management data";
            setUsersError(message);
        } finally {
            setUsersLoading(false);
        }
    }

    async function loadRooms() {
        if (!isAdmin) {
            setRooms([]);
            setRoomsLoading(false);
            return;
        }

        const token = getToken();
        if (!token) {
            setRoomsError(t("settings.error.missing_token"));
            setRoomsLoading(false);
            return;
        }

        setRoomsLoading(true);
        setRoomsError("");

        try {
            const data = await fetchRooms(token);
            setRooms(data);
            const devs = await fetchDashboardDevices();
            setDevices(devs as DeviceConfig[]);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to load areas";
            setRoomsError(message);
        } finally {
            setRoomsLoading(false);
        }
    }

    async function loadGeneralSettings() {
        if (!isAdmin) {
            setGeneralSettings(null);
            setGeneralSettingsError("");
            setGeneralSettingsLoading(false);
            setTimezoneDraft("");
            setHouseTemperatureDeviceDraft("");
            return;
        }

        const token = getToken();
        if (!token) {
            setGeneralSettings(null);
            setGeneralSettingsError(t("settings.error.missing_token"));
            setGeneralSettingsLoading(false);
            return;
        }

        setGeneralSettingsLoading(true);
        setGeneralSettingsError("");

        try {
            const data = await fetchGeneralSettings(token);
            setGeneralSettings(data);
            setTimezoneDraft(data.configured_timezone ?? "");
            setHouseTemperatureDeviceDraft(data.house_temperature_device_id ?? "");
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to load general settings";
            setGeneralSettings(null);
            setGeneralSettingsError(message);
        } finally {
            setGeneralSettingsLoading(false);
        }
    }

    async function loadTemperatureSourceOptions() {
        if (!isAdmin) {
            setTemperatureSourceOptions([]);
            setTemperatureSourceError("");
            setTemperatureSourceLoading(false);
            return;
        }

        setTemperatureSourceLoading(true);
        setTemperatureSourceError("");

        try {
            const devices = await fetchDashboardDevices();
            const eligibleDevices = devices
                .filter((device): device is DeviceConfig => !device.is_external && hasDhtSensor(device))
                .map((device) => ({
                    device_id: device.device_id,
                    name: device.name,
                    room_name: device.room_name ?? null,
                    board: device.board ?? null,
                }))
                .sort((left, right) => left.name.localeCompare(right.name));
            setTemperatureSourceOptions(eligibleDevices);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to load eligible temperature boards";
            setTemperatureSourceOptions([]);
            setTemperatureSourceError(message);
        } finally {
            setTemperatureSourceLoading(false);
        }
    }

    const loadManagedUsersForEffect = useEffectEvent(() => {
        void loadManagedUsers();
    });

    const loadRoomsForEffect = useEffectEvent(() => {
        void loadRooms();
    });

    const loadGeneralSettingsForEffect = useEffectEvent(() => {
        void loadGeneralSettings();
    });

    const loadTemperatureSourceOptionsForEffect = useEffectEvent(() => {
        void loadTemperatureSourceOptions();
    });

    useEffect(() => {
        if (isAdmin && activePanel === "general") {
            loadGeneralSettingsForEffect();
            loadTemperatureSourceOptionsForEffect();
        }

        if (activePanel === "users" || activePanel === "rooms") {
            loadManagedUsersForEffect();
            loadRoomsForEffect();
        }
    }, [activePanel, isAdmin]);

    async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setSubmitError("");
        setUserFormErrors({});
        setNotice("");

        const errors: Record<string, string> = {};
        if (!formState.username.trim()) {
            errors.username = t("settings.error.username_required");
        } else if (formState.username.trim().length < 3) {
            errors.username = t("settings.error.username_length");
        }

        if (!formState.fullname.trim()) {
            errors.fullname = t("settings.error.fullname_required");
        }
        
        if (!formState.password) {
            errors.password = t("settings.error.password_required");
        } else if (formState.password.length < 8) {
            errors.password = t("settings.error.password_length");
        }

        if (Object.keys(errors).length > 0) {
            setUserFormErrors(errors);
            return;
        }

        const token = getToken();
        if (!token) {
            setSubmitError(t("settings.error.missing_token"));
            return;
        }

        setIsSubmitting(true);

        try {
            const createdUser = await adminCreateUser(
                {
                    fullname: formState.fullname,
                    username: formState.username,
                    password: formState.password,
                    account_type: formState.account_type,
                },
                token,
            );

            setFormState({
                fullname: "",
                username: "",
                password: "",
                account_type: "parent" as AccountType,
            });
            setNotice(t("settings.notice.user_created").replace("{username}", createdUser.username));
            await loadManagedUsers();
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to create user";
            setSubmitError(message);
        } finally {
            setIsSubmitting(false);
        }
    }

    async function handleStatusChange(targetUser: ManagedUser, action: "revoke" | "promote") {
        const token = getToken();
        if (!token) {
            setUsersError(t("settings.error.missing_token"));
            return;
        }

        setActionUserId(targetUser.user_id);
        setUsersError("");
        setNotice("");

        try {
            let updatedUser = targetUser;
            if (action === "revoke") {
                await deleteManagedUser(targetUser.user_id, token);
            } else if (action === "promote") {
                updatedUser = await promoteManagedUser(targetUser.user_id, token);
            }

            if (action === "revoke") {
                setManagedUsers((currentUsers) =>
                    currentUsers.filter((entry) => entry.user_id !== targetUser.user_id)
                );
            } else {
                setManagedUsers((currentUsers) =>
                    currentUsers.map((entry) => (entry.user_id === updatedUser.user_id ? updatedUser : entry)),
                );
            }

            if (action === "promote") {
                setNotice("");
                const newRole = updatedUser.account_type === "admin" ? t("settings.users.form.role.admin") : t("settings.users.form.role.user");
                showToast(t("settings.toast.role_changed").replace("{username}", updatedUser.username).replace("{role}", newRole), "success");
            } else {
                setNotice("");
                showToast(t("settings.toast.user_deleted").replace("{username}", targetUser.username), "success");
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : `Failed to ${action} user`;
            setUsersError(message);
            if (action === "revoke") {
                showToast(message, "error");
            }
        } finally {
            setActionUserId(null);
        }
    }

    async function handleToggleRoomUser(room: RoomRecord, targetUserId: number) {
        setRoomActionId(room.room_id);
        setRoomsError("");

        try {
            const token = getToken();
            if (!token) return;

            const currentAllowed = room.allowed_user_ids || [];
            const isAllowed = currentAllowed.includes(targetUserId);
            
            let newAllowed: number[];
            if (isAllowed) {
                newAllowed = currentAllowed.filter((id) => id !== targetUserId);
            } else {
                newAllowed = [...currentAllowed, targetUserId];
            }

            const updatedRoom = await updateRoomAccess(room.room_id, newAllowed, token);

            setRooms((current) =>
                current.map((r) => (r.room_id === room.room_id ? updatedRoom : r))
            );
            
            showToast(t("settings.toast.area_access_updated"), "success");
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to update area access";
            setRoomsError(message);
        } finally {
            setRoomActionId(null);
        }
    }

    async function handleCreateRoom(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setRoomsError("");
        setCreateRoomNameError("");
        setNotice("");

        const token = getToken();
        if (!token) {
            setRoomsError(t("settings.error.missing_token"));
            return;
        }

        if (!roomFormName.trim()) {
            setCreateRoomNameError(t("settings.error.area_name_required"));
            return;
        }

        setRoomSubmitting(true);

        try {
            const createdRoom = await createRoom(
                {
                    name: roomFormName.trim(),
                },
                token,
            );

            setRooms((currentRooms) =>
                [...currentRooms, createdRoom].sort((left, right) => left.name.localeCompare(right.name)),
            );
            setRoomFormName("");
            setNotice(t("settings.notice.area_created").replace("{name}", createdRoom.name));
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to create area";
            setRoomsError(message);
        } finally {
            setRoomSubmitting(false);
        }
    }

    async function handleUpdateRoom(room: RoomRecord) {
        if (!editingRoomName.trim() || editingRoomName.trim() === room.name) {
            setEditingRoomId(null);
            return;
        }

        const token = getToken();
        if (!token) {
            setRoomsError(t("settings.error.missing_token"));
            return;
        }

        setRoomActionId(room.room_id);
        setRoomsError("");
        setNotice("");

        try {
            const updatedRoom = await updateRoom(room.room_id, editingRoomName.trim(), token);

            setRooms((currentRooms) =>
                currentRooms.map((entry) => (entry.room_id === updatedRoom.room_id ? updatedRoom : entry)),
            );
            setNotice(t("settings.notice.area_renamed").replace("{name}", updatedRoom.name));
            setEditingRoomId(null);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to update area";
            setRoomsError(message);
        } finally {
            setRoomActionId(null);
        }
    }

    async function handleDeleteRoom(roomId: number) {
        if (!window.confirm("Are you sure you want to delete this area? Devices assigned to it will be unassigned.")) return;

        const token = getToken();
        if (!token) {
            setRoomsError(t("settings.error.missing_token"));
            return;
        }

        setRoomActionId(roomId);
        setRoomsError("");
        setNotice("");

        try {
            await deleteRoom(roomId, token);

            setRooms((currentRooms) => currentRooms.filter((entry) => entry.room_id !== roomId));
            setNotice(t("settings.toast.area_deleted"));
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to delete area";
            setRoomsError(message);
        } finally {
            setRoomActionId(null);
        }
    }

    async function handleSaveTimezone(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (!isAdmin) {
            return;
        }

        const token = getToken();
        if (!token) {
            setGeneralSettingsError(t("settings.error.missing_token"));
            return;
        }

        const normalizedDraft = timezoneDraft.trim();
        if (
            normalizedDraft &&
            generalSettings &&
            !generalSettings.timezone_options.includes(normalizedDraft)
        ) {
            setGeneralSettingsError(t("settings.error.timezone_invalid"));
            return;
        }

        setTimezoneSaving(true);
        setGeneralSettingsError("");

        try {
            const nextSettings = await updateGeneralSettings(
                { timezone: normalizedDraft || null },
                token,
            );
            setGeneralSettings(nextSettings);
            setTimezoneDraft(nextSettings.configured_timezone ?? "");
            showToast(
                normalizedDraft
                    ? t("settings.toast.server_timezone_updated").replace("{timezone}", nextSettings.effective_timezone || "")
                    : t("settings.toast.server_timezone_reset").replace("{timezone}", nextSettings.effective_timezone || ""),
                "success",
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to update server timezone";
            setGeneralSettingsError(message);
            showToast(message, "error");
        } finally {
            setTimezoneSaving(false);
        }
    }

    async function handleSaveHouseTemperatureSource(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (!isAdmin) {
            return;
        }

        const token = getToken();
        if (!token) {
            setTemperatureSourceError(t("settings.error.missing_token"));
            return;
        }

        const normalizedDraft = houseTemperatureDeviceDraft.trim();
        if (
            normalizedDraft &&
            !temperatureSourceOptions.some((option) => option.device_id === normalizedDraft)
        ) {
            setTemperatureSourceError(t("settings.error.board_invalid"));
            return;
        }

        setTemperatureSourceSaving(true);
        setTemperatureSourceError("");

        try {
            const nextSettings = await updateGeneralSettings(
                { house_temperature_device_id: normalizedDraft || null },
                token,
            );
            setGeneralSettings(nextSettings);
            setHouseTemperatureDeviceDraft(nextSettings.house_temperature_device_id ?? "");
            showToast(
                nextSettings.house_temperature_device_name
                    ? t("settings.toast.house_climate_updated").replace("{name}", nextSettings.house_temperature_device_name)
                    : t("settings.toast.house_climate_disabled"),
                "success",
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to update house temperature source";
            setTemperatureSourceError(message);
            showToast(message, "error");
        } finally {
            setTemperatureSourceSaving(false);
        }
    }

    const [locationDeleting, setLocationDeleting] = useState(false);
    const [isResetLocationModalOpen, setIsResetLocationModalOpen] = useState(false);
    async function handleDeleteLocation() {
        setIsResetLocationModalOpen(false);
        setLocationDeleting(true);
        try {
            const token = getToken();
            if (!token) throw new Error(t("settings.error.missing_token"));

            const { deleteHouseholdLocation } = await import("@/lib/api");
            await deleteHouseholdLocation(token);
            
            showToast(t("settings.toast.location_reset") || "Home location has been reset", "success");
            // Navigate back to dashboard
            window.location.href = "/";
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to reset location";
            showToast(message, "error");
        } finally {
            setLocationDeleting(false);
        }
    }

    return (
        <div className="flex h-screen w-full bg-background-light text-slate-800 dark:bg-background-dark dark:text-slate-200 overflow-hidden font-sans selection:bg-primary selection:text-white">
            <Sidebar />

            <main className="flex min-w-0 min-h-0 flex-1 flex-col">
                <header className="px-8 pt-8 pb-4">
                    <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">{t("settings.title")}</h2>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">{t("settings.description")}</p>
                </header>

                <div className="px-8 border-b border-slate-200 dark:border-slate-800 flex gap-8">
                    <button
                        onClick={() => setActivePanel("general")}
                        className={`py-4 text-sm font-semibold transition-colors ${
                            activePanel === "general"
                                ? "border-b-[3px] border-primary text-primary"
                                : "text-slate-500 hover:text-primary dark:text-slate-400"
                        }`}
                    >
                        {t("settings.tabs.general")}
                    </button>
                    <button
                        onClick={() => setActivePanel("apiKeys")}
                        className={`py-4 text-sm font-semibold transition-colors ${
                            activePanel === "apiKeys"
                                ? "border-b-[3px] border-primary text-primary"
                                : "text-slate-500 hover:text-primary dark:text-slate-400"
                        }`}
                    >
                        {t("settings.tabs.apiKeys")}
                    </button>
                    {isAdmin ? (
                        <button
                            onClick={() => setActivePanel("users")}
                            className={`py-4 text-sm font-semibold transition-colors ${
                                activePanel === "users"
                                    ? "border-b-[3px] border-primary text-primary"
                                    : "text-slate-500 hover:text-primary dark:text-slate-400"
                            }`}
                        >
                            {t("settings.tabs.users")}
                        </button>
                    ) : null}
                    {isAdmin ? (
                        <button
                            onClick={() => setActivePanel("rooms")}
                            className={`py-4 text-sm font-semibold transition-colors ${
                                activePanel === "rooms"
                                    ? "border-b-[3px] border-primary text-primary"
                                    : "text-slate-500 hover:text-primary dark:text-slate-400"
                            }`}
                        >
                            {t("settings.tabs.rooms")}
                        </button>
                    ) : null}
                    {isAdmin ? (
                        <button
                            onClick={() => setActivePanel("configs")}
                            className={`py-4 text-sm font-semibold transition-colors ${
                                activePanel === "configs"
                                    ? "border-b-[3px] border-primary text-primary"
                                    : "text-slate-500 hover:text-primary dark:text-slate-400"
                            }`}
                        >
                            {t("settings.tabs.configs")}
                        </button>
                    ) : null}
                    {isAdmin ? (
                        <button
                            onClick={() => setActivePanel("wifi")}
                            className={`py-4 text-sm font-semibold transition-colors ${
                                activePanel === "wifi"
                                    ? "border-b-[3px] border-primary text-primary"
                                    : "text-slate-500 hover:text-primary dark:text-slate-400"
                            }`}
                        >
                            {t("settings.tabs.wifi")}
                        </button>
                    ) : null}
                </div>

                <div className="flex-1 overflow-y-auto bg-slate-50/60 p-6 dark:bg-background-dark">
                    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
                        {notice ? (
                            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                                {notice}
                            </div>
                        ) : null}
                        {usersError ? (
                            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                                {usersError}
                            </div>
                        ) : null}
                        {roomsError ? (
                            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                                {roomsError}
                            </div>
                        ) : null}

                        {activePanel === "general" ? (
                            <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                                <section className="flex flex-col justify-between rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-surface-dark">
                                    <div>
                                        <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">{t("settings.appearance.label")}</p>
                                        <h2 className="mt-2 text-xl font-semibold text-slate-900 dark:text-white">{t("settings.appearance.title")}</h2>
                                        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                            {t("settings.appearance.description")}
                                        </p>
                                    </div>
                                    <div className="mt-6 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800">
                                        <ThemeToggle />
                                    </div>
                                </section>

                                <section className="flex flex-col justify-between rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-surface-dark">
                                    <div>
                                        <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">{t("settings.language.label")}</p>
                                        <h2 className="mt-2 text-xl font-semibold text-slate-900 dark:text-white">{t("settings.language.title")}</h2>
                                        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                            {t("settings.language.description")}
                                        </p>
                                    </div>
                                    <div className="mt-6 relative">
                                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500 dark:text-slate-400">
                                            <span className="material-icons-round text-[20px]">language</span>
                                        </div>
                                        <select
                                            className="w-full appearance-none rounded-lg border border-slate-200 bg-white pl-10 pr-10 py-2.5 text-sm font-medium text-slate-900 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-700 dark:bg-surface-dark dark:text-white"
                                            value={language}
                                            onChange={(e) => setLanguage(e.target.value as "en" | "vi")}
                                        >
                                            <option value="en">{t("lang.en")}</option>
                                            <option value="vi">{t("lang.vi")}</option>
                                        </select>
                                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-500 dark:text-slate-400">
                                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                        </div>
                                    </div>
                                </section>

                                <section className="flex flex-col justify-between rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-surface-dark">
                                    <div>
                                        <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">{t("settings.navigation.label")}</p>
                                        <h2 className="mt-2 text-xl font-semibold text-slate-900 dark:text-white">{t("settings.navigation.title")}</h2>
                                        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                            {t("settings.navigation.description")}
                                        </p>
                                    </div>
                                    <div className="mt-6 flex items-center">
                                        <label className="relative inline-flex items-center cursor-pointer cursor-allowed">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={hoverToExpandSidebar}
                                                onChange={(e) => {
                                                    const val = e.target.checked;
                                                    setHoverToExpandSidebar(val);
                                                    try { localStorage.setItem("hoverToExpandSidebar", String(val)); } catch {}
                                                    // We could dispatch an event to let Sidebar know immediately, but a page reload is usually expected, or we can use a custom event.
                                                    if (typeof window !== "undefined") {
                                                        window.dispatchEvent(new Event("sidebarHoverSettingChanged"));
                                                    }
                                                }}
                                            />
                                            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-primary"></div>
                                        </label>
                                        <span className="ml-3 text-sm font-medium text-slate-900 dark:text-white">{t("settings.navigation.enable")}</span>
                                    </div>
                                </section>

                                {isAdmin ? (
                                    <section className="flex flex-col justify-between rounded-3xl border border-rose-200 bg-rose-50/30 p-6 shadow-sm dark:border-rose-900/50 dark:bg-rose-900/10">
                                        <div>
                                            <p className="text-sm font-medium uppercase tracking-[0.2em] text-rose-600 dark:text-rose-400">{t("settings.location.label") || "HOME LOCATION"}</p>
                                            <h2 className="mt-2 text-xl font-semibold text-slate-900 dark:text-white">{t("settings.location.title") || "Reset Home Location"}</h2>
                                            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                                {t("settings.location.description") || "Clear the current home location. You will be prompted to set it again on the dashboard."}
                                            </p>
                                        </div>
                                        <div className="mt-6">
                                            <button
                                                onClick={() => setIsResetLocationModalOpen(true)}
                                                disabled={locationDeleting}
                                                className="w-full sm:w-auto rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-rose-600 dark:hover:bg-rose-500"
                                            >
                                                {locationDeleting ? (t("settings.location.resetting") || "Resetting...") : (t("settings.location.reset_btn") || "Reset Location")}
                                            </button>
                                        </div>
                                    </section>
                                ) : null}

                                {isAdmin ? (
                                    <section className="md:col-span-2 lg:col-span-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-surface-dark">
                                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                            <div>
                                                <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">{t("settings.climate.label")}</p>
                                                <h2 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">{t("settings.climate.title")}</h2>
                                                <p className="mt-2 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
                                                    {t("settings.climate.description")}
                                                </p>
                                            </div>
                                        </div>

                                        {temperatureSourceError ? (
                                            <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                                                {temperatureSourceError}
                                            </div>
                                        ) : null}

                                        {temperatureSourceLoading ? (
                                            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-400">
                                                {t("settings.climate.loading")}
                                            </div>
                                        ) : (
                                            <div className="mt-6 space-y-6">
                                                <div className="grid gap-4 md:grid-cols-2">
                                                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/80">
                                                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{t("settings.climate.current")}</p>
                                                        <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">
                                                            {generalSettings?.house_temperature_device_name || t("settings.climate.not_configured")}
                                                        </p>
                                                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                                            {generalSettings?.house_temperature_device_id
                                                                ? t("settings.climate.current_desc_configured")
                                                                : t("settings.climate.current_desc_hidden")}
                                                        </p>
                                                    </div>
                                                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/80">
                                                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{t("settings.climate.eligible")}</p>
                                                        <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">{temperatureSourceOptions.length}</p>
                                                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                                            {t("settings.climate.eligible_desc")}
                                                        </p>
                                                    </div>
                                                </div>

                                                <form className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-900/80" onSubmit={handleSaveHouseTemperatureSource}>
                                                    <div>
                                                        <label htmlFor="house-temperature-source" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                                            {t("settings.climate.source_board")}
                                                        </label>
                                                        <select
                                                            id="house-temperature-source"
                                                            value={houseTemperatureDeviceDraft}
                                                            onChange={(event) => setHouseTemperatureDeviceDraft(event.target.value)}
                                                            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                                                        >
                                                            <option value="">{t("settings.climate.no_show")}</option>
                                                            {temperatureSourceOptions.map((option) => (
                                                                <option key={option.device_id} value={option.device_id}>
                                                                    {option.name}{option.room_name ? ` · ${option.room_name}` : ""}{option.board ? ` · ${option.board}` : ""}
                                                                </option>
                                                            ))}
                                                        </select>
                                                        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                                            {t("settings.climate.select_desc")}
                                                        </p>
                                                    </div>

                                                    <div className="flex flex-wrap gap-3">
                                                        <button
                                                            type="submit"
                                                            disabled={temperatureSourceSaving}
                                                            className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                                                        >
                                                            {temperatureSourceSaving ? t("settings.climate.saving") : t("settings.climate.save_btn")}
                                                        </button>
                                                    </div>
                                                </form>
                                            </div>
                                        )}
                                    </section>
                                ) : null}

                                {isAdmin ? (
                                    <section className="md:col-span-2 lg:col-span-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-surface-dark">
                                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                            <div>
                                                <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">{t("settings.timezone.label")}</p>
                                                <h2 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">{t("settings.timezone.title")}</h2>
                                                <p className="mt-2 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
                                                    {t("settings.timezone.description")}
                                                </p>
                                            </div>
                                        </div>

                                        {generalSettingsError ? (
                                            <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                                                {generalSettingsError}
                                            </div>
                                        ) : null}

                                        {generalSettingsLoading ? (
                                            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-400">
                                                {t("settings.timezone.loading")}
                                            </div>
                                        ) : generalSettings ? (
                                            <div className="mt-6 space-y-6">
                                                <div className="grid gap-4 md:grid-cols-2">
                                                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/80">
                                                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{t("settings.timezone.current")}</p>
                                                        <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">{generalSettings.effective_timezone}</p>
                                                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{formatTimezoneSourceLabel(generalSettings, t)}</p>
                                                    </div>
                                                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/80">
                                                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{t("settings.timezone.server_time")}</p>
                                                        <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">{formatServerTimePreview(generalSettings.current_server_time, generalSettings.effective_timezone)}</p>
                                                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("settings.timezone.preview_desc")}</p>
                                                    </div>
                                                </div>

                                                <form className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-900/80" onSubmit={handleSaveTimezone}>
                                                    <div>
                                                        <label htmlFor="server-timezone" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                                            {t("settings.timezone.override")}
                                                        </label>
                                                        <select
                                                            id="server-timezone"
                                                            value={timezoneDraft}
                                                            onChange={(event) => setTimezoneDraft(event.target.value)}
                                                            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                                                        >
                                                            <option value="">{t("settings.timezone.use_runtime")}</option>
                                                            {generalSettings.timezone_options.map((timezone) => (
                                                                <option key={timezone} value={timezone}>
                                                                    {timezone}
                                                                </option>
                                                            ))}
                                                        </select>
                                                        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                                            {t("settings.timezone.help_text")}
                                                        </p>
                                                    </div>

                                                    <div className="flex flex-wrap gap-3">
                                                        <button
                                                            type="submit"
                                                            disabled={timezoneSaving}
                                                            className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                                                        >
                                                            {timezoneSaving ? t("settings.timezone.saving") : t("settings.timezone.save_btn")}
                                                        </button>
                                                    </div>
                                                </form>
                                            </div>
                                        ) : null}
                                    </section>
                                ) : null}
                            </div>
                        ) : null}

                        {activePanel === "apiKeys" ? (
                            <ApiKeysPanel timezone={generalSettings?.effective_timezone ?? null} />
                        ) : null}

                        {activePanel === "users" ? (
                            isAdmin ? (
                                <div className="space-y-10">
                                    <section className="max-w-5xl">
                                        <div className="flex justify-between items-start mb-6">
                                            <div>
                                                <h3 className="text-xl font-bold dark:text-white text-slate-900">{t("settings.users.provision.title")}</h3>
                                                <p className="text-sm text-slate-500 dark:text-slate-400">{t("settings.users.provision.desc")}</p>
                                            </div>
                                            {submitError ? (
                                                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300 max-w-xs text-right">
                                                    {submitError}
                                                </div>
                                            ) : null}
                                        </div>
                                        <form className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 p-6 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl" onSubmit={handleCreateUser} noValidate>
                                            <div className="flex flex-col gap-2">
                                                <label className={`text-sm font-medium ${userFormErrors.username ? 'text-rose-500' : 'dark:text-slate-300 text-slate-700'}`}>{t("settings.users.form.username")}</label>
                                                <input 
                                                    className={`bg-white dark:bg-slate-800 border rounded-lg px-4 py-2.5 text-sm focus:ring-primary focus:border-primary outline-none transition-shadow text-slate-900 dark:text-white ${userFormErrors.username ? 'border-rose-500 focus:ring-rose-500/20' : 'border-slate-200 dark:border-slate-700/50'}`} 
                                                    placeholder="e.g. jdoe" 
                                                    type="text"
                                                    value={formState.username}
                                                    onChange={(event) => {
                                                        setFormState((current) => ({ ...current, username: event.target.value }));
                                                        if (userFormErrors.username) setUserFormErrors(prev => ({ ...prev, username: "" }));
                                                    }}
                                                />
                                                {userFormErrors.username ? (
                                                    <p className="text-xs font-medium text-rose-500 flex items-center">
                                                        <span className="material-icons-round text-[14px] mr-1">error_outline</span>
                                                        {userFormErrors.username}
                                                    </p>
                                                ) : null}
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                <label className={`text-sm font-medium ${userFormErrors.fullname ? 'text-rose-500' : 'dark:text-slate-300 text-slate-700'}`}>{t("settings.users.form.fullname")}</label>
                                                <input 
                                                    className={`bg-white dark:bg-slate-800 border rounded-lg px-4 py-2.5 text-sm focus:ring-primary focus:border-primary outline-none transition-shadow text-slate-900 dark:text-white ${userFormErrors.fullname ? 'border-rose-500 focus:ring-rose-500/20' : 'border-slate-200 dark:border-slate-700/50'}`} 
                                                    placeholder="John Doe" 
                                                    type="text"
                                                    value={formState.fullname}
                                                    onChange={(event) => {
                                                        setFormState((current) => ({ ...current, fullname: event.target.value }));
                                                        if (userFormErrors.fullname) setUserFormErrors(prev => ({ ...prev, fullname: "" }));
                                                    }}
                                                />
                                                {userFormErrors.fullname ? (
                                                    <p className="text-xs font-medium text-rose-500 flex items-center">
                                                        <span className="material-icons-round text-[14px] mr-1">error_outline</span>
                                                        {userFormErrors.fullname}
                                                    </p>
                                                ) : null}
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                <label className={`text-sm font-medium ${userFormErrors.password ? 'text-rose-500' : 'dark:text-slate-300 text-slate-700'}`}>{t("settings.users.form.password")}</label>
                                                <input 
                                                    className={`bg-white dark:bg-slate-800 border rounded-lg px-4 py-2.5 text-sm focus:ring-primary focus:border-primary outline-none transition-shadow text-slate-900 dark:text-white ${userFormErrors.password ? 'border-rose-500 focus:ring-rose-500/20' : 'border-slate-200 dark:border-slate-700/50'}`} 
                                                    placeholder="••••••••" 
                                                    type="password"
                                                    value={formState.password}
                                                    onChange={(event) => {
                                                        setFormState((current) => ({ ...current, password: event.target.value }));
                                                        if (userFormErrors.password) setUserFormErrors(prev => ({ ...prev, password: "" }));
                                                    }}
                                                />
                                                {userFormErrors.password ? (
                                                    <p className="text-xs font-medium text-rose-500 flex items-center">
                                                        <span className="material-icons-round text-[14px] mr-1">error_outline</span>
                                                        {userFormErrors.password}
                                                    </p>
                                                ) : null}
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                <label className="text-sm font-medium dark:text-slate-300 text-slate-700">{t("settings.users.form.role")}</label>
                                                <select 
                                                    className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700/50 rounded-lg px-4 py-2.5 text-sm focus:ring-primary focus:border-primary outline-none transition-shadow text-slate-900 dark:text-white"
                                                    value={formState.account_type}
                                                    onChange={(event) => setFormState((current) => ({ ...current, account_type: event.target.value as AccountType }))}
                                                >
                                                    <option value="parent">{t("settings.users.form.role.user")}</option>
                                                    <option value="admin">{t("settings.users.form.role.admin")}</option>
                                                </select>
                                            </div>
                                            <div className="lg:col-span-4 flex justify-end mt-2">
                                                <button 
                                                    type="submit" 
                                                    disabled={isSubmitting}
                                                    className="bg-primary hover:bg-blue-600 text-white font-semibold py-2.5 px-6 rounded-lg text-sm shadow-lg shadow-primary/20 transition-all flex items-center gap-2 disabled:opacity-50"
                                                >
                                                    {isSubmitting ? <span className="material-icons-round text-[18px] animate-spin">refresh</span> : null}
                                                    {t("settings.users.form.create_btn")}
                                                </button>
                                            </div>
                                        </form>
                                    </section>

                                    <div className="flex flex-col gap-8 max-w-5xl">
                                        <section className="w-full">
                                            <div className="mb-4">
                                                <div className="flex justify-between items-center pr-2">
                                                    <div>
                                                        <h3 className="text-xl font-bold dark:text-white text-slate-900">{t("settings.users.active.title")}</h3>
                                                        <p className="text-sm text-slate-500 dark:text-slate-400">{t("settings.users.active.desc")}</p>
                                                    </div>
                                                    <button 
                                                        onClick={() => void loadManagedUsers()}
                                                        className="text-slate-500 hover:text-primary transition-colors flex items-center gap-1 text-sm font-medium"
                                                    >
                                                        <span className="material-icons-round text-lg">refresh</span> {t("settings.users.active.refresh")}
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto w-full">
                                                <table className="w-full text-left whitespace-nowrap">
                                                    <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
                                                        <tr>
                                                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t("settings.users.table.user")}</th>
                                                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t("settings.users.table.role")}</th>
                                                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-right">{t("settings.users.table.actions")}</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                                                        {usersLoading ? (
                                                            <tr>
                                                                <td colSpan={3} className="px-6 py-12 text-center">
                                                                    <span className="material-icons-round animate-spin text-slate-400 text-3xl">refresh</span>
                                                                </td>
                                                            </tr>
                                                        ) : Object.keys(managedUsers).length === 0 ? (
                                                            <tr>
                                                                <td colSpan={3} className="px-6 py-12 text-center">
                                                                    <div className="flex flex-col items-center justify-center opacity-50">
                                                                        <span className="material-icons-round text-4xl mb-2 text-slate-400">group</span>
                                                                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{t("settings.users.table.empty")}</p>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        ) : (
                                                            managedUsers.map((managedUser) => (
                                                                <tr key={managedUser.user_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                                                    <td className="px-6 py-4">
                                                                        <div className="flex items-center gap-3">
                                                                            <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 font-bold uppercase overflow-hidden text-xs shadow-sm">
                                                                                {managedUser.fullname.substring(0, 2)}
                                                                            </div>
                                                                            <div className="min-w-0 flex flex-col items-start text-left max-w-[200px]">
                                                                                <div className="flex items-center gap-2">
                                                                                    <p className="text-sm font-bold truncate dark:text-white text-slate-900">{managedUser.username}</p>
                                                                                    {managedUser.user_id === user?.user_id ? (
                                                                                        <span className="bg-primary/10 text-primary text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider whitespace-nowrap">{t("settings.users.table.you")}</span>
                                                                                    ) : null}
                                                                                </div>
                                                                                <p className="text-xs text-slate-500 dark:text-slate-400 truncate w-full">{managedUser.fullname}</p>
                                                                            </div>
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-6 py-4">
                                                                        <div className="flex gap-2 items-center">
                                                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 capitalize border border-slate-200 dark:border-slate-700">
                                                                                {formatAccountTypeLabel(managedUser.account_type)}
                                                                            </span>
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-6 py-4 text-right">
                                                                        <div className="flex justify-end gap-2">
                                                                            {managedUser.user_id !== 1 && managedUser.user_id !== user?.user_id ? (
                                                                                <button
                                                                                    onClick={() => setPromoteModalTarget(managedUser)}
                                                                                    disabled={actionUserId === managedUser.user_id}
                                                                                    className="text-slate-400 hover:text-blue-500 transition-colors disabled:opacity-30 p-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-500/10 inline-flex items-center justify-center"
                                                                                    title={managedUser.account_type === "admin" ? t("settings.users.table.demote_title") : t("settings.users.table.promote_title")}
                                                                                >
                                                                                    {actionUserId === managedUser.user_id ? <span className="material-icons-round text-lg animate-spin">refresh</span> : <span className="material-icons-round text-lg">{managedUser.account_type === "admin" ? "arrow_downward" : "arrow_upward"}</span>}
                                                                                </button>
                                                                            ) : null}
                                                                            {managedUser.user_id !== 1 && (
                                                                                <button
                                                                                    onClick={() => setRevokeModalTarget(managedUser)}
                                                                                    disabled={actionUserId === managedUser.user_id || managedUser.user_id === user?.user_id}
                                                                                    className="text-slate-400 hover:text-rose-500 transition-colors disabled:opacity-30 p-2 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-500/10 inline-flex items-center justify-center"
                                                                                    title={t("settings.users.table.delete_title")}
                                                                                >
                                                                                    {actionUserId === managedUser.user_id ? <span className="material-icons-round text-lg animate-spin">refresh</span> : <span className="material-icons-round text-lg">delete</span>}
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            ))
                                                        )}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </section>
                                    </div>
                                </div>
                            ) : (
                                <section className="rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm dark:border-slate-700 dark:bg-surface-dark">
                                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">
                                        <span className="material-icons-round text-4xl">admin_panel_settings</span>
                                    </div>
                                    <h2 className="mt-5 text-2xl font-semibold text-slate-900 dark:text-white">{t("settings.users.admin_req.title")}</h2>
                                    <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                                        {t("settings.users.admin_req.desc")}
                                    </p>
                                </section>
                            )
                        ) : null}

                        {activePanel === "rooms" ? (
                            isAdmin ? (
                                <div className="space-y-6">
                                    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-surface-dark">
                                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                            <div>
                                                <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">{t("settings.areas.matrix.label")}</p>
                                                <h2 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">{t("settings.areas.matrix.title")}</h2>
                                                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                                    {t("settings.areas.matrix.desc")}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => void loadRooms()}
                                                className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                                            >
                                                <span className="material-icons-round mr-2 text-[18px]">refresh</span>
                                                {t("settings.areas.matrix.refresh")}
                                            </button>
                                        </div>
                                    </section>

                                    <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-6">
                                        {/* Create Area Interactive Card */}
                                        <article className="flex min-h-[350px] flex-col rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-surface-dark overflow-hidden">
                                            {!isCreatingArea ? (
                                                <button 
                                                    onClick={() => setIsCreatingArea(true)}
                                                    className="flex h-full w-full flex-col items-center justify-center p-6 text-slate-500 transition-all hover:bg-slate-50 hover:text-primary dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-primary group"
                                                >
                                                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 group-hover:bg-primary/10 transition-colors dark:bg-slate-800 dark:group-hover:bg-primary/20">
                                                        <span className="material-icons-round text-3xl">add</span>
                                                    </div>
                                                    <span className="text-lg font-semibold">{t("settings.areas.create.title")}</span>
                                                    <span className="mt-2 text-sm text-center px-4">{t("settings.areas.create.desc")}</span>
                                                </button>
                                            ) : (
                                                <div className="flex h-full flex-col p-6">
                                                    <div className="mb-6 flex items-center gap-3">
                                                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                                                            <span className="material-icons-round">meeting_room</span>
                                                        </div>
                                                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{t("settings.areas.create.title")}</h3>
                                                    </div>
                                                    
                                                    <form className="flex flex-1 flex-col justify-between" onSubmit={(e) => {
                                                        void handleCreateRoom(e);
                                                        if (!createRoomNameError && roomFormName.trim()) {
                                                            setIsCreatingArea(false);
                                                        }
                                                    }} noValidate>
                                                        <div>
                                                            <label className={`mb-1.5 block text-sm font-medium ${createRoomNameError ? 'text-rose-500' : 'text-slate-700 dark:text-slate-300'}`}>{t("settings.areas.form.name")}</label>
                                                            <input
                                                                type="text"
                                                                value={roomFormName}
                                                                autoFocus
                                                                onChange={(event) => {
                                                                    setRoomFormName(event.target.value);
                                                                    if (createRoomNameError) setCreateRoomNameError("");
                                                                }}
                                                                className={`w-full rounded-2xl border bg-white px-4 py-3 text-slate-900 outline-none transition dark:bg-slate-900/80 dark:text-white ${createRoomNameError ? 'border-rose-500 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20' : 'border-slate-300 focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700'}`}
                                                                placeholder={t("settings.areas.form.placeholder")}
                                                            />
                                                            {createRoomNameError ? (
                                                                <p className="mt-2 text-sm font-medium text-rose-500 flex items-center">
                                                                    <span className="material-icons-round text-[18px] mr-1">error_outline</span>
                                                                    {createRoomNameError}
                                                                </p>
                                                            ) : null}
                                                        </div>
                                                        <div className="mt-6 flex gap-3">
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setIsCreatingArea(false);
                                                                    setRoomFormName("");
                                                                    setCreateRoomNameError("");
                                                                }}
                                                                className="flex-1 rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                                                            >
                                                                {t("settings.areas.card.btn_cancel")}
                                                            </button>
                                                            <button
                                                                type="submit"
                                                                disabled={roomSubmitting}
                                                                className="flex flex-1 items-center justify-center rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-70"
                                                            >
                                                                {roomSubmitting ? (
                                                                    <span className="material-icons-round animate-spin">refresh</span>
                                                                ) : (
                                                                    t("settings.areas.form.btn_create")
                                                                )}
                                                            </button>
                                                        </div>
                                                    </form>
                                                </div>
                                            )}
                                        </article>

                                        {roomsLoading ? (
                                            <div className="col-span-full flex min-h-64 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
                                                <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                                                    <span className="material-icons-round animate-spin">refresh</span>
                                                    {t("settings.areas.matrix.loading")}
                                                </div>
                                            </div>
                                        ) : (
                                            rooms.map((room) => {
                                                return (
                                                    <article
                                                        key={room.room_id}
                                                        className="flex min-h-[350px] flex-col rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 hover:shadow-md dark:border-slate-700 dark:bg-surface-dark dark:hover:border-slate-600"
                                                    >
                                                        {/* Header */}
                                                        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
                                                            {editingRoomId === room.room_id ? (
                                                                <input
                                                                    type="text"
                                                                    value={editingRoomName}
                                                                    onChange={(e) => setEditingRoomName(e.target.value)}
                                                                    autoFocus
                                                                    disabled={roomActionId === room.room_id}
                                                                    className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === "Enter") void handleUpdateRoom(room);
                                                                        if (e.key === "Escape") setEditingRoomId(null);
                                                                    }}
                                                                />
                                                            ) : (
                                                                <div className="flex flex-col">
                                                                    <div className="flex items-center gap-2">
                                                                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white line-clamp-1">{room.name}</h3>
                                                                    </div>
                                                                    <span className="mt-1 w-fit rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                                                        {t("settings.areas.card.area_label").replace("{id}", room.room_id.toString())}
                                                                    </span>
                                                                </div>
                                                            )}

                                                            <div className="ml-3 flex shrink-0 items-center gap-1">
                                                                {editingRoomId === room.room_id ? (
                                                                    <>
                                                                        <button
                                                                            onClick={() => void handleUpdateRoom(room)}
                                                                            disabled={roomActionId === room.room_id}
                                                                            className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-white transition hover:bg-blue-600 disabled:opacity-70"
                                                                            title={t("settings.areas.card.btn_save")}
                                                                        >
                                                                            {roomActionId === room.room_id ? <span className="material-icons-round text-sm animate-spin">refresh</span> : <span className="material-icons-round text-sm">check</span>}
                                                                        </button>
                                                                        <button
                                                                            onClick={() => setEditingRoomId(null)}
                                                                            disabled={roomActionId === room.room_id}
                                                                            className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition hover:bg-slate-200 disabled:opacity-70 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                                                                            title={t("settings.areas.card.btn_cancel")}
                                                                        >
                                                                            <span className="material-icons-round text-sm">close</span>
                                                                        </button>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <button
                                                                            onClick={() => {
                                                                                setEditingRoomId(room.room_id);
                                                                                setEditingRoomName(room.name);
                                                                            }}
                                                                            className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-slate-50 text-slate-500 transition hover:bg-slate-200 hover:text-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                                                                            title={t("settings.areas.card.btn_edit")}
                                                                        >
                                                                            <span className="material-icons-round text-sm">edit</span>
                                                                        </button>
                                                                        <button
                                                                            onClick={() => setDeleteRoomTarget(room)}
                                                                            disabled={roomActionId === room.room_id}
                                                                            className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 text-rose-500 transition hover:bg-rose-100 hover:text-rose-600 disabled:opacity-50 dark:bg-rose-500/10 dark:text-rose-400 dark:hover:bg-rose-500/20"
                                                                            title={t("settings.areas.card.btn_delete")}
                                                                        >
                                                                            {roomActionId === room.room_id ? <span className="material-icons-round text-sm animate-spin">refresh</span> : <span className="material-icons-round text-sm">delete</span>}
                                                                        </button>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* Body */}
                                                        <div className="flex flex-1 flex-col divide-y divide-slate-100 dark:divide-slate-800">
                                                            <div className="p-5">
                                                                <h4 className="flex items-center text-sm font-semibold text-slate-900 dark:text-white">
                                                                    <span className="material-icons-round mr-2 text-[18px] text-slate-400">group</span>
                                                                    {t("settings.areas.card.accessible_by")}
                                                                </h4>
                                                                <div className="mt-3 flex flex-wrap gap-2">
                                                                    {assignableUsers.length === 0 ? (
                                                                        <p className="text-sm italic text-slate-400">{t("settings.areas.card.no_users")}</p>
                                                                    ) : (
                                                                        assignableUsers.map((u) => {
                                                                            const isAllowed = room.allowed_user_ids?.includes(u.user_id) ?? false;
                                                                            return (
                                                                                <button
                                                                                    key={u.user_id}
                                                                                    onClick={() => void handleToggleRoomUser(room, u.user_id)}
                                                                                    disabled={roomActionId === room.room_id}
                                                                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${isAllowed ? 'bg-primary/10 border-primary/20 text-primary dark:bg-primary/20 dark:text-white hover:bg-primary/20 dark:hover:bg-primary/30' : 'bg-slate-50 border-slate-200 text-slate-600 dark:bg-slate-800/50 dark:border-slate-700/60 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                                                                                >
                                                                                    <span className="material-icons-round text-[14px]">
                                                                                        {isAllowed ? 'check_circle' : 'radio_button_unchecked'}
                                                                                    </span>
                                                                                    {u.username}
                                                                                    {u.user_id === user?.user_id && (
                                                                                        <span className="ml-0.5 rounded bg-primary/10 px-1 py-0.5 text-[9px] font-bold uppercase text-primary">
                                                                                            {t("settings.users.you_badge")}
                                                                                        </span>
                                                                                    )}
                                                                                </button>
                                                                            )
                                                                        })
                                                                    )}
                                                                </div>
                                                            </div>

                                                            <div className="flex-1 p-5">
                                                                <h4 className="flex items-center text-sm font-semibold text-slate-900 dark:text-white">
                                                                    <span className="material-icons-round mr-2 text-[18px] text-slate-400">devices</span>
                                                                    {t("settings.areas.card.assigned_devices")}
                                                                </h4>
                                                                <div className="mt-3 flex flex-col gap-2">
                                                                    {devices.length === 0 ? (
                                                                        <p className="text-sm italic text-slate-400">{t("settings.areas.card.no_devices")}</p>
                                                                    ) : (
                                                                        (() => {
                                                                            const roomDevices = devices.filter(d => d.room_id === room.room_id);
                                                                            if (roomDevices.length === 0) {
                                                                                return <p className="text-xs italic text-slate-400">{t("settings.areas.card.no_devices")}</p>;
                                                                            }
                                                                            return roomDevices.map((device) => (
                                                                                <div key={device.device_id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/50">
                                                                                    <span className="text-slate-700 dark:text-slate-300">{device.name}</span>
                                                                                    <span className="text-[10px] uppercase tracking-wide text-slate-400">{device.device_type ?? (device.is_external ? 'External' : 'Device')}</span>
                                                                                </div>
                                                                            ));
                                                                        })()
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </article>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <section className="rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm dark:border-slate-700 dark:bg-surface-dark">
                                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">
                                        <span className="material-icons-round text-4xl">admin_panel_settings</span>
                                    </div>
                                    <h2 className="mt-5 text-2xl font-semibold text-slate-900 dark:text-white">Admin access required</h2>
                                    <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                                        This menu only appears for accounts with admin privileges. Sign in with an admin account if you need to manage area boundaries and device access.
                                    </p>
                                </section>
                            )
                        ) : null}

                        {activePanel === "configs" ? (
                            <ConfigsPanel timezone={generalSettings?.effective_timezone ?? null} />
                        ) : null}

                        {activePanel === "wifi" ? (
                            <WifiCredentialsPanel timezone={generalSettings?.effective_timezone ?? null} />
                        ) : null}
                    </div>
                </div>
            </main>

            <ConfirmModal
                isOpen={isResetLocationModalOpen}
                title={t("settings.location.reset_btn") || "Reset Location"}
                message={t("settings.location.confirm_reset") || "Are you sure you want to reset your home location?"}
                onConfirm={handleDeleteLocation}
                onCancel={() => setIsResetLocationModalOpen(false)}
                confirmText={t("settings.location.reset_btn") || "Reset Location"}
                cancelText={t("settings.location.cancel_btn") || "Cancel"}
                type="danger"
                isLoading={locationDeleting}
            />


            {/* Promote Modal */}
            {promoteModalTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm transition-all dark:bg-slate-900/60">
                    <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-surface-dark dark:border dark:border-slate-800">
                        <div className="p-6">
                            <div className="flex items-start gap-4">
                                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
                                    <span className="material-icons-round">manage_accounts</span>
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                                        {promoteModalTarget.account_type === "admin" ? t("settings.users.modal.promote.title_demote") : t("settings.users.modal.promote.title_promote")}
                                    </h3>
                                    <p className="text-sm text-slate-500 mt-1 mb-6 dark:text-slate-400">
                                        {promoteModalTarget.account_type === "admin" 
                                            ? t("settings.users.modal.promote.desc_demote").replace("{username}", promoteModalTarget.username) 
                                            : t("settings.users.modal.promote.desc_promote").replace("{username}", promoteModalTarget.username)}
                                    </p>
                                    <div className="flex gap-3">
                                        <button 
                                            onClick={() => {
                                                void handleStatusChange(promoteModalTarget, "promote");
                                                setPromoteModalTarget(null);
                                            }}
                                            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-all"
                                        >
                                            {t("settings.users.modal.promote.btn_confirm")}
                                        </button>
                                        <button 
                                            onClick={() => setPromoteModalTarget(null)}
                                            className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 text-sm font-semibold rounded-lg transition-all"
                                        >
                                            {t("settings.users.modal.promote.btn_cancel")}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Revoke User Modal */}
            {revokeModalTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm transition-all dark:bg-slate-900/60">
                    <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-surface-dark dark:border dark:border-slate-800">
                        <div className="p-6">
                            <div className="flex items-start gap-4">
                                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
                                    <span className="material-icons-round">delete_forever</span>
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                                        {t("settings.users.modal.delete.title")}
                                    </h3>
                                    <p className="text-sm text-slate-500 mt-1 mb-6 dark:text-slate-400">
                                        {t("settings.users.modal.delete.desc").replace("{username}", revokeModalTarget.username)}
                                    </p>
                                    <div className="flex gap-3">
                                        <button 
                                            onClick={() => {
                                                void handleStatusChange(revokeModalTarget, "revoke");
                                                setRevokeModalTarget(null);
                                            }}
                                            className="px-6 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold rounded-lg transition-all"
                                        >
                                            {t("settings.users.modal.delete.btn_confirm")}
                                        </button>
                                        <button 
                                            onClick={() => setRevokeModalTarget(null)}
                                            className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 text-sm font-semibold rounded-lg transition-all"
                                        >
                                            {t("settings.users.modal.delete.btn_cancel")}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Room Modal */}
            {deleteRoomTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm transition-all dark:bg-slate-900/60">
                    <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-surface-dark dark:border dark:border-slate-800">
                        <div className="p-6">
                            <div className="flex items-start gap-4">
                                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
                                    <span className="material-icons-round">delete_forever</span>
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                                        {t("settings.areas.modal.delete.title")}
                                    </h3>
                                    <p className="text-sm text-slate-500 mt-1 mb-6 dark:text-slate-400">
                                        {t("settings.areas.modal.delete.desc").replace("{name}", deleteRoomTarget.name)}
                                    </p>
                                    <div className="flex gap-3">
                                        <button 
                                            onClick={() => {
                                                void handleDeleteRoom(deleteRoomTarget.room_id);
                                                setDeleteRoomTarget(null);
                                            }}
                                            className="px-6 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold rounded-lg transition-all"
                                        >
                                            {t("settings.areas.modal.delete.btn_confirm")}
                                        </button>
                                        <button 
                                            onClick={() => setDeleteRoomTarget(null)}
                                            className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 text-sm font-semibold rounded-lg transition-all"
                                        >
                                            {t("general.cancel")}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
