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

/** Current four-digit year (UTC). */
export function fullYear(): number {
  return new Date().getUTCFullYear();
}

/**
 * Canonical brand prefix — configurable later via org_config, hard-coded for now.
 * Changing this here updates every document type in one place.
 */
const BRAND = 'LQR';

function fmt(type: string, year: number, n: number): string {
  return `${BRAND}-${type}-${year}-${String(n).padStart(6, '0')}`;
}

export async function orderNo(tx: Sql, orgId: string): Promise<string> {
  const y = fullYear();
  return fmt('SO', y, await nextDocNo(tx, orgId, 'order', y));
}

export async function invoiceNo(tx: Sql, orgId: string): Promise<string> {
  const y = fullYear();
  return fmt('INV', y, await nextDocNo(tx, orgId, 'invoice', y));
}

export async function receiptNo(tx: Sql, orgId: string): Promise<string> {
  const y = fullYear();
  return fmt('RC', y, await nextDocNo(tx, orgId, 'receipt', y));
}

export async function creditNoteNo(tx: Sql, orgId: string): Promise<string> {
  const y = fullYear();
  return fmt('CN', y, await nextDocNo(tx, orgId, 'credit_note', y));
}

/** Customer codes are lifetime-sequential, year-less: LQR-C-000001 */
export async function customerCode(tx: Sql, orgId: string): Promise<string> {
  const n = await nextDocNo(tx, orgId, 'customer', 0);
  return `${BRAND}-C-${String(n).padStart(6, '0')}`;
}
