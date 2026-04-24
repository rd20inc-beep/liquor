import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, Card, ErrorNote, Field, Input, Select } from '../components/ui';
import { api, ApiError } from '../lib/api';

export const Route = createFileRoute('/_app/inventory/receipt')({
  component: NewReceipt,
});

interface Warehouse {
  id: string;
  code: string;
  name: string;
  type: string;
}
interface Product {
  id: string;
  sku: string;
  name: string;
}

function NewReceipt() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    warehouse_id: '',
    product_id: '',
    qty: '',
    cost_price: '',
    batch_no: '',
    mfg_date: '',
    expiry_date: '',
    note: '',
  });
  const [error, setError] = useState<string | null>(null);

  const whQ = useQuery({
    queryKey: ['masters', 'warehouses'],
    queryFn: () => api.get<{ items: Warehouse[] }>('/warehouses'),
  });
  const productsQ = useQuery({
    queryKey: ['masters', 'products'],
    queryFn: () => api.get<{ items: Product[] }>('/products?limit=500'),
  });

  const submit = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/stock/receipts', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
      void navigate({ to: '/inventory' });
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : 'Could not record receipt'),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const body: Record<string, unknown> = {
      warehouse_id: form.warehouse_id,
      product_id: form.product_id,
      qty: Number(form.qty),
      cost_price: Number(form.cost_price) || 0,
    };
    if (form.batch_no.trim()) body.batch_no = form.batch_no.trim();
    if (form.mfg_date) body.mfg_date = form.mfg_date;
    if (form.expiry_date) body.expiry_date = form.expiry_date;
    if (form.note.trim()) body.note = form.note.trim();
    submit.mutate(body);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Goods receipt</h1>
        <Link to="/inventory" className="text-sm text-amber-400 hover:underline">
          ← Inventory
        </Link>
      </div>

      {error && <ErrorNote message={error} />}

      <Card>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Warehouse">
            <Select
              required
              value={form.warehouse_id}
              onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}
            >
              <option value="">— pick —</option>
              {whQ.data?.items.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                  {w.type === 'van' ? ' (van)' : ''}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Product">
            <Select
              required
              value={form.product_id}
              onChange={(e) => setForm({ ...form, product_id: e.target.value })}
            >
              <option value="">— pick —</option>
              {productsQ.data?.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} — {p.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Qty" hint="number of bottles received">
            <Input
              required
              type="number"
              min="1"
              placeholder="144"
              value={form.qty}
              onChange={(e) => setForm({ ...form, qty: e.target.value })}
            />
          </Field>

          <Field label="Cost price per unit" hint="PKR">
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="420"
              value={form.cost_price}
              onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
            />
          </Field>

          <Field label="Batch / lot number" optional>
            <Input
              placeholder="MC-2601"
              value={form.batch_no}
              onChange={(e) => setForm({ ...form, batch_no: e.target.value })}
            />
          </Field>

          <div />

          <Field label="Mfg date" optional>
            <Input
              type="date"
              value={form.mfg_date}
              onChange={(e) => setForm({ ...form, mfg_date: e.target.value })}
            />
          </Field>

          <Field label="Expiry date" optional>
            <Input
              type="date"
              value={form.expiry_date}
              onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
            />
          </Field>

          <Field label="Note" optional>
            <Input
              placeholder="e.g. PO-2601 from distillery"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </Field>

          <div className="col-span-full flex justify-end gap-2">
            <Link to="/inventory">
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending ? 'Recording…' : 'Record receipt'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
