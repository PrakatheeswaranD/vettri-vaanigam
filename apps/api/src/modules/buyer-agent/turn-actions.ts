/**
 * The conversational half of the buyer pipeline: COMPARE and BUY.
 *
 * WHAT WAS DISCONNECTED
 *
 * The Buyer Agent did discovery, filtering, comparison and recommendation
 * — and then stopped. Purchase, spending policy, authorization, checkout,
 * payment, verification and order all existed and all worked, reachable
 * only by leaving the conversation, finding the product page, and driving
 * an ordinary e-commerce checkout by hand.
 *
 * Two working halves of one pipeline with nothing joining them, and the
 * seam sat exactly where the product's premise is: *the buyer should
 * express intent rather than operate a website*.
 *
 * THE RULE THESE HANDLERS FOLLOW
 *
 * Everything here resolves against rows that already exist. A BUY resolves
 * to a variant the agent ITSELF recommended on this conversation, looked
 * up by position — never to a product id or name that arrived in the
 * message, and never to something the model produced. Then it goes through
 * `createPurchaseProposal`, the same function the REST route calls, so the
 * buyer's spending policy decides exactly as it would have.
 *
 * The conversation is a way to REACH the purchase path. It is never a
 * second path around it.
 */
import type { PrismaClient } from "@prisma/client";
import type { BuyerComparisonDTO, BuyerPurchaseOutcomeDTO } from "@razorgrowth/contracts";

/**
 * The last set of products the agent put in front of this buyer.
 *
 * Read from the `RecommendationRecord` the conversation already wrote,
 * which is the only honest record of "what is on the table" — a client
 * telling the server which products it is looking at would be a client
 * choosing what gets bought.
 */
export interface ConversationCandidate {
  productId: string;
  /** The SPECIFIC variant that was actually recommended (size, colour,
   * whichever attribute made it the match) — never re-derived as "the
   * cheapest active variant of the product", which can silently be a
   * different one than what the buyer was shown. */
  variantId: string;
}

export async function loadConversationCandidates(
  prisma: PrismaClient,
  conversationId: string,
): Promise<{ productIds: string[]; candidates: ConversationCandidate[]; recommendationId: string | null }> {
  const record = await prisma.recommendationRecord.findFirst({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    select: { id: true, recommendedProductIds: true, recommendedVariantIds: true },
  });
  if (!record) return { productIds: [], candidates: [], recommendationId: null };

  const productIds = Array.isArray(record.recommendedProductIds)
    ? record.recommendedProductIds.filter((entry): entry is string => typeof entry === "string")
    : [];
  const variantIds = Array.isArray(record.recommendedVariantIds)
    ? record.recommendedVariantIds.filter((entry): entry is string => typeof entry === "string")
    : [];

  // Pair by position only when the two arrays actually agree in length.
  // A historical row written before this column existed has an empty
  // `variantIds` — zip would otherwise silently misalign a shorter array
  // against a longer one and pair the wrong variant to the wrong product.
  const candidates: ConversationCandidate[] =
    variantIds.length === productIds.length
      ? productIds.map((productId, index) => ({ productId, variantId: variantIds[index]! }))
      : [];

  return { productIds, candidates, recommendationId: record.id };
}

/* ═══════════════════════════════════════════════════════════════════════
 * COMPARE
 * ══════════════════════════════════════════════════════════════════════ */

function attributeValue(attributes: unknown, key: string): string | null {
  if (!attributes || typeof attributes !== "object") return null;
  const value = (attributes as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

/**
 * A deterministic side-by-side of products the agent already recommended.
 *
 * FACTS ONLY. Every row is a catalogue value, and `differs` is computed
 * rather than asserted. There is deliberately no "which is better" row:
 * that is a recommendation, the agent already made one, and dressing a
 * second one as a comparison table would hide that it is an opinion.
 *
 * A field a product does not record shows as null, never as a plausible
 * default — "no rating recorded" and "rated 0" are opposite claims.
 */
export async function buildComparison(
  prisma: PrismaClient,
  productIds: readonly string[],
): Promise<BuyerComparisonDTO | null> {
  if (productIds.length < 2) return null;

  // At most four: a side-by-side nobody can read is not a comparison.
  const ids = [...productIds].slice(0, 4);
  const products = await prisma.product.findMany({
    where: { id: { in: ids }, status: "ACTIVE" },
    include: {
      merchant: { select: { name: true } },
      variants: { where: { active: true }, include: { inventory: true }, orderBy: { priceMinor: "asc" } },
    },
  });

  // Preserve the order the agent recommended them in, not the database's.
  const ordered = ids.map((id) => products.find((p) => p.id === id)).filter((p): p is (typeof products)[number] => Boolean(p));
  if (ordered.length < 2) return null;

  const cheapest = ordered.map((product) => product.variants[0] ?? null);

  /** Attribute keys any of the compared products records, so the table
   * covers what they actually differ on rather than a fixed list. */
  const attributeKeys = [
    ...new Set(
      ordered.flatMap((product) =>
        product.variants.flatMap((variant) =>
          variant.attributes && typeof variant.attributes === "object"
            ? Object.keys(variant.attributes as Record<string, unknown>)
            : [],
        ),
      ),
    ),
  ].slice(0, 6);

  const rows: BuyerComparisonDTO["rows"] = [
    { label: "Product", values: ordered.map((p) => p.name), differs: true },
    { label: "Sold by", values: ordered.map((p) => p.merchant.name), differs: false },
    { label: "Category", values: ordered.map((p) => p.category), differs: false },
    {
      label: "Price from",
      values: cheapest.map((variant) => (variant ? String(variant.priceMinor) : null)),
      differs: false,
    },
    {
      label: "Availability",
      values: ordered.map((product) => {
        const total = product.variants.reduce((sum, v) => sum + (v.inventory?.availableQuantity ?? 0), 0);
        if (product.variants.some((v) => v.inventory === null)) return null;
        return total > 0 ? `${total} in stock` : "Out of stock";
      }),
      differs: false,
    },
    {
      label: "Returns",
      values: ordered.map((p) => p.returnPolicySummary),
      differs: false,
    },
    ...attributeKeys.map((key) => ({
      label: key,
      values: cheapest.map((variant) => (variant ? attributeValue(variant.attributes, key) : null)),
      differs: false,
    })),
  ];

  // `differs` is DERIVED, so a row can never claim a difference the values
  // do not show.
  for (const row of rows) {
    const seen = new Set(row.values.map((value) => value ?? " null"));
    row.differs = seen.size > 1;
  }

  return { productIds: ordered.map((p) => p.id), rows };
}

/* ═══════════════════════════════════════════════════════════════════════
 * BUY
 * ══════════════════════════════════════════════════════════════════════ */

export type ResolveBuyResult =
  | { resolved: true; productId: string; variantId: string }
  | { resolved: false; reason: string };

/**
 * Which product did the buyer mean, and which VARIANT of it?
 *
 * Resolved ONLY from what the agent recommended on this conversation, by
 * position. Three refusals, all deliberate:
 *
 *   nothing recommended   Nothing to buy. The buyer is searching, not
 *                         purchasing, whatever words they used.
 *   ordinal out of range  "Buy the third" with two options is a mistake,
 *                         and buying the second instead would be the agent
 *                         choosing for them.
 *   no ordinal, several   "Buy this" is unambiguous with one option and a
 *                         guess with four. It asks rather than picks.
 *
 * The last is the one that matters. An agent that resolves ambiguity by
 * picking the first result will eventually buy the wrong thing, and the
 * buyer will find out from their bank.
 *
 * WHY THE VARIANT COMES FROM `candidates`, NEVER RE-DERIVED
 *
 * A product can have several purchasable variants — different sizes,
 * different colours — and only one of them was the one that actually
 * satisfied the buyer's stated constraints. `candidates` carries that
 * exact pairing, persisted by the recommendation that produced it (see
 * `RecommendationRecord.recommendedVariantIds`). Re-deriving "the
 * cheapest active variant" here would silently substitute a DIFFERENT
 * size or colour than the one the buyer was shown — this function used to
 * do exactly that, and it is the one case where "close enough" is a
 * wrong purchase, not a wrong recommendation.
 *
 * A candidate whose `variantId` is empty (a historical row written before
 * that column existed) falls back to the product's cheapest active
 * variant, so old conversations degrade rather than error — but every
 * candidate created from here forward carries the real one.
 */
export async function resolveBuyTarget(
  prisma: PrismaClient,
  candidates: readonly ConversationCandidate[],
  ordinal: number | null,
): Promise<ResolveBuyResult> {
  if (candidates.length === 0) {
    return { resolved: false, reason: "There is nothing on the table to buy yet — tell me what you are looking for first." };
  }
  if (ordinal === null && candidates.length > 1) {
    return {
      resolved: false,
      reason: `There are ${candidates.length} options from earlier. Say which one you mean — "buy the first" or "buy the second" — and I will price it up.`,
    };
  }

  const chosen = candidates[(ordinal ?? 1) - 1];
  if (!chosen) {
    return {
      resolved: false,
      reason: `I only have ${candidates.length} option${candidates.length === 1 ? "" : "s"} in front of me, so there is no number ${ordinal}. Say which of them you meant.`,
    };
  }

  if (chosen.variantId) {
    // The variant the buyer was actually shown. Still confirmed live —
    // a size that was in stock when recommended may not be now — never
    // trusted blind just because it was persisted.
    const stillPurchasable = await prisma.productVariant.findFirst({
      where: { id: chosen.variantId, active: true, product: { status: "ACTIVE" } },
      select: { id: true },
    });
    if (stillPurchasable) {
      return { resolved: true, productId: chosen.productId, variantId: chosen.variantId };
    }
    // Fall through to the cheapest-alternative lookup below rather than
    // refusing outright — the product itself may still have other
    // purchasable variants even though this exact one no longer does.
  }

  // No persisted variant (a historical row), or the persisted one is no
  // longer purchasable. Cheapest active, in-stock variant is the honest
  // fallback here, never an arbitrary row.
  const variant = await prisma.productVariant.findFirst({
    where: { productId: chosen.productId, active: true, product: { status: "ACTIVE" } },
    orderBy: { priceMinor: "asc" },
    select: { id: true },
  });
  if (!variant) {
    return { resolved: false, reason: "That product has no purchasable variant right now." };
  }
  return { resolved: true, productId: chosen.productId, variantId: variant.id };
}

/**
 * Shapes the proposal the purchase service returned for the conversation.
 *
 * Every value is carried verbatim — the policy's own outcome, its own
 * explanation, and the service's own arithmetic. Nothing is recomputed
 * here: a second calculation of the same total is a second chance to
 * disagree with the figure the provider will actually be asked for.
 *
 * The breakdown exists because a lone total is not something a shopper can
 * check. `listTotalMinor - discountMinor === amountMinor` holds exactly,
 * in integer minor units, and a test asserts it end to end.
 */
export function toPurchaseOutcome(
  proposal: {
    id: string;
    outcome: string;
    explanation: string;
    amountMinor: number;
    currency: string;
    productName: string;
    variantTitle: string;
    quantity: number;
    unitPriceMinor: number;
    listTotalMinor: number;
    discountMinor: number;
    appliedOffer: { proposalId: string; percentageBps: number | null; provenance: string } | null;
  },
  productId: string,
  variantId: string,
  quantity: number,
): BuyerPurchaseOutcomeDTO {
  return {
    proposalId: proposal.id,
    productId,
    variantId,
    productName: proposal.productName,
    variantTitle: proposal.variantTitle,
    quantity,
    unitPriceMinor: proposal.unitPriceMinor,
    listTotalMinor: proposal.listTotalMinor,
    discountMinor: proposal.discountMinor,
    amountMinor: proposal.amountMinor,
    currency: proposal.currency,
    appliedOffer: proposal.appliedOffer,
    outcome: proposal.outcome,
    explanation: proposal.explanation,
    // STEP_UP means the buyer's own policy wants them to say yes
    // explicitly. Money has moved in neither case.
    requiresAuthorization: proposal.outcome !== "AUTO_APPROVE",
  };
}
