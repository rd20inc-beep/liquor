# Liquor Distribution OS — Product Requirements Document

**Version:** 1.0
**Date:** 2026-04-13
**Status:** Draft for engineering handoff
**Owner:** Product / Engineering

---

## 1. Problem Statement

Liquor distribution is operationally chaotic: route-based field teams, credit-heavy customer base, partial collections, van-stock leakage, and deferred cash recovery. Existing ERPs assume clean, linear B2B flows and fail at the three things that actually matter:

1. **Cash recovery** — collectors log outcomes loosely; promises, disputes, and part-payments are invisible.
2. **Stock truth** — warehouse vs van reconciliation is manual and lagging.
3. **Field execution** — reps/drivers/collectors work blind to credit state, priority, and history.

This product is not a general ERP. It is a **route-aware operational control system** optimized for cash velocity, stock visibility, and field decisioning.

## 2. Goals & Non-Goals

### Goals (first release)
- Reduce overdue >30 days by 40% within 90 days of go-live.
- Eliminate stock discrepancy between van and warehouse (target: <0.5% variance).
- Make every field visit produce structured, auditable output (visit has a mandatory outcome).
- Cut order-to-invoice cycle to <5 minutes (currently manual rekeying).

### Non-Goals (v1)
- Consumer-facing e-commerce.
- Manufacturing / bottling operations.
- Full financial accounting (integrate with Tally/Zoho instead).
- Multi-country tax engines.

## 3. Personas

| Persona | Device | Core need |
|---|---|---|
| **Sales Rep** (Ravi) | Android phone, field | Place order for customer quickly, see if credit allows it |
| **Collector** (Sanjay) | Android phone, field | Know who to chase today, log what happened, capture proof |
| **Driver** (Imran) | Android phone / tablet, field | Deliver correct qty, handle shortages, get signed POD |
| **Accounts Officer** (Priya) | Desktop | Reconcile payments, resolve disputes, chase broken promises |
| **Admin** (Operations Head) | Desktop | Approvals, overrides, exception management |
| **Owner** (Proprietor) | Phone + desktop | Trust the numbers; act on risk; approve what matters |

## 4. Success Metrics

- **Cash recovery:** DSO (days sales outstanding) reduction; % of invoices in >30d bucket.
- **Field productivity:** visits/day, collection conversion rate, order fill rate.
- **Stock integrity:** physical vs system variance per cycle count.
- **Adoption:** daily active field users; % orders placed through app vs back-office entry.
- **Control:** # of overrides/month; audit-log completeness.

## 5. Scope — Feature Requirements

### 5.1 Customer Management
- **Must:** structured profile; geo-location; route assignment; credit limit and payment term (enum, not text); assigned rep & collector; status (active / hold / blocked / dispute).
- **Must:** auto-computed credit state — outstanding, aging buckets, available credit, risk score, promise state.
- **Must:** buying behavior summary — order frequency, avg basket, top SKUs, last order/payment/visit.
- **Should:** dispute/hold toggle with reason code and expected resolution date.
- **Won't (v1):** complex hierarchical customer trees (chains with HQ-branch billing).

### 5.2 Product & Pricing
- **Must:** SKU with brand, category, bottle size, case qty, HSN, tax rate.
- **Must:** price lists with validity windows; per-customer price list override.
- **Must:** promo bundles (buy X get Y, case discounts).
- **Should:** MRP capture for excise compliance.

### 5.3 Inventory & Warehousing
- **Must:** multi-warehouse; van is a warehouse typed `van` bound to a vehicle & custodian.
- **Must:** batch/lot with expiry; FEFO pick logic.
- **Must:** three stock states — physical, sellable, free. Reservations on order confirmation.
- **Must:** append-only `stock_movements` ledger; every movement has reason + user + GPS (if mobile) + timestamp.
- **Must:** cycle count workflow with variance capture.
- **Should:** near-expiry alerts; dead-stock flags (no movement in N days).

### 5.4 Sales Orders
- **Must:** order entry from rep app, admin web, and "repeat last order" shortcut.
- **Must:** inline credit check before submission; clear block/hold/approve states.
- **Must:** AI reorder suggestions using buying history (Phase 2 lite: rule-based frequency; Phase 3: ML).
- **Must:** substitutions flow when requested SKU is out of stock.
- **Must:** approval workflow for credit overrides — reason mandatory, logged.

### 5.5 Invoicing & AR
- **Must:** invoice generated on delivery confirmation (or on order for cash customers).
- **Must:** invoice is locked after posting; corrections go through credit notes.
- **Must:** append-only AR ledger; all balances derived from ledger.
- **Must:** customer statement generation (PDF / WhatsApp share).

### 5.6 Collections Engine **(most critical module)**
- **Must:** a collection visit captures a mandatory outcome from a fixed enum: `collected / partial / promise / dispute / not_available / refused`.
- **Must:** payment has mode (cash/cheque/bank/UPI), mode reference, proof image (mandatory above configurable threshold), GPS, timestamp.
- **Must:** payment allocation across invoices (FIFO default, manual allowed).
- **Must:** promise records with due date, broken-promise auto-escalation.
- **Must:** cheque lifecycle (issued → deposited → cleared/bounced) with auto-reversal on bounce.
- **Must:** locked after posting — edits require admin + audit entry.
- **Should:** duplicate payment prevention (same customer, same amount, same day → warn).

### 5.7 Delivery & Route
- **Must:** trip = vehicle + driver + route + date + ordered stops.
- **Must:** van load-out with stock transfer from warehouse.
- **Must:** delivery confirmation with per-line delivered qty, shortage reason, POD (signature + photo).
- **Must:** end-of-trip van reconciliation (sold + returned + remaining = loaded).
- **Should:** live ETA sharing via WhatsApp link (Phase 2).

### 5.8 Returns & Damages
- **Must:** return captured at delivery (refused) or scheduled pickup.
- **Must:** damage flagged with photo + reason; routed to separate damaged-stock location.
- **Must:** credit note auto-drafted, requires approval to post.

### 5.9 Analytics & Dashboards
- **Must:** Owner dashboard (today's money movement, exposure, risk, approvals).
- **Must:** AR aging with drill-down to customer → invoice → visit history.
- **Must:** Inventory health (stockouts, near-expiry, dead stock, fast movers).
- **Must:** Collector performance (visits, conversion, cash collected, promises kept).
- **Must:** Route progress (live, trip-level).

### 5.10 Roles, Control & Compliance
- **Must:** RBAC with resource × action matrix (see §7).
- **Must:** approval matrix for credit override, stock adjust, payment edit, price list change.
- **Must:** audit log — before/after JSON for every mutation of a locked entity.
- **Must:** GPS + timestamp on every field action.
- **Must:** cash reconciliation (collector daily close).
- **Should:** 2FA for admin/owner on sensitive actions (credit override, payment edit).

## 6. Key Workflows (acceptance criteria)

### W1 — Credit-Controlled Order
**Trigger:** Rep submits order for customer.
**Flow:**
1. System computes `available_credit = credit_limit - outstanding`.
2. System computes `risk_score` from overdue aging, broken promises, dispute flag.
3. If `order_total ≤ available_credit` AND `risk_score < threshold` AND customer status = active → **auto-approve**, reserve stock.
4. Else if insufficient credit OR risk ≥ threshold → **hold**, notify rep + admin.
5. Else if status in (hold/blocked/dispute) → **reject**, surface reason.
6. Admin override → requires reason code, logs entry, approves.

**Acceptance:**
- No order may bypass credit check.
- Override is impossible without captured reason.
- Approval event appears in audit log with before/after state.

### W2 — Delivery + Collection
**Trigger:** Driver arrives at stop.
**Flow:**
1. Driver opens delivery → enters delivered qty per line.
2. Shortages captured with reason (out-of-stock on van / customer refused qty / damaged).
3. POD: signature + photo mandatory.
4. Invoice finalized with actual delivered qty (not ordered qty).
5. If collector present: collection flow begins immediately.
6. Else: invoice lands in collector's priority list on due date.

**Acceptance:**
- Cannot close delivery without POD and shortage reasons.
- Invoice total must equal sum of delivered lines (not order lines).

### W3 — Overdue Recovery Loop
**Trigger:** Nightly job at 02:00 local.
**Flow:**
1. Recompute aging for all customers.
2. Generate today's promise list (promises due today).
3. Rank customers by composite score = `overdue_amount × age_weight × customer_value`.
4. Push into each collector's Priority List for the morning.
5. Broken promises auto-flag and notify owner if >3 in 30 days.
6. N broken promises (configurable, default 3) → auto-set `status=hold`.

**Acceptance:**
- Priority list is deterministic and reproducible from inputs.
- Hold is reversible only via admin action with reason.

### W4 — Stock Risk & Reorder
**Trigger:** Stock level crosses reorder point.
**Flow:**
1. System generates reorder suggestion (SKU, qty = f(velocity, lead time, safety stock)).
2. Lands in admin queue.
3. Admin approves → PO draft.

**Acceptance:**
- Reorder ignores damaged and reserved stock.
- Suggestion shows last 30-day velocity & stockout days.

### W5 — Smart Ordering (field)
**Trigger:** Rep opens customer 360 view.
**Flow:**
1. System displays: "Due for order in N days" (based on frequency).
2. System pre-fills likely basket (top SKUs × avg qty).
3. Rep adjusts and submits.

**Acceptance:**
- Suggestion shown only if ≥3 prior orders exist.
- Rep can reject suggestion without penalty (no forced flow).

## 7. Role × Permission Matrix

| Resource / Action | Sales | Collector | Driver | Accounts | Admin | Owner |
|---|---|---|---|---|---|---|
| Customer: view | own route | own route | trip only | all | all | all |
| Customer: create | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Customer: hold/block | ❌ | request | ❌ | ✅ | ✅ | ✅ |
| Credit limit: edit | ❌ | ❌ | ❌ | request | ✅ | ✅ |
| Order: create | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Order: approve credit override | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Invoice: view | own | own | trip | all | all | all |
| Invoice: edit (locked) | ❌ | ❌ | ❌ | ❌ | ✅* | ❌ |
| Payment: record | ❌ | ✅ | cash-at-door | ✅ | ✅ | ❌ |
| Payment: edit (locked) | ❌ | ❌ | ❌ | ❌ | ✅* | ❌ |
| Stock: transfer | ❌ | ❌ | van→wh | ✅ | ✅ | ❌ |
| Stock: adjust | ❌ | ❌ | ❌ | ❌ | ✅* | approve |
| Price list: edit | ❌ | ❌ | ❌ | ❌ | ✅ | approve |
| Dashboards | own KPIs | own KPIs | trip | finance | all | all |
| Audit log: view | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |

(*) = requires audit entry + approval record.

## 8. Non-Functional Requirements

- **Offline-first mobile:** 8h field day without connectivity; journal-based sync with conflict resolution.
- **Performance:** p95 API <300ms on transactional endpoints; mobile screen transitions <100ms.
- **Availability:** 99.5% (business hours, single region v1); RPO 15 min, RTO 1 hour.
- **Security:** TLS in transit; AES-256 at rest; PII (phone, address) encrypted column-level; role-scoped row filters.
- **Audit:** every mutation of locked entity logs `before_json`, `after_json`, actor, timestamp, IP, GPS.
- **Scale (v1):** 50k customers, 5k orders/day, 200 concurrent mobile users, 2M invoices/yr.
- **Localization:** English + Hindi UI; INR only v1; timezone pinned per org.

## 9. Integrations

- **WhatsApp Business API** — statements, OTP, ETA links.
- **Payment gateway** — UPI collection (Razorpay/PhonePe for Business).
- **SMS gateway** — payment receipts, promise reminders.
- **Accounting** — one-way export to Tally / Zoho Books (invoices, payments, credit notes).
- **Maps** — geocoding + routing (Google Maps or OSRM).
- **Storage** — S3-compatible (MinIO self-hosted or AWS S3) for PODs and proofs.

## 10. Data Model (summary — full DDL in `schema.sql`)

Core entities: `customers`, `payment_terms`, `customer_credit_state`, `products`, `price_lists`, `warehouses`, `stock_batches`, `stock_movements`, `sales_orders`, `invoices`, `ar_ledger`, `collection_visits`, `payments`, `payment_allocations`, `promises`, `routes`, `trips`, `deliveries`, `users`, `roles_permissions`, `approval_requests`, `audit_log`, `locks`.

Principles:
- **Append-only** for `ar_ledger`, `stock_movements`, `audit_log`.
- **Derived state** (`customer_credit_state`) refreshed on event, not on read.
- **Locks** table gates mutations of posted entities.

## 11. Open Questions

1. Excise permit numbers per state — mandatory on invoice? Which states?
2. Post-dated cheque custody — physical register scan or just metadata?
3. Cash deposit cycle — daily bank deposit reconciliation within the app or separate?
4. Return policy — return window from invoice date? Per-SKU vs global?
5. Price lists — time-of-day or only date-range validity?

## 12. Phase Plan

| Phase | Weeks | Deliverables |
|---|---|---|
| 1 | 1–6 | Foundation: customers, catalog, warehouses, orders, invoices, AR ledger, admin web, audit + locks |
| 2 | 7–12 | Field apps: Sales Rep, Collector (collections engine + offline sync), Priority list, Owner dashboard v1 |
| 3 | 13–16 | Delivery: Driver app, trips, van stock, POD, shortage/return |
| 4 | 17–22 | Control & intelligence: approval matrix, risk scoring, AI reorder, churn, dead-stock, route optimization |
| 5 | 23+ | Integrations: WhatsApp, UPI, Tally sync, e-invoice, BI |

## 13. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Field users reject structured outcomes (feels slower) | adoption fails | Two-tap outcome flow, voice note fallback, supervisor KPI on usage |
| Offline sync conflicts | bad data, lost payments | Event-journal with server as authority; idempotency keys |
| Cash handling disputes | trust collapse | Mandatory photo proof + GPS + dual-custody deposit reconciliation |
| Owner doesn't trust dashboards | rollback to spreadsheets | Drill-down to source transaction from every KPI |
| Excise compliance gaps | legal | Legal review per state before launch; permit number capture |
