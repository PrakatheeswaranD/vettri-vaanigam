import type { AgentActionStatus, AgentActorType, PrismaClient } from "@prisma/client";
import type { LedgerVerificationResultDTO, WorkflowFinancialOutcomeDTO, WorkflowTraceDTO } from "@razorgrowth/contracts";
import { listAgentActions } from "./repository.js";
import { toAgentActionDTO } from "./mapper.js";
import { verifyWorkflowLedger } from "./ledger.js";

export interface ListLedgerParams {
  merchantId: string;
  actorType?: AgentActorType;
  status?: AgentActionStatus;
  workflowId?: string;
  page: number;
  limit: number;
}

export async function listLedgerEntries(prisma: PrismaClient, params: ListLedgerParams) {
  const { items, total } = await listAgentActions(prisma, params);
  return {
    items: items.map(toAgentActionDTO),
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / params.limit)),
    },
  };
}

/** PART 05 §61-§63 — a restrained, read-only integrity check: recomputes
 * the hash chain from persisted rows and reports whether it still lines
 * up. Never mutates anything, never exposes raw hashes beyond what the
 * DTO already carries per-event. */
export async function verifyLedgerWorkflow(prisma: PrismaClient, workflowId: string): Promise<LedgerVerificationResultDTO> {
  const result = await verifyWorkflowLedger(prisma, workflowId);
  return { ...result, verifiedAt: new Date().toISOString() };
}

/** PART 08 §64, §72, §107-§109 — a jury/technical-panel-facing view over
 * the SAME `AgentAction` rows the ledger already persists, in `sequence`
 * order. Never a second audit log; the financial outcome is DERIVED from
 * which deterministic events are actually present, never asserted by any
 * caller. */
function deriveFinancialOutcome(actionTypes: string[]): WorkflowFinancialOutcomeDTO {
  const capturedIndex = actionTypes.indexOf("PAYMENT_CAPTURED");
  const failedIndex = actionTypes.indexOf("PAYMENT_FAILED");
  if (capturedIndex !== -1 && failedIndex !== -1 && failedIndex < capturedIndex) return "RECOVERED";
  if (capturedIndex !== -1) return "CAPTURED";
  if (failedIndex !== -1) return "FAILED";
  return "PENDING";
}

export async function getWorkflowTrace(prisma: PrismaClient, workflowId: string): Promise<WorkflowTraceDTO> {
  const events = await prisma.agentAction.findMany({ where: { workflowId }, orderBy: { sequence: "asc" } });
  const integrity = await verifyWorkflowLedger(prisma, workflowId);

  const steps = events.map((event) => ({
    sequence: event.sequence,
    actor: event.actorType,
    event: event.actionType,
    status: event.status,
    conciseReason: event.conciseReason,
    timestamp: (event.executedAt ?? event.createdAt).toISOString(),
    relatedEntityType: event.relatedEntityType,
    relatedEntityId: event.relatedEntityId,
  }));

  return {
    workflowId,
    startedAt: events[0] ? (events[0].executedAt ?? events[0].createdAt).toISOString() : null,
    completedAt: events.length > 0 ? (events[events.length - 1]!.executedAt ?? events[events.length - 1]!.createdAt).toISOString() : null,
    steps,
    financialOutcome: deriveFinancialOutcome(events.map((e) => e.actionType)),
    ledgerIntegrity: { valid: integrity.valid, eventCount: integrity.eventCount, brokenAtSequence: integrity.brokenAtSequence },
  };
}
