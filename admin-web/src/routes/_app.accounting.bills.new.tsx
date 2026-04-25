import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, Card, ErrorNote, Field, Input, Select } from '../components/ui';
import { api, ApiError } from '../lib/api';

export const Route = createFileRoute('/_app/accounting/bills/new')({
  component: NewBill,
});

interface Vendor {
  id: string;
  code: string;
  name: string;
  active: boolean;
}
interface Category {
  id: string;
  code: string;
  name: string;
  gl_account_code: string;
  active: boolean;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function NewBill() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const vendorsQ = useQuery({
    queryKey: ['vendors'],
    queryFn: () => api.get<{ items: Vendor[] }>('/vendors'),
  });
  const categoriesQ = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => api.get<{ items: Category[] }>('/expense-categories'),
  });

  const [form, setForm] = useState({
    vendor_id: '',
    vendor_ref: '',
    bill_date: today(),
    due_date: addDays(today(), 15),
    expense_category_id: '',
    amount: '',
    description: '',
  });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ id: string; bill_no: string }>('/bills', body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['bills'] });
      qc.invalidateQueries({ queryKey: ['vendors'] });
      qc.invalidateQueries({ queryKey: ['gl'] });
      void navigate({ to: '/accounting/bills/$id', params: { id: res.id } });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not create bill'),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.vendor_id) {
      setError('Pick a vendor');
      return;
    }
    if (!form.expense_category_id) {
      setError('Pick an expense category');
      return;
    }
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Amount must be greater than zero');
      return;
    }
    create.mutate({
      vendor_id: form.vendor_id,
      vendor_ref: form.vendor_ref.trim() || undefined,
      bill_date: form.bill_date,
      due_date: form.due_date,
      expense_category_id: form.expense_category_id,
      amount,
      description: form.description.trim() || undefined,
    });
  };

  const activeVendors = (vendorsQ.data?.items ?? []).filter((v) => v.active);
  const activeCategories = (categoriesQ.data?.items ?? []).filter((c) => c.active);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">New bill</h1>
        <Link to="/accounting/bills" className="text-sm text-indigo-600 hover:underline">
          ← Bills
        </Link>
      </div>

      {error && <ErrorNote message={error} />}

      <Card>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Vendor">
            <Select
              required
              value={form.vendor_id}
              onChange={(e) => setForm({ ...form, vendor_id: e.target.value })}
            >
              <option value="">— pick —</option>
              {activeVendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.code} — {v.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Vendor ref" optional hint="Their invoice number">
            <Input
              value={form.vendor_ref}
              onChange={(e) => setForm({ ...form, vendor_ref: e.target.value })}
              placeholder="e.g. PSO-2026-0042"
            />
          </Field>

          <Field label="Expense category">
            <Select
              required
              value={form.expense_category_id}
              onChange={(e) => setForm({ ...form, expense_category_id: e.target.value })}
            >
              <option value="">— pick —</option>
              {activeCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name} ({c.gl_account_code})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Amount" hint="PKR">
            <Input
              required
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="0.00"
            />
          </Field>

          <Field label="Bill date">
            <Input
              required
              type="date"
              value={form.bill_date}
              onChange={(e) => setForm({ ...form, bill_date: e.target.value })}
            />
          </Field>

          <Field label="Due date">
            <Input
              required
              type="date"
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            />
          </Field>

          <Field label="Description" optional>
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What was billed"
            />
          </Field>

          <div className="col-span-full flex justify-end gap-2">
            <Link to="/accounting/bills">
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Posting…' : 'Post bill'}
            </Button>
          </div>
        </form>
        <p className="mt-3 text-xs text-slate-500">
          Posting books a journal entry: DR{' '}
          <code className="text-slate-700">expense category</code> / CR{' '}
          <code className="text-slate-700">2100 Accounts Payable</code>. Settle later via
          a bill payment.
        </p>
      </Card>
    </div>
  );
}
