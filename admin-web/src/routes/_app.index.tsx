import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { Badge, Card, Money, Spinner, Tile } from '../components/ui';
import { api } from '../lib/api';
import { formatPriorityReason } from '../lib/formatters';

export const Route = createFileRoute('/_app/')({
  component: Dashboard,
});

interface Invoice {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  total: string;
  outstanding: string;
  status: string;
  days_overdue: number;
}

interface Payment {
  id: string;
  receipt_no: string;
  amount: string;
  mode: string;
  verification_status: string;
  collected_at: string;
}

interface Order {
  id: string;
  order_no: string;
  order_date: string;
  status: string;
  customer_name: string;
  customer_code: string;
  total: string;
}

interface PriorityRow {
  sequence: number;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  score: string;
  reason: string;
  outstanding: string;
}

interface Approval {
  id: string;
  type: string;
  reason: string | null;
  requested_by_name: string | null;
  created_at: string;
}

function todayISO() {
  // Local date string for comparison against `invoice_date` etc.
  return new Date().toISOString().slice(0, 10);
}

function Dashboard() {
  const today = todayISO();

  const invoicesQ = useQuery({
    queryKey: ['dashboard', 'invoices'],
    queryFn: () => api.get<{ items: Invoice[] }>('/invoices?limit=200'),
  });
  const paymentsTodayQ = useQuery({
    queryKey: ['dashboard', 'payments-today', today],
    queryFn: () =>
      api.get<{ items: Payment[] }>(`/payments?from=${today}&to=${today}&limit=200`),
  });
  const heldOrdersQ = useQuery({
    queryKey: ['dashboard', 'orders-held'],
    queryFn: () => api.get<{ items: Order[] }>('/orders?status=held&limit=50'),
  });
  const priorityQ = useQuery({
    queryKey: ['dashboard', 'priority'],
    queryFn: () => api.get<{ items: PriorityRow[] }>('/priority-list'),
    retry: false,
  });
  const pendingQ = useQuery({
    queryKey: ['dashboard', 'pending-approvals'],
    queryFn: () => api.get<{ items: Approval[] }>('/approvals?status=pending&limit=10'),
  });

  const invoices = invoicesQ.data?.items ?? [];
  const aging = invoices.reduce(
    (acc, i) => {
      const out = Number(i.outstanding);
      acc.outstanding += out;
      if (i.days_overdue > 60) acc.over60 += out;
      else if (i.days_overdue > 30) acc.over30 += out;
      else if (i.days_overdue > 15) acc.over15 += out;
      else if (i.days_overdue > 7) acc.over7 += out;
      else if (i.days_overdue > 0) acc.over1 += out;
      return acc;
    },
    { outstanding: 0, over1: 0, over7: 0, over15: 0, over30: 0, over60: 0 },
  );

  const salesToday = invoices
    .filter((i) => i.invoice_date?.slice(0, 10) === today)
    .reduce((s, i) => s + Number(i.total), 0);

  const verifiedPaymentsToday = (paymentsTodayQ.data?.items ?? []).filter(
    (p) => p.verification_status === 'verified',
  );
  const collectedToday = verifiedPaymentsToday.reduce((s, p) => s + Number(p.amount), 0);
  const pendingChequeTodayCount = (paymentsTodayQ.data?.items ?? []).filter(
    (p) => p.verification_status === 'pending',
  ).length;

  const gap = salesToday - collectedToday;

  // Top 5 overdue customers — group open invoices by customer, sort by outstanding
  const overdueByCustomer = new Map<
    string,
    { id: string; code: string; name: string; outstanding: number; oldest: number; count: number }
  >();
  for (const inv of invoices) {
    if (inv.days_overdue <= 0) continue;
    const prev = overdueByCustomer.get(inv.customer_id);
    if (prev) {
      prev.outstanding += Number(inv.outstanding);
      prev.oldest = Math.max(prev.oldest, inv.days_overdue);
      prev.count += 1;
    } else {
      overdueByCustomer.set(inv.customer_id, {
        id: inv.customer_id,
        code: inv.customer_code,
        name: inv.customer_name,
        outstanding: Number(inv.outstanding),
        oldest: inv.days_overdue,
        count: 1,
      });
    }
  }
  const topOverdue = [...overdueByCustomer.values()]
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, 5);

  const heldOrders = heldOrdersQ.data?.items ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>

      {/* Today's money movement */}
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-600">
            Today
          </h2>
          <span className="text-xs text-slate-500">{today}</span>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Tile
            label="Sales today"
            value={invoicesQ.isLoading ? <Spinner /> : <Money value={salesToday} />}
            sub={`${invoices.filter((i) => i.invoice_date?.slice(0, 10) === today).length} invoice(s)`}
            tone="blue"
          />
          <Tile
            label="Collected today"
            value={
              paymentsTodayQ.isLoading ? (
                <Spinner />
              ) : (
                <Money value={collectedToday} />
              )
            }
            sub={`${verifiedPaymentsToday.length} verified`}
            tone="green"
          />
          <Tile
            label="Gap"
            value={
              invoicesQ.isLoading || paymentsTodayQ.isLoading ? <Spinner /> : <Money value={gap} />
            }
            sub={gap > 0 ? 'unreceived' : 'net collected'}
            tone={gap > 0 ? 'amber' : 'green'}
          />
          <Tile
            label="Pending cheques"
            value={paymentsTodayQ.isLoading ? <Spinner /> : pendingChequeTodayCount}
            sub="awaiting verification"
            tone={pendingChequeTodayCount > 0 ? 'amber' : undefined}
          />
        </div>
      </section>

      {/* Exposure + pipeline */}
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-600">
            Exposure
          </h2>
          <Link to="/invoices" className="text-xs text-amber-400 hover:underline">
            Invoices →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          <Tile
            label="Total outstanding"
            value={invoicesQ.isLoading ? <Spinner /> : <Money value={aging.outstanding} />}
            tone="blue"
          />
          <Tile
            label="Overdue 1–7"
            value={<Money value={aging.over1} />}
            tone={aging.over1 > 0 ? 'amber' : undefined}
          />
          <Tile
            label="Overdue 8–15"
            value={<Money value={aging.over7} />}
            tone={aging.over7 > 0 ? 'amber' : undefined}
          />
          <Tile
            label="Overdue 16–30"
            value={<Money value={aging.over15} />}
            tone={aging.over15 > 0 ? 'amber' : undefined}
          />
          <Tile
            label="Overdue 31–60"
            value={<Money value={aging.over30} />}
            tone={aging.over30 > 0 ? 'red' : undefined}
          />
          <Tile
            label="Overdue 60+"
            value={<Money value={aging.over60} />}
            tone={aging.over60 > 0 ? 'red' : undefined}
          />
        </div>
      </section>

      {/* Held orders & approvals row */}
      <section>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card
            title={
              <span className="flex items-center gap-2">
                Held orders
                <Badge tone={heldOrders.length > 0 ? 'amber' : 'slate'}>
                  {heldOrdersQ.isLoading ? '…' : heldOrders.length}
                </Badge>
              </span>
            }
            actions={
              <Link to="/orders" className="text-xs text-amber-400 hover:underline">
                Review →
              </Link>
            }
          >
            {heldOrdersQ.isLoading ? (
              <Spinner />
            ) : heldOrders.length === 0 ? (
              <div className="text-sm text-slate-500">No held orders.</div>
            ) : (
              <ul className="divide-y divide-slate-800/60">
                {heldOrders.slice(0, 5).map((o) => (
                  <li key={o.id} className="py-2 text-sm">
                    <Link
                      to="/orders/$id"
                      params={{ id: o.id }}
                      className="flex items-center justify-between hover:text-amber-400"
                    >
                      <div>
                        <div className="text-slate-800">
                          {o.customer_name}{' '}
                          <span className="text-xs text-slate-500">({o.customer_code})</span>
                        </div>
                        <div className="text-xs text-slate-500">
                          {o.order_no} · {o.order_date?.slice(0, 10)}
                        </div>
                      </div>
                      <Money value={o.total} />
                    </Link>
                  </li>
                ))}
                {heldOrders.length > 5 && (
                  <li className="pt-2 text-xs text-slate-500">
                    + {heldOrders.length - 5} more
                  </li>
                )}
              </ul>
            )}
          </Card>

          <Card
            title={
              <span className="flex items-center gap-2">
                Pending approvals
                <Badge tone={(pendingQ.data?.items.length ?? 0) > 0 ? 'amber' : 'slate'}>
                  {pendingQ.isLoading ? '…' : (pendingQ.data?.items.length ?? 0)}
                </Badge>
              </span>
            }
            actions={
              <Link to="/approvals" className="text-xs text-amber-400 hover:underline">
                Inbox →
              </Link>
            }
          >
            {pendingQ.isLoading ? (
              <Spinner />
            ) : pendingQ.data?.items.length === 0 ? (
              <div className="text-sm text-slate-500">No pending approvals.</div>
            ) : (
              <ul className="divide-y divide-slate-800/60">
                {pendingQ.data?.items.slice(0, 5).map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge tone="blue">{a.type}</Badge>
                        <span className="text-slate-800">{a.reason ?? '—'}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        by {a.requested_by_name ?? 'unknown'} ·{' '}
                        {new Date(a.created_at).toLocaleString()}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </section>

      {/* Priority list + top overdue */}
      <section>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card
            title="Today's priority list"
            actions={
              <Link to="/customers" className="text-xs text-amber-400 hover:underline">
                Customers →
              </Link>
            }
          >
            {priorityQ.isLoading ? (
              <Spinner label="Loading priority list" />
            ) : priorityQ.isError ? (
              <div className="text-sm text-slate-500">
                Priority list unavailable — run{' '}
                <code className="text-slate-600">POST /admin/jobs/build_priority_list/run</code>.
              </div>
            ) : priorityQ.data?.items.length === 0 ? (
              <div className="text-sm text-slate-500">Nothing to chase today.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-1 text-left">#</th>
                    <th className="text-left">Customer</th>
                    <th className="text-left">Reason</th>
                    <th className="text-right">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {priorityQ.data?.items.slice(0, 8).map((r) => (
                    <tr
                      key={`${r.customer_id}-${r.sequence}`}
                      className="border-t border-slate-200"
                    >
                      <td className="py-1.5 text-slate-500">{r.sequence}</td>
                      <td>
                        <Link
                          to="/customers/$id"
                          params={{ id: r.customer_id }}
                          className="text-slate-800 hover:text-amber-400"
                        >
                          {r.customer_name}
                        </Link>
                      </td>
                      <td className="text-xs text-slate-600">{formatPriorityReason(r.reason)}</td>
                      <td className="text-right">
                        <Money value={r.outstanding} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card
            title={
              <span className="flex items-center gap-2">
                Top overdue customers
                <Badge tone={topOverdue.length > 0 ? 'red' : 'slate'}>
                  {topOverdue.length}
                </Badge>
              </span>
            }
          >
            {invoicesQ.isLoading ? (
              <Spinner />
            ) : topOverdue.length === 0 ? (
              <div className="text-sm text-slate-500">Nothing overdue.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-1 text-left">Customer</th>
                    <th className="text-right">Invoices</th>
                    <th className="text-right">Oldest</th>
                    <th className="text-right">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {topOverdue.map((c) => (
                    <tr key={c.id} className="border-t border-slate-200">
                      <td className="py-1.5">
                        <Link
                          to="/customers/$id"
                          params={{ id: c.id }}
                          className="text-slate-800 hover:text-amber-400"
                        >
                          {c.name}
                        </Link>
                        <span className="ml-1 text-xs text-slate-500">({c.code})</span>
                      </td>
                      <td className="text-right text-slate-600">{c.count}</td>
                      <td className="text-right">
                        <span
                          className={
                            c.oldest > 60
                              ? 'text-red-600'
                              : c.oldest > 30
                                ? 'text-amber-400'
                                : 'text-slate-700'
                          }
                        >
                          {c.oldest}d
                        </span>
                      </td>
                      <td className="text-right">
                        <Money value={c.outstanding} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      </section>
    </div>
  );
}
