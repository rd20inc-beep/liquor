import type { CreditDecision, CustomerStatus } from '@liquor/shared';

export interface CustomerCreditSnapshot {
  status: CustomerStatus;
  hold_reason: string | null;
  available_credit: number;
  outstanding_total: number;
  risk_score: number;
  broken_promises_30d: number;
  promise_amount: number;
  promise_due_date: string | null;
  high_value: boolean;
}

export interface CreditConfig {
  risk_threshold: number; // 0..1, org_config.risk_threshold
  broken_promise_limit: number; // org_config.broken_promise_limit
}

export interface CreditDecisionResult {
  decision: CreditDecision;
  reasons: string[];
  risk_score: number;
  available_credit: number;
}

/**
 * Pure credit decision. Rules (v1, see PRD §6 W1):
 *   1. Customer status must be 'active' — blocked/hold/dispute → reject
 *   2. available_credit >= order_total — else hold
 *   3. risk_score < risk_threshold — else hold
 *   4. broken_promises_30d < broken_promise_limit — else hold
 * Reasons list is always populated so callers can show *why* without re-deriving.
 */
export function decide(
  customer: CustomerCreditSnapshot,
  orderTotal: number,
  config: CreditConfig,
): CreditDecisionResult {
  const reasons: string[] = [];

  // Hard rejects first (do not fall through to hold reasons)
  if (customer.status === 'blocked') {
    reasons.push('customer_blocked');
    return {
      decision: 'reject',
      reasons,
      risk_score: customer.risk_score,
      available_credit: customer.available_credit,
    };
  }
  if (customer.status === 'dispute') {
    reasons.push('customer_in_dispute');
    return {
      decision: 'reject',
      reasons,
      risk_score: customer.risk_score,
      available_credit: customer.available_credit,
    };
  }
  if (customer.status === 'hold') {
    reasons.push('customer_on_hold');
    if (customer.hold_reason) reasons.push(`hold_reason:${customer.hold_reason}`);
    return {
      decision: 'reject',
      reasons,
      risk_score: customer.risk_score,
      available_credit: customer.available_credit,
    };
  }

  // Soft holds (any one triggers hold for manual review)
  if (orderTotal > customer.available_credit) {
    reasons.push(
      `over_credit_limit:needs=${orderTotal.toFixed(2)}:available=${customer.available_credit.toFixed(2)}`,
    );
  }
  if (customer.risk_score >= config.risk_threshold) {
    reasons.push(`risk_score_high:${customer.risk_score}>=${config.risk_threshold}`);
  }
  if (customer.broken_promises_30d >= config.broken_promise_limit) {
    reasons.push(
      `too_many_broken_promises:${customer.broken_promises_30d}>=${config.broken_promise_limit}`,
    );
  }

  if (reasons.length > 0) {
    return {
      decision: 'hold',
      reasons,
      risk_score: customer.risk_score,
      available_credit: customer.available_credit,
    };
  }

  reasons.push('within_limits');
  return {
    decision: 'approve',
    reasons,
    risk_score: customer.risk_score,
    available_credit: customer.available_credit,
  };
}
