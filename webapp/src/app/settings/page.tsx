"use client";

import { FormEvent, useEffect, useEffectEvent, useState } from "react";


import { useAuth } from "@/components/AuthProvider";
import { useWebSocket } from "@/hooks/useWebSocket";
import {
    ManagedUser,
    adminCreateUser,
    approveManagedUser,
    fetchManagedUsers,
    getToken,
    deleteManagedUser,
    promoteManagedUser,
} from "@/lib/auth";
import { RuntimeNetworkInfo, fetchRuntimeNetworkInfo } from "@/lib/api";
import {
    RoomRecord,
    createRoom,
    fetchRooms,
    updateRoom,
    deleteRoom,
    updateRoomAccess,
} from "@/lib/rooms";
import Sidebar from "@/components/Sidebar";
import { ConfigsPanel } from "./ConfigsPanel";
import { useToast } from "@/components/ToastContext";

function formatAccountTypeLabel(accountType?: string | null) {
    return accountType === "admin" ? "admin" : "user";
}

type SettingsPanel = "general" | "users" | "rooms" | "configs";
type AccountType = ManagedUser["account_type"];


export default function SettingsPage() {
    const { user } = useAuth();
    const { showToast } = useToast();
    const isAdmin = user?.account_type === "admin";

    const [activePanel, setActivePanel] = useState<SettingsPanel>("general");
    const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
    const [usersLoading, setUsersLoading] = useState(true);
    const [usersError, setUsersError] = useState("");
    const [rooms, setRooms] = useState<RoomRecord[]>([]);
    const [roomsLoading, setRoomsLoading] = useState(true);
    const [roomsError, setRoomsError] = useState("");
    const [runtimeNetwork, setRuntimeNetwork] = useState<RuntimeNetworkInfo | null>(null);
    const [networkLoading, setNetworkLoading] = useState(true);
    const [networkError, setNetworkError] = useState("");
    const [roomFormName, setRoomFormName] = useState("");
    const [editingRoomId, setEditingRoomId] = useState<number | null>(null);
    const [editingRoomName, setEditingRoomName] = useState("");
    const [roomSubmitting, setRoomSubmitting] = useState(false);
    const [roomActionId, setRoomActionId] = useState<number | null>(null);
    const [notice, setNotice] = useState("");
    const [submitError, setSubmitError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [actionUserId, setActionUserId] = useState<number | null>(null);
    const [revokeModalTarget, setRevokeModalTarget] = useState<ManagedUser | null>(null);
    const [promoteModalTarget, setPromoteModalTarget] = useState<ManagedUser | null>(null);
    const [formState, setFormState] = useState({
        fullname: "",
        username: "",
        password: "",
        account_type: "parent" as AccountType,
    });

    useWebSocket((event) => {
        if (event.type === "system_metrics" && event.payload) {
            const metrics = event.payload as Record<string, unknown>;
            if (typeof metrics.cpu_percent === 'number' && typeof metrics.memory_used === 'number' && typeof metrics.memory_total === 'number') {
                setRuntimeNetwork((prev) => {
                    if (!prev) return prev;
                    return {
                        ...prev,
                        cpu_percent: metrics.cpu_percent as number,
                        memory_used: metrics.memory_used as number,
                        memory_total: metrics.memory_total as number,
                        storage_used: metrics.storage_used as number,
                        storage_total: metrics.storage_total as number
                    };
                });
            }
        }
    });

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
            setUsersError("Missing session token. Please sign in again.");
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
            setRoomsError("Missing session token. Please sign in again.");
            setRoomsLoading(false);
            return;
        }

        setRoomsLoading(true);
        setRoomsError("");

        try {
            const data = await fetchRooms(token);
            setRooms(data);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to load rooms";
            setRoomsError(message);
        } finally {
            setRoomsLoading(false);
        }
    }

    async function loadRuntimeNetworkInfo() {
        if (!isAdmin) {
            setRuntimeNetwork(null);
            setNetworkError("");
            setNetworkLoading(false);
            return;
        }

        const token = getToken();
        if (!token) {
            setRuntimeNetwork(null);
            setNetworkError("Missing session token. Please sign in again.");
            setNetworkLoading(false);
            return;
        }

        setNetworkLoading(true);
        setNetworkError("");

        try {
            const data = await fetchRuntimeNetworkInfo(token);
            setRuntimeNetwork(data);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : "Failed to load runtime network targets";
            setRuntimeNetwork(null);
            setNetworkError(message);
        } finally {
            setNetworkLoading(false);
        }
    }

    const loadManagedUsersForEffect = useEffectEvent(() => {
        void loadManagedUsers();
    });

    const loadRoomsForEffect = useEffectEvent(() => {
        void loadRooms();
    });

    const loadRuntimeNetworkForEffect = useEffectEvent(() => {
        void loadRuntimeNetworkInfo();
    });

    useEffect(() => {
        if (isAdmin && activePanel === "general") {
            loadRuntimeNetworkForEffect();
        }

        if (activePanel === "users" || activePanel === "rooms") {
            loadManagedUsersForEffect();
            loadRoomsForEffect();
        }
    }, [activePanel, isAdmin]);

    async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setSubmitError("");
        setNotice("");

        const token = getToken();
        if (!token) {
            setSubmitError("Missing session token. Please sign in again.");
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
                    ui_layout: {},
                },
                token,
            );

            setFormState({
                fullname: "",
                username: "",
                password: "",
                account_type: "parent" as AccountType,
            });
            setNotice(
                `Created ${createdUser.username}. The account is pending approval until an admin approves it.`,
            );
            await loadManagedUsers();
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to create user";
            setSubmitError(message);
        } finally {
            setIsSubmitting(false);
        }
    }

    async function handleStatusChange(targetUser: ManagedUser, action: "approve" | "revoke" | "promote") {

        const token = getToken();
        if (!token) {
            setUsersError("Missing session token. Please sign in again.");
            return;
        }

        setActionUserId(targetUser.user_id);
        setUsersError("");
        setNotice("");

        try {
            let updatedUser = targetUser;
            if (action === "approve") {
                updatedUser = await approveManagedUser(targetUser.user_id, token);
            } else if (action === "revoke") {
                await deleteManagedUser(targetUser.user_id, token);
            } else if (action === "promote") {
                updatedUser = await promoteManagedUser(targetUser.user_id, token);
            }

            if (action === "revoke") {
                setManagedUsers((currentUsers) =>
                    currentUsers.map((entry) => 
                        entry.user_id === targetUser.user_id 
                            ? { ...entry, approval_status: "revoked" } 
                            : entry
                    ),
                );
            } else {
                setManagedUsers((currentUsers) =>
                    currentUsers.map((entry) => (entry.user_id === updatedUser.user_id ? updatedUser : entry)),
                );
            }
            
            if (action === "approve") {
                setNotice(`Approved ${updatedUser.username}.`);
            } else if (action === "promote") {
                setNotice("");
                showToast(`Promoted ${updatedUser.username} to Admin.`, "success");
            } else {
                setNotice("");
                showToast(`Revoked ${targetUser.username}. Their account has been blocked.`, "success");
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
            
            showToast(`Room access updated.`, "success");
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to update room access";
            setRoomsError(message);
        } finally {
            setRoomActionId(null);
        }
    }

    async function handleCreateRoom(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setRoomsError("");
        setNotice("");

        const token = getToken();
        if (!token) {
            setRoomsError("Missing session token. Please sign in again.");
            return;
        }

        if (!roomFormName.trim()) {
            setRoomsError("Enter a room name before creating it.");
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
            setNotice(`Created room ${createdRoom.name}.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to create room";
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
            setRoomsError("Missing session token. Please sign in again.");
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
            setNotice(`Renamed room to ${updatedRoom.name}.`);
            setEditingRoomId(null);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to update room";
            setRoomsError(message);
        } finally {
            setRoomActionId(null);
        }
    }

    async function handleDeleteRoom(roomId: number) {
        if (!window.confirm("Are you sure you want to delete this room? Devices assigned to it will be unassigned.")) return;

        const token = getToken();
        if (!token) {
            setRoomsError("Missing session token. Please sign in again.");
            return;
        }

        setRoomActionId(roomId);
        setRoomsError("");
        setNotice("");

        try {
            await deleteRoom(roomId, token);

            setRooms((currentRooms) => currentRooms.filter((entry) => entry.room_id !== roomId));
            setNotice("Room deleted.");
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to delete room";
            setRoomsError(message);
        } finally {
            setRoomActionId(null);
        }
    }

    return (
        <div className="flex min-h-screen w-full bg-background-light text-slate-800 dark:bg-background-dark dark:text-slate-200 overflow-hidden font-sans selection:bg-primary selection:text-white">
            <Sidebar />

            <main className="flex min-w-0 flex-1 flex-col">
                <header className="px-8 pt-8 pb-4">
                    <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Settings</h2>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">Admin tools, user lifecycle, and instance notes.</p>
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
                        General
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
                            User Management
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
                            Rooms
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
                            Configs
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
                            <div className="grid gap-6">
                                {isAdmin ? (
                                    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-surface-dark">
                                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                            <div>
                                                <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">System Health</p>
                                                <h2 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">Active server metrics</h2>
                                                <p className="mt-2 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
                                                    Real-time server diagnostics covering active processes, memory limits, and localized network targets.
                                                </p>
                                            </div>
                                        </div>

                                        {networkError ? (
                                            <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                                                {networkError}
                                            </div>
                                        ) : null}

                                        {!networkError && runtimeNetwork?.warning ? (
                                            <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                                                <p className="font-semibold">Manual reflash attention</p>
                                                <p className="mt-1">{runtimeNetwork.warning}</p>
                                            </div>
                                        ) : null}

                                        {networkLoading ? (
                                            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-400">
                                                Loading system metrics...
                                            </div>
                                        ) : runtimeNetwork ? (
                                            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/80">
                                                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Server Host / IP</p>
                                                    <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">{runtimeNetwork.advertised_host}</p>
                                                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Current network boundary for devices.</p>
                                                </div>
                                                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/80">
                                                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">CPU Usage</p>
                                                    <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">{runtimeNetwork.cpu_percent.toFixed(1)}%</p>
                                                    <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200 overflow-hidden dark:bg-slate-700">
                                                        <div className={`h-full ${runtimeNetwork.cpu_percent > 80 ? 'bg-rose-500' : 'bg-primary'}`} style={{ width: `${Math.min(100, runtimeNetwork.cpu_percent)}%` }}></div>
                                                    </div>
                                                </div>
                                                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/80">
                                                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Memory Usage</p>
                                                    <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">
                                                        {(runtimeNetwork.memory_used / 1024 / 1024 / 1024).toFixed(1)} GB / {(runtimeNetwork.memory_total / 1024 / 1024 / 1024).toFixed(1)} GB
                                                    </p>
                                                    <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200 overflow-hidden dark:bg-slate-700">
                                                        <div className={`h-full ${(runtimeNetwork.memory_used / runtimeNetwork.memory_total) > 0.8 ? 'bg-rose-500' : 'bg-primary'}`} style={{ width: `${Math.min(100, (runtimeNetwork.memory_used / runtimeNetwork.memory_total) * 100)}%` }}></div>
                                                    </div>
                                                </div>
                                                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/80">
                                                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Storage Usage</p>
                                                    <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">
                                                        {(runtimeNetwork.storage_used / 1024 / 1024 / 1024).toFixed(1)} GB / {(runtimeNetwork.storage_total / 1024 / 1024 / 1024).toFixed(1)} GB
                                                    </p>
                                                    <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200 overflow-hidden dark:bg-slate-700">
                                                        <div className={`h-full ${(runtimeNetwork.storage_used / runtimeNetwork.storage_total) > 0.8 ? 'bg-rose-500' : 'bg-primary'}`} style={{ width: `${Math.min(100, (runtimeNetwork.storage_used / runtimeNetwork.storage_total) * 100)}%` }}></div>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : null}
                                    </section>
                                ) : null}
                            </div>
                        ) : null}

                        {activePanel === "users" ? (
                            isAdmin ? (
                                <div className="space-y-10">
                                    <section className="max-w-5xl">
                                        <div className="flex justify-between items-start mb-6">
                                            <div>
                                                <h3 className="text-xl font-bold dark:text-white text-slate-900">Provision a new household account</h3>
                                                <p className="text-sm text-slate-500 dark:text-slate-400">Add a new user to your IoT ecosystem and assign their role.</p>
                                            </div>
                                            {submitError ? (
                                                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300 max-w-xs text-right">
                                                    {submitError}
                                                </div>
                                            ) : null}
                                        </div>
                                        <form className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 p-6 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl" onSubmit={handleCreateUser}>
                                            <div className="flex flex-col gap-2">
                                                <label className="text-sm font-medium dark:text-slate-300 text-slate-700">Username</label>
                                                <input 
                                                    className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700/50 rounded-lg px-4 py-2.5 text-sm focus:ring-primary focus:border-primary outline-none transition-shadow text-slate-900 dark:text-white" 
                                                    placeholder="e.g. jdoe" 
                                                    type="text"
                                                    value={formState.username}
                                                    onChange={(event) => setFormState((current) => ({ ...current, username: event.target.value }))}
                                                    required
                                                    minLength={3}
                                                />
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                <label className="text-sm font-medium dark:text-slate-300 text-slate-700">Full Name</label>
                                                <input 
                                                    className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700/50 rounded-lg px-4 py-2.5 text-sm focus:ring-primary focus:border-primary outline-none transition-shadow text-slate-900 dark:text-white" 
                                                    placeholder="John Doe" 
                                                    type="text"
                                                    value={formState.fullname}
                                                    onChange={(event) => setFormState((current) => ({ ...current, fullname: event.target.value }))}
                                                    required
                                                />
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                <label className="text-sm font-medium dark:text-slate-300 text-slate-700">Initial Password</label>
                                                <input 
                                                    className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700/50 rounded-lg px-4 py-2.5 text-sm focus:ring-primary focus:border-primary outline-none transition-shadow text-slate-900 dark:text-white" 
                                                    placeholder="••••••••" 
                                                    type="password"
                                                    value={formState.password}
                                                    onChange={(event) => setFormState((current) => ({ ...current, password: event.target.value }))}
                                                    required
                                                    minLength={8}
                                                />
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                <label className="text-sm font-medium dark:text-slate-300 text-slate-700">Role Selection</label>
                                                <select 
                                                    className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700/50 rounded-lg px-4 py-2.5 text-sm focus:ring-primary focus:border-primary outline-none transition-shadow text-slate-900 dark:text-white"
                                                    value={formState.account_type}
                                                    onChange={(event) => setFormState((current) => ({ ...current, account_type: event.target.value as AccountType }))}
                                                >
                                                    <option value="parent">User</option>
                                                    <option value="admin">Admin</option>
                                                </select>
                                            </div>
                                            <div className="lg:col-span-4 flex justify-end mt-2">
                                                <button 
                                                    type="submit" 
                                                    disabled={isSubmitting}
                                                    className="bg-primary hover:bg-blue-600 text-white font-semibold py-2.5 px-6 rounded-lg text-sm shadow-lg shadow-primary/20 transition-all flex items-center gap-2 disabled:opacity-50"
                                                >
                                                    {isSubmitting ? <span className="material-icons-round text-[18px] animate-spin">refresh</span> : null}
                                                    Create Account
                                                </button>
                                            </div>
                                        </form>
                                    </section>

                                    <div className="flex flex-col gap-8 max-w-5xl">
                                        <section className="w-full">
                                            <div className="mb-4">
                                                <div className="flex justify-between items-center pr-2">
                                                    <div>
                                                        <h3 className="text-xl font-bold dark:text-white text-slate-900">Active household members</h3>
                                                        <p className="text-sm text-slate-500 dark:text-slate-400">Manage existing access controls.</p>
                                                    </div>
                                                    <button 
                                                        onClick={() => void loadManagedUsers()}
                                                        className="text-slate-500 hover:text-primary transition-colors flex items-center gap-1 text-sm font-medium"
                                                    >
                                                        <span className="material-icons-round text-lg">refresh</span> Refresh
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto w-full">
                                                <table className="w-full text-left whitespace-nowrap">
                                                    <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
                                                        <tr>
                                                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">User</th>
                                                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Role</th>
                                                            <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-right">Actions</th>
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
                                                                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">No active users yet.</p>
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
                                                                                        <span className="bg-primary/10 text-primary text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider whitespace-nowrap">You</span>
                                                                                    ) : null}
                                                                                </div>
                                                                                <p className="text-xs text-slate-500 dark:text-slate-400 truncate w-full">{managedUser.fullname}</p>
                                                                            </div>
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-6 py-4 flex gap-2 items-center">
                                                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 capitalize border border-slate-200 dark:border-slate-700">
                                                                            {formatAccountTypeLabel(managedUser.account_type)}
                                                                        </span>
                                                                        {managedUser.approval_status !== "approved" && (
                                                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize border ${managedUser.approval_status === "pending" ? "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-500 dark:border-amber-500/30" : "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30"}`}>
                                                                                {managedUser.approval_status}
                                                                            </span>
                                                                        )}
                                                                    </td>
                                                                    <td className="px-6 py-4 text-right flex justify-end gap-2">
                                                                        {managedUser.approval_status === "pending" && (
                                                                            <button 
                                                                                onClick={() => handleStatusChange(managedUser, "approve")}
                                                                                disabled={actionUserId === managedUser.user_id}
                                                                                className="text-slate-400 hover:text-emerald-500 transition-colors disabled:opacity-30 p-2 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-500/10 inline-flex items-center justify-center"
                                                                                title="Approve access"
                                                                            >
                                                                                {actionUserId === managedUser.user_id ? <span className="material-icons-round text-lg animate-spin">refresh</span> : <span className="material-icons-round text-lg">check_circle</span>}
                                                                            </button>
                                                                        )}
                                                                        {managedUser.account_type !== "admin" && managedUser.approval_status === "approved" ? (
                                                                            <button 
                                                                                onClick={() => setPromoteModalTarget(managedUser)}
                                                                                disabled={actionUserId === managedUser.user_id || managedUser.user_id === user?.user_id}
                                                                                className="text-slate-400 hover:text-blue-500 transition-colors disabled:opacity-30 p-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-500/10 inline-flex items-center justify-center"
                                                                                title="Promote to admin"
                                                                            >
                                                                                {actionUserId === managedUser.user_id ? <span className="material-icons-round text-lg animate-spin">refresh</span> : <span className="material-icons-round text-lg">arrow_upward</span>}
                                                                            </button>
                                                                        ) : null}
                                                                        {managedUser.approval_status !== "revoked" && (
                                                                            <button 
                                                                                onClick={() => setRevokeModalTarget(managedUser)}
                                                                                disabled={actionUserId === managedUser.user_id || managedUser.user_id === user?.user_id}
                                                                                className="text-slate-400 hover:text-rose-500 transition-colors disabled:opacity-30 p-2 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-500/10 inline-flex items-center justify-center"
                                                                                title="Revoke access"
                                                                            >
                                                                                {actionUserId === managedUser.user_id ? <span className="material-icons-round text-lg animate-spin">refresh</span> : <span className="material-icons-round text-lg">block</span>}
                                                                            </button>
                                                                        )}
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
                                    <h2 className="mt-5 text-2xl font-semibold text-slate-900 dark:text-white">Admin access required</h2>
                                    <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                                        This menu only appears for accounts with admin privileges. Sign in with an approved admin account such as the temporary QA account if you need to manage household users.
                                    </p>
                                </section>
                            )
                        ) : null}

                        {activePanel === "rooms" ? (
                            isAdmin ? (
                                <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
                                    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-surface-dark">
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">Create room</p>
                                                <h2 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">Provision a room boundary</h2>
                                                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                                    New rooms start private by default. Only admins retain access until you explicitly grant control to other approved household users.
                                                </p>
                                            </div>
                                            <span className="material-icons-round rounded-2xl bg-primary/10 p-3 text-2xl text-primary">meeting_room</span>
                                        </div>

                                        <form className="mt-6 space-y-5" onSubmit={handleCreateRoom}>
                                            <div>
                                                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Room name</label>
                                                <input
                                                    type="text"
                                                    value={roomFormName}
                                                    onChange={(event) => setRoomFormName(event.target.value)}
                                                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900/80 dark:text-white"
                                                    placeholder="Living room"
                                                    required
                                                />
                                            </div>

                                            <button
                                                type="submit"
                                                disabled={roomSubmitting}
                                                className="flex w-full items-center justify-center rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-70"
                                            >
                                                {roomSubmitting ? (
                                                    <span className="material-icons-round animate-spin">refresh</span>
                                                ) : (
                                                    <>
                                                        <span className="material-icons-round mr-2 text-[18px]">add_home</span>
                                                        Create Room
                                                    </>
                                                )}
                                            </button>
                                        </form>
                                    </section>

                                    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-surface-dark">
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                                <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">Access matrix</p>
                                                <h2 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">Room-level control assignments</h2>
                                                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                                    Decide exactly which approved household users may operate devices inside each room.
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => void loadRooms()}
                                                className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                                            >
                                                <span className="material-icons-round mr-2 text-[18px]">refresh</span>
                                                Refresh
                                            </button>
                                        </div>

                                        <div className="mt-6">
                                            {roomsLoading ? (
                                                <div className="flex min-h-64 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
                                                    <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                                                        <span className="material-icons-round animate-spin">refresh</span>
                                                        Loading rooms...
                                                    </div>
                                                </div>
                                            ) : rooms.length === 0 ? (
                                                <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-14 text-center dark:border-slate-700 dark:bg-slate-900/50">
                                                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                                                        <span className="material-icons-round text-3xl">meeting_room</span>
                                                    </div>
                                                    <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">No rooms created yet</h3>
                                                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                                        Create the first room on the left to start assigning device control boundaries.
                                                    </p>
                                                </div>
                                            ) : (
                                                <div className="grid gap-4">
                                                    {rooms.map((room) => {
                                                        return (
                                                            <article
                                                                key={room.room_id}
                                                                className="rounded-3xl border border-slate-200 bg-slate-50/70 p-5 transition hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-900/50 dark:hover:border-slate-600 dark:hover:bg-slate-900/80"
                                                            >
                                                                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                                                    <div className="min-w-0 flex-1">
                                                                        {editingRoomId === room.room_id ? (
                                                                            <input
                                                                                type="text"
                                                                                value={editingRoomName}
                                                                                onChange={(e) => setEditingRoomName(e.target.value)}
                                                                                autoFocus
                                                                                disabled={roomActionId === room.room_id}
                                                                                className="block w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-[15px] font-medium text-slate-900 focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10 transition-all dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:focus:border-primary"
                                                                                onKeyDown={(e) => {
                                                                                    if (e.key === "Enter") void handleUpdateRoom(room);
                                                                                    if (e.key === "Escape") setEditingRoomId(null);
                                                                                }}
                                                                            />
                                                                        ) : (
                                                                            <div className="flex flex-wrap items-center gap-2">
                                                                                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{room.name}</h3>
                                                                                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                                                                    room #{room.room_id}
                                                                                </span>
                                                                            </div>
                                                                        )}
                                                                        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                                                            Room configuration and devices assigned.
                                                                        </p>
                                                                    </div>

                                                                    <div className="flex items-center gap-2">
                                                                        {editingRoomId === room.room_id ? (
                                                                            <>
                                                                                <button
                                                                                    onClick={() => void handleUpdateRoom(room)}
                                                                                    disabled={roomActionId === room.room_id}
                                                                                    className="inline-flex h-10 items-center justify-center rounded-2xl bg-primary px-4 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-70"
                                                                                >
                                                                                    {roomActionId === room.room_id ? (
                                                                                        <span className="material-icons-round animate-spin">refresh</span>
                                                                                    ) : (
                                                                                        "Save"
                                                                                    )}
                                                                                </button>
                                                                                <button
                                                                                    onClick={() => setEditingRoomId(null)}
                                                                                    disabled={roomActionId === room.room_id}
                                                                                    className="inline-flex h-10 items-center justify-center rounded-2xl bg-slate-100 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                                                                                >
                                                                                    Cancel
                                                                                </button>
                                                                            </>
                                                                        ) : (
                                                                            <>
                                                                                <button
                                                                                    onClick={() => {
                                                                                        setEditingRoomId(room.room_id);
                                                                                        setEditingRoomName(room.name);
                                                                                    }}
                                                                                    className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                                                                                    title="Edit Room Name"
                                                                                >
                                                                                    <span className="material-icons-round text-xl">edit</span>
                                                                                </button>
                                                                                <button
                                                                                    onClick={() => void handleDeleteRoom(room.room_id)}
                                                                                    disabled={roomActionId === room.room_id}
                                                                                    className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-red-50 text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40"
                                                                                    title="Delete Room"
                                                                                >
                                                                                    {roomActionId === room.room_id ? (
                                                                                        <span className="material-icons-round animate-spin">refresh</span>
                                                                                    ) : (
                                                                                        <span className="material-icons-round text-xl">delete</span>
                                                                                    )}
                                                                                </button>
                                                                            </>
                                                                        )}
                                                                    </div>
                                                                </div>

                                                                <div className="mt-6 border-t border-slate-200 dark:border-slate-800/60 pt-5">
                                                                    <div className="mb-3 flex items-center justify-between">
                                                                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Accessible by</h4>
                                                                        <p className="text-xs text-slate-500 dark:text-slate-400">Admins always have full access</p>
                                                                    </div>
                                                                    <div className="flex flex-wrap gap-2">
                                                                        {managedUsers.filter(u => u.approval_status === "approved" && u.account_type !== "admin").length === 0 ? (
                                                                            <p className="text-sm text-slate-500 dark:text-slate-400 italic">No approved household users available.</p>
                                                                        ) : (
                                                                            managedUsers
                                                                                .filter(u => u.approval_status === "approved" && u.account_type !== "admin")
                                                                                .map(u => {
                                                                                    const isAllowed = room.allowed_user_ids?.includes(u.user_id) ?? false;
                                                                                    return (
                                                                                        <button
                                                                                            key={u.user_id}
                                                                                            onClick={() => void handleToggleRoomUser(room, u.user_id)}
                                                                                            disabled={roomActionId === room.room_id}
                                                                                            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors disabled:opacity-50 ${isAllowed ? 'bg-primary/10 border-primary/20 text-primary dark:bg-primary/20 dark:text-white hover:bg-primary/20 dark:hover:bg-primary/30' : 'bg-slate-50 border-slate-200 text-slate-600 dark:bg-slate-800/50 dark:border-slate-700/60 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                                                                                        >
                                                                                            <span className="material-icons-round text-[16px]">
                                                                                                {isAllowed ? 'check_circle' : 'radio_button_unchecked'}
                                                                                            </span>
                                                                                            {u.username}
                                                                                        </button>
                                                                                    )
                                                                                })
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </article>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    </section>
                                </div>
                            ) : (
                                <section className="rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm dark:border-slate-700 dark:bg-surface-dark">
                                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">
                                        <span className="material-icons-round text-4xl">admin_panel_settings</span>
                                    </div>
                                    <h2 className="mt-5 text-2xl font-semibold text-slate-900 dark:text-white">Admin access required</h2>
                                    <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                                        This menu only appears for accounts with admin privileges. Sign in with an approved admin account if you need to manage room boundaries and device access.
                                    </p>
                                </section>
                            )
                        ) : null}

                        {activePanel === "configs" ? (
                            <ConfigsPanel />
                        ) : null}
                    </div>
                </div>
            </main>

            {revokeModalTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-fade-in pointer-events-auto" onClick={() => setRevokeModalTarget(null)}></div>
                    <div className="flex flex-col gap-6 w-full max-w-sm pointer-events-auto z-10">
                        <div className="p-6 bg-slate-900 text-white rounded-[12px] shadow-2xl border border-slate-700 animate-scale-in">
                            <div className="flex flex-col items-center text-center">
                                <div className="w-14 h-14 flex items-center justify-center rounded-full bg-red-500/20 text-red-500 mb-4">
                                    <svg fill="none" height="28" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="28" xmlns="http://www.w3.org/2000/svg"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>
                                </div>
                                <h3 className="text-lg font-semibold">Revoke Access?</h3>
                                <p className="text-sm text-slate-400 mt-2 mb-6">Are you sure you want to revoke {revokeModalTarget.username}? Their access will be blocked immediately.</p>
                                <div className="flex w-full gap-3">
                                    <button 
                                        onClick={() => {
                                            void handleStatusChange(revokeModalTarget, "revoke");
                                            setRevokeModalTarget(null);
                                        }}
                                        className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-all"
                                    >
                                        Revoke Access
                                    </button>
                                    <button 
                                        onClick={() => setRevokeModalTarget(null)}
                                        className="flex-1 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold rounded-lg transition-all border border-slate-700"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            
            {promoteModalTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-fade-in pointer-events-auto" onClick={() => setPromoteModalTarget(null)}></div>
                    <div className="flex flex-col gap-6 w-full max-w-sm pointer-events-auto z-10">
                        <div className="p-6 bg-slate-900 text-white rounded-[12px] shadow-2xl border border-slate-700 animate-scale-in">
                            <div className="flex items-start">
                                <div className="flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-full bg-blue-500/20 text-blue-500">
                                    <svg fill="none" height="24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M20 6 9 17l-5-5"></path></svg>
                                </div>
                                <div className="ml-4 flex-1">
                                    <h3 className="text-lg font-semibold text-white">Promote to Admin?</h3>
                                    <p className="text-sm text-slate-400 mt-1 mb-6">Are you sure you want to promote {promoteModalTarget.username} to an admin? They will have full system access.</p>
                                    <div className="flex gap-3">
                                        <button 
                                            onClick={() => {
                                                void handleStatusChange(promoteModalTarget, "promote");
                                                setPromoteModalTarget(null);
                                            }}
                                            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-all"
                                        >
                                            Promote
                                        </button>
                                        <button 
                                            onClick={() => setPromoteModalTarget(null)}
                                            className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold rounded-lg transition-all border border-slate-700"
                                        >
                                            Cancel
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
