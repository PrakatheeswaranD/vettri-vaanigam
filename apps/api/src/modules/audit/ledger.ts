/**
 * Centralized Agent Action Ledger writer (PART 05 §51-§60, §65-§69).
 *
 * The ONE place any code in this repository appends a ledger event —
 * business services never call `prisma.agentAction.create` directly
 * (PART 05 §65). This is what makes the per-workflow sequence numbering
 * and hash chain (§57-§60) trustworthy: every write goes through the same
 * sequence-then-hash logic, so no call site can accidentally skip it or
 * get it slightly wrong.
 *
 * Hash chain: `eventHash = SHA256(canonical(event data) + previousEventHash)`,
 * scoped per `workflowId` (§59 — not one global chain). This is explicitly
 * application-level tamper EVIDENCE, not a blockchain (§63, §130): it lets
 * `verifyWorkflowLedger` detect that a row was altered or removed after
 * the fact, nothing more.
 */
import { createHash } from "node:crypto";
import type { AgentAction, AgentActorType, AgentActionStatus, Prisma, PolicyDecision, PrismaClient } from "@prisma/client";
import { canonicalStringify } from "@razorgrowth/domain";
import { logger } from "../../observability/logger.js";

export const LEDGER_HASH_VERSION = "1";

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export interface AppendLedgerEventParams {
  workflowId: string;
  merchantId: string;
  actorType: AgentActorType;
  actionType: string;
  conciseReason: string;
  status?: AgentActionStatus;
  policyDecision?: PolicyDecision | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  /** Compact structured facts only (proposal/policy/approval/authorization
   * IDs, reason codes, amounts) — never a full AI prompt/response or
   * chain-of-thought (§64, §102). */
  metadata?: Record<string, unknown> | null;
  agentRunId?: string | null;
  isSyntheticDemo?: boolean;
  executedAt?: Date | null;
}

function computeEventHash(input: {
  workflowId: string;
  sequence: number;
  merchantId: string;
  actorType: string;
  actionType: string;
  conciseReason: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  metadata: Record<string, unknown> | null;
  previousEventHash: string | null;
}): string {
  const canonical = canonicalStringify({
    v: LEDGER_HASH_VERSION,
    workflowId: input.workflowId,
    sequence: input.sequence,
    merchantId: input.merchantId,
    actorType: input.actorType,
    actionType: input.actionType,
    conciseReason: input.conciseReason,
    relatedEntityType: input.relatedEntityType,
    relatedEntityId: input.relatedEntityId,
    metadata: (input.metadata as never) ?? null,
    previousEventHash: input.previousEventHash,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Appends one event to a workflow's hash chain. MUST be called with an
 * already-open transaction client whenever the caller also mutates related
 * business state (proposal status, Approval/ExecutionAuthorization rows)
 * in the same request — PART 05 §67 requires those to commit atomically
 * together, never partially.
 *
 * Concurrency (§60, §69): sequence assignment is read-then-write, which is
 * safe under normal sequential use but can race if two requests append to
 * the SAME workflow concurrently. The unique `(workflowId, sequence)`
 * constraint makes a race fail loudly (a Prisma P2002 error) rather than
 * silently corrupting the chain; `withLedgerConcurrencyRetry` (below)
 * retries the whole enclosing transaction when that happens.
 */
export async function appendLedgerEvent(tx: PrismaLike, params: AppendLedgerEventParams): Promise<AgentAction> {
  const last = await tx.agentAction.findFirst({
    where: { workflowId: params.workflowId },
    orderBy: { sequence: "desc" },
  });
  const sequence = (last?.sequence ?? 0) + 1;
  const previousEventHash = last?.eventHash ?? null;
  const relatedEntityType = params.relatedEntityType ?? null;
  const relatedEntityId = params.relatedEntityId ?? null;
  const metadata = params.metadata ?? null;

  const eventHash = computeEventHash({
    workflowId: params.workflowId,
    sequence,
    merchantId: params.merchantId,
    actorType: params.actorType,
    actionType: params.actionType,
    conciseReason: params.conciseReason,
    relatedEntityType,
    relatedEntityId,
    metadata,
    previousEventHash,
  });

  return tx.agentAction.create({
    data: {
      workflowId: params.workflowId,
      merchantId: params.merchantId,
      actorType: params.actorType,
      actionType: params.actionType,
      status: params.status ?? "PROPOSED",
      conciseReason: params.conciseReason,
      policyDecision: params.policyDecision ?? null,
      relatedEntityType,
      relatedEntityId,
      metadata: (metadata as never) ?? undefined,
      agentRunId: params.agentRunId ?? null,
      sequence,
      previousEventHash,
      eventHash,
      ledgerHashVersion: LEDGER_HASH_VERSION,
      isSyntheticDemo: params.isSyntheticDemo ?? true,
      executedAt: params.executedAt ?? null,
    },
  });
}

const LEDGER_SEQUENCE_CONFLICT_CODE = "P2002";
const MAX_LEDGER_RETRY_ATTEMPTS = 5;

function isSequenceConflict(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === LEDGER_SEQUENCE_CONFLICT_CODE &&
    JSON.stringify((err as { meta?: unknown }).meta ?? {}).includes("workflowId")
  );
}

/**
 * Retries an entire `$transaction` callback if it fails specifically
 * because two concurrent requests raced to append the next sequence
 * number for the same workflow (PART 05 §60, §69, §96). Any other error
 * propagates immediately — this is not a generic retry-on-failure wrapper.
 */
export async function withLedgerConcurrencyRetry<T>(
  prisma: PrismaClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_LEDGER_RETRY_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(fn);
    } catch (err) {
      if (!isSequenceConflict(err)) throw err;
      lastError = err;
      logger.warn({ event: "ledger.sequence_conflict_retry", attempt }, "Ledger sequence conflict; retrying transaction");
    }
  }
  throw lastError;
}

export interface WorkflowVerificationResult {
  workflowId: string;
  valid: boolean;
  eventCount: number;
  brokenAtSequence: number | null;
}

/**
 * Recomputes the hash chain for a workflow from its stored rows and checks
 * sequence continuity, previous-hash linkage, and each event's own hash
 * (PART 05 §61). A `false` result means the persisted rows no longer
 * match what the chain recorded at write time — sequence gap, tampered
 * field, or a hash that doesn't recompute to what's stored.
 */
export async function verifyWorkflowLedger(prisma: PrismaClient, workflowId: string): Promise<WorkflowVerificationResult> {
  const events = await prisma.agentAction.findMany({
    where: { workflowId },
    orderBy: { sequence: "asc" },
  });

  if (events.length === 0) {
    return { workflowId, valid: true, eventCount: 0, brokenAtSequence: null };
  }

  let previousEventHash: string | null = null;
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    const expectedSequence = i + 1;
    if (event.sequence !== expectedSequence) {
      return { workflowId, valid: false, eventCount: events.length, brokenAtSequence: expectedSequence };
    }
    if (event.previousEventHash !== previousEventHash) {
      return { workflowId, valid: false, eventCount: events.length, brokenAtSequence: event.sequence };
    }
    const recomputed = computeEventHash({
      workflowId: event.workflowId,
      sequence: event.sequence,
      merchantId: event.merchantId,
      actorType: event.actorType,
      actionType: event.actionType,
      conciseReason: event.conciseReason,
      relatedEntityType: event.relatedEntityType,
      relatedEntityId: event.relatedEntityId,
      metadata: (event.metadata as Record<string, unknown> | null) ?? null,
      previousEventHash: event.previousEventHash,
    });
    if (recomputed !== event.eventHash) {
      return { workflowId, valid: false, eventCount: events.length, brokenAtSequence: event.sequence };
    }
    previousEventHash = event.eventHash;
  }

  return { workflowId, valid: true, eventCount: events.length, brokenAtSequence: null };
}
