import { getRuntimeFlag } from "@/lib/runtimeConfig";

export const E2E_SKIP_EMAIL_VERIFICATION =
  getRuntimeFlag("EXPO_PUBLIC_E2E_SKIP_EMAIL_VERIFICATION", "e2eSkipEmailVerification");

export const E2E_ENABLE_TEST_RECEIPTS =
  getRuntimeFlag("EXPO_PUBLIC_E2E_ENABLE_TEST_RECEIPTS", "e2eEnableTestReceipts");
