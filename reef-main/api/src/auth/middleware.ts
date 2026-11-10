import { createMiddleware } from "hono/factory";
import { getConnInfo } from "@hono/node-server/conninfo";
import { can, highestRole, type Permission } from "@reef/shared";
import { ApiError } from "../http/errors.js";
import type { AppEnv } from "../app.js";

/**
 * Requires a valid Supabase access token.
 * Checks the session, then retrieves the user's role and plant.
 */
export const requireUser = createMiddleware<AppEnv>(
  async (c, next) => {
    const header = c.req.header("Authorization") ?? "";

    const token = header.startsWith("Bearer ")
      ? header.slice(7).trim()
      : "";

    if (!token) {
      console.warn("[auth] Request rejected: missing Bearer token");

      throw new ApiError(
        "UNAUTHENTICATED",
        "Sign in to continue",
      );
    }

    let userId: string;
    let sessionId: string;

    // STEP 1: Verify the Supabase access token.
    try {
      const verified = await c.var.deps.verifyToken(token);

      userId = verified.userId;
      sessionId = verified.sessionId;
    } catch (error) {
      console.error(
        "[auth] Token verification failed:",
        error instanceof Error ? error.message : "Unknown error",
      );

      throw new ApiError(
        "UNAUTHENTICATED",
        "Your session has expired or is not valid. Sign in again",
      );
    }

    // STEP 2: Create repositories using the user's access token.
    const repos = c.var.deps.repositories(token);

    const device = c.req.header("user-agent") ?? null;

    let address: string | null = null;

    try {
      address = getConnInfo(c).remote.address ?? null;
    } catch {
      address = null;
    }

    // STEP 3: Validate and update the user's session.
    let sessionActive: boolean;

    try {
      sessionActive = await repos.sessions.touch(
        sessionId,
        device,
        address,
      );
    } catch (error) {
      console.error(
        "[auth] Session validation failed:",
        error instanceof Error ? error.message : "Unknown error",
      );

      throw new ApiError(
        "UNAUTHENTICATED",
        "Unable to validate your session. Please sign in again",
      );
    }

    if (!sessionActive) {
      console.warn(
        "[auth] Session rejected: session is inactive or revoked",
      );

      throw new ApiError(
        "UNAUTHENTICATED",
        "This sign-in has been revoked. Sign in again",
      );
    }

    // STEP 4: Retrieve the user's roles and assigned plant.
    let roles;
    let plant;

    try {
      [roles, plant] = await Promise.all([
        repos.roles.forUser(userId),
        repos.roles.plantFor(userId),
      ]);
    } catch (error) {
      console.error(
        "[auth] User role lookup failed:",
        error instanceof Error ? error.message : "Unknown error",
      );

      throw error;
    }

    const role = highestRole(roles);

    // STEP 5: Attach the authenticated user to the request.
    c.set("user", {
      id: userId,
      role,
      plant,
      sessionId,
    });

    c.set("repos", repos);

    await next();
  },
);

/**
 * Checks whether the authenticated user's role
 * has permission to access a particular resource.
 */
export function requirePermission(permission: Permission) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!can(c.var.user.role, permission)) {
      throw new ApiError(
        "FORBIDDEN",
        "Your role does not allow this",
      );
    }

    await next();
  });
}