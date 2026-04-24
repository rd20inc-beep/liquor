# Phase 5 — Integrations & Customer-Facing Surfaces

**Duration:** 8 weeks (weeks 23–30)
**Prereq:** Phases 1–4 in GA. Minimum 6 months of clean operational data. Core system stable.
**Goal:** Open the platform to the outside world. Connect to payment rails (UPI), messaging (WhatsApp inbound + outbound), accounting (Tally/Zoho), tax compliance (e-invoice, e-way bill), and give customers a self-service surface so they stop depending on phone calls and visits for statements and reorders. Each integration is isolated behind an adapter so vendor swaps don't cost architecture.

**Definition of Done (phase):**
- Customers can pay invoices via UPI link; collection auto-reconciles against AR ledger within minutes of settlement.
- WhatsApp Business conversations are two-way: customers can request statements, confirm orders, pay via UPI link, all handled by bot with agent handoff fallback.
- Every posted invoice above statutory threshold generates a valid e-invoice (IRN + QR) and, where applicable, an e-way bill.
- Tally/Zoho gets invoices, payments, credit notes, and returns daily via a one-way sync with full reconciliation report.
- Customers have a minimal self-service web portal — login with phone OTP, view statement, pay outstanding, place order against preset catalog.
- Every integration has: idempotent replay, dead-letter queue, reconciliation view, and a kill switch.

**Team assumption:** 1 backend, 0.5 integration specialist, 0.5 mobile, 1 frontend (portal + admin), 0.5 QA, 0.5 PM.

---

## Epic breakdown

| # | Epic | Story points |
|---|---|---|
| E44 | Integration platform (adapters, DLQ, recon) | 21 |
| E45 | UPI collection & auto-reconcile | 21 |
| E46 | WhatsApp Business (outbound templates) | 13 |
| E47 | WhatsApp Business (inbound + bot + handoff) | 21 |
| E48 | e-Invoice (IRN + QR) compliance | 21 |
| E49 | e-Way bill compliance | 13 |
| E50 | Tally / Zoho Books sync | 21 |
| E51 | Customer self-service portal | 21 |
| E52 | Voice / SMS ordering (lightweight) | 13 |
| E53 | Partner/supplier portal lite | 8 |
| E54 | Data exports, BI, webhooks | 13 |
| E55 | Hardening, audits, rollout | 13 |
| **Total** | | **199** |

---

## E44 — Integration platform

### LDS-800 — Adapter pattern + base integration service
**Type:** feature · **Points:** 5
**AC:**
- Abstract adapter interface: `send(event, context) → ack/fail`, `receive(webhook_payload)`, `reconcile(range)`.
- Adapters isolated in `/integrations/<name>` with owned config, credentials (via secrets vault), and observability.
- Core platform knows nothing about vendor specifics.

### LDS-801 — Event bus + outbound pipeline
**Type:** feature · **Points:** 5
**AC:**
- Outbound events published to Kafka/NATS topic per domain (payment.created, invoice.posted, return.approved).
- Each adapter subscribes to relevant topics; processes with idempotency key.
- Consumer lag dashboarded.

### LDS-802 — Dead-letter queue + replay
**Type:** feature · **Points:** 3
**AC:**
- Failed deliveries after retry budget exhausted land in DLQ.
- Admin console: inspect, edit payload (with audit), replay.
- Retention policy: 30 days in hot DLQ, archive to cold storage.

### LDS-803 — Reconciliation reports per integration
**Type:** feature · **Points:** 5
**AC:**
- Daily auto-run: compare what we sent vs what vendor accepted vs what we have internally.
- Outputs: matched / vendor-only / ours-only / mismatched, with drill-down.
- Owner review before books close.

### LDS-804 — Webhook ingress service
**Type:** feature · **Points:** 3
**AC:**
- Unified `/webhooks/{vendor}` endpoint.
- Signature verification per vendor (HMAC / public key).
- Persist raw payload before processing; retry-safe.

---

## E45 — UPI collection & auto-reconcile

### LDS-810 — Payment gateway integration (Razorpay / PhonePe for Business)
**Type:** feature · **Points:** 5
**AC:**
- Create UPI payment link API wrapped in adapter.
- Amount + invoice/customer reference encoded in notes.
- Webhook handler persists events to Postgres first, processes after.

### LDS-811 — Generate pay-links from collector / admin / portal
**Type:** feature · **Points:** 3
**AC:**
- Collector app: "Request UPI" on any customer → generates link → WhatsApp/SMS delivered.
- Admin can issue link from invoice screen.
- Link has expiry (default 7 days), configurable amount (full / partial).

### LDS-812 — Auto-reconcile UPI payments to AR
**Type:** feature · **Points:** 5
**AC:**
- Webhook `payment.captured` → match via reference → create payment record → allocate → lock.
- Unmatched webhooks sit in a "needs review" queue, not silently dropped.
- Duplicate settlement protection via vendor txn_id idempotency.

### LDS-813 — Static QR code per customer (optional)
**Type:** feature · **Points:** 3
**AC:**
- Each customer can be issued a static UPI QR printable for their shop counter.
- Settlement maps by virtual UPI ID / note; fallback to manual match if ambiguous.

### LDS-814 — Refund path
**Type:** feature · **Points:** 3
**AC:**
- Refund initiated from admin: creates reverse ledger entry on approval.
- Matches refund webhook; handles partial refunds.

### LDS-815 — Settlement file reconciliation
**Type:** feature · **Points:** 2
**AC:**
- Daily settlement statement from PG parsed + compared to webhook-sourced payments.
- Discrepancies surfaced in recon report.

---

## E46 — WhatsApp outbound templates

### LDS-820 — WhatsApp Business provider integration (Meta Cloud API / Gupshup)
**Type:** feature · **Points:** 5
**AC:**
- Adapter for outbound message send.
- Templates registered and approved with Meta.
- Send rate limits handled with queuing.

### LDS-821 — Template library with variables
**Type:** feature · **Points:** 3
**AC:**
- Statement-ready, payment-receipt, promise-reminder, delivery-ETA, new-invoice.
- DB-stored templates with variable binding and preview.

### LDS-822 — Send triggers wired to domain events
**Type:** feature · **Points:** 3
**AC:**
- invoice.posted → "your invoice is ready" with PDF + pay-link.
- payment.captured → receipt template.
- promise.due_today → reminder.
- Customer opt-out honored.

### LDS-823 — Template delivery receipts + retry
**Type:** feature · **Points:** 2
**AC:**
- Track sent / delivered / read / failed.
- Auto-retry on transient failure; fallback to SMS.

---

## E47 — WhatsApp inbound + bot + handoff

### LDS-830 — Inbound message webhook + customer matching
**Type:** feature · **Points:** 5
**AC:**
- Incoming messages matched to customer by phone number.
- Unknown senders get polite "please share your shop name" and route to admin triage.

### LDS-831 — Intent router (lightweight)
**Type:** feature · **Points:** 5
**AC:**
- Intents: `statement`, `outstanding`, `place_order`, `last_invoice`, `pay`, `human`.
- Regex + keyword first; LLM as fallback for ambiguous input (optional, flagged).

### LDS-832 — Self-serve conversation flows
**Type:** feature · **Points:** 5
**AC:**
- "statement" → send current-month PDF.
- "outstanding" → amount + pay-link.
- "place order" → render favorites list with buttons → confirmation → creates order (credit-checked).
- Stateful dialog with timeout.

### LDS-833 — Agent handoff
**Type:** feature · **Points:** 3
**AC:**
- "human" intent or repeated misunderstanding → ticket created → routed to admin queue.
- Admin replies from portal; conversation threaded.
- SLA timer per open ticket.

### LDS-834 — Conversation audit + replay
**Type:** feature · **Points:** 3
**AC:**
- All messages logged with intent classification, outcome, handoff status.
- Used for bot training and dispute defense.

---

## E48 — e-Invoice compliance (India GST)

### LDS-840 — IRN generator integration (GSP/ASP)
**Type:** feature · **Points:** 5
**AC:**
- Adapter for IRN service (NIC via a GSP).
- On invoice.posted above threshold: canonical JSON built → signed → submitted → IRN + QR persisted on invoice.
- Failure to get IRN blocks invoice becoming customer-facing PDF until resolved.

### LDS-841 — Canonical invoice JSON builder
**Type:** feature · **Points:** 5
**AC:**
- Strict schema adherence with HSN, GSTIN, place-of-supply, item classification.
- Validators catch missing fields at order time (not at post time).

### LDS-842 — Invoice cancellation / amendment flow
**Type:** feature · **Points:** 3
**AC:**
- Cancellation within allowed window calls IRN cancel API.
- Amendments handled via credit/debit notes (already in Phase 1).

### LDS-843 — Invoice PDF update with IRN + QR
**Type:** feature · **Points:** 3
**AC:**
- Final PDF embeds IRN and signed QR.
- Portal and WhatsApp send the IRN'd version only.

### LDS-844 — IRN reconciliation
**Type:** feature · **Points:** 3
**AC:**
- Daily: all qualifying invoices have valid IRN; gaps surfaced immediately.
- Monthly: match internal invoice register with GSTN portal data if feasible.

### LDS-845 — State-specific permit / excise fields
**Type:** feature · **Points:** 2
**AC:**
- Configurable per state: permit number, license number, additional cess.
- Mandatory at invoice posting when customer's state requires it.

---

## E49 — e-Way bill compliance

### LDS-850 — e-Way bill generation tied to delivery confirm
**Type:** feature · **Points:** 5
**AC:**
- On load-out or delivery-confirm (per business flow): generate EWB via same GSP.
- Vehicle + driver + route details captured from trip module.
- EWB number + validity on delivery record.

### LDS-851 — EWB lifecycle (extend / cancel / consolidate)
**Type:** feature · **Points:** 3
**AC:**
- Extend on delays; cancel on trip cancel; consolidated EWB for multi-invoice trips where allowed.

### LDS-852 — EWB failure handling
**Type:** feature · **Points:** 3
**AC:**
- If EWB generation fails, trip cannot depart in enforcing states (configurable).
- Admin workflow to retry or manually generate via government portal.

### LDS-853 — EWB register + audit
**Type:** feature · **Points:** 2
**AC:**
- Searchable register; period audit report matching EWBs to invoices and trips.

---

## E50 — Tally / Zoho Books sync

### LDS-860 — Tally integration (push-based via connector)
**Type:** feature · **Points:** 8
**AC:**
- Daily batch: invoices, credit notes, payments, returns pushed to Tally via connector (TDL / XML import / Tally Prime API).
- Customer + SKU + tax ledgers mapped deterministically.
- Idempotent on reference number; retries safe.

### LDS-861 — Zoho Books integration (API-based)
**Type:** feature · **Points:** 5
**AC:**
- Same event set pushed via Zoho API.
- Contact sync, item sync, invoice + payment creation.

### LDS-862 — Mapping config (customer → ledger, SKU → item)
**Type:** feature · **Points:** 3
**AC:**
- Admin UI to define mappings; unmapped entities queue for admin attention before sync.

### LDS-863 — Reverse sync (optional, configurable)
**Type:** feature · **Points:** 3
**AC:**
- Tally / Zoho payments (non-UPI, manual bank entries) flow back to mark invoices paid in our system.
- Conflict rules explicit (which side wins on disagreement).

### LDS-864 — Daily reconciliation report
**Type:** feature · **Points:** 2
**AC:**
- Our vs accounting: invoices count, total value, payments count and value.
- Mismatches highlighted; drill-down to record level.

---

## E51 — Customer self-service portal

### LDS-870 — Portal auth (phone OTP)
**Type:** feature · **Points:** 3
**AC:**
- Customer signs in with phone → OTP → session.
- Access scoped strictly to own data.

### LDS-871 — Dashboard: outstanding, recent invoices, statements
**Type:** feature · **Points:** 5
**AC:**
- One-screen view of total outstanding, aging, last 10 invoices, next promise.
- Download statement PDF (any date range).

### LDS-872 — Online order placement
**Type:** feature · **Points:** 5
**AC:**
- Catalog filtered to customer's price list.
- Cart, credit-check banner, submit → creates order in system with `channel=portal`.
- Subject to same credit rules as rep-placed orders.

### LDS-873 — Pay now (UPI link from portal)
**Type:** feature · **Points:** 3
**AC:**
- Customer selects invoices → generates pay-link → completes UPI → success screen → receipt.

### LDS-874 — Order tracking + delivery ETA
**Type:** feature · **Points:** 3
**AC:**
- Live status: confirmed → dispatched → out-for-delivery → delivered.
- Rider name + vehicle + ETA when out for delivery.

### LDS-875 — Dispute raise from portal
**Type:** feature · **Points:** 2
**AC:**
- Raise a dispute on any invoice with reason + photo.
- Lands in admin queue; same flow as field-raised disputes.

---

## E52 — Voice / SMS ordering (lightweight)

### LDS-880 — SMS shortcode / keyword ordering
**Type:** feature · **Points:** 5
**AC:**
- SMS "ORDER" to shortcode → reply with last-order repeat option.
- "OUT" → outstanding amount + pay-link.
- Low-infra fallback for shops without smartphones.

### LDS-881 — Voice / IVR hotline (optional)
**Type:** feature · **Points:** 5
**AC:**
- Number customer calls; IVR menu: 1 reorder, 2 outstanding, 3 speak to admin.
- Reorder call creates a "confirm via call back" task for admin.

### LDS-882 — Missed-call reorder trigger
**Type:** feature · **Points:** 3
**AC:**
- Customer gives missed call to registered number → webhook creates a "call me back" task in admin queue with phone match.

---

## E53 — Partner / supplier portal lite

### LDS-890 — Supplier self-service for PO acknowledgement
**Type:** feature · **Points:** 3
**AC:**
- Suppliers (created in Phase 4 PO module) can log in, view open POs, acknowledge or reject.

### LDS-891 — Supplier dispatch / ASN intake
**Type:** feature · **Points:** 3
**AC:**
- Supplier can notify dispatch with batch + expiry + qty; feeds goods receipt draft on our side.

### LDS-892 — Supplier payment status view
**Type:** feature · **Points:** 2
**AC:**
- Supplier sees PO → GRN → invoice → payment status (read-only; AP module beyond scope).

---

## E54 — Data exports, BI, webhooks

### LDS-900 — CSV / Excel export everywhere
**Type:** feature · **Points:** 3
**AC:**
- Every admin list has export button; large exports run async with email link.

### LDS-901 — BI connector (Metabase / Superset / read-replica)
**Type:** feature · **Points:** 3
**AC:**
- Read-only warehouse connection with row-level security per role.
- Pre-built dashboard templates ship with onboarding.

### LDS-902 — Public webhooks for tenants' own systems
**Type:** feature · **Points:** 5
**AC:**
- Org admin registers webhook URLs for events (order, invoice, payment).
- Signed deliveries; retries; DLQ visibility.

### LDS-903 — API keys for tenant-side integrations
**Type:** feature · **Points:** 2
**AC:**
- Scoped API keys (read-only by default); rotation + revocation.

---

## E55 — Hardening, audits, rollout

### LDS-910 — Security audit (integrations)
**Type:** chore · **Points:** 5
**AC:**
- Pen-test adapters, webhook endpoints, portal auth.
- Fix high/critical before GA.

### LDS-911 — Compliance checklist (GST, data)
**Type:** chore · **Points:** 3
**AC:**
- IRN cancellation windows, EWB validity rules, data retention per statute all wired.
- CA/consultant sign-off.

### LDS-912 — Integration health dashboard
**Type:** feature · **Points:** 3
**AC:**
- Per-adapter: uptime, lag, error rate, DLQ depth, last reconcile result.
- Owner and admin alert on thresholds.

### LDS-913 — Staged rollout plan + kill switches
**Type:** chore · **Points:** 2
**AC:**
- Turn on per-org / per-integration with flags.
- Documented rollback steps per integration.

---

## Cross-cutting acceptance tests (end of Phase 5)

1. **UPI round-trip:** collector generates link via WhatsApp → customer pays → webhook received → invoice marked paid → customer gets receipt template → AR ledger reflects within 2 min.
2. **UPI duplicate protection:** vendor retries webhook 5x with same txn_id → payment recorded once; replay does not create duplicate ledger entries.
3. **WhatsApp inbound:** customer types "outstanding" → bot replies with amount + pay-link → customer pays → conversation thread shows full loop.
4. **Agent handoff:** bot fails twice to parse → ticket created → admin replies from portal → customer receives reply → ticket closed with SLA met.
5. **e-Invoice compliance:** 100 invoices in a day → all above threshold have IRN + QR → PDFs embed QR → recon report shows zero gaps.
6. **e-Way bill:** trip planned with 8 invoices → EWB generated → vehicle dispatches → trip close verifies all EWBs consumed → no orphan EWBs.
7. **Tally sync:** daily push of invoices, payments, CNs → Tally register matches our register within tolerance → unmapped ledger surfaces in admin queue.
8. **Portal order with credit enforcement:** customer on hold attempts to order via portal → blocked with clear reason → collector notified.
9. **Reconciliation accuracy:** manual-vs-auto end-of-month close completes in under 2 hours (down from days).
10. **Kill switch:** turn off UPI adapter → pay-links deactivate immediately → new collections fall back to cash/cheque → no data loss, no stuck webhooks.

---

## Sprint plan (2-week sprints)

### Sprint 12 (weeks 23–24) — Platform + UPI
- E44 all · E45 LDS-810/811/812/814 · E55 LDS-913
- **Outcome:** adapter framework live; UPI collection functional with webhook-driven auto-reconcile.

### Sprint 13 (weeks 25–26) — WhatsApp + portal foundation
- E45 LDS-813/815 · E46 all · E47 LDS-830/831/832 · E51 LDS-870/871/873
- **Outcome:** WhatsApp outbound receipts + statements; inbound with core intents; portal login + outstanding + pay.

### Sprint 14 (weeks 27–28) — Compliance (e-Invoice + EWB)
- E47 LDS-833/834 · E48 all · E49 all · E51 LDS-872/874/875
- **Outcome:** IRN + EWB live for qualifying invoices; portal supports ordering + tracking + disputes.

### Sprint 15 (weeks 29–30) — Accounting + misc + GA
- E50 all · E52 all · E53 all · E54 all · E55 LDS-910/911/912
- **Outcome:** Tally/Zoho sync GA. Lightweight SMS/IVR rails. BI + webhooks. Security audit closed. Phase 5 complete.

---

## Risks & mitigations (Phase 5 specific)

| Risk | Mitigation |
|---|---|
| UPI webhook downtime silently loses collections | Idempotent replay + daily settlement-file recon catches any gaps |
| WhatsApp template rejections by Meta delay launch | Start template approval in Sprint 12; have SMS fallback pre-wired |
| Bot misclassifies intent, annoys customer | Conservative router: anything ambiguous hands off to agent immediately; weekly review of mis-parses |
| IRN service outages block posting | Queue and retry; admin override within legal window; escalation runbook |
| EWB restrictions differ by state | State-specific config table; per-state enforcement flag |
| Tally connector breaks on upgrades | Integration tests against Tally Prime versions; connector versioned and upgradable independently |
| Customer portal becomes attack surface | Per-customer rate limits; strict scoping; phone OTP only; monthly pen-test |
| Supplier portal expands into a full AP module mid-phase | Out of scope, hold the line; revisit in a later phase |
| Integration sprawl (8 vendors, each fragile) | Adapter pattern + unified health dashboard + DLQ visibility; no new integration without recon report spec |
| Data leakage via webhooks to tenants' systems | Signed payloads, IP allow-lists, field-level filtering per subscription |

---

## Out of Phase 5 (explicit non-goals)

- Full accounts-payable module (supplier invoicing, payments) → future
- ERP migration tooling (import from legacy ERPs in bulk) → as needed, case by case
- Native iOS builds for all field apps → post-Phase 5 if demand
- Multi-tenant billing / SaaS monetization stack → separate initiative
- Multi-country tax engines (outside India) → future, per market
- Deep LLM chatbot / voice AI (OpenAI-grade conversational agent) → possible future phase; keep current bot bounded
- Blockchain / anti-counterfeit tracking → not planned
- Excise department direct-filing APIs (where available) → state-by-state, future

---

## Post-Phase-5 roadmap hint

At this point the platform is a **complete distribution OS** — field execution, accounting hooks, customer rails, compliance. Natural next waves:

1. **Multi-depot orchestration** — consolidated planning across warehouses.
2. **AP module** — close the supplier-payment loop.
3. **Finance analytics** — margin optimization, pricing experiments at scale.
4. **Marketplace mode** — expose inventory to wholesale buyers via API.
5. **Packaged SaaS** — onboarding flow, billing, support portal, to serve multiple distributors.
