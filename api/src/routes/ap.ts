import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { rbacGuard } from '../plugins/rbac.js';
import { audit } from '../services/audit.js';
import {
  billNo as generateBillNo,
  billPaymentNo as generateBillPaymentNo,
  expenseNo as generateExpenseNo,
  vendorCode as generateVendorCode,
} from '../services/doc-numbers.js';
import {
  postBillPaymentToLedger,
  postBillToLedger,
  postExpenseToLedger,
} from '../services/gl-post.js';

// ---------- Schemas ----------

const VendorBody = z.object({
  name: z.string().min(1).max(200),
  contact_phone: z.string().max(50).optional(),
  contact_email: z.string().email().optional(),
  address: z.string().optional(),
  ntn: z.string().max(50).optional(),
  notes: z.string().optional(),
});

const VendorUpdate = VendorBody.partial().extend({
  active: z.boolean().optional(),
});

const ExpenseCategoryBody = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  gl_account_code: z.string().min(1).max(20),
  active: z.boolean().optional(),
});

const BillBody = z.object({
  vendor_id: z.string().uuid(),
  vendor_ref: z.string().max(100).optional(),
  bill_date: z.string().date(),
  due_date: z.string().date(),
  expense_category_id: z.string().uuid().optional(),
  gl_account_code: z.string().min(1).max(20).optional(),
  amount: z.number().positive(),
  description: z.string().optional(),
  attachment_url: z.string().url().optional(),
});

const BillPaymentBody = z.object({
  bill_id: z.string().uuid(),
  payment_date: z.string().date(),
  amount: z.number().positive(),
  pay_account_code: z.string().min(1).max(20),
  reference: z.string().max(100).optional(),
  notes: z.string().optional(),
});

const ExpenseBody = z.object({
  expense_date: z.string().date(),
  amount: z.number().positive(),
  expense_category_id: z.string().uuid().optional(),
  gl_account_code: z.string().min(1).max(20).optional(),
  pay_account_code: z.string().min(1).max(20),
  vendor_id: z.string().uuid().optional(),
  vehicle_id: z.string().uuid().optional(),
  warehouse_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  description: z.string().optional(),
  attachment_url: z.string().url().optional(),
});

// ---------- Helpers ----------

async function resolveAccountCode(
  tx: typeof sql,
  orgId: string,
  expenseCategoryId: string | undefined,
  glAccountCode: string | undefined,
): Promise<string> {
  if (expenseCategoryId) {
    const [cat] = await tx<Array<{ gl_account_code: string }>>`
      SELECT gl_account_code FROM expense_categories
      WHERE id = ${expenseCategoryId} AND org_id = ${orgId} AND active = true
    `;
    if (!cat) throw badRequest('Expense category not found or inactive');
    return cat.gl_account_code;
  }
  if (!glAccountCode) {
    throw badRequest('Either expense_category_id or gl_account_code is required');
  }
  return glAccountCode;
}

async function assertPostableAccount(
  tx: typeof sql,
  orgId: string,
  code: string,
): Promise<void> {
  const [a] = await tx<Array<{ is_postable: boolean; is_control: boolean }>>`
    SELECT is_postable, is_control FROM gl_accounts
    WHERE org_id = ${orgId} AND code = ${code} AND active = true
  `;
  if (!a) throw badRequest(`GL account ${code} not found or inactive`);
  if (!a.is_postable) throw badRequest(`Account ${code} is a header — not postable`);
  if (a.is_control)
    throw badRequest(`Account ${code} is a control account — not allowed here`);
}

// ---------- Routes ----------

export default async function apRoutes(app: FastifyInstance) {
  // ============= VENDORS =============
  app.get('/vendors', { preHandler: [rbacGuard('vendor', 'read')] }, async (req) => {
    const orgId = req.user.org_id;
    const items = await sql`
      SELECT v.*,
        (SELECT COALESCE(SUM(b.outstanding), 0)::text
           FROM bills b
           WHERE b.vendor_id = v.id AND b.status IN ('open', 'partial')) AS outstanding_total
      FROM vendors v
      WHERE v.org_id = ${orgId}
      ORDER BY v.active DESC, v.name
    `;
    return { items };
  });

  app.get('/vendors/:id', { preHandler: [rbacGuard('vendor', 'read')] }, async (req) => {
    const { id } = req.params as { id: string };
    const orgId = req.user.org_id;
    const [row] = await sql`
      SELECT v.*,
        (SELECT COALESCE(SUM(b.outstanding), 0)::text
           FROM bills b
           WHERE b.vendor_id = v.id AND b.status IN ('open', 'partial')) AS outstanding_total
      FROM vendors v
      WHERE v.id = ${id} AND v.org_id = ${orgId}
    `;
    if (!row) throw notFound('Vendor not found');
    return row;
  });

  app.post('/vendors', { preHandler: [rbacGuard('vendor', 'create')] }, async (req, reply) => {
    const body = VendorBody.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const orgId = req.user.org_id;
    const result = await sql.begin(async (tx) => {
      const code = await generateVendorCode(tx, orgId);
      const [row] = await tx`
        INSERT INTO vendors (org_id, code, name, contact_phone, contact_email, address, ntn, notes)
        VALUES (${orgId}, ${code}, ${body.data.name}, ${body.data.contact_phone ?? null},
                ${body.data.contact_email ?? null}, ${body.data.address ?? null},
                ${body.data.ntn ?? null}, ${body.data.notes ?? null})
        RETURNING *
      `;
      await audit(
        {
          orgId,
          userId: req.user.sub,
          action: 'create',
          entity: 'vendor',
          entityId: row!.id,
          after: { code, name: body.data.name },
        },
        tx,
      );
      return row;
    });
    return reply.status(201).send(result);
  });

  app.patch('/vendors/:id', { preHandler: [rbacGuard('vendor', 'update')] }, async (req) => {
    const { id } = req.params as { id: string };
    const body = VendorUpdate.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const orgId = req.user.org_id;
    const fields = body.data;
    if (Object.keys(fields).length === 0) throw badRequest('No fields to update');

    const cols = Object.keys(fields) as Array<keyof typeof fields>;
    const setObj: Record<string, unknown> = {};
    for (const col of cols) setObj[col] = fields[col];

    const rows = await sql`
      UPDATE vendors SET ${sql(setObj, ...cols)}
      WHERE id = ${id} AND org_id = ${orgId}
      RETURNING *
    `;
    if (rows.length === 0) throw notFound('Vendor not found');
    return rows[0];
  });

  // ============= EXPENSE CATEGORIES =============
  app.get(
    '/expense-categories',
    { preHandler: [rbacGuard('expense', 'read')] },
    async (req) => {
      const orgId = req.user.org_id;
      const items = await sql`
        SELECT * FROM expense_categories WHERE org_id = ${orgId}
        ORDER BY active DESC, code
      `;
      return { items };
    },
  );

  app.post(
    '/expense-categories',
    { preHandler: [rbacGuard('expense', 'create')] },
    async (req, reply) => {
      const body = ExpenseCategoryBody.safeParse(req.body);
      if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
      const orgId = req.user.org_id;
      await assertPostableAccount(sql, orgId, body.data.gl_account_code);
      try {
        const [row] = await sql`
          INSERT INTO expense_categories (org_id, code, name, gl_account_code, active)
          VALUES (${orgId}, ${body.data.code}, ${body.data.name},
                  ${body.data.gl_account_code}, ${body.data.active ?? true})
          RETURNING *
        `;
        return reply.status(201).send(row);
      } catch (err) {
        if (err instanceof Error && err.message.includes('unique')) {
          throw conflict('Category code already exists');
        }
        throw err;
      }
    },
  );

  // ============= BILLS =============
  app.get('/bills', { preHandler: [rbacGuard('bill', 'read')] }, async (req) => {
    const orgId = req.user.org_id;
    const q = z
      .object({
        vendor_id: z.string().uuid().optional(),
        status: z.enum(['open', 'partial', 'paid', 'cancelled']).optional(),
        from: z.string().date().optional(),
        to: z.string().date().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      })
      .safeParse(req.query);
    if (!q.success) throw badRequest('Invalid query', q.error.flatten());
    const { vendor_id, status, from, to, limit } = q.data;

    const items = await sql`
      SELECT b.id, b.bill_no, b.vendor_id, v.code AS vendor_code, v.name AS vendor_name,
             b.vendor_ref, b.bill_date, b.due_date,
             b.amount::text AS amount, b.outstanding::text AS outstanding,
             b.status, b.gl_account_code, b.expense_category_id,
             ec.name AS expense_category_name, b.description
      FROM bills b
      JOIN vendors v ON v.id = b.vendor_id
      LEFT JOIN expense_categories ec ON ec.id = b.expense_category_id
      WHERE b.org_id = ${orgId}
        ${vendor_id ? sql`AND b.vendor_id = ${vendor_id}` : sql``}
        ${status ? sql`AND b.status = ${status}` : sql``}
        ${from ? sql`AND b.bill_date >= ${from}` : sql``}
        ${to ? sql`AND b.bill_date <= ${to}` : sql``}
      ORDER BY b.bill_date DESC, b.bill_no DESC
      LIMIT ${limit}
    `;
    return { items };
  });

  app.get('/bills/:id', { preHandler: [rbacGuard('bill', 'read')] }, async (req) => {
    const { id } = req.params as { id: string };
    const orgId = req.user.org_id;
    const [head] = await sql`
      SELECT b.*, v.code AS vendor_code, v.name AS vendor_name,
             ec.name AS expense_category_name, ec.code AS expense_category_code,
             u.name AS created_by_name
      FROM bills b
      JOIN vendors v ON v.id = b.vendor_id
      LEFT JOIN expense_categories ec ON ec.id = b.expense_category_id
      LEFT JOIN users u ON u.id = b.created_by
      WHERE b.id = ${id} AND b.org_id = ${orgId}
    `;
    if (!head) throw notFound('Bill not found');
    const payments = await sql`
      SELECT id, payment_no, payment_date, amount::text AS amount, pay_account_code, reference, notes
      FROM bill_payments
      WHERE bill_id = ${id}
      ORDER BY payment_date DESC, payment_no DESC
    `;
    return { ...head, payments };
  });

  app.post('/bills', { preHandler: [rbacGuard('bill', 'create')] }, async (req, reply) => {
    const body = BillBody.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const orgId = req.user.org_id;
    const userId = req.user.sub;
    const d = body.data;

    const result = await sql.begin(async (tx) => {
      const [vendor] = await tx<Array<{ id: string; active: boolean }>>`
        SELECT id, active FROM vendors WHERE id = ${d.vendor_id} AND org_id = ${orgId}
      `;
      if (!vendor) throw badRequest('Vendor not found');
      if (!vendor.active) throw conflict('Vendor is inactive');

      const accountCode = await resolveAccountCode(
        tx,
        orgId,
        d.expense_category_id,
        d.gl_account_code,
      );
      await assertPostableAccount(tx, orgId, accountCode);

      const billNoStr = await generateBillNo(tx, orgId);
      const [bill] = await tx<Array<{ id: string }>>`
        INSERT INTO bills (
          org_id, bill_no, vendor_id, vendor_ref, bill_date, due_date,
          expense_category_id, gl_account_code,
          amount, outstanding, status, description, attachment_url,
          created_by, locked_at
        ) VALUES (
          ${orgId}, ${billNoStr}, ${d.vendor_id}, ${d.vendor_ref ?? null},
          ${d.bill_date}, ${d.due_date},
          ${d.expense_category_id ?? null}, ${accountCode},
          ${d.amount}, ${d.amount}, 'open', ${d.description ?? null},
          ${d.attachment_url ?? null},
          ${userId}, now()
        )
        RETURNING id
      `;

      await postBillToLedger(tx, {
        orgId,
        userId,
        billId: bill!.id,
        billNo: billNoStr,
        billDate: d.bill_date,
        expenseAccountCode: accountCode,
        amount: d.amount,
        vendorRef: d.vendor_ref ?? null,
      });

      await audit(
        {
          orgId,
          userId,
          action: 'create',
          entity: 'bill',
          entityId: bill!.id,
          after: { bill_no: billNoStr, vendor_id: d.vendor_id, amount: d.amount },
        },
        tx,
      );

      return { id: bill!.id, bill_no: billNoStr };
    });

    return reply.status(201).send(result);
  });

  // ============= BILL PAYMENTS =============
  app.post(
    '/bill-payments',
    { preHandler: [rbacGuard('bill', 'pay')] },
    async (req, reply) => {
      const body = BillPaymentBody.safeParse(req.body);
      if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
      const orgId = req.user.org_id;
      const userId = req.user.sub;
      const d = body.data;

      const result = await sql.begin(async (tx) => {
        const [bill] = await tx<
          Array<{
            id: string;
            bill_no: string;
            vendor_id: string;
            outstanding: string;
            status: string;
          }>
        >`
          SELECT id, bill_no, vendor_id, outstanding, status
          FROM bills WHERE id = ${d.bill_id} AND org_id = ${orgId}
          FOR UPDATE
        `;
        if (!bill) throw notFound('Bill not found');
        if (bill.status === 'paid') throw conflict('Bill is already paid');
        if (bill.status === 'cancelled') throw conflict('Bill is cancelled');
        const outstanding = Number(bill.outstanding);
        if (d.amount > outstanding) {
          throw conflict(`Payment ${d.amount} exceeds outstanding ${outstanding}`);
        }

        await assertPostableAccount(tx, orgId, d.pay_account_code);

        const paymentNoStr = await generateBillPaymentNo(tx, orgId);
        const [payment] = await tx<Array<{ id: string }>>`
          INSERT INTO bill_payments (
            org_id, payment_no, bill_id, vendor_id, payment_date,
            amount, pay_account_code, reference, notes, created_by, locked_at
          ) VALUES (
            ${orgId}, ${paymentNoStr}, ${d.bill_id}, ${bill.vendor_id}, ${d.payment_date},
            ${d.amount}, ${d.pay_account_code}, ${d.reference ?? null}, ${d.notes ?? null},
            ${userId}, now()
          )
          RETURNING id
        `;

        // Update bill outstanding under bypass (bill is locked-from-birth)
        const newOutstanding = outstanding - d.amount;
        const newStatus = newOutstanding === 0 ? 'paid' : 'partial';
        await tx`SELECT set_config('app.bypass_lock', 'on', true)`;
        await tx`
          UPDATE bills
          SET outstanding = ${newOutstanding}, status = ${newStatus}, updated_at = now()
          WHERE id = ${d.bill_id}
        `;

        await postBillPaymentToLedger(tx, {
          orgId,
          userId,
          paymentId: payment!.id,
          paymentNo: paymentNoStr,
          paymentDate: d.payment_date,
          billNo: bill.bill_no,
          payAccountCode: d.pay_account_code,
          amount: d.amount,
        });

        await audit(
          {
            orgId,
            userId,
            action: 'create',
            entity: 'bill_payment',
            entityId: payment!.id,
            after: {
              payment_no: paymentNoStr,
              bill_id: d.bill_id,
              amount: d.amount,
              new_status: newStatus,
            },
          },
          tx,
        );

        return { id: payment!.id, payment_no: paymentNoStr, new_status: newStatus };
      });

      return reply.status(201).send(result);
    },
  );

  // ============= EXPENSES =============
  app.get('/expenses', { preHandler: [rbacGuard('expense', 'read')] }, async (req) => {
    const orgId = req.user.org_id;
    const q = z
      .object({
        category_id: z.string().uuid().optional(),
        from: z.string().date().optional(),
        to: z.string().date().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      })
      .safeParse(req.query);
    if (!q.success) throw badRequest('Invalid query', q.error.flatten());
    const { category_id, from, to, limit } = q.data;

    const items = await sql`
      SELECT e.id, e.expense_no, e.expense_date, e.amount::text AS amount,
             e.expense_category_id, ec.name AS category_name, ec.code AS category_code,
             e.gl_account_code, e.pay_account_code,
             e.vendor_id, v.name AS vendor_name,
             e.vehicle_id, ve.reg_no AS vehicle_reg,
             e.description, u.name AS created_by_name
      FROM expenses e
      LEFT JOIN expense_categories ec ON ec.id = e.expense_category_id
      LEFT JOIN vendors v ON v.id = e.vendor_id
      LEFT JOIN vehicles ve ON ve.id = e.vehicle_id
      LEFT JOIN users u ON u.id = e.created_by
      WHERE e.org_id = ${orgId}
        ${category_id ? sql`AND e.expense_category_id = ${category_id}` : sql``}
        ${from ? sql`AND e.expense_date >= ${from}` : sql``}
        ${to ? sql`AND e.expense_date <= ${to}` : sql``}
      ORDER BY e.expense_date DESC, e.expense_no DESC
      LIMIT ${limit}
    `;
    return { items };
  });

  app.post('/expenses', { preHandler: [rbacGuard('expense', 'create')] }, async (req, reply) => {
    const body = ExpenseBody.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const orgId = req.user.org_id;
    const userId = req.user.sub;
    const d = body.data;

    const result = await sql.begin(async (tx) => {
      const accountCode = await resolveAccountCode(
        tx,
        orgId,
        d.expense_category_id,
        d.gl_account_code,
      );
      await assertPostableAccount(tx, orgId, accountCode);
      await assertPostableAccount(tx, orgId, d.pay_account_code);

      const expenseNoStr = await generateExpenseNo(tx, orgId);
      const [exp] = await tx<Array<{ id: string }>>`
        INSERT INTO expenses (
          org_id, expense_no, expense_date, amount,
          expense_category_id, gl_account_code, pay_account_code,
          vendor_id, vehicle_id, warehouse_id, user_id,
          description, attachment_url, created_by, locked_at
        ) VALUES (
          ${orgId}, ${expenseNoStr}, ${d.expense_date}, ${d.amount},
          ${d.expense_category_id ?? null}, ${accountCode}, ${d.pay_account_code},
          ${d.vendor_id ?? null}, ${d.vehicle_id ?? null}, ${d.warehouse_id ?? null},
          ${d.user_id ?? null},
          ${d.description ?? null}, ${d.attachment_url ?? null},
          ${userId}, now()
        )
        RETURNING id
      `;

      await postExpenseToLedger(tx, {
        orgId,
        userId,
        expenseId: exp!.id,
        expenseNo: expenseNoStr,
        expenseDate: d.expense_date,
        expenseAccountCode: accountCode,
        payAccountCode: d.pay_account_code,
        amount: d.amount,
        description: d.description ?? null,
      });

      await audit(
        {
          orgId,
          userId,
          action: 'create',
          entity: 'expense',
          entityId: exp!.id,
          after: { expense_no: expenseNoStr, amount: d.amount, account: accountCode },
        },
        tx,
      );

      return { id: exp!.id, expense_no: expenseNoStr };
    });

    return reply.status(201).send(result);
  });
}
