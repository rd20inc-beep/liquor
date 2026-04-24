import type { Sql } from 'postgres';
import { badRequest, conflict, notFound } from '../errors.js';
import { appendLedger } from './ar-ledger.js';
import { audit } from './audit.js';
import { creditNoteNo, invoiceNo as generateInvoiceNo } from './doc-numbers.js';

export interface PostInvoiceInput {
  orgId: string;
  orderId: string;
  warehouseId: string;
  userId: string;
  /** Days added to invoice_date for due_date. Derived from customer payment term if omitted. */
  dueDays?: number;
}

export interface PostInvoiceResult {
  invoice_id: string;
  invoice_no: string;
  total: number;
  outstanding: number;
  ledger_id: number;
  running_balance: number;
  idempotent: boolean;
}

/**
 * Atomic invoice posting: consumes reserved stock, writes invoice + lines,
 * appends AR ledger debit, writes sale movements, locks the invoice.
 *
 * Idempotent on order_id: re-posting returns the existing invoice.
 */
export async function postInvoice(tx: Sql, input: PostInvoiceInput): Promise<PostInvoiceResult> {
  const { orgId, orderId, warehouseId, userId } = input;

  // Idempotency on order_id
  const existing = await tx<
    Array<{ id: string; invoice_no: string; total: string; outstanding: string }>
  >`
    SELECT id, invoice_no, total, outstanding
    FROM invoices WHERE order_id = ${orderId} AND org_id = ${orgId}
  `;
  if (existing.length > 0) {
    const e = existing[0]!;
    return {
      invoice_id: e.id,
      invoice_no: e.invoice_no,
      total: Number(e.total),
      outstanding: Number(e.outstanding),
      ledger_id: 0,
      running_balance: 0,
      idempotent: true,
    };
  }

  // Load order + customer term (for due date)
  const [order] = await tx<
    Array<{
      id: string;
      status: string;
      customer_id: string;
      subtotal: string;
      tax_total: string;
      total: string;
    }>
  >`
    SELECT id, status, customer_id, subtotal, tax_total, total
    FROM sales_orders
    WHERE id = ${orderId} AND org_id = ${orgId}
    FOR UPDATE
  `;
  if (!order) throw notFound('Order not found');
  if (order.status !== 'approved' && order.status !== 'confirmed') {
    throw conflict(`Cannot invoice order in status '${order.status}'`);
  }

  const [custTerm] = await tx<Array<{ days: number | null }>>`
    SELECT pt.days
    FROM customers c
    LEFT JOIN payment_terms pt ON pt.id = c.payment_term_id
    WHERE c.id = ${order.customer_id}
  `;
  const dueDays = input.dueDays ?? custTerm?.days ?? 0;

  // Load lines
  const lines = await tx<
    Array<{
      id: string;
      product_id: string;
      qty: number;
      unit_price: string;
      tax_rate: string;
      line_total: string;
    }>
  >`
    SELECT id, product_id, qty, unit_price, tax_rate, line_total
    FROM sales_order_lines WHERE order_id = ${orderId}
  `;
  if (lines.length === 0) throw badRequest('Order has no lines');

  // Consume reserved stock: for each line, pick reserved batches FEFO and decrement
  interface Alloc {
    batch_id: string;
    qty: number;
  }
  const perLineAllocations = new Map<string, Alloc[]>();

  for (const line of lines) {
    const batches = await tx<Array<{ id: string; qty_reserved: number; qty_physical: number }>>`
      SELECT id, qty_reserved, qty_physical
      FROM stock_batches
      WHERE warehouse_id = ${warehouseId}
        AND product_id = ${line.product_id}
        AND qty_reserved > 0
      ORDER BY expiry_date NULLS LAST, created_at
      FOR UPDATE
    `;
    const total = batches.reduce((s, b) => s + Number(b.qty_reserved), 0);
    if (total < line.qty) {
      throw conflict(
        `Insufficient reserved stock for product ${line.product_id}: reserved=${total}, needed=${line.qty}`,
      );
    }
    const allocs: Alloc[] = [];
    let remaining = line.qty;
    for (const b of batches) {
      if (remaining === 0) break;
      const take = Math.min(Number(b.qty_reserved), remaining);
      // Convert reservation to consumption: debit both qty_reserved and qty_physical
      await tx`
        UPDATE stock_batches
        SET qty_reserved = qty_reserved - ${take},
            qty_physical = qty_physical - ${take}
        WHERE id = ${b.id}
      `;
      allocs.push({ batch_id: b.id, qty: take });
      remaining -= take;
    }
    perLineAllocations.set(line.id, allocs);
  }

  // Create the invoice — locked from birth (locked_at = now())
  const invoiceNo = await generateInvoiceNo(tx, orgId);
  const subtotal = Number(order.subtotal);
  const taxTotal = Number(order.tax_total);
  const total = Number(order.total);

  const [invoice] = await tx<Array<{ id: string }>>`
    INSERT INTO invoices (
      org_id, invoice_no, order_id, customer_id,
      invoice_date, due_date,
      subtotal, tax_total, total, outstanding,
      status, locked_at
    ) VALUES (
      ${orgId}, ${invoiceNo}, ${orderId}, ${order.customer_id},
      current_date, current_date + ${dueDays}::int,
      ${subtotal}, ${taxTotal}, ${total}, ${total},
      'open', now()
    )
    RETURNING id
  `;
  const invoiceId = invoice!.id;

  // Insert invoice_lines split by batch allocation (one row per batch)
  for (const line of lines) {
    const allocs = perLineAllocations.get(line.id) ?? [];
    if (allocs.length === 0) continue;
    const unitPrice = Number(line.unit_price);
    const taxRate = Number(line.tax_rate);
    for (const a of allocs) {
      // Pro-rate line_total by share of line qty
      const share = a.qty / Number(line.qty);
      const lineTotal = Math.round(Number(line.line_total) * share * 100) / 100;
      await tx`
        INSERT INTO invoice_lines (invoice_id, product_id, batch_id, qty, unit_price, tax_rate, line_total)
        VALUES (${invoiceId}, ${line.product_id}, ${a.batch_id}, ${a.qty}, ${unitPrice}, ${taxRate}, ${lineTotal})
      `;
      // Write sale movement
      await tx`
        INSERT INTO stock_movements (
          org_id, product_id, batch_id, from_wh_id, to_wh_id,
          qty, reason, ref_type, ref_id, user_id
        ) VALUES (
          ${orgId}, ${line.product_id}, ${a.batch_id}, ${warehouseId}, NULL,
          ${a.qty}, 'sale', 'invoice', ${invoiceId}, ${userId}
        )
      `;
    }
  }

  // AR ledger debit
  const ledger = await appendLedger(tx, {
    orgId,
    customerId: order.customer_id,
    entryType: 'invoice',
    refType: 'invoice',
    refId: invoiceId,
    debit: total,
    credit: 0,
    note: `Invoice ${invoiceNo}`,
  });

  // Update order status
  await tx`
    UPDATE sales_orders SET status = 'invoiced', updated_at = now()
    WHERE id = ${orderId}
  `;

  await audit(
    {
      orgId,
      userId,
      action: 'create',
      entity: 'invoice',
      entityId: invoiceId,
      after: { invoice_no: invoiceNo, total, order_id: orderId },
    },
    tx,
  );

  return {
    invoice_id: invoiceId,
    invoice_no: invoiceNo,
    total,
    outstanding: total,
    ledger_id: ledger.id,
    running_balance: ledger.running_balance,
    idempotent: false,
  };
}

/**
 * Recompute invoice status from current outstanding. Called after payment
 * allocations, credit notes, or dispute toggles. Uses bypass to update the
 * locked row; caller must be inside a transaction.
 */
export async function recomputeInvoiceStatus(
  tx: Sql,
  invoiceId: string,
  opts: { disputed?: boolean } = {},
): Promise<string> {
  await tx`SELECT set_config('app.bypass_lock', 'on', true)`;

  const [inv] = await tx<Array<{ total: string; outstanding: string; status: string }>>`
    SELECT total, outstanding, status
    FROM invoices WHERE id = ${invoiceId}
    FOR UPDATE
  `;
  if (!inv) throw notFound('Invoice not found');

  const total = Number(inv.total);
  const outstanding = Number(inv.outstanding);

  let newStatus: 'open' | 'partial' | 'paid' | 'disputed' | 'void';
  if (opts.disputed) newStatus = 'disputed';
  else if (outstanding === 0) newStatus = 'paid';
  else if (outstanding < total) newStatus = 'partial';
  else newStatus = 'open';

  if (newStatus !== inv.status) {
    await tx`
      UPDATE invoices SET status = ${newStatus}, updated_at = now()
      WHERE id = ${invoiceId}
    `;
  }
  return newStatus;
}

/**
 * Apply a credit note: append ledger credit, reduce outstanding on the target
 * invoice (if any), recompute status. Called from the approval decide handler.
 */
export interface CreditNoteInput {
  orgId: string;
  customerId: string;
  invoiceId?: string;
  amount: number;
  reason: string;
  userId: string;
}

export async function applyCreditNote(
  tx: Sql,
  input: CreditNoteInput,
): Promise<{ credit_note_id: string; ledger_id: number }> {
  const { orgId, customerId, invoiceId, amount, reason, userId } = input;
  if (amount <= 0) throw badRequest('Credit note amount must be positive');

  // If an invoice is targeted, verify it and cap the amount to outstanding
  if (invoiceId) {
    const [inv] = await tx<Array<{ outstanding: string; customer_id: string }>>`
      SELECT outstanding, customer_id FROM invoices
      WHERE id = ${invoiceId} AND org_id = ${orgId}
      FOR UPDATE
    `;
    if (!inv) throw notFound('Target invoice not found');
    if (inv.customer_id !== customerId) {
      throw badRequest('Invoice belongs to a different customer');
    }
    if (amount > Number(inv.outstanding)) {
      throw conflict(`Credit note amount exceeds invoice outstanding (${inv.outstanding})`);
    }
  }

  const cnNo = await creditNoteNo(tx, orgId);
  const [cn] = await tx<Array<{ id: string }>>`
    INSERT INTO credit_notes (
      org_id, cn_no, invoice_id, customer_id, amount, reason, approved_by, locked_at
    ) VALUES (
      ${orgId}, ${cnNo}, ${invoiceId ?? null}, ${customerId}, ${amount}, ${reason}, ${userId}, now()
    )
    RETURNING id
  `;
  const cnId = cn!.id;

  // Apply to invoice outstanding (with bypass)
  if (invoiceId) {
    await tx`SELECT set_config('app.bypass_lock', 'on', true)`;
    await tx`
      UPDATE invoices SET outstanding = outstanding - ${amount}, updated_at = now()
      WHERE id = ${invoiceId}
    `;
    await recomputeInvoiceStatus(tx, invoiceId);
  }

  const ledger = await appendLedger(tx, {
    orgId,
    customerId,
    entryType: 'credit_note',
    refType: 'credit_note',
    refId: cnId,
    debit: 0,
    credit: amount,
    note: `Credit note ${cnNo}: ${reason}`,
  });

  await audit(
    {
      orgId,
      userId,
      action: 'create',
      entity: 'credit_note',
      entityId: cnId,
      after: { cn_no: cnNo, amount, invoice_id: invoiceId ?? null, reason },
    },
    tx,
  );

  return { credit_note_id: cnId, ledger_id: ledger.id };
}
