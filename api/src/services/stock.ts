import type { Sql } from 'postgres';
import { sql } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { postAdjustmentToLedger } from './gl-post.js';

export interface BatchAllocation {
  batch_id: string;
  qty: number;
  expiry_date: string | null;
}

/**
 * First-Expiry-First-Out pick. Returns a list of batch allocations summing to `qty`,
 * or null if the warehouse does not hold enough free stock for the product.
 *
 * Callers MUST run this inside a transaction and pass that tx as `tx`. The rows
 * are locked with FOR UPDATE to prevent concurrent allocations of the same qty.
 */
export async function pickBatchesFEFO(
  tx: Sql,
  warehouseId: string,
  productId: string,
  qty: number,
): Promise<BatchAllocation[] | null> {
  if (qty <= 0) throw new Error('qty must be positive');

  const batches = await tx<
    Array<{
      id: string;
      expiry_date: string | null;
      free: number;
    }>
  >`
    SELECT
      sb.id,
      sb.expiry_date,
      (sb.qty_physical - sb.qty_damaged - sb.qty_reserved)::int AS free
    FROM stock_batches sb
    WHERE sb.warehouse_id = ${warehouseId}
      AND sb.product_id = ${productId}
      AND (sb.qty_physical - sb.qty_damaged - sb.qty_reserved) > 0
    ORDER BY sb.expiry_date NULLS LAST, sb.created_at
    FOR UPDATE
  `;

  const allocations: BatchAllocation[] = [];
  let remaining = qty;
  for (const b of batches) {
    if (remaining === 0) break;
    const take = Math.min(b.free, remaining);
    allocations.push({ batch_id: b.id, qty: take, expiry_date: b.expiry_date });
    remaining -= take;
  }

  return remaining === 0 ? allocations : null;
}

/**
 * Reserve `qty` of `product_id` at `warehouse_id` against one or more batches.
 * Increments qty_reserved on each affected batch. Returns the allocations used.
 * Throws if free qty is insufficient.
 */
export async function reserveStock(
  tx: Sql,
  warehouseId: string,
  productId: string,
  qty: number,
): Promise<BatchAllocation[]> {
  const picks = await pickBatchesFEFO(tx, warehouseId, productId, qty);
  if (picks === null) {
    throw new InsufficientStockError(warehouseId, productId, qty);
  }
  for (const p of picks) {
    await tx`
      UPDATE stock_batches
      SET qty_reserved = qty_reserved + ${p.qty}
      WHERE id = ${p.batch_id}
    `;
  }
  return picks;
}

/**
 * Release previously-reserved qty back to free. No-op if qty is zero.
 */
export async function releaseReservation(tx: Sql, batchId: string, qty: number): Promise<void> {
  if (qty === 0) return;
  await tx`
    UPDATE stock_batches
    SET qty_reserved = GREATEST(0, qty_reserved - ${qty})
    WHERE id = ${batchId}
  `;
}

export class InsufficientStockError extends Error {
  constructor(
    public readonly warehouse_id: string,
    public readonly product_id: string,
    public readonly qty: number,
  ) {
    super(`Insufficient free stock: warehouse=${warehouse_id} product=${product_id} qty=${qty}`);
    this.name = 'InsufficientStockError';
  }
}

export interface AdjustInput {
  warehouse_id: string;
  product_id: string;
  batch_id?: string;
  delta_qty: number;
  reason: string;
  note?: string;
}

/**
 * Apply a stock adjustment: update batch qty_physical and write a movement.
 * Positive deltas without a batch_id open a new batch; negative deltas must
 * target a specific batch_id.
 */
export async function applyAdjustment(tx: Sql, orgId: string, userId: string, d: AdjustInput) {
  if (d.delta_qty === 0) throw badRequest('delta_qty cannot be zero');
  let batchId: string;
  let costPrice = 0;

  if (d.batch_id) {
    const [b] = await tx<
      Array<{
        id: string;
        qty_physical: number;
        qty_damaged: number;
        qty_reserved: number;
        cost_price: string;
      }>
    >`
      SELECT id, qty_physical, qty_damaged, qty_reserved, cost_price
      FROM stock_batches
      WHERE id = ${d.batch_id} AND org_id = ${orgId}
        AND warehouse_id = ${d.warehouse_id} AND product_id = ${d.product_id}
      FOR UPDATE
    `;
    if (!b) throw notFound('Batch not found in this warehouse/product');
    const newPhysical = Number(b.qty_physical) + d.delta_qty;
    if (newPhysical < Number(b.qty_damaged) + Number(b.qty_reserved)) {
      throw conflict('Adjustment would leave insufficient physical qty to cover reserved/damaged');
    }
    await tx`UPDATE stock_batches SET qty_physical = ${newPhysical} WHERE id = ${b.id}`;
    batchId = b.id;
    costPrice = Number(b.cost_price);
  } else {
    if (d.delta_qty < 0) throw badRequest('Negative adjustment requires batch_id');
    const [b] = await tx<Array<{ id: string }>>`
      INSERT INTO stock_batches (org_id, product_id, warehouse_id, qty_physical)
      VALUES (${orgId}, ${d.product_id}, ${d.warehouse_id}, ${d.delta_qty})
      RETURNING id
    `;
    batchId = b!.id;
    // costPrice remains 0 — no value to book; treat as qty-only adjustment.
  }

  const abs = Math.abs(d.delta_qty);
  const isIncrease = d.delta_qty > 0;
  const noteText = d.note ? `${d.reason} — ${d.note}` : d.reason;
  await tx`
    INSERT INTO stock_movements (
      org_id, product_id, batch_id,
      from_wh_id, to_wh_id,
      qty, reason, ref_type, ref_id, user_id, note
    ) VALUES (
      ${orgId}, ${d.product_id}, ${batchId},
      ${isIncrease ? null : d.warehouse_id}, ${isIncrease ? d.warehouse_id : null},
      ${abs}, 'adjust', 'stock_adjustment', ${batchId},
      ${userId}, ${noteText}
    )
  `;

  await tx`
    INSERT INTO audit_log (org_id, user_id, action, entity, entity_id, before_json, after_json)
    VALUES (
      ${orgId}, ${userId}, 'update', 'stock_batch', ${batchId},
      ${sql.json({})}, ${sql.json({ delta_qty: d.delta_qty, reason: d.reason })}
    )
  `;

  await postAdjustmentToLedger(tx, {
    orgId,
    userId,
    batchId,
    productId: d.product_id,
    adjustDate: new Date().toISOString().slice(0, 10),
    deltaQty: d.delta_qty,
    costPrice,
    reason: d.reason,
  });

  return { batch_id: batchId, delta_qty: d.delta_qty };
}

/** Org-level stock state across all active warehouses. */
export async function getStockState(
  orgId: string,
  filters: {
    warehouse_id?: string;
    product_id?: string;
    below_reorder?: boolean;
    near_expiry_days?: number;
  } = {},
) {
  const conds = [sql`v.org_id = ${orgId}`, sql`v.warehouse_active = true`];
  if (filters.warehouse_id) conds.push(sql`v.warehouse_id = ${filters.warehouse_id}`);
  if (filters.product_id) conds.push(sql`v.product_id   = ${filters.product_id}`);
  if (filters.below_reorder) {
    conds.push(sql`p.reorder_point IS NOT NULL AND v.sellable < p.reorder_point`);
  }
  if (filters.near_expiry_days !== undefined) {
    conds.push(
      sql`v.nearest_expiry IS NOT NULL AND v.nearest_expiry <= current_date + ${filters.near_expiry_days}::int`,
    );
  }
  const where = conds.reduce((a, b) => sql`${a} AND ${b}`);

  return sql`
    SELECT
      v.warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name, w.type AS warehouse_type,
      v.product_id, p.sku, p.name AS product_name, p.case_qty, p.reorder_point, p.safety_stock,
      v.physical, v.sellable, v.free, v.nearest_expiry
    FROM v_stock_state v
    JOIN warehouses w ON w.id = v.warehouse_id
    JOIN products   p ON p.id = v.product_id
    WHERE ${where}
    ORDER BY w.name, p.name
  `;
}
