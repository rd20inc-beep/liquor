import type { PaymentMode } from '@liquor/shared';
import type { Sql } from 'postgres';
import { badRequest, conflict, notFound } from '../errors.js';
import { appendLedger } from './ar-ledger.js';
import { audit } from './audit.js';
import { recomputeInvoiceStatus } from './invoice.js';

export interface AllocationInput {
  invoice_id: string;
  amount: number;
}

export interface RecordPaymentInput {
  orgId: string;
  customerId: string;
  visitId?: string | null;
  collectorId?: string | null;
  amount: number;
  mode: PaymentMode;
  mode_ref?: string | null;
  cheque_date?: string | null;
  bank_name?: string | null;
  proof_image_url?: string | null;
  collected_at?: string;
  idempotency_key?: string | null;
  /** Explicit allocations. If absent, FIFO auto-allocates against open invoices. */
  allocations?: AllocationInput[];
  /** Suppress duplicate-detection error. */
  force?: boolean;
  userId: string;
}

export interface RecordPaymentResult {
  payment_id: string;
  receipt_no: string;
  amount: number;
  allocated: number;
  advance: number;
  allocations: AllocationInput[];
  ledger_id: number;
  running_balance: number;
  idempotent: boolean;
}

function generateReceiptNo(): string {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const rand = crypto.randomUUID().slice(0, 6).toUpperCase();
  return `RC-${ymd}-${rand}`;
}

/**
 * FIFO allocator: oldest-due invoices first, open/partial/disputed only.
 * Returns allocations that together sum to min(amount, total_outstanding).
 */
async function allocateFIFO(
  tx: Sql,
  customerId: string,
  amount: number,
): Promise<AllocationInput[]> {
  const invoices = await tx<Array<{ id: string; outstanding: string }>>`
    SELECT id, outstanding FROM invoices
    WHERE customer_id = ${customerId}
      AND status IN ('open','partial','disputed')
      AND outstanding > 0
    ORDER BY due_date, invoice_date, id
    FOR UPDATE
  `;
  const out: AllocationInput[] = [];
  let remaining = amount;
  for (const inv of invoices) {
    if (remaining <= 0) break;
    const owed = Number(inv.outstanding);
    const applied = Math.min(owed, remaining);
    out.push({ invoice_id: inv.id, amount: Math.round(applied * 100) / 100 });
    remaining = Math.round((remaining - applied) * 100) / 100;
  }
  return out;
}

/**
 * Warn if an identical-looking payment landed in the last 10 minutes. Caller
 * bypasses with force=true.
 */
async function checkDuplicate(
  tx: Sql,
  orgId: string,
  customerId: string,
  amount: number,
  mode: PaymentMode,
): Promise<string | null> {
  const [dup] = await tx<Array<{ id: string }>>`
    SELECT id FROM payments
    WHERE org_id = ${orgId}
      AND customer_id = ${customerId}
      AND amount = ${amount}
      AND mode = ${mode}
      AND collected_at >= now() - interval '10 minutes'
    LIMIT 1
  `;
  return dup?.id ?? null;
}

export async function recordPayment(
  tx: Sql,
  input: RecordPaymentInput,
): Promise<RecordPaymentResult> {
  const { orgId, customerId, amount, mode, userId } = input;
  if (amount <= 0) throw badRequest('Payment amount must be positive');

  // Idempotency
  if (input.idempotency_key) {
    const prior = await tx<Array<{ id: string; receipt_no: string; amount: string }>>`
      SELECT id, receipt_no, amount FROM payments
      WHERE org_id = ${orgId} AND idempotency_key = ${input.idempotency_key}
    `;
    if (prior.length > 0) {
      const allocs = await tx<Array<{ invoice_id: string; amount: string }>>`
        SELECT invoice_id, amount FROM payment_allocations WHERE payment_id = ${prior[0]!.id}
      `;
      const allocated = allocs.reduce((s, a) => s + Number(a.amount), 0);
      return {
        payment_id: prior[0]!.id,
        receipt_no: prior[0]!.receipt_no,
        amount: Number(prior[0]!.amount),
        allocated,
        advance: Number(prior[0]!.amount) - allocated,
        allocations: allocs.map((a) => ({ invoice_id: a.invoice_id, amount: Number(a.amount) })),
        ledger_id: 0,
        running_balance: 0,
        idempotent: true,
      };
    }
  }

  // Duplicate detection (same customer + amount + mode within 10m)
  if (!input.force) {
    const dupId = await checkDuplicate(tx, orgId, customerId, amount, mode);
    if (dupId) {
      throw conflict(
        `Possible duplicate of payment ${dupId} (same customer+amount+mode in last 10min). Pass force=true to override.`,
      );
    }
  }

  // Resolve allocations
  let allocations = input.allocations ?? [];
  if (allocations.length === 0) {
    allocations = await allocateFIFO(tx, customerId, amount);
  } else {
    // Validate explicit allocations
    const invoiceIds = allocations.map((a) => a.invoice_id);
    const rows = await tx<
      Array<{ id: string; outstanding: string; customer_id: string; org_id: string }>
    >`
      SELECT id, outstanding, customer_id, org_id
      FROM invoices WHERE id IN ${tx(invoiceIds)}
      FOR UPDATE
    `;
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const a of allocations) {
      const inv = byId.get(a.invoice_id);
      if (!inv) throw badRequest(`Invoice ${a.invoice_id} not found`);
      if (inv.org_id !== orgId) throw badRequest(`Invoice ${a.invoice_id} belongs to another org`);
      if (inv.customer_id !== customerId)
        throw badRequest(`Invoice ${a.invoice_id} belongs to another customer`);
      if (a.amount <= 0) throw badRequest('Allocation amount must be positive');
      if (a.amount > Number(inv.outstanding)) {
        throw conflict(`Allocation exceeds outstanding on invoice ${a.invoice_id}`);
      }
    }
  }

  const allocatedSum = Math.round(allocations.reduce((s, a) => s + a.amount, 0) * 100) / 100;
  if (allocatedSum > amount) {
    throw badRequest(`Allocations (${allocatedSum}) exceed payment amount (${amount})`);
  }
  const advance = Math.round((amount - allocatedSum) * 100) / 100;

  // Cash/bank/upi are locked immediately; cheques unlocked until verified.
  const lockNow = mode !== 'cheque';
  const verification = mode === 'cheque' ? 'pending' : 'verified';
  const receiptNo = generateReceiptNo();
  const collectedAt = input.collected_at ?? new Date().toISOString();

  const lockTime = lockNow ? new Date() : null;
  const [payment] = await tx<Array<{ id: string }>>`
    INSERT INTO payments (
      org_id, receipt_no, visit_id, customer_id, collector_id,
      amount, mode, mode_ref, cheque_date, bank_name,
      verification_status, verified_by, verified_at,
      proof_image_url, collected_at, locked_at, idempotency_key
    ) VALUES (
      ${orgId}, ${receiptNo}, ${input.visitId ?? null}, ${customerId}, ${input.collectorId ?? null},
      ${amount}, ${mode}, ${input.mode_ref ?? null}, ${input.cheque_date ?? null}, ${input.bank_name ?? null},
      ${verification}, ${lockNow ? userId : null}, ${lockTime},
      ${input.proof_image_url ?? null}, ${collectedAt}::timestamptz,
      ${lockTime}, ${input.idempotency_key ?? null}
    )
    RETURNING id
  `;
  const paymentId = payment!.id;

  // Write allocations (locked guard blocks if payment locked; we inserted
  // allocations before locking. For cash/bank/upi, we set locked_at at insert
  // time — so we need to temporarily bypass.
  if (allocations.length > 0 && lockNow) {
    await tx`SELECT set_config('app.bypass_lock', 'on', true)`;
  }
  for (const a of allocations) {
    await tx`
      INSERT INTO payment_allocations (payment_id, invoice_id, amount)
      VALUES (${paymentId}, ${a.invoice_id}, ${a.amount})
    `;
    // Decrement invoice.outstanding under bypass
    await tx`SELECT set_config('app.bypass_lock', 'on', true)`;
    await tx`
      UPDATE invoices SET outstanding = outstanding - ${a.amount}, updated_at = now()
      WHERE id = ${a.invoice_id}
    `;
    await recomputeInvoiceStatus(tx, a.invoice_id);
  }

  // Ledger credit for cheques only lands after verify; for cash/bank/upi we
  // credit now.
  let ledgerId = 0;
  let runningBalance = 0;
  if (verification === 'verified') {
    const led = await appendLedger(tx, {
      orgId,
      customerId,
      entryType: 'payment',
      refType: 'payment',
      refId: paymentId,
      debit: 0,
      credit: amount,
      note: `Payment ${receiptNo} (${mode})`,
    });
    ledgerId = led.id;
    runningBalance = led.running_balance;
  }

  await audit(
    {
      orgId,
      userId,
      action: 'create',
      entity: 'payment',
      entityId: paymentId,
      after: {
        receipt_no: receiptNo,
        amount,
        mode,
        verification_status: verification,
        allocated: allocatedSum,
        advance,
      },
    },
    tx,
  );

  return {
    payment_id: paymentId,
    receipt_no: receiptNo,
    amount,
    allocated: allocatedSum,
    advance,
    allocations,
    ledger_id: ledgerId,
    running_balance: runningBalance,
    idempotent: false,
  };
}

/**
 * Verify a cheque payment. decision='verified' locks the payment and appends
 * the ledger credit. decision='bounced' reverses: keeps allocations in place
 * audit-wise, but appends a compensating debit and restores invoice outstanding.
 */
export async function verifyCheque(
  tx: Sql,
  orgId: string,
  paymentId: string,
  userId: string,
  decision: 'verified' | 'bounced',
  note?: string,
): Promise<{ payment_id: string; verification_status: string; ledger_id: number }> {
  const [p] = await tx<
    Array<{
      id: string;
      customer_id: string;
      amount: string;
      mode: string;
      verification_status: string;
      receipt_no: string;
      locked_at: string | null;
    }>
  >`
    SELECT id, customer_id, amount, mode, verification_status, receipt_no, locked_at
    FROM payments
    WHERE id = ${paymentId} AND org_id = ${orgId}
    FOR UPDATE
  `;
  if (!p) throw notFound('Payment not found');
  if (p.mode !== 'cheque') throw badRequest('Only cheque payments can be verified');
  if (p.verification_status === 'verified' || p.verification_status === 'bounced') {
    throw conflict(`Cheque is already ${p.verification_status}`);
  }

  const amount = Number(p.amount);

  // Fetch allocations so we can either credit (verify) or reverse (bounce)
  const allocs = await tx<Array<{ invoice_id: string; amount: string }>>`
    SELECT invoice_id, amount FROM payment_allocations WHERE payment_id = ${paymentId}
  `;

  if (decision === 'verified') {
    const led = await appendLedger(tx, {
      orgId,
      customerId: p.customer_id,
      entryType: 'payment',
      refType: 'payment',
      refId: paymentId,
      debit: 0,
      credit: amount,
      note: `Payment ${p.receipt_no} (cheque) verified`,
    });

    // Lock the payment row
    if (!p.locked_at) {
      await tx`SELECT set_config('app.bypass_lock', 'on', true)`;
      await tx`
        UPDATE payments
        SET verification_status = 'verified', verified_by = ${userId},
            verified_at = now(), locked_at = now()
        WHERE id = ${paymentId}
      `;
    }
    await audit(
      {
        orgId,
        userId,
        action: 'approve',
        entity: 'payment',
        entityId: paymentId,
        before: { verification_status: p.verification_status },
        after: { verification_status: 'verified', note: note ?? null },
      },
      tx,
    );
    return { payment_id: paymentId, verification_status: 'verified', ledger_id: led.id };
  }

  // decision === 'bounced'
  // Restore invoice.outstanding for each prior allocation (under bypass) and
  // recompute status. The allocation rows themselves stay for audit trail.
  await tx`SELECT set_config('app.bypass_lock', 'on', true)`;
  for (const a of allocs) {
    await tx`
      UPDATE invoices SET outstanding = outstanding + ${a.amount}, updated_at = now()
      WHERE id = ${a.invoice_id}
    `;
    await recomputeInvoiceStatus(tx, a.invoice_id);
  }

  // Compensating debit entry keeps ar_ledger append-only while reversing effect.
  // Since this is a bounce before the verified-credit was written, the prior
  // customer balance has not received a credit for this payment. We write a
  // debit only if allocations had been applied (allocations reduced outstanding
  // at record time, affecting the customer balance).
  const allocatedSum = allocs.reduce((s, a) => s + Number(a.amount), 0);
  let ledgerId = 0;
  if (allocatedSum > 0) {
    const led = await appendLedger(tx, {
      orgId,
      customerId: p.customer_id,
      entryType: 'adjustment',
      refType: 'payment_bounce',
      refId: paymentId,
      debit: allocatedSum,
      credit: 0,
      note: `Cheque ${p.receipt_no} bounced: restore ${allocatedSum}`,
    });
    ledgerId = led.id;
  }

  await tx`SELECT set_config('app.bypass_lock', 'on', true)`;
  await tx`
    UPDATE payments
    SET verification_status = 'bounced', verified_by = ${userId},
        verified_at = now(), locked_at = now()
    WHERE id = ${paymentId}
  `;

  await audit(
    {
      orgId,
      userId,
      action: 'reject',
      entity: 'payment',
      entityId: paymentId,
      before: { verification_status: p.verification_status },
      after: { verification_status: 'bounced', note: note ?? null, restored: allocatedSum },
    },
    tx,
  );

  return { payment_id: paymentId, verification_status: 'bounced', ledger_id: ledgerId };
}
