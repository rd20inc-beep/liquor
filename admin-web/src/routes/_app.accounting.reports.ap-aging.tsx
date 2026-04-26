import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Card, Input, Spinner } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/accounting/reports/ap-aging')({
  component: APAging,
});

interface VendorRow {
  vendor_id: string;
  vendor_code: string;
  vendor_name: string;
  current: string;
  b1_30: string;
  b31_60: string;
  b61_90: string;
  b90_plus: string;
  total: string;
}

interface APResponse {
  as_of: string;
  vendors: VendorRow[];
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

function APAging() {
  const [asOf, setAsOf] = useState(today);
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'ap-aging', asOf],
    queryFn: () => api.get<APResponse>(`/reports/ap-aging?as_of=${asOf}`),
    enabled: Boolean(asOf),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">AP aging</h1>
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
              Total payable:{' '}
              <span className="font-mono text-slate-800">PKR {fmt(data.totals.total)}</span>
            </div>
          )}
        </div>

        {isLoading || !data ? (
          <Spinner label="Computing aging" />
        ) : data.vendors.length === 0 ? (
          <div className="text-sm text-slate-500">No outstanding vendor balances.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 text-left">Code</th>
                <th className="text-left">Vendor</th>
                <th className="text-right">Current</th>
                <th className="text-right">1–30</th>
                <th className="text-right">31–60</th>
                <th className="text-right">61–90</th>
                <th className="text-right">90+</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.vendors.map((v) => (
                <tr key={v.vendor_id} className="border-t border-slate-200">
                  <td className="py-1.5 font-mono text-xs text-slate-600">{v.vendor_code}</td>
                  <td className="text-slate-800">{v.vendor_name}</td>
                  <td className="text-right font-mono text-slate-700">{fmt(v.current)}</td>
                  <td className="text-right font-mono text-amber-700">{fmt(v.b1_30)}</td>
                  <td className="text-right font-mono text-amber-700">{fmt(v.b31_60)}</td>
                  <td className="text-right font-mono text-red-600">{fmt(v.b61_90)}</td>
                  <td className="text-right font-mono text-red-700">{fmt(v.b90_plus)}</td>
                  <td className="text-right font-mono text-slate-900">{fmt(v.total)}</td>
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
