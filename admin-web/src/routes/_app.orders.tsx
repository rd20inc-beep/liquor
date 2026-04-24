import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
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
  const navigate = useNavigate();
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
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 text-left">Order</th>
                <th className="text-left">Date</th>
                <th className="text-left">Customer</th>
                <th className="text-left">Status</th>
                <th className="text-right">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.items.map((o) => (
                <tr
                  key={o.id}
                  onClick={() => void navigate({ to: '/orders/$id', params: { id: o.id } })}
                  className="cursor-pointer border-t border-slate-800/60 hover:bg-slate-900/60"
                >
                  <td className="py-2 font-mono text-xs text-blue-400">
                    {o.order_no}
                  </td>
                  <td className="text-xs text-slate-400">{o.order_date?.slice(0, 10)}</td>
                  <td>
                    {o.customer_name}{' '}
                    <span className="text-xs text-slate-500">({o.customer_code})</span>
                  </td>
                  <td>
                    <Badge tone={statusTone[o.status] ?? 'slate'}>{o.status}</Badge>
                  </td>
                  <td className="text-right">
                    <Money value={o.total} />
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
