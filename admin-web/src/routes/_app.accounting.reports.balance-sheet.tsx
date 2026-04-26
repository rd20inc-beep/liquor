import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge, Card, Input, Spinner } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/accounting/reports/balance-sheet')({
  component: BalanceSheet,
});

interface AccountRow {
  code: string;
  name: string;
  type: string;
  normal_side: string;
  balance: string;
}

interface BSResponse {
  as_of: string;
  fiscal_year_start: string;
  assets: AccountRow[];
  liabilities: AccountRow[];
  equity: AccountRow[];
  totals: {
    assets: string;
    liabilities: string;
    equity: string;
    ytd_net_income: string;
    equity_with_ni: string;
    liabilities_plus_equity: string;
    balanced: boolean;
    difference: string;
  };
}

function fmt(n: string | number): string {
  const v = Number(n);
  return v.toLocaleString('en-PK', { minimumFractionDigits: 2 });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function Section({ title, items }: { title: string; items: AccountRow[] }) {
  if (items.length === 0) return null;
  const total = items.reduce((s, a) => s + Number(a.balance), 0);
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
          <td className="text-right font-mono text-slate-800">{fmt(a.balance)}</td>
        </tr>
      ))}
      <tr className="border-t border-slate-300 bg-slate-50">
        <td colSpan={2} className="py-2 text-xs uppercase tracking-wider text-slate-600">
          Total {title}
        </td>
        <td className="text-right font-mono text-slate-900">{fmt(total)}</td>
      </tr>
    </>
  );
}

function BalanceSheet() {
  const [asOf, setAsOf] = useState(today);
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'balance-sheet', asOf],
    queryFn: () => api.get<BSResponse>(`/reports/balance-sheet?as_of=${asOf}`),
    enabled: Boolean(asOf),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Balance sheet</h1>
        <Link to="/accounting" className="text-sm text-indigo-600 hover:underline">
          ← Accounting
        </Link>
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-slate-500">As of</label>
            <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </div>
          {data && (
            <div className="ml-auto text-sm">
              <Badge tone={data.totals.balanced ? 'green' : 'red'}>
                {data.totals.balanced
                  ? 'balanced'
                  : `out by ${fmt(data.totals.difference)}`}
              </Badge>
              <span className="ml-3 text-xs text-slate-500">
                FY start {data.fiscal_year_start}
              </span>
            </div>
          )}
        </div>

        {isLoading || !data ? (
          <Spinner label="Computing balance sheet" />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 text-left">Code</th>
                <th className="text-left">Account</th>
                <th className="text-right">Balance (PKR)</th>
              </tr>
            </thead>
            <tbody>
              <Section title="Assets" items={data.assets} />
              <Section title="Liabilities" items={data.liabilities} />
              <Section title="Equity" items={data.equity} />
              <tr className="bg-slate-50">
                <td colSpan={2} className="py-1.5 text-xs italic text-slate-600">
                  YTD net income (since {data.fiscal_year_start})
                </td>
                <td className="text-right font-mono text-slate-800">
                  {fmt(data.totals.ytd_net_income)}
                </td>
              </tr>
              <tr className="border-t-2 border-slate-300 bg-slate-100/70">
                <td colSpan={2} className="py-2 text-xs font-semibold uppercase tracking-wider text-slate-700">
                  Total assets
                </td>
                <td className="text-right font-mono text-slate-900">{fmt(data.totals.assets)}</td>
              </tr>
              <tr className="bg-slate-100/70">
                <td colSpan={2} className="py-2 text-xs font-semibold uppercase tracking-wider text-slate-700">
                  Total liabilities + equity (incl. YTD NI)
                </td>
                <td className="text-right font-mono text-slate-900">
                  {fmt(data.totals.liabilities_plus_equity)}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
