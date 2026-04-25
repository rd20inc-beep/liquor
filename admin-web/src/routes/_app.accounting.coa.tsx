import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge, Card, Input, Spinner } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/accounting/coa')({
  component: ChartOfAccounts,
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
}

const typeTone: Record<Account['type'], 'blue' | 'amber' | 'green' | 'red' | 'slate'> = {
  asset: 'blue',
  liability: 'amber',
  equity: 'slate',
  revenue: 'green',
  cogs: 'red',
  expense: 'red',
};

function ChartOfAccounts() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['gl', 'accounts'],
    queryFn: () => api.get<{ items: Account[] }>('/gl/accounts'),
  });

  const items = (data?.items ?? []).filter((a) => {
    if (type && a.type !== type) return false;
    if (q.trim()) {
      const n = q.trim().toLowerCase();
      if (!a.code.includes(n) && !a.name.toLowerCase().includes(n)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Chart of accounts</h1>
        <Link to="/accounting" className="text-sm text-indigo-600 hover:underline">
          ← Accounting
        </Link>
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap gap-3">
          <div className="w-48">
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm"
            >
              <option value="">All types</option>
              <option value="asset">Asset</option>
              <option value="liability">Liability</option>
              <option value="equity">Equity</option>
              <option value="revenue">Revenue</option>
              <option value="cogs">COGS</option>
              <option value="expense">Expense</option>
            </select>
          </div>
          <div className="min-w-64 flex-1">
            <Input
              placeholder="Search code or name…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>

        {isLoading ? (
          <Spinner label="Loading accounts" />
        ) : items.length === 0 ? (
          <div className="text-sm text-slate-500">No accounts match.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 text-left">Code</th>
                <th className="text-left">Name</th>
                <th className="text-left">Type</th>
                <th className="text-left">Normal</th>
                <th className="text-left">Flags</th>
                <th className="text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr
                  key={a.id}
                  onClick={() =>
                    a.is_postable
                      ? navigate({ to: '/accounting/account/$id', params: { id: a.id } })
                      : null
                  }
                  className={`border-t border-slate-200 ${
                    a.is_postable ? 'cursor-pointer hover:bg-slate-100/70' : 'bg-slate-50/40'
                  }`}
                >
                  <td className="py-1.5 font-mono text-xs text-slate-700">{a.code}</td>
                  <td
                    className={
                      a.is_postable
                        ? 'text-slate-800'
                        : 'font-semibold uppercase tracking-wide text-slate-600'
                    }
                  >
                    {a.name}
                  </td>
                  <td>
                    <Badge tone={typeTone[a.type]}>{a.type}</Badge>
                  </td>
                  <td className="text-xs text-slate-600">{a.normal_side}</td>
                  <td className="text-xs">
                    {!a.is_postable && (
                      <span className="mr-1 text-slate-500">header</span>
                    )}
                    {a.is_control && <Badge tone="amber">control</Badge>}
                  </td>
                  <td>
                    <Badge tone={a.active ? 'green' : 'slate'}>
                      {a.active ? 'active' : 'inactive'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
