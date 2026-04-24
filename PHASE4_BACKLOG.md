# Phase 4 — Control, Intelligence & Optimization

**Duration:** 6 weeks (weeks 17–22)
**Prereq:** Phases 1–3 in GA with 3+ months of field data (orders, payments, visits, deliveries, returns).
**Goal:** Stop reacting, start deciding. Turn the operational data accumulated in Phases 1–3 into closed-loop intelligence: risk-scored credit, predicted reorders, optimized routes, proactive dead-stock alerts, structured approvals that actually reduce exception volume. All features here are **derived** — they cost nothing to build until the data exists, and everything here fails safely back to the v1 rules when a model is untrained or a signal is thin.

**Definition of Done (phase):**
- Every customer has a rolling risk score that demonstrably outperforms the Phase 1 heuristic on held-out data (measured: overdue-conversion prediction AUC).
- Reorder suggestions land in sales-rep and admin-ordering flows with accept-rate ≥ 35% on pilot routes.
- Route optimization reduces trip distance and/or stop sequence time by measurable margin on A/B-tested routes.
- Dead-stock and churn alerts fire proactively; ≥ 1 business outcome attributable per week (price drop, transfer, outreach).
- Approval matrix matures: threshold-based auto-approvals for low-risk cases reduce admin inbox by ≥ 50%.
- All intelligence features have a kill switch and a fallback path.

**Team assumption:** 1 backend, 1 data/ML, 1 frontend, 0.5 mobile, 0.5 QA, 0.5 PM.

---

## Epic breakdown

| # | Epic | Story points |
|---|---|---|
| E33 | Data foundation (warehouse, features) | 21 |
| E34 | Customer risk scoring | 21 |
| E35 | Reorder intelligence (demand prediction) | 21 |
| E36 | Churn detection & win-back | 13 |
| E37 | Dead stock, fast mover, near-expiry analytics | 13 |
| E38 | Reorder point & PO suggestions | 13 |
| E39 | Route optimization | 21 |
| E40 | Approval matrix maturation | 13 |
| E41 | Collector productivity intelligence | 13 |
| E42 | Owner intelligence dashboard | 13 |
| E43 | Experimentation, pilot, rollback | 13 |
| **Total** | | **175** |

---

## E33 — Data foundation

### LDS-600 — ClickHouse (or DuckDB/warehouse) analytics store
**Type:** chore · **Points:** 5
**AC:**
- Analytics warehouse provisioned alongside Postgres.
- Decision: ClickHouse (scale) or Postgres-with-cron rollups (simplicity). Default: ClickHouse for event-heavy features.
- Retention policy per table documented.

### LDS-601 — CDC pipeline Postgres → warehouse
**Type:** chore · **Points:** 5
**AC:**
- Debezium (or logical replication + Airbyte) streams: `ar_ledger`, `stock_movements`, `payments`, `collection_visits`, `sales_orders`, `invoices`, `deliveries`, `returns`, `sync_events`.
- Delivery-once or at-least-once with idempotent upserts.
- Lag < 2 min p95, alerted on breach.

### LDS-602 — Feature store (tables + materialization job)
**Type:** feature · **Points:** 5
**AC:**
- Tables: `feat_customer_daily`, `feat_product_daily`, `feat_route_daily`, `feat_collector_daily`.
- Daily materialization at 03:00; backfill script for history.
- Schema versioned; consumers pin feature_version.

### LDS-603 — Online feature lookup API
**Type:** feature · **Points:** 3
**AC:**
- `GET /features/customer/{id}` → served from Redis snapshot updated nightly.
- p95 < 20ms; models read online features, not warehouse.

### LDS-604 — Model registry + serving shell
**Type:** feature · **Points:** 3
**AC:**
- Registry (MLflow or lightweight table): model name, version, metrics, training data hash, deployed_at.
- Serving via simple internal service `POST /models/{name}/predict` with model loaded in-memory.
- Shadow-predict mode (predict + log, don't surface) for any new model.

---

## E34 — Customer risk scoring

### LDS-610 — Feature engineering for risk
**Type:** feature · **Points:** 5
**AC:**
- Features per customer: aging-bucket shares, last-30d/90d payment ratios, promise-kept rate, cheque-bounce rate, dispute frequency, avg days-to-pay, seasonality markers, credit utilization trajectory.
- Unit-tested for null handling (new customers with thin history).

### LDS-611 — Risk model v1 (gradient-boosted)
**Type:** feature · **Points:** 5
**AC:**
- Target: will customer have any invoice cross 30-day bucket in next 30 days?
- Model: LightGBM/XGBoost; calibrated probabilities (Platt/isotonic).
- Train/val/test split by time (no leakage).
- Ship only if AUC ≥ 0.75 on held-out test and calibration within acceptable bands.

### LDS-612 — Risk score writeback + SLAs
**Type:** feature · **Points:** 3
**AC:**
- Daily batch writes `customer_credit_state.risk_score` (replaces heuristic when model active).
- Fallback to heuristic if model serving unavailable; flagged in response.
- Change log persisted: (customer_id, old_score, new_score, date, reasons_top3).

### LDS-613 — Risk explainability (SHAP top-3 reasons)
**Type:** feature · **Points:** 3
**AC:**
- Each score accompanied by top 3 contributing features (e.g., "broken promise last 14d, rising 30+ bucket, cheque bounce Q2").
- Shown in admin customer detail; drives collector conversations.

### LDS-614 — Shadow-run against v1 heuristic
**Type:** feature · **Points:** 3
**AC:**
- Both scores computed daily for 2 weeks; decisions logged without acting.
- Compare decisions that would have differed (approve vs hold).
- GA only after pilot owner review.

### LDS-615 — Risk-driven credit action triggers
**Type:** feature · **Points:** 2
**AC:**
- Score ≥ 0.8 (high risk) → recommend credit limit reduction (admin approval).
- Score dropping ≥ 0.3 sustained 30 days → recommend credit limit increase.
- Suggestions only — owner decides.

---

## E35 — Reorder intelligence

### LDS-620 — Customer × SKU purchase history features
**Type:** feature · **Points:** 3
**AC:**
- Per (customer, sku): last order date, median interval, trailing-90d qty, trend slope, day-of-week pattern.
- Seasonal SKUs (festival, summer) flagged via simple heuristic.

### LDS-621 — Reorder prediction model
**Type:** feature · **Points:** 5
**AC:**
- For each (customer, sku) active in last 90d: predict P(order in next 7 days) and expected qty.
- Model: survival analysis or simple Poisson / gradient-boosted regression per SKU band.
- Metric: accept-rate of suggestions, not just statistical fit.

### LDS-622 — Suggestion API (replaces rule-based shim)
**Type:** feature · **Points:** 3
**AC:**
- `GET /customers/{id}/suggestions` returns ranked basket with qty + confidence.
- Fallback to Phase 2 rule-based if model unavailable.

### LDS-623 — Rep app accept/edit/reject telemetry
**Type:** feature · **Points:** 3
**AC:**
- Every suggestion interaction logged (accepted / edited-qty / rejected / ignored).
- Feeds back into training data for next retrain.

### LDS-624 — "Due for reorder" push digest
**Type:** feature · **Points:** 3
**AC:**
- Daily 08:00 push to reps: top 5 customers predicted to order today, with basket preview.
- Opens straight into rep-app order screen.

### LDS-625 — Admin-ordering mode (call customer to suggest)
**Type:** feature · **Points:** 4
**AC:**
- Admin/telecaller screen: list of predicted-to-order customers with suggested basket and phone.
- Tap-to-call → record call outcome → place order on behalf.
- Useful for customers reps can't visit daily.

---

## E36 — Churn detection & win-back

### LDS-630 — Churn definition + labeling
**Type:** feature · **Points:** 2
**AC:**
- Churn = customer active in 90d window 1, zero orders in next 60d.
- Labels generated daily; stored in feature store.

### LDS-631 — Churn risk score
**Type:** feature · **Points:** 5
**AC:**
- Same model pattern as risk scoring; target = churn label.
- Output: `churn_probability_60d` per active customer.

### LDS-632 — Win-back campaigns
**Type:** feature · **Points:** 3
**AC:**
- Admin can define campaigns (e.g., "high-churn-risk last 30d") → produces call/visit list.
- Campaign participation logged; retention outcome tracked.

### LDS-633 — Competitor stock signal capture
**Type:** feature · **Points:** 3
**AC:**
- Rep-app optional field: "competitor stocked?" + brand.
- Feeds churn model as a strong leading signal.

---

## E37 — Dead stock, fast mover, near-expiry

### LDS-640 — Inventory analytics rollups
**Type:** feature · **Points:** 3
**AC:**
- Per (warehouse × product): daily velocity (7d, 30d, 90d), days-of-supply, days-since-last-sale, expiry cliff.
- Views exposed to admin dashboard.

### LDS-641 — Dead-stock alert engine
**Type:** feature · **Points:** 3
**AC:**
- Flag SKUs with 0 sales in 90 days and qty > 0.
- Suggested action: transfer / promote / discount.
- Owner dashboard widget.

### LDS-642 — Near-expiry proactive action
**Type:** feature · **Points:** 3
**AC:**
- 60/30/14 day expiry tiers; 14-day tier triggers mandatory action prompt.
- Actions: promo discount / transfer to high-velocity warehouse / write-off preview.

### LDS-643 — Fast-mover stockout risk
**Type:** feature · **Points:** 2
**AC:**
- SKUs with days-of-supply < lead-time → red alert even if above static reorder point.

### LDS-644 — ABC classification
**Type:** feature · **Points:** 2
**AC:**
- Products auto-classified A/B/C by revenue contribution (80/15/5).
- Visible in admin catalog; drives reorder priority and stocking rules.

---

## E38 — Reorder point & PO suggestions

### LDS-650 — Dynamic reorder point
**Type:** feature · **Points:** 5
**AC:**
- ROP = (avg_daily_demand × lead_time) + safety_stock(service_level, demand_std).
- Per (warehouse × product); recomputed weekly.
- Override per product allowed.

### LDS-651 — PO suggestion engine
**Type:** feature · **Points:** 5
**AC:**
- Daily: for products at/below ROP, suggest qty to reach target (economic order qty or simple target days of supply).
- Grouped by supplier; admin approves → creates PO draft.

### LDS-652 — PO module v1
**Type:** feature · **Points:** 3
**AC:**
- Minimal: draft → sent → received (with goods receipt linking to `stock_batches`).
- Supplier master added; payments to suppliers out of scope (accounting sync later).

---

## E39 — Route optimization

### LDS-660 — Geocoding fill-in + validation
**Type:** feature · **Points:** 3
**AC:**
- Nightly job geocodes customers missing `geo`; flags mismatches (address vs geo > 500m).
- Admin tool to bulk-correct.

### LDS-661 — TSP-style stop sequencing
**Type:** feature · **Points:** 5
**AC:**
- OR-Tools (or similar) solver for stop sequence given start (warehouse) + end (warehouse) + time windows if any.
- Distance + drive-time from real matrix (OSRM or maps API).
- Respects fixed-order constraints (e.g., wholesale customer must be first).

### LDS-662 — Optimization service + admin integration
**Type:** feature · **Points:** 5
**AC:**
- Dispatch screen (Phase 3) gains "Optimize sequence" button.
- Shows before/after distance + time saved; admin accepts or keeps manual order.
- Telemetry logs accept rate.

### LDS-663 — A/B experiment: optimized vs manual
**Type:** feature · **Points:** 3
**AC:**
- Randomly half the days: run optimized; other half: manual.
- Compare total trip duration, stops completed, collections per trip.
- Report weekly.

### LDS-664 — Multi-drop / consolidation planning (v0)
**Type:** feature · **Points:** 5
**AC:**
- Given set of orders and available vehicles, suggest allocation minimizing total distance subject to capacity.
- v0 scope: single-depot, single-day, no time windows.

---

## E40 — Approval matrix maturation

### LDS-670 — Threshold-based auto-approvals
**Type:** feature · **Points:** 3
**AC:**
- Config: approval type → auto-approve if below threshold AND below risk band.
- E.g., credit override auto-approved if order < ₹X and risk < 0.3.
- Audit entry marks "auto_approved".

### LDS-671 — Delegation of approvals
**Type:** feature · **Points:** 2
**AC:**
- Owner can delegate approval rights (time-bounded) to admin.
- All delegated approvals logged with original delegator.

### LDS-672 — Approval SLA tracking
**Type:** feature · **Points:** 2
**AC:**
- Time-to-decide tracked; overdue approvals surfaced prominently.
- Impacts owner dashboard if approvals are blocking field work.

### LDS-673 — Bulk approvals
**Type:** feature · **Points:** 3
**AC:**
- Admin/owner can multi-select and approve/reject with common reason.
- Capped at 50 at a time to prevent accidental mass approval.

### LDS-674 — Approval policy audit
**Type:** feature · **Points:** 3
**AC:**
- Monthly report: auto-approvals count, outcomes (did any go bad?), overrides that turned out wrong.
- Used to recalibrate thresholds.

---

## E41 — Collector productivity intelligence

### LDS-680 — Collector scorecards
**Type:** feature · **Points:** 3
**AC:**
- Per collector: visits/day, conversion rate, amount collected, promise-kept rate, GPS anomaly count.
- Ranked and comparable; visible to owner and the collector (transparent).

### LDS-681 — Optimal visit-time suggestions
**Type:** feature · **Points:** 3
**AC:**
- From historical successful visit times per customer: suggest best hour-window.
- Shown on priority list when confidence is high.

### LDS-682 — Route load balancing
**Type:** feature · **Points:** 4
**AC:**
- If collector overloaded (priority list > capacity), suggest redistribution to peers with available capacity.
- Manual accept; audit entry for reassignment.

### LDS-683 — Field anomaly drill-down
**Type:** feature · **Points:** 3
**AC:**
- Owner clicks anomaly → sees GPS map, visit timeline, recent collector history.
- Supports disciplinary or training decisions.

---

## E42 — Owner intelligence dashboard

### LDS-690 — Leading vs lagging indicators
**Type:** feature · **Points:** 3
**AC:**
- Expand Phase 2 dashboard with forward-looking panels: churn at risk, predicted collections next 7d, expected shortfall vs target.

### LDS-691 — Weekly business review (auto-digest)
**Type:** feature · **Points:** 3
**AC:**
- Email/WhatsApp digest every Monday 08:00: last week KPIs, anomalies, wins, risks, top actions.
- Owner can reply "acknowledge" to clear.

### LDS-692 — Customer segmentation
**Type:** feature · **Points:** 3
**AC:**
- Auto-segments: Champions, Loyal, At-Risk, Dormant, New.
- Per-segment KPIs; feeds campaigns.

### LDS-693 — Margin & profitability view
**Type:** feature · **Points:** 4
**AC:**
- Per customer / SKU / route: revenue, cost, gross margin.
- Flags loss-making customers (if cost-to-serve high vs gross margin).

---

## E43 — Experimentation, pilot, rollback

### LDS-700 — Feature flag hardening for ML features
**Type:** feature · **Points:** 3
**AC:**
- Each intelligence feature behind its own flag with % rollout.
- Kill switch flips back to v1 heuristic instantly.

### LDS-701 — Experiment framework
**Type:** feature · **Points:** 5
**AC:**
- Assign cohorts (customers, routes, reps) to arms (control, treatment).
- Metric collection + stat-sig calculator.
- Used for route opt, reorder suggestions, auto-approvals.

### LDS-702 — Model monitoring
**Type:** feature · **Points:** 3
**AC:**
- Track feature drift, prediction distribution, downstream accept-rate.
- Page on drift > threshold.

### LDS-703 — Pilot on 2 routes, retro, GA decision
**Type:** chore · **Points:** 2
**AC:**
- Agreed pilot metrics, 2-week run, owner sign-off before org-wide rollout.

---

## Cross-cutting acceptance tests (end of Phase 4)

1. **Risk model impact:** credit decisions on holdout month correlate with actual defaults; heuristic-vs-model shadow report shows material disagreement on high-risk tail, with model being right more often.
2. **Reorder suggestion lift:** pilot routes show ≥ 35% suggestion accept rate and ≥ 10% uplift in basket size vs control.
3. **Route optimization:** A/B test shows measurable trip-time reduction on optimized days; accept rate of optimized sequences ≥ 60%.
4. **Auto-approval safety:** auto-approved credit overrides have default rate no higher than manually-approved ones; audit passes.
5. **Dead stock resolution:** ≥ 1 dead-stock SKU per week triggers admin action (discount/transfer); inventory health trends positive.
6. **Churn win-back:** 30% of high-churn-risk customers in campaign are retained vs control group.
7. **Kill switch:** disabling any intelligence feature via flag reverts behavior to Phase 3 within 60s with no user-visible breakage.
8. **Model staleness:** staleness > 14 days triggers alert; predictions continue with warning banner, no silent degradation.
9. **Shadow mode reliability:** 2-week shadow log shows model predictions written without any production side effect.
10. **Explainability:** every high-stakes decision (hold customer, auto-approve override) has human-readable reasons surfaced on audit entry.

---

## Sprint plan (2-week sprints)

### Sprint 9 (weeks 17–18) — Data foundation + risk v1
- E33 all · E34 LDS-610/611/612/614 · E40 LDS-670 · E43 LDS-700
- **Outcome:** Warehouse + CDC + feature store live. Risk model in shadow mode. First auto-approval threshold live behind flag.

### Sprint 10 (weeks 19–20) — Reorder + inventory intelligence
- E34 LDS-613/615 · E35 all · E37 all · E38 all · E41 LDS-680/681 · E43 LDS-701
- **Outcome:** Reorder suggestions live on pilot routes. Dead stock + near-expiry + ROP flowing through admin workflows.

### Sprint 11 (weeks 21–22) — Routes, churn, owner intelligence, GA
- E36 all · E39 all · E40 LDS-671/672/673/674 · E41 LDS-682/683 · E42 all · E43 LDS-702/703
- **Outcome:** Route optimization A/B running. Churn/win-back flows active. Owner intelligence dashboard delivered. Pilot complete, GA decision.

---

## Risks & mitigations (Phase 4 specific)

| Risk | Mitigation |
|---|---|
| Not enough data for models to generalize | Require minimum 3 months × 2 routes before training; gracefully fall back to Phase 1 heuristics |
| Model says "hold", field feels punished → backlash | Ship with top-3 reasons always; collector and rep see what they can do to change score; no black-box holds |
| Route optimization ignores field knowledge (shortcuts, customer preferences) | Always suggest, never force; dispatcher has final say; learn from overrides |
| Auto-approvals mask real risk | Monthly audit of auto-approved outcomes; threshold recalibration loop |
| Suggestion fatigue (reps see 20 suggestions, act on 1) | Cap to top N, confidence-weighted; telemetry on ignored suggestions drives retirement of low-value ones |
| Privacy/data governance on customer behavior scoring | Access controls (who can see risk score), retention policy, explicit owner acknowledgment of scoring before GA |
| ML feature drift silently degrades predictions | Drift monitors + auto-disable if metric drops below threshold; model versioning for rollback |
| Team treats ML as set-and-forget | Ownership assigned per model; quarterly review calendared |

---

## Out of Phase 4 (explicit non-goals)

- External integrations (WhatsApp inbound chat, UPI auto-reconcile, Tally/Zoho sync) → **Phase 5**
- e-invoice / tax e-way bill generation → Phase 5
- Customer self-service portal → Phase 5
- Multi-depot consolidated planning (>1 warehouse per trip) → Phase 5+
- Deep-learning price optimization, dynamic pricing → future
- Computer vision on POD images → future
- Full financial accounting module → never (use Tally/Zoho integration)
- Voice ordering via WhatsApp bot → Phase 5 or later
