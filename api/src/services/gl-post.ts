/**
 * GL auto-posting helpers. Each event handler in invoice/payment/stock services
 * calls one of these to write a balanced journal entry inside the same tx.
 *
 * Cutover model: there's no backfill — events that occurred before the GL
 * tables existed simply don't have JEs. From this point forward, every
 * operational write that should hit the books goes through these helpers.
 *
 * Failure mode: hard-fail. If account codes are missing, the whole tx aborts
 * so the books stay consistent with the operational state.
 */
import type { Sql } from 'postgres';
import { badRequest } from '../errors.js';
import { journalNo } from './doc-numbers.js';

type PaymentMode = 'cash' | 'cheque' | 'bank' | 'upi';

const MODE_TO_ACCOUNT: Record<PaymentMode, string> = {
  cash: '1010',     // Cash on hand
  bank: '1110',     // Bank — Operating
  cheque: '1110',   // Bank — Operating (on verify)
  upi: '1210',      // JazzCash (default mobile wallet bucket)
};

interface PostLine {
  account_code: string;
  debit?: number;
  credit?: number;
  memo?: string;
  customer_id?: string | null;
  product_id?: string | null;
  batch_id?: string | null;
}

interface PostJournalInput {
  orgId: string;
  userId: string;
  jeDate: string; // YYYY-MM-DD
  sourceType: string;
  sourceId?: string | null;
  memo?: string | null;
  lines: PostLine[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function ensurePeriodOpen(tx: Sql, orgId: string, isoDate: string): Promise<void> {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const [period] = await tx<Array<{ status: string }>>`
    SELECT status FROM gl_periods
    WHERE org_id = ${orgId} AND year = ${year} AND month = ${month}
  `;
  if (!period) {
    await tx`
      INSERT INTO gl_periods (org_id, year, month, status)
      VALUES (${orgId}, ${year}, ${month}, 'open')
      ON CONFLICT (org_id, year, month) DO NOTHING
    `;
    return;
  }
  if (period.status !== 'open') {
    throw badRequest(
      `Cannot post to closed period ${year}-${String(month).padStart(2, '0')}`,
    );
  }
}

async function resolveAccounts(
  tx: Sql,
  orgId: string,
  codes: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(codes)];
  const rows = await tx<Array<{ id: string; code: string; active: boolean }>>`
    SELECT id, code, active
    FROM gl_accounts
    WHERE org_id = ${orgId} AND code = ANY(${unique})
  `;
  const map = new Map(rows.map((r) => [r.code, r.id]));
  for (const c of unique) {
    if (!map.has(c)) {
      throw badRequest(
        `GL account ${c} not found for this org — seed the chart of accounts`,
      );
    }
  }
  return map;
}

/**
 * Core poster. Validates balance, opens the period if missing, writes header
 * (unposted), then lines, then flips posted=true. The trigger that protects
 * posted-journal lines is satisfied because we post after lines are in.
 */
export async function postJournal(
  tx: Sql,
  input: PostJournalInput,
): Promise<{ id: string; journal_no: string }> {
  const { orgId, userId, jeDate, sourceType, sourceId, memo, lines } = input;
  if (lines.length < 2) throw badRequest('Journal must have at least two lines');

  let totalDebit = 0;
  let totalCredit = 0;
  for (const l of lines) {
    totalDebit += l.debit ?? 0;
    totalCredit += l.credit ?? 0;
  }
  totalDebit = round2(totalDebit);
  totalCredit = round2(totalCredit);
  if (totalDebit === 0) throw badRequest('Journal has zero amounts');
  if (totalDebit !== totalCredit) {
    throw badRequest(
      `Journal does not balance: debit=${totalDebit} credit=${totalCredit} (source=${sourceType})`,
    );
  }

  await ensurePeriodOpen(tx, orgId, jeDate);
  const accountIds = await resolveAccounts(tx, orgId, lines.map((l) => l.account_code));

  const journal_no = await journalNo(tx, orgId);
  const [head] = await tx<Array<{ id: string; journal_no: string }>>`
    INSERT INTO gl_journals (
      org_id, journal_no, je_date, source_type, source_id, memo,
      posted, created_by
    ) VALUES (
      ${orgId}, ${journal_no}, ${jeDate}, ${sourceType}, ${sourceId ?? null}, ${memo ?? null},
      false, ${userId}
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
        ${head!.id}, ${orgId}, ${accountIds.get(l.account_code)!},
        ${round2(l.debit ?? 0)}, ${round2(l.credit ?? 0)}, ${l.memo ?? null},
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

  return head!;
}

// ---------- Event-specific helpers ----------

export async function postInvoiceToLedger(
  tx: Sql,
  args: {
    orgId: string;
    userId: string;
    invoiceId: string;
    invoiceNo: string;
    invoiceDate: string;
    customerId: string;
    total: number;
  },
): Promise<void> {
  if (args.total <= 0) return;
  await postJournal(tx, {
    orgId: args.orgId,
    userId: args.userId,
    jeDate: args.invoiceDate,
    sourceType: 'invoice',
    sourceId: args.invoiceId,
    memo: `Invoice ${args.invoiceNo}`,
    lines: [
      {
        account_code: '1300', // Accounts Receivable
        debit: args.total,
        customer_id: args.customerId,
        memo: `Invoice ${args.invoiceNo}`,
      },
      {
        account_code: '4100', // Sales revenue
        credit: args.total,
        memo: `Invoice ${args.invoiceNo}`,
      },
    ],
  });
}

export async function postCogsToLedger(
  tx: Sql,
  args: {
    orgId: string;
    userId: string;
    invoiceId: string;
    invoiceNo: string;
    invoiceDate: string;
    /** Per-batch consumption — uses cost_price × qty */
    consumption: Array<{ batch_id: string; product_id: string; qty: number; cost_price: number }>;
  },
): Promise<void> {
  const total = round2(
    args.consumption.reduce((s, c) => s + c.qty * c.cost_price, 0),
  );
  if (total <= 0) return;

  const lines: PostLine[] = [];
  // Per-batch DR COGS lines for product/batch subledger detail
  for (const c of args.consumption) {
    const amt = round2(c.qty * c.cost_price);
    if (amt <= 0) continue;
    lines.push({
      account_code: '5100', // COGS
      debit: amt,
      product_id: c.product_id,
      batch_id: c.batch_id,
      memo: `COGS ${c.qty} units @ ${c.cost_price}`,
    });
  }
  // Single CR Inventory consolidation
  lines.push({
    account_code: '1400', // Inventory
    credit: total,
    memo: `Inventory release for ${args.invoiceNo}`,
  });

  await postJournal(tx, {
    orgId: args.orgId,
    userId: args.userId,
    jeDate: args.invoiceDate,
    sourceType: 'cogs',
    sourceId: args.invoiceId,
    memo: `COGS for ${args.invoiceNo}`,
    lines,
  });
}

export async function postPaymentToLedger(
  tx: Sql,
  args: {
    orgId: string;
    userId: string;
    paymentId: string;
    receiptNo: string;
    paymentDate: string;
    customerId: string;
    amount: number;
    mode: PaymentMode;
  },
): Promise<void> {
  if (args.amount <= 0) return;
  const cashAccount = MODE_TO_ACCOUNT[args.mode];
  await postJournal(tx, {
    orgId: args.orgId,
    userId: args.userId,
    jeDate: args.paymentDate,
    sourceType: 'payment',
    sourceId: args.paymentId,
    memo: `Payment ${args.receiptNo} (${args.mode})`,
    lines: [
      {
        account_code: cashAccount,
        debit: args.amount,
        memo: `Receipt ${args.receiptNo}`,
      },
      {
        account_code: '1300', // AR
        credit: args.amount,
        customer_id: args.customerId,
        memo: `Receipt ${args.receiptNo}`,
      },
    ],
  });
}

export async function postChequeBounceToLedger(
  tx: Sql,
  args: {
    orgId: string;
    userId: string;
    paymentId: string;
    receiptNo: string;
    bounceDate: string;
    customerId: string;
    amount: number;
  },
): Promise<void> {
  if (args.amount <= 0) return;
  // For cheques, the original payment posted on verify (DR Bank, CR AR).
  // On bounce we mirror it: DR AR, CR Bank.
  await postJournal(tx, {
    orgId: args.orgId,
    userId: args.userId,
    jeDate: args.bounceDate,
    sourceType: 'payment_bounce',
    sourceId: args.paymentId,
    memo: `Cheque ${args.receiptNo} bounced`,
    lines: [
      {
        account_code: '1300', // AR — restore receivable
        debit: args.amount,
        customer_id: args.customerId,
        memo: `Bounce ${args.receiptNo}`,
      },
      {
        account_code: '1110', // Bank
        credit: args.amount,
        memo: `Bounce ${args.receiptNo}`,
      },
    ],
  });
}

export async function postCreditNoteToLedger(
  tx: Sql,
  args: {
    orgId: string;
    userId: string;
    creditNoteId: string;
    cnNo: string;
    cnDate: string;
    customerId: string;
    amount: number;
    reason: string;
  },
): Promise<void> {
  if (args.amount <= 0) return;
  await postJournal(tx, {
    orgId: args.orgId,
    userId: args.userId,
    jeDate: args.cnDate,
    sourceType: 'credit_note',
    sourceId: args.creditNoteId,
    memo: `Credit note ${args.cnNo} — ${args.reason}`,
    lines: [
      {
        account_code: '4200', // Sales returns
        debit: args.amount,
        memo: `CN ${args.cnNo}`,
      },
      {
        account_code: '1300', // AR
        credit: args.amount,
        customer_id: args.customerId,
        memo: `CN ${args.cnNo}`,
      },
    ],
  });
}

export async function postReceiptToLedger(
  tx: Sql,
  args: {
    orgId: string;
    userId: string;
    batchId: string;
    productId: string;
    receiptDate: string;
    qty: number;
    costPrice: number;
    /** purchase_in vs opening_balance — opening posts to equity */
    reason: 'purchase_in' | 'opening_balance';
  },
): Promise<void> {
  const total = round2(args.qty * args.costPrice);
  if (total <= 0) return;
  // No vendor module yet → cash purchases. Owner's capital for opening.
  const credit_account = args.reason === 'opening_balance' ? '3100' : '1010';
  await postJournal(tx, {
    orgId: args.orgId,
    userId: args.userId,
    jeDate: args.receiptDate,
    sourceType: 'stock_receipt',
    sourceId: args.batchId,
    memo: `Stock receipt ${args.qty} units @ ${args.costPrice} (${args.reason})`,
    lines: [
      {
        account_code: '1400', // Inventory
        debit: total,
        product_id: args.productId,
        batch_id: args.batchId,
        memo: `Receipt ${args.qty} units`,
      },
      {
        account_code: credit_account,
        credit: total,
        memo: args.reason === 'opening_balance' ? "Opening stock" : 'Cash purchase',
      },
    ],
  });
}

export async function postAdjustmentToLedger(
  tx: Sql,
  args: {
    orgId: string;
    userId: string;
    batchId: string;
    productId: string;
    adjustDate: string;
    deltaQty: number;
    costPrice: number;
    reason: string;
  },
): Promise<void> {
  const valueDelta = round2(args.deltaQty * args.costPrice);
  if (valueDelta === 0) return;
  // delta > 0  => DR Inventory, CR Inventory variance (gain)
  // delta < 0  => DR Inventory variance (loss), CR Inventory
  const inventoryAcct = '1400';
  const varianceAcct = '5200';
  const lines: PostLine[] =
    args.deltaQty > 0
      ? [
          {
            account_code: inventoryAcct,
            debit: Math.abs(valueDelta),
            product_id: args.productId,
            batch_id: args.batchId,
          },
          {
            account_code: varianceAcct,
            credit: Math.abs(valueDelta),
            memo: args.reason,
          },
        ]
      : [
          {
            account_code: varianceAcct,
            debit: Math.abs(valueDelta),
            memo: args.reason,
          },
          {
            account_code: inventoryAcct,
            credit: Math.abs(valueDelta),
            product_id: args.productId,
            batch_id: args.batchId,
          },
        ];

  await postJournal(tx, {
    orgId: args.orgId,
    userId: args.userId,
    jeDate: args.adjustDate,
    sourceType: 'stock_adjust',
    sourceId: args.batchId,
    memo: `Adjustment ${args.deltaQty > 0 ? '+' : ''}${args.deltaQty} units — ${args.reason}`,
    lines,
  });
}
