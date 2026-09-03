/**
 * The single place a buyer spending policy comes into existence.
 *
 * WHY THIS FILE EXISTS
 *
 * The first-contact default used to be a fixed list — "Electronics/Laptop",
 * "Books", "Accessories" — which no merchant in this system sells. The
 * result was that a shopper's very first purchase came back
 * CATEGORY_NOT_ALLOWED, on the merchant's own headline product, with a
 * message that reads like the shopper did something wrong.
 *
 * A default that blocks everything is not a safe default, it is a broken
 * one: nobody is protected by a rule that only ever fires on legitimate
 * purchases, and the real effect is that people turn the check off.
 *
 * That default was replaced here and repaired in the existing rows by
 * migrations 20260831060000 / 20260831070000 — but only on the purchase
 * path. `GET /buyer/policy` kept its own copy of the broken list and went
 * on creating fresh poisoned rows, which the already-applied migrations
 * could no longer reach. Two creation paths for one record is what let a
 * fixed bug keep shipping, so there is now exactly one.
 *
 * A fresh policy is seeded from the categories that actually exist to be
 * bought, across active merchants. Across, not just one: a buyer context
 * can shop anywhere, and seeding from whichever shop they happened to open
 * first would silently block every other shop they visit.
 *
 * That is still a real, enforced allow-list — a category added later is
 * not automatically permitted, and the shopper can narrow it whenever they
 * like. It just starts from something true.
 *
 * An EXISTING policy is never rewritten. A shopper who has narrowed their
 * own allow-list must not have it silently widened by visiting a shop.
 */
import { prisma } from "../../db/client.js";

/** Categories that exist to be bought right now, across active merchants. */
export async function purchasableCategories(): Promise<string[]> {
  const rows = await prisma.product.findMany({
    where: { status: "ACTIVE", merchant: { status: "ACTIVE" } },
    select: { category: true },
    distinct: ["category"],
    take: 100,
  });
  return rows.map((row) => row.category);
}

/**
 * Whether the shopper's policy permits buying from this category.
 *
 * `allowAllCategories` is a real column the shopper set deliberately —
 * never a magic word matched out of `allowedCategories`. A wildcard hidden
 * in user-supplied text is what an injection would aim for, and it makes a
 * deliberate "allow everything" indistinguishable from a typo.
 *
 * Lives here rather than in a route because two callers now need it: the
 * HTTP purchase path and the Buyer Agent conversation. A second copy would
 * be a second answer to "may this shopper buy this".
 */
export function categoryPermitted(
  policy: { allowAllCategories: boolean },
  category: string,
  allowedCategories: string[],
): boolean {
  if (policy.allowAllCategories) return true;
  return allowedCategories.includes(category);
}

/**
 * Returns this buyer context's policy, creating one seeded from real
 * categories on first contact. Never widens an existing policy.
 */
export async function resolveBuyerPolicy(buyerContext: string) {
  const existing = await prisma.buyerSpendingPolicy.findUnique({ where: { customerAccountId: buyerContext } });
  if (existing) return existing;

  return prisma.buyerSpendingPolicy.create({
    data: { customerAccountId: buyerContext, allowedCategories: await purchasableCategories() },
  });
}
