import { z } from "zod";
import { DEFAULT_RETENTION, type RetentionYears } from "@reef/shared";

const Env = z
  .object({
    PORT: z.coerce.number().int().positive().default(8787),
    SUPABASE_URL: z.url(),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    CORS_ORIGINS: z.string().default("http://localhost:8080"),
    // How long employee information is kept, in years. The rule itself is REEF's and is written
    // up in docs/privacy.md; these two settings are what the code acts on, so REEF can change
    // either period without anybody touching the code.
    RETENTION_IDENTITY_YEARS: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(DEFAULT_RETENTION.identity),
    RETENTION_RECORD_YEARS: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(DEFAULT_RETENTION.record),
    // The sweep that raises service reminders runs with no user behind it, so it cannot borrow
    // a caller's token and needs its own credential. Optional: without it the API still serves
    // every request and the scheduler says at start-up that it is not running. It bypasses
    // row-level security, so it stays on the server and never reaches a browser.
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    // REEF's own calendar day, so "did yesterday's sweep run" has exactly one answer.
    SCHEDULE_TIMEZONE: z.string().min(1).default("Africa/Johannesburg"),
    // Push notifications. The VAPID key pair signs every push so the browser vendor's push
    // service knows the message came from REEF. Generate it once with `npx web-push
    // generate-vapid-keys`. The public key is public by design; the private key stays here.
    // Optional: without both, the API still runs and the app hides the notifications switch.
    VAPID_PUBLIC_KEY: z.string().min(1).optional(),
    VAPID_PRIVATE_KEY: z.string().min(1).optional(),
    // Who the push services contact if REEF's messages cause trouble: a mailto: or https: URL.
    VAPID_SUBJECT: z
      .string()
      .regex(/^(mailto:|https:\/\/)/, "must start with mailto: or https://")
      .default("mailto:owner@reef.co.za"),
  })
  .refine((e) => e.RETENTION_IDENTITY_YEARS <= e.RETENTION_RECORD_YEARS, {
    // Removing the identity number while keeping the rest of the record is the whole point of the
    // shorter period. If the number were kept longer than the record it sits in, the two rules
    // would contradict each other and the longer one would silently win.
    message: "RETENTION_IDENTITY_YEARS must not be longer than RETENTION_RECORD_YEARS",
    path: ["RETENTION_IDENTITY_YEARS"],
  })
  .refine((e) => Boolean(e.VAPID_PUBLIC_KEY) === Boolean(e.VAPID_PRIVATE_KEY), {
    // One without the other cannot sign a push, and would fail on the first reminder rather
    // than at start-up.
    message: "Set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, or neither",
    path: ["VAPID_PRIVATE_KEY"],
  });

export type Config = {
  port: number;
  supabaseUrl: string;
  supabaseKey: string;
  corsOrigins: string[];
  retention: RetentionYears;
  serviceRoleKey: string | null;
  timezone: string;
  /** Null when push notifications are not set up. */
  vapid: { publicKey: string; privateKey: string; subject: string } | null;
};

/** Fails at start-up, naming every missing setting, rather than on the first request. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Missing or invalid settings in api/.env: ${names}`);
  }
  const e = parsed.data;
  return {
    port: e.PORT,
    supabaseUrl: e.SUPABASE_URL.replace(/\/$/, ""),
    supabaseKey: e.SUPABASE_PUBLISHABLE_KEY,
    corsOrigins: e.CORS_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    retention: {
      identity: e.RETENTION_IDENTITY_YEARS,
      record: e.RETENTION_RECORD_YEARS,
    },
    serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY ?? null,
    timezone: e.SCHEDULE_TIMEZONE,
    vapid:
      e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY
        ? {
            publicKey: e.VAPID_PUBLIC_KEY,
            privateKey: e.VAPID_PRIVATE_KEY,
            subject: e.VAPID_SUBJECT,
          }
        : null,
  };
}
