# Evaluator readiness changes

The external gateway now authorizes the basket that will actually be executed. An accepted upsell is checked against the signed amount, expiry, final categories, current merchant ceiling and margin rules. A rail-specific or human-approved basket cannot silently inherit permission for a different offer. The decision stores the final total and line discounts.

Decision records and their first hash-chained audit event commit in one transaction. If that audit write fails, the decision rolls back and execution does not begin.

Payment initiation claims the existing payment row before the provider POST. Concurrent callers receive the known order or a retriable conflict. An ambiguous provider response leaves the attempt blocked against automatic creation. Recovery searches Razorpay orders by the exact receipt and accepts only one match with the authorized amount and currency. No matches remain unresolved; multiple matches require manual reconciliation. A receipt is not treated as a provider idempotency guarantee.

## Reproduce the checks

```sh
pnpm typecheck
pnpm lint
pnpm test:isolated
pnpm --filter @razorgrowth/web test
pnpm --filter @razorgrowth/domain test
pnpm build
```

The isolated command creates a fresh PGlite database, applies migrations, seeds it, runs API tests and stops the server. Data is retained in an ignored `.dbdata-tests-*` directory for diagnosis. Direct test execution requires a separate local `TEST_DATABASE_URL`; it refuses the application's database. This validates application behavior over the PostgreSQL wire protocol, not production PostgreSQL concurrency or load capacity.

New regressions cover an upsell exceeding a mandate, crossing a merchant ceiling, adding a blocked category, recording the final authorized total, leaving an unaccepted offer out of checkout, and rolling back on an audit failure. Payment tests check concurrent upstream creation and recovery after provider acceptance followed by a lost response.

## Remaining submission evidence

The saved provider order still had no payment on the latest read-back. Complete an application checkout with Razorpay Test Mode and show its captured payment, verified webhook or callback, reconciliation and linked ledger. Capture is not inferred from order creation or mock tests.

After completing checkout, run from `apps/api` with `PROOF_PROVIDER_ORDER_ID` set to that application's provider order:

```sh
node --env-file=../../.env --import ./scripts/node-runtime-compat.mjs --import tsx scripts/verify-captured-proof.ts
```

This is read-only provider verification. It writes `docs/evidence/razorpay-capture-proof.json` and fails unless exactly one captured payment exists. It does not independently prove application webhook delivery.

Production work still includes managed signing-key lifecycle, background reconciliation, load testing on PostgreSQL, and independent security review. No evaluator score is guaranteed by these changes.
