import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { rbacGuard } from '../plugins/rbac.js';
import { PriceNotFoundError, resolvePrice } from '../services/pricing.js';

const CreatePriceListBody = z.object({
  name: z.string().min(1).max(200),
  effective_from: z.string().date(),
  effective_to: z.string().date().optional(),
  is_default: z.boolean().optional(),
});

const UpdatePriceListBody = z.object({
  name: z.string().min(1).max(200).optional(),
  effective_from: z.string().date().optional(),
  effective_to: z.string().date().nullable().optional(),
  is_default: z.boolean().optional(),
});

const UpsertItemBody = z.object({
  product_id: z.string().uuid(),
  unit_price: z.number().positive(),
  case_price: z.number().positive().nullable().optional(),
  min_qty: z.number().int().min(1).default(1),
});

const BulkUpsertBody = z.object({
  items: z.array(UpsertItemBody).min(1).max(1000),
});

const ResolveQuery = z.object({
  customer_id: z.string().uuid(),
  product_id: z.string().uuid(),
  qty: z.coerce.number().int().positive(),
  date: z.string().date().optional(),
});

export default async function priceListRoutes(app: FastifyInstance) {
  // LIST price lists
  app.get('/price-lists', { preHandler: [rbacGuard('price_list', 'read')] }, async (req) => {
    const orgId = req.user.org_id;
    const rows = await sql`
        SELECT
          pl.id, pl.name, pl.effective_from, pl.effective_to, pl.is_default,
          (SELECT count(*)::int FROM price_list_items i WHERE i.price_list_id = pl.id) AS item_count
        FROM price_lists pl
        WHERE pl.org_id = ${orgId}
        ORDER BY pl.is_default DESC, pl.name
      `;
    return { items: rows };
  });

  // GET price list with items
  app.get('/price-lists/:id', { preHandler: [rbacGuard('price_list', 'read')] }, async (req) => {
    const { id } = req.params as { id: string };
    const orgId = req.user.org_id;

    const [pl] = await sql`
        SELECT * FROM price_lists WHERE id = ${id} AND org_id = ${orgId}
      `;
    if (!pl) throw notFound('Price list not found');

    const items = await sql`
        SELECT
          i.product_id, p.sku, p.name AS product_name, p.bottle_size_ml, p.case_qty,
          i.unit_price, i.case_price, i.min_qty
        FROM price_list_items i
        JOIN products p ON p.id = i.product_id
        WHERE i.price_list_id = ${id}
        ORDER BY p.name
      `;
    return { ...pl, items };
  });

  // CREATE
  app.post(
    '/price-lists',
    { preHandler: [rbacGuard('price_list', 'create')] },
    async (req, reply) => {
      const body = CreatePriceListBody.safeParse(req.body);
      if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
      const orgId = req.user.org_id;
      const d = body.data;

      try {
        const [row] = await sql.begin(async (tx) => {
          // If setting this as default, unset any existing default first
          if (d.is_default) {
            await tx`UPDATE price_lists SET is_default = false WHERE org_id = ${orgId} AND is_default = true`;
          }
          return tx`
            INSERT INTO price_lists (org_id, name, effective_from, effective_to, is_default)
            VALUES (${orgId}, ${d.name}, ${d.effective_from}, ${d.effective_to ?? null}, ${d.is_default ?? false})
            RETURNING *
          `;
        });
        return reply.status(201).send(row);
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('unique')) {
          throw conflict('A price list with this name already exists');
        }
        throw err;
      }
    },
  );

  // UPDATE metadata (name / dates / default)
  app.patch(
    '/price-lists/:id',
    { preHandler: [rbacGuard('price_list', 'update')] },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = UpdatePriceListBody.safeParse(req.body);
      if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
      const orgId = req.user.org_id;
      const fields = body.data;
      if (Object.keys(fields).length === 0) throw badRequest('No fields to update');

      const [row] = await sql.begin(async (tx) => {
        if (fields.is_default === true) {
          await tx`
            UPDATE price_lists SET is_default = false
            WHERE org_id = ${orgId} AND is_default = true AND id <> ${id}
          `;
        }
        const cols = Object.keys(fields) as Array<keyof typeof fields>;
        const setObj: Record<string, unknown> = {};
        for (const col of cols) setObj[col] = fields[col];
        return tx`
          UPDATE price_lists SET ${tx(setObj, ...cols)}
          WHERE id = ${id} AND org_id = ${orgId}
          RETURNING *
        `;
      });
      if (!row) throw notFound('Price list not found');
      return row;
    },
  );

  // UPSERT items (bulk)
  app.post(
    '/price-lists/:id/items',
    { preHandler: [rbacGuard('price_list', 'update')] },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = BulkUpsertBody.safeParse(req.body);
      if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
      const orgId = req.user.org_id;

      const [pl] = await sql`
        SELECT id FROM price_lists WHERE id = ${id} AND org_id = ${orgId}
      `;
      if (!pl) throw notFound('Price list not found');

      // Verify all products belong to this org
      const productIds = body.data.items.map((i) => i.product_id);
      const valid = await sql<Array<{ id: string }>>`
        SELECT id FROM products WHERE id IN ${sql(productIds)} AND org_id = ${orgId}
      `;
      if (valid.length !== productIds.length) {
        throw badRequest('One or more products not found in this org');
      }

      await sql.begin(async (tx) => {
        for (const item of body.data.items) {
          await tx`
            INSERT INTO price_list_items (price_list_id, product_id, unit_price, case_price, min_qty)
            VALUES (${id}, ${item.product_id}, ${item.unit_price}, ${item.case_price ?? null}, ${item.min_qty})
            ON CONFLICT (price_list_id, product_id) DO UPDATE SET
              unit_price = EXCLUDED.unit_price,
              case_price = EXCLUDED.case_price,
              min_qty    = EXCLUDED.min_qty
          `;
        }
      });

      return { ok: true, upserted: body.data.items.length };
    },
  );

  // DELETE item
  app.delete(
    '/price-lists/:id/items/:productId',
    { preHandler: [rbacGuard('price_list', 'update')] },
    async (req, reply) => {
      const { id, productId } = req.params as { id: string; productId: string };
      const orgId = req.user.org_id;

      const [pl] = await sql`
        SELECT id FROM price_lists WHERE id = ${id} AND org_id = ${orgId}
      `;
      if (!pl) throw notFound('Price list not found');

      const rows = await sql`
        DELETE FROM price_list_items
        WHERE price_list_id = ${id} AND product_id = ${productId}
        RETURNING product_id
      `;
      if (rows.length === 0) throw notFound('Item not on this price list');
      return reply.status(204).send();
    },
  );

  // RESOLVE price — debug/support endpoint
  app.get(
    '/price-lists/resolve',
    { preHandler: [rbacGuard('price_list', 'read')] },
    async (req) => {
      const parsed = ResolveQuery.safeParse(req.query);
      if (!parsed.success) throw badRequest('Invalid query', parsed.error.flatten());
      const orgId = req.user.org_id;
      const { customer_id, product_id, qty, date } = parsed.data;
      try {
        return await resolvePrice(orgId, customer_id, product_id, qty, date);
      } catch (err) {
        if (err instanceof PriceNotFoundError) throw notFound(err.message);
        throw err;
      }
    },
  );
}
