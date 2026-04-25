import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge, Button, Card, Input, Money, Spinner } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/products/')({
  component: ProductsList,
});

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
  mrp: string | null;
  reorder_point: number | null;
  active: boolean;
}

function ProductsList() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['products', q],
    queryFn: () => {
      const p = new URLSearchParams({ limit: '200' });
      if (q) p.set('q', q);
      return api.get<{ items: Product[] }>(`/products?${p.toString()}`);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Products</h1>
        <Link to="/products/new">
          <Button>+ New product</Button>
        </Link>
      </div>

      <Card>
        <div className="mb-3 flex gap-3">
          <div className="min-w-64 flex-1">
            <Input
              placeholder="Search name or SKU…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        {isLoading ? (
          <Spinner label="Loading products" />
        ) : data?.items.length === 0 ? (
          <div className="text-sm text-slate-500">
            No products yet. Click "+ New product" to add the first one.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 text-left">SKU</th>
                  <th className="text-left">Name</th>
                  <th className="text-left">Brand</th>
                  <th className="text-left">Category</th>
                  <th className="text-right">Bottle / Case</th>
                  <th className="text-right">Tax %</th>
                  <th className="text-right">MRP</th>
                  <th className="text-right">Reorder</th>
                  <th className="text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => navigate({ to: '/products/$id', params: { id: p.id } })}
                    className="cursor-pointer border-t border-slate-200 hover:bg-slate-100/70"
                  >
                    <td className="py-1.5 font-mono text-xs text-slate-600">{p.sku}</td>
                    <td className="text-slate-800">{p.name}</td>
                    <td className="text-slate-600">{p.brand_name}</td>
                    <td className="text-slate-600">{p.category}</td>
                    <td className="text-right text-slate-600">
                      {p.bottle_size_ml}ml · {p.case_qty}/case
                    </td>
                    <td className="text-right text-slate-600">{Number(p.tax_rate).toFixed(1)}</td>
                    <td className="text-right">
                      <Money value={p.mrp} />
                    </td>
                    <td className="text-right text-slate-600">{p.reorder_point ?? '—'}</td>
                    <td>
                      <Badge tone={p.active ? 'green' : 'slate'}>
                        {p.active ? 'active' : 'inactive'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
