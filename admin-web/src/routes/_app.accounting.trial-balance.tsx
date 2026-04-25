import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Card, Input, Spinner } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/accounting/trial-balance')({
  component: TrialBalance,
});

interface TBRow {
  id: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'cogs' | 'expense';
  normal_side: 'debit' | 'credit';
  period_debit: string;
  period_credit: string;
  balance: string;
}

interface TBResponse {
  from: string;
  to: string;
  items: TBRow[];
  total_debit: string;
  total_credit: string;
}

function startOfYear(): string {
  return `${new Date().getUTCFullYear()}-01-01`;
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function fmt(n: string | number): string {
  const v = Number(n);
  if (!v) return '';
  return v.toLocaleString('en-PK', { minimumFractionDigits: 2 });
}

const typeOrder: TBRow['type'][] = [
  'asset',
  'liability',
  'equity',
  'revenue',
  'cogs',
  'expense',
];
const typeLabel: Record<TBRow['type'], string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  revenue: 'Revenue',
  cogs: 'Cost of goods sold',
  expense: 'Expenses',
};

function TrialBalance() {
  const [from, setFrom] = useState(startOfYear);
  const [to, setTo] = useState(today);

  const { data, isLoading } = useQuery({
    queryKey: ['gl', 'trial-balance', from, to],
    queryFn: () =>
      api.get<TBResponse>(`/gl/trial-balance?from=${from}&to=${to}`),
    enabled: Boolean(from && to),
  });

  const balanced = data && Math.abs(Number(data.total_debit) - Number(data.total_credit)) < 0.005;

  const grouped = (data?.items ?? []).reduce<Record<TBRow['type'], TBRow[]>>(
    (acc, r) => {
      (acc[r.type] ??= []).push(r);
      return acc;
    },
    { asset: [], liability: [], equity: [], revenue: [], cogs: [], expense: [] },
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Trial balance</h1>
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

        {isLoading ? (
          <Spinner label="Computing trial balance" />
        ) : !data || data.items.length === 0 ? (
          <div className="text-sm text-slate-500">No activity in this range.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 text-left">Code</th>
                <th className="text-left">Account</th>
                <th className="text-right">Debit</th>
                <th className="text-right">Credit</th>
                <th className="text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {typeOrder.flatMap((t) => {
                const rows = grouped[t];
                if (!rows || rows.length === 0) return [];
                return [
                  <tr key={`h-${t}`} className="bg-slate-50">
                    <td colSpan={5} className="py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {typeLabel[t]}
                    </td>
                  </tr>,
                  ...rows.map((r) => (
                    <tr key={r.id} className="border-t border-slate-200">
                      <td className="py-1.5 font-mono text-xs text-slate-600">{r.code}</td>
                      <td className="text-slate-800">
                        <Link
                          to="/accounting/account/$id"
                          params={{ id: r.id }}
                          className="hover:underline"
                        >
                          {r.name}
                        </Link>
                      </td>
                      <td className="text-right font-mono text-slate-700">{fmt(r.period_debit)}</td>
                      <td className="text-right font-mono text-slate-700">{fmt(r.period_credit)}</td>
                      <td className="text-right font-mono text-slate-800">
                        {fmt(r.balance)}{' '}
                        <span className="text-xs text-slate-400">{r.normal_side === 'debit' ? 'Dr' : 'Cr'}</span>
                      </td>
                    </tr>
                  )),
                ];
              })}
              <tr className="border-t-2 border-slate-300 bg-slate-50">
                <td colSpan={2} className="py-2 text-xs uppercase text-slate-500">
                  Totals
                </td>
                <td className="text-right font-mono text-slate-900">{fmt(data.total_debit)}</td>
                <td className="text-right font-mono text-slate-900">{fmt(data.total_credit)}</td>
                <td className={`text-right text-xs ${balanced ? 'text-emerald-700' : 'text-red-700'}`}>
                  {balanced ? 'balanced ✓' : 'OUT OF BALANCE'}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
