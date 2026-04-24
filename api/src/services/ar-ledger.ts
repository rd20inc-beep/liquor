import type { LedgerEntryType } from '@liquor/shared';
import type { Sql } from 'postgres';

export interface LedgerEntry {
  orgId: string;
  customerId: string;
  entryType: LedgerEntryType;
  refType: string;
  refId: string;
  debit: number;
  credit: number;
  note?: string | null;
}

/**
 * Append an entry to ar_ledger with correct running_balance. Serialized per
 * customer via pg_advisory_xact_lock, matching the credit-state refresh lock.
 *
 * Invariant: exactly one of {debit, credit} is positive (enforced in SQL by
 * the ar_ledger CHECK constraint).
 */
export async function appendLedger(
  tx: Sql,
  entry: LedgerEntry,
): Promise<{
  id: number;
  running_balance: number;
}> {
  if (entry.debit < 0 || entry.credit < 0) throw new Error('amounts must be non-negative');
  if (entry.debit > 0 && entry.credit > 0)
    throw new Error('entry is either debit or credit, not both');
  if (entry.debit === 0 && entry.credit === 0) throw new Error('entry must have non-zero amount');

  const lockKey = Number.parseInt(entry.customerId.replace(/-/g, '').slice(0, 8), 16);
  await tx`SELECT pg_advisory_xact_lock(${lockKey})`;

  const [prior] = await tx<Array<{ running_balance: string | null }>>`
    SELECT running_balance FROM ar_ledger
    WHERE customer_id = ${entry.customerId}
    ORDER BY id DESC
    LIMIT 1
  `;
  const priorBalance = prior?.running_balance ? Number(prior.running_balance) : 0;
  const newBalance = Math.round((priorBalance + entry.debit - entry.credit) * 100) / 100;

  const [row] = await tx<Array<{ id: number; running_balance: string }>>`
    INSERT INTO ar_ledger (
      org_id, customer_id, entry_type, ref_type, ref_id,
      debit, credit, running_balance, note
    ) VALUES (
      ${entry.orgId}, ${entry.customerId}, ${entry.entryType}, ${entry.refType}, ${entry.refId},
      ${entry.debit}, ${entry.credit}, ${newBalance}, ${entry.note ?? null}
    )
    RETURNING id, running_balance
  `;
  return { id: row!.id, running_balance: Number(row!.running_balance) };
}
