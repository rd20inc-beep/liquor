import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { Badge, Card, Spinner } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/accounting/vendors/$id')({
  component: VendorDetail,
});

interface Vendor {
  id: string;
  code: string;
  name: string;
  contact_phone: string | null;
  contact_email: string | null;
  address: string | null;
  ntn: string | null;
  notes: string | null;
  active: boolean;
  outstanding_total: string;
  created_at: string;
}

interface Bill {
  id: string;
  bill_no: string;
  vendor_ref: string | null;
  bill_date: string;
  due_date: string;
  amount: string;
  outstanding: string;
  status: string;
  description: string | null;
}

const statusTone: Record<string, 'slate' | 'amber' | 'green' | 'red'> = {
  open: 'amber',
  partial: 'amber',
  paid: 'green',
  cancelled: 'slate',
};

function fmt(n: string | number): string {
  return Number(n).toLocaleString('en-PK', { minimumFractionDigits: 2 });
}

function VendorDetail() {
  const { id } = Route.useParams();
  const vQ = useQuery({
    queryKey: ['vendors', id],
    queryFn: () => api.get<Vendor>(`/vendors/${id}`),
  });
  const billsQ = useQuery({
    queryKey: ['vendors', id, 'bills'],
    queryFn: () => api.get<{ items: Bill[] }>(`/bills?vendor_id=${id}&limit=100`),
  });

  if (vQ.isLoading || !vQ.data) return <Spinner label="Loading vendor" />;
  const v = vQ.data;
  const bills = billsQ.data?.items ?? [];
  const outstanding = Number(v.outstanding_total);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Vendor</div>
          <h1 className="text-xl font-semibold text-slate-900">
            {v.name}{' '}
            <span className="ml-1 font-mono text-sm text-slate-500">({v.code})</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={v.active ? 'green' : 'slate'}>{v.active ? 'active' : 'inactive'}</Badge>
          <Link to="/accounting/vendors" className="text-sm text-indigo-600 hover:underline">
            ← Vendors
          </Link>
        </div>
      </div>

      <Card>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
          <div>
            <dt className="text-xs uppercase text-slate-500">Outstanding</dt>
            <dd className={outstanding > 0 ? 'font-mono text-amber-700' : 'text-slate-500'}>
              {outstanding > 0 ? `PKR ${fmt(outstanding)}` : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">NTN</dt>
            <dd className="font-mono text-slate-800">{v.ntn ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Phone</dt>
            <dd className="text-slate-800">{v.contact_phone ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Email</dt>
            <dd className="text-slate-800">{v.contact_email ?? '—'}</dd>
          </div>
          {v.address && (
            <div className="col-span-full">
              <dt className="text-xs uppercase text-slate-500">Address</dt>
              <dd className="text-slate-800">{v.address}</dd>
            </div>
          )}
          {v.notes && (
            <div className="col-span-full">
              <dt className="text-xs uppercase text-slate-500">Notes</dt>
              <dd className="text-slate-800">{v.notes}</dd>
            </div>
          )}
        </dl>
      </Card>

      <Card title="Bills">
        {billsQ.isLoading ? (
          <Spinner label="Loading bills" />
        ) : bills.length === 0 ? (
          <div className="text-sm text-slate-500">No bills recorded for this vendor.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 text-left">Bill #</th>
                <th className="text-left">Vendor ref</th>
                <th className="text-left">Bill date</th>
                <th className="text-left">Due</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Outstanding</th>
                <th className="text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => (
                <tr
                  key={b.id}
                  className="border-t border-slate-200 hover:bg-slate-100/70"
                >
                  <td className="py-1.5 font-mono text-xs">
                    <Link
                      to="/accounting/bills/$id"
                      params={{ id: b.id }}
                      className="text-indigo-600 hover:underline"
                    >
                      {b.bill_no}
                    </Link>
                  </td>
                  <td className="text-xs text-slate-600">{b.vendor_ref ?? '—'}</td>
                  <td className="text-slate-700">{b.bill_date}</td>
                  <td className="text-slate-700">{b.due_date}</td>
                  <td className="text-right font-mono text-slate-800">{fmt(b.amount)}</td>
                  <td className="text-right font-mono">
                    {Number(b.outstanding) > 0 ? (
                      <span className="text-amber-700">{fmt(b.outstanding)}</span>
                    ) : (
                      <span className="text-slate-400">paid</span>
                    )}
                  </td>
                  <td>
                    <Badge tone={statusTone[b.status] ?? 'slate'}>{b.status}</Badge>
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
