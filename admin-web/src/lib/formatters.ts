// Humanize internal tag codes → readable labels.
// These codes come straight from credit-engine.ts, jobs.ts, and admin-entered
// override codes. The UI used to print them raw (`over_credit_limit` etc.)
// which looks awful to operators.

function titleCase(snake: string): string {
  const parts = snake.replace(/[-_]+/g, ' ').trim().split(/\s+/);
  if (parts.length === 0) return snake;
  return parts
    .map((w, i) => (i === 0 ? w[0]?.toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join(' ');
}

function money(raw: string | number): string {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  if (Number.isNaN(n)) return String(raw);
  return `Rs ${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/**
 * Format a credit-engine reason code like:
 *   over_credit_limit:needs=216000.00:available=150000.00
 *   risk_score_high:0.600>=0.600
 *   too_many_broken_promises:3>=3
 *   customer_on_hold
 *   hold_reason:payment dispute
 *   within_limits
 */
export function formatCreditReason(raw: string): string {
  const [code, ...rest] = raw.split(':');
  const meta = rest.join(':'); // preserve any colons inside values
  switch (code) {
    case 'customer_blocked':
      return 'Customer is blocked';
    case 'customer_in_dispute':
      return 'Customer is in dispute';
    case 'customer_on_hold':
      return 'Customer on hold';
    case 'hold_reason':
      return `Hold reason: ${meta}`;
    case 'within_limits':
      return 'Within credit limits';
    case 'over_credit_limit': {
      const needs = /needs=([\d.]+)/.exec(meta)?.[1];
      const avail = /available=([\d.]+)/.exec(meta)?.[1];
      if (needs && avail) {
        return `Over credit limit — needs ${money(needs)}, ${money(avail)} available`;
      }
      return 'Over credit limit';
    }
    case 'risk_score_high': {
      const m = /([\d.]+)>=([\d.]+)/.exec(meta);
      if (m) return `Risk score ${m[1]} ≥ threshold ${m[2]}`;
      return 'Risk score too high';
    }
    case 'too_many_broken_promises': {
      const m = /(\d+)>=(\d+)/.exec(meta);
      if (m) return `${m[1]} broken promises in window (limit ${m[2]})`;
      return 'Too many broken promises';
    }
    default:
      return titleCase(code ?? raw);
  }
}

/** Admin-entered override codes are ad-hoc; fall back to title-case. */
export function formatOverrideCode(code: string): string {
  const known: Record<string, string> = {
    management_override: 'Management override',
    one_time_exception: 'One-time exception',
    special_rate: 'Special rate',
    customer_goodwill: 'Customer goodwill',
    price_correction: 'Price correction',
  };
  return known[code] ?? titleCase(code);
}

/** Priority-list reason tags emitted by services/jobs.ts buildPriorityList. */
export function formatPriorityReason(code: string): string {
  const known: Record<string, string> = {
    promise_due_today: 'Promise due today',
    overdue_30plus: 'Overdue 30+ days',
    high_value: 'High-value account',
    route_order: 'Route order',
    missed_visit: 'Missed visit',
  };
  return known[code] ?? titleCase(code);
}
