/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { DeviceHistoryEntry, fetchDeviceStateHistory } from "@/lib/api";
import { useLanguage } from "@/components/LanguageContext";

const PAGE_SIZE = 30;

type MergedEntry =
  | { kind: "state"; entry: DeviceHistoryEntry }
  | { kind: "divider"; event_type: "online" | "offline"; timestamp: string };

// Internal metadata keys — not meaningful to show as state
const SKIP_KEYS = new Set([
  "kind", "pin", "provider", "ip_address", "model",
  "color_mode", "capabilities", "reported_at", "command_id", "pins",
]);

// Priority order: most user-visible field wins
const PRIORITY_KEYS = [
  "power", "brightness", "color_temperature", "rgb",
  "speed", "temperature", "humidity", "value",
];

const CHANGE_LABEL: Record<string, string> = {
  power: "Power",
  brightness: "Brightness",
  color_temperature: "Color Temp",
  rgb: "Color",
  speed: "Speed",
  temperature: "Temperature",
  humidity: "Humidity",
  value: "Value",
};

function formatStateValue(key: string, val: unknown): string {
  if (key === "brightness") return `${val}%`;
  if (key === "color_temperature") return `${val}K`;
  if (key === "power") {
    const s = String(val).toLowerCase();
    return s === "on" ? "On" : s === "off" ? "Off" : String(val);
  }
  if (key === "rgb" && typeof val === "object" && val !== null) {
    const { r = 0, g = 0, b = 0 } = val as { r: number; g: number; b: number };
    return `R${r} G${g} B${b}`;
  }
  if (key === "temperature") return `${val}°`;
  if (key === "humidity") return `${val}%`;
  return String(val);
}

function extractPrimary(raw: string): {
  label: string;
  display: string;
  isPower: boolean;
  powerOn: boolean;
} {
  try {
    const obj = JSON.parse(raw);
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
      return { label: "—", display: "—", isPower: false, powerOn: false };
    }
    for (const key of PRIORITY_KEYS) {
      if (key in obj) {
        const val = obj[key];
        const isPower = key === "power";
        return {
          label: CHANGE_LABEL[key] ?? key,
          display: formatStateValue(key, val),
          isPower,
          powerOn: isPower && String(val).toLowerCase() === "on",
        };
      }
    }
    // Fallback: first non-skip key
    for (const [k, v] of Object.entries(obj)) {
      if (!SKIP_KEYS.has(k)) {
        return {
          label: CHANGE_LABEL[k] ?? k,
          display: String(v),
          isPower: false,
          powerOn: false,
        };
      }
    }
  } catch {
    // not JSON
  }
  return { label: "—", display: "—", isPower: false, powerOn: false };
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts.endsWith("Z") ? ts : ts + "Z");
    return d.toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return ts;
  }
}

function mergeEntries(
  stateEntries: DeviceHistoryEntry[],
  dividerEntries: DeviceHistoryEntry[]
): MergedEntry[] {
  const dividers: MergedEntry[] = dividerEntries
    .filter((e) => e.event_type === "online" || e.event_type === "offline")
    .map((e) => ({
      kind: "divider" as const,
      event_type: e.event_type as "online" | "offline",
      timestamp: e.timestamp,
    }));

  const states: MergedEntry[] = stateEntries.map((e) => ({
    kind: "state" as const,
    entry: e,
  }));

  return [...states, ...dividers].sort((a, b) => {
    const ta = a.kind === "state" ? a.entry.timestamp : a.timestamp;
    const tb = b.kind === "state" ? b.entry.timestamp : b.timestamp;
    return (
      new Date(tb.endsWith("Z") ? tb : tb + "Z").getTime() -
      new Date(ta.endsWith("Z") ? ta : ta + "Z").getTime()
    );
  });
}

export interface StateHistoryModalProps {
  deviceId: string;
  deviceName: string;
  onClose: () => void;
}

export function StateHistoryModal({
  deviceId,
  deviceName,
  onClose,
}: StateHistoryModalProps) {
  const { t } = useLanguage();
  const [stateRows, setStateRows] = useState<DeviceHistoryEntry[]>([]);
  const [connRows, setConnRows] = useState<DeviceHistoryEntry[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const loadPage = useCallback(
    async (nextOffset: number) => {
      setLoading(true);
      setError(null);
      try {
        const [stateData, connData] = await Promise.all([
          fetchDeviceStateHistory(deviceId, {
            event_type: "state_change",
            limit: PAGE_SIZE,
            offset: nextOffset,
          }),
          nextOffset === 0
            ? fetchDeviceStateHistory(deviceId, { limit: 200 })
            : Promise.resolve(null),
        ]);
        setStateRows((prev) => (nextOffset === 0 ? stateData : [...prev, ...stateData]));
        if (connData !== null) {
          setConnRows(
            connData.filter((e) => e.event_type === "online" || e.event_type === "offline")
          );
        }
        setHasMore(stateData.length === PAGE_SIZE);
        setOffset(nextOffset + stateData.length);
      } catch {
        setError(t("devices.history.error"));
      } finally {
        setLoading(false);
      }
    },
    [deviceId, t]
  );

  useEffect(() => {
    loadPage(0);
  }, [loadPage]);

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose();
  };

  const merged = mergeEntries(stateRows, connRows);

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={handleBackdrop}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
              {t("devices.history.title")}
            </p>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white truncate max-w-[260px]">
              {deviceName}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <span className="material-icons-round text-[20px]">close</span>
          </button>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-[120px_1fr_1fr] gap-x-4 px-5 py-2 shrink-0 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
          <span className="text-[10px] uppercase tracking-widest font-semibold text-slate-400">
            {t("devices.history.time")}
          </span>
          <span className="text-[10px] uppercase tracking-widest font-semibold text-slate-400">
            {t("devices.history.change_type")}
          </span>
          <span className="text-[10px] uppercase tracking-widest font-semibold text-slate-400">
            {t("devices.history.new_state")}
          </span>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-2 divide-y divide-slate-50 dark:divide-slate-800/50">
          {loading && stateRows.length === 0 && (
            <div className="flex items-center justify-center py-10 text-sm text-slate-400">
              <span className="material-icons-round animate-spin text-[18px] mr-2">sync</span>
              {t("devices.history.loading")}
            </div>
          )}

          {!loading && error && stateRows.length === 0 && (
            <div className="flex items-center justify-center py-10 text-sm text-red-500 gap-2">
              <span className="material-icons-round text-[18px]">error_outline</span>
              {error}
            </div>
          )}

          {!loading && !error && merged.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-400">
              <span className="material-icons-round text-[32px]">history</span>
              <span className="text-sm">{t("devices.history.no_data")}</span>
            </div>
          )}

          {merged.map((item, idx) => {
            if (item.kind === "divider") {
              const isOffline = item.event_type === "offline";
              return (
                <div
                  key={`divider-${item.timestamp}-${idx}`}
                  className="flex items-center gap-2 py-2 my-1"
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      isOffline ? "bg-red-400" : "bg-green-400"
                    }`}
                  />
                  <span className="text-[10px] uppercase tracking-widest font-semibold text-slate-400 flex-1">
                    {isOffline
                      ? t("devices.history.divider_offline")
                      : t("devices.history.divider_online")}
                  </span>
                  <span className="text-[10px] text-slate-300 dark:text-slate-600 shrink-0">
                    {formatTimestamp(item.timestamp)}
                  </span>
                </div>
              );
            }

            const { entry } = item;
            const { label, display, isPower, powerOn } = extractPrimary(entry.payload ?? "");

            return (
              <div
                key={entry.id}
                className="grid grid-cols-[120px_1fr_1fr] gap-x-4 py-2.5 items-center"
              >
                <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums leading-tight">
                  {formatTimestamp(entry.timestamp)}
                </span>

                <span className="text-[12px] font-medium text-slate-600 dark:text-slate-300 truncate">
                  {label}
                </span>

                {isPower ? (
                  <span
                    className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full w-fit ${
                      powerOn
                        ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                        : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        powerOn ? "bg-green-500" : "bg-slate-400"
                      }`}
                    />
                    {display}
                  </span>
                ) : (
                  <span className="text-[12px] font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                    {display}
                  </span>
                )}
              </div>
            );
          })}

          {hasMore && stateRows.length > 0 && (
            <div className="flex justify-center py-3">
              <button
                onClick={() => loadPage(offset)}
                disabled={loading}
                className="text-xs font-medium px-4 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                {loading ? (
                  <span className="material-icons-round animate-spin text-[14px]">sync</span>
                ) : (
                  <span className="material-icons-round text-[14px]">expand_more</span>
                )}
                {t("devices.history.load_more")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
