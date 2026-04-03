import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";

import { store } from "../store";

type HeaderReadable =
  | {
      headers?: unknown;
      get?: (name: string) => string | string[] | undefined;
      ip?: unknown;
      socket?: { remoteAddress?: unknown };
    }
  | undefined;

export class RateLimitExceededError extends TRPCError {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super({ code: "TOO_MANY_REQUESTS", message });
    this.retryAfterMs = Math.max(0, retryAfterMs);
  }
}

export function hashRateLimitIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function getHeaderValue(req: unknown, headerName: string): string | null {
  const normalizedName = headerName.toLowerCase();
  const requestLike = req as HeaderReadable;
  const headers = requestLike?.headers as
    | {
        get?: (name: string) => string | null;
        [key: string]: unknown;
      }
    | undefined;

  if (headers && typeof headers.get === "function") {
    const value = headers.get(normalizedName) ?? headers.get(headerName);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  if (headers && typeof headers === "object") {
    const value = headers[normalizedName] ?? headers[headerName];
    if (Array.isArray(value)) {
      const first = value[0];
      if (typeof first === "string" && first.trim()) {
        return first.trim();
      }
    } else if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  if (typeof requestLike?.get === "function") {
    const value = requestLike.get(headerName) ?? requestLike.get(normalizedName);
    if (Array.isArray(value)) {
      const first = value[0];
      if (typeof first === "string" && first.trim()) {
        return first.trim();
      }
    } else if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

export function getClientIp(req: unknown): string {
  const appEngineUserIp = getHeaderValue(req, "x-appengine-user-ip");
  if (appEngineUserIp) return appEngineUserIp;

  const forwardedFor = getHeaderValue(req, "x-forwarded-for");
  if (forwardedFor) {
    const forwardedChain = forwardedFor
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const trusted = forwardedChain.at(-1);
    if (trusted) return trusted;
  }

  const realIp = getHeaderValue(req, "x-real-ip");
  if (realIp) return realIp;

  const requestLike = req as HeaderReadable;
  if (typeof requestLike?.ip === "string" && requestLike.ip.trim()) {
    return requestLike.ip.trim();
  }
  if (
    requestLike?.socket &&
    typeof requestLike.socket.remoteAddress === "string" &&
    requestLike.socket.remoteAddress.trim()
  ) {
    return requestLike.socket.remoteAddress.trim();
  }

  return "unknown";
}

export function getClientIpHash(req: unknown): string {
  return hashRateLimitIdentifier(getClientIp(req));
}

export async function assertWithinRateLimit(params: {
  key: string;
  maxRequests: number;
  windowMs: number;
  message?: string;
}): Promise<void> {
  const { key, maxRequests, windowMs } = params;
  const result = await store.consumeRateLimit(key, maxRequests, windowMs);
  if (!result.allowed) {
    const waitSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    const message =
      params.message ?? `Too many requests. Please retry in about ${waitSeconds} second${waitSeconds === 1 ? "" : "s"}.`;
    throw new RateLimitExceededError(message, result.retryAfterMs);
  }
}
