import type { PushConfig } from "@reef/shared";
import { api, ApiRequestError } from "@/lib/api";
import { isIosSafari, isStandalone } from "@/lib/pwa";

/**
 * Push notifications on this device: service reminders on the lock screen, even when the app
 * is closed. The browser does the hard part. This file asks the person's permission, asks the
 * browser for a subscription signed for REEF's server key, and hands it to the API.
 *
 * States, in the order they are checked:
 *   unsupported  the browser has no push support at all
 *   ios-install  iPhone/iPad Safari: push only works once the app is on the Home Screen
 *   server-off   the API has no VAPID keys, so nothing could be sent
 *   blocked      the person said no; only browser settings can undo that
 *   off          ready to turn on
 *   on           this device is subscribed and saved on the server
 */
export const PUSH_STATE_KEY = ["push", "state"] as const;

export type PushState = "unsupported" | "ios-install" | "server-off" | "blocked" | "off" | "on";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** VAPID keys travel as URL-safe base64; the browser wants raw bytes. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

/** The service worker, once it is running. Null if it does not start within a few seconds. */
async function registration(timeoutMs = 5000): Promise<ServiceWorkerRegistration | null> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing?.active) return existing;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

/** Does not wait for the service worker: no worker means no subscription. */
async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

async function saveOnServer(sub: PushSubscription): Promise<void> {
  await api<{ subscribed: boolean }>("/api/v1/push/subscriptions", {
    method: "POST",
    body: JSON.stringify(sub.toJSON()),
  });
}

export async function fetchPushConfig(): Promise<PushConfig> {
  return (await api<PushConfig>("/api/v1/push/config")).data;
}

/**
 * Works out where this device stands. When the browser already holds a subscription it is
 * saved again, which files it under whoever is signed in now and keeps it fresh.
 */
export async function getPushState(): Promise<{ state: PushState; config: PushConfig | null }> {
  if (!pushSupported()) {
    return {
      state: isIosSafari() && !isStandalone() ? "ios-install" : "unsupported",
      config: null,
    };
  }
  const config = await fetchPushConfig();
  if (!config.enabled || !config.public_key) return { state: "server-off", config };
  if (Notification.permission === "denied") return { state: "blocked", config };

  const sub = await currentSubscription();
  if (sub && Notification.permission === "granted") {
    await saveOnServer(sub);
    return { state: "on", config };
  }
  return { state: "off", config };
}

/** Asks permission, subscribes this browser, and saves it on the server. */
export async function enablePush(publicKey: string): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "blocked";
  if (permission !== "granted") return "off";

  const reg = await registration();
  if (!reg) {
    throw new Error("The app is still starting. Reload the page and try again.");
  }
  const key = urlBase64ToUint8Array(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made for an older server key cannot receive messages signed with the new one.
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await saveOnServer(sub);
  return "on";
}

/**
 * Stops alerts to this device for the signed-in person. With `keepBrowser`, the browser keeps
 * its subscription so the next person to sign in on a shared phone is offered it again
 * straight away; only the server's record of who it belongs to is removed.
 */
export async function disablePush(opts: { keepBrowser?: boolean } = {}): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  const sub = await currentSubscription();
  if (!sub) return "off";
  try {
    await api<{ unsubscribed: boolean }>("/api/v1/push/subscriptions/remove", {
      method: "POST",
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
  } catch (err) {
    // Already gone on the server is the outcome we wanted.
    if (!(err instanceof ApiRequestError && err.code === "NOT_FOUND")) throw err;
  }
  if (!opts.keepBrowser) await sub.unsubscribe();
  return "off";
}

export async function sendTestPush(): Promise<{ sent: number; failed: number; removed: number }> {
  return (
    await api<{ sent: number; failed: number; removed: number }>("/api/v1/push/test", {
      method: "POST",
    })
  ).data;
}
