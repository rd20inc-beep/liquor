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
  docType: 'order' | 'invoice' | 'receipt' | 'credit_note' | 'customer' | 'journal',
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

/**
 * Canonical brand prefix — configurable later via org_config.
 * Changing this here updates every document type in one place.
 */
const BRAND = 'LQ';

/** Format for year-based docs: LQ26-00001 */
function fmt(year: number, n: number): string {
  return `${BRAND}${String(year).padStart(2, '0')}-${String(n).padStart(5, '0')}`;
}

// Each doc type has its own counter so an order LQ26-00001 and an invoice
// LQ26-00001 can co-exist (they live in different tables).
export async function orderNo(tx: Sql, orgId: string): Promise<string> {
  const y = yy();
  return fmt(y, await nextDocNo(tx, orgId, 'order', y));
}

export async function invoiceNo(tx: Sql, orgId: string): Promise<string> {
  const y = yy();
  return fmt(y, await nextDocNo(tx, orgId, 'invoice', y));
}

export async function receiptNo(tx: Sql, orgId: string): Promise<string> {
  const y = yy();
  return fmt(y, await nextDocNo(tx, orgId, 'receipt', y));
}

export async function creditNoteNo(tx: Sql, orgId: string): Promise<string> {
  const y = yy();
  return fmt(y, await nextDocNo(tx, orgId, 'credit_note', y));
}

export async function journalNo(tx: Sql, orgId: string): Promise<string> {
  const y = yy();
  const n = await nextDocNo(tx, orgId, 'journal', y);
  return `${BRAND}-JE${String(y).padStart(2, '0')}-${String(n).padStart(5, '0')}`;
}

/** Customer codes are lifetime-sequential, year-less: LQ-C00001 */
export async function customerCode(tx: Sql, orgId: string): Promise<string> {
  const n = await nextDocNo(tx, orgId, 'customer', 0);
  return `${BRAND}-C${String(n).padStart(5, '0')}`;
}
