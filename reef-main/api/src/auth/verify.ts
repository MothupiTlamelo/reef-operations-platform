


import {
  createLocalJWKSet,
  jwtVerify,
  type JWTPayload,
} from "jose";

export type VerifiedToken = {
  userId: string;
  sessionId: string;
};

export type TokenVerifier = (
  token: string,
) => Promise<VerifiedToken>;

type JwksResolver = ReturnType<typeof createLocalJWKSet>;

export function supabaseVerifier(
  supabaseUrl: string,
  publishableKey: string,
): TokenVerifier {
  const normalizedUrl = supabaseUrl.replace(/\/+$/, "");
  const issuer = `${normalizedUrl}/auth/v1`;
  const jwksUrl = `${issuer}/.well-known/jwks.json`;

  let jwksResolver: JwksResolver | undefined;
  let jwksFetchedAt = 0;
  let jwksRequest: Promise<JwksResolver> | undefined;

  async function getJwks(
    forceRefresh = false,
  ): Promise<JwksResolver> {
    const cacheIsFresh =
      jwksResolver !== undefined &&
      Date.now() - jwksFetchedAt < 10 * 60 * 1000;

    if (!forceRefresh && jwksResolver && cacheIsFresh) {
      return jwksResolver;
    }

    if (jwksRequest) {
      return jwksRequest;
    }

    const request = (async (): Promise<JwksResolver> => {
      let response: Response;

      try {
        response = await fetch(jwksUrl, {
          method: "GET",
          headers: {
            apikey: publishableKey,
            Accept: "application/json",
          },
        });
      } catch (error) {
        if (error instanceof Error) {
          const cause =
            error.cause instanceof Error
              ? `${error.cause.name}: ${error.cause.message}`
              : error.cause
                ? String(error.cause)
                : "No additional cause";

          throw new Error(
            `Supabase JWKS fetch failed: ${error.message}. Details: ${cause}`,
          );
        }

        throw new Error(
          `Supabase JWKS fetch failed: ${String(error)}`,
        );
      }

      if (!response.ok) {
        throw new Error(
          `Could not retrieve Supabase signing keys: HTTP ${response.status}`,
        );
      }

      const body: unknown = await response.json();

      if (
        !body ||
        typeof body !== "object" ||
        !("keys" in body) ||
        !Array.isArray(body.keys) ||
        body.keys.length === 0
      ) {
        throw new Error(
          "Supabase returned an invalid or empty JWKS response",
        );
      }

      const resolver = createLocalJWKSet(
        body as Parameters<typeof createLocalJWKSet>[0],
      );

      jwksResolver = resolver;
      jwksFetchedAt = Date.now();

      return resolver;
    })();

    jwksRequest = request;

    try {
      return await request;
    } finally {
      if (jwksRequest === request) {
        jwksRequest = undefined;
      }
    }
  }

  return async (token: string): Promise<VerifiedToken> => {
    let resolver = await getJwks();
    let payload: JWTPayload;

    try {
      ({ payload } = await jwtVerify(token, resolver, {
        issuer,
        audience: "authenticated",
      }));
    } catch (error) {
      const errorCode =
        error &&
        typeof error === "object" &&
        "code" in error
          ? error.code
          : undefined;

      if (errorCode !== "ERR_JWKS_NO_MATCHING_KEY") {
        throw error;
      }

      // Refresh the signing keys once if the key has rotated.
      resolver = await getJwks(true);

      ({ payload } = await jwtVerify(token, resolver, {
        issuer,
        audience: "authenticated",
      }));
    }

    if (typeof payload.sub !== "string" || !payload.sub) {
      throw new Error("Token has no user ID");
    }

    const sessionId = payload.session_id;

    if (typeof sessionId !== "string" || !sessionId) {
      throw new Error("Token has no session ID");
    }

    return {
      userId: payload.sub,
      sessionId,
    };
  };
}
