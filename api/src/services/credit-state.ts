import { sql } from '../db.js';

/**
 * Recompute customer_credit_state from source-of-truth tables.
 * Called after: invoice post, payment record, credit note, promise create/resolve.
 * Uses advisory lock per customer to prevent concurrent refresh races.
 */
export async function refreshCreditState(customerId: string): Promise<void> {
  await sql.begin(async (tx) => {
    // Advisory lock keyed on customer UUID (first 8 hex chars as integer)
    const lockKey = Number.parseInt(customerId.replace(/-/g, '').slice(0, 8), 16);
    await tx`SELECT pg_advisory_xact_lock(${lockKey})`;

    // Outstanding = sum of open/partial/disputed invoice outstanding
    const [balRow] = await tx`
      SELECT COALESCE(SUM(outstanding), 0) AS outstanding_total
      FROM invoices
      WHERE customer_id = ${customerId} AND status IN ('open','partial','disputed')
    `;

    // Aging buckets from v_invoice_aging
    const [agingRow] = await tx`
      SELECT
        COALESCE(SUM(outstanding) FILTER (WHERE bucket = '1_7'),    0) AS overdue_0_7,
        COALESCE(SUM(outstanding) FILTER (WHERE bucket = '8_15'),   0) AS overdue_8_15,
        COALESCE(SUM(outstanding) FILTER (WHERE bucket = '16_30'),  0) AS overdue_16_30,
        COALESCE(SUM(outstanding) FILTER (WHERE bucket = '31_60'),  0) AS overdue_31_60,
        COALESCE(SUM(outstanding) FILTER (WHERE bucket = '60_plus'),0) AS overdue_60_plus
      FROM v_invoice_aging
      WHERE customer_id = ${customerId}
    `;

    // Credit limit
    const [custRow] = await tx`
      SELECT credit_limit FROM customers WHERE id = ${customerId}
    `;

    // Advance balance (payments with unallocated surplus)
    const [advRow] = await tx`
      SELECT COALESCE(
        SUM(p.amount - COALESCE(alloc.total_allocated, 0)), 0
      ) AS advance_balance
      FROM payments p
      LEFT JOIN (
        SELECT payment_id, SUM(amount) AS total_allocated FROM payment_allocations GROUP BY payment_id
      ) alloc ON alloc.payment_id = p.id
      WHERE p.customer_id = ${customerId}
        AND p.verification_status = 'verified'
        AND p.amount > COALESCE(alloc.total_allocated, 0)
    `;

    // Last timestamps
    const [tsRow] = await tx`
      SELECT
        (SELECT MAX(order_date) FROM sales_orders WHERE customer_id = ${customerId} AND status NOT IN ('cancelled','draft'))::timestamptz AS last_order_at,
        (SELECT MAX(collected_at) FROM payments WHERE customer_id = ${customerId} AND verification_status IN ('verified','deposited')) AS last_payment_at,
        (SELECT MAX(started_at) FROM collection_visits WHERE customer_id = ${customerId}) AS last_visit_at,
        (SELECT MAX(delivered_at) FROM deliveries WHERE customer_id = ${customerId} AND status = 'delivered') AS last_delivery_at
    `;

    // Promise state
    const [promRow] = await tx`
      SELECT
        COALESCE(SUM(amount), 0) AS promise_amount,
        MIN(promised_date) AS promise_due_date
      FROM promises
      WHERE customer_id = ${customerId} AND status = 'open'
    `;

    // Broken promises in last 30 days
    const [bpRow] = await tx`
      SELECT count(*)::int AS broken_promises_30d
      FROM promises
      WHERE customer_id = ${customerId}
        AND status = 'broken'
        AND closed_at >= now() - interval '30 days'
    `;

    const outstanding = Number(balRow?.outstanding_total ?? 0);
    const creditLimit = Number(custRow?.credit_limit ?? 0);
    const advance = Number(advRow?.advance_balance ?? 0);
    const available = creditLimit - outstanding + advance;

    const daysLast = tsRow?.last_order_at
      ? Math.floor((Date.now() - new Date(tsRow.last_order_at as string).getTime()) / 86400000)
      : null;

    // Simple heuristic risk score (replaced by ML model in Phase 4)
    const overdue30Plus =
      Number(agingRow?.overdue_31_60 ?? 0) + Number(agingRow?.overdue_60_plus ?? 0);
    const brokenPromises = Number(bpRow?.broken_promises_30d ?? 0);
    let risk = 0;
    if (outstanding > 0) {
      risk = Math.min(1, (overdue30Plus / Math.max(outstanding, 1)) * 0.5 + brokenPromises * 0.15);
    }
    risk = Math.round(risk * 1000) / 1000;

    await tx`
      INSERT INTO customer_credit_state (
        customer_id, outstanding_total, advance_balance,
        overdue_0_7, overdue_8_15, overdue_16_30, overdue_31_60, overdue_60_plus,
        available_credit, risk_score,
        last_order_at, last_payment_at, last_visit_at, last_delivery_at,
        promise_amount, promise_due_date, broken_promises_30d,
        days_since_last_order, refreshed_at
      ) VALUES (
        ${customerId}, ${outstanding}, ${advance},
        ${agingRow?.overdue_0_7 ?? 0}, ${agingRow?.overdue_8_15 ?? 0},
        ${agingRow?.overdue_16_30 ?? 0}, ${agingRow?.overdue_31_60 ?? 0},
        ${agingRow?.overdue_60_plus ?? 0},
        ${available}, ${risk},
        ${tsRow?.last_order_at ?? null}, ${tsRow?.last_payment_at ?? null},
        ${tsRow?.last_visit_at ?? null}, ${tsRow?.last_delivery_at ?? null},
        ${promRow?.promise_amount ?? 0}, ${promRow?.promise_due_date ?? null},
        ${bpRow?.broken_promises_30d ?? 0},
        ${daysLast}, now()
      )
      ON CONFLICT (customer_id) DO UPDATE SET
        outstanding_total = EXCLUDED.outstanding_total,
        advance_balance = EXCLUDED.advance_balance,
        overdue_0_7 = EXCLUDED.overdue_0_7,
        overdue_8_15 = EXCLUDED.overdue_8_15,
        overdue_16_30 = EXCLUDED.overdue_16_30,
        overdue_31_60 = EXCLUDED.overdue_31_60,
        overdue_60_plus = EXCLUDED.overdue_60_plus,
        available_credit = EXCLUDED.available_credit,
        risk_score = EXCLUDED.risk_score,
        last_order_at = EXCLUDED.last_order_at,
        last_payment_at = EXCLUDED.last_payment_at,
        last_visit_at = EXCLUDED.last_visit_at,
        last_delivery_at = EXCLUDED.last_delivery_at,
        promise_amount = EXCLUDED.promise_amount,
        promise_due_date = EXCLUDED.promise_due_date,
        broken_promises_30d = EXCLUDED.broken_promises_30d,
        days_since_last_order = EXCLUDED.days_since_last_order,
        refreshed_at = now()
    `;
  });
}

/**
 * Bulk refresh all customers for an org (nightly safety net).
 */
export async function refreshAllCreditStates(orgId: string): Promise<number> {
  const customers = await sql`
    SELECT id FROM customers WHERE org_id = ${orgId} AND status <> 'blocked'
  `;
  for (const c of customers) {
    await refreshCreditState(c.id);
  }
  return customers.length;
}
