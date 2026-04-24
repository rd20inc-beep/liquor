import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Field,
  Input,
  Money,
  Spinner,
  Tile,
} from '../components/ui';
import { api, ApiError } from '../lib/api';

export const Route = createFileRoute('/_app/invoices/$id')({
  component: InvoiceDetail,
});

interface InvoiceDetailPayload {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string;
  subtotal: string;
  tax_total: string;
  total: string;
  outstanding: string;
  status: 'open' | 'partial' | 'paid' | 'disputed' | 'void';
  locked_at: string | null;
  order_id: string | null;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  lines: Array<{
    id: string;
    product_id: string;
    sku: string;
    product_name: string;
    batch_id: string | null;
    batch_no: string | null;
    expiry_date: string | null;
    qty: number;
    unit_price: string;
    tax_rate: string;
    line_total: string;
  }>;
  allocations: Array<{
    payment_id: string;
    receipt_no: string;
    mode: string;
    verification_status: string;
    collected_at: string;
    amount: string;
  }>;
  credit_notes: Array<{
    id: string;
    cn_no: string;
    amount: string;
    reason: string;
    issued_at: string;
  }>;
}

const statusTone: Record<string, 'slate' | 'green' | 'amber' | 'red' | 'blue'> = {
  open: 'amber',
  partial: 'amber',
  paid: 'green',
  disputed: 'red',
  void: 'slate',
};

function asDate(s: string | null | undefined): string {
  return s ? s.slice(0, 10) : '—';
}

function InvoiceDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();

  const [showCN, setShowCN] = useState(false);
  const [cnAmount, setCnAmount] = useState('');
  const [cnReason, setCnReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const invoiceQ = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.get<InvoiceDetailPayload>(`/invoices/${id}`),
  });

  const raiseCN = useMutation({
    mutationFn: (body: { customer_id: string; invoice_id: string; amount: number; reason: string }) =>
      api.post('/credit-notes', body),
    onSuccess: (r: unknown) => {
      setShowCN(false);
      setCnAmount('');
      setCnReason('');
      setError(null);
      const queued =
        typeof r === 'object' && r !== null && 'approval' in r
          ? 'Credit note queued for admin approval.'
          : 'Credit note posted.';
      setFlash(queued);
      qc.invalidateQueries({ queryKey: ['invoice', id] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['customer360'] });
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : 'Could not raise credit note'),
  });

  if (invoiceQ.isLoading) return <Spinner label="Loading invoice" />;
  if (invoiceQ.isError || !invoiceQ.data)
    return <div className="text-sm text-red-600">Invoice not found.</div>;

  const inv = invoiceQ.data;
  const daysOverdue = Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(asDate(inv.due_date) + 'T00:00:00Z').getTime()) / 86400000,
    ),
  );
  const canRaiseCN = inv.status !== 'paid' && inv.status !== 'void' && Number(inv.outstanding) > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Invoice</div>
          <h1 className="text-xl font-semibold text-slate-900">
            {inv.invoice_no}{' '}
            <Badge tone={statusTone[inv.status] ?? 'slate'}>{inv.status}</Badge>{' '}
            {inv.locked_at && <Badge tone="green">locked</Badge>}
          </h1>
          <div className="mt-1 text-sm text-slate-600">
            <Link
              to="/customers/$id"
              params={{ id: inv.customer_id }}
              className="hover:text-indigo-600"
            >
              {inv.customer_name}
            </Link>{' '}
            <span className="text-slate-500">({inv.customer_code})</span>
            {' · issued '}
            {asDate(inv.invoice_date)}
            {' · due '}
            {asDate(inv.due_date)}
            {daysOverdue > 0 && (
              <span className="ml-1 text-red-600">({daysOverdue}d overdue)</span>
            )}
          </div>
        </div>
        <Link to="/invoices" className="text-sm text-indigo-600 hover:underline">
          ← Invoices
        </Link>
      </div>

      {error && <ErrorNote message={error} />}
      {flash && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {flash}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tile label="Subtotal" value={<Money value={inv.subtotal} />} />
        <Tile label="Tax" value={<Money value={inv.tax_total} />} />
        <Tile label="Total" value={<Money value={inv.total} />} tone="blue" />
        <Tile
          label="Outstanding"
          value={<Money value={inv.outstanding} />}
          tone={Number(inv.outstanding) === 0 ? 'green' : 'amber'}
        />
      </div>

      {inv.order_id && (
        <Card title="Source order">
          <Link
            to="/orders/$id"
            params={{ id: inv.order_id }}
            className="text-indigo-600 underline-offset-2 hover:underline"
          >
            Open order
          </Link>
        </Card>
      )}

      <Card title="Lines">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-1 text-left">Product</th>
                <th className="text-left">SKU</th>
                <th className="text-left">Batch</th>
                <th className="text-left">Expiry</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Unit</th>
                <th className="text-right">Tax %</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l) => (
                <tr key={l.id} className="border-t border-slate-200">
                  <td className="py-1.5 text-slate-800">{l.product_name}</td>
                  <td className="font-mono text-xs text-slate-600">{l.sku}</td>
                  <td className="font-mono text-xs text-slate-600">
                    {l.batch_no ?? '—'}
                  </td>
                  <td className="text-xs text-slate-600">{asDate(l.expiry_date)}</td>
                  <td className="text-right">{l.qty}</td>
                  <td className="text-right">
                    <Money value={l.unit_price} />
                  </td>
                  <td className="text-right text-slate-600">{Number(l.tax_rate)}</td>
                  <td className="text-right">
                    <Money value={l.line_total} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title={
          <span className="flex items-center gap-2">
            Allocations
            <Badge tone={inv.allocations.length > 0 ? 'blue' : 'slate'}>
              {inv.allocations.length}
            </Badge>
          </span>
        }
      >
        {inv.allocations.length === 0 ? (
          <div className="text-sm text-slate-500">No payments allocated yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-1 text-left">Receipt</th>
                <th className="text-left">Mode</th>
                <th className="text-left">Verification</th>
                <th className="text-left">Collected</th>
                <th className="text-right">Applied</th>
              </tr>
            </thead>
            <tbody>
              {inv.allocations.map((a) => (
                <tr key={a.payment_id} className="border-t border-slate-200">
                  <td className="py-1.5 font-mono text-xs">
                    <Link
                      to="/payments/$id"
                      params={{ id: a.payment_id }}
                      className="text-indigo-600 underline-offset-2 hover:underline"
                    >
                      {a.receipt_no}
                    </Link>
                  </td>
                  <td>
                    <Badge>{a.mode}</Badge>
                  </td>
                  <td>
                    <Badge
                      tone={
                        a.verification_status === 'verified'
                          ? 'green'
                          : a.verification_status === 'bounced'
                            ? 'red'
                            : 'amber'
                      }
                    >
                      {a.verification_status}
                    </Badge>
                  </td>
                  <td className="text-xs text-slate-600">
                    {new Date(a.collected_at).toLocaleString()}
                  </td>
                  <td className="text-right">
                    <Money value={a.amount} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {inv.credit_notes.length > 0 && (
        <Card title="Credit notes">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-1 text-left">CN no.</th>
                <th className="text-left">Reason</th>
                <th className="text-left">Issued</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {inv.credit_notes.map((cn) => (
                <tr key={cn.id} className="border-t border-slate-200">
                  <td className="py-1.5 font-mono text-xs text-slate-800">{cn.cn_no}</td>
                  <td className="text-slate-700">{cn.reason}</td>
                  <td className="text-xs text-slate-600">
                    {new Date(cn.issued_at).toLocaleString()}
                  </td>
                  <td className="text-right">
                    <Money value={cn.amount} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {canRaiseCN && (
        <div className="flex flex-wrap gap-2">
          <Link to="/payments/new" search={{ customer_id: inv.customer_id }}>
            <Button>Record payment</Button>
          </Link>
          <Button variant="secondary" onClick={() => setShowCN((v) => !v)}>
            {showCN ? 'Close' : 'Raise credit note'}
          </Button>
        </div>
      )}

      {showCN && (
        <Card title="Raise credit note">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              raiseCN.mutate({
                customer_id: inv.customer_id,
                invoice_id: inv.id,
                amount: Number(cnAmount),
                reason: cnReason,
              });
            }}
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field
                label="Amount"
                hint={`Outstanding: Rs ${Number(inv.outstanding).toLocaleString('en-US')}`}
              >
                <Input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={inv.outstanding}
                  value={cnAmount}
                  onChange={(e) => setCnAmount(e.target.value)}
                />
              </Field>
              <Field label="Reason">
                <Input
                  required
                  placeholder="e.g. damaged in transit, price correction"
                  value={cnReason}
                  onChange={(e) => setCnReason(e.target.value)}
                />
              </Field>
            </div>
            <p className="text-xs text-slate-500">
              Non-admins: this queues an approval request. Admin/owner: it's posted immediately
              — the invoice outstanding drops, a ledger credit is appended, and the customer
              balance updates.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowCN(false)}>
                Close
              </Button>
              <Button type="submit" disabled={raiseCN.isPending}>
                {raiseCN.isPending ? 'Submitting…' : 'Submit'}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
