import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Badge, Button, Card, Input, Spinner, Tile } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/inventory/')({
  component: InventoryDashboard,
});

interface StockRow {
  warehouse_id: string;
  warehouse_code: string;
  warehouse_name: string;
  warehouse_type: 'warehouse' | 'van';
  product_id: string;
  sku: string;
  product_name: string;
  case_qty: number;
  reorder_point: number | null;
  safety_stock: number | null;
  physical: string;
  sellable: string;
  free: string;
  nearest_expiry: string | null;
}

interface Warehouse {
  id: string;
  code: string;
  name: string;
  type: string;
  active: boolean;
}

function asDateOnly(s: string | null): string | null {
  return s ? s.slice(0, 10) : null;
}
function daysUntil(date: string | null): number | null {
  const iso = asDateOnly(date);
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`).getTime();
  if (Number.isNaN(d)) return null;
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`).getTime();
  return Math.floor((d - today) / 86400000);
}

function InventoryDashboard() {
  const [whFilter, setWhFilter] = useState('');
  const [search, setSearch] = useState('');

  const stockQ = useQuery({
    queryKey: ['inventory', 'stock'],
    queryFn: () => api.get<{ items: StockRow[] }>('/stock'),
  });
  const whQ = useQuery({
    queryKey: ['inventory', 'warehouses'],
    queryFn: () => api.get<{ items: Warehouse[] }>('/warehouses'),
  });

  const rows = stockQ.data?.items ?? [];
  const warehouses = whQ.data?.items ?? [];

  // Derived filters
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (whFilter && r.warehouse_id !== whFilter) return false;
      if (q && !r.sku.toLowerCase().includes(q) && !r.product_name.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [rows, whFilter, search]);

  // Aggregates
  const uniqueSkus = useMemo(() => new Set(rows.map((r) => r.product_id)).size, [rows]);
  const lowStock = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.reorder_point != null && Number(r.sellable) < r.reorder_point,
      ),
    [rows],
  );
  const nearExpiry = useMemo(
    () =>
      rows
        .filter((r) => {
          const d = daysUntil(r.nearest_expiry);
          return d != null && d <= 30;
        })
        .sort((a, b) => (daysUntil(a.nearest_expiry) ?? 0) - (daysUntil(b.nearest_expiry) ?? 0)),
    [rows],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Inventory</h1>
        <Link to="/inventory/receipt">
          <Button>+ New receipt</Button>
        </Link>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tile
          label="SKUs stocked"
          value={stockQ.isLoading ? <Spinner /> : uniqueSkus}
          sub={`${rows.length} rows across warehouses`}
          tone="blue"
        />
        <Tile
          label="Below reorder"
          value={stockQ.isLoading ? <Spinner /> : lowStock.length}
          sub={lowStock.length > 0 ? 'restock required' : 'all clear'}
          tone={lowStock.length > 0 ? 'amber' : 'green'}
        />
        <Tile
          label="Near expiry (30d)"
          value={stockQ.isLoading ? <Spinner /> : nearExpiry.length}
          sub={nearExpiry.length > 0 ? 'review queue' : 'no batches expiring'}
          tone={nearExpiry.length > 0 ? 'red' : 'green'}
        />
        <Tile
          label="Warehouses"
          value={whQ.isLoading ? <Spinner /> : warehouses.filter((w) => w.active).length}
          sub={`${warehouses.filter((w) => w.type === 'van').length} vans`}
        />
      </div>

      {/* Alerts row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title={
            <span className="flex items-center gap-2">
              Low stock
              <Badge tone={lowStock.length > 0 ? 'amber' : 'slate'}>{lowStock.length}</Badge>
            </span>
          }
        >
          {stockQ.isLoading ? (
            <Spinner />
          ) : lowStock.length === 0 ? (
            <div className="text-sm text-slate-500">Nothing below reorder point.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-1 text-left">Warehouse</th>
                  <th className="text-left">SKU</th>
                  <th className="text-right">Sellable</th>
                  <th className="text-right">Reorder at</th>
                </tr>
              </thead>
              <tbody>
                {lowStock.slice(0, 8).map((r) => (
                  <tr
                    key={`${r.warehouse_id}-${r.product_id}`}
                    className="border-t border-slate-200"
                  >
                    <td className="py-1.5 text-xs text-slate-600">{r.warehouse_code}</td>
                    <td>
                      <span className="text-slate-800">{r.product_name}</span>
                      <span className="ml-1 text-xs text-slate-500">{r.sku}</span>
                    </td>
                    <td className="text-right">
                      <span className="text-amber-700">{r.sellable}</span>
                    </td>
                    <td className="text-right text-slate-600">{r.reorder_point}</td>
                  </tr>
                ))}
                {lowStock.length > 8 && (
                  <tr>
                    <td colSpan={4} className="py-2 text-xs text-slate-500">
                      + {lowStock.length - 8} more
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </Card>

        <Card
          title={
            <span className="flex items-center gap-2">
              Near expiry (≤30d)
              <Badge tone={nearExpiry.length > 0 ? 'red' : 'slate'}>{nearExpiry.length}</Badge>
            </span>
          }
        >
          {stockQ.isLoading ? (
            <Spinner />
          ) : nearExpiry.length === 0 ? (
            <div className="text-sm text-slate-500">No batches expiring soon.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-1 text-left">Warehouse</th>
                  <th className="text-left">SKU</th>
                  <th className="text-right">Sellable</th>
                  <th className="text-right">Expires</th>
                </tr>
              </thead>
              <tbody>
                {nearExpiry.slice(0, 8).map((r) => {
                  const d = daysUntil(r.nearest_expiry)!;
                  const tone = d < 0 ? 'text-red-700' : d <= 7 ? 'text-red-600' : 'text-amber-700';
                  return (
                    <tr
                      key={`${r.warehouse_id}-${r.product_id}`}
                      className="border-t border-slate-200"
                    >
                      <td className="py-1.5 text-xs text-slate-600">{r.warehouse_code}</td>
                      <td>
                        <span className="text-slate-800">{r.product_name}</span>
                        <span className="ml-1 text-xs text-slate-500">{r.sku}</span>
                      </td>
                      <td className="text-right text-slate-700">{r.sellable}</td>
                      <td className={`text-right ${tone}`}>
                        {d < 0 ? `${-d}d past` : `${d}d`}
                        <span className="ml-1 text-xs text-slate-500">
                          ({asDateOnly(r.nearest_expiry)})
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* Full grid */}
      <Card
        title="Stock by warehouse × product"
        actions={
          <div className="flex items-center gap-2">
            <select
              value={whFilter}
              onChange={(e) => setWhFilter(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
            >
              <option value="">All warehouses</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                  {w.type === 'van' ? ' (van)' : ''}
                </option>
              ))}
            </select>
            <div className="w-56">
              <Input
                placeholder="Search SKU or name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        }
      >
        {stockQ.isLoading ? (
          <Spinner label="Loading stock" />
        ) : filtered.length === 0 ? (
          <div className="text-sm text-slate-500">
            {rows.length === 0 ? 'No stock yet — record a goods receipt to populate.' : 'No rows match your filter.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 text-left">Warehouse</th>
                  <th className="text-left">Product</th>
                  <th className="text-left">SKU</th>
                  <th className="text-right">Physical</th>
                  <th className="text-right">Sellable</th>
                  <th className="text-right">Free</th>
                  <th className="text-right">Reserved</th>
                  <th className="text-right">Reorder</th>
                  <th className="text-left">Nearest expiry</th>
                  <th className="text-left">Flags</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const physical = Number(r.physical);
                  const sellable = Number(r.sellable);
                  const free = Number(r.free);
                  const reserved = sellable - free;
                  const low = r.reorder_point != null && sellable < r.reorder_point;
                  const expDays = daysUntil(r.nearest_expiry);
                  const near = expDays != null && expDays <= 30;
                  return (
                    <tr
                      key={`${r.warehouse_id}-${r.product_id}`}
                      className="border-t border-slate-200 hover:bg-slate-100/70"
                    >
                      <td className="py-1.5">
                        <div className="text-slate-700">{r.warehouse_code}</div>
                        {r.warehouse_type === 'van' && (
                          <div className="text-xs text-slate-500">van</div>
                        )}
                      </td>
                      <td className="text-slate-800">{r.product_name}</td>
                      <td className="font-mono text-xs text-slate-600">{r.sku}</td>
                      <td className="text-right">{physical}</td>
                      <td className="text-right">{sellable}</td>
                      <td className={`text-right ${low ? 'text-amber-700' : ''}`}>{free}</td>
                      <td className="text-right text-slate-500">
                        {reserved > 0 ? reserved : '—'}
                      </td>
                      <td className="text-right text-slate-500">
                        {r.reorder_point ?? '—'}
                      </td>
                      <td className="text-xs text-slate-600">
                        {asDateOnly(r.nearest_expiry) ?? '—'}
                        {expDays != null && expDays <= 60 && (
                          <span className={`ml-1 ${expDays < 0 ? 'text-red-700' : expDays <= 7 ? 'text-red-600' : 'text-amber-700'}`}>
                            ({expDays < 0 ? `${-expDays}d past` : `${expDays}d`})
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {low && <Badge tone="amber">LOW</Badge>}
                          {near && (
                            <Badge tone={expDays! < 0 ? 'red' : expDays! <= 7 ? 'red' : 'amber'}>
                              {expDays! < 0 ? 'EXPIRED' : `EXPIRES ${expDays}d`}
                            </Badge>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
