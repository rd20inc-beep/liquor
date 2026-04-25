import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, Select, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';

export const Route = createFileRoute('/_app/accounting/bills/$id')({
  component: BillDetail,
});

interface BillPayment {
  id: string;
  payment_no: string;
  payment_date: string;
  amount: string;
  pay_account_code: string;
  reference: string | null;
  notes: string | null;
}
interface Bill {
  id: string;
  bill_no: string;
  vendor_id: string;
  vendor_code: string;
  vendor_name: string;
  vendor_ref: string | null;
  bill_date: string;
  due_date: string;
  amount: string;
  outstanding: string;
  status: 'open' | 'partial' | 'paid' | 'cancelled';
  expense_category_name: string | null;
  expense_category_code: string | null;
  gl_account_code: string;
  description: string | null;
  created_by_name: string | null;
  payments: BillPayment[];
}

const statusTone: Record<string, 'amber' | 'green' | 'slate' | 'red'> = {
  open: 'amber',
  partial: 'amber',
  paid: 'green',
  cancelled: 'slate',
};

const PAY_ACCOUNTS = [
  { code: '1010', label: '1010 — Cash on hand' },
  { code: '1110', label: '1110 — Bank — Operating' },
  { code: '1210', label: '1210 — JazzCash' },
  { code: '1220', label: '1220 — EasyPaisa' },
];

function fmt(n: string | number): string {
  return Number(n).toLocaleString('en-PK', { minimumFractionDigits: 2 });
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function BillDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const billQ = useQuery({
    queryKey: ['bills', id],
    queryFn: () => api.get<Bill>(`/bills/${id}`),
  });

  const [showPay, setShowPay] = useState(false);
  const [payForm, setPayForm] = useState({
    payment_date: today(),
    amount: '',
    pay_account_code: '1010',
    reference: '',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);

  const pay = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ id: string; payment_no: string }>('/bill-payments', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bills'] });
      qc.invalidateQueries({ queryKey: ['vendors'] });
      qc.invalidateQueries({ queryKey: ['gl'] });
      setShowPay(false);
      setPayForm({
        payment_date: today(),
        amount: '',
        pay_account_code: '1010',
        reference: '',
        notes: '',
      });
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : 'Could not record payment'),
  });

  if (billQ.isLoading || !billQ.data) return <Spinner label="Loading bill" />;
  const b = billQ.data;
  const outstanding = Number(b.outstanding);

  const onPay = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const amount = Number(payForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Amount must be greater than zero');
      return;
    }
    if (amount > outstanding) {
      setError(`Amount exceeds outstanding (${fmt(outstanding)})`);
      return;
    }
    pay.mutate({
      bill_id: id,
      payment_date: payForm.payment_date,
      amount,
      pay_account_code: payForm.pay_account_code,
      reference: payForm.reference.trim() || undefined,
      notes: payForm.notes.trim() || undefined,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Bill</div>
          <h1 className="text-xl font-semibold text-slate-900">{b.bill_no}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={statusTone[b.status]}>{b.status}</Badge>
          {b.status !== 'paid' && b.status !== 'cancelled' && (
            <Button onClick={() => setShowPay((s) => !s)}>
              {showPay ? 'Hide payment form' : '+ Record payment'}
            </Button>
          )}
          <Link to="/accounting/bills" className="text-sm text-indigo-600 hover:underline">
            ← Bills
          </Link>
        </div>
      </div>

      {error && <ErrorNote message={error} />}

      <Card>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
          <div>
            <dt className="text-xs uppercase text-slate-500">Vendor</dt>
            <dd className="text-slate-800">
              <Link
                to="/accounting/vendors/$id"
                params={{ id: b.vendor_id }}
                className="hover:underline"
              >
                <span className="font-mono text-xs text-slate-500">{b.vendor_code}</span>{' '}
                {b.vendor_name}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Vendor ref</dt>
            <dd className="text-slate-800">{b.vendor_ref ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Bill date</dt>
            <dd className="text-slate-800">{b.bill_date}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Due date</dt>
            <dd className="text-slate-800">{b.due_date}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Category</dt>
            <dd className="text-slate-800">
              {b.expense_category_code ?? '—'} {b.expense_category_name ?? ''}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">GL account</dt>
            <dd className="font-mono text-slate-800">{b.gl_account_code}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Amount</dt>
            <dd className="font-mono text-slate-800">PKR {fmt(b.amount)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Outstanding</dt>
            <dd
              className={
                outstanding > 0
                  ? 'font-mono text-amber-700'
                  : 'font-mono text-emerald-700'
              }
            >
              PKR {fmt(b.outstanding)}
            </dd>
          </div>
          {b.description && (
            <div className="col-span-full">
              <dt className="text-xs uppercase text-slate-500">Description</dt>
              <dd className="text-slate-800">{b.description}</dd>
            </div>
          )}
        </dl>
      </Card>

      {showPay && (
        <Card title="Record payment">
          <form onSubmit={onPay} className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Payment date">
              <Input
                required
                type="date"
                value={payForm.payment_date}
                onChange={(e) =>
                  setPayForm({ ...payForm, payment_date: e.target.value })
                }
              />
            </Field>
            <Field label="Amount" hint={`Outstanding: PKR ${fmt(outstanding)}`}>
              <Input
                required
                type="number"
                min="0"
                step="0.01"
                max={outstanding}
                value={payForm.amount}
                onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
              />
            </Field>
            <Field label="Pay from">
              <Select
                value={payForm.pay_account_code}
                onChange={(e) =>
                  setPayForm({ ...payForm, pay_account_code: e.target.value })
                }
              >
                {PAY_ACCOUNTS.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reference" optional>
              <Input
                value={payForm.reference}
                onChange={(e) =>
                  setPayForm({ ...payForm, reference: e.target.value })
                }
                placeholder="Cheque #, transfer ID…"
              />
            </Field>
            <Field label="Notes" optional>
              <Input
                value={payForm.notes}
                onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })}
              />
            </Field>
            <div className="flex items-end justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowPay(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pay.isPending}>
                {pay.isPending ? 'Posting…' : 'Post payment'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card title="Payments">
        {b.payments.length === 0 ? (
          <div className="text-sm text-slate-500">No payments recorded yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 text-left">Payment #</th>
                <th className="text-left">Date</th>
                <th className="text-right">Amount</th>
                <th className="text-left">Pay from</th>
                <th className="text-left">Ref</th>
                <th className="text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {b.payments.map((p) => (
                <tr key={p.id} className="border-t border-slate-200">
                  <td className="py-1.5 font-mono text-xs text-slate-700">{p.payment_no}</td>
                  <td className="text-slate-700">{p.payment_date}</td>
                  <td className="text-right font-mono text-slate-800">{fmt(p.amount)}</td>
                  <td className="font-mono text-xs text-slate-600">{p.pay_account_code}</td>
                  <td className="text-xs text-slate-600">{p.reference ?? '—'}</td>
                  <td className="text-xs text-slate-600">{p.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
