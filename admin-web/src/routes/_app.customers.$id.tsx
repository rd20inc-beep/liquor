import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge, Button, Card, ErrorNote, Money, Select, Spinner, Tile } from '../components/ui';
import { api, ApiError } from '../lib/api';

export const Route = createFileRoute('/_app/customers/$id')({
  component: CustomerDetail,
});

interface Customer360 {
  customer: {
    id: string;
    code: string;
    name: string;
    status: 'active' | 'hold' | 'blocked' | 'dispute';
    phone: string | null;
    address: string | null;
    credit_limit: string;
    outstanding_total: string;
    available_credit: string;
    risk_score: string;
    payment_term_code: string | null;
    price_list_id: string | null;
  };
  aging: Record<string, string>;
  open_invoices: Array<{
    id: string;
    invoice_no: string;
    invoice_date: string;
    due_date: string;
    total: string;
    outstanding: string;
    status: string;
    days_overdue: number;
  }>;
  recent_orders: Array<{
    id: string;
    order_no: string;
    order_date: string;
    status: string;
    total: string;
  }>;
  recent_payments: Array<{
    id: string;
    receipt_no: string;
    amount: string;
    mode: string;
    verification_status: string;
    collected_at: string;
  }>;
  recent_visits: Array<{
    id: string;
    started_at: string;
    outcome: string | null;
    note: string | null;
  }>;
  suggestions: {
    likely_basket: Array<{ product_id: string; sku: string; name: string; avg_qty: string }>;
    due_for_reorder: boolean;
  };
}

function CustomerDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [editPriceList, setEditPriceList] = useState(false);
  const [pickedList, setPickedList] = useState<string>('');
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['customer360', id],
    queryFn: () => api.get<Customer360>(`/customers/${id}/360`),
  });

  const listsQ = useQuery({
    queryKey: ['masters', 'price-lists'],
    queryFn: () => api.get<{ items: Array<{ id: string; name: string; is_default: boolean }> }>('/price-lists'),
    enabled: editPriceList,
  });

  const setList = useMutation({
    mutationFn: (value: string | null) =>
      api.patch(`/customers/${id}`, { price_list_id: value }),
    onSuccess: () => {
      setActionError(null);
      setEditPriceList(false);
      qc.invalidateQueries({ queryKey: ['customer360', id] });
    },
    onError: (e) =>
      setActionError(e instanceof ApiError ? e.message : 'Could not update price list'),
  });

  if (isLoading) return <Spinner label="Loading customer" />;
  if (isError || !data)
    return <div className="text-sm text-red-400">Customer not found.</div>;

  const c = data.customer;
  const currentList = listsQ.data?.items.find((l) => l.id === c.price_list_id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Customer</div>
          <h1 className="text-2xl font-semibold text-slate-100">
            {c.name}
            <span className="ml-3 text-sm text-slate-500">({c.code})</span>
          </h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-slate-400">
            <Badge
              tone={
                c.status === 'active' ? 'green' : c.status === 'hold' ? 'amber' : 'red'
              }
            >
              {c.status}
            </Badge>
            <span>{c.phone ?? '—'}</span>
            <span>•</span>
            <span>Term: {c.payment_term_code ?? '—'}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/orders/new" search={{ customer_id: id }}>
            <Button>+ New order</Button>
          </Link>
          <Link to="/payments/new" search={{ customer_id: id }}>
            <Button variant="secondary">Record payment</Button>
          </Link>
          <Link to="/customers" className="text-sm text-violet-400 hover:underline">
            ← All customers
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tile label="Credit limit" value={<Money value={c.credit_limit} />} />
        <Tile
          label="Outstanding"
          value={<Money value={c.outstanding_total} />}
          tone="amber"
        />
        <Tile
          label="Available"
          value={<Money value={c.available_credit} />}
          tone="blue"
        />
        <Tile
          label="Risk score"
          value={Number(c.risk_score).toFixed(2)}
          tone={
            Number(c.risk_score) >= 0.6
              ? 'red'
              : Number(c.risk_score) >= 0.3
                ? 'amber'
                : 'green'
          }
        />
      </div>

      {actionError && <ErrorNote message={actionError} />}

      <Card title="Pricing">
        {!editPriceList ? (
          <div className="flex items-center justify-between text-sm">
            <div>
              <span className="text-slate-400">Price list: </span>
              {c.price_list_id ? (
                <Link
                  to="/price-lists/$id"
                  params={{ id: c.price_list_id }}
                  className="text-violet-400 underline-offset-2 hover:underline"
                >
                  {currentList?.name ?? c.price_list_id.slice(0, 8) + '…'}
                </Link>
              ) : (
                <span className="text-slate-200">default (org-wide)</span>
              )}
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                setPickedList(c.price_list_id ?? '');
                setEditPriceList(true);
              }}
            >
              Change
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setList.mutate(pickedList || null);
            }}
          >
            <div className="min-w-64 flex-1">
              <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
                Price list
              </span>
              <Select
                value={pickedList}
                onChange={(e) => setPickedList(e.target.value)}
              >
                <option value="">— use default —</option>
                {listsQ.data?.items.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.is_default ? ' (default)' : ''}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" disabled={setList.isPending}>
              {setList.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditPriceList(false)}>
              Cancel
            </Button>
          </form>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Open invoices">
          {data.open_invoices.length === 0 ? (
            <div className="text-sm text-slate-500">No open invoices.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-1 text-left">Invoice</th>
                  <th className="text-left">Due</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Outstanding</th>
                  <th className="text-right">Overdue</th>
                </tr>
              </thead>
              <tbody>
                {data.open_invoices.map((inv) => (
                  <tr key={inv.id} className="border-t border-slate-800/60">
                    <td className="py-1.5 font-mono text-xs">
                      <Link
                        to="/invoices/$id"
                        params={{ id: inv.id }}
                        className="text-violet-400 underline-offset-2 hover:underline"
                      >
                        {inv.invoice_no}
                      </Link>
                    </td>
                    <td className="text-xs text-slate-400">{inv.due_date?.slice(0, 10)}</td>
                    <td className="text-right">
                      <Money value={inv.total} />
                    </td>
                    <td className="text-right">
                      <Money value={inv.outstanding} />
                    </td>
                    <td className="text-right text-xs">
                      {inv.days_overdue > 0 ? `${inv.days_overdue}d` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Recent orders">
          {data.recent_orders.length === 0 ? (
            <div className="text-sm text-slate-500">No recent orders.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-1 text-left">Order</th>
                  <th className="text-left">Date</th>
                  <th className="text-left">Status</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_orders.map((o) => (
                  <tr key={o.id} className="border-t border-slate-800/60">
                    <td className="py-1.5 font-mono text-xs">
                      <Link
                        to="/orders/$id"
                        params={{ id: o.id }}
                        className="text-violet-400 underline-offset-2 hover:underline"
                      >
                        {o.order_no}
                      </Link>
                    </td>
                    <td className="text-xs text-slate-400">{o.order_date}</td>
                    <td>
                      <Badge>{o.status}</Badge>
                    </td>
                    <td className="text-right">
                      <Money value={o.total} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Recent payments">
          {data.recent_payments.length === 0 ? (
            <div className="text-sm text-slate-500">No payments yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-1 text-left">Receipt</th>
                  <th className="text-left">Mode</th>
                  <th className="text-left">Status</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_payments.map((p) => (
                  <tr key={p.id} className="border-t border-slate-800/60">
                    <td className="py-1.5 font-mono text-xs">
                      <Link
                        to="/payments/$id"
                        params={{ id: p.id }}
                        className="text-violet-400 underline-offset-2 hover:underline"
                      >
                        {p.receipt_no}
                      </Link>
                    </td>
                    <td>
                      <Badge>{p.mode}</Badge>
                    </td>
                    <td>
                      <Badge
                        tone={
                          p.verification_status === 'verified'
                            ? 'green'
                            : p.verification_status === 'bounced'
                              ? 'red'
                              : 'amber'
                        }
                      >
                        {p.verification_status}
                      </Badge>
                    </td>
                    <td className="text-right">
                      <Money value={p.amount} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Likely reorder basket">
          {data.suggestions.likely_basket.length === 0 ? (
            <div className="text-sm text-slate-500">Not enough history.</div>
          ) : (
            <ul className="space-y-1 text-sm">
              {data.suggestions.likely_basket.map((p) => (
                <li key={p.product_id} className="flex justify-between">
                  <span className="text-slate-200">{p.name}</span>
                  <span className="text-slate-500">
                    avg qty {Number(p.avg_qty).toFixed(0)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {data.suggestions.due_for_reorder && (
            <div className="mt-3 rounded-md border border-violet-900/50 bg-violet-950/40 p-2 text-xs text-violet-300">
              Due for reorder based on past cadence.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
