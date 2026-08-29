/**
 * Single shared Prisma client instance (PART 01 §62 — centralize database
 * access; do not instantiate `PrismaClient` ad hoc across the codebase).
 */
import { PrismaClient } from "@prisma/client";

/**
 * Interactive-transaction limits.
 *
 * Prisma's defaults are `maxWait: 2s` / `timeout: 5s`. Those are fine
 * against a database on localhost, but they break against a MANAGED
 * database reached over the network: commerce execution runs one atomic
 * transaction that creates a cart, an order, order items, a checkout
 * session and several hash-chained ledger events. Each of those is a
 * round trip, and at real network latency the transaction exceeded 5s
 * and Prisma tore it down mid-flight with
 * `P2028: Transaction not found` — observed against Supabase.
 *
 * The fix is deliberately to raise the ceiling rather than to split the
 * transaction. Atomicity here is not a performance detail: it is what
 * guarantees an order can never exist without its ledger events, and
 * that a partially-written checkout can never be reachable. Trading that
 * away to fit inside an arbitrary 5s default would weaken exactly the
 * financial-integrity property this system is built to hold.
 *
 * These are ceilings, not delays — a fast transaction still commits
 * immediately.
 */
export const prisma = new PrismaClient({
  transactionOptions: {
    maxWait: 15_000,
    timeout: 30_000,
  },
});
