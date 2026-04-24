import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Lock enforcement integration tests (LDS-091). Connects to TEST_DATABASE_URL
 * which should point at a freshly-migrated Postgres with the Liquor OS schema
 * applied. Skipped otherwise — the suite is safe to run under vitest regardless.
 */

const url = process.env.TEST_DATABASE_URL;
const shouldRun = Boolean(url);

// Use describe.skipIf so the suite reports cleanly in CI when the env is absent.
const describeDB = shouldRun ? describe : describe.skip;

describeDB('lock enforcement', () => {
  const sql = postgres(url ?? '', { max: 2 });

  // Seed IDs scoped to this test run so reruns don't collide
  const ORG = '22222222-0000-0000-0000-000000000001';
  const USER = '22222222-0000-0000-0000-000000000010';
  const CUSTOMER = '22222222-0000-0000-0000-000000000100';
  const INVOICE = '22222222-0000-0000-0000-000000000200';
  const PAYMENT = '22222222-0000-0000-0000-000000000300';

  beforeAll(async () => {
    // Idempotent seed — clean up prior run first
    await sql`DELETE FROM ar_ledger WHERE org_id = ${ORG}`;
    await sql`DELETE FROM payment_allocations WHERE payment_id = ${PAYMENT}`;
    await sql`DELETE FROM payments WHERE id = ${PAYMENT}`;
    await sql`DELETE FROM invoices WHERE id = ${INVOICE}`;
    await sql`DELETE FROM customers WHERE id = ${CUSTOMER}`;
    await sql`DELETE FROM users WHERE id = ${USER}`;
    await sql`DELETE FROM orgs WHERE id = ${ORG}`;

    await sql`INSERT INTO orgs (id, name) VALUES (${ORG}, 'lock-test')`;
    await sql`INSERT INTO users (id, org_id, name, phone, role) VALUES (${USER}, ${ORG}, 'admin', '1', 'admin')`;
    await sql`INSERT INTO customers (id, org_id, code, name) VALUES (${CUSTOMER}, ${ORG}, 'C1', 'Test')`;
    await sql`
      INSERT INTO invoices (id, org_id, invoice_no, customer_id, due_date, subtotal, tax_total, total, outstanding, locked_at)
      VALUES (${INVOICE}, ${ORG}, 'INV-LOCK', ${CUSTOMER}, current_date, 1000, 0, 1000, 1000, now())
    `;
    await sql`
      INSERT INTO payments (id, org_id, receipt_no, customer_id, amount, mode, verification_status, locked_at, verified_at, verified_by)
      VALUES (${PAYMENT}, ${ORG}, 'RC-LOCK', ${CUSTOMER}, 500, 'cash', 'verified', now(), now(), ${USER})
    `;
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('locked invoice UPDATE without bypass raises', async () => {
    await expect(sql`UPDATE invoices SET outstanding = 900 WHERE id = ${INVOICE}`).rejects.toThrow(
      /locked/,
    );
  });

  it('locked invoice UPDATE with bypass succeeds', async () => {
    const result = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.bypass_lock', 'on', true)`;
      const rows =
        await tx`UPDATE invoices SET outstanding = 900 WHERE id = ${INVOICE} RETURNING outstanding`;
      return rows[0];
    });
    expect(Number(result?.outstanding)).toBe(900);
    // Restore for next tests
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.bypass_lock', 'on', true)`;
      await tx`UPDATE invoices SET outstanding = 1000 WHERE id = ${INVOICE}`;
    });
  });

  it('ar_ledger UPDATE always raises — append-only', async () => {
    await sql`
      INSERT INTO ar_ledger (org_id, customer_id, entry_type, ref_type, ref_id, debit, credit, running_balance)
      VALUES (${ORG}, ${CUSTOMER}, 'invoice', 'invoice', ${INVOICE}, 1000, 0, 1000)
    `;
    await expect(
      sql`UPDATE ar_ledger SET note = 'x' WHERE customer_id = ${CUSTOMER}`,
    ).rejects.toThrow(/append-only/);

    // Even bypass does not permit UPDATE — only DELETE
    await expect(
      sql.begin(async (tx) => {
        await tx`SELECT set_config('app.bypass_lock', 'on', true)`;
        await tx`UPDATE ar_ledger SET note = 'x' WHERE customer_id = ${CUSTOMER}`;
      }),
    ).rejects.toThrow(/append-only/);
  });

  it('ar_ledger zero-entry CHECK rejects debit=0 AND credit=0', async () => {
    await expect(
      sql`
        INSERT INTO ar_ledger (org_id, customer_id, entry_type, ref_type, ref_id, debit, credit, running_balance)
        VALUES (${ORG}, ${CUSTOMER}, 'adjustment', 'test', ${INVOICE}, 0, 0, 1000)
      `,
    ).rejects.toThrow(/ar_ledger_check/);
  });

  it('payment_allocations INSERT on locked payment is blocked', async () => {
    await expect(
      sql`INSERT INTO payment_allocations (payment_id, invoice_id, amount) VALUES (${PAYMENT}, ${INVOICE}, 100)`,
    ).rejects.toThrow(/locked/);
  });

  it('payment_allocations INSERT on locked payment succeeds under bypass', async () => {
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.bypass_lock', 'on', true)`;
      await tx`INSERT INTO payment_allocations (payment_id, invoice_id, amount) VALUES (${PAYMENT}, ${INVOICE}, 100)`;
    });
    const [row] = await sql<Array<{ amount: string }>>`
      SELECT amount FROM payment_allocations WHERE payment_id = ${PAYMENT} AND invoice_id = ${INVOICE}
    `;
    expect(Number(row?.amount)).toBe(100);
  });
});
