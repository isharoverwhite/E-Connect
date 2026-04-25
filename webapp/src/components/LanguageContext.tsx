/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { fetchCurrentUser, updateUserLanguage } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { translations, LanguageCode, TranslationKey } from "@/lib/i18n";

export type { LanguageCode, TranslationKey };

interface LanguageContextType {
    language: LanguageCode;
    setLanguage: (lang: LanguageCode) => void;
    t: (key: TranslationKey | string, fallback?: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

function getTextNodes(node: Node): Text[] {
    const textNodes: Text[] = [];
    if (node.nodeType === Node.TEXT_NODE) {
        if (node.nodeValue && node.nodeValue.trim().length > 0) {
            textNodes.push(node as Text);
        }
    } else {
        const nodeName = node.nodeName.toUpperCase();
        // Skip elements that typically contain code, icons, or non-visible text
        if (["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "TITLE", "SVG", "I", "CANVAS", "VIDEO", "AUDIO", "TEXTAREA", "INPUT", "SELECT"].includes(nodeName)) {
            return textNodes;
        }
        
        // Skip elements that are likely icon containers
        const element = node as Element;
        if (element.getAttribute) {
            const className = element.getAttribute("class") || "";
            const lowerClass = className.toLowerCase();
            if (lowerClass.includes("icon") || lowerClass.includes("lucide")) {
                return textNodes;
            }
        }

        for (let i = 0; i < node.childNodes.length; i++) {
            textNodes.push(...getTextNodes(node.childNodes[i]));
        }
    }
    return textNodes;
}

// Global state for the scramble animation loop
let scrambleActive = false;
let scrambleNodes: {
    node: Text;
    targetText: string;
    sequences: string[][];
    frame: number;
}[] = [];

const UPPER_ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER_ALPHA = "abcdefghijklmnopqrstuvwxyz";
const NUMBERS = "0123456789";

function getCharSequence(targetChar: string, charIndex: number): string[] {
    if (!targetChar.trim()) return [targetChar];
    
    // Keep emojis and complex characters unchanged
    if (targetChar.length > 1) {
        return [targetChar];
    }
    // Match common emoji and icon Unicode blocks
    if (/[\u2600-\u27BF\u2B50\u2B55\u23E9-\u23F3\u23F8-\u23FA]/.test(targetChar)) {
        return [targetChar];
    }
    
    let alpha = UPPER_ALPHA;
    
    // Check casing to keep scramble visually consistent
    if (targetChar.toUpperCase() === targetChar.toLowerCase()) {
        if (/[0-9]/.test(targetChar)) {
            alpha = NUMBERS;
        } else {
            // It's punctuation or a symbol (e.g. '-', '.', ',')
            return [targetChar];
        }
    } else if (targetChar === targetChar.toLowerCase()) {
        alpha = LOWER_ALPHA;
    } else {
        alpha = UPPER_ALPHA;
    }

    const seq: string[] = [];
    
    let targetIdx = alpha.indexOf(targetChar);
    if (targetIdx === -1) {
        targetIdx = 0; // fallback if target is not in A-Z (e.g., Vietnamese letters)
    }
    
    // Base frames plus stagger to create a left-to-right sweep
    const stagger = Math.min(20, charIndex);
    const totalFrames = 10 + stagger;
    
    for (let i = 0; i < totalFrames - 1; i++) {
        const distanceToTarget = totalFrames - 1 - i;
        const charIdx = ((targetIdx - distanceToTarget) % alpha.length + alpha.length) % alpha.length;
        seq.push(alpha[charIdx]);
    }
    seq.push(targetChar);
    
    return seq;
}

function triggerGlobalScramble() {
    const nodes = getTextNodes(document.body);
    
    nodes.forEach(node => {
        let currentText = node.nodeValue || "";
        if (!currentText.trim()) return;

        const anyNode = node as Node & { _isScrambling?: boolean; _targetText?: string; _lastScrambledText?: string };
        
        if (anyNode._isScrambling) {
            // Already scrambling. Did React update it?
            if (anyNode._lastScrambledText !== currentText) {
                // React updated it! Use the NEW text as the target!
                anyNode._targetText = currentText;
            } else {
                // React didn't update it, keep the existing target
                currentText = anyNode._targetText || currentText;
            }
        }

        anyNode._isScrambling = true;
        anyNode._targetText = currentText;
        anyNode._lastScrambledText = currentText;
        
        // Remove existing entry if any
        scrambleNodes = scrambleNodes.filter(n => n.node !== node);
        
        // Use Array.from to correctly iterate over Unicode characters including emojis
        const chars = Array.from(currentText);
        const charSequences: string[][] = [];
        for (let i = 0; i < chars.length; i++) {
            charSequences.push(getCharSequence(chars[i], i));
        }

        scrambleNodes.push({
            node,
            targetText: currentText,
            sequences: charSequences,
            frame: 0
        });
    });

    if (!scrambleActive && scrambleNodes.length > 0) {
        scrambleActive = true;
        let lastTime = performance.now();
        
        const loop = (time: number) => {
            if (!scrambleActive) return;
            
            // Limit frame rate to ~33fps (30ms) for smoother scrambling
            if (time - lastTime < 30) {
                requestAnimationFrame(loop);
                return;
            }
            lastTime = time;

            scrambleNodes = scrambleNodes.filter(item => {
                const { node, targetText, sequences, frame } = item;
                const anyNode = node as Node & { _isScrambling?: boolean; _lastScrambledText?: string };
                
                if (!node.isConnected) {
                    anyNode._isScrambling = false;
                    return false;
                }

                // If the DOM was modified by React since our last frame, abort!
                if (node.nodeValue !== anyNode._lastScrambledText) {
                    anyNode._isScrambling = false;
                    return false;
                }

                let allFinished = true;
                const newText = sequences.map(seq => {
                    if (frame < seq.length - 1) {
                        allFinished = false;
                        return seq[frame];
                    }
                    return seq[seq.length - 1];
                }).join("");
                    
                node.nodeValue = newText;
                anyNode._lastScrambledText = newText;

                if (allFinished) {
                    node.nodeValue = targetText;
                    anyNode._lastScrambledText = targetText;
                    anyNode._isScrambling = false;
                    return false; // remove from queue
                }

                item.frame += 1;
                return true; // keep in queue
            });

            if (scrambleNodes.length > 0) {
                requestAnimationFrame(loop);
            } else {
                scrambleActive = false;
            }
        };
        requestAnimationFrame(loop);
    }
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
    const [language, setLanguageState] = useState<LanguageCode>("en");
    const [isInitialized, setIsInitialized] = useState(false);
    const prevLanguage = useRef<LanguageCode | null>(null);

    useEffect(() => {
        const initializeLanguage = async () => {
            try {
                let userLanguage: LanguageCode | null = null;
                const token = getToken();

                if (token) {
                    try {
                        const user = await fetchCurrentUser(token);
                        if (user && user.language && (user.language === "en" || user.language === "vi")) {
                            userLanguage = user.language as LanguageCode;
                        }
                    } catch (err) {
                        console.warn("Failed to fetch user language preference (unauthorized or network error)");
                    }
                }

                if (userLanguage) {
                    setLanguageState(userLanguage);
                    localStorage.setItem("app_language", userLanguage);
                    setIsInitialized(true);
                    return;
                }

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

    useEffect(() => {
        const handleProfileLoaded = (event: Event) => {
            const customEvent = event as CustomEvent;
            const profile = customEvent.detail;
            if (profile && profile.language && (profile.language === "en" || profile.language === "vi")) {
                setLanguageState(profile.language);
                localStorage.setItem("app_language", profile.language);
            }
        };

        window.addEventListener('auth-profile-loaded', handleProfileLoaded);
        return () => window.removeEventListener('auth-profile-loaded', handleProfileLoaded);
    }, []);

    useEffect(() => {
        if (!isInitialized) return;
        if (prevLanguage.current && prevLanguage.current !== language) {
            triggerGlobalScramble();
        }
        prevLanguage.current = language;
    }, [language, isInitialized]);

    const setLanguage = async (lang: LanguageCode) => {
        setLanguageState(lang);
        localStorage.setItem("app_language", lang);

        const token = getToken();
        if (token) {
            try {
                await updateUserLanguage(lang, token);
            } catch (err) {
                console.error("Failed to update user language preference", err);
            }
        }
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

