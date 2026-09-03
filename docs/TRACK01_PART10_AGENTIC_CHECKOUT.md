# TRACK01 PART 10 — agentic cart and checkout

Continues [Part 0](TRACK01_PART0_FIXES.md) → [Part 9](TRACK01_PART9_AI_BUYER_CORE.md).

> Problems hit along the way: [TRACK01_PROBLEMS_LOG.md](TRACK01_PROBLEMS_LOG.md).
>
> Followed by [Part 11](TRACK01_PART11_PRODUCT_DISCOVERY.md), which taught the comparison which products the buyer actually named.

"Buy this." now runs the whole chain — select, price, validate the offer, check policy, propose, authorize, create a real payment order — without the buyer leaving the conversation.

---

## The bug that mattered most

**The offer was displayed and never applied.**

Part 9 surfaced merchant-authorized offers to the buyer: a real 5%, traced to an `AUTHORIZED` governance row. `createPurchaseProposal` then computed:

```ts
const amountMinor = variant.priceMinor * input.quantity;
```

No offer. On the demo catalogue that is **₹4,500 shown as "5% off" and quoted at ₹4,500** — worse than showing no offer at all, because the buyer has been told something untrue about their own money.

### Recomputed, never copied

The merchant's stored `discountMinor` was calculated against *their* assumed basket. Copying that absolute figure is correct only when the buyer's quantity happens to match. So:

- a **percentage** offer is recomputed against this actual basket, in integer minor units
- a **fixed-amount** offer is capped at the basket total, because a discount larger than the purchase is a refund nobody authorized
- `Math.round` matches the convention the negotiation service already uses, so two discount paths in one product cannot round in opposite directions

Live on the demo data: **₹4,500 − 5% = ₹225 off → ₹4,275.**

### The seam it flows through was already debugged

`OrderItem.lineDiscountMinor` exists because a *negotiated* discount once got silently stripped by a Zod schema, and every negotiated purchase failed as `FINANCIAL_INTEGRITY_ERROR`. Execution recomputes `(unitPrice × qty) − lineDiscount` and refuses if it disagrees with the stored total.

So the discount reaching the real Razorpay charge is **enforced by an integrity check, not hoped for** — and a test asserts that invariant directly.

## "Yes" was resolving against the wrong conversation

`findPendingProposal` looked up the buyer's most recent `PROPOSED` decision record. Decision records are scoped to the **buyer**, not the conversation.

A shopper with an unanswered quote in one thread could open a fresh conversation, say "yes" to something else, and **authorize the old purchase** — a real payment order against a basket they were not looking at.

Caught by a test asserting that "yes" on a fresh conversation authorizes nothing. It returned `CHECKOUT_READY`.

Fixed with `BuyerConversation.pendingProposalId`: the BUY turn records what it quoted, AUTHORIZE resolves only that, and it is cleared on authorization so **one yes buys one thing**. Ownership is still re-checked against the buyer, because a conversation id is not proof of whose basket it is.

## AUTHORIZE is the most dangerous classification in the product

It is the only turn that creates a payment order, so it is gated twice:

1. **It is not consulted unless a proposal is actually pending.** A buyer with nothing priced cannot authorize anything, whatever they type — "yes" falls through to SEARCH, which spends nothing.
2. **The vocabulary is answers to a question the agent just asked**, not general enthusiasm. `yes`, `go ahead`, `authorize it`, `confirm the purchase` qualify. `sounds good`, `nice`, `I like it` deliberately do not — those are things a shopper says while still browsing.

Six tests pin the negative cases, including that a pending proposal must not swallow every following message: "show cheaper ones" is still a refinement, "compare these" is still a comparison.

### Authorizing is not paying

`POST /authorize` creates an order and a payment in `CREATED` state with a provider order id. **It does not charge.** The charge requires the buyer to complete the provider's own checkout, which returns a signature the server verifies separately.

That distinction is carried all the way to the copy on screen: *"Still not charged. The payment order exists; completing payment is a separate step, and the result comes back from the provider rather than from this page."*

## One implementation of authorization

The whole decision — the serializing policy-row update, the re-checked category and currency and ceiling, the daily allowance including pending purchases, and the deliberate distinction between a rolled-back failure and a genuinely ambiguous one — lived inline in the route handler.

A conversation that ran its own version would be a **second implementation of money-moving authorization**, and the one nobody tests is the one that eventually double-charges. Extracted to [`authorizePurchaseProposal`](../apps/api/src/modules/buyer-policy/purchase-proposal-service.ts); both callers land there. Lint caught the six now-dead imports the extraction left behind.

## What the buyer sees

| | |
|---|---|
| product / variant / quantity | named, not just ids |
| unit price × quantity | the list subtotal |
| offer | percentage, amount, and **its provenance** — the merchant's own authorization, not "a deal we found" |
| total | the figure the provider is asked for |
| policy result | the policy's own words, verbatim; a decline is never softened |
| authorization state | `requiresAuthorization`, before anything is created |
| checkout state | payment state, provider order id, and `paid` |

Every figure is an **integer in minor units**, and `listTotalMinor − discountMinor === amountMinor` holds exactly. A test asserts the identity and that all four figures are integers, because a buyer can check this arithmetic on screen.

### `paid` has exactly one source

True only when the server has verified a provider-confirmed capture. Not "the buyer returned from the checkout page", not "the client said it worked". Nothing in the frontend may conclude a purchase completed — a component test asserts the UI says *"still not charged"* on a `CREATED` payment and never renders "Payment confirmed" until the state is `CAPTURED`.

## What was NOT removed

The spec asks to remove duplicate cart/checkout systems. **There were none.**

`Cart` and `CartItem` exist purely as internal execution artifacts written inside the commerce execution service — a server-side record of what was purchased. There is no cart API, no cart UI, no "add to cart" flow, and `/customer/cart` has redirected to the Buyer Agent since Part 1. Verified by tracing every importer of `cart-repository.ts` (two, both execution services) and grepping the web app for cart hooks and pages (none found).

Reported because claiming a removal that did not happen would be worse than reporting nothing.

## Verification

| Check | Result |
|---|---|
| `pnpm typecheck` | clean, 4 packages |
| `pnpm lint` | clean |
| `pnpm build` | green |
| API tests | **48 files, 474 tests** (7 new for checkout) |
| Domain tests | **36 files, 521 tests** (19 new for AUTHORIZE) |
| Web tests | **10 files, 68 tests** (5 new for the breakdown and checkout card) |
| Contracts tests | 1 file, 6 tests |
| Byte sweep | every modified file confirmed clean UTF-8 |

### The offer test cannot pass vacuously

It asserts the fixture product **actually carries an authorized offer** before asserting anything about the discount, and that the expected discount is greater than zero. A fixture without an offer would otherwise satisfy every arithmetic assertion while proving the opposite of what it claims.

## Not verified in a browser

Same as every part since 1: signing in needs a password, which I do not enter. The purchase breakdown and checkout card are asserted at the DOM level with `@testing-library/react` — including that the total, the discount and the list price all appear and agree — but nothing here is a screenshot, and CSS could still hide what the DOM contains.
