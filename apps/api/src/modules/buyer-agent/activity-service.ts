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
  CHECKOUT_CREATED: "CHECKOUT",
  PAYMENT_AUTHORIZED: "PAYMENT",
  PAYMENT_CAPTURED: "PAYMENT",
  PAYMENT_FAILED: "PAYMENT",
  CLIENT_PAYMENT_SIGNATURE_VERIFIED: "PAYMENT",
  ORDER_CREATED: "ORDER",
  ORDER_FULFILLED: "ORDER",
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
    select: { workflowId: true },
    distinct: ["workflowId"],
    take: ACTIVITY_WORKFLOW_LIMIT,
  });

  const workflowIds = [
    ...new Set([
      ...decisions.map((d) => d.workflowId).filter((id): id is string => Boolean(id)),
      ...conversationEvents.map((e) => e.workflowId),
    ]),
  ].slice(0, ACTIVITY_WORKFLOW_LIMIT);

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
