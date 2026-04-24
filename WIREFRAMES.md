# Liquor Distribution OS — Wireframes (ASCII)

Mobile screens are 360×640 reference. All wireframes use monospace ASCII for handoff to design team who will render in Figma.

Legend: `[Button]` · `{input}` · `«tab»` · `▼` dropdown · `●` badge · `▓▓░` progress/aging

---

## PART A — SALES REP APP

### A1. Home / Today's Route
```
┌──────────────────────────────┐
│ ← Ravi · Route-A · Mon       │
├──────────────────────────────┤
│ TODAY                         │
│ Visits 8/14   Orders ₹42,300  │
│ ▓▓▓▓▓▓░░░░░░ 57%              │
├──────────────────────────────┤
│ NEXT STOPS                    │
│ ┌─────────────────────────┐   │
│ │ 1· Shree Wines    ● OVERDUE │
│ │    Last order 9d ago    │   │
│ │    Due for reorder      │   │
│ └─────────────────────────┘   │
│ ┌─────────────────────────┐   │
│ │ 2· Bar Grande           │   │
│ │    Credit: ₹12k / ₹50k  │   │
│ └─────────────────────────┘   │
│ ┌─────────────────────────┐   │
│ │ 3· Hotel Taj   ● HOLD   │   │
│ │    Blocked — 2 disputes │   │
│ └─────────────────────────┘   │
│                               │
│ [ + New Order ]  [ Customers ]│
└──────────────────────────────┘
```

### A2. Customer 360
```
┌──────────────────────────────┐
│ ← Shree Wines          ⋮     │
│ Gandhi Rd · Route-A           │
│ ☎ 98xxxx  💬 WhatsApp         │
├──────────────────────────────┤
│ OUTSTANDING    ₹ 38,400       │
│ 0-7 ░░  8-15 ▓░  16-30 ▓▓▓    │
│ 31+  ▓▓▓▓▓                    │
├──────────────────────────────┤
│ «360» «Orders» «Payments»     │
├──────────────────────────────┤
│ DUE FOR REORDER (9d since)    │
│ Suggested basket:             │
│  · Kingfisher 650ml ×5 cases  │
│  · Bacardi 750ml   ×2 cases   │
│  · Tuborg 500ml    ×3 cases   │
│ [ Review & Place Order → ]    │
├──────────────────────────────┤
│ LAST VISIT  3d ago · Collector│
│ Outcome: Promise ₹10k on 16th │
└──────────────────────────────┘
  [Call] [WA] [Order] [Log Visit]
```

### A3. New Order
```
┌──────────────────────────────┐
│ ← Order · Shree Wines         │
├──────────────────────────────┤
│ 🟢 Credit OK   ₹11,600 / ₹50k │
├──────────────────────────────┤
│ 🔎 {search SKU}               │
│ ★ Customer favorites          │
│ ┌─────────────────────────┐   │
│ │ Kingfisher 650ml · Case │   │
│ │ ₹2,400/case · 22 in van │   │
│ │           [− 5 +]       │   │
│ └─────────────────────────┘   │
│ ┌─────────────────────────┐   │
│ │ Bacardi 750ml · Case    │   │
│ │ ₹8,100/case · OOS van   │   │
│ │   ● Substitute offered  │   │
│ └─────────────────────────┘   │
│                               │
│ Subtotal   ₹12,000            │
│ Tax        ₹  2,160           │
│ Total      ₹14,160            │
├──────────────────────────────┤
│ [  Review & Submit  ]         │
└──────────────────────────────┘
```

### A4. Credit Hold Banner (when over limit)
```
┌──────────────────────────────┐
│ 🔴 CREDIT EXCEEDED            │
│ Order ₹60k · Available ₹11.6k │
│ Options:                      │
│  [ Reduce order ]             │
│  [ Request approval ]         │
│  [ Cash-only order ]          │
└──────────────────────────────┘
```

---

## PART B — COLLECTOR APP

### B1. Priority List (Home)
```
┌──────────────────────────────┐
│ ← Sanjay · Today's Priority   │
│ Target ₹1.2L · Collected ₹35k │
├──────────────────────────────┤
│ ● PROMISE DUE TODAY (3)       │
│ ┌─────────────────────────┐   │
│ │ Hotel Meridian          │   │
│ │ Promised ₹25,000 today  │   │
│ │ Total due ₹48,200       │   │
│ │ Last visit: 5d ago      │   │
│ └─────────────────────────┘   │
│ ● OVERDUE 30+ (5)             │
│ ┌─────────────────────────┐   │
│ │ Shree Wines             │   │
│ │ Due ₹22,400 · 42d       │   │
│ └─────────────────────────┘   │
│ ● HIGH VALUE (2)              │
│ ...                           │
├──────────────────────────────┤
│ [ Route Map ]  [ End of Day ] │
└──────────────────────────────┘
```

### B2. Customer Collection Screen
```
┌──────────────────────────────┐
│ ← Hotel Meridian              │
│ Outstanding  ₹48,200          │
├──────────────────────────────┤
│ OPEN INVOICES                 │
│ ☑ INV-1042  ₹18,000  32d      │
│ ☑ INV-1078  ₹12,200  18d      │
│ ☐ INV-1103  ₹18,000   7d      │
│                               │
│ Selected total: ₹30,200       │
├──────────────────────────────┤
│ [  💰 Collect  ]              │
│ [  📅 Promise ]               │
│ [  ⚠  Dispute ]               │
│ [  ⏭  Not available ]         │
└──────────────────────────────┘
```

### B3. Collect Payment
```
┌──────────────────────────────┐
│ ← Collect · Hotel Meridian    │
├──────────────────────────────┤
│ Amount  ₹ {25,000}            │
│ Mode    [Cash ▼]              │
│   ○ Cash   ● Cheque           │
│   ○ UPI    ○ Bank             │
│                               │
│ Cheque No  {123456}           │
│ Cheque Dt  {20 Apr 2026}      │
│ Bank       {HDFC}             │
│                               │
│ 📷 Proof   [ Capture photo ]  │
│ 📍 GPS     auto-attached ✓    │
│                               │
│ ALLOCATE                      │
│ INV-1042  ₹18,000  [apply all]│
│ INV-1078  ₹ 7,000  [  part  ] │
│ Unallocated ₹0                │
├──────────────────────────────┤
│ [  Record Payment  ]          │
└──────────────────────────────┘
```

### B4. End of Day Reconciliation
```
┌──────────────────────────────┐
│ ← End of Day · 14 Apr 2026    │
├──────────────────────────────┤
│ Cash collected      ₹42,000   │
│ Cash deposited      ₹ {?}     │
│ Variance                ₹?    │
│                               │
│ Cheques collected  4 · ₹ 86k  │
│   [ View list ]               │
│                               │
│ Visits  12 (P 3 · C 7 · D 1 · NA 1) │
├──────────────────────────────┤
│ [  Close Day & Submit  ]      │
└──────────────────────────────┘
```

---

## PART C — DRIVER APP

### C1. Today's Trip
```
┌──────────────────────────────┐
│ ← Trip T-0412 · Route-A       │
│ Vehicle MH-14-XX-1234         │
│ Stops 2/12 · 10 remaining     │
├──────────────────────────────┤
│ [ Van Stock ]   [ Map ]       │
├──────────────────────────────┤
│ NEXT STOP                     │
│ ┌─────────────────────────┐   │
│ │ 3· Bar Grande           │   │
│ │ INV-1104 · ₹22,400      │   │
│ │ 8 lines · 11 cases      │   │
│ │ [  Start Delivery  →  ] │   │
│ └─────────────────────────┘   │
│                               │
│ UPCOMING                      │
│ 4· Hotel Park   INV-1106      │
│ 5· Shree Wines  INV-1107      │
└──────────────────────────────┘
```

### C2. Delivery Screen
```
┌──────────────────────────────┐
│ ← Bar Grande · INV-1104       │
├──────────────────────────────┤
│ LINES                         │
│ Kingfisher 650ml              │
│   Ordered 5 · Delivered [5]   │
│ Bacardi 750ml                 │
│   Ordered 2 · Delivered [1]   │
│   Shortage reason [OOS van ▼] │
│ Tuborg 500ml                  │
│   Ordered 3 · Delivered [3]   │
├──────────────────────────────┤
│ POD                           │
│ 📷 Photo   [ Capture ]        │
│ ✍ Signature [ Sign ]          │
├──────────────────────────────┤
│ [  Confirm Delivery  ]        │
└──────────────────────────────┘
```

### C3. Van Reconciliation (end of trip)
```
┌──────────────────────────────┐
│ ← Close Trip T-0412           │
├──────────────────────────────┤
│ SKU          Load  Sold  Left │
│ Kingfisher   40    32    8    │
│ Bacardi      15     9    6    │
│ Tuborg       30    30    0    │
│ ...                           │
│                               │
│ Returns: 2 cases (damage)     │
│ Variance: 0 units             │
├──────────────────────────────┤
│ [  Submit & Return to WH  ]   │
└──────────────────────────────┘
```

---

## PART D — OWNER APP (mobile)

### D1. Owner Home
```
┌──────────────────────────────┐
│ ← Dashboard · 14 Apr          │
├──────────────────────────────┤
│ TODAY                         │
│ Sales      ₹ 4,82,000         │
│ Collected  ₹ 2,31,000         │
│ Gap        ₹ 2,51,000         │
├──────────────────────────────┤
│ OVERDUE EXPOSURE              │
│ 0-7  ▓▓░░░░  ₹ 1.2L           │
│ 8-15 ▓▓▓░░   ₹ 0.9L           │
│ 16-30 ▓▓▓▓░  ₹ 1.4L           │
│ 30+  ▓▓▓▓▓▓  ₹ 3.8L   🔴      │
│ [ Top risky accounts → ]      │
├──────────────────────────────┤
│ APPROVALS (2)        >        │
│ STOCK ALERTS (5)     >        │
│ BROKEN PROMISES (3)  >        │
├──────────────────────────────┤
│ ROUTES LIVE                   │
│ A ▓▓▓▓▓░ 8/12                 │
│ B ▓▓░░░░ 4/10                 │
│ C ░░░░░░ not started          │
└──────────────────────────────┘
```

### D2. Approval Inbox
```
┌──────────────────────────────┐
│ ← Approvals                   │
├──────────────────────────────┤
│ CREDIT OVERRIDE               │
│ Shree Wines                   │
│ Order ₹60k · Available ₹11.6k │
│ Rep: Ravi · Reason: "festival │
│ stock, will clear in 7d"      │
│ [ Approve ]  [ Reject ]       │
├──────────────────────────────┤
│ STOCK ADJUSTMENT              │
│ Warehouse-1 · Kingfisher -12  │
│ Reason: "breakage audit"      │
│ [ Approve ]  [ Reject ]       │
└──────────────────────────────┘
```

---

## PART E — ADMIN WEB (desktop, 1440px)

### E1. Admin Layout
```
┌─────────────────────────────────────────────────────────────┐
│ LIQUOR OS   Customers  Orders  Invoices  Collections  Stock │
│             Routes  Reports  Settings                  🔔 👤 │
├─────────────────────────────────────────────────────────────┤
│ LEFT NAV         │   MAIN CONTENT                            │
│ · Dashboard      │   [filters row]                           │
│ · Customers      │                                           │
│ · Credit Mgmt    │   [data table with inline actions]        │
│ · Orders         │                                           │
│ · Invoicing      │                                           │
│ · Collections    │                                           │
│ · Disputes       │                                           │
│ · Inventory      │                                           │
│ · Trips          │                                           │
│ · Users & Roles  │                                           │
│ · Audit Log      │                                           │
└─────────────────────────────────────────────────────────────┘
```

### E2. AR Aging (drill-down)
```
┌─────────────────────────────────────────────────────────────┐
│ AR AGING            Route ▼  Collector ▼  Export ⤓           │
├─────────────────────────────────────────────────────────────┤
│ Bucket    Customers   Amount        %                        │
│ 0-7          142      ₹  4,20,000   12%                      │
│ 8-15         98       ₹  6,80,000   19%                      │
│ 16-30        74       ₹  8,40,000   24%                      │
│ 31-60        52       ₹ 10,20,000   29%  🔴                  │
│ 60+          28       ₹  5,80,000   16%  🔴                  │
├─────────────────────────────────────────────────────────────┤
│ TOP OVERDUE                                                   │
│ Customer         Outstanding  Aging   Collector  Promise     │
│ Hotel Meridian   ₹  88,000    45d     Sanjay     ✓ today     │
│ Shree Wines      ₹  62,400    42d     Sanjay     broken ×2   │
│ Bar Grande       ₹  48,900    38d     Ramesh     —           │
│ [ → open customer ]                                           │
└─────────────────────────────────────────────────────────────┘
```

### E3. Invoice Detail (with audit)
```
┌─────────────────────────────────────────────────────────────┐
│ INV-1042   Shree Wines   ₹18,000   Status: PARTIAL   🔒      │
├─────────────────────────────────────────────────────────────┤
│ LINES                                                         │
│ Kingfisher 650ml   5 cs   ₹2,400    ₹12,000                  │
│ Tuborg 500ml       3 cs   ₹1,600    ₹ 4,800                  │
│ Tax                                 ₹ 1,200                  │
├─────────────────────────────────────────────────────────────┤
│ ALLOCATIONS (2)                                               │
│ Payment P-0987  ₹10,000  14 Mar  Sanjay                      │
│ Payment P-1005  ₹ 3,000  22 Mar  Sanjay                      │
│ Remaining                  ₹ 5,000                           │
├─────────────────────────────────────────────────────────────┤
│ AUDIT                                                         │
│ 14 Mar 09:12 · Invoice posted · Priya                        │
│ 14 Mar 18:40 · Locked                                        │
│ 22 Mar 11:03 · Payment allocated P-1005 · Priya              │
└─────────────────────────────────────────────────────────────┘
```

### E4. Inventory Health
```
┌─────────────────────────────────────────────────────────────┐
│ INVENTORY                 Warehouse ▼  Category ▼            │
├─────────────────────────────────────────────────────────────┤
│ SKU             Physical  Sellable  Free   Expiry  Status   │
│ Kingfisher 650  420       410       380    ok      FAST     │
│ Bacardi 750      88        88        75    ok      FAST     │
│ Old Monk 750    210       210       210    <60d    NEAR-EXP │
│ RedLabel 1L       8         8         8    ok      LOW 🟠   │
│ Jägermeister      0         0         0    —       OOS 🔴   │
│ HauntedOak       52        52        52    >180d   DEAD     │
├─────────────────────────────────────────────────────────────┤
│ REORDER SUGGESTIONS (3)                                      │
│ RedLabel 1L   velocity 12/day · stockout in 1d · qty 60     │
│ [ Approve & Create PO ]                                      │
└─────────────────────────────────────────────────────────────┘
```

---

## PART F — SHARED COMPONENTS

### F1. Credit Exposure Strip (reusable)
```
 0-7  ▓░░░░░  ₹ 1.2L
 8-15 ▓▓░░░   ₹ 0.9L
 16-30 ▓▓▓░░  ₹ 1.4L
 30+   ▓▓▓▓▓  ₹ 3.8L  🔴
```

### F2. Visit Outcome Picker
```
[✅ Collected]  [🟡 Partial]  [📅 Promise]
[⚠  Dispute ]  [🚪 Absent]   [❌ Refused]
```

### F3. Offline Sync Indicator
```
States:
  ● Synced · last 12s
  ◐ Syncing · 3 pending
  ○ Offline · 14 pending — auto-sync when online
```

---

## PART G — FLOW MAPS (textual)

### Order → Delivery → Collection
```
[Rep A3] → submit → [Credit Engine]
                      ├ OK → Order confirmed → Invoice draft
                      └ hold → [Owner D2] approve → continue
                            ↓
                   [Driver C1 C2] deliver → POD → Invoice posted (locked)
                            ↓
                   [Collector B1] priority list on due date
                            ↓
                   [Collector B2 B3] collect → allocate → locked
                            ↓
                   [AR ledger updated · customer_credit_state refreshed]
```

### Broken Promise Escalation
```
[Promise created B2]
   ↓ (due date passes without payment)
[Nightly job] → mark broken → increment counter
   ├ counter < 3 → raise priority on collector's list
   └ counter ≥ 3 → auto-hold customer + notify [Owner D1]
```
