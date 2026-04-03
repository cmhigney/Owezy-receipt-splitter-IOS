#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createTRPCProxyClient, httpLink } = require("@trpc/client");
const superjson = require("superjson");

function parseDotEnv(dotEnvPath) {
  if (!fs.existsSync(dotEnvPath)) return {};
  const raw = fs.readFileSync(dotEnvPath, "utf8");
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function getEnv(name, dotEnvValues) {
  return process.env[name] || dotEnvValues[name] || "";
}

async function firebaseRequest(apiKey, action, body) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/${action}?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.error) {
    const message = json?.error?.message || response.statusText || "Firebase request failed";
    const error = new Error(message);
    error.response = json;
    throw error;
  }

  return json;
}

function detectMimeTypeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".heic") return "image/heic";
  if (ext === ".heif") return "image/heif";
  if (ext === ".pdf") return "application/pdf";
  return "image/jpeg";
}

function safeRound(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function parseArgs(argv) {
  const files = [];
  let scanRegion = null;

  for (const arg of argv) {
    if (arg.startsWith("--scan-region=")) {
      const values = arg
        .slice("--scan-region=".length)
        .split(",")
        .map((value) => Number(value.trim()));
      if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
        throw new Error("Invalid --scan-region. Use --scan-region=x,y,width,height");
      }
      scanRegion = {
        x: values[0],
        y: values[1],
        width: values[2],
        height: values[3],
      };
      continue;
    }

    files.push(path.resolve(arg));
  }

  return { files, scanRegion };
}

function summarizeParsed(parsed) {
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const repeatedDollarSmashCount = items.filter(
    (item) =>
      String(item?.name || "").toLowerCase().includes("dollar single smash burger") &&
      Math.abs(Number(item?.price) - 1) < 0.001,
  ).length;

  return {
    restaurantName: parsed?.restaurantName || "",
    itemCount: items.length,
    items: items.map((item) => ({
      name: item.name,
      price: safeRound(item.price),
      quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
    })),
    subtotal: safeRound(parsed?.subtotal),
    tax: safeRound(parsed?.tax),
    tip: safeRound(parsed?.tip),
    total: safeRound(parsed?.total),
    repeatedDollarSmashCount,
    autoGratuityDetected: Boolean(parsed?.autoGratuity?.detected),
  };
}

async function main() {
  const { files, scanRegion } = parseArgs(process.argv.slice(2));
  if (files.length === 0) {
    throw new Error("Pass one or more image paths.");
  }

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing file: ${filePath}`);
    }
  }

  const repoRoot = process.cwd();
  const dotEnvValues = parseDotEnv(path.join(repoRoot, ".env"));
  const firebaseApiKey = getEnv("EXPO_PUBLIC_FIREBASE_API_KEY", dotEnvValues);
  const apiBaseUrl = getEnv("EXPO_PUBLIC_API_BASE_URL", dotEnvValues).replace(/\/+$/, "");

  if (!firebaseApiKey) {
    throw new Error("Missing EXPO_PUBLIC_FIREBASE_API_KEY");
  }
  if (!apiBaseUrl) {
    throw new Error("Missing EXPO_PUBLIC_API_BASE_URL");
  }

  const runId = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const email = `scan.compare.${runId}@example.com`;
  const password = `Owezy!${crypto.randomBytes(6).toString("hex")}A`;
  const displayName = `Scan${runId.slice(-6)}`.slice(0, 15);

  let activeIdToken = null;

  const client = createTRPCProxyClient({
    links: [
      httpLink({
        url: `${apiBaseUrl}/api/trpc`,
        transformer: superjson,
        headers() {
          return activeIdToken ? { authorization: `Bearer ${activeIdToken}` } : {};
        },
      }),
    ],
  });

  try {
    const signup = await firebaseRequest(firebaseApiKey, "accounts:signUp", {
      email,
      password,
      returnSecureToken: true,
    });
    activeIdToken = signup.idToken;

    await client.users.signup.mutate({ displayName });

    const results = [];
    for (const filePath of files) {
      try {
        const base64 = fs.readFileSync(filePath, { encoding: "base64" });
        const parsed = await client.scans.parseReceipt.mutate({
          imageBase64: base64,
          mimeType: detectMimeTypeFromPath(filePath),
          scanRegion: scanRegion || undefined,
        });
        results.push({
          filePath,
          status: "ok",
          summary: summarizeParsed(parsed),
        });
      } catch (error) {
        results.push({
          filePath,
          status: "error",
          error: String(error?.message || error || "UNKNOWN_ERROR").replace(/^TRPCClientError:\s*/i, ""),
        });
      }
    }

    console.log(JSON.stringify({ email, apiBaseUrl, scanRegion, results }, null, 2));
  } finally {
    if (activeIdToken) {
      try {
        await client.users.deleteAccount.mutate();
      } catch {
        try {
          await firebaseRequest(firebaseApiKey, "accounts:delete", { idToken: activeIdToken });
        } catch {
          // ignore cleanup failures
        }
      }
    }
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
