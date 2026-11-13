import webpush from "web-push";
import type { PushPayload } from "@reef/shared";
import type {
  PendingPush,
  PushDeliveryRepository,
  StoredPushSubscription,
} from "../repositories/types.js";

/**
 * Push notifications: the reminder on a phone's lock screen, even when the app is closed.
 *
 * The browser vendor runs the push service (Google for Chrome and Android, Apple for Safari and
 * iPhone home-screen apps, Mozilla, Microsoft). The API signs each message with REEF's VAPID key
 * so the service knows who sent it, and encrypts it with the device's own keys so only that
 * device can read it. `PushSender` is the seam: the real one calls the push service, tests use
 * a fake that records what would have gone out.
 */

/** "gone" means the push service says the device unsubscribed or was reset; stop sending to it. */
export type SendOutcome = "sent" | "gone" | "failed";

export interface PushSender {
  send(sub: StoredPushSubscription, payload: PushPayload): Promise<SendOutcome>;
}

export type VapidKeys = { publicKey: string; privateKey: string; subject: string };

/** How long a push service keeps trying to reach a phone that is off or underground. */
const TTL_SECONDS = 24 * 60 * 60;

export class WebPushSender implements PushSender {
  constructor(
    private readonly vapid: VapidKeys,
    private readonly log: (line: string) => void = console.warn,
  ) {}

  async send(sub: StoredPushSubscription, payload: PushPayload): Promise<SendOutcome> {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        {
          TTL: TTL_SECONDS,
          urgency: "normal",
          vapidDetails: {
            subject: this.vapid.subject,
            publicKey: this.vapid.publicKey,
            privateKey: this.vapid.privateKey,
          },
        },
      );
      return "sent";
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // 404 and 410 are the push service saying this subscription no longer exists.
      if (status === 404 || status === 410) return "gone";
      this.log(`push to ${new URL(sub.endpoint).host} failed: ${status ?? (err as Error).message}`);
      return "failed";
    }
  }
}

/** The screen a reminder opens when tapped. */
export function payloadFor(n: PendingPush): PushPayload {
  return {
    title: n.subject,
    body: n.body,
    url: n.equipment_id ? "/equipment" : "/dashboard",
    tag: `reef-${n.id}`,
    notification_id: n.id,
  };
}

export const TEST_PAYLOAD: PushPayload = {
  title: "Reef Ops notifications are on",
  body: "This device will now get service reminders, even when the app is closed.",
  url: "/dashboard",
  tag: "reef-test",
};

export type DeliveryResult = {
  notifications: number;
  sent: number;
  failed: number;
  removed: number;
};

/** How far back an unsent reminder is still worth a buzz. Older ones wait in the bell. */
export const PUSH_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Sends every reminder that has not been pushed yet to all of its recipient's devices.
 *
 * A reminder is marked pushed once it reached at least one device, or once there was nothing
 * to try (the person has no devices, or every device is gone). It is left unmarked only when
 * every attempt failed for a reason that might pass, such as the push service being down, so
 * the next run tries again. Devices the push service reports as gone are forgotten.
 */
export async function deliverPending(
  repo: PushDeliveryRepository,
  sender: PushSender,
  now: Date = new Date(),
  limit = 200,
): Promise<DeliveryResult> {
  const since = new Date(now.getTime() - PUSH_WINDOW_MS).toISOString();
  const pending = await repo.pending(since, limit);
  const result: DeliveryResult = { notifications: pending.length, sent: 0, failed: 0, removed: 0 };
  if (pending.length === 0) return result;

  const subs = await repo.subscriptionsFor([...new Set(pending.map((n) => n.user_id))]);
  const byUser = new Map<string, StoredPushSubscription[]>();
  for (const s of subs) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);

  const done: string[] = [];
  const gone = new Set<string>();

  for (const n of pending) {
    const targets = (byUser.get(n.user_id) ?? []).filter((s) => !gone.has(s.endpoint));
    const outcomes = await Promise.all(targets.map((s) => sender.send(s, payloadFor(n))));
    outcomes.forEach((o, i) => {
      if (o === "sent") result.sent += 1;
      if (o === "failed") result.failed += 1;
      if (o === "gone") gone.add(targets[i].endpoint);
    });
    const retry = outcomes.length > 0 && outcomes.every((o) => o === "failed");
    if (!retry) done.push(n.id);
  }

  await repo.markPushed(done);
  if (gone.size > 0) {
    await repo.forget([...gone]);
    result.removed = gone.size;
  }
  return result;
}

/** Sends the test message to one person's devices, forgetting any that are gone. */
export async function sendTest(
  subs: readonly StoredPushSubscription[],
  sender: PushSender,
): Promise<{ sent: number; failed: number; gone: string[] }> {
  const outcomes = await Promise.all(subs.map((s) => sender.send(s, TEST_PAYLOAD)));
  return {
    sent: outcomes.filter((o) => o === "sent").length,
    failed: outcomes.filter((o) => o === "failed").length,
    gone: subs.filter((_, i) => outcomes[i] === "gone").map((s) => s.endpoint),
  };
}

export function describeDelivery(r: DeliveryResult): string {
  return `${r.notifications} reminders, ${r.sent} pushed, ${r.failed} failed, ${r.removed} devices removed`;
}
