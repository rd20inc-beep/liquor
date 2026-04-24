import { InvoiceStatus } from '@liquor/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { rbacGuard } from '../plugins/rbac.js';
import { refreshCreditState } from '../services/credit-state.js';
import { applyCreditNote, postInvoice } from '../services/invoice.js';

const ListQuery = z.object({
  customer_id: z.string().uuid().optional(),
  status: InvoiceStatus.optional(),
  bucket: z.enum(['current', '1_7', '8_15', '16_30', '31_60', '60_plus']).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});

const PostInvoiceBody = z.object({
  warehouse_id: z.string().uuid(),
  due_days: z.number().int().nonnegative().optional(),
});

const RequestCreditNoteBody = z.object({
  customer_id: z.string().uuid(),
  invoice_id: z.string().uuid().optional(),
  amount: z.number().positive(),
  reason: z.string().min(1),
});

export default async function invoiceRoutes(app: FastifyInstance) {
  // LIST invoices with filters
  app.get('/invoices', { preHandler: [rbacGuard('invoice', 'read')] }, async (req) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest('Invalid query', parsed.error.flatten());
    const orgId = req.user.org_id;
    const { customer_id, status, bucket, from, to, limit, cursor } = parsed.data;

    const conds = [sql`i.org_id = ${orgId}`];
    if (customer_id) conds.push(sql`i.customer_id = ${customer_id}`);
    if (status) conds.push(sql`i.status = ${status}`);
    if (from) conds.push(sql`i.invoice_date >= ${from}::date`);
    if (to) conds.push(sql`i.invoice_date <= ${to}::date`);
    if (cursor) conds.push(sql`i.id < ${cursor}`);
    if (bucket) {
      const expr = {
        current: sql`current_date <= i.due_date`,
        '1_7': sql`current_date - i.due_date BETWEEN 1 AND 7`,
        '8_15': sql`current_date - i.due_date BETWEEN 8 AND 15`,
        '16_30': sql`current_date - i.due_date BETWEEN 16 AND 30`,
        '31_60': sql`current_date - i.due_date BETWEEN 31 AND 60`,
        '60_plus': sql`current_date - i.due_date > 60`,
      }[bucket];
      conds.push(expr);
    }
    const where = conds.reduce((a, b) => sql`${a} AND ${b}`);

    const rows = await sql`
        SELECT
          i.id, i.invoice_no, i.invoice_date, i.due_date,
          i.subtotal, i.tax_total, i.total, i.outstanding, i.status,
          i.customer_id, c.code AS customer_code, c.name AS customer_name,
          GREATEST(0, (current_date - i.due_date)::int) AS days_overdue
        FROM invoices i
        JOIN customers c ON c.id = i.customer_id
        WHERE ${where}
        ORDER BY i.invoice_date DESC, i.id DESC
        LIMIT ${limit}
      `;
    const nextCursor = rows.length === limit ? rows[rows.length - 1]!.id : null;
    return { items: rows, next_cursor: nextCursor };
  });

  // GET invoice detail
  app.get('/invoices/:id', { preHandler: [rbacGuard('invoice', 'read')] }, async (req) => {
    const { id } = req.params as { id: string };
    const orgId = req.user.org_id;

    const [invoice] = await sql`
        SELECT i.*, c.code AS customer_code, c.name AS customer_name
        FROM invoices i
        JOIN customers c ON c.id = i.customer_id
        WHERE i.id = ${id} AND i.org_id = ${orgId}
      `;
    if (!invoice) throw notFound('Invoice not found');

    const [lines, allocations, creditNotes] = await Promise.all([
      sql`
          SELECT
            il.id, il.product_id, p.sku, p.name AS product_name,
            il.batch_id, sb.batch_no, sb.expiry_date,
            il.qty, il.unit_price, il.tax_rate, il.line_total
          FROM invoice_lines il
          JOIN products p ON p.id = il.product_id
          LEFT JOIN stock_batches sb ON sb.id = il.batch_id
          WHERE il.invoice_id = ${id}
        `,
      sql`
          SELECT
            pa.payment_id, p.receipt_no, p.mode, p.collected_at,
            p.verification_status, pa.amount
          FROM payment_allocations pa
          JOIN payments p ON p.id = pa.payment_id
          WHERE pa.invoice_id = ${id}
          ORDER BY p.collected_at DESC
        `,
      sql`
          SELECT id, cn_no, amount, reason, issued_at
          FROM credit_notes
          WHERE invoice_id = ${id} AND org_id = ${orgId}
          ORDER BY issued_at DESC
        `,
    ]);

    return { ...invoice, lines, allocations, credit_notes: creditNotes };
  });

  // POST invoice from approved order
  app.post(
    '/orders/:id/invoice',
    { preHandler: [rbacGuard('invoice', 'create')] },
    async (req, reply) => {
      const { id: orderId } = req.params as { id: string };
      const body = PostInvoiceBody.safeParse(req.body);
      if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
      const orgId = req.user.org_id;

      const [wh] =
        await sql`SELECT id FROM warehouses WHERE id = ${body.data.warehouse_id} AND org_id = ${orgId}`;
      if (!wh) throw badRequest('Warehouse not found');

      const result = await sql.begin(async (tx) =>
        postInvoice(tx, {
          orgId,
          orderId,
          warehouseId: body.data.warehouse_id,
          userId: req.user.sub,
          dueDays: body.data.due_days,
        }),
      );

      // Refresh customer credit state (outstanding changed)
      const [order] = await sql<Array<{ customer_id: string }>>`
        SELECT customer_id FROM sales_orders WHERE id = ${orderId}
      `;
      if (order) await refreshCreditState(order.customer_id);

      return reply.status(result.idempotent ? 200 : 201).send(result);
    },
  );

  // REQUEST a credit note — creates an approval_request. On approve the handler
  // in routes/approvals.ts invokes applyCreditNote.
  app.post(
    '/credit-notes',
    { preHandler: [rbacGuard('credit_note', 'create')] },
    async (req, reply) => {
      const body = RequestCreditNoteBody.safeParse(req.body);
      if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
      const orgId = req.user.org_id;
      const d = body.data;

      const [cust] = await sql`
        SELECT id FROM customers WHERE id = ${d.customer_id} AND org_id = ${orgId}
      `;
      if (!cust) throw badRequest('Customer not found');
      if (d.invoice_id) {
        const [inv] = await sql`
          SELECT id FROM invoices WHERE id = ${d.invoice_id} AND org_id = ${orgId}
        `;
        if (!inv) throw badRequest('Invoice not found');
      }

      // Admin skips approval — apply immediately
      if (req.user.role === 'admin' || req.user.role === 'owner') {
        const result = await sql.begin(async (tx) =>
          applyCreditNote(tx, {
            orgId,
            customerId: d.customer_id,
            invoiceId: d.invoice_id,
            amount: d.amount,
            reason: d.reason,
            userId: req.user.sub,
          }),
        );
        if (d.invoice_id) {
          const [inv] = await sql<Array<{ customer_id: string }>>`
            SELECT customer_id FROM invoices WHERE id = ${d.invoice_id}
          `;
          if (inv) await refreshCreditState(inv.customer_id);
        } else {
          await refreshCreditState(d.customer_id);
        }
        return reply.status(201).send(result);
      }

      // Non-admin — queue approval
      const [appr] = await sql`
        INSERT INTO approval_requests (
          org_id, type, ref_type, ref_id, requested_by, status, reason, payload
        ) VALUES (
          ${orgId}, 'credit_note', 'credit_note', gen_random_uuid(),
          ${req.user.sub}, 'pending', ${d.reason},
          ${sql.json({
            customerId: d.customer_id,
            invoiceId: d.invoice_id,
            amount: d.amount,
            reason: d.reason,
          })}
        )
        RETURNING id, type, status, created_at
      `;
      return reply
        .status(202)
        .send({ approval: appr, message: 'Credit note queued for admin approval' });
    },
  );
}
