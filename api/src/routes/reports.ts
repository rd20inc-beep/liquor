/**
 * Financial reports — read-only, computed live from gl_journal_lines + sub-
 * ledger tables. No materialized views yet; add them later if perf bites.
 *
 * All endpoints are gl:read scoped. Date params are inclusive.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { badRequest } from '../errors.js';
import { rbacGuard } from '../plugins/rbac.js';

const AsOfQuery = z.object({ as_of: z.string().date() });
const RangeQuery = z.object({ from: z.string().date(), to: z.string().date() });

interface AccountRow {
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'cogs' | 'expense';
  normal_side: 'debit' | 'credit';
  balance: string;
}

function n(v: unknown): number {
  return Number(v ?? 0);
}

function fiscalYearStart(asOf: string): string {
  return `${asOf.slice(0, 4)}-01-01`;
}

export default async function reportRoutes(app: FastifyInstance) {
  // Balance sheet — point-in-time snapshot of A / L / E.
  // Equity is augmented with current-year-to-as_of net income (retained
  // earnings flow that hasn't been booked yet because no period has closed).
  app.get(
    '/reports/balance-sheet',
    { preHandler: [rbacGuard('gl', 'read')] },
    async (req) => {
      const parsed = AsOfQuery.safeParse(req.query);
      if (!parsed.success) throw badRequest('Invalid query', parsed.error.flatten());
      const { as_of } = parsed.data;
      const orgId = req.user.org_id;

      const accounts = (await sql`
        SELECT a.code, a.name, a.type, a.normal_side,
          (CASE WHEN a.normal_side = 'debit'
                THEN COALESCE(SUM(l.debit - l.credit), 0)
                ELSE COALESCE(SUM(l.credit - l.debit), 0)
           END)::text AS balance
        FROM gl_accounts a
        LEFT JOIN gl_journal_lines l ON l.account_id = a.id
        LEFT JOIN gl_journals      j ON j.id = l.journal_id
                                    AND j.posted = true
                                    AND j.je_date <= ${as_of}
        WHERE a.org_id = ${orgId}
          AND a.type IN ('asset', 'liability', 'equity')
          AND a.is_postable = true
        GROUP BY a.id, a.code, a.name, a.type, a.normal_side
        HAVING (CASE WHEN a.normal_side = 'debit'
                     THEN COALESCE(SUM(l.debit - l.credit), 0)
                     ELSE COALESCE(SUM(l.credit - l.debit), 0)
                END) <> 0
        ORDER BY a.code
      `) as unknown as AccountRow[];

      // YTD net income (revenue - cogs - expenses) for the fiscal year so far
      const fyStart = fiscalYearStart(as_of);
      const [niRow] = (await sql`
        SELECT
          COALESCE(SUM(CASE WHEN a.type = 'revenue' THEN l.credit - l.debit ELSE 0 END), 0)::text AS revenue,
          COALESCE(SUM(CASE WHEN a.type = 'cogs'    THEN l.debit  - l.credit ELSE 0 END), 0)::text AS cogs,
          COALESCE(SUM(CASE WHEN a.type = 'expense' THEN l.debit  - l.credit ELSE 0 END), 0)::text AS expense
        FROM gl_journal_lines l
        JOIN gl_journals j ON j.id = l.journal_id AND j.posted = true
                          AND j.je_date BETWEEN ${fyStart} AND ${as_of}
        JOIN gl_accounts a ON a.id = l.account_id
        WHERE a.org_id = ${orgId}
          AND a.type IN ('revenue', 'cogs', 'expense')
      `) as unknown as Array<{ revenue: string; cogs: string; expense: string }>;
      const ytdNetIncome = n(niRow?.revenue) - n(niRow?.cogs) - n(niRow?.expense);

      const assets       = accounts.filter((a) => a.type === 'asset');
      const liabilities  = accounts.filter((a) => a.type === 'liability');
      const equity       = accounts.filter((a) => a.type === 'equity');

      const totals = {
        assets:      assets.reduce((s, a) => s + n(a.balance), 0),
        liabilities: liabilities.reduce((s, a) => s + n(a.balance), 0),
        equity:      equity.reduce((s, a) => s + n(a.balance), 0),
        ytd_net_income: ytdNetIncome,
      };
      const totalLE = totals.liabilities + totals.equity + totals.ytd_net_income;
      const balanced = Math.abs(totals.assets - totalLE) < 0.005;

      return {
        as_of,
        fiscal_year_start: fyStart,
        assets,
        liabilities,
        equity,
        totals: {
          assets: totals.assets.toFixed(2),
          liabilities: totals.liabilities.toFixed(2),
          equity: totals.equity.toFixed(2),
          ytd_net_income: ytdNetIncome.toFixed(2),
          equity_with_ni: (totals.equity + ytdNetIncome).toFixed(2),
          liabilities_plus_equity: totalLE.toFixed(2),
          balanced,
          difference: (totals.assets - totalLE).toFixed(2),
        },
      };
    },
  );

  // Profit and loss for [from, to]
  app.get(
    '/reports/profit-loss',
    { preHandler: [rbacGuard('gl', 'read')] },
    async (req) => {
      const parsed = RangeQuery.safeParse(req.query);
      if (!parsed.success) throw badRequest('Invalid query', parsed.error.flatten());
      const { from, to } = parsed.data;
      const orgId = req.user.org_id;

      const rows = (await sql`
        SELECT a.code, a.name, a.type,
          (CASE
             WHEN a.type = 'revenue' THEN COALESCE(SUM(l.credit - l.debit), 0)
             ELSE                         COALESCE(SUM(l.debit  - l.credit), 0)
           END)::text AS amount
        FROM gl_accounts a
        LEFT JOIN gl_journal_lines l ON l.account_id = a.id
        LEFT JOIN gl_journals      j ON j.id = l.journal_id
                                    AND j.posted = true
                                    AND j.je_date BETWEEN ${from} AND ${to}
        WHERE a.org_id = ${orgId}
          AND a.type IN ('revenue', 'cogs', 'expense')
          AND a.is_postable = true
        GROUP BY a.id, a.code, a.name, a.type
        HAVING (CASE
                  WHEN a.type = 'revenue' THEN COALESCE(SUM(l.credit - l.debit), 0)
                  ELSE                         COALESCE(SUM(l.debit  - l.credit), 0)
                END) <> 0
        ORDER BY a.code
      `) as unknown as Array<{ code: string; name: string; type: string; amount: string }>;

      const revenue   = rows.filter((r) => r.type === 'revenue');
      const cogs      = rows.filter((r) => r.type === 'cogs');
      const expenses  = rows.filter((r) => r.type === 'expense');
      const totRevenue = revenue.reduce((s, r) => s + n(r.amount), 0);
      const totCogs    = cogs.reduce((s, r) => s + n(r.amount), 0);
      const totExp     = expenses.reduce((s, r) => s + n(r.amount), 0);
      const grossProfit = totRevenue - totCogs;
      const netIncome   = grossProfit - totExp;

      return {
        from,
        to,
        revenue,
        cogs,
        expenses,
        totals: {
          revenue: totRevenue.toFixed(2),
          cogs: totCogs.toFixed(2),
          gross_profit: grossProfit.toFixed(2),
          gross_margin_pct:
            totRevenue > 0 ? ((grossProfit / totRevenue) * 100).toFixed(2) : '0.00',
          expenses: totExp.toFixed(2),
          net_income: netIncome.toFixed(2),
        },
      };
    },
  );

  // Cash activity per cash/bank account over [from, to]
  app.get(
    '/reports/cash-activity',
    { preHandler: [rbacGuard('gl', 'read')] },
    async (req) => {
      const parsed = RangeQuery.safeParse(req.query);
      if (!parsed.success) throw badRequest('Invalid query', parsed.error.flatten());
      const { from, to } = parsed.data;
      const orgId = req.user.org_id;

      // Cash & bank are accounts whose code starts with '10' or '11' or '12'
      // (cash drawer / bank / mobile wallet) AND are postable leaves.
      const accounts = (await sql`
        SELECT a.id, a.code, a.name,
          (SELECT COALESCE(SUM(l.debit - l.credit), 0)
             FROM gl_journal_lines l
             JOIN gl_journals j ON j.id = l.journal_id AND j.posted = true
                                AND j.je_date < ${from}
             WHERE l.account_id = a.id)::text AS opening,
          (SELECT COALESCE(SUM(l.debit), 0)
             FROM gl_journal_lines l
             JOIN gl_journals j ON j.id = l.journal_id AND j.posted = true
                                AND j.je_date BETWEEN ${from} AND ${to}
             WHERE l.account_id = a.id)::text AS debits,
          (SELECT COALESCE(SUM(l.credit), 0)
             FROM gl_journal_lines l
             JOIN gl_journals j ON j.id = l.journal_id AND j.posted = true
                                AND j.je_date BETWEEN ${from} AND ${to}
             WHERE l.account_id = a.id)::text AS credits
        FROM gl_accounts a
        WHERE a.org_id = ${orgId}
          AND a.is_postable = true
          AND a.type = 'asset'
          AND (a.code LIKE '10%' OR a.code LIKE '11%' OR a.code LIKE '12%')
        ORDER BY a.code
      `) as unknown as Array<{
        id: string;
        code: string;
        name: string;
        opening: string;
        debits: string;
        credits: string;
      }>;

      const items = accounts.map((a) => {
        const opening = n(a.opening);
        const debits = n(a.debits);
        const credits = n(a.credits);
        return {
          code: a.code,
          name: a.name,
          opening: opening.toFixed(2),
          debits: debits.toFixed(2),
          credits: credits.toFixed(2),
          net_change: (debits - credits).toFixed(2),
          closing: (opening + debits - credits).toFixed(2),
        };
      });
      const totals = items.reduce(
        (acc, it) => ({
          opening: acc.opening + n(it.opening),
          debits: acc.debits + n(it.debits),
          credits: acc.credits + n(it.credits),
          closing: acc.closing + n(it.closing),
        }),
        { opening: 0, debits: 0, credits: 0, closing: 0 },
      );
      return {
        from,
        to,
        items,
        totals: {
          opening: totals.opening.toFixed(2),
          debits: totals.debits.toFixed(2),
          credits: totals.credits.toFixed(2),
          net_change: (totals.debits - totals.credits).toFixed(2),
          closing: totals.closing.toFixed(2),
        },
      };
    },
  );

  // AR aging — by customer, bucketed by days overdue at as_of.
  // Buckets: current (not yet due), 1-30, 31-60, 61-90, 90+
  app.get(
    '/reports/ar-aging',
    { preHandler: [rbacGuard('gl', 'read')] },
    async (req) => {
      const parsed = AsOfQuery.safeParse(req.query);
      if (!parsed.success) throw badRequest('Invalid query', parsed.error.flatten());
      const { as_of } = parsed.data;
      const orgId = req.user.org_id;

      const rows = (await sql`
        WITH bucketed AS (
          SELECT
            i.customer_id,
            i.outstanding,
            CASE
              WHEN ${as_of}::date <= i.due_date                        THEN 'current'
              WHEN (${as_of}::date - i.due_date) BETWEEN 1 AND 30      THEN 'b1_30'
              WHEN (${as_of}::date - i.due_date) BETWEEN 31 AND 60     THEN 'b31_60'
              WHEN (${as_of}::date - i.due_date) BETWEEN 61 AND 90     THEN 'b61_90'
              ELSE 'b90_plus'
            END AS bucket
          FROM invoices i
          WHERE i.org_id = ${orgId}
            AND i.invoice_date <= ${as_of}
            AND i.status NOT IN ('paid', 'void')
            AND i.outstanding > 0
        )
        SELECT
          c.id          AS customer_id,
          c.code        AS customer_code,
          c.name        AS customer_name,
          COALESCE(SUM(b.outstanding) FILTER (WHERE b.bucket = 'current'), 0)::text AS current,
          COALESCE(SUM(b.outstanding) FILTER (WHERE b.bucket = 'b1_30'),   0)::text AS b1_30,
          COALESCE(SUM(b.outstanding) FILTER (WHERE b.bucket = 'b31_60'),  0)::text AS b31_60,
          COALESCE(SUM(b.outstanding) FILTER (WHERE b.bucket = 'b61_90'),  0)::text AS b61_90,
          COALESCE(SUM(b.outstanding) FILTER (WHERE b.bucket = 'b90_plus'),0)::text AS b90_plus,
          COALESCE(SUM(b.outstanding), 0)::text AS total
        FROM bucketed b
        JOIN customers c ON c.id = b.customer_id
        GROUP BY c.id, c.code, c.name
        HAVING COALESCE(SUM(b.outstanding), 0) > 0
        ORDER BY COALESCE(SUM(b.outstanding), 0) DESC
      `) as unknown as Array<{
        customer_id: string;
        customer_code: string;
        customer_name: string;
        current: string;
        b1_30: string;
        b31_60: string;
        b61_90: string;
        b90_plus: string;
        total: string;
      }>;

      const totals = rows.reduce(
        (acc, r) => ({
          current: acc.current + n(r.current),
          b1_30: acc.b1_30 + n(r.b1_30),
          b31_60: acc.b31_60 + n(r.b31_60),
          b61_90: acc.b61_90 + n(r.b61_90),
          b90_plus: acc.b90_plus + n(r.b90_plus),
          total: acc.total + n(r.total),
        }),
        { current: 0, b1_30: 0, b31_60: 0, b61_90: 0, b90_plus: 0, total: 0 },
      );
      return {
        as_of,
        customers: rows,
        totals: {
          current: totals.current.toFixed(2),
          b1_30: totals.b1_30.toFixed(2),
          b31_60: totals.b31_60.toFixed(2),
          b61_90: totals.b61_90.toFixed(2),
          b90_plus: totals.b90_plus.toFixed(2),
          total: totals.total.toFixed(2),
        },
      };
    },
  );

  // AP aging — same shape but bills/vendors
  app.get(
    '/reports/ap-aging',
    { preHandler: [rbacGuard('gl', 'read')] },
    async (req) => {
      const parsed = AsOfQuery.safeParse(req.query);
      if (!parsed.success) throw badRequest('Invalid query', parsed.error.flatten());
      const { as_of } = parsed.data;
      const orgId = req.user.org_id;

      const rows = (await sql`
        WITH bucketed AS (
          SELECT
            b.vendor_id,
            b.outstanding,
            CASE
              WHEN ${as_of}::date <= b.due_date                        THEN 'current'
              WHEN (${as_of}::date - b.due_date) BETWEEN 1 AND 30      THEN 'b1_30'
              WHEN (${as_of}::date - b.due_date) BETWEEN 31 AND 60     THEN 'b31_60'
              WHEN (${as_of}::date - b.due_date) BETWEEN 61 AND 90     THEN 'b61_90'
              ELSE 'b90_plus'
            END AS bucket
          FROM bills b
          WHERE b.org_id = ${orgId}
            AND b.bill_date <= ${as_of}
            AND b.status NOT IN ('paid', 'cancelled')
            AND b.outstanding > 0
        )
        SELECT
          v.id          AS vendor_id,
          v.code        AS vendor_code,
          v.name        AS vendor_name,
          COALESCE(SUM(b.outstanding) FILTER (WHERE b.bucket = 'current'), 0)::text AS current,
          COALESCE(SUM(b.outstanding) FILTER (WHERE b.bucket = 'b1_30'),   0)::text AS b1_30,
          COALESCE(SUM(b.outstanding) FILTER (WHERE b.bucket = 'b31_60'),  0)::text AS b31_60,
          COALESCE(SUM(b.outstanding) FILTER (WHERE b.bucket = 'b61_90'),  0)::text AS b61_90,
          COALESCE(SUM(b.outstanding) FILTER (WHERE b.bucket = 'b90_plus'),0)::text AS b90_plus,
          COALESCE(SUM(b.outstanding), 0)::text AS total
        FROM bucketed b
        JOIN vendors v ON v.id = b.vendor_id
        GROUP BY v.id, v.code, v.name
        HAVING COALESCE(SUM(b.outstanding), 0) > 0
        ORDER BY COALESCE(SUM(b.outstanding), 0) DESC
      `) as unknown as Array<{
        vendor_id: string;
        vendor_code: string;
        vendor_name: string;
        current: string;
        b1_30: string;
        b31_60: string;
        b61_90: string;
        b90_plus: string;
        total: string;
      }>;

      const totals = rows.reduce(
        (acc, r) => ({
          current: acc.current + n(r.current),
          b1_30: acc.b1_30 + n(r.b1_30),
          b31_60: acc.b31_60 + n(r.b31_60),
          b61_90: acc.b61_90 + n(r.b61_90),
          b90_plus: acc.b90_plus + n(r.b90_plus),
          total: acc.total + n(r.total),
        }),
        { current: 0, b1_30: 0, b31_60: 0, b61_90: 0, b90_plus: 0, total: 0 },
      );
      return {
        as_of,
        vendors: rows,
        totals: {
          current: totals.current.toFixed(2),
          b1_30: totals.b1_30.toFixed(2),
          b31_60: totals.b31_60.toFixed(2),
          b61_90: totals.b61_90.toFixed(2),
          b90_plus: totals.b90_plus.toFixed(2),
          total: totals.total.toFixed(2),
        },
      };
    },
  );

  // Reconciliation: sub-ledger totals vs GL control account balances
  app.get(
    '/reports/reconciliation',
    { preHandler: [rbacGuard('gl', 'read')] },
    async (req) => {
      const parsed = AsOfQuery.safeParse(req.query);
      if (!parsed.success) throw badRequest('Invalid query', parsed.error.flatten());
      const { as_of } = parsed.data;
      const orgId = req.user.org_id;

      // Helper: GL balance for an account code at as_of (DR-positive)
      const glBalance = async (code: string, drPositive: boolean): Promise<number> => {
        const [r] = (await sql`
          SELECT COALESCE(SUM(${
            drPositive ? sql`l.debit - l.credit` : sql`l.credit - l.debit`
          }), 0)::text AS balance
          FROM gl_journal_lines l
          JOIN gl_journals j ON j.id = l.journal_id AND j.posted = true
                            AND j.je_date <= ${as_of}
          JOIN gl_accounts a ON a.id = l.account_id
          WHERE a.org_id = ${orgId} AND a.code = ${code}
        `) as unknown as Array<{ balance: string }>;
        return n(r?.balance);
      };

      // AR
      const arGl = await glBalance('1300', true);
      const [arSub] = (await sql`
        SELECT COALESCE(SUM(outstanding), 0)::text AS sub
        FROM invoices
        WHERE org_id = ${orgId}
          AND invoice_date <= ${as_of}
          AND status NOT IN ('void')
      `) as unknown as Array<{ sub: string }>;

      // AP
      const apGl = await glBalance('2100', false);
      const [apSub] = (await sql`
        SELECT COALESCE(SUM(outstanding), 0)::text AS sub
        FROM bills
        WHERE org_id = ${orgId}
          AND bill_date <= ${as_of}
          AND status NOT IN ('cancelled')
      `) as unknown as Array<{ sub: string }>;

      // Inventory
      const invGl = await glBalance('1400', true);
      const [invSub] = (await sql`
        SELECT COALESCE(SUM(qty_physical * cost_price), 0)::text AS sub
        FROM stock_batches
        WHERE org_id = ${orgId}
      `) as unknown as Array<{ sub: string }>;

      const mk = (label: string, gl: number, sub: number) => ({
        label,
        gl_balance: gl.toFixed(2),
        subledger_total: sub.toFixed(2),
        difference: (gl - sub).toFixed(2),
        reconciled: Math.abs(gl - sub) < 0.01,
      });

      return {
        as_of,
        items: [
          mk('Accounts Receivable (1300)', arGl, n(arSub?.sub)),
          mk('Accounts Payable (2100)',    apGl, n(apSub?.sub)),
          mk('Inventory (1400)',           invGl, n(invSub?.sub)),
        ],
      };
    },
  );
}
