/**
 * Starts the local Owezy backend for CI/E2E testing.
 *
 * Run with:  npx tsx scripts/ci-backend.ts
 * Requires:  Node.js >= 22.5 (for node:sqlite)
 *
 * Env vars:
 *   PORT              (default: 3001)
 *   OWEZY_STORE_MODE  set to "memory" for in-process SQLite (no file I/O)
 *
 * The iOS Simulator can reach http://localhost:PORT even when external network
 * access is unavailable (loopback bypasses simulator network isolation).
 */
import http from 'node:http';
import app from '../backend/hono';
import { store } from '../backend/store';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

const server = http.createServer(async (req, res) => {
  // Log every request so CI artifacts can show whether the simulator reached the backend.
  const remoteAddr = req.socket?.remoteAddress ?? 'unknown';
  const remotePort = req.socket?.remotePort ?? '?';
  console.log(`[ci-backend] REQ ${req.method} ${req.url} from ${remoteAddr}:${remotePort}`);

  // CI-only admin endpoint: force emailVerified=true for a given email.
  // Only available when OWEZY_STORE_MODE=memory (local CI runs).
  if (
    req.method === 'POST' &&
    req.url === '/ci/verify-email' &&
    process.env.OWEZY_STORE_MODE === 'memory'
  ) {
    try {
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', resolve);
        req.on('error', reject);
      });
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { email?: string };
      const email = (body.email ?? '').trim().toLowerCase();
      if (!email) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'email required' }));
        return;
      }
      const user = await store.getUserByEmail(email);
      if (!user) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'user not found' }));
        return;
      }
      await store.updateUser(user.id, { emailVerified: true, emailVerifiedAt: new Date().toISOString() });
      console.log(`[ci-backend] emailVerified=true set for ${email}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      console.error('[ci-backend] /ci/verify-email error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal error' }));
    }
    return;
  }

  try {
    const host = req.headers.host ?? `localhost:${PORT}`;
    const url = new URL(req.url ?? '/', `http://${host}`);

    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', resolve);
      req.on('error', reject);
    });

    const body = chunks.length > 0 ? Buffer.concat(chunks) : null;

    const reqHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') reqHeaders[key] = value;
      else if (Array.isArray(value) && value.length > 0) reqHeaders[key] = value[0];
    }

    const request = new Request(url.toString(), {
      method: req.method ?? 'GET',
      headers: reqHeaders,
      body: body && body.length > 0 ? body : undefined,
    });

    const response = await app.fetch(request);

    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    res.writeHead(response.status);
    console.log(`[ci-backend] RES ${response.status} ${req.method} ${req.url}`);

    const responseBody = await response.arrayBuffer();
    res.end(Buffer.from(responseBody));
  } catch (err) {
    console.error('[ci-backend] Unhandled error:', err);
    if (!res.headersSent) res.writeHead(500);
    res.end('Internal Server Error');
  }
});

// Bind explicitly to 0.0.0.0 (all IPv4 interfaces) so the iOS Simulator can
// reach the backend via 127.0.0.1. Using the default (::) can cause the server
// to only accept IPv6 connections on macOS runners where IPV6_V6ONLY is set.
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[ci-backend] Owezy backend running at http://127.0.0.1:${PORT}`);
  console.log(`[ci-backend] Store mode: ${process.env.OWEZY_STORE_MODE ?? 'auto'}`);
});

process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
