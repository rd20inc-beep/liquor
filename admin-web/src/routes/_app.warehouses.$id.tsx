import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, Select, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';

export const Route = createFileRoute('/_app/warehouses/$id')({
  component: WarehouseEdit,
});

interface Vehicle {
  id: string;
  reg_no: string;
  active: boolean;
}
interface User {
  id: string;
  name: string;
  role: string;
  active: boolean;
}
interface Warehouse {
  id: string;
  code: string;
  name: string;
  type: 'warehouse' | 'van';
  vehicle_id: string | null;
  custodian_user_id: string | null;
  vehicle_reg_no: string | null;
  custodian_name: string | null;
  is_damage_quarantine: boolean;
  active: boolean;
}

function WarehouseEdit() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const whQ = useQuery({
    queryKey: ['warehouses', id],
    queryFn: () => api.get<Warehouse>(`/warehouses/${id}`),
  });
  const vehiclesQ = useQuery({
    queryKey: ['masters', 'vehicles'],
    queryFn: () => api.get<{ items: Vehicle[] }>('/vehicles'),
  });
  const usersQ = useQuery({
    queryKey: ['masters', 'users'],
    queryFn: () => api.get<{ items: User[] }>('/users'),
  });

  const [form, setForm] = useState<{
    name: string;
    vehicle_id: string;
    custodian_user_id: string;
    is_damage_quarantine: boolean;
    active: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (whQ.data && !form) {
      setForm({
        name: wh.name,
        vehicle_id: wh.vehicle_id ?? '',
        custodian_user_id: wh.custodian_user_id ?? '',
        is_damage_quarantine: wh.is_damage_quarantine,
        active: wh.active,
      });
    }
  }, [whQ.data, form]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch<Warehouse>(`/warehouses/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['warehouses'] });
      qc.invalidateQueries({ queryKey: ['masters', 'warehouses'] });
      void navigate({ to: '/warehouses' });
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : 'Could not save warehouse'),
  });

  if (whQ.isError)
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-slate-900">Warehouse</h1>
        <ErrorNote message="Could not load warehouse" />
      </div>
    );
  if (!whQ.data || !form) return <Spinner label="Loading warehouse" />;
  const wh = whQ.data;
  const isVan = wh.type === 'van';

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      is_damage_quarantine: form.is_damage_quarantine,
      active: form.active,
    };
    // Only send vehicle/custodian if van (PATCH rejects nulling vehicle on van)
    if (isVan) {
      if (!form.vehicle_id) {
        setError('Vans require a vehicle');
        return;
      }
      if (!form.custodian_user_id) {
        setError('Vans require a custodian');
        return;
      }
      body.vehicle_id = form.vehicle_id;
      body.custodian_user_id = form.custodian_user_id;
    } else {
      body.vehicle_id = form.vehicle_id || null;
      body.custodian_user_id = form.custodian_user_id || null;
    }
    save.mutate(body);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">
            {isVan ? 'Van' : 'Warehouse'}
          </div>
          <h1 className="text-xl font-semibold text-slate-900">
            {wh.name}{' '}
            <span className="ml-1 font-mono text-sm text-slate-500">
              ({wh.code})
            </span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={form.active ? 'green' : 'slate'}>
            {form.active ? 'active' : 'inactive'}
          </Badge>
          <Link to="/warehouses" className="text-sm text-indigo-600 hover:underline">
            ← All warehouses
          </Link>
        </div>
      </div>

      {error && <ErrorNote message={error} />}

      <Card>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Code" hint="Immutable">
            <Input value={wh.code} disabled readOnly />
          </Field>

          <Field label="Type" hint="Immutable">
            <Input value={wh.type} disabled readOnly />
          </Field>

          <Field label="Name">
            <Input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>

          <Field label="Vehicle" optional={!isVan} hint={isVan ? 'Required for vans' : 'Optional'}>
            <Select
              value={form.vehicle_id}
              onChange={(e) => setForm({ ...form, vehicle_id: e.target.value })}
              required={isVan}
            >
              <option value="">— none —</option>
              {vehiclesQ.data?.items
                .filter((v) => v.active || v.id === wh.vehicle_id)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.reg_no}
                  </option>
                ))}
            </Select>
          </Field>

          <Field
            label="Custodian"
            optional={!isVan}
            hint={isVan ? 'Driver responsible for this van' : 'Optional'}
          >
            <Select
              value={form.custodian_user_id}
              onChange={(e) => setForm({ ...form, custodian_user_id: e.target.value })}
              required={isVan}
            >
              <option value="">— none —</option>
              {usersQ.data?.items
                .filter((u) => u.active || u.id === wh.custodian_user_id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </option>
                ))}
            </Select>
          </Field>

          <Field label="Damage quarantine">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.is_damage_quarantine}
                onChange={(e) =>
                  setForm({ ...form, is_damage_quarantine: e.target.checked })
                }
              />
              Holds damaged stock — not sellable
            </label>
          </Field>

          <Field label="Active">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              Available for transfers and loads
            </label>
          </Field>

          <div className="col-span-full flex justify-end gap-2">
            <Link to="/warehouses">
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
