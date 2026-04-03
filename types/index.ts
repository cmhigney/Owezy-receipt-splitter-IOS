export interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  emailVerifiedAt?: string;
  displayName: string;
  username: string;
  phone?: string;
  profilePicture?: string;
  createdAt: string;
  lastUsernameChangeAt?: string;
  totalReceiptsScanned: number;
  totalAmountSplit: number;
  totalFriendsSplitWith: number;
  venmoUsername?: string;
  cashAppUsername?: string;
  zelleUsername?: string;
  paypalUsername?: string;
}

export interface Friend {
  id: string;
  name: string;
  username?: string;
  venmoUsername?: string;
  cashAppUsername?: string;
  zelleUsername?: string;
  paypalUsername?: string;
  phone?: string;
  profilePicture?: string;
  preferredPayment?: 'venmo' | 'cashapp' | 'zelle' | 'paypal' | 'apple';
  usageCount: number;
  color: string;
}

export interface FriendRequest {
  id: string;
  direction: 'incoming' | 'outgoing';
  userId: string;
  displayName: string;
  username: string;
  profilePicture?: string;
  createdAt: string;
}

export interface ReceiptItem {
  id: string;
  name: string;
  price: number;
  assignedTo: string[];
}

export interface AutoGratuityInfo {
  detected: boolean;
  partySizeMin: number | null;
  policyText: string | null;
  includedInTotal: boolean;
  autoGratuityAmount?: number | null;
  additionalTipAmount?: number | null;
}

export interface PersonSummary {
  personId: string;
  personName: string;
  items: { name: string; cost: number; splitCount?: number }[];
  itemSubtotal: number;
  taxShare: number;
  tipShare: number;
  total: number;
  paid: boolean;
}

export type TipSplitMode = 'proportional' | 'even';

export interface Split {
  id: string;
  restaurantName: string;
  date: string;
  items: ReceiptItem[];
  subtotal: number;
  tax: number;
  tip: number;
  tipSplitMode?: TipSplitMode;
  total: number;
  people: Friend[];
  summaries: PersonSummary[];
  hasFees?: boolean;
}

export type AuthTab = 'signup' | 'login';
export type SplitStep = 'scan' | 'items' | 'tip' | 'people' | 'assign' | 'summary' | 'pay';

// ─── Receipt Intelligence Types ───────────────────────────────────────────────

export type ReceiptType =
  | 'restaurant_itemized'
  | 'restaurant_signed_slip'
  | 'restaurant_merchant_copy'
  | 'restaurant_customer_copy'
  | 'restaurant_auto_gratuity'
  | 'restaurant_split_check'
  | 'fast_food'
  | 'cafe'
  | 'bar_tab'
  | 'kiosk'
  | 'takeout'
  | 'delivery_platform'
  | 'grocery'
  | 'convenience_store'
  | 'pharmacy'
  | 'big_box_retail'
  | 'self_checkout'
  | 'gas_station'
  | 'service_repair'
  | 'salon_barber'
  | 'card_terminal_slip'
  | 'unknown';

export type OcrEngineUsed = 'apple_vision' | 'apple_vision_retry' | 'docai' | 'cloud_vision';

export type AmountStatus =
  | 'included'
  | 'excluded_informational'
  | 'excluded_duplicate'
  | 'excluded_suggestion'
  | 'excluded_low_confidence'
  | 'excluded_ocr_artifact'
  | 'excluded_wrong_payment_phase';

export type ConfidenceTier = 'high' | 'medium' | 'low' | 'needs_review' | 'hard_failure';

export type FeeType =
  | 'service_fee'
  | 'convenience_fee'
  | 'delivery_fee'
  | 'processing_fee'
  | 'platform_fee'
  | 'small_order_fee'
  | 'bag_fee'
  | 'bottle_deposit'
  | 'environmental_fee'
  | 'fuel_surcharge'
  | 'regulatory_fee'
  | 'service_charge'
  | 'auto_gratuity'
  | 'mandatory_gratuity'
  | 'venue_fee'
  | 'event_fee'
  | 'table_fee'
  | 'cover_charge'
  | 'packaging_fee'
  | 'split_check_fee'
  | 'kiosk_fee'
  | 'merchant_adjustment'
  | 'rounding_adjustment'
  | 'unknown_fee';

export type DiscountType =
  | 'coupon'
  | 'loyalty_discount'
  | 'promotional_discount'
  | 'happy_hour_discount'
  | 'combo_discount'
  | 'manufacturer_coupon'
  | 'employee_discount'
  | 'senior_discount'
  | 'member_discount'
  | 'returned_deposit'
  | 'price_adjustment'
  | 'unknown_discount';

export type TaxType =
  | 'sales_tax'
  | 'food_tax'
  | 'alcohol_tax'
  | 'prepared_food_tax'
  | 'local_tax'
  | 'state_tax'
  | 'county_tax'
  | 'vat'
  | 'gst'
  | 'unknown_tax';

export interface MonetaryComponent {
  id: string;
  normalized_type: FeeType | DiscountType | TaxType | string;
  raw_label: string;
  raw_value_text: string;
  parsed_amount: number;
  sign: 1 | -1;
  confidence: number;
  confidence_tier: ConfidenceTier;
  status: AmountStatus;
  ocr_span_ref?: string;
  notes?: string;
}

export interface RawAmountCandidate {
  raw_text: string;
  label_text: string;
  amount_text: string;
  parsed_amount: number;
  line_index: number;
  ocr_confidence?: number;
  classification_result: string;
  status: AmountStatus;
  status_reason: string;
  selected_as?: string;
}

export interface PaymentLine {
  method: 'credit' | 'debit' | 'cash' | 'gift_card' | 'store_credit' | 'split' | 'unknown';
  raw_label: string;
  amount: number;
  card_last4?: string;
  network?: string;
  is_authorization?: boolean;
}

export interface DetectedTotal {
  raw_label: string;
  raw_value_text: string;
  parsed_amount: number;
  confidence: number;
  selected: boolean;
  rejection_reason?: string;
}

export interface NormalizedReceipt {
  // Identity
  receipt_id: string;
  receipt_type: ReceiptType;
  source_type: 'photo' | 'screenshot' | 'pdf';

  // Merchant
  merchant_name?: string;
  merchant_address?: string;
  merchant_phone?: string;
  merchant_confidence: number;

  // Transaction
  date?: string;
  time?: string;
  order_id?: string;
  check_id?: string;
  invoice_id?: string;
  transaction_id?: string;
  authorization_code?: string;

  // Currency
  currency: string;

  // UI display fields — what the app shows (simple 4-field breakdown)
  ui_display: {
    subtotal: number;
    tax: number;     // may include fees (merged for UI)
    tip: number;     // optional tip; mandatory charges tracked separately in financials
    final_total: number;
  };

  // Full financial ledger — backend only, never shown directly in UI
  financials: {
    subtotal: number;
    tax_total: number;            // actual taxes only (no fees)
    tip: number;                  // optional tip only
    fee_total: number;            // delivery, service, convenience, etc.
    mandatory_charge_total: number; // auto-grat, cover charge, service charge
    discount_total: number;       // all discounts (negative amounts)
    credits_total: number;        // gift card, store credit, cashback applied
    rounding_total: number;
    final_total: number;          // the true printed payable amount
    pre_tip_total: number;        // final_total minus optional tip
    balance_due?: number;
    amount_tendered?: number;
    change_given?: number;
    total_paid?: number;
  };

  // Line-level detail
  taxes: MonetaryComponent[];
  fees: MonetaryComponent[];
  discounts: MonetaryComponent[];
  mandatory_charges: MonetaryComponent[];
  payments: PaymentLine[];

  // Restaurant-specific
  auto_gratuity?: {
    detected: boolean;
    party_size_min?: number;
    policy_text?: string;
    amount: number;
    is_included_in_total: boolean;
    is_mandatory: boolean;
    percentage?: number;
  };
  is_open_tab?: boolean;
  is_merchant_copy?: boolean;
  is_split_check?: boolean;
  check_number?: string;
  total_checks?: number;
  tax_included?: boolean;

  // Audit trail
  totals_detected: DetectedTotal[];
  raw_amount_candidates: RawAmountCandidate[];
  hidden_amounts_included_in_total: {
    fee_ids: string[];
    mandatory_charge_ids: string[];
    discount_ids: string[];
    description: string;
  };

  // Quality & routing
  ocr_engine_used: OcrEngineUsed;
  ocr_engine_sequence: OcrEngineUsed[];
  fallback_used: boolean;
  fallback_trigger_reason?: string;
  parser_version: string;

  // Validation
  calculation_check_passed: boolean;
  calculation_delta: number;
  calculation_tolerance_used: number;
  review_required: boolean;
  review_reasons: string[];
  confidence_overall: ConfidenceTier;
  confidence_breakdown: {
    subtotal: number;
    tax: number;
    tip: number;
    final_total: number;
    merchant: number;
    items: number;
  };

  // Duplicate / fraud
  duplicate_of?: string;
  fraud_flags: string[];
  document_validity: 'valid' | 'likely_valid' | 'uncertain' | 'invalid';
}
