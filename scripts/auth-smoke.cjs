#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createTRPCProxyClient, httpLink } = require("@trpc/client");
const superjson = require("superjson");

function parseDotEnv(dotEnvPath) {
  if (!fs.existsSync(dotEnvPath)) {
    return {};
  }

  const raw = fs.readFileSync(dotEnvPath, "utf8");
  const values = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

function getEnv(name, dotEnvValues) {
  const value = process.env[name] || dotEnvValues[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function firebaseRequest(apiKey, action, body) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/${action}?key=${apiKey}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
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

async function main() {
  const repoRoot = process.cwd();
  const dotEnvValues = parseDotEnv(path.join(repoRoot, ".env"));
  const firebaseApiKey = getEnv("EXPO_PUBLIC_FIREBASE_API_KEY", dotEnvValues);
  const apiBaseUrl = getEnv("EXPO_PUBLIC_API_BASE_URL", dotEnvValues).replace(/\/+$/, "");
  const runId = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const email = `auth.smoke.${runId}@example.com`;
  const firstPassword = `Owezy!${crypto.randomBytes(6).toString("hex")}A`;
  const secondPassword = `Owezy!${crypto.randomBytes(6).toString("hex")}B`;
  const firstDisplayName = `Auth${runId.slice(-6)}`.slice(0, 15);
  const secondDisplayName = `Retry${runId.slice(-6)}`.slice(0, 15);
  const phone = "(555) 123-4567";

  let activeIdToken = null;

  const client = createTRPCProxyClient({
    links: [
      httpLink({
        url: `${apiBaseUrl}/api/trpc`,
        transformer: superjson,
        headers() {
          return activeIdToken
            ? { authorization: `Bearer ${activeIdToken}` }
            : {};
        },
      }),
    ],
  });

  let firstMe = null;
  let recreatedMe = null;

  try {
    console.log(`[auth-smoke] starting run ${runId}`);
    console.log(`[auth-smoke] firebase signup: ${email}`);

    const firstSignup = await firebaseRequest(firebaseApiKey, "accounts:signUp", {
      email,
      password: firstPassword,
      returnSecureToken: true,
    });
    activeIdToken = firstSignup.idToken;

    const firstProfile = await client.users.signup.mutate({
      displayName: firstDisplayName,
      phone,
    });
    assert(firstProfile?.user?.email === email, "Backend signup did not return the expected email.");
    assert(firstProfile?.user?.displayName === firstDisplayName, "Backend signup display name mismatch.");
    assert(firstProfile?.user?.phone === phone, "Backend signup phone mismatch.");

    firstMe = await client.users.me.query();
    assert(firstMe?.email === email, "users.me did not return the signed-up email.");
    assert(firstMe?.displayName === firstDisplayName, "users.me display name mismatch after signup.");

    console.log("[auth-smoke] firebase login + backend me");
    const firstLogin = await firebaseRequest(firebaseApiKey, "accounts:signInWithPassword", {
      email,
      password: firstPassword,
      returnSecureToken: true,
    });
    activeIdToken = firstLogin.idToken;

    const meAfterLogin = await client.users.me.query();
    assert(meAfterLogin?.email === email, "Login session could not read backend profile.");
    assert(meAfterLogin?.id === firstMe?.id, "Login returned a different backend user id.");

    console.log("[auth-smoke] backend delete account");
    await client.users.deleteAccount.mutate();
    activeIdToken = null;

    let reuseBlockedAsExpected = false;
    try {
      await firebaseRequest(firebaseApiKey, "accounts:signInWithPassword", {
        email,
        password: firstPassword,
        returnSecureToken: true,
      });
    } catch (error) {
      const message = String(error?.message || "");
      reuseBlockedAsExpected =
        message.includes("EMAIL_NOT_FOUND") ||
        message.includes("INVALID_LOGIN_CREDENTIALS") ||
        message.includes("INVALID_PASSWORD");
    }
    assert(reuseBlockedAsExpected, "Deleted Firebase account was still able to sign in.");

    console.log("[auth-smoke] recreate same email after delete");
    const secondSignup = await firebaseRequest(firebaseApiKey, "accounts:signUp", {
      email,
      password: secondPassword,
      returnSecureToken: true,
    });
    activeIdToken = secondSignup.idToken;

    const recreatedProfile = await client.users.signup.mutate({
      displayName: secondDisplayName,
    });
    assert(recreatedProfile?.user?.email === email, "Recreated backend profile email mismatch.");
    assert(recreatedProfile?.user?.displayName === secondDisplayName, "Recreated backend profile display name mismatch.");

    recreatedMe = await client.users.me.query();
    assert(recreatedMe?.email === email, "Recreated account could not load backend profile.");
    assert(recreatedMe?.id, "Recreated account did not return a backend id.");

    console.log("[auth-smoke] cleanup");
    await client.users.deleteAccount.mutate();
    activeIdToken = null;

    console.log("[auth-smoke] PASS");
    console.log(
      JSON.stringify(
        {
          email,
          firstUserId: firstMe?.id ?? null,
          recreatedUserId: recreatedMe?.id ?? null,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (activeIdToken) {
      try {
        await firebaseRequest(firebaseApiKey, "accounts:delete", {
          idToken: activeIdToken,
        });
        console.log("[auth-smoke] cleaned up temporary Firebase user after failure");
      } catch (cleanupError) {
        console.error("[auth-smoke] cleanup failed", cleanupError?.message || cleanupError);
      }
    }
    throw error;
  }
}

main().catch((error) => {
  console.error("[auth-smoke] FAIL");
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
