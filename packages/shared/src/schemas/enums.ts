import { z } from 'zod';

export const UserRole = z.enum(['sales', 'collector', 'driver', 'accounts', 'admin', 'owner']);
export type UserRole = z.infer<typeof UserRole>;

export const CustomerType = z.enum(['outlet', 'bar', 'hotel', 'retailer', 'other']);
export type CustomerType = z.infer<typeof CustomerType>;

export const CustomerStatus = z.enum(['active', 'hold', 'blocked', 'dispute']);
export type CustomerStatus = z.infer<typeof CustomerStatus>;

export const PaymentTermType = z.enum([
  'cash',
  'same_day',
  'net_7',
  'net_14',
  'net_30',
  'pdc',
  'custom',
]);
export type PaymentTermType = z.infer<typeof PaymentTermType>;

export const WarehouseType = z.enum(['warehouse', 'van']);
export type WarehouseType = z.infer<typeof WarehouseType>;

export const StockMoveReason = z.enum([
  'sale',
  'return',
  'transfer',
  'damage',
  'adjust',
  'cycle_count',
  'load_out',
  'load_in',
  'purchase_in',
  'opening_balance',
]);
export type StockMoveReason = z.infer<typeof StockMoveReason>;

export const OrderStatus = z.enum([
  'draft',
  'held',
  'approved',
  'confirmed',
  'invoiced',
  'cancelled',
  'fulfilled',
]);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const CreditDecision = z.enum(['approve', 'hold', 'reject']);
export type CreditDecision = z.infer<typeof CreditDecision>;

export const InvoiceStatus = z.enum(['open', 'partial', 'paid', 'disputed', 'void']);
export type InvoiceStatus = z.infer<typeof InvoiceStatus>;

export const LedgerEntryType = z.enum([
  'invoice',
  'payment',
  'credit_note',
  'adjustment',
  'write_off',
]);
export type LedgerEntryType = z.infer<typeof LedgerEntryType>;

export const PaymentMode = z.enum(['cash', 'cheque', 'bank', 'upi']);
export type PaymentMode = z.infer<typeof PaymentMode>;

export const PaymentVerification = z.enum(['pending', 'deposited', 'verified', 'bounced']);
export type PaymentVerification = z.infer<typeof PaymentVerification>;

export const VisitOutcome = z.enum([
  'collected',
  'partial',
  'promise',
  'dispute',
  'not_available',
  'refused',
]);
export type VisitOutcome = z.infer<typeof VisitOutcome>;

export const PromiseStatus = z.enum(['open', 'kept', 'broken', 'cancelled']);
export type PromiseStatus = z.infer<typeof PromiseStatus>;

export const TripStatus = z.enum(['planned', 'loaded', 'in_progress', 'closed', 'cancelled']);
export type TripStatus = z.infer<typeof TripStatus>;

export const DeliveryStatus = z.enum(['pending', 'delivered', 'partial', 'failed']);
export type DeliveryStatus = z.infer<typeof DeliveryStatus>;

export const ApprovalStatus = z.enum(['pending', 'approved', 'rejected', 'cancelled']);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const PromoKind = z.enum(['buy_x_get_y', 'case_discount', 'bundle']);
export type PromoKind = z.infer<typeof PromoKind>;

export const ApprovalType = z.enum([
  'credit_override',
  'stock_adjust',
  'credit_note',
  'price_list',
  'customer_hold_release',
  'van_variance',
  'eod_variance',
]);
export type ApprovalType = z.infer<typeof ApprovalType>;

export const ReturnReason = z.enum(['damaged', 'expired', 'refused', 'short_dated', 'other']);
export type ReturnReason = z.infer<typeof ReturnReason>;

export const ShortageReason = z.enum([
  'oos_van',
  'refused_partial',
  'refused_full',
  'damaged_in_transit',
  'wrong_qty_loaded',
  'other',
]);
export type ShortageReason = z.infer<typeof ShortageReason>;

export const AuditAction = z.enum([
  'create',
  'update',
  'delete',
  'override',
  'approve',
  'reject',
  'lock',
  'unlock',
]);
export type AuditAction = z.infer<typeof AuditAction>;

export const SyncEventStatus = z.enum(['pending', 'accepted', 'rejected', 'conflict']);
export type SyncEventStatus = z.infer<typeof SyncEventStatus>;

export const OrderChannel = z.enum(['admin', 'rep_app', 'portal', 'whatsapp', 'sms']);
export type OrderChannel = z.infer<typeof OrderChannel>;
