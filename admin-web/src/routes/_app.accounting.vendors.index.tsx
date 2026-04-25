import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge, Button, Card, Input, Spinner } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/accounting/vendors/')({
  component: VendorsList,
});

interface Vendor {
  id: string;
  code: string;
  name: string;
  contact_phone: string | null;
  contact_email: string | null;
  ntn: string | null;
  active: boolean;
  outstanding_total: string;
}

function fmt(n: string | number): string {
  return Number(n).toLocaleString('en-PK', { minimumFractionDigits: 2 });
}

function VendorsList() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['vendors'],
    queryFn: () => api.get<{ items: Vendor[] }>('/vendors'),
  });

  const items = (data?.items ?? []).filter((v) => {
    if (!q.trim()) return true;
    const n = q.trim().toLowerCase();
    return (
      v.code.toLowerCase().includes(n) ||
      v.name.toLowerCase().includes(n) ||
      (v.ntn ?? '').includes(n)
    );
  });
  const totalOutstanding = items.reduce((s, v) => s + Number(v.outstanding_total), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Vendors</h1>
        <div className="flex gap-2">
          <Link to="/accounting" className="text-sm text-indigo-600 hover:underline">
            ← Accounting
          </Link>
          <Link to="/accounting/vendors/new">
            <Button>+ New vendor</Button>
          </Link>
        </div>
      </div>

      <Card>
        <div className="mb-3 flex items-center gap-3">
          <div className="min-w-64 flex-1">
            <Input
              placeholder="Search code / name / NTN…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="text-sm text-slate-500">
            Outstanding (filtered):{' '}
            <span className="font-mono text-slate-800">PKR {fmt(totalOutstanding)}</span>
          </div>
        </div>

        {isLoading ? (
          <Spinner label="Loading vendors" />
        ) : items.length === 0 ? (
          <div className="text-sm text-slate-500">
            {data?.items.length === 0 ? 'No vendors yet — add one to start tracking AP.' : 'No matches.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 text-left">Code</th>
                <th className="text-left">Name</th>
                <th className="text-left">Contact</th>
                <th className="text-left">NTN</th>
                <th className="text-right">Outstanding</th>
                <th className="text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((v) => (
                <tr
                  key={v.id}
                  onClick={() =>
                    navigate({ to: '/accounting/vendors/$id', params: { id: v.id } })
                  }
                  className="cursor-pointer border-t border-slate-200 hover:bg-slate-100/70"
                >
                  <td className="py-1.5 font-mono text-xs text-slate-600">{v.code}</td>
                  <td className="text-slate-800">{v.name}</td>
                  <td className="text-xs text-slate-600">
                    {v.contact_phone ?? v.contact_email ?? '—'}
                  </td>
                  <td className="font-mono text-xs text-slate-600">{v.ntn ?? '—'}</td>
                  <td className="text-right font-mono">
                    {Number(v.outstanding_total) > 0 ? (
                      <span className="text-amber-700">PKR {fmt(v.outstanding_total)}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td>
                    <Badge tone={v.active ? 'green' : 'slate'}>
                      {v.active ? 'active' : 'inactive'}
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
