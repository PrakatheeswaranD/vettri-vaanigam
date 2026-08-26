/**
 * Server-side idempotency for commerce execution (PART 06 §8, §48-§51).
 *
 * A retried request with the SAME idempotency key and an unchanged
 * request fingerprint returns the persisted response snapshot without
 * re-executing anything; the same key with a materially DIFFERENT
 * request is a genuine conflict, never silently re-executed against new
 * terms.
 */
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { CommerceExecutionRequestDTO } from "@razorgrowth/contracts";
import { canonicalStringify } from "@razorgrowth/domain";

export const COMMERCE_CHECKOUT_OPERATION = "commerce.checkout";

export function computeIdempotencyFingerprint(request: CommerceExecutionRequestDTO): string {
  const canonical = canonicalStringify({
    authorizationId: request.authorizationId,
    productId: request.selection.productId,
    variantId: request.selection.variantId,
    quantity: request.selection.quantity,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function findIdempotencyRecord(prisma: PrismaClient, merchantId: string, operation: string, idempotencyKey: string) {
  return prisma.idempotencyRecord.findUnique({
    where: { merchantId_operation_idempotencyKey: { merchantId, operation, idempotencyKey } },
  });
}

export function createIdempotencyRecord(
  tx: Prisma.TransactionClient,
  data: { merchantId: string; operation: string; idempotencyKey: string; requestFingerprint: string; responseSnapshot: Prisma.InputJsonValue },
) {
  return tx.idempotencyRecord.create({ data });
}

const IDEMPOTENCY_CONFLICT_CODE = "P2002";

export function isIdempotencyUniqueConflict(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === IDEMPOTENCY_CONFLICT_CODE &&
    JSON.stringify((err as { meta?: unknown }).meta ?? {}).includes("idempotencyKey")
  );
}
