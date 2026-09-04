# TRACK01 PART 17 — final autonomous commerce evaluation

Continues [Part 0](TRACK01_PART0_FIXES.md) → [Part 16](TRACK01_PART16_OBSOLETE_CODE_REMOVAL.md).

> Problems hit along the way: [TRACK01_PROBLEMS_LOG.md](TRACK01_PROBLEMS_LOG.md).

An independent scoring of what was **actually driven and observed**, not what exists in the source. Where I had only read the code, I stopped and drove it first — which changed two scores and produced one fix.

---

## Scoring rule applied

A capability scores only if I personally drove it and read the result back out of the database or a network response. Four things on the scorecard had never been driven by me at all — merchant **upsell**, merchant **repeat purchase**, buyer **comparison**, buyer **negotiation** — so I tested those before writing a number. Two passed, one was a real limit, and one was a defect I fixed.

---

# MERCHANT GROWTH SCORE: 82/100

| Criterion | Wt | Score | Evidence actually observed |
|---|---:|---:|---|
| Real opportunity detection | 9 | **9** | 10 types from this merchant's own data. Counts cross-checked: *"36 payments are in an UNKNOWN state"* matched `payment.count({state:"UNKNOWN"})` exactly. |
| Autonomous action generation | 8 | **8** | Proposals with `reasonCodes: [MERCHANT_CONFIGURED_RELATIONSHIP, COMPLEMENTARY_PRODUCT, READINESS_SUPPORTED]`, mode `DETERMINISTIC_RELATIONSHIP`. |
| Automatic execution | 9 | **9** | Policy `ALLOW / WITHIN_AUTONOMOUS_LIMIT` → `ExecutionAuthorization` ACTIVE with financial bounds → proposal `EXECUTED`. No human in the loop. |
| **Upsell** | 6 | **3** | Was **0** before this part: not one UPSELL proposal existed in 237. Fixed (below) and proven by test; still not reachable from its own card, because those subjects have a dearer *variant* but no upsell *relationship*. |
| Cross-sell | 6 | **6** | Executed end to end, authorized, bounded. |
| Recovery | 10 | **10** | Full deliberate failure → `PROVIDER_ERROR` → eligibility → policy → authorization → **new** checkout → attempt #2 CAPTURED. 28 ledger events, one workflow. |
| **Repeat purchase** | 6 | **2** | Detected and ranked (*"2 repeat customers past 1.5× their own median gap"*) — but **no tool handles `REPEAT_PURCHASE`**, so the run skips it. Detection only. |
| Measurable outcomes | 10 | **9** | ₹5,58,486.00 captured across **114** agent-proposed orders, reconciled to the rupee; ₹1,17,576.00 recovered across 24. Correctly refuses an uplift claim: *"provenance, not attribution — there is no control group."* |
| Policy enforcement | 10 | **10** | Observed a real basket cross the ₹5,000 ceiling and flip `ALLOW → REQUIRE_APPROVAL` on its own. |
| Approval boundaries | 8 | **8** | Approved with a typed reason; `approverId` server-derived (`owner@meridianathletics.demo`), authorization issued, proposal → AUTHORIZED. |
| Explainability | 7 | **7** | Every step carries why it was detected and what happened — including *"This does NOT close the missing-offer gap that was detected."* |
| Auditability | 7 | **7** | Hash-chained `AgentAction`; the whole failure→recovery story is one workflow. |
| Backend integration | 4 | **4** | Real Postgres, real Razorpay adapter (`paymentProvider: RAZORPAY_TEST_MODE`). |

**Total: 82/100**

## What holds the merchant score down

**Action breadth is the weakness, not governance.** The governed spine — detect → propose → validate → policy → authorize → execute → verify → audit — scores near full marks on every line. What is thin is *how many kinds of action* the agent can actually take: of 11 detected opportunity types, **5 have a tool**, and in practice only cross-sell and recovery ever executed.

- **Repeat purchase / abandoned-checkout recovery**: detected, ranked, described with an action sentence — and skipped. The skip is deliberate and documented ("a customer-keyed finding no proposal shape exists for"), and the console does say *"1 the agent can act on with no buyer present"*. It is an honest limit, not a lie, but it is a limit.
- **Bundles**: zero proposals ever, same ranking cause as upsell.
- **Bounded offers**: the demo provider deliberately never invents a discount without real signal. Correct behaviour; it means the `ELIGIBLE_OFFER` card cannot be closed by this provider.

---

# AI BUYER SCORE: 90/100

| Criterion | Wt | Score | Evidence actually observed |
|---|---:|---:|---|
| Intent understanding | 5 | **5** | *"I need running shoes over 4500 and under 4520"* → normalized intent. |
| Structured requirements | 5 | **5** | `["category = Running Shoes", "budget ≥ ₹4500.00", "budget ≤ ₹4600.00", "must be purchasable now"]`. |
| Product discovery | 5 | **5** | Real catalogue search across merchants. |
| Catalog grounding | 7 | **7** | Prices, stock, size/colour/surface all from the merchant's own rows. Nothing invented. |
| Filtering | 5 | **5** | Both budget bounds merged across turns and enforced. |
| **Comparison** | 5 | **5** | The spec's own example: *"Show running shoes." → "Only under 3600." → "Compare 1 and 3."* compared **exactly** positions 1 and 3, 10 rows with `differs` flags and per-product fit (`meets: [Running Shoes, under ₹3,600]`). |
| Reasoning | 5 | **5** | *"Ranked #1: costs ₹4,500; ₹20 below your ₹4,520 maximum; is currently in stock."* |
| Recommendation | 5 | **4** | Grounded and explained, but ranking is essentially price-ascending — no relevance dimension. |
| Offer handling | 6 | **5** | 5% authorized offer **applied and recomputed** against the actual basket (₹4,500 − ₹225 = ₹4,275), with provenance. −1: an offer is only visible if its product lands in the top 5 by price. |
| **Negotiation** | 6 | **6** | Three distinct outcomes driven: `AUTO_APPLIED` (2% earned, ₹69.78), `PROPOSED_TO_MERCHANT` (10% — above the 5% auto-ceiling), `DECLINED` (50% — past the 15% maximum). Never silently clamped; each refusal names the boundary and offers what *is* available. |
| Spending policy | 7 | **7** | A restriction typed into the form declined a real purchase: `CATEGORY_NOT_ALLOWED, CATEGORY_RESTRICTED`, no order, no payment. |
| Authorization | 7 | **7** | Explicit "yes"; policy re-read and re-checked at execution. |
| Checkout | 5 | **5** | Cart → order → checkout session, stock reserved transactionally. |
| **Razorpay Test Mode** | 6 | **4** | Real orders from `api.razorpay.com`: `order_TXuhbBzjvkdTEL`, `order_TXxbI5XcO7Lhkr`, `order_TXyZI1oz2HbfaA`. −2: no payment was ever **completed** at Razorpay. |
| **Payment verification** | 7 | **5** | Signature verified over raw bytes; tampered body rejected 400 with no state change; correctly-signed wrong amount refused with `PAYMENT_FINANCIAL_INTEGRITY_ERROR`; three redeliveries → exactly one capture. −2: captures were delivered by **self-signed** webhooks, so the pipeline is proven and a Razorpay-confirmed payment is not. |
| Order creation | 5 | **5** | `PAID` only after verified capture; `ORDER_CONFIRMED` written against it. |
| Failure handling | 5 | **5** | `debit=UNKNOWN` (never "not debited"), retry blocked, inventory released — and attempt #1 **still** reads UNKNOWN after recovery succeeded. |
| Activity / audit | 5 | **5** | Nine stages end to end, every event matched to a real ledger row by id. |

**Total: 90/100**

## What holds the buyer score down

**The one real gap is provider-confirmed payment.** Everything up to Razorpay is genuine — real orders created by live API calls, the real hosted checkout script loading with a real session. I did not complete a payment because that means typing a card number into a payment field, which I don't do, test card or not. So the *verification pipeline* is proven exhaustively and *"Razorpay confirmed this payment"* is not a claim this evaluation can make.

Secondary: discovery ranks by price alone, and offers surface only for top-ranked products — I had to construct a narrow ₹4,500–₹4,520 band to make the offered product visible at all. A shopper would not do that.

---

# OVERALL TRACK 01 READINESS: 85/100

Not the average. It reflects that both agents genuinely complete the required chain, that they are joined (a merchant-authorized offer reached a buyer's basket and changed the price), and that the governance is real rather than decorative — against known limits in action breadth and payment confirmation.

### Both agents run the required pipeline — verified, not asserted

| Stage | Merchant Agent | AI Buyer |
|---|---|---|
| OBSERVE | 10 opportunities from own data | intent + catalogue search |
| STRUCTURED DECISION | proposal + reason codes | recommendation + comparison |
| VALIDATION | `validateGrowthProposal` | grounding against real rows |
| DETERMINISTIC POLICY | `ALLOW` / `REQUIRE_APPROVAL` | `AUTO_APPROVE` / `DECLINE` |
| AUTHORIZATION | `ExecutionAuthorization` + bounds | explicit buyer "yes", allowance reserved |
| EXECUTION | proposal EXECUTED | order + Razorpay order |
| VERIFICATION | terminal status recorded | signature-verified capture |
| AUDIT | hash-chained ledger | 15-event workflow, shown to the buyer |

### The loop actually closes between them

The strongest single piece of evidence in this project: a **5% offer the merchant's agent proposed and the merchant's policy engine authorized** was later surfaced to a shopper by the buyer agent, recomputed against that shopper's real basket, and charged — ₹4,500.00 → **₹4,275.00**, ending in a PAID order the merchant can see. Two autonomous agents, one governed money path.

### Does it feel AI-native rather than a dashboard with AI bolted on?

On the evidence, largely yes, and for a specific reason: **the agent's decisions are the primary objects, not a side panel.** The merchant console's unit is an opportunity with a stated cause and a stage rail; the buyer's is a conversation whose turns are governed actions. Value is classified (OBSERVED / ESTIMATED / OPPORTUNITY / VERIFIED) rather than blended, and the system refuses claims it cannot support — "8 of 10 opportunities cannot yet be given a rupee forecast", "provenance, not attribution".

Where it still reads as a dashboard: the Commerce section's four views are conventional operational tables with agent findings attached, rather than agent-first surfaces.

---

## Weaknesses, and what I did about them

### Fixed in this part

**W1 — the agent could not answer an upsell card with an upsell.** Verified against the database: **zero** UPSELL and zero BUNDLE proposals had ever been created, in 237. `deterministicGrowthProposal` picks one best candidate by `RELATIONSHIP_PRIORITY`, where COMPLEMENTARY outranks UPSELL_ALTERNATIVE, so an upsell only wins when no complementary candidate is currently purchasable — which depends on stock, not on the merchant's intent.

The autonomous run now narrows the proposal to the kind of action the card is about: an UPSELL opportunity asks for an upsell, a CROSS_SELL opportunity for a cross-sell. **Narrowing, never widening** — it can only ever be a subset of what the merchant already permits, and a test proves a merchant's disabled switch still wins.

`ELIGIBLE_OFFER` is deliberately excluded: the provider will not invent a discount without real signal, and forcing an offer-only proposal there would convert correct conservatism into a refusal.

### Not fixed, with reasons

**W2 — repeat purchase and abandoned-checkout recovery are detected but not executable.** Both need outbound messaging the product does not have. That is a feature, not a cleanup, and inventing a half version to score a point would be worse than the honest gap.

**W3 — no payment completed at Razorpay.** Requires entering card details. The webhook path — which is the authoritative one regardless — is exercised exhaustively.

**W4 — offers surface only for top-ranked products.** A real shopper would rarely see an authorized discount. Fixing it means changing how offers are attached to discovery results, which is a product decision rather than a defect.

**W5 — the integration suite depletes its own fixture.** Documented in Part 16; each `readyCheckout()` reserves stock nothing restores, so the suite degrades until unrelated assertions fail. The payments fixture is now drift-tolerant, but the underlying consumption remains.

---

## Final verification

| Gate | Result |
|---|---|
| Typecheck | clean, 4 packages |
| Lint | clean |
| Build | green, 4 packages |
| Unit tests | domain 36 files / 528, web 10 / 69, contracts 2 / 12 |
| Integration tests | API 51 files / **518** |
| Merchant Agent flow | Run a cycle → 2 executed, **0 failed** |
| AI Buyer flow | 5 grounded recommendations → priced → authorized → real Razorpay order |
| Payment flow | signature-verified capture → order PAID → 15 ledger events |

Two new tests pin W1 from both directions: a product the ranking would otherwise cross-sell yields an upsell when restricted, and a restriction cannot re-enable an action the merchant switched off.
