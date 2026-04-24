import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { badRequest, forbidden } from '../errors.js';
import { rbacGuard } from '../plugins/rbac.js';
import { refreshAllCreditStates } from '../services/credit-state.js';
import {
  autoHoldBrokenPromises,
  buildPriorityList,
  markBrokenPromises,
  releaseExpiredHolds,
  runNightlyJobs,
} from '../services/jobs.js';

const JOB_RUNNERS: Record<string, (orgId: string) => Promise<unknown>> = {
  release_expired_holds: releaseExpiredHolds,
  mark_broken_promises: markBrokenPromises,
  refresh_credit_states: refreshAllCreditStates,
  auto_hold_broken_promises: autoHoldBrokenPromises,
  build_priority_list: (orgId: string) => buildPriorityList(orgId),
  nightly: runNightlyJobs,
};

export default async function adminRoutes(app: FastifyInstance) {
  // Trigger a job on demand — admin or owner only.
  app.post(
    '/admin/jobs/:name/run',
    { preHandler: [rbacGuard('admin', 'job_run')] },
    async (req) => {
      const { name } = req.params as { name: string };
      if (req.user.role !== 'admin' && req.user.role !== 'owner') {
        throw forbidden('Only admin or owner can trigger jobs');
      }
      const runner = JOB_RUNNERS[name];
      if (!runner) throw badRequest(`Unknown job: ${name}`);
      const started = Date.now();
      const result = await runner(req.user.org_id);
      return { job: name, duration_ms: Date.now() - started, result };
    },
  );

  // List available jobs for convenience
  app.get('/admin/jobs', { preHandler: [rbacGuard('admin', 'job_read')] }, async () => ({
    jobs: Object.keys(JOB_RUNNERS),
  }));

  // Collector priority list for today (read)
  app.get('/priority-list', { preHandler: [rbacGuard('priority', 'read')] }, async (req) => {
    const q = z
      .object({
        day: z.string().date().optional(),
        collector_id: z.string().uuid().optional(),
      })
      .safeParse(req.query);
    if (!q.success) throw badRequest('Invalid query', q.error.flatten());

    const { day, collector_id } = q.data;
    const orgId = req.user.org_id;

    // Collectors only see their own list
    const scopedCollector = req.user.role === 'collector' ? req.user.sub : collector_id;

    const conds = [
      sql`pl.org_id = ${orgId}`,
      sql`pl.day = ${day ?? new Date().toISOString().slice(0, 10)}::date`,
    ];
    if (scopedCollector) conds.push(sql`pl.collector_id = ${scopedCollector}`);
    const where = conds.reduce((a, b) => sql`${a} AND ${b}`);

    const rows = await sql`
        SELECT
          pl.sequence, pl.customer_id, c.code AS customer_code, c.name AS customer_name,
          pl.score, pl.reason, pl.outstanding, pl.promise_amount, pl.visited
        FROM collector_priority_list pl
        JOIN customers c ON c.id = pl.customer_id
        WHERE ${where}
        ORDER BY pl.sequence
      `;
    return { items: rows };
  });
}
