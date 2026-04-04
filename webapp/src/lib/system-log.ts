import type { SystemLogEntry } from "@/lib/api";

export function isSystemLogAlertEntry(entry: Pick<SystemLogEntry, "severity">): boolean {
    return entry.severity !== "info";
}
