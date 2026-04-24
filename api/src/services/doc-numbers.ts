import type { Sql } from 'postgres';

/**
 * Atomically allocate the next sequential number for a doc type.
 * UPSERT on (org_id, doc_type, year) with seq = seq + 1 returns the new seq
 * without races.
 *
 * For doc types where "per year" doesn't make sense (customer codes), pass
 * year = 0 so the counter is lifetime.
 */
export async function nextDocNo(
  tx: Sql,
  orgId: string,
  docType: 'order' | 'invoice' | 'receipt' | 'credit_note' | 'customer',
  year: number,
): Promise<number> {
  const [row] = await tx<Array<{ seq: number }>>`
    INSERT INTO doc_counters (org_id, doc_type, year, seq)
    VALUES (${orgId}, ${docType}, ${year}, 1)
    ON CONFLICT (org_id, doc_type, year) DO UPDATE
      SET seq = doc_counters.seq + 1
    RETURNING seq
  `;
  return row!.seq;
}

/** Current two-digit year (UTC). */
export function yy(): number {
  return new Date().getUTCFullYear() % 100;
}

export async function orderNo(tx: Sql, orgId: string): Promise<string> {
  const y = yy();
  const n = await nextDocNo(tx, orgId, 'order', y);
  return `SO-${String(y).padStart(2, '0')}-${String(n).padStart(5, '0')}`;
}

export async function invoiceNo(tx: Sql, orgId: string): Promise<string> {
  const y = yy();
  const n = await nextDocNo(tx, orgId, 'invoice', y);
  return `INV-${String(y).padStart(2, '0')}-${String(n).padStart(5, '0')}`;
}

export async function receiptNo(tx: Sql, orgId: string): Promise<string> {
  const y = yy();
  const n = await nextDocNo(tx, orgId, 'receipt', y);
  return `RC-${String(y).padStart(2, '0')}-${String(n).padStart(5, '0')}`;
}

export async function creditNoteNo(tx: Sql, orgId: string): Promise<string> {
  const y = yy();
  const n = await nextDocNo(tx, orgId, 'credit_note', y);
  return `CN-${String(y).padStart(2, '0')}-${String(n).padStart(5, '0')}`;
}

/** Customer codes are lifetime-sequential: C-00001 */
export async function customerCode(tx: Sql, orgId: string): Promise<string> {
  const n = await nextDocNo(tx, orgId, 'customer', 0);
  return `C-${String(n).padStart(5, '0')}`;
}
