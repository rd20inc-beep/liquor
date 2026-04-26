import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Card, Input, Spinner } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/accounting/reports/cash-activity')({
  component: CashActivity,
});

interface CashRow {
  code: string;
  name: string;
  opening: string;
  debits: string;
  credits: string;
  net_change: string;
  closing: string;
}

interface CashResponse {
  from: string;
  to: string;
  items: CashRow[];
  totals: {
    opening: string;
    debits: string;
    credits: string;
    net_change: string;
    closing: string;
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

function CashActivity() {
  const [from, setFrom] = useState(startOfYear);
  const [to, setTo] = useState(today);
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'cash-activity', from, to],
    queryFn: () =>
      api.get<CashResponse>(`/reports/cash-activity?from=${from}&to=${to}`),
    enabled: Boolean(from && to),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Cash activity</h1>
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
          <Spinner label="Computing cash activity" />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 text-left">Code</th>
                <th className="text-left">Account</th>
                <th className="text-right">Opening</th>
                <th className="text-right">Receipts (DR)</th>
                <th className="text-right">Disbursements (CR)</th>
                <th className="text-right">Net change</th>
                <th className="text-right">Closing</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((it) => (
                <tr key={it.code} className="border-t border-slate-200">
                  <td className="py-1.5 font-mono text-xs text-slate-600">{it.code}</td>
                  <td className="text-slate-800">{it.name}</td>
                  <td className="text-right font-mono text-slate-700">{fmt(it.opening)}</td>
                  <td className="text-right font-mono text-emerald-700">{fmt(it.debits)}</td>
                  <td className="text-right font-mono text-red-700">{fmt(it.credits)}</td>
                  <td
                    className={`text-right font-mono ${
                      Number(it.net_change) >= 0 ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {fmt(it.net_change)}
                  </td>
                  <td className="text-right font-mono text-slate-900">{fmt(it.closing)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 bg-slate-50">
                <td colSpan={2} className="py-2 text-xs uppercase tracking-wider text-slate-700">
                  Totals
                </td>
                <td className="text-right font-mono text-slate-900">{fmt(data.totals.opening)}</td>
                <td className="text-right font-mono text-emerald-700">{fmt(data.totals.debits)}</td>
                <td className="text-right font-mono text-red-700">{fmt(data.totals.credits)}</td>
                <td
                  className={`text-right font-mono ${
                    Number(data.totals.net_change) >= 0
                      ? 'text-emerald-700'
                      : 'text-red-700'
                  }`}
                >
                  {fmt(data.totals.net_change)}
                </td>
                <td className="text-right font-mono text-slate-900">{fmt(data.totals.closing)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
