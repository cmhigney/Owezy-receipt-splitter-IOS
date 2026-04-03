import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Transaction } from "firebase-admin/firestore";

import { Friend, Split } from "../types";

export interface StoredUser {
  id: string;
  email: string;
  password: string;
  passwordHistory?: string[];
  emailVerified: boolean;
  emailVerifiedAt?: string;
  displayName: string;
  username: string;
  phone?: string;
  profilePicture?: string;
  createdAt: string;
  lastUsernameChangeAt?: string;
  totalReceiptsScanned: number;
  totalAmountSplit: number;
  totalFriendsSplitWith: number;
  venmoUsername?: string;
  cashAppUsername?: string;
  zelleUsername?: string;
  paypalUsername?: string;
}

export interface AuthToken {
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export interface PasswordResetCodeRecord {
  email: string;
  userId: string;
  codeHash: string;
  createdAt: string;
  expiresAt: string;
  attempts: number;
  lastSentAt: string;
  consumedAt?: string;
}

export interface EmailVerificationCodeRecord {
  email: string;
  userId: string;
  codeHash: string;
  createdAt: string;
  expiresAt: string;
  attempts: number;
  lastSentAt: string;
  consumedAt?: string;
}

export interface FriendRequestRecord {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: "pending" | "accepted" | "declined";
  createdAt: string;
  respondedAt?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

const DATA_DIR = path.join(process.cwd(), "backend", "data");
const DATA_FILE = path.join(DATA_DIR, "store.db");
const LEGACY_DATA_FILE = path.join(DATA_DIR, "store.json");
const DEFAULT_TOKEN_TTL_DAYS = 30;
const MAX_SPLITS_PER_USER = 50;
const STORE_MODE = (process.env.OWEZY_STORE_MODE ?? "auto").toLowerCase();
const FIREBASE_RUNTIME = Boolean(
  process.env.K_SERVICE || process.env.FUNCTION_TARGET || process.env.FIREBASE_CONFIG,
);
const RESOLVED_STORE_MODE =
  STORE_MODE === "auto" ? (FIREBASE_RUNTIME ? "firestore" : "sqlite-file") : STORE_MODE;
const USE_FIRESTORE = RESOLVED_STORE_MODE === "firestore";
const VERBOSE_STORE_LOGS = !FIREBASE_RUNTIME && process.env.NODE_ENV !== "production";
const DB_PATH =
  RESOLVED_STORE_MODE === "memory"
    ? ":memory:"
    : process.env.OWEZY_STORE_PATH ?? DATA_FILE;

function logStore(message: string) {
  if (VERBOSE_STORE_LOGS) {
    console.log(message);
  }
}

interface LegacyPersistedStore {
  users: StoredUser[];
  tokens: [string, AuthToken][];
  friendsByUser: [string, Friend[]][];
  splitsByUser: [string, Split[]][];
}

type SQLiteDatabase = any;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function normalizeSplits(splits: Split[]): Split[] {
  return [...splits]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, MAX_SPLITS_PER_USER);
}

function hashTokenForStorage(token: string): string {
  return `tokh_${createHash("sha256").update(token).digest("hex")}`;
}

function fromPersistedUserRecord(row: any): StoredUser {
  const emailVerifiedRaw = row.emailVerified;
  const rawPasswordHistory = row.passwordHistory;
  let passwordHistory: string[] = [];

  if (Array.isArray(rawPasswordHistory)) {
    passwordHistory = rawPasswordHistory.filter((entry): entry is string => typeof entry === "string");
  } else if (typeof rawPasswordHistory === "string" && rawPasswordHistory.trim()) {
    try {
      const parsed = JSON.parse(rawPasswordHistory);
      if (Array.isArray(parsed)) {
        passwordHistory = parsed.filter((entry): entry is string => typeof entry === "string");
      }
    } catch {
      passwordHistory = [];
    }
  }

  return {
    id: row.id,
    email: row.email,
    password: row.password,
    passwordHistory,
    emailVerified: emailVerifiedRaw === true || emailVerifiedRaw === 1 || emailVerifiedRaw === "1",
    emailVerifiedAt: row.emailVerifiedAt ?? undefined,
    displayName: row.displayName,
    username: row.username,
    phone: row.phone ?? undefined,
    profilePicture: row.profilePicture ?? undefined,
    createdAt: row.createdAt,
    lastUsernameChangeAt: row.lastUsernameChangeAt ?? undefined,
    totalReceiptsScanned: Number(row.totalReceiptsScanned) || 0,
    totalAmountSplit: Number(row.totalAmountSplit) || 0,
    totalFriendsSplitWith: Number(row.totalFriendsSplitWith) || 0,
    venmoUsername: row.venmoUsername ?? undefined,
    cashAppUsername: row.cashAppUsername ?? undefined,
    zelleUsername: row.zelleUsername ?? undefined,
    paypalUsername: row.paypalUsername ?? undefined,
  };
}

function toPersistedUserRecord(user: StoredUser) {
  return {
    id: user.id,
    email: user.email,
    password: user.password,
    passwordHistory: user.passwordHistory ?? [],
    emailVerified: user.emailVerified ? 1 : 0,
    emailVerifiedAt: user.emailVerifiedAt ?? null,
    displayName: user.displayName,
    username: user.username,
    phone: user.phone ?? null,
    profilePicture: user.profilePicture ?? null,
    createdAt: user.createdAt,
    lastUsernameChangeAt: user.lastUsernameChangeAt ?? null,
    totalReceiptsScanned: user.totalReceiptsScanned,
    totalAmountSplit: user.totalAmountSplit,
    totalFriendsSplitWith: user.totalFriendsSplitWith,
    venmoUsername: user.venmoUsername ?? null,
    cashAppUsername: user.cashAppUsername ?? null,
    zelleUsername: user.zelleUsername ?? null,
    paypalUsername: user.paypalUsername ?? null,
  };
}

function ensureUserColumns(db: SQLiteDatabase) {
  const columns = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  const names = new Set(columns.map((column) => column.name));

  if (!names.has("emailVerified")) {
    db.exec("ALTER TABLE users ADD COLUMN emailVerified INTEGER NOT NULL DEFAULT 0;");
  }
  if (!names.has("emailVerifiedAt")) {
    db.exec("ALTER TABLE users ADD COLUMN emailVerifiedAt TEXT;");
  }
  if (!names.has("passwordHistory")) {
    db.exec("ALTER TABLE users ADD COLUMN passwordHistory TEXT;");
  }
}

function createDatabase(): SQLiteDatabase {
  if (DB_PATH !== ":memory:") {
    ensureDataDir();
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (path: string) => SQLiteDatabase };
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password TEXT NOT NULL,
      passwordHistory TEXT,
      emailVerified INTEGER NOT NULL DEFAULT 0,
      emailVerifiedAt TEXT,
      displayName TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      phone TEXT,
      profilePicture TEXT,
      createdAt TEXT NOT NULL,
      lastUsernameChangeAt TEXT,
      totalReceiptsScanned INTEGER NOT NULL DEFAULT 0,
      totalAmountSplit REAL NOT NULL DEFAULT 0,
      totalFriendsSplitWith INTEGER NOT NULL DEFAULT 0,
      venmoUsername TEXT,
      cashAppUsername TEXT,
      zelleUsername TEXT,
      paypalUsername TEXT
    );

    CREATE TABLE IF NOT EXISTS tokens (
      token TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      expiresAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_reset_codes (
      email TEXT PRIMARY KEY COLLATE NOCASE,
      userId TEXT NOT NULL,
      codeHash TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      lastSentAt TEXT NOT NULL,
      consumedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS email_verification_codes (
      email TEXT PRIMARY KEY COLLATE NOCASE,
      userId TEXT NOT NULL,
      codeHash TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      lastSentAt TEXT NOT NULL,
      consumedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS friends_by_user (
      userId TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS friend_requests (
      id TEXT PRIMARY KEY,
      fromUserId TEXT NOT NULL,
      toUserId TEXT NOT NULL,
      status TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      respondedAt TEXT,
      UNIQUE (fromUserId, toUserId)
    );

    CREATE TABLE IF NOT EXISTS splits_by_user (
      userId TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scan_usage (
      userId TEXT NOT NULL,
      monthKey TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (userId, monthKey)
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      resetAtMs INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens (userId);
    CREATE INDEX IF NOT EXISTS idx_password_reset_codes_expires_at ON password_reset_codes (expiresAt);
    CREATE INDEX IF NOT EXISTS idx_email_verification_codes_expires_at ON email_verification_codes (expiresAt);
    CREATE INDEX IF NOT EXISTS idx_friend_requests_to_user ON friend_requests (toUserId, createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_friend_requests_from_user ON friend_requests (fromUserId, createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_scan_usage_user ON scan_usage (userId);
    CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits (resetAtMs);
  `);
  ensureUserColumns(db);

  if (RESOLVED_STORE_MODE !== "memory" && !process.env.OWEZY_STORE_PATH) {
    logStore(
      "[store] Using local SQLite file. Set OWEZY_STORE_PATH to a durable mounted path for production.",
    );
  }

  return db;
}

function parseStoredArray<T>(raw: unknown): T[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as T;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, stripUndefinedDeep(entryValue)]);
    return Object.fromEntries(entries) as T;
  }
  return value;
}

function upsertFriendRecord(friends: Friend[], nextFriend: Friend): Friend[] {
  const existing = friends.find(
    (friend) =>
      friend.id === nextFriend.id ||
      (
        friend.username &&
        nextFriend.username &&
        friend.username.toLowerCase() === nextFriend.username.toLowerCase()
      ),
  );

  if (!existing) {
    return [...friends, nextFriend];
  }

  return friends.map((friend) =>
    friend.id === existing.id ? { ...existing, ...nextFriend } : friend,
  );
}

function fromPersistedPasswordResetCodeRecord(row: any): PasswordResetCodeRecord {
  return {
    email: row.email,
    userId: row.userId,
    codeHash: row.codeHash,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    attempts: Number(row.attempts) || 0,
    lastSentAt: row.lastSentAt ?? row.createdAt,
    consumedAt: row.consumedAt ?? undefined,
  };
}

function toPersistedPasswordResetCodeRecord(record: PasswordResetCodeRecord) {
  return {
    email: record.email,
    userId: record.userId,
    codeHash: record.codeHash,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    attempts: record.attempts,
    lastSentAt: record.lastSentAt,
    consumedAt: record.consumedAt ?? null,
  };
}

function fromPersistedEmailVerificationCodeRecord(row: any): EmailVerificationCodeRecord {
  return {
    email: row.email,
    userId: row.userId,
    codeHash: row.codeHash,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    attempts: Number(row.attempts) || 0,
    lastSentAt: row.lastSentAt ?? row.createdAt,
    consumedAt: row.consumedAt ?? undefined,
  };
}

function toPersistedEmailVerificationCodeRecord(record: EmailVerificationCodeRecord) {
  return {
    email: record.email,
    userId: record.userId,
    codeHash: record.codeHash,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    attempts: record.attempts,
    lastSentAt: record.lastSentAt,
    consumedAt: record.consumedAt ?? null,
  };
}

function fromPersistedFriendRequestRecord(row: any): FriendRequestRecord {
  return {
    id: row.id,
    fromUserId: row.fromUserId,
    toUserId: row.toUserId,
    status:
      row.status === "accepted" || row.status === "declined"
        ? row.status
        : "pending",
    createdAt: row.createdAt,
    respondedAt: row.respondedAt ?? undefined,
  };
}

function toPersistedFriendRequestRecord(record: FriendRequestRecord) {
  return {
    id: record.id,
    fromUserId: record.fromUserId,
    toUserId: record.toUserId,
    status: record.status,
    createdAt: record.createdAt,
    respondedAt: record.respondedAt ?? null,
  };
}

function migrateLegacyJson(db: SQLiteDatabase) {
  if (DB_PATH === ":memory:" || !fs.existsSync(LEGACY_DATA_FILE)) {
    return;
  }

  const userCountRow = db
    .prepare("SELECT COUNT(*) AS count FROM users")
    .get() as { count: number };
  if (userCountRow.count > 0) {
    return;
  }

  const raw = fs.readFileSync(LEGACY_DATA_FILE, "utf8");
  if (!raw.trim()) {
    return;
  }

  const parsed = JSON.parse(raw) as Partial<LegacyPersistedStore>;

  for (const user of parsed.users ?? []) {
    db.prepare(
      `
      INSERT OR IGNORE INTO users (
        id, email, password, emailVerified, emailVerifiedAt, displayName, username, phone, profilePicture, createdAt,
        lastUsernameChangeAt, totalReceiptsScanned, totalAmountSplit, totalFriendsSplitWith,
        venmoUsername, cashAppUsername, zelleUsername, paypalUsername
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      user.id,
      user.email,
      user.password,
      (user as StoredUser).emailVerified ? 1 : 0,
      (user as StoredUser).emailVerifiedAt ?? null,
      user.displayName,
      user.username,
      user.phone ?? null,
      user.profilePicture ?? null,
      user.createdAt,
      user.lastUsernameChangeAt ?? null,
      user.totalReceiptsScanned,
      user.totalAmountSplit,
      user.totalFriendsSplitWith,
      user.venmoUsername ?? null,
      user.cashAppUsername ?? null,
      user.zelleUsername ?? null,
      user.paypalUsername ?? null,
    );
  }

  for (const [token, authToken] of parsed.tokens ?? []) {
    db.prepare(
      "INSERT OR IGNORE INTO tokens (token, userId, createdAt, expiresAt) VALUES (?, ?, ?, ?)",
    ).run(token, authToken.userId, authToken.createdAt, authToken.expiresAt);
  }

  for (const [userId, friends] of parsed.friendsByUser ?? []) {
    db.prepare(
      `
      INSERT INTO friends_by_user (userId, data)
      VALUES (?, ?)
      ON CONFLICT(userId) DO UPDATE SET data = excluded.data
      `,
    ).run(userId, JSON.stringify(friends));
  }

  for (const [userId, splits] of parsed.splitsByUser ?? []) {
    db.prepare(
      `
      INSERT INTO splits_by_user (userId, data)
      VALUES (?, ?)
      ON CONFLICT(userId) DO UPDATE SET data = excluded.data
      `,
    ).run(userId, JSON.stringify(normalizeSplits(splits)));
  }

  logStore("[store] Migrated legacy JSON store to SQLite");
}

let db: SQLiteDatabase | null = null;
let firestore: ReturnType<typeof getFirestore> | null = null;

if (USE_FIRESTORE) {
  if (!getApps().length) {
    initializeApp();
  }
  firestore = getFirestore();
  logStore("[store] Firestore store enabled");
} else {
  db = createDatabase();
  migrateLegacyJson(db);
  const initialUserCountRow = db
    .prepare("SELECT COUNT(*) AS count FROM users")
    .get() as { count: number };
  logStore(
    `[store] SQLite store ready (${DB_PATH === ":memory:" ? "memory" : DB_PATH}) with ${initialUserCountRow.count} user(s)`,
  );
}

function requireFirestore() {
  if (!firestore) {
    throw new Error("Firestore store is not initialized");
  }
  return firestore;
}

function requireDb() {
  if (!db) {
    throw new Error("SQLite store is not initialized");
  }
  return db;
}

export const store = {
  async getUserById(id: string): Promise<StoredUser | undefined> {
    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      const snap = await fs.collection("users").doc(id).get();
      return snap.exists ? fromPersistedUserRecord(snap.data()) : undefined;
    }

    const sql = requireDb();
    const row = sql.prepare("SELECT * FROM users WHERE id = ?").get(id);
    return row ? fromPersistedUserRecord(row) : undefined;
  },

  async getUserByEmail(email: string): Promise<StoredUser | undefined> {
    const lower = email.toLowerCase();
    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      const indexSnap = await fs.collection("userEmailIndex").doc(lower).get();
      if (!indexSnap.exists) return undefined;
      const userId = indexSnap.get("userId");
      if (typeof userId !== "string") return undefined;
      return this.getUserById(userId);
    }

    const sql = requireDb();
    const row = sql
      .prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE")
      .get(email);
    return row ? fromPersistedUserRecord(row) : undefined;
  },

  async getUserByUsername(username: string): Promise<StoredUser | undefined> {
    const lower = username.toLowerCase();
    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      const indexSnap = await fs.collection("usernameIndex").doc(lower).get();
      if (!indexSnap.exists) return undefined;
      const userId = indexSnap.get("userId");
      if (typeof userId !== "string") return undefined;
      return this.getUserById(userId);
    }

    const sql = requireDb();
    const row = sql
      .prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
      .get(username);
    return row ? fromPersistedUserRecord(row) : undefined;
  },

  async isUsernameTaken(username: string, excludeUserId?: string): Promise<boolean> {
    const lower = username.toLowerCase();
    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      const indexSnap = await fs.collection("usernameIndex").doc(lower).get();
      if (!indexSnap.exists) return false;
      const userId = indexSnap.get("userId");
      if (typeof userId !== "string") return false;
      if (excludeUserId && userId === excludeUserId) return false;
      return true;
    }

    const sql = requireDb();
    const row = sql
      .prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE")
      .get(username) as { id: string } | undefined;
    if (!row) return false;
    if (excludeUserId && row.id === excludeUserId) return false;
    return true;
  },

  async isEmailTaken(email: string): Promise<boolean> {
    const lower = email.toLowerCase();
    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      const indexSnap = await fs.collection("userEmailIndex").doc(lower).get();
      return indexSnap.exists;
    }

    const sql = requireDb();
    const row = sql
      .prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE")
      .get(email);
    return !!row;
  },

  async createUser(user: StoredUser): Promise<void> {
    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      const emailKey = user.email.toLowerCase();
      const usernameKey = user.username.toLowerCase();
      await fs.runTransaction(async (tx: Transaction) => {
        const userRef = fs.collection("users").doc(user.id);
        const emailRef = fs.collection("userEmailIndex").doc(emailKey);
        const usernameRef = fs.collection("usernameIndex").doc(usernameKey);

        const [userDoc, emailDoc, usernameDoc] = await Promise.all([
          tx.get(userRef),
          tx.get(emailRef),
          tx.get(usernameRef),
        ]);

        if (userDoc.exists || emailDoc.exists || usernameDoc.exists) {
          throw new Error("User uniqueness constraint violated");
        }

        tx.set(userRef, toPersistedUserRecord(user));
        tx.set(emailRef, { userId: user.id });
        tx.set(usernameRef, { userId: user.id });
      });
      logStore("[store] User created");
      return;
    }

    const sql = requireDb();
    sql.prepare(
      `
      INSERT INTO users (
        id, email, password, passwordHistory, emailVerified, emailVerifiedAt, displayName, username, phone, profilePicture, createdAt,
        lastUsernameChangeAt, totalReceiptsScanned, totalAmountSplit, totalFriendsSplitWith,
        venmoUsername, cashAppUsername, zelleUsername, paypalUsername
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      user.id,
      user.email,
      user.password,
      JSON.stringify(user.passwordHistory ?? []),
      user.emailVerified ? 1 : 0,
      user.emailVerifiedAt ?? null,
      user.displayName,
      user.username,
      user.phone ?? null,
      user.profilePicture ?? null,
      user.createdAt,
      user.lastUsernameChangeAt ?? null,
      user.totalReceiptsScanned,
      user.totalAmountSplit,
      user.totalFriendsSplitWith,
      user.venmoUsername ?? null,
      user.cashAppUsername ?? null,
      user.zelleUsername ?? null,
      user.paypalUsername ?? null,
    );
    logStore("[store] User created");
  },

  async updateUser(id: string, updates: Partial<StoredUser>): Promise<StoredUser | undefined> {
    const existing = await this.getUserById(id);
    if (!existing) return undefined;

    const updated: StoredUser = {
      ...existing,
      ...updates,
      id: existing.id,
    };

    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      await fs.runTransaction(async (tx: Transaction) => {
        const userRef = fs.collection("users").doc(id);
        const userDoc = await tx.get(userRef);
        if (!userDoc.exists) {
          return;
        }

        const prev = fromPersistedUserRecord(userDoc.data());
        const prevEmail = prev.email.toLowerCase();
        const prevUsername = prev.username.toLowerCase();
        const nextEmail = updated.email.toLowerCase();
        const nextUsername = updated.username.toLowerCase();

        if (prevEmail !== nextEmail) {
          const nextEmailRef = fs.collection("userEmailIndex").doc(nextEmail);
          const nextEmailDoc = await tx.get(nextEmailRef);
          if (nextEmailDoc.exists && nextEmailDoc.get("userId") !== id) {
            throw new Error("Email already in use");
          }
          tx.delete(fs.collection("userEmailIndex").doc(prevEmail));
          tx.set(nextEmailRef, { userId: id });
        }

        if (prevUsername !== nextUsername) {
          const nextUsernameRef = fs.collection("usernameIndex").doc(nextUsername);
          const nextUsernameDoc = await tx.get(nextUsernameRef);
          if (nextUsernameDoc.exists && nextUsernameDoc.get("userId") !== id) {
            throw new Error("Username already in use");
          }
          tx.delete(fs.collection("usernameIndex").doc(prevUsername));
          tx.set(nextUsernameRef, { userId: id });
        }

        tx.set(userRef, toPersistedUserRecord(updated));
      });
      logStore("[store] User updated");
      return updated;
    }

    const sql = requireDb();
    sql.prepare(
      `
      UPDATE users SET
        email = ?,
        password = ?,
        passwordHistory = ?,
        emailVerified = ?,
        emailVerifiedAt = ?,
        displayName = ?,
        username = ?,
        phone = ?,
        profilePicture = ?,
        createdAt = ?,
        lastUsernameChangeAt = ?,
        totalReceiptsScanned = ?,
        totalAmountSplit = ?,
        totalFriendsSplitWith = ?,
        venmoUsername = ?,
        cashAppUsername = ?,
        zelleUsername = ?,
        paypalUsername = ?
      WHERE id = ?
      `,
    ).run(
      updated.email,
      updated.password,
      JSON.stringify(updated.passwordHistory ?? []),
      updated.emailVerified ? 1 : 0,
      updated.emailVerifiedAt ?? null,
      updated.displayName,
      updated.username,
      updated.phone ?? null,
      updated.profilePicture ?? null,
      updated.createdAt,
      updated.lastUsernameChangeAt ?? null,
      updated.totalReceiptsScanned,
      updated.totalAmountSplit,
      updated.totalFriendsSplitWith,
      updated.venmoUsername ?? null,
      updated.cashAppUsername ?? null,
      updated.zelleUsername ?? null,
      updated.paypalUsername ?? null,
      id,
    );
    logStore("[store] User updated");
    return updated;
  },

  async createToken(userId: string, ttlDays = DEFAULT_TOKEN_TTL_DAYS): Promise<string> {
    const createdAt = new Date();
    const expiresAt = new Date(createdAt);
    expiresAt.setDate(expiresAt.getDate() + ttlDays);
    const token = `tok_${randomBytes(32).toString("base64url")}`;
    const tokenStorageKey = hashTokenForStorage(token);

    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      await fs.collection("tokens").doc(tokenStorageKey).set({
        userId,
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });
      logStore("[store] Token created");
      return token;
    }

    const sql = requireDb();
    sql.prepare(
      "INSERT INTO tokens (token, userId, createdAt, expiresAt) VALUES (?, ?, ?, ?)",
    ).run(tokenStorageKey, userId, createdAt.toISOString(), expiresAt.toISOString());
    logStore("[store] Token created");
    return token;
  },

  async validateToken(token: string): Promise<AuthToken | undefined> {
    const tokenStorageKey = hashTokenForStorage(token);
    let record: AuthToken | undefined;
    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      const hashedSnap = await fs.collection("tokens").doc(tokenStorageKey).get();
      if (hashedSnap.exists) {
        record = hashedSnap.data() as AuthToken;
      } else {
        const legacySnap = await fs.collection("tokens").doc(token).get();
        record = legacySnap.exists ? (legacySnap.data() as AuthToken) : undefined;
      }
    } else {
      const sql = requireDb();
      record = sql
        .prepare("SELECT userId, createdAt, expiresAt FROM tokens WHERE token = ?")
        .get(tokenStorageKey) as AuthToken | undefined;
      if (!record) {
        record = sql
          .prepare("SELECT userId, createdAt, expiresAt FROM tokens WHERE token = ?")
          .get(token) as AuthToken | undefined;
      }
    }

    if (!record) {
      return undefined;
    }

    const now = Date.now();
    const expiresAt = new Date(record.expiresAt).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      await this.deleteToken(token);
      return undefined;
    }

    return record;
  },

  async deleteToken(token: string): Promise<void> {
    const tokenStorageKey = hashTokenForStorage(token);
    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      await Promise.all([
        fs.collection("tokens").doc(tokenStorageKey).delete().catch(() => undefined),
        fs.collection("tokens").doc(token).delete().catch(() => undefined),
      ]);
      return;
    }

    const sql = requireDb();
    sql.prepare("DELETE FROM tokens WHERE token IN (?, ?)").run(tokenStorageKey, token);
  },

  async deleteTokensByUserId(userId: string): Promise<void> {
    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      const tokenSnap = await fs.collection("tokens").where("userId", "==", userId).get();
      await Promise.all(tokenSnap.docs.map((doc) => doc.ref.delete()));
      return;
    }

    const sql = requireDb();
    sql.prepare("DELETE FROM tokens WHERE userId = ?").run(userId);
  },

  async getPasswordResetCodeByEmail(email: string): Promise<PasswordResetCodeRecord | undefined> {
    const lower = email.toLowerCase();

    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      const snap = await fs.collection("password_reset_codes").doc(lower).get();
      if (!snap.exists) return undefined;
      return fromPersistedPasswordResetCodeRecord(snap.data());
    }

    const sql = requireDb();
    const row = sql
      .prepare("SELECT * FROM password_reset_codes WHERE email = ? COLLATE NOCASE")
      .get(lower);
    return row ? fromPersistedPasswordResetCodeRecord(row) : undefined;
  },

  async savePasswordResetCode(record: PasswordResetCodeRecord): Promise<void> {
    const lower = record.email.toLowerCase();
    const nextRecord: PasswordResetCodeRecord = { ...record, email: lower };

    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      await fs
        .collection("password_reset_codes")
        .doc(lower)
        .set(toPersistedPasswordResetCodeRecord(nextRecord));
      return;
    }

    const sql = requireDb();
    sql.prepare(
      `
      INSERT INTO password_reset_codes (email, userId, codeHash, createdAt, expiresAt, attempts, lastSentAt, consumedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        userId = excluded.userId,
        codeHash = excluded.codeHash,
        createdAt = excluded.createdAt,
        expiresAt = excluded.expiresAt,
        attempts = excluded.attempts,
        lastSentAt = excluded.lastSentAt,
        consumedAt = excluded.consumedAt
      `,
    ).run(
      nextRecord.email,
      nextRecord.userId,
      nextRecord.codeHash,
      nextRecord.createdAt,
      nextRecord.expiresAt,
      nextRecord.attempts,
      nextRecord.lastSentAt,
      nextRecord.consumedAt ?? null,
    );
  },

  async deletePasswordResetCodeByEmail(email: string): Promise<void> {
    const lower = email.toLowerCase();

    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      await fs.collection("password_reset_codes").doc(lower).delete();
      return;
    }

    const sql = requireDb();
    sql.prepare("DELETE FROM password_reset_codes WHERE email = ? COLLATE NOCASE").run(lower);
  },

  async getEmailVerificationCodeByEmail(email: string): Promise<EmailVerificationCodeRecord | undefined> {
    const lower = email.toLowerCase();

    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      const snap = await fs.collection("email_verification_codes").doc(lower).get();
      if (!snap.exists) return undefined;
      return fromPersistedEmailVerificationCodeRecord(snap.data());
    }

    const sql = requireDb();
    const row = sql
      .prepare("SELECT * FROM email_verification_codes WHERE email = ? COLLATE NOCASE")
      .get(lower);
    return row ? fromPersistedEmailVerificationCodeRecord(row) : undefined;
  },

  async saveEmailVerificationCode(record: EmailVerificationCodeRecord): Promise<void> {
    const lower = record.email.toLowerCase();
    const nextRecord: EmailVerificationCodeRecord = { ...record, email: lower };

    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      await fs
        .collection("email_verification_codes")
        .doc(lower)
        .set(toPersistedEmailVerificationCodeRecord(nextRecord));
      return;
    }

    const sql = requireDb();
    sql.prepare(
      `
      INSERT INTO email_verification_codes (email, userId, codeHash, createdAt, expiresAt, attempts, lastSentAt, consumedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        userId = excluded.userId,
        codeHash = excluded.codeHash,
        createdAt = excluded.createdAt,
        expiresAt = excluded.expiresAt,
        attempts = excluded.attempts,
        lastSentAt = excluded.lastSentAt,
        consumedAt = excluded.consumedAt
      `,
    ).run(
      nextRecord.email,
      nextRecord.userId,
      nextRecord.codeHash,
      nextRecord.createdAt,
      nextRecord.expiresAt,
      nextRecord.attempts,
      nextRecord.lastSentAt,
      nextRecord.consumedAt ?? null,
    );
  },

  async deleteEmailVerificationCodeByEmail(email: string): Promise<void> {
    const lower = email.toLowerCase();

    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      await fs.collection("email_verification_codes").doc(lower).delete();
      return;
    }

    const sql = requireDb();
    sql.prepare("DELETE FROM email_verification_codes WHERE email = ? COLLATE NOCASE").run(lower);
  },

  async deleteUserById(userId: string): Promise<void> {
    const existing = await this.getUserById(userId);
    if (!existing) {
      return;
    }

    if (USE_FIRESTORE) {
      const fs = requireFirestore();

      const tokenSnap = await fs.collection("tokens").where("userId", "==", userId).get();
      await Promise.all(tokenSnap.docs.map((doc) => doc.ref.delete()));
      const scanUsageSnap = await fs.collection("scan_usage").where("userId", "==", userId).get();
      await Promise.all(scanUsageSnap.docs.map((doc) => doc.ref.delete()));
      const [incomingRequestSnap, outgoingRequestSnap] = await Promise.all([
        fs.collection("friend_requests").where("toUserId", "==", userId).get(),
        fs.collection("friend_requests").where("fromUserId", "==", userId).get(),
      ]);
      await Promise.all([
        ...incomingRequestSnap.docs.map((doc) => doc.ref.delete()),
        ...outgoingRequestSnap.docs.map((doc) => doc.ref.delete()),
      ]);
      await fs.collection("rate_limits").doc(`ocr:${userId}`).delete().catch(() => undefined);

      const batch = fs.batch();
      batch.delete(fs.collection("users").doc(userId));
      batch.delete(fs.collection("userEmailIndex").doc(existing.email.toLowerCase()));
      batch.delete(fs.collection("usernameIndex").doc(existing.username.toLowerCase()));
      batch.delete(fs.collection("friends_by_user").doc(userId));
      batch.delete(fs.collection("splits_by_user").doc(userId));
      batch.delete(fs.collection("password_reset_codes").doc(existing.email.toLowerCase()));
      batch.delete(fs.collection("email_verification_codes").doc(existing.email.toLowerCase()));
      await batch.commit();

      logStore("[store] User deleted");
      return;
    }

    const sql = requireDb();
    sql.prepare("DELETE FROM tokens WHERE userId = ?").run(userId);
    sql.prepare("DELETE FROM friends_by_user WHERE userId = ?").run(userId);
    sql.prepare("DELETE FROM friend_requests WHERE fromUserId = ? OR toUserId = ?").run(userId, userId);
    sql.prepare("DELETE FROM splits_by_user WHERE userId = ?").run(userId);
    sql.prepare("DELETE FROM scan_usage WHERE userId = ?").run(userId);
    sql.prepare("DELETE FROM rate_limits WHERE key = ?").run(`ocr:${userId}`);
    sql.prepare("DELETE FROM password_reset_codes WHERE email = ? COLLATE NOCASE").run(existing.email.toLowerCase());
    sql.prepare("DELETE FROM email_verification_codes WHERE email = ? COLLATE NOCASE").run(existing.email.toLowerCase());
    sql.prepare("DELETE FROM users WHERE id = ?").run(userId);

    logStore("[store] User deleted");
  },

  async getFriends(userId: string): Promise<Friend[]> {
    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      const snap = await fs.collection("friends_by_user").doc(userId).get();
      if (!snap.exists) return [];
      const friends = snap.get("friends");
      return Array.isArray(friends) ? (friends as Friend[]) : [];
    }

    const sql = requireDb();
    const row = sql
      .prepare("SELECT data FROM friends_by_user WHERE userId = ?")
      .get(userId) as { data: string } | undefined;
    return parseStoredArray<Friend>(row?.data);
  },

  async saveFriends(userId: string, friends: Friend[]): Promise<Friend[]> {
    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      const sanitizedFriends = stripUndefinedDeep(friends);
      await fs.collection("friends_by_user").doc(userId).set({ friends: sanitizedFriends });
      return friends;
    }

    const sql = requireDb();
    sql.prepare(
      `
      INSERT INTO friends_by_user (userId, data)
      VALUES (?, ?)
      ON CONFLICT(userId) DO UPDATE SET data = excluded.data
      `,
    ).run(userId, JSON.stringify(friends));
    return friends;
  },

  async getFriendRequestById(id: string): Promise<FriendRequestRecord | undefined> {
    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      const snap = await fs.collection("friend_requests").doc(id).get();
      return snap.exists ? fromPersistedFriendRequestRecord(snap.data()) : undefined;
    }

    const sql = requireDb();
    const row = sql
      .prepare("SELECT * FROM friend_requests WHERE id = ?")
      .get(id);
    return row ? fromPersistedFriendRequestRecord(row) : undefined;
  },

  async getFriendRequestByUsers(
    fromUserId: string,
    toUserId: string,
  ): Promise<FriendRequestRecord | undefined> {
    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      const snap = await fs.collection("friend_requests").doc(`${fromUserId}:${toUserId}`).get();
      return snap.exists ? fromPersistedFriendRequestRecord(snap.data()) : undefined;
    }

    const sql = requireDb();
    const row = sql
      .prepare("SELECT * FROM friend_requests WHERE fromUserId = ? AND toUserId = ?")
      .get(fromUserId, toUserId);
    return row ? fromPersistedFriendRequestRecord(row) : undefined;
  },

  async saveFriendRequest(record: FriendRequestRecord): Promise<FriendRequestRecord> {
    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      await fs
        .collection("friend_requests")
        .doc(record.id)
        .set(toPersistedFriendRequestRecord(record));
      return record;
    }

    const sql = requireDb();
    sql.prepare(
      `
      INSERT INTO friend_requests (id, fromUserId, toUserId, status, createdAt, respondedAt)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        fromUserId = excluded.fromUserId,
        toUserId = excluded.toUserId,
        status = excluded.status,
        createdAt = excluded.createdAt,
        respondedAt = excluded.respondedAt
      `,
    ).run(
      record.id,
      record.fromUserId,
      record.toUserId,
      record.status,
      record.createdAt,
      record.respondedAt ?? null,
    );
    return record;
  },

  async updateFriendRequest(
    id: string,
    updates: Partial<Pick<FriendRequestRecord, "status" | "respondedAt" | "createdAt">>,
  ): Promise<FriendRequestRecord | undefined> {
    const existing = await this.getFriendRequestById(id);
    if (!existing) return undefined;

    return this.saveFriendRequest({
      ...existing,
      ...updates,
    });
  },

  async acceptFriendRequest(params: {
    requestId: string;
    actingUserId: string;
    senderFriend: Friend;
    recipientFriend: Friend;
    respondedAt: string;
  }): Promise<FriendRequestRecord> {
    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      const accepted = await fs.runTransaction(async (tx: Transaction) => {
        const requestRef = fs.collection("friend_requests").doc(params.requestId);
        const requestSnap = await tx.get(requestRef);
        if (!requestSnap.exists) {
          throw new Error("FRIEND_REQUEST_NOT_FOUND");
        }

        const request = fromPersistedFriendRequestRecord(requestSnap.data());
        if (request.toUserId !== params.actingUserId || request.status !== "pending") {
          throw new Error("FRIEND_REQUEST_NOT_FOUND");
        }

        const senderFriendsRef = fs.collection("friends_by_user").doc(request.fromUserId);
        const recipientFriendsRef = fs.collection("friends_by_user").doc(request.toUserId);
        const [senderFriendsSnap, recipientFriendsSnap] = await Promise.all([
          tx.get(senderFriendsRef),
          tx.get(recipientFriendsRef),
        ]);

        const senderFriends = Array.isArray(senderFriendsSnap.get("friends"))
          ? (senderFriendsSnap.get("friends") as Friend[])
          : [];
        const recipientFriends = Array.isArray(recipientFriendsSnap.get("friends"))
          ? (recipientFriendsSnap.get("friends") as Friend[])
          : [];

        const nextSenderFriends = stripUndefinedDeep(
          upsertFriendRecord(senderFriends, params.recipientFriend),
        );
        const nextRecipientFriends = stripUndefinedDeep(
          upsertFriendRecord(recipientFriends, params.senderFriend),
        );

        const nextRequest: FriendRequestRecord = {
          ...request,
          status: "accepted",
          respondedAt: params.respondedAt,
        };

        tx.set(senderFriendsRef, { friends: nextSenderFriends });
        tx.set(recipientFriendsRef, { friends: nextRecipientFriends });
        tx.set(requestRef, toPersistedFriendRequestRecord(nextRequest));
        return nextRequest;
      });

      return accepted;
    }

    const sql = requireDb();
    sql.exec("BEGIN IMMEDIATE");
    try {
      const requestRow = sql
        .prepare("SELECT * FROM friend_requests WHERE id = ?")
        .get(params.requestId);
      if (!requestRow) {
        throw new Error("FRIEND_REQUEST_NOT_FOUND");
      }

      const request = fromPersistedFriendRequestRecord(requestRow);
      if (request.toUserId !== params.actingUserId || request.status !== "pending") {
        throw new Error("FRIEND_REQUEST_NOT_FOUND");
      }

      const senderFriendsRow = sql
        .prepare("SELECT data FROM friends_by_user WHERE userId = ?")
        .get(request.fromUserId) as { data: string } | undefined;
      const recipientFriendsRow = sql
        .prepare("SELECT data FROM friends_by_user WHERE userId = ?")
        .get(request.toUserId) as { data: string } | undefined;

      const senderFriends = parseStoredArray<Friend>(senderFriendsRow?.data);
      const recipientFriends = parseStoredArray<Friend>(recipientFriendsRow?.data);
      const nextSenderFriends = upsertFriendRecord(senderFriends, params.recipientFriend);
      const nextRecipientFriends = upsertFriendRecord(recipientFriends, params.senderFriend);

      sql.prepare(
        `
        INSERT INTO friends_by_user (userId, data)
        VALUES (?, ?)
        ON CONFLICT(userId) DO UPDATE SET data = excluded.data
        `,
      ).run(request.fromUserId, JSON.stringify(nextSenderFriends));
      sql.prepare(
        `
        INSERT INTO friends_by_user (userId, data)
        VALUES (?, ?)
        ON CONFLICT(userId) DO UPDATE SET data = excluded.data
        `,
      ).run(request.toUserId, JSON.stringify(nextRecipientFriends));
      sql.prepare(
        "UPDATE friend_requests SET status = ?, respondedAt = ? WHERE id = ?",
      ).run("accepted", params.respondedAt, params.requestId);

      sql.exec("COMMIT");
      return {
        ...request,
        status: "accepted",
        respondedAt: params.respondedAt,
      };
    } catch (error) {
      sql.exec("ROLLBACK");
      throw error;
    }
  },

  async listIncomingFriendRequests(userId: string): Promise<FriendRequestRecord[]> {
    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      const snap = await fs
        .collection("friend_requests")
        .where("toUserId", "==", userId)
        .get();

      return snap.docs
        .map((doc) => fromPersistedFriendRequestRecord(doc.data()))
        .filter((request) => request.status === "pending")
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    const sql = requireDb();
    const rows = sql
      .prepare(
        "SELECT * FROM friend_requests WHERE toUserId = ? AND status = 'pending' ORDER BY createdAt DESC",
      )
      .all(userId) as any[];
    return rows.map((row) => fromPersistedFriendRequestRecord(row));
  },

  async listOutgoingFriendRequests(userId: string): Promise<FriendRequestRecord[]> {
    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      const snap = await fs
        .collection("friend_requests")
        .where("fromUserId", "==", userId)
        .get();

      return snap.docs
        .map((doc) => fromPersistedFriendRequestRecord(doc.data()))
        .filter((request) => request.status === "pending")
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    const sql = requireDb();
    const rows = sql
      .prepare(
        "SELECT * FROM friend_requests WHERE fromUserId = ? AND status = 'pending' ORDER BY createdAt DESC",
      )
      .all(userId) as any[];
    return rows.map((row) => fromPersistedFriendRequestRecord(row));
  },

  async getSplits(userId: string): Promise<Split[]> {
    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      const snap = await fs.collection("splits_by_user").doc(userId).get();
      if (!snap.exists) return [];
      const splits = snap.get("splits");
      return normalizeSplits(Array.isArray(splits) ? (splits as Split[]) : []);
    }

    const sql = requireDb();
    const row = sql
      .prepare("SELECT data FROM splits_by_user WHERE userId = ?")
      .get(userId) as { data: string } | undefined;
    return normalizeSplits(parseStoredArray<Split>(row?.data));
  },

  async saveSplits(userId: string, splits: Split[]): Promise<Split[]> {
    const normalized = normalizeSplits(splits);

    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      const sanitizedSplits = stripUndefinedDeep(normalized);
      await fs.collection("splits_by_user").doc(userId).set({ splits: sanitizedSplits });
      return normalized;
    }

    const sql = requireDb();
    sql.prepare(
      `
      INSERT INTO splits_by_user (userId, data)
      VALUES (?, ?)
      ON CONFLICT(userId) DO UPDATE SET data = excluded.data
      `,
    ).run(userId, JSON.stringify(normalized));
    return normalized;
  },

  async getMonthlyScanUsage(userId: string, monthKey: string): Promise<number> {
    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      const docId = `${userId}_${monthKey}`;
      const snap = await fs.collection("scan_usage").doc(docId).get();
      if (!snap.exists) return 0;
      const count = Number(snap.get("count"));
      return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    }

    const sql = requireDb();
    const row = sql
      .prepare("SELECT count FROM scan_usage WHERE userId = ? AND monthKey = ?")
      .get(userId, monthKey) as { count: number } | undefined;
    if (!row) return 0;
    const count = Number(row.count);
    return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  },

  async incrementMonthlyScanUsage(userId: string, monthKey: string, by = 1): Promise<number> {
    const step = Math.max(1, Math.floor(by));
    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      const docId = `${userId}_${monthKey}`;
      const ref = fs.collection("scan_usage").doc(docId);
      const next = await fs.runTransaction(async (tx: Transaction) => {
        const snap = await tx.get(ref);
        const current = snap.exists ? Number(snap.get("count")) : 0;
        const normalizedCurrent = Number.isFinite(current) ? Math.max(0, Math.floor(current)) : 0;
        const updated = normalizedCurrent + step;
        tx.set(ref, {
          userId,
          monthKey,
          count: updated,
          updatedAt: new Date().toISOString(),
        });
        return updated;
      });
      return next;
    }

    const sql = requireDb();
    sql.prepare(
      `
      INSERT INTO scan_usage (userId, monthKey, count)
      VALUES (?, ?, ?)
      ON CONFLICT(userId, monthKey) DO UPDATE SET count = count + excluded.count
      `,
    ).run(userId, monthKey, step);

    const row = sql
      .prepare("SELECT count FROM scan_usage WHERE userId = ? AND monthKey = ?")
      .get(userId, monthKey) as { count: number };
    return Number.isFinite(Number(row?.count)) ? Math.max(0, Math.floor(Number(row.count))) : 0;
  },

  async consumeRateLimit(key: string, maxRequests: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const nextResetAtMs = now + windowMs;

    if (USE_FIRESTORE) {
      const fs = requireFirestore();
      const ref = fs.collection("rate_limits").doc(key);
      return fs.runTransaction(async (tx: Transaction) => {
        const snap = await tx.get(ref);
        if (!snap.exists) {
          tx.set(ref, {
            key,
            count: 1,
            resetAtMs: nextResetAtMs,
          });
          return { allowed: true, retryAfterMs: 0 };
        }

        const countRaw = Number(snap.get("count"));
        const resetAtMsRaw = Number(snap.get("resetAtMs"));
        const currentCount = Number.isFinite(countRaw) ? Math.max(0, Math.floor(countRaw)) : 0;
        const currentResetAtMs = Number.isFinite(resetAtMsRaw) ? resetAtMsRaw : 0;

        if (currentResetAtMs <= now) {
          tx.set(
            ref,
            {
              key,
              count: 1,
              resetAtMs: nextResetAtMs,
            },
            { merge: true },
          );
          return { allowed: true, retryAfterMs: 0 };
        }

        if (currentCount >= maxRequests) {
          return {
            allowed: false,
            retryAfterMs: Math.max(0, currentResetAtMs - now),
          };
        }

        tx.set(
          ref,
          {
            key,
            count: currentCount + 1,
            resetAtMs: currentResetAtMs,
          },
          { merge: true },
        );
        return { allowed: true, retryAfterMs: 0 };
      });
    }

    const sql = requireDb();
    const row = sql
      .prepare("SELECT count, resetAtMs FROM rate_limits WHERE key = ?")
      .get(key) as { count: number; resetAtMs: number } | undefined;

    const currentCount = Number.isFinite(Number(row?.count)) ? Math.max(0, Math.floor(Number(row?.count))) : 0;
    const currentResetAtMs = Number.isFinite(Number(row?.resetAtMs)) ? Number(row?.resetAtMs) : 0;

    if (!row || currentResetAtMs <= now) {
      sql.prepare(
        `
        INSERT INTO rate_limits (key, count, resetAtMs)
        VALUES (?, 1, ?)
        ON CONFLICT(key) DO UPDATE SET count = excluded.count, resetAtMs = excluded.resetAtMs
        `,
      ).run(key, nextResetAtMs);
      return { allowed: true, retryAfterMs: 0 };
    }

    if (currentCount >= maxRequests) {
      return {
        allowed: false,
        retryAfterMs: Math.max(0, currentResetAtMs - now),
      };
    }

    sql.prepare("UPDATE rate_limits SET count = ?, resetAtMs = ? WHERE key = ?").run(
      currentCount + 1,
      currentResetAtMs,
      key,
    );

    return { allowed: true, retryAfterMs: 0 };
  },
};
