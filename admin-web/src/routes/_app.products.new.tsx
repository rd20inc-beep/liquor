import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, Card, ErrorNote, Field, Input, Select } from '../components/ui';
import { api, ApiError } from '../lib/api';

export const Route = createFileRoute('/_app/products/new')({
  component: NewProduct,
});

interface Brand {
  id: string;
  name: string;
}

function NewProduct() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    sku: '',
    name: '',
    brand_id: '',
    newBrand: '',
    category: 'spirits',
    bottle_size_ml: '750',
    case_qty: '6',
    tax_rate: '17',
    mrp: '',
    reorder_point: '',
    safety_stock: '',
    lead_time_days: '7',
  });
  const [error, setError] = useState<string | null>(null);

  const brandsQ = useQuery({
    queryKey: ['masters', 'brands'],
    queryFn: () => api.get<{ items: Brand[] }>('/brands'),
  });

  const createBrand = useMutation({
    mutationFn: (name: string) => api.post<Brand>('/brands', { name }),
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ['masters', 'brands'] });
      setForm((f) => ({ ...f, brand_id: b.id, newBrand: '' }));
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not create brand'),
  });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ id: string }>('/products', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      void navigate({ to: '/products' });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not create product'),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.brand_id) {
      setError('Pick a brand or create a new one');
      return;
    }
    const body: Record<string, unknown> = {
      sku: form.sku.trim(),
      name: form.name.trim(),
      brand_id: form.brand_id,
      category: form.category.trim(),
      bottle_size_ml: Number(form.bottle_size_ml),
      case_qty: Number(form.case_qty),
      tax_rate: Number(form.tax_rate),
    };
    if (form.mrp) body.mrp = Number(form.mrp);
    if (form.reorder_point) body.reorder_point = Number(form.reorder_point);
    if (form.safety_stock) body.safety_stock = Number(form.safety_stock);
    if (form.lead_time_days) body.lead_time_days = Number(form.lead_time_days);
    create.mutate(body);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-100">New product</h1>
        <Link to="/products" className="text-sm text-blue-400 hover:underline">
          ← All products
        </Link>
      </div>

      {error && <ErrorNote message={error} />}

      <Card>
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="SKU">
            <Input
              required
              autoFocus
              maxLength={100}
              placeholder="MUR-CLAS-650"
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
            />
          </Field>

          <Field label="Name">
            <Input
              required
              placeholder="Murree Classic Lager 650ml"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>

          <Field label="Brand">
            <Select
              value={form.brand_id}
              onChange={(e) => setForm({ ...form, brand_id: e.target.value })}
            >
              <option value="">— pick —</option>
              {brandsQ.data?.items.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="…or new brand" optional hint="Creates a brand if name is filled">
            <div className="flex gap-2">
              <Input
                placeholder="Brand name"
                value={form.newBrand}
                onChange={(e) => setForm({ ...form, newBrand: e.target.value })}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={!form.newBrand.trim() || createBrand.isPending}
                onClick={() => createBrand.mutate(form.newBrand.trim())}
              >
                {createBrand.isPending ? '…' : 'Add'}
              </Button>
            </div>
          </Field>

          <Field label="Category">
            <Input
              required
              placeholder="spirits"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
          </Field>

          <Field label="Bottle size (ml)">
            <Input
              required
              type="number"
              min="1"
              value={form.bottle_size_ml}
              onChange={(e) => setForm({ ...form, bottle_size_ml: e.target.value })}
            />
          </Field>

          <Field label="Case qty">
            <Input
              required
              type="number"
              min="1"
              value={form.case_qty}
              onChange={(e) => setForm({ ...form, case_qty: e.target.value })}
            />
          </Field>

          <Field label="Tax %">
            <Input
              required
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={form.tax_rate}
              onChange={(e) => setForm({ ...form, tax_rate: e.target.value })}
            />
          </Field>

          <Field label="MRP" hint="PKR — printed on label" optional>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.mrp}
              onChange={(e) => setForm({ ...form, mrp: e.target.value })}
            />
          </Field>

          <Field label="Reorder point" optional>
            <Input
              type="number"
              min="0"
              value={form.reorder_point}
              onChange={(e) => setForm({ ...form, reorder_point: e.target.value })}
            />
          </Field>

          <Field label="Safety stock" optional>
            <Input
              type="number"
              min="0"
              value={form.safety_stock}
              onChange={(e) => setForm({ ...form, safety_stock: e.target.value })}
            />
          </Field>

          <Field label="Lead time (days)" optional>
            <Input
              type="number"
              min="0"
              value={form.lead_time_days}
              onChange={(e) => setForm({ ...form, lead_time_days: e.target.value })}
            />
          </Field>

          <div className="col-span-full flex justify-end gap-2">
            <Link to="/products">
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create product'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
