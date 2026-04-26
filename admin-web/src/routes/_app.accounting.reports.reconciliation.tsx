import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge, Card, Input, Spinner } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/accounting/reports/reconciliation')({
  component: Reconciliation,
});

interface ReconRow {
  label: string;
  gl_balance: string;
  subledger_total: string;
  difference: string;
  reconciled: boolean;
}

interface ReconResponse {
  as_of: string;
  items: ReconRow[];
}

function fmt(n: string | number): string {
  return Number(n).toLocaleString('en-PK', { minimumFractionDigits: 2 });
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function Reconciliation() {
  const [asOf, setAsOf] = useState(today);
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'reconciliation', asOf],
    queryFn: () => api.get<ReconResponse>(`/reports/reconciliation?as_of=${asOf}`),
    enabled: Boolean(asOf),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Subledger reconciliation</h1>
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
        </div>

        {isLoading || !data ? (
          <Spinner label="Reconciling" />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 text-left">Account</th>
                <th className="text-right">GL balance</th>
                <th className="text-right">Subledger total</th>
                <th className="text-right">Difference</th>
                <th className="text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((it) => (
                <tr key={it.label} className="border-t border-slate-200">
                  <td className="py-2 text-slate-800">{it.label}</td>
                  <td className="text-right font-mono text-slate-700">{fmt(it.gl_balance)}</td>
                  <td className="text-right font-mono text-slate-700">
                    {fmt(it.subledger_total)}
                  </td>
                  <td
                    className={`text-right font-mono ${
                      Math.abs(Number(it.difference)) < 0.01
                        ? 'text-emerald-700'
                        : 'text-red-700'
                    }`}
                  >
                    {fmt(it.difference)}
                  </td>
                  <td>
                    <Badge tone={it.reconciled ? 'green' : 'red'}>
                      {it.reconciled ? 'reconciled' : 'mismatch'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Mismatches are expected for entries that pre-date the GL cutover (Phase A).
          Newly created invoices, bills, payments, and stock receipts post to both the
          sub-ledger and the GL atomically; older rows live only in the sub-ledger.
        </p>
      </Card>
    </div>
  );
}
