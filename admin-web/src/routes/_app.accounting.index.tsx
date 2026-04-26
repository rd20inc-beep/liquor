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
  const vendorsQ = useQuery({
    queryKey: ['vendors'],
    queryFn: () => api.get<{ items: Array<{ outstanding_total: string; active: boolean }> }>('/vendors'),
  });
  const expensesQ = useQuery({
    queryKey: ['expenses', 'recent'],
    queryFn: () => api.get<{ items: Array<{ amount: string }> }>('/expenses?limit=200'),
  });

  const periods = periodsQ.data?.items ?? [];
  const open = periods.filter((p) => p.status === 'open');
  const current = open[0] ?? periods[0] ?? null;
  const apOutstanding = (vendorsQ.data?.items ?? []).reduce(
    (s, v) => s + Number(v.outstanding_total),
    0,
  );
  const expenseTotal = (expensesQ.data?.items ?? []).reduce(
    (s, e) => s + Number(e.amount),
    0,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Accounting</h1>
        <div className="flex flex-wrap gap-2">
          <Link to="/accounting/vendors">
            <Button variant="secondary">Vendors</Button>
          </Link>
          <Link to="/accounting/bills">
            <Button variant="secondary">Bills</Button>
          </Link>
          <Link to="/accounting/expenses">
            <Button variant="secondary">Expenses</Button>
          </Link>
          <Link to="/accounting/coa">
            <Button variant="secondary">Chart of accounts</Button>
          </Link>
          <Link to="/accounting/trial-balance">
            <Button variant="secondary">Trial balance</Button>
          </Link>
          <Link to="/accounting/journals/new">
            <Button>+ New JE</Button>
          </Link>
        </div>
      </div>

      <Card title="Reports">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Link
            to="/accounting/reports/balance-sheet"
            className="group rounded-lg border border-slate-200 bg-white p-3 transition hover:border-indigo-400 hover:shadow-sm"
          >
            <div className="text-sm font-semibold text-slate-900 group-hover:text-indigo-700">
              Balance sheet
            </div>
            <div className="text-xs text-slate-500">Assets / liabilities / equity at a date</div>
          </Link>
          <Link
            to="/accounting/reports/profit-loss"
            className="group rounded-lg border border-slate-200 bg-white p-3 transition hover:border-indigo-400 hover:shadow-sm"
          >
            <div className="text-sm font-semibold text-slate-900 group-hover:text-indigo-700">
              Profit &amp; loss
            </div>
            <div className="text-xs text-slate-500">Revenue − COGS − expenses for a period</div>
          </Link>
          <Link
            to="/accounting/reports/cash-activity"
            className="group rounded-lg border border-slate-200 bg-white p-3 transition hover:border-indigo-400 hover:shadow-sm"
          >
            <div className="text-sm font-semibold text-slate-900 group-hover:text-indigo-700">
              Cash activity
            </div>
            <div className="text-xs text-slate-500">Per-account opening / receipts / disbursements / closing</div>
          </Link>
          <Link
            to="/accounting/reports/ar-aging"
            className="group rounded-lg border border-slate-200 bg-white p-3 transition hover:border-indigo-400 hover:shadow-sm"
          >
            <div className="text-sm font-semibold text-slate-900 group-hover:text-indigo-700">
              AR aging
            </div>
            <div className="text-xs text-slate-500">Customer outstanding by overdue bucket</div>
          </Link>
          <Link
            to="/accounting/reports/ap-aging"
            className="group rounded-lg border border-slate-200 bg-white p-3 transition hover:border-indigo-400 hover:shadow-sm"
          >
            <div className="text-sm font-semibold text-slate-900 group-hover:text-indigo-700">
              AP aging
            </div>
            <div className="text-xs text-slate-500">Vendor outstanding by overdue bucket</div>
          </Link>
          <Link
            to="/accounting/reports/reconciliation"
            className="group rounded-lg border border-slate-200 bg-white p-3 transition hover:border-indigo-400 hover:shadow-sm"
          >
            <div className="text-sm font-semibold text-slate-900 group-hover:text-indigo-700">
              Reconciliation
            </div>
            <div className="text-xs text-slate-500">Subledger totals vs GL control accounts</div>
          </Link>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tile
          label="Current period"
          value={current ? `${monthName(current.month)} ${current.year}` : '—'}
          sub={current?.status === 'open' ? 'open' : 'closed'}
          tone={current?.status === 'open' ? 'green' : 'amber'}
        />
        <Tile
          label="AP outstanding"
          value={
            vendorsQ.isLoading ? (
              <Spinner />
            ) : (
              `PKR ${apOutstanding.toLocaleString('en-PK', { minimumFractionDigits: 0 })}`
            )
          }
          sub={apOutstanding > 0 ? 'across vendors' : 'all settled'}
          tone={apOutstanding > 0 ? 'amber' : 'green'}
        />
        <Tile
          label="Expenses (last 200)"
          value={
            expensesQ.isLoading ? (
              <Spinner />
            ) : (
              `PKR ${expenseTotal.toLocaleString('en-PK', { minimumFractionDigits: 0 })}`
            )
          }
          sub="recent"
          tone="blue"
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
