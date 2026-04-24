-- Verify initial_schema: ensure core tables and new additions exist.
BEGIN;

SELECT 1/count(*) FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN (
     'orgs','org_config','users','customers','customer_credit_state',
     'products','brands','warehouses','stock_batches','stock_movements',
     'sales_orders','invoices','ar_ledger','payments','payment_allocations',
     'collection_visits','promises','disputes','collector_eod',
     'collector_priority_list','trips','deliveries','delivery_lines',
     'returns','trip_reconciliation','suppliers','purchase_orders',
     'notifications','file_uploads','approval_requests','audit_log',
     'locks','sync_events','integration_sync_log',
     'product_substitutions'
   )
HAVING count(*) = 35;

ROLLBACK;
