/**
 * What the Merchant Agent is doing, derived entirely from rows that
 * already exist.
 *
 * WHY THERE IS NO `AgentRun` TABLE
 *
 * Everything this returns is already recorded: the opportunity engine
 * computes detection from orders and payments on read, `GrowthActionProposal`
 * carries every proposal and its governance status, and the `AgentAction`
 * ledger carries every transition with a hash chain over it. A run table
 * would be a fourth copy of facts three places already hold, and the first
 * time it disagreed with the ledger the ledger would be right.
 *
 * So this is a read model. It creates no financial truth and persists
 * nothing.
 *
 * THE FIVE QUESTIONS
 *
 *   "How can I increase revenue?"   nextActions, ranked by the engine
 *   "What did you automatically do?" autonomousActions + executed
 *   "Why did you do it?"             every entry carries its own reason
 *   "What happened?"                 executed / verified / failures
 *   "What should happen next?"       objective + awaitingApproval
 *
 * Each is answered from data, and each answer says which rows it came
 * from, because an agent that cannot show its working is a chatbot.
 */
import type { PrismaClient } from "@prisma/client";
import type { AgentStatusDTO } from "@razorgrowth/contracts";
import { getRevenueOpportunityReport } from "../growth/revenue-evidence-service.js";
import { getGrowthSummary } from "../growth/summary-service.js";

/** How many entries each list carries. The console shows a briefing; the
 * full history is the Growth page and the ledger. */
const LIST_LIMIT = 5;

/**
 * Governance completed and execution is permitted.
 *
 * There is deliberately no `EXECUTED` proposal status to look for: a
 * proposal's lifecycle ends at `AUTHORIZED`, and whether the authorization
 * was then consumed is recorded on the order, the payment and the ledger —
 * not by mutating the proposal. Reporting `AUTHORIZED` as "executed" would
 * overclaim, so the console is told exactly what this is.
 */
const AUTHORIZED_STATUSES = ["AUTHORIZED"] as const;

/** Statuses that mean something stopped it — kept distinct from "failed",
 * because a policy refusal is the system working. */
const BLOCKED_STATUSES = ["REJECTED_VALIDATION", "POLICY_DENIED", "APPROVAL_REJECTED"] as const;

export async function getAgentStatus(prisma: PrismaClient, merchantId: string): Promise<AgentStatusDTO> {
  const [report, summary, lastRun, autonomous, executed, awaiting, failures] = await Promise.all([
    getRevenueOpportunityReport(prisma, merchantId),
    getGrowthSummary(prisma, merchantId),

    prisma.agentAction.findFirst({
      where: { merchantId, actorType: "MERCHANT_AGENT", actionType: "AGENT_RUN_COMPLETED" },
      orderBy: { createdAt: "desc" },
      select: { workflowId: true, conciseReason: true, status: true, createdAt: true },
    }),

    // What the agent decided to do on its own — its own ledger entries,
    // newest first. `actorType` scoping is what keeps a deterministic
    // readiness recalculation (written as SYSTEM) out of this list.
    prisma.agentAction.findMany({
      where: { merchantId, actorType: "MERCHANT_AGENT" },
      orderBy: { createdAt: "desc" },
      take: LIST_LIMIT,
      select: { id: true, actionType: true, conciseReason: true, status: true, workflowId: true, createdAt: true },
    }),

    prisma.growthActionProposal.findMany({
      where: { merchantId, status: { in: [...AUTHORIZED_STATUSES] } },
      orderBy: { createdAt: "desc" },
      take: LIST_LIMIT,
      select: { id: true, actionType: true, explanation: true, status: true, createdAt: true },
    }),

    prisma.growthActionProposal.findMany({
      where: { merchantId, status: "PENDING_APPROVAL" },
      orderBy: { createdAt: "desc" },
      take: LIST_LIMIT,
      select: { id: true, actionType: true, explanation: true, status: true, createdAt: true },
    }),

    prisma.growthActionProposal.findMany({
      where: { merchantId, status: { in: [...BLOCKED_STATUSES] } },
      orderBy: { createdAt: "desc" },
      take: LIST_LIMIT,
      select: { id: true, actionType: true, explanation: true, rejectionReason: true, status: true, createdAt: true },
    }),
  ]);

  const top = report.opportunities[0] ?? null;

  return {
    /**
     * The current objective is the top-ranked opportunity, stated as the
     * agent's own sentence about it. Not a slogan: if the engine finds
     * nothing, the objective says so rather than inventing work.
     */
    objective: top
      ? {
          opportunityId: top.id,
          headline: top.title,
          why: top.whyDetected,
          proposedAction: top.proposedAction,
          effort: top.effort,
          policyOutcome: top.policy.outcome,
        }
      : null,

    lastRun: lastRun
      ? {
          workflowId: lastRun.workflowId,
          summary: lastRun.conciseReason,
          status: lastRun.status,
          completedAt: lastRun.createdAt.toISOString(),
        }
      : null,

    detected: {
      count: report.totals.opportunityCount,
      blockedByPolicy: report.totals.blockedCount,
      // Opportunities whose action the agent can take without a buyer.
      // Reported separately so the console never implies it can execute
      // a cross-sell nobody is currently buying.
      directlyActionable: report.opportunities.filter(
        (o) => o.type === "FAILED_PAYMENT_RECOVERY" && o.policy.outcome !== "BLOCKED" && o.subjectIds.length > 0,
      ).length,
    },

    nextActions: report.opportunities.slice(0, LIST_LIMIT).map((o) => ({
      opportunityId: o.id,
      type: o.type,
      title: o.title,
      why: o.whyDetected,
      actionLabel: o.actionLabel,
      effort: o.effort,
      policyOutcome: o.policy.outcome,
    })),

    autonomousActions: autonomous.map((a) => ({
      id: a.id,
      actionType: a.actionType,
      reason: a.conciseReason,
      status: a.status,
      workflowId: a.workflowId,
      at: a.createdAt.toISOString(),
    })),

    executedActions: executed.map((p) => ({
      proposalId: p.id,
      actionType: p.actionType,
      explanation: p.explanation,
      status: p.status,
      at: p.createdAt.toISOString(),
    })),

    awaitingApproval: awaiting.map((p) => ({
      proposalId: p.id,
      actionType: p.actionType,
      explanation: p.explanation,
      status: p.status,
      at: p.createdAt.toISOString(),
    })),

    failures: failures.map((p) => ({
      proposalId: p.id,
      actionType: p.actionType,
      // The rejection reason is the honest one; the explanation is the
      // agent's prose about a proposal that did not survive.
      reason: p.rejectionReason ?? p.explanation,
      status: p.status,
      at: p.createdAt.toISOString(),
    })),

    /**
     * VERIFIED, and only verified. Both figures require a provider-
     * confirmed CAPTURED payment on an order carrying an authorized
     * proposal — see `summary-service.ts`. Nothing the agent merely
     * attempted appears here.
     */
    verified: {
      capturedValue: summary.observedCapturedValue,
      recoveredValue: summary.recoveredValue,
      recoveredOrders: summary.recoveredOrders,
    },

    generatedAt: new Date().toISOString(),
  };
}
