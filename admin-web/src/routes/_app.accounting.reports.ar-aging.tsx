import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Card, Input, Spinner } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/accounting/reports/ar-aging')({
  component: ARAging,
});

interface CustomerRow {
  customer_id: string;
  customer_code: string;
  customer_name: string;
  current: string;
  b1_30: string;
  b31_60: string;
  b61_90: string;
  b90_plus: string;
  total: string;
}

interface ARResponse {
  as_of: string;
  customers: CustomerRow[];
  totals: {
    current: string;
    b1_30: string;
    b31_60: string;
    b61_90: string;
    b90_plus: string;
    total: string;
  };
}

function fmt(n: string | number): string {
  const v = Number(n);
  if (v === 0) return '';
  return v.toLocaleString('en-PK', { minimumFractionDigits: 2 });
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function ARAging() {
  const [asOf, setAsOf] = useState(today);
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'ar-aging', asOf],
    queryFn: () => api.get<ARResponse>(`/reports/ar-aging?as_of=${asOf}`),
    enabled: Boolean(asOf),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">AR aging</h1>
        <Link to="/accounting" className="text-sm text-indigo-600 hover:underline">
          ← Accounting
        </Link>
      </div>

      <Card>
        <div className="mb-3 flex items-end gap-3">
          <div>
            <label className="text-xs text-slate-500">As of</label>
            <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </div>
          {data && (
            <div className="ml-auto text-sm text-slate-500">
              Total receivable:{' '}
              <span className="font-mono text-slate-800">PKR {fmt(data.totals.total)}</span>
            </div>
          )}
        </div>

        {isLoading || !data ? (
          <Spinner label="Computing aging" />
        ) : data.customers.length === 0 ? (
          <div className="text-sm text-slate-500">No outstanding customer balances.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 text-left">Code</th>
                <th className="text-left">Customer</th>
                <th className="text-right">Current</th>
                <th className="text-right">1–30</th>
                <th className="text-right">31–60</th>
                <th className="text-right">61–90</th>
                <th className="text-right">90+</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.customers.map((c) => (
                <tr key={c.customer_id} className="border-t border-slate-200">
                  <td className="py-1.5 font-mono text-xs text-slate-600">{c.customer_code}</td>
                  <td className="text-slate-800">{c.customer_name}</td>
                  <td className="text-right font-mono text-slate-700">{fmt(c.current)}</td>
                  <td className="text-right font-mono text-amber-700">{fmt(c.b1_30)}</td>
                  <td className="text-right font-mono text-amber-700">{fmt(c.b31_60)}</td>
                  <td className="text-right font-mono text-red-600">{fmt(c.b61_90)}</td>
                  <td className="text-right font-mono text-red-700">{fmt(c.b90_plus)}</td>
                  <td className="text-right font-mono text-slate-900">{fmt(c.total)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 bg-slate-50">
                <td colSpan={2} className="py-2 text-xs uppercase tracking-wider text-slate-700">
                  Totals
                </td>
                <td className="text-right font-mono text-slate-900">{fmt(data.totals.current)}</td>
                <td className="text-right font-mono text-slate-900">{fmt(data.totals.b1_30)}</td>
                <td className="text-right font-mono text-slate-900">{fmt(data.totals.b31_60)}</td>
                <td className="text-right font-mono text-slate-900">{fmt(data.totals.b61_90)}</td>
                <td className="text-right font-mono text-slate-900">{fmt(data.totals.b90_plus)}</td>
                <td className="text-right font-mono text-slate-900">{fmt(data.totals.total)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
