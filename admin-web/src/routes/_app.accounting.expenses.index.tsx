import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, Card, Input, Spinner } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/accounting/expenses/')({
  component: ExpensesList,
});

interface Expense {
  id: string;
  expense_no: string;
  expense_date: string;
  amount: string;
  category_code: string | null;
  category_name: string | null;
  gl_account_code: string;
  pay_account_code: string;
  vendor_name: string | null;
  vehicle_reg: string | null;
  description: string | null;
  created_by_name: string | null;
}

function fmt(n: string | number): string {
  return Number(n).toLocaleString('en-PK', { minimumFractionDigits: 2 });
}

function ExpensesList() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', from, to],
    queryFn: () => {
      const p = new URLSearchParams({ limit: '200' });
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      return api.get<{ items: Expense[] }>(`/expenses?${p.toString()}`);
    },
  });

  const items = (data?.items ?? []).filter((e) => {
    if (!q.trim()) return true;
    const n = q.trim().toLowerCase();
    return (
      e.expense_no.toLowerCase().includes(n) ||
      (e.category_name ?? '').toLowerCase().includes(n) ||
      (e.description ?? '').toLowerCase().includes(n) ||
      (e.vendor_name ?? '').toLowerCase().includes(n)
    );
  });
  const total = items.reduce((s, e) => s + Number(e.amount), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Expenses</h1>
        <div className="flex gap-2">
          <Link to="/accounting" className="text-sm text-indigo-600 hover:underline">
            ← Accounting
          </Link>
          <Link to="/accounting/expenses/new">
            <Button>+ New expense</Button>
          </Link>
        </div>
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-slate-500">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-slate-500">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="min-w-64 flex-1">
            <Input
              placeholder="Search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="text-sm text-slate-500">
            Total: <span className="font-mono text-slate-800">PKR {fmt(total)}</span>
          </div>
        </div>

        {isLoading ? (
          <Spinner label="Loading expenses" />
        ) : items.length === 0 ? (
          <div className="text-sm text-slate-500">No expenses recorded.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 text-left">Expense #</th>
                <th className="text-left">Date</th>
                <th className="text-left">Category</th>
                <th className="text-left">Description</th>
                <th className="text-left">Vendor</th>
                <th className="text-left">Vehicle</th>
                <th className="text-right">Amount</th>
                <th className="text-left">Paid via</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} className="border-t border-slate-200">
                  <td className="py-1.5 font-mono text-xs text-slate-700">{e.expense_no}</td>
                  <td className="text-slate-700">{e.expense_date}</td>
                  <td className="text-xs text-slate-600">
                    {e.category_code ?? '—'}{' '}
                    <span className="text-slate-400">({e.gl_account_code})</span>
                  </td>
                  <td className="text-slate-700">{e.description ?? '—'}</td>
                  <td className="text-xs text-slate-600">{e.vendor_name ?? '—'}</td>
                  <td className="text-xs text-slate-600">{e.vehicle_reg ?? '—'}</td>
                  <td className="text-right font-mono text-slate-800">{fmt(e.amount)}</td>
                  <td className="font-mono text-xs text-slate-600">{e.pay_account_code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
