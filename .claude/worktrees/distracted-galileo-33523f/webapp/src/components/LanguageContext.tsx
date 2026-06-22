/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import React, { createContext, useContext, useState, useEffect, useLayoutEffect, useRef } from "react";
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
            // Skip wrapper spans injected by our own splitText animation
            if (element.getAttribute("data-split-wrapper")) {
                return textNodes;
            }
        }

        for (let i = 0; i < node.childNodes.length; i++) {
            textNodes.push(...getTextNodes(node.childNodes[i]));
        }
    }
    return textNodes;
}
// ─── splitText-style animation (anime.js inspired) ───────────────────────────
// Each text node is wrapped in a clip container and its characters are split
// into individual <span> elements that slide in from below (or above) with a
// staggered delay, exactly like animejs.com/documentation/text/splittext.

const CHAR_DURATION_MS = 420;       // duration of a single char slide
const CHAR_STAGGER_MS  = 18;        // delay added per char index
const EASE_OUT_EXPO = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

const oldTextsByParent = new Map<Element, string[]>();

function captureOldTexts() {
    oldTextsByParent.clear();
    const nodes = getTextNodes(document.body);
    nodes.forEach(node => {
        if (node.parentElement) {
            if (!oldTextsByParent.has(node.parentElement)) {
                oldTextsByParent.set(node.parentElement, []);
            }
            oldTextsByParent.get(node.parentElement)!.push(node.nodeValue || "");
        }
    });
}

/** Wraps a single text node with a splitText animation. */
function animateSplitTextNode(node: Text, targetText: string, oldText: string) {
    if (!node.isConnected || !targetText.trim()) return;

    const parent = node.parentElement;
    if (!parent) return;

    // Build a wrapper that clips the characters.
    // Must be inline-block (not inline) so overflow:hidden actually clips children.
    const wrapper = document.createElement("span");
    wrapper.style.cssText =
        "display:inline-block; overflow:hidden; vertical-align:bottom; max-width:100%; position:relative;";
    wrapper.setAttribute("data-split-wrapper", "1");

    const newChars = Array.from(targetText);
    const oldChars = Array.from(oldText || targetText); // fallback to target if no old text

    newChars.forEach((ch, i) => {
        if (ch === " ") {
            wrapper.appendChild(document.createTextNode(" "));
            return;
        }

        const oldCh = i < oldChars.length ? oldChars[i] : "";

        // Per-character clip container (overflow:hidden + inline-block)
        const clip = document.createElement("span");
        clip.style.cssText =
            "display:inline-block; overflow:hidden; vertical-align:bottom; position:relative;";

        const spanOld = document.createElement("span");
        spanOld.textContent = oldCh;
        spanOld.style.cssText = "display:inline-block; position:absolute; left:0; top:0; will-change:transform, opacity; z-index:1;";

        const spanNew = document.createElement("span");
        spanNew.textContent = ch;
        spanNew.style.cssText = "display:inline-block; will-change:transform; position:relative; z-index:2;";

        // Initial positions for slot machine
        spanNew.style.transform = `translateY(-100%)`;
        spanOld.style.transform = `translateY(0%)`;

        clip.appendChild(spanOld);
        clip.appendChild(spanNew);
        wrapper.appendChild(clip);

        // Kick off the animation with stagger
        const delay = i * CHAR_STAGGER_MS;
        const start = performance.now() + delay;

        const animate = (now: number) => {
            if (!spanNew.isConnected) return;
            const elapsed = Math.max(0, now - start);
            if (elapsed <= 0) {
                requestAnimationFrame(animate);
                return;
            }
            const progress = Math.min(elapsed / CHAR_DURATION_MS, 1);
            const eased = EASE_OUT_EXPO(progress);
            
            const currentNewY = -100 * (1 - eased);
            const currentOldY = 100 * eased;

            spanNew.style.transform = `translateY(${currentNewY.toFixed(2)}%)`;
            spanOld.style.transform = `translateY(${currentOldY.toFixed(2)}%)`;
            spanOld.style.opacity = `${1 - eased}`;

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                spanNew.style.transform = "translateY(0%)";
                spanOld.style.transform = "translateY(100%)";
                spanOld.style.opacity = "0";
            }
        };
        requestAnimationFrame(animate);
    });

    // Replace the text node with our animated wrapper
    parent.replaceChild(wrapper, node);

    // After the longest animation finishes, unwrap back to plain text so
    // React's reconciler doesn't encounter unexpected DOM structure.
    const totalDuration = CHAR_DURATION_MS + newChars.length * CHAR_STAGGER_MS + 80;
    setTimeout(() => {
        if (wrapper.isConnected) {
            const plain = document.createTextNode(targetText);
            wrapper.parentElement?.replaceChild(plain, wrapper);
        }
    }, totalDuration);
}

function triggerGlobalScramble() {
    const nodes = getTextNodes(document.body);
    nodes.forEach(node => {
        const text = node.nodeValue || "";
        if (!text.trim()) return;

        let oldText = "";
        if (node.parentElement && oldTextsByParent.has(node.parentElement)) {
            const arr = oldTextsByParent.get(node.parentElement)!;
            if (arr.length > 0) {
                oldText = arr.shift()!;
            }
        }

        animateSplitTextNode(node, text, oldText);
    });
    oldTextsByParent.clear();
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
                captureOldTexts();
                setLanguageState(profile.language);
                localStorage.setItem("app_language", profile.language);
            }
        };

        window.addEventListener('auth-profile-loaded', handleProfileLoaded);
        return () => window.removeEventListener('auth-profile-loaded', handleProfileLoaded);
    }, []);

    // useLayoutEffect fires BEFORE the browser paints — this ensures the char
    // wrappers are inserted and initial translateY is set before anything is
    // rendered to screen, preventing new-language text from flashing at position 0
    // then sliding in (the overlap the user sees with useEffect).
    useLayoutEffect(() => {
        if (!isInitialized) return;
        if (prevLanguage.current && prevLanguage.current !== language) {
            triggerGlobalScramble();
        }
        prevLanguage.current = language;
    }, [language, isInitialized]);

    const setLanguage = async (lang: LanguageCode) => {
        captureOldTexts();
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

