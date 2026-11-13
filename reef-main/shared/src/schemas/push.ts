import { z } from "zod";

/**
 * A browser's push subscription, as `PushSubscription.toJSON()` returns it. The endpoint is a
 * URL at the browser vendor's push service; the two keys encrypt the message for that browser.
 * `expirationTime` is accepted because browsers send it, and ignored because none set it.
 */
export const PushSubscriptionInput = z.object({
  endpoint: z
    .url({ protocol: /^https$/ })
    .max(2048)
    .describe("The push service URL the browser was given"),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(128),
  }),
});
export type PushSubscriptionInput = z.infer<typeof PushSubscriptionInput>;

/** Which device to stop sending to. Only the caller's own devices can be removed. */
export const PushUnsubscribe = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2048),
});
export type PushUnsubscribe = z.infer<typeof PushUnsubscribe>;

/**
 * What the web app needs before it can ask the browser to subscribe. `public_key` is the VAPID
 * application server key; it is public by design. When push is not set up on the server,
 * `enabled` is false and the app hides the switch instead of offering one that cannot work.
 */
export type PushConfig = { enabled: boolean; public_key: string | null };

/** What the phone receives. Kept small: push services cap a message at about 4 KB. */
export type PushPayload = {
  title: string;
  body: string;
  /** The screen to open when the notification is tapped. */
  url: string;
  /** Collapses repeats: a second message with the same tag replaces the first on the phone. */
  tag: string;
  notification_id?: string;
};
