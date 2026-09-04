
# TRACK01 PART 18 — fixing the issues and completing the remaining suggestions

## The rule that produced everything below

Part 17 ended with a list of weaknesses I had found but not fixed, and a set of improvements I had recommended without making. This part works that list. The rule was the one that has held since Part 13: **a fix is not done because the code changed — it is done when something that failed before now passes, and I have watched both halves of that.**

Applied honestly it did three things I did not expect. The offer "discoverability" improvement turned out to be an arithmetic bug that lost merchants sales. The test-hygiene chore turned out to be the direct cause of a payment-suite failure I had already misdiagnosed once. And the new abandoned-checkout action shipped with an unbounded loop that only its own integration test caught.

## Product bugs

### P18-1 · A budget was being compared against a price nobody would be charged
`packages/domain/src/buyer-eligibility.ts` compares a candidate's `priceMinor` against the buyer's stated ceiling. Discovery fed it the **list** price, because merchant-authorized offers were resolved only for products that had already won ranking — one stage too late.

So a product whose governed discount brought it inside the buyer's budget was thrown out one stage earlier as over-budget. Both sides lost: the buyer never saw something they could afford, and the merchant lost the sale their own agent had authorized the discount to win. Ranking had the same defect, sorting on list price.

The arithmetic was also duplicated — `createPurchaseProposal` derived the discount inline, and nothing else could reach that derivation. It now lives in `packages/domain/src/buyer-offer.ts` as `offerDiscountMinor` / `effectivePriceMinor`, and discovery, ranking and checkout all use the one function. A second derivation is a second chance to disagree about a number the buyer is charged.

**Proved both ways.** A regression test builds a ₹3,600 product with a merchant-authorized 10% offer and asks for shoes under ₹3,500. With the fix, the product is recommended. With the fix reverted by one line, the same test returns a one-item list without it. A guard that does not fail without the fix guards nothing.

### P18-2 · A merchant's price commitment never expired
`findBuyerVisibleOffers` used to promise in its own docblock that "an authorization that lapsed is not an offer" and check nothing — a promise I withdrew in Part 15 rather than fake, because `GrowthActionProposal` had **no validity window at all**. The only time bound in reach was the `ExecutionAuthorization`'s ten minutes, which bounds executing one checkout and says nothing about how long a price stands.

Withdrawing the promise was right; leaving the gap was not. An offer authorized months ago was still quoted to a buyer as live.

`MerchantPolicy.offerValidityHours` now sits beside the three internal windows a merchant already sets (`proposalValidityMinutes`, `approvalValidityMinutes`, `authorizationValidityMinutes`), defaulting to seven days — and deliberately in hours, not minutes, because those three bound how long an *internal step* may sit and this one bounds something a *buyer* is shown and may act on. Every offer is stamped at creation, and the filter reads that stamp and nothing else.

**NULL is not expired.** The 39 committed offers in the database predate the column. A merchant agreed to those prices under rules that had no expiry, and revoking them because a column was added later would be the system changing its mind about a price on the merchant's behalf. Two tests hold that line: an aged offer stops being quoted, and a NULL one still stands.

### P18-3 · The agent could see abandoned checkouts and could not touch them
`ABANDONED_CHECKOUT_RECOVERY` has been detected since the opportunity engine was written — with a value, an evidence trail, and the action label "Re-issue a checkout link for the abandoned baskets". `toolForOpportunityType` mapped it to nothing, so the card appeared on the merchant's screen every cycle with an action nothing could perform. Pattern 5 again: capability shipped, consumption forgotten.

I had earlier called this "nearly free — point it at `executeRecovery`". **That was wrong, and reading the code is what showed it.** `evaluateRecoveryEligibility` refuses a payment in `CREATED` with `FAILURE_NOT_RETRYABLE` — "nothing has definitively failed yet" — and that refusal is correct: `executeRecovery` creates a *new* checkout, which is right for a payment that verifiably failed and dangerous for one that may still be live.

So this is a separate, smaller action. `reissue_abandoned_checkout` extends the **existing** session's expiry and returns it to `READY_FOR_PAYMENT`. No new order, no new payment, no change of amount, `movesMoney: false` — and that claim is true, not aspirational. It runs the same governed pipeline as every other action: proposal → policy → authorization → execution → verification → ledger, with the safety rules as a pure function in `packages/domain/src/checkout-reissue.ts` re-checked immediately before the write, because an authorization can sit for ten minutes and a buyer can finish paying inside ten minutes.

`executeRecovery` was also hardened to require `recoveryAction === "RETRY_SAME_CHECKOUT"`. Both actions are `actionType: RECOVERY` with the same three `source*` columns; its existing order-state checks would have refused a re-issue proposal, but for the wrong reason and only by luck.

### P18-4 · The new action could re-issue the same checkout for ever
Found by its own integration test, which expected a second re-issue to refuse and watched it succeed.

Extending `expiresAt` does not make `createdAt` any younger, so the staleness check that gates the first re-issue passes again on every subsequent cycle. An unattended agent would have re-opened the same basket indefinitely.

The guard is `windowStillOpen`: a checkout whose validity window has not yet passed already gives the buyer a live chance to complete, and extending a window nobody has run out of is interference rather than recovery. It is the same reasoning as the staleness rule, one level up.

This is worth naming because the defect was in the part I was most confident about. The refusals I designed carefully — captured payments, unknown states, released inventory — all worked first time. The one that got through was the interaction between two things I had each got right.

### P18-5 · Commerce led with figures that said nothing about the agent
The Commerce section opened with captured revenue, orders received, average paid order and customer count: four numbers any storefront dashboard shows, none of which answer whether an agent did anything. A merchant evaluating an AI-native commerce system had to go to a different section to find out.

It now leads with attributed revenue — this merchant's own agent, external buyer agents, and direct, on the same PAID-only whole-history basis as the strip below it. Verified against the live endpoint: **₹2,54,748 from this merchant's agent over 52 orders, ₹62,802 from external buyer agents over 18, ₹89,599 direct over 9 — 78% of ₹4,07,149 settled, and 52 + 18 + 9 = 79, exactly the `paidOrderCount` the strip below reports.**

Two decisions inside it are the point. The merchant's own agent and external buyer agents are **never summed into one "AI revenue" headline**: an order that arrived through the agent gateway was placed by somebody else's agent against this catalogue, and reporting it as this merchant's agent's work would be the console taking credit for a third party. And classification uses the explicit allowlist already in `operations-service.ts`, never a substring guess at "AI" or "AGENT" — `Order.source` is a free String, and the data proves why that matters: both `direct` and `DIRECT_BUYER` exist in it. Anything unrecognised counts as human, so a new agent source is under-reported until it is listed, which is the safe direction for a figure whose whole purpose is to claim credit for the agent.

## Test and fixture bugs

### P18-6 · The test suite was eating its own fixture
`payments.test.ts` reserves inventory 29 times per run and nothing ever gave it back. Over sixteen parts that reached 44 of 630 rows at zero — including the ₹399 socks that kept a cross-sell basket under the merchant's ₹5,000 auto-approval ceiling. The basket became ₹5,399, policy correctly answered `REQUIRE_APPROVAL`, and **twenty-six payment tests failed on a null authorization for reasons that had nothing to do with payments.** I had already misdiagnosed that once as my own regression before `git stash` proved otherwise.

**The first fix I wrote was wrong, and would have been worse than the bug.** It incremented each tracked order's lines back. The application already restocks on two paths of its own — `payment-transition.ts` releases an AGENT_GATEWAY reservation on verified terminal failure behind a once-only `inventoryReleasedAt` claim, and `maintenance-service.ts` restocks when it expires an unpaid checkout. Adding an increment on top of either would have **invented stock**, turning a shrinking fixture into a growing one. That is the more dangerous failure, because a catalogue quietly gaining inventory looks like nothing is wrong.

Recording the levels and putting them back cannot double-count, and does not require this helper to stay in agreement with every restock rule the application has or later grows. **Measured: 398,520 units before a run of `payments.test.ts` + `commerce.test.ts`, 398,520 after — zero drift across 42 tests and 29 checkouts.**

It deliberately does not top up rows that merely look low: roughly one in nine non-Running-Shoes variants is seeded at zero *on purpose*, as the out-of-stock evidence the readiness score is derived from. A cleanup broad enough to "fix" stock levels would erase a deliberate signal to repair an accidental one.

### P18-7 · My own new fixture broke two other suites
The regression test for P18-1 needs a cheap Black/UK9 running shoe — which is exactly the shape the buyer-agent and merchant-agent suites shop for. Left in the database it won recommendations in two other files and failed them on its own prices (`expected 324000 to be 360000`).

`buyer-agent.test.ts` gets away with permanent fixtures because they are ₹64,000 laptops named "00 …" that sit out of everyone's way. This one cannot, so it deletes itself. The obvious teardown — `deleteMany({ where: { product: { merchantId } } })` — **did not work**: Prisma compiles a nested relation filter into a subquery and the PGlite dev shim answers those with "unexpected message from server". Letting the database's own `onDelete: Cascade` rules do the work is both simpler and something the shim can execute.

## Environment friction

### P18-8 · The dev server points at hosted Supabase, where the new migration is not applied
Browser verification of P18-5 failed with a 500 on login until I found that `DATABASE_URL` in `.env` is the hosted Supabase pooler, not the local database — and neither `20260905000000_conversation_workflow` (pending since Part 12) nor this part's `20260906000000_offer_validity` has been applied there.

**Both migrations are applied to the local database only.** Applying anything to the hosted database is the user's call and has not been made. Verification ran against a dev stack started with `DATABASE_URL` and `DIRECT_URL` overridden to the local instance — Node's `--env-file` yields to real environment variables, which makes that a one-line override rather than an edit to the user's `.env`.

### P18-9 · The PGlite shim wedged again, and `netstat` said it was fine — for the fifth time
Mid-run, every query started returning "Can't reach database server" while port 5432 was still `LISTENING` under a live node process. Killing it and letting the supervisor restart it fixed it; the cluster survived this time.

`docker-compose.yml` now offers real Postgres on port 5433 as an alternative — a different port deliberately, so it can run alongside the shim and switching is an `.env` edit rather than a process hunt. **It is unverified: Docker is not installed on this machine, so the compose file is written against the documented images and flags and has never been started.** Saying it works would be exactly the kind of claim this project has spent eighteen parts refusing to make.

## My own mistakes

**Wrong Prisma field names, four more times.** `Product.title` (it is `name`), `ProductVariant.priceAmountMinor` (it is `priceMinor`), `OrderItem.productId` (it is `variantId`, and the product comes through the variant), and a `Payment.idempotencyKey` that does not exist at all. Also `prisma.user` for a model called `MerchantUser`, and `GrowthActionType.ELIGIBLE_OFFER` for a value that is actually `BOUNDED_OFFER`. Pattern 12, unchanged and undiminished: every one was caught in seconds by the typechecker or the query itself, and every one would have been avoided by one `grep` first.

**Three Tailwind classes that do not exist.** `bg-brand` (the ramp has no `DEFAULT`, only 50–900), `bg-surface-muted` (it is `subtle` or `sunken`), and — worse than a typo — `bg-accent`, which exists but whose palette comment reserves it for "a human needs to decide this. Nothing else." Attribution is a reading, not a decision waiting on someone. I read the config only because I had made the same class of mistake in Part 14.

**Shell heredocs ate two large files.** Both times the content was long and full of apostrophes; both times the failure was an unmatched quote at a line I had not written. Pattern 6 again. The lesson from Part 9 was "write a script file rather than inlining" — the sharper version is that beyond a certain size, prose-bearing content should not go through the shell at all.

**I called P18-3 "nearly free" before reading the function I proposed to reuse.** `executeRecovery` would have created a second chargeable checkout against an order whose first payment may still have been live. The estimate was wrong by the entire safety argument, and only reading `evaluateRecoveryEligibility` — which refuses that exact case, correctly — showed it.

**My first re-issue fixture described a state that does not occur.** It backdated `createdAt` and left `expiresAt` in the future, producing an "abandoned" checkout whose window was still open. The tests passed anyway, because the guard that would have caught it was in a domain package I had tested but not rebuilt — so the API was running the previous compiled copy. Two mistakes covering for each other, and the only reason it surfaced is that one assertion was specific enough to notice.

## What was NOT done, and why

**A Razorpay-confirmed capture.** Still not achieved, and still not achievable by me: it requires entering card details into Razorpay's own checkout, which I will not do. Every payment result verified in this part is against the mock gateway or a self-signed webhook, and the honesty caveat in `scripts/demo-golden-path.ts` stands unchanged. This is the one claim in the evaluation that remains unproven end to end against the real provider.

**Applying either pending migration to the hosted database.** See P18-8. That is the user's decision.
