/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';

import { useLanguage } from '@/components/LanguageContext';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Sidebar() {
    const { user, logout } = useAuth();
    const { t } = useLanguage();
    const pathname = usePathname();
    const [isCollapsed, setIsCollapsed] = useState(() => {
        if (typeof window !== 'undefined') {
            const stored = localStorage.getItem('sidebarCollapsed');
            if (stored !== null) return stored === 'true';
        }
        return false;
    });

    const [isHovered, setIsHovered] = useState(false);
    const [hoverToExpandSetting, setHoverToExpandSetting] = useState(true);
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768);
        checkMobile();
        window.addEventListener('resize', checkMobile);

        const loadSetting = () => {
            if (typeof window !== 'undefined') {
                const stored = localStorage.getItem('hoverToExpandSidebar');
                if (stored !== null) setHoverToExpandSetting(stored === 'true');
            }
        };
        loadSetting();
        // Sync setting changes from other pages (like Settings)
        window.addEventListener('sidebarHoverSettingChanged', loadSetting);
        return () => {
            window.removeEventListener('sidebarHoverSettingChanged', loadSetting);
            window.removeEventListener('resize', checkMobile);
        };
    }, []);

    const isEffectivelyCollapsed = isMobile || (isCollapsed && (!hoverToExpandSetting || !isHovered));

    const toggleSidebar = () => {
        setIsCollapsed(prev => {
            const next = !prev;
            localStorage.setItem('sidebarCollapsed', String(next));
            return next;
        });
    };

    const formatAccountTypeLabel = (type: string | undefined) => {
        switch (type) {
            case 'admin':
                return t('sidebar.role.admin');
            case 'support':
                return t('sidebar.role.support');
            case 'member':
            default:
                return t('sidebar.role.member');
        }
    };

    const navItems = [
        { href: '/', icon: 'dashboard', label: t('sidebar.nav.dashboard') },
        { href: '/devices', icon: 'devices_other', label: t('sidebar.nav.devices') },
        { href: '/automation', icon: 'account_tree', label: t('sidebar.nav.automation') },
        { href: '/logs', icon: 'analytics', label: t('sidebar.nav.logs') },
        { href: '/extensions', icon: 'extension', label: t('sidebar.nav.extensions') },
    ];

    const getLinkClass = (href: string) => {
        const isActive = pathname === href;
        return `${isActive
            ? "bg-primary/10 font-medium text-primary"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white"
            } flex items-center rounded-lg transition-colors overflow-hidden mx-3 my-1 relative`;
    };

    return (
        <aside
            onMouseEnter={() => !isMobile && setIsHovered(true)}
            onMouseLeave={() => !isMobile && setIsHovered(false)}
            className={`z-20 flex flex-col justify-between border-r border-slate-200 bg-surface-light shadow-lg transition-all duration-300 dark:border-slate-700 dark:bg-surface-dark shrink-0 sticky top-0 h-[100dvh] overflow-hidden ${isEffectivelyCollapsed ? 'w-20' : 'w-64'}`}
        >
            <div className="flex flex-col w-full">
                {/* Header Logo & Toggle */}
                <div className="relative flex items-center h-16 border-b border-slate-200 dark:border-slate-700 overflow-hidden shrink-0 w-full">
                    {/* Logo */}
                    <div className={`flex items-center w-[256px] px-5 transition-all duration-300 ${isEffectivelyCollapsed ? '-translate-x-12 opacity-0 pointer-events-none' : 'translate-x-0 opacity-100'}`}>
                        <span className="material-icons-round text-3xl text-primary flex-shrink-0">hub</span>
                        <span className="ml-2 text-xl font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap">E-Connect</span>
                    </div>

                    {/* Toggle Button */}
                    <div className={`absolute top-0 bottom-0 right-0 flex items-center justify-center transition-all duration-300 ${isEffectivelyCollapsed ? 'w-20' : 'w-16'}`}>
                        <button
                            onClick={toggleSidebar}
                            className={`flex shrink-0 items-center justify-center rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white ${isMobile ? 'hidden' : ''}`}
                            title={isEffectivelyCollapsed ? t('sidebar.action.expand') : (isCollapsed ? t('sidebar.action.pin') : t('sidebar.action.collapse'))}
                        >
                            <span className="material-icons-round text-[20px]">
                                {isCollapsed ? 'keyboard_double_arrow_right' : 'keyboard_double_arrow_left'}
                            </span>
                        </button>
                    </div>
                </div>

                {/* Navigation Items */}
                <nav className="py-4 flex flex-col gap-1 w-full overflow-hidden">
                    {navItems.map((item) => (
                        <Link key={item.href} href={item.href} className={getLinkClass(item.href)} title={isEffectivelyCollapsed ? item.label : undefined}>
                            <div className={`flex h-11 shrink-0 items-center justify-center transition-all duration-300 ${isEffectivelyCollapsed ? 'w-14' : 'w-12'}`}>
                                <span className="material-icons-round text-[24px]">{item.icon}</span>
                            </div>
                            <span className={`transition-all duration-300 whitespace-nowrap ${isEffectivelyCollapsed ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'}`}>
                                {item.label}
                            </span>
                        </Link>
                    ))}
                </nav>
            </div>

            {/* Bottom Actions */}
            <div className="border-t border-slate-200 dark:border-slate-700 py-4 flex flex-col gap-1 w-full overflow-hidden shrink-0">
                <Link href="/settings" className={getLinkClass('/settings')} title={isEffectivelyCollapsed ? t('sidebar.nav.settings') : undefined}>
                    <div className={`flex h-11 shrink-0 items-center justify-center transition-all duration-300 ${isEffectivelyCollapsed ? 'w-14' : 'w-12'}`}>
                        <span className="material-icons-round text-[24px]">settings</span>
                    </div>
                    <span className={`transition-all duration-300 whitespace-nowrap ${isEffectivelyCollapsed ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'}`}>
                        {t('sidebar.nav.settings')}
                    </span>
                </Link>

                <div className={`group flex items-center mx-3 my-1 rounded-lg transition-all duration-300 overflow-hidden relative ${isEffectivelyCollapsed ? 'h-11' : 'h-16'}`}>
                    <div className={`flex shrink-0 items-center justify-center transition-all duration-300 ${isEffectivelyCollapsed ? 'w-14' : 'w-12'}`}>
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-tr from-primary to-purple-500 text-xs font-bold uppercase text-white" title={isEffectivelyCollapsed ? (user?.fullname || t('sidebar.user.default')) : undefined}>
                            {user?.fullname?.substring(0, 2) || "EC"}
                        </div>
                    </div>
                    
                    <div className={`flex-1 min-w-0 transition-all duration-300 overflow-hidden ${isEffectivelyCollapsed ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'}`}>
                        <div className="relative">
                            <p className="text-sm font-medium leading-tight truncate text-slate-900 dark:text-white">
                                {user?.fullname || t('sidebar.user.default')}
                            </p>
                            {(user?.fullname || t('sidebar.user.default')).length > 10 && !isEffectivelyCollapsed && (
                                <p className="text-sm font-medium leading-tight absolute top-0 left-0 bg-surface-light dark:bg-surface-dark z-[100] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap overflow-visible w-max pr-2 pointer-events-none text-slate-900 dark:text-white">
                                    {user?.fullname || t('sidebar.user.default')}
                                </p>
                            )}
                        </div>
                        <p className="mt-0.5 text-xs capitalize text-slate-500 dark:text-slate-400 truncate">{formatAccountTypeLabel(user?.account_type)}</p>
                    </div>

                    <div className={`absolute right-2 flex shrink-0 items-center justify-center transition-all duration-300 ${isEffectivelyCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-0 group-hover:opacity-100'}`}>
                        <button
                            onClick={logout}
                            className="rounded-md p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                            title={t('sidebar.action.logout')}
                        >
                            <span className="material-icons-round text-[18px]">logout</span>
                        </button>
                    </div>
                </div>
            </div>
        </aside>
    );
}
