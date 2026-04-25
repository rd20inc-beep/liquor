import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, Select, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';

export const Route = createFileRoute('/_app/products/$id')({
  component: ProductEdit,
});

interface Brand {
  id: string;
  name: string;
}

interface Product {
  id: string;
  sku: string;
  name: string;
  brand_id: string;
  brand_name: string;
  category: string;
  bottle_size_ml: number;
  case_qty: number;
  tax_rate: string;
  hsn: string | null;
  mrp: string | null;
  reorder_point: number | null;
  safety_stock: number | null;
  lead_time_days: number | null;
  active: boolean;
}

function nullableNumber(s: string): number | null {
  return s.trim() === '' ? null : Number(s);
}

function ProductEdit() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const productQ = useQuery({
    queryKey: ['products', id],
    queryFn: () => api.get<Product>(`/products/${id}`),
  });
  const brandsQ = useQuery({
    queryKey: ['masters', 'brands'],
    queryFn: () => api.get<{ items: Brand[] }>('/brands'),
  });

  const [form, setForm] = useState<{
    name: string;
    brand_id: string;
    category: string;
    bottle_size_ml: string;
    case_qty: string;
    tax_rate: string;
    hsn: string;
    mrp: string;
    reorder_point: string;
    safety_stock: string;
    lead_time_days: string;
    active: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (productQ.data && !form) {
      const p = productQ.data;
      setForm({
        name: p.name,
        brand_id: p.brand_id,
        category: p.category,
        bottle_size_ml: String(p.bottle_size_ml),
        case_qty: String(p.case_qty),
        tax_rate: p.tax_rate,
        hsn: p.hsn ?? '',
        mrp: p.mrp ?? '',
        reorder_point: p.reorder_point?.toString() ?? '',
        safety_stock: p.safety_stock?.toString() ?? '',
        lead_time_days: p.lead_time_days?.toString() ?? '',
        active: p.active,
      });
    }
  }, [productQ.data, form]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch<Product>(`/products/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      void navigate({ to: '/products' });
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : 'Could not save product'),
  });

  if (productQ.isError) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-slate-900">Product</h1>
        <ErrorNote message="Could not load product" />
      </div>
    );
  }
  if (!productQ.data || !form) {
    return <Spinner label="Loading product" />;
  }
  const product = productQ.data;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    save.mutate({
      name: form.name.trim(),
      brand_id: form.brand_id,
      category: form.category.trim(),
      bottle_size_ml: Number(form.bottle_size_ml),
      case_qty: Number(form.case_qty),
      tax_rate: Number(form.tax_rate),
      hsn: form.hsn.trim() || null,
      mrp: nullableNumber(form.mrp),
      reorder_point: nullableNumber(form.reorder_point),
      safety_stock: nullableNumber(form.safety_stock),
      lead_time_days: nullableNumber(form.lead_time_days),
      active: form.active,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Product</div>
          <h1 className="text-xl font-semibold text-slate-900">
            {product.name}{' '}
            <span className="ml-1 font-mono text-sm text-slate-500">
              ({product.sku})
            </span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={form.active ? 'green' : 'slate'}>
            {form.active ? 'active' : 'inactive'}
          </Badge>
          <Link to="/products" className="text-sm text-indigo-600 hover:underline">
            ← All products
          </Link>
        </div>
      </div>

      {error && <ErrorNote message={error} />}

      <Card>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="SKU" hint="Immutable after creation">
            <Input value={product.sku} disabled readOnly />
          </Field>

          <Field label="Name">
            <Input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>

          <Field label="Brand">
            <Select
              required
              value={form.brand_id}
              onChange={(e) => setForm({ ...form, brand_id: e.target.value })}
            >
              {brandsQ.data?.items.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Category">
            <Input
              required
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

          <Field label="HSN" optional>
            <Input
              value={form.hsn}
              onChange={(e) => setForm({ ...form, hsn: e.target.value })}
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

          <Field label="Active">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              Listed for sales and transfers
            </label>
          </Field>

          <div className="col-span-full flex justify-end gap-2">
            <Link to="/products">
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
