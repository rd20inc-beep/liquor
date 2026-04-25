import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Button, Card, ErrorNote, Field, Input, Select } from '../components/ui';
import { api, ApiError } from '../lib/api';

export const Route = createFileRoute('/_app/accounting/journals/new')({
  component: NewJournal,
});

interface Account {
  id: string;
  code: string;
  name: string;
  is_postable: boolean;
  is_control: boolean;
  active: boolean;
}

interface Line {
  account_code: string;
  debit: string;
  credit: string;
  memo: string;
}

const emptyLine = (): Line => ({ account_code: '', debit: '', credit: '', memo: '' });

const today = () => new Date().toISOString().slice(0, 10);

function NewJournal() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const accountsQ = useQuery({
    queryKey: ['gl', 'accounts'],
    queryFn: () => api.get<{ items: Account[] }>('/gl/accounts'),
  });

  const postable = useMemo(
    () =>
      (accountsQ.data?.items ?? []).filter(
        (a) => a.is_postable && !a.is_control && a.active,
      ),
    [accountsQ.data],
  );

  const [date, setDate] = useState(today);
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);
  const [error, setError] = useState<string | null>(null);

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const diff = totalDebit - totalCredit;
  const balanced = Math.abs(diff) < 0.005 && totalDebit > 0;

  const post = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ id: string; journal_no: string }>('/gl/journals', body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['gl'] });
      void navigate({ to: '/accounting/journals/$id', params: { id: res.id } });
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : 'Could not post journal'),
  });

  const updateLine = (i: number, patch: Partial<Line>) =>
    setLines((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addLine = () => setLines((rs) => [...rs, emptyLine()]);
  const removeLine = (i: number) =>
    setLines((rs) => (rs.length > 2 ? rs.filter((_, idx) => idx !== i) : rs));

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!balanced) {
      setError('Debits must equal credits and be greater than zero');
      return;
    }
    const cleaned = lines
      .filter((l) => l.account_code && (Number(l.debit) > 0 || Number(l.credit) > 0))
      .map((l) => ({
        account_code: l.account_code,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
        memo: l.memo.trim() || undefined,
      }));
    if (cleaned.length < 2) {
      setError('Need at least two lines with amounts');
      return;
    }
    post.mutate({
      je_date: date,
      memo: memo.trim() || undefined,
      lines: cleaned,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">New journal entry</h1>
        <Link to="/accounting/journals" className="text-sm text-indigo-600 hover:underline">
          ← Journals
        </Link>
      </div>

      {error && <ErrorNote message={error} />}

      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Date">
              <Input
                required
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label="Memo" optional hint="Shown on every line by default">
              <Input
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="e.g. April rent accrual"
              />
            </Field>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 text-left">Account</th>
                  <th className="text-right">Debit</th>
                  <th className="text-right">Credit</th>
                  <th className="text-left">Memo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-t border-slate-200">
                    <td className="py-1">
                      <Select
                        value={l.account_code}
                        onChange={(e) =>
                          updateLine(i, { account_code: e.target.value })
                        }
                      >
                        <option value="">— pick —</option>
                        {postable.map((a) => (
                          <option key={a.id} value={a.code}>
                            {a.code} — {a.name}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-1">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        className="text-right"
                        value={l.debit}
                        onChange={(e) =>
                          updateLine(i, { debit: e.target.value, credit: '' })
                        }
                      />
                    </td>
                    <td className="py-1">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        className="text-right"
                        value={l.credit}
                        onChange={(e) =>
                          updateLine(i, { credit: e.target.value, debit: '' })
                        }
                      />
                    </td>
                    <td className="py-1">
                      <Input
                        value={l.memo}
                        onChange={(e) => updateLine(i, { memo: e.target.value })}
                        placeholder="optional"
                      />
                    </td>
                    <td className="py-1 pl-2 text-right">
                      {lines.length > 2 && (
                        <button
                          type="button"
                          onClick={() => removeLine(i)}
                          className="text-xs text-slate-400 hover:text-red-600"
                          aria-label="Remove line"
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-slate-300 bg-slate-50">
                  <td className="py-2 text-xs uppercase text-slate-500">Totals</td>
                  <td className="text-right font-mono text-slate-800">
                    {totalDebit.toFixed(2)}
                  </td>
                  <td className="text-right font-mono text-slate-800">
                    {totalCredit.toFixed(2)}
                  </td>
                  <td colSpan={2} className="text-xs text-slate-500">
                    {balanced ? (
                      <span className="text-emerald-700">balanced ✓</span>
                    ) : (
                      <span className="text-red-700">
                        out by {diff.toFixed(2)} ({totalDebit > totalCredit ? 'DR > CR' : 'CR > DR'})
                      </span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <Button type="button" variant="ghost" onClick={addLine}>
              + Add line
            </Button>
            <div className="flex gap-2">
              <Link to="/accounting/journals">
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </Link>
              <Button type="submit" disabled={!balanced || post.isPending}>
                {post.isPending ? 'Posting…' : 'Post journal'}
              </Button>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Posted journals are immutable. To correct one, post a reversal from its detail
            page.
          </p>
        </form>
      </Card>
    </div>
  );
}
