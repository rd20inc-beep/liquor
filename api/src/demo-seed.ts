/**
 * Demo-data seed — idempotent. Creates brand, products, stock, customers, and
 * a small order/invoice/payment trail so the dashboards have something to show.
 *
 * Run: docker compose exec api pnpm --filter @liquor/api exec tsx src/demo-seed.ts
 */
import { resolve } from 'node:path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(import.meta.dirname, '../../.env') });

import postgres from 'postgres';
import { config } from './config.js';
import { appendLedger } from './services/ar-ledger.js';
import { refreshCreditState } from './services/credit-state.js';

const sql = postgres(config.DATABASE_URL);

const ORG = '00000000-0000-0000-0000-000000000001';
const ADMIN = '00000000-0000-0000-0000-000000000010';
const COLLECTOR = '00000000-0000-0000-0000-000000000030';
const MAIN_WH = '00000000-0000-0000-0000-000000000200';
const PRICE_LIST = '00000000-0000-0000-0000-000000000100';
const ROUTE = '00000000-0000-0000-0000-000000000300';

// Deterministic UUIDs so re-runs are idempotent
const BRAND = '11111111-1111-1111-1111-111111110001';
const VEHICLE = '22222222-2222-2222-2222-222222220001';
const VAN = '22222222-2222-2222-2222-222222220002';

const PRODUCTS = [
  { id: '33333333-3333-3333-3333-333333330001', sku: 'MUR-CLAS-650', name: 'Murree Classic Lager 650ml',       size: 650,  case_qty: 12, tax: 17, mrp: 600,  price: 480,  reorder: 24 },
  { id: '33333333-3333-3333-3333-333333330002', sku: 'MUR-STR-650',  name: 'Murree Strong 650ml',               size: 650,  case_qty: 12, tax: 17, mrp: 680,  price: 540,  reorder: 24 },
  { id: '33333333-3333-3333-3333-333333330003', sku: 'MUR-MAL-750',  name: 'Murree Millennium Malt 750ml',      size: 750,  case_qty: 6,  tax: 17, mrp: 4500, price: 3600, reorder: 6  },
  { id: '33333333-3333-3333-3333-333333330004', sku: 'MUR-VOD-750',  name: 'Murree Vintage Vodka 750ml',        size: 750,  case_qty: 6,  tax: 17, mrp: 2800, price: 2200, reorder: 6  },
];

const CUSTOMERS = [
  { id: '44444444-4444-4444-4444-444444440001', code: 'C-001', name: 'Peshawar Club Bar',           seq: 1,  limit: 250000,  hv: true  },
  { id: '44444444-4444-4444-4444-444444440002', code: 'C-002', name: 'Serena Hotel — F&B',           seq: 2,  limit: 500000,  hv: true  },
  { id: '44444444-4444-4444-4444-444444440003', code: 'C-003', name: 'Blue Lagoon Karachi',          seq: 3,  limit: 150000,  hv: false },
  { id: '44444444-4444-4444-4444-444444440004', code: 'C-004', name: 'Marriott Islamabad — F&B',     seq: 4,  limit: 800000,  hv: true  },
  { id: '44444444-4444-4444-4444-444444440005', code: 'C-005', name: 'Gymkhana Lahore',              seq: 5,  limit: 300000,  hv: false },
  { id: '44444444-4444-4444-4444-444444440006', code: 'C-006', name: 'Sind Club',                    seq: 6,  limit: 200000,  hv: false },
  { id: '44444444-4444-4444-4444-444444440007', code: 'C-007', name: 'Pearl Continental Bhurban',    seq: 7,  limit: 400000,  hv: true  },
  { id: '44444444-4444-4444-4444-444444440008', code: 'C-008', name: 'Boat Club Karachi',            seq: 8,  limit: 100000,  hv: false },
];

// Batches to open — date expressions keep data fresh on re-run
interface BatchSpec {
  id: string;
  product_id: string;
  warehouse_id: string;
  batch_no: string;
  expiry_sql: string;    // raw SQL for expiry_date
  cost_price: number;
  qty: number;
}
const BATCHES: BatchSpec[] = [
  // Main WH — healthy stock
  { id: '55555555-5555-5555-5555-555555550001', product_id: PRODUCTS[0]!.id, warehouse_id: MAIN_WH, batch_no: 'MC-2601', expiry_sql: "current_date + interval '180 days'", cost_price: 420, qty: 144 },
  { id: '55555555-5555-5555-5555-555555550002', product_id: PRODUCTS[1]!.id, warehouse_id: MAIN_WH, batch_no: 'MS-2601', expiry_sql: "current_date + interval '120 days'", cost_price: 480, qty: 96  },
  { id: '55555555-5555-5555-5555-555555550003', product_id: PRODUCTS[2]!.id, warehouse_id: MAIN_WH, batch_no: 'MM-2601', expiry_sql: "current_date + interval '400 days'", cost_price: 3100, qty: 24 },
  // Vodka: one batch, low qty + near-expiry → triggers LOW + EXPIRES flags
  { id: '55555555-5555-5555-5555-555555550004', product_id: PRODUCTS[3]!.id, warehouse_id: MAIN_WH, batch_no: 'MV-2512', expiry_sql: "current_date + interval '18 days'",  cost_price: 1900, qty: 4 },
];

async function seed() {
  console.log('Demo seed starting…');

  // 1. Brand
  await sql`
    INSERT INTO brands (id, org_id, name) VALUES (${BRAND}, ${ORG}, 'Murree Brewery')
    ON CONFLICT (id) DO NOTHING
  `;
  console.log('  ✓ Brand: Murree Brewery');

  // 2. Products
  for (const p of PRODUCTS) {
    await sql`
      INSERT INTO products (id, org_id, sku, name, brand_id, category, bottle_size_ml, case_qty, tax_rate, mrp, reorder_point, safety_stock, lead_time_days)
      VALUES (${p.id}, ${ORG}, ${p.sku}, ${p.name}, ${BRAND}, 'spirits', ${p.size}, ${p.case_qty}, ${p.tax}, ${p.mrp}, ${p.reorder}, ${Math.floor(p.reorder / 2)}, 7)
      ON CONFLICT (id) DO NOTHING
    `;
  }
  console.log(`  ✓ Products: ${PRODUCTS.length}`);

  // 3. Price list items
  for (const p of PRODUCTS) {
    await sql`
      INSERT INTO price_list_items (price_list_id, product_id, unit_price, case_price, min_qty)
      VALUES (${PRICE_LIST}, ${p.id}, ${p.price}, ${p.price * p.case_qty * 0.95}, 1)
      ON CONFLICT (price_list_id, product_id) DO UPDATE SET unit_price = EXCLUDED.unit_price
    `;
  }
  console.log('  ✓ Price list items');

  // 4. Vehicle + van
  await sql`
    INSERT INTO vehicles (id, org_id, reg_no, capacity_cases)
    VALUES (${VEHICLE}, ${ORG}, 'ISB-4472', 60)
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO warehouses (id, org_id, code, name, type, vehicle_id, custodian_user_id)
    VALUES (${VAN}, ${ORG}, 'VAN-01', 'Van ISB-4472', 'van', ${VEHICLE}, ${COLLECTOR})
    ON CONFLICT (id) DO NOTHING
  `;
  console.log('  ✓ Vehicle + van warehouse');

  // 5. Customers on the default route
  for (const c of CUSTOMERS) {
    await sql`
      INSERT INTO customers (id, org_id, code, name, route_id, route_sequence, credit_limit, price_list_id, high_value)
      VALUES (${c.id}, ${ORG}, ${c.code}, ${c.name}, ${ROUTE}, ${c.seq}, ${c.limit}, ${PRICE_LIST}, ${c.hv})
      ON CONFLICT (org_id, code) DO UPDATE SET credit_limit = EXCLUDED.credit_limit
    `;
  }
  console.log(`  ✓ Customers: ${CUSTOMERS.length}`);

  // 6. Stock receipts — open batches and write purchase_in movements
  for (const b of BATCHES) {
    // Check if batch already exists
    const [exists] = await sql`SELECT id FROM stock_batches WHERE id = ${b.id}`;
    if (exists) continue;
    await sql.begin(async (tx) => {
      const expiryDate = await tx.unsafe(`SELECT (${b.expiry_sql})::date AS d`);
      const d = expiryDate[0]!.d;
      await tx`
        INSERT INTO stock_batches (id, org_id, product_id, warehouse_id, batch_no, expiry_date, cost_price, qty_physical)
        VALUES (${b.id}, ${ORG}, ${b.product_id}, ${b.warehouse_id}, ${b.batch_no}, ${d}, ${b.cost_price}, ${b.qty})
      `;
      await tx`
        INSERT INTO stock_movements (org_id, product_id, batch_id, from_wh_id, to_wh_id, qty, reason, ref_type, ref_id, user_id)
        VALUES (${ORG}, ${b.product_id}, ${b.id}, NULL, ${b.warehouse_id}, ${b.qty}, 'purchase_in', 'receipt', ${b.id}, ${ADMIN})
      `;
    });
  }
  console.log(`  ✓ Batches: ${BATCHES.length}`);

  // 7. A posted invoice + partial payment (to put numbers on the dashboard)
  const DEMO_ORDER = '66666666-6666-6666-6666-666666660001';
  const DEMO_INVOICE = '77777777-7777-7777-7777-777777770001';
  const DEMO_PAYMENT = '88888888-8888-8888-8888-888888880001';

  const [invExists] = await sql`SELECT id FROM invoices WHERE id = ${DEMO_INVOICE}`;
  if (!invExists) {
    const cust = CUSTOMERS[3]!; // Marriott — high credit limit
    const prod = PRODUCTS[0]!;  // Murree Classic
    const qty = 24;
    const unit = prod.price;
    const afterDiscount = unit * qty;
    const tax = afterDiscount * (prod.tax / 100);
    const total = Math.round((afterDiscount + tax) * 100) / 100;

    await sql.begin(async (tx) => {
      // Order
      await tx`
        INSERT INTO sales_orders (id, org_id, order_no, customer_id, channel, order_date, status, credit_decision, subtotal, tax_total, total)
        VALUES (${DEMO_ORDER}, ${ORG}, 'SO-DEMO-001', ${cust.id}, 'admin', current_date, 'invoiced', 'approve', ${afterDiscount}, ${tax}, ${total})
      `;
      await tx`
        INSERT INTO sales_order_lines (order_id, product_id, qty, unit_price, tax_rate, line_total)
        VALUES (${DEMO_ORDER}, ${prod.id}, ${qty}, ${unit}, ${prod.tax}, ${total})
      `;

      // Invoice (locked from birth), consume 24 from main warehouse batch #1
      await tx`
        INSERT INTO invoices (id, org_id, invoice_no, order_id, customer_id, invoice_date, due_date, subtotal, tax_total, total, outstanding, status, locked_at)
        VALUES (${DEMO_INVOICE}, ${ORG}, 'INV-DEMO-001', ${DEMO_ORDER}, ${cust.id}, current_date, current_date + 14, ${afterDiscount}, ${tax}, ${total}, ${total}, 'open', now())
      `;
      await tx`
        INSERT INTO invoice_lines (invoice_id, product_id, batch_id, qty, unit_price, tax_rate, line_total)
        VALUES (${DEMO_INVOICE}, ${prod.id}, ${BATCHES[0]!.id}, ${qty}, ${unit}, ${prod.tax}, ${total})
      `;

      // Decrement batch physical + write sale movement
      await tx`
        UPDATE stock_batches SET qty_physical = qty_physical - ${qty} WHERE id = ${BATCHES[0]!.id}
      `;
      await tx`
        INSERT INTO stock_movements (org_id, product_id, batch_id, from_wh_id, to_wh_id, qty, reason, ref_type, ref_id, user_id)
        VALUES (${ORG}, ${prod.id}, ${BATCHES[0]!.id}, ${MAIN_WH}, NULL, ${qty}, 'sale', 'invoice', ${DEMO_INVOICE}, ${ADMIN})
      `;

      // Ledger debit
      await appendLedger(tx, {
        orgId: ORG,
        customerId: cust.id,
        entryType: 'invoice',
        refType: 'invoice',
        refId: DEMO_INVOICE,
        debit: total,
        credit: 0,
        note: 'Invoice INV-DEMO-001',
      });

      // Partial payment of 60% (cash) — allocate via bypass on the locked invoice
      const paymentAmt = Math.round(total * 0.6 * 100) / 100;
      await tx`
        INSERT INTO payments (id, org_id, receipt_no, customer_id, collector_id, amount, mode, verification_status, collected_at, verified_at, verified_by, locked_at)
        VALUES (${DEMO_PAYMENT}, ${ORG}, 'RC-DEMO-001', ${cust.id}, ${COLLECTOR}, ${paymentAmt}, 'cash', 'verified', now(), now(), ${ADMIN}, now())
      `;
      await tx`SELECT set_config('app.bypass_lock', 'on', true)`;
      await tx`
        INSERT INTO payment_allocations (payment_id, invoice_id, amount)
        VALUES (${DEMO_PAYMENT}, ${DEMO_INVOICE}, ${paymentAmt})
      `;
      await tx`
        UPDATE invoices SET outstanding = outstanding - ${paymentAmt}, status = 'partial' WHERE id = ${DEMO_INVOICE}
      `;

      await appendLedger(tx, {
        orgId: ORG,
        customerId: cust.id,
        entryType: 'payment',
        refType: 'payment',
        refId: DEMO_PAYMENT,
        debit: 0,
        credit: paymentAmt,
        note: 'Payment RC-DEMO-001 (cash)',
      });
    });
    console.log('  ✓ Demo order → invoice → partial payment');
  } else {
    console.log('  ⊙ Demo order already present — skipping');
  }

  // 8. A held order — tests the held-orders tile
  const HELD_ORDER = '66666666-6666-6666-6666-666666660002';
  const [heldExists] = await sql`SELECT id FROM sales_orders WHERE id = ${HELD_ORDER}`;
  if (!heldExists) {
    // Pick a customer with a tight credit limit relative to the order total
    const cust = CUSTOMERS[2]!; // Blue Lagoon — 150k limit
    const prod = PRODUCTS[2]!;  // Millennium Malt @ 3600 x 6 = 21.6k gross
    const qty = 60; // 60 bottles → 216k gross — exceeds 150k limit
    const unit = prod.price;
    const afterDiscount = unit * qty;
    const tax = afterDiscount * (prod.tax / 100);
    const total = Math.round((afterDiscount + tax) * 100) / 100;
    await sql`
      INSERT INTO sales_orders (id, org_id, order_no, customer_id, channel, order_date, status, credit_decision, credit_reasons, subtotal, tax_total, total)
      VALUES (${HELD_ORDER}, ${ORG}, 'SO-DEMO-002', ${cust.id}, 'admin', current_date, 'held', 'hold',
              ${sql.json(['over_credit_limit'])}, ${afterDiscount}, ${tax}, ${total})
    `;
    await sql`
      INSERT INTO sales_order_lines (order_id, product_id, qty, unit_price, tax_rate, line_total)
      VALUES (${HELD_ORDER}, ${prod.id}, ${qty}, ${unit}, ${prod.tax}, ${total})
    `;
    console.log('  ✓ Held order (over credit limit)');
  } else {
    console.log('  ⊙ Held order already present — skipping');
  }

  // 9. Refresh credit state for every demo customer so available_credit,
  //    outstanding_total, and aging buckets reflect the seeded activity.
  for (const c of CUSTOMERS) {
    await refreshCreditState(c.id);
  }
  console.log(`  ✓ Refreshed credit state: ${CUSTOMERS.length} customers`);

  await sql.end();
  console.log('Demo seed complete.');
}

seed().catch((err) => {
  console.error('Demo seed failed:', err);
  process.exit(1);
});
