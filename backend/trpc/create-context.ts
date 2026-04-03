import { initTRPC, TRPCError } from "@trpc/server";
import { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import { verifyBearerToken } from "../firebase-auth";
import {
  RateLimitExceededError,
  assertWithinRateLimit,
  getClientIpHash,
} from "../security/request-security";

async function resolveAuthFromBearerToken(token: string | null | undefined) {
  let userId: string | null = null;
  let authEmail: string | null = null;
  let authEmailVerified = false;

  if (!token) {
    return { userId, authEmail, authEmailVerified };
  }

  try {
    const tokenData = await verifyBearerToken(token);
    if (tokenData) {
      userId = tokenData.uid;
      authEmail = tokenData.email;
      authEmailVerified = tokenData.emailVerified;
    }
  } catch (error) {
    console.warn("[auth] Failed to verify bearer token for fetch request.", error);
  }

  return { userId, authEmail, authEmailVerified };
}

export const createContext = async (opts: FetchCreateContextFnOptions) => {
  const authHeader = opts.req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");

  const { userId, authEmail, authEmailVerified } = await resolveAuthFromBearerToken(token);

  return {
    req: opts.req,
    userId,
    authEmail,
    authEmailVerified,
  };
};

export type Context = Awaited<ReturnType<typeof createContext>>;

function readRateLimitNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(raw)));
}

const PUBLIC_RATE_LIMIT_WINDOW_MS = readRateLimitNumber(
  "OWEZY_PUBLIC_RATE_LIMIT_WINDOW_MS",
  5 * 60 * 1000,
  10_000,
  60 * 60 * 1000,
);
const PUBLIC_RATE_LIMIT_MAX_PER_IP = readRateLimitNumber(
  "OWEZY_PUBLIC_RATE_LIMIT_MAX_PER_IP",
  180,
  20,
  10_000,
);
const PUBLIC_RATE_LIMIT_MAX_PER_USER = readRateLimitNumber(
  "OWEZY_PUBLIC_RATE_LIMIT_MAX_PER_USER",
  90,
  10,
  10_000,
);
const PROTECTED_RATE_LIMIT_WINDOW_MS = readRateLimitNumber(
  "OWEZY_PROTECTED_RATE_LIMIT_WINDOW_MS",
  5 * 60 * 1000,
  10_000,
  60 * 60 * 1000,
);
const PROTECTED_RATE_LIMIT_MAX_PER_IP = readRateLimitNumber(
  "OWEZY_PROTECTED_RATE_LIMIT_MAX_PER_IP",
  600,
  50,
  20_000,
);
const PROTECTED_RATE_LIMIT_MAX_PER_USER = readRateLimitNumber(
  "OWEZY_PROTECTED_RATE_LIMIT_MAX_PER_USER",
  300,
  20,
  20_000,
);

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    const retryAfterMs =
      error.cause instanceof RateLimitExceededError
        ? error.cause.retryAfterMs
        : error instanceof RateLimitExceededError
          ? error.retryAfterMs
          : 0;

    return {
      ...shape,
      data: {
        ...shape.data,
        ...(retryAfterMs > 0 ? { retryAfterMs } : {}),
      },
    };
  },
});

export const createTRPCRouter = t.router;

const publicRateLimitMiddleware = t.middleware(async ({ ctx, path, type, next }) => {
  const clientIpHash = getClientIpHash(ctx.req);
  const routeScope = `${type}:${path}`;

  // Apply a baseline per-IP limit to every public procedure so new routes do not ship unthrottled.
  await assertWithinRateLimit({
    key: `trpc:public:${routeScope}:ip:${clientIpHash}`,
    maxRequests: PUBLIC_RATE_LIMIT_MAX_PER_IP,
    windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
  });

  // If a public procedure is called with an authenticated user, apply a user-level budget as well.
  if (ctx.userId) {
    await assertWithinRateLimit({
      key: `trpc:public:${routeScope}:user:${ctx.userId}`,
      maxRequests: PUBLIC_RATE_LIMIT_MAX_PER_USER,
      windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
    });
  }

  return next();
});

const protectedRateLimitAndAuthMiddleware = t.middleware(async ({ ctx, path, type, next }) => {
  const clientIpHash = getClientIpHash(ctx.req);
  const routeScope = `${type}:${path}`;

  await assertWithinRateLimit({
    key: `trpc:protected:${routeScope}:ip:${clientIpHash}`,
    maxRequests: PROTECTED_RATE_LIMIT_MAX_PER_IP,
    windowMs: PROTECTED_RATE_LIMIT_WINDOW_MS,
  });

  if (!ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }

  await assertWithinRateLimit({
    key: `trpc:protected:${routeScope}:user:${ctx.userId}`,
    maxRequests: PROTECTED_RATE_LIMIT_MAX_PER_USER,
    windowMs: PROTECTED_RATE_LIMIT_WINDOW_MS,
  });

  return next({ ctx: { ...ctx, userId: ctx.userId } });
});

export const publicProcedure = t.procedure.use(publicRateLimitMiddleware);

export const protectedProcedure = t.procedure.use(protectedRateLimitAndAuthMiddleware);
