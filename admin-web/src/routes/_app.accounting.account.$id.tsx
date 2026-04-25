import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge, Card, Input, Spinner } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/accounting/account/$id')({
  component: AccountLedger,
});

interface Account {
  id: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'cogs' | 'expense';
  normal_side: 'debit' | 'credit';
  is_postable: boolean;
  is_control: boolean;
  active: boolean;
  parent_code: string | null;
  parent_name: string | null;
}

interface LedgerEntry {
  id: number;
  debit: string;
  credit: string;
  memo: string | null;
  customer_id: string | null;
  product_id: string | null;
  batch_id: string | null;
  journal_id: string;
  journal_no: string;
  je_date: string;
  source_type: string;
  source_id: string | null;
  posted: boolean;
}

interface LedgerResponse {
  items: LedgerEntry[];
  opening_balance: string;
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

function AccountLedger() {
  const { id } = Route.useParams();
  const [from, setFrom] = useState(startOfYear);
  const [to, setTo] = useState(today);

  const acctQ = useQuery({
    queryKey: ['gl', 'account', id],
    queryFn: () => api.get<Account>(`/gl/accounts/${id}`),
  });
  const ledgerQ = useQuery({
    queryKey: ['gl', 'ledger', id, from, to],
    queryFn: () =>
      api.get<LedgerResponse>(`/gl/accounts/${id}/ledger?from=${from}&to=${to}&limit=500`),
  });

  if (acctQ.isLoading || !acctQ.data) return <Spinner label="Loading account" />;

  const a = acctQ.data;
  const opening = Number(ledgerQ.data?.opening_balance ?? 0);
  // Walk forward in chronological order to compute running balance
  const sorted = [...(ledgerQ.data?.items ?? [])].sort((x, y) =>
    `${x.je_date}-${x.journal_no}`.localeCompare(`${y.je_date}-${y.journal_no}`),
  );
  let running = opening;
  const rows = sorted.map((e) => {
    const dr = Number(e.debit);
    const cr = Number(e.credit);
    running += a.normal_side === 'debit' ? dr - cr : cr - dr;
    return { ...e, running };
  });
  const closing = running;
  rows.reverse(); // newest first for display

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Account · {a.type}
          </div>
          <h1 className="text-xl font-semibold text-slate-900">
            <span className="font-mono text-base text-slate-500">{a.code}</span> {a.name}
          </h1>
          {a.parent_code && (
            <div className="text-xs text-slate-500">
              under {a.parent_code} {a.parent_name}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {a.is_control && <Badge tone="amber">control</Badge>}
          <Badge tone={a.active ? 'green' : 'slate'}>
            {a.active ? 'active' : 'inactive'}
          </Badge>
          <Link to="/accounting/coa" className="text-sm text-indigo-600 hover:underline">
            ← Chart of accounts
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
          <div className="ml-auto text-sm">
            <span className="mr-4 text-slate-500">
              Opening:{' '}
              <span className="font-mono text-slate-800">{fmt(opening)}</span>{' '}
              <span className="text-xs text-slate-400">{a.normal_side === 'debit' ? 'Dr' : 'Cr'}</span>
            </span>
            <span className="text-slate-500">
              Closing:{' '}
              <span className="font-mono text-slate-800">{fmt(closing)}</span>{' '}
              <span className="text-xs text-slate-400">{a.normal_side === 'debit' ? 'Dr' : 'Cr'}</span>
            </span>
          </div>
        </div>

        {ledgerQ.isLoading ? (
          <Spinner label="Loading ledger" />
        ) : rows.length === 0 ? (
          <div className="text-sm text-slate-500">No activity in this range.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 text-left">Date</th>
                <th className="text-left">JE #</th>
                <th className="text-left">Source</th>
                <th className="text-left">Memo</th>
                <th className="text-right">Debit</th>
                <th className="text-right">Credit</th>
                <th className="text-right">Running</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-t border-slate-200">
                  <td className="py-1.5 text-slate-600">{e.je_date}</td>
                  <td className="font-mono text-xs">
                    <Link
                      to="/accounting/journals/$id"
                      params={{ id: e.journal_id }}
                      className="text-indigo-600 hover:underline"
                    >
                      {e.journal_no}
                    </Link>
                  </td>
                  <td className="text-xs text-slate-600">{e.source_type}</td>
                  <td className="text-slate-700">{e.memo ?? '—'}</td>
                  <td className="text-right font-mono text-slate-700">{fmt(e.debit)}</td>
                  <td className="text-right font-mono text-slate-700">{fmt(e.credit)}</td>
                  <td className="text-right font-mono text-slate-800">{fmt(e.running)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
