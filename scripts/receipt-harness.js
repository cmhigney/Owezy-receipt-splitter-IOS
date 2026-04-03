#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { createTRPCProxyClient, httpLink } = require("@trpc/client");
const superjson = require("superjson");

const SUPPORTED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
  ".pdf",
]);

function loadDotEnvIfPresent() {
  const envPath = path.resolve(".env");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function printHelp() {
  console.log(`
Receipt Harness

Parses batches of receipt files through your live backend (scans.parseReceipt),
captures the parsed JSON, and generates a UI-state summary for each receipt.

Usage:
  node scripts/receipt-harness.js [options]

Options:
  --base-url <url>         Backend base URL (defaults to EXPO_PUBLIC_API_BASE_URL)
  --email <email>          Login email for auth
  --password <password>    Login password for auth
  --token <token>          Existing auth token (skips login)
  --receipts-dir <dir>     Receipt directory (default: receipt-tests/receipts)
  --manifest <file>        Optional manifest JSON
  --text-dir <dir>         Optional directory of raw OCR text fixtures to parse via scans.parseReceiptText
  --baseline-report <file> Compare current parses against a prior report's parsed output
  --out <file>             Output report JSON path
  --people <n>             People count for UI simulation (default: 4)
  --limit <n>              Max number of files to process
  --allow-production       Allow running against production-like backend URLs
  --disable-dedupe-cache   Disable local per-run dedupe cache for identical files
  --fail-on-mismatch       Exit non-zero on expectation failures
  --help                   Show this help

Manifest format:
{
  "defaults": { "peopleCount": 4 },
  "cases": [
    {
      "file": "sample1.jpg",
      "label": "Dinner 8-top",
      "peopleCount": 8,
      "expect": {
        "minItems": 5,
        "autoGratuityDetected": true,
        "partySizeMin": 8,
        "ui": { "requiresPartySizePrompt": true, "manualTipShowsSplitMode": true }
      }
    }
  ]
}
  `.trim());
}

function parseArgs(argv) {
  const out = {
    baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || "",
    email: "",
    password: "",
    token: "",
    receiptsDir: "receipt-tests/receipts",
    manifest: "",
    textDir: "",
    baselineReport: "",
    outputPath: "",
    peopleCount: 4,
    limit: 0,
    allowProduction: false,
    disableDedupeCache: false,
    failOnMismatch: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        out.help = true;
        break;
      case "--base-url":
        out.baseUrl = argv[++i] || "";
        break;
      case "--email":
        out.email = argv[++i] || "";
        break;
      case "--password":
        out.password = argv[++i] || "";
        break;
      case "--token":
        out.token = argv[++i] || "";
        break;
      case "--receipts-dir":
        out.receiptsDir = argv[++i] || out.receiptsDir;
        break;
      case "--manifest":
        out.manifest = argv[++i] || "";
        break;
      case "--text-dir":
        out.textDir = argv[++i] || "";
        break;
      case "--baseline-report":
        out.baselineReport = argv[++i] || "";
        break;
      case "--out":
        out.outputPath = argv[++i] || "";
        break;
      case "--people": {
        const val = Number(argv[++i] || "4");
        out.peopleCount = Number.isFinite(val) && val > 0 ? Math.round(val) : 4;
        break;
      }
      case "--limit": {
        const val = Number(argv[++i] || "0");
        out.limit = Number.isFinite(val) && val > 0 ? Math.round(val) : 0;
        break;
      }
      case "--allow-production":
        out.allowProduction = true;
        break;
      case "--disable-dedupe-cache":
        out.disableDedupeCache = true;
        break;
      case "--fail-on-mismatch":
        out.failOnMismatch = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return out;
}

function normalizeBaseUrl(url) {
  const trimmed = (url || "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/, "").replace(/\/api\/trpc$/i, "");
}

function isLikelyProductionBaseUrl(baseUrl) {
  try {
    const { hostname } = new URL(baseUrl);
    if (!hostname) return false;
    const lower = hostname.toLowerCase();
    if (
      lower === "localhost" ||
      lower === "127.0.0.1" ||
      lower === "::1" ||
      lower.endsWith(".local")
    ) {
      return false;
    }
    return (
      lower.endsWith(".a.run.app") ||
      lower.endsWith(".run.app") ||
      lower.endsWith(".cloudfunctions.net")
    );
  } catch {
    return false;
  }
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function detectMimeTypeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".heic") return "image/heic";
  if (ext === ".heif") return "image/heif";
  if (ext === ".pdf") return "application/pdf";
  return "image/jpeg";
}

function collectFilesRecursively(dirPath) {
  const out = [];
  if (!fs.existsSync(dirPath)) return out;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFilesRecursively(full));
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (SUPPORTED_EXTENSIONS.has(ext)) {
      out.push(full);
    }
  }
  return out;
}

function safeRound(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function deriveUiSummary(parsed, peopleCount) {
  const tip = safeRound(parsed.tip);
  const subtotal = safeRound(parsed.subtotal);
  const tax = safeRound(parsed.tax);
  const partySizeMin = Number(parsed.autoGratuity?.partySizeMin);
  const hasPartyThreshold = Number.isFinite(partySizeMin) && partySizeMin > 0;

  const requiresPartySizePrompt =
    Boolean(parsed.autoGratuity?.detected) && hasPartyThreshold && tip > 0;

  const initialState = (() => {
    if (tip <= 0) {
      return {
        pendingAutoTipAmount: null,
        tipAmount: 0,
        tipDetectedFromReceipt: false,
        showTipEntry: false,
      };
    }
    if (requiresPartySizePrompt) {
      return {
        pendingAutoTipAmount: tip,
        tipAmount: 0,
        tipDetectedFromReceipt: false,
        showTipEntry: false,
      };
    }
    return {
      pendingAutoTipAmount: null,
      tipAmount: tip,
      tipDetectedFromReceipt: true,
      showTipEntry: true,
    };
  })();

  const showsAutoGratuityCardInitially =
    initialState.showTipEntry &&
    initialState.tipDetectedFromReceipt &&
    Boolean(parsed.autoGratuity?.detected) &&
    initialState.tipAmount > 0;

  const showsTipFoundCardInitially =
    initialState.showTipEntry &&
    initialState.tipDetectedFromReceipt &&
    initialState.tipAmount > 0 &&
    !showsAutoGratuityCardInitially;

  const showsSplitModeInitially =
    initialState.showTipEntry &&
    initialState.tipAmount > 0 &&
    peopleCount > 0;

  const manualTipAmount = safeRound(tip > 0 ? tip : Math.max(5, subtotal * 0.15));

  const manualTipAfterNo = {
    showTipEntry: true,
    tipAmount: manualTipAmount,
    tipDetectedFromReceipt: false,
    showsAutoGratuityCard: false,
    showsTipFoundCard: false,
    showsSplitMode: manualTipAmount > 0 && peopleCount > 0,
  };

  return {
    peopleCount,
    requiresPartySizePrompt,
    initialState,
    initialCards: {
      autoGratuity: showsAutoGratuityCardInitially,
      tipFound: showsTipFoundCardInitially,
      splitMode: showsSplitModeInitially,
    },
    manualTipAfterNo,
    totalsPreview: {
      subtotal,
      tax,
      tip: safeRound(initialState.tipAmount),
      totalWithTip: safeRound(subtotal + tax + initialState.tipAmount),
    },
  };
}

function runGenericChecks(parsed) {
  const checks = [];
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const itemSum = safeRound(items.reduce((sum, item) => sum + (Number(item.price) || 0), 0));
  const subtotal = safeRound(parsed.subtotal);
  const tax = safeRound(parsed.tax);
  const tip = safeRound(parsed.tip);
  const total = safeRound(parsed.total);
  const expectedTotal = safeRound(subtotal + tax + tip);

  checks.push({
    name: "non_negative_amounts",
    pass: subtotal >= 0 && tax >= 0 && tip >= 0 && total >= 0,
    details: { subtotal, tax, tip, total },
  });

  checks.push({
    name: "has_items_or_total",
    pass: items.length > 0 || total > 0,
    details: { itemCount: items.length, total },
  });

  const nonFoodChargeItems = items.filter((item) =>
    /\b(auto\s*)?(gratuity|tip|service\s*charge|surcharge|tax|subtotal|total|amount due|balance due)\b/i.test(
      String(item?.name || ""),
    ),
  );
  checks.push({
    name: "items_exclude_charge_lines",
    pass: nonFoodChargeItems.length === 0,
    details: { count: nonFoodChargeItems.length, names: nonFoodChargeItems.map((item) => item.name) },
  });

  checks.push({
    name: "total_matches_components",
    pass: Math.abs(total - expectedTotal) <= 0.1 || total === 0,
    details: { total, expectedTotal },
  });

  checks.push({
    name: "subtotal_reasonable_vs_items",
    pass: items.length === 0 || subtotal === 0 || Math.abs(subtotal - itemSum) <= Math.max(0.1, subtotal * 0.35),
    details: { subtotal, itemSum, itemCount: items.length },
  });

  return checks;
}

function evaluateExpectations(parsed, ui, expect) {
  if (!expect || typeof expect !== "object") return [];
  const failures = [];
  const lowerRestaurant = String(parsed.restaurantName || "").toLowerCase();
  const itemCount = Array.isArray(parsed.items) ? parsed.items.length : 0;

  if (typeof expect.restaurantNameContains === "string") {
    const needle = expect.restaurantNameContains.toLowerCase();
    if (!lowerRestaurant.includes(needle)) {
      failures.push(`restaurantName missing "${expect.restaurantNameContains}"`);
    }
  }
  if (typeof expect.minItems === "number" && itemCount < expect.minItems) {
    failures.push(`itemCount ${itemCount} < minItems ${expect.minItems}`);
  }
  if (typeof expect.maxItems === "number" && itemCount > expect.maxItems) {
    failures.push(`itemCount ${itemCount} > maxItems ${expect.maxItems}`);
  }
  if (
    typeof expect.autoGratuityDetected === "boolean" &&
    Boolean(parsed.autoGratuity?.detected) !== expect.autoGratuityDetected
  ) {
    failures.push(
      `autoGratuity.detected ${Boolean(parsed.autoGratuity?.detected)} != ${expect.autoGratuityDetected}`,
    );
  }
  if (typeof expect.partySizeMin === "number") {
    const actualPartyMin = Number(parsed.autoGratuity?.partySizeMin ?? 0);
    if (actualPartyMin !== expect.partySizeMin) {
      failures.push(`partySizeMin ${actualPartyMin} != ${expect.partySizeMin}`);
    }
  }

  if (expect.ui && typeof expect.ui === "object") {
    for (const [key, expectedValue] of Object.entries(expect.ui)) {
      const actualValue = ui?.[key];
      if (typeof expectedValue === "boolean" && actualValue !== expectedValue) {
        failures.push(`ui.${key} ${actualValue} != ${expectedValue}`);
      }
    }
  }

  return failures;
}

function loadManifest(manifestPath) {
  const raw = fs.readFileSync(manifestPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid manifest JSON");
  }
  const defaults = parsed.defaults && typeof parsed.defaults === "object" ? parsed.defaults : {};
  const cases = Array.isArray(parsed.cases) ? parsed.cases : [];
  return { defaults, cases };
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeFileKey(filePath) {
  return path.resolve(filePath).toLowerCase();
}

function buildItemSignature(item) {
  const quantity = Math.max(1, Math.round(Number(item?.quantity) || 1));
  const price = safeRound(Number(item?.price) || 0).toFixed(2);
  return `${normalizeText(item?.name)}::${price}::${quantity}`;
}

function loadBaselineReport(reportPath) {
  const raw = fs.readFileSync(reportPath, "utf8");
  const parsed = JSON.parse(raw);
  const cases = Array.isArray(parsed?.cases) ? parsed.cases : [];
  const byFileKey = new Map();

  for (const testCase of cases) {
    if (!testCase || typeof testCase !== "object") continue;
    if (!testCase.filePath || !testCase.parsed) continue;
    byFileKey.set(normalizeFileKey(testCase.filePath), {
      label: testCase.label || path.basename(testCase.filePath),
      parsed: testCase.parsed,
    });
  }

  return {
    reportPath,
    byFileKey,
  };
}

function getTextFixturePath(caseFilePath, textDir) {
  if (!textDir) return "";
  const baseName = path.basename(caseFilePath, path.extname(caseFilePath));
  return path.resolve(textDir, `${baseName}.txt`);
}

function compareParsedToBaseline(parsed, baselineParsed) {
  const failures = [];

  if (!baselineParsed || typeof baselineParsed !== "object") {
    return failures;
  }

  const currentRestaurant = normalizeText(parsed.restaurantName);
  const baselineRestaurant = normalizeText(baselineParsed.restaurantName);
  if (baselineRestaurant && currentRestaurant !== baselineRestaurant) {
    failures.push(
      `baseline.restaurantName "${parsed.restaurantName}" != "${baselineParsed.restaurantName}"`,
    );
  }

  const amountFields = ["subtotal", "tax", "tip", "total"];
  for (const field of amountFields) {
    const actual = safeRound(parsed[field]);
    const expected = safeRound(baselineParsed[field]);
    if (Math.abs(actual - expected) > 0.1) {
      failures.push(`baseline.${field} ${actual} != ${expected}`);
    }
  }

  const actualAutoGrat = Boolean(parsed.autoGratuity?.detected);
  const expectedAutoGrat = Boolean(baselineParsed.autoGratuity?.detected);
  if (actualAutoGrat !== expectedAutoGrat) {
    failures.push(`baseline.autoGratuity.detected ${actualAutoGrat} != ${expectedAutoGrat}`);
  }

  const actualPartyMin = Number(parsed.autoGratuity?.partySizeMin ?? 0);
  const expectedPartyMin = Number(baselineParsed.autoGratuity?.partySizeMin ?? 0);
  if (actualPartyMin !== expectedPartyMin) {
    failures.push(`baseline.autoGratuity.partySizeMin ${actualPartyMin} != ${expectedPartyMin}`);
  }

  const currentItems = Array.isArray(parsed.items) ? parsed.items : [];
  const baselineItems = Array.isArray(baselineParsed.items) ? baselineParsed.items : [];
  const currentSignatures = currentItems.map(buildItemSignature).sort();
  const baselineSignatures = baselineItems.map(buildItemSignature).sort();

  if (currentSignatures.length !== baselineSignatures.length) {
    failures.push(
      `baseline.itemCount ${currentSignatures.length} != ${baselineSignatures.length}`,
    );
  }

  const currentRemaining = [...currentSignatures];
  const missingFromCurrent = [];
  for (const signature of baselineSignatures) {
    const matchIndex = currentRemaining.indexOf(signature);
    if (matchIndex >= 0) {
      currentRemaining.splice(matchIndex, 1);
    } else {
      missingFromCurrent.push(signature);
    }
  }

  if (missingFromCurrent.length > 0) {
    failures.push(
      `baseline.items missing ${missingFromCurrent.slice(0, 5).join(" | ")}`,
    );
  }
  if (currentRemaining.length > 0) {
    failures.push(`baseline.items extra ${currentRemaining.slice(0, 5).join(" | ")}`);
  }

  return failures;
}

function buildCasesFromManifest(manifestPath, manifest, fallbackPeopleCount) {
  const baseDir = path.dirname(manifestPath);
  return manifest.cases.map((testCase, index) => {
    if (!testCase || typeof testCase !== "object" || typeof testCase.file !== "string") {
      throw new Error(`Invalid manifest case at index ${index}`);
    }
    const absoluteFilePath = path.isAbsolute(testCase.file)
      ? testCase.file
      : path.resolve(baseDir, testCase.file);
    return {
      id: testCase.id || `case_${index + 1}`,
      label: testCase.label || path.basename(absoluteFilePath),
      filePath: absoluteFilePath,
      peopleCount:
        Number.isFinite(Number(testCase.peopleCount))
          ? Math.max(1, Math.round(Number(testCase.peopleCount)))
          : Number.isFinite(Number(manifest.defaults.peopleCount))
            ? Math.max(1, Math.round(Number(manifest.defaults.peopleCount)))
            : fallbackPeopleCount,
      expect: testCase.expect || null,
    };
  });
}

function buildCasesFromDirectory(receiptsDir, peopleCount) {
  const absoluteDir = path.resolve(receiptsDir);
  const files = collectFilesRecursively(absoluteDir).sort();
  return files.map((filePath, idx) => ({
    id: `file_${idx + 1}`,
    label: path.basename(filePath),
    filePath,
    peopleCount,
    expect: null,
  }));
}

async function main() {
  loadDotEnvIfPresent();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const baseUrl = normalizeBaseUrl(args.baseUrl);
  if (!baseUrl) {
    throw new Error(
      "Missing backend URL. Set EXPO_PUBLIC_API_BASE_URL or pass --base-url https://your-backend-url",
    );
  }
  if (isLikelyProductionBaseUrl(baseUrl) && !args.allowProduction) {
    throw new Error(
      `Refusing to run against production-like URL (${baseUrl}). Use --allow-production to override.`,
    );
  }

  const defaultManifestPath = path.resolve("receipt-tests/manifest.json");
  const manifestPath = args.manifest
    ? path.resolve(args.manifest)
    : (fs.existsSync(defaultManifestPath) ? defaultManifestPath : "");

  let cases = [];
  let manifestUsed = "";
  if (manifestPath) {
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Manifest file not found: ${manifestPath}`);
    }
    const manifest = loadManifest(manifestPath);
    cases = buildCasesFromManifest(manifestPath, manifest, args.peopleCount);
    manifestUsed = manifestPath;
  } else {
    cases = buildCasesFromDirectory(args.receiptsDir, args.peopleCount);
  }

  if (args.limit > 0) {
    cases = cases.slice(0, args.limit);
  }

  if (cases.length === 0) {
    throw new Error(
      `No receipt files found. Add files under "${args.receiptsDir}" or provide --manifest`,
    );
  }

  let baseline = null;
  if (args.baselineReport) {
    const baselineReportPath = path.resolve(args.baselineReport);
    if (!fs.existsSync(baselineReportPath)) {
      throw new Error(`Baseline report file not found: ${baselineReportPath}`);
    }
    baseline = loadBaselineReport(baselineReportPath);
  }

  const textDir = args.textDir ? path.resolve(args.textDir) : "";
  if (textDir && !fs.existsSync(textDir)) {
    throw new Error(`Text fixture directory not found: ${textDir}`);
  }

  let authToken = args.token || "";
  const trpcClient = createTRPCProxyClient({
    links: [
      httpLink({
        url: `${baseUrl}/api/trpc`,
        transformer: superjson,
        headers() {
          const headers = {};
          if (authToken) {
            headers.authorization = `Bearer ${authToken}`;
          }
          return headers;
        },
      }),
    ],
  });

  if (!authToken) {
    if (!args.email || !args.password) {
      throw new Error("Provide --token or both --email and --password");
    }
    console.log(`[auth] Logging in as ${args.email}`);
    const loginResult = await trpcClient.users.login.mutate({
      email: args.email,
      password: args.password,
    });
    if (!loginResult?.token) {
      throw new Error("Login succeeded but no token was returned");
    }
    authToken = loginResult.token;
  }

  let me = null;
  try {
    me = await trpcClient.users.me.query();
    console.log(`[auth] Using user ${me.email} (${me.id})`);
  } catch {
    console.log("[auth] Token acquired, but users.me failed; proceeding with scans");
  }

  const startedAt = new Date().toISOString();
  const caseResults = [];
  let okCount = 0;
  let mismatchCount = 0;
  let errorCount = 0;
  let backendCallCount = 0;
  let dedupeCacheHitCount = 0;
  const dedupeParseCache = new Map();

  for (const [index, testCase] of cases.entries()) {
    const caseHeader = `[${index + 1}/${cases.length}] ${testCase.label}`;
    if (!fs.existsSync(testCase.filePath)) {
      const result = {
        id: testCase.id,
        label: testCase.label,
        filePath: testCase.filePath,
        status: "error",
        error: "FILE_NOT_FOUND",
      };
      caseResults.push(result);
      errorCount += 1;
      console.log(`${caseHeader} -> ERROR (file not found)`);
      continue;
    }

    try {
      const base64 = fs.readFileSync(testCase.filePath, { encoding: "base64" });
      const mimeType = detectMimeTypeFromPath(testCase.filePath);
      const dedupeKey = `${mimeType}:${sha256Hex(base64)}`;
      const textFixturePath = getTextFixturePath(testCase.filePath, textDir);
      const hasTextFixture = textFixturePath ? fs.existsSync(textFixturePath) : false;
      let parsed = null;
      let usedDedupeCache = false;
      if (!args.disableDedupeCache && !hasTextFixture) {
        const cachedParsed = dedupeParseCache.get(dedupeKey);
        if (cachedParsed) {
          parsed = deepClone(cachedParsed);
          usedDedupeCache = true;
          dedupeCacheHitCount += 1;
        }
      }
      if (!parsed) {
        if (hasTextFixture) {
          const text = fs.readFileSync(textFixturePath, "utf8");
          parsed = await trpcClient.scans.parseReceiptText.mutate({
            text,
            source: "apple_vision",
          });
        } else {
          parsed = await trpcClient.scans.parseReceipt.mutate({
            imageBase64: base64,
            mimeType,
          });
        }
        backendCallCount += 1;
        if (!args.disableDedupeCache && !hasTextFixture) {
          dedupeParseCache.set(dedupeKey, deepClone(parsed));
        }
      }

      const checks = runGenericChecks(parsed);
      const genericFailures = checks
        .filter((check) => !check.pass)
        .map((check) => check.name);
      const ui = deriveUiSummary(parsed, testCase.peopleCount);
      const uiExpectSurface = {
        requiresPartySizePrompt: ui.requiresPartySizePrompt,
        showsAutoGratuityCardInitially: ui.initialCards.autoGratuity,
        manualTipShowsSplitMode: ui.manualTipAfterNo.showsSplitMode,
      };
      const expectationFailures = evaluateExpectations(parsed, uiExpectSurface, testCase.expect);
      const baselineCase = baseline?.byFileKey.get(normalizeFileKey(testCase.filePath)) || null;
      const baselineFailures = baselineCase
        ? compareParsedToBaseline(parsed, baselineCase.parsed)
        : [];

      const status =
        expectationFailures.length > 0 || genericFailures.length > 0 || baselineFailures.length > 0
          ? "mismatch"
          : "ok";
      if (status === "ok") {
        okCount += 1;
      } else {
        mismatchCount += 1;
      }

      caseResults.push({
        id: testCase.id,
        label: testCase.label,
        filePath: testCase.filePath,
        status,
        usedDedupeCache,
        usedTextFixture: hasTextFixture,
        textFixturePath: hasTextFixture ? textFixturePath : null,
        parsed,
        checks,
        genericFailures,
        ui,
        expectationFailures,
        baselineFailures,
        baselineLabel: baselineCase?.label || null,
      });

      console.log(
        `${caseHeader} -> ${status.toUpperCase()} | items=${parsed.items?.length || 0} total=${parsed.total} autoGrat=${Boolean(parsed.autoGratuity?.detected)}${usedDedupeCache ? " [dedupe-cache]" : ""}`,
      );
      if (expectationFailures.length > 0) {
        for (const failure of expectationFailures) {
          console.log(`  - ${failure}`);
        }
      }
      if (genericFailures.length > 0) {
        for (const failure of genericFailures) {
          console.log(`  - generic check failed: ${failure}`);
        }
      }
      if (baselineFailures.length > 0) {
        for (const failure of baselineFailures) {
          console.log(`  - baseline mismatch: ${failure}`);
        }
      }
    } catch (error) {
      const message =
        String(error?.message || "")
          .replace(/^TRPCClientError:\s*/i, "")
          .trim() || "UNKNOWN_ERROR";
      caseResults.push({
        id: testCase.id,
        label: testCase.label,
        filePath: testCase.filePath,
        status: "error",
        error: message,
      });
      errorCount += 1;
      console.log(`${caseHeader} -> ERROR | ${message}`);
    }
  }

  const endedAt = new Date().toISOString();
  const defaultReportPath = path.resolve(
    "receipt-tests/reports",
    `receipt-report-${Date.now()}.json`,
  );
  const reportPath = args.outputPath ? path.resolve(args.outputPath) : defaultReportPath;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });

  const report = {
    meta: {
      startedAt,
      endedAt,
      baseUrl,
      manifest: manifestUsed || null,
      baselineReport: baseline?.reportPath || null,
      totalCases: cases.length,
      summary: {
        ok: okCount,
        mismatch: mismatchCount,
        error: errorCount,
      },
      requestStats: {
        backendCalls: backendCallCount,
        dedupeCacheHits: dedupeCacheHitCount,
      },
      user: me ? { id: me.id, email: me.email, username: me.username } : null,
    },
    cases: caseResults,
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log("");
  console.log("Receipt harness complete");
  console.log(`Report: ${reportPath}`);
  console.log(`Summary: ok=${okCount}, mismatch=${mismatchCount}, error=${errorCount}`);
  console.log(
    `Request stats: backendCalls=${backendCallCount}, dedupeCacheHits=${dedupeCacheHitCount}`,
  );

  if (args.failOnMismatch && (mismatchCount > 0 || errorCount > 0)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Receipt harness failed: ${error?.message || error}`);
  process.exit(1);
});
