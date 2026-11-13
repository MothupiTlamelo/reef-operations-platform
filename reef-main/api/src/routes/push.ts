import type { Hono } from "hono";
import { PushSubscriptionInput, PushUnsubscribe, type PushConfig } from "@reef/shared";
import type { AppEnv } from "../app.js";
import { parseBody } from "../http/body.js";
import { ok } from "../http/envelope.js";
import { ApiError } from "../http/errors.js";
import type { Registry } from "../registry.js";
import { sendTest } from "../services/push.js";
import { defineRoute } from "./define.js";

export function pushRoutes(app: Hono<AppEnv>, registry: Registry) {
  defineRoute(
    app,
    registry,
    {
      method: "GET",
      path: "/api/v1/push/config",
      access: "notifications:read",
      summary:
        "Whether push notifications are set up on the server and, if so, the public VAPID key the browser needs to subscribe. The app hides its notifications switch when this says disabled.",
      refuses: "A caller who is not signed in.",
    },
    (c) => {
      const push = c.var.deps.push;
      const config: PushConfig = push
        ? { enabled: true, public_key: push.publicKey }
        : { enabled: false, public_key: null };
      return ok(c, config);
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "POST",
      path: "/api/v1/push/subscriptions",
      access: "notifications:read",
      summary:
        "Saves this device's push subscription for the signed-in person, so their service reminders also arrive on its lock screen. Saving the same device again refreshes it; a shared device moves to whoever saved it last.",
      refuses:
        "An endpoint that is not an https URL, missing encryption keys, or any attempt to save a device for somebody else (there is no user field, and the database files every device under the caller).",
    },
    async (c) => {
      const sub = await parseBody(c, PushSubscriptionInput);
      const ua = c.req.header("User-Agent")?.slice(0, 300) ?? null;
      await c.var.repos.pushSubscriptions.save(sub, ua);
      return ok(c, { subscribed: true }, 201);
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "POST",
      path: "/api/v1/push/subscriptions/remove",
      access: "notifications:read",
      summary:
        "Stops push notifications to one of the signed-in person's devices. A POST rather than a DELETE because the device is named by its endpoint URL, which is too long and too awkward for a path.",
      refuses:
        "A device that is not the caller's, and one that was never saved, both as 404, so the answer does not reveal whether somebody else's device exists.",
    },
    async (c) => {
      const { endpoint } = await parseBody(c, PushUnsubscribe);
      const removed = await c.var.repos.pushSubscriptions.remove(c.var.user.id, endpoint);
      if (!removed) throw new ApiError("NOT_FOUND", "That device does not have notifications on");
      return ok(c, { unsubscribed: true });
    },
  );

  defineRoute(
    app,
    registry,
    {
      method: "POST",
      path: "/api/v1/push/test",
      access: "notifications:read",
      summary:
        "Sends a test notification to every device the signed-in person has turned notifications on for, so they can check it works without waiting for a machine to fall due.",
      refuses:
        "A server without push set up (409), and a person with no devices turned on (404). Only ever sends to the caller's own devices.",
    },
    async (c) => {
      const push = c.var.deps.push;
      if (!push) {
        throw new ApiError("CONFLICT", "Push notifications are not set up on the server yet");
      }
      const subs = await c.var.repos.pushSubscriptions.list(c.var.user.id);
      if (subs.length === 0) {
        throw new ApiError("NOT_FOUND", "Turn on notifications on this device first");
      }
      const result = await sendTest(subs, push.sender);
      for (const endpoint of result.gone) {
        await c.var.repos.pushSubscriptions.remove(c.var.user.id, endpoint);
      }
      return ok(c, { sent: result.sent, failed: result.failed, removed: result.gone.length });
    },
  );
}
