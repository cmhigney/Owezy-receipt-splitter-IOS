import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { appRouter } from "./trpc/app-router";
import { createContext } from "./trpc/create-context";

const app = new Hono();
const MAX_API_BODY_BYTES = 10 * 1024 * 1024;

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
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return origin;
      if (allowedOrigins.length === 0) {
        return isProduction ? undefined : origin;
      }
      return allowedOrigins.includes(origin) ? origin : undefined;
    },
    credentials: false,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use("*", async (c, next) => {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Cross-Origin-Resource-Policy", "same-site");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header("Cache-Control", "no-store");
  await next();
});
app.use("/api/trpc/*", async (c, next) => {
  const contentLengthRaw = c.req.header("content-length");
  const contentLength = Number(contentLengthRaw ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_API_BODY_BYTES) {
    return c.json(
      {
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: "Request body too large.",
        },
      },
      413,
    );
  }
  await next();
});

app.use(
  "/api/trpc/*",
  trpcServer({
    endpoint: "/api/trpc",
    router: appRouter,
    createContext,
  }),
);

app.get("/", (c) => {
  return c.json({ status: "ok", message: "Owezy API is running" });
});

export default app;
