import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge, Button, Card, ErrorNote, Spinner } from '../components/ui';
import { api, ApiError, tokens } from '../lib/api';

export const Route = createFileRoute('/_app/approvals')({
  component: Approvals,
});

interface Approval {
  id: string;
  type: string;
  ref_type: string;
  ref_id: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reason: string | null;
  payload: unknown;
  created_at: string;
  requested_by_name: string | null;
  approver_name: string | null;
}

const typeLabels: Record<string, string> = {
  stock_adjust: 'Stock adjustment',
  credit_override: 'Credit-limit override',
  price_override: 'Price override',
  customer_hold_release: 'Release hold',
  van_variance: 'Van EOD variance',
  eod_variance: 'EOD variance',
  price_list: 'Price list change',
  discount_over: 'Discount over threshold',
};

function prettyJSON(v: unknown): string {
  if (v === null || v === undefined) return '—';
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function Summary({ type, payload }: { type: string; payload: unknown }) {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (type === 'stock_adjust') {
    const delta = Number(p.delta_qty);
    return (
      <div className="text-xs text-slate-600">
        Adjust{' '}
        <span className={delta < 0 ? 'font-semibold text-red-700' : 'font-semibold text-emerald-700'}>
          {delta > 0 ? `+${delta}` : delta}
        </span>{' '}
        on product{' '}
        <code className="text-slate-800">{String(p.product_id ?? '').slice(0, 8)}…</code>{' '}
        at warehouse{' '}
        <code className="text-slate-800">{String(p.warehouse_id ?? '').slice(0, 8)}…</code>
        {p.batch_id ? (
          <>
            {' '}
            · batch{' '}
            <code className="text-slate-800">{String(p.batch_id).slice(0, 8)}…</code>
          </>
        ) : null}
        {p.reason ? <> · {String(p.reason)}</> : null}
      </div>
    );
  }
  if (type === 'credit_override' || type === 'over_credit_limit') {
    return (
      <div className="text-xs text-slate-600">
        Allow order despite credit limit
        {p.amount != null ? <> · PKR {String(p.amount)}</> : null}
      </div>
    );
  }
  if (type === 'price_override') {
    return (
      <div className="text-xs text-slate-600">
        Override price
        {p.list_price != null ? <> from PKR {String(p.list_price)}</> : null}
        {p.new_price != null ? <> → PKR {String(p.new_price)}</> : null}
      </div>
    );
  }
  if (type === 'customer_hold_release') {
    return (
      <div className="text-xs text-slate-600">
        Release customer hold{p.customer_id ? <> on <code className="text-slate-800">{String(p.customer_id).slice(0, 8)}…</code></> : null}
      </div>
    );
  }
  return null;
}

function Approvals() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const user = tokens.user();
  const canDecide = user?.role === 'admin' || user?.role === 'owner';

  const listQ = useQuery({
    queryKey: ['approvals', 'pending'],
    queryFn: () => api.get<{ items: Approval[] }>('/approvals?status=pending&limit=100'),
  });

  const decide = useMutation({
    mutationFn: (args: { id: string; decision: 'approve' | 'reject' }) =>
      api.post(`/approvals/${args.id}/decide`, { decision: args.decision }),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['approvals'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : 'Decision failed');
    },
  });

  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const items = listQ.data?.items ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Approvals</h1>
      {error && <ErrorNote message={error} />}
      <Card>
        {listQ.isLoading ? (
          <Spinner label="Loading" />
        ) : items.length === 0 ? (
          <div className="text-sm text-slate-500">No pending approvals.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((a) => {
              const isOpen = expanded.has(a.id);
              const label = typeLabels[a.type] ?? a.type;
              return (
                <div key={a.id}>
                  <div className="grid grid-cols-[180px_1fr_140px_150px_200px] items-start gap-x-3 py-3">
                    <button
                      type="button"
                      onClick={() => toggle(a.id)}
                      className="flex items-center gap-2 text-left"
                    >
                      <span className="text-slate-400">{isOpen ? '▾' : '▸'}</span>
                      <Badge tone="blue">{label}</Badge>
                    </button>
                    <div className="min-w-0">
                      <div className="text-sm text-slate-800">{a.reason ?? '—'}</div>
                      <Summary type={a.type} payload={a.payload} />
                    </div>
                    <div className="text-sm text-slate-600">
                      {a.requested_by_name ?? 'unknown'}
                    </div>
                    <div className="text-xs text-slate-500">
                      {new Date(a.created_at).toLocaleString()}
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        disabled={!canDecide || decide.isPending}
                        onClick={() => decide.mutate({ id: a.id, decision: 'reject' })}
                      >
                        Reject
                      </Button>
                      <Button
                        disabled={!canDecide || decide.isPending}
                        onClick={() => decide.mutate({ id: a.id, decision: 'approve' })}
                      >
                        Approve
                      </Button>
                    </div>
                  </div>
                  {isOpen && (
                    <div className="grid grid-cols-1 gap-3 border-t border-slate-100 bg-slate-50 p-3 md:grid-cols-[1fr_1fr]">
                      <div>
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          Request
                        </div>
                        <dl className="space-y-1 text-xs text-slate-700">
                          <div className="flex gap-2">
                            <dt className="w-24 text-slate-500">Type</dt>
                            <dd className="font-mono text-slate-800">{a.type}</dd>
                          </div>
                          <div className="flex gap-2">
                            <dt className="w-24 text-slate-500">Ref</dt>
                            <dd className="font-mono text-slate-800">
                              {a.ref_type} · {a.ref_id.slice(0, 8)}…
                            </dd>
                          </div>
                          <div className="flex gap-2">
                            <dt className="w-24 text-slate-500">Approval ID</dt>
                            <dd className="font-mono text-slate-800">{a.id.slice(0, 8)}…</dd>
                          </div>
                          {a.reason && (
                            <div className="flex gap-2">
                              <dt className="w-24 text-slate-500">Reason</dt>
                              <dd className="text-slate-800">{a.reason}</dd>
                            </div>
                          )}
                        </dl>
                      </div>
                      <div>
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          Payload
                        </div>
                        <pre className="max-h-72 overflow-auto rounded-md border border-slate-200 bg-white p-2 text-xs text-slate-800">
                          {prettyJSON(a.payload)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {!canDecide && (
          <div className="mt-3 text-xs text-slate-500">
            Only admin or owner can decide approvals.
          </div>
        )}
      </Card>
    </div>
  );
}
