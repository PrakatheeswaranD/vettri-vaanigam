/**
 * Leaves inventory as the test file found it.
 *
 * WHY THIS IS NEEDED
 *
 * Creating a checkout reserves stock in the same transaction as the order —
 * correctly, because that is what stops an oversell. For a real sale the
 * reservation is consumed; for a test it is simply gone, and every run ate
 * a little more of the seeded catalogue.
 *
 * That is not theoretical. `payments.test.ts` alone reserves stock 29 times
 * per run. Over sixteen parts of development 44 of 630 inventory rows
 * reached zero, including the ₹399 socks that kept a cross-sell basket
 * under the merchant's ₹5,000 auto-approval ceiling. The basket became
 * ₹5,399, policy correctly answered REQUIRE_APPROVAL, and twenty-six
 * payment tests died on a null authorization — none of which had anything
 * to do with payments. The database had to be re-seeded to recover.
 *
 * WHY A SNAPSHOT AND NOT "GIVE BACK WHAT WAS RESERVED"
 *
 * The first version of this file incremented each tracked order's lines
 * back. That would have been wrong, and quietly: the application ALREADY
 * restocks on two paths of its own — `payment-transition.ts` releases an
 * AGENT_GATEWAY reservation on verified terminal failure (guarded by a
 * once-only `inventoryReleasedAt` claim), and `maintenance-service.ts`
 * restocks when it expires an unpaid checkout. Adding an increment on top
 * of either would have INVENTED stock, turning a shrinking fixture into a
 * growing one — a worse failure, because it looks like nothing is wrong.
 *
 * Recording the levels and putting them back cannot double-count, and does
 * not need this helper to stay in agreement with every restock rule the
 * application has or later grows.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * Top up rows that merely look low. Roughly one in nine non-Running-Shoes
 * variants is seeded at zero ON PURPOSE, as the out-of-stock evidence the
 * readiness score is derived from. A cleanup broad enough to "fix" stock
 * would erase a deliberate signal to repair an accidental one.
 *
 * It also leaves rows that did not exist at capture time alone. A test that
 * creates its own variant owns it; deleting or zeroing it here would be a
 * different change wearing this one's clothes.
 *
 * Safe because `vitest.config.ts` sets `fileParallelism: false` — one test
 * file touches this database at a time, so a restore cannot land on top of
 * another file's fixture.
 */
import type { PrismaClient } from "@prisma/client";

export function createInventoryTracker() {
  let snapshot: Map<string, number> | null = null;

  return {
    /**
     * Record current stock levels. Call at the END of `beforeAll`, after
     * the file's own fixtures exist — anything created afterwards is the
     * test's own and is left untouched.
     */
    async capture(prisma: PrismaClient): Promise<void> {
      const rows = await prisma.inventory.findMany({ select: { variantId: true, availableQuantity: true } });
      snapshot = new Map(rows.map((row) => [row.variantId, row.availableQuantity]));
    },

    /** Put the recorded levels back. Returns how many rows had moved. */
    async restore(prisma: PrismaClient): Promise<number> {
      if (!snapshot) return 0;
      const rows = await prisma.inventory.findMany({ select: { variantId: true, availableQuantity: true } });

      let repaired = 0;
      for (const row of rows) {
        const original = snapshot.get(row.variantId);
        if (original === undefined || original === row.availableQuantity) continue;
        await prisma.inventory.update({
          where: { variantId: row.variantId },
          data: { availableQuantity: original },
        });
        repaired += 1;
      }
      snapshot = null;
      return repaired;
    },
  };
}
