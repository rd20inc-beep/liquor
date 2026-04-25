import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, Card, ErrorNote, Field, Input, Select } from '../components/ui';
import { api, ApiError } from '../lib/api';

export const Route = createFileRoute('/_app/accounting/expenses/new')({
  component: NewExpense,
});

interface Category {
  id: string;
  code: string;
  name: string;
  gl_account_code: string;
  active: boolean;
}
interface Vendor {
  id: string;
  code: string;
  name: string;
  active: boolean;
}
interface Vehicle {
  id: string;
  reg_no: string;
  active: boolean;
}

const PAY_ACCOUNTS = [
  { code: '1010', label: '1010 — Cash on hand' },
  { code: '1110', label: '1110 — Bank — Operating' },
  { code: '1210', label: '1210 — JazzCash' },
  { code: '1220', label: '1220 — EasyPaisa' },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function NewExpense() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const categoriesQ = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => api.get<{ items: Category[] }>('/expense-categories'),
  });
  const vendorsQ = useQuery({
    queryKey: ['vendors'],
    queryFn: () => api.get<{ items: Vendor[] }>('/vendors'),
  });
  const vehiclesQ = useQuery({
    queryKey: ['masters', 'vehicles'],
    queryFn: () => api.get<{ items: Vehicle[] }>('/vehicles'),
  });

  const [form, setForm] = useState({
    expense_date: today(),
    expense_category_id: '',
    amount: '',
    pay_account_code: '1010',
    vendor_id: '',
    vehicle_id: '',
    description: '',
  });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ id: string; expense_no: string }>('/expenses', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['gl'] });
      void navigate({ to: '/accounting/expenses' });
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : 'Could not record expense'),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.expense_category_id) {
      setError('Pick a category');
      return;
    }
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Amount must be greater than zero');
      return;
    }
    create.mutate({
      expense_date: form.expense_date,
      expense_category_id: form.expense_category_id,
      amount,
      pay_account_code: form.pay_account_code,
      vendor_id: form.vendor_id || undefined,
      vehicle_id: form.vehicle_id || undefined,
      description: form.description.trim() || undefined,
    });
  };

  const activeCategories = (categoriesQ.data?.items ?? []).filter((c) => c.active);
  const activeVendors = (vendorsQ.data?.items ?? []).filter((v) => v.active);
  const activeVehicles = (vehiclesQ.data?.items ?? []).filter((v) => v.active);

  const selectedCategory = activeCategories.find((c) => c.id === form.expense_category_id);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">New expense</h1>
        <Link to="/accounting/expenses" className="text-sm text-indigo-600 hover:underline">
          ← Expenses
        </Link>
      </div>

      {error && <ErrorNote message={error} />}

      <Card>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Expense date">
            <Input
              required
              type="date"
              value={form.expense_date}
              onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
            />
          </Field>

          <Field label="Amount" hint="PKR">
            <Input
              required
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </Field>

          <Field
            label="Category"
            hint={
              selectedCategory
                ? `Posts to ${selectedCategory.gl_account_code} ${selectedCategory.name}`
                : 'Pick the expense category'
            }
          >
            <Select
              required
              value={form.expense_category_id}
              onChange={(e) =>
                setForm({ ...form, expense_category_id: e.target.value })
              }
            >
              <option value="">— pick —</option>
              {activeCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name} ({c.gl_account_code})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Paid from">
            <Select
              value={form.pay_account_code}
              onChange={(e) =>
                setForm({ ...form, pay_account_code: e.target.value })
              }
            >
              {PAY_ACCOUNTS.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Vendor" optional hint="If linked to a known vendor">
            <Select
              value={form.vendor_id}
              onChange={(e) => setForm({ ...form, vendor_id: e.target.value })}
            >
              <option value="">— none —</option>
              {activeVendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.code} — {v.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Vehicle" optional hint="e.g. for fuel / maintenance">
            <Select
              value={form.vehicle_id}
              onChange={(e) => setForm({ ...form, vehicle_id: e.target.value })}
            >
              <option value="">— none —</option>
              {activeVehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.reg_no}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Description" optional>
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What was it for?"
            />
          </Field>

          <div className="col-span-full flex justify-end gap-2">
            <Link to="/accounting/expenses">
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Posting…' : 'Post expense'}
            </Button>
          </div>
        </form>
        <p className="mt-3 text-xs text-slate-500">
          Posting books a JE: DR{' '}
          <code className="text-slate-700">expense category account</code> / CR{' '}
          <code className="text-slate-700">{form.pay_account_code}</code>.
        </p>
      </Card>
    </div>
  );
}
