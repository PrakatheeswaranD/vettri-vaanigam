/**
 * The Merchant Agent's action layer, declared rather than described.
 *
 * WHAT THIS REPLACED
 *
 * `runAutonomousCycle` dispatched on a two-value string — `mode: "RECOVER"
 * | "PROPOSE"` — decided by a `CONSUMPTION` map, with the branch inlined
 * in the middle of the pipeline. That worked, and it had three problems
 * worth fixing before a third action type arrived:
 *
 *   1. Adding an action meant editing the pipeline, not adding an entry.
 *   2. Nothing outside the cycle could invoke an action, so a merchant who
 *      wanted the agent to do one specific thing had to navigate to the
 *      right screen and do it by hand — the console was the only interface
 *      to capability the agent already had.
 *   3. Nothing could ANSWER "what is this agent able to do?". The set of
 *      actions existed only as branches.
 *
 * A registry fixes all three: the cycle looks a tool up by opportunity
 * type, `GET /merchant-agent/tools` lists them, and
 * `POST /merchant-agent/tools/:name` runs one on a named subject.
 *
 * ONE IMPLEMENTATION, NOT TWO
 *
 * The merchant-invoked path and the autonomous path call the SAME handler.
 * A tool that behaved differently depending on who started it would be two
 * tools wearing one name, and the one nobody tests is the one that moves
 * money wrong.
 *
 * THE SAFETY CLASSES ARE NOT A CONVENIENCE
 *
 * AUTOMATIC is deliberately almost empty. A tool qualifies only if it
 * moves no money AND writes no merchant-authored fact — it may only make
 * the merchant's record MORE true. Reconciliation qualifies because it
 * asks the provider what happened and records the answer; it cannot
 * invent, and it cannot charge. Everything else is GOVERNED and goes
 * through proposal → policy → approval → authorization → execute with no
 * shortcut, whichever caller started it.
 *
 * There is no third class on purpose. "Usually doesn't need approval"
 * would be a governed tool with an exception, and the exception is where
 * the money goes missing.
 */
import type { PrismaClient } from "@prisma/client";
import type { AgentToolDTO, AgentToolInvocationResultDTO } from "@razorgrowth/contracts";
import type { RevenueOpportunityType } from "@razorgrowth/domain";
import { isValidProposalTransition } from "@razorgrowth/domain";
import { AppError } from "../../http/errors.js";
import { logger } from "../../observability/logger.js";
import { appendLedgerEvent } from "../audit/ledger.js";
import { reconcilePayment } from "../payments/payment-service.js";
import { executeRecovery } from "../payments/recovery-execution-service.js";
import { evaluateProposalPolicy } from "../policy/service.js";
import { issueExecutionAuthorization } from "../policy/authorization-service.js";
import { evaluateAndProposeRecovery } from "./recovery-service.js";
import { proposeGrowthAction } from "./service.js";

/**
 * Error codes that mean a guardrail said no, not that something broke.
 *
 * An execution service refusing because the order moved on, the
 * authorization was already consumed, or the recomputed total no longer
 * matches is the system protecting the merchant's money — exactly what it
 * is for. Counting those as failures would make a working safeguard look
 * like an outage, and would bury a real outage among them.
 */
export const REFUSAL_CODES = new Set([
  "AUTHORIZATION_NOT_ALLOWED",
  "AUTHORIZATION_EXPIRED",
  "AUTHORIZATION_ALREADY_CONSUMED",
  "COMMERCE_STATE_CHANGED",
  "PROPOSAL_CHANGED",
  "FINANCIAL_INTEGRITY_ERROR",
  "IDEMPOTENCY_CONFLICT",
  "CONFLICT",
  "INVALID_STATE_TRANSITION",
  "NOT_FOUND",
  "PAYMENT_NOT_CONFIGURED",
]);

export function classifyToolError(error: unknown, context?: { tool?: string; merchantId?: string; workflowId?: string; subject?: string }): { outcome: "REFUSED" | "FAILED"; detail: string } {
  if (error instanceof AppError) {
    return { outcome: REFUSAL_CODES.has(error.code) ? "REFUSED" : "FAILED", detail: error.message };
  }
  /**
   * AN UNDIAGNOSABLE FAILURE IS WORSE THAN A LOUD ONE.
   *
   * This returned the sentence below and dropped the error on the floor.
   * The merchant read "an unexpected error stopped this step" against the
   * agent's own headline objective and had nothing to act on; so did
   * whoever they asked, because nothing reached the logs either. A real
   * provider outage and a typo in an id were indistinguishable, from
   * every angle, forever.
   *
   * The merchant still gets a short, honest sentence — internal error
   * text is not something to paste onto their screen — but the actual
   * error now reaches the operator who can do something about it.
   */
  logger.error(
    {
      event: "merchant_agent.tool_unexpected_error",
      tool: context?.tool,
      merchantId: context?.merchantId,
      workflowId: context?.workflowId,
      subject: context?.subject,
      err: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
    },
    "Merchant Agent tool failed with an unexpected error",
  );
  const name = error instanceof Error ? error.name : "Error";
  return {
    outcome: "FAILED",
    detail: `This step stopped on an unexpected ${name}. It has been logged with this run's id for investigation; nothing was changed.`,
  };
}

export interface ToolContext {
  prisma: PrismaClient;
  merchantId: string;
  /** Ties every step of one run together in the audit ledger. */
  workflowId: string;
  /**
   * Whether this run has no human present.
   *
   * Reaches the Policy Engine, where it gates the daily autonomous-action
   * ceiling — a limit that exists for exactly the case where nobody is
   * watching. Defaults to false at every call site, which is the safe
   * direction: a caller that forgets it gets the supervised behaviour
   * rather than accidentally exempting a scheduled run from the limit set
   * for it.
   */
  unattended?: boolean;
  /**
   * The opportunity type this invocation is answering, when there is one.
   *
   * A tool that `handles` several opportunity types was given no way to
   * tell them apart, so it could not report which detected gap it had
   * actually addressed — see `proposeGrowthActionTool`. Absent for a
   * merchant invoking a tool by hand, which is answering no card.
   */
  opportunityType?: RevenueOpportunityType;
}

/**
 * Moves a proposal to its terminal lifecycle state.
 *
 * WHY THE GOVERNANCE ROW RECORDS THIS AT ALL
 *
 * Governance used to end at AUTHORIZED, so an authorization that was
 * issued and then failed looked exactly like one still waiting to run.
 * "What did the agent actually do?" could only be answered by joining out
 * to whatever each action type happened to write.
 *
 * It records WHAT HAPPENED, never how much money moved — amounts stay on
 * the payment rows, which remain the only financial truth.
 *
 * The transition is validated against the domain's own table rather than
 * written blind: a status change that the lifecycle does not permit is a
 * bug worth failing loudly, not a row to overwrite.
 */
async function recordTerminalStatus(
  ctx: ToolContext,
  proposalId: string,
  to: "EXECUTED" | "VERIFIED" | "FAILED",
): Promise<void> {
  const proposal = await ctx.prisma.growthActionProposal.findFirst({
    where: { id: proposalId, merchantId: ctx.merchantId },
    select: { status: true },
  });
  if (!proposal) return;
  if (!isValidProposalTransition(proposal.status, to)) {
    logger.warn(
      { event: "agent_tool.invalid_transition", proposalId, from: proposal.status, to },
      "Refused an illegal proposal lifecycle transition",
    );
    return;
  }
  await ctx.prisma.growthActionProposal.update({ where: { id: proposalId }, data: { status: to } });
}

export type ToolOutcome = AgentToolInvocationResultDTO["outcome"];

export interface ToolRunResult {
  outcome: ToolOutcome;
  detail: string;
  proposalId?: string | null;
  /**
   * What the policy engine decided, for governed tools.
   *
   * Carried out of the tool rather than recomputed by the caller: the run
   * log's whole job is to show that a step which executed passed policy
   * first, and a null here would make that unprovable. An AUTOMATIC tool
   * reports null because no policy was consulted — there is nothing for
   * one to weigh.
   */
  policyOutcome?: string | null;
  authorizationId?: string | null;
  changed?: AgentToolInvocationResultDTO["changed"];
  /** Pipeline stages reached, for the run log. */
  stages?: string[];
}

export interface AgentToolDefinition {
  readonly meta: AgentToolDTO;
  run(ctx: ToolContext, subjectId: string): Promise<ToolRunResult>;
}

/* ═══════════════════════════════════════════════════════════════════════
 * The governed pipeline, shared by every GOVERNED tool
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * proposal → policy → authorization, identically for every governed tool.
 *
 * Extracted so a new governed action inherits the whole governance path
 * instead of reimplementing the parts of it its author remembers. The
 * caller supplies only how to BUILD the proposal; nothing after that is
 * negotiable.
 */
async function governedPipeline(
  ctx: ToolContext,
  build: () => Promise<{ id: string; status: string; rejectionReason: string | null }>,
): Promise<
  | { ok: true; proposalId: string; authorizationId: string; policyOutcome: string; stages: string[] }
  | { ok: false; result: ToolRunResult }
> {
  const stages = ["DETECTED"];

  let proposalId: string;
  try {
    const proposal = await build();
    proposalId = proposal.id;
    stages.push("PROPOSED");

    // A proposal the agent itself refused to make. This is the guardrail
    // working — an unverified payment outcome must be reconciled, never
    // retried blind — so it is a refusal, not a failure.
    if (proposal.status !== "PROPOSED") {
      return {
        ok: false,
        result: {
          outcome: "REFUSED",
          detail: proposal.rejectionReason ?? `The agent did not propose an action (${proposal.status}).`,
          proposalId,
          stages,
        },
      };
    }
  } catch (error) {
    const { outcome, detail } = classifyToolError(error, { tool: "governed_pipeline_propose", merchantId: ctx.merchantId, workflowId: ctx.workflowId });
    return { ok: false, result: { outcome, detail, proposalId: null, stages } };
  }

  let policyOutcome: string;
  try {
    policyOutcome = (
      await evaluateProposalPolicy(ctx.prisma, ctx.merchantId, proposalId, { unattended: ctx.unattended ?? false })
    ).outcome;
    stages.push("POLICY_CHECKED");
  } catch (error) {
    return {
      ok: false,
      result: {
        outcome: "FAILED",
        detail: error instanceof AppError ? error.message : "The policy engine could not decide on this proposal.",
        proposalId,
        stages,
      },
    };
  }

  if (policyOutcome !== "ALLOW") {
    // `REQUIRE_APPROVAL`, singular — the value the `PolicyDecision` enum
    // actually uses. Spelling it `REQUIRES_APPROVAL` once routed every
    // needs-a-human proposal into the BLOCKED branch, telling merchants
    // their policy had refused outright what it was merely waiting on.
    const needsApproval = policyOutcome === "REQUIRE_APPROVAL";
    return {
      ok: false,
      result: {
        outcome: needsApproval ? "AWAITING_APPROVAL" : "BLOCKED",
        detail: needsApproval
          ? "Outside your automatic-approval limits, so it is waiting for you."
          : "Your policy refused this action outright.",
        proposalId,
        policyOutcome,
        stages,
      },
    };
  }

  try {
    const authorization = await issueExecutionAuthorization(ctx.prisma, ctx.merchantId, proposalId);
    if ("denied" in authorization) {
      return { ok: false, result: { outcome: "BLOCKED", detail: authorization.explanation, proposalId, policyOutcome, stages } };
    }
    stages.push("AUTHORIZED");
    return { ok: true, proposalId, authorizationId: authorization.id, policyOutcome, stages };
  } catch (error) {
    return {
      ok: false,
      result: {
        outcome: "FAILED",
        detail: error instanceof AppError ? error.message : "Authorization could not be issued.",
        proposalId,
        policyOutcome,
        stages,
      },
    };
  }
}

/* ═══════════════════════════════════════════════════════════════════════
 * The tools
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * AUTOMATIC. Asks the provider what actually happened to a payment whose
 * outcome this merchant does not know, and records the answer.
 *
 * WHY THIS IS SAFE TO RUN UNATTENDED
 *
 * It moves no money and authors no fact. `reconcilePayment` reads from the
 * provider and writes only what the provider reports; where the provider
 * is ambiguous it refuses outright rather than guessing which of several
 * settled payments is authoritative. The worst outcome is that the
 * merchant's record becomes MORE true.
 *
 * WHY IT NEEDED TO EXIST
 *
 * The Revenue Opportunity Engine filters `state === "FAILED"`, so an
 * UNKNOWN payment was detected by nothing and acted on by nothing. The
 * demo merchant had four sitting in exactly that state: money neither
 * recovered nor written off, with no screen and no cycle that would ever
 * touch them. Recovery already reconciles UNKNOWN payments before
 * evaluating eligibility — but only for a payment something proposed
 * recovery for, and nothing ever did.
 */
const reconcilePaymentTool: AgentToolDefinition = {
  meta: {
    name: "reconcile_payment",
    summary:
      "Ask the payment provider what actually happened to a payment whose outcome is unknown, and record their answer. Moves no money and invents nothing — it can only make your records more accurate.",
    safety: "AUTOMATIC",
    reads: "PAYMENTS",
    subject: "a payment id",
    movesMoney: false,
    requiresApproval: false,
    handles: ["UNVERIFIED_PAYMENT"],
  },
  async run(ctx, paymentId) {
    const before = await ctx.prisma.payment.findFirst({
      where: { id: paymentId, merchantId: ctx.merchantId },
      select: { id: true, state: true },
    });
    if (!before) throw AppError.notFound(`Payment not found: ${paymentId}`);

    await reconcilePayment(ctx.prisma, ctx.merchantId, paymentId);

    // VERIFY means re-reading the row, not trusting the return value.
    const after = await ctx.prisma.payment.findFirstOrThrow({
      where: { id: paymentId, merchantId: ctx.merchantId },
      select: { state: true },
    });

    await appendLedgerEvent(ctx.prisma, {
      workflowId: ctx.workflowId,
      merchantId: ctx.merchantId,
      actorType: "SYSTEM",
      actionType: "PAYMENT_RECONCILED",
      status: "EXECUTED",
      conciseReason: `Agent reconciled payment ${paymentId} with the provider: ${before.state} -> ${after.state}.`,
      relatedEntityType: "Payment",
      relatedEntityId: paymentId,
      executedAt: new Date(),
    });

    return {
      outcome: "EXECUTED",
      detail:
        before.state === after.state
          ? `The provider confirms this payment is still ${after.state}. Nothing changed, and the outcome is now verified rather than assumed.`
          : `The provider reports this payment is ${after.state}, not ${before.state}. Your records now match theirs.`,
      changed: { entity: "Payment", id: paymentId, from: before.state, to: after.state },
      stages: ["DETECTED", "EXECUTED", "VERIFIED"],
    };
  },
};

/**
 * GOVERNED. Proposes and — inside the merchant's own limits — executes a
 * bounded retry of a failed payment.
 */
const recoverFailedPaymentTool: AgentToolDefinition = {
  meta: {
    name: "recover_failed_payment",
    summary:
      "Propose a bounded retry for a payment that failed, then execute it if it sits inside your automatic-approval limits. A new checkout is created; the money is not recovered until the provider captures it.",
    safety: "GOVERNED",
    reads: "PAYMENTS",
    subject: "a payment id",
    movesMoney: true,
    requiresApproval: true,
    handles: ["FAILED_PAYMENT_RECOVERY"],
  },
  async run(ctx, paymentId) {
    const gated = await governedPipeline(ctx, () => evaluateAndProposeRecovery(ctx.prisma, ctx.merchantId, paymentId));
    if (!gated.ok) return gated.result;

    try {
      // The authorization id is the idempotency key: one authorization
      // may produce exactly one recovery attempt, so a retried run cannot
      // create a second checkout against the same permission.
      const result = await executeRecovery(ctx.prisma, ctx.merchantId, gated.authorizationId, gated.authorizationId);
      const stages = [...gated.stages, "EXECUTED"];

      const checkout = await ctx.prisma.checkoutSession.findFirst({
        where: { id: result.checkoutId, merchantId: ctx.merchantId },
        select: { id: true, status: true },
      });
      if (!checkout) {
        // Execution ran and its claim could not be confirmed. FAILED, not
        // EXECUTED: an unverifiable success is the one outcome a
        // governance record must never round up.
        await recordTerminalStatus(ctx, gated.proposalId, "FAILED");
        return {
          outcome: "FAILED",
          detail: "Execution reported a checkout that could not be read back.",
          proposalId: gated.proposalId,
          policyOutcome: gated.policyOutcome,
          authorizationId: gated.authorizationId,
          stages,
        };
      }
      stages.push("VERIFIED");
      // AUTHORIZED -> EXECUTED -> VERIFIED, each transition validated
      // against the domain's own table rather than written blind.
      await recordTerminalStatus(ctx, gated.proposalId, "EXECUTED");
      await recordTerminalStatus(ctx, gated.proposalId, "VERIFIED");

      return {
        outcome: "EXECUTED",
        // Deliberately not "recovered ₹X". A new checkout is a retry the
        // customer still has to complete; claiming the money here would
        // be inventing a payment result.
        detail: `A new authorized checkout (${checkout.status.toLowerCase()}) was created for this order. The payment itself is not recovered until the provider captures it.`,
        proposalId: gated.proposalId,
        policyOutcome: gated.policyOutcome,
        authorizationId: gated.authorizationId,
        changed: { entity: "CheckoutSession", id: checkout.id, from: "none", to: checkout.status },
        stages,
      };
    } catch (error) {
      const { outcome, detail } = classifyToolError(error, { tool: "governed_pipeline_execute", merchantId: ctx.merchantId, workflowId: ctx.workflowId, subject: gated.proposalId });
      // A REFUSED step is a guardrail working, and the authorization was
      // never consumed — the proposal stays AUTHORIZED and is legitimately
      // re-workable. Only a genuine FAILURE is terminal.
      if (outcome === "FAILED") await recordTerminalStatus(ctx, gated.proposalId, "FAILED");
      return {
        outcome,
        detail,
        proposalId: gated.proposalId,
        policyOutcome: gated.policyOutcome,
        authorizationId: gated.authorizationId,
        stages: gated.stages,
      };
    }
  },
};

/**
 * GOVERNED. Proposes a cross-sell, upsell, bundle or bounded offer against
 * one product, inside the merchant's growth boundaries.
 */
const proposeGrowthActionTool: AgentToolDefinition = {
  meta: {
    name: "propose_growth_action",
    summary:
      "Propose a cross-sell, upsell, bundle or bounded offer for a product, inside the boundaries you set. Once authorized it applies the next time a buyer's basket matches; nothing executes until one does.",
    safety: "GOVERNED",
    reads: "PRODUCTS",
    subject: "a product id",
    movesMoney: false,
    requiresApproval: true,
    handles: ["CROSS_SELL", "UPSELL", "ELIGIBLE_OFFER"],
  },
  async run(ctx, productId) {
    const gated = await governedPipeline(ctx, () =>
      proposeGrowthAction(ctx.prisma, { merchantId: ctx.merchantId, primaryProductId: productId }),
    );
    if (!gated.ok) return gated.result;

    /**
     * SAY WHICH ACTION WAS ACTUALLY PROPOSED.
     *
     * This tool handles three different opportunity types and returned
     * one fixed sentence for all of them. So an ELIGIBLE_OFFER
     * opportunity — "these products are promotion-eligible and no bounded
     * offer is attached; the permission exists, the offer does not" —
     * could be answered with a CROSS_SELL carrying no offer, and reported
     * as "Authorized and ready." The merchant reads the card's own title
     * and concludes the offer gap is closed. It is not.
     *
     * That the proposal carries no offer is often CORRECT: the demo
     * provider deliberately never invents a discount without real signal.
     * A conservative agent declining to fabricate a reason to discount is
     * the behaviour we want. Reporting that as though it had created the
     * offer is not.
     *
     * So the detail now names the action type, and says plainly when the
     * detected gap is still open.
     */
    const proposal = await ctx.prisma.growthActionProposal.findFirst({
      where: { id: gated.proposalId, merchantId: ctx.merchantId },
      select: { actionType: true, offerKind: true },
    });
    const actionLabel = (proposal?.actionType ?? "growth action").toLowerCase().replaceAll("_", " ");
    const carriesOffer = Boolean(proposal?.offerKind);
    const offerGapStillOpen = ctx.opportunityType === "ELIGIBLE_OFFER" && !carriesOffer;

    // A governed growth proposal cannot execute without a live basket to
    // attach to. It is authorized and then waits.
    //
    // EXECUTED and deliberately NOT VERIFIED: the agent has done
    // everything it can do, and nothing has yet been applied to a real
    // basket. Marking it VERIFIED would claim a result that has not
    // happened — the same reason the detail below refuses to name money.
    await recordTerminalStatus(ctx, gated.proposalId, "EXECUTED");
    return {
      outcome: "EXECUTED",
      detail:
        `Authorized a ${actionLabel}${carriesOffer ? " carrying a bounded offer" : " with no discount attached"}. ` +
        "It applies automatically the next time a buyer's basket matches; nothing executes until one does." +
        (offerGapStillOpen
          ? " This does NOT close the missing-offer gap that was detected: no bounded offer was proposed, because the agent will not invent a discount without a reason in your own data."
          : ""),
      proposalId: gated.proposalId,
      policyOutcome: gated.policyOutcome,
      authorizationId: gated.authorizationId,
      stages: gated.stages,
    };
  },
};

/* ═══════════════════════════════════════════════════════════════════════
 * The registry
 * ══════════════════════════════════════════════════════════════════════ */

const TOOLS: readonly AgentToolDefinition[] = [
  reconcilePaymentTool,
  recoverFailedPaymentTool,
  proposeGrowthActionTool,
] as const;

export const AGENT_TOOLS: readonly AgentToolDTO[] = TOOLS.map((t) => t.meta);

export function findTool(name: string): AgentToolDefinition | null {
  return TOOLS.find((t) => t.meta.name === name) ?? null;
}

/**
 * Which tool the autonomous cycle routes an opportunity type to, or null
 * when that type is for a human to read rather than for the agent to work.
 *
 * This IS the old `CONSUMPTION` map, derived from the tools themselves
 * rather than maintained beside them — two lists that must agree about
 * which types are actionable would eventually disagree, and this codebase
 * has already shipped that bug twice.
 *
 * The types that map to nothing are deliberate, not missing:
 * ABANDONED_CHECKOUT_RECOVERY, REPEAT_PURCHASE and CUSTOMER_REACTIVATION
 * are keyed by customer or checkout, and no proposal shape exists for
 * either; UNDERPERFORMING_PRODUCT, PRODUCT_DISCOVERY and
 * AI_BUYER_READINESS ask the merchant to author product facts, which the
 * agent must never invent. Manufacturing a proposal for "add attributes to
 * nine products" would put a governance row on a task governance has no
 * opinion about.
 */
const TOOL_BY_OPPORTUNITY: ReadonlyMap<string, string> = new Map(
  TOOLS.flatMap((tool) => tool.meta.handles.map((type) => [type as string, tool.meta.name] as const)),
);

export function toolForOpportunityType(type: RevenueOpportunityType | string): string | null {
  return TOOL_BY_OPPORTUNITY.get(type) ?? null;
}
