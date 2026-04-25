import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';

export const Route = createFileRoute('/_app/accounting/journals/$id')({
  component: JournalDetail,
});

interface JournalLine {
  id: number;
  line_no: number;
  account_id: string;
  account_code: string;
  account_name: string;
  debit: string;
  credit: string;
  memo: string | null;
  customer_name: string | null;
  product_name: string | null;
}

interface Journal {
  id: string;
  journal_no: string;
  je_date: string;
  source_type: string;
  source_id: string | null;
  memo: string | null;
  posted: boolean;
  posted_at: string | null;
  posted_by_name: string | null;
  created_by_name: string | null;
  reversal_of: string | null;
  reversed_by: string | null;
  lines: JournalLine[];
}

const today = () => new Date().toISOString().slice(0, 10);

function JournalDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showReverse, setShowReverse] = useState(false);
  const [reversalDate, setReversalDate] = useState(today);
  const [reversalMemo, setReversalMemo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const jQ = useQuery({
    queryKey: ['gl', 'journal', id],
    queryFn: () => api.get<Journal>(`/gl/journals/${id}`),
  });

  const reverse = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ id: string }>(`/gl/journals/${id}/reverse`, body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['gl'] });
      void navigate({ to: '/accounting/journals/$id', params: { id: res.id } });
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : 'Could not reverse journal'),
  });

  if (jQ.isLoading) return <Spinner label="Loading journal" />;
  if (jQ.isError || !jQ.data) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-slate-900">Journal entry</h1>
        <ErrorNote message="Could not load journal" />
      </div>
    );
  }

  const j = jQ.data;
  const totalDebit = j.lines.reduce((s, l) => s + Number(l.debit), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Journal entry · {j.source_type}
          </div>
          <h1 className="text-xl font-semibold text-slate-900">{j.journal_no}</h1>
        </div>
        <div className="flex items-center gap-2">
          {j.reversal_of && <Badge tone="amber">reversal</Badge>}
          {j.reversed_by && <Badge tone="red">reversed</Badge>}
          {!j.reversed_by && !j.reversal_of && j.source_type === 'manual' && (
            <Button variant="secondary" onClick={() => setShowReverse((s) => !s)}>
              Reverse
            </Button>
          )}
          <Link to="/accounting/journals" className="text-sm text-indigo-600 hover:underline">
            ← Journals
          </Link>
        </div>
      </div>

      {error && <ErrorNote message={error} />}

      <Card>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
          <div>
            <dt className="text-xs uppercase text-slate-500">Date</dt>
            <dd className="text-slate-800">{j.je_date}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Source</dt>
            <dd className="text-slate-800">{j.source_type}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Posted by</dt>
            <dd className="text-slate-800">{j.posted_by_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Posted at</dt>
            <dd className="text-slate-800">
              {j.posted_at ? new Date(j.posted_at).toLocaleString() : '—'}
            </dd>
          </div>
          {j.memo && (
            <div className="col-span-full">
              <dt className="text-xs uppercase text-slate-500">Memo</dt>
              <dd className="text-slate-800">{j.memo}</dd>
            </div>
          )}
        </dl>
      </Card>

      {showReverse && (
        <Card title="Reverse this journal">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Reversal date">
              <Input
                type="date"
                value={reversalDate}
                onChange={(e) => setReversalDate(e.target.value)}
              />
            </Field>
            <Field label="Memo" optional>
              <Input
                value={reversalMemo}
                onChange={(e) => setReversalMemo(e.target.value)}
                placeholder={`Reversal of ${j.journal_no}`}
              />
            </Field>
            <div className="flex items-end gap-2">
              <Button
                onClick={() =>
                  reverse.mutate({
                    je_date: reversalDate,
                    memo: reversalMemo.trim() || undefined,
                  })
                }
                disabled={reverse.isPending}
              >
                {reverse.isPending ? 'Posting…' : 'Post reversal'}
              </Button>
              <Button variant="ghost" onClick={() => setShowReverse(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card title="Lines">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2 text-left">#</th>
              <th className="text-left">Account</th>
              <th className="text-left">Subledger</th>
              <th className="text-right">Debit</th>
              <th className="text-right">Credit</th>
              <th className="text-left">Memo</th>
            </tr>
          </thead>
          <tbody>
            {j.lines.map((l) => (
              <tr key={l.id} className="border-t border-slate-200">
                <td className="py-1.5 text-xs text-slate-500">{l.line_no}</td>
                <td className="text-slate-800">
                  <Link
                    to="/accounting/account/$id"
                    params={{ id: l.account_id }}
                    className="hover:underline"
                  >
                    <span className="font-mono text-xs text-slate-600">{l.account_code}</span>{' '}
                    {l.account_name}
                  </Link>
                </td>
                <td className="text-xs text-slate-600">
                  {l.customer_name ?? l.product_name ?? '—'}
                </td>
                <td className="text-right font-mono text-slate-700">
                  {Number(l.debit) > 0
                    ? Number(l.debit).toLocaleString('en-PK', { minimumFractionDigits: 2 })
                    : ''}
                </td>
                <td className="text-right font-mono text-slate-700">
                  {Number(l.credit) > 0
                    ? Number(l.credit).toLocaleString('en-PK', { minimumFractionDigits: 2 })
                    : ''}
                </td>
                <td className="text-xs text-slate-600">{l.memo ?? '—'}</td>
              </tr>
            ))}
            <tr className="border-t border-slate-300 bg-slate-50">
              <td colSpan={3} className="py-2 text-xs uppercase text-slate-500">
                Totals
              </td>
              <td className="text-right font-mono text-slate-800">
                {totalDebit.toLocaleString('en-PK', { minimumFractionDigits: 2 })}
              </td>
              <td className="text-right font-mono text-slate-800">
                {totalDebit.toLocaleString('en-PK', { minimumFractionDigits: 2 })}
              </td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </Card>

      {(j.reversal_of || j.reversed_by) && (
        <Card>
          <div className="text-sm">
            {j.reversal_of && (
              <div>
                Reverses{' '}
                <Link
                  to="/accounting/journals/$id"
                  params={{ id: j.reversal_of }}
                  className="text-indigo-600 hover:underline"
                >
                  earlier journal
                </Link>
                .
              </div>
            )}
            {j.reversed_by && (
              <div>
                Reversed by{' '}
                <Link
                  to="/accounting/journals/$id"
                  params={{ id: j.reversed_by }}
                  className="text-indigo-600 hover:underline"
                >
                  later journal
                </Link>
                .
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
