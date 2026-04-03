import { z } from "zod";

const ID_MAX_LENGTH = 128;
const FRIEND_NAME_MAX_LENGTH = 80;
const USERNAME_MAX_LENGTH = 15;
const PAYMENT_HANDLE_MAX_LENGTH = 64;
const PHONE_MAX_LENGTH = 32;
const PROFILE_PICTURE_MAX_LENGTH = 800_000;
const COLOR_MAX_LENGTH = 32;
const RECEIPT_NAME_MAX_LENGTH = 200;
const RESTAURANT_NAME_MAX_LENGTH = 120;
const DATE_MAX_LENGTH = 64;
const MAX_SPLIT_AMOUNT = 1_000_000;

export const friendSchema = z.object({
  id: z.string().trim().min(1).max(ID_MAX_LENGTH),
  name: z.string().trim().min(1).max(FRIEND_NAME_MAX_LENGTH),
  username: z.string().trim().min(1).max(USERNAME_MAX_LENGTH).optional(),
  venmoUsername: z.string().trim().min(1).max(PAYMENT_HANDLE_MAX_LENGTH).optional(),
  cashAppUsername: z.string().trim().min(1).max(PAYMENT_HANDLE_MAX_LENGTH).optional(),
  zelleUsername: z.string().trim().min(1).max(PAYMENT_HANDLE_MAX_LENGTH).optional(),
  paypalUsername: z.string().trim().min(1).max(PAYMENT_HANDLE_MAX_LENGTH).optional(),
  phone: z.string().trim().min(1).max(PHONE_MAX_LENGTH).optional(),
  profilePicture: z.string().trim().min(1).max(PROFILE_PICTURE_MAX_LENGTH).optional(),
  preferredPayment: z.enum(["venmo", "cashapp", "zelle", "paypal", "apple"]).optional(),
  usageCount: z.number().int().min(0).max(100_000),
  color: z.string().trim().min(1).max(COLOR_MAX_LENGTH),
}).strict();

export const friendRequestSchema = z.object({
  id: z.string().trim().min(1).max(ID_MAX_LENGTH),
  direction: z.enum(["incoming", "outgoing"]),
  userId: z.string().trim().min(1).max(ID_MAX_LENGTH),
  displayName: z.string().trim().min(1).max(FRIEND_NAME_MAX_LENGTH),
  username: z.string().trim().min(1).max(USERNAME_MAX_LENGTH),
  profilePicture: z.string().trim().min(1).max(PROFILE_PICTURE_MAX_LENGTH).optional(),
  createdAt: z.string().trim().min(1).max(DATE_MAX_LENGTH),
}).strict();

export const receiptItemSchema = z.object({
  id: z.string().trim().min(1).max(ID_MAX_LENGTH),
  name: z.string().trim().min(1).max(RECEIPT_NAME_MAX_LENGTH),
  price: z.number().finite().min(0).max(MAX_SPLIT_AMOUNT),
  assignedTo: z.array(z.string().trim().min(1).max(ID_MAX_LENGTH)).max(200),
}).strict();

export const personSummarySchema = z.object({
  personId: z.string().trim().min(1).max(ID_MAX_LENGTH),
  personName: z.string().trim().min(1).max(FRIEND_NAME_MAX_LENGTH),
  items: z.array(
    z.object({
      name: z.string().trim().min(1).max(RECEIPT_NAME_MAX_LENGTH),
      cost: z.number().finite().min(0).max(MAX_SPLIT_AMOUNT),
      splitCount: z.number().int().min(1).max(500).optional(),
    }).strict(),
  ).max(200),
  itemSubtotal: z.number().finite().min(0).max(MAX_SPLIT_AMOUNT),
  taxShare: z.number().finite().min(0).max(MAX_SPLIT_AMOUNT),
  tipShare: z.number().finite().min(0).max(MAX_SPLIT_AMOUNT),
  total: z.number().finite().min(0).max(MAX_SPLIT_AMOUNT),
  paid: z.boolean(),
}).strict();

export const splitSchema = z.object({
  id: z.string().trim().min(1).max(ID_MAX_LENGTH),
  restaurantName: z.string().trim().min(1).max(RESTAURANT_NAME_MAX_LENGTH),
  date: z.string().trim().min(1).max(DATE_MAX_LENGTH),
  items: z.array(receiptItemSchema).max(200),
  subtotal: z.number().finite().min(0).max(MAX_SPLIT_AMOUNT),
  tax: z.number().finite().min(0).max(MAX_SPLIT_AMOUNT),
  tip: z.number().finite().min(0).max(MAX_SPLIT_AMOUNT),
  tipSplitMode: z.enum(["proportional", "even"]).optional(),
  total: z.number().finite().min(0).max(MAX_SPLIT_AMOUNT),
  people: z.array(friendSchema).max(200),
  summaries: z.array(personSummarySchema).max(200),
}).strict();

// ─── Receipt Intelligence Schemas ─────────────────────────────────────────────

const LABEL_MAX = 200;
const NOTES_MAX = 500;
const VERSION_MAX = 32;
const FRAUD_FLAG_MAX = 100;
const REVIEW_REASON_MAX = 100;
const MAX_MONETARY_AMOUNT = 1_000_000;

export const monetaryComponentSchema = z.object({
  id: z.string().trim().min(1).max(ID_MAX_LENGTH),
  normalized_type: z.string().trim().min(1).max(LABEL_MAX),
  raw_label: z.string().trim().min(0).max(LABEL_MAX),
  raw_value_text: z.string().trim().min(0).max(LABEL_MAX),
  parsed_amount: z.number().finite().min(0).max(MAX_MONETARY_AMOUNT),
  sign: z.union([z.literal(1), z.literal(-1)]),
  confidence: z.number().min(0).max(1),
  confidence_tier: z.enum(["high", "medium", "low", "needs_review", "hard_failure"]),
  status: z.enum([
    "included",
    "excluded_informational",
    "excluded_duplicate",
    "excluded_suggestion",
    "excluded_low_confidence",
    "excluded_ocr_artifact",
    "excluded_wrong_payment_phase",
  ]),
  ocr_span_ref: z.string().trim().max(LABEL_MAX).optional(),
  notes: z.string().trim().max(NOTES_MAX).optional(),
}).strict();

export const rawAmountCandidateSchema = z.object({
  raw_text: z.string().trim().max(LABEL_MAX),
  label_text: z.string().trim().max(LABEL_MAX),
  amount_text: z.string().trim().max(LABEL_MAX),
  parsed_amount: z.number().finite().min(0).max(MAX_MONETARY_AMOUNT),
  line_index: z.number().int().min(0).max(10_000),
  ocr_confidence: z.number().min(0).max(1).optional(),
  classification_result: z.string().trim().max(LABEL_MAX),
  status: z.string().trim().max(LABEL_MAX),
  status_reason: z.string().trim().max(NOTES_MAX),
  selected_as: z.string().trim().max(LABEL_MAX).optional(),
}).strict();

export const paymentLineSchema = z.object({
  method: z.enum(["credit", "debit", "cash", "gift_card", "store_credit", "split", "unknown"]),
  raw_label: z.string().trim().max(LABEL_MAX),
  amount: z.number().finite().min(0).max(MAX_MONETARY_AMOUNT),
  card_last4: z.string().trim().max(8).optional(),
  network: z.string().trim().max(32).optional(),
  is_authorization: z.boolean().optional(),
}).strict();

export const detectedTotalSchema = z.object({
  raw_label: z.string().trim().max(LABEL_MAX),
  raw_value_text: z.string().trim().max(LABEL_MAX),
  parsed_amount: z.number().finite().min(0).max(MAX_MONETARY_AMOUNT),
  confidence: z.number().min(0).max(1),
  selected: z.boolean(),
  rejection_reason: z.string().trim().max(NOTES_MAX).optional(),
}).strict();

export const normalizedReceiptSchema = z.object({
  receipt_id: z.string().trim().min(1).max(ID_MAX_LENGTH),
  receipt_type: z.string().trim().min(1).max(LABEL_MAX),
  source_type: z.enum(["photo", "screenshot", "pdf"]),

  merchant_name: z.string().trim().max(RESTAURANT_NAME_MAX_LENGTH).optional(),
  merchant_address: z.string().trim().max(NOTES_MAX).optional(),
  merchant_phone: z.string().trim().max(PHONE_MAX_LENGTH).optional(),
  merchant_confidence: z.number().min(0).max(1),

  date: z.string().trim().max(DATE_MAX_LENGTH).optional(),
  time: z.string().trim().max(DATE_MAX_LENGTH).optional(),
  order_id: z.string().trim().max(ID_MAX_LENGTH).optional(),
  check_id: z.string().trim().max(ID_MAX_LENGTH).optional(),
  invoice_id: z.string().trim().max(ID_MAX_LENGTH).optional(),
  transaction_id: z.string().trim().max(ID_MAX_LENGTH).optional(),
  authorization_code: z.string().trim().max(ID_MAX_LENGTH).optional(),

  currency: z.string().trim().min(1).max(8),

  ui_display: z.object({
    subtotal: z.number().finite().min(0).max(MAX_MONETARY_AMOUNT),
    tax: z.number().finite().min(0).max(MAX_MONETARY_AMOUNT),
    tip: z.number().finite().min(0).max(MAX_MONETARY_AMOUNT),
    final_total: z.number().finite().min(0).max(MAX_MONETARY_AMOUNT),
  }).strict(),

  financials: z.object({
    subtotal: z.number().finite().min(0).max(MAX_MONETARY_AMOUNT),
    tax_total: z.number().finite().min(0).max(MAX_MONETARY_AMOUNT),
    tip: z.number().finite().min(0).max(MAX_MONETARY_AMOUNT),
    fee_total: z.number().finite().min(0).max(MAX_MONETARY_AMOUNT),
    mandatory_charge_total: z.number().finite().min(0).max(MAX_MONETARY_AMOUNT),
    discount_total: z.number().finite().min(0).max(MAX_MONETARY_AMOUNT),
    credits_total: z.number().finite().min(0).max(MAX_MONETARY_AMOUNT),
    rounding_total: z.number().finite().min(0).max(MAX_MONETARY_AMOUNT),
    final_total: z.number().finite().min(0).max(MAX_MONETARY_AMOUNT),
    pre_tip_total: z.number().finite().min(0).max(MAX_MONETARY_AMOUNT),
    balance_due: z.number().finite().min(0).max(MAX_MONETARY_AMOUNT).optional(),
    amount_tendered: z.number().finite().min(0).max(MAX_MONETARY_AMOUNT).optional(),
    change_given: z.number().finite().min(0).max(MAX_MONETARY_AMOUNT).optional(),
    total_paid: z.number().finite().min(0).max(MAX_MONETARY_AMOUNT).optional(),
  }).strict(),

  taxes: z.array(monetaryComponentSchema).max(20),
  fees: z.array(monetaryComponentSchema).max(20),
  discounts: z.array(monetaryComponentSchema).max(20),
  mandatory_charges: z.array(monetaryComponentSchema).max(20),
  payments: z.array(paymentLineSchema).max(20),

  auto_gratuity: z.object({
    detected: z.boolean(),
    party_size_min: z.number().int().min(1).max(99).optional(),
    policy_text: z.string().trim().max(NOTES_MAX).optional(),
    amount: z.number().finite().min(0).max(MAX_MONETARY_AMOUNT),
    is_included_in_total: z.boolean(),
    is_mandatory: z.boolean(),
    percentage: z.number().min(0).max(100).optional(),
  }).strict().optional(),
  is_open_tab: z.boolean().optional(),
  is_merchant_copy: z.boolean().optional(),
  is_split_check: z.boolean().optional(),
  check_number: z.string().trim().max(ID_MAX_LENGTH).optional(),
  total_checks: z.number().int().min(1).max(99).optional(),
  tax_included: z.boolean().optional(),

  totals_detected: z.array(detectedTotalSchema).max(20),
  raw_amount_candidates: z.array(rawAmountCandidateSchema).max(200),
  hidden_amounts_included_in_total: z.object({
    fee_ids: z.array(z.string().trim().max(ID_MAX_LENGTH)).max(20),
    mandatory_charge_ids: z.array(z.string().trim().max(ID_MAX_LENGTH)).max(20),
    discount_ids: z.array(z.string().trim().max(ID_MAX_LENGTH)).max(20),
    description: z.string().trim().max(NOTES_MAX),
  }).strict(),

  ocr_engine_used: z.enum(["apple_vision", "apple_vision_retry", "docai", "cloud_vision"]),
  ocr_engine_sequence: z.array(z.enum(["apple_vision", "apple_vision_retry", "docai", "cloud_vision"])).max(10),
  fallback_used: z.boolean(),
  fallback_trigger_reason: z.string().trim().max(NOTES_MAX).optional(),
  parser_version: z.string().trim().min(1).max(VERSION_MAX),

  calculation_check_passed: z.boolean(),
  calculation_delta: z.number().finite().min(0).max(MAX_MONETARY_AMOUNT),
  calculation_tolerance_used: z.number().min(0).max(1),
  review_required: z.boolean(),
  review_reasons: z.array(z.string().trim().max(REVIEW_REASON_MAX)).max(20),
  confidence_overall: z.enum(["high", "medium", "low", "needs_review", "hard_failure"]),
  confidence_breakdown: z.object({
    subtotal: z.number().min(0).max(1),
    tax: z.number().min(0).max(1),
    tip: z.number().min(0).max(1),
    final_total: z.number().min(0).max(1),
    merchant: z.number().min(0).max(1),
    items: z.number().min(0).max(1),
  }).strict(),

  duplicate_of: z.string().trim().max(ID_MAX_LENGTH).optional(),
  fraud_flags: z.array(z.string().trim().max(FRAUD_FLAG_MAX)).max(20),
  document_validity: z.enum(["valid", "likely_valid", "uncertain", "invalid"]),
}).strict();
