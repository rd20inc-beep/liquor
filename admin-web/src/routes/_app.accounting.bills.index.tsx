import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge, Button, Card, Input, Spinner } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/accounting/bills/')({
  component: BillsList,
});

interface Bill {
  id: string;
  bill_no: string;
  vendor_id: string;
  vendor_code: string;
  vendor_name: string;
  vendor_ref: string | null;
  bill_date: string;
  due_date: string;
  amount: string;
  outstanding: string;
  status: 'open' | 'partial' | 'paid' | 'cancelled';
  expense_category_name: string | null;
}

const statusTone: Record<string, 'amber' | 'green' | 'slate' | 'red'> = {
  open: 'amber',
  partial: 'amber',
  paid: 'green',
  cancelled: 'slate',
};

function fmt(n: string | number): string {
  return Number(n).toLocaleString('en-PK', { minimumFractionDigits: 2 });
}

function BillsList() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['bills', status],
    queryFn: () => {
      const p = new URLSearchParams({ limit: '200' });
      if (status) p.set('status', status);
      return api.get<{ items: Bill[] }>(`/bills?${p.toString()}`);
    },
  });

  const items = (data?.items ?? []).filter((b) => {
    if (!q.trim()) return true;
    const n = q.trim().toLowerCase();
    return (
      b.bill_no.toLowerCase().includes(n) ||
      b.vendor_name.toLowerCase().includes(n) ||
      (b.vendor_ref ?? '').toLowerCase().includes(n)
    );
  });
  const totalAmount = items.reduce((s, b) => s + Number(b.amount), 0);
  const totalOutstanding = items.reduce((s, b) => s + Number(b.outstanding), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Bills</h1>
        <div className="flex gap-2">
          <Link to="/accounting" className="text-sm text-indigo-600 hover:underline">
            ← Accounting
          </Link>
          <Link to="/accounting/bills/new">
            <Button>+ New bill</Button>
          </Link>
        </div>
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="w-40">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm"
            >
              <option value="">All statuses</option>
              <option value="open">open</option>
              <option value="partial">partial</option>
              <option value="paid">paid</option>
              <option value="cancelled">cancelled</option>
            </select>
          </div>
          <div className="min-w-64 flex-1">
            <Input
              placeholder="Search bill / vendor / ref…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="text-sm text-slate-500">
            <span className="mr-3">
              Total: <span className="font-mono text-slate-800">PKR {fmt(totalAmount)}</span>
            </span>
            <span>
              Outstanding:{' '}
              <span className="font-mono text-amber-700">PKR {fmt(totalOutstanding)}</span>
            </span>
          </div>
        </div>

        {isLoading ? (
          <Spinner label="Loading bills" />
        ) : items.length === 0 ? (
          <div className="text-sm text-slate-500">No bills.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 text-left">Bill #</th>
                <th className="text-left">Vendor</th>
                <th className="text-left">Vendor ref</th>
                <th className="text-left">Category</th>
                <th className="text-left">Bill date</th>
                <th className="text-left">Due</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Outstanding</th>
                <th className="text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((b) => (
                <tr
                  key={b.id}
                  onClick={() =>
                    navigate({ to: '/accounting/bills/$id', params: { id: b.id } })
                  }
                  className="cursor-pointer border-t border-slate-200 hover:bg-slate-100/70"
                >
                  <td className="py-1.5 font-mono text-xs text-slate-700">{b.bill_no}</td>
                  <td className="text-slate-800">{b.vendor_name}</td>
                  <td className="text-xs text-slate-600">{b.vendor_ref ?? '—'}</td>
                  <td className="text-xs text-slate-600">
                    {b.expense_category_name ?? '—'}
                  </td>
                  <td className="text-slate-700">{b.bill_date}</td>
                  <td className="text-slate-700">{b.due_date}</td>
                  <td className="text-right font-mono text-slate-800">{fmt(b.amount)}</td>
                  <td className="text-right font-mono">
                    {Number(b.outstanding) > 0 ? (
                      <span className="text-amber-700">{fmt(b.outstanding)}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td>
                    <Badge tone={statusTone[b.status]}>{b.status}</Badge>
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
