import type { AgentAction } from "@prisma/client";
import type { AgentActionDTO } from "@razorgrowth/contracts";

export function toAgentActionDTO(action: AgentAction): AgentActionDTO {
  return {
    id: action.id,
    workflowId: action.workflowId,
    agentRunId: action.agentRunId,
    merchantId: action.merchantId,
    actorType: action.actorType,
    actionType: action.actionType,
    status: action.status,
    conciseReason: action.conciseReason,
    policyDecision: action.policyDecision,
    relatedEntityType: action.relatedEntityType,
    relatedEntityId: action.relatedEntityId,
    metadata: (action.metadata as Record<string, unknown> | null) ?? null,
    sequence: action.sequence,
    previousEventHash: action.previousEventHash,
    eventHash: action.eventHash,
    ledgerHashVersion: action.ledgerHashVersion,
    isSyntheticDemo: action.isSyntheticDemo,
    createdAt: action.createdAt.toISOString(),
    executedAt: action.executedAt ? action.executedAt.toISOString() : null,
  };
}
