import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { Badge, Card, Spinner } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/users/')({
  component: UsersList,
});

interface User {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  role: 'sales' | 'collector' | 'driver' | 'accounts' | 'admin' | 'owner';
  active: boolean;
}

const roleTone: Record<User['role'], 'slate' | 'blue' | 'amber' | 'green' | 'red'> = {
  owner: 'red',
  admin: 'amber',
  accounts: 'blue',
  sales: 'green',
  collector: 'slate',
  driver: 'slate',
};

function UsersList() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ items: User[] }>('/users'),
  });

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Users</h1>
      </div>

      <Card>
        {isLoading ? (
          <Spinner label="Loading users" />
        ) : items.length === 0 ? (
          <div className="text-sm text-slate-500">No users yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 text-left">Name</th>
                <th className="text-left">Role</th>
                <th className="text-left">Phone</th>
                <th className="text-left">Email</th>
                <th className="text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr
                  key={u.id}
                  onClick={() => navigate({ to: '/users/$id', params: { id: u.id } })}
                  className="cursor-pointer border-t border-slate-200 hover:bg-slate-100/70"
                >
                  <td className="py-1.5 text-slate-800">{u.name}</td>
                  <td>
                    <Badge tone={roleTone[u.role]}>{u.role}</Badge>
                  </td>
                  <td className="font-mono text-xs text-slate-600">{u.phone}</td>
                  <td className="text-slate-600">{u.email ?? '—'}</td>
                  <td>
                    <Badge tone={u.active ? 'green' : 'slate'}>
                      {u.active ? 'active' : 'inactive'}
                    </Badge>
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
