'use client';

import { useAuth } from '@/components/AuthProvider';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Sidebar() {
    const { user, logout } = useAuth();
    const pathname = usePathname();

    const formatAccountTypeLabel = (type: string | undefined) => {
        switch (type) {
            case 'admin':
                return 'Master Node';
            case 'support':
                return 'Tech Ops';
            case 'member':
            default:
                return 'Local Node';
        }
    };

    const navItems = [
        { href: '/', icon: 'dashboard', label: 'Dashboard' },
        { href: '/devices', icon: 'devices_other', label: 'Devices' },
        { href: '/automation', icon: 'precision_manufacturing', label: 'Automation' },
        { href: '/logs', icon: 'analytics', label: 'Logs & Stats' },
        { href: '/extensions', icon: 'extension', label: 'Extensions' },
    ];

    const getLinkClass = (href: string) => {
        const isActive = pathname === href;
        return isActive
            ? "flex items-center rounded-lg bg-primary/10 px-4 py-3 font-medium text-primary transition-colors"
            : "flex items-center rounded-lg px-4 py-3 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white";
    };

    return (
        <aside className="z-20 hidden w-64 flex-col justify-between border-r border-slate-200 bg-surface-light shadow-lg dark:border-slate-700 dark:bg-surface-dark md:flex shrink-0">
            <div>
                <div className="flex h-16 items-center border-b border-slate-200 px-6 dark:border-slate-700">
                    <span className="material-icons-round mr-2 text-3xl text-primary">hub</span>
                    <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">E-Connect</span>
                </div>

                <nav className="space-y-1 p-4">
                    {navItems.map((item) => (
                        <Link key={item.href} href={item.href} className={getLinkClass(item.href)}>
                            <span className="material-icons-round mr-3">{item.icon}</span>
                            {item.label}
                        </Link>
                    ))}
                </nav>
            </div>

            <div className="border-t border-slate-200 p-4 dark:border-slate-700">
                <Link href="/settings" className={`${getLinkClass('/settings')} mb-2`}>
                    <span className="material-icons-round mr-3">settings</span>
                    Settings
                </Link>
                <div className="group flex items-center justify-between px-4 py-3">
                    <div className="flex items-center min-w-0 pr-2">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-primary to-purple-500 text-xs font-bold uppercase text-white">
                            {user?.fullname?.substring(0, 2) || "EC"}
                        </div>
                        <div className="ml-3 min-w-0 relative group/profile flex-1">
                            <div className="relative">
                                <p className="text-sm font-medium leading-tight truncate text-slate-900 dark:text-white">
                                    {user?.fullname || "E-Connect User"}
                                </p>
                                {(user?.fullname || "E-Connect User").length > 10 && (
                                    <p className="text-sm font-medium leading-tight absolute top-0 left-0 bg-surface-light dark:bg-surface-dark z-[100] opacity-0 group-hover/profile:opacity-100 transition-opacity whitespace-nowrap overflow-visible w-max pr-2 pointer-events-none text-slate-900 dark:text-white">
                                        {user?.fullname || "E-Connect User"}
                                    </p>
                                )}
                            </div>
                            <p className="mt-0.5 text-xs capitalize text-slate-500 dark:text-slate-400 truncate">{formatAccountTypeLabel(user?.account_type)}</p>
                        </div>
                    </div>
                    <button
                        onClick={logout}
                        className="rounded-md p-2 text-slate-400 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-red-500/10 shrink-0"
                        title="Logout"
                    >
                        <span className="material-icons-round text-[18px]">logout</span>
                    </button>
                </div>
            </div>
        </aside>
    );
}
