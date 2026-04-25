import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge, Button, Card, Input, Spinner } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/accounting/journals/')({
  component: JournalsList,
});

interface Journal {
  id: string;
  journal_no: string;
  je_date: string;
  source_type: string;
  memo: string | null;
  posted: boolean;
  total_debit: string;
  posted_by_name: string | null;
}

const SOURCES = [
  '',
  'manual',
  'reversal',
  'invoice',
  'payment',
  'credit_note',
  'stock_receipt',
  'stock_adjust',
  'cogs',
  'bill',
  'bill_payment',
  'expense',
];

function JournalsList() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [src, setSrc] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['gl', 'journals', from, to, src],
    queryFn: () => {
      const p = new URLSearchParams({ limit: '200' });
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      if (src) p.set('source_type', src);
      return api.get<{ items: Journal[] }>(`/gl/journals?${p.toString()}`);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Journal entries</h1>
        <div className="flex gap-2">
          <Link to="/accounting" className="text-sm text-indigo-600 hover:underline">
            ← Accounting
          </Link>
          <Link to="/accounting/journals/new">
            <Button>+ New</Button>
          </Link>
        </div>
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap gap-3">
          <div>
            <label className="text-xs text-slate-500">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-slate-500">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-slate-500">Source</label>
            <select
              value={src}
              onChange={(e) => setSrc(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm"
            >
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s || 'All sources'}
                </option>
              ))}
            </select>
          </div>
        </div>

        {isLoading ? (
          <Spinner label="Loading journals" />
        ) : (data?.items ?? []).length === 0 ? (
          <div className="text-sm text-slate-500">No journal entries match.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 text-left">JE #</th>
                <th className="text-left">Date</th>
                <th className="text-left">Source</th>
                <th className="text-left">Memo</th>
                <th className="text-right">Amount</th>
                <th className="text-left">Posted by</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((j) => (
                <tr key={j.id} className="border-t border-slate-200 hover:bg-slate-100/70">
                  <td className="py-1.5 font-mono text-xs text-slate-700">
                    <Link
                      to="/accounting/journals/$id"
                      params={{ id: j.id }}
                      className="hover:underline"
                    >
                      {j.journal_no}
                    </Link>
                  </td>
                  <td className="text-slate-600">{j.je_date}</td>
                  <td>
                    <Badge tone={j.source_type === 'manual' ? 'slate' : 'blue'}>
                      {j.source_type}
                    </Badge>
                  </td>
                  <td className="truncate text-slate-700">{j.memo ?? '—'}</td>
                  <td className="text-right font-mono text-slate-700">
                    {Number(j.total_debit).toLocaleString('en-PK', {
                      minimumFractionDigits: 2,
                    })}
                  </td>
                  <td className="text-xs text-slate-600">{j.posted_by_name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
