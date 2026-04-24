import { CustomerStatus, CustomerType } from '@liquor/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { rbacGuard } from '../plugins/rbac.js';
import { refreshCreditState } from '../services/credit-state.js';
import { customerCode as generateCustomerCode } from '../services/doc-numbers.js';
import { PriceNotFoundError, resolvePrice } from '../services/pricing.js';

// ---------- Schemas ----------

const CreateCustomerBody = z.object({
  code: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(200),
  type: CustomerType.optional().default('outlet'),
  route_id: z.string().uuid().optional(),
  route_sequence: z.number().int().positive().optional(),
  address: z.string().optional(),
  phone: z.string().min(10).max(15).optional(),
  whatsapp: z.string().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  assigned_rep_id: z.string().uuid().optional(),
  assigned_collector_id: z.string().uuid().optional(),
  credit_limit: z.number().nonnegative().optional().default(0),
  payment_term_id: z.string().uuid().optional(),
  price_list_id: z.string().uuid().optional(),
  high_value: z.boolean().optional().default(false),
});

const UpdateCustomerBody = z.object({
  name: z.string().min(1).max(200).optional(),
  type: CustomerType.optional(),
  route_id: z.string().uuid().nullable().optional(),
  route_sequence: z.number().int().positive().nullable().optional(),
  address: z.string().nullable().optional(),
  phone: z.string().min(10).max(15).nullable().optional(),
  whatsapp: z.string().nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  assigned_rep_id: z.string().uuid().nullable().optional(),
  assigned_collector_id: z.string().uuid().nullable().optional(),
  payment_term_id: z.string().uuid().nullable().optional(),
  price_list_id: z.string().uuid().nullable().optional(),
  high_value: z.boolean().optional(),
});

const HoldBody = z.object({
  reason: z.string().min(1),
  until: z.string().date().optional(),
});

const ListQuery = z.object({
  route_id: z.string().uuid().optional(),
  status: CustomerStatus.optional(),
  risk: z.enum(['low', 'medium', 'high']).optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});

// ---------- Routes ----------

export default async function customerRoutes(app: FastifyInstance) {
  // LIST with filters + fuzzy search
  app.get('/customers', { preHandler: [rbacGuard('customer', 'read')] }, async (req) => {
    const q = ListQuery.safeParse(req.query);
    if (!q.success) throw badRequest('Invalid query', q.error.flatten());
    const { route_id, status, risk, q: search, limit, cursor } = q.data;
    const orgId = req.user.org_id;

    // Build WHERE fragments
    const conditions = [sql`c.org_id = ${orgId}`];

    // RBAC scope: sales/collector see only their route's customers
    if (req.rbacScope === 'route' && req.user.sub) {
      conditions.push(sql`c.route_id IN (
          SELECT r.id FROM routes r
          JOIN customers c2 ON c2.route_id = r.id
          WHERE c2.assigned_rep_id = ${req.user.sub}
             OR c2.assigned_collector_id = ${req.user.sub}
          GROUP BY r.id
        )`);
    }

    if (route_id) conditions.push(sql`c.route_id = ${route_id}`);
    if (status) conditions.push(sql`c.status = ${status}`);
    if (cursor) conditions.push(sql`c.id > ${cursor}`);
    if (search) conditions.push(sql`c.name ILIKE ${`%${search}%`}`);

    if (risk) {
      const riskMap = { low: [0, 0.3], medium: [0.3, 0.6], high: [0.6, 1.01] } as const;
      const [lo, hi] = riskMap[risk];
      conditions.push(sql`cs.risk_score >= ${lo} AND cs.risk_score < ${hi}`);
    }

    const where = conditions.reduce((a, b) => sql`${a} AND ${b}`);

    const rows = await sql`
        SELECT
          c.id, c.code, c.name, c.type, c.status, c.phone,
          c.route_id, c.route_sequence, c.credit_limit, c.high_value,
          c.created_at,
          cs.outstanding_total, cs.available_credit, cs.risk_score,
          cs.last_order_at, cs.last_payment_at, cs.last_visit_at,
          cs.days_since_last_order, cs.broken_promises_30d
        FROM customers c
        LEFT JOIN customer_credit_state cs ON cs.customer_id = c.id
        WHERE ${where}
        ORDER BY c.route_sequence NULLS LAST, c.name
        LIMIT ${limit}
      `;

    const nextCursor = rows.length === limit ? rows[rows.length - 1]!.id : null;
    return { items: rows, next_cursor: nextCursor };
  });

  // GET single customer
  app.get('/customers/:id', { preHandler: [rbacGuard('customer', 'read')] }, async (req) => {
    const { id } = req.params as { id: string };
    const orgId = req.user.org_id;

    const rows = await sql`
        SELECT
          c.*,
          cs.outstanding_total, cs.advance_balance,
          cs.overdue_0_7, cs.overdue_8_15, cs.overdue_16_30,
          cs.overdue_31_60, cs.overdue_60_plus,
          cs.available_credit, cs.risk_score,
          cs.last_order_at, cs.last_payment_at, cs.last_visit_at,
          cs.last_delivery_at, cs.promise_amount, cs.promise_due_date,
          cs.broken_promises_30d, cs.days_since_last_order,
          pt.code AS payment_term_code, pt.type AS payment_term_type, pt.days AS payment_term_days
        FROM customers c
        LEFT JOIN customer_credit_state cs ON cs.customer_id = c.id
        LEFT JOIN payment_terms pt ON pt.id = c.payment_term_id
        WHERE c.id = ${id} AND c.org_id = ${orgId}
      `;
    if (rows.length === 0) throw notFound('Customer not found');
    return rows[0];
  });

  // 360 VIEW — profile + AR + history + suggestions
  app.get('/customers/:id/360', { preHandler: [rbacGuard('customer', 'read')] }, async (req) => {
    const { id } = req.params as { id: string };
    const orgId = req.user.org_id;

    // Parallel queries
    const [customerRows, openInvoices, recentOrders, recentPayments, recentVisits, suggestions] =
      await Promise.all([
        // Customer + credit state
        sql`
            SELECT
              c.*, cs.*,
              pt.code AS payment_term_code, pt.type AS payment_term_type, pt.days AS payment_term_days
            FROM customers c
            LEFT JOIN customer_credit_state cs ON cs.customer_id = c.id
            LEFT JOIN payment_terms pt ON pt.id = c.payment_term_id
            WHERE c.id = ${id} AND c.org_id = ${orgId}
          `,
        // Open invoices
        sql`
            SELECT id, invoice_no, invoice_date, due_date, total, outstanding, status,
              GREATEST(0, (current_date - due_date)::int) AS days_overdue
            FROM invoices
            WHERE customer_id = ${id} AND status IN ('open','partial','disputed')
            ORDER BY due_date
          `,
        // Last 5 orders
        sql`
            SELECT id, order_no, order_date, status, total
            FROM sales_orders
            WHERE customer_id = ${id} AND status <> 'cancelled'
            ORDER BY order_date DESC LIMIT 5
          `,
        // Last 5 payments
        sql`
            SELECT id, receipt_no, amount, mode, verification_status, collected_at
            FROM payments
            WHERE customer_id = ${id}
            ORDER BY collected_at DESC LIMIT 5
          `,
        // Last 5 visits
        sql`
            SELECT id, collector_id, started_at, outcome, note
            FROM collection_visits
            WHERE customer_id = ${id} AND outcome IS NOT NULL
            ORDER BY started_at DESC LIMIT 5
          `,
        // Reorder suggestions: top SKUs from last 3 orders
        sql`
            WITH last_orders AS (
              SELECT id FROM sales_orders
              WHERE customer_id = ${id} AND status NOT IN ('cancelled','draft')
              ORDER BY order_date DESC LIMIT 3
            )
            SELECT
              p.id AS product_id, p.sku, p.name,
              ROUND(AVG(sol.qty)) AS avg_qty,
              COUNT(*)::int AS order_count
            FROM sales_order_lines sol
            JOIN last_orders lo ON lo.id = sol.order_id
            JOIN products p ON p.id = sol.product_id
            GROUP BY p.id, p.sku, p.name
            ORDER BY order_count DESC, avg_qty DESC
            LIMIT 10
          `,
      ]);

    if (customerRows.length === 0) throw notFound('Customer not found');

    // Due-for-reorder heuristic
    const customer = customerRows[0]!;
    let dueForReorder = false;
    if (recentOrders.length >= 3) {
      const dates = recentOrders.map((o) => new Date(o.order_date as string).getTime());
      const gaps: number[] = [];
      for (let i = 0; i < dates.length - 1; i++) {
        gaps.push((dates[i]! - dates[i + 1]!) / 86400000);
      }
      const medianGap = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0;
      const daysSinceLastOrder = Number(customer.days_since_last_order ?? 999);
      dueForReorder = daysSinceLastOrder >= medianGap * 0.8;
    }

    return {
      customer,
      aging: {
        overdue_0_7: customer.overdue_0_7,
        overdue_8_15: customer.overdue_8_15,
        overdue_16_30: customer.overdue_16_30,
        overdue_31_60: customer.overdue_31_60,
        overdue_60_plus: customer.overdue_60_plus,
      },
      open_invoices: openInvoices,
      recent_orders: recentOrders,
      recent_payments: recentPayments,
      recent_visits: recentVisits,
      suggestions: {
        likely_basket: suggestions,
        due_for_reorder: dueForReorder,
      },
    };
  });

  // CREATE customer
  app.post('/customers', { preHandler: [rbacGuard('customer', 'create')] }, async (req, reply) => {
    const body = CreateCustomerBody.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const orgId = req.user.org_id;
    const d = body.data;

    const geo =
      d.lat != null && d.lng != null
        ? sql`ST_SetSRID(ST_MakePoint(${d.lng}, ${d.lat}), 4326)::geography`
        : sql`NULL`;

    try {
      const row = await sql.begin(async (tx) => {
        const code = d.code?.trim() || (await generateCustomerCode(tx, orgId));
        const [inserted] = await tx`
            INSERT INTO customers (
              org_id, code, name, type, route_id, route_sequence,
              geo, address, phone, whatsapp,
              assigned_rep_id, assigned_collector_id,
              credit_limit, payment_term_id, price_list_id, high_value
            ) VALUES (
              ${orgId}, ${code}, ${d.name}, ${d.type}, ${d.route_id ?? null}, ${d.route_sequence ?? null},
              ${geo}, ${d.address ?? null}, ${d.phone ?? null}, ${d.whatsapp ?? null},
              ${d.assigned_rep_id ?? null}, ${d.assigned_collector_id ?? null},
              ${d.credit_limit}, ${d.payment_term_id ?? null}, ${d.price_list_id ?? null}, ${d.high_value}
            )
            RETURNING *
          `;
        return inserted;
      });
      // Trigger auto-creates credit_state row; refresh it to set available_credit
      await refreshCreditState(row!.id);
      return reply.status(201).send(row);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('unique')) {
        throw conflict('A customer with this code already exists');
      }
      throw err;
    }
  });

  // UPDATE customer
  app.patch('/customers/:id', { preHandler: [rbacGuard('customer', 'update')] }, async (req) => {
    const { id } = req.params as { id: string };
    const body = UpdateCustomerBody.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const orgId = req.user.org_id;

    const d = body.data;
    if (Object.keys(d).length === 0) throw badRequest('No fields to update');

    // Build the update object, handling geo separately
    const updateFields: Record<string, unknown> = {};
    const plainKeys: string[] = [];

    for (const [k, v] of Object.entries(d)) {
      if (k === 'lat' || k === 'lng') continue; // handled separately
      updateFields[k] = v;
      plainKeys.push(k);
    }

    let geoFragment = sql``;
    const hasGeo = d.lat !== undefined || d.lng !== undefined;
    if (hasGeo) {
      if (d.lat != null && d.lng != null) {
        geoFragment = sql`, geo = ST_SetSRID(ST_MakePoint(${d.lng}, ${d.lat}), 4326)::geography`;
      } else {
        geoFragment = sql`, geo = NULL`;
      }
    }

    let rows: Array<Record<string, unknown>>;
    if (plainKeys.length > 0) {
      rows = await sql`
          UPDATE customers
          SET ${sql(updateFields, ...plainKeys)} ${geoFragment}
          WHERE id = ${id} AND org_id = ${orgId}
          RETURNING *
        `;
    } else if (hasGeo) {
      rows = await sql`
          UPDATE customers
          SET updated_at = now() ${geoFragment}
          WHERE id = ${id} AND org_id = ${orgId}
          RETURNING *
        `;
    } else {
      throw badRequest('No fields to update');
    }

    if (rows.length === 0) throw notFound('Customer not found');
    return rows[0];
  });

  // UPDATE credit limit (admin/owner, separate endpoint for audit)
  app.patch(
    '/customers/:id/credit',
    { preHandler: [rbacGuard('credit_limit', 'edit')] },
    async (req) => {
      const { id } = req.params as { id: string };
      const orgId = req.user.org_id;

      const body = z
        .object({
          credit_limit: z.number().nonnegative(),
          payment_term_id: z.string().uuid().optional(),
          reason: z.string().min(1),
        })
        .safeParse(req.body);
      if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
      const { credit_limit, payment_term_id, reason } = body.data;

      // Fetch before state for audit
      const [before] = await sql`
        SELECT credit_limit, payment_term_id FROM customers WHERE id = ${id} AND org_id = ${orgId}
      `;
      if (!before) throw notFound('Customer not found');

      const updateObj: Record<string, unknown> = { credit_limit };
      const cols = ['credit_limit'];
      if (payment_term_id !== undefined) {
        updateObj.payment_term_id = payment_term_id;
        cols.push('payment_term_id');
      }

      const [updated] = await sql`
        UPDATE customers SET ${sql(updateObj, ...cols)}
        WHERE id = ${id} AND org_id = ${orgId}
        RETURNING id, credit_limit, payment_term_id
      `;

      // Audit entry
      await sql`
        INSERT INTO audit_log (org_id, user_id, action, entity, entity_id, before_json, after_json)
        VALUES (
          ${orgId}, ${req.user.sub}, 'update', 'customer_credit', ${id},
          ${sql.json({ credit_limit: before.credit_limit, payment_term_id: before.payment_term_id, reason })},
          ${sql.json({ credit_limit: updated!.credit_limit, payment_term_id: updated!.payment_term_id })}
        )
      `;

      // Refresh credit state with new limit
      await refreshCreditState(id);

      return updated;
    },
  );

  // HOLD customer
  app.post('/customers/:id/hold', { preHandler: [rbacGuard('customer', 'hold')] }, async (req) => {
    const { id } = req.params as { id: string };
    const orgId = req.user.org_id;

    const body = HoldBody.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());

    const [before] = await sql`
        SELECT status, hold_reason FROM customers WHERE id = ${id} AND org_id = ${orgId}
      `;
    if (!before) throw notFound('Customer not found');

    const [updated] = await sql`
        UPDATE customers
        SET status = 'hold', hold_reason = ${body.data.reason}, hold_until = ${body.data.until ?? null}
        WHERE id = ${id} AND org_id = ${orgId}
        RETURNING id, status, hold_reason, hold_until
      `;

    await sql`
        INSERT INTO audit_log (org_id, user_id, action, entity, entity_id, before_json, after_json)
        VALUES (
          ${orgId}, ${req.user.sub}, 'update', 'customer', ${id},
          ${sql.json({ status: before.status })},
          ${sql.json({ status: 'hold', reason: body.data.reason, until: body.data.until })}
        )
      `;

    return updated;
  });

  // REPEAT LAST ORDER — returns a prefilled order body for submission
  app.get(
    '/customers/:id/repeat-last-order',
    { preHandler: [rbacGuard('order', 'create')] },
    async (req) => {
      const { id } = req.params as { id: string };
      const orgId = req.user.org_id;

      const [cust] = await sql`SELECT id FROM customers WHERE id = ${id} AND org_id = ${orgId}`;
      if (!cust) throw notFound('Customer not found');

      const [lastOrder] = await sql<Array<{ id: string; order_date: string }>>`
        SELECT id, order_date FROM sales_orders
        WHERE customer_id = ${id} AND status NOT IN ('cancelled','draft')
        ORDER BY order_date DESC, created_at DESC
        LIMIT 1
      `;
      if (!lastOrder) return { suggestion: null, lines: [] };

      const lines = await sql<
        Array<{
          product_id: string;
          qty: number;
          sku: string;
          name: string;
        }>
      >`
        SELECT sol.product_id, sol.qty, p.sku, p.name
        FROM sales_order_lines sol
        JOIN products p ON p.id = sol.product_id
        WHERE sol.order_id = ${lastOrder.id}
      `;

      // Re-price today
      const today = new Date().toISOString().slice(0, 10);
      const priced = [];
      for (const line of lines) {
        try {
          const p = await resolvePrice(orgId, id, line.product_id, line.qty, today);
          priced.push({
            product_id: line.product_id,
            sku: line.sku,
            name: line.name,
            qty: line.qty,
            unit_price: p.unit_price,
            line_total: p.line_total,
            source: p.source,
          });
        } catch (e) {
          if (e instanceof PriceNotFoundError) {
            priced.push({
              product_id: line.product_id,
              sku: line.sku,
              name: line.name,
              qty: line.qty,
              unit_price: null,
              line_total: null,
              source: 'unavailable',
            });
          } else throw e;
        }
      }

      return {
        source_order_id: lastOrder.id,
        source_order_date: lastOrder.order_date,
        lines: priced,
      };
    },
  );

  // STATEMENT — ledger entries between dates + opening/closing/aging
  app.get(
    '/customers/:id/statement',
    { preHandler: [rbacGuard('customer', 'read')] },
    async (req) => {
      const { id } = req.params as { id: string };
      const orgId = req.user.org_id;
      const q = z
        .object({
          from: z.string().date(),
          to: z.string().date(),
        })
        .safeParse(req.query);
      if (!q.success) throw badRequest('Invalid query', q.error.flatten());

      const [cust] = await sql`
        SELECT c.id, c.code, c.name, c.address, c.phone,
               o.name AS org_name
        FROM customers c
        JOIN orgs o ON o.id = c.org_id
        WHERE c.id = ${id} AND c.org_id = ${orgId}
      `;
      if (!cust) throw notFound('Customer not found');

      // Opening balance = running_balance of last entry strictly before `from`
      const [opening] = await sql<Array<{ running_balance: string | null }>>`
        SELECT running_balance FROM ar_ledger
        WHERE customer_id = ${id} AND ts < ${q.data.from}::date
        ORDER BY id DESC LIMIT 1
      `;
      const entries = await sql`
        SELECT id, ts, entry_type, ref_type, ref_id, debit, credit, running_balance, note
        FROM ar_ledger
        WHERE customer_id = ${id}
          AND ts >= ${q.data.from}::date
          AND ts <  (${q.data.to}::date + interval '1 day')
        ORDER BY id
      `;
      const closingBalance =
        entries.length > 0
          ? Number(entries[entries.length - 1]!.running_balance)
          : Number(opening?.running_balance ?? 0);

      const [aging] = await sql`
        SELECT
          COALESCE(cs.outstanding_total, 0)  AS outstanding_total,
          COALESCE(cs.overdue_0_7, 0)        AS overdue_0_7,
          COALESCE(cs.overdue_8_15, 0)       AS overdue_8_15,
          COALESCE(cs.overdue_16_30, 0)      AS overdue_16_30,
          COALESCE(cs.overdue_31_60, 0)      AS overdue_31_60,
          COALESCE(cs.overdue_60_plus, 0)    AS overdue_60_plus
        FROM customer_credit_state cs WHERE cs.customer_id = ${id}
      `;

      return {
        customer: cust,
        period: { from: q.data.from, to: q.data.to },
        opening_balance: Number(opening?.running_balance ?? 0),
        closing_balance: closingBalance,
        entries,
        aging: aging ?? {},
      };
    },
  );

  // UNHOLD / ACTIVATE customer (clears hold or releases block)
  app.post(
    '/customers/:id/activate',
    { preHandler: [rbacGuard('customer', 'hold')] },
    async (req) => {
      const { id } = req.params as { id: string };
      const orgId = req.user.org_id;

      const body = z.object({ reason: z.string().min(1) }).safeParse(req.body);
      if (!body.success) throw badRequest('Invalid request body', body.error.flatten());

      const [before] = await sql`
        SELECT status, hold_reason, hold_until
        FROM customers WHERE id = ${id} AND org_id = ${orgId}
      `;
      if (!before) throw notFound('Customer not found');
      if (before.status === 'active') throw conflict('Customer is already active');

      const [updated] = await sql`
        UPDATE customers
        SET status = 'active', hold_reason = NULL, hold_until = NULL
        WHERE id = ${id} AND org_id = ${orgId}
        RETURNING id, status, hold_reason, hold_until
      `;

      await sql`
        INSERT INTO audit_log (org_id, user_id, action, entity, entity_id, before_json, after_json)
        VALUES (
          ${orgId}, ${req.user.sub}, 'update', 'customer', ${id},
          ${sql.json({ status: before.status, hold_reason: before.hold_reason, hold_until: before.hold_until })},
          ${sql.json({ status: 'active', reason: body.data.reason })}
        )
      `;

      await refreshCreditState(id);
      return updated;
    },
  );
}
