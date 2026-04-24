import { WarehouseType } from '@liquor/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { rbacGuard } from '../plugins/rbac.js';

// ---------- Vehicles ----------

const CreateVehicleBody = z.object({
  reg_no: z.string().min(1).max(50),
  capacity_cases: z.number().int().positive(),
  active: z.boolean().optional(),
});

const UpdateVehicleBody = z.object({
  reg_no: z.string().min(1).max(50).optional(),
  capacity_cases: z.number().int().positive().optional(),
  active: z.boolean().optional(),
});

// ---------- Warehouses ----------

const CreateWarehouseBody = z
  .object({
    code: z.string().min(1).max(50),
    name: z.string().min(1).max(200),
    type: WarehouseType,
    vehicle_id: z.string().uuid().optional(),
    custodian_user_id: z.string().uuid().optional(),
    is_damage_quarantine: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => d.type !== 'van' || d.vehicle_id !== undefined, {
    message: 'van warehouses require vehicle_id',
    path: ['vehicle_id'],
  })
  .refine((d) => d.type !== 'van' || d.custodian_user_id !== undefined, {
    message: 'van warehouses require custodian_user_id',
    path: ['custodian_user_id'],
  });

const UpdateWarehouseBody = z.object({
  name: z.string().min(1).max(200).optional(),
  vehicle_id: z.string().uuid().nullable().optional(),
  custodian_user_id: z.string().uuid().nullable().optional(),
  is_damage_quarantine: z.boolean().optional(),
  active: z.boolean().optional(),
});

export default async function warehouseRoutes(app: FastifyInstance) {
  // ---- VEHICLES ----
  app.get('/vehicles', { preHandler: [rbacGuard('vehicle', 'read')] }, async (req) => {
    const orgId = req.user.org_id;
    const rows = await sql`
        SELECT id, reg_no, capacity_cases, active
        FROM vehicles WHERE org_id = ${orgId}
        ORDER BY reg_no
      `;
    return { items: rows };
  });

  app.post('/vehicles', { preHandler: [rbacGuard('vehicle', 'create')] }, async (req, reply) => {
    const body = CreateVehicleBody.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const orgId = req.user.org_id;
    const { reg_no, capacity_cases, active } = body.data;
    try {
      const [row] = await sql`
          INSERT INTO vehicles (org_id, reg_no, capacity_cases, active)
          VALUES (${orgId}, ${reg_no}, ${capacity_cases}, ${active ?? true})
          RETURNING id, reg_no, capacity_cases, active
        `;
      return reply.status(201).send(row);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('unique')) {
        throw conflict('A vehicle with this registration already exists');
      }
      throw err;
    }
  });

  app.patch('/vehicles/:id', { preHandler: [rbacGuard('vehicle', 'update')] }, async (req) => {
    const { id } = req.params as { id: string };
    const body = UpdateVehicleBody.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const orgId = req.user.org_id;
    const fields = body.data;
    if (Object.keys(fields).length === 0) throw badRequest('No fields to update');

    const cols = Object.keys(fields) as Array<keyof typeof fields>;
    const setObj: Record<string, unknown> = {};
    for (const col of cols) setObj[col] = fields[col];

    const rows = await sql`
        UPDATE vehicles SET ${sql(setObj, ...cols)}
        WHERE id = ${id} AND org_id = ${orgId}
        RETURNING id, reg_no, capacity_cases, active
      `;
    if (rows.length === 0) throw notFound('Vehicle not found');
    return rows[0];
  });

  // ---- WAREHOUSES ----
  app.get('/warehouses', { preHandler: [rbacGuard('warehouse', 'read')] }, async (req) => {
    const orgId = req.user.org_id;
    const rows = await sql`
        SELECT
          w.id, w.code, w.name, w.type, w.vehicle_id, w.custodian_user_id,
          w.is_damage_quarantine, w.active,
          v.reg_no AS vehicle_reg_no,
          u.name   AS custodian_name
        FROM warehouses w
        LEFT JOIN vehicles v ON v.id = w.vehicle_id
        LEFT JOIN users u    ON u.id = w.custodian_user_id
        WHERE w.org_id = ${orgId}
        ORDER BY w.type, w.name
      `;
    return { items: rows };
  });

  app.get('/warehouses/:id', { preHandler: [rbacGuard('warehouse', 'read')] }, async (req) => {
    const { id } = req.params as { id: string };
    const orgId = req.user.org_id;
    const rows = await sql`
        SELECT
          w.*, v.reg_no AS vehicle_reg_no, u.name AS custodian_name
        FROM warehouses w
        LEFT JOIN vehicles v ON v.id = w.vehicle_id
        LEFT JOIN users u    ON u.id = w.custodian_user_id
        WHERE w.id = ${id} AND w.org_id = ${orgId}
      `;
    if (rows.length === 0) throw notFound('Warehouse not found');
    return rows[0];
  });

  app.post(
    '/warehouses',
    { preHandler: [rbacGuard('warehouse', 'create')] },
    async (req, reply) => {
      const body = CreateWarehouseBody.safeParse(req.body);
      if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
      const orgId = req.user.org_id;
      const d = body.data;
      try {
        const [row] = await sql`
          INSERT INTO warehouses (
            org_id, code, name, type, vehicle_id, custodian_user_id,
            is_damage_quarantine, active
          ) VALUES (
            ${orgId}, ${d.code}, ${d.name}, ${d.type},
            ${d.vehicle_id ?? null}, ${d.custodian_user_id ?? null},
            ${d.is_damage_quarantine ?? false}, ${d.active ?? true}
          )
          RETURNING *
        `;
        return reply.status(201).send(row);
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('unique')) {
          throw conflict('A warehouse with this code already exists');
        }
        throw err;
      }
    },
  );

  app.patch('/warehouses/:id', { preHandler: [rbacGuard('warehouse', 'update')] }, async (req) => {
    const { id } = req.params as { id: string };
    const body = UpdateWarehouseBody.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const orgId = req.user.org_id;

    const fields = body.data;
    if (Object.keys(fields).length === 0) throw badRequest('No fields to update');

    // If the warehouse is a van we must not null out vehicle_id
    if (fields.vehicle_id === null) {
      const [w] = await sql`SELECT type FROM warehouses WHERE id = ${id} AND org_id = ${orgId}`;
      if (w?.type === 'van') throw badRequest('Cannot unset vehicle_id on a van warehouse');
    }

    const cols = Object.keys(fields) as Array<keyof typeof fields>;
    const setObj: Record<string, unknown> = {};
    for (const col of cols) setObj[col] = fields[col];

    const rows = await sql`
        UPDATE warehouses SET ${sql(setObj, ...cols)}
        WHERE id = ${id} AND org_id = ${orgId}
        RETURNING *
      `;
    if (rows.length === 0) throw notFound('Warehouse not found');
    return rows[0];
  });
}
