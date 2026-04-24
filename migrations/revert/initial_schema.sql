-- Revert initial_schema: drop everything created in deploy.
-- Order: views, triggers handled by cascade, tables reverse-dep order, then enums.
BEGIN;

DROP VIEW IF EXISTS v_invoice_aging;
DROP VIEW IF EXISTS v_stock_state;

-- Tables (children first)
DROP TABLE IF EXISTS sync_events CASCADE;
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS locks CASCADE;
DROP TABLE IF EXISTS approval_requests CASCADE;
DROP TABLE IF EXISTS returns CASCADE;
DROP TABLE IF EXISTS delivery_lines CASCADE;
DROP TABLE IF EXISTS deliveries CASCADE;
DROP TABLE IF EXISTS trips CASCADE;
DROP TABLE IF EXISTS route_stops CASCADE;
DROP TABLE IF EXISTS collector_eod CASCADE;
DROP TABLE IF EXISTS disputes CASCADE;
DROP TABLE IF EXISTS promises CASCADE;
DROP TABLE IF EXISTS payment_allocations CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS collection_visits CASCADE;
DROP TABLE IF EXISTS ar_ledger CASCADE;
DROP TABLE IF EXISTS credit_notes CASCADE;
DROP TABLE IF EXISTS invoice_lines CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS sales_order_lines CASCADE;
DROP TABLE IF EXISTS sales_orders CASCADE;
DROP TABLE IF EXISTS cycle_count_lines CASCADE;
DROP TABLE IF EXISTS cycle_counts CASCADE;
DROP TABLE IF EXISTS stock_movements CASCADE;
DROP TABLE IF EXISTS stock_batches CASCADE;
DROP TABLE IF EXISTS warehouses CASCADE;
DROP TABLE IF EXISTS vehicles CASCADE;
DROP TABLE IF EXISTS promos CASCADE;
DROP TABLE IF EXISTS price_list_items CASCADE;
DROP TABLE IF EXISTS price_lists CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS brands CASCADE;
DROP TABLE IF EXISTS customer_credit_state CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS payment_terms CASCADE;
DROP TABLE IF EXISTS routes CASCADE;
DROP TABLE IF EXISTS roles_permissions CASCADE;
DROP TABLE IF EXISTS user_devices CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS orgs CASCADE;

-- Functions
DROP FUNCTION IF EXISTS set_updated_at() CASCADE;
DROP FUNCTION IF EXISTS enforce_lock() CASCADE;
DROP FUNCTION IF EXISTS forbid_mutation() CASCADE;
DROP FUNCTION IF EXISTS check_allocation_sum() CASCADE;

-- Enums
DROP TYPE IF EXISTS approval_status;
DROP TYPE IF EXISTS delivery_status;
DROP TYPE IF EXISTS trip_status;
DROP TYPE IF EXISTS promise_status;
DROP TYPE IF EXISTS visit_outcome;
DROP TYPE IF EXISTS payment_verification;
DROP TYPE IF EXISTS payment_mode;
DROP TYPE IF EXISTS ledger_entry_type;
DROP TYPE IF EXISTS invoice_status;
DROP TYPE IF EXISTS credit_decision;
DROP TYPE IF EXISTS order_status;
DROP TYPE IF EXISTS stock_move_reason;
DROP TYPE IF EXISTS warehouse_type;
DROP TYPE IF EXISTS payment_term_type;
DROP TYPE IF EXISTS customer_status;
DROP TYPE IF EXISTS customer_type;
DROP TYPE IF EXISTS user_role;

COMMIT;
