import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { Badge, Card, Spinner } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/warehouses/')({
  component: WarehousesList,
});

interface Warehouse {
  id: string;
  code: string;
  name: string;
  type: 'warehouse' | 'van';
  vehicle_reg_no: string | null;
  custodian_name: string | null;
  is_damage_quarantine: boolean;
  active: boolean;
}

function WarehousesList() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get<{ items: Warehouse[] }>('/warehouses'),
  });

  const items = data?.items ?? [];
  const yards = items.filter((w) => w.type === 'warehouse');
  const vans = items.filter((w) => w.type === 'van');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Warehouses & vans</h1>
      </div>

      {isLoading ? (
        <Spinner label="Loading warehouses" />
      ) : items.length === 0 ? (
        <Card>
          <div className="text-sm text-slate-500">No warehouses yet.</div>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card title="Yards">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 text-left">Code</th>
                  <th className="text-left">Name</th>
                  <th className="text-left">Flags</th>
                  <th className="text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {yards.map((w) => (
                  <tr
                    key={w.id}
                    onClick={() =>
                      navigate({ to: '/warehouses/$id', params: { id: w.id } })
                    }
                    className="cursor-pointer border-t border-slate-200 hover:bg-slate-100/70"
                  >
                    <td className="py-1.5 font-mono text-xs text-slate-600">{w.code}</td>
                    <td className="text-slate-800">{w.name}</td>
                    <td>
                      {w.is_damage_quarantine && <Badge tone="red">DAMAGE</Badge>}
                    </td>
                    <td>
                      <Badge tone={w.active ? 'green' : 'slate'}>
                        {w.active ? 'active' : 'inactive'}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {yards.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-3 text-sm text-slate-500">
                      No yard warehouses.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>

          <Card title="Vans">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 text-left">Code</th>
                  <th className="text-left">Name</th>
                  <th className="text-left">Vehicle</th>
                  <th className="text-left">Custodian</th>
                  <th className="text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {vans.map((w) => (
                  <tr
                    key={w.id}
                    onClick={() =>
                      navigate({ to: '/warehouses/$id', params: { id: w.id } })
                    }
                    className="cursor-pointer border-t border-slate-200 hover:bg-slate-100/70"
                  >
                    <td className="py-1.5 font-mono text-xs text-slate-600">{w.code}</td>
                    <td className="text-slate-800">{w.name}</td>
                    <td className="font-mono text-xs text-slate-600">
                      {w.vehicle_reg_no ?? '—'}
                    </td>
                    <td className="text-slate-600">{w.custodian_name ?? '—'}</td>
                    <td>
                      <Badge tone={w.active ? 'green' : 'slate'}>
                        {w.active ? 'active' : 'inactive'}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {vans.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-3 text-sm text-slate-500">
                      No vans configured.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}
