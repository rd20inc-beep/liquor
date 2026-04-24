import type { FastifyInstance } from 'fastify';
import { sql } from '../db.js';
import { rbacGuard } from '../plugins/rbac.js';

export default async function paymentTermRoutes(app: FastifyInstance) {
  app.get(
    '/payment-terms',
    { preHandler: [rbacGuard('customer', 'read')] },
    async (req) => {
      const orgId = req.user.org_id;
      const items = await sql`
        SELECT id, code, type, days, grace_days, requires_pdc
        FROM payment_terms
        WHERE org_id = ${orgId}
        ORDER BY days, code
      `;
      return { items };
    },
  );
}
