/**
 * The merchant-facing view of the Adaptive Agent Trust Score.
 *
 * WHY THIS IS RECOMPUTED AND NOT STORED
 *
 * The score IS the decision history. A stored running total is a second
 * copy of the same fact, and a second copy can only ever be a way for it
 * to disagree with the first — a backfill, a deleted record, or a changed
 * weight would leave a merchant looking at a number no query could
 * reproduce. Recomputing means the console always shows something a human
 * can re-derive from the ledger in front of them.
 *
 * The per-decision snapshot on `DecisionRecord` is the deliberate
 * exception, and for the opposite reason: that field answers "what did the
 * gate know at the time", which is a historical fact that must NOT change
 * when the agent's later behaviour does.
 *
 * WHY IT IS BATCHED
 *
 * The obvious implementation runs two counts per agent. On a hundred-agent
 * list that is two hundred round trips to render one table. Two grouped
 * queries answer it for every agent at once.
 */
import type { PrismaClient } from "@prisma/client";
import {
  computeAgentTrust,
  effectiveCeilingMinor,
  ATTACK_REASON_CODES,
  POLICY_DECLINE_REASON_CODES,
  TRUST_PENALTY_WINDOW_DAYS,
  type TrustBand,
} from "@razorgrowth/domain";

export interface AgentTrustSummary {
  score: number;
  band: TrustBand;
  explanation: string;
  ceilingMinor: number;
  earned: boolean;
  collapsed: boolean;
  declines: number;
  flaggedAttacks: number;
}

interface AgentRow {
  id: string;
  settledOrderCount: number;
}

/** The ceilings the merchant configured, or the conservative defaults. */
async function ceilingsFor(prisma: PrismaClient, merchantId: string) {
  const policy = await prisma.agentGatewayPolicy.findUnique({
    where: { merchantId },
    select: { unknownAgentCeilingMinor: true, knownAgentCeilingMinor: true },
  });
  return {
    unknownAgentCeilingMinor: policy?.unknownAgentCeilingMinor ?? 1_000_000,
    knownAgentCeilingMinor: policy?.knownAgentCeilingMinor ?? 5_000_000,
  };
}

export async function summariseAgentTrust(
  prisma: PrismaClient,
  merchantId: string,
  agents: AgentRow[],
): Promise<Map<string, AgentTrustSummary>> {
  const result = new Map<string, AgentTrustSummary>();
  if (agents.length === 0) return result;

  const agentIds = agents.map((a) => a.id);
  const since = new Date(Date.now() - TRUST_PENALTY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const ceilings = await ceilingsFor(prisma, merchantId);

  const [declineGroups, attackGroups] = await Promise.all([
    prisma.decisionRecord.groupBy({
      by: ["agentIdentityId"],
      where: {
        agentIdentityId: { in: agentIds },
        createdAt: { gte: since },
        reasonCode: { in: [...POLICY_DECLINE_REASON_CODES] },
      },
      _count: { _all: true },
    }),
    prisma.decisionRecord.groupBy({
      by: ["agentIdentityId"],
      where: {
        agentIdentityId: { in: agentIds },
        createdAt: { gte: since },
        reasonCode: { in: [...ATTACK_REASON_CODES] },
      },
      _count: { _all: true },
    }),
  ]);

  const declinesById = new Map(declineGroups.map((g) => [g.agentIdentityId, g._count._all]));
  const attacksById = new Map(attackGroups.map((g) => [g.agentIdentityId, g._count._all]));

  for (const agent of agents) {
    const declines = declinesById.get(agent.id) ?? 0;
    const flaggedAttacks = attacksById.get(agent.id) ?? 0;

    const trust = computeAgentTrust({ settledOrders: agent.settledOrderCount, declines, flaggedAttacks });
    const ceiling = effectiveCeilingMinor({ trustScore: trust.score, ...ceilings });

    result.set(agent.id, {
      score: trust.score,
      band: trust.band,
      explanation: trust.explanation,
      ceilingMinor: ceiling.ceilingMinor,
      earned: ceiling.earned,
      collapsed: ceiling.collapsed,
      declines,
      flaggedAttacks,
    });
  }

  return result;
}
