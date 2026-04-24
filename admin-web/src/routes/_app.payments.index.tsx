import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Badge, Button, Card, Input, Money, Spinner, Tile } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/payments/')({
  component: PaymentsList,
});

interface Payment {
  id: string;
  receipt_no: string;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  amount: string;
  mode: 'cash' | 'cheque' | 'bank' | 'upi';
  verification_status: 'pending' | 'deposited' | 'verified' | 'bounced';
  collected_at: string;
  allocated: string;
}

const verTone: Record<string, 'slate' | 'green' | 'amber' | 'red' | 'blue'> = {
  pending: 'amber',
  deposited: 'blue',
  verified: 'green',
  bounced: 'red',
};

type Filter = 'all' | 'pending' | 'verified' | 'bounced';

const TABS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'verified', label: 'Verified' },
  { id: 'bounced', label: 'Bounced' },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function weekAgoISO() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

function PaymentsList() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['payments'],
    queryFn: () => api.get<{ items: Payment[] }>('/payments?limit=200'),
  });

  const items = data?.items ?? [];
  const today = todayISO();
  const weekAgo = weekAgoISO();

  const summary = useMemo(() => {
    let receivedToday = 0;
    let pendingChequesCount = 0;
    let pendingChequesValue = 0;
    let verifiedWeek = 0;
    let advanceTotal = 0;
    for (const p of items) {
      const amt = Number(p.amount);
      const alloc = Number(p.allocated);
      const advance = Math.max(0, amt - alloc);
      const collectedDate = p.collected_at?.slice(0, 10);

      if (p.verification_status === 'verified' && collectedDate === today) {
        receivedToday += amt;
      }
      if (p.mode === 'cheque' && p.verification_status === 'pending') {
        pendingChequesCount += 1;
        pendingChequesValue += amt;
      }
      if (p.verification_status === 'verified' && collectedDate >= weekAgo) {
        verifiedWeek += amt;
      }
      if (p.verification_status === 'verified' && advance > 0) {
        advanceTotal += advance;
      }
    }
    return { receivedToday, pendingChequesCount, pendingChequesValue, verifiedWeek, advanceTotal };
  }, [items, today, weekAgo]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const p of items) c[p.verification_status] = (c[p.verification_status] ?? 0) + 1;
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    const qLower = q.trim().toLowerCase();
    return items.filter((p) => {
      if (filter !== 'all' && p.verification_status !== filter) return false;
      if (
        qLower &&
        !p.receipt_no.toLowerCase().includes(qLower) &&
        !p.customer_name.toLowerCase().includes(qLower) &&
        !p.customer_code.toLowerCase().includes(qLower)
      ) {
        return false;
      }
      return true;
    });
  }, [items, filter, q]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Payments</h1>
        <Link to="/payments/new">
          <Button>+ Record payment</Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tile
          label="Received today"
          value={isLoading ? <Spinner /> : <Money value={summary.receivedToday} />}
          sub="verified only"
          tone="green"
        />
        <Tile
          label="Pending cheques"
          value={isLoading ? <Spinner /> : summary.pendingChequesCount}
          sub={<Money value={summary.pendingChequesValue} />}
          tone={summary.pendingChequesCount > 0 ? 'amber' : 'green'}
        />
        <Tile
          label="Verified 7d"
          value={isLoading ? <Spinner /> : <Money value={summary.verifiedWeek} />}
          sub="trailing week"
        />
        <Tile
          label="Advance held"
          value={isLoading ? <Spinner /> : <Money value={summary.advanceTotal} />}
          sub="unallocated surplus"
          tone="blue"
        />
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-md border border-slate-200 bg-slate-50 p-1">
            {TABS.map((t) => {
              const active = filter === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setFilter(t.id)}
                  className={`rounded px-3 py-1 text-xs font-medium transition ${
                    active
                      ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                      : 'text-slate-500 hover:bg-white hover:text-slate-800'
                  }`}
                >
                  {t.label}
                  <span className="ml-1.5 text-[10px] text-slate-400">{counts[t.id] ?? 0}</span>
                </button>
              );
            })}
          </div>
          <div className="min-w-64 flex-1">
            <Input
              placeholder="Search receipt # / customer…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>

        {isLoading ? (
          <Spinner label="Loading payments" />
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">
            {items.length === 0 ? 'No payments yet.' : 'No payments match this filter.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 text-left">Receipt</th>
                <th className="text-left">Customer</th>
                <th className="text-left">Mode</th>
                <th className="text-left">Status</th>
                <th className="text-left">Collected</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Allocated</th>
                <th className="text-right">Advance</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const amt = Number(p.amount);
                const alloc = Number(p.allocated);
                const advance = Math.max(0, amt - alloc);
                return (
                  <tr
                    key={p.id}
                    onClick={() => void navigate({ to: '/payments/$id', params: { id: p.id } })}
                    className="cursor-pointer border-t border-slate-200 hover:bg-slate-100"
                  >
                    <td className="py-2 font-mono text-xs text-indigo-600">{p.receipt_no}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <Link
                        to="/customers/$id"
                        params={{ id: p.customer_id }}
                        className="text-slate-800 hover:text-indigo-600"
                      >
                        {p.customer_name}
                      </Link>{' '}
                      <span className="text-xs text-slate-500">({p.customer_code})</span>
                    </td>
                    <td>
                      <Badge>{p.mode}</Badge>
                    </td>
                    <td>
                      <Badge tone={verTone[p.verification_status] ?? 'slate'}>
                        {p.verification_status}
                      </Badge>
                    </td>
                    <td className="text-xs text-slate-500">
                      {new Date(p.collected_at).toLocaleDateString()}
                    </td>
                    <td className="text-right">
                      <Money value={amt} />
                    </td>
                    <td className="text-right">
                      <Money value={alloc} />
                    </td>
                    <td className="text-right">
                      {advance > 0 ? (
                        <Money value={advance} />
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
