# TRACK01 Part 1 — one product, eleven links

Part 0 established the [baseline](TRACK01_BASELINE.md) and [fixed](TRACK01_PART0_FIXES.md) what was broken. This part restructures the console around the two Track 01 capabilities — **merchant revenue growth through AI**, and **end-to-end AI buyer commerce** — so it reads as one product rather than several applications sharing a shell.

> Problems hit along the way: [TRACK01_PROBLEMS_LOG.md](TRACK01_PROBLEMS_LOG.md).

## The shape of the change

| | Before | After |
|---|---|---|
| Merchant destinations | 19, in two groups | **5** |
| Customer destinations | 7 | **6** |
| Route files | 28 | 24 |
| Nav groups | 2 (merchant) | 1 per role |

Nothing here is a rewrite of a working screen. Every page that moved kept its component; the pages that were removed duplicated one that stayed, and their non-duplicated half was moved into it first.

## Merchant console — 5

| | Route | What it holds | Where it came from |
|---|---|---|---|
| 🚀 | `/merchant/overview` | Revenue scoreboard, readiness, recent agent activity | unchanged |
| 🤖 | `/merchant/agent` | **Proposals & Offers** · Readiness · Connect | Offers & Actions + AI Readiness + Protocols |
| 📈 | `/merchant/growth` | Ranked revenue opportunities, scores, catalogue findings | unchanged |
| 🛍 | `/merchant/commerce` | **Products** · Orders · Customers · Payments · Post-Purchase | five separate destinations across two nav groups |
| 🛡 | `/merchant/governance` | **Decisions** · Approvals · Policies · Trace · Ledger · Sandbox | six separate destinations |

## Customer console — 6

| | Route | Where it came from |
|---|---|---|
| 🤖 | `/customer/buyer-agent` | Buyer Agent + the spending envelope from Home + the proposals from Cart |
| 🔎 | `/customer/discover` | unchanged; product detail is now `/customer/discover/:productId` |
| 📦 | `/customer/orders` | unchanged |
| 💳 | `/customer/payments` | unchanged |
| 🧠 | `/customer/activity` | unchanged |
| 🛡 | `/customer/policy` | unchanged |

## What was consolidated, and why

**Commerce.** Products, Orders, Customers, Payments and Post-Purchase were five entries spread across two unrelated nav groups. A merchant chasing one order's story — what was bought, who bought it, whether the money arrived, whether it came back — walked the sidebar four times. One subject, one place.

**Governance.** A policy is the rule, a decision is that rule applied, an approval is the rule deferring to a human, and the trace and ledger are how you prove any of it happened. Those were in different halves of the sidebar. They are one subject read at increasing depth.

**Merchant Agent.** "AI Readiness" and "Protocols" read as unrelated diagnostics when they are the two preconditions for this agent working at all: whether the catalogue is good enough for it to have something to say, and whether an outside agent can reach it.

**Buyer Agent.** "Cart & Offers" was the agent's own un-authorized proposals given its own destination, so authorizing a purchase happened on a different screen from asking for it. It is now the foot of the conversation that produced it.

## What was merged and removed

Each was traced for dependencies first; all four were unreferenced at the point of deletion.

| Removed | Why | What survived |
|---|---|---|
| `ActivityPage` (51) | Half was the gateway decision feed already shown under Decisions — the console saying the same thing twice under two names. | Its `ActivityFeed` now opens the Ledger tab, where the deeper detail already lived. |
| `MerchantAnalyticsPage` (~20) | Rendered five numbers already derived from Commerce's own data. A page whose entire content summarises its siblings is a summary. | The summary strip above the Commerce tabs. |
| `CustomerHomePage` (206) | A hero, a "recent orders" list repeating the Orders page, and a card linking to Discover — three restatements of the navigation on the first screen after sign-in. | The spending envelope, now beside the chat box as `SpendingEnvelopeStrip`. |
| `DemoTourPage` (651) | A scripted walkthrough of screens the console already shows. A demo artifact, not a product capability. | Nothing — the pages it toured are the product. |

`RedTeamPanel` moved off the decision log and into Sandbox: "here is real traffic" and "here is me attacking myself" were sharing a screen.

## Verification

| Check | Result |
|---|---|
| `pnpm typecheck` | clean, 4 packages |
| `pnpm lint` | clean |
| `pnpm build` | all 4 packages build; web bundle in 24.8s |
| `apps/web` tests | **8 files pass** (was 7) |
| `apps/api` tests | 38 files pass, unchanged |

### The new test earns its place

[`navigation.test.tsx`](apps/web/src/navigation.test.tsx) exists because the failure mode of a restructure this size is not a crash. It is a sidebar link, a tab, or a "View all →" that quietly lands on Not Found — which typechecks perfectly, because a route path is just a string.

So it scans **every `to=` in the source** and requires each to resolve against the route table, rather than checking a hand-written list that would have been updated by the same edit that broke one. It also pins the five and six destination names, and cross-checks its route table against `App.tsx` in both directions so the two cannot drift.

It immediately found **four broken links**, two of which predated this restructure:

- `ActivityFeed` and `LatestWorkflowStrip` both linked to `/trust-trace`, a top-level route that stopped existing before Part 0.
- `TrustTracePage` linked to `/break-the-agent`, likewise.
- `CatalogPage` still linked to `/merchant/catalog/:id` through a template literal, which the earlier string-replace sweep did not match.

It also runs in **3.8 seconds**. The first version used `import.meta.glob` to pull every module through Vite's transform pipeline and took nearly sixteen minutes; a test nobody will wait for is a test that gets deleted.

## Old links still work

Every previous path redirects rather than 404s — they were shipped in demo scripts and screenshots. `demo-golden-path.ts`'s Trust Trace deep link was repointed at the real route.

## Not verified in a browser

The authenticated walkthrough could not be completed this session: the browser profile was reset and its session token is gone, and signing in would mean entering a password, which I do not do. The public route, the unauthenticated redirect to `/login`, the API boot and the build are all confirmed clean; the console errors observed were the API starting up, not the app.

Worth clicking once: **Commerce → each tab**, **Governance → each tab**, and the **Buyer Agent** screen, where the envelope strip and the proposals section are new compositions rather than moved pages.
