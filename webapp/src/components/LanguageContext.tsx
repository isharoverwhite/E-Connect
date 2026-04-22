/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { translations, LanguageCode, TranslationKey } from "@/lib/i18n";
export type { LanguageCode, TranslationKey };

interface LanguageContextType {
    language: LanguageCode;
    setLanguage: (lang: LanguageCode) => void;
    t: (key: TranslationKey | string, fallback?: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
    const [language, setLanguageState] = useState<LanguageCode>("en");
    const [isInitialized, setIsInitialized] = useState(false);

    useEffect(() => {
        const initializeLanguage = async () => {
            try {
                // Check if user has a saved preference
                const savedLanguage = localStorage.getItem("app_language") as LanguageCode;
                if (savedLanguage && (savedLanguage === "en" || savedLanguage === "vi")) {
                    setLanguageState(savedLanguage);
                    setIsInitialized(true);
                    return;
                }

                // If no saved preference, try to detect via IP
                const response = await fetch("https://ipapi.co/json/");
                const data = await response.json();

                if (data.country_code === "VN") {
                    setLanguageState("vi");
                    localStorage.setItem("app_language", "vi");
                } else {
                    setLanguageState("en");
                    localStorage.setItem("app_language", "en");
                }
            } catch (error) {
                console.error("Failed to detect language from IP:", error);
                // Fallback to English
                setLanguageState("en");
                localStorage.setItem("app_language", "en");
            } finally {
                setIsInitialized(true);
            }
        };

        initializeLanguage();
    }, []);

    const setLanguage = (lang: LanguageCode) => {
        setLanguageState(lang);
        localStorage.setItem("app_language", lang);
    };

    const t = (key: TranslationKey | string, fallback?: string): string => {
        const dict = translations[language] as Record<string, string>;
        return dict[key] || fallback || key;
    };

    // Prevent hydration mismatch by not rendering children until language is initialized
    // or we can render children and they might flash, but a short delay is usually okay.
    // For a smoother experience without flashing, we just render children, they'll use English initially, 
    // but the effect runs very quickly.
    
    return (
        <LanguageContext.Provider value={{ language, setLanguage, t }}>
            {children}
        </LanguageContext.Provider>
    );
}

export function useLanguage() {
    const context = useContext(LanguageContext);
    if (context === undefined) {
        throw new Error("useLanguage must be used within a LanguageProvider");
    }
    return context;
}
