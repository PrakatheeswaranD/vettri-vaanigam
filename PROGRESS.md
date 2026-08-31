# Anumati — current implementation status

Last verified: 2026-08-30

The full agentic commerce gateway and governance platform implementation is complete and verified.

## Delivered Capabilities

- **Protocol Adapters & Conformance**:
  - **ACP (Agentic Commerce Protocol)**: Spec-implemented 2026-04-17 checkout sessions with detached Ed25519 signatures, scoped delegated-payment tokens, and live charge capture.
  - **x402 Protocol v2**: Complete HTTP 402 challenge/response with price quotation, internal settlement reservation, nonce replay protection, and tamper-evident ledger audit.
  - **AP2 & SD-JWT**: Cart-mandate compatibility envelope normalization paired with an IETF SD-JWT selective disclosure parser utility.
  - **UAP & UCP**: Universal Agent Protocol and Universal Checkout Protocol adapters for unified basket intake.
- **Decision Engine & Policy Enforcement**:
  - Basket repricing from authoritative merchant catalog with multi-currency minor unit precision.
  - Negotiated bundle and upsell acceptance directly hooked into checkout execution lines and totals.
  - Crash recovery and stale lock timeouts for human step-up decisions stuck in `PROCESSING`.
- **Commerce & Inventory Lifecycle**:
  - Automated maintenance service sweeping expired/abandoned checkout sessions and restocking reserved inventory into available stock.
  - Multi-variant catalog management with atomic compilation, publishing, and rollback index safety.
- **Post-Purchase Operations**:
  - **Refunds**: Full and partial refunds on captured payments with strict state machine validation and inventory restock tracking.
  - **Returns**: Multi-item return request workflow (`REQUESTED` → `APPROVED` → `RECEIVED` → `COMPLETED`).
  - **Fulfillment**: Item-level carrier assignment, tracking number registration, and real-time transit state tracking.
  - **Disputes / Chargebacks**: Evidence tracking and status transitions (`OPEN`, `UNDER_REVIEW`, `WON`, `LOST`).
  - **Taxation**: Intra-state (CGST + SGST) and Inter-state (IGST) Indian GST calculation across basis point brackets.
- **Autonomous Growth & Attribution**:
  - Automatic campaign assignment binding on order placement (`CampaignOrderAttribution`).
  - Automatic campaign conversion recording and budget tracking on verified payment capture (`CampaignConversion`).
- **Distributed Architecture & Security**:
  - Pluggable `DistributedRateLimitStore` supporting cluster backends and in-memory bucket stores.
  - SHA-256 hash-chained tamper-evident agent action ledger.
- **Merchant Console & OpenAPI**:
  - Interactive web application with Product creation modals and Autonomous Campaign Management UI.
  - Comprehensive OpenAPI 3.1 schema covering all gateway, ACP, x402, UAP/UCP, and post-purchase endpoints.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
```

Full automated suites verify ACP signatures and isolation, delegated payment charges, x402 lifecycle, SD-JWT parsing, catalog compilation/rollback, post-purchase state machines, and end-to-end payment flows.
