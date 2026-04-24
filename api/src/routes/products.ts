import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { rbacGuard } from '../plugins/rbac.js';

// ---------- Brands ----------

const CreateBrandBody = z.object({
  name: z.string().min(1).max(200),
});

// ---------- Products ----------

const CreateProductBody = z.object({
  sku: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  brand_id: z.string().uuid(),
  category: z.string().min(1).max(100),
  bottle_size_ml: z.number().int().positive(),
  case_qty: z.number().int().min(1).default(1),
  hsn: z.string().optional(),
  tax_rate: z.number().min(0).max(100).default(0),
  mrp: z.number().nonnegative().optional(),
  reorder_point: z.number().int().nonnegative().optional(),
  safety_stock: z.number().int().nonnegative().optional(),
  lead_time_days: z.number().int().nonnegative().optional(),
  active: z.boolean().optional(),
});

const UpdateProductBody = z.object({
  name: z.string().min(1).max(200).optional(),
  brand_id: z.string().uuid().optional(),
  category: z.string().min(1).max(100).optional(),
  bottle_size_ml: z.number().int().positive().optional(),
  case_qty: z.number().int().min(1).optional(),
  hsn: z.string().nullable().optional(),
  tax_rate: z.number().min(0).max(100).optional(),
  mrp: z.number().nonnegative().nullable().optional(),
  reorder_point: z.number().int().nonnegative().nullable().optional(),
  safety_stock: z.number().int().nonnegative().nullable().optional(),
  lead_time_days: z.number().int().nonnegative().nullable().optional(),
  active: z.boolean().optional(),
});

const ListQuery = z.object({
  q: z.string().optional(),
  brand_id: z.string().uuid().optional(),
  category: z.string().optional(),
  active: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().uuid().optional(),
});

export default async function productRoutes(app: FastifyInstance) {
  // ---- BRANDS ----
  app.get('/brands', { preHandler: [rbacGuard('product', 'read')] }, async (req) => {
    const orgId = req.user.org_id;
    const rows = await sql`
        SELECT b.id, b.name,
               (SELECT count(*)::int FROM products p WHERE p.brand_id = b.id) AS product_count
        FROM brands b WHERE b.org_id = ${orgId}
        ORDER BY b.name
      `;
    return { items: rows };
  });

  app.post('/brands', { preHandler: [rbacGuard('product', 'create')] }, async (req, reply) => {
    const body = CreateBrandBody.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const orgId = req.user.org_id;
    try {
      const [row] = await sql`
          INSERT INTO brands (org_id, name) VALUES (${orgId}, ${body.data.name})
          RETURNING id, name
        `;
      return reply.status(201).send(row);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('unique')) {
        throw conflict('A brand with this name already exists');
      }
      throw err;
    }
  });

  // ---- PRODUCTS ----
  app.get('/products', { preHandler: [rbacGuard('product', 'read')] }, async (req) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest('Invalid query', parsed.error.flatten());
    const { q, brand_id, category, active, limit, cursor } = parsed.data;
    const orgId = req.user.org_id;

    const conditions = [sql`p.org_id = ${orgId}`];
    if (brand_id) conditions.push(sql`p.brand_id = ${brand_id}`);
    if (category) conditions.push(sql`p.category = ${category}`);
    if (active !== undefined) conditions.push(sql`p.active = ${active}`);
    if (cursor) conditions.push(sql`p.id > ${cursor}`);
    if (q) {
      const like = `%${q}%`;
      conditions.push(sql`(p.name ILIKE ${like} OR p.sku ILIKE ${like})`);
    }
    const where = conditions.reduce((a, b) => sql`${a} AND ${b}`);

    const rows = await sql`
        SELECT
          p.id, p.sku, p.name, p.brand_id, b.name AS brand_name,
          p.category, p.bottle_size_ml, p.case_qty, p.hsn, p.tax_rate,
          p.mrp, p.reorder_point, p.safety_stock, p.lead_time_days, p.active,
          p.created_at
        FROM products p
        JOIN brands b ON b.id = p.brand_id
        WHERE ${where}
        ORDER BY p.name
        LIMIT ${limit}
      `;
    const nextCursor = rows.length === limit ? rows[rows.length - 1]!.id : null;
    return { items: rows, next_cursor: nextCursor };
  });

  app.get('/products/:id', { preHandler: [rbacGuard('product', 'read')] }, async (req) => {
    const { id } = req.params as { id: string };
    const orgId = req.user.org_id;
    const rows = await sql`
        SELECT p.*, b.name AS brand_name
        FROM products p JOIN brands b ON b.id = p.brand_id
        WHERE p.id = ${id} AND p.org_id = ${orgId}
      `;
    if (rows.length === 0) throw notFound('Product not found');
    return rows[0];
  });

  app.post('/products', { preHandler: [rbacGuard('product', 'create')] }, async (req, reply) => {
    const body = CreateProductBody.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const orgId = req.user.org_id;
    const d = body.data;

    // Verify brand belongs to org
    const [brand] = await sql`
        SELECT id FROM brands WHERE id = ${d.brand_id} AND org_id = ${orgId}
      `;
    if (!brand) throw badRequest('Brand not found');

    try {
      const [row] = await sql`
          INSERT INTO products (
            org_id, sku, name, brand_id, category, bottle_size_ml, case_qty,
            hsn, tax_rate, mrp, reorder_point, safety_stock, lead_time_days, active
          ) VALUES (
            ${orgId}, ${d.sku}, ${d.name}, ${d.brand_id}, ${d.category},
            ${d.bottle_size_ml}, ${d.case_qty}, ${d.hsn ?? null}, ${d.tax_rate},
            ${d.mrp ?? null}, ${d.reorder_point ?? null}, ${d.safety_stock ?? null},
            ${d.lead_time_days ?? null}, ${d.active ?? true}
          )
          RETURNING *
        `;
      return reply.status(201).send(row);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('unique')) {
        throw conflict('A product with this SKU already exists');
      }
      throw err;
    }
  });

  app.patch('/products/:id', { preHandler: [rbacGuard('product', 'update')] }, async (req) => {
    const { id } = req.params as { id: string };
    const body = UpdateProductBody.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const orgId = req.user.org_id;
    const fields = body.data;
    if (Object.keys(fields).length === 0) throw badRequest('No fields to update');

    if (fields.brand_id) {
      const [brand] = await sql`
          SELECT id FROM brands WHERE id = ${fields.brand_id} AND org_id = ${orgId}
        `;
      if (!brand) throw badRequest('Brand not found');
    }

    const cols = Object.keys(fields) as Array<keyof typeof fields>;
    const setObj: Record<string, unknown> = {};
    for (const col of cols) setObj[col] = fields[col];

    const rows = await sql`
        UPDATE products SET ${sql(setObj, ...cols)}
        WHERE id = ${id} AND org_id = ${orgId}
        RETURNING *
      `;
    if (rows.length === 0) throw notFound('Product not found');
    return rows[0];
  });
}
