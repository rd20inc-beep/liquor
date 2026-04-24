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

interface OpenInvoice {
  id: string;
  invoice_no: string;
  due_date: string;
  total: string;
  outstanding: string;
  days_overdue: number;
  status: string;
}

interface PaymentResult {
  payment_id: string;
  receipt_no: string;
  amount: number;
  allocated: number;
  advance: number;
  allocations: Array<{ invoice_id: string; amount: number }>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
  // invoice_id → apply amount (as a string so blank ≠ 0)
  const [applyMap, setApplyMap] = useState<Record<string, string>>({});

  const customersQ = useQuery({
    queryKey: ['customers', 'all'],
    queryFn: () => api.get<{ items: Customer[] }>('/customers?limit=500'),
  });

  const selectedCustomer = customersQ.data?.items.find((c) => c.id === customerId);

  // Open invoices for the selected customer
  const openInvoicesQ = useQuery({
    queryKey: ['invoices', 'for-customer', customerId],
    enabled: Boolean(customerId),
    queryFn: () =>
      api
        .get<{ items: OpenInvoice[] }>(`/invoices?customer_id=${customerId}&limit=200`)
        .then((r) => ({
          items: r.items
            .filter((i) => ['open', 'partial', 'disputed'].includes(i.status))
            .sort((a, b) => a.due_date.localeCompare(b.due_date)),
        })),
  });
  const openInvoices = openInvoicesQ.data?.items ?? [];

  // Reset allocation map when the customer changes
  const onPickCustomer = (id: string) => {
    setCustomerId(id);
    setApplyMap({});
  };

  // Totals for UI feedback
  const amt = Number(amount) || 0;
  const allocatedSum = Object.values(applyMap).reduce((s, v) => s + (Number(v) || 0), 0);
  const remaining = round2(amt - allocatedSum);
  const overAllocated = allocatedSum > amt + 0.001;

  // Auto-FIFO: distribute `amt` oldest-first across open invoices
  const autoFIFO = () => {
    let left = amt;
    const next: Record<string, string> = {};
    for (const inv of openInvoices) {
      if (left <= 0) break;
      const owed = Number(inv.outstanding);
      if (owed <= 0) continue;
      const take = Math.min(owed, left);
      next[inv.id] = String(round2(take));
      left = round2(left - take);
    }
    setApplyMap(next);
  };

  const clearAllocations = () => setApplyMap({});

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
    if (!amt || amt <= 0) return setError('Amount must be positive');
    if (overAllocated) {
      return setError(
        `Allocations (Rs ${allocatedSum.toLocaleString('en-US')}) exceed payment amount`,
      );
    }

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

    // Only pass allocations if admin filled in any — otherwise let the server FIFO.
    const allocations = Object.entries(applyMap)
      .map(([invoice_id, v]) => ({ invoice_id, amount: Number(v) || 0 }))
      .filter((a) => a.amount > 0);
    if (allocations.length > 0) body.allocations = allocations;

    record.mutate(body);
  };

  if (result) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-slate-900">Payment recorded</h1>
          <Link to="/payments" className="text-sm text-indigo-600 hover:underline">
            ← Payments
          </Link>
        </div>
        <Card>
          <div className="space-y-4">
            <div className="flex items-baseline justify-between">
              <div>
                <div className="font-mono text-sm text-slate-600">{result.receipt_no}</div>
                <div className="text-xl font-semibold text-slate-900">
                  <Money value={result.amount} />
                </div>
              </div>
              <Badge tone="green">recorded</Badge>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-100/60 p-3 text-sm">
              <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
                Allocation (FIFO by due date)
              </div>
              {result.allocations.length === 0 ? (
                <div className="text-slate-600">
                  No allocations — full amount is sitting as advance.
                </div>
              ) : (
                <ul className="space-y-1 text-slate-700">
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
                <div className="mt-1 flex justify-between text-xs text-amber-700">
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
        <h1 className="text-xl font-semibold text-slate-900">Record payment</h1>
        <Link to="/payments" className="text-sm text-indigo-600 hover:underline">
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
              onChange={(e) => onPickCustomer(e.target.value)}
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

          {/* Multi-invoice allocation — shows only when customer has open invoices */}
          {customerId && openInvoices.length > 0 && (
            <div className="col-span-full">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Apply to invoices
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    Leave blank to let the system auto-allocate FIFO (oldest due first).
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={autoFIFO}
                    disabled={!amt}
                    title={!amt ? 'Enter an amount first' : 'Distribute oldest-first'}
                  >
                    Auto FIFO
                  </Button>
                  <Button type="button" variant="ghost" onClick={clearAllocations}>
                    Clear
                  </Button>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Invoice</th>
                      <th className="px-3 text-left">Due</th>
                      <th className="px-3 text-right">Outstanding</th>
                      <th className="px-3 text-right">Apply</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openInvoices.map((inv) => {
                      const owed = Number(inv.outstanding);
                      const applied = Number(applyMap[inv.id] ?? 0);
                      const overLine = applied > owed + 0.001;
                      return (
                        <tr key={inv.id} className="border-t border-slate-100">
                          <td className="px-3 py-1.5 font-mono text-xs text-indigo-600">
                            {inv.invoice_no}
                          </td>
                          <td className="px-3 text-xs text-slate-500">
                            {inv.due_date?.slice(0, 10)}
                            {inv.days_overdue > 0 && (
                              <span className="ml-1 text-red-600">
                                ({inv.days_overdue}d)
                              </span>
                            )}
                          </td>
                          <td className="px-3 text-right">
                            <Money value={owed} />
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0"
                              className={`w-28 text-right ${overLine ? 'border-red-500 focus:border-red-500 focus:ring-red-500/30' : ''}`}
                              value={applyMap[inv.id] ?? ''}
                              onChange={(e) =>
                                setApplyMap({ ...applyMap, [inv.id]: e.target.value })
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200 bg-slate-50">
                      <td
                        colSpan={3}
                        className="px-3 py-2 text-right text-xs uppercase text-slate-500"
                      >
                        Allocated
                      </td>
                      <td className="px-3 text-right text-sm font-semibold">
                        <span className={overAllocated ? 'text-red-600' : 'text-slate-900'}>
                          <Money value={allocatedSum} />
                        </span>
                      </td>
                    </tr>
                    {amt > 0 && (
                      <tr className="border-t border-slate-100 bg-slate-50">
                        <td
                          colSpan={3}
                          className="px-3 py-2 text-right text-xs uppercase text-slate-500"
                        >
                          {remaining >= 0 ? 'Remaining (goes to advance)' : 'Over-allocated by'}
                        </td>
                        <td className="px-3 text-right text-sm">
                          <span
                            className={
                              remaining < 0
                                ? 'text-red-600'
                                : remaining > 0
                                  ? 'text-amber-700'
                                  : 'text-slate-500'
                            }
                          >
                            <Money value={Math.abs(remaining)} />
                          </span>
                        </td>
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {customerId && openInvoicesQ.data && openInvoices.length === 0 && (
            <div className="col-span-full rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              This customer has no open invoices — the full amount will sit as advance until
              future invoices are raised.
            </div>
          )}

          {dupWarning && (
            <label className="col-span-full flex items-center gap-2 text-sm text-amber-700">
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
