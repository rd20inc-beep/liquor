import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { rbacGuard } from '../plugins/rbac.js';
import { audit } from '../services/audit.js';
import { applyAdjustment } from '../services/stock.js';

const StartBody = z.object({
  warehouse_id: z.string().uuid(),
});

const EnterLinesBody = z.object({
  lines: z
    .array(
      z.object({
        batch_id: z.string().uuid(),
        counted_qty: z.number().int().nonnegative(),
        note: z.string().optional(),
      }),
    )
    .min(1)
    .max(1000),
});

export default async function cycleCountRoutes(app: FastifyInstance) {
  // START cycle count
  app.post(
    '/cycle-counts',
    { preHandler: [rbacGuard('cycle_count', 'create')] },
    async (req, reply) => {
      const body = StartBody.safeParse(req.body);
      if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
      const orgId = req.user.org_id;

      const [wh] = await sql`
        SELECT id FROM warehouses WHERE id = ${body.data.warehouse_id} AND org_id = ${orgId}
      `;
      if (!wh) throw badRequest('Warehouse not found');

      const [cc] = await sql`
        INSERT INTO cycle_counts (org_id, warehouse_id, started_by)
        VALUES (${orgId}, ${body.data.warehouse_id}, ${req.user.sub})
        RETURNING id, warehouse_id, started_at
      `;
      return reply.status(201).send(cc);
    },
  );

  // LIST
  app.get('/cycle-counts', { preHandler: [rbacGuard('cycle_count', 'read')] }, async (req) => {
    const orgId = req.user.org_id;
    const rows = await sql`
        SELECT
          cc.id, cc.warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
          cc.started_at, cc.closed_at, cc.started_by,
          (SELECT count(*)::int FROM cycle_count_lines WHERE cycle_id = cc.id) AS line_count
        FROM cycle_counts cc
        JOIN warehouses w ON w.id = cc.warehouse_id
        WHERE cc.org_id = ${orgId}
        ORDER BY cc.started_at DESC
        LIMIT 100
      `;
    return { items: rows };
  });

  // GET cycle count with variance lines
  app.get('/cycle-counts/:id', { preHandler: [rbacGuard('cycle_count', 'read')] }, async (req) => {
    const { id } = req.params as { id: string };
    const orgId = req.user.org_id;

    const [cc] = await sql`
        SELECT cc.*, w.code AS warehouse_code, w.name AS warehouse_name
        FROM cycle_counts cc
        JOIN warehouses w ON w.id = cc.warehouse_id
        WHERE cc.id = ${id} AND cc.org_id = ${orgId}
      `;
    if (!cc) throw notFound('Cycle count not found');

    const lines = await sql`
        SELECT
          ccl.batch_id, ccl.system_qty, ccl.counted_qty, ccl.variance, ccl.note,
          sb.batch_no, sb.expiry_date,
          sb.product_id, p.sku, p.name AS product_name
        FROM cycle_count_lines ccl
        JOIN stock_batches sb ON sb.id = ccl.batch_id
        JOIN products p ON p.id = sb.product_id
        WHERE ccl.cycle_id = ${id}
        ORDER BY p.name
      `;
    return { ...cc, lines };
  });

  // ENTER counted qty (bulk). Computes system_qty snapshot from current qty_physical.
  app.post(
    '/cycle-counts/:id/lines',
    { preHandler: [rbacGuard('cycle_count', 'update')] },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = EnterLinesBody.safeParse(req.body);
      if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
      const orgId = req.user.org_id;

      const [cc] = await sql<Array<{ id: string; warehouse_id: string; closed_at: string | null }>>`
        SELECT id, warehouse_id, closed_at FROM cycle_counts
        WHERE id = ${id} AND org_id = ${orgId}
      `;
      if (!cc) throw notFound('Cycle count not found');
      if (cc.closed_at) throw conflict('Cycle count is already closed');

      // Verify all batches belong to this warehouse
      const batchIds = body.data.lines.map((l) => l.batch_id);
      const owned = await sql<Array<{ id: string; qty_physical: number }>>`
        SELECT id, qty_physical FROM stock_batches
        WHERE id IN ${sql(batchIds)} AND org_id = ${orgId} AND warehouse_id = ${cc.warehouse_id}
      `;
      if (owned.length !== batchIds.length) {
        throw badRequest('One or more batches do not belong to the count warehouse');
      }
      const systemById = new Map(owned.map((b) => [b.id, Number(b.qty_physical)]));

      await sql.begin(async (tx) => {
        for (const line of body.data.lines) {
          await tx`
            INSERT INTO cycle_count_lines (cycle_id, batch_id, system_qty, counted_qty, note)
            VALUES (${id}, ${line.batch_id}, ${systemById.get(line.batch_id)!}, ${line.counted_qty}, ${line.note ?? null})
            ON CONFLICT (cycle_id, batch_id) DO UPDATE SET
              counted_qty = EXCLUDED.counted_qty,
              system_qty  = EXCLUDED.system_qty,
              note        = EXCLUDED.note
          `;
        }
      });

      return { ok: true, upserted: body.data.lines.length };
    },
  );

  // APPLY variances — admin applies adjustments directly; others queue approvals.
  app.post(
    '/cycle-counts/:id/apply',
    { preHandler: [rbacGuard('cycle_count', 'apply')] },
    async (req) => {
      const { id } = req.params as { id: string };
      const orgId = req.user.org_id;

      const [cc] = await sql<Array<{ id: string; warehouse_id: string; closed_at: string | null }>>`
        SELECT id, warehouse_id, closed_at FROM cycle_counts
        WHERE id = ${id} AND org_id = ${orgId}
      `;
      if (!cc) throw notFound('Cycle count not found');
      if (cc.closed_at) throw conflict('Cycle count is already closed');

      const lines = await sql<
        Array<{
          batch_id: string;
          variance: number;
          system_qty: number;
          counted_qty: number;
          product_id: string;
          warehouse_id: string;
        }>
      >`
        SELECT
          ccl.batch_id, ccl.variance, ccl.system_qty, ccl.counted_qty,
          sb.product_id, sb.warehouse_id
        FROM cycle_count_lines ccl
        JOIN stock_batches sb ON sb.id = ccl.batch_id
        WHERE ccl.cycle_id = ${id} AND ccl.variance <> 0
      `;

      const isAdmin = req.user.role === 'admin' || req.user.role === 'owner';

      if (!isAdmin) {
        // Queue one approval per variance
        const approvals = await sql.begin(async (tx) => {
          const results = [];
          for (const line of lines) {
            const [appr] = await tx`
              INSERT INTO approval_requests (
                org_id, type, ref_type, ref_id, requested_by, status, reason, payload
              ) VALUES (
                ${orgId}, 'stock_adjust', 'cycle_count_line', ${cc.id},
                ${req.user.sub}, 'pending', ${`Cycle count variance ${line.variance}`},
                ${sql.json({
                  warehouse_id: line.warehouse_id,
                  product_id: line.product_id,
                  batch_id: line.batch_id,
                  delta_qty: Number(line.variance),
                  reason: `cycle_count:${cc.id}`,
                })}
              )
              RETURNING id
            `;
            results.push(appr!.id);
          }
          return results;
        });
        return { queued: approvals.length, approval_ids: approvals };
      }

      // Admin — apply directly
      const applied = await sql.begin(async (tx) => {
        const out = [];
        for (const line of lines) {
          const r = await applyAdjustment(tx, orgId, req.user.sub, {
            warehouse_id: line.warehouse_id,
            product_id: line.product_id,
            batch_id: line.batch_id,
            delta_qty: Number(line.variance),
            reason: `cycle_count:${cc.id}`,
          });
          out.push(r);
        }
        return out;
      });
      return { applied: applied.length };
    },
  );

  // CLOSE
  app.post(
    '/cycle-counts/:id/close',
    { preHandler: [rbacGuard('cycle_count', 'update')] },
    async (req) => {
      const { id } = req.params as { id: string };
      const orgId = req.user.org_id;

      const [cc] = await sql<Array<{ id: string; closed_at: string | null }>>`
        SELECT id, closed_at FROM cycle_counts WHERE id = ${id} AND org_id = ${orgId}
      `;
      if (!cc) throw notFound('Cycle count not found');
      if (cc.closed_at) throw conflict('Already closed');

      const [closed] = await sql`
        UPDATE cycle_counts SET closed_at = now() WHERE id = ${id}
        RETURNING id, closed_at
      `;
      await audit({
        orgId,
        userId: req.user.sub,
        action: 'update',
        entity: 'cycle_count',
        entityId: id,
        after: { closed_at: closed!.closed_at },
      });
      return closed;
    },
  );
}
