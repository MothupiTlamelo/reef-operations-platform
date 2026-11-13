import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PushToggle } from "../src/components/PushToggle";
import { urlBase64ToUint8Array } from "../src/lib/push";
import { installBrowserShims, renderScreen } from "./helpers";

const calls: { path: string; method: string; body?: unknown }[] = [];
let serverEnabled = true;

vi.mock("@/lib/api", () => ({
  api: async (path: string, init?: { method?: string; body?: string }) => {
    calls.push({
      path,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    if (path === "/api/v1/push/config")
      return {
        data: serverEnabled
          ? {
              enabled: true,
              public_key:
                "BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            }
          : { enabled: false, public_key: null },
      };
    if (path === "/api/v1/push/test") return { data: { sent: 1, failed: 0, removed: 0 } };
    return { data: { ok: true } };
  },
  ApiRequestError: class extends Error {
    code = "";
  },
}));

type FakeSub = {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer | null };
  toJSON: () => unknown;
  unsubscribe: () => Promise<boolean>;
};
let current: FakeSub | null = null;

function installPush(permission: NotificationPermission, next: NotificationPermission = "granted") {
  const pushManager = {
    getSubscription: async () => current,
    subscribe: async (opts: { applicationServerKey: Uint8Array }) => {
      current = {
        endpoint: "https://fcm.googleapis.com/fcm/send/test-device",
        options: { applicationServerKey: opts.applicationServerKey.buffer as ArrayBuffer },
        toJSON: () => ({
          endpoint: "https://fcm.googleapis.com/fcm/send/test-device",
          keys: { p256dh: "p", auth: "a" },
        }),
        unsubscribe: async () => {
          current = null;
          return true;
        },
      };
      return current;
    },
  };
  const reg = { active: {}, pushManager };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: async () => reg,
      ready: Promise.resolve(reg),
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
  (window as unknown as Record<string, unknown>).PushManager = function PushManager() {};
  const N = { permission, requestPermission: vi.fn(async () => ((N.permission = next), next)) };
  (window as unknown as Record<string, unknown>).Notification = N;
  return N;
}

function uninstallPush() {
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
  delete (window as unknown as Record<string, unknown>).PushManager;
  delete (window as unknown as Record<string, unknown>).Notification;
}

describe("PushToggle", () => {
  beforeEach(() => {
    installBrowserShims();
    calls.length = 0;
    current = null;
    serverEnabled = true;
  });
  afterEach(() => uninstallPush());

  it("says so when the browser has no push support", async () => {
    uninstallPush();
    await renderScreen(PushToggle);
    expect(await screen.findByText(/can't show phone alerts/i)).toBeTruthy();
  });

  it("hides the switch when the server is not set up", async () => {
    installPush("default");
    serverEnabled = false;
    await renderScreen(PushToggle);
    expect(await screen.findByText(/aren't set up on the server/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /turn on/i })).toBeNull();
  });

  it("asks permission, subscribes and saves the device", async () => {
    const N = installPush("default");
    const { user } = await renderScreen(PushToggle);
    await user.click(await screen.findByRole("button", { name: /turn on alerts/i }));
    await screen.findByText("Alerts are on for this device.");
    expect(N.requestPermission).toHaveBeenCalledOnce();
    expect(calls).toContainEqual({
      path: "/api/v1/push/subscriptions",
      method: "POST",
      body: {
        endpoint: "https://fcm.googleapis.com/fcm/send/test-device",
        keys: { p256dh: "p", auth: "a" },
      },
    });
  });

  it("explains how to unblock when the person says no", async () => {
    installPush("default", "denied");
    const { user } = await renderScreen(PushToggle);
    await user.click(await screen.findByRole("button", { name: /turn on alerts/i }));
    expect(await screen.findByText(/blocked for this site/i)).toBeTruthy();
    expect(calls.some((c) => c.path === "/api/v1/push/subscriptions")).toBe(false);
  });

  it("sends a test and turns off", async () => {
    installPush("granted");
    current = {
      endpoint: "https://fcm.googleapis.com/fcm/send/test-device",
      options: { applicationServerKey: null },
      toJSON: () => ({
        endpoint: "https://fcm.googleapis.com/fcm/send/test-device",
        keys: { p256dh: "p", auth: "a" },
      }),
      unsubscribe: async () => {
        current = null;
        return true;
      },
    };
    const { user } = await renderScreen(PushToggle);
    await user.click(await screen.findByRole("button", { name: /send test/i }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/v1/push/test")).toBe(true));

    await user.click(screen.getByRole("button", { name: /turn off/i }));
    await screen.findByRole("button", { name: /turn on alerts/i });
    expect(calls).toContainEqual({
      path: "/api/v1/push/subscriptions/remove",
      method: "POST",
      body: { endpoint: "https://fcm.googleapis.com/fcm/send/test-device" },
    });
    expect(current).toBeNull();
  });
});

describe("urlBase64ToUint8Array", () => {
  it("decodes URL-safe base64 without padding", () => {
    expect([...urlBase64ToUint8Array("AQID_-8")]).toEqual([1, 2, 3, 255, 239]);
  });
});
