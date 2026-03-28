"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { loginUser, setToken } from "@/lib/auth";
import { useRouter } from "next/navigation";

export default function LoginPage() {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [keepLogin, setKeepLogin] = useState(false);
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const { refreshProfile } = useAuth();
    const router = useRouter();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setIsLoading(true);

        try {
            const formData = new FormData();
            formData.append("username", username);
            formData.append("password", password);
            formData.append("keep_login", keepLogin ? "true" : "false");

            const data = await loginUser(formData);
            setToken(data);
            await refreshProfile();
            router.push("/");
        } catch (error: unknown) {
            setError(error instanceof Error ? error.message : "Failed to login");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-background-light dark:bg-background-dark flex items-center justify-center p-4">
            <div className="bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700/50 rounded-2xl p-8 w-full max-w-md shadow-xl flex flex-col items-center">

                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-6">
                    <span className="material-icons-round text-primary text-3xl">home_iot_device</span>
                </div>

                <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Welcome Back</h1>
                <p className="text-slate-500 dark:text-slate-400 text-sm mb-8 text-center">Log in to E-Connect to manage your smart ecosystem.</p>

                {error && (
                    <div className="w-full bg-red-500/10 border border-red-500/50 text-red-500 text-sm rounded-lg p-3 mb-6 flex items-center">
                        <span className="material-icons-round mr-2 text-[18px]">error_outline</span>
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="w-full space-y-5">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Username</label>
                        <div className="relative">
                            <span className="material-icons-round absolute left-3 top-2.5 text-slate-400 text-[20px]">person</span>
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="w-full bg-white dark:bg-black/20 border border-slate-300 dark:border-slate-700 rounded-xl py-2.5 pl-10 pr-4 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                                placeholder="Enter your username"
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <div className="flex justify-between items-center mb-1.5">
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Password</label>
                        </div>
                        <div className="relative">
                            <span className="material-icons-round absolute left-3 top-2.5 text-slate-400 text-[20px]">lock</span>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-white dark:bg-black/20 border border-slate-300 dark:border-slate-700 rounded-xl py-2.5 pl-10 pr-4 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                                placeholder="••••••••"
                                required
                            />
                        </div>
                    </div>

                    <label className="flex items-start gap-3 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-slate-50/80 dark:bg-black/20 px-4 py-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={keepLogin}
                            onChange={(e) => setKeepLogin(e.target.checked)}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                        />
                        <span className="text-sm text-slate-600 dark:text-slate-300">
                            <span className="block font-medium text-slate-800 dark:text-slate-100">Keep login</span>
                            <span className="block text-xs text-slate-500 dark:text-slate-400">
                                Leave this unchecked to auto-logout after 4 hours without interaction.
                            </span>
                        </span>
                    </label>

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full bg-primary hover:bg-blue-600 text-white font-medium py-2.5 rounded-xl transition shadow-sm hover:shadow shadow-primary/20 flex justify-center items-center mt-4 disabled:opacity-70"
                    >
                        {isLoading ? (
                            <span className="material-icons-round animate-spin">refresh</span>
                        ) : (
                            "Sign In"
                        )}
                    </button>
                </form>

            </div>
        </div>
    );
}
