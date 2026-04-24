# Phase 2 — Field Apps & Collections Engine

**Duration:** 6 weeks (weeks 7–12)
**Prereq:** Phase 1 delivered — orders, invoices, payments, AR ledger, audit/locks all working via admin web.
**Goal:** Put the business in the field. Sales Rep app for ordering, Collector app for recovery, offline-first sync, priority engine, owner dashboard v1 with real field data.

**Definition of Done (phase):**
- Sales reps place orders from phones; credit decision surfaces inline.
- Collectors see a deterministic Priority List each morning, log every visit with a mandatory outcome, record payments with proof + GPS + allocation.
- Apps work 8 hours offline without data loss; sync resumes automatically.
- Broken-promise escalation is live; customers auto-hold after N broken promises.
- Owner dashboard v1 shows live sales, collections, exposure, routes, approvals — all from field-captured data.
- Pilot with 2 routes × 3 users for 1 week before GA.

**Team assumption:** 1 backend, 2 mobile (RN or Flutter), 1 frontend (admin web), 0.5 QA, 0.5 PM.

---

## Epic breakdown

| # | Epic | Story points |
|---|---|---|
| E13 | Mobile app skeleton (shared) | 21 |
| E14 | Offline journal + sync engine | 34 |
| E15 | Sales Rep app | 34 |
| E16 | Collector app | 34 |
| E17 | Collections engine (server) | 34 |
| E18 | Priority list engine | 21 |
| E19 | Promise / dispute workflows | 13 |
| E20 | Owner dashboard v1 + alerts | 13 |
| E21 | Notifications (push/SMS/WA) | 13 |
| E22 | Pilot, training, telemetry | 13 |
| **Total** | | **230** |

---

## E13 — Mobile app skeleton (shared)

### LDS-200 — Choose stack + monorepo integration
**Type:** chore · **Points:** 3
**AC:**
- Decision: React Native (Expo EAS) or Flutter. Default: **React Native + TS** for shared types with web.
- `/mobile` package in monorepo; shared zod schemas from `/packages/shared`.
- Android build via EAS; iOS deferred unless requested.

### LDS-201 — Auth flow (phone + OTP) with biometric re-auth
**Type:** feature · **Points:** 3
**AC:**
- Phone → OTP → token stored in secure storage.
- Biometric/PIN unlock after 5 min idle; no re-login needed for 30 days.
- Device registered on login; force-logout on admin deactivate.

### LDS-202 — App shell: nav, role routing, offline indicator
**Type:** feature · **Points:** 3
**AC:**
- Role from token decides default tab (Sales → Route; Collector → Priority; Driver → Trip).
- Persistent offline/sync badge in header (Synced · Syncing · Offline).

### LDS-203 — Design system (mobile primitives)
**Type:** feature · **Points:** 5
**AC:**
- Button, Input, Money, Aging bar, Outcome picker, Photo capture, Signature pad, GPS stamp.
- Thumb-zone layout; primary CTAs anchored bottom.
- Haptic feedback on commit actions.

### LDS-204 — Local DB (SQLite) + encrypted storage
**Type:** feature · **Points:** 5
**AC:**
- SQLite via op-sqlite/WatermelonDB for journal + cache.
- AES-encrypted with key from secure enclave.
- On logout: wipe local DB.

### LDS-205 — GPS + photo + voice capture utilities
**Type:** feature · **Points:** 3
**AC:**
- GPS helper returns lat/lng/accuracy; mock mode for dev.
- Photo pipeline: capture → compress (long edge 1600px, 80% jpeg) → enqueue for upload.
- Voice note: record → local mp3 → transcribe (server-side whisper/STT, Phase 4 optional).

### LDS-206 — Crash / analytics SDK
**Type:** chore · **Points:** 2
**AC:**
- Sentry + custom analytics events (visit_started, order_submitted, payment_recorded).

---

## E14 — Offline journal + sync engine

### LDS-210 — Journal event schema + local storage
**Type:** feature · **Points:** 5
**AC:**
- Every mutating action writes a `JournalEvent` row (event_id UUID, type, occurred_at, payload, gps, status).
- UI reads from local projections, not the journal directly.
- Server state and journal events never mix in one view.

### LDS-211 — Optimistic UI with local projections
**Type:** feature · **Points:** 5
**AC:**
- After writing event, local projection table updated immediately.
- Pending badge on entities until server confirms.
- On reject: projection reverts, user sees clear error toast.

### LDS-212 — Push sync (batched, idempotent)
**Type:** feature · **Points:** 5
**AC:**
- `POST /sync/push` with up to 50 events per batch.
- Exponential backoff on failure; respects server `Retry-After`.
- `event_id` is the idempotency key — replay-safe.

### LDS-213 — Pull sync with watermark
**Type:** feature · **Points:** 5
**AC:**
- `GET /sync/pull?since=...` returns changed entities relevant to user scope.
- Scope filter on server: rep gets own route's customers + own orders; collector gets assigned customers + open invoices.
- Delta only; no full table dumps after first bootstrap.

### LDS-214 — Conflict resolution rules
**Type:** feature · **Points:** 5
**AC:**
- Server is authoritative. Rules:
  - Payment: if server already has payment with same idempotency_key → accept once, reject duplicates silently.
  - Visit outcome edit on already-closed visit → reject with `conflict_reason=visit_closed_by_other`.
  - Order submission on a now-held customer → reject `customer_held`.
- Every rejection returned to client with human-readable reason.

### LDS-215 — Bootstrap & hydration (first login)
**Type:** feature · **Points:** 3
**AC:**
- First login pulls scoped snapshot: own customers (max 500), own open invoices, product catalog, routes.
- Progress UI; can abort and retry.
- Subsequent logins use incremental pull.

### LDS-216 — Background sync on network change
**Type:** feature · **Points:** 3
**AC:**
- Auto-sync when connectivity regained.
- Foreground-sync every 60s if connected; paused when app backgrounded.
- Battery-friendly: no polling when no pending events and no stale pull.

### LDS-217 — Sync health UI (for troubleshooting)
**Type:** feature · **Points:** 3
**AC:**
- Hidden debug screen (long-press version): pending count, last pull ts, last errors, manual resync, export logs.

---

## E15 — Sales Rep app

### LDS-220 — Today's Route home (A1)
**Type:** feature · **Points:** 3
**AC:**
- Route-ordered customer list for today (from `routes.days_of_week`).
- Badges: overdue, reorder-due, hold.
- Progress bar: visits done vs planned; orders booked total.

### LDS-221 — Customer 360 mobile (A2)
**Type:** feature · **Points:** 5
**AC:**
- Consumes `GET /customers/{id}/360`; cached offline.
- Aging strip, last visit outcome, outstanding, tabs for Orders / Payments.
- Tap-to-call, WhatsApp deeplink.

### LDS-222 — Reorder suggestion (rule-based)
**Type:** feature · **Points:** 5
**AC:**
- Server computes likely basket from last 3 orders (top SKUs × rounded avg qty).
- Flag `due_for_reorder=true` if days since last order ≥ median gap × 0.8.
- Rep can accept whole basket or edit before placing.

### LDS-223 — New Order screen (A3) with live credit banner
**Type:** feature · **Points:** 8
**AC:**
- SKU search, favorites pinned, van-stock visible (when collector+rep=driver, else warehouse stock).
- Live credit banner recomputes as qty changes (local pre-check; server revalidates).
- OOS handling: substitute suggestions surfaced inline.
- Submit → receives `OrderCreateResult` with confirmed/held/rejected.

### LDS-224 — Order list + status for rep
**Type:** feature · **Points:** 3
**AC:**
- My orders today; filter by status; drill-down to credit reasons if held.

### LDS-225 — Log a non-order visit
**Type:** feature · **Points:** 3
**AC:**
- Rep can record a visit with outcome `not_available` / `no_order` / `competitor_stock` without placing order.
- GPS check-in captured.

### LDS-226 — "My Day" KPIs
**Type:** feature · **Points:** 2
**AC:**
- Visits done, orders booked (₹), conversion rate, distance covered.
- Compared against target if configured.

### LDS-227 — Price list + promo display
**Type:** feature · **Points:** 3
**AC:**
- Customer's applicable price shown on each SKU.
- Active promos flagged on products (display-only in P2; engine Phase 4).

### LDS-228 — Repeat-last-order shortcut
**Type:** feature · **Points:** 2
**AC:**
- Button on 360 → opens order screen prefilled with last order's lines.

---

## E16 — Collector app

### LDS-240 — Priority List home (B1)
**Type:** feature · **Points:** 5
**AC:**
- Sections: Promises Due Today · Overdue 30+ · High Value · Route Order · Missed Visits.
- Ranked per §LDS-260 engine.
- Pull-to-refresh; works offline (cached list from morning sync).

### LDS-241 — Customer Collection screen (B2)
**Type:** feature · **Points:** 5
**AC:**
- Open invoices with checkboxes for multi-select allocation.
- Running selected-total updates live.
- Four primary actions: Collect · Promise · Dispute · Not Available.

### LDS-242 — Collect Payment screen (B3)
**Type:** feature · **Points:** 8
**AC:**
- Mode picker: Cash / Cheque / UPI / Bank.
- Mode-specific fields (cheque: no/date/bank; UPI: ref).
- Proof photo mandatory above configurable threshold (default ₹10,000 for cash).
- GPS auto-attached; timestamp locked to device trust clock (server re-checks skew).
- Allocation across invoices with "Apply remaining" helper; unallocated becomes advance.

### LDS-243 — Visit outcome commit flow
**Type:** feature · **Points:** 3
**AC:**
- Every visit must be closed with an outcome from the enum.
- Voice memo optional; note optional.
- Local validation: cannot close without outcome.

### LDS-244 — Promise create screen
**Type:** feature · **Points:** 3
**AC:**
- Amount (pre-filled to outstanding, editable), promised date (calendar).
- Warns if customer already has an open promise.

### LDS-245 — Dispute capture
**Type:** feature · **Points:** 3
**AC:**
- Select affected invoice(s), reason free text, photo upload.
- Auto-flags customer as `dispute`; releases on resolution.

### LDS-246 — End-of-Day reconciliation (B4)
**Type:** feature · **Points:** 5
**AC:**
- Shows cash collected (computed), collector enters cash deposited + deposit slip photo.
- Variance auto-computed; non-zero requires note.
- Cheques collected listed; cannot close EOD while sync has pending events.

### LDS-247 — Route map view (stops with pins)
**Type:** feature · **Points:** 3
**AC:**
- Map with customer pins colored by status.
- Optional; lite fallback is list view.

### LDS-248 — Collector "My Day" KPIs
**Type:** feature · **Points:** 2
**AC:**
- Visits, collections (₹), conversion, promises kept/broken, vs target.

### LDS-249 — Tap-to-call + WhatsApp + last visit timeline
**Type:** feature · **Points:** 2
**AC:**
- One-tap actions from any customer screen.
- Timeline shows last 10 visits with outcome badges.

---

## E17 — Collections engine (server)

### LDS-260 — Visit lifecycle service
**Type:** feature · **Points:** 5
**AC:**
- `POST /visits` opens; `PATCH /visits/{id}` closes with outcome.
- Reject close without outcome.
- On close: update `customer_credit_state.last_visit_at`.

### LDS-261 — Payment recording atomic flow
**Type:** feature · **Points:** 8
**AC:**
- Single transaction: insert payment, insert allocations, write AR ledger credits per allocation, recompute invoice outstanding + status, refresh customer_credit_state, lock payment.
- Idempotent on `idempotency_key`.
- Allocation sum validated via deferred trigger (already in DDL).

### LDS-262 — Cheque lifecycle
**Type:** feature · **Points:** 5
**AC:**
- States: `pending` → `verified` | `bounced`.
- Bounce: auto-reverse AR ledger entries, invoice outstanding restored, customer flagged for follow-up, notification dispatched.
- Audit trail for each state change.

### LDS-263 — Advance payment handling
**Type:** feature · **Points:** 3
**AC:**
- Unallocated payment becomes an advance (credit balance on customer).
- Future invoices auto-allocate advance first (configurable).
- Visible on customer 360 as "Advance ₹X available".

### LDS-264 — Collector EOD service
**Type:** feature · **Points:** 3
**AC:**
- Computes expected cash (mode=cash on the day); accepts deposited + slip.
- Creates `collector_eod` row; variance ≠ 0 creates approval request to admin.
- Blocks next-day Priority list load if previous EOD not closed (configurable grace period).

### LDS-265 — GPS anomaly detection
**Type:** feature · **Points:** 3
**AC:**
- Flag visits where GPS is >500m from customer geo (tunable).
- Flag payments where collector GPS is far from customer.
- Surface flags in owner dashboard under "Field anomalies".

### LDS-266 — Dispute → hold linkage
**Type:** feature · **Points:** 2
**AC:**
- On dispute raised: invoice status → `disputed`; customer `dispute` flag set until resolved.
- Resolved disputes restore invoice to `open/partial/paid` based on ledger state.

---

## E18 — Priority list engine

### LDS-270 — Scoring function (pure)
**Type:** feature · **Points:** 5
**AC:**
- `score(customer) = w1*overdue_amount + w2*age_weight + w3*value_weight + w4*broken_promises_factor`.
- Weights in config table, tunable without deploy.
- Unit-tested with fixed inputs → stable ranks.

### LDS-271 — Nightly generation job
**Type:** feature · **Points:** 5
**AC:**
- 02:00 org-local: recompute aging → refresh `customer_credit_state` → generate per-collector priority list for today.
- List stored as materialized snapshot (`priority_list_daily`) so field app reads are O(1).
- Re-run idempotent.

### LDS-272 — Priority API
**Type:** feature · **Points:** 3
**AC:**
- `GET /collections/priority?collector_id=...` returns today's list with reason per entry.
- Supports manual reorder by collector (saved locally, not server).

### LDS-273 — Missed visit detection
**Type:** feature · **Points:** 3
**AC:**
- If customer in yesterday's priority wasn't visited → bumped into today's "Missed Visit" band.
- After 3 consecutive misses → flag on owner dashboard.

### LDS-274 — Priority debug view (admin)
**Type:** feature · **Points:** 3
**AC:**
- Admin can inspect why a customer is / is not on a collector's list with score breakdown.
- Essential for tuning weights.

### LDS-275 — High-value customer flag
**Type:** feature · **Points:** 2
**AC:**
- Admin can mark customers `high_value=true` (or auto-flag by annual revenue threshold).
- Adds fixed boost to score.

---

## E19 — Promise / dispute workflows

### LDS-280 — Promise lifecycle
**Type:** feature · **Points:** 3
**AC:**
- States: `open` → `kept` | `broken` | `cancelled`.
- Kept: on payment ≥ promised amount on/before date.
- Broken: nightly job marks `broken` the day after date.
- Cancelled: only if customer makes another promise that supersedes.

### LDS-281 — Broken promise escalation
**Type:** feature · **Points:** 3
**AC:**
- Counter maintained in `customer_credit_state.broken_promises_30d`.
- ≥ N (default 3) → auto-set `status=hold`, reason "repeated broken promises".
- Owner notified.

### LDS-282 — Promise reminders (push/SMS)
**Type:** feature · **Points:** 3
**AC:**
- Morning of promise day: push to collector, SMS to customer (configurable templates).
- Evening: if not kept, reminder next morning before auto-break.

### LDS-283 — Dispute resolution UI (admin web)
**Type:** feature · **Points:** 4
**AC:**
- Disputes inbox; filter by customer, age, amount.
- Resolve with outcome: `full_credit_note`, `partial_credit`, `invalid_dispute`.
- Writes credit note (if any) via Phase 1 service.

---

## E20 — Owner dashboard v1 + alerts

### LDS-290 — Live KPIs (sales today, collected today)
**Type:** feature · **Points:** 3
**AC:**
- Computed from today's invoices and payments; refreshed every 60s or on websocket push.
- Gap = sales − collected, highlighted red if gap > configurable threshold.

### LDS-291 — Overdue exposure panel (D1)
**Type:** feature · **Points:** 3
**AC:**
- Aging bars from `customer_credit_state` aggregate.
- Drill-down to top risky customers (sorted by score).

### LDS-292 — Routes live panel
**Type:** feature · **Points:** 3
**AC:**
- Per active trip/route: stops done vs planned, collections captured, last GPS ping.
- Lightweight server-sent events; no heavy websocket infra required yet.

### LDS-293 — Broken promises / field anomalies alerts
**Type:** feature · **Points:** 3
**AC:**
- Panel: today's broken promises, GPS anomalies, EOD variances.
- Tap to open underlying record.

### LDS-294 — Owner mobile approval inbox (D2)
**Type:** feature · **Points:** 2
**AC:**
- Owner app (or admin web mobile-responsive) shows pending approvals with approve/reject.
- Reuses Phase 1 framework.

---

## E21 — Notifications

### LDS-300 — Push notification infra (FCM)
**Type:** feature · **Points:** 3
**AC:**
- Registration on login; topic per role + per user.
- Server helper `notify(user_id, template, context)`.

### LDS-301 — SMS gateway integration
**Type:** feature · **Points:** 3
**AC:**
- Pluggable provider (MSG91/Twilio).
- Templates stored in DB; variable interpolation.
- Rate limiting + DLR callbacks.

### LDS-302 — WhatsApp Business API (read-only templates)
**Type:** feature · **Points:** 4
**AC:**
- Outbound templates only in P2 (customer statement, payment receipt, promise reminder).
- Inbound / chatbot deferred to Phase 5.
- Approved templates registered with Meta.

### LDS-303 — Notification preferences per user
**Type:** feature · **Points:** 3
**AC:**
- Admin and user can toggle categories (assignments, approvals, promise reminders).
- DND window per user.

---

## E22 — Pilot, training, telemetry

### LDS-310 — Feature flags + org-level rollout
**Type:** chore · **Points:** 3
**AC:**
- Flags for field apps, priority engine, notifications.
- Org-scoped so pilot route can opt in without affecting others.

### LDS-311 — In-app training tooltips
**Type:** feature · **Points:** 3
**AC:**
- First-run coach marks for Sales rep and Collector apps.
- Replayable from Settings.

### LDS-312 — Admin pilot console
**Type:** feature · **Points:** 2
**AC:**
- Enable/disable features per user/route.
- Dry-run toggle for priority engine.

### LDS-313 — Field telemetry dashboard
**Type:** feature · **Points:** 3
**AC:**
- Events per user, sync lag distribution, reject reasons, crash-free sessions %.
- Used to decide GA readiness.

### LDS-314 — Pilot runbook + training materials
**Type:** chore · **Points:** 2
**AC:**
- Short printable one-pagers per role.
- 15-minute video walkthroughs.
- Escalation hotline for pilot week.

---

## Cross-cutting acceptance tests (end of Phase 2)

1. **Full field day offline:** rep and collector go offline at 08:00, place 8 orders and record 12 payments by 18:00, reconnect → all events apply cleanly, zero data loss, zero duplicates.
2. **Idempotent payment:** same payment submitted twice (network retry) → server stores once; client projection consistent.
3. **Conflict flow:** two collectors attempt payment on same invoice within 1s → first wins, second receives specific rejection with actionable message.
4. **Priority determinism:** given fixed customer state at 02:00, generated list is identical across re-runs.
5. **Broken-promise auto-hold:** customer breaks 3 promises in 30 days → status flips to hold, order creation blocked end-to-end.
6. **Cheque bounce reversal:** verified bounced → ledger reversed, invoice aging restored, customer re-enters priority list next cycle.
7. **GPS anomaly:** visit captured >1km from customer geo → flagged on owner dashboard with drill-down.
8. **EOD gate:** collector cannot close Day 2 priority before Day 1 EOD reconciled.
9. **Advance allocation:** unallocated ₹5000 recorded → next invoice auto-consumes from advance first.
10. **Notification fan-out:** payment recorded → customer WhatsApp receipt sent + owner push for values > configured threshold.

---

## Sprint plan (2-week sprints)

### Sprint 4 (weeks 7–8) — Rails & Rep app
- E13 all · E14 LDS-210/211/212/213/215 · E15 LDS-220/221/223/224 · E22 LDS-310
- **Outcome:** Rep can place orders from phone online-only; sync push/pull basic.

### Sprint 5 (weeks 9–10) — Collections core
- E14 LDS-214/216/217 · E15 LDS-222/225/226/227/228 · E16 LDS-240/241/242/243/244/245 · E17 LDS-260/261/262/263 · E18 LDS-270/271/272
- **Outcome:** Collector app records payments with proof; priority engine generating lists nightly; offline-first works for full 8h day.

### Sprint 6 (weeks 11–12) — Intelligence, pilot, polish
- E16 LDS-246/247/248/249 · E17 LDS-264/265/266 · E18 LDS-273/274/275 · E19 all · E20 all · E21 all · E22 LDS-311/312/313/314
- **Outcome:** Promise/dispute workflows live, owner dashboard v1 complete, pilot ran on 2 routes for full week, GA decision.

---

## Risks & mitigations (Phase 2 specific)

| Risk | Mitigation |
|---|---|
| Field users bypass structured outcomes (pick "not_available" to avoid work) | Supervisor KPI on outcome distribution; photo/GPS auto-captured makes fake visits expensive |
| Clock skew on cheap Android devices poisons timestamps | Server re-stamps `received_at`; anomaly flag when device time drifts > 5 min |
| Duplicate payments via retry storms | Client-side `event_id` UUID enforced server-side; UI disables submit button post-tap |
| Sync conflict storms after bad day | Sync health screen + manual "resync all" flow with server-side trace IDs |
| Priority list feels random to collectors | Score breakdown visible to supervisors; tunable weights; first-week pilot to calibrate |
| FCM push quotas / WhatsApp template rejections | SMS fallback; quiet degrade when channels fail |
| Battery / data usage complaints in field | Image compression, delta-only pull, background tasks only on wifi/charger when possible |

---

## Out of Phase 2 (explicit non-goals)

- Driver app + trips + POD → **Phase 3**
- Returns workflow → Phase 3
- AI-based reorder / churn scoring → Phase 4
- Route optimization (TSP/OR-Tools) → Phase 4
- Inbound WhatsApp conversations / chatbot → Phase 5
- UPI collection via gateway (auto-reconcile UPI txns) → Phase 5
- Tally / Zoho sync → Phase 5
- iOS build → post-GA unless requested
