import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, Select, Spinner } from '../components/ui';
import { api, ApiError, tokens } from '../lib/api';

export const Route = createFileRoute('/_app/users/$id')({
  component: UserEdit,
});

type Role = 'sales' | 'collector' | 'driver' | 'accounts' | 'admin' | 'owner';

interface User {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  role: Role;
  active: boolean;
  created_at: string;
  devices?: Array<{ device_id: string; platform: string; last_seen_at: string | null }>;
}

const ROLES: Role[] = ['sales', 'collector', 'driver', 'accounts', 'admin', 'owner'];

function UserEdit() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = tokens.user();
  const editingSelf = me?.sub === id;

  const userQ = useQuery({
    queryKey: ['users', id],
    queryFn: () => api.get<User>(`/users/${id}`),
  });

  const [form, setForm] = useState<{
    name: string;
    email: string;
    role: Role;
    active: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (userQ.data && !form) {
      setForm({
        name: u.name,
        email: u.email ?? '',
        role: u.role,
        active: u.active,
      });
    }
  }, [userQ.data, form]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch<User>(`/users/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['masters', 'users'] });
      void navigate({ to: '/users' });
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : 'Could not save user'),
  });

  if (userQ.isError)
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-slate-900">User</h1>
        <ErrorNote message="Could not load user" />
      </div>
    );
  if (!userQ.data || !form) return <Spinner label="Loading user" />;
  const u = userQ.data;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    save.mutate({
      name: form.name.trim(),
      email: form.email.trim() || null,
      role: form.role,
      active: form.active,
    });
  };

  const devices = u.devices ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">User</div>
          <h1 className="text-xl font-semibold text-slate-900">{u.name}</h1>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={form.active ? 'green' : 'slate'}>
            {form.active ? 'active' : 'inactive'}
          </Badge>
          <Link to="/users" className="text-sm text-indigo-600 hover:underline">
            ← All users
          </Link>
        </div>
      </div>

      {error && <ErrorNote message={error} />}
      {editingSelf && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          You are editing your own account — changes to role or active status may log you
          out.
        </div>
      )}

      <Card>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Phone" hint="Immutable — used as login fallback">
            <Input value={u.phone} disabled readOnly />
          </Field>

          <Field label="Name">
            <Input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>

          <Field label="Email" optional>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>

          <Field label="Role">
            <Select
              value={form.role}
              onChange={(e) =>
                setForm({ ...form, role: e.target.value as Role })
              }
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Active">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              Can sign in
            </label>
          </Field>

          <div className="col-span-full flex justify-end gap-2">
            <Link to="/users">
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

      {devices.length > 0 && (
        <Card title="Devices">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 text-left">Device</th>
                <th className="text-left">Platform</th>
                <th className="text-left">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.device_id} className="border-t border-slate-200">
                  <td className="py-1.5 font-mono text-xs text-slate-600">
                    {d.device_id.slice(0, 12)}…
                  </td>
                  <td className="text-slate-600">{d.platform}</td>
                  <td className="text-xs text-slate-500">
                    {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
