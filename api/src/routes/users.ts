import { UserRole } from '@liquor/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { rbacGuard } from '../plugins/rbac.js';

const CreateUserBody = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().min(10).max(15),
  email: z.string().email().optional(),
  role: UserRole,
});

const UpdateUserBody = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().nullable().optional(),
  role: UserRole.optional(),
  active: z.boolean().optional(),
});

export default async function userRoutes(app: FastifyInstance) {
  // List users
  app.get('/users', { preHandler: [rbacGuard('user', 'read')] }, async (req) => {
    const orgId = req.user.org_id;
    const rows = await sql`
        SELECT id, name, phone, email, role, active, created_at
        FROM users
        WHERE org_id = ${orgId}
        ORDER BY name
      `;
    return { items: rows };
  });

  // Get single user
  app.get('/users/:id', { preHandler: [rbacGuard('user', 'read')] }, async (req) => {
    const { id } = req.params as { id: string };
    const orgId = req.user.org_id;
    const rows = await sql`
        SELECT u.id, u.name, u.phone, u.email, u.role, u.active, u.created_at,
               json_agg(json_build_object(
                 'device_id', d.device_id,
                 'platform', d.platform,
                 'last_seen_at', d.last_seen_at
               )) FILTER (WHERE d.id IS NOT NULL) AS devices
        FROM users u
        LEFT JOIN user_devices d ON d.user_id = u.id
        WHERE u.id = ${id} AND u.org_id = ${orgId}
        GROUP BY u.id
      `;
    if (rows.length === 0) throw notFound('User not found');
    return rows[0];
  });

  // Create user
  app.post('/users', { preHandler: [rbacGuard('user', 'create')] }, async (req, reply) => {
    const body = CreateUserBody.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const { name, phone, email, role } = body.data;
    const orgId = req.user.org_id;

    try {
      const rows = await sql`
          INSERT INTO users (org_id, name, phone, email, role)
          VALUES (${orgId}, ${name}, ${phone}, ${email ?? null}, ${role})
          RETURNING id, name, phone, email, role, active, created_at
        `;
      return reply.status(201).send(rows[0]);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('unique')) {
        throw conflict('A user with this phone already exists in the org');
      }
      throw err;
    }
  });

  // Update user
  app.patch('/users/:id', { preHandler: [rbacGuard('user', 'update')] }, async (req) => {
    const { id } = req.params as { id: string };
    const body = UpdateUserBody.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const orgId = req.user.org_id;

    const fields = body.data;
    if (Object.keys(fields).length === 0) throw badRequest('No fields to update');

    const cols = Object.keys(fields) as Array<keyof typeof fields>;
    const setObj: Record<string, unknown> = {};
    for (const col of cols) {
      setObj[col] = fields[col];
    }

    const rows = await sql`
        UPDATE users SET ${sql(setObj, ...cols)}
        WHERE id = ${id} AND org_id = ${orgId}
        RETURNING id, name, phone, email, role, active, created_at
      `;
    if (rows.length === 0) throw notFound('User not found');
    return rows[0];
  });
}
