import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, Card, ErrorNote, Field, Input, Select } from '../components/ui';
import { api, ApiError } from '../lib/api';

export const Route = createFileRoute('/_app/inventory/transfer')({
  component: NewTransfer,
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

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

function NewTransfer() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    from_wh_id: '',
    to_wh_id: '',
    product_id: '',
    qty: '',
    reason: 'transfer' as 'transfer' | 'load_out' | 'load_in',
    note: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(newIdempotencyKey);

  const whQ = useQuery({
    queryKey: ['masters', 'warehouses'],
    queryFn: () => api.get<{ items: Warehouse[] }>('/warehouses'),
  });
  const productsQ = useQuery({
    queryKey: ['masters', 'products'],
    queryFn: () => api.get<{ items: Product[] }>('/products?limit=500'),
  });

  const submit = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post('/stock/transfers', body, {
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
      void navigate({ to: '/inventory' });
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : 'Could not record transfer'),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.from_wh_id === form.to_wh_id) {
      setError('Source and destination must differ');
      return;
    }
    submit.mutate({
      from_wh_id: form.from_wh_id,
      to_wh_id: form.to_wh_id,
      product_id: form.product_id,
      qty: Number(form.qty),
      reason: form.reason,
      note: form.note.trim() || undefined,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Stock transfer</h1>
        <Link to="/inventory" className="text-sm text-indigo-600 hover:underline">
          ← Inventory
        </Link>
      </div>

      {error && <ErrorNote message={error} />}

      <Card>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="From warehouse" hint="Source — stock is picked FEFO">
            <Select
              required
              value={form.from_wh_id}
              onChange={(e) => setForm({ ...form, from_wh_id: e.target.value })}
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

          <Field label="To warehouse" hint="Destination — new batches opened here">
            <Select
              required
              value={form.to_wh_id}
              onChange={(e) => setForm({ ...form, to_wh_id: e.target.value })}
            >
              <option value="">— pick —</option>
              {whQ.data?.items
                .filter((w) => w.id !== form.from_wh_id)
                .map((w) => (
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

          <Field label="Qty">
            <Input
              required
              type="number"
              min="1"
              value={form.qty}
              onChange={(e) => setForm({ ...form, qty: e.target.value })}
            />
          </Field>

          <Field label="Reason">
            <Select
              value={form.reason}
              onChange={(e) =>
                setForm({ ...form, reason: e.target.value as typeof form.reason })
              }
            >
              <option value="transfer">Transfer (warehouse → warehouse)</option>
              <option value="load_out">Load-out (warehouse → van)</option>
              <option value="load_in">Load-in (van → warehouse)</option>
            </Select>
          </Field>

          <Field label="Note" optional>
            <Input
              placeholder="e.g. end-of-day van return"
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
              {submit.isPending ? 'Transferring…' : 'Record transfer'}
            </Button>
          </div>
        </form>
        <p className="mt-3 text-xs text-slate-500">
          Transfer is atomic — source batches are picked FEFO and decremented; destination
          batches are opened preserving lot identity and expiry. Idempotent on key{' '}
          <code className="text-slate-700">{idempotencyKey.slice(0, 8)}…</code>.
        </p>
      </Card>
    </div>
  );
}
