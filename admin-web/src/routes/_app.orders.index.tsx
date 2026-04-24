import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Badge, Button, Card, Input, Money, Spinner, Tile } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/orders/')({
  component: Orders,
});

interface Order {
  id: string;
  order_no: string;
  order_date: string;
  status: 'draft' | 'held' | 'approved' | 'confirmed' | 'invoiced' | 'cancelled' | 'fulfilled';
  credit_decision: 'approve' | 'hold' | 'reject' | null;
  customer_code: string;
  customer_name: string;
  total: string;
}

const statusTone: Record<string, 'slate' | 'green' | 'amber' | 'red' | 'blue'> = {
  draft: 'slate',
  held: 'amber',
  approved: 'blue',
  confirmed: 'blue',
  invoiced: 'green',
  fulfilled: 'green',
  cancelled: 'red',
};

type StatusFilter = 'all' | 'held' | 'approved' | 'invoiced' | 'cancelled';

const FILTER_TABS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'held', label: 'Held' },
  { id: 'approved', label: 'Approved' },
  { id: 'invoiced', label: 'Invoiced' },
  { id: 'cancelled', label: 'Cancelled' },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function Orders() {
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [q, setQ] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: () => api.get<{ items: Order[] }>('/orders?limit=200'),
  });

  const items = data?.items ?? [];
  const today = todayISO();

  // Summary metrics over all orders in the window
  const summary = useMemo(() => {
    const todays = items.filter((o) => o.order_date?.slice(0, 10) === today);
    const todaysTotal = todays.reduce((s, o) => s + Number(o.total), 0);
    const held = items.filter((o) => o.status === 'held').length;
    const totals = items
      .filter((o) => o.status !== 'cancelled')
      .map((o) => Number(o.total));
    const avg = totals.length > 0 ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
    return { todaysCount: todays.length, todaysTotal, held, avg };
  }, [items, today]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const o of items) c[o.status] = (c[o.status] ?? 0) + 1;
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    const qLower = q.trim().toLowerCase();
    return items.filter((o) => {
      if (filter !== 'all' && o.status !== filter) return false;
      if (
        qLower &&
        !o.order_no.toLowerCase().includes(qLower) &&
        !o.customer_name.toLowerCase().includes(qLower) &&
        !o.customer_code.toLowerCase().includes(qLower)
      ) {
        return false;
      }
      return true;
    });
  }, [items, filter, q]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Orders</h1>
        <Link to="/orders/new">
          <Button>+ New order</Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tile
          label="Orders today"
          value={isLoading ? <Spinner /> : summary.todaysCount}
          sub={`${summary.held} held · needs decision`}
          tone="blue"
        />
        <Tile
          label="Value booked today"
          value={isLoading ? <Spinner /> : <Money value={summary.todaysTotal} />}
        />
        <Tile
          label="Held orders"
          value={isLoading ? <Spinner /> : summary.held}
          sub={summary.held > 0 ? 'credit engine holds' : 'all clear'}
          tone={summary.held > 0 ? 'amber' : 'green'}
        />
        <Tile
          label="Avg order value"
          value={isLoading ? <Spinner /> : <Money value={summary.avg} />}
          sub={`last ${items.length} orders`}
        />
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-md border border-slate-200 bg-slate-50 p-1">
            {FILTER_TABS.map((t) => {
              const active = filter === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setFilter(t.id)}
                  className={`rounded px-3 py-1 text-xs font-medium transition ${
                    active
                      ? 'bg-slate-300 text-slate-900'
                      : 'text-slate-600 hover:bg-slate-200 hover:text-slate-800'
                  }`}
                >
                  {t.label}
                  <span className="ml-1.5 text-[10px] text-slate-500">
                    {counts[t.id] ?? 0}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="min-w-64 flex-1">
            <Input
              placeholder="Search order # / customer name / code…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>

        {isLoading ? (
          <Spinner label="Loading orders" />
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">
            {items.length === 0
              ? 'No orders yet. Click "+ New order" to create the first one.'
              : 'No orders match this filter.'}
          </div>
        ) : (
          <div className="w-full text-sm">
            <div className="grid grid-cols-[140px_110px_1fr_110px_140px_80px] gap-x-3 border-b border-slate-200 pb-2 text-xs uppercase text-slate-500">
              <div>Order</div>
              <div>Date</div>
              <div>Customer</div>
              <div>Status</div>
              <div className="text-right">Total</div>
              <div />
            </div>
            {filtered.map((o) => (
              <a
                key={o.id}
                href={`/orders/${o.id}`}
                className="grid grid-cols-[140px_110px_1fr_110px_140px_80px] items-center gap-x-3 border-b border-slate-200 py-2 text-slate-800 no-underline transition hover:bg-slate-100/70"
              >
                <div className="font-mono text-xs text-amber-400">{o.order_no}</div>
                <div className="text-xs text-slate-600">{o.order_date?.slice(0, 10)}</div>
                <div>
                  {o.customer_name}{' '}
                  <span className="text-xs text-slate-500">({o.customer_code})</span>
                </div>
                <div>
                  <Badge tone={statusTone[o.status] ?? 'slate'}>{o.status}</Badge>
                </div>
                <div className="text-right">
                  <Money value={o.total} />
                </div>
                <div className="text-right text-amber-400">Open →</div>
              </a>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
