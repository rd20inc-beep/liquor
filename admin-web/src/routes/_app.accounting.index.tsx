import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { Badge, Button, Card, Spinner, Tile } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/accounting/')({
  component: AccountingHome,
});

interface Period {
  id: string;
  year: number;
  month: number;
  status: 'open' | 'closed';
  closed_at: string | null;
  closed_by_name: string | null;
}

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

const monthName = (m: number) =>
  ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];

function AccountingHome() {
  const periodsQ = useQuery({
    queryKey: ['gl', 'periods'],
    queryFn: () => api.get<{ items: Period[] }>('/gl/periods'),
  });
  const recentQ = useQuery({
    queryKey: ['gl', 'journals', 'recent'],
    queryFn: () => api.get<{ items: Journal[] }>('/gl/journals?limit=10'),
  });

  const periods = periodsQ.data?.items ?? [];
  const open = periods.filter((p) => p.status === 'open');
  const current = open[0] ?? periods[0] ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Accounting</h1>
        <div className="flex gap-2">
          <Link to="/accounting/coa">
            <Button variant="secondary">Chart of accounts</Button>
          </Link>
          <Link to="/accounting/trial-balance">
            <Button variant="secondary">Trial balance</Button>
          </Link>
          <Link to="/accounting/journals/new">
            <Button>+ New journal entry</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tile
          label="Current period"
          value={current ? `${monthName(current.month)} ${current.year}` : '—'}
          sub={current?.status === 'open' ? 'open' : 'closed'}
          tone={current?.status === 'open' ? 'green' : 'amber'}
        />
        <Tile label="Open periods" value={open.length} sub="includes current" tone="blue" />
        <Tile
          label="Closed periods"
          value={periods.filter((p) => p.status === 'closed').length}
          sub="historical"
        />
        <Tile
          label="Recent JEs"
          value={recentQ.isLoading ? <Spinner /> : recentQ.data?.items.length ?? 0}
          sub="last 10"
        />
      </div>

      <Card
        title="Recent journal entries"
        actions={
          <Link to="/accounting/journals" className="text-sm text-indigo-600 hover:underline">
            View all
          </Link>
        }
      >
        {recentQ.isLoading ? (
          <Spinner label="Loading" />
        ) : (recentQ.data?.items ?? []).length === 0 ? (
          <div className="text-sm text-slate-500">No journal entries yet.</div>
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
              {recentQ.data?.items.map((j) => (
                <tr key={j.id} className="border-t border-slate-200">
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

      <Card title="Periods">
        {periodsQ.isLoading ? (
          <Spinner label="Loading" />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 text-left">Period</th>
                <th className="text-left">Status</th>
                <th className="text-left">Closed</th>
                <th className="text-left">Closed by</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.id} className="border-t border-slate-200">
                  <td className="py-1.5 text-slate-800">
                    {monthName(p.month)} {p.year}
                  </td>
                  <td>
                    <Badge tone={p.status === 'open' ? 'green' : 'slate'}>{p.status}</Badge>
                  </td>
                  <td className="text-xs text-slate-500">
                    {p.closed_at ? new Date(p.closed_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="text-slate-600">{p.closed_by_name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
