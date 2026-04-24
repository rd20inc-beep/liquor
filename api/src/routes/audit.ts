import { AuditAction } from '@liquor/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { rbacGuard } from '../plugins/rbac.js';

const ListQuery = z.object({
  entity: z.string().optional(),
  entity_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  action: AuditAction.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.coerce.number().int().positive().optional(),
});

export default async function auditRoutes(app: FastifyInstance) {
  app.get('/audit', { preHandler: [rbacGuard('audit', 'read')] }, async (req) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest('Invalid query', parsed.error.flatten());
    const orgId = req.user.org_id;
    const { entity, entity_id, user_id, action, from, to, limit, cursor } = parsed.data;

    const conds = [sql`a.org_id = ${orgId}`];
    if (entity) conds.push(sql`a.entity = ${entity}`);
    if (entity_id) conds.push(sql`a.entity_id = ${entity_id}`);
    if (user_id) conds.push(sql`a.user_id = ${user_id}`);
    if (action) conds.push(sql`a.action = ${action}`);
    if (from) conds.push(sql`a.ts >= ${from}::timestamptz`);
    if (to) conds.push(sql`a.ts <= ${to}::timestamptz`);
    if (cursor) conds.push(sql`a.id < ${cursor}`);
    const where = conds.reduce((a, b) => sql`${a} AND ${b}`);

    const rows = await sql`
        SELECT
          a.id, a.ts, a.action, a.entity, a.entity_id,
          a.user_id, u.name AS user_name,
          a.before_json, a.after_json, a.ip
        FROM audit_log a
        LEFT JOIN users u ON u.id = a.user_id
        WHERE ${where}
        ORDER BY a.id DESC
        LIMIT ${limit}
      `;
    const nextCursor = rows.length === limit ? rows[rows.length - 1]!.id : null;
    return { items: rows, next_cursor: nextCursor };
  });

  app.get('/audit/:id', { preHandler: [rbacGuard('audit', 'read')] }, async (req) => {
    const { id } = req.params as { id: string };
    const orgId = req.user.org_id;
    const rows = await sql`
        SELECT a.*, u.name AS user_name
        FROM audit_log a
        LEFT JOIN users u ON u.id = a.user_id
        WHERE a.id = ${id} AND a.org_id = ${orgId}
      `;
    if (rows.length === 0) throw notFound('Audit entry not found');
    return rows[0];
  });
}
