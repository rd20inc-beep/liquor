import { sql } from '../db.js';

export interface ResolvedPrice {
  unit_price: number;
  line_total: number;
  source: 'customer_override' | 'default';
  price_list_id: string;
  price_list_name: string;
  /** true when the effective unit_price came from `case_price` (qty was a case multiple and crossed min_qty) */
  case_priced: boolean;
}

export class PriceNotFoundError extends Error {
  constructor(public readonly product_id: string) {
    super(`No price list contains product ${product_id}`);
    this.name = 'PriceNotFoundError';
  }
}

/**
 * Resolve a product's price for a customer on a given date.
 *
 * Lookup order:
 *   1. customer's price_list_id (override) if effective on `date`
 *   2. org default price list if effective on `date`
 *   3. throw PriceNotFoundError
 *
 * If qty >= case_qty AND qty is a multiple of case_qty AND qty >= min_qty,
 * case_price is used (if present). Otherwise unit_price.
 */
export async function resolvePrice(
  orgId: string,
  customerId: string,
  productId: string,
  qty: number,
  date: string = new Date().toISOString().slice(0, 10),
): Promise<ResolvedPrice> {
  if (qty <= 0) throw new Error('qty must be positive');

  // Single query: try customer override first, fall back to default. Both joins
  // enforce effective_from <= date AND (effective_to IS NULL OR effective_to >= date).
  const rows = await sql<
    Array<{
      price_list_id: string;
      price_list_name: string;
      is_default: boolean;
      from_customer: boolean;
      unit_price: string;
      case_price: string | null;
      min_qty: number;
      case_qty: number;
    }>
  >`
    WITH candidate AS (
      -- Customer override
      SELECT pl.id AS price_list_id, pl.name AS price_list_name, pl.is_default,
             true AS from_customer,
             pli.unit_price, pli.case_price, pli.min_qty,
             p.case_qty,
             1 AS priority
      FROM customers c
      JOIN price_lists pl      ON pl.id = c.price_list_id
      JOIN price_list_items pli ON pli.price_list_id = pl.id AND pli.product_id = ${productId}
      JOIN products p           ON p.id = pli.product_id
      WHERE c.id = ${customerId}
        AND c.org_id = ${orgId}
        AND pl.effective_from <= ${date}::date
        AND (pl.effective_to IS NULL OR pl.effective_to >= ${date}::date)

      UNION ALL

      -- Default price list
      SELECT pl.id, pl.name, pl.is_default, false,
             pli.unit_price, pli.case_price, pli.min_qty, p.case_qty, 2
      FROM price_lists pl
      JOIN price_list_items pli ON pli.price_list_id = pl.id AND pli.product_id = ${productId}
      JOIN products p           ON p.id = pli.product_id
      WHERE pl.org_id = ${orgId}
        AND pl.is_default = true
        AND pl.effective_from <= ${date}::date
        AND (pl.effective_to IS NULL OR pl.effective_to >= ${date}::date)
    )
    SELECT price_list_id, price_list_name, is_default, from_customer,
           unit_price, case_price, min_qty, case_qty
    FROM candidate
    ORDER BY priority
    LIMIT 1
  `;

  if (rows.length === 0) throw new PriceNotFoundError(productId);
  const row = rows[0]!;

  if (qty < row.min_qty) {
    throw new Error(`qty ${qty} below min_qty ${row.min_qty} on price list ${row.price_list_name}`);
  }

  const unitPrice = Number(row.unit_price);
  const casePrice = row.case_price !== null ? Number(row.case_price) : null;

  // Case pricing applies when qty is a whole-case multiple and a case_price exists.
  const isCaseQty = row.case_qty > 1 && qty % row.case_qty === 0;
  const effectiveUnit = isCaseQty && casePrice !== null ? casePrice / row.case_qty : unitPrice;

  return {
    unit_price: Math.round(effectiveUnit * 100) / 100,
    line_total: Math.round(effectiveUnit * qty * 100) / 100,
    source: row.from_customer ? 'customer_override' : 'default',
    price_list_id: row.price_list_id,
    price_list_name: row.price_list_name,
    case_priced: isCaseQty && casePrice !== null,
  };
}
