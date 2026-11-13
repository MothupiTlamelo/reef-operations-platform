import type { Notification } from "@reef/shared";
import { api } from "@/lib/api";

/** One cache entry for the bell, so every screen shares the same list and unread count. */
export const NOTIFICATIONS_KEY = ["notifications", "bell"] as const;

/** How often the bell asks for new reminders while the tab is open. */
export const NOTIFICATIONS_POLL_MS = 60_000;

export async function fetchNotifications(limit = 20): Promise<Notification[]> {
  const res = await api<Notification[]>(`/api/v1/notifications?limit=${limit}`);
  return res.data;
}

export async function markNotificationRead(id: string): Promise<void> {
  await api<{ read: boolean }>(`/api/v1/notifications/${encodeURIComponent(id)}/read`, {
    method: "PATCH",
  });
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "just now", "5 minutes ago", "yesterday", "3 days ago". Falls back to a date after a month. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const seconds = Math.round((then.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), "hour");
  if (abs < 30 * 86_400) return relative.format(Math.round(seconds / 86_400), "day");
  return then.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}
