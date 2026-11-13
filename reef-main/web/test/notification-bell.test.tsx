import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Notification } from "@reef/shared";

import { NotificationBell } from "../src/components/NotificationBell";
import { timeAgo } from "../src/lib/notifications";
import { installBrowserShims, renderScreen } from "./helpers";

const calls: { path: string; method: string }[] = [];
let rows: Notification[] = [];

vi.mock("@/lib/api", () => ({
  api: async (path: string, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    calls.push({ path, method });
    if (method === "PATCH") {
      const id = path.split("/")[4];
      rows = rows.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
      return { data: { read: true } };
    }
    return { data: rows };
  },
  apiListAll: async () => [],
  fetchMe: async () => ({ id: "owner-1", role: "owner" }),
  ApiRequestError: class extends Error {},
}));

function reminder(id: string, name: string, read = false): Notification {
  return {
    id,
    kind: "service_due",
    subject: `Service due: ${name}`,
    body: `${name} was due a service on 2026-11-01. Book it in, or record the service if it has already been done.`,
    equipment_id: `eq-${id}`,
    mine_id: "mine-1",
    created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    read_at: read ? new Date().toISOString() : null,
  };
}

describe("NotificationBell", () => {
  beforeEach(() => {
    installBrowserShims();
    calls.length = 0;
  });

  it("shows how many reminders are unread", async () => {
    rows = [
      reminder("n1", "Crusher 1"),
      reminder("n2", "Loader 3"),
      reminder("n3", "Pump 2", true),
    ];
    await renderScreen(NotificationBell);
    expect(await screen.findByRole("button", { name: "Notifications, 2 unread" })).toBeTruthy();
    expect(calls[0]).toEqual({ path: "/api/v1/notifications?limit=20", method: "GET" });
  });

  it("lists reminders and marks one read", async () => {
    rows = [reminder("n1", "Crusher 1"), reminder("n2", "Loader 3")];
    const { user } = await renderScreen(NotificationBell);
    await user.click(await screen.findByRole("button", { name: "Notifications, 2 unread" }));

    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("Service due: Crusher 1")).toBeTruthy();
    expect(within(panel).getAllByText("View equipment")).toHaveLength(2);

    await user.click(
      within(panel).getByRole("button", { name: 'Mark "Service due: Crusher 1" as read' }),
    );
    expect(calls).toContainEqual({ path: "/api/v1/notifications/n1/read", method: "PATCH" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeTruthy(),
    );
  });

  it("marks everything read at once", async () => {
    rows = [reminder("n1", "Crusher 1"), reminder("n2", "Loader 3")];
    const { user } = await renderScreen(NotificationBell);
    await user.click(await screen.findByRole("button", { name: "Notifications, 2 unread" }));
    await user.click(await screen.findByRole("button", { name: /mark all read/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy());
    const patched = calls.filter((c) => c.method === "PATCH").map((c) => c.path);
    expect(patched.sort()).toEqual([
      "/api/v1/notifications/n1/read",
      "/api/v1/notifications/n2/read",
    ]);
  });

  it("says so when there is nothing to read", async () => {
    rows = [];
    const { user } = await renderScreen(NotificationBell);
    await user.click(await screen.findByRole("button", { name: "Notifications" }));
    expect(await screen.findByText("You're all caught up")).toBeTruthy();
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  it("reads naturally", () => {
    expect(timeAgo("2026-11-13T11:59:50Z", now)).toBe("just now");
    expect(timeAgo("2026-11-13T11:55:00Z", now)).toBe("5 minutes ago");
    expect(timeAgo("2026-11-13T09:00:00Z", now)).toBe("3 hours ago");
    expect(timeAgo("2026-11-12T12:00:00Z", now)).toBe("yesterday");
    expect(timeAgo("2026-11-10T12:00:00Z", now)).toBe("3 days ago");
  });
});
