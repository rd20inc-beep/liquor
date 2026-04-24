import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { rbacGuard } from '../plugins/rbac.js';
import {
  InsufficientStockError,
  applyAdjustment,
  getStockState,
  pickBatchesFEFO,
} from '../services/stock.js';

// ---------- Schemas ----------

const StateQuery = z.object({
  warehouse_id: z.string().uuid().optional(),
  product_id: z.string().uuid().optional(),
  below_reorder: z.coerce.boolean().optional(),
  near_expiry_days: z.coerce.number().int().nonnegative().optional(),
});

const ReceiptBody = z.object({
  warehouse_id: z.string().uuid(),
  product_id: z.string().uuid(),
  qty: z.number().int().positive(),
  cost_price: z.number().nonnegative().default(0),
  batch_no: z.string().optional(),
  mfg_date: z.string().date().optional(),
  expiry_date: z.string().date().optional(),
  reason: z.enum(['purchase_in', 'opening_balance']).default('purchase_in'),
  ref_type: z.string().optional(),
  ref_id: z.string().uuid().optional(),
  note: z.string().optional(),
});

const TransferBody = z.object({
  from_wh_id: z.string().uuid(),
  to_wh_id: z.string().uuid(),
  product_id: z.string().uuid(),
  qty: z.number().int().positive(),
  reason: z.enum(['transfer', 'load_out', 'load_in']).default('transfer'),
  note: z.string().optional(),
});

const PickQuery = z.object({
  warehouse_id: z.string().uuid(),
  product_id: z.string().uuid(),
  qty: z.coerce.number().int().positive(),
});

const BatchesQuery = z.object({
  warehouse_id: z.string().uuid(),
  product_id: z.string().uuid(),
});

// ---------- Routes ----------

export default async function stockRoutes(app: FastifyInstance) {
  // LIST stock state
  app.get('/stock', { preHandler: [rbacGuard('stock', 'read')] }, async (req) => {
    const parsed = StateQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest('Invalid query', parsed.error.flatten());
    const rows = await getStockState(req.user.org_id, parsed.data);
    return { items: rows };
  });

  // LIST batches at a warehouse for a product (for adjustment UI)
  app.get('/stock/batches', { preHandler: [rbacGuard('stock', 'read')] }, async (req) => {
    const parsed = BatchesQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest('Invalid query', parsed.error.flatten());
    const { warehouse_id, product_id } = parsed.data;
    const orgId = req.user.org_id;
    const items = await sql`
      SELECT id,
             batch_no                                          AS lot_code,
             expiry_date,
             mfg_date,
             qty_physical::text                                AS qty_physical,
             qty_reserved::text                                AS qty_reserved,
             qty_damaged::text                                 AS qty_damaged,
             (qty_physical - qty_reserved - qty_damaged)::text AS qty_sellable,
             cost_price::text                                  AS cost_price
      FROM stock_batches
      WHERE org_id = ${orgId}
        AND warehouse_id = ${warehouse_id}
        AND product_id = ${product_id}
        AND qty_physical > 0
      ORDER BY COALESCE(expiry_date, 'infinity'::date) ASC, created_at ASC
    `;
    return { items };
  });

  // FEFO pick preview (dry run — does not reserve)
  app.get('/stock/pick', { preHandler: [rbacGuard('stock', 'read')] }, async (req) => {
    const parsed = PickQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest('Invalid query', parsed.error.flatten());
    const { warehouse_id, product_id, qty } = parsed.data;
    const orgId = req.user.org_id;

    // Scope check
    const [wh] =
      await sql`SELECT id FROM warehouses WHERE id = ${warehouse_id} AND org_id = ${orgId}`;
    if (!wh) throw notFound('Warehouse not found');

    // Read-only dry run — still FOR UPDATE so callers see a realistic pick
    const picks = await sql.begin(async (tx) => pickBatchesFEFO(tx, warehouse_id, product_id, qty));
    if (picks === null) throw conflict('Insufficient free stock for FEFO pick');
    return { allocations: picks };
  });

  // RECEIPT — open a batch and add to physical stock
  app.post(
    '/stock/receipts',
    { preHandler: [rbacGuard('stock', 'receipt')] },
    async (req, reply) => {
      const body = ReceiptBody.safeParse(req.body);
      if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
      const orgId = req.user.org_id;
      const d = body.data;

      // Scope: warehouse belongs to org, product belongs to org
      const [wh] =
        await sql`SELECT id, type FROM warehouses WHERE id = ${d.warehouse_id} AND org_id = ${orgId}`;
      if (!wh) throw badRequest('Warehouse not found');
      const [prod] =
        await sql`SELECT id FROM products WHERE id = ${d.product_id} AND org_id = ${orgId}`;
      if (!prod) throw badRequest('Product not found');

      const row = await sql.begin(async (tx) => {
        const [batch] = await tx`
          INSERT INTO stock_batches (
            org_id, product_id, warehouse_id, batch_no, mfg_date, expiry_date,
            cost_price, qty_physical
          ) VALUES (
            ${orgId}, ${d.product_id}, ${d.warehouse_id},
            ${d.batch_no ?? null}, ${d.mfg_date ?? null}, ${d.expiry_date ?? null},
            ${d.cost_price}, ${d.qty}
          )
          RETURNING *
        `;

        await tx`
          INSERT INTO stock_movements (
            org_id, product_id, batch_id, from_wh_id, to_wh_id, qty, reason,
            ref_type, ref_id, user_id, note
          ) VALUES (
            ${orgId}, ${d.product_id}, ${batch!.id}, NULL, ${d.warehouse_id},
            ${d.qty}, ${d.reason},
            ${d.ref_type ?? 'receipt'}, ${d.ref_id ?? batch!.id},
            ${req.user.sub}, ${d.note ?? null}
          )
        `;
        return batch;
      });

      return reply.status(201).send(row);
    },
  );

  // TRANSFER — atomic debit/credit between warehouses with FEFO source pick
  app.post(
    '/stock/transfers',
    { preHandler: [rbacGuard('stock', 'transfer')] },
    async (req, reply) => {
      const body = TransferBody.safeParse(req.body);
      if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
      const orgId = req.user.org_id;
      const d = body.data;

      if (d.from_wh_id === d.to_wh_id) throw badRequest('from_wh_id and to_wh_id must differ');
      const idempotencyKey = (req.headers['idempotency-key'] as string | undefined) ?? null;

      // Both warehouses in this org
      const whs = await sql<Array<{ id: string }>>`
        SELECT id FROM warehouses WHERE id IN (${d.from_wh_id}, ${d.to_wh_id}) AND org_id = ${orgId}
      `;
      if (whs.length !== 2) throw badRequest('Warehouse not found in this org');

      // Idempotency: if a prior transfer movement pair exists with this key, return it
      if (idempotencyKey) {
        const existing = await sql<Array<{ id: string; ref_id: string }>>`
          SELECT id, ref_id FROM stock_movements
          WHERE org_id = ${orgId} AND ref_type = 'transfer' AND ref_id = ${idempotencyKey}::uuid
          LIMIT 1
        `;
        if (existing.length > 0) {
          return reply.status(200).send({ transfer_id: existing[0]!.ref_id, idempotent: true });
        }
      }

      const result = await sql.begin(async (tx) => {
        const picks = await pickBatchesFEFO(tx, d.from_wh_id, d.product_id, d.qty);
        if (picks === null) throw new InsufficientStockError(d.from_wh_id, d.product_id, d.qty);

        const transferId = (await tx<Array<{ id: string }>>`SELECT gen_random_uuid() AS id`)[0]!.id;
        const refId = idempotencyKey ?? transferId;

        for (const p of picks) {
          // Debit source batch
          await tx`
            UPDATE stock_batches
            SET qty_physical = qty_physical - ${p.qty}
            WHERE id = ${p.batch_id}
          `;

          // Credit: either merge into existing dest batch with matching (batch_no, expiry)
          // or open a fresh dest batch. We simplify by always opening a new batch keyed
          // to the source batch, preserving lot identity and expiry.
          const [srcBatch] = await tx<
            Array<{
              batch_no: string | null;
              mfg_date: string | null;
              expiry_date: string | null;
              cost_price: string;
            }>
          >`
            SELECT batch_no, mfg_date, expiry_date, cost_price
            FROM stock_batches WHERE id = ${p.batch_id}
          `;

          const [destBatch] = await tx<Array<{ id: string }>>`
            INSERT INTO stock_batches (
              org_id, product_id, warehouse_id, batch_no, mfg_date, expiry_date,
              cost_price, qty_physical
            ) VALUES (
              ${orgId}, ${d.product_id}, ${d.to_wh_id},
              ${srcBatch!.batch_no}, ${srcBatch!.mfg_date}, ${srcBatch!.expiry_date},
              ${srcBatch!.cost_price}, ${p.qty}
            )
            RETURNING id
          `;

          // Movement pair: out of source, into dest (reuse ref_id for both legs)
          await tx`
            INSERT INTO stock_movements (
              org_id, product_id, batch_id, from_wh_id, to_wh_id, qty, reason,
              ref_type, ref_id, user_id, note
            ) VALUES
              (${orgId}, ${d.product_id}, ${p.batch_id}, ${d.from_wh_id}, NULL,
               ${p.qty}, ${d.reason}, 'transfer', ${refId}::uuid,
               ${req.user.sub}, ${d.note ?? null}),
              (${orgId}, ${d.product_id}, ${destBatch!.id}, NULL, ${d.to_wh_id},
               ${p.qty}, ${d.reason}, 'transfer', ${refId}::uuid,
               ${req.user.sub}, ${d.note ?? null})
          `;
        }

        return { transfer_id: refId, allocations: picks };
      });

      return reply.status(201).send(result);
    },
  );

  // ADJUST — non-admin: creates approval. admin: applies directly.
  // body: { warehouse_id, product_id, batch_id?, delta_qty, reason }
  app.post(
    '/stock/adjustments',
    { preHandler: [rbacGuard('stock', 'adjust')] },
    async (req, reply) => {
      const body = z
        .object({
          warehouse_id: z.string().uuid(),
          product_id: z.string().uuid(),
          batch_id: z.string().uuid().optional(),
          delta_qty: z.number().int(),
          reason: z.string().min(1),
          note: z.string().optional(),
        })
        .safeParse(req.body);
      if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
      const orgId = req.user.org_id;
      const d = body.data;
      if (d.delta_qty === 0) throw badRequest('delta_qty cannot be zero');

      // Admin applies directly; everyone else files an approval
      const isAdmin = req.user.role === 'admin' || req.user.role === 'owner';
      if (!isAdmin) {
        const [appr] = await sql`
          INSERT INTO approval_requests (
            org_id, type, ref_type, ref_id, requested_by, status, reason, payload
          ) VALUES (
            ${orgId}, 'stock_adjust', 'stock_adjustment',
            gen_random_uuid(), ${req.user.sub}, 'pending', ${d.reason},
            ${sql.json(d)}
          )
          RETURNING id, type, status, reason, payload, created_at
        `;
        return reply
          .status(202)
          .send({ approval: appr, message: 'Adjustment queued for admin approval' });
      }

      // Admin path — direct apply
      const result = await sql.begin(async (tx) => applyAdjustment(tx, orgId, req.user.sub, d));
      return reply.status(201).send(result);
    },
  );
}
