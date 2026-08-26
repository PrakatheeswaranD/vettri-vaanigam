/**
 * Authorization foundation (PART 00 §36, §55; PART 01 §55).
 *
 * PART 01 does not implement authentication. Instead of trusting a
 * merchant ID sent by the client (which would let any caller read/act on
 * any merchant's data), every route resolves the single controlled demo
 * merchant server-side, by a fixed slug known only to this module.
 * Production multi-tenant authentication is explicitly out of scope per
 * PART 00 §36/§47.
 */
import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../http/errors.js";

export const DEMO_MERCHANT_SLUG = "meridian-athletics";

/**
 * Cached with a short TTL rather than forever. A permanent cache goes
 * stale the moment `pnpm db:seed`/`db:reset` recreates the merchant row
 * under a new id while this process is still running — every request
 * would then 500 until the dev server was manually restarted. A bounded
 * TTL means the process self-heals within seconds of a reseed instead,
 * at the cost of one extra indexed lookup by unique slug every 30s — a
 * cost worth paying for a demo/dev environment that gets reseeded
 * repeatedly.
 */
const CACHE_TTL_MS = 30_000;

let cachedMerchantId: string | null = null;
let cachedAt = 0;

export async function getDemoMerchantId(prisma: PrismaClient): Promise<string> {
  const isFresh = cachedMerchantId !== null && Date.now() - cachedAt < CACHE_TTL_MS;
  if (isFresh) return cachedMerchantId!;

  const merchant = await prisma.merchant.findUnique({
    where: { slug: DEMO_MERCHANT_SLUG },
    select: { id: true },
  });

  if (!merchant) {
    // A stale cached id is better than none if this lookup itself fails
    // transiently (e.g. mid-reseed, the row briefly doesn't exist) —
    // fall back to it rather than breaking every route for the TTL
    // window on a blip.
    if (cachedMerchantId) return cachedMerchantId;
    throw new AppError(
      "INTERNAL_ERROR",
      "Demo merchant is not seeded. Run `pnpm db:seed` before starting the API.",
    );
  }

  cachedMerchantId = merchant.id;
  cachedAt = Date.now();
  return cachedMerchantId;
}
