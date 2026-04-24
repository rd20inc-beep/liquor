import { sql } from '../db.js';
import { logger } from '../logger.js';
import { audit } from './audit.js';
import { refreshAllCreditStates } from './credit-state.js';

/**
 * Auto-release customers whose hold_until has passed. status: hold → active.
 * Returns the count of customers released. (LDS-033)
 */
export async function releaseExpiredHolds(orgId: string): Promise<number> {
  const released = await sql<Array<{ id: string }>>`
    UPDATE customers
    SET status = 'active', hold_reason = NULL, hold_until = NULL
    WHERE org_id = ${orgId}
      AND status = 'hold'
      AND hold_until IS NOT NULL
      AND hold_until < current_date
    RETURNING id
  `;
  for (const r of released) {
    await audit({
      orgId,
      userId: null,
      action: 'update',
      entity: 'customer',
      entityId: r.id,
      after: { status: 'active', reason: 'hold_until_expired', by: 'system' },
    });
  }
  return released.length;
}

/**
 * Auto-hold customers with >= broken_promise_limit broken promises in window.
 * Only applies if org_config.auto_hold_on_broken is true.
 */
export async function autoHoldBrokenPromises(orgId: string): Promise<number> {
  const [cfg] = await sql<
    Array<{
      broken_promise_limit: number;
      broken_promise_window_days: number;
      auto_hold_on_broken: boolean;
    }>
  >`
    SELECT broken_promise_limit, broken_promise_window_days, auto_hold_on_broken
    FROM org_config WHERE org_id = ${orgId}
  `;
  if (!cfg || !cfg.auto_hold_on_broken) return 0;

  const candidates = await sql<Array<{ customer_id: string; broken_count: number }>>`
    SELECT customer_id, count(*)::int AS broken_count
    FROM promises p
    JOIN customers c ON c.id = p.customer_id AND c.org_id = ${orgId}
    WHERE p.status = 'broken'
      AND p.closed_at >= now() - make_interval(days => ${cfg.broken_promise_window_days})
      AND c.status = 'active'
    GROUP BY customer_id
    HAVING count(*) >= ${cfg.broken_promise_limit}
  `;

  let held = 0;
  for (const c of candidates) {
    const result = await sql`
      UPDATE customers
      SET status = 'hold',
          hold_reason = ${`auto: ${c.broken_count} broken promises in ${cfg.broken_promise_window_days}d`}
      WHERE id = ${c.customer_id} AND status = 'active'
      RETURNING id
    `;
    if (result.length > 0) {
      await audit({
        orgId,
        userId: null,
        action: 'update',
        entity: 'customer',
        entityId: c.customer_id,
        after: { status: 'hold', reason: 'auto_broken_promises', count: c.broken_count },
      });
      held += 1;
    }
  }
  return held;
}

/**
 * Build today's collector priority list (PRD §W3). Score combines overdue
 * amount, age, and customer value. Replaces existing rows for `today`.
 */
export async function buildPriorityList(
  orgId: string,
  day: string = new Date().toISOString().slice(0, 10),
): Promise<number> {
  // Clear today's list
  await sql`
    DELETE FROM collector_priority_list
    WHERE org_id = ${orgId} AND day = ${day}::date
  `;

  const rows = await sql<
    Array<{
      collector_id: string;
      customer_id: string;
      score: number;
      reason: string;
      outstanding: string;
      promise_amount: string | null;
    }>
  >`
    WITH ranked AS (
      SELECT
        c.assigned_collector_id AS collector_id,
        c.id AS customer_id,
        COALESCE(cs.outstanding_total, 0) AS outstanding,
        cs.promise_amount,
        -- Age weight: stronger for older buckets
        (COALESCE(cs.overdue_0_7,0)    * 1.0 +
         COALESCE(cs.overdue_8_15,0)   * 1.5 +
         COALESCE(cs.overdue_16_30,0)  * 2.0 +
         COALESCE(cs.overdue_31_60,0)  * 3.0 +
         COALESCE(cs.overdue_60_plus,0)* 4.0)
         * (CASE WHEN c.high_value THEN 1.5 ELSE 1.0 END) AS score,
        CASE
          WHEN cs.promise_due_date = current_date              THEN 'promise_due_today'
          WHEN COALESCE(cs.overdue_31_60,0) + COALESCE(cs.overdue_60_plus,0) > 0 THEN 'overdue_30plus'
          WHEN c.high_value                                    THEN 'high_value'
          ELSE 'route_order'
        END AS reason
      FROM customers c
      JOIN customer_credit_state cs ON cs.customer_id = c.id
      WHERE c.org_id = ${orgId}
        AND c.status = 'active'
        AND c.assigned_collector_id IS NOT NULL
        AND (COALESCE(cs.outstanding_total, 0) > 0 OR cs.promise_due_date = current_date)
    )
    SELECT collector_id, customer_id, score, reason, outstanding, promise_amount
    FROM ranked
    ORDER BY collector_id, score DESC
  `;

  // Assign sequence per collector
  const seqByCollector = new Map<string, number>();
  let inserted = 0;
  for (const r of rows) {
    const next = (seqByCollector.get(r.collector_id) ?? 0) + 1;
    seqByCollector.set(r.collector_id, next);
    await sql`
      INSERT INTO collector_priority_list (
        org_id, collector_id, day, customer_id, sequence,
        score, reason, outstanding, promise_amount
      ) VALUES (
        ${orgId}, ${r.collector_id}, ${day}::date, ${r.customer_id}, ${next},
        ${r.score}, ${r.reason}, ${r.outstanding}, ${r.promise_amount ?? null}
      )
      ON CONFLICT (collector_id, day, customer_id) DO NOTHING
    `;
    inserted += 1;
  }
  return inserted;
}

/** Mark promises broken once promised_date has passed and nothing was collected. */
export async function markBrokenPromises(orgId: string): Promise<number> {
  const rows = await sql<Array<{ id: string }>>`
    UPDATE promises p
    SET status = 'broken', closed_at = now()
    FROM customers c
    WHERE p.customer_id = c.id AND c.org_id = ${orgId}
      AND p.status = 'open'
      AND p.promised_date < current_date
    RETURNING p.id
  `;
  return rows.length;
}

/**
 * Run all nightly jobs for a single org. Order matters: release expired holds
 * and mark broken promises before rebuilding state + priority list.
 */
export async function runNightlyJobs(orgId: string): Promise<Record<string, number>> {
  const log = logger.child({ module: 'jobs', orgId });
  log.info('nightly jobs starting');

  const released = await releaseExpiredHolds(orgId);
  const broken = await markBrokenPromises(orgId);
  const refreshed = await refreshAllCreditStates(orgId);
  const held = await autoHoldBrokenPromises(orgId);
  const priorityRows = await buildPriorityList(orgId);

  const out = { released, broken, refreshed, held, priority_rows: priorityRows };
  log.info({ ...out }, 'nightly jobs complete');
  return out;
}

/** Run nightly jobs for every org in the system. */
export async function runNightlyJobsAllOrgs(): Promise<Record<string, number>> {
  const orgs = await sql<Array<{ id: string }>>`SELECT id FROM orgs`;
  const totals: Record<string, number> = {
    released: 0,
    broken: 0,
    refreshed: 0,
    held: 0,
    priority_rows: 0,
  };
  for (const org of orgs) {
    const r = await runNightlyJobs(org.id);
    for (const [k, v] of Object.entries(r)) totals[k] = (totals[k] ?? 0) + v;
  }
  return totals;
}
