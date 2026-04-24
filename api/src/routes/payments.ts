import { PaymentMode, PaymentVerification } from '@liquor/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { rbacGuard } from '../plugins/rbac.js';
import { refreshCreditState } from '../services/credit-state.js';
import { recordPayment, verifyCheque } from '../services/payment.js';

// ---------- Schemas ----------

const AllocationSchema = z.object({
  invoice_id: z.string().uuid(),
  amount: z.number().positive(),
});

const PaymentBodyBase = z.object({
  customer_id: z.string().uuid(),
  amount: z.number().positive(),
  mode: PaymentMode,
  mode_ref: z.string().optional(),
  cheque_date: z.string().date().optional(),
  bank_name: z.string().optional(),
  proof_image_url: z.string().url().optional(),
  collected_at: z.string().datetime().optional(),
  allocations: z.array(AllocationSchema).optional(),
  force: z.boolean().optional(),
});

const VerifyBody = z.object({
  decision: z.enum(['verified', 'bounced']),
  note: z.string().optional(),
});

const ListQuery = z.object({
  customer_id: z.string().uuid().optional(),
  mode: PaymentMode.optional(),
  verification: PaymentVerification.optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});

// ---------- Routes ----------

export default async function paymentRoutes(app: FastifyInstance) {
  // LIST
  app.get('/payments', { preHandler: [rbacGuard('payment', 'read')] }, async (req) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest('Invalid query', parsed.error.flatten());
    const orgId = req.user.org_id;
    const { customer_id, mode, verification, from, to, limit, cursor } = parsed.data;

    const conds = [sql`p.org_id = ${orgId}`];
    if (customer_id) conds.push(sql`p.customer_id = ${customer_id}`);
    if (mode) conds.push(sql`p.mode = ${mode}`);
    if (verification) conds.push(sql`p.verification_status = ${verification}`);
    if (from) conds.push(sql`p.collected_at >= ${from}::date`);
    if (to) conds.push(sql`p.collected_at <= ${to}::date + interval '1 day'`);
    if (cursor) conds.push(sql`p.id < ${cursor}`);

    if (req.rbacScope === 'own' && req.user.role === 'collector') {
      conds.push(sql`p.collector_id = ${req.user.sub}`);
    }
    const where = conds.reduce((a, b) => sql`${a} AND ${b}`);

    const rows = await sql`
        SELECT
          p.id, p.receipt_no, p.customer_id, c.code AS customer_code, c.name AS customer_name,
          p.amount, p.mode, p.verification_status, p.collected_at, p.locked_at,
          p.collector_id,
          (SELECT COALESCE(SUM(amount),0) FROM payment_allocations WHERE payment_id = p.id) AS allocated
        FROM payments p
        JOIN customers c ON c.id = p.customer_id
        WHERE ${where}
        ORDER BY p.collected_at DESC, p.id DESC
        LIMIT ${limit}
      `;
    const nextCursor = rows.length === limit ? rows[rows.length - 1]!.id : null;
    return { items: rows, next_cursor: nextCursor };
  });

  // GET detail
  app.get('/payments/:id', { preHandler: [rbacGuard('payment', 'read')] }, async (req) => {
    const { id } = req.params as { id: string };
    const orgId = req.user.org_id;

    const [payment] = await sql`
        SELECT p.*, c.code AS customer_code, c.name AS customer_name
        FROM payments p
        JOIN customers c ON c.id = p.customer_id
        WHERE p.id = ${id} AND p.org_id = ${orgId}
      `;
    if (!payment) throw notFound('Payment not found');

    const allocations = await sql`
        SELECT
          pa.invoice_id, i.invoice_no, i.total, i.outstanding, pa.amount
        FROM payment_allocations pa
        JOIN invoices i ON i.id = pa.invoice_id
        WHERE pa.payment_id = ${id}
      `;
    return { ...payment, allocations };
  });

  // CREATE direct payment (no visit)
  app.post('/payments', { preHandler: [rbacGuard('payment', 'create')] }, async (req, reply) => {
    const body = PaymentBodyBase.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const orgId = req.user.org_id;
    const d = body.data;
    const idempotencyKey = (req.headers['idempotency-key'] as string | undefined) ?? null;

    const [cust] = await sql`
        SELECT id FROM customers WHERE id = ${d.customer_id} AND org_id = ${orgId}
      `;
    if (!cust) throw badRequest('Customer not found');

    const result = await sql.begin(async (tx) =>
      recordPayment(tx, {
        orgId,
        customerId: d.customer_id,
        visitId: null,
        collectorId: req.user.role === 'collector' ? req.user.sub : null,
        amount: d.amount,
        mode: d.mode,
        mode_ref: d.mode_ref ?? null,
        cheque_date: d.cheque_date ?? null,
        bank_name: d.bank_name ?? null,
        proof_image_url: d.proof_image_url ?? null,
        collected_at: d.collected_at,
        idempotency_key: idempotencyKey,
        allocations: d.allocations,
        force: d.force,
        userId: req.user.sub,
      }),
    );

    await refreshCreditState(d.customer_id);
    return reply.status(result.idempotent ? 200 : 201).send(result);
  });

  // CREATE payment on a visit (collector flow)
  app.post(
    '/visits/:id/payment',
    { preHandler: [rbacGuard('payment', 'create')] },
    async (req, reply) => {
      const { id: visitId } = req.params as { id: string };
      const body = PaymentBodyBase.safeParse(req.body);
      if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
      const orgId = req.user.org_id;
      const d = body.data;
      const idempotencyKey = (req.headers['idempotency-key'] as string | undefined) ?? null;

      const [visit] = await sql<Array<{ id: string; customer_id: string; collector_id: string }>>`
        SELECT id, customer_id, collector_id
        FROM collection_visits
        WHERE id = ${visitId} AND org_id = ${orgId}
      `;
      if (!visit) throw notFound('Visit not found');
      if (visit.customer_id !== d.customer_id) {
        throw badRequest('customer_id does not match visit');
      }

      const result = await sql.begin(async (tx) =>
        recordPayment(tx, {
          orgId,
          customerId: d.customer_id,
          visitId: visit.id,
          collectorId: visit.collector_id,
          amount: d.amount,
          mode: d.mode,
          mode_ref: d.mode_ref ?? null,
          cheque_date: d.cheque_date ?? null,
          bank_name: d.bank_name ?? null,
          proof_image_url: d.proof_image_url ?? null,
          collected_at: d.collected_at,
          idempotency_key: idempotencyKey,
          allocations: d.allocations,
          force: d.force,
          userId: req.user.sub,
        }),
      );

      await refreshCreditState(d.customer_id);
      return reply.status(result.idempotent ? 200 : 201).send(result);
    },
  );

  // VERIFY cheque (accounts/admin)
  app.post(
    '/payments/:id/verify',
    { preHandler: [rbacGuard('payment', 'verify')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = VerifyBody.safeParse(req.body);
      if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
      const orgId = req.user.org_id;

      const [prior] = await sql<Array<{ customer_id: string }>>`
        SELECT customer_id FROM payments WHERE id = ${id} AND org_id = ${orgId}
      `;
      if (!prior) throw notFound('Payment not found');

      const result = await sql.begin(async (tx) =>
        verifyCheque(tx, orgId, id, req.user.sub, body.data.decision, body.data.note),
      );
      await refreshCreditState(prior.customer_id);
      return reply.status(200).send(result);
    },
  );
}
