import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, type Db } from "./harness.js";

// Push subscriptions against a real Postgres, because the rules that matter here are row-level
// security and a SECURITY DEFINER function, and a fake has neither.

let db: Db;
let owner: string;
let manager: string;

const PHONE = "https://fcm.googleapis.com/fcm/send/shared-phone";

beforeAll(async () => {
  db = await migratedDb();
  owner = await db.user("owner");
  manager = await db.user("manager");
}, 60_000);

const save = (userId: string, endpoint: string) =>
  db.as(userId, (tx) =>
    tx.query("SELECT public.save_push_subscription($1, 'p256', 'auth', 'test-agent')", [endpoint]),
  );

const ownerOf = async (endpoint: string) =>
  (
    await db.query<{ user_id: string }>(
      "SELECT user_id FROM push_subscriptions WHERE endpoint = $1",
      [endpoint],
    )
  ).rows.map((r) => r.user_id);

describe("push subscriptions, against a real database", () => {
  it("files a device under the person who saved it", async () => {
    await save(owner, "https://fcm.googleapis.com/fcm/send/owner-1");
    expect(await ownerOf("https://fcm.googleapis.com/fcm/send/owner-1")).toEqual([owner]);
  });

  it("moves a shared phone to whoever saved it last, keeping one row", async () => {
    await save(owner, PHONE);
    await save(manager, PHONE);
    expect(await ownerOf(PHONE)).toEqual([manager]);
  });

  it("refuses a save with nobody signed in", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE authenticated");
        await tx.query(
          "SELECT public.save_push_subscription('https://push.example.com/anon', 'p', 'a')",
        );
      }),
    ).rejects.toThrow(/Sign in/);
  });

  it("refuses a plain http endpoint", async () => {
    await expect(save(owner, "http://push.example.com/insecure")).rejects.toThrow(/check/i);
  });

  it("does not let a person insert directly, bypassing the function", async () => {
    await expect(
      db.as(owner, (tx) =>
        tx.query(
          "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, 'https://x.example/1', 'p', 'a')",
          [manager],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("shows a person only their own devices", async () => {
    await save(owner, "https://fcm.googleapis.com/fcm/send/owner-2");
    await save(manager, "https://web.push.apple.com/manager-2");
    const seen = await db.as(manager, (tx) =>
      tx.query<{ user_id: string }>("SELECT user_id FROM push_subscriptions"),
    );
    expect(seen.rows.length).toBeGreaterThan(0);
    expect(seen.rows.every((r) => r.user_id === manager)).toBe(true);
  });

  it("lets a person remove their own device and not somebody else's", async () => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/owner-3";
    await save(owner, endpoint);
    const byOther = await db.as(manager, (tx) =>
      tx.query("DELETE FROM push_subscriptions WHERE endpoint = $1 RETURNING id", [endpoint]),
    );
    expect(byOther.rows).toHaveLength(0);
    const byOwner = await db.as(owner, (tx) =>
      tx.query("DELETE FROM push_subscriptions WHERE endpoint = $1 RETURNING id", [endpoint]),
    );
    expect(byOwner.rows).toHaveLength(1);
  });

  it("records when a reminder was pushed", async () => {
    const { rows } = await db.query<{ id: string; pushed_at: string | null }>(
      `INSERT INTO notifications (user_id, kind, subject, body, dedupe_key)
       VALUES ($1, 'service_due', 's', 'b', 'push-test') RETURNING id, pushed_at`,
      [owner],
    );
    expect(rows[0]!.pushed_at).toBeNull();
    await db.query("UPDATE notifications SET pushed_at = now() WHERE id = $1", [rows[0]!.id]);
    const after = await db.query<{ pushed_at: string | null }>(
      "SELECT pushed_at FROM notifications WHERE id = $1",
      [rows[0]!.id],
    );
    expect(after.rows[0]!.pushed_at).not.toBeNull();
  });
});
