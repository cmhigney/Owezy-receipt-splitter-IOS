import cors from "cors";
import express from "express";
import { onRequest } from "firebase-functions/v2/https";
import * as trpcExpress from "@trpc/server/adapters/express";

import { verifyBearerToken } from "../../backend/firebase-auth";
import { appRouter } from "../../backend/trpc/app-router";

const app = express();

function getAllowedOrigins(): string[] {
  const raw = process.env.OWEZY_ALLOWED_ORIGINS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

const isProduction = process.env.NODE_ENV === "production" || Boolean(process.env.K_SERVICE);
const allowedOrigins = getAllowedOrigins();

app.use(
  cors({
    origin(origin, callback) {
      // Native app requests have no Origin header.
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.length === 0) {
        callback(null, !isProduction);
        return;
      }

      callback(null, allowedOrigins.includes(origin));
    },
    credentials: false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(express.json({ limit: "10mb" }));
app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  const bodyTooLarge =
    typeof error === "object" &&
    error !== null &&
    ("type" in error || "status" in error) &&
    (((error as { type?: unknown }).type === "entity.too.large") ||
      ((error as { status?: unknown }).status === 413));

  if (bodyTooLarge) {
    res.status(413).json({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "Request body too large.",
      },
    });
    return;
  }

  next(error);
});

async function resolveAuthFromBearerToken(token: string | undefined) {
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
    console.warn("[auth] Failed to verify bearer token for express request.", error);
  }

  return { userId, authEmail, authEmailVerified };
}

const createContext = async ({ req }: trpcExpress.CreateExpressContextOptions) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace(/^Bearer\s+/i, "");

  const { userId, authEmail, authEmailVerified } = await resolveAuthFromBearerToken(token);

  return {
    req: req as unknown as Request,
    userId,
    authEmail,
    authEmailVerified,
  };
};

app.use(
  "/api/trpc",
  trpcExpress.createExpressMiddleware({
    router: appRouter,
    createContext,
  }),
);

app.get("/", (_req, res) => {
  res.json({ status: "ok", message: "Owezy Firebase API is running" });
});

export const backend = onRequest(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 60,
    invoker: "public",
  },
  app,
);
