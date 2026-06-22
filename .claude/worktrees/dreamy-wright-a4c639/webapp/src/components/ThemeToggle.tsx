/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import { useTheme } from "next-themes";
import { useLanguage } from "@/components/LanguageContext";

export function ThemeToggle({ isCollapsed }: { isCollapsed?: boolean }) {
  const { theme, setTheme } = useTheme();
  const { t } = useLanguage();

  const toggleTheme = () => {
    if (theme === "light") setTheme("dark");
    else if (theme === "dark") setTheme("system");
    else setTheme("light");
  };

  const getIcon = () => {
    if (theme === "light") return "light_mode";
    if (theme === "dark") return "dark_mode";
    return "brightness_auto";
  };

  const getLabel = () => {
    if (theme === "light") return t("settings.appearance.theme.light");
    if (theme === "dark") return t("settings.appearance.theme.dark");
    return t("settings.appearance.theme.system");
  };

  return (
    <button
      onClick={toggleTheme}
      suppressHydrationWarning
      className={`flex items-center text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white rounded-lg px-4 py-3 transition-colors ${
        isCollapsed ? "justify-center mx-2" : "w-full"
      }`}
      title={isCollapsed ? getLabel() : undefined}
    >
      <span suppressHydrationWarning className="material-icons-round flex-shrink-0 text-[24px]">{getIcon()}</span>
      {!isCollapsed && (
        <span suppressHydrationWarning className="ml-3 transition-opacity duration-300 whitespace-nowrap">
          {getLabel()}
        </span>
      )}
    </button>
  );
}
