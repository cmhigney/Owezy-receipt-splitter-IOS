import { httpLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import superjson from "superjson";

import type { AppRouter } from "@/backend/trpc/app-router";
import { getOptionalRuntimeValue } from "@/lib/runtimeConfig";

export const trpc = createTRPCReact<AppRouter>();

const PRODUCTION_API_URL = 'https://backend-7yfqvahoxa-uc.a.run.app';

const getBaseUrl = () => {
  const url = getOptionalRuntimeValue("EXPO_PUBLIC_API_BASE_URL", "apiBaseUrl");
  if (!url) {
    if (__DEV__) console.warn('[trpc] EXPO_PUBLIC_API_BASE_URL not set — using default production backend.');
    return PRODUCTION_API_URL;
  }
  // Accept values with a trailing slash or pasted /api/trpc suffix.
  const withoutTrailingSlash = url.replace(/\/+$/, "");
  return withoutTrailingSlash.replace(/\/api\/trpc$/i, "");
};

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

export const trpcClient = trpc.createClient({
  links: [
    httpLink({
      url: `${getBaseUrl()}/api/trpc`,
      transformer: superjson,
      headers() {
        const headers: Record<string, string> = {};
        if (authToken) {
          headers["authorization"] = `Bearer ${authToken}`;
        }
        return headers;
      },
    }),
  ],
});
