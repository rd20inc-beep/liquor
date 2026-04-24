import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, Money, Spinner, Tile } from '../components/ui';
import { api, ApiError } from '../lib/api';

export const Route = createFileRoute('/_app/payments/$id')({
  component: PaymentDetail,
});

interface Payment {
  id: string;
  receipt_no: string;
  amount: string;
  mode: 'cash' | 'cheque' | 'bank' | 'upi';
  mode_ref: string | null;
  cheque_date: string | null;
  bank_name: string | null;
  verification_status: 'pending' | 'deposited' | 'verified' | 'bounced';
  verified_at: string | null;
  proof_image_url: string | null;
  collected_at: string;
  locked_at: string | null;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  allocations: Array<{
    invoice_id: string;
    invoice_no: string;
    total: string;
    outstanding: string;
    amount: string;
  }>;
}

const verTone: Record<string, 'slate' | 'green' | 'amber' | 'red' | 'blue'> = {
  pending: 'amber',
  deposited: 'blue',
  verified: 'green',
  bounced: 'red',
};

function PaymentDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [showAction, setShowAction] = useState<'verify' | 'bounce' | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const paymentQ = useQuery({
    queryKey: ['payment', id],
    queryFn: () => api.get<Payment>(`/payments/${id}`),
  });

  const decide = useMutation({
    mutationFn: (body: { decision: 'verified' | 'bounced'; note?: string }) =>
      api.post(`/payments/${id}/verify`, body),
    onSuccess: () => {
      setShowAction(null);
      setNote('');
      setError(null);
      qc.invalidateQueries({ queryKey: ['payment', id] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['customer360'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : 'Verification failed'),
  });

  if (paymentQ.isLoading) return <Spinner label="Loading payment" />;
  if (paymentQ.isError || !paymentQ.data)
    return <div className="text-sm text-red-600">Payment not found.</div>;

  const p = paymentQ.data;
  const amt = Number(p.amount);
  const allocated = p.allocations.reduce((s, a) => s + Number(a.amount), 0);
  const advance = Math.max(0, amt - allocated);
  const isCheque = p.mode === 'cheque';
  const pending = p.verification_status === 'pending';

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Payment</div>
          <h1 className="text-xl font-semibold text-slate-900">
            {p.receipt_no}{' '}
            <Badge tone={verTone[p.verification_status] ?? 'slate'}>
              {p.verification_status}
            </Badge>{' '}
            <Badge>{p.mode}</Badge>
          </h1>
          <div className="mt-1 text-sm text-slate-600">
            <Link
              to="/customers/$id"
              params={{ id: p.customer_id }}
              className="hover:text-indigo-600"
            >
              {p.customer_name}
            </Link>{' '}
            <span className="text-slate-500">({p.customer_code})</span>
            {' · '}
            {new Date(p.collected_at).toLocaleString()}
          </div>
        </div>
        <Link to="/payments" className="text-sm text-indigo-600 hover:underline">
          ← Payments
        </Link>
      </div>

      {error && <ErrorNote message={error} />}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tile label="Amount" value={<Money value={amt} />} tone="blue" />
        <Tile label="Allocated" value={<Money value={allocated} />} />
        <Tile
          label="Advance"
          value={<Money value={advance} />}
          tone={advance > 0 ? 'amber' : undefined}
        />
        <Tile
          label="Locked"
          value={p.locked_at ? 'yes' : 'no'}
          tone={p.locked_at ? 'green' : 'amber'}
          sub={p.locked_at ? new Date(p.locked_at).toLocaleString() : undefined}
        />
      </div>

      {isCheque && (
        <Card title="Cheque details">
          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
            <div>
              <div className="text-xs uppercase text-slate-500">Bank</div>
              <div className="text-slate-800">{p.bank_name ?? '—'}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Cheque date</div>
              <div className="text-slate-800">{p.cheque_date ?? '—'}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Reference</div>
              <div className="font-mono text-slate-800">{p.mode_ref ?? '—'}</div>
            </div>
          </div>
        </Card>
      )}

      <Card title="Allocations">
        {p.allocations.length === 0 ? (
          <div className="text-sm text-slate-500">
            No allocations — the full amount is sitting as advance on the customer.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-1 text-left">Invoice</th>
                <th className="text-right">Invoice total</th>
                <th className="text-right">Outstanding</th>
                <th className="text-right">Applied</th>
              </tr>
            </thead>
            <tbody>
              {p.allocations.map((a) => (
                <tr key={a.invoice_id} className="border-t border-slate-200">
                  <td className="py-1.5 font-mono text-xs">
                    <Link
                      to="/invoices/$id"
                      params={{ id: a.invoice_id }}
                      className="text-indigo-600 underline-offset-2 hover:underline"
                    >
                      {a.invoice_no}
                    </Link>
                  </td>
                  <td className="text-right">
                    <Money value={a.total} />
                  </td>
                  <td className="text-right">
                    <Money value={a.outstanding} />
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

      {isCheque && pending && (
        <div className="flex gap-2">
          <Button onClick={() => setShowAction('verify')}>Verify cheque</Button>
          <Button variant="danger" onClick={() => setShowAction('bounce')}>
            Mark bounced
          </Button>
        </div>
      )}

      {showAction && (
        <Card
          title={
            showAction === 'verify' ? 'Verify cheque' : 'Bounce cheque'
          }
        >
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              decide.mutate({
                decision: showAction === 'verify' ? 'verified' : 'bounced',
                note: note.trim() || undefined,
              });
            }}
          >
            <Field label="Note" optional>
              <Input
                placeholder={
                  showAction === 'verify'
                    ? 'Cleared on statement'
                    : 'Returned — insufficient funds'
                }
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            {showAction === 'bounce' && (
              <p className="text-xs text-amber-700">
                Bouncing appends a compensating debit to the AR ledger, restores outstanding on
                every previously-allocated invoice, and locks the payment as <code>bounced</code>.
              </p>
            )}
            {showAction === 'verify' && (
              <p className="text-xs text-slate-500">
                Verifying appends the ledger credit (if not already posted) and locks the payment.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowAction(null)}
              >
                Close
              </Button>
              <Button
                type="submit"
                variant={showAction === 'bounce' ? 'danger' : 'primary'}
                disabled={decide.isPending}
              >
                {decide.isPending
                  ? 'Saving…'
                  : showAction === 'verify'
                    ? 'Verify'
                    : 'Bounce'}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
