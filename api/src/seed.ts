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
import { ensureCurrentPeriod, seedDefaultCoa } from './services/gl-seed.js';

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

  // Default logins (idempotent): role + phone + human-readable login_id
  const seedUsers = [
    { id: '00000000-0000-0000-0000-000000000010', name: 'Admin',             login: 'admin',   phone: '+923009999000', role: 'admin' },
    { id: '00000000-0000-0000-0000-000000000011', name: 'Owner',             login: 'owner',   phone: '+923009999001', role: 'owner' },
    { id: '00000000-0000-0000-0000-000000000020', name: 'Ahmed (Sales)',     login: 'ahmed',   phone: '+923009999002', role: 'sales' },
    { id: '00000000-0000-0000-0000-000000000030', name: 'Bilal (Collector)', login: 'bilal',   phone: '+923009999003', role: 'collector' },
    { id: '00000000-0000-0000-0000-000000000040', name: 'Imran (Driver)',    login: 'imran',   phone: '+923009999004', role: 'driver' },
    { id: '00000000-0000-0000-0000-000000000050', name: 'Ayesha (Accounts)', login: 'ayesha',  phone: '+923009999005', role: 'accounts' },
  ] as const;
  for (const u of seedUsers) {
    await sql`
      INSERT INTO users (id, org_id, name, login_id, phone, role)
      VALUES (${u.id}, ${orgId}, ${u.name}, ${u.login}, ${u.phone}, ${u.role})
      ON CONFLICT (id) DO UPDATE SET
        login_id = EXCLUDED.login_id,
        name     = EXCLUDED.name
    `;
    console.log(`  ${u.role.padEnd(10)} login=${u.login} phone=${u.phone}`);
  }

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

  await seedDefaultCoa(sql, orgId);
  await ensureCurrentPeriod(sql, orgId);
  console.log('  Default COA + current GL period seeded');

  await sql.end();
  console.log('Seed complete.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
