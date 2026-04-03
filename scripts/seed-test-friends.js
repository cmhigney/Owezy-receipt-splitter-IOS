#!/usr/bin/env node
'use strict';

// Seeds 8 test friends for a given account.
// Usage:
//   FIREBASE_API_KEY=<key> TEST_EMAIL=cmhigney@gmail.com TEST_PASSWORD=<pass> node scripts/seed-test-friends.js
//
// NOTE: This replaces the entire friends list for the account with the 8 test friends below.

const BACKEND_URL = (process.env.BACKEND_URL || 'https://backend-7yfqvahoxa-uc.a.run.app').replace(/\/+$/, '');
const FIREBASE_API_KEY = (
  process.env.FIREBASE_API_KEY ||
  process.env.EXPO_PUBLIC_FIREBASE_API_KEY ||
  ''
).trim();
const EMAIL = (process.env.TEST_EMAIL || '').trim().toLowerCase();
const PASSWORD = (process.env.TEST_PASSWORD || '').trim();

if (!FIREBASE_API_KEY) {
  console.error('seed-test-friends: FIREBASE_API_KEY or EXPO_PUBLIC_FIREBASE_API_KEY must be set');
  process.exit(1);
}
if (!EMAIL || !PASSWORD) {
  console.error('seed-test-friends: TEST_EMAIL and TEST_PASSWORD must be set');
  process.exit(1);
}

const AVATAR_COLORS = [
  '#5BA4CF', '#E57373', '#97B87E', '#D9B253',
  '#9583EF', '#D4789C', '#F0A05E', '#6DC5B0',
];

function makeId() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

const TEST_FRIENDS = [
  {
    id: makeId(),
    name: 'Jake Miller',
    username: 'jakemiller99',
    venmoUsername: 'jake-miller-99',
    cashAppUsername: 'jakemiller',
    zelleUsername: '',
    paypalUsername: '',
    phone: '(555) 867-5309',
    usageCount: 7,
    color: AVATAR_COLORS[0],
  },
  {
    id: makeId(),
    name: 'Sofia Chen',
    username: 'sofiac',
    venmoUsername: 'sofiac',
    cashAppUsername: '',
    zelleUsername: 'sofia.chen@gmail.com',
    paypalUsername: 'sofiac',
    phone: '',
    usageCount: 5,
    color: AVATAR_COLORS[1],
  },
  {
    id: makeId(),
    name: 'Marcus Johnson',
    username: 'marcusj',
    venmoUsername: 'mjohnson',
    cashAppUsername: 'marcusjohnson',
    zelleUsername: '',
    paypalUsername: '',
    phone: '(555) 123-4567',
    usageCount: 4,
    color: AVATAR_COLORS[2],
  },
  {
    id: makeId(),
    name: 'Ava Williams',
    username: 'avaw',
    venmoUsername: '',
    cashAppUsername: 'avawilliams',
    zelleUsername: 'ava.williams@email.com',
    paypalUsername: 'avawilliams',
    phone: '(555) 234-5678',
    usageCount: 6,
    color: AVATAR_COLORS[3],
  },
  {
    id: makeId(),
    name: 'Tyler Rodriguez',
    username: 'trod22',
    venmoUsername: 'trod22',
    cashAppUsername: 'tylerrod',
    zelleUsername: '',
    paypalUsername: '',
    phone: '',
    usageCount: 3,
    color: AVATAR_COLORS[4],
  },
  {
    id: makeId(),
    name: 'Mia Patel',
    username: 'miapatel',
    venmoUsername: 'miapatel',
    cashAppUsername: '',
    zelleUsername: '(555) 345-6789',
    paypalUsername: 'miapatel',
    phone: '(555) 345-6789',
    usageCount: 8,
    color: AVATAR_COLORS[5],
  },
  {
    id: makeId(),
    name: 'Ethan Brooks',
    username: 'ethanb99',
    venmoUsername: '',
    cashAppUsername: 'ethanb99',
    zelleUsername: '',
    paypalUsername: 'ethanbrooks',
    phone: '(555) 456-7890',
    usageCount: 2,
    color: AVATAR_COLORS[6],
  },
  {
    id: makeId(),
    name: 'Lily Thompson',
    username: 'lilyt',
    venmoUsername: 'lily-thompson',
    cashAppUsername: 'lilythompson',
    zelleUsername: 'lily.t@email.com',
    paypalUsername: '',
    phone: '(555) 567-8901',
    usageCount: 5,
    color: AVATAR_COLORS[7],
  },
];

async function firebaseSignIn(email, password) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || 'Firebase sign-in failed');
  }
  return data.idToken;
}

async function trpcRequest(procedure, input, token) {
  const res = await fetch(`${BACKEND_URL}/api/trpc/${procedure}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ json: input }),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error(`Non-JSON from ${procedure}: ${text.slice(0, 200)}`);
  }
  if (data?.error) {
    throw new Error(data.error.message || 'tRPC error');
  }
  return data?.result?.data?.json ?? data?.result?.data;
}

function stripEmpty(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v !== undefined));
}

async function seed() {
  console.log(`seed-test-friends: signing in as ${EMAIL}...`);
  const token = await firebaseSignIn(EMAIL, PASSWORD);
  console.log('seed-test-friends: signed in, saving 8 test friends...');
  const friends = TEST_FRIENDS.map(stripEmpty);
  await trpcRequest('friends.save', { friends }, token);
  console.log('seed-test-friends: done!');
  TEST_FRIENDS.forEach((f) => console.log(`  - ${f.name} (@${f.username})`));
}

seed().catch((err) => {
  console.error('seed-test-friends: failed -', err.message || err);
  process.exit(1);
});
