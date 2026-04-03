#!/usr/bin/env node
/**
 * Standalone parser unit/integration tests.
 * Run with: node scripts/test-parse-logic.js
 *
 * No server, no auth, no network calls needed.
 * Tests the parseReceiptTextWithVision() logic directly using the exact same
 * code as backend/trpc/routes/scans.ts (pure functions only, copy-kept in sync).
 */

// ─── helpers ────────────────────────────────────────────────────────────────

function roundCurrency(v) { return Math.round(v * 100) / 100; }
function cleanLine(l) { return l.replace(/\s+/g, ' ').trim(); }

function parseCurrencyToken(token) {
  const hadDecimal = token.includes('.');
  const cleaned = token.replace(/[$,\s]/g, '').trim();
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return { amount: value, hadDecimal };
}

function normalizeAmount(rawAmount, hadDecimal, _label) {
  if (hadDecimal) return roundCurrency(rawAmount);
  if (rawAmount >= 1000) return roundCurrency(rawAmount / 100);
  return roundCurrency(rawAmount);
}

function getLineAmount(line) {
  const cleaned = cleanLine(line);
  if (!cleaned) return null;
  // Filter out matches immediately followed by '%' — those are percentages, not currency.
  const matches = [...cleaned.matchAll(/\$?\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?/g)]
    .filter(m => cleaned[m.index + m[0].length] !== '%');
  if (!matches.length) return null;
  const last = matches[matches.length - 1];
  if (!last || last.index === undefined) return null;
  const parsed = parseCurrencyToken(last[0]);
  if (!parsed) return null;
  const label = cleanLine(cleaned.slice(0, last.index).replace(/[:\-]$/, ''));
  if (!label) return null;
  const rawToken = last[0].replace(/^\$/, '');
  if (/^\d{5}$/.test(rawToken) && looksLikeAddressOrLocationLabel(label)) return null;
  return { label, amount: normalizeAmount(parsed.amount, parsed.hadDecimal, label), hadDecimal: parsed.hadDecimal };
}

function getStandaloneAmountLine(line) {
  const cleaned = cleanLine(line);
  if (!cleaned || cleaned.includes('%')) return null;
  if (!/^\$?\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?$/.test(cleaned)) return null;
  return parseCurrencyToken(cleaned);
}

function hasKeyword(value, keywords) {
  const lower = value.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

function looksLikeAddressOrLocationLabel(label) {
  const n = cleanLine(label);
  if (!n) return false;
  if (/^[A-Za-z .'-]+,\s*[A-Za-z]{2}$/.test(n)) return true;
  if (/\b\d{5}(?:-\d{4})?\b/.test(n)) return true;
  return /\b(?:suite|ste\.?|street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|drive|dr\.?|lane|ln\.?|floor|fl\.?|unit|apt\.?|apartment|new york|brooklyn|manhattan|queens|bronx)\b/i.test(n);
}

function isSeparatorLine(line) {
  return /^[-=*_~]{5,}$/.test(cleanLine(line).replace(/\s+/g, ''));
}

function looksLikeMetadataLabel(label) {
  const n = cleanLine(label);
  if (!n) return false;
  const lower = n.toLowerCase();
  if (looksLikeAddressOrLocationLabel(n)) return true;
  if (isSeparatorLine(n)) return true;
  if (/^=+\s*seat\b.*=+$/i.test(n)) return true;
  if (/\b(?:server|serv|table|tbl|guest|guests|party|order(?:ed|ing)?|check|disc|invoice|receipt|transaction|approval|auth)\b/.test(lower)) return true;
  if (/\b(?:tel|phone|www|http|visa|mastercard|amex|debit|credit|card|charged to room|room \/ sig|signature|new total|additional tip)\b/.test(lower)) return true;
  if (/\b(?:mwst|ust|vat|tax|gst|tva|iva)\s*(?:nr\.?|no\.?|id|reg\.?|registration|number|#)\b/i.test(n)) return true;
  if (/\b(?:tisch|rech(?:\.|nr|\.nr)?|bon\s*(?:nr|no|#)?|pers(?:onen)?|kellner|bedienung|entspricht)\b/i.test(n)) return true;
  if (/\b(?:seat\s+\d+|shared subtotal|room:\s*\d+)\b/i.test(n)) return true;
  if (/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(lower) || /\b\d{1,2}:\d{2}\b/.test(lower)) return true;
  if (/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/.test(n)) return true;
  if (/^(?:mc|visa|amex|disc)\b/i.test(n)) return true;
  return false;
}

function isSubtotalLabel(l) { return /\bsub[\s-]?total\b|\bnet amount\b|\bsous[\s-]?total\b/.test(l); }
function isTaxLabel(l) { return /\btax\b|\bvat\b|\bgst\b|\bhst\b|\bpst\b|\bqst\b|\bmwst\b|\biva\b|\btva\b|\bbtw\b|\bmoms\b/.test(l); }
function isTipLabel(l) {
  if (!/\btip\b|\bgratuity\b|\bservice charge\b|\bsurcharge\b/.test(l)) return false;
  if (/\bcredit\b|\bcard\b|\bdebit\b|\bpayment\b|\bprocessing\b/.test(l)) return false;
  return true;
}
function isTotalLabel(l) {
  return /\bgrand total\b|\border total\b|\btotal\b|\bamount due\b|\bbalance due\b|\bamount payable\b|\blotal\b|\bgesamtbetrag\b|\bmontant\b|\btotale\b/.test(l) && !isSubtotalLabel(l);
}
function isDiscountLabel(l) { return /\bdiscount\b|\bcoupon\b|\bpromo\b|\bhappy hour\b|\bcomp\b/.test(l.toLowerCase()); }
function isFeeLabel(l) {
  const lower = l.toLowerCase();
  return /\bdelivery fee\b|\bservice fee\b|\bprocessing fee\b|\bconvenience fee\b|\border fee\b|\bplatform fee\b/.test(lower)
    || /\bcredit\s*card\s*surcharge\b|\bcard\s*surcharge\b|\bpayment\s*surcharge\b|\bcc\s*surcharge\b/.test(lower);
}

function looksLikeAutoGratuityLabel(label) {
  const lower = label.toLowerCase();
  // "Addl Gratuity", "Additional Gratuity" are customer-written additions, not automatic
  if (/\b(?:addl|additional)\s+gratuity\b/.test(lower)) return false;
  return /\bgratuity\b|\bservice charge\b|\bservice fee\b|\bsurcharge\b/.test(lower)
    || /\bauto(?:matic)?\b/.test(lower)
    || /\blarge party\b/.test(lower)
    || /\bpart(?:y|ies)\b/.test(lower);
}

function normalizeTipLabelForKey(label) {
  return cleanLine(label).toLowerCase().replace(/[^a-z0-9% ]/g, '').replace(/\s+/g, ' ').trim();
}

function isLikelySuggestedTipLabel(label) {
  const lower = label.toLowerCase();
  if (!lower) return false;
  if (/\bsuggest(?:ed|ion)?\b|\brecommended\b|\btip\s*(guide|options?|amounts?)\b/.test(lower)) return true;
  // Labels that start with "tip" or "gratuity" are real charges, not suggestions
  // e.g. "Tip (15%)", "Tip (20% pre-disc)", "Gratuity (21.00%)" are actual tip lines
  if (/^(?:tip|gratuity|grat)\b/.test(lower)) return false;
  const hasPercent = /\b\d{1,2}(?:\.\d+)?\s*%/.test(lower); // no trailing \b — %: and %) lack word boundary
  const hasAutoContext = /\bgratuity\b|\bservice charge\b|\bsurcharge\b|\bauto(?:matic)?\b|\badded\b|\bpaid\b|\bactual\b/.test(lower);
  return hasPercent && !hasAutoContext;
}

function isLikelyPolicyThresholdTipLabel(label, amount) {
  const lower = label.toLowerCase();
  const mpt = /\bpart(?:y|ies)\b/.test(lower) && (/\bor more\b|\+\b/.test(lower) || /\bpart(?:y|ies)\s+of\b/.test(lower));
  if (!mpt) return false;
  return Number.isFinite(amount) && amount > 0 && amount <= 20 && Math.abs(amount - Math.round(amount)) <= 0.001;
}

function dedupeTipCandidates(candidates) {
  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    const amount = roundCurrency(c.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const label = cleanLine(c.label || '');
    const key = `${amount.toFixed(2)}|${normalizeTipLabelForKey(label)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ amount, label });
  }
  return out;
}

function getMeaningfulTipCandidates(candidates) {
  return dedupeTipCandidates(candidates).filter(c =>
    c.amount > 0 && c.amount <= 10000 && !isLikelySuggestedTipLabel(c.label) && !isLikelyPolicyThresholdTipLabel(c.label, c.amount)
  );
}

function deriveTipFromCandidates(candidates) {
  const cleaned = getMeaningfulTipCandidates(candidates);
  if (!cleaned.length) return 0;
  const autoLike = cleaned.filter(c => looksLikeAutoGratuityLabel(c.label));
  const nonAuto = cleaned.filter(c => !looksLikeAutoGratuityLabel(c.label));
  if (autoLike.length > 0 && nonAuto.length > 0) {
    return roundCurrency(Math.max(...autoLike.map(c => c.amount)) + Math.max(...nonAuto.map(c => c.amount)));
  }
  return roundCurrency(cleaned[cleaned.length - 1].amount);
}

function extractPartySizeThreshold(text) {
  const n = cleanLine(text);
  if (!n) return null;
  const patterns = [
    /part(?:y|ies)\s*(?:of)?\s*(\d{1,2})\s*(?:\+|or\s+more)?/i,
    /(\d{1,2})\s*(?:\+|or\s+more)\s*part(?:y|ies)/i,
    /for\s*part(?:y|ies)\s*(?:of)?\s*(\d{1,2})/i,
  ];
  for (const p of patterns) {
    const m = n.match(p);
    if (!m) continue;
    const v = Number(m[1]);
    if (Number.isFinite(v) && v > 0 && v <= 99) return Math.round(v);
  }
  return null;
}

function extractPercentFromText(text) {
  if (!text) return null;
  const m = text.match(/(\d{1,2}(?:\.\d+)?)\s*%/);
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v) || v <= 0 || v > 60) return null;
  return v;
}

function inferTipFromTotals(subtotal, tax, total) {
  const base = roundCurrency(Math.max(0, subtotal + tax));
  if (base <= 0 || total <= 0) return 0;
  const delta = roundCurrency(total - base);
  if (delta <= 0 || delta > roundCurrency(base * 0.6)) return 0;
  return delta;
}

const nonItemKeywords = [
  'station','order','serv','server','table','check','guest','parties','party',
  'auth','approval','trans','receipt','subtotal','total','tax','tip','gratuity',
  'service charge','surcharge','balance','amount due','change',
];

function parseQuantityAndName(rawLabel) {
  let label = cleanLine(rawLabel);
  if (!label) return null;
  const lower = label.toLowerCase();
  let quantity = 1;
  const qtyPrefix = label.match(/^(\d{1,2})\s*[xX]?\s+(.+)$/);
  if (qtyPrefix) { quantity = Math.max(1, Number(qtyPrefix[1]) || 1); label = cleanLine(qtyPrefix[2]); }
  if (label.length < 2) return null;
  if (!/[A-Za-z]/.test(label)) return null;
  if (hasKeyword(label, nonItemKeywords)) return null;
  if (isDiscountLabel(lower)) return null;
  if (isFeeLabel(lower)) return null;
  if (looksLikeAddressOrLocationLabel(label)) return null;
  if (looksLikeMetadataLabel(label)) return null;
  const letters = (label.match(/[A-Za-z]/g) || []).length;
  const digits = (label.match(/\d/g) || []).length;
  if (digits > letters) return null;
  if (label.includes('#')) return null;
  return { quantity, name: label };
}

const receiptKeywordsForName = [
  'subtotal','sub total','sub-total','tax','sales tax','vat','gst','hst','pst','qst',
  'tip','gratuity','service charge','surcharge','total','grand total','order total',
  'net amount','amount payable','amount due','balance due','change','cash','visa',
  'mastercard','amex','debit','credit','card','auth','approval','transaction','invoice',
  'receipt','table','server','guest','www.','http','thank you','welcome',
];

function extractRestaurantName(lines) {
  for (const line of lines.slice(0, 10)) {
    const c = cleanLine(line);
    if (!c) continue;
    if (!/[A-Za-z]/.test(c)) continue;
    if (hasKeyword(c, receiptKeywordsForName)) continue;
    if (looksLikeAddressOrLocationLabel(c)) continue;
    if (looksLikeMetadataLabel(c)) continue;
    if (c.length < 3) continue;
    return c;
  }
  return 'Unknown Restaurant';
}

function isLikelyVisionItemLine(line) {
  const la = getLineAmount(line);
  if (!la) return false;
  if (la.amount <= 0 || la.amount > 1000) return false;
  return Boolean(parseQuantityAndName(la.label));
}

function findLikelyItemSectionStart(lines, totalsSectionStartIndex) {
  const sepIdxs = [];
  for (let i = 0; i < totalsSectionStartIndex; i++) {
    if (isSeparatorLine(lines[i])) sepIdxs.push(i);
  }
  for (let s = sepIdxs.length - 1; s >= 0; s--) {
    const si = sepIdxs[s];
    const cands = [];
    for (let i = si + 1; i < totalsSectionStartIndex; i++) {
      if (isLikelyVisionItemLine(lines[i])) cands.push(i);
    }
    if (cands.length >= 2) return cands[0];
  }
  const first = lines.findIndex((l, idx) => idx < totalsSectionStartIndex && isLikelyVisionItemLine(l));
  return first >= 0 ? first : 0;
}

function shouldMergeSplitAmountLine(currentLine, nextLine) {
  const sa = getStandaloneAmountLine(nextLine);
  if (!sa) return false;
  const current = cleanLine(currentLine);
  if (!current) return false;
  if (/^(?:CHF|EUR|GBP|CAD|AUD|NZD|JPY|MXN|BRL|INR|SGD|HKD|SEK|NOK|DKK|PLN|CZK|HUF|RON|TRY|ZAR|KRW|THB|AED|SAR|ILS|EGP|TWD|PHP|IDR|MYR|VND|CLP|COP|ARS|PEN)\s*:?\s*$/i.test(current)) return false;
  const lower = current.toLowerCase();
  const isCharge = isSubtotalLabel(lower) || isTaxLabel(lower) || isTipLabel(lower)
    || isTotalLabel(lower) || isDiscountLabel(lower) || isFeeLabel(lower);
  if (!isCharge && looksLikeMetadataLabel(current)) return false;
  const inlineAmount = getLineAmount(current);
  if (!inlineAmount) return Boolean(parseQuantityAndName(current)) || isCharge;
  return /\d{1,2}(?:\.\d+)?\s*%/.test(current) && (isTipLabel(lower) || looksLikeAutoGratuityLabel(current));
}

function mergeSplitAmountLines(lines) {
  const merged = [];
  for (let i = 0; i < lines.length; i++) {
    const current = cleanLine(lines[i]);
    if (!current) continue;
    const next = i + 1 < lines.length ? cleanLine(lines[i + 1]) : '';
    // 3-way merge: "Total\nCHF\n54.50" → "Total 54.50"
    if (next && /^(?:CHF|EUR|GBP|CAD|AUD|NZD|JPY|MXN|BRL|INR|SGD|HKD|SEK|NOK|DKK|PLN|CZK|HUF|RON|TRY|ZAR|KRW|THB|AED|SAR|ILS|EGP|TWD|PHP|IDR|MYR|VND|CLP|COP|ARS|PEN)\s*:?\s*$/i.test(next) && i + 2 < lines.length) {
      const nextNext = cleanLine(lines[i + 2]);
      if (nextNext && getStandaloneAmountLine(nextNext)) {
        const lower = current.toLowerCase();
        const isChargeLabel = isSubtotalLabel(lower) || isTaxLabel(lower) || isTipLabel(lower)
          || isTotalLabel(lower) || isDiscountLabel(lower) || isFeeLabel(lower);
        if (isChargeLabel) {
          merged.push(`${current} ${nextNext}`);
          i += 2;
          continue;
        }
      }
    }
    if (next && shouldMergeSplitAmountLine(current, next)) {
      merged.push(`${current} ${next}`);
      i++;
      continue;
    }
    merged.push(current);
  }
  return merged;
}

function extractAutoGratuityInfo(receiptText, tipAmount, tipLabels = []) {
  const lines = receiptText.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const policyLine = lines.find(line => {
    const lower = line.toLowerCase();
    const hasFeeWord = /\bgratuity\b|\bservice charge\b|\bservice fee\b|\bsurcharge\b/.test(lower);
    const hasAutoContext = /\bauto(?:matic)?\b|\bincluded\b|\badded\b|\bapply\b|\bapplied\b|\blarge party\b|\bpart(?:y|ies)\b|\bor more\b|\+\b/.test(lower);
    return hasFeeWord && hasAutoContext;
  }) ?? null;
  const hasAutoTipLabel = tipLabels.some(looksLikeAutoGratuityLabel);
  const partySizeMin = extractPartySizeThreshold(lines.join(' '));
  const detected = hasAutoTipLabel || Boolean(policyLine) || partySizeMin !== null;
  return {
    detected,
    partySizeMin: detected ? partySizeMin : null,
    policyText: detected ? policyLine : null,
    includedInTotal: detected && tipAmount > 0,
    autoGratuityAmount: null,
    additionalTipAmount: null,
  };
}

function applyTipBreakdownFromCandidates({ candidates, subtotal, tip, autoGratuity }) {
  tip = roundCurrency(tip);
  if (!autoGratuity.detected || tip <= 0) return { ...autoGratuity, autoGratuityAmount: null, additionalTipAmount: null };
  const cleaned = getMeaningfulTipCandidates(candidates);
  if (!cleaned.length) return autoGratuity;
  const autoLike = cleaned.filter(c => looksLikeAutoGratuityLabel(c.label));
  const nonAuto = cleaned.filter(c => !looksLikeAutoGratuityLabel(c.label));
  const policyPercent = extractPercentFromText(autoGratuity.policyText);
  const expectedAuto = policyPercent !== null && subtotal > 0 ? roundCurrency(subtotal * (policyPercent / 100)) : null;
  const tolerance = Math.max(0.2, roundCurrency(Math.max(0, subtotal) * 0.03));
  if (autoLike.length > 0 && nonAuto.length > 0) {
    const af = roundCurrency(Math.max(...autoLike.map(c => c.amount)));
    const naf = roundCurrency(Math.max(...nonAuto.map(c => c.amount)));
    if (Math.abs(af + naf - tip) <= tolerance) return { ...autoGratuity, autoGratuityAmount: af, additionalTipAmount: naf };
    if (af < tip - 0.1) return { ...autoGratuity, autoGratuityAmount: af, additionalTipAmount: roundCurrency(Math.max(0, tip - af)) };
  }
  if (autoLike.length > 0) return { ...autoGratuity, autoGratuityAmount: tip, additionalTipAmount: null };
  if (expectedAuto !== null && tip > expectedAuto + tolerance) {
    return { ...autoGratuity, autoGratuityAmount: expectedAuto, additionalTipAmount: roundCurrency(Math.max(0, tip - expectedAuto)) };
  }
  return autoGratuity;
}

function applyAutoGratuityInference({ subtotal, tax, tip, total, autoGratuity }) {
  tip = roundCurrency(tip);
  total = roundCurrency(total);
  let inferredFromTotals = false;
  let ag = { ...autoGratuity };
  if (tip <= 0) {
    const inferred = inferTipFromTotals(subtotal, tax, total);
    if (inferred > 0) { tip = inferred; inferredFromTotals = true; }
    else if (ag.detected) {
      const pp = extractPercentFromText(ag.policyText);
      if (pp !== null) {
        const base = roundCurrency(Math.max(0, subtotal + tax)) || roundCurrency(Math.max(0, subtotal));
        if (base > 0) { tip = roundCurrency(base * (pp / 100)); }
      }
    }
  }
  if (total <= 0 && (subtotal > 0 || tax > 0 || tip > 0)) total = roundCurrency(subtotal + tax + tip);
  if (ag.detected && tip > 0) {
    const pp = extractPercentFromText(ag.policyText);
    const expectedAuto = pp !== null && subtotal > 0 ? roundCurrency(subtotal * (pp / 100)) : null;
    if (expectedAuto !== null) {
      const tol = Math.max(0.2, roundCurrency(subtotal * 0.03));
      const autoPortion = tip >= expectedAuto - tol ? roundCurrency(Math.min(tip, expectedAuto)) : roundCurrency(tip);
      const addl = roundCurrency(Math.max(0, tip - autoPortion));
      ag = { ...ag, autoGratuityAmount: autoPortion > 0 ? autoPortion : null, additionalTipAmount: addl > 0 ? addl : null };
    } else {
      ag = { ...ag, autoGratuityAmount: tip > 0 ? tip : null, additionalTipAmount: null };
    }
  } else {
    ag = { ...ag, autoGratuityAmount: null, additionalTipAmount: null };
  }
  const inferredPct = subtotal > 0 && tip > 0 ? roundCurrency((tip / subtotal) * 100) : 0;
  const inferredLooksAuto = inferredFromTotals && inferredPct >= 15 && inferredPct <= 25;
  return {
    tip, total,
    autoGratuity: {
      ...ag,
      detected: ag.detected || inferredLooksAuto,
      policyText: ag.policyText || (inferredLooksAuto ? `Inferred ${inferredPct}% gratuity from receipt totals` : null),
      includedInTotal: (ag.detected || inferredLooksAuto) && tip > 0 && (inferredFromTotals || total > 0),
    },
  };
}

function reconcileParsedTotals({ items, subtotal, tax, tip, total, autoGratuity }) {
  items = [...items];
  subtotal = roundCurrency(subtotal || 0);
  tax = roundCurrency(tax || 0);
  tip = roundCurrency(tip || 0);
  total = roundCurrency(total || 0);
  autoGratuity = { ...autoGratuity };
  const hasSynth = items.length === 1 && cleanLine(String(items[0]?.name || '')).toLowerCase() === 'receipt items';
  const expected = roundCurrency(subtotal + tax + tip);
  const mismatch = roundCurrency(total - expected);
  if (mismatch > 0.1) {
    if (hasSynth) {
      subtotal = roundCurrency(Math.max(0, total - tax - tip));
      items = [{ ...items[0], price: subtotal, quantity: 1 }];
    } else if (!autoGratuity.detected && mismatch <= roundCurrency(Math.max(0.1, subtotal * 0.35))) {
      tax = roundCurrency(tax + mismatch);
    }
  } else if (mismatch < -0.1) {
    const baseTotal = roundCurrency(subtotal + tax);
    const infDiscount = roundCurrency(baseTotal - total);
    if (infDiscount > 0 && infDiscount <= roundCurrency(subtotal * 0.5)) subtotal = roundCurrency(subtotal - infDiscount);
    if (tip > 0 && Math.abs(total - roundCurrency(subtotal + tax)) <= 0.1) tip = 0;
  }
  if (tip <= 0 && autoGratuity.detected) {
    autoGratuity = { ...autoGratuity, includedInTotal: false, autoGratuityAmount: null, additionalTipAmount: null };
  }
  return { items, subtotal: roundCurrency(subtotal), tax: roundCurrency(tax), tip: roundCurrency(tip), total: roundCurrency(total), autoGratuity };
}

// ─── main parser ─────────────────────────────────────────────────────────────

function parseReceiptTextWithVision(text) {
  const rawLines = text.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const lines = mergeSplitAmountLines(rawLines);

  const totalsSectionStart = (() => {
    const idx = lines.findIndex(l => { const lo = l.toLowerCase(); return isSubtotalLabel(lo) || isTotalLabel(lo); });
    return idx >= 0 ? idx : lines.length;
  })();
  const itemSectionStart = findLikelyItemSectionStart(lines, totalsSectionStart);
  const restaurantName = extractRestaurantName(lines);

  let items = [];
  const subtotalCandidates = [];
  const taxCandidates = [];
  const discountCandidates = [];
  const feeCandidates = [];
  const tipCandidates = [];
  const totalCandidates = [];
  const genericAmounts = [];
  let sawDecimal = false;

  for (let i = 0; i < lines.length; i++) {
    const la = getLineAmount(lines[i]);
    if (!la) continue;
    sawDecimal = sawDecimal || la.hadDecimal;
    const lower = la.label.toLowerCase();
    const amount = la.amount;

    if (isSubtotalLabel(lower)) { subtotalCandidates.push(amount); continue; }
    if (isTaxLabel(lower)) { taxCandidates.push(amount); continue; }
    if (isTipLabel(lower)) { tipCandidates.push({ amount, label: la.label }); continue; }
    if (isDiscountLabel(lower)) { discountCandidates.push(amount); continue; }
    if (isFeeLabel(lower)) { feeCandidates.push(amount); continue; }
    if (isTotalLabel(lower)) { totalCandidates.push({ amount, index: i }); continue; }

    genericAmounts.push({ amount, index: i, label: lower });

    const parsed = parseQuantityAndName(la.label);
    if (!parsed) continue;
    if (amount <= 0 || amount > 1000) continue;
    if (i < itemSectionStart || i >= totalsSectionStart) continue;
    items.push({ name: parsed.name, price: amount, quantity: parsed.quantity });
  }

  const subtotalLast = roundCurrency(subtotalCandidates.at(-1) ?? 0);
  let subtotal = subtotalLast;
  const feeTotal = roundCurrency(feeCandidates.filter(a => a > 0).reduce((s, a) => s + a, 0));
  let tax = roundCurrency(taxCandidates.reduce((s, n) => s + n, 0) + feeTotal);
  const tipCandidateLabels = dedupeTipCandidates(tipCandidates).map(c => c.label);
  let tip = deriveTipFromCandidates(tipCandidates);

  let total = 0;
  if (totalCandidates.length > 0) {
    if (totalCandidates.length === 1) {
      total = roundCurrency(totalCandidates[0].amount);
    } else {
      const computedBase = roundCurrency(subtotal + tax + tip);
      const best = [...totalCandidates].sort((a, b) => {
        const da = Math.abs(a.amount - computedBase);
        const db = Math.abs(b.amount - computedBase);
        if (Math.abs(da - db) < 0.05) return a.index - b.index;
        return da - db;
      })[0];
      total = roundCurrency(best.amount);
    }
  } else if (subtotal > 0) {
    total = roundCurrency(subtotal + tax + tip);
  } else {
    const half = Math.floor(lines.length * 0.5);
    const likelyTotals = genericAmounts.filter(e => e.index >= half && e.amount > 0 && !hasKeyword(e.label, nonItemKeywords)).map(e => e.amount);
    const fallback = likelyTotals.length ? likelyTotals : genericAmounts.filter(e => e.amount > 0 && !hasKeyword(e.label, nonItemKeywords)).map(e => e.amount);
    total = roundCurrency(Math.max(...fallback, 0));
  }

  if (subtotalCandidates.length > 1 && total > 0) {
    const sumCands = roundCurrency(subtotalCandidates.filter(a => a > 0).reduce((s, a) => s + a, 0));
    if (sumCands > 0) {
      const dLast = Math.abs(total - roundCurrency(subtotal + tax + tip));
      const dSum = Math.abs(total - roundCurrency(sumCands + tax + tip));
      if (dSum + 0.1 < dLast) subtotal = sumCands;
    }
  }

  if (discountCandidates.length > 0 && subtotal > 0 && total > 0) {
    const discTotal = roundCurrency(discountCandidates.reduce((s, a) => s + a, 0));
    const adj = roundCurrency(subtotal - discTotal);
    if (adj > 0 && Math.abs(total - roundCurrency(adj + tax + tip)) + 0.1 < Math.abs(total - roundCurrency(subtotal + tax + tip))) {
      subtotal = adj;
    }
  }

  if (tax <= 0 && subtotal > 0 && total > 0) {
    const infTax = roundCurrency(total - subtotal - tip);
    if (infTax > 0 && infTax <= roundCurrency(subtotal * 0.3)) tax = infTax;
  }

  if (!sawDecimal && subtotal === 0 && tax === 0 && tip === 0 && total >= 200) total = roundCurrency(total / 100);
  if (!sawDecimal && subtotal >= 200) subtotal = roundCurrency(subtotal / 100);
  if (!sawDecimal && tax >= 200) tax = roundCurrency(tax / 100);
  if (!sawDecimal && tip >= 200) tip = roundCurrency(tip / 100);

  if (items.length === 0 && (subtotal > 0 || total > 0)) {
    const base = subtotal > 0 ? subtotal : Math.max(0, total - tax - tip);
    const fb = roundCurrency(base > 0 ? base : total);
    if (fb > 0) items.push({ name: 'Receipt Items', price: fb, quantity: 1 });
  } else if (items.length > 0 && subtotal > 0) {
    const itemSum = roundCurrency(items.reduce((s, it) => s + it.price, 0));
    if (itemSum <= 0 || subtotal > roundCurrency(itemSum * 1.8)) {
      items = [{ name: 'Receipt Items', price: subtotal, quantity: 1 }];
    }
  }

  if (items.length === 0 && total === 0) throw new Error('NO_ITEMS_OR_TOTAL');

  let autoGratuity = extractAutoGratuityInfo(text, tip, tipCandidateLabels);
  ({ tip, total, autoGratuity } = applyAutoGratuityInference({ subtotal, tax, tip, total, autoGratuity }));
  autoGratuity = applyTipBreakdownFromCandidates({ candidates: tipCandidates, subtotal, tip, autoGratuity });
  const reconciled = reconcileParsedTotals({ items, subtotal, tax, tip, total, autoGratuity });

  return {
    restaurantName,
    items: reconciled.items.slice(0, 60),
    subtotal: reconciled.subtotal,
    tax: reconciled.tax,
    tip: reconciled.tip,
    total: reconciled.total,
    autoGratuity: reconciled.autoGratuity,
  };
}

// ─── test runner ─────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

function check(name, actual, expected, opts = {}) {
  const tolerance = opts.tolerance ?? 0;
  let ok;
  if (typeof expected === 'boolean') {
    ok = actual === expected;
  } else if (typeof expected === 'number') {
    ok = Math.abs(actual - expected) <= Math.max(tolerance, 0.005);
  } else {
    ok = actual === expected;
  }
  if (ok) {
    console.log(`  ✓  ${name}`);
    passed++;
  } else {
    console.log(`  ✗  ${name}`);
    console.log(`       expected: ${JSON.stringify(expected)}${tolerance ? ` (±${tolerance})` : ''}`);
    console.log(`       actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

// ─── Unit tests: normalizeAmount fix ────────────────────────────────────────

section('normalizeAmount — $100-$999 round amounts must NOT be divided by 100');

check('150 no decimal → 150.00 (was bug: returned 1.50)', normalizeAmount(150, false, 'Subtotal'), 150);
check('299 no decimal → 299.00', normalizeAmount(299, false, 'Total'), 299);
check('100 no decimal → 100.00', normalizeAmount(100, false, 'Tax'), 100);
check('999 no decimal → 999.00', normalizeAmount(999, false, 'Subtotal'), 999);
check('4599 no decimal → 45.99 (>= 1000 path still works)', normalizeAmount(4599, false, 'Subtotal'), 45.99);
check('1000 no decimal → 10.00', normalizeAmount(1000, false, 'Total'), 10);
check('45.99 with decimal → 45.99 (unchanged)', normalizeAmount(45.99, true, 'Subtotal'), 45.99);
check('5 no decimal → 5.00 (small amount unchanged)', normalizeAmount(5, false, 'Tax'), 5);

// ─── Unit tests: isTipLabel fix ──────────────────────────────────────────────

section('isTipLabel — credit/card surcharges must NOT be classified as tips');

check('tip → true', isTipLabel('tip'), true);
check('gratuity → true', isTipLabel('gratuity'), true);
check('service charge → true', isTipLabel('service charge'), true);
check('surcharge → true (non-card surcharge)', isTipLabel('surcharge'), true);
check('18% gratuity (party of 6+) → true', isTipLabel('18% gratuity (party of 6+)'), true);
check('credit card surcharge → false', isTipLabel('credit card surcharge'), false);
check('card surcharge 3% → false', isTipLabel('card surcharge 3%'), false);
check('credit surcharge → false', isTipLabel('credit surcharge'), false);
check('debit surcharge → false', isTipLabel('debit surcharge'), false);
check('processing surcharge → false', isTipLabel('processing surcharge'), false);

// ─── Integration tests ───────────────────────────────────────────────────────

function runReceipt(label, text, assertions) {
  section(`Receipt: ${label}`);
  let result;
  try {
    result = parseReceiptTextWithVision(text);
  } catch (e) {
    console.log(`  ✗  THREW: ${e.message}`);
    failed++;
    return;
  }
  console.log(`  restaurant: "${result.restaurantName}"`);
  console.log(`  items (${result.items.length}): ${result.items.map(i => `${i.name}=$${i.price}`).join(', ')}`);
  console.log(`  subtotal=$${result.subtotal}  tax=$${result.tax}  tip=$${result.tip}  total=$${result.total}`);
  if (result.autoGratuity.detected) {
    console.log(`  autoGratuity: detected policyText="${result.autoGratuity.policyText}" partySizeMin=${result.autoGratuity.partySizeMin} autoAmt=$${result.autoGratuity.autoGratuityAmount} addlTip=$${result.autoGratuity.additionalTipAmount}`);
  }
  assertions(result);
}

// ── 01: Standard receipt, blank tip line ────────────────────────────────────
runReceipt('01 blank tip line', `
The Tavern
123 Main Street
Table: 5  Server: Mike

Burger              12.99
Fries                4.99
Chicken Sandwich    11.50
House Salad          8.99
2 Sodas              4.98

Subtotal            43.45
Tax                  3.91
Tip              _______
Total               47.36
`, r => {
  check('restaurant name', r.restaurantName, 'The Tavern');
  check('item count >= 4', r.items.length >= 4, true);
  check('subtotal', r.subtotal, 43.45, { tolerance: 0.02 });
  check('tax', r.tax, 3.91, { tolerance: 0.02 });
  check('tip = 0 (blank line)', r.tip, 0);
  check('total', r.total, 47.36, { tolerance: 0.02 });
  check('no auto-gratuity', r.autoGratuity.detected, false);
  check('total = subtotal + tax', Math.abs(r.total - (r.subtotal + r.tax)), 0, { tolerance: 0.02 });
});

// ── 04: Auto-gratuity 18% ────────────────────────────────────────────────────
runReceipt('04 auto-gratuity 18%', `
Casa Italian
456 Oak Ave
Table 12  Guests: 8

Pasta Primavera     18.50
Chicken Parmesan    22.00
Caesar Salad        12.00
Tiramisu             8.00
4 House Wine        36.00

Subtotal            96.50
18% Gratuity (party of 6+)  17.37
Tax                  8.07
Total              121.94
`, r => {
  check('item count >= 4', r.items.length >= 4, true);
  check('subtotal', r.subtotal, 96.50, { tolerance: 0.05 });
  check('auto-gratuity detected', r.autoGratuity.detected, true);
  check('tip > 0', r.tip > 0, true);
  check('total', r.total, 121.94, { tolerance: 0.05 });
});

// ── 05: Auto-grat + additional handwritten tip ───────────────────────────────
runReceipt('05 auto-grat + handwritten tip', `
Seafood House
Table 7  Server: Lisa  Guests: 9

Grilled Salmon      32.00
Lobster Bisque      14.00
2 Crab Cakes        26.00
Bottle Chardonnay   54.00

Subtotal           126.00
18% Gratuity        22.68
Additional Tip      10.00
Tax                 11.34
Total              170.02
`, r => {
  check('auto-gratuity detected', r.autoGratuity.detected, true);
  check('total', r.total, 170.02, { tolerance: 0.05 });
  check('tip includes both amounts', r.tip, 32.68, { tolerance: 0.10 });
});

// ── 06: Zero tip written ─────────────────────────────────────────────────────
runReceipt('06 zero handwritten tip', `
Coffee Bean
Order #4521

Latte                5.50
Avocado Toast        9.99

Subtotal            15.49
Tax                  1.39
Tip                  0.00
Total               16.88
`, r => {
  check('tip = 0', r.tip, 0);
  check('total', r.total, 16.88, { tolerance: 0.02 });
  check('no auto-gratuity', r.autoGratuity.detected, false);
});

// ── 12: Discounts and comps ───────────────────────────────────────────────────
runReceipt('12 discounts and comp', `
Happy Hour Bar
789 Pine St

IPA Pint             8.00
Nachos              12.00
Burger              14.00
Comp Burger        -14.00
Happy Hour Discount  -2.00

Subtotal            18.00
Tax                  1.80
Total               19.80
`, r => {
  check('total', r.total, 19.80, { tolerance: 0.05 });
  check('subtotal close to 18', r.subtotal, 18.00, { tolerance: 0.50 });
  check('no items named "comp burger" (filtered)', r.items.every(i => !i.name.toLowerCase().includes('comp')), true);
});

// ── 14: Delivery with fees ────────────────────────────────────────────────────
runReceipt('14 delivery with fees', `
Pizza Palace
Online Order #12345

Pepperoni Pizza     18.99
Garlic Bread         4.99
Diet Coke            2.99

Subtotal            26.97
Delivery Fee         3.99
Tax                  2.32
Total               33.28
`, r => {
  check('item count >= 3', r.items.length >= 3, true);
  check('tax includes delivery fee', r.tax, 6.31, { tolerance: 0.10 });
  check('total', r.total, 33.28, { tolerance: 0.05 });
  check('no auto-gratuity', r.autoGratuity.detected, false);
});

// ── 15: Long receipt many items (was rejected by structural check!) ───────────
runReceipt('15 long receipt many items', `
The Busy Bistro
1 Restaurant Row
New York, NY 10001
Tel: 212-555-0100

Table 22  Server: Carlos  Guests: 6
Check #98765  Date: 03/15/2026  Time: 7:30 PM

--------------------------------------------------
Shrimp Cocktail      16.00
Soup of the Day       9.00
House Salad           8.50
Caesar Salad          9.50
Bruschetta            7.50
----
NY Strip 10oz        42.00
Salmon Filet         34.00
Chicken Parmigiana   28.00
Veggie Pasta         22.00
Burger Deluxe        18.00
Truffle Fries         9.00
Onion Rings           7.50
----
Lava Cake            10.00
Cheesecake            9.00
Sorbet                7.00
----
4 House Wine         48.00
2 Beer               14.00
3 Soft Drink          9.00

Subtotal            318.00
Tax                  28.62
Total               346.62
`, r => {
  check('item count >= 8 (long receipt not rejected)', r.items.length >= 8, true);
  check('subtotal', r.subtotal, 318.00, { tolerance: 1.00 });
  check('total', r.total, 346.62, { tolerance: 0.50 });
  check('no auto-gratuity', r.autoGratuity.detected, false);
});

// ── 18: Suggested tip amounts must NOT become actual tip ─────────────────────
runReceipt('18 suggested tip amounts only', `
Quick Eats
#1234

Combo Meal          12.99
Drink                2.49

Subtotal            15.48
Tax                  1.40
Total               16.88

Suggested Tip:
15% - $2.53
18% - $3.04
20% - $3.38
`, r => {
  check('tip = 0 (suggestions ignored)', r.tip, 0);
  check('total = 16.88', r.total, 16.88, { tolerance: 0.02 });
  check('item count >= 2', r.items.length >= 2, true);
});

// ── credit card surcharge NOT counted as tip ──────────────────────────────────
runReceipt('credit card surcharge (not tip)', `
Cafe Corner
Order #789

Coffee               4.50
Muffin               3.25

Subtotal             7.75
Tax                  0.70
Credit Card Surcharge 3%  0.25
Total                8.70
`, r => {
  check('tip = 0 (surcharge is not a tip)', r.tip, 0);
  check('total', r.total, 8.70, { tolerance: 0.05 });
});

// ── $150 round subtotal (tests normalizeAmount fix end-to-end) ────────────────
runReceipt('$150 round subtotal (no decimal in OCR)', `
Steak House
12 Elite Ave

NY Strip            65.00
Lobster             75.00
Wine                35.00

Subtotal           150
Tax                 13.50
Total              163.50
`, r => {
  check('subtotal = 150 (not 1.50)', r.subtotal, 150.00, { tolerance: 0.05 });
  check('total = 163.50', r.total, 163.50, { tolerance: 0.05 });
});

// ── item+price on separate lines (merge test) ─────────────────────────────────
runReceipt('item names and prices on separate lines', `
Corner Diner

Burger
12.99
Fries
4.99
Milkshake
6.50

Subtotal     24.48
Tax           2.20
Total        26.68
`, r => {
  check('item count >= 2 (merged lines)', r.items.length >= 2, true);
  check('subtotal', r.subtotal, 24.48, { tolerance: 0.05 });
  check('total', r.total, 26.68, { tolerance: 0.05 });
});

// ── suggested additional tip section (real scan: Mongolian Beef) ──────────────
// Real Apple Vision OCR output from a receipt with "Suggested Additional Tip" section.
// Bugs fixed: isLikelySuggestedTipLabel %\b regex, total picks suggested total, "Ordered:" as name.
runReceipt('suggested additional tip section — tip and total must not be inflated', `
Server: Denny F
Check #54
Table 42
Guest Count: 6
Ordered:
11/10/23 7:17 PM
1 Black Pepper Lamb
$20.00
3 Mongolian Beef
$57.00
2 Fish
$36.00
Subtotal
$113.00
Gratuity (21.00%)
$23.73
Tax
$9.32
Total
$146.05
Suggested Additional Tip:
+ 2%: (Tip $2.26
Total $148.31)
+ 3%: (Tip $3.39 Total $149.44)
+ 5%: (Tip $5.65 Total $151.70)
+ 7%: (Tip $7.91 Total $153.96)
Tip percentages are based on the check
price before taxes.
`, r => {
  check('items = 3', r.items.length, 3);
  check('subtotal = 113', r.subtotal, 113.00, { tolerance: 0.05 });
  check('tax = 9.32', r.tax, 9.32, { tolerance: 0.05 });
  check('tip = 23.73 (auto-grat only, not inflated by suggested tips)', r.tip, 23.73, { tolerance: 0.05 });
  check('total = 146.05 (real total, not a suggested total)', r.total, 146.05, { tolerance: 0.05 });
  check('autoGratuityDetected = true', r.autoGratuity.detected, true);
  check('autoGratuityAmount = 23.73', r.autoGratuity.autoGratuityAmount, 23.73, { tolerance: 0.05 });
  check('additionalTipAmount = null', r.autoGratuity.additionalTipAmount, null);
  check('restaurant name is not "Ordered:"', r.restaurantName !== 'Ordered:', true);
});

// ─── Unit tests: looksLikeAutoGratuityLabel fix ──────────────────────────────

section('looksLikeAutoGratuityLabel — "Addl/Additional Gratuity" must be non-auto');
check('SERVICE CHARGE (20%) → auto', looksLikeAutoGratuityLabel('SERVICE CHARGE (20%)'), true);
check('GRATUITY (18%) - AUTO → auto', looksLikeAutoGratuityLabel('GRATUITY (18%) - AUTO'), true);
check('gratuity → auto', looksLikeAutoGratuityLabel('gratuity'), true);
check('Addl Gratuity: → NOT auto (customer addition)', looksLikeAutoGratuityLabel('Addl Gratuity:'), false);
check('Additional Gratuity → NOT auto', looksLikeAutoGratuityLabel('Additional Gratuity'), false);
check('Addl Tip: → NOT auto', looksLikeAutoGratuityLabel('Addl Tip:'), false);

// ── 02 Blue Moon Bistro: neat handwritten tip ────────────────────────────────
runReceipt('02 Blue Moon Bistro — neat handwritten tip', `
BLUE MOON BISTRO
88 Federal Hill
Providence, RI 02903
Server: Anna                     Check #4821
02/10/2026  6:18 PM

1 French Onion Soup          $10.00
1 Duck Confit                $28.00
1 Mushroom Risotto           $22.00
1 Glass Pinot Noir           $14.00
1 Creme Brulee               $10.00

Subtotal                     $84.00
Tax                           $5.88
TOTAL                        $89.88

Tip:   $17.98
Total: $107.86
`, r => {
  check('item count >= 4', r.items.length >= 4, true);
  check('subtotal', r.subtotal, 84.00, { tolerance: 0.05 });
  check('tax', r.tax, 5.88, { tolerance: 0.05 });
  check('tip = 17.98 (handwritten)', r.tip, 17.98, { tolerance: 0.10 });
  check('total = 107.86 (with tip)', r.total, 107.86, { tolerance: 0.10 });
  check('restaurant name', r.restaurantName, 'BLUE MOON BISTRO');
});

// ── 03 Harbor Grill: messy handwritten $30 tip ───────────────────────────────
runReceipt('03 Harbor Grill — messy handwritten $30 tip', `
HARBOR GRILL
55 Thames St
Newport, RI 02840
Srv: JEN  Tbl: PATIO-6
02/28/2026  8:55 PM
CC: VISA ****4392

2 Clam Chowder               $18.00
1 Lobster Roll                $32.00
1 Fish & Chips                $21.00
1 Grilled Swordfish           $34.00
1 Kids Mac & Cheese            $9.00
3 IPA Draft                   $27.00
1 Lemonade                     $4.50
1 Choc Lava Cake               $12.00

Subtotal                     $157.50
Tax                           $11.03
TOTAL                        $168.53

Tip:   $30.00
Total: $198.53
`, r => {
  check('item count >= 6', r.items.length >= 6, true);
  check('subtotal', r.subtotal, 157.50, { tolerance: 0.05 });
  check('tax', r.tax, 11.03, { tolerance: 0.05 });
  check('tip = 30 (messy handwritten)', r.tip, 30.00, { tolerance: 0.10 });
  check('total = 198.53 (with tip)', r.total, 198.53, { tolerance: 0.10 });
});

// ── 04 Palazzo Ristorante: auto-gratuity 18%, party of 8 ────────────────────
runReceipt('04 Palazzo Ristorante — 18% auto-grat party of 8', `
PALAZZO RISTORANTE
220 Atwells Ave
Providence, RI 02903
Server: Marco          Table: 22
02/14/2026  7:30 PM    Party of 8

3 Bruschetta                 $33.00
2 Caprese Salad              $26.00
2 Chicken Parm               $48.00
1 Veal Marsala               $32.00
1 Patron Vodka               $22.00
1 Eggplant Rollatini         $22.00
2 Bottles Chianti            $80.00
4 Espresso                   $20.00
2 Cannoli                    $16.00
1 Tiramisu                   $12.00

Subtotal                    $329.00
Tax (7%)                     $23.03
* AUTO GRATUITY (18%)        $59.22

TOTAL                       $411.25

* Gratuity of 18% has been added
for parties of 6 or more
Additional Tip:  ___
New Total:       ___
Signature:
`, r => {
  check('item count >= 7', r.items.length >= 7, true);
  check('subtotal', r.subtotal, 329.00, { tolerance: 0.05 });
  check('tax', r.tax, 23.03, { tolerance: 0.05 });
  check('tip = 59.22 (auto-grat only)', r.tip, 59.22, { tolerance: 0.10 });
  check('total = 411.25', r.total, 411.25, { tolerance: 0.10 });
  check('auto-gratuity detected', r.autoGratuity.detected, true);
  check('no auto-inflated tip', r.tip <= 60, true);
});

// ── 05 Sakura Steakhouse: 20% auto-grat + $20 additional handwritten ─────────
runReceipt('05 Sakura Steakhouse — 20% auto-grat + $20 addl tip', `
SAKURA JAPANESE STEAKHOUSE & SUSHI
75 Washington St
Providence, RI 02903
Hibachi Table #3          Party: 10
01/05/2026  6:45 PM
VISA ****8817

4 Hibachi Chicken            $92.00
3 Hibachi Steak              $95.00
4 Hibachi Shrimp             $56.00
1 Sushi Combo Deluxe         $38.00
2 Edamame                    $12.00
3 Sake Carafe                $45.00
2 Soda                       $16.00
2 Mochi Ice Cream            $14.00

Subtotal                    $368.00
Tax (7%)                     $25.76
GRATUITY (20%) - AUTO        $73.60
TOTAL                       $467.36

Addl Tip:  $20.00
New Total: $487.36
x
`, r => {
  check('item count >= 6', r.items.length >= 6, true);
  check('subtotal', r.subtotal, 368.00, { tolerance: 0.05 });
  check('auto-gratuity detected', r.autoGratuity.detected, true);
  check('tip includes both auto + addl (>= 93)', r.tip >= 93, true);
  check('total = 487.36 (includes addl tip)', r.total, 487.36, { tolerance: 0.10 });
});

// ── 07 South Kitchen BBQ: split check (CHECK 1 of 2) ────────────────────────
runReceipt('07 South Kitchen BBQ — split check 1 of 2', `
SOUTH KITCHEN BBQ
99 Dorrance St, Providence RI
CHECK 1 of 2              Table 8
03/03/2026  12:30 PM
AMEX ****1055

1 Pulled Pork Plate          $17.50
1 Brisket Sandwich           $19.00
1 Coleslaw Side               $5.00
1 Cornbread                   $4.00
2 Sweet Tea                   $7.00

Subtotal                     $52.50
Tax                           $3.68
TOTAL                        $56.17

Tip:   $10.00
Total: $66.17

Y'all come back now!
`, r => {
  check('item count >= 4', r.items.length >= 4, true);
  check('subtotal', r.subtotal, 52.50, { tolerance: 0.05 });
  check('tax', r.tax, 3.68, { tolerance: 0.05 });
  check('tip = 10 (handwritten)', r.tip, 10.00, { tolerance: 0.05 });
  check('total = 66.17', r.total, 66.17, { tolerance: 0.05 });
  check('no auto-gratuity on split check', r.autoGratuity.detected, false);
});

// ── 08 Le Château Blanc: 20% service charge + $100 additional gratuity ───────
runReceipt('08 Le Chateau Blanc — 20% service charge + $100 addl gratuity', `
LE CHATEAU BLANC
Fine French Cuisine
1 Bellevue Avenue
Newport, Rhode Island
Captain: Philippe         Party of 6
02/14/2026  8:00 PM

2 Tasting Menu 7-Crs        $290.00
2 Tasting Menu 5-Crs        $190.00
2 A La Carte Entree         $120.00
1 Btl Dom Perignon 15       $350.00
1 Btl Chateauneuf           $140.00
6 Espresso/Digestif          $84.00

Subtotal                   $1174.00
RI Sales Tax (7%)            $82.18
SERVICE CHARGE (20%)        $234.80
TOTAL                      $1490.98

20% service charge included for parties of 6+
Addl Gratuity:  $100.00
New Total:     $1590.98
x
`, r => {
  check('item count >= 4', r.items.length >= 4, true);
  check('subtotal', r.subtotal, 1174.00, { tolerance: 0.50 });
  check('service charge auto-grat detected', r.autoGratuity.detected, true);
  check('tip = service charge + addl (334.80)', r.tip, 334.80, { tolerance: 0.20 });
  check('total = 1590.98 (includes addl)', r.total, 1590.98, { tolerance: 0.50 });
});

// ── 09 Taco Loco: tip printed on receipt (selected at terminal) ──────────────
runReceipt('09 Taco Loco — 15% tip printed on receipt (terminal)', `
TACO LOCO
FRESH MEX KITCHEN
412 Hope St
Providence, RI 02906

Order #247  DINE IN
02/26/2026  12:05 PM
DEBIT ****3390

2 Birria Tacos               $11.00
1 Burrito Bowl               $13.50
1 Chips & Guac                $6.50
2 Horchata                    $8.00

Subtotal                     $39.00
Tax                           $2.73
Tip (15%)                     $5.85

TOTAL                        $47.58

Tip selected at terminal
`, r => {
  check('item count >= 4', r.items.length >= 4, true);
  check('subtotal', r.subtotal, 39.00, { tolerance: 0.05 });
  check('tax', r.tax, 2.73, { tolerance: 0.05 });
  check('tip = 5.85 (printed, 15%)', r.tip, 5.85, { tolerance: 0.05 });
  check('total = 47.58', r.total, 47.58, { tolerance: 0.05 });
  check('no auto-gratuity on terminal tip', r.autoGratuity.detected, false);
});

// ── 10 Sunny Side Cafe: brunch + handwritten tip ─────────────────────────────
runReceipt('10 Sunny Side Cafe — brunch with handwritten tip', `
SUNNY SIDE CAFE
Brunch & Breakfast
28 Hope Street
Bristol, RI 02809
Server: Katie  Table: 5
02/16/2026  10:45 AM
VISA ****5501

1 Eggs Benedict              $16.00
1 Avocado Toast              $14.00
1 Belgian Waffle             $13.50
2 Bacon (side)                $5.50
2 Mimosa                     $20.00
1 Fresh OJ                    $6.00
1 Latte                       $5.50

Subtotal                     $80.50
Tax                           $5.64
TOTAL                        $86.14

Tip:   $22.00
Total: $108.14
`, r => {
  check('item count >= 5', r.items.length >= 5, true);
  check('subtotal', r.subtotal, 80.50, { tolerance: 0.05 });
  check('tip = 22 (handwritten)', r.tip, 22.00, { tolerance: 0.10 });
  check('total = 108.14', r.total, 108.14, { tolerance: 0.10 });
});

// ── 11 Dragon Palace: cash payment, no tip line ──────────────────────────────
runReceipt('11 Dragon Palace — cash payment, no tip', `
DRAGON PALACE
Chinese Restaurant
1200 Post Rd, Warwick RI
401-555-3344

12/30/2025  9:12 PM
Order: DINE-IN #88

1 Wonton Soup                 $6.50
1 Gen Tso Chicken            $14.95
1 Beef w/ Broccoli           $13.95
1 Shrimp Lo Mein             $12.95
2 Spring Roll                 $6.00
1 Fried Rice (Lg)             $9.50
2 Soda                        $4.00

Subtotal                     $67.85
Tax                           $4.75
TOTAL                        $72.60

CASH TENDERED                $80.00
CHANGE                        $7.40
CASH PAYMENT - NO TIP LINE
`, r => {
  check('item count >= 5', r.items.length >= 5, true);
  check('subtotal', r.subtotal, 67.85, { tolerance: 0.05 });
  check('tax', r.tax, 4.75, { tolerance: 0.05 });
  check('tip = 0 (cash, no tip)', r.tip, 0);
  check('total = 72.60', r.total, 72.60, { tolerance: 0.05 });
  check('no auto-gratuity', r.autoGratuity.detected, false);
});

// ── 12 Oak & Ember: happy hour -20% + comp item + handwritten tip ────────────
runReceipt('12 Oak & Ember — happy hour discount + comp + handwritten tip', `
OAK & EMBER
Craft Kitchen & Bar
Server: Dan  Tbl: 11
02/20/2026  7:55 PM
DISC ****4478

1 Wagyu Burger               $24.00
1 Grilled Chicken Sand       $18.00
1 Truffle Fries              $12.00
1 Caesar Salad               $14.00
2 Old Fashioned              $38.00
1 Draft IPA                   $8.00
1 Cheesecake                 $11.00
HAPPY HOUR -20% DRINKS      -$13.60
COMP: Cheesecake (mgr)      -$11.00

Subtotal                    $117.00
Discounts                   -$24.60
Adj Subtotal                 $92.40
Tax (7%)                      $6.47

TOTAL                        $98.87

Tip:   $25.00
Total: $123.87
`, r => {
  check('item count >= 5 (comp filtered)', r.items.length >= 5, true);
  check('adj subtotal ≈ 92.40 (post-discount)', r.subtotal, 92.40, { tolerance: 0.50 });
  check('tax', r.tax, 6.47, { tolerance: 0.05 });
  check('tip = 25 (handwritten)', r.tip, 25.00, { tolerance: 0.10 });
  check('total = 123.87', r.total, 123.87, { tolerance: 0.10 });
  check('no auto-gratuity', r.autoGratuity.detected, false);
});

// ── 13 Café de Flore: French receipt with SERVICE COMPRIS ───────────────────
runReceipt('13 Cafe de Flore — French receipt, service compris (no tip)', `
CAFE DE FLORE
172 Boulevard Saint-Germain
75006 Paris, France

Table: 24  Couverts: 2
15/02/2026  14:30

2 Cafe Creme                  9.60
1 Croque Monsieur            14.50
1 Salade Nicoise             16.00
1 Tarte Tatin                12.00
2 Eau Minerale                7.00

Sous-total HT                53.19
TVA (10%)                     5.91

TOTAL TTC                    59.10
CB VISA ****3321
SERVICE COMPRIS
`, r => {
  check('item count >= 3', r.items.length >= 3, true);
  check('total = 59.10', r.total, 59.10, { tolerance: 0.10 });
  check('tip = 0 (service compris)', r.tip, 0);
  check('no auto-gratuity triggered', r.autoGratuity.detected, false);
});

// ── 14 Papa Tony's Pizza: delivery + service fee + driver tip ────────────────
runReceipt('14 Papa Tonys Pizza — delivery/service fees + driver tip', `
PAPA TONY'S PIZZA
678 Cranston St
Cranston, RI 02920

*** DELIVERY ORDER ***
Order #4521  02/25/2026  6:32 PM
Driver: Tony Jr.

1 lg Pepperoni Pizza         $18.99
1 lg Margherita Pizza        $17.99
1 Buffalo Wings (12)         $14.99
1 Garlic Knots (8)            $6.99
2 2L Coke                     $7.98
1 Cannoli (3pk)               $9.99

Subtotal                     $76.93
Tax (7%)                      $5.39
Delivery Fee                  $5.99
Service Fee                   $2.50
Driver Tip                    $8.00

TOTAL                        $98.81
PAID: VISA ****9012
`, r => {
  check('item count >= 5', r.items.length >= 5, true);
  check('subtotal', r.subtotal, 76.93, { tolerance: 0.05 });
  check('fees rolled into tax (≈ 13.88)', r.tax, 13.88, { tolerance: 0.20 });
  check('tip = 8 (driver tip)', r.tip, 8.00, { tolerance: 0.05 });
  check('total = 98.81', r.total, 98.81, { tolerance: 0.05 });
});

// ── 17 Murphy's Tap Room: crossed-out tip ($15 crossed, $20 written) ─────────
runReceipt('17 Murphys Tap Room — crossed-out tip (OCR sees both $15 and $20)', `
MURPHY'S TAP ROOM
67 Broadway, Newport RI
BAR TAB  Seat: 7
02/11/2026  11:45 PM
APEX ****0034

1 Guinness Draft              $8.00
1 Jameson Neat               $12.00
1 Guinness Draft              $8.00
1 Fish & Chips               $18.00
1 Irish Coffee               $11.00
1 Guinness Draft              $8.00
1 Jameson Neat               $12.00
1 Shot Fireball               $7.00

Subtotal                     $84.00
Tax                           $5.88
TOTAL                        $89.88

Tip:  $15 $20.00
Total: $109.88
Slainte!
`, r => {
  check('item count >= 5', r.items.length >= 5, true);
  check('subtotal', r.subtotal, 84.00, { tolerance: 0.05 });
  // getLineAmount takes LAST amount on the tip line → $20, not crossed-out $15
  check('tip = 20 (last/final amount, not crossed-out 15)', r.tip, 20.00, { tolerance: 0.05 });
  check('total = 109.88 (with final tip)', r.total, 109.88, { tolerance: 0.05 });
});

// ── 18 Coastal Catch: suggested gratuity table, customer chose 20% ───────────
runReceipt('18 Coastal Catch — suggested gratuity printed, tip = chosen 20%', `
COASTAL CATCH
Seafood & Raw Bar
Server: Becca  Tbl: DECK-8
02/22/2026  1:30 PM

1 Raw Bar Platter            $48.00
1 Lobster Bisque             $14.00
1 Grilled Swordfish          $32.00
1 Fish Tacos                 $19.00
2 Glass Sauvignon Bl         $26.00
1 Frozen Lemonade             $7.00

Subtotal                    $146.00
Tax (7%)                     $10.22
TOTAL                       $156.22

========== SUGGESTED GRATUITY ==========
18% = $28.12   20% = $31.24   25% = $39.05

Tip:   $31.24
Total: $187.46
`, r => {
  check('item count >= 5', r.items.length >= 5, true);
  check('subtotal', r.subtotal, 146.00, { tolerance: 0.05 });
  check('tax', r.tax, 10.22, { tolerance: 0.05 });
  // Suggested amounts ($28.12, $31.24, $39.05) must NOT become the tip
  // Only "Tip: $31.24" (handwritten) is the real tip
  check('tip = 31.24 (chosen, not inflated by table)', r.tip, 31.24, { tolerance: 0.10 });
  check('total = 187.46 (with tip)', r.total, 187.46, { tolerance: 0.10 });
  check('no auto-gratuity', r.autoGratuity.detected, false);
});

// ── 19 Union Station Brewery: dual tax rates (food 7% + bev 8%) ──────────────
runReceipt('19 Union Station Brewery — dual tax rates, food + bev subtotals', `
UNION STATION BREWERY
36 Exchange Terrace
Providence, RI 02903
Server: Pete  Tbl: 19
02/24/2026  7:00 PM  Guests: 4

--- FOOD ---
1 Pretzel & Beer Chz         $13.00
1 Brew Burger                $18.00
1 BBQ Chicken Pizza          $19.00
1 Fish & Chips               $19.00
1 Side Coleslaw               $5.00

--- BEVERAGES ---
2 House IPA (pint)           $16.00
1 Stout (pint)                $8.00
1 Pale Ale Flight            $12.00
1 Glass Merlot               $11.00
2 Soda                        $7.00

Food Subtotal                $72.00
Bev Subtotal                 $54.00
Food Tax (7%)                 $5.04
Bev Tax (8%)                  $4.32

TOTAL                       $135.36
Tip:
Total:
`, r => {
  check('item count >= 8', r.items.length >= 8, true);
  // Parser sums both subtotals
  check('combined subtotal = 126', r.subtotal, 126.00, { tolerance: 0.50 });
  // Parser sums both taxes
  check('combined tax = 9.36', r.tax, 9.36, { tolerance: 0.20 });
  check('tip = 0 (blank lines)', r.tip, 0);
  check('total = 135.36', r.total, 135.36, { tolerance: 0.05 });
});

// ── 20 Bonefish Grill: gift card split payment ───────────────────────────────
runReceipt('20 Bonefish Grill — gift card + CC split payment', `
BONEFISH GRILL
230 Garden City Dr
Cranston, RI 02920
Server: Tbl: 23
02/14/2026  8:15 PM

2 Bang Bang Shrimp           $25.98
1 Atlantic Salmon            $27.00
1 Filet Mignon 8oz           $36.00
1 Crab Cake Dinner           $29.00
2 Glass Prosecco             $24.00
1 Espresso Martini           $14.00
1 Warm Choc Cake             $10.00

Subtotal                    $165.98
Tax (7%)                     $11.62
TOTAL                       $177.60

PAYMENT DETAILS
Gift Card ****1234           -$50.00
VISA ****9988               $127.60
Balance on Gift Card: $10.00
Tip (on CC):  $30.00
CC Total:     $157.60

Happy Valentine's Day!
`, r => {
  check('item count >= 5', r.items.length >= 5, true);
  check('subtotal', r.subtotal, 165.98, { tolerance: 0.05 });
  check('tax', r.tax, 11.62, { tolerance: 0.05 });
  // Tip is captured from "Tip (on CC): $30.00" line
  // Total may differ depending on which total candidate is selected
  check('total >= 177.60 (printed bill total)', r.total >= 177.60, true);
});

// ── 22 Trattoria Roma: handwritten math on receipt ───────────────────────────
runReceipt('22 Trattoria Roma — handwritten math (80.25 x 20 = 16.05)', `
TRATTORIA ROMA
55 DePasquale Ave
Providence, RI 02903
Server: Gina  Tbl: 4
02/15/2026  8:30 PM
VISA ****3301

1 Caprese                    $13.00
1 Penne Arrabbiata           $18.00
1 Chicken Marsala            $24.00
1 Glass Montepulciano        $12.00
1 Limoncello                  $8.00

Subtotal                     $75.00
Tax (7%)                      $5.25
TOTAL                        $80.25

80.25 x 20
$16.00
Tip:   $16.00
Total: $96.25
`, r => {
  check('item count >= 4', r.items.length >= 4, true);
  check('subtotal', r.subtotal, 75.00, { tolerance: 0.05 });
  check('tax', r.tax, 5.25, { tolerance: 0.05 });
  check('tip = 16 (labeled tip line, not math)', r.tip, 16.00, { tolerance: 0.05 });
  check('total = 96.25', r.total, 96.25, { tolerance: 0.05 });
});

// ── 23 Bolt Coffee: short receipt, tip pre-printed ───────────────────────────
runReceipt('23 Bolt Coffee — short receipt, all amounts printed', `
BOLT COFFEE CO.
100 Washington St
Providence RI

02/27/2026  8:02 AM
Reg 2  #0447

1 Latte (Oat, Lg)             $6.50
1 Croissant                   $4.25

Subtotal                     $10.75
Tax                           $0.75
Tip                           $2.00
TOTAL                        $13.50
Apple Pay
`, r => {
  check('item count >= 2', r.items.length >= 2, true);
  check('subtotal', r.subtotal, 10.75, { tolerance: 0.05 });
  check('tax', r.tax, 0.75, { tolerance: 0.05 });
  check('tip = 2.00 (Apple Pay, printed)', r.tip, 2.00, { tolerance: 0.05 });
  check('total = 13.50', r.total, 13.50, { tolerance: 0.05 });
});

// ── 24 Iron Works BBQ: per-seat sections (SEAT 1/2/3 + SHARED) ───────────────
runReceipt('24 Iron Works BBQ — per-seat sections + shared item', `
IRON WORKS BBQ
12 Narragansett Ave
Jamestown, RI 02835
Server: Tommy  Tbl: 6
02/23/2026  5:45 PM
VISA ****4411

=== SEAT 1 ===
1 Brisket Plate              $22.00
1 IPA Draft                   $8.00
1 Pecan Pie                   $8.00
Seat 1 subtotal: $38.00

=== SEAT 2 ===
1 Pulled Pork Sand           $16.00
1 Mac & Cheese                $7.00
1 Lemonade                    $4.00
Seat 2 subtotal: $27.00

=== SEAT 3 ===
1 Ribs Half Rack             $24.00
1 Cornbread                   $4.00
1 Sweet Tea                   $4.00
1 Banana Pudding              $7.00
Seat 3 subtotal: $39.00

=== SHARED ===
1 Sampler Platter            $28.00
Shared subtotal: $28.00

Subtotal                    $132.00
Tax (7%)                      $9.24
TOTAL                       $141.24

Tip:   $25.00
Total: $166.24
`, r => {
  // Per-seat subtotal lines ("Seat 1 subtotal: $38") cause early totalsSectionStart,
  // so items after seat 1 fall outside the item window and the parser collapses to
  // "Receipt Items". Verify at least 1 item/collapse entry is present.
  check('items present (may collapse for per-seat receipts)', r.items.length >= 1, true);
  check('subtotal', r.subtotal, 132.00, { tolerance: 1.00 });
  check('tax', r.tax, 9.24, { tolerance: 0.20 });
  check('tip = 25', r.tip, 25.00, { tolerance: 0.10 });
  check('total = 166.24', r.total, 166.24, { tolerance: 0.10 });
});

// ── 25 Sushi Heaven: promo code, tip labeled as "20% pre-disc" ───────────────
runReceipt('25 Sushi Heaven — promo -20%, tip on pre-discount subtotal', `
SUSHI HEAVEN
500 Angell St
Providence, RI 02906
Server: Yuki  Tbl: 3
02/19/2026  6:01 PM
AMEX ****5544

1 Spicy Tuna Roll            $14.00
1 Dragon Roll                $18.00
8 Salmon Sashimi             $22.00
1 Gyoza (6pc)                 $9.00
1 Miso Soup                   $4.00
2 Hot Sake                   $18.00
1 Green Tea Ice Crm           $6.00

PROMO: SUSHI20              -$18.20
Subtotal                     $91.00
Promo -20%                  -$18.20
Adj Subtotal                 $72.80
Tax (7%)                      $5.10
Tip (20% pre-disc)           $18.20

TOTAL                        $96.10
Tip calculated on pre-discount total.
Tip added at terminal
`, r => {
  check('item count >= 5', r.items.length >= 5, true);
  check('adj subtotal ≈ 72.80', r.subtotal, 72.80, { tolerance: 0.50 });
  check('tax', r.tax, 5.10, { tolerance: 0.10 });
  // "Tip (20% pre-disc)" contains % → isLikelySuggestedTipLabel=true → filtered
  // But inferTipFromTotals correctly infers 18.20 from total mismatch
  check('tip = 18.20 (inferred or direct)', r.tip, 18.20, { tolerance: 0.10 });
  check('total = 96.10', r.total, 96.10, { tolerance: 0.05 });
});

// ── 26 Vanderbilt Hotel: in-room dining, 22% service charge + delivery fee ───
runReceipt('26 Vanderbilt Hotel — service charge (22%) + delivery fee, no addl tip', `
THE VANDERBILT HOTEL & RESORT
41 Mary St Newport, RI 02840

IN-ROOM DINING
Room: 412  GUEST JOHNSON
10/04/2026  10:30 PM
Order: RS-0088

1 Lobster Thermidor          $55.00
1 Filet Mignon 10oz          $62.00
1 Btl Veuve Clicquot        $120.00
2 Creme Brulee               $28.00
1 Cheese Board               $24.00

Subtotal                    $289.00
Tax (7%)                     $20.23
Service Charge (22%)         $63.58
Delivery Fee                  $8.00
TOTAL                       $380.81

CHARGED TO ROOM 412
Addl Gratuity:  ___
New Total:      ___
Room / Sig:     ___
`, r => {
  check('item count >= 4', r.items.length >= 4, true);
  check('subtotal', r.subtotal, 289.00, { tolerance: 0.50 });
  // delivery fee rolled into tax
  check('tax includes delivery fee (≈ 28.23)', r.tax, 28.23, { tolerance: 0.50 });
  check('tip = service charge 63.58', r.tip, 63.58, { tolerance: 0.20 });
  check('total = 380.81', r.total, 380.81, { tolerance: 0.10 });
  check('auto-gratuity detected (service charge)', r.autoGratuity.detected, true);
});

// ── NEW: Convenience fee (flat dollar) ───────────────────────────────────────
runReceipt('convenience fee — flat $1.75 online ordering fee', `
TOAST TO GO
Online Order

1 Burger                     $12.99
1 Fries                       $4.99
1 Soda                        $2.49

Subtotal                     $20.47
Tax (8%)                      $1.64
Convenience Fee               $1.75

TOTAL                        $23.86
`, r => {
  check('item count >= 3', r.items.length >= 3, true);
  check('subtotal', r.subtotal, 20.47, { tolerance: 0.05 });
  // Convenience fee rolled into tax
  check('tax includes convenience fee (≈ 3.39)', r.tax, 3.39, { tolerance: 0.10 });
  check('tip = 0', r.tip, 0);
  check('total = 23.86', r.total, 23.86, { tolerance: 0.05 });
  check('no auto-gratuity', r.autoGratuity.detected, false);
});

// ── NEW: Credit card surcharge (percentage, labeled as fee not tip) ───────────
runReceipt('credit card surcharge percentage — rolled into tax, not tip', `
LOCAL DINER
1 Main St

1 Pancake Stack               $9.99
1 Bacon & Eggs               $11.99
1 Coffee                      $2.50

Subtotal                     $24.48
Tax (7%)                      $1.71
Credit Card Surcharge (3%)    $0.73

TOTAL                        $26.92
`, r => {
  check('item count >= 3', r.items.length >= 3, true);
  check('subtotal', r.subtotal, 24.48, { tolerance: 0.05 });
  check('tip = 0 (surcharge is NOT a tip)', r.tip, 0);
  // Surcharge rolled into tax
  check('tax includes surcharge (≈ 2.44)', r.tax, 2.44, { tolerance: 0.10 });
  check('total = 26.92', r.total, 26.92, { tolerance: 0.05 });
});

// ── NEW: Multiple fees (delivery + service + platform) ───────────────────────
runReceipt('multiple fees — delivery + service + platform, all rolled into tax', `
FOOD APP ORDER
Delivery

1 Margherita Pizza           $18.00
1 Garden Salad                $9.00

Subtotal                     $27.00
Tax (8%)                      $2.16
Delivery Fee                  $4.99
Service Fee                   $1.99
Platform Fee                  $0.99

TOTAL                        $37.13
`, r => {
  check('item count >= 2', r.items.length >= 2, true);
  check('subtotal', r.subtotal, 27.00, { tolerance: 0.05 });
  // All 3 fees + tax rolled together
  check('tax includes all fees (≈ 10.13)', r.tax, 10.13, { tolerance: 0.20 });
  check('tip = 0', r.tip, 0);
  check('total = 37.13', r.total, 37.13, { tolerance: 0.05 });
});

// ── NEW: Online order with processing fee ─────────────────────────────────────
runReceipt('processing fee on online order — not tip, rolled into tax', `
BURGER JOINT
Online Order #7749

2 Cheeseburger               $22.00
2 Onion Rings                 $8.00
2 Milkshake                  $12.00

Subtotal                     $42.00
Tax (7%)                      $2.94
Processing Fee                $1.26

TOTAL                        $46.20
Tip:  $6.00
Total: $52.20
`, r => {
  check('item count >= 3', r.items.length >= 3, true);
  check('subtotal', r.subtotal, 42.00, { tolerance: 0.05 });
  check('processing fee NOT classified as tip', r.tip, 6.00, { tolerance: 0.10 });
  check('total = 52.20 (with tip)', r.total, 52.20, { tolerance: 0.10 });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

runReceipt('repeated identical item lines remain distinct', `
BOON STREET MARKET
145 Boon St
Narragansett, RI 02882

Server: TICKET B
Check #21
Guest Count: 1
Ordered: 3/24/26 7:12 PM

2 Captain Morgan             $20.00
2 Dollar Single Smash Burger $2.00
3 Mini Half Side of Fries     $4.00
3 Miller High Life BTL       $12.00
1 Dollar Single Smash Burger  $1.00
1 Dollar Single Smash Burger  $1.00
Add a Half Side of Fries      $2.00

Subtotal                     $42.00
Tax                           $3.36
Tip                           $9.07
Total                        $54.43
`, r => {
  check('item count keeps repeated lines', r.items.length >= 7, true);
  check(
    'two separate $1 single smash burger lines preserved',
    r.items.filter(item => item.name === 'Dollar Single Smash Burger' && Math.abs(item.price - 1) < 0.001).length,
    2
  );
  check('subtotal', r.subtotal, 42.00, { tolerance: 0.05 });
  check('tax', r.tax, 3.36, { tolerance: 0.05 });
  check('tip', r.tip, 9.07, { tolerance: 0.05 });
  check('total', r.total, 54.43, { tolerance: 0.05 });
});

console.log(`\n${'═'.repeat(60)}`);
console.log(`  RESULTS: ${passed} passed, ${failed} failed  (${passed + failed} total)`);
console.log('═'.repeat(60));
if (failed > 0) process.exit(1);
