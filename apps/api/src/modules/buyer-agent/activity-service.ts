/**
 * Agent Activity — the buyer's own record of what their agent did.
 *
 * EVERY EVENT HERE IS A LEDGER ROW THAT ALREADY EXISTED.
 *
 * Nothing in this file generates activity. It reads `AgentAction` — the
 * hash-chained audit ledger every stage of the pipeline already writes to
 * — filters it to this buyer's own workflows, and maps each row onto the
 * stage it belongs to. An event appears here because a backend action
 * happened; if no action happened, the stage is absent, and absent is the
 * honest answer.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * Synthesise the missing stages. A conversation that searched but never
 * bought has no POLICY, AUTHORIZATION, CHECKOUT, PAYMENT or ORDER event,
 * and this returns exactly the stages that occurred rather than a
 * ten-step timeline with seven of them greyed out and invented. A
 * progress bar that shows steps nobody took is a lie with a nice
 * animation.
 *
 * NO CHAIN-OF-THOUGHT
 *
 * `conciseReason` is a structured fact written at the time of the action —
 * "Compared 2 products on 9 published catalogue fields" — never model
 * reasoning. The ledger has never stored chain-of-thought and this does
 * not add a path to it.
 */
import type { PrismaClient } from "@prisma/client";
import type { BuyerActivityResponseDTO, BuyerActivityStage } from "@razorgrowth/contracts";

/**
 * Ledger action types, mapped to the stage the buyer understands.
 *
 * A closed map on purpose. An action type that is not listed does not
 * appear in the buyer's activity feed at all — merchant-side events share
 * this ledger, and a shopper has no business reading a merchant's growth
 * proposals. Adding a stage is a deliberate act, not something that
 * happens because someone named a new action type.
 */
const STAGE_BY_ACTION: Readonly<Record<string, BuyerActivityStage>> = {
  BUYER_INTENT_EXTRACTED: "INTENT",
  PRODUCTS_DISCOVERED: "DISCOVERY",
  MARKETPLACE_DISCOVERED: "DISCOVERY",
  COMPARISON_BUILT: "COMPARISON",
  RECOMMENDATION_PROPOSED: "RECOMMENDATION",
  OFFERS_EVALUATED: "OFFER_CHECK",
  AUTHORIZED_OFFER_APPLIED: "OFFER_CHECK",
  BUYER_PURCHASE_PROPOSED: "POLICY",
  BUYER_PURCHASE_AUTHORIZED: "AUTHORIZATION",
  EXECUTION_AUTHORIZATION_DENIED: "AUTHORIZATION",

  // ── CHECKOUT ──────────────────────────────────────────────────────
  // `CHECKOUT_CREATED` is what the MERCHANT growth path writes. The
  // buyer's own path writes `AGENT_CHECKOUT_CREATED`, and listing only
  // the first meant a buyer's purchase reached a real Razorpay order
  // while their activity page showed no checkout stage at all — the
  // events existed and nothing read them.
  AGENT_CHECKOUT_CREATED: "CHECKOUT",
  CHECKOUT_CREATED: "CHECKOUT",
  CHECKOUT_READY_FOR_PAYMENT: "CHECKOUT",
  PAYMENT_INITIATION_REQUESTED: "CHECKOUT",
  // The Razorpay Test Mode order. This IS the checkout the buyer is sent
  // to, so hiding it left the most concrete step in the chain invisible.
  PROVIDER_ORDER_CREATED: "CHECKOUT",
  // The internal order row, created with the basket reservation before
  // any payment. See the ORDER block below for why it is not ORDER.
  ORDER_CREATED: "CHECKOUT",

  // ── PAYMENT ───────────────────────────────────────────────────────
  PAYMENT_RECORD_CREATED: "PAYMENT",
  PAYMENT_AUTHORIZED: "PAYMENT",
  PAYMENT_CAPTURED: "PAYMENT",
  PAYMENT_FAILED: "PAYMENT",
  PAYMENT_RECONCILED: "PAYMENT",
  CLIENT_PAYMENT_VERIFICATION_RECEIVED: "PAYMENT",
  CLIENT_PAYMENT_SIGNATURE_VERIFIED: "PAYMENT",
  CLIENT_PAYMENT_SIGNATURE_INVALID: "PAYMENT",
  // A buyer is entitled to know their payment was VERIFIED rather than
  // assumed. Without these two the page could show a capture and never
  // show what earned the right to believe it.
  WEBHOOK_RECEIVED: "PAYMENT",
  WEBHOOK_SIGNATURE_VERIFIED: "PAYMENT",
  // A refused capture is the single most important thing that can happen
  // to someone's money. Omitting it would have shown a payment that
  // simply stopped, with no record of why.
  PAYMENT_FINANCIAL_INTEGRITY_ERROR: "PAYMENT",
  PAYMENT_STATE_TRANSITION_REJECTED: "PAYMENT",

  // ── ORDER ─────────────────────────────────────────────────────────
  //
  // `ORDER_CREATED` is deliberately NOT here. An order row exists from
  // the moment the basket is reserved, before a rupee has moved, so
  // mapping it to ORDER lit the last stage of the rail for a purchase
  // that might never be paid — the same overstatement as a checkout
  // screen that says "order placed" because a row was inserted. It sits
  // under CHECKOUT above, which is what it actually is: the checkout
  // being prepared.
  //
  // ORDER means the buyer has an order, and only a verified capture
  // writes `ORDER_CONFIRMED`.
  ORDER_CONFIRMED: "ORDER",
  ORDER_FULFILLED: "ORDER",
  AGENT_INVENTORY_RESERVATION_RELEASED: "ORDER",
};

/** The order the spec names, used to sort stages within one workflow so a
 * timeline reads as a pipeline rather than as raw insert order. */
const STAGE_ORDER: readonly BuyerActivityStage[] = [
  "INTENT",
  "DISCOVERY",
  "COMPARISON",
  "RECOMMENDATION",
  "OFFER_CHECK",
  "POLICY",
  "AUTHORIZATION",
  "CHECKOUT",
  "PAYMENT",
  "ORDER",
];

/** How many workflows to return. A feed, not an export. */
export const ACTIVITY_WORKFLOW_LIMIT = 20;

/**
 * This buyer's agent activity, grouped into the workflows it happened in.
 *
 * SCOPING IS THE SECURITY BOUNDARY HERE.
 *
 * The ledger is merchant-scoped and shared with every merchant-side
 * event. A buyer may only ever see workflows their own actions created,
 * so the workflow ids come from rows this buyer owns — their decision
 * records and their conversations — and never from a merchant filter that
 * would leak a seller's internal activity into a shopper's feed.
 */
export async function getBuyerActivity(
  prisma: PrismaClient,
  buyerContext: string,
  agentId: string,
): Promise<BuyerActivityResponseDTO> {
  // Workflows this buyer's own purchases created.
  const decisions = await prisma.decisionRecord.findMany({
    where: { externalAgentId: agentId, protocolActorRef: buyerContext, workflowId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: ACTIVITY_WORKFLOW_LIMIT,
    select: { workflowId: true, createdAt: true, outcome: true, explanation: true, computedTotalMinor: true, currency: true },
  });

  // Workflows this buyer's own conversations created. A search that never
  // became a purchase is still their agent's activity, and omitting it
  // would make the feed look like it only records spending.
  const conversationEvents = await prisma.agentAction.findMany({
    where: {
      actorType: "BUYER_AGENT",
      relatedEntityType: "BuyerConversation",
      relatedEntityId: {
        in: (
          await prisma.buyerConversation.findMany({
            where: { customerAccountId: buyerContext },
            orderBy: { updatedAt: "desc" },
            take: ACTIVITY_WORKFLOW_LIMIT,
            select: { id: true },
          })
        ).map((c) => c.id),
      },
    },
    orderBy: { createdAt: "desc" },
    select: { workflowId: true, createdAt: true },
    distinct: ["workflowId"],
    take: ACTIVITY_WORKFLOW_LIMIT,
  });

  /**
   * MERGED BY RECENCY, NOT BY SOURCE.
   *
   * This concatenated the two lists and sliced the first twenty. Since
   * the decisions came first, a buyer with twenty or more purchase
   * proposals — the demo shopper has ninety-six — never saw a single
   * conversation-only workflow, which is precisely what the comment above
   * says must not happen. The feed silently became "spending only" for
   * exactly the buyers who use the agent most.
   *
   * Both sources are already ordered newest-first; interleaving them on
   * their own timestamps is what makes "the twenty most recent things
   * your agent did" true rather than "the twenty most recent purchases,
   * then whatever fits".
   */
  const latestByWorkflow = new Map<string, number>();
  for (const row of [
    ...decisions.map((d) => ({ workflowId: d.workflowId, at: d.createdAt })),
    ...conversationEvents.map((e) => ({ workflowId: e.workflowId, at: e.createdAt })),
  ]) {
    if (!row.workflowId) continue;
    const at = row.at.getTime();
    const seen = latestByWorkflow.get(row.workflowId);
    if (seen === undefined || at > seen) latestByWorkflow.set(row.workflowId, at);
  }

  const workflowIds = [...latestByWorkflow.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, ACTIVITY_WORKFLOW_LIMIT)
    .map(([id]) => id);

  if (workflowIds.length === 0) return { workflows: [], stageOrder: [...STAGE_ORDER] };

  const rows = await prisma.agentAction.findMany({
    where: { workflowId: { in: workflowIds } },
    orderBy: [{ workflowId: "asc" }, { sequence: "asc" }],
    select: {
      id: true,
      workflowId: true,
      actionType: true,
      actorType: true,
      status: true,
      conciseReason: true,
      createdAt: true,
      sequence: true,
    },
  });

  const decisionByWorkflow = new Map(decisions.map((d) => [d.workflowId!, d]));
  const byWorkflow = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byWorkflow.get(row.workflowId);
    if (list) list.push(row);
    else byWorkflow.set(row.workflowId, [row]);
  }

  const workflows = workflowIds
    .map((workflowId) => {
      const events = (byWorkflow.get(workflowId) ?? [])
        // Only the stages a buyer's pipeline actually has. A merchant-side
        // event sharing this workflow is not this buyer's activity.
        .filter((row) => STAGE_BY_ACTION[row.actionType] !== undefined)
        .map((row) => ({
          id: row.id,
          stage: STAGE_BY_ACTION[row.actionType]!,
          actionType: row.actionType,
          actor: row.actorType,
          status: row.status,
          // The reason written AT THE TIME of the action, carried
          // verbatim. Never regenerated, never explained after the fact.
          detail: row.conciseReason,
          at: row.createdAt.toISOString(),
          sequence: row.sequence,
        }));

      if (events.length === 0) return null;

      const decision = decisionByWorkflow.get(workflowId) ?? null;
      return {
        workflowId,
        startedAt: events[0]!.at,
        // The stages this workflow REACHED. Absent stages are absent, not
        // rendered as pending steps that nobody took.
        reachedStages: [...new Set(events.map((e) => e.stage))].sort(
          (a, b) => STAGE_ORDER.indexOf(a) - STAGE_ORDER.indexOf(b),
        ),
        events,
        outcome: decision
          ? {
              policyOutcome: decision.outcome,
              explanation: decision.explanation,
              amountMinor: decision.computedTotalMinor,
              currency: decision.currency,
            }
          : null,
      };
    })
    .filter((w): w is NonNullable<typeof w> => w !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  return { workflows, stageOrder: [...STAGE_ORDER] };
}
