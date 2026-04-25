-- ============================================================================
-- Liquor Distribution OS — PostgreSQL schema v2 (refined)
-- Target: PostgreSQL 15+
-- Conventions:
--   * UUID primary keys (pgcrypto gen_random_uuid)
--   * timestamptz everywhere (server-side UTC, display in org timezone)
--   * money as numeric(14,2); quantities as integer
--   * append-only tables: ar_ledger, stock_movements, audit_log
--   * soft state: customer_credit_state (materialized, refreshed on event)
--   * locks table + trigger gates mutations on posted entities
--   * all FK columns indexed (Postgres does NOT auto-index FKs)
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE user_role            AS ENUM ('sales','collector','driver','accounts','admin','owner');
CREATE TYPE customer_type        AS ENUM ('outlet','bar','hotel','retailer','other');
CREATE TYPE customer_status      AS ENUM ('active','hold','blocked','dispute');
CREATE TYPE payment_term_type    AS ENUM ('cash','same_day','net_7','net_14','net_30','pdc','custom');
CREATE TYPE warehouse_type       AS ENUM ('warehouse','van');
CREATE TYPE stock_move_reason    AS ENUM ('sale','return','transfer','damage','adjust','cycle_count','load_out','load_in','purchase_in','opening_balance');
CREATE TYPE order_status         AS ENUM ('draft','held','approved','confirmed','invoiced','cancelled','fulfilled');
CREATE TYPE credit_decision      AS ENUM ('approve','hold','reject');
CREATE TYPE invoice_status       AS ENUM ('open','partial','paid','disputed','void');
CREATE TYPE ledger_entry_type    AS ENUM ('invoice','payment','credit_note','adjustment','write_off');
CREATE TYPE payment_mode         AS ENUM ('cash','cheque','bank','upi');
CREATE TYPE payment_verification AS ENUM ('pending','deposited','verified','bounced');
CREATE TYPE visit_outcome        AS ENUM ('collected','partial','promise','dispute','not_available','refused');
CREATE TYPE promise_status       AS ENUM ('open','kept','broken','cancelled');
CREATE TYPE trip_status          AS ENUM ('planned','loaded','in_progress','closed','cancelled');
CREATE TYPE delivery_status      AS ENUM ('pending','delivered','partial','failed');
CREATE TYPE approval_status      AS ENUM ('pending','approved','rejected','cancelled');
CREATE TYPE promo_kind           AS ENUM ('buy_x_get_y','case_discount','bundle');
CREATE TYPE sync_event_status    AS ENUM ('pending','accepted','rejected','conflict');
CREATE TYPE approval_type        AS ENUM ('credit_override','stock_adjust','credit_note','price_list','customer_hold_release','van_variance','eod_variance');
CREATE TYPE return_reason        AS ENUM ('damaged','expired','refused','short_dated','other');
CREATE TYPE shortage_reason      AS ENUM ('oos_van','refused_partial','refused_full','damaged_in_transit','wrong_qty_loaded','other');
CREATE TYPE audit_action         AS ENUM ('create','update','delete','override','approve','reject','lock','unlock');

-- ============================================================================
-- CORE: orgs, users, auth, config
-- ============================================================================

CREATE TABLE orgs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    timezone    text NOT NULL DEFAULT 'Asia/Kolkata',
    currency    text NOT NULL DEFAULT 'INR',
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE org_config (
    org_id      uuid PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
    -- credit engine
    risk_threshold         numeric(4,3) NOT NULL DEFAULT 0.600,   -- 0..1; orders held above this
    -- broken promise escalation
    broken_promise_limit   integer NOT NULL DEFAULT 3 CHECK (broken_promise_limit > 0),
    broken_promise_window_days integer NOT NULL DEFAULT 30 CHECK (broken_promise_window_days > 0),
    -- auto-hold after N broken promises
    auto_hold_on_broken    boolean NOT NULL DEFAULT true,
    -- proof image required above this cash amount
    proof_image_threshold  numeric(14,2) NOT NULL DEFAULT 10000,
    -- GPS anomaly distance (meters)
    gps_anomaly_distance_m integer NOT NULL DEFAULT 500 CHECK (gps_anomaly_distance_m > 0),
    -- collector EOD grace period (hours)
    eod_grace_hours        integer NOT NULL DEFAULT 24 CHECK (eod_grace_hours >= 0),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      uuid NOT NULL REFERENCES orgs(id),
    name        text NOT NULL,
    login_id    citext,                         -- human-readable login (e.g. 'admin', 'ahmed')
    phone       text NOT NULL,                  -- kept for future SMS flows
    email       citext,
    role        user_role NOT NULL,
    active      boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, phone)
);
CREATE INDEX users_org_id ON users(org_id);
-- Unique login_id globally (nullable so existing rows without a login remain valid)
CREATE UNIQUE INDEX users_login_id_unique ON users(login_id) WHERE login_id IS NOT NULL;

CREATE TABLE user_devices (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id    text NOT NULL,
    platform     text,
    last_seen_at timestamptz,
    push_token   text,
    UNIQUE (user_id, device_id)
);

CREATE TABLE roles_permissions (
    role      user_role NOT NULL,
    resource  text     NOT NULL,
    action    text     NOT NULL,
    scope     text     NOT NULL DEFAULT 'own',   -- own | route | trip | all
    PRIMARY KEY (role, resource, action)
);

-- ============================================================================
-- CUSTOMERS & CREDIT
-- ============================================================================

CREATE TABLE routes (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        uuid NOT NULL REFERENCES orgs(id),
    name          text NOT NULL,
    owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    days_of_week  smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
    active        boolean NOT NULL DEFAULT true,
    UNIQUE (org_id, name)
);
CREATE INDEX routes_org_id ON routes(org_id);

CREATE TABLE payment_terms (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        uuid NOT NULL REFERENCES orgs(id),
    code          text NOT NULL,
    type          payment_term_type NOT NULL,
    days          integer NOT NULL DEFAULT 0 CHECK (days >= 0),
    grace_days    integer NOT NULL DEFAULT 0 CHECK (grace_days >= 0),
    requires_pdc  boolean NOT NULL DEFAULT false,
    UNIQUE (org_id, code)
);
CREATE INDEX payment_terms_org_id ON payment_terms(org_id);

CREATE TABLE customers (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                uuid NOT NULL REFERENCES orgs(id),
    code                  text NOT NULL,
    name                  text NOT NULL,
    type                  customer_type NOT NULL DEFAULT 'outlet',
    route_id              uuid REFERENCES routes(id) ON DELETE SET NULL,
    route_sequence        integer,
    geo                   geography(Point,4326),
    address               text,
    phone                 text,
    whatsapp              text,
    assigned_rep_id       uuid REFERENCES users(id) ON DELETE SET NULL,
    assigned_collector_id uuid REFERENCES users(id) ON DELETE SET NULL,
    credit_limit          numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
    payment_term_id       uuid REFERENCES payment_terms(id) ON DELETE SET NULL,
    status                customer_status NOT NULL DEFAULT 'active',
    hold_reason           text,
    hold_until            date,
    high_value            boolean NOT NULL DEFAULT false,
    price_list_id         uuid,  -- FK added after price_lists
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, code)
);
CREATE INDEX customers_org_id      ON customers(org_id);
CREATE INDEX customers_route_idx   ON customers(route_id, route_sequence);
CREATE INDEX customers_rep_idx     ON customers(assigned_rep_id);
CREATE INDEX customers_coll_idx    ON customers(assigned_collector_id);
CREATE INDEX customers_term_idx    ON customers(payment_term_id);
CREATE INDEX customers_name_trgm   ON customers USING gin (name gin_trgm_ops);
CREATE INDEX customers_geo_idx     ON customers USING gist (geo);

-- Derived state: refreshed on every ar/payment/promise event.
-- Auto-created when customer is inserted (trigger below).
CREATE TABLE customer_credit_state (
    customer_id       uuid PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
    outstanding_total numeric(14,2) NOT NULL DEFAULT 0,
    advance_balance   numeric(14,2) NOT NULL DEFAULT 0 CHECK (advance_balance >= 0),
    overdue_0_7       numeric(14,2) NOT NULL DEFAULT 0,
    overdue_8_15      numeric(14,2) NOT NULL DEFAULT 0,
    overdue_16_30     numeric(14,2) NOT NULL DEFAULT 0,
    overdue_31_60     numeric(14,2) NOT NULL DEFAULT 0,
    overdue_60_plus   numeric(14,2) NOT NULL DEFAULT 0,
    available_credit  numeric(14,2) NOT NULL DEFAULT 0,
    risk_score        numeric(4,3) NOT NULL DEFAULT 0 CHECK (risk_score >= 0 AND risk_score <= 1),
    last_order_at     timestamptz,
    last_payment_at   timestamptz,
    last_visit_at     timestamptz,
    last_delivery_at  timestamptz,
    promise_amount    numeric(14,2) NOT NULL DEFAULT 0 CHECK (promise_amount >= 0),
    promise_due_date  date,
    broken_promises_30d integer NOT NULL DEFAULT 0 CHECK (broken_promises_30d >= 0),
    days_since_last_order integer,
    refreshed_at      timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- CATALOG & PRICING
-- ============================================================================

CREATE TABLE brands (
    id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES orgs(id),
    name   text NOT NULL,
    UNIQUE (org_id, name)
);
CREATE INDEX brands_org_id ON brands(org_id);

CREATE TABLE products (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL REFERENCES orgs(id),
    sku             text NOT NULL,
    name            text NOT NULL,
    brand_id        uuid NOT NULL REFERENCES brands(id),
    category        text NOT NULL,
    bottle_size_ml  integer NOT NULL CHECK (bottle_size_ml > 0),
    case_qty        integer NOT NULL DEFAULT 1 CHECK (case_qty >= 1),
    hsn             text,
    tax_rate        numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
    mrp             numeric(14,2) CHECK (mrp >= 0),
    -- Phase 4: reorder intelligence
    reorder_point   integer,
    safety_stock    integer,
    lead_time_days  integer CHECK (lead_time_days >= 0),
    active          boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, sku)
);
CREATE INDEX products_org_id    ON products(org_id);
CREATE INDEX products_brand_id  ON products(brand_id);
CREATE INDEX products_name_trgm ON products USING gin (name gin_trgm_ops);

CREATE TABLE price_lists (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         uuid NOT NULL REFERENCES orgs(id),
    name           text NOT NULL,
    effective_from date NOT NULL,
    effective_to   date,
    is_default     boolean NOT NULL DEFAULT false,
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
    UNIQUE (org_id, name)
);
CREATE INDEX price_lists_org_id ON price_lists(org_id);
-- Only one default per org
CREATE UNIQUE INDEX price_lists_one_default ON price_lists(org_id) WHERE is_default = true;

CREATE TABLE price_list_items (
    price_list_id uuid NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
    product_id    uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    unit_price    numeric(14,2) NOT NULL CHECK (unit_price > 0),
    case_price    numeric(14,2) CHECK (case_price > 0),
    min_qty       integer NOT NULL DEFAULT 1 CHECK (min_qty >= 1),
    PRIMARY KEY (price_list_id, product_id)
);
CREATE INDEX price_list_items_product ON price_list_items(product_id);

-- Deferred FK
ALTER TABLE customers
  ADD CONSTRAINT customers_price_list_fk FOREIGN KEY (price_list_id)
    REFERENCES price_lists(id) ON DELETE SET NULL;
CREATE INDEX customers_price_list_idx ON customers(price_list_id);

CREATE TABLE promos (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         uuid NOT NULL REFERENCES orgs(id),
    name           text NOT NULL,
    kind           promo_kind NOT NULL,
    config         jsonb NOT NULL,
    effective_from date NOT NULL,
    effective_to   date,
    active         boolean NOT NULL DEFAULT true,
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
    UNIQUE (org_id, name)
);
CREATE INDEX promos_org_id ON promos(org_id);

-- Product substitution allow-list (Phase 3)
CREATE TABLE product_substitutions (
    product_id     uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    substitute_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    PRIMARY KEY (product_id, substitute_id),
    CHECK (product_id <> substitute_id)
);

-- ============================================================================
-- INVENTORY
-- ============================================================================

CREATE TABLE vehicles (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         uuid NOT NULL REFERENCES orgs(id),
    reg_no         text NOT NULL,
    capacity_cases integer NOT NULL CHECK (capacity_cases > 0),
    active         boolean NOT NULL DEFAULT true,
    UNIQUE (org_id, reg_no)
);
CREATE INDEX vehicles_org_id ON vehicles(org_id);

CREATE TABLE warehouses (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            uuid NOT NULL REFERENCES orgs(id),
    code              text NOT NULL,
    name              text NOT NULL,
    type              warehouse_type NOT NULL,
    vehicle_id        uuid REFERENCES vehicles(id) ON DELETE SET NULL,
    custodian_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    is_damage_quarantine boolean NOT NULL DEFAULT false,
    active            boolean NOT NULL DEFAULT true,
    -- Van warehouses require a vehicle
    CHECK (type <> 'van' OR vehicle_id IS NOT NULL),
    UNIQUE (org_id, code)
);
CREATE INDEX warehouses_org_id     ON warehouses(org_id);
CREATE INDEX warehouses_vehicle_id ON warehouses(vehicle_id);

CREATE TABLE stock_batches (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         uuid NOT NULL REFERENCES orgs(id),
    product_id     uuid NOT NULL REFERENCES products(id),
    warehouse_id   uuid NOT NULL REFERENCES warehouses(id),
    batch_no       text,
    mfg_date       date,
    expiry_date    date,
    cost_price     numeric(14,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
    qty_physical   integer NOT NULL DEFAULT 0,
    qty_reserved   integer NOT NULL DEFAULT 0,
    qty_damaged    integer NOT NULL DEFAULT 0,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CHECK (qty_physical >= 0 AND qty_reserved >= 0 AND qty_damaged >= 0),
    CHECK (qty_reserved + qty_damaged <= qty_physical)
);
CREATE INDEX stock_batches_lookup ON stock_batches(warehouse_id, product_id);
CREATE INDEX stock_batches_expiry ON stock_batches(product_id, expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX stock_batches_org_id ON stock_batches(org_id);

-- Append-only movements ledger
CREATE TABLE stock_movements (
    id            bigserial PRIMARY KEY,
    org_id        uuid NOT NULL REFERENCES orgs(id),
    ts            timestamptz NOT NULL DEFAULT now(),
    product_id    uuid NOT NULL REFERENCES products(id),
    batch_id      uuid REFERENCES stock_batches(id),
    from_wh_id    uuid REFERENCES warehouses(id),
    to_wh_id      uuid REFERENCES warehouses(id),
    qty           integer NOT NULL CHECK (qty > 0),
    reason        stock_move_reason NOT NULL,
    ref_type      text,
    ref_id        uuid,
    user_id       uuid REFERENCES users(id),
    gps           geography(Point,4326),
    note          text,
    CHECK (from_wh_id IS NOT NULL OR to_wh_id IS NOT NULL)
);
CREATE INDEX stock_movements_ref        ON stock_movements(ref_type, ref_id);
CREATE INDEX stock_movements_org_ts     ON stock_movements(org_id, ts);
CREATE INDEX stock_movements_product    ON stock_movements(product_id, ts);
CREATE INDEX stock_movements_from_wh    ON stock_movements(from_wh_id) WHERE from_wh_id IS NOT NULL;
CREATE INDEX stock_movements_to_wh      ON stock_movements(to_wh_id) WHERE to_wh_id IS NOT NULL;

CREATE TABLE cycle_counts (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        uuid NOT NULL REFERENCES orgs(id),
    warehouse_id  uuid NOT NULL REFERENCES warehouses(id),
    started_at    timestamptz NOT NULL DEFAULT now(),
    closed_at     timestamptz,
    started_by    uuid REFERENCES users(id)
);
CREATE INDEX cycle_counts_wh ON cycle_counts(warehouse_id);

CREATE TABLE cycle_count_lines (
    cycle_id      uuid NOT NULL REFERENCES cycle_counts(id) ON DELETE CASCADE,
    batch_id      uuid NOT NULL REFERENCES stock_batches(id),
    system_qty    integer NOT NULL CHECK (system_qty >= 0),
    counted_qty   integer NOT NULL CHECK (counted_qty >= 0),
    variance      integer GENERATED ALWAYS AS (counted_qty - system_qty) STORED,
    note          text,
    PRIMARY KEY (cycle_id, batch_id)
);

-- ============================================================================
-- ORDERS
-- ============================================================================

CREATE TABLE sales_orders (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id               uuid NOT NULL REFERENCES orgs(id),
    order_no             text NOT NULL,
    customer_id          uuid NOT NULL REFERENCES customers(id),
    rep_id               uuid REFERENCES users(id) ON DELETE SET NULL,
    channel              text NOT NULL DEFAULT 'admin',  -- admin | rep_app | portal | whatsapp | sms
    order_date           date NOT NULL DEFAULT current_date,
    status               order_status NOT NULL DEFAULT 'draft',
    credit_decision      credit_decision,
    credit_reasons       jsonb,
    approved_by          uuid REFERENCES users(id) ON DELETE SET NULL,
    override_reason_code text,
    override_note        text,
    subtotal             numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    tax_total            numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
    total                numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
    notes                text,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    idempotency_key      text,
    UNIQUE (org_id, order_no),
    UNIQUE (org_id, idempotency_key)
);
CREATE INDEX sales_orders_customer   ON sales_orders(customer_id, order_date DESC);
CREATE INDEX sales_orders_org_status ON sales_orders(org_id, status, order_date DESC)
  WHERE status IN ('draft','held','approved','confirmed');
CREATE INDEX sales_orders_rep        ON sales_orders(rep_id) WHERE rep_id IS NOT NULL;

CREATE TABLE sales_order_lines (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id      uuid NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    product_id    uuid NOT NULL REFERENCES products(id),
    qty           integer NOT NULL CHECK (qty > 0),
    unit_price    numeric(14,2) NOT NULL CHECK (unit_price >= 0),
    discount_pct  numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
    tax_rate      numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
    line_total    numeric(14,2) NOT NULL CHECK (line_total >= 0),
    promo_id      uuid REFERENCES promos(id) ON DELETE SET NULL
);
CREATE INDEX sales_order_lines_order   ON sales_order_lines(order_id);
CREATE INDEX sales_order_lines_product ON sales_order_lines(product_id);

-- ============================================================================
-- INVOICES & AR LEDGER
-- ============================================================================

CREATE TABLE invoices (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL REFERENCES orgs(id),
    invoice_no      text NOT NULL,
    order_id        uuid REFERENCES sales_orders(id) ON DELETE RESTRICT,
    customer_id     uuid NOT NULL REFERENCES customers(id),
    invoice_date    date NOT NULL DEFAULT current_date,
    due_date        date NOT NULL,
    subtotal        numeric(14,2) NOT NULL CHECK (subtotal >= 0),
    tax_total       numeric(14,2) NOT NULL CHECK (tax_total >= 0),
    total           numeric(14,2) NOT NULL CHECK (total >= 0),
    outstanding     numeric(14,2) NOT NULL,
    status          invoice_status NOT NULL DEFAULT 'open',
    -- Phase 5: e-Invoice
    irn             text,
    irn_qr          text,
    locked_at       timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, invoice_no),
    CHECK (outstanding >= 0 AND outstanding <= total),
    CHECK (due_date >= invoice_date)
);
CREATE INDEX invoices_customer_open ON invoices(customer_id) WHERE status IN ('open','partial','disputed');
CREATE INDEX invoices_due_date      ON invoices(due_date) WHERE status IN ('open','partial','disputed');
CREATE INDEX invoices_order_id      ON invoices(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX invoices_org_date      ON invoices(org_id, invoice_date DESC);

CREATE TABLE invoice_lines (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id  uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id  uuid NOT NULL REFERENCES products(id),
    batch_id    uuid REFERENCES stock_batches(id),
    qty         integer NOT NULL CHECK (qty > 0),
    unit_price  numeric(14,2) NOT NULL CHECK (unit_price >= 0),
    tax_rate    numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
    line_total  numeric(14,2) NOT NULL CHECK (line_total >= 0)
);
CREATE INDEX invoice_lines_invoice ON invoice_lines(invoice_id);
CREATE INDEX invoice_lines_product ON invoice_lines(product_id);

CREATE TABLE credit_notes (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         uuid NOT NULL REFERENCES orgs(id),
    cn_no          text NOT NULL,
    invoice_id     uuid REFERENCES invoices(id) ON DELETE RESTRICT,
    customer_id    uuid NOT NULL REFERENCES customers(id),
    amount         numeric(14,2) NOT NULL CHECK (amount > 0),
    reason         text NOT NULL,
    approved_by    uuid REFERENCES users(id) ON DELETE SET NULL,
    issued_at      timestamptz NOT NULL DEFAULT now(),
    locked_at      timestamptz,
    UNIQUE (org_id, cn_no)
);
CREATE INDEX credit_notes_customer ON credit_notes(customer_id);
CREATE INDEX credit_notes_invoice  ON credit_notes(invoice_id) WHERE invoice_id IS NOT NULL;

-- Append-only. Source of truth for customer balance.
CREATE TABLE ar_ledger (
    id              bigserial PRIMARY KEY,
    org_id          uuid NOT NULL REFERENCES orgs(id),
    ts              timestamptz NOT NULL DEFAULT now(),
    customer_id     uuid NOT NULL REFERENCES customers(id),
    entry_type      ledger_entry_type NOT NULL,
    ref_type        text NOT NULL,
    ref_id          uuid NOT NULL,
    debit           numeric(14,2) NOT NULL DEFAULT 0,
    credit          numeric(14,2) NOT NULL DEFAULT 0,
    running_balance numeric(14,2) NOT NULL,
    note            text,
    -- Exactly one side positive, the other zero; both-zero rejected
    CHECK (debit >= 0 AND credit >= 0 AND (debit > 0) <> (credit > 0))
);
CREATE INDEX ar_ledger_customer_ts ON ar_ledger(customer_id, ts);
CREATE INDEX ar_ledger_ref         ON ar_ledger(ref_type, ref_id);
CREATE INDEX ar_ledger_org_ts      ON ar_ledger(org_id, ts);

-- ============================================================================
-- COLLECTIONS
-- ============================================================================

CREATE TABLE collection_visits (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL REFERENCES orgs(id),
    customer_id     uuid NOT NULL REFERENCES customers(id),
    collector_id    uuid NOT NULL REFERENCES users(id),
    started_at      timestamptz NOT NULL DEFAULT now(),
    closed_at       timestamptz,
    gps_in          geography(Point,4326),
    gps_out         geography(Point,4326),
    outcome         visit_outcome,  -- NULL while open; set on close
    note            text,
    voice_memo_url  text,
    idempotency_key text,
    UNIQUE (org_id, idempotency_key),
    -- outcome must be set when closed
    CHECK ((closed_at IS NULL AND outcome IS NULL) OR (closed_at IS NOT NULL AND outcome IS NOT NULL))
);
CREATE INDEX visits_collector_day ON collection_visits(collector_id, started_at DESC);
CREATE INDEX visits_customer      ON collection_visits(customer_id, started_at DESC);
CREATE INDEX visits_org_date      ON collection_visits(org_id, started_at DESC);

CREATE TABLE payments (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id               uuid NOT NULL REFERENCES orgs(id),
    receipt_no           text NOT NULL,
    visit_id             uuid REFERENCES collection_visits(id) ON DELETE SET NULL,
    customer_id          uuid NOT NULL REFERENCES customers(id),
    collector_id         uuid REFERENCES users(id) ON DELETE SET NULL,
    amount               numeric(14,2) NOT NULL CHECK (amount > 0),
    mode                 payment_mode NOT NULL,
    mode_ref             text,
    cheque_date          date,
    bank_name            text,
    verification_status  payment_verification NOT NULL DEFAULT 'pending',
    verified_by          uuid REFERENCES users(id) ON DELETE SET NULL,
    verified_at          timestamptz,
    proof_image_url      text,
    gps                  geography(Point,4326),
    collected_at         timestamptz NOT NULL DEFAULT now(),
    locked_at            timestamptz,
    idempotency_key      text,
    UNIQUE (org_id, receipt_no),
    UNIQUE (org_id, idempotency_key),
    -- Mode-specific required fields (defense-in-depth on top of app-level zod):
    --   cheque  → cheque_date AND mode_ref (cheque number) required
    --   bank    → mode_ref (transfer ref) required
    --   upi     → mode_ref (transaction id) required
    --   cash    → no extra requirements
    CHECK (mode <> 'cheque' OR (cheque_date IS NOT NULL AND mode_ref IS NOT NULL)),
    CHECK (mode NOT IN ('bank', 'upi') OR mode_ref IS NOT NULL)
);
CREATE INDEX payments_customer  ON payments(customer_id, collected_at DESC);
CREATE INDEX payments_collector ON payments(collector_id, collected_at DESC);
CREATE INDEX payments_org_date  ON payments(org_id, collected_at DESC);
CREATE INDEX payments_cheque_pending ON payments(verification_status, cheque_date)
  WHERE mode = 'cheque' AND verification_status IN ('pending','deposited');

CREATE TABLE payment_allocations (
    payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    amount     numeric(14,2) NOT NULL CHECK (amount > 0),
    PRIMARY KEY (payment_id, invoice_id)
);
CREATE INDEX payment_allocations_invoice ON payment_allocations(invoice_id);

CREATE TABLE promises (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                 uuid NOT NULL REFERENCES orgs(id),
    customer_id            uuid NOT NULL REFERENCES customers(id),
    amount                 numeric(14,2) NOT NULL CHECK (amount > 0),
    promised_date          date NOT NULL,
    created_from_visit_id  uuid REFERENCES collection_visits(id) ON DELETE SET NULL,
    status                 promise_status NOT NULL DEFAULT 'open',
    closed_at              timestamptz,
    note                   text,
    idempotency_key        text,
    created_at             timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, idempotency_key)
);
CREATE INDEX promises_due           ON promises(promised_date) WHERE status = 'open';
CREATE INDEX promises_customer      ON promises(customer_id, status);
CREATE INDEX promises_customer_date ON promises(customer_id, promised_date) WHERE status = 'open';

CREATE TABLE disputes (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       uuid NOT NULL REFERENCES orgs(id),
    customer_id  uuid NOT NULL REFERENCES customers(id),
    invoice_id   uuid REFERENCES invoices(id) ON DELETE SET NULL,
    raised_by    uuid REFERENCES users(id) ON DELETE SET NULL,
    raised_at    timestamptz NOT NULL DEFAULT now(),
    reason       text NOT NULL,
    photo_url    text,
    resolved_at  timestamptz,
    resolution   text
);
CREATE INDEX disputes_customer ON disputes(customer_id);
CREATE INDEX disputes_invoice  ON disputes(invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX disputes_org_open ON disputes(org_id) WHERE resolved_at IS NULL;

CREATE TABLE collector_eod (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           uuid NOT NULL REFERENCES orgs(id),
    collector_id     uuid NOT NULL REFERENCES users(id),
    day              date NOT NULL,
    cash_collected   numeric(14,2) NOT NULL DEFAULT 0 CHECK (cash_collected >= 0),
    cash_deposited   numeric(14,2) NOT NULL DEFAULT 0 CHECK (cash_deposited >= 0),
    deposit_slip_url text,
    variance         numeric(14,2) GENERATED ALWAYS AS (cash_collected - cash_deposited) STORED,
    note             text,
    closed_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (collector_id, day)
);

-- Priority list: generated nightly by priority engine (Phase 2)
CREATE TABLE collector_priority_list (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        uuid NOT NULL REFERENCES orgs(id),
    collector_id  uuid NOT NULL REFERENCES users(id),
    day           date NOT NULL,
    customer_id   uuid NOT NULL REFERENCES customers(id),
    sequence      integer NOT NULL,
    score         numeric(10,3) NOT NULL,
    reason        text NOT NULL,  -- promise_due_today | overdue_30plus | high_value | route_order | missed_visit
    outstanding   numeric(14,2) NOT NULL DEFAULT 0,
    promise_amount numeric(14,2),
    visited       boolean NOT NULL DEFAULT false,
    UNIQUE (collector_id, day, customer_id),
    UNIQUE (collector_id, day, sequence)
);
CREATE INDEX priority_list_day ON collector_priority_list(org_id, day, collector_id);

-- ============================================================================
-- DELIVERY & ROUTES
-- ============================================================================

-- Note: route stops live on customers (route_id + route_sequence). No separate
-- route_stops table — avoids dual source of truth with customers.

CREATE TABLE trips (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                uuid NOT NULL REFERENCES orgs(id),
    trip_no               text NOT NULL,
    vehicle_id            uuid NOT NULL REFERENCES vehicles(id),
    driver_id             uuid NOT NULL REFERENCES users(id),
    route_id              uuid REFERENCES routes(id) ON DELETE SET NULL,
    trip_date             date NOT NULL DEFAULT current_date,
    status                trip_status NOT NULL DEFAULT 'planned',
    loaded_manifest_json  jsonb,  -- snapshot of what was loaded, for reconciliation
    opened_at             timestamptz,
    closed_at             timestamptz,
    UNIQUE (org_id, trip_no)
);
CREATE INDEX trips_org_date  ON trips(org_id, trip_date, status);
CREATE INDEX trips_driver    ON trips(driver_id, trip_date DESC);
CREATE INDEX trips_vehicle   ON trips(vehicle_id, trip_date DESC);
CREATE INDEX trips_route     ON trips(route_id) WHERE route_id IS NOT NULL;

CREATE TABLE deliveries (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL REFERENCES orgs(id),
    trip_id         uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    stop_sequence   integer NOT NULL,
    invoice_id      uuid REFERENCES invoices(id) ON DELETE SET NULL,
    order_id        uuid REFERENCES sales_orders(id) ON DELETE SET NULL,
    customer_id     uuid NOT NULL REFERENCES customers(id),
    status          delivery_status NOT NULL DEFAULT 'pending',
    failure_reason  text,
    pod_image_url   text,
    signature_url   text,
    delivered_at    timestamptz,
    gps             geography(Point,4326),
    idempotency_key text,
    UNIQUE (org_id, idempotency_key)
);
CREATE INDEX deliveries_trip     ON deliveries(trip_id, stop_sequence);
CREATE INDEX deliveries_customer ON deliveries(customer_id, delivered_at DESC);
CREATE INDEX deliveries_invoice  ON deliveries(invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX deliveries_order    ON deliveries(order_id) WHERE order_id IS NOT NULL;

CREATE TABLE delivery_lines (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id       uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    order_line_id     uuid REFERENCES sales_order_lines(id) ON DELETE SET NULL,
    invoice_line_id   uuid REFERENCES invoice_lines(id) ON DELETE SET NULL,
    product_id        uuid NOT NULL REFERENCES products(id),
    ordered_qty       integer NOT NULL CHECK (ordered_qty > 0),
    delivered_qty     integer NOT NULL DEFAULT 0 CHECK (delivered_qty >= 0),
    shortage_qty      integer GENERATED ALWAYS AS (ordered_qty - delivered_qty) STORED,
    shortage_reason_code shortage_reason
);
CREATE INDEX delivery_lines_delivery ON delivery_lines(delivery_id);

CREATE TABLE returns (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         uuid NOT NULL REFERENCES orgs(id),
    customer_id    uuid NOT NULL REFERENCES customers(id),
    delivery_id    uuid REFERENCES deliveries(id) ON DELETE SET NULL,
    product_id     uuid NOT NULL REFERENCES products(id),
    batch_id       uuid REFERENCES stock_batches(id),
    qty            integer NOT NULL CHECK (qty > 0),
    reason         return_reason NOT NULL,
    photo_url      text,
    received_at    timestamptz NOT NULL DEFAULT now(),
    credit_note_id uuid REFERENCES credit_notes(id) ON DELETE SET NULL
);
CREATE INDEX returns_customer    ON returns(customer_id);
CREATE INDEX returns_delivery    ON returns(delivery_id) WHERE delivery_id IS NOT NULL;
CREATE INDEX returns_credit_note ON returns(credit_note_id) WHERE credit_note_id IS NOT NULL;
CREATE INDEX returns_org_date    ON returns(org_id, received_at DESC);

-- Van reconciliation (Phase 3)
CREATE TABLE trip_reconciliation (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id     uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE UNIQUE,
    org_id      uuid NOT NULL REFERENCES orgs(id),
    reconciled_by uuid REFERENCES users(id),
    lines       jsonb NOT NULL,  -- [{product_id, loaded, sold, returned, remaining, variance}]
    total_variance integer NOT NULL DEFAULT 0,
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- PURCHASE ORDERS (Phase 4, schema ready now)
-- ============================================================================

CREATE TABLE suppliers (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id   uuid NOT NULL REFERENCES orgs(id),
    name     text NOT NULL,
    phone    text,
    email    citext,
    address  text,
    active   boolean NOT NULL DEFAULT true,
    UNIQUE (org_id, name)
);
CREATE INDEX suppliers_org_id ON suppliers(org_id);

CREATE TABLE purchase_orders (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      uuid NOT NULL REFERENCES orgs(id),
    po_no       text NOT NULL,
    supplier_id uuid NOT NULL REFERENCES suppliers(id),
    status      text NOT NULL DEFAULT 'draft',  -- draft | sent | acknowledged | received | cancelled
    total       numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
    notes       text,
    created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, po_no)
);
CREATE INDEX purchase_orders_supplier ON purchase_orders(supplier_id);

CREATE TABLE purchase_order_lines (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id       uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id  uuid NOT NULL REFERENCES products(id),
    qty         integer NOT NULL CHECK (qty > 0),
    unit_cost   numeric(14,2) NOT NULL CHECK (unit_cost >= 0),
    line_total  numeric(14,2) NOT NULL CHECK (line_total >= 0)
);
CREATE INDEX po_lines_po ON purchase_order_lines(po_id);

-- ============================================================================
-- NOTIFICATIONS (Phase 2+)
-- ============================================================================

CREATE TABLE notifications (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      uuid NOT NULL REFERENCES orgs(id),
    user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
    channel     text NOT NULL,  -- push | sms | whatsapp | email
    template    text NOT NULL,
    context     jsonb NOT NULL DEFAULT '{}',
    status      text NOT NULL DEFAULT 'pending',  -- pending | sent | delivered | failed
    sent_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user   ON notifications(user_id, created_at DESC);
CREATE INDEX notifications_status ON notifications(status) WHERE status = 'pending';

-- ============================================================================
-- FILE UPLOADS (central registry)
-- ============================================================================

CREATE TABLE file_uploads (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      uuid NOT NULL REFERENCES orgs(id),
    uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
    bucket      text NOT NULL,
    key         text NOT NULL,
    content_type text,
    size_bytes  bigint,
    entity_type text,
    entity_id   uuid,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (bucket, key)
);
CREATE INDEX file_uploads_entity ON file_uploads(entity_type, entity_id);

-- ============================================================================
-- CONTROL: approvals, locks, audit
-- ============================================================================

CREATE TABLE approval_requests (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        uuid NOT NULL REFERENCES orgs(id),
    type          approval_type NOT NULL,
    ref_type      text NOT NULL,
    ref_id        uuid NOT NULL,
    requested_by  uuid NOT NULL REFERENCES users(id),
    approver_id   uuid REFERENCES users(id) ON DELETE SET NULL,
    status        approval_status NOT NULL DEFAULT 'pending',
    reason        text,
    payload       jsonb,
    decided_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX approvals_pending    ON approval_requests(org_id, status) WHERE status = 'pending';
CREATE INDEX approvals_ref        ON approval_requests(ref_type, ref_id);
CREATE INDEX approvals_requested  ON approval_requests(requested_by);
CREATE INDEX approvals_approver   ON approval_requests(approver_id) WHERE approver_id IS NOT NULL;

CREATE TABLE locks (
    entity_type text NOT NULL,
    entity_id   uuid NOT NULL,
    locked_at   timestamptz NOT NULL DEFAULT now(),
    locked_by   uuid REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (entity_type, entity_id)
);

CREATE TABLE audit_log (
    id          bigserial PRIMARY KEY,
    org_id      uuid NOT NULL REFERENCES orgs(id),
    ts          timestamptz NOT NULL DEFAULT now(),
    user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
    action      audit_action NOT NULL,
    entity      text NOT NULL,
    entity_id   uuid NOT NULL,
    before_json jsonb,
    after_json  jsonb,
    ip          inet,
    gps         geography(Point,4326)
);
CREATE INDEX audit_entity  ON audit_log(entity, entity_id, ts);
CREATE INDEX audit_user    ON audit_log(user_id, ts);
CREATE INDEX audit_org_ts  ON audit_log(org_id, ts);

-- Per-org, per-doc-type, per-year counters for human-readable numbers
-- (e.g. SO-26-00042, INV-26-00001, C-00017).
CREATE TABLE doc_counters (
    org_id    uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    doc_type  text NOT NULL,       -- 'order' | 'invoice' | 'receipt' | 'credit_note' | 'customer'
    year      integer NOT NULL,    -- 2-digit YY (customer counters use 0 to skip year)
    seq       integer NOT NULL DEFAULT 0,
    PRIMARY KEY (org_id, doc_type, year)
);

-- ============================================================================
-- SYNC (offline journal from mobile)
-- ============================================================================

CREATE TABLE sync_events (
    event_id     uuid PRIMARY KEY,
    org_id       uuid NOT NULL REFERENCES orgs(id),
    device_id    text NOT NULL,
    user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
    type         text NOT NULL,
    occurred_at  timestamptz NOT NULL,
    received_at  timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    status       sync_event_status NOT NULL DEFAULT 'pending',
    payload      jsonb NOT NULL,
    gps          geography(Point,4326),
    reject_reason text
);
CREATE INDEX sync_events_pending ON sync_events(status, received_at) WHERE status = 'pending';
CREATE INDEX sync_events_device  ON sync_events(device_id, occurred_at);
CREATE INDEX sync_events_org     ON sync_events(org_id, received_at DESC);

-- ============================================================================
-- PHASE 5: integration tracking
-- ============================================================================

CREATE TABLE integration_sync_log (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL REFERENCES orgs(id),
    integration     text NOT NULL,  -- tally | zoho | whatsapp | upi_gateway
    direction       text NOT NULL,  -- outbound | inbound
    entity_type     text NOT NULL,
    entity_id       uuid NOT NULL,
    status          text NOT NULL DEFAULT 'pending',  -- pending | sent | ack | failed | dlq
    payload         jsonb,
    response        jsonb,
    error           text,
    attempts        integer NOT NULL DEFAULT 0,
    last_attempt_at timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX integration_log_entity ON integration_sync_log(entity_type, entity_id);
CREATE INDEX integration_log_status ON integration_sync_log(integration, status) WHERE status IN ('pending','failed','dlq');

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Sellable and free stock per (org, warehouse, product)
CREATE VIEW v_stock_state AS
SELECT
    sb.org_id,
    sb.warehouse_id,
    sb.product_id,
    SUM(sb.qty_physical)                                    AS physical,
    SUM(sb.qty_physical - sb.qty_damaged)                   AS sellable,
    SUM(sb.qty_physical - sb.qty_damaged - sb.qty_reserved) AS free,
    MIN(sb.expiry_date) FILTER (WHERE sb.qty_physical - sb.qty_damaged - sb.qty_reserved > 0) AS nearest_expiry
FROM stock_batches sb
JOIN warehouses w ON w.id = sb.warehouse_id AND w.active = true
GROUP BY sb.org_id, sb.warehouse_id, sb.product_id;

-- Current aging snapshot
CREATE VIEW v_invoice_aging AS
SELECT
    i.id,
    i.org_id,
    i.invoice_no,
    i.customer_id,
    i.invoice_date,
    i.total,
    i.outstanding,
    i.due_date,
    GREATEST(0, (current_date - i.due_date)::int) AS days_overdue,
    CASE
        WHEN current_date <= i.due_date                        THEN 'current'
        WHEN current_date - i.due_date BETWEEN 1 AND 7        THEN '1_7'
        WHEN current_date - i.due_date BETWEEN 8 AND 15       THEN '8_15'
        WHEN current_date - i.due_date BETWEEN 16 AND 30      THEN '16_30'
        WHEN current_date - i.due_date BETWEEN 31 AND 60      THEN '31_60'
        ELSE '60_plus'
    END AS bucket
FROM invoices i
WHERE i.status IN ('open','partial','disputed');

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- updated_at helper
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER customers_updated_at
  BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER sales_orders_updated_at
  BEFORE UPDATE ON sales_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER invoices_updated_at
  BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER org_config_updated_at
  BEFORE UPDATE ON org_config FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Auto-create customer_credit_state on customer insert
CREATE OR REPLACE FUNCTION auto_create_credit_state() RETURNS trigger AS $$
BEGIN
    INSERT INTO customer_credit_state (customer_id, available_credit)
    VALUES (NEW.id, NEW.credit_limit)
    ON CONFLICT (customer_id) DO NOTHING;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER customers_auto_credit_state
  AFTER INSERT ON customers FOR EACH ROW EXECUTE FUNCTION auto_create_credit_state();

-- Auto-create org_config on org insert
CREATE OR REPLACE FUNCTION auto_create_org_config() RETURNS trigger AS $$
BEGIN
    INSERT INTO org_config (org_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER orgs_auto_config
  AFTER INSERT ON orgs FOR EACH ROW EXECUTE FUNCTION auto_create_org_config();

-- Lock enforcement: prevent mutation on locked entities
CREATE OR REPLACE FUNCTION enforce_lock() RETURNS trigger AS $$
BEGIN
    IF current_setting('app.bypass_lock', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    IF OLD.locked_at IS NOT NULL THEN
        RAISE EXCEPTION '% % is locked; edits require admin bypass', TG_TABLE_NAME, OLD.id
            USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    -- Prevent unlocking without bypass
    IF NEW.locked_at IS NULL AND OLD.locked_at IS NOT NULL THEN
        RAISE EXCEPTION '% % cannot be unlocked without admin bypass', TG_TABLE_NAME, OLD.id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER invoices_lock_guard
  BEFORE UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION enforce_lock();

CREATE TRIGGER payments_lock_guard
  BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION enforce_lock();

CREATE TRIGGER credit_notes_lock_guard
  BEFORE UPDATE OR DELETE ON credit_notes FOR EACH ROW EXECUTE FUNCTION enforce_lock();

-- Append-only enforcement
-- Append-only ledgers: bypass_lock allows archival deletion (rare, requires
-- admin) for ar_ledger and stock_movements.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('app.bypass_lock', true) = 'on' THEN
        RETURN OLD;  -- allow archival with bypass
    END IF;
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;

-- Audit log: absolutely immutable. No bypass — compliance evidence.
CREATE OR REPLACE FUNCTION forbid_mutation_strict() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% is tamper-evident; no UPDATE or DELETE permitted',
        TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER ar_ledger_append_only
  BEFORE UPDATE OR DELETE ON ar_ledger FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER stock_movements_append_only
  BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_mutation_strict();

-- Payment allocation sum check.
-- Enforces TWO invariants:
--   (a) sum of allocations on a single payment <= payment.amount
--   (b) sum of allocations across all payments to a single invoice <= invoice.total
-- (b) prevents two payments from each fully allocating the same invoice.
-- Deferred so multi-row inserts in the same tx can rebalance before commit.
CREATE OR REPLACE FUNCTION check_allocation_sum() RETURNS trigger AS $$
DECLARE
    target_payment_id uuid;
    target_invoice_id uuid;
    pay_amt    numeric(14,2);
    inv_total  numeric(14,2);
    alloc_sum  numeric(14,2);
BEGIN
    target_payment_id := COALESCE(NEW.payment_id, OLD.payment_id);
    target_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);

    -- (a) per-payment cap
    SELECT amount INTO pay_amt FROM payments WHERE id = target_payment_id;
    IF pay_amt IS NULL THEN
        RAISE EXCEPTION 'payment % not found for allocation', target_payment_id;
    END IF;
    SELECT COALESCE(SUM(amount), 0) INTO alloc_sum
      FROM payment_allocations WHERE payment_id = target_payment_id;
    IF alloc_sum > pay_amt THEN
        RAISE EXCEPTION 'Allocations (%) exceed payment amount (%)', alloc_sum, pay_amt
            USING ERRCODE = 'check_violation';
    END IF;

    -- (b) per-invoice cap
    SELECT total INTO inv_total FROM invoices WHERE id = target_invoice_id;
    IF inv_total IS NULL THEN
        RAISE EXCEPTION 'invoice % not found for allocation', target_invoice_id;
    END IF;
    SELECT COALESCE(SUM(amount), 0) INTO alloc_sum
      FROM payment_allocations WHERE invoice_id = target_invoice_id;
    IF alloc_sum > inv_total THEN
        RAISE EXCEPTION 'Allocations to invoice % (%) exceed invoice total (%)',
            target_invoice_id, alloc_sum, inv_total
            USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER payment_allocations_check
  AFTER INSERT OR UPDATE OR DELETE ON payment_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_allocation_sum();

-- Allocations inherit the parent payment's lock state: once a payment is
-- locked, its allocations are frozen too (unless app.bypass_lock='on').
CREATE OR REPLACE FUNCTION enforce_allocation_lock() RETURNS trigger AS $$
DECLARE
    target_payment_id uuid;
    pay_locked_at timestamptz;
BEGIN
    IF current_setting('app.bypass_lock', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    target_payment_id := COALESCE(NEW.payment_id, OLD.payment_id);
    SELECT locked_at INTO pay_locked_at FROM payments WHERE id = target_payment_id;
    IF pay_locked_at IS NOT NULL THEN
        RAISE EXCEPTION 'payment % is locked; allocation edits require admin bypass', target_payment_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER payment_allocations_lock_guard
  BEFORE INSERT OR UPDATE OR DELETE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION enforce_allocation_lock();

-- ============================================================================
-- GENERAL LEDGER (Phase A foundation)
-- ============================================================================

CREATE TYPE gl_account_type AS ENUM ('asset', 'liability', 'equity', 'revenue', 'cogs', 'expense');
CREATE TYPE gl_normal_side  AS ENUM ('debit', 'credit');
CREATE TYPE gl_period_status AS ENUM ('open', 'closed');

CREATE TABLE gl_accounts (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        uuid NOT NULL REFERENCES orgs(id),
    code          text NOT NULL,
    name          text NOT NULL,
    type          gl_account_type NOT NULL,
    normal_side   gl_normal_side  NOT NULL,
    parent_id     uuid REFERENCES gl_accounts(id),
    is_postable   boolean NOT NULL DEFAULT true,    -- false for header/group rows
    is_control    boolean NOT NULL DEFAULT false,   -- AR/AP/Inventory — no manual JE
    active        boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, code)
);
CREATE INDEX gl_accounts_org_id ON gl_accounts(org_id);
CREATE INDEX gl_accounts_parent ON gl_accounts(parent_id);

CREATE TABLE gl_periods (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      uuid NOT NULL REFERENCES orgs(id),
    year        int NOT NULL CHECK (year BETWEEN 2000 AND 2100),
    month       int NOT NULL CHECK (month BETWEEN 1 AND 12),
    status      gl_period_status NOT NULL DEFAULT 'open',
    closed_at   timestamptz,
    closed_by   uuid REFERENCES users(id),
    UNIQUE (org_id, year, month)
);
CREATE INDEX gl_periods_org ON gl_periods(org_id, year, month);

CREATE TABLE gl_journals (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        uuid NOT NULL REFERENCES orgs(id),
    journal_no    text NOT NULL,
    je_date       date NOT NULL,
    source_type   text NOT NULL,                    -- 'manual', 'invoice', 'payment', 'credit_note', 'stock_receipt', 'stock_adjust', 'cogs', 'bill', 'bill_payment', 'expense'
    source_id     uuid,
    memo          text,
    posted        boolean NOT NULL DEFAULT false,
    posted_at     timestamptz,
    posted_by     uuid REFERENCES users(id),
    reversal_of   uuid REFERENCES gl_journals(id),
    reversed_by   uuid REFERENCES gl_journals(id),
    created_by    uuid NOT NULL REFERENCES users(id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, journal_no)
);
CREATE INDEX gl_journals_org_date ON gl_journals(org_id, je_date DESC);
CREATE INDEX gl_journals_source   ON gl_journals(source_type, source_id);

CREATE TABLE gl_journal_lines (
    id            bigserial PRIMARY KEY,
    journal_id    uuid NOT NULL REFERENCES gl_journals(id) ON DELETE CASCADE,
    org_id        uuid NOT NULL REFERENCES orgs(id),
    account_id    uuid NOT NULL REFERENCES gl_accounts(id),
    debit         numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
    credit        numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
    memo          text,
    customer_id   uuid REFERENCES customers(id),
    product_id    uuid REFERENCES products(id),
    batch_id      uuid REFERENCES stock_batches(id),
    line_no       int NOT NULL,
    CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)),
    UNIQUE (journal_id, line_no)
);
CREATE INDEX gl_lines_journal  ON gl_journal_lines(journal_id);
CREATE INDEX gl_lines_account  ON gl_journal_lines(account_id);
CREATE INDEX gl_lines_customer ON gl_journal_lines(customer_id) WHERE customer_id IS NOT NULL;

-- Posted journals are immutable. Reversals are created as new journals
-- (linked via reversal_of/reversed_by) — never edit lines after posting.
CREATE OR REPLACE FUNCTION gl_journal_immutable() RETURNS trigger AS $$
DECLARE
    j_posted boolean;
BEGIN
    SELECT posted INTO j_posted FROM gl_journals
        WHERE id = COALESCE(NEW.journal_id, OLD.journal_id);
    IF j_posted THEN
        IF current_setting('app.bypass_lock', true) = 'on' THEN
            IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'cannot modify lines of a posted journal'
            USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER gl_journal_lines_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON gl_journal_lines
    FOR EACH ROW EXECUTE FUNCTION gl_journal_immutable();

-- Reversal must point to a different journal — never self-reversal.
ALTER TABLE gl_journals
    ADD CONSTRAINT gl_journals_no_self_reversal
    CHECK (reversal_of IS NULL OR reversal_of <> id);
ALTER TABLE gl_journals
    ADD CONSTRAINT gl_journals_no_self_reversed_by
    CHECK (reversed_by IS NULL OR reversed_by <> id);

-- Balance enforcement: SUM(debit) = SUM(credit) per journal at post time.
-- Fires when the journal transitions to posted=true. The header-first /
-- lines-second / post-third pattern in services satisfies this naturally.
CREATE OR REPLACE FUNCTION gl_assert_balanced() RETURNS trigger AS $$
DECLARE
    total_debit  numeric(14,2);
    total_credit numeric(14,2);
BEGIN
    IF NEW.posted IS NOT TRUE THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND OLD.posted = true THEN RETURN NEW; END IF;
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
        INTO total_debit, total_credit
        FROM gl_journal_lines
        WHERE journal_id = NEW.id;
    IF total_debit = 0 THEN
        RAISE EXCEPTION 'journal % has zero amounts', NEW.journal_no
            USING ERRCODE = 'check_violation';
    END IF;
    IF total_debit <> total_credit THEN
        RAISE EXCEPTION 'journal % does not balance: debit=% credit=%',
            NEW.journal_no, total_debit, total_credit
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER gl_journals_balance
    BEFORE INSERT OR UPDATE OF posted ON gl_journals
    FOR EACH ROW EXECUTE FUNCTION gl_assert_balanced();

-- Period closure: posting requires the je_date's period to exist and be open.
-- Bypassable via app.bypass_lock for back-dated adjusting entries.
CREATE OR REPLACE FUNCTION gl_assert_period_open() RETURNS trigger AS $$
DECLARE
    p_status gl_period_status;
    p_year   int;
    p_month  int;
BEGIN
    IF NEW.posted IS NOT TRUE THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND OLD.posted = true THEN RETURN NEW; END IF;
    IF current_setting('app.bypass_lock', true) = 'on' THEN RETURN NEW; END IF;
    p_year  := EXTRACT(YEAR  FROM NEW.je_date)::int;
    p_month := EXTRACT(MONTH FROM NEW.je_date)::int;
    SELECT status INTO p_status
        FROM gl_periods
        WHERE org_id = NEW.org_id AND year = p_year AND month = p_month;
    IF p_status IS NULL THEN
        RAISE EXCEPTION 'no gl_period for %-% in org %; open it before posting',
            p_year, p_month, NEW.org_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF p_status = 'closed' THEN
        RAISE EXCEPTION 'gl_period %-% is closed for org %', p_year, p_month, NEW.org_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER gl_journals_period_open
    BEFORE INSERT OR UPDATE OF je_date, posted ON gl_journals
    FOR EACH ROW EXECUTE FUNCTION gl_assert_period_open();

-- Header immutability: once posted, only reversed_by may change. Bypassable
-- via app.bypass_lock for emergency archival ops.
CREATE OR REPLACE FUNCTION gl_journal_header_immutable() RETURNS trigger AS $$
BEGIN
    IF OLD.posted IS NOT TRUE THEN RETURN NEW; END IF;
    IF current_setting('app.bypass_lock', true) = 'on' THEN RETURN NEW; END IF;
    -- Allow only reversed_by to change post-posting.
    IF NEW.org_id      IS DISTINCT FROM OLD.org_id
       OR NEW.journal_no  IS DISTINCT FROM OLD.journal_no
       OR NEW.je_date     IS DISTINCT FROM OLD.je_date
       OR NEW.source_type IS DISTINCT FROM OLD.source_type
       OR NEW.source_id   IS DISTINCT FROM OLD.source_id
       OR NEW.memo        IS DISTINCT FROM OLD.memo
       OR NEW.posted      IS DISTINCT FROM OLD.posted
       OR NEW.posted_at   IS DISTINCT FROM OLD.posted_at
       OR NEW.posted_by   IS DISTINCT FROM OLD.posted_by
       OR NEW.reversal_of IS DISTINCT FROM OLD.reversal_of
       OR NEW.created_by  IS DISTINCT FROM OLD.created_by
       OR NEW.created_at  IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'cannot modify posted journal header (only reversed_by may change)'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER gl_journals_header_immutable
    BEFORE UPDATE ON gl_journals
    FOR EACH ROW EXECUTE FUNCTION gl_journal_header_immutable();

-- Control-account guard: manual JEs cannot touch AR / AP / Inventory etc.
-- Sub-ledger postings (source_type != 'manual') are allowed.
CREATE OR REPLACE FUNCTION gl_block_manual_control_writes() RETURNS trigger AS $$
DECLARE
    j_source_type text;
    a_is_control  boolean;
BEGIN
    IF current_setting('app.bypass_lock', true) = 'on' THEN RETURN NEW; END IF;
    SELECT source_type INTO j_source_type FROM gl_journals  WHERE id = NEW.journal_id;
    SELECT is_control  INTO a_is_control  FROM gl_accounts WHERE id = NEW.account_id;
    IF a_is_control = true AND j_source_type = 'manual' THEN
        RAISE EXCEPTION 'manual JE cannot post to control account %; use the originating sub-ledger event',
            NEW.account_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER gl_lines_block_manual_control
    BEFORE INSERT ON gl_journal_lines
    FOR EACH ROW EXECUTE FUNCTION gl_block_manual_control_writes();

-- Partial indexes on optional subledger refs — speed up product/batch queries
-- without bloating the index when most lines have neither set.
CREATE INDEX gl_lines_product ON gl_journal_lines(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX gl_lines_batch   ON gl_journal_lines(batch_id)   WHERE batch_id   IS NOT NULL;

-- ============================================================================
-- CROSS-TABLE INTEGRITY TRIGGERS
-- ============================================================================

-- stock_movements: every referenced entity (product, batch, warehouse, user)
-- must belong to the movement's org. Defense in depth — the app uses scoped
-- inserts but a trigger catches forgotten paths and direct SQL.
CREATE OR REPLACE FUNCTION stock_movements_org_match() RETURNS trigger AS $$
DECLARE
    p_org uuid;
    b_org uuid;
    fwh_org uuid;
    twh_org uuid;
    u_org uuid;
BEGIN
    SELECT org_id INTO p_org   FROM products      WHERE id = NEW.product_id;
    IF p_org IS DISTINCT FROM NEW.org_id THEN
        RAISE EXCEPTION 'stock_movements: product % belongs to org % not %',
            NEW.product_id, p_org, NEW.org_id USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.batch_id IS NOT NULL THEN
        SELECT org_id INTO b_org FROM stock_batches WHERE id = NEW.batch_id;
        IF b_org IS DISTINCT FROM NEW.org_id THEN
            RAISE EXCEPTION 'stock_movements: batch % belongs to org % not %',
                NEW.batch_id, b_org, NEW.org_id USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    IF NEW.from_wh_id IS NOT NULL THEN
        SELECT org_id INTO fwh_org FROM warehouses WHERE id = NEW.from_wh_id;
        IF fwh_org IS DISTINCT FROM NEW.org_id THEN
            RAISE EXCEPTION 'stock_movements: from_wh % belongs to org % not %',
                NEW.from_wh_id, fwh_org, NEW.org_id USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    IF NEW.to_wh_id IS NOT NULL THEN
        SELECT org_id INTO twh_org FROM warehouses WHERE id = NEW.to_wh_id;
        IF twh_org IS DISTINCT FROM NEW.org_id THEN
            RAISE EXCEPTION 'stock_movements: to_wh % belongs to org % not %',
                NEW.to_wh_id, twh_org, NEW.org_id USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    IF NEW.user_id IS NOT NULL THEN
        SELECT org_id INTO u_org FROM users WHERE id = NEW.user_id;
        IF u_org IS DISTINCT FROM NEW.org_id THEN
            RAISE EXCEPTION 'stock_movements: user % belongs to org % not %',
                NEW.user_id, u_org, NEW.org_id USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER stock_movements_org_match
    BEFORE INSERT ON stock_movements
    FOR EACH ROW EXECUTE FUNCTION stock_movements_org_match();

-- ar_ledger: validate running_balance = prior_running_balance + debit - credit
-- per customer. The advisory lock serializes concurrent inserts for the same
-- customer so two BEFORE-triggers can't read stale prior values. The app
-- (services/ar-ledger.ts) already takes its own lock; this is defense in depth.
CREATE OR REPLACE FUNCTION ar_ledger_validate_balance() RETURNS trigger AS $$
DECLARE
    prior numeric(14,2);
    expected numeric(14,2);
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtext('ar_ledger.' || NEW.customer_id::text)
    );
    SELECT running_balance INTO prior
        FROM ar_ledger
        WHERE customer_id = NEW.customer_id
        ORDER BY id DESC
        LIMIT 1;
    IF prior IS NULL THEN prior := 0; END IF;
    expected := prior + NEW.debit - NEW.credit;
    IF NEW.running_balance <> expected THEN
        RAISE EXCEPTION 'ar_ledger running_balance % mismatch for customer % (prior=% dr=% cr=% expected=%)',
            NEW.running_balance, NEW.customer_id, prior, NEW.debit, NEW.credit, expected
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER ar_ledger_validate_balance
    BEFORE INSERT ON ar_ledger
    FOR EACH ROW EXECUTE FUNCTION ar_ledger_validate_balance();

-- ============================================================================
-- SEED: roles_permissions
-- ============================================================================

INSERT INTO roles_permissions(role, resource, action, scope) VALUES
  -- Sales rep
  ('sales',     'customer',     'read',     'route'),
  ('sales',     'order',        'create',   'own'),
  ('sales',     'order',        'read',     'own'),
  ('sales',     'invoice',      'read',     'own'),
  ('sales',     'product',      'read',     'all'),
  ('sales',     'price_list',   'read',     'all'),
  ('sales',     'visit',        'create',   'own'),
  ('sales',     'visit',        'read',     'own'),
  -- Collector
  ('collector', 'customer',     'read',     'route'),
  ('collector', 'payment',      'create',   'own'),
  ('collector', 'payment',      'read',     'own'),
  ('collector', 'visit',        'create',   'own'),
  ('collector', 'visit',        'read',     'own'),
  ('collector', 'promise',      'create',   'own'),
  ('collector', 'promise',      'read',     'own'),
  ('collector', 'dispute',      'create',   'own'),
  ('collector', 'invoice',      'read',     'route'),
  ('collector', 'customer',     'hold',     'own'),   -- request only
  ('collector', 'eod',          'create',   'own'),
  -- Driver
  ('driver',    'delivery',     'read',     'trip'),
  ('driver',    'delivery',     'confirm',  'trip'),
  ('driver',    'return',       'create',   'trip'),
  ('driver',    'stock',        'transfer', 'trip'),   -- van → wh
  ('driver',    'trip',         'read',     'own'),
  ('driver',    'customer',     'read',     'trip'),
  -- Accounts
  ('accounts',  'customer',     'read',     'all'),
  ('accounts',  'customer',     'create',   'all'),
  ('accounts',  'order',        'create',   'all'),
  ('accounts',  'order',        'read',     'all'),
  ('accounts',  'invoice',      'read',     'all'),
  ('accounts',  'payment',      'read',     'all'),
  ('accounts',  'payment',      'verify',   'all'),
  ('accounts',  'credit_note',  'create',   'all'),
  ('accounts',  'credit_note',  'read',     'all'),
  ('accounts',  'dispute',      'read',     'all'),
  ('accounts',  'dispute',      'resolve',  'all'),
  ('accounts',  'customer',     'hold',     'all'),
  ('accounts',  'credit_limit', 'read',     'all'),
  ('accounts',  'dashboard',    'read',     'all'),
  ('accounts',  'product',      'read',     'all'),
  ('accounts',  'stock',        'transfer', 'all'),
  ('accounts',  'gl',           'read',     'all'),
  ('accounts',  'gl',           'post',     'all'),
  -- Admin (wildcard)
  ('admin',     '*',            '*',        'all'),
  -- Owner
  ('owner',     '*',            'read',     'all'),
  ('owner',     'approval',     'decide',   'all'),
  ('owner',     'credit_limit', 'edit',     'all'),
  ('owner',     'stock_adjust', 'approve',  'all'),
  ('owner',     'customer',     'hold',     'all'),
  ('owner',     'dashboard',    'read',     'all'),
  ('owner',     'gl',           'post',     'all'),
  ('owner',     'gl',           'close',    'all')
ON CONFLICT DO NOTHING;

COMMIT;
