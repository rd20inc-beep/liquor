# Phase 3 — Delivery, Trips & Returns

**Duration:** 4 weeks (weeks 13–16)
**Prereq:** Phase 1 (foundation + AR) and Phase 2 (field apps, sync, collections engine) in GA.
**Goal:** Close the physical loop. Drivers load vans from warehouses, run sequenced trips, confirm deliveries with POD, capture shortages and returns at the doorstep, reconcile the van at end of trip. Invoicing moves from "posted on order" (rare in this business) to "posted on actual delivered qty" — because what was loaded is not always what was delivered.

**Definition of Done (phase):**
- Admin plans trips from confirmed orders; stock is moved warehouse → van atomically.
- Driver app runs a sequenced day; each delivery produces a POD (signature + photo) and actual per-line delivered qty.
- Shortages and refusals are captured with reason codes and routed to returns/credit-note flow.
- Van reconciliation at end of trip is mandatory — loaded = delivered + returned + remaining, any gap surfaces an anomaly.
- Invoice totals reconcile to delivered qty, not ordered qty. AR ledger updated from delivery events.
- Owner dashboard shows live route progress with stop-level drill-down.
- Pilot on 2 trips × 1 week; GA follows.

**Team assumption:** 1 backend, 1 mobile (driver app), 1 frontend (admin web for dispatch), 0.5 QA, 0.5 PM.

---

## Epic breakdown

| # | Epic | Story points |
|---|---|---|
| E23 | Trip planning & dispatch (admin) | 21 |
| E24 | Van load-out & stock movement | 13 |
| E25 | Driver app | 34 |
| E26 | Delivery confirmation & POD | 21 |
| E27 | Shortages, refusals, substitutions | 13 |
| E28 | Returns & damages workflow | 21 |
| E29 | Van reconciliation & trip close | 13 |
| E30 | Invoice posting from delivery | 13 |
| E31 | Live route tracking & owner view | 8 |
| E32 | Pilot, training, GA | 8 |
| **Total** | | **165** |

---

## E23 — Trip planning & dispatch (admin)

### LDS-400 — Trip create from confirmed orders
**Type:** feature · **Points:** 5
**AC:**
- Admin selects date + route + vehicle + driver.
- System lists confirmed orders matching route/date; admin picks which to include.
- Generates `trips` row + `deliveries` rows with sequence pre-filled from `route_stops`.
- Idempotent on `(vehicle_id, trip_date)` — duplicate create returns existing trip.

### LDS-401 — Manual stop reorder + insert ad-hoc stop
**Type:** feature · **Points:** 3
**AC:**
- Drag-to-reorder stops before load-out.
- Insert ad-hoc stop (customer not on route) with justification note.
- Once trip status ≥ `loaded`, stop list is locked (edits via approval).

### LDS-402 — Trip planning board (dispatch screen)
**Type:** feature · **Points:** 5
**AC:**
- Admin web board: columns per vehicle for the day.
- Drag orders onto vehicles; capacity indicator vs `vehicles.capacity_cases`.
- Over-capacity warning (non-blocking).

### LDS-403 — Order → trip assignment tracking
**Type:** feature · **Points:** 2
**AC:**
- Every confirmed order shows which trip (if any) is carrying it.
- Unassigned confirmed orders surfaced daily as "pending dispatch" alert.

### LDS-404 — Trip manifest PDF
**Type:** feature · **Points:** 3
**AC:**
- Printable manifest: vehicle, driver, stop sequence, invoices, line totals, totals to collect (if cash route).
- Driver can sign physical copy as backup.

### LDS-405 — Trip cancel / reassign
**Type:** feature · **Points:** 3
**AC:**
- Cancel before load-out: releases reservations, notifies rep.
- Reassign driver/vehicle before `in_progress`; audit entry required.
- After `in_progress`: cancel is blocked; only stops can be individually marked failed.

---

## E24 — Van load-out & stock movement

### LDS-410 — Pick list generation (FEFO)
**Type:** feature · **Points:** 5
**AC:**
- From trip's deliveries, aggregate required qty per product.
- Use `pickBatches` helper (Phase 1) to pick FEFO batches from warehouse.
- Pick list printable; scanner flow optional (barcode scan → increment picked).

### LDS-411 — Load-out: atomic transfer warehouse → van
**Type:** feature · **Points:** 5
**AC:**
- `POST /trips/{id}/load` with batch-level qty.
- Atomic: stock_movements pair (warehouse out, van in), batch qty updated on both sides, trip status → `loaded`.
- Loaded snapshot persisted on trip (`loaded_manifest_json`) so reconciliation has ground truth.
- Reversible only before `in_progress` via explicit cancel.

### LDS-412 — Loading anomaly detection
**Type:** feature · **Points:** 3
**AC:**
- Flag if loaded qty ≠ required qty per product (either direction).
- Underload → partial delivery risk, warned on dispatch.
- Overload → potential skimming, requires justification note.

---

## E25 — Driver app

### LDS-420 — Trip home (C1)
**Type:** feature · **Points:** 3
**AC:**
- Shows today's trip with stops in sequence and progress counter.
- Tabs: Stops · Van Stock · Map.
- Cannot start next stop before current stop closed (configurable for flexibility).

### LDS-421 — Van Stock view
**Type:** feature · **Points:** 3
**AC:**
- Per-SKU loaded / delivered / remaining live totals.
- Per-batch breakdown expandable.
- Offline — driven from local load snapshot + local delivery events.

### LDS-422 — Stop detail / delivery start
**Type:** feature · **Points:** 3
**AC:**
- Customer info, invoice/order, total value, lines with ordered qty.
- "Start Delivery" sets delivery status `in_progress`, captures arrival GPS + timestamp.

### LDS-423 — Delivery screen (C2)
**Type:** feature · **Points:** 5
**AC:**
- Per-line editable `delivered_qty` defaulted to ordered qty.
- Reducing qty requires shortage reason from enum (OOS on van / refused by customer / damaged / customer not needed).
- Totals recompute live.

### LDS-424 — POD capture
**Type:** feature · **Points:** 5
**AC:**
- Signature pad (customer signs on device).
- Photo of delivered goods / receipt mandatory (at least 1).
- Cannot confirm delivery without both.
- Uploads enqueued to sync engine, even when delivered offline.

### LDS-425 — Cash-on-delivery capture (for cash customers)
**Type:** feature · **Points:** 5
**AC:**
- If customer's payment term = `cash` or `same_day`: collect flow inlined inside delivery.
- Reuses Phase 2 payment service.
- Driver's cash bucket updated; reconciled at trip close or handed to collector.

### LDS-426 — Substitution at door
**Type:** feature · **Points:** 3
**AC:**
- If customer accepts a substitute SKU, driver swaps line (bounded to admin-allowed substitutions per product).
- Generates audit entry; invoice posted reflects actual SKU.

### LDS-427 — Failed stop / customer not available
**Type:** feature · **Points:** 3
**AC:**
- Delivery status `failed` with reason (not_available / refused_full / shop_closed / wrong_address).
- Goods return to van (stay on loaded qty).
- Admin notified; order auto-rescheduled or released per config.

### LDS-428 — Offline mode parity
**Type:** feature · **Points:** 3
**AC:**
- All screens work offline; deliveries confirmed produce journal events like Phase 2 payments.
- Uploads (POD images, signatures) queue and upload opportunistically.

### LDS-429 — In-stop collection handoff
**Type:** feature · **Points:** 2
**AC:**
- If collector is co-riding with driver: driver marks "collector will collect" on invoices; collector gets immediate priority on their app for this customer.

---

## E26 — Delivery confirmation & POD

### LDS-440 — Delivery confirm API (atomic)
**Type:** feature · **Points:** 5
**AC:**
- `POST /deliveries/{id}/confirm` (from openapi.yaml) runs atomically:
  - Update delivery status & per-line delivered_qty.
  - Persist POD image + signature URLs.
  - Write stock_movements (van out → customer, reason=sale).
  - Trigger invoice posting (E30) with actual delivered qty.
  - Update customer_credit_state.last_delivery_at.
- Idempotent on `idempotency_key`.

### LDS-441 — POD media upload service
**Type:** feature · **Points:** 3
**AC:**
- Pre-signed upload URLs for signature + photo to object store.
- Background re-upload if initial attempt failed.
- Media linked via URLs in delivery record — never embedded in DB.

### LDS-442 — POD quality checks
**Type:** feature · **Points:** 3
**AC:**
- Photo dimensions / file size bounds; reject bogus (0-byte, all-black).
- Signature stroke-count sanity check — reject empty signature.
- Flags (not hard blocks) feed owner anomaly panel.

### LDS-443 — Delivery timeline on customer 360
**Type:** feature · **Points:** 3
**AC:**
- Past deliveries with POD thumbnails, driver name, delivered qty vs ordered, any shortages.
- Long-press POD to view full image.

### LDS-444 — Partial delivery handling
**Type:** feature · **Points:** 4
**AC:**
- If delivered_qty < ordered_qty for any line → delivery status = `partial`.
- Invoice posts at delivered qty only.
- Remaining qty: admin config → either reorder draft / drop / keep open on order.

### LDS-445 — POD retrieval endpoints (accounts)
**Type:** feature · **Points:** 3
**AC:**
- Accounts can fetch POD for any invoice (for dispute defense).
- Searchable by invoice, customer, date range, driver.

---

## E27 — Shortages, refusals, substitutions

### LDS-450 — Shortage reason codes & config
**Type:** feature · **Points:** 3
**AC:**
- Enum: `oos_van`, `refused_partial`, `refused_full`, `damaged_in_transit`, `wrong_qty_loaded`, `other`.
- Each reason mapped to downstream action (release stock / create return / flag load error).
- Config table so reasons are editable without deploy.

### LDS-451 — Shortage reconciliation logic
**Type:** feature · **Points:** 5
**AC:**
- `oos_van` → flag load-out error (ticket for dispatcher).
- `refused_*` → goods remain on van; return to warehouse at trip close.
- `damaged_in_transit` → move qty to damaged pool on van; credit note flow at trip close.
- `wrong_qty_loaded` → variance booked against warehouse at trip close.

### LDS-452 — Substitution allow-list
**Type:** feature · **Points:** 3
**AC:**
- Per-product substitution map (brand equivalents) maintained by admin.
- Driver can only swap within allow-list; else needs admin approval (which breaks offline, so rare).

### LDS-453 — Refusal escalation
**Type:** feature · **Points:** 2
**AC:**
- Customer refusing full order triggers alert to rep + admin with reason captured.
- Auto-opens a dispute if amount > threshold (configurable).

---

## E28 — Returns & damages

### LDS-460 — Return capture at delivery
**Type:** feature · **Points:** 5
**AC:**
- From delivery screen, driver records "customer returning old stock" with product, qty, reason (expired/damaged/short-dated).
- Photo mandatory for damaged returns.
- Creates `returns` row; goods loaded back into van as damaged/returned pool.

### LDS-461 — Scheduled pickup flow (separate from delivery)
**Type:** feature · **Points:** 3
**AC:**
- Admin can schedule a pickup-only visit (no delivery invoice).
- Trip planner shows pickup stops with blue pin.
- Same capture flow as LDS-460.

### LDS-462 — Return receipt at warehouse (trip close)
**Type:** feature · **Points:** 3
**AC:**
- On trip close, van's damaged/returned pool transfers to warehouse damaged-stock location.
- Stock movements logged: van → warehouse (reason=return/damage).

### LDS-463 — Credit note draft for returns
**Type:** feature · **Points:** 5
**AC:**
- Return auto-drafts credit note at current invoice price.
- Requires admin approval before posting (reuses Phase 1 approval framework).
- On approve: AR ledger credit, customer outstanding reduced, return row linked to CN.

### LDS-464 — Damage write-off flow
**Type:** feature · **Points:** 3
**AC:**
- Damaged goods at warehouse: admin posts write-off (stock_adjust with reason=damage).
- Cost hit booked; feeds loss analytics in Phase 4 dashboards.

### LDS-465 — Return reason analytics
**Type:** feature · **Points:** 2
**AC:**
- Breakdown by reason per SKU, per route, per customer.
- Surfaces quality / logistics / customer-abuse patterns.

---

## E29 — Van reconciliation & trip close

### LDS-470 — Reconciliation math service
**Type:** feature · **Points:** 5
**AC:**
- For each product on trip: `loaded = sum(delivered) + sum(returned_to_wh) + remaining_on_van`.
- Variance per product computed; 0 tolerance in v1 (rounded to units).
- Variance details persisted on trip.

### LDS-471 — Close-trip UI (C3)
**Type:** feature · **Points:** 3
**AC:**
- Grid: SKU | Loaded | Sold | Returned | Left | Variance.
- Non-zero variance rows highlighted; driver must enter note per variance.
- Submit → trip status `closed`.

### LDS-472 — Trip close server flow
**Type:** feature · **Points:** 5
**AC:**
- Requires: all deliveries in final status, all POD media uploaded, cash bucket matches deliveries collected (if applicable).
- Transfers remaining van stock back to warehouse (stock_movements pair).
- Closes trip; triggers EOD approval if variance > 0.
- Admin can force-close with approval (audit entry).

---

## E30 — Invoice posting from delivery

### LDS-480 — Shift invoice-post trigger to delivery confirm
**Type:** feature · **Points:** 5
**AC:**
- Invoice no longer auto-posts on order confirmation (unless cash-and-carry warehouse pickup).
- On delivery confirm: invoice generated using delivered_qty per line; posted + locked.
- Orders that never deliver → no invoice; reservation released on trip close.

### LDS-482 — Proforma vs tax invoice distinction
**Type:** feature · **Points:** 3
**AC:**
- On order confirm → proforma (PDF only, no AR entry).
- On delivery confirm → tax invoice with fresh invoice_no, AR entry, statutory sequence.
- Proforma number retained on invoice for trace.

### LDS-483 — Invoice correction via return / credit note
**Type:** feature · **Points:** 3
**AC:**
- Invoice remains locked; any correction flows through credit note.
- UI shows invoice + related CNs as a single "effective net" view on customer 360.

### LDS-484 — Sequence / compliance checks
**Type:** feature · **Points:** 2
**AC:**
- Gapless invoice numbering per org per financial year (DB sequence + FY prefix).
- Rejected deliveries do not burn numbers.

---

## E31 — Live route tracking & owner view

### LDS-490 — Driver GPS pings (opt-in)
**Type:** feature · **Points:** 3
**AC:**
- Driver app sends location every 2 minutes while trip in progress (battery-safe).
- Disabled outside trip hours; privacy-respecting.

### LDS-491 — Route progress on owner dashboard
**Type:** feature · **Points:** 3
**AC:**
- Extends Phase 2 owner dashboard with per-trip drill-down.
- Map view with driver pin, completed (green), current (blue), pending (grey) stops.

### LDS-492 — ETA to customer (WhatsApp link)
**Type:** feature · **Points:** 2
**AC:**
- Customer receives a link showing ETA + driver name + vehicle (optional per customer).
- Link expires 24h after delivery.

---

## E32 — Pilot, training, GA

### LDS-500 — Pilot enablement via feature flag
**Type:** chore · **Points:** 2
**AC:**
- Dispatch + driver app gated per org/route; can roll back without app update.

### LDS-501 — Driver training one-pager + video
**Type:** chore · **Points:** 2
**AC:**
- 10-minute walkthrough: load-out, deliveries, returns, trip close.
- Escalation hotline for pilot week.

### LDS-502 — Pilot telemetry
**Type:** feature · **Points:** 2
**AC:**
- Median trip close variance per driver, POD upload success rate, shortage reason distribution, avg stop duration.
- Used to decide GA readiness.

### LDS-503 — Back-office runbook
**Type:** chore · **Points:** 2
**AC:**
- What to do when: driver app crashes mid-trip, POD upload stuck, variance dispute, trip force-close, wrong customer delivered.

---

## Cross-cutting acceptance tests (end of Phase 3)

1. **Full trip loop:** admin plans trip → load-out → 8 deliveries (2 partial, 1 failed, 1 with return) → van reconciled → invoices posted reflect delivered qty exactly → AR aging accurate.
2. **Idempotent delivery confirm:** same confirm retried → single invoice, no duplicate ledger entries, stock moved once.
3. **Offline trip:** driver goes offline at stop #2, completes remaining stops offline with PODs, reconnects at trip close → all deliveries sync, images upload, invoices post correctly.
4. **Shortage reconciliation:** `oos_van` shortage on a line → load-error ticket created; `refused_full` → goods return to warehouse on trip close; damaged → credit note drafted.
5. **Return with credit note:** driver records return of 2 cases → admin approves CN → invoice outstanding reduced → customer aging reflects in real time.
6. **Van reconciliation enforcement:** driver tries to close trip with 1-unit variance and no note → blocked. With note → closes + approval request created.
7. **Gapless invoice sequence:** cancelled delivery does not consume invoice number; numbering verified across 100 trips.
8. **Partial delivery invoice:** ordered 10 cases, delivered 7 → invoice posts at 7 × price; 3 cases handling per config (reorder drafted / dropped).
9. **Substitution at door:** allow-listed swap recorded → invoice shows substitute SKU + audit entry.
10. **POD retrieval for dispute:** accounts pulls POD for a disputed invoice within 2 clicks.

---

## Sprint plan (2-week sprints)

### Sprint 7 (weeks 13–14) — Planning & Load-out
- E23 all · E24 all · E25 LDS-420/421/422/423 · E26 LDS-440/441 · E32 LDS-500
- **Outcome:** admin can plan + load trips; driver can see trip and open a delivery online.

### Sprint 8 (weeks 15–16) — Confirm, reconcile, post, pilot
- E25 LDS-424/425/426/427/428/429 · E26 LDS-442/443/444/445 · E27 all · E28 all · E29 all · E30 all · E31 all · E32 LDS-501/502/503
- **Outcome:** end-to-end trip loop works including offline, returns, reconciliation, and invoice-from-delivery. Pilot ran for 1 week.

---

## Risks & mitigations (Phase 3 specific)

| Risk | Mitigation |
|---|---|
| Driver skips POD photo to save time | POD mandatory; cannot progress to next stop without both signature + photo |
| Van variance becomes normalized ("always 1-2 off") | Variance trends tracked per driver; supervisor review ≥ 3 variances in a week |
| Invoice numbering gaps under partial rollbacks | Gapless sequence with pre-allocation + compensating entry on rollback; audit for missing numbers nightly |
| Cash-on-delivery handoff between driver and collector | Dual attestation: driver marks handed, collector marks received; mismatch flags |
| Returns abused to reduce outstanding fraudulently | CN requires admin approval; return reason + photo mandatory; repeat returns per customer flagged |
| Load-out race: two trips try to pick same batch | Pessimistic lock on batch row during pick; retry with next FEFO batch |
| POD images stuck in upload queue | Background retry with exponential backoff; "stuck > 24h" alert; bulk re-upload tool |
| Driver app battery drain from GPS + camera | 2-min GPS cadence, only during active trip; photo compression before queue |

---

## Out of Phase 3 (explicit non-goals)

- Route optimization (TSP / OR-Tools) → Phase 4
- Multi-drop consolidation planning → Phase 4
- Customer self-service tracking portal → Phase 5
- Inbound WhatsApp driver ↔ customer chat → Phase 5
- Temperature / seal integrity checks (beverages don't require) → not planned
- Barcode hardware integration → optional Phase 4 if pilot demands
- iOS driver build → post-GA unless requested
