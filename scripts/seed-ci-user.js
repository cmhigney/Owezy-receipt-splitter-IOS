#!/usr/bin/env node
// Idempotent seed script: creates/updates the CI test user in Firestore.
// Run once per CI job before Maestro tests.
//
// Required env vars:
//   TEST_EMAIL              - e.g. cmhigney@gmail.com
//   TEST_PASSWORD           - plain-text password to store as pbkdf2 hash
//   FIREBASE_SERVICE_ACCOUNT - raw JSON of a Firebase service-account key
//                              (Project Settings → Service Accounts → Generate key)

'use strict';

const crypto = require('crypto');
const admin = require('firebase-admin');

// ── Validate inputs ──────────────────────────────────────────────────────────
const EMAIL = (process.env.TEST_EMAIL || '').trim().toLowerCase();
const PASSWORD = (process.env.TEST_PASSWORD || '').trim();
const SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT || '';

if (!EMAIL || !PASSWORD) {
  console.error('seed-ci-user: TEST_EMAIL and TEST_PASSWORD must be set');
  process.exit(1);
}
if (!SERVICE_ACCOUNT_JSON) {
  console.error('seed-ci-user: FIREBASE_SERVICE_ACCOUNT must be set (raw JSON of service account key)');
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(SERVICE_ACCOUNT_JSON);
} catch {
  console.error('seed-ci-user: FIREBASE_SERVICE_ACCOUNT is not valid JSON');
  process.exit(1);
}

// ── Init Admin SDK ───────────────────────────────────────────────────────────
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
}
const db = admin.firestore();

// ── Password hashing (identical to backend/trpc/routes/users.ts) ─────────────
const PASSWORD_ITERATIONS = 210_000;
const PASSWORD_KEYLEN = 32;
const PASSWORD_DIGEST = 'sha256';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEYLEN, PASSWORD_DIGEST)
    .toString('hex');
  return `pbkdf2$${PASSWORD_ITERATIONS}$${salt}$${hash}`;
}

// ── Seed ─────────────────────────────────────────────────────────────────────
async function seed() {
  // Check email index
  const indexRef = db.collection('userEmailIndex').doc(EMAIL);
  const indexSnap = await indexRef.get();

  if (indexSnap.exists) {
    const userId = indexSnap.get('userId');
    console.log(`seed-ci-user: user exists (${userId}) — refreshing password + emailVerified`);
    await db.collection('users').doc(userId).update({
      emailVerified: 1,
      password: hashPassword(PASSWORD),
    });
    console.log('seed-ci-user: done.');
    return;
  }

  // Create fresh user
  const userId = `usr_${crypto.randomBytes(12).toString('base64url')}`;
  const baseName = EMAIL.split('@')[0].replace(/[^a-z0-9]/gi, '').slice(0, 12) || 'cibot';
  const suffix = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  const username = `${baseName}${suffix}`.slice(0, 16).toLowerCase();
  const hashedPassword = hashPassword(PASSWORD);
  const now = new Date().toISOString();

  const userRecord = {
    id: userId,
    email: EMAIL,
    password: hashedPassword,
    passwordHistory: [],
    emailVerified: 1,      // verified from the start — no email modal blocker
    emailVerifiedAt: now,
    displayName: 'CI Bot',
    username,
    phone: null,
    profilePicture: null,
    createdAt: now,
    lastUsernameChangeAt: null,
    totalReceiptsScanned: 0,
    totalAmountSplit: 0,
    totalFriendsSplitWith: 0,
    venmoUsername: null,
    cashAppUsername: null,
    zelleUsername: null,
    paypalUsername: null,
  };

  await db.runTransaction(async (tx) => {
    tx.set(db.collection('users').doc(userId), userRecord);
    tx.set(db.collection('userEmailIndex').doc(EMAIL), { userId });
    tx.set(db.collection('usernameIndex').doc(username), { userId });
  });

  console.log(`seed-ci-user: created user ${EMAIL} (id=${userId}, username=${username})`);
}

seed().catch((err) => {
  console.error('seed-ci-user: failed —', err.message || err);
  process.exit(1);
});
