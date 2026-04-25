import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { z } from 'zod';
import { sql } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { rbacGuard } from '../plugins/rbac.js';
import { audit } from '../services/audit.js';
import { journalNo } from '../services/doc-numbers.js';

// ---------- Schemas ----------

const JournalLine = z
  .object({
    account_code: z.string().min(1).max(20),
    debit: z.number().nonnegative().default(0),
    credit: z.number().nonnegative().default(0),
    memo: z.string().max(500).optional(),
    customer_id: z.string().uuid().optional(),
    product_id: z.string().uuid().optional(),
    batch_id: z.string().uuid().optional(),
  })
  .refine((l) => (l.debit > 0 ? l.credit === 0 : l.credit > 0), {
    message: 'Each line must have exactly one of debit or credit > 0',
  });

const PostJournalBody = z.object({
  je_date: z.string().date(),
  memo: z.string().max(500).optional(),
  lines: z.array(JournalLine).min(2),
});

const ListJournalsQuery = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  source_type: z.string().optional(),
  account_code: z.string().optional(),
  posted: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const TrialBalanceQuery = z.object({
  from: z.string().date(),
  to: z.string().date(),
});

const LedgerQuery = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const ClosePeriodBody = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
});

// ---------- Helpers ----------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function assertPeriodOpen(tx: Sql, orgId: string, isoDate: string): Promise<void> {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const [period] = await tx<Array<{ status: string }>>`
    SELECT status FROM gl_periods
    WHERE org_id = ${orgId} AND year = ${year} AND month = ${month}
  `;
  if (!period) {
    // Auto-open the period if it doesn't exist (cutover convenience)
    await tx`
      INSERT INTO gl_periods (org_id, year, month, status)
      VALUES (${orgId}, ${year}, ${month}, 'open')
      ON CONFLICT (org_id, year, month) DO NOTHING
    `;
    return;
  }
  if (period.status !== 'open') {
    throw conflict(`Period ${year}-${String(month).padStart(2, '0')} is closed`);
  }
}

// ---------- Routes ----------

export default async function glRoutes(app: FastifyInstance) {
  // List COA — flat with parent_code resolved client-side
  app.get('/gl/accounts', { preHandler: [rbacGuard('gl', 'read')] }, async (req) => {
    const orgId = req.user.org_id;
    const items = await sql`
      SELECT a.id, a.code, a.name, a.type, a.normal_side,
             a.is_postable, a.is_control, a.active,
             p.code AS parent_code
      FROM gl_accounts a
      LEFT JOIN gl_accounts p ON p.id = a.parent_id
      WHERE a.org_id = ${orgId}
      ORDER BY a.code
    `;
    return { items };
  });

  // GET single account
  app.get('/gl/accounts/:id', { preHandler: [rbacGuard('gl', 'read')] }, async (req) => {
    const { id } = req.params as { id: string };
    const orgId = req.user.org_id;
    const [row] = await sql`
      SELECT a.*, p.code AS parent_code, p.name AS parent_name
      FROM gl_accounts a
      LEFT JOIN gl_accounts p ON p.id = a.parent_id
      WHERE a.id = ${id} AND a.org_id = ${orgId}
    `;
    if (!row) throw notFound('Account not found');
    return row;
  });

  // GL detail (ledger) for an account
  app.get(
    '/gl/accounts/:id/ledger',
    { preHandler: [rbacGuard('gl', 'read')] },
    async (req) => {
      const { id } = req.params as { id: string };
      const orgId = req.user.org_id;
      const parsed = LedgerQuery.safeParse(req.query);
      if (!parsed.success) throw badRequest('Invalid query', parsed.error.flatten());
      const { from, to, limit } = parsed.data;

      const [acct] = await sql<Array<{ id: string; normal_side: string }>>`
        SELECT id, normal_side FROM gl_accounts
        WHERE id = ${id} AND org_id = ${orgId}
      `;
      if (!acct) throw notFound('Account not found');

      const items = await sql`
        SELECT l.id, l.debit::text AS debit, l.credit::text AS credit, l.memo,
               l.customer_id, l.product_id, l.batch_id,
               j.id AS journal_id, j.journal_no, j.je_date, j.source_type, j.source_id, j.posted
        FROM gl_journal_lines l
        JOIN gl_journals j ON j.id = l.journal_id
        WHERE l.account_id = ${id}
          AND j.org_id = ${orgId}
          AND j.posted = true
          ${from ? sql`AND j.je_date >= ${from}` : sql``}
          ${to ? sql`AND j.je_date <= ${to}` : sql``}
        ORDER BY j.je_date DESC, j.journal_no DESC
        LIMIT ${limit}
      `;

      // Opening balance = sum of all activity strictly before `from`
      const [opening] = from
        ? await sql<Array<{ balance: string }>>`
            SELECT
              CASE WHEN ${acct.normal_side} = 'debit'
                   THEN COALESCE(SUM(l.debit - l.credit), 0)
                   ELSE COALESCE(SUM(l.credit - l.debit), 0)
              END::text AS balance
            FROM gl_journal_lines l
            JOIN gl_journals j ON j.id = l.journal_id
            WHERE l.account_id = ${id}
              AND j.org_id = ${orgId}
              AND j.posted = true
              AND j.je_date < ${from}
          `
        : [{ balance: '0' }];

      return { items, opening_balance: opening?.balance ?? '0' };
    },
  );

  // List journals
  app.get('/gl/journals', { preHandler: [rbacGuard('gl', 'read')] }, async (req) => {
    const orgId = req.user.org_id;
    const parsed = ListJournalsQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest('Invalid query', parsed.error.flatten());
    const { from, to, source_type, account_code, posted, limit } = parsed.data;

    const items = await sql`
      SELECT j.id, j.journal_no, j.je_date, j.source_type, j.source_id, j.memo,
             j.posted, j.posted_at, j.posted_by,
             u.name AS posted_by_name,
             (SELECT COALESCE(SUM(debit), 0)::text FROM gl_journal_lines WHERE journal_id = j.id) AS total_debit
      FROM gl_journals j
      LEFT JOIN users u ON u.id = j.posted_by
      WHERE j.org_id = ${orgId}
        ${from ? sql`AND j.je_date >= ${from}` : sql``}
        ${to ? sql`AND j.je_date <= ${to}` : sql``}
        ${source_type ? sql`AND j.source_type = ${source_type}` : sql``}
        ${posted !== undefined ? sql`AND j.posted = ${posted}` : sql``}
        ${
          account_code
            ? sql`AND EXISTS (
                SELECT 1 FROM gl_journal_lines l
                JOIN gl_accounts a ON a.id = l.account_id
                WHERE l.journal_id = j.id AND a.code = ${account_code}
              )`
            : sql``
        }
      ORDER BY j.je_date DESC, j.journal_no DESC
      LIMIT ${limit}
    `;
    return { items };
  });

  // GET single journal with lines
  app.get('/gl/journals/:id', { preHandler: [rbacGuard('gl', 'read')] }, async (req) => {
    const { id } = req.params as { id: string };
    const orgId = req.user.org_id;
    const [head] = await sql`
      SELECT j.*, u.name AS posted_by_name, c.name AS created_by_name
      FROM gl_journals j
      LEFT JOIN users u ON u.id = j.posted_by
      LEFT JOIN users c ON c.id = j.created_by
      WHERE j.id = ${id} AND j.org_id = ${orgId}
    `;
    if (!head) throw notFound('Journal not found');
    const lines = await sql`
      SELECT l.id, l.line_no, l.debit::text AS debit, l.credit::text AS credit, l.memo,
             l.customer_id, l.product_id, l.batch_id,
             a.id AS account_id, a.code AS account_code, a.name AS account_name,
             cu.name AS customer_name, p.name AS product_name
      FROM gl_journal_lines l
      JOIN gl_accounts a ON a.id = l.account_id
      LEFT JOIN customers cu ON cu.id = l.customer_id
      LEFT JOIN products  p  ON p.id  = l.product_id
      WHERE l.journal_id = ${id}
      ORDER BY l.line_no
    `;
    return { ...head, lines };
  });

  // POST manual journal entry
  app.post('/gl/journals', { preHandler: [rbacGuard('gl', 'post')] }, async (req, reply) => {
    const orgId = req.user.org_id;
    const userId = req.user.sub;
    const parsed = PostJournalBody.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid request body', parsed.error.flatten());
    const d = parsed.data;

    // Balance check
    const totalDebit = round2(d.lines.reduce((s, l) => s + l.debit, 0));
    const totalCredit = round2(d.lines.reduce((s, l) => s + l.credit, 0));
    if (totalDebit === 0) throw badRequest('Journal must have at least one debit line');
    if (totalDebit !== totalCredit) {
      throw badRequest(
        `Journal does not balance: debit=${totalDebit} credit=${totalCredit}`,
      );
    }

    const result = await sql.begin(async (tx) => {
      await assertPeriodOpen(tx, orgId, d.je_date);

      // Resolve account codes → ids; reject control/non-postable
      const codes = [...new Set(d.lines.map((l) => l.account_code))];
      const accts = await tx<
        Array<{ id: string; code: string; is_postable: boolean; is_control: boolean }>
      >`
        SELECT id, code, is_postable, is_control
        FROM gl_accounts
        WHERE org_id = ${orgId} AND code = ANY(${codes}) AND active = true
      `;
      const byCode = new Map(accts.map((a) => [a.code, a]));
      for (const code of codes) {
        const a = byCode.get(code);
        if (!a) throw badRequest(`Unknown account code: ${code}`);
        if (!a.is_postable) throw badRequest(`Account ${code} is a header — not postable`);
        if (a.is_control)
          throw badRequest(
            `Account ${code} is a control account — manual JEs not allowed; use the originating event`,
          );
      }

      const journal_no = await journalNo(tx, orgId);
      const [head] = await tx<Array<{ id: string; journal_no: string }>>`
        INSERT INTO gl_journals (
          org_id, journal_no, je_date, source_type, memo,
          posted, created_by
        ) VALUES (
          ${orgId}, ${journal_no}, ${d.je_date}, 'manual', ${d.memo ?? null},
          false, ${userId}
        )
        RETURNING id, journal_no
      `;

      for (let i = 0; i < d.lines.length; i++) {
        const l = d.lines[i]!;
        await tx`
          INSERT INTO gl_journal_lines (
            journal_id, org_id, account_id, debit, credit, memo,
            customer_id, product_id, batch_id, line_no
          ) VALUES (
            ${head!.id}, ${orgId}, ${byCode.get(l.account_code)!.id},
            ${round2(l.debit)}, ${round2(l.credit)}, ${l.memo ?? null},
            ${l.customer_id ?? null}, ${l.product_id ?? null}, ${l.batch_id ?? null},
            ${i + 1}
          )
        `;
      }

      await tx`
        UPDATE gl_journals
        SET posted = true, posted_at = now(), posted_by = ${userId}
        WHERE id = ${head!.id}
      `;

      await audit(
        {
          orgId,
          userId,
          action: 'create',
          entity: 'gl_journal',
          entityId: head!.id,
          before: null,
          after: { journal_no: head!.journal_no, je_date: d.je_date, total: totalDebit, lines: d.lines.length },
        },
        tx,
      );

      return head!;
    });

    return reply.status(201).send(result);
  });

  // Reverse a posted journal — creates a mirror JE on a chosen date.
  app.post(
    '/gl/journals/:id/reverse',
    { preHandler: [rbacGuard('gl', 'post')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const orgId = req.user.org_id;
      const userId = req.user.sub;
      const body = z
        .object({ je_date: z.string().date(), memo: z.string().optional() })
        .safeParse(req.body);
      if (!body.success) throw badRequest('Invalid request body', body.error.flatten());

      const result = await sql.begin(async (tx) => {
        const [orig] = await tx<
          Array<{ id: string; journal_no: string; posted: boolean; reversed_by: string | null }>
        >`
          SELECT id, journal_no, posted, reversed_by
          FROM gl_journals WHERE id = ${id} AND org_id = ${orgId}
          FOR UPDATE
        `;
        if (!orig) throw notFound('Journal not found');
        if (!orig.posted) throw conflict('Cannot reverse an unposted journal');
        if (orig.reversed_by) throw conflict('Journal already reversed');

        await assertPeriodOpen(tx, orgId, body.data.je_date);

        const lines = await tx<
          Array<{
            account_id: string;
            debit: string;
            credit: string;
            memo: string | null;
            customer_id: string | null;
            product_id: string | null;
            batch_id: string | null;
          }>
        >`
          SELECT account_id, debit, credit, memo, customer_id, product_id, batch_id
          FROM gl_journal_lines WHERE journal_id = ${id}
          ORDER BY line_no
        `;

        const journal_no = await journalNo(tx, orgId);
        const [head] = await tx<Array<{ id: string; journal_no: string }>>`
          INSERT INTO gl_journals (
            org_id, journal_no, je_date, source_type, memo,
            posted, created_by, reversal_of
          ) VALUES (
            ${orgId}, ${journal_no}, ${body.data.je_date}, 'reversal',
            ${body.data.memo ?? `Reversal of ${orig.journal_no}`},
            false, ${userId}, ${id}
          )
          RETURNING id, journal_no
        `;

        for (let i = 0; i < lines.length; i++) {
          const l = lines[i]!;
          await tx`
            INSERT INTO gl_journal_lines (
              journal_id, org_id, account_id, debit, credit, memo,
              customer_id, product_id, batch_id, line_no
            ) VALUES (
              ${head!.id}, ${orgId}, ${l.account_id},
              ${l.credit}, ${l.debit}, ${l.memo ?? null},
              ${l.customer_id ?? null}, ${l.product_id ?? null}, ${l.batch_id ?? null},
              ${i + 1}
            )
          `;
        }

        await tx`
          UPDATE gl_journals
          SET posted = true, posted_at = now(), posted_by = ${userId}
          WHERE id = ${head!.id}
        `;
        await tx`
          UPDATE gl_journals SET reversed_by = ${head!.id}
          WHERE id = ${id}
        `;

        await audit(
          {
            orgId,
            userId,
            action: 'create',
            entity: 'gl_journal',
            entityId: head!.id,
            before: null,
            after: { reversal_of: orig.journal_no, journal_no: head!.journal_no },
          },
          tx,
        );

        return head!;
      });

      return reply.status(201).send(result);
    },
  );

  // Trial balance for a date range
  app.get('/gl/trial-balance', { preHandler: [rbacGuard('gl', 'read')] }, async (req) => {
    const orgId = req.user.org_id;
    const parsed = TrialBalanceQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest('Invalid query', parsed.error.flatten());
    const { from, to } = parsed.data;

    const rows = await sql`
      SELECT
        a.id, a.code, a.name, a.type, a.normal_side,
        COALESCE(SUM(l.debit), 0)::text  AS period_debit,
        COALESCE(SUM(l.credit), 0)::text AS period_credit,
        CASE WHEN a.normal_side = 'debit'
             THEN COALESCE(SUM(l.debit - l.credit), 0)
             ELSE COALESCE(SUM(l.credit - l.debit), 0)
        END::text AS balance
      FROM gl_accounts a
      LEFT JOIN gl_journal_lines l ON l.account_id = a.id
      LEFT JOIN gl_journals      j ON j.id = l.journal_id
                                  AND j.posted = true
                                  AND j.je_date >= ${from}
                                  AND j.je_date <= ${to}
      WHERE a.org_id = ${orgId} AND a.is_postable = true
      GROUP BY a.id, a.code, a.name, a.type, a.normal_side
      HAVING COALESCE(SUM(l.debit), 0) <> 0 OR COALESCE(SUM(l.credit), 0) <> 0
      ORDER BY a.code
    `;
    let total_debit = 0;
    let total_credit = 0;
    for (const r of rows as unknown as Array<{ period_debit: string; period_credit: string }>) {
      total_debit += Number(r.period_debit);
      total_credit += Number(r.period_credit);
    }
    return {
      from,
      to,
      items: rows,
      total_debit: round2(total_debit).toString(),
      total_credit: round2(total_credit).toString(),
    };
  });

  // List periods
  app.get('/gl/periods', { preHandler: [rbacGuard('gl', 'read')] }, async (req) => {
    const orgId = req.user.org_id;
    const items = await sql`
      SELECT p.id, p.year, p.month, p.status, p.closed_at,
             u.name AS closed_by_name
      FROM gl_periods p
      LEFT JOIN users u ON u.id = p.closed_by
      WHERE p.org_id = ${orgId}
      ORDER BY p.year DESC, p.month DESC
    `;
    return { items };
  });

  // Close a period — admin/owner only
  app.post('/gl/periods/close', { preHandler: [rbacGuard('gl', 'close')] }, async (req) => {
    if (req.user.role !== 'admin' && req.user.role !== 'owner') {
      throw forbidden('Only admin or owner can close periods');
    }
    const orgId = req.user.org_id;
    const userId = req.user.sub;
    const parsed = ClosePeriodBody.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid request body', parsed.error.flatten());
    const { year, month } = parsed.data;

    const result = await sql.begin(async (tx) => {
      const [updated] = await tx`
        UPDATE gl_periods
        SET status = 'closed', closed_at = now(), closed_by = ${userId}
        WHERE org_id = ${orgId} AND year = ${year} AND month = ${month} AND status = 'open'
        RETURNING id, year, month, status
      `;
      if (!updated) throw conflict(`Period ${year}-${month} is already closed or missing`);

      // Auto-open the next period so JEs can keep flowing
      const nextYear = month === 12 ? year + 1 : year;
      const nextMonth = month === 12 ? 1 : month + 1;
      await tx`
        INSERT INTO gl_periods (org_id, year, month, status)
        VALUES (${orgId}, ${nextYear}, ${nextMonth}, 'open')
        ON CONFLICT (org_id, year, month) DO NOTHING
      `;

      await audit(
        {
          orgId,
          userId,
          action: 'lock',
          entity: 'gl_period',
          entityId: updated!.id,
          before: { status: 'open' },
          after: { status: 'closed', year, month },
        },
        tx,
      );

      return updated;
    });
    return result;
  });
}
