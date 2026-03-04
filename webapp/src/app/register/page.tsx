"use client";

import Link from "next/link";

export default function RegisterPage() {
    return (
        <div className="min-h-screen bg-background-light dark:bg-background-dark flex items-center justify-center p-4">
            <div className="bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700/50 rounded-2xl p-8 w-full max-w-md shadow-xl text-center">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                    <span className="material-icons-round text-primary text-3xl">person_add_disabled</span>
                </div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Registration Is Restricted</h1>
                <p className="text-slate-500 dark:text-slate-400 text-sm mb-8">
                    Household members are created by an administrator after the server has been initialized.
                </p>
                <Link
                    href="/login"
                    className="inline-flex items-center justify-center bg-primary hover:bg-blue-600 text-white font-medium px-5 py-2.5 rounded-xl transition shadow-sm hover:shadow shadow-primary/20"
                >
                    Back To Login
                </Link>
            </div>
        </div>
    );
}
