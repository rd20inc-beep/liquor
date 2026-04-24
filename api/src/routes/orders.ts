import { OrderChannel, OrderStatus } from '@liquor/shared';
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { z } from 'zod';
import { sql } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { rbacGuard } from '../plugins/rbac.js';
import { audit } from '../services/audit.js';
import {
  type CreditConfig,
  type CustomerCreditSnapshot,
  decide,
} from '../services/credit-engine.js';
import { refreshCreditState } from '../services/credit-state.js';
import { resolvePrice } from '../services/pricing.js';
import { releaseReservation, reserveStock } from '../services/stock.js';

// ---------- Schemas ----------

const CreateOrderBody = z.object({
  customer_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  channel: OrderChannel.optional().default('admin'),
  order_date: z.string().date().optional(),
  notes: z.string().optional(),
  idempotency_key: z.string().min(1).max(100).optional(),
  lines: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        qty: z.number().int().positive(),
        discount_pct: z.number().min(0).max(100).default(0),
        promo_id: z.string().uuid().optional(),
      }),
    )
    .min(1)
    .max(200),
});

const OverrideBody = z.object({
  reason_code: z.string().min(1).max(50),
  note: z.string().min(1),
  /**
   * Optional per-line price adjustments applied atomically before approving.
   * Useful when admin negotiates a special rate as part of the override.
   */
  line_adjustments: z
    .array(
      z.object({
        line_id: z.string().uuid(),
        unit_price: z.number().positive().optional(),
        discount_pct: z.number().min(0).max(100).optional(),
      }),
    )
    .optional(),
});

const CancelBody = z.object({
  reason: z.string().min(1),
});

const ListQuery = z.object({
  customer_id: z.string().uuid().optional(),
  status: OrderStatus.optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});

// ---------- Helpers ----------

function generateOrderNo(): string {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const rand = crypto.randomUUID().slice(0, 6).toUpperCase();
  return `SO-${ymd}-${rand}`;
}

async function loadOrgConfig(orgId: string): Promise<CreditConfig> {
  const [row] = await sql<Array<{ risk_threshold: string; broken_promise_limit: number }>>`
    SELECT risk_threshold, broken_promise_limit
    FROM org_config WHERE org_id = ${orgId}
  `;
  return {
    risk_threshold: Number(row?.risk_threshold ?? 0.6),
    broken_promise_limit: row?.broken_promise_limit ?? 3,
  };
}

async function loadCustomerSnapshot(
  tx: Sql,
  orgId: string,
  customerId: string,
): Promise<CustomerCreditSnapshot | null> {
  const [row] = await tx<
    Array<{
      status: CustomerCreditSnapshot['status'];
      hold_reason: string | null;
      available_credit: string;
      outstanding_total: string;
      risk_score: string;
      broken_promises_30d: number;
      promise_amount: string;
      promise_due_date: string | null;
      high_value: boolean;
    }>
  >`
    SELECT
      c.status, c.hold_reason, c.high_value,
      COALESCE(cs.available_credit, 0)     AS available_credit,
      COALESCE(cs.outstanding_total, 0)     AS outstanding_total,
      COALESCE(cs.risk_score, 0)            AS risk_score,
      COALESCE(cs.broken_promises_30d, 0)   AS broken_promises_30d,
      COALESCE(cs.promise_amount, 0)        AS promise_amount,
      cs.promise_due_date
    FROM customers c
    LEFT JOIN customer_credit_state cs ON cs.customer_id = c.id
    WHERE c.id = ${customerId} AND c.org_id = ${orgId}
    FOR UPDATE OF c
  `;
  if (!row) return null;
  return {
    status: row.status,
    hold_reason: row.hold_reason,
    high_value: row.high_value,
    available_credit: Number(row.available_credit),
    outstanding_total: Number(row.outstanding_total),
    risk_score: Number(row.risk_score),
    broken_promises_30d: row.broken_promises_30d,
    promise_amount: Number(row.promise_amount),
    promise_due_date: row.promise_due_date,
  };
}

// ---------- Routes ----------

export default async function orderRoutes(app: FastifyInstance) {
  // LIST
  app.get('/orders', { preHandler: [rbacGuard('order', 'read')] }, async (req) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest('Invalid query', parsed.error.flatten());
    const orgId = req.user.org_id;
    const { customer_id, status, from, to, limit, cursor } = parsed.data;

    const conds = [sql`o.org_id = ${orgId}`];
    if (customer_id) conds.push(sql`o.customer_id = ${customer_id}`);
    if (status) conds.push(sql`o.status = ${status}`);
    if (from) conds.push(sql`o.order_date >= ${from}::date`);
    if (to) conds.push(sql`o.order_date <= ${to}::date`);
    if (cursor) conds.push(sql`o.id < ${cursor}`);

    // RBAC scope: sales rep sees own orders
    if (req.rbacScope === 'own' && req.user.role === 'sales') {
      conds.push(sql`o.rep_id = ${req.user.sub}`);
    }
    const where = conds.reduce((a, b) => sql`${a} AND ${b}`);

    const rows = await sql`
        SELECT
          o.id, o.order_no, o.order_date, o.channel, o.status,
          o.credit_decision, o.subtotal, o.tax_total, o.total,
          o.customer_id, c.code AS customer_code, c.name AS customer_name,
          o.rep_id
        FROM sales_orders o
        JOIN customers c ON c.id = o.customer_id
        WHERE ${where}
        ORDER BY o.order_date DESC, o.created_at DESC
        LIMIT ${limit}
      `;
    const nextCursor = rows.length === limit ? rows[rows.length - 1]!.id : null;
    return { items: rows, next_cursor: nextCursor };
  });

  // GET with lines
  app.get('/orders/:id', { preHandler: [rbacGuard('order', 'read')] }, async (req) => {
    const { id } = req.params as { id: string };
    const orgId = req.user.org_id;

    const [order] = await sql`
        SELECT o.*, c.code AS customer_code, c.name AS customer_name
        FROM sales_orders o
        JOIN customers c ON c.id = o.customer_id
        WHERE o.id = ${id} AND o.org_id = ${orgId}
      `;
    if (!order) throw notFound('Order not found');

    const lines = await sql`
        SELECT
          ol.id, ol.product_id, p.sku, p.name AS product_name,
          ol.qty, ol.unit_price, ol.discount_pct, ol.tax_rate, ol.line_total,
          ol.promo_id
        FROM sales_order_lines ol
        JOIN products p ON p.id = ol.product_id
        WHERE ol.order_id = ${id}
      `;
    return { ...order, lines };
  });

  // CREATE order with credit check
  app.post('/orders', { preHandler: [rbacGuard('order', 'create')] }, async (req, reply) => {
    const body = CreateOrderBody.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const orgId = req.user.org_id;
    const d = body.data;

    // Verify customer + warehouse belong to org
    const [cust] =
      await sql`SELECT id FROM customers WHERE id = ${d.customer_id} AND org_id = ${orgId}`;
    if (!cust) throw badRequest('Customer not found');
    const [wh] =
      await sql`SELECT id FROM warehouses WHERE id = ${d.warehouse_id} AND org_id = ${orgId}`;
    if (!wh) throw badRequest('Warehouse not found');

    // Idempotency
    if (d.idempotency_key) {
      const existing = await sql<Array<{ id: string }>>`
          SELECT id FROM sales_orders
          WHERE org_id = ${orgId} AND idempotency_key = ${d.idempotency_key}
        `;
      if (existing.length > 0) {
        return reply.status(200).send({ id: existing[0]!.id, idempotent: true });
      }
    }

    const orderDate = d.order_date ?? new Date().toISOString().slice(0, 10);
    const config = await loadOrgConfig(orgId);

    // Resolve prices + compute line totals (server-side)
    interface ResolvedLine {
      product_id: string;
      qty: number;
      unit_price: number;
      discount_pct: number;
      tax_rate: number;
      line_total: number;
      promo_id: string | null;
    }
    const resolvedLines: ResolvedLine[] = [];
    let subtotal = 0;
    let taxTotal = 0;

    for (const line of d.lines) {
      const price = await resolvePrice(orgId, d.customer_id, line.product_id, line.qty, orderDate);
      const [prod] = await sql<Array<{ tax_rate: string }>>`
          SELECT tax_rate FROM products WHERE id = ${line.product_id} AND org_id = ${orgId}
        `;
      if (!prod) throw badRequest(`Product ${line.product_id} not found`);

      const taxRate = Number(prod.tax_rate);
      const gross = price.unit_price * line.qty;
      const afterDiscount = gross * (1 - line.discount_pct / 100);
      const tax = afterDiscount * (taxRate / 100);
      const lineTotal = Math.round((afterDiscount + tax) * 100) / 100;

      resolvedLines.push({
        product_id: line.product_id,
        qty: line.qty,
        unit_price: price.unit_price,
        discount_pct: line.discount_pct,
        tax_rate: taxRate,
        line_total: lineTotal,
        promo_id: line.promo_id ?? null,
      });
      subtotal += afterDiscount;
      taxTotal += tax;
    }
    subtotal = Math.round(subtotal * 100) / 100;
    taxTotal = Math.round(taxTotal * 100) / 100;
    const total = Math.round((subtotal + taxTotal) * 100) / 100;

    const result = await sql.begin(async (tx) => {
      const snapshot = await loadCustomerSnapshot(tx, orgId, d.customer_id);
      if (!snapshot) throw badRequest('Customer not found');
      const creditResult = decide(snapshot, total, config);

      let newStatus: 'draft' | 'held' | 'approved';
      if (creditResult.decision === 'approve') newStatus = 'approved';
      else if (creditResult.decision === 'hold') newStatus = 'held';
      else newStatus = 'draft'; // rejected — keep as draft with decision=reject so rep sees reasons

      const repId = req.user.role === 'sales' ? req.user.sub : null;

      const [order] = await tx`
          INSERT INTO sales_orders (
            org_id, order_no, customer_id, rep_id, channel, order_date,
            status, credit_decision, credit_reasons,
            subtotal, tax_total, total, notes, idempotency_key
          ) VALUES (
            ${orgId}, ${generateOrderNo()}, ${d.customer_id}, ${repId},
            ${d.channel}, ${orderDate},
            ${newStatus}, ${creditResult.decision}, ${sql.json(creditResult.reasons)},
            ${subtotal}, ${taxTotal}, ${total}, ${d.notes ?? null},
            ${d.idempotency_key ?? null}
          )
          RETURNING *
        `;

      for (const line of resolvedLines) {
        await tx`
            INSERT INTO sales_order_lines (
              order_id, product_id, qty, unit_price, discount_pct, tax_rate, line_total, promo_id
            ) VALUES (
              ${order!.id}, ${line.product_id}, ${line.qty}, ${line.unit_price},
              ${line.discount_pct}, ${line.tax_rate}, ${line.line_total}, ${line.promo_id}
            )
          `;
      }

      // Reserve stock on approve
      if (creditResult.decision === 'approve') {
        for (const line of resolvedLines) {
          await reserveStock(tx, d.warehouse_id, line.product_id, line.qty);
        }
      }

      await audit(
        {
          orgId,
          userId: req.user.sub,
          action: 'create',
          entity: 'sales_order',
          entityId: order!.id,
          after: {
            order_no: order!.order_no,
            total,
            decision: creditResult.decision,
            reasons: creditResult.reasons,
          },
        },
        tx,
      );

      return { order, lines: resolvedLines, credit: creditResult };
    });

    return reply.status(201).send(result);
  });

  // OVERRIDE — admin approves a held or rejected order
  app.post(
    '/orders/:id/override',
    { preHandler: [rbacGuard('order', 'override')] },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = OverrideBody.safeParse(req.body);
      if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
      const orgId = req.user.org_id;

      const result = await sql.begin(async (tx) => {
        const [order] = await tx<
          Array<{
            id: string;
            status: string;
            customer_id: string;
            total: string;
            credit_decision: string | null;
          }>
        >`
          SELECT id, status, customer_id, total, credit_decision
          FROM sales_orders
          WHERE id = ${id} AND org_id = ${orgId}
          FOR UPDATE
        `;
        if (!order) throw notFound('Order not found');
        if (order.status !== 'held' && order.status !== 'draft') {
          throw conflict(`Cannot override order in status '${order.status}'`);
        }

        // Check blocked customers — override forbidden per PRD §W1
        const [customer] = await tx<Array<{ status: string }>>`
          SELECT status FROM customers WHERE id = ${order.customer_id} AND org_id = ${orgId}
        `;
        if (customer?.status === 'blocked') {
          throw conflict('Cannot override order for blocked customer — change status first');
        }

        // Apply optional per-line price adjustments, capture before/after for audit
        const adjustmentsAudit: Array<Record<string, unknown>> = [];
        if (body.data.line_adjustments && body.data.line_adjustments.length > 0) {
          for (const adj of body.data.line_adjustments) {
            const [line] = await tx<Array<{
              id: string; order_id: string; qty: number;
              unit_price: string; discount_pct: string; tax_rate: string; line_total: string;
            }>>`
              SELECT id, order_id, qty, unit_price, discount_pct, tax_rate, line_total
              FROM sales_order_lines
              WHERE id = ${adj.line_id}
              FOR UPDATE
            `;
            if (!line) throw badRequest(`Line ${adj.line_id} not found`);
            if (line.order_id !== id) throw badRequest(`Line ${adj.line_id} belongs to a different order`);

            const newUnit = adj.unit_price ?? Number(line.unit_price);
            const newDiscount = adj.discount_pct ?? Number(line.discount_pct);
            const taxRate = Number(line.tax_rate);
            const gross = newUnit * line.qty;
            const afterDiscount = gross * (1 - newDiscount / 100);
            const tax = afterDiscount * (taxRate / 100);
            const newLineTotal = Math.round((afterDiscount + tax) * 100) / 100;

            await tx`
              UPDATE sales_order_lines
              SET unit_price = ${newUnit},
                  discount_pct = ${newDiscount},
                  line_total = ${newLineTotal}
              WHERE id = ${line.id}
            `;
            adjustmentsAudit.push({
              line_id: line.id,
              before: { unit_price: Number(line.unit_price), discount_pct: Number(line.discount_pct), line_total: Number(line.line_total) },
              after:  { unit_price: newUnit, discount_pct: newDiscount, line_total: newLineTotal },
            });
          }

          // Recompute order totals from the updated lines
          const [totals] = await tx<Array<{ subtotal: string; tax_total: string; total: string }>>`
            SELECT
              COALESCE(SUM( qty * unit_price * (1 - discount_pct/100)             ), 0)::numeric(14,2) AS subtotal,
              COALESCE(SUM( qty * unit_price * (1 - discount_pct/100) * tax_rate/100 ), 0)::numeric(14,2) AS tax_total,
              COALESCE(SUM(line_total), 0)::numeric(14,2) AS total
            FROM sales_order_lines
            WHERE order_id = ${id}
          `;
          await tx`
            UPDATE sales_orders
            SET subtotal  = ${totals!.subtotal},
                tax_total = ${totals!.tax_total},
                total     = ${totals!.total}
            WHERE id = ${id}
          `;
        }

        const [appr] = await tx`
          INSERT INTO approval_requests (
            org_id, type, ref_type, ref_id, requested_by, approver_id,
            status, reason, payload, decided_at
          ) VALUES (
            ${orgId}, 'credit_override', 'sales_order', ${id},
            ${req.user.sub}, ${req.user.sub},
            'approved', ${body.data.reason_code}, ${sql.json(body.data)}, now()
          )
          RETURNING id
        `;

        const [updated] = await tx`
          UPDATE sales_orders
          SET status = 'approved',
              approved_by = ${req.user.sub},
              override_reason_code = ${body.data.reason_code},
              override_note = ${body.data.note},
              updated_at = now()
          WHERE id = ${id}
          RETURNING *
        `;

        // Load warehouse_id from originating context — not stored on order, so we
        // need it from the request. We don't have warehouse on the order table, so
        // we skip reservation here; reservation happens at confirm/invoice time.
        // (Confirm step wiring comes with invoice module.)

        await audit(
          {
            orgId,
            userId: req.user.sub,
            action: 'override',
            entity: 'sales_order',
            entityId: id,
            before: { status: order.status, credit_decision: order.credit_decision, total: Number(order.total) },
            after: {
              status: 'approved',
              reason_code: body.data.reason_code,
              note: body.data.note,
              ...(adjustmentsAudit.length > 0 ? { line_adjustments: adjustmentsAudit } : {}),
            },
          },
          tx,
        );

        return { order: updated, approval_id: appr!.id };
      });

      return result;
    },
  );

  // CANCEL
  app.post('/orders/:id/cancel', { preHandler: [rbacGuard('order', 'cancel')] }, async (req) => {
    const { id } = req.params as { id: string };
    const body = CancelBody.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const orgId = req.user.org_id;

    const result = await sql.begin(async (tx) => {
      const [order] = await tx<
        Array<{
          id: string;
          status: string;
          customer_id: string;
        }>
      >`
          SELECT id, status, customer_id FROM sales_orders
          WHERE id = ${id} AND org_id = ${orgId}
          FOR UPDATE
        `;
      if (!order) throw notFound('Order not found');
      if (order.status === 'invoiced' || order.status === 'fulfilled') {
        throw conflict('Cannot cancel an invoiced or fulfilled order — use credit note');
      }
      if (order.status === 'cancelled') throw conflict('Order already cancelled');

      // Release any reservations: for each line, reverse FEFO-style
      if (order.status === 'approved' || order.status === 'confirmed') {
        const lines = await tx<Array<{ product_id: string; qty: number }>>`
            SELECT product_id, qty FROM sales_order_lines WHERE order_id = ${id}
          `;
        for (const line of lines) {
          // Find batches with reserved stock, oldest-expiry first, and release
          const batches = await tx<Array<{ id: string; qty_reserved: number }>>`
              SELECT id, qty_reserved FROM stock_batches
              WHERE product_id = ${line.product_id} AND qty_reserved > 0
              ORDER BY expiry_date NULLS LAST, created_at
              FOR UPDATE
            `;
          let remaining = line.qty;
          for (const b of batches) {
            if (remaining === 0) break;
            const release = Math.min(b.qty_reserved, remaining);
            await releaseReservation(tx, b.id, release);
            remaining -= release;
          }
        }
      }

      const [updated] = await tx`
          UPDATE sales_orders
          SET status = 'cancelled', updated_at = now()
          WHERE id = ${id}
          RETURNING *
        `;

      await audit(
        {
          orgId,
          userId: req.user.sub,
          action: 'update',
          entity: 'sales_order',
          entityId: id,
          before: { status: order.status },
          after: { status: 'cancelled', reason: body.data.reason },
        },
        tx,
      );

      return updated;
    });

    // Refresh credit state (outstanding didn't change, but last_order timestamps may)
    await refreshCreditState((result as unknown as { customer_id: string }).customer_id);
    return result;
  });
}
