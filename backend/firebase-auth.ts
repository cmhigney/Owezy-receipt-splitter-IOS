import { Buffer } from "node:buffer";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

export type VerifiedAuthContext = {
  uid: string;
  email: string | null;
  emailVerified: boolean;
};

const FIREBASE_RUNTIME = Boolean(
  process.env.K_SERVICE || process.env.FUNCTION_TARGET || process.env.FIREBASE_CONFIG,
);
const ALLOW_INSECURE_LOCAL_AUTH =
  process.env.OWEZY_ALLOW_INSECURE_LOCAL_AUTH === "1";

function ensureAdminApp() {
  if (!getApps().length) {
    initializeApp();
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;

  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padLength = (4 - (payload.length % 4)) % 4;
    const normalized = `${payload}${"=".repeat(padLength)}`;
    const raw = Buffer.from(normalized, "base64").toString("utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function decodeUnverifiedLocalToken(token: string): VerifiedAuthContext | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;

  const uid = typeof payload.user_id === "string"
    ? payload.user_id
    : typeof payload.sub === "string"
      ? payload.sub
      : null;

  if (!uid) return null;

  const email = typeof payload.email === "string" ? payload.email : null;
  return {
    uid,
    email,
    emailVerified: payload.email_verified === true,
  };
}

export async function verifyBearerToken(token: string): Promise<VerifiedAuthContext | null> {
  if (!token) return null;

  const allowUnverifiedLocalAuth =
    !FIREBASE_RUNTIME &&
    process.env.NODE_ENV !== "production" &&
    ALLOW_INSECURE_LOCAL_AUTH;
  if (allowUnverifiedLocalAuth) {
    return decodeUnverifiedLocalToken(token);
  }

  ensureAdminApp();
  const decoded = await getAuth().verifyIdToken(token);
  return {
    uid: decoded.uid,
    email: typeof decoded.email === "string" ? decoded.email : null,
    emailVerified: decoded.email_verified === true,
  };
}

export async function getFirebaseUserByEmail(email: string) {
  ensureAdminApp();
  return getAuth().getUserByEmail(email);
}

export async function createFirebaseUser(params: {
  uid: string;
  email: string;
  password: string;
  displayName?: string;
  emailVerified?: boolean;
}) {
  ensureAdminApp();
  return getAuth().createUser({
    uid: params.uid,
    email: params.email,
    password: params.password,
    displayName: params.displayName,
    emailVerified: params.emailVerified ?? false,
  });
}

export async function updateFirebaseUserByUid(
  uid: string,
  params: {
    email?: string;
    password?: string;
    displayName?: string;
    emailVerified?: boolean;
  },
) {
  ensureAdminApp();
  return getAuth().updateUser(uid, params);
}

export async function deleteFirebaseUserByUid(uid: string) {
  ensureAdminApp();
  return getAuth().deleteUser(uid);
}
