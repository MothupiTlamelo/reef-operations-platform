import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { supabaseVerifier } from "./auth/verify.js";
import { loadConfig } from "./config.js";
import { schedulerRepositories, supabaseRepositories } from "./db/supabase.js";
import { deliverPending, describeDelivery, WebPushSender } from "./services/push.js";
import { startScheduler } from "./services/scheduler.js";

const config = loadConfig();
const pushSender = config.vapid ? new WebPushSender(config.vapid) : null;
const { app } = createApp({
  verifyToken: supabaseVerifier(config.supabaseUrl, config.supabaseKey),
  repositories: supabaseRepositories(config),
  corsOrigins: config.corsOrigins,
  retention: config.retention,
  push:
    config.vapid && pushSender ? { publicKey: config.vapid.publicKey, sender: pushSender } : null,
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`REEF API listening on http://localhost:${info.port}`);
});

// Started after the server is listening, so a slow first sweep cannot delay the health check
// the deploy is waiting on.
const scheduled = schedulerRepositories(config);
const stopScheduler = scheduled
  ? startScheduler({
      jobs: scheduled.jobs,
      sweepRepo: scheduled.sweepRepo,
      zone: config.timezone,
      log: (message) => console.log(message),
      afterSweep: pushSender
        ? async () => {
            const result = await deliverPending(scheduled.pushRepo, pushSender);
            if (result.notifications > 0) console.log(`push delivery: ${describeDelivery(result)}`);
          }
        : undefined,
    })
  : null;

if (!scheduled) {
  // Said plainly rather than left silent. Nobody notices reminders that were never going to be
  // sent, which is the whole reason this task exists.
  console.warn(
    "SUPABASE_SERVICE_ROLE_KEY is not set, so the service reminder sweep is NOT running. " +
      "Every day it does not run shows as missed on GET /api/v1/admin/jobs.",
  );
}

if (!config.vapid) {
  console.warn(
    "VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not set, so push notifications are switched off. " +
      "Reminders still appear in the notification bell.",
  );
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopScheduler?.();
    server.close(() => process.exit(0));
  });
}
