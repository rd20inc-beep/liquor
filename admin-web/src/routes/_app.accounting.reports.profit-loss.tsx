import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Card, Input, Spinner } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/accounting/reports/profit-loss')({
  component: ProfitLoss,
});

interface AccountRow {
  code: string;
  name: string;
  type: string;
  amount: string;
}

interface PLResponse {
  from: string;
  to: string;
  revenue: AccountRow[];
  cogs: AccountRow[];
  expenses: AccountRow[];
  totals: {
    revenue: string;
    cogs: string;
    gross_profit: string;
    gross_margin_pct: string;
    expenses: string;
    net_income: string;
  };
}

function fmt(n: string | number): string {
  return Number(n).toLocaleString('en-PK', { minimumFractionDigits: 2 });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function startOfYear(): string {
  return `${new Date().getUTCFullYear()}-01-01`;
}

function Section({
  title,
  items,
  isContra,
}: {
  title: string;
  items: AccountRow[];
  isContra?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <>
      <tr className="bg-slate-50">
        <td colSpan={3} className="py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
          {title}
        </td>
      </tr>
      {items.map((a) => (
        <tr key={a.code} className="border-t border-slate-200">
          <td className="py-1.5 font-mono text-xs text-slate-600">{a.code}</td>
          <td className="text-slate-800">{a.name}</td>
          <td className={`text-right font-mono ${isContra ? 'text-red-700' : 'text-slate-800'}`}>
            {isContra ? '−' : ''}
            {fmt(a.amount)}
          </td>
        </tr>
      ))}
    </>
  );
}

function ProfitLoss() {
  const [from, setFrom] = useState(startOfYear);
  const [to, setTo] = useState(today);
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'profit-loss', from, to],
    queryFn: () => api.get<PLResponse>(`/reports/profit-loss?from=${from}&to=${to}`),
    enabled: Boolean(from && to),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Profit &amp; loss</h1>
        <Link to="/accounting" className="text-sm text-indigo-600 hover:underline">
          ← Accounting
        </Link>
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
        </div>

        {isLoading || !data ? (
          <Spinner label="Computing P&L" />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 text-left">Code</th>
                <th className="text-left">Account</th>
                <th className="text-right">Amount (PKR)</th>
              </tr>
            </thead>
            <tbody>
              <Section title="Revenue" items={data.revenue} />
              <tr className="border-t border-slate-200 bg-slate-50">
                <td colSpan={2} className="py-2 text-xs uppercase tracking-wider text-slate-600">
                  Total revenue
                </td>
                <td className="text-right font-mono text-slate-900">{fmt(data.totals.revenue)}</td>
              </tr>

              <Section title="Cost of goods sold" items={data.cogs} isContra />
              <tr className="border-t border-slate-200 bg-slate-50">
                <td colSpan={2} className="py-2 text-xs uppercase tracking-wider text-slate-600">
                  Gross profit ({data.totals.gross_margin_pct}%)
                </td>
                <td className="text-right font-mono text-slate-900">
                  {fmt(data.totals.gross_profit)}
                </td>
              </tr>

              <Section title="Operating expenses" items={data.expenses} isContra />
              <tr className="border-t border-slate-200 bg-slate-50">
                <td colSpan={2} className="py-2 text-xs uppercase tracking-wider text-slate-600">
                  Total expenses
                </td>
                <td className="text-right font-mono text-slate-900">
                  {fmt(data.totals.expenses)}
                </td>
              </tr>

              <tr className="border-t-2 border-slate-300 bg-slate-100/70">
                <td colSpan={2} className="py-2 text-xs font-semibold uppercase tracking-wider text-slate-700">
                  Net income
                </td>
                <td
                  className={`text-right font-mono ${
                    Number(data.totals.net_income) >= 0
                      ? 'text-emerald-700'
                      : 'text-red-700'
                  }`}
                >
                  {fmt(data.totals.net_income)}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
