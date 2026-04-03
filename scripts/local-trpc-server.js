#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const express = require("../functions/node_modules/express");
const cors = require("../functions/node_modules/cors");
const trpcExpress = require("@trpc/server/adapters/express");

function loadDotEnvIfPresent(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnvIfPresent(path.resolve(".env"));
loadDotEnvIfPresent(path.resolve("functions/.env"));
if (!process.env.OWEZY_STORE_MODE) {
  process.env.OWEZY_STORE_MODE = "sqlite-file";
}

const { store } = require("../functions/lib/backend/store");
const { appRouter } = require("../functions/lib/backend/trpc/app-router");

function getAllowedOrigins() {
  const raw = (process.env.OWEZY_ALLOWED_ORIGINS || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

const app = express();
const isProduction =
  process.env.NODE_ENV === "production" || Boolean(process.env.K_SERVICE);
const allowedOrigins = getAllowedOrigins();

app.use(
  cors({
    origin(origin, callback) {
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
  next();
});

app.use(express.json({ limit: "10mb" }));

async function createContext({ req }) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  let userId = null;
  let authToken = null;
  if (token) {
    const tokenData = await store.validateToken(token);
    if (tokenData) {
      userId = tokenData.userId;
      authToken = token;
    }
  }
  return {
    req,
    userId,
    authToken,
  };
}

app.use(
  "/api/trpc",
  trpcExpress.createExpressMiddleware({
    router: appRouter,
    createContext,
  }),
);

app.get("/", (_req, res) => {
  res.json({ status: "ok", message: "Owezy local API is running" });
});

const port = Number(process.env.PORT || 8787);
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`[local-trpc-server] Listening on http://127.0.0.1:${port}`);
  console.log(`[local-trpc-server] OWEZY_STORE_MODE=${process.env.OWEZY_STORE_MODE}`);
});

function shutdown(signal) {
  console.log(`[local-trpc-server] Received ${signal}, shutting down...`);
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
