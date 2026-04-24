import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge, Button, Card, Input, Money, Spinner } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/customers/')({
  component: CustomersList,
});

interface Customer {
  id: string;
  code: string;
  name: string;
  type: string;
  status: 'active' | 'hold' | 'blocked' | 'dispute';
  phone: string | null;
  credit_limit: string;
  outstanding_total: string | null;
  available_credit: string | null;
  risk_score: string | null;
}

const statusTone = {
  active: 'green',
  hold: 'amber',
  blocked: 'red',
  dispute: 'red',
} as const;

function CustomersList() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | Customer['status']>('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['customers', search, status],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '100' });
      if (search) params.set('q', search);
      if (status) params.set('status', status);
      return api.get<{ items: Customer[] }>(`/customers?${params.toString()}`);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-100">Customers</h1>
        <Link to="/customers/new">
          <Button>+ New customer</Button>
        </Link>
      </div>

      <Card>
        <div className="flex flex-wrap gap-3">
          <div className="min-w-64 flex-1">
            <Input
              placeholder="Search by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as '' | Customer['status'])}
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="hold">Hold</option>
            <option value="blocked">Blocked</option>
            <option value="dispute">Dispute</option>
          </select>
        </div>
      </Card>

      <Card>
        {isLoading ? (
          <Spinner label="Loading customers" />
        ) : isError ? (
          <div className="text-sm text-red-400">Failed to load customers.</div>
        ) : data?.items.length === 0 ? (
          <div className="text-sm text-slate-500">No customers match your filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 text-left">Code</th>
                  <th className="text-left">Name</th>
                  <th className="text-left">Status</th>
                  <th className="text-right">Credit limit</th>
                  <th className="text-right">Outstanding</th>
                  <th className="text-right">Available</th>
                  <th className="text-right">Risk</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((c) => (
                  <tr
                    key={c.id}
                    className="border-t border-slate-800/60 hover:bg-slate-900/50"
                  >
                    <td className="py-2 text-slate-400">{c.code}</td>
                    <td>
                      <Link
                        to="/customers/$id"
                        params={{ id: c.id }}
                        className="text-slate-200 hover:text-violet-400"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td>
                      <Badge tone={statusTone[c.status]}>{c.status}</Badge>
                    </td>
                    <td className="text-right">
                      <Money value={c.credit_limit} />
                    </td>
                    <td className="text-right">
                      <Money value={c.outstanding_total} />
                    </td>
                    <td className="text-right">
                      <Money value={c.available_credit} />
                    </td>
                    <td className="text-right text-xs text-slate-400">
                      {c.risk_score ? Number(c.risk_score).toFixed(2) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
