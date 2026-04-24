import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { Badge, Button, Card, Money, Spinner } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/orders')({
  component: Orders,
});

interface Order {
  id: string;
  order_no: string;
  order_date: string;
  status: string;
  credit_decision: string | null;
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

function Orders() {
  const { data, isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: () => api.get<{ items: Order[] }>('/orders?limit=100'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-100">Orders</h1>
        <Link to="/orders/new">
          <Button>+ New order</Button>
        </Link>
      </div>

      <Card>
        {isLoading ? (
          <Spinner label="Loading orders" />
        ) : data?.items.length === 0 ? (
          <div className="text-sm text-slate-500">No orders yet.</div>
        ) : (
          // Grid-based rows so the whole row can be a real <a href="..."> —
          // native anchor navigation works even if JS routing misbehaves.
          <div className="w-full text-sm">
            <div className="grid grid-cols-[140px_110px_1fr_110px_140px_80px] gap-x-3 border-b border-slate-800 pb-2 text-xs uppercase text-slate-500">
              <div>Order</div>
              <div>Date</div>
              <div>Customer</div>
              <div>Status</div>
              <div className="text-right">Total</div>
              <div className="text-right">&nbsp;</div>
            </div>
            {data?.items.map((o) => (
              <Link
                key={o.id}
                to="/orders/$id"
                params={{ id: o.id }}
                className="grid grid-cols-[140px_110px_1fr_110px_140px_80px] items-center gap-x-3 border-b border-slate-800/60 py-2 text-slate-200 transition hover:bg-slate-900/70"
              >
                <div className="font-mono text-xs text-blue-400 underline-offset-2 hover:underline">
                  {o.order_no}
                </div>
                <div className="text-xs text-slate-400">{o.order_date?.slice(0, 10)}</div>
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
                <div className="text-right text-blue-400">Open →</div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
