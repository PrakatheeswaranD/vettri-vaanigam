/**
 * The Merchant Agent's autonomous cycle.
 *
 * WHAT WAS ACTUALLY MISSING
 *
 * Every stage of the loop already existed, and nothing joined them up.
 * The Revenue Opportunity Engine observed, identified, analysed and
 * prioritised. `evaluateAndProposeRecovery` proposed. `validateGrowthProposal`
 * validated. `evaluateProposalPolicy` decided. `issueExecutionAuthorization`
 * bounded. `executeRecovery` executed. The ledger audited all of it.
 *
 * But a merchant had to drive each step by hand, one payment at a time,
 * through four separate endpoints — and the console only ever called the
 * first. A proposal reached `PROPOSED` and stopped there forever. The
 * product had an autonomous revenue agent that could not act on its own,
 * which is the one thing it is for.
 *
 * This file is that missing drive shaft. It creates no new detection, no
 * second policy engine and no alternative execution path: every stage
 * below is a call into the service that already owned it.
 *
 *     OBSERVE / IDENTIFY / ANALYZE / PRIORITIZE
 *         getRevenueOpportunityReport   (ranked, from real rows)
 *     PROPOSE + VALIDATE
 *         evaluateAndProposeRecovery    (LLM-assisted, then validated)
 *     POLICY CHECK
 *         evaluateProposalPolicy        (deterministic, no AI in scope)
 *     BOUNDARY
 *         ALLOW              -> issueExecutionAuthorization -> execute
 *         REQUIRES_APPROVAL  -> stop, leave for a human
 *     EXECUTE / VERIFY
 *         executeRecovery, then re-read the row that proves it
 *     MEASURE / AUDIT
 *         appendLedgerEvent at every transition
 *
 * WHAT THE MODEL IS AND IS NOT ALLOWED TO DO
 *
 * The LLM's entire contribution is a structured proposal shape, produced
 * inside `evaluateAndProposeRecovery` and validated against merchant
 * configuration before it is persisted. It never reaches this file. Money
 * moves only through `executeRecovery`, which consumes an
 * `ExecutionAuthorization` the deterministic policy engine issued against
 * a proposal fingerprint. There is no code path from a model's output to
 * a payment, and this orchestrator does not create one.
 *
 * WHAT AUTO-EXECUTES, HONESTLY
 *
 * Only failed-payment recovery, because it is the only opportunity type
 * whose action needs nothing from a buyer: the order, the basket and the
 * price already exist and the merchant is retrying a payment against
 * them. A cross-sell or an upsell cannot execute without a live basket to
 * attach to, so those are proposed and governed and then wait — for a
 * buyer, or for the merchant. Reporting them as "executed" would be the
 * more impressive outcome and a false one.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { AgentRunResultDTO, AgentRunStepDTO } from "@razorgrowth/contracts";
import { logger } from "../../observability/logger.js";
import { appendLedgerEvent } from "../audit/ledger.js";
import { getRevenueOpportunityReport } from "../growth/revenue-evidence-service.js";
import { classifyToolError, findTool, toolForOpportunityType } from "./tools.js";

/**
 * How many individual subjects one cycle will act on, across every
 * opportunity.
 *
 * A bound, not a preference. Each step reconciles payment state with the
 * provider and writes governance rows; an unbounded run against a large
 * failure backlog would hold a request open for minutes and make the
 * per-order recovery-attempt count race with itself. The remaining
 * opportunities are still reported as next actions, so nothing is hidden
 * — the agent simply says what it left.
 */
export const MAX_ACTIONS_PER_RUN = 12;

/**
 * How the agent consumes each kind of opportunity.
 *
 * WHY THIS TABLE EXISTS
 *
 * The cycle used to act on exactly one type, so eight of the engine's
 * detections were computed, ranked, displayed — and then waited for a
 * merchant to notice them and drive four endpoints by hand. The engine
 * was doing its job and nothing downstream consumed the result.
 *
 *   RECOVER      propose a recovery on a PAYMENT, then policy, then
 *                execute inside the merchant's own limits. The only path
 *                that needs no buyer, because the order and price exist.
 *   PROPOSE      propose a growth action on a PRODUCT and carry it into
 *                governance. It cannot execute without a live basket, so
 *                it stops at authorization and waits for one.
 *   SURFACE      a catalogue or positioning task. There is no proposal to
 *                make: a human has to edit something. The agent reports it
 *                as a next action and does not pretend otherwise.
 *
 * SURFACE entries deliberately produce no work items. Manufacturing a
 * proposal for "add attributes to nine products" would put a governance
 * row on a task governance has no opinion about.
 */
/**
 * WHERE THE ACTION LOGIC WENT.
 *
 * This file used to hold a `CONSUMPTION` map (opportunity type -> RECOVER
 * | PROPOSE | SURFACE), a refusal-code set, and a `runOne` that inlined
 * both branches of the pipeline. All three now live in `tools.ts` as a
 * registry, for one reason that matters: the merchant can invoke the same
 * actions directly, and an action implemented twice is an action whose
 * second copy nobody tests.
 *
 * What stays here is what is genuinely about a RUN rather than an action:
 * selecting work, bounding it, and recording what happened.
 *
 * The SURFACE class is gone as a concept. A type either maps to a tool or
 * it does not, and `toolForOpportunityType` is the single answer — derived
 * from the tools' own `handles`, so a type cannot be actionable in one
 * list and inert in another. Two lists that must agree eventually
 * disagree; this codebase has shipped that bug twice already.
 */

/** Identity, kept for the type constraint: it forces every call site to
 * supply a complete step rather than an object that merely resembles one. */
function step(partial: Omit<AgentRunStepDTO, "stages"> & { stages: AgentRunStepDTO["stages"] }): AgentRunStepDTO {
  return partial;
}

/** One work item: one subject, and the tool that acts on it. */
interface WorkUnit {
  opportunityId: string;
  type: string;
  title: string;
  whyDetected: string;
  subjectId: string;
  toolName: string;
}

/**
 * One opportunity, walked as far down the pipeline as policy allows.
 *
 * Never throws: a failure on one opportunity is a recorded outcome for
 * that opportunity, not an aborted run. An agent that stops working
 * because the second of five payments could not be reconciled is worse
 * than one that reports the refusal and continues.
 */
async function runOne(
  prisma: PrismaClient,
  merchantId: string,
  workflowId: string,
  unit: WorkUnit,
  unattended: boolean,
): Promise<AgentRunStepDTO> {
  const base = {
    opportunityId: unit.opportunityId,
    opportunityType: unit.type,
    title: unit.title,
    whyDetected: unit.whyDetected,
  };

  const tool = findTool(unit.toolName);
  if (!tool) {
    // Unreachable while the work list is built from the registry, and
    // stated rather than thrown so one bad mapping cannot end a run.
    return step({
      ...base,
      outcome: "FAILED",
      detail: `No agent tool named "${unit.toolName}" is registered.`,
      proposalId: null,
      policyOutcome: null,
      authorizationId: null,
      stages: ["DETECTED"],
    });
  }

  try {
    const result = await tool.run({ prisma, merchantId, workflowId, unattended }, unit.subjectId);
    return step({
      ...base,
      outcome: result.outcome,
      detail: result.detail,
      proposalId: result.proposalId ?? null,
      policyOutcome: result.policyOutcome ?? null,
      authorizationId: result.authorizationId ?? null,
      stages: (result.stages ?? ["DETECTED"]) as AgentRunStepDTO["stages"],
    });
  } catch (error) {
    const { outcome, detail } = classifyToolError(error, { tool: unit.toolName, merchantId, workflowId, subject: unit.subjectId });
    return step({ ...base, outcome, detail, proposalId: null, policyOutcome: null, authorizationId: null, stages: ["DETECTED"] });
  }
}

/**
 * `unattended` says whether a human is present for this run.
 *
 * It reaches the Policy Engine, which applies the merchant's daily
 * autonomous-action ceiling only when nobody is watching — the case that
 * limit exists for. It defaults to FALSE so that a caller which forgets it
 * gets the supervised behaviour: forgetting must never be the thing that
 * exempts a scheduled run from its own limit.
 */
export async function runAutonomousCycle(
  prisma: PrismaClient,
  merchantId: string,
  options: { unattended?: boolean } = {},
): Promise<AgentRunResultDTO> {
  const unattended = options.unattended ?? false;
  const workflowId = randomUUID();
  const startedAt = new Date();

  // ── OBSERVE / IDENTIFY / ANALYZE / PRIORITIZE ─────────────────────────
  // One call, because the engine already does all four over real rows and
  // returns them ranked. Re-deriving any of it here would be a second
  // opinion about the merchant's own data.
  const report = await getRevenueOpportunityReport(prisma, merchantId);

  /**
   * ONE OPPORTUNITY IS NOT ONE ACTION.
   *
   * The engine aggregates: a single FAILED_PAYMENT_RECOVERY card can
   * cover eighty payments, because that is the right way to show a
   * merchant the problem. It is the wrong unit to act on — an earlier
   * version of this run took `subjectIds[0]` and left seventy-nine
   * recoverable payments untouched while reporting the cycle complete.
   *
   * So the work list is one entry per PAYMENT, and the bound applies
   * there. Whatever the bound leaves is reported as deferred.
   */
  const workList: WorkUnit[] = report.opportunities
    .filter((o) => o.policy.outcome !== "BLOCKED")
    .flatMap((o) => {
      // A type with no registered tool is one the agent has no safe action
      // for — a catalogue gap it must not author, or a customer-keyed
      // finding no proposal shape exists for. It is reported to the
      // merchant by the engine and skipped here, rather than turned into a
      // governance row for a task governance has no opinion about.
      const toolName = toolForOpportunityType(o.type);
      if (!toolName) return [];
      return o.subjectIds.map((subjectId) => ({
        opportunityId: o.id,
        type: o.type,
        title: o.title,
        whyDetected: o.whyDetected,
        subjectId,
        toolName,
      }));
    });
  const actionable = workList;

  /**
   * ROUND-ROBIN, SO ONE CARD CANNOT STARVE THE REST.
   *
   * Taking the first N of a priority-ordered list looks right and is not.
   * The failed-payment card alone covers eighty payments and always sorts
   * first, so a flat slice spent the entire cycle inside it — and the
   * cross-sell, upsell and offer opportunities the engine had detected
   * were never once acted on, in any cycle, ever. The merchant would have
   * had to find those by hand, which is the exact thing this is for.
   *
   * Breadth first, then depth: one subject from each opportunity in
   * priority order, then a second from each, until the bound. Every
   * detected opportunity gets worked every cycle, and the highest-priority
   * one still gets the most attention.
   */
  const byOpportunity = new Map<string, WorkUnit[]>();
  for (const item of workList) {
    const bucket = byOpportunity.get(item.opportunityId);
    if (bucket) bucket.push(item);
    else byOpportunity.set(item.opportunityId, [item]);
  }
  const buckets = [...byOpportunity.values()];
  const selected: WorkUnit[] = [];
  for (let depth = 0; selected.length < MAX_ACTIONS_PER_RUN; depth += 1) {
    const before = selected.length;
    for (const bucket of buckets) {
      if (selected.length >= MAX_ACTIONS_PER_RUN) break;
      const item = bucket[depth];
      if (item) selected.push(item);
    }
    // Every bucket exhausted — nothing more to take at any depth.
    if (selected.length === before) break;
  }

  logger.info(
    { event: "merchant_agent.run_started", merchantId, workflowId, detected: report.opportunities.length, actionable: actionable.length },
    "Merchant Agent autonomous cycle started",
  );

  await appendLedgerEvent(prisma, {
    workflowId,
    merchantId,
    actorType: "MERCHANT_AGENT",
    actionType: "AGENT_RUN_STARTED",
    conciseReason: `Autonomous cycle started. ${report.opportunities.length} opportunit${report.opportunities.length === 1 ? "y" : "ies"} detected, covering ${actionable.length} directly actionable payment${actionable.length === 1 ? "" : "s"}.`,
  });

  const steps: AgentRunStepDTO[] = [];
  // Sequential on purpose: each step reconciles payment state with the
  // provider and reads the per-order recovery-attempt count the policy
  // engine also reads. Running them in parallel would race on it.
  for (const unit of selected) {
    steps.push(await runOne(prisma, merchantId, workflowId, unit, unattended));
  }

  const counts = {
    executed: steps.filter((s) => s.outcome === "EXECUTED").length,
    awaitingApproval: steps.filter((s) => s.outcome === "AWAITING_APPROVAL").length,
    blocked: steps.filter((s) => s.outcome === "BLOCKED").length,
    refused: steps.filter((s) => s.outcome === "REFUSED").length,
    failed: steps.filter((s) => s.outcome === "FAILED").length,
  };

  // MEASURE + AUDIT. The run's own summary is a ledger event like any
  // other, so "what did the agent do at 14:32" is answerable from the
  // same tamper-evident chain as everything else.
  await appendLedgerEvent(prisma, {
    workflowId,
    merchantId,
    actorType: "MERCHANT_AGENT",
    actionType: "AGENT_RUN_COMPLETED",
    status: counts.failed > 0 ? "FAILED" : "EXECUTED",
    conciseReason:
      `Autonomous cycle finished: ${counts.executed} executed, ${counts.awaitingApproval} awaiting approval, ` +
      `${counts.blocked} blocked by policy, ${counts.refused} refused by the agent, ${counts.failed} failed.`,
    metadata: { ...counts, detected: report.opportunities.length, considered: selected.length },
  });

  logger.info({ event: "merchant_agent.run_completed", merchantId, workflowId, ...counts }, "Merchant Agent autonomous cycle completed");

  return {
    workflowId,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    detectedCount: report.opportunities.length,
    actionableCount: actionable.length,
    consideredCount: selected.length,
    // Stated so the console can say "5 of 9 this cycle" rather than
    // implying the backlog is empty.
    deferredCount: Math.max(0, actionable.length - selected.length),
    counts,
    steps,
  };
}
