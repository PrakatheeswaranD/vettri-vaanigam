/**
 * Agent protocol vocabulary and the normalized `PurchaseIntent`.
 *
 * THE THESIS, IN ONE TYPE
 *
 * Three incompatible agent-commerce standards are arriving at the same
 * merchants at once — OpenAI/Stripe's ACP, Google's AP2, and Coinbase's
 * x402 — and NPCI is drafting a fourth. A merchant cannot be expected to
 * integrate each one. Every adapter's only job is to turn its own wire
 * format into ONE `PurchaseIntent`; everything downstream (mandate check,
 * policy, negotiation, step-up, ledger) is protocol-agnostic and never
 * learns which protocol the buyer spoke.
 *
 * That is what makes a fourth protocol a new adapter rather than a new
 * system.
 *
 * HONESTY: `ACP` is implemented against the published open spec. `AP2` and
 * `X402` are compatibility SHIMS — they accept the shape and normalize it,
 * but have not been certified against a live counterparty. `PROTOCOL_
 * FIDELITY` records that distinction so the UI can label it rather than
 * implying three equal integrations.
 */
import type { CurrencyCode } from "./money.js";

export const AGENT_PROTOCOLS = ["ACP", "AP2", "X402"] as const;
export type AgentProtocol = (typeof AGENT_PROTOCOLS)[number];

export const PROTOCOL_FIDELITY: Record<AgentProtocol, "SPEC_IMPLEMENTED" | "COMPATIBILITY_SHIM"> = {
  ACP: "SPEC_IMPLEMENTED",
  AP2: "COMPATIBILITY_SHIM",
  X402: "COMPATIBILITY_SHIM",
};

export const PROTOCOL_DISPLAY_NAMES: Record<AgentProtocol, string> = {
  ACP: "Agentic Commerce Protocol (OpenAI/Stripe)",
  AP2: "Agent Payments Protocol (Google)",
  X402: "x402 (Coinbase)",
};

/**
 * Whether this merchant has transacted with the calling agent before.
 *
 * Deliberately NOT self-reported: an agent claiming to be trusted is
 * exactly the case the ceiling exists to catch, so this is always decided
 * from the merchant's own records.
 */
export const AGENT_TRUST_LEVELS = ["KNOWN", "UNKNOWN"] as const;
export type AgentTrustLevel = (typeof AGENT_TRUST_LEVELS)[number];

export interface PurchaseIntentLine {
  /** Merchant-side product identifier resolved by the adapter. A line the
   * adapter could not resolve is rejected rather than guessed. */
  productId: string;
  variantId: string | null;
  quantity: number;
}

/**
 * The single internal representation every protocol collapses into.
 *
 * Note what is NOT here: any amount supplied by the buyer agent. A
 * protocol payload states a price, and trusting it would let a caller
 * name its own total. The adapter carries the CLAIMED total only so the
 * gateway can compare it against the server-computed one and refuse on
 * mismatch — the authoritative figure is always recomputed from the
 * merchant's catalogue.
 */
export interface PurchaseIntent {
  protocol: AgentProtocol;
  protocolVersion: string | null;
  agentId: string;
  agentTrust: AgentTrustLevel;
  merchantId: string;
  lines: PurchaseIntentLine[];
  currency: CurrencyCode;
  /** What the agent said the order costs. Never used as the charge amount. */
  claimedTotalMinor: number | null;
  idempotencyKey: string;
  receivedAt: Date;
}
