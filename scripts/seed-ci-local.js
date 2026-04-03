#!/usr/bin/env node
'use strict';

const BACKEND_URL = (process.env.BACKEND_URL || 'http://localhost:3001').replace(/\/+$/, '');
const FIREBASE_API_KEY = (
  process.env.FIREBASE_API_KEY ||
  process.env.EXPO_PUBLIC_FIREBASE_API_KEY ||
  ''
).trim();

const PRIMARY_USER = {
  email: (process.env.TEST_EMAIL || '').trim().toLowerCase(),
  password: (process.env.TEST_PASSWORD || '').trim(),
  displayName: (process.env.TEST_DISPLAY_NAME || 'CI Primary').trim(),
  username: (process.env.TEST_USERNAME || 'cibotalpha1').trim().toLowerCase(),
  phone: (process.env.TEST_PHONE || '').trim(),
  venmoUsername: (process.env.TEST_VENMO || '').trim(),
  cashAppUsername: (process.env.TEST_CASHAPP || '').trim(),
  zelleUsername: (process.env.TEST_ZELLE || '').trim(),
  paypalUsername: (process.env.TEST_PAYPAL || '').trim(),
};

if (!FIREBASE_API_KEY) {
  console.error('seed-ci-local: FIREBASE_API_KEY or EXPO_PUBLIC_FIREBASE_API_KEY must be set');
  process.exit(1);
}

if (!PRIMARY_USER.email || !PRIMARY_USER.password) {
  console.error('seed-ci-local: TEST_EMAIL and TEST_PASSWORD must be set');
  process.exit(1);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    const message = data?.error?.message || `${response.status} ${response.statusText}`;
    const error = new Error(message);
    error.code = data?.error?.message || 'HTTP_ERROR';
    throw error;
  }

  return data;
}

async function firebaseSignUp(email, password) {
  return fetchJson(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
    },
  );
}

async function firebaseSignIn(email, password) {
  return fetchJson(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
    },
  );
}

async function ensureFirebaseUser(email, password) {
  try {
    const created = await firebaseSignUp(email, password);
    console.log(`seed-ci-local: created Firebase Auth user ${email}`);
    return created.idToken;
  } catch (error) {
    if (error.code !== 'EMAIL_EXISTS') {
      throw error;
    }
    const signedIn = await firebaseSignIn(email, password);
    console.log(`seed-ci-local: signed in existing Firebase Auth user ${email}`);
    return signedIn.idToken;
  }
}

async function trpcRequest(procedure, input, token) {
  const response = await fetch(`${BACKEND_URL}/api/trpc/${procedure}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ json: input }),
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${procedure}: ${text.slice(0, 200)}`);
  }

  if (data?.error) {
    const err = new Error(data.error.message || 'tRPC error');
    err.code = data.error.data?.code || 'UNKNOWN';
    throw err;
  }

  return data?.result?.data?.json ?? data?.result?.data;
}

async function ensureBackendProfile(user, token) {
  try {
    await trpcRequest('users.signup', {
      displayName: user.displayName,
      phone: user.phone || undefined,
    }, token);
    console.log(`seed-ci-local: ensured backend profile for ${user.email}`);
  } catch (error) {
    if (error.code !== 'CONFLICT') {
      throw error;
    }
    console.log(`seed-ci-local: backend profile already existed for ${user.email}`);
  }

  await trpcRequest('users.updateProfile', {
    displayName: user.displayName,
    username: user.username,
    phone: user.phone || undefined,
    venmoUsername: user.venmoUsername || undefined,
    cashAppUsername: user.cashAppUsername || undefined,
    zelleUsername: user.zelleUsername || undefined,
    paypalUsername: user.paypalUsername || undefined,
  }, token);
}

async function seedUser(user) {
  const token = await ensureFirebaseUser(user.email, user.password);
  await ensureBackendProfile(user, token);
}

async function seed() {
  await seedUser(PRIMARY_USER);

  console.log('seed-ci-local: done.');
  console.log(`seed-ci-local: PRIMARY_TEST_USERNAME=${PRIMARY_USER.username}`);
}

seed().catch((error) => {
  console.error('seed-ci-local: failed -', error.message || error);
  process.exit(1);
});
