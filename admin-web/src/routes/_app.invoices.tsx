import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Badge, Card, Money, Spinner } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/invoices')({
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
  status: string;
  days_overdue: number;
}

const statusTone: Record<string, 'slate' | 'green' | 'amber' | 'red' | 'blue'> = {
  open: 'amber',
  partial: 'amber',
  paid: 'green',
  disputed: 'red',
  void: 'slate',
};

function Invoices() {
  const { data, isLoading } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => api.get<{ items: Invoice[] }>('/invoices?limit=100'),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-100">Invoices</h1>
      <Card>
        {isLoading ? (
          <Spinner label="Loading invoices" />
        ) : data?.items.length === 0 ? (
          <div className="text-sm text-slate-500">No invoices yet.</div>
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
              </tr>
            </thead>
            <tbody>
              {data?.items.map((i) => (
                <tr key={i.id} className="border-t border-slate-800/60">
                  <td className="py-1.5 font-mono text-xs">{i.invoice_no}</td>
                  <td>
                    {i.customer_name}{' '}
                    <span className="text-xs text-slate-500">({i.customer_code})</span>
                  </td>
                  <td className="text-xs text-slate-400">{i.due_date}</td>
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
                    {i.days_overdue > 0 ? `${i.days_overdue}d` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
