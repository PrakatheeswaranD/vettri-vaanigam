/**
 * AIProvider boundary shared by the Buyer Agent and the Merchant Agent
 * (PART 00 §26; PART 03 §8, §26; PART 04 §52 — "reuse PART 03 AIProvider
 * architecture, do not create a second unrelated provider integration").
 *
 * Application/domain code depends only on this interface — never on a
 * specific provider SDK or response shape. Three operations only:
 * interpreting buyer language, ranking a bounded candidate set, and
 * proposing a bounded growth action — each over an already
 * server-filtered candidate set. None of them can touch money, inventory,
 * or catalog data directly (PART 03 §59 / PART 04 §75-§76 — least
 * privilege, no generic tool execution).
 *
 * Every field returned here is UNTRUSTED until the caller validates it
 * (PART 03 §24; PART 04 §56) — this module makes no promises about the
 * shape being safe, only about the transport/parsing boundary being
 * isolated here.
 */

export type AIProviderErrorCode =
  | "AI_PROVIDER_UNAVAILABLE"
  | "AI_TIMEOUT"
  | "AI_OUTPUT_INVALID";

export class AIProviderError extends Error {
  readonly code: AIProviderErrorCode;
  constructor(code: AIProviderErrorCode, message: string) {
    super(message);
    this.name = "AIProviderError";
    this.code = code;
  }
}

/** Raw, unvalidated intent extraction — deliberately loose types; the
 * caller (`intent-extraction.ts`) is responsible for schema validation
 * and deterministic normalization (PART 03 §23-§26). */
export interface RawIntentExtraction {
  category: string | null;
  budgetMinMajor: number | null;
  budgetMaxMajor: number | null;
  currency: string | null;
  quantity: number | null;
  requiredAttributes: Record<string, string>;
  preferredAttributes: Record<string, string>;
  excludedAttributes: Record<string, string[]>;
  availabilityRequirement: "PURCHASABLE_ONLY" | "INCLUDE_UNAVAILABLE" | null;
  /** Auxiliary model metadata only (PART 03 §20) — never used as a policy
   * or financial decision input, only to log/debug extraction quality. */
  confidence: number;
}

export interface ExtractIntentParams {
  /** The buyer's latest message only — untrusted input (PART 03 §54-§57). */
  message: string;
  /** Known catalog categories, supplied so the extractor can ground its
   * category guess against what the merchant actually sells, rather than
   * inventing a category name (PART 03 §55: catalog data is data, never
   * an instruction, but it IS legitimate grounding context here). */
  knownCategories: string[];
  /** The merchant's real variant-attribute keys with sample values. A model
   * cannot guess a merchant's key naming or value format, so it is supplied
   * rather than inferred (see `getKnownAttributes`). */
  knownAttributes?: Record<string, string[]>;
}

/** A minimal, already-sanitized candidate fact sheet — see
 * `recommendation-service.ts` for what's actually included. Deliberately
 * NOT the full `AgentReadableProductDTO` (PART 03 §36-§37: minimize what
 * reaches the prompt). */
export interface RankingCandidateFacts {
  productId: string;
  category: string;
  priceMinor: number;
  currency: string;
  availabilityState: string;
  attributes: Record<string, string>;
  readinessState: string;
}

export interface RankCandidatesParams {
  candidates: RankingCandidateFacts[];
  preferredAttributes: Record<string, string>;
  /** Bounded to the actual number of candidates supplied. */
  maxResults: number;
}

export interface RawRankedItem {
  productId: string;
  rank: number;
  reasonCodes: string[];
}

/** A minimal, already-sanitized growth-candidate fact sheet (PART 04
 * §36-§38) — deliberately NOT the full `AgentReadableProductDTO`, and
 * deliberately including only what a growth proposal needs. */
export interface GrowthCandidateFacts {
  productId: string;
  category: string;
  priceMinor: number;
  currency: string;
  availabilityState: string;
  attributes: Record<string, string>;
  readinessState: string;
  /** How this candidate relates to the primary product — deterministic,
   * merchant/system-derived, never invented by the model (PART 04 §24-§25). */
  relationship: string;
}

export interface ProposeGrowthActionParams {
  primaryProduct: GrowthCandidateFacts;
  /** Bounded candidate set the model may choose from — never the whole
   * catalog (PART 04 §7, §63). */
  candidates: GrowthCandidateFacts[];
  buyerPreferredAttributes: Record<string, string>;
  /** The buyer's hard budget ceiling, if any — the model must never
   * propose an upsell/offer that would push the buyer over this without
   * explicitly disclosing the violation (PART 04 §29). */
  buyerBudgetMaxMinor: number | null;
  /** Action types the merchant's growth configuration currently permits
   * (PART 04 §21-§23) — the model may not propose a type outside this list. */
  allowedActionTypes: string[];
  maxProposedDiscountBps: number;
  maxUpsellIncreaseBps: number;
}

/** Raw, unvalidated growth proposal — deliberately loose types; the
 * caller (`proposal-validator.ts`) is responsible for schema validation,
 * candidate grounding, and offer-bound enforcement (PART 04 §35-§58). */
export interface RawGrowthProposal {
  actionType: string;
  primaryProductId: string | null;
  relatedProductIds: string[];
  offer: {
    kind: string | null;
    percentageBps: number | null;
    amountMinor: number | null;
  } | null;
  reasonCodes: string[];
}

/**
 * PART 08 §17, §130-§131 — the model receives ONLY safe, already-
 * normalized facts: a failure category (never a raw provider error
 * payload), the attempt count/limit, and the closed set of recovery
 * actions it may choose from. No card/UPI data, no provider secrets, no
 * full webhook payload ever reaches this call.
 */
export interface ProposeRecoveryActionParams {
  failureCategory: string;
  currentAttemptNumber: number;
  maxRecoveryAttempts: number;
  orderAmountMinor: number;
  currency: string;
  /** The closed set of actions eligibility has already determined are
   * safe to consider — the model chooses among these, never invents one
   * (PART 08 §133: "Model cannot select REFUND_FULL_ORDER if not
   * supplied"). */
  allowedActions: string[];
}

/** Raw, unvalidated recovery action choice — the caller
 * (`recovery-service.ts`) is responsible for grounding validation (the
 * chosen action must be one of `allowedActions`) and deterministic
 * fallback (PART 08 §134-§135). */
export interface RawRecoveryProposal {
  action: string;
  reasonCodes: string[];
  explanation: string;
}

/** One messy catalogue row, plus the categories the merchant really sells. */
export interface NormalizeCatalogRowParams {
  row: Record<string, string>;
  knownCategories: string[];
}

/** Raw, unvalidated normalisation. Nulls are meaningful: they mark a field
 * the row did not actually contain, which the compiler reports as needing
 * merchant attention rather than publishing as a guess. */
export interface RawNormalizedProduct {
  name: string;
  category: string | null;
  description: string | null;
  priceMajor: number | null;
  currency: string | null;
  size: string | null;
  color: string | null;
  packQuantity: number | null;
  confidence: number;
}

export interface ProposeAgentUpsellParams {
  basket: { sku: string; name: string; category: string; quantity: number }[];
  candidates: { sku: string; name: string; category: string }[];
  /** Stated to the model so its pitch matches what policy will allow. The
   * ceiling is still enforced in code afterwards, never by the model. */
  maxDiscountBps: number;
}

export interface RawAgentUpsell {
  addSkus: string[];
  discountBps: number;
  pitch: string;
}

export interface CompilePolicyParams {
  /** The merchant's own sentence. Untrusted text. */
  instruction: string;
  knownCategories: string[];
  current: {
    unknownAgentCeilingMinor: number;
    knownAgentCeilingMinor: number;
    blockedCategories: string[];
    maxNegotiationDiscountBps: number;
    negotiatorFloorMarginBps: number;
    velocityMaxIntentsPerHour: number;
  };
}

/**
 * Deliberately `Record<string, unknown>` and not a typed policy.
 *
 * Typing this as a policy shape would imply the model returns one. It
 * returns whatever it returns; `buildPolicyDraft` is what turns that into
 * bounded, known fields, and letting the type system pretend otherwise is
 * how an unvalidated model output ends up assigned to a config.
 */
export type RawPolicyDraftResponse = Record<string, unknown>;

export interface AIProvider {
  readonly mode: "LIVE_ANTHROPIC" | "LIVE_GEMINI" | "DEMO_RULE_BASED";
  extractIntent(params: ExtractIntentParams): Promise<RawIntentExtraction>;
  rankCandidates(params: RankCandidatesParams): Promise<RawRankedItem[]>;
  proposeGrowthAction(params: ProposeGrowthActionParams): Promise<RawGrowthProposal>;
  proposeRecoveryAction(params: ProposeRecoveryActionParams): Promise<RawRecoveryProposal>;
  /** Vaanigam Catalog Compiler — turns one free-text catalogue row into
   * structured fields an AI buyer can filter on. */
  normalizeCatalogRow(params: NormalizeCatalogRowParams): Promise<RawNormalizedProduct>;
  /** Vaanigam Negotiator — proposes a bounded add-on offer. Its discount is
   * clamped by the merchant's policy before it reaches anyone. */
  proposeAgentUpsell(params: ProposeAgentUpsellParams): Promise<RawAgentUpsell>;
  /** Vaanigam Policy Author — drafts policy changes from a merchant's own
   * sentence. The result is ALWAYS clamped by `buildPolicyDraft` and
   * approved by a human before anything is saved. */
  compilePolicyFromInstruction(params: CompilePolicyParams): Promise<RawPolicyDraftResponse>;
}
