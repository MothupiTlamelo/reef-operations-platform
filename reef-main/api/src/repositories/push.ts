import type { SupabaseClient } from "@supabase/supabase-js";
import type { PushSubscriptionInput } from "@reef/shared";
import { ApiError } from "../http/errors.js";
import type {
  PendingPush,
  PushDeliveryRepository,
  PushSubscriptionRepository,
  StoredPushSubscription,
} from "./types.js";

type PgError = { code?: string; message: string };

function translate(err: PgError): ApiError {
  switch (err.code) {
    case "42501":
      return new ApiError("FORBIDDEN", "Sign in to turn on notifications");
    case "23514":
      return new ApiError("VALIDATION_FAILED", "That push address is not accepted");
    default:
      return new ApiError("INTERNAL", err.message);
  }
}

const COLUMNS = "user_id, endpoint, p256dh, auth";

/** The caller's own devices, through the caller's token. */
export class SupabasePushSubscriptions implements PushSubscriptionRepository {
  constructor(private readonly db: SupabaseClient) {}

  async save(sub: PushSubscriptionInput, userAgent: string | null): Promise<void> {
    // Through the function rather than an upsert, so a shared phone that changes hands moves to
    // the new person instead of failing row-level security (see the migration).
    const { error } = await this.db.rpc("save_push_subscription", {
      p_endpoint: sub.endpoint,
      p_p256dh: sub.keys.p256dh,
      p_auth: sub.keys.auth,
      p_user_agent: userAgent,
    });
    if (error) throw translate(error);
  }

  async remove(userId: string, endpoint: string): Promise<boolean> {
    const { data, error } = await this.db
      .from("push_subscriptions")
      .delete()
      .eq("user_id", userId)
      .eq("endpoint", endpoint)
      .select("id");
    if (error) throw translate(error);
    return (data ?? []).length > 0;
  }

  async list(userId: string): Promise<StoredPushSubscription[]> {
    const { data, error } = await this.db
      .from("push_subscriptions")
      .select(COLUMNS)
      .eq("user_id", userId);
    if (error) throw translate(error);
    return (data ?? []) as StoredPushSubscription[];
  }
}

/** Everybody's devices and unsent reminders, on the scheduler's service credential. */
export class SupabasePushDelivery implements PushDeliveryRepository {
  constructor(private readonly db: SupabaseClient) {}

  async pending(since: string, limit: number): Promise<PendingPush[]> {
    const { data, error } = await this.db
      .from("notifications")
      .select("id, user_id, subject, body, equipment_id")
      .is("pushed_at", null)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) throw translate(error);
    return (data ?? []) as PendingPush[];
  }

  async subscriptionsFor(userIds: readonly string[]): Promise<StoredPushSubscription[]> {
    if (userIds.length === 0) return [];
    const { data, error } = await this.db
      .from("push_subscriptions")
      .select(COLUMNS)
      .in("user_id", [...userIds]);
    if (error) throw translate(error);
    return (data ?? []) as StoredPushSubscription[];
  }

  async markPushed(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const { error } = await this.db
      .from("notifications")
      .update({ pushed_at: new Date().toISOString() })
      .in("id", [...ids]);
    if (error) throw translate(error);
  }

  async forget(endpoints: readonly string[]): Promise<void> {
    if (endpoints.length === 0) return;
    const { error } = await this.db
      .from("push_subscriptions")
      .delete()
      .in("endpoint", [...endpoints]);
    if (error) throw translate(error);
  }
}
