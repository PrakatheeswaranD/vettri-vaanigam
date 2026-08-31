# Integration progress — 2026-08-30

This is a progress record, not a declaration of full compliance with `D:\55555555555555.md`.

## Verified in this continuation

- Customer purchase proposals persist server-priced baskets in DecisionRecord and emit ledger events.
- Saved buyer policy enforces categories, currency, autonomous ceilings, optional stated budget, and daily allowance including pending purchases.
- Authorization rechecks policy, expires after fifteen minutes, serializes the buyer allowance reservation, and prevents executing a proposal twice.
- Marketplace product variants and Buyer Agent recommendations open the same governed purchase modal.
- Cross-merchant checkout uses the existing transactional inventory/cart/order/checkout/payment chain.
- Payment evidence and verification routes check proposal ownership before accessing seller-side payments.
- UI no longer claims capture, margin validation, recovery tickets, or audit events without evidence.
- Buyer policy edits require OWNER; purchase authorization requires OWNER or APPROVER within the existing merchant-scoped demo identity model.
- Webhook handlers return their Fastify reply, preventing duplicate response/header writes observed during regression tests.

## Verification evidence

- `pnpm typecheck`: passed.
- Web production build: passed.
- Six mocked authorization guard tests: passed.
- One database-backed cross-merchant purchase test: passed (single order/payment on replay; stock decremented once; no fabricated capture).
- Payment suite: 28 passed.
- Recovery suite: 13 passed.
- All 27 migrations and demo seed applied successfully to a new isolated verification database.

## Local database note

The existing `.dbdata` directory crashes on startup with a PGlite WASM abort. A fresh in-memory instance and a fresh on-disk directory both work. The original data was not deleted or reset.

The verification server uses port 55432 and `.dbdata-verification-20260830`. `scripts/db-server.mjs` now accepts `PGLITE_DATA_DIR` to make this isolation explicit. Set both DATABASE_URL and DIRECT_URL to that local database for verification; the regular application environment has not been changed. Seeding required execution outside the sandbox because tsx encountered `uv_os_get_passwd` ENOMEM inside it.

## Remaining work (not complete)

- Distinct customer/platform-admin server identities and authorization boundaries: current role selection is still a demo experience on merchant sessions.
- Cross-merchant conversational intent search/ranking; marketplace discovery and purchase work, but the existing conversation service still searches one merchant.
- Provider checkout UI completion for the new customer flow; current modal creates the provider order and reads evidence but does not open Razorpay Checkout.
- Unified customer transaction/proposal history and durable recovery after closing the modal.
- Full platform-admin onboarding, readiness governance, aggregate payment/risk/audit integration.
- Final growth, buyer-insight, offer, demo, responsive/accessibility and specification-by-specification audit.
- Live Razorpay Test Mode verification and full-project regression/browser verification. Automated payment tests use the mock provider explicitly, not real Razorpay.

## Subsequent continuation: marketplace chat and enforced identities

The items above describe the earlier checkpoint. Subsequent changes now include:

- Customer conversational search uses published catalogs across up to five active merchants, derives vocabulary from those catalogs, and applies the existing deterministic candidate/grounding pipeline. Merchant chat remains merchant-scoped. Out-of-stock products are excluded from purchasable recommendations.
- Database-backed CUSTOMER and PLATFORM_ADMIN account roles, wrong-experience login rejection, customer API allowlisting, administrator route protection, role-aware frontend guards, and query-cache clearing at login.
- Separate demo credentials: customer@anumati.demo / CustomerDemo!2026; admin@anumati.demo / AdminDemo!2026. Provisioning uses `apps/api/scripts/provision-demo-identities.ts`, refuses production, and does not reset merchant data. Each seeded customer identity uses its own context tenant; generalized customer registration/multiple customers per tenant is not implemented.
- Customer purchase history and authoritative payment refresh replace merchant-console aliases for customer orders/payments/activity.
- Platform-wide overview, merchant onboarding, readiness assessment, merchant suspension/reactivation, payment exceptions, payment history, user-role visibility, and audit views. All administrator APIs require PLATFORM_ADMIN. Lists are bounded to 100 records; pagination and richer presentation remain future work.
- Customer Razorpay Test checkout reuses the existing provider script loader and verifies completion through the proposal-owned backend route. Mock provider orders never open Razorpay or claim a real payment.
- Migration `20260830012000_experience_identity_roles` applied to the isolated database (28 total migrations).

The default database at 127.0.0.1:5432 is unavailable. Migration failed there both inside and outside the sandbox; original database files remain untouched. The original API was restarted on port 4000 with its unchanged environment, but reports database unavailability. Permission was requested before switching that API to the isolated database on port 55432; no switch has been made yet.

Remaining validation includes browser flows against a working local API, live Razorpay Test Mode, complete specification audit, merchant growth/intent attribution polish, failure-demo integration in the new admin view, and the full regression suite. Typecheck and web production build passed after these changes.

## Connected Supabase and regression checkpoint

- The configured `razorgrowth-ai` Supabase project was reached with its saved pooler connection and all 30 Prisma migrations were deployed without seeding or resetting remote data.
- RLS is enabled for the newly introduced backend tables, including mandate nonces. The backend-owned tables intentionally expose no public client policies.
- The API retention sweep is now opt-in with `RETENTION_SWEEPER_ENABLED=false` by default, preventing a development restart from silently redacting connected data.
- The marketplace seed now resets seller dependency graphs in FK-safe order, so repeated integration runs do not fail after purchases create downstream rows.
- Category-aware marketplace discovery now selects up to five merchants after intent extraction; unrelated or identity-context merchants can no longer hide valid sellers based on alphabetical order.
- Workspace typecheck and web production build pass. A clean isolated-database regression now passes all 32 API test files and all 281 tests.

## Connected end-to-end verification

- Distinct CUSTOMER and PLATFORM_ADMIN demo identities were provisioned in the connected Supabase project without resetting merchant data. Remote provisioning is refused unless `ALLOW_REMOTE_DEMO_IDENTITIES=true` is explicitly set, and is always refused in production mode.
- The connected browser flow verifies separate administrator and customer logins with server-enforced roles.
- The Admin risk page now runs a platform-scoped one-click failure-first scenario. Its dedicated persisted record is explicitly synthetic, isolated in an identity context, states that no money moved, and does not relabel historical UNKNOWN evidence. The browser rendered DEBITED / NOT_CREDITED, automatic retry BLOCKED, and deterministic CRITICAL risk.
- The connected customer flow verified marketplace discovery, a saved-policy denial, a policy update, AUTO_APPROVE for an allowed ₹450 purchase, explicit authorization, durable order/checkout/payment creation, and creation of a real Razorpay Test Mode order. Razorpay Checkout opened successfully. The unpaid attempt remains honestly CREATED with debit and credit UNKNOWN; capture was not fabricated.
- Lint passes for every workspace package and root scripts. Typecheck, frontend production build, backend startup/readiness, all migrations, isolated seed, and the full regression pass. `.env` is git-ignored, the tracked secret scan found only documented placeholders/CI-local credentials, and no TODO/FIXME, placeholder `href="#"`, or empty click handlers were found in application source.
