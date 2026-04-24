import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Button, Card, ErrorNote, Field, Input, Select } from '../components/ui';
import { api, ApiError, tokens } from '../lib/api';

export const Route = createFileRoute('/_app/inventory/adjust')({
  component: NewAdjustment,
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
interface Batch {
  id: string;
  lot_code: string | null;
  expiry_date: string | null;
  qty_physical: string;
  qty_sellable: string;
}

const REASONS = [
  { value: 'count_correction', label: 'Cycle count correction' },
  { value: 'damage', label: 'Damage / breakage' },
  { value: 'theft', label: 'Theft / shrinkage' },
  { value: 'sample', label: 'Sample / promotion' },
  { value: 'expiry_writeoff', label: 'Expiry write-off' },
  { value: 'other', label: 'Other (specify in note)' },
];

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

function NewAdjustment() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = tokens.user();
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';

  const [form, setForm] = useState({
    warehouse_id: '',
    product_id: '',
    batch_id: '',
    delta_qty: '',
    reason: 'count_correction',
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
  const batchesQ = useQuery({
    queryKey: ['inventory', 'batches', form.warehouse_id, form.product_id],
    queryFn: () =>
      api.get<{ items: Batch[] }>(
        `/stock/batches?warehouse_id=${form.warehouse_id}&product_id=${form.product_id}`,
      ),
    enabled: Boolean(form.warehouse_id && form.product_id),
  });

  const batches = batchesQ.data?.items ?? [];

  const selectedBatch = useMemo(
    () => batches.find((b) => b.id === form.batch_id) ?? null,
    [batches, form.batch_id],
  );

  const submit = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ approval?: { id: string }; movement_id?: string }>(
        '/stock/adjustments',
        body,
        { headers: { 'Idempotency-Key': idempotencyKey } },
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['approvals'] });
      if (!isAdmin && res.approval) {
        void navigate({ to: '/approvals' });
      } else {
        void navigate({ to: '/inventory' });
      }
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : 'Could not record adjustment'),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const delta = Number(form.delta_qty);
    if (!Number.isFinite(delta) || delta === 0) {
      setError('Delta qty must be a non-zero whole number');
      return;
    }
    if (!Number.isInteger(delta)) {
      setError('Delta qty must be a whole number');
      return;
    }
    if (delta < 0 && !form.batch_id) {
      setError('Negative adjustments require a specific batch');
      return;
    }
    submit.mutate({
      warehouse_id: form.warehouse_id,
      product_id: form.product_id,
      batch_id: form.batch_id || undefined,
      delta_qty: delta,
      reason: form.reason,
      note: form.note.trim() || undefined,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Stock adjustment</h1>
        <Link to="/inventory" className="text-sm text-indigo-600 hover:underline">
          ← Inventory
        </Link>
      </div>

      {!isAdmin && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Your role cannot apply adjustments directly — this will be queued for admin approval.
        </div>
      )}

      {error && <ErrorNote message={error} />}

      <Card>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Warehouse">
            <Select
              required
              value={form.warehouse_id}
              onChange={(e) =>
                setForm({ ...form, warehouse_id: e.target.value, batch_id: '' })
              }
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
              onChange={(e) =>
                setForm({ ...form, product_id: e.target.value, batch_id: '' })
              }
            >
              <option value="">— pick —</option>
              {productsQ.data?.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} — {p.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Batch"
            optional
            hint={
              form.warehouse_id && form.product_id
                ? batchesQ.isLoading
                  ? 'Loading batches…'
                  : batches.length === 0
                    ? 'No batches at this location'
                    : 'Required for negative adjustments'
                : 'Pick warehouse and product first'
            }
          >
            <Select
              value={form.batch_id}
              disabled={!form.warehouse_id || !form.product_id || batches.length === 0}
              onChange={(e) => setForm({ ...form, batch_id: e.target.value })}
            >
              <option value="">— any / new batch —</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.lot_code ?? b.id.slice(0, 8)}
                  {b.expiry_date ? ` · exp ${b.expiry_date.slice(0, 10)}` : ''}
                  {' · '}
                  {b.qty_sellable} sellable
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Delta qty"
            hint="Positive to add, negative to remove (e.g. −3 for damage)"
          >
            <Input
              required
              type="number"
              step="1"
              value={form.delta_qty}
              onChange={(e) => setForm({ ...form, delta_qty: e.target.value })}
              placeholder="e.g. -2 or 5"
            />
          </Field>

          <Field label="Reason">
            <Select
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            >
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Note" optional>
            <Input
              placeholder="e.g. 2 bottles cracked during van load"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </Field>

          {selectedBatch && form.delta_qty && (
            <div className="col-span-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <span className="font-semibold">Preview:</span>{' '}
              {selectedBatch.qty_sellable} sellable →{' '}
              <span
                className={
                  Number(form.delta_qty) < 0 ? 'text-red-700' : 'text-emerald-700'
                }
              >
                {Number(selectedBatch.qty_sellable) + Number(form.delta_qty || 0)}
              </span>{' '}
              on batch{' '}
              <code className="text-slate-800">
                {selectedBatch.lot_code ?? selectedBatch.id.slice(0, 8)}
              </code>
            </div>
          )}

          <div className="col-span-full flex justify-end gap-2">
            <Link to="/inventory">
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending
                ? 'Submitting…'
                : isAdmin
                  ? 'Apply adjustment'
                  : 'Queue for approval'}
            </Button>
          </div>
        </form>
        <p className="mt-3 text-xs text-slate-500">
          Adjustments are recorded in the append-only ledger with reason + note for audit.
          Idempotent on key <code className="text-slate-700">{idempotencyKey.slice(0, 8)}…</code>.
        </p>
      </Card>
    </div>
  );
}
