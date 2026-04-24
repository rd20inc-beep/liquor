import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Badge, Card, Input, Money, Spinner, Tile } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/invoices/')({
  component: Invoices,
});

interface Invoice {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string;
  customer_code: string;
  customer_name: string;
  total: string;
  outstanding: string;
  status: 'open' | 'partial' | 'paid' | 'disputed' | 'void';
  days_overdue: number;
}

const statusTone: Record<string, 'slate' | 'green' | 'amber' | 'red' | 'blue'> = {
  open: 'amber',
  partial: 'amber',
  paid: 'green',
  disputed: 'red',
  void: 'slate',
};

type Filter = 'all' | 'open' | 'partial' | 'paid' | 'disputed';

const TABS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'partial', label: 'Partial' },
  { id: 'paid', label: 'Paid' },
  { id: 'disputed', label: 'Disputed' },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function Invoices() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => api.get<{ items: Invoice[] }>('/invoices?limit=200'),
  });

  const items = data?.items ?? [];
  const today = todayISO();
  const monthStart = today.slice(0, 8) + '01';

  const summary = useMemo(() => {
    let totalOutstanding = 0;
    let overdueCount = 0;
    let overdueValue = 0;
    let issuedToday = 0;
    let paidThisMonthCount = 0;
    let paidThisMonthValue = 0;
    for (const i of items) {
      const out = Number(i.outstanding);
      totalOutstanding += out;
      if (i.days_overdue > 0 && out > 0) {
        overdueCount += 1;
        overdueValue += out;
      }
      if (i.invoice_date?.slice(0, 10) === today) issuedToday += 1;
      if (i.status === 'paid' && i.invoice_date?.slice(0, 10) >= monthStart) {
        paidThisMonthCount += 1;
        paidThisMonthValue += Number(i.total);
      }
    }
    return {
      totalOutstanding,
      overdueCount,
      overdueValue,
      issuedToday,
      paidThisMonthCount,
      paidThisMonthValue,
    };
  }, [items, today, monthStart]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const i of items) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    const qLower = q.trim().toLowerCase();
    return items.filter((i) => {
      if (filter !== 'all' && i.status !== filter) return false;
      if (
        qLower &&
        !i.invoice_no.toLowerCase().includes(qLower) &&
        !i.customer_name.toLowerCase().includes(qLower) &&
        !i.customer_code.toLowerCase().includes(qLower)
      ) {
        return false;
      }
      return true;
    });
  }, [items, filter, q]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Invoices</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tile
          label="Outstanding"
          value={isLoading ? <Spinner /> : <Money value={summary.totalOutstanding} />}
          sub={`${items.filter((i) => Number(i.outstanding) > 0).length} open`}
          tone="blue"
        />
        <Tile
          label="Overdue"
          value={isLoading ? <Spinner /> : summary.overdueCount}
          sub={<Money value={summary.overdueValue} />}
          tone={summary.overdueCount > 0 ? 'amber' : 'green'}
        />
        <Tile
          label="Issued today"
          value={isLoading ? <Spinner /> : summary.issuedToday}
          sub="new invoices"
        />
        <Tile
          label="Paid this month"
          value={isLoading ? <Spinner /> : summary.paidThisMonthCount}
          sub={<Money value={summary.paidThisMonthValue} />}
          tone="green"
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
              placeholder="Search invoice # / customer…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>

        {isLoading ? (
          <Spinner label="Loading invoices" />
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">
            {items.length === 0 ? 'No invoices yet.' : 'No invoices match this filter.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 text-left">Invoice</th>
                <th className="text-left">Customer</th>
                <th className="text-left">Due</th>
                <th className="text-left">Status</th>
                <th className="text-right">Total</th>
                <th className="text-right">Outstanding</th>
                <th className="text-right">Overdue</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr
                  key={i.id}
                  onClick={() => void navigate({ to: '/invoices/$id', params: { id: i.id } })}
                  className="cursor-pointer border-t border-slate-200 hover:bg-slate-100"
                >
                  <td className="py-2 font-mono text-xs text-indigo-600">{i.invoice_no}</td>
                  <td>
                    {i.customer_name}{' '}
                    <span className="text-xs text-slate-500">({i.customer_code})</span>
                  </td>
                  <td className="text-xs text-slate-500">{i.due_date?.slice(0, 10)}</td>
                  <td>
                    <Badge tone={statusTone[i.status] ?? 'slate'}>{i.status}</Badge>
                  </td>
                  <td className="text-right">
                    <Money value={i.total} />
                  </td>
                  <td className="text-right">
                    <Money value={i.outstanding} />
                  </td>
                  <td className="text-right text-xs">
                    {i.days_overdue > 0 ? (
                      <span className="text-red-600">{i.days_overdue}d</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="text-right text-sm text-slate-500">Open →</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
