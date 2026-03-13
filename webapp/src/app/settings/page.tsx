"use client";

import { FormEvent, useEffect, useEffectEvent, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import {
    ManagedUser,
    adminCreateUser,
    approveManagedUser,
    fetchManagedUsers,
    getToken,
    revokeManagedUser,
} from "@/lib/auth";
import {
    RoomRecord,
    createRoom,
    fetchRooms,
    updateRoomAccess,
} from "@/lib/rooms";

type SettingsPanel = "general" | "users" | "rooms";
type AccountType = ManagedUser["account_type"];

const TEMP_ACCOUNT = {
    username: "ryzen30xx",
    password: "[REDACTED_PASSWORD]",
};

const statusStyles: Record<string, string> = {
    approved: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
    pending: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
    revoked: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300",
};

const roleStyles: Record<string, string> = {
    admin: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300",
    parent: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300",
    child: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-200",
};

const householdRoleStyles: Record<string, string> = {
    owner: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-500/30 dark:bg-fuchsia-500/10 dark:text-fuchsia-300",
    admin: "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-300",
    member: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-200",
    guest: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-200",
};

function formatTimestamp(value?: string | null) {
    if (!value) {
        return "Just provisioned";
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return "Recently updated";
    }

    return parsed.toLocaleString();
}

export default function SettingsPage() {
    const { user, logout } = useAuth();
    const isAdmin = user?.account_type === "admin";

    const [activePanel, setActivePanel] = useState<SettingsPanel>(isAdmin ? "users" : "general");
    const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
    const [usersLoading, setUsersLoading] = useState(true);
    const [usersError, setUsersError] = useState("");
    const [rooms, setRooms] = useState<RoomRecord[]>([]);
    const [roomsLoading, setRoomsLoading] = useState(true);
    const [roomsError, setRoomsError] = useState("");
    const [roomFormName, setRoomFormName] = useState("");
    const [roomAssignments, setRoomAssignments] = useState<number[]>([]);
    const [roomAssignmentDrafts, setRoomAssignmentDrafts] = useState<Record<number, number[]>>({});
    const [roomSubmitting, setRoomSubmitting] = useState(false);
    const [roomActionId, setRoomActionId] = useState<number | null>(null);
    const [notice, setNotice] = useState("");
    const [submitError, setSubmitError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [actionUserId, setActionUserId] = useState<number | null>(null);
    const [formState, setFormState] = useState({
        fullname: "",
        username: "",
        password: "",
        account_type: "parent" as AccountType,
    });
    const assignableUsers = managedUsers.filter(
        (managedUser) => managedUser.approval_status === "approved" && managedUser.user_id !== user?.user_id,
    );

    useEffect(() => {
        setActivePanel(isAdmin ? "users" : "general");
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
            setRoomAssignmentDrafts(
                Object.fromEntries(
                    data.map((room) => [room.room_id, room.assigned_user_ids ?? room.allowed_user_ids ?? []]),
                ),
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to load rooms";
            setRoomsError(message);
        } finally {
            setRoomsLoading(false);
        }
    }

    const loadManagedUsersForEffect = useEffectEvent(() => {
        void loadManagedUsers();
    });

    const loadRoomsForEffect = useEffectEvent(() => {
        void loadRooms();
    });

    useEffect(() => {
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
                account_type: "parent",
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

    async function handleStatusChange(targetUser: ManagedUser, action: "approve" | "revoke") {
        const token = getToken();
        if (!token) {
            setUsersError("Missing session token. Please sign in again.");
            return;
        }

        setActionUserId(targetUser.user_id);
        setUsersError("");
        setNotice("");

        try {
            const updatedUser =
                action === "approve"
                    ? await approveManagedUser(targetUser.user_id, token)
                    : await revokeManagedUser(targetUser.user_id, token);

            setManagedUsers((currentUsers) =>
                currentUsers.map((entry) => (entry.user_id === updatedUser.user_id ? updatedUser : entry)),
            );
            setNotice(
                action === "approve"
                    ? `Approved ${updatedUser.username}.`
                    : `Revoked ${updatedUser.username}. Existing access is blocked immediately.`,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : `Failed to ${action} user`;
            setUsersError(message);
        } finally {
            setActionUserId(null);
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
                    allowed_user_ids: roomAssignments,
                },
                token,
            );

            setRooms((currentRooms) =>
                [...currentRooms, createdRoom].sort((left, right) => left.name.localeCompare(right.name)),
            );
            setRoomAssignmentDrafts((currentDrafts) => ({
                ...currentDrafts,
                [createdRoom.room_id]: createdRoom.assigned_user_ids ?? createdRoom.allowed_user_ids ?? [],
            }));
            setRoomFormName("");
            setRoomAssignments([]);
            setNotice(`Created room ${createdRoom.name}. Other users stay blocked until access is granted.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to create room";
            setRoomsError(message);
        } finally {
            setRoomSubmitting(false);
        }
    }

    async function handleSaveRoomAccess(room: RoomRecord) {
        const token = getToken();
        if (!token) {
            setRoomsError("Missing session token. Please sign in again.");
            return;
        }

        setRoomActionId(room.room_id);
        setRoomsError("");
        setNotice("");

        try {
            const updatedRoom = await updateRoomAccess(
                room.room_id,
                roomAssignmentDrafts[room.room_id] ?? [],
                token,
            );

            setRooms((currentRooms) =>
                currentRooms.map((entry) => (entry.room_id === updatedRoom.room_id ? updatedRoom : entry)),
            );
            setRoomAssignmentDrafts((currentDrafts) => ({
                ...currentDrafts,
                [updatedRoom.room_id]: updatedRoom.assigned_user_ids ?? updatedRoom.allowed_user_ids ?? [],
            }));
            setNotice(`Updated access for ${updatedRoom.name}.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to update room access";
            setRoomsError(message);
        } finally {
            setRoomActionId(null);
        }
    }

    return (
        <div className="flex min-h-screen w-full bg-background-light text-slate-800 dark:bg-background-dark dark:text-slate-200 overflow-hidden font-sans selection:bg-primary selection:text-white">
            <aside className="hidden w-64 flex-col justify-between border-r border-slate-200 bg-surface-light shadow-lg dark:border-slate-700 dark:bg-surface-dark md:flex">
                <div>
                    <div className="flex h-16 items-center border-b border-slate-200 px-6 dark:border-slate-700">
                        <span className="material-icons-round mr-2 text-3xl text-primary">hub</span>
                        <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">E-Connect</span>
                    </div>

                    <nav className="space-y-1 p-4">
                        <Link href="/" className="flex items-center rounded-lg px-4 py-3 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white">
                            <span className="material-icons-round mr-3">dashboard</span>
                            Dashboard
                        </Link>
                        <Link href="/devices" className="flex items-center rounded-lg px-4 py-3 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white">
                            <span className="material-icons-round mr-3">devices_other</span>
                            Devices
                        </Link>
                        <Link href="/automation" className="flex items-center rounded-lg px-4 py-3 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white">
                            <span className="material-icons-round mr-3">precision_manufacturing</span>
                            Automation
                        </Link>
                        <Link href="/logs" className="flex items-center rounded-lg px-4 py-3 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white">
                            <span className="material-icons-round mr-3">analytics</span>
                            Logs & Stats
                        </Link>
                        <Link href="/extensions" className="flex items-center rounded-lg px-4 py-3 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white">
                            <span className="material-icons-round mr-3">extension</span>
                            Extensions
                        </Link>
                    </nav>
                </div>

                <div className="border-t border-slate-200 p-4 dark:border-slate-700">
                    <Link href="/settings" className="mb-2 flex items-center rounded-lg bg-primary/10 px-4 py-3 font-medium text-primary transition-colors">
                        <span className="material-icons-round mr-3">settings</span>
                        Settings
                    </Link>
                    <div className="group flex items-center justify-between px-4 py-3">
                        <div className="flex items-center">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-tr from-primary to-cyan-500 text-xs font-bold uppercase text-white">
                                {user?.fullname?.substring(0, 2) || "EC"}
                            </div>
                            <div className="ml-3">
                                <p className="text-sm font-medium text-slate-900 dark:text-white">{user?.fullname || "E-Connect User"}</p>
                                <p className="text-xs capitalize text-slate-500 dark:text-slate-400">{user?.account_type || "member"}</p>
                            </div>
                        </div>
                        <button
                            onClick={logout}
                            className="rounded-md p-2 text-slate-400 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-red-500/10"
                            title="Logout"
                        >
                            <span className="material-icons-round text-[18px]">logout</span>
                        </button>
                    </div>
                </div>
            </aside>

            <main className="flex min-w-0 flex-1 flex-col">
                <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-surface-light px-6 shadow-sm dark:border-slate-700 dark:bg-surface-dark">
                    <div>
                        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Settings</h1>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Admin tools, user lifecycle, and instance notes.</p>
                    </div>
                    <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900/80">
                        <button
                            onClick={() => setActivePanel("general")}
                            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                                activePanel === "general"
                                    ? "bg-primary text-white shadow-sm"
                                    : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                            }`}
                        >
                            General
                        </button>
                        {isAdmin ? (
                            <button
                                onClick={() => setActivePanel("users")}
                                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                                    activePanel === "users"
                                        ? "bg-primary text-white shadow-sm"
                                        : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                                }`}
                            >
                                User Management
                            </button>
                        ) : null}
                        {isAdmin ? (
                            <button
                                onClick={() => setActivePanel("rooms")}
                                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                                    activePanel === "rooms"
                                        ? "bg-primary text-white shadow-sm"
                                        : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                                }`}
                            >
                                Rooms
                            </button>
                        ) : null}
                    </div>
                </header>

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
                            <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
                                <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-surface-dark">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">Instance</p>
                                            <h2 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">Operational baseline for this deployment</h2>
                                        </div>
                                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-right dark:border-slate-700 dark:bg-slate-900/80">
                                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Current session</p>
                                            <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{user?.username || "unknown"}</p>
                                            <p className="text-xs capitalize text-slate-500 dark:text-slate-400">{user?.account_type || "member"}</p>
                                        </div>
                                    </div>

                                    <div className="mt-6 grid gap-4 md:grid-cols-3">
                                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/80">
                                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Admin-only menu</p>
                                            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                                                User lifecycle controls only render for `account_type=admin` and are enforced again by backend role checks.
                                            </p>
                                        </div>
                                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/80">
                                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Approval lifecycle</p>
                                            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                                                New users start in `pending`, can be switched to `approved`, and `revoked` accounts are blocked at login and on authenticated routes.
                                            </p>
                                        </div>
                                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/80">
                                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Temporary note</p>
                                            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                                                PRD has been updated with the seeded QA account so future agents know this instance intentionally carries a temporary hardcoded credential.
                                            </p>
                                        </div>
                                    </div>
                                </section>

                                <section className="rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-900 via-slate-900 to-cyan-950 p-6 text-white shadow-sm dark:border-slate-700">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-xs uppercase tracking-[0.2em] text-cyan-200/80">Seeded QA Admin</p>
                                            <h2 className="mt-2 text-2xl font-semibold">Temporary support account</h2>
                                        </div>
                                        <span className="material-icons-round text-4xl text-cyan-200/80">admin_panel_settings</span>
                                    </div>
                                    <div className="mt-6 space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
                                        <div className="flex items-center justify-between gap-3 text-sm">
                                            <span className="text-cyan-100/80">Username</span>
                                            <code className="rounded-full bg-white/10 px-3 py-1 font-semibold">{TEMP_ACCOUNT.username}</code>
                                        </div>
                                        <div className="flex items-center justify-between gap-3 text-sm">
                                            <span className="text-cyan-100/80">Password</span>
                                            <code className="rounded-full bg-white/10 px-3 py-1 font-semibold">{TEMP_ACCOUNT.password}</code>
                                        </div>
                                    </div>
                                    <p className="mt-4 text-sm leading-6 text-cyan-50/85">
                                        This account is reseeded by the backend for temporary QA support and should be removed once the testing window closes.
                                    </p>
                                </section>
                            </div>
                        ) : null}

                        {activePanel === "users" ? (
                            isAdmin ? (
                                <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
                                    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-surface-dark">
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">Create user</p>
                                                <h2 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">Provision a new household account</h2>
                                                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                                    Accounts are created in `pending` state so approval is explicit and auditable.
                                                </p>
                                            </div>
                                            <span className="material-icons-round rounded-2xl bg-primary/10 p-3 text-2xl text-primary">person_add</span>
                                        </div>

                                        {submitError ? (
                                            <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                                                {submitError}
                                            </div>
                                        ) : null}

                                        <form className="mt-6 space-y-5" onSubmit={handleCreateUser}>
                                            <div>
                                                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Full name</label>
                                                <input
                                                    type="text"
                                                    value={formState.fullname}
                                                    onChange={(event) =>
                                                        setFormState((current) => ({ ...current, fullname: event.target.value }))
                                                    }
                                                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900/80 dark:text-white"
                                                    placeholder="Nguyen Van Admin"
                                                    required
                                                />
                                            </div>

                                            <div className="grid gap-4 sm:grid-cols-2">
                                                <div>
                                                    <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Username</label>
                                                    <input
                                                        type="text"
                                                        value={formState.username}
                                                        onChange={(event) =>
                                                            setFormState((current) => ({ ...current, username: event.target.value }))
                                                        }
                                                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900/80 dark:text-white"
                                                        placeholder="newmember"
                                                        required
                                                        minLength={3}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Account type</label>
                                                    <select
                                                        value={formState.account_type}
                                                        onChange={(event) =>
                                                            setFormState((current) => ({
                                                                ...current,
                                                                account_type: event.target.value as AccountType,
                                                            }))
                                                        }
                                                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900/80 dark:text-white"
                                                    >
                                                        <option value="parent">Parent</option>
                                                        <option value="child">Child</option>
                                                        <option value="admin">Admin</option>
                                                    </select>
                                                </div>
                                            </div>

                                            <div>
                                                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Temporary password</label>
                                                <input
                                                    type="password"
                                                    value={formState.password}
                                                    onChange={(event) =>
                                                        setFormState((current) => ({ ...current, password: event.target.value }))
                                                    }
                                                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-900/80 dark:text-white"
                                                    placeholder="At least 8 characters"
                                                    required
                                                    minLength={8}
                                                />
                                            </div>

                                            <button
                                                type="submit"
                                                disabled={isSubmitting}
                                                className="flex w-full items-center justify-center rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-70"
                                            >
                                                {isSubmitting ? (
                                                    <span className="material-icons-round animate-spin">refresh</span>
                                                ) : (
                                                    <>
                                                        <span className="material-icons-round mr-2 text-[18px]">person_add</span>
                                                        Create Pending User
                                                    </>
                                                )}
                                            </button>
                                        </form>
                                    </section>

                                    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-surface-dark">
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                                <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">Directory</p>
                                                <h2 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">Household user approvals</h2>
                                                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                                    Approve new accounts before login, or revoke existing access without deleting history.
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => void loadManagedUsers()}
                                                className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                                            >
                                                <span className="material-icons-round mr-2 text-[18px]">refresh</span>
                                                Refresh
                                            </button>
                                        </div>

                                        <div className="mt-6">
                                            {usersLoading ? (
                                                <div className="flex min-h-64 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
                                                    <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                                                        <span className="material-icons-round animate-spin">refresh</span>
                                                        Loading managed users...
                                                    </div>
                                                </div>
                                            ) : managedUsers.length === 0 ? (
                                                <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-14 text-center dark:border-slate-700 dark:bg-slate-900/50">
                                                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                                                        <span className="material-icons-round text-3xl">group</span>
                                                    </div>
                                                    <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">No users in this household yet</h3>
                                                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                                        Create the first additional user on the left, then approve them here.
                                                    </p>
                                                </div>
                                            ) : (
                                                <div className="grid gap-4">
                                                    {managedUsers.map((managedUser) => {
                                                        const statusClass =
                                                            statusStyles[managedUser.approval_status] || statusStyles.pending;
                                                        const accountClass =
                                                            roleStyles[managedUser.account_type] || roleStyles.child;
                                                        const householdRoleClass =
                                                            householdRoleStyles[managedUser.household_role || "member"] ||
                                                            householdRoleStyles.member;
                                                        const isSelf = managedUser.user_id === user?.user_id;

                                                        return (
                                                            <article
                                                                key={managedUser.user_id}
                                                                className="rounded-3xl border border-slate-200 bg-slate-50/70 p-5 transition hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-900/50 dark:hover:border-slate-600 dark:hover:bg-slate-900/80"
                                                            >
                                                                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                                                    <div className="min-w-0">
                                                                        <div className="flex flex-wrap items-center gap-2">
                                                                            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                                                                                {managedUser.fullname}
                                                                            </h3>
                                                                            <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${statusClass}`}>
                                                                                {managedUser.approval_status}
                                                                            </span>
                                                                            <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${accountClass}`}>
                                                                                {managedUser.account_type}
                                                                            </span>
                                                                            {managedUser.household_role ? (
                                                                                <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${householdRoleClass}`}>
                                                                                    {managedUser.household_role}
                                                                                </span>
                                                                            ) : null}
                                                                            {isSelf ? (
                                                                                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                                                                    current session
                                                                                </span>
                                                                            ) : null}
                                                                        </div>
                                                                        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                                                            @{managedUser.username}
                                                                        </p>
                                                                        <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                                                                            Created {formatTimestamp(managedUser.created_at)}
                                                                        </p>
                                                                    </div>

                                                                    <div className="flex flex-wrap gap-2">
                                                                        {managedUser.approval_status !== "approved" ? (
                                                                            <button
                                                                                onClick={() => void handleStatusChange(managedUser, "approve")}
                                                                                disabled={actionUserId === managedUser.user_id}
                                                                                className="inline-flex items-center rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-70"
                                                                            >
                                                                                {actionUserId === managedUser.user_id ? (
                                                                                    <span className="material-icons-round animate-spin">refresh</span>
                                                                                ) : (
                                                                                    <>
                                                                                        <span className="material-icons-round mr-2 text-[18px]">verified_user</span>
                                                                                        Approve
                                                                                    </>
                                                                                )}
                                                                            </button>
                                                                        ) : null}
                                                                        <button
                                                                            onClick={() => void handleStatusChange(managedUser, "revoke")}
                                                                            disabled={actionUserId === managedUser.user_id || isSelf}
                                                                            className="inline-flex items-center rounded-2xl border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/30 dark:bg-slate-900/70 dark:text-rose-300 dark:hover:bg-rose-500/10"
                                                                        >
                                                                            {actionUserId === managedUser.user_id ? (
                                                                                <span className="material-icons-round animate-spin">refresh</span>
                                                                            ) : (
                                                                                <>
                                                                                    <span className="material-icons-round mr-2 text-[18px]">block</span>
                                                                                    Revoke
                                                                                </>
                                                                            )}
                                                                        </button>
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

                                            <div>
                                                <p className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-300">Initial room access</p>
                                                {assignableUsers.length === 0 ? (
                                                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
                                                        Approve additional users first if you want to grant room control during creation.
                                                    </div>
                                                ) : (
                                                    <div className="grid gap-3">
                                                        {assignableUsers.map((managedUser) => {
                                                            const checked = roomAssignments.includes(managedUser.user_id);
                                                            return (
                                                                <label
                                                                    key={managedUser.user_id}
                                                                    className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900/50"
                                                                >
                                                                    <div>
                                                                        <p className="font-medium text-slate-900 dark:text-white">{managedUser.fullname}</p>
                                                                        <p className="text-xs text-slate-500 dark:text-slate-400">@{managedUser.username}</p>
                                                                    </div>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={checked}
                                                                        onChange={() =>
                                                                            setRoomAssignments((currentAssignments) =>
                                                                                checked
                                                                                    ? currentAssignments.filter((userId) => userId !== managedUser.user_id)
                                                                                    : [...currentAssignments, managedUser.user_id],
                                                                            )
                                                                        }
                                                                        className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                                                                    />
                                                                </label>
                                                            );
                                                        })}
                                                    </div>
                                                )}
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
                                                        const selectedAssignments = roomAssignmentDrafts[room.room_id] ?? [];
                                                        return (
                                                            <article
                                                                key={room.room_id}
                                                                className="rounded-3xl border border-slate-200 bg-slate-50/70 p-5 transition hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-900/50 dark:hover:border-slate-600 dark:hover:bg-slate-900/80"
                                                            >
                                                                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                                                    <div className="min-w-0">
                                                                        <div className="flex flex-wrap items-center gap-2">
                                                                            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{room.name}</h3>
                                                                            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                                                                room #{room.room_id}
                                                                            </span>
                                                                        </div>
                                                                        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                                                            Users without an explicit grant cannot control devices assigned to this room.
                                                                        </p>
                                                                    </div>

                                                                    <button
                                                                        onClick={() => void handleSaveRoomAccess(room)}
                                                                        disabled={roomActionId === room.room_id}
                                                                        className="inline-flex items-center rounded-2xl bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-70"
                                                                    >
                                                                        {roomActionId === room.room_id ? (
                                                                            <span className="material-icons-round animate-spin">refresh</span>
                                                                        ) : (
                                                                            <>
                                                                                <span className="material-icons-round mr-2 text-[18px]">save</span>
                                                                                Save access
                                                                            </>
                                                                        )}
                                                                    </button>
                                                                </div>

                                                                <div className="mt-5 grid gap-3">
                                                                    {assignableUsers.length === 0 ? (
                                                                        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
                                                                            No approved non-admin users are available for room assignment yet.
                                                                        </div>
                                                                    ) : (
                                                                        assignableUsers.map((managedUser) => {
                                                                            const checked = selectedAssignments.includes(managedUser.user_id);
                                                                            return (
                                                                                <label
                                                                                    key={`${room.room_id}-${managedUser.user_id}`}
                                                                                    className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900/50"
                                                                                >
                                                                                    <div>
                                                                                        <p className="font-medium text-slate-900 dark:text-white">{managedUser.fullname}</p>
                                                                                        <p className="text-xs text-slate-500 dark:text-slate-400">@{managedUser.username}</p>
                                                                                    </div>
                                                                                    <input
                                                                                        type="checkbox"
                                                                                        checked={checked}
                                                                                        onChange={() =>
                                                                                            setRoomAssignmentDrafts((currentDrafts) => ({
                                                                                                ...currentDrafts,
                                                                                                [room.room_id]: checked
                                                                                                    ? selectedAssignments.filter((userId) => userId !== managedUser.user_id)
                                                                                                    : [...selectedAssignments, managedUser.user_id],
                                                                                            }))
                                                                                        }
                                                                                        className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                                                                                    />
                                                                                </label>
                                                                            );
                                                                        })
                                                                    )}
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
                    </div>
                </div>
            </main>
        </div>
    );
}
