/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

'use client';

import { useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';
import { fetchWifiCredentials } from '@/lib/wifi-credentials';
import Link from 'next/link';

export default function WifiWarningBanner() {
    const { user } = useAuth();
    const [hasWifi, setHasWifi] = useState<boolean | null>(true);

    useEffect(() => {
        let mounted = true;

        async function checkWifi() {
            // Only check if user is logged in
            if (!user) {
                if (mounted) setHasWifi(true);
                return;
            }

            try {
                const credentials = await fetchWifiCredentials();
                if (mounted) {
                    setHasWifi(credentials.length > 0);
                }
            } catch {
                // Silently ignore errors (e.g., token expired, network down)
            }
        }

        void checkWifi();

        // Periodically check every 5 seconds
        const interval = setInterval(checkWifi, 5000);
        return () => {
            mounted = false;
            clearInterval(interval);
        };
    }, [user]);

    if (hasWifi !== false) {
        return null;
    }

    return (
        <Link 
            href="/settings"
            className="flex-shrink-0 bg-[linear-gradient(45deg,#d97706_25%,#f59e0b_25%,#f59e0b_50%,#d97706_50%,#d97706_75%,#f59e0b_75%,#f59e0b_100%)] bg-[length:40px_40px] animate-stripe-slide text-white text-sm font-medium py-1.5 px-4 flex items-center justify-center shadow-md z-[100] w-full animate-in slide-in-from-top-2 border-b-2 border-amber-700 hover:brightness-110 transition-all cursor-pointer"
        >
            <span className="material-icons-round text-[18px] mr-2">wifi_off</span>
            <span>No Wi-Fi network configured. Click here to configure your network settings to allow devices to connect.</span>
        </Link>
    );
}
