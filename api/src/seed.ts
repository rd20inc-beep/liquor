/**
 * Seed script — creates demo org, admin user, and default payment terms.
 * Idempotent: safe to run multiple times.
 *
 * Usage: tsx api/src/seed.ts
 */
import { resolve } from 'node:path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(import.meta.dirname, '../../.env') });

import postgres from 'postgres';
import { config } from './config.js';

const sql = postgres(config.DATABASE_URL);

async function seed() {
  console.log('Seeding database...');

  // 1. Org
  const [org] = await sql`
    INSERT INTO orgs (id, name, timezone, currency)
    VALUES ('00000000-0000-0000-0000-000000000001', 'Demo Distributors', 'Asia/Karachi', 'PKR')
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `;
  const orgId = org?.id ?? '00000000-0000-0000-0000-000000000001';
  console.log(`  Org: ${orgId}`);

  // 2. Admin user (phone: +923009999000)
  const [admin] = await sql`
    INSERT INTO users (id, org_id, name, phone, role)
    VALUES ('00000000-0000-0000-0000-000000000010', ${orgId}, 'Admin', '+923009999000', 'admin')
    ON CONFLICT (org_id, phone) DO NOTHING
    RETURNING id, phone
  `;
  console.log(`  Admin: ${admin?.phone ?? '+923009999000 (exists)'}`);

  // 3. Owner user
  const [owner] = await sql`
    INSERT INTO users (id, org_id, name, phone, role)
    VALUES ('00000000-0000-0000-0000-000000000011', ${orgId}, 'Owner', '+923009999001', 'owner')
    ON CONFLICT (org_id, phone) DO NOTHING
    RETURNING id, phone
  `;
  console.log(`  Owner: ${owner?.phone ?? '+923009999001 (exists)'}`);

  // 4. Sales rep
  const [rep] = await sql`
    INSERT INTO users (id, org_id, name, phone, role)
    VALUES ('00000000-0000-0000-0000-000000000020', ${orgId}, 'Ahmed (Sales)', '+923009999002', 'sales')
    ON CONFLICT (org_id, phone) DO NOTHING
    RETURNING id, phone
  `;
  console.log(`  Sales Rep: ${rep?.phone ?? '+923009999002 (exists)'}`);

  // 5. Collector
  const [collector] = await sql`
    INSERT INTO users (id, org_id, name, phone, role)
    VALUES ('00000000-0000-0000-0000-000000000030', ${orgId}, 'Bilal (Collector)', '+923009999003', 'collector')
    ON CONFLICT (org_id, phone) DO NOTHING
    RETURNING id, phone
  `;
  console.log(`  Collector: ${collector?.phone ?? '+923009999003 (exists)'}`);

  // 6. Driver
  const [driver] = await sql`
    INSERT INTO users (id, org_id, name, phone, role)
    VALUES ('00000000-0000-0000-0000-000000000040', ${orgId}, 'Imran (Driver)', '+923009999004', 'driver')
    ON CONFLICT (org_id, phone) DO NOTHING
    RETURNING id, phone
  `;
  console.log(`  Driver: ${driver?.phone ?? '+923009999004 (exists)'}`);

  // 7. Accounts
  const [accounts] = await sql`
    INSERT INTO users (id, org_id, name, phone, role)
    VALUES ('00000000-0000-0000-0000-000000000050', ${orgId}, 'Ayesha (Accounts)', '+923009999005', 'accounts')
    ON CONFLICT (org_id, phone) DO NOTHING
    RETURNING id, phone
  `;
  console.log(`  Accounts: ${accounts?.phone ?? '+923009999005 (exists)'}`);

  // 8. Default payment terms
  const terms = [
    { code: 'CASH', type: 'cash', days: 0, grace: 0, pdc: false },
    { code: 'SAME_DAY', type: 'same_day', days: 0, grace: 0, pdc: false },
    { code: 'NET7', type: 'net_7', days: 7, grace: 2, pdc: false },
    { code: 'NET14', type: 'net_14', days: 14, grace: 3, pdc: false },
    { code: 'NET30', type: 'net_30', days: 30, grace: 5, pdc: false },
    { code: 'PDC', type: 'pdc', days: 30, grace: 0, pdc: true },
  ];
  for (const t of terms) {
    await sql`
      INSERT INTO payment_terms (org_id, code, type, days, grace_days, requires_pdc)
      VALUES (${orgId}, ${t.code}, ${t.type}, ${t.days}, ${t.grace}, ${t.pdc})
      ON CONFLICT (org_id, code) DO NOTHING
    `;
  }
  console.log(`  Payment terms: ${terms.length} seeded`);

  // 9. Default price list
  await sql`
    INSERT INTO price_lists (id, org_id, name, effective_from, is_default)
    VALUES ('00000000-0000-0000-0000-000000000100', ${orgId}, 'Standard', '2026-01-01', true)
    ON CONFLICT (org_id, name) DO NOTHING
  `;
  console.log('  Default price list: Standard');

  // 10. Default warehouse
  await sql`
    INSERT INTO warehouses (id, org_id, code, name, type)
    VALUES ('00000000-0000-0000-0000-000000000200', ${orgId}, 'WH-MAIN', 'Main Warehouse', 'warehouse')
    ON CONFLICT (org_id, code) DO NOTHING
  `;
  console.log('  Warehouse: WH-MAIN');

  // 11. Default route
  await sql`
    INSERT INTO routes (id, org_id, name)
    VALUES ('00000000-0000-0000-0000-000000000300', ${orgId}, 'Route-A')
    ON CONFLICT (org_id, name) DO NOTHING
  `;
  console.log('  Route: Route-A');

  await sql.end();
  console.log('Seed complete.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
