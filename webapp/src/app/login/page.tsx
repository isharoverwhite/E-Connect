/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { loginUser, setToken } from "@/lib/auth";
import { useRouter } from "next/navigation";

export default function LoginPage() {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
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
                    <span className="material-icons-round text-primary text-3xl">home</span>
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
                                type={showPassword ? "text" : "password"}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-white dark:bg-black/20 border border-slate-300 dark:border-slate-700 rounded-xl py-2.5 pl-10 pr-10 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                                placeholder="••••••••"
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors focus:outline-none"
                                aria-label={showPassword ? "Hide password" : "Show password"}
                                tabIndex={-1}
                            >
                                <span className="material-icons-round text-[20px]">
                                    {showPassword ? "visibility_off" : "visibility"}
                                </span>
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 cursor-pointer group">
                            <input
                                type="checkbox"
                                checked={keepLogin}
                                onChange={(e) => setKeepLogin(e.target.checked)}
                                className="w-4 h-4 rounded appearance-none border border-slate-300 dark:border-slate-600 checked:bg-primary checked:border-primary relative
                                before:content-[''] before:absolute before:inset-0 before:bg-[url('data:image/svg+xml;charset=UTF-8,%3csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22white%22 stroke-width=%223%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3e%3cpolyline points=%2220 6 9 17 4 12%22/%3e%3c/svg%3e')]
                                before:scale-0 checked:before:scale-75 before:transition-transform before:duration-200 before:ease-out
                                transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30"
                            />
                            <span className="text-sm text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-slate-200 transition-colors">
                                Keep me logged in
                            </span>
                        </label>
                    </div>

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
