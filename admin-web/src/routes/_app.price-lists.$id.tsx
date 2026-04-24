import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, Money, Select, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';

export const Route = createFileRoute('/_app/price-lists/$id')({
  component: PriceListDetail,
});

interface PriceList {
  id: string;
  name: string;
  effective_from: string;
  effective_to: string | null;
  is_default: boolean;
  items: Array<{
    product_id: string;
    sku: string;
    product_name: string;
    bottle_size_ml: number;
    case_qty: number;
    unit_price: string;
    case_price: string | null;
    min_qty: number;
  }>;
}

interface Product {
  id: string;
  sku: string;
  name: string;
  case_qty: number;
}

function PriceListDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [productId, setProductId] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [casePrice, setCasePrice] = useState('');
  const [minQty, setMinQty] = useState('1');

  const listQ = useQuery({
    queryKey: ['price-list', id],
    queryFn: () => api.get<PriceList>(`/price-lists/${id}`),
  });
  const productsQ = useQuery({
    queryKey: ['masters', 'products'],
    queryFn: () => api.get<{ items: Product[] }>('/products?limit=500'),
  });

  const addItem = useMutation({
    mutationFn: (items: unknown[]) =>
      api.post(`/price-lists/${id}/items`, { items }),
    onSuccess: () => {
      setError(null);
      setFlash('Item saved');
      setProductId('');
      setUnitPrice('');
      setCasePrice('');
      setMinQty('1');
      qc.invalidateQueries({ queryKey: ['price-list', id] });
      qc.invalidateQueries({ queryKey: ['price-lists'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save item'),
  });

  const deleteItem = useMutation({
    mutationFn: (productId: string) =>
      api.del(`/price-lists/${id}/items/${productId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['price-list', id] });
      qc.invalidateQueries({ queryKey: ['price-lists'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not delete item'),
  });

  if (listQ.isLoading) return <Spinner label="Loading price list" />;
  if (listQ.isError || !listQ.data)
    return <div className="text-sm text-red-600">Price list not found.</div>;

  const pl = listQ.data;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Price list</div>
          <h1 className="text-xl font-semibold text-slate-900">
            {pl.name} {pl.is_default && <Badge tone="blue">default</Badge>}
          </h1>
          <div className="mt-1 text-sm text-slate-600">
            Effective {pl.effective_from?.slice(0, 10)} →{' '}
            {pl.effective_to?.slice(0, 10) ?? 'open'}
          </div>
        </div>
        <Link to="/price-lists" className="text-sm text-indigo-600 hover:underline">
          ← All price lists
        </Link>
      </div>

      {error && <ErrorNote message={error} />}
      {flash && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {flash}
        </div>
      )}

      <Card title="Add / update item">
        <form
          className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_140px_140px_100px_120px]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!productId) {
              setError('Pick a product');
              return;
            }
            addItem.mutate([
              {
                product_id: productId,
                unit_price: Number(unitPrice),
                case_price: casePrice ? Number(casePrice) : null,
                min_qty: Number(minQty) || 1,
              },
            ]);
          }}
        >
          <Field label="Product">
            <Select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">— pick —</option>
              {productsQ.data?.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sku})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Unit price" hint="PKR">
            <Input
              required
              type="number"
              min="0.01"
              step="0.01"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
            />
          </Field>
          <Field label="Case price" hint="PKR · optional" optional>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={casePrice}
              onChange={(e) => setCasePrice(e.target.value)}
            />
          </Field>
          <Field label="Min qty">
            <Input
              type="number"
              min="1"
              value={minQty}
              onChange={(e) => setMinQty(e.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={addItem.isPending} className="w-full">
              {addItem.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
        <p className="mt-2 text-xs text-slate-500">
          Upsert — if the product is already on this list, its price will be updated.
        </p>
      </Card>

      <Card title={`Items (${pl.items.length})`}>
        {pl.items.length === 0 ? (
          <div className="text-sm text-slate-500">
            No items yet. Add at least one above — this list has no effect until it contains
            the products you want to re-price.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-1 text-left">SKU</th>
                <th className="text-left">Product</th>
                <th className="text-right">Bottle / case</th>
                <th className="text-right">Unit price</th>
                <th className="text-right">Case price</th>
                <th className="text-right">Min qty</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pl.items.map((it) => (
                <tr key={it.product_id} className="border-t border-slate-200">
                  <td className="py-1.5 font-mono text-xs text-slate-600">{it.sku}</td>
                  <td className="text-slate-800">{it.product_name}</td>
                  <td className="text-right text-xs text-slate-600">
                    {it.bottle_size_ml}ml · {it.case_qty}
                  </td>
                  <td className="text-right">
                    <Money value={it.unit_price} />
                  </td>
                  <td className="text-right">
                    <Money value={it.case_price} />
                  </td>
                  <td className="text-right text-slate-600">{it.min_qty}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => deleteItem.mutate(it.product_id)}
                      className="text-xs text-red-600 hover:text-red-700"
                      disabled={deleteItem.isPending}
                    >
                      remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
