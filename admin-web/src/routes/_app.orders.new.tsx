import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { Badge, Button, Card, ErrorNote, Field, Input, Money, Select, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatCreditReason } from '../lib/formatters';

const searchSchema = z.object({
  customer_id: z.string().uuid().optional(),
});

export const Route = createFileRoute('/_app/orders/new')({
  component: NewOrder,
  validateSearch: searchSchema,
});

interface Customer {
  id: string;
  code: string;
  name: string;
  available_credit: string | null;
  status: string;
}
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
  case_qty: number;
}

interface Line {
  id: string; // local form id
  product_id: string;
  qty: string;
  discount_pct: string;
}

interface OrderResult {
  order: {
    id: string;
    order_no: string;
    status: string;
    total: string;
  };
  credit: {
    decision: 'approve' | 'hold' | 'reject';
    reasons: string[];
    available_credit: number;
  };
}

function newLineId() {
  return Math.random().toString(36).slice(2, 10);
}

function NewOrder() {
  const qc = useQueryClient();
  const search = useSearch({ from: '/_app/orders/new' });

  const [customerId, setCustomerId] = useState(search.customer_id ?? '');
  const [warehouseId, setWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([
    { id: newLineId(), product_id: '', qty: '1', discount_pct: '0' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OrderResult | null>(null);

  const customersQ = useQuery({
    queryKey: ['customers', 'all'],
    queryFn: () => api.get<{ items: Customer[] }>('/customers?limit=500'),
  });
  const warehousesQ = useQuery({
    queryKey: ['masters', 'warehouses'],
    queryFn: () => api.get<{ items: Warehouse[] }>('/warehouses'),
  });
  const productsQ = useQuery({
    queryKey: ['masters', 'products'],
    queryFn: () => api.get<{ items: Product[] }>('/products?limit=500'),
  });

  const selectedCustomer = customersQ.data?.items.find((c) => c.id === customerId);

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<OrderResult>('/orders', body),
    onSuccess: (r) => {
      setResult(r);
      setError(null);
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['customer360'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not submit order'),
  });

  const addLine = () =>
    setLines((ls) => [...ls, { id: newLineId(), product_id: '', qty: '1', discount_pct: '0' }]);
  const removeLine = (id: string) =>
    setLines((ls) => (ls.length === 1 ? ls : ls.filter((l) => l.id !== id)));
  const updateLine = (id: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!customerId) return setError('Pick a customer');
    if (!warehouseId) return setError('Pick a warehouse');
    const cleanLines = lines
      .filter((l) => l.product_id && Number(l.qty) > 0)
      .map((l) => ({
        product_id: l.product_id,
        qty: Number(l.qty),
        discount_pct: Number(l.discount_pct) || 0,
      }));
    if (cleanLines.length === 0) return setError('At least one line is required');

    create.mutate({
      customer_id: customerId,
      warehouse_id: warehouseId,
      lines: cleanLines,
      notes: notes.trim() || undefined,
    });
  };

  // Display-mode after successful submit
  if (result) {
    const tone =
      result.credit.decision === 'approve'
        ? 'green'
        : result.credit.decision === 'hold'
          ? 'amber'
          : 'red';
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-slate-900">Order submitted</h1>
          <Link to="/orders" className="text-sm text-amber-400 hover:underline">
            ← Orders
          </Link>
        </div>
        <Card>
          <div className="space-y-4">
            <div className="flex items-baseline justify-between">
              <div>
                <div className="font-mono text-sm text-slate-600">
                  {result.order.order_no}
                </div>
                <div className="text-xl font-semibold text-slate-900">
                  <Money value={result.order.total} />
                </div>
              </div>
              <Badge tone={tone}>
                Credit {result.credit.decision} · status {result.order.status}
              </Badge>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-100/60 p-3 text-sm">
              <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">
                Credit engine
              </div>
              <ul className="space-y-1 text-sm text-slate-800">
                {result.credit.reasons.map((r) => (
                  <li key={r} className="flex items-start gap-2">
                    <span className="mt-0.5 text-amber-400">•</span>
                    <span>{formatCreditReason(r)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 text-xs text-slate-500">
                Available credit: <Money value={result.credit.available_credit} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setResult(null);
                  setLines([{ id: newLineId(), product_id: '', qty: '1', discount_pct: '0' }]);
                  setNotes('');
                }}
              >
                Place another
              </Button>
              <Link to="/orders">
                <Button>Go to orders</Button>
              </Link>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">New order</h1>
        <Link to="/orders" className="text-sm text-amber-400 hover:underline">
          ← Orders
        </Link>
      </div>

      {error && <ErrorNote message={error} />}

      <Card>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                    {c.status !== 'active' ? ` · ${c.status}` : ''}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Ship from warehouse"
              hint={selectedCustomer ? `Available credit: Rs ${Number(selectedCustomer.available_credit ?? 0).toLocaleString('en-US')}` : undefined}
            >
              <Select
                required
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
              >
                <option value="">— pick —</option>
                {warehousesQ.data?.items
                  .filter((w) => w.type === 'warehouse')
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-medium uppercase tracking-wide text-slate-600">
                Lines
              </h3>
              <Button type="button" variant="secondary" onClick={addLine}>
                + Add line
              </Button>
            </div>

            {productsQ.isLoading ? (
              <Spinner label="Loading products" />
            ) : (
              <div className="space-y-2">
                {lines.map((line, i) => (
                  <div
                    key={line.id}
                    className="grid grid-cols-[1fr_100px_100px_auto] gap-2"
                  >
                    <Select
                      required
                      value={line.product_id}
                      onChange={(e) => updateLine(line.id, { product_id: e.target.value })}
                    >
                      <option value="">Product #{i + 1}</option>
                      {productsQ.data?.items.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.sku})
                        </option>
                      ))}
                    </Select>
                    <Input
                      required
                      type="number"
                      min="1"
                      placeholder="qty"
                      value={line.qty}
                      onChange={(e) => updateLine(line.id, { qty: e.target.value })}
                    />
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      placeholder="disc %"
                      value={line.discount_pct}
                      onChange={(e) =>
                        updateLine(line.id, { discount_pct: e.target.value })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => removeLine(line.id)}
                      disabled={lines.length === 1}
                    >
                      ✕
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-2 text-xs text-slate-500">
              Unit prices are resolved server-side against the customer's price list.
            </p>
          </div>

          <Field label="Notes" optional>
            <Input
              placeholder="e.g. deliver before EOD Friday"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>

          <div className="flex justify-end gap-2">
            <Link to="/orders">
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Submitting…' : 'Submit order'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

