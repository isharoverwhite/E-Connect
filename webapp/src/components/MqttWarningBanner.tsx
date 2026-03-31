'use client';

import { useEffect, useState } from 'react';

export default function MqttWarningBanner() {
    const [mqttStatus, setMqttStatus] = useState<'connected' | 'disconnected' | 'unknown'>('connected');

    useEffect(() => {
        let mounted = true;

        async function checkHealth() {
            try {
                let healthUrl = '/health';
                if (typeof window !== 'undefined') {
                    const apiBase = process.env.NEXT_PUBLIC_API_URL || '';
                    if (apiBase.startsWith('http')) {
                        const url = new URL(apiBase);
                        healthUrl = `${url.protocol}//${url.host}/health`;
                    }
                }

                const res = await fetch(healthUrl, { cache: 'no-store' });
                if (res.ok || res.status === 503) {
                    const data = await res.json();
                    if (mounted && data.mqtt) {
                        setMqttStatus(data.mqtt);
                    }
                }
            } catch (_error) {
                // Silently ignore fetch errors (e.g., network down) to avoid spamming console
            }
        }

        // Check immediately on mount
        void checkHealth();

        // Then poll every 5 seconds
        const interval = setInterval(checkHealth, 5000);
        return () => {
            mounted = false;
            clearInterval(interval);
        };
    }, []);

    if (mqttStatus !== 'disconnected') {
        return null;
    }

    return (
        <div className="flex-shrink-0 bg-[linear-gradient(45deg,#991b1b_25%,#ef4444_25%,#ef4444_50%,#991b1b_50%,#991b1b_75%,#ef4444_75%,#ef4444_100%)] bg-[length:40px_40px] animate-stripe-slide text-white text-sm font-medium py-1.5 px-4 flex items-center justify-center shadow-md z-[100] w-full animate-in slide-in-from-top-2 border-b-2 border-red-900">
            <span className="material-icons-round text-[18px] mr-2">link_off</span>
            <span>MQTT Broker is disconnected. Real-time updates and device controls are currently unavailable. Please check your network and broker settings.</span>
        </div>
    );
}
