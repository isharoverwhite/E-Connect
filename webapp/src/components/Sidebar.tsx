'use client';

import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Sidebar() {
    const { user, logout } = useAuth();
    const pathname = usePathname();
    const [isCollapsed, setIsCollapsed] = useState(false);

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
        return `${isActive
            ? "bg-primary/10 font-medium text-primary"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white"
            } flex items-center rounded-lg px-4 py-3 transition-colors ${isCollapsed ? 'justify-center mx-2' : ''}`;
    };

    return (
        <aside className={`z-20 hidden flex-col justify-between border-r border-slate-200 bg-surface-light shadow-lg transition-all duration-300 dark:border-slate-700 dark:bg-surface-dark md:flex shrink-0 ${isCollapsed ? 'w-24' : 'w-64'}`}>
            <div>
                <div className={`flex items-center border-b border-slate-200 dark:border-slate-700 overflow-hidden whitespace-nowrap transition-all duration-300 ${isCollapsed ? 'flex-col justify-center py-3 gap-3 h-[90px]' : 'justify-between px-4 h-16'}`}>
                    <div className="flex items-center">
                        <span className="material-icons-round text-3xl text-primary flex-shrink-0">hub</span>
                        {!isCollapsed && <span className="ml-2 text-xl font-bold tracking-tight text-slate-900 dark:text-white transition-opacity duration-300">E-Connect</span>}
                    </div>
                    <button
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        className="flex shrink-0 items-center justify-center rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white"
                        title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
                    >
                        <span className="material-icons-round text-[20px]">
                            {isCollapsed ? 'keyboard_double_arrow_right' : 'keyboard_double_arrow_left'}
                        </span>
                    </button>
                </div>

                <nav className={`space-y-1 ${isCollapsed ? 'py-4 px-0' : 'p-4'}`}>
                    {navItems.map((item) => (
                        <Link key={item.href} href={item.href} className={getLinkClass(item.href)} title={isCollapsed ? item.label : undefined}>
                            <span className="material-icons-round flex-shrink-0">{item.icon}</span>
                            {!isCollapsed && <span className="ml-3 transition-opacity duration-300 whitespace-nowrap">{item.label}</span>}
                        </Link>
                    ))}
                </nav>
            </div>

            <div className={`border-t border-slate-200 ${isCollapsed ? 'py-4 px-0' : 'p-4'} dark:border-slate-700 space-y-2`}>
                <Link href="/settings" className={getLinkClass('/settings')} title={isCollapsed ? "Settings" : undefined}>
                    <span className="material-icons-round flex-shrink-0">settings</span>
                    {!isCollapsed && <span className="ml-3 transition-opacity duration-300 whitespace-nowrap">Settings</span>}
                </Link>

                <div className={`group flex ${isCollapsed ? 'flex-col gap-3 justify-center items-center mt-2' : 'items-center justify-between'} px-4 py-3`}>
                    <div className={`flex items-center min-w-0 ${isCollapsed ? 'justify-center pr-0' : 'pr-2'}`}>
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-primary to-purple-500 text-xs font-bold uppercase text-white" title={isCollapsed ? (user?.fullname || "E-Connect User") : undefined}>
                            {user?.fullname?.substring(0, 2) || "EC"}
                        </div>
                        {!isCollapsed && (
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
                        )}
                    </div>
                    <button
                        onClick={logout}
                        className={`rounded-md p-2 text-slate-400 transition-all hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 shrink-0 ${isCollapsed ? 'opacity-100 block mt-2' : 'opacity-0 group-hover:opacity-100'}`}
                        title="Logout"
                    >
                        <span className="material-icons-round text-[18px]">logout</span>
                    </button>
                </div>
            </div>
        </aside>
    );
}
