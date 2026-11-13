import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { startScheduler } from "../src/services/scheduler.js";
import { deliverPending, payloadFor, PUSH_WINDOW_MS } from "../src/services/push.js";
import {
  FakePushSender,
  MemoryJobs,
  MemoryPushDelivery,
  MemorySweep,
  testApp,
  USERS,
} from "./fakes.js";

const OWNER = USERS["owner-token"]!.id;
const MANAGER = USERS["manager-token"]!.id;

const PHONE = "https://fcm.googleapis.com/fcm/send/owner-phone";
const LAPTOP = "https://updates.push.services.mozilla.com/wpush/v2/owner-laptop";
const IPHONE = "https://web.push.apple.com/manager-iphone";

function subscription(endpoint: string) {
  return { endpoint, expirationTime: null, keys: { p256dh: "BPkey", auth: "authkey" } };
}

function withPush() {
  const sender = new FakePushSender();
  const t = testApp({}, { push: { publicKey: "BPublicKey", sender } });
  return { ...t, sender };
}

describe("GET /api/v1/push/config", () => {
  it("hands out the public key when push is set up", async () => {
    const { call } = withPush();
    const res = await call("GET", "/api/v1/push/config", { token: "worker-token" });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ enabled: true, public_key: "BPublicKey" });
  });

  it("says disabled, rather than failing, when it is not", async () => {
    const { call } = testApp();
    const res = await call("GET", "/api/v1/push/config", { token: "owner-token" });
    expect((await res.json()).data).toEqual({ enabled: false, public_key: null });
  });

  it("needs a sign-in", async () => {
    const { call } = withPush();
    expect((await call("GET", "/api/v1/push/config")).status).toBe(401);
  });
});

describe("saving and removing a device", () => {
  it("files the device under the caller", async () => {
    const { call, pushSubscriptions } = withPush();
    const res = await call("POST", "/api/v1/push/subscriptions", {
      token: "owner-token",
      body: subscription(PHONE),
    });
    expect(res.status).toBe(201);
    expect(pushSubscriptions.rows).toMatchObject([{ user_id: OWNER, endpoint: PHONE }]);
  });

  it("refuses an endpoint that is not https, and missing keys", async () => {
    const { call, pushSubscriptions } = withPush();
    const plain = await call("POST", "/api/v1/push/subscriptions", {
      token: "owner-token",
      body: subscription("http://push.example.com/x"),
    });
    expect(plain.status).toBe(400);
    const noKeys = await call("POST", "/api/v1/push/subscriptions", {
      token: "owner-token",
      body: { endpoint: PHONE },
    });
    expect(noKeys.status).toBe(400);
    expect(pushSubscriptions.rows).toHaveLength(0);
  });

  it("moves a shared phone to whoever signed in on it last", async () => {
    const { call, pushSubscriptions } = withPush();
    await call("POST", "/api/v1/push/subscriptions", {
      token: "owner-token",
      body: subscription(PHONE),
    });
    await call("POST", "/api/v1/push/subscriptions", {
      token: "manager-token",
      body: subscription(PHONE),
    });
    expect(pushSubscriptions.rows).toMatchObject([{ user_id: MANAGER, endpoint: PHONE }]);
  });

  it("removes only the caller's own device", async () => {
    const { call, pushSubscriptions } = withPush();
    await call("POST", "/api/v1/push/subscriptions", {
      token: "owner-token",
      body: subscription(PHONE),
    });
    const other = await call("POST", "/api/v1/push/subscriptions/remove", {
      token: "manager-token",
      body: { endpoint: PHONE },
    });
    expect(other.status).toBe(404);
    expect(pushSubscriptions.rows).toHaveLength(1);

    const own = await call("POST", "/api/v1/push/subscriptions/remove", {
      token: "owner-token",
      body: { endpoint: PHONE },
    });
    expect(own.status).toBe(200);
    expect(pushSubscriptions.rows).toHaveLength(0);
  });
});

describe("POST /api/v1/push/test", () => {
  it("sends only to the caller's own devices", async () => {
    const { call, sender } = withPush();
    await call("POST", "/api/v1/push/subscriptions", {
      token: "owner-token",
      body: subscription(PHONE),
    });
    await call("POST", "/api/v1/push/subscriptions", {
      token: "manager-token",
      body: subscription(IPHONE),
    });
    const res = await call("POST", "/api/v1/push/test", { token: "owner-token" });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ sent: 1, failed: 0, removed: 0 });
    expect(sender.sent.map((s) => s.endpoint)).toEqual([PHONE]);
  });

  it("forgets a device the push service says is gone", async () => {
    const { call, sender, pushSubscriptions } = withPush();
    await call("POST", "/api/v1/push/subscriptions", {
      token: "owner-token",
      body: subscription(PHONE),
    });
    sender.outcomes[PHONE] = "gone";
    const res = await call("POST", "/api/v1/push/test", { token: "owner-token" });
    expect((await res.json()).data).toEqual({ sent: 0, failed: 0, removed: 1 });
    expect(pushSubscriptions.rows).toHaveLength(0);
  });

  it("explains when there is nothing to send to", async () => {
    const { call } = withPush();
    const none = await call("POST", "/api/v1/push/test", { token: "owner-token" });
    expect(none.status).toBe(404);
    const off = await testApp().call("POST", "/api/v1/push/test", { token: "owner-token" });
    expect(off.status).toBe(409);
  });
});

describe("delivering reminders to phones", () => {
  const NOW = new Date("2026-11-13T08:00:00Z");
  const recent = new Date(NOW.getTime() - 60_000).toISOString();

  function setup() {
    const repo = new MemoryPushDelivery();
    const sender = new FakePushSender();
    repo.subs = [
      { user_id: OWNER, endpoint: PHONE, p256dh: "k", auth: "a" },
      { user_id: OWNER, endpoint: LAPTOP, p256dh: "k", auth: "a" },
      { user_id: MANAGER, endpoint: IPHONE, p256dh: "k", auth: "a" },
    ];
    repo.notifications = [
      {
        id: "n1",
        user_id: OWNER,
        subject: "Service due: Crusher 1",
        body: "Crusher 1 was due a service on 2026-11-10.",
        equipment_id: "eq1",
        created_at: recent,
        pushed_at: null,
      },
      {
        id: "n2",
        user_id: MANAGER,
        subject: "Service due: Crusher 1",
        body: "Crusher 1 was due a service on 2026-11-10.",
        equipment_id: "eq1",
        created_at: recent,
        pushed_at: null,
      },
    ];
    return { repo, sender };
  }

  it("sends each reminder to every device its person owns, once", async () => {
    const { repo, sender } = setup();
    const first = await deliverPending(repo, sender, NOW);
    expect(first).toEqual({ notifications: 2, sent: 3, failed: 0, removed: 0 });
    expect(sender.sent.map((s) => s.endpoint).sort()).toEqual([IPHONE, LAPTOP, PHONE].sort());
    expect(sender.sent[0]!.payload).toMatchObject({
      title: "Service due: Crusher 1",
      url: "/equipment",
    });

    const second = await deliverPending(repo, sender, NOW);
    expect(second.notifications).toBe(0);
    expect(sender.sent).toHaveLength(3);
  });

  it("tries again next time when every attempt failed", async () => {
    const { repo, sender } = setup();
    sender.outcomes[IPHONE] = "failed";
    const result = await deliverPending(repo, sender, NOW);
    expect(result.failed).toBe(1);
    expect(repo.notifications.find((n) => n.id === "n2")!.pushed_at).toBeNull();
    expect(repo.notifications.find((n) => n.id === "n1")!.pushed_at).not.toBeNull();

    delete sender.outcomes[IPHONE];
    expect((await deliverPending(repo, sender, NOW)).sent).toBe(1);
  });

  it("forgets devices that are gone and does not retry for them", async () => {
    const { repo, sender } = setup();
    sender.outcomes[LAPTOP] = "gone";
    const result = await deliverPending(repo, sender, NOW);
    expect(result.removed).toBe(1);
    expect(repo.subs.map((s) => s.endpoint)).not.toContain(LAPTOP);
    expect(repo.notifications.every((n) => n.pushed_at !== null)).toBe(true);
  });

  it("marks a reminder done when its person has no devices, so it is not re-read forever", async () => {
    const { repo, sender } = setup();
    repo.subs = [];
    const result = await deliverPending(repo, sender, NOW);
    expect(result.sent).toBe(0);
    expect(repo.notifications.every((n) => n.pushed_at !== null)).toBe(true);
  });

  it("does not buzz a phone about a reminder older than a day", async () => {
    const { repo, sender } = setup();
    for (const n of repo.notifications) {
      n.created_at = new Date(NOW.getTime() - PUSH_WINDOW_MS - 1000).toISOString();
    }
    expect((await deliverPending(repo, sender, NOW)).notifications).toBe(0);
    expect(sender.sent).toHaveLength(0);
  });

  it("opens the dashboard for a reminder that is not about a machine", () => {
    expect(
      payloadFor({ id: "x", user_id: OWNER, subject: "s", body: "b", equipment_id: null }).url,
    ).toBe("/dashboard");
  });
});

describe("the scheduler", () => {
  it("runs push delivery on every tick, after the sweep", async () => {
    const order: string[] = [];
    const jobs = new MemoryJobs();
    const sweepRepo = new MemorySweep();
    const origMachines = sweepRepo.machines.bind(sweepRepo);
    sweepRepo.machines = async () => {
      order.push("sweep");
      return origMachines();
    };
    let resolveDone: () => void = () => {};
    const done = new Promise<void>((r) => (resolveDone = r));
    const stop = startScheduler({
      jobs,
      sweepRepo,
      zone: "Africa/Johannesburg",
      afterSweep: async () => {
        order.push("push");
        resolveDone();
      },
    });
    await done;
    stop();
    expect(order).toEqual(["sweep", "push"]);
  });

  it("keeps running when push delivery throws", async () => {
    const logs: string[] = [];
    let resolveDone: () => void = () => {};
    const done = new Promise<void>((r) => (resolveDone = r));
    const stop = startScheduler({
      jobs: new MemoryJobs(),
      sweepRepo: new MemorySweep(),
      zone: "Africa/Johannesburg",
      log: (m) => {
        logs.push(m);
        if (m.includes("after-sweep")) resolveDone();
      },
      afterSweep: async () => {
        throw new Error("push service down");
      },
    });
    await done;
    stop();
    expect(logs.some((m) => m.includes("push service down"))).toBe(true);
  });
});

describe("push settings", () => {
  const base = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "pk",
  };

  it("is off when no keys are set", () => {
    expect(loadConfig(base as NodeJS.ProcessEnv).vapid).toBeNull();
  });

  it("is on with both keys, with a default contact", () => {
    const config = loadConfig({
      ...base,
      VAPID_PUBLIC_KEY: "pub",
      VAPID_PRIVATE_KEY: "priv",
    } as NodeJS.ProcessEnv);
    expect(config.vapid).toEqual({
      publicKey: "pub",
      privateKey: "priv",
      subject: "mailto:owner@reef.co.za",
    });
  });

  it("refuses one key without the other at start-up", () => {
    expect(() => loadConfig({ ...base, VAPID_PUBLIC_KEY: "pub" } as NodeJS.ProcessEnv)).toThrow(
      /VAPID_PRIVATE_KEY/,
    );
  });
});
