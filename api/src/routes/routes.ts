import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { rbacGuard } from '../plugins/rbac.js';

const CreateRouteBody = z.object({
  name: z.string().min(1).max(200),
  owner_user_id: z.string().uuid().optional(),
  days_of_week: z.array(z.number().int().min(0).max(6)).optional(),
  active: z.boolean().optional(),
});

const UpdateRouteBody = z.object({
  name: z.string().min(1).max(200).optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  days_of_week: z.array(z.number().int().min(0).max(6)).optional(),
  active: z.boolean().optional(),
});

const ReorderBody = z.object({
  stops: z
    .array(
      z.object({
        customer_id: z.string().uuid(),
        sequence: z.number().int().positive(),
      }),
    )
    .min(1),
});

export default async function routeRoutes(app: FastifyInstance) {
  // LIST routes (with customer count)
  app.get('/routes', { preHandler: [rbacGuard('route', 'read')] }, async (req) => {
    const orgId = req.user.org_id;
    const rows = await sql`
        SELECT
          r.id, r.name, r.owner_user_id, r.days_of_week, r.active,
          u.name AS owner_name,
          (SELECT count(*)::int FROM customers c WHERE c.route_id = r.id) AS customer_count
        FROM routes r
        LEFT JOIN users u ON u.id = r.owner_user_id
        WHERE r.org_id = ${orgId}
        ORDER BY r.name
      `;
    return { items: rows };
  });

  // GET route with stop list
  app.get('/routes/:id', { preHandler: [rbacGuard('route', 'read')] }, async (req) => {
    const { id } = req.params as { id: string };
    const orgId = req.user.org_id;

    const [route] = await sql`
        SELECT r.id, r.name, r.owner_user_id, r.days_of_week, r.active,
               u.name AS owner_name
        FROM routes r
        LEFT JOIN users u ON u.id = r.owner_user_id
        WHERE r.id = ${id} AND r.org_id = ${orgId}
      `;
    if (!route) throw notFound('Route not found');

    const stops = await sql`
        SELECT id, code, name, route_sequence, status, credit_limit
        FROM customers
        WHERE route_id = ${id} AND org_id = ${orgId}
        ORDER BY route_sequence NULLS LAST, name
      `;
    return { ...route, stops };
  });

  // CREATE route
  app.post('/routes', { preHandler: [rbacGuard('route', 'create')] }, async (req, reply) => {
    const body = CreateRouteBody.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const { name, owner_user_id, days_of_week, active } = body.data;
    const orgId = req.user.org_id;

    try {
      const [row] = await sql`
          INSERT INTO routes (org_id, name, owner_user_id, days_of_week, active)
          VALUES (
            ${orgId}, ${name}, ${owner_user_id ?? null},
            ${days_of_week ?? [1, 2, 3, 4, 5, 6]}, ${active ?? true}
          )
          RETURNING id, name, owner_user_id, days_of_week, active
        `;
      return reply.status(201).send(row);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('unique')) {
        throw conflict('A route with this name already exists');
      }
      throw err;
    }
  });

  // UPDATE route
  app.patch('/routes/:id', { preHandler: [rbacGuard('route', 'update')] }, async (req) => {
    const { id } = req.params as { id: string };
    const body = UpdateRouteBody.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const orgId = req.user.org_id;

    const fields = body.data;
    if (Object.keys(fields).length === 0) throw badRequest('No fields to update');

    const cols = Object.keys(fields) as Array<keyof typeof fields>;
    const setObj: Record<string, unknown> = {};
    for (const col of cols) setObj[col] = fields[col];

    const rows = await sql`
        UPDATE routes SET ${sql(setObj, ...cols)}
        WHERE id = ${id} AND org_id = ${orgId}
        RETURNING id, name, owner_user_id, days_of_week, active
      `;
    if (rows.length === 0) throw notFound('Route not found');
    return rows[0];
  });

  // REORDER stops — bulk update route_sequence for customers on this route
  app.post('/routes/:id/reorder', { preHandler: [rbacGuard('route', 'update')] }, async (req) => {
    const { id } = req.params as { id: string };
    const body = ReorderBody.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const orgId = req.user.org_id;

    // Verify route exists and all customer ids belong to it
    const [route] = await sql`
        SELECT id FROM routes WHERE id = ${id} AND org_id = ${orgId}
      `;
    if (!route) throw notFound('Route not found');

    const ids = body.data.stops.map((s) => s.customer_id);
    const owned = await sql`
        SELECT id FROM customers
        WHERE id IN ${sql(ids)} AND org_id = ${orgId} AND route_id = ${id}
      `;
    if (owned.length !== ids.length) {
      throw badRequest('One or more customers are not on this route');
    }

    await sql.begin(async (tx) => {
      for (const stop of body.data.stops) {
        await tx`
            UPDATE customers
            SET route_sequence = ${stop.sequence}
            WHERE id = ${stop.customer_id} AND org_id = ${orgId}
          `;
      }
      await tx`
          INSERT INTO audit_log (org_id, user_id, action, entity, entity_id, before_json, after_json)
          VALUES (
            ${orgId}, ${req.user.sub}, 'update', 'route_sequence', ${id},
            ${sql.json({})}, ${sql.json({ stops: body.data.stops })}
          )
        `;
    });

    return { ok: true, updated: body.data.stops.length };
  });

  // DELETE route (soft: set active=false; hard delete blocked if customers assigned)
  app.delete('/routes/:id', { preHandler: [rbacGuard('route', 'delete')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const orgId = req.user.org_id;

    const countRows = await sql<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM customers
        WHERE route_id = ${id} AND org_id = ${orgId}
      `;
    const count = countRows[0]?.count ?? 0;

    if (count > 0) {
      throw conflict(
        `Cannot delete route with ${count} assigned customer(s). Reassign them first or deactivate the route.`,
      );
    }

    const rows = await sql`
        DELETE FROM routes WHERE id = ${id} AND org_id = ${orgId} RETURNING id
      `;
    if (rows.length === 0) throw notFound('Route not found');
    return reply.status(204).send();
  });
}
