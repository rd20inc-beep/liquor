# Phase 1 — Foundation Backlog

**Duration:** 6 weeks
**Goal:** Foundation layer — customers, catalog, warehouses, orders, invoices, AR ledger, admin web, audit + locks. No field apps yet (Phase 2). No delivery module (Phase 3).

**Definition of Done (phase):**
- Admin can onboard customers, products, price lists, warehouses, users.
- Orders can be created via admin web with inline credit check.
- Invoices post to locked state and write to AR ledger.
- Payments can be recorded from admin web (field app comes in Phase 2).
- Audit log captures every mutation of locked entities.
- All endpoints in `openapi.yaml` for tags Auth/Customers/Catalog/Inventory/Orders/Invoices/Admin return real data.
- Staging deployed with seed org + 50 demo customers.

**Team assumption:** 1 backend, 1 frontend (admin web), 1 full-stack, 0.5 QA, 0.5 PM.

---

## Epic breakdown

| # | Epic | Story points |
|---|---|---|
| E1 | Platform & infra skeleton | 13 |
| E2 | Auth, users, RBAC | 13 |
| E3 | Orgs, routes, warehouses, vehicles | 8 |
| E4 | Customers + credit state | 21 |
| E5 | Catalog + price lists | 13 |
| E6 | Inventory (stock, batches, movements) | 21 |
| E7 | Orders + credit engine | 21 |
| E8 | Invoicing + AR ledger | 21 |
| E9 | Payments (admin-web capture only) | 13 |
| E10 | Audit log + locks + approvals | 13 |
| E11 | Admin web shell + dashboards v0 | 21 |
| E12 | Observability, CI/CD, staging | 13 |
| **Total** | | **191** |

---

## E1 — Platform & infra skeleton

### LDS-001 — Repo, monorepo layout, lint/format
**Type:** chore · **Points:** 2
**AC:**
- Monorepo with `/api`, `/admin-web`, `/packages/shared` (types, zod schemas).
- Lint, formatter, pre-commit hooks configured.
- `make dev` brings up full stack locally.

### LDS-002 — Postgres 15 + Redis + MinIO local via docker-compose
**Type:** chore · **Points:** 3
**AC:**
- `docker-compose.yml` with pg15 (+ postgis, pgcrypto, pg_trgm, citext), Redis 7, MinIO.
- Health-check endpoints green on boot.

### LDS-003 — Schema migration tool wired (Sqitch or Flyway)
**Type:** chore · **Points:** 3
**AC:**
- `schema.sql` split into ordered migrations.
- `make migrate` applies to local + CI.
- Rollback scripts present for destructive migrations.

### LDS-004 — API skeleton (framework, config, error model)
**Type:** feature · **Points:** 3
**AC:**
- Node/TS (Fastify) **or** Go (chi) — decide at sprint 0.
- Config via env; 12-factor.
- Standardized error envelope: `{code, message, details}`.
- Request ID middleware; structured JSON logs.

### LDS-005 — Shared types package generated from OpenAPI
**Type:** feature · **Points:** 2
**AC:**
- `openapi.yaml` → TS types + zod schemas auto-generated into `/packages/shared`.
- Admin web consumes same types as API.

---

## E2 — Auth, users, RBAC

### LDS-010 — Phone + OTP login (SMS stub in dev)
**Type:** feature · **Points:** 5
**AC:**
- `POST /auth/login` accepts phone+otp+device_id.
- Dev mode: OTP always `123456`; prod: pluggable SMS provider.
- JWT access token (15m) + refresh token (30d) stored hashed.
- Rate limit: 5 OTP requests / phone / hour.

### LDS-011 — Users CRUD + role assignment (admin web)
**Type:** feature · **Points:** 3
**AC:**
- Admin can create user with role, phone, name.
- Deactivate flow sets `active=false` (never hard-delete).

### LDS-012 — RBAC middleware (resource × action × scope)
**Type:** feature · **Points:** 3
**AC:**
- Middleware reads `roles_permissions` table.
- Scope `own|route|all` enforced via row filter on queries.
- Integration tests: sales rep can only list customers on own route.

### LDS-013 — Session & device registration
**Type:** feature · **Points:** 2
**AC:**
- `user_devices` row upserted on login.
- Admin can view last_seen_at per device.

---

## E3 — Orgs, routes, warehouses, vehicles

### LDS-020 — Org bootstrap script + default seed
**Type:** feature · **Points:** 2
**AC:**
- Seed creates 1 org, 1 admin user, 1 default payment term, 1 default price list.

### LDS-021 — Routes CRUD + stop ordering
**Type:** feature · **Points:** 3
**AC:**
- Admin creates routes, assigns customers with sequence.
- Drag-to-reorder in admin web (simple list, not map yet).

### LDS-022 — Warehouses & vehicles CRUD
**Type:** feature · **Points:** 3
**AC:**
- Warehouse types: `warehouse` or `van`.
- Van warehouses require `vehicle_id` and `custodian_user_id`.

---

## E4 — Customers + credit state

### LDS-030 — Customer CRUD with structured payment term
**Type:** feature · **Points:** 5
**AC:**
- Create/edit customer with type, route, geo, credit limit, payment term.
- Unique `(org_id, code)` enforced.
- Payment term is FK, not free text.

### LDS-031 — Customer 360 endpoint
**Type:** feature · **Points:** 5
**AC:**
- `GET /customers/{id}/360` returns profile + aging + recent orders/payments + open invoices + reorder suggestion.
- Sub-300ms p95 with denormalized read path.

### LDS-032 — Credit state materialized + refresh logic
**Type:** feature · **Points:** 5
**AC:**
- `customer_credit_state` row exists for every customer.
- Refresh function recomputes on: invoice post, payment, credit note, promise create/resolve.
- Nightly sweep rebuilds all (safety net).
- Aging buckets match `v_invoice_aging` exactly.

### LDS-033 — Hold / block workflow
**Type:** feature · **Points:** 3
**AC:**
- `POST /customers/{id}/hold` with reason required.
- Held customers blocked at order creation.
- `hold_until` auto-releases via nightly job.

### LDS-034 — Customer search (admin web)
**Type:** feature · **Points:** 3
**AC:**
- Fuzzy name / code search using pg_trgm.
- Filters: route, status, risk bucket.

---

## E5 — Catalog + price lists

### LDS-040 — Brands & products CRUD
**Type:** feature · **Points:** 3
**AC:**
- SKU unique per org; bottle size, case qty, HSN, tax rate mandatory.
- Bulk CSV import tolerant to errors (row-level report).

### LDS-041 — Price lists with validity + default flag
**Type:** feature · **Points:** 3
**AC:**
- Multiple price lists; only one `is_default=true` per org.
- Customer can override via `customers.price_list_id`.
- Price lookup order: customer override → default → error.

### LDS-042 — Price resolution service
**Type:** feature · **Points:** 3
**AC:**
- `resolvePrice(customer_id, product_id, qty, date)` → unit_price + source.
- Unit test grid covers: valid range, min_qty, case vs bottle, missing price.

### LDS-043 — Promo stub (schema only; engine deferred)
**Type:** feature · **Points:** 2
**AC:**
- `promos` table + admin screen to list; engine wiring in Phase 4.

### LDS-044 — Bulk CSV import UI (products + customers)
**Type:** feature · **Points:** 2
**AC:**
- Drag-drop CSV, preview first 20 rows, validate, apply.
- Errors downloadable as CSV.

---

## E6 — Inventory

### LDS-050 — Stock batches: receive into warehouse
**Type:** feature · **Points:** 5
**AC:**
- Goods receipt creates `stock_batches` row and `stock_movements` entry (reason=adjust or dedicated `receipt`).
- Batch no, mfg/expiry, cost price captured.

### LDS-051 — Stock transfer (warehouse ↔ warehouse/van)
**Type:** feature · **Points:** 3
**AC:**
- `POST /stock/transfer` atomic: debit from, credit to, movement pair logged.
- Idempotency-Key enforced.

### LDS-052 — Stock adjust with approval flow
**Type:** feature · **Points:** 3
**AC:**
- Non-admin `stock.adjust` → creates `approval_requests` row, not applied until approved.
- Admin can apply directly, still audit-logged.

### LDS-053 — Stock state view + low-stock alerts
**Type:** feature · **Points:** 3
**AC:**
- `v_stock_state` exposed via `GET /stock`.
- Nightly job flags products below reorder point (config per product).

### LDS-054 — Cycle count workflow
**Type:** feature · **Points:** 5
**AC:**
- Start cycle count → enter counted qty per batch → variance computed → apply adjustments via approval.

### LDS-055 — FEFO pick helper
**Type:** feature · **Points:** 2
**AC:**
- Function `pickBatches(warehouse_id, product_id, qty)` returns batch allocations ordered by expiry.
- Returns `null` if free qty insufficient.

---

## E7 — Orders + credit engine

### LDS-060 — Order create with line validation
**Type:** feature · **Points:** 3
**AC:**
- Admin web + API.
- Price resolved server-side (ignore client-submitted price unless admin).
- Lines total = sum(line_total); totals recomputed server-side.

### LDS-061 — Credit engine service
**Type:** feature · **Points:** 5
**AC:**
- Pure function `decide(customer_state, order_total)` → `{decision, reasons[], risk_score}`.
- Rules (v1, configurable): `available_credit >= total` AND `risk_score < 0.6` AND `status=active` → approve.
- Unit tests cover all combinations.

### LDS-062 — Credit reservation + release
**Type:** feature · **Points:** 3
**AC:**
- On order confirmed → reserve stock via `qty_reserved` increment.
- On order cancelled → release.
- On invoice posted → convert reservation to consumption.

### LDS-063 — Hold / approve / override endpoints
**Type:** feature · **Points:** 3
**AC:**
- Override requires `reason_code` + `note`; writes to `audit_log` + `approval_requests`.
- Cannot override `rejected` (blocked customer) without status change first.

### LDS-064 — Order admin web screens
**Type:** feature · **Points:** 5
**AC:**
- List with filters, detail, create, credit banner, approve/override buttons visible only to authorized roles.
- Reject path surfaces reasons clearly.

### LDS-065 — Repeat-last-order shortcut
**Type:** feature · **Points:** 2
**AC:**
- On customer 360, button "Repeat last order" prefills cart.

---

## E8 — Invoicing + AR ledger

### LDS-070 — Invoice posting service
**Type:** feature · **Points:** 5
**AC:**
- `postInvoice(order_id)` atomic:
  - Creates invoice + lines.
  - Writes AR ledger debit entry with running_balance.
  - Writes stock_movements (sale).
  - Converts reservation to consumption.
  - Locks invoice (`locked_at = now()`).
- Idempotent on order_id.

### LDS-071 — AR ledger running balance integrity
**Type:** feature · **Points:** 3
**AC:**
- Every ledger insert computes `running_balance` using serializable transaction or advisory lock per customer.
- Property test: random sequence of 1000 debit/credit entries per customer → final balance matches sum.

### LDS-072 — Invoice statuses maintained
**Type:** feature · **Points:** 2
**AC:**
- Outstanding == 0 → status `paid`.
- Dispute raised → status `disputed`.
- Partial allocation → status `partial`.

### LDS-073 — Credit note issue + post
**Type:** feature · **Points:** 3
**AC:**
- Creates approval request; on approve, writes ledger credit and reduces invoice outstanding.
- Return flow (Phase 3) reuses this.

### LDS-074 — Invoice detail & list (admin web)
**Type:** feature · **Points:** 5
**AC:**
- List with aging filter, status, customer.
- Detail shows lines, allocations, audit entries, statement print (PDF).

### LDS-075 — Customer statement PDF
**Type:** feature · **Points:** 3
**AC:**
- `GET /customers/{id}/statement?from=&to=` returns PDF.
- Shows opening balance, entries, closing balance, aging buckets.

---

## E9 — Payments (admin-web only in Phase 1)

### LDS-080 — Payment record API
**Type:** feature · **Points:** 5
**AC:**
- `POST /visits/{id}/payment` AND `POST /payments` (admin direct entry, no visit).
- Allocations sum ≤ amount; unallocated = advance (stored on customer).
- Lock on post.

### LDS-081 — Allocation engine (FIFO default)
**Type:** feature · **Points:** 3
**AC:**
- Default allocation picks oldest invoices first; admin can override line-by-line.
- Allocation triggers invoice status recompute.

### LDS-082 — Cheque lifecycle + verification
**Type:** feature · **Points:** 3
**AC:**
- Cheque payments start `pending`; accounts verifies → `verified` or `bounced`.
- Bounce: auto-reverse ledger entries + flag customer for follow-up.

### LDS-083 — Duplicate payment detection
**Type:** feature · **Points:** 2
**AC:**
- Warn on same customer + amount + mode + day within last 10 minutes.
- Block if identical `idempotency_key`.

---

## E10 — Audit, locks, approvals

### LDS-090 — Audit log write helper + middleware
**Type:** feature · **Points:** 3
**AC:**
- `audit(action, entity, id, before, after)` called from mutation services.
- Before/after stored as JSON snapshots.
- Non-blocking (async queue) but durable.

### LDS-091 — Lock enforcement tests
**Type:** feature · **Points:** 2
**AC:**
- Integration tests confirm DB triggers block updates on locked invoices/payments.
- Admin bypass (`SET LOCAL app.bypass_lock='on'`) only via explicit service method with audit entry.

### LDS-092 — Approval request framework
**Type:** feature · **Points:** 5
**AC:**
- Generic `approval_requests` + decide endpoint.
- Types: `credit_override`, `stock_adjust`, `credit_note`, `price_list`, `customer_hold_release`.
- Admin inbox UI with approve/reject + note.

### LDS-093 — Audit log viewer (admin web)
**Type:** feature · **Points:** 3
**AC:**
- Filter by entity, user, date range.
- Side-by-side diff view of before/after JSON.

---

## E11 — Admin web shell + dashboards v0

### LDS-100 — App shell, nav, auth gate
**Type:** feature · **Points:** 3
**AC:**
- Login → token persisted → nav with role-gated items.

### LDS-101 — Design system primitives
**Type:** feature · **Points:** 3
**AC:**
- Button, Input, Select, Table, Modal, Toast, Tabs, Badge, Money, GeoPoint.
- All wired to shared zod types.

### LDS-102 — Owner dashboard v0
**Type:** feature · **Points:** 5
**AC:**
- Tiles: sales today, collected today, gap, aging exposure, pending approvals, stock alerts.
- Drill-down from each tile to source list.

### LDS-103 — AR aging dashboard
**Type:** feature · **Points:** 5
**AC:**
- Bucket summary, top overdue table, per-customer drill-down to invoices → ledger entries.

### LDS-104 — Inventory health dashboard
**Type:** feature · **Points:** 5
**AC:**
- SKU × warehouse grid with physical/sellable/free.
- Near-expiry queue, dead-stock (>90d no movement), low-stock alerts.

---

## E12 — Observability, CI/CD, staging

### LDS-110 — CI pipeline (lint, test, build, migrate)
**Type:** chore · **Points:** 3
**AC:**
- GitHub Actions or GitLab CI.
- PR blocks on failing tests.
- Migration dry-run on every PR.

### LDS-111 — Staging environment
**Type:** chore · **Points:** 5
**AC:**
- Managed Postgres, Redis, object store.
- Seeded with demo org + 50 customers + 100 products.
- Reset script runs nightly.

### LDS-112 — Observability baseline
**Type:** chore · **Points:** 3
**AC:**
- Structured logs shipped to centralized store (Loki/CloudWatch/etc.).
- Prometheus metrics for API p95, error rate, DB connections.
- Sentry for exception capture.

### LDS-113 — Backup & restore runbook
**Type:** chore · **Points:** 2
**AC:**
- Nightly logical backup to offsite bucket.
- Documented restore procedure tested once in staging.

---

## Cross-cutting acceptance tests (end of Phase 1)

1. **Full order-to-invoice loop:** admin creates customer → places order → credit approves → invoice posts → ledger updated → customer_credit_state reflects correctly.
2. **Credit block path:** over-limit order held → admin overrides → audit entry captured.
3. **Stock reservation:** order consumes free stock; cancel releases; invoice post converts reservation to movement.
4. **Lock enforcement:** attempt to update locked invoice fails with expected error.
5. **Payment allocation:** record payment covering 2 invoices; oldest cleared first; status transitions correct.
6. **Cheque bounce:** verify bounced → ledger auto-reversed → customer aging restored.
7. **Approval framework:** non-admin stock adjust queues; owner approves; movement posts.
8. **RBAC scope:** sales rep API call scoped to route only.

---

## Sprint plan (2-week sprints)

### Sprint 1 (weeks 1–2) — Foundation can run
- E1 all · E2 LDS-010, LDS-012 · E3 LDS-020 · E12 LDS-110
- **Outcome:** auth'd admin can log in to empty shell; migrations run in CI.

### Sprint 2 (weeks 3–4) — Masters
- E3 remainder · E4 LDS-030/031/034 · E5 all · E6 LDS-050/051/053/055 · E11 LDS-100/101
- **Outcome:** customers, products, warehouses, initial stock visible in admin web.

### Sprint 3 (weeks 5–6) — Transactions
- E4 LDS-032/033 · E6 LDS-052/054 · E7 all · E8 all · E9 all · E10 all · E11 LDS-102/103/104 · E12 LDS-111/112/113
- **Outcome:** full order→invoice→payment loop works; dashboards show live numbers; staging demo-able.

---

## Risks & mitigations (Phase 1 specific)

| Risk | Mitigation |
|---|---|
| AR ledger running balance races | Advisory lock per customer_id during insert; property tests |
| Stock reservation / release drift | Single atomic service; reconciliation job reports drift nightly |
| Price resolution edge cases bite later | Exhaustive unit test grid before shipping order creation |
| CSV import admin creates bad customers | Strict validation, dry-run preview, rollback on any row error |
| Lock bypass misused | Bypass only via named service method that writes audit entry with `override_reason` |

---

## Out of Phase 1 (explicit non-goals)

- Mobile apps (Phase 2)
- Collections priority list (Phase 2)
- Delivery / trips / POD (Phase 3)
- WhatsApp / UPI / Tally integrations (Phase 5)
- AI reorder suggestions (Phase 4 — rule-based shim only in P1)
- Promo engine (schema only in P1)
- Returns workflow (Phase 3)
