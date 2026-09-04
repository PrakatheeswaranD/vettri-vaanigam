/**
 * ACP idempotency-key handling (TECH_SPEC §2.1).
 *
 * The spec is explicit: a repeat with the same key must return the CACHED
 * response, not act twice. That is not a nicety for an agent-commerce
 * endpoint — a buyer agent retrying a timed-out checkout is the normal
 * case, and without this the retry creates a second order.
 *
 * Three outcomes, matching the spec's own error vocabulary:
 *
 * - no key            -> `400 idempotency_key_required`
 * - key seen, settled -> replay the stored response verbatim
 * - key seen, in-flight or reused with a DIFFERENT body
 *                     -> `409 idempotency_in_flight` / conflict
 *
 * The body fingerprint matters as much as the key. A client that reuses a
 * key for a different cart has made a mistake, and silently returning the
 * first cart's response would hide it. We compare a canonical hash so key
 * ordering in the JSON cannot change the verdict.
 */
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { canonicalStringify, type CanonicalValue } from "@razorgrowth/domain";
import { AppError } from "../../http/errors.js";

/** Marker stored while a request is still running, so a concurrent retry
 * can be told "in flight" rather than being allowed to run twice. */
const IN_FLIGHT = "__vettri_vaanigam_in_flight__";

/**
 * Canonical, so key ORDER cannot change the fingerprint.
 *
 * This used `JSON.stringify`, which preserves insertion order — so the
 * same cart sent with its keys in a different order produced a different
 * hash and was refused as a conflicting reuse of the key. Clients do not
 * guarantee key order, and neither do most JSON libraries.
 */
function fingerprintBody(body: unknown): string {
  return createHash("sha256").update(canonicalStringify((body ?? null) as CanonicalValue)).digest("hex");
}

/**
 * How long an in-flight marker is honoured before another attempt may
 * take over.
 *
 * Without this, a process that crashed mid-request left the key locked
 * forever: every retry saw IN_FLIGHT and returned 409, and the agent could
 * never complete that purchase or any retry of it. A lease turns a crash
 * into a delay instead of a permanent lockout.
 */
const IN_FLIGHT_LEASE_MS = 60_000;

export interface IdempotentOutcome<T> {
  replayed: boolean;
  response: T;
}

/**
 * Runs `work` at most once per (merchant, operation, key).
 *
 * The unique constraint is the authority on "first caller wins" — not the
 * preceding read — so two simultaneous retries cannot both execute.
 */
export async function withIdempotency<T>(
  prisma: PrismaClient,
  params: { merchantId: string; operation: string; key: string | undefined; body: unknown },
  work: () => Promise<T>,
): Promise<IdempotentOutcome<T>> {
  if (!params.key || params.key.trim().length === 0) {
    throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "An Idempotency-Key header is required on this endpoint.");
  }

  const fingerprint = fingerprintBody(params.body);
  const where = {
    merchantId_operation_idempotencyKey: {
      merchantId: params.merchantId,
      operation: params.operation,
      idempotencyKey: params.key,
    },
  };

  const existing = await prisma.idempotencyRecord.findUnique({ where });
  if (existing) {
    if (existing.requestFingerprint !== fingerprint) {
      throw new AppError(
        "IDEMPOTENCY_KEY_REUSED",
        "This Idempotency-Key was already used with a different request body.",
      );
    }
    // A deployment rename must not treat an older in-flight marker as a
    // finished response and bypass the existing request lease.
    if (existing.responseSnapshot !== IN_FLIGHT && existing.responseSnapshot !== "__vaanigam_in_flight__") {
      return { replayed: true, response: existing.responseSnapshot as T };
    }

    const age = Date.now() - existing.createdAt.getTime();
    if (age < IN_FLIGHT_LEASE_MS) {
      throw new AppError("IDEMPOTENCY_IN_FLIGHT", "A request with this Idempotency-Key is still being processed.");
    }

    // The lease expired: the previous attempt died without finishing.
    // Taking it over turns a crash into a delay rather than a permanent
    // lockout of that key.
    await prisma.idempotencyRecord.delete({ where }).catch(() => undefined);
  }

  try {
    await prisma.idempotencyRecord.create({
      data: {
        merchantId: params.merchantId,
        operation: params.operation,
        idempotencyKey: params.key,
        requestFingerprint: fingerprint,
        responseSnapshot: IN_FLIGHT,
      },
    });
  } catch {
    // Lost the race to a concurrent identical request. That one is doing
    // the work; this one must not repeat it.
    throw new AppError("IDEMPOTENCY_IN_FLIGHT", "A request with this Idempotency-Key is already being processed.");
  }

  try {
    const response = await work();
    await prisma.idempotencyRecord.update({
      where,
      data: { responseSnapshot: response as never },
    });
    return { replayed: false, response };
  } catch (err) {
    // A failed attempt must not poison the key. Releasing it lets the
    // agent retry the same request, which is the whole point of having a
    // key — whereas leaving an IN_FLIGHT marker would lock it out forever.
    await prisma.idempotencyRecord.delete({ where }).catch(() => undefined);
    throw err;
  }
}
