import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { Badge, Button, Card, ErrorNote, Field, Input, Money, Select } from '../components/ui';
import { api, ApiError } from '../lib/api';

const searchSchema = z.object({
  customer_id: z.string().uuid().optional(),
});

export const Route = createFileRoute('/_app/payments/new')({
  component: NewPayment,
  validateSearch: searchSchema,
});

interface Customer {
  id: string;
  code: string;
  name: string;
  outstanding_total: string | null;
}

interface PaymentResult {
  payment_id: string;
  receipt_no: string;
  amount: number;
  allocated: number;
  advance: number;
  allocations: Array<{ invoice_id: string; amount: number }>;
}

function NewPayment() {
  const qc = useQueryClient();
  const search = useSearch({ from: '/_app/payments/new' });

  const [customerId, setCustomerId] = useState(search.customer_id ?? '');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'cash' | 'cheque' | 'bank' | 'upi'>('cash');
  const [modeRef, setModeRef] = useState('');
  const [bankName, setBankName] = useState('');
  const [chequeDate, setChequeDate] = useState('');
  const [force, setForce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PaymentResult | null>(null);

  const customersQ = useQuery({
    queryKey: ['customers', 'all'],
    queryFn: () => api.get<{ items: Customer[] }>('/customers?limit=500'),
  });

  const selectedCustomer = customersQ.data?.items.find((c) => c.id === customerId);

  const record = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<PaymentResult>('/payments', body),
    onSuccess: (r) => {
      setResult(r);
      setError(null);
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['customer360'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not record payment'),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!customerId) return setError('Pick a customer');
    const amt = Number(amount);
    if (!amt || amt <= 0) return setError('Amount must be positive');

    const body: Record<string, unknown> = {
      customer_id: customerId,
      amount: amt,
      mode,
    };
    if (modeRef.trim()) body.mode_ref = modeRef.trim();
    if (mode === 'cheque') {
      if (chequeDate) body.cheque_date = chequeDate;
      if (bankName.trim()) body.bank_name = bankName.trim();
    }
    if (force) body.force = true;
    record.mutate(body);
  };

  if (result) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-slate-100">Payment recorded</h1>
          <Link to="/payments" className="text-sm text-violet-400 hover:underline">
            ← Payments
          </Link>
        </div>
        <Card>
          <div className="space-y-4">
            <div className="flex items-baseline justify-between">
              <div>
                <div className="font-mono text-sm text-slate-400">{result.receipt_no}</div>
                <div className="text-xl font-semibold text-slate-100">
                  <Money value={result.amount} />
                </div>
              </div>
              <Badge tone="green">recorded</Badge>
            </div>
            <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3 text-sm">
              <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
                Allocation (FIFO by due date)
              </div>
              {result.allocations.length === 0 ? (
                <div className="text-slate-400">
                  No allocations — full amount is sitting as advance.
                </div>
              ) : (
                <ul className="space-y-1 text-slate-300">
                  {result.allocations.map((a) => (
                    <li key={a.invoice_id} className="flex justify-between font-mono text-xs">
                      <span>{a.invoice_id.slice(0, 8)}…</span>
                      <Money value={a.amount} />
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex justify-between text-xs text-slate-500">
                <span>Allocated total</span>
                <Money value={result.allocated} />
              </div>
              {result.advance > 0 && (
                <div className="mt-1 flex justify-between text-xs text-amber-300">
                  <span>Advance (unallocated)</span>
                  <Money value={result.advance} />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setResult(null);
                  setAmount('');
                  setModeRef('');
                  setBankName('');
                  setChequeDate('');
                  setForce(false);
                }}
              >
                Record another
              </Button>
              <Link to="/payments">
                <Button>Go to payments</Button>
              </Link>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const dupWarning = error?.toLowerCase().includes('duplicate');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-100">Record payment</h1>
        <Link to="/payments" className="text-sm text-violet-400 hover:underline">
          ← Payments
        </Link>
      </div>

      {error && <ErrorNote message={error} />}

      <Card>
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Customer">
            <Select
              required
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">— pick —</option>
              {customersQ.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Amount"
            hint={
              selectedCustomer?.outstanding_total
                ? `Outstanding: Rs ${Number(selectedCustomer.outstanding_total).toLocaleString('en-US')}`
                : 'PKR'
            }
          >
            <Input
              required
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>

          <Field label="Mode">
            <Select
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
              <option value="bank">Bank transfer</option>
              <option value="upi">UPI / mobile wallet</option>
            </Select>
          </Field>

          <Field label="Reference" optional hint="Txn id, UPI ref, cheque no.">
            <Input
              placeholder="e.g. 1234-5678"
              value={modeRef}
              onChange={(e) => setModeRef(e.target.value)}
            />
          </Field>

          {mode === 'cheque' && (
            <>
              <Field label="Bank name" optional>
                <Input
                  placeholder="Habib Bank"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                />
              </Field>
              <Field label="Cheque date" optional>
                <Input
                  type="date"
                  value={chequeDate}
                  onChange={(e) => setChequeDate(e.target.value)}
                />
              </Field>
            </>
          )}

          {dupWarning && (
            <label className="col-span-full flex items-center gap-2 text-sm text-amber-300">
              <input
                type="checkbox"
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
              />
              Yes, this is not a duplicate — proceed.
            </label>
          )}

          <div className="col-span-full flex justify-end gap-2">
            <Link to="/payments">
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={record.isPending}>
              {record.isPending ? 'Recording…' : 'Record payment'}
            </Button>
          </div>
        </form>
        <p className="mt-3 text-xs text-slate-500">
          Amount is auto-allocated FIFO across open invoices (oldest due first). Unallocated
          remainder stays on the customer as advance. Cheques post as{' '}
          <code>pending</code> — verify or bounce from the payment detail later.
        </p>
      </Card>
    </div>
  );
}
