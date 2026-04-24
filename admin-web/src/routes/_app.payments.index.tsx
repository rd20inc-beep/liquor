import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { Badge, Button, Card, Money, Spinner } from '../components/ui';
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
  mode: string;
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

function PaymentsList() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['payments'],
    queryFn: () => api.get<{ items: Payment[] }>('/payments?limit=100'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Payments</h1>
        <Link to="/payments/new">
          <Button>+ Record payment</Button>
        </Link>
      </div>

      <Card>
        {isLoading ? (
          <Spinner label="Loading payments" />
        ) : data?.items.length === 0 ? (
          <div className="text-sm text-slate-500">No payments yet.</div>
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
              {data?.items.map((p) => {
                const amt = Number(p.amount);
                const alloc = Number(p.allocated);
                const advance = Math.max(0, amt - alloc);
                return (
                  <tr
                    key={p.id}
                    onClick={() => void navigate({ to: '/payments/$id', params: { id: p.id } })}
                    className="cursor-pointer border-t border-slate-200 hover:bg-white"
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
                    <td className="text-xs text-slate-600">
                      {new Date(p.collected_at).toLocaleString()}
                    </td>
                    <td className="text-right">
                      <Money value={amt} />
                    </td>
                    <td className="text-right">
                      <Money value={alloc} />
                    </td>
                    <td className="text-right">
                      {advance > 0 ? <Money value={advance} /> : <span className="text-slate-500">—</span>}
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
