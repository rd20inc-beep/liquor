import { Link, Outlet, createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { Button } from '../components/ui';
import { tokens } from '../lib/api';

export const Route = createFileRoute('/_app')({
  beforeLoad: () => {
    if (!tokens.user()) throw redirect({ to: '/login' });
  },
  component: AppShell,
});

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/customers', label: 'Customers' },
  { to: '/products', label: 'Products' },
  { to: '/inventory', label: 'Inventory' },
  { to: '/orders', label: 'Orders' },
  { to: '/invoices', label: 'Invoices' },
  { to: '/payments', label: 'Payments' },
  { to: '/approvals', label: 'Approvals' },
] as const;

function AppShell() {
  const user = tokens.user();
  const navigate = useNavigate();
  const logout = () => {
    tokens.clear();
    void navigate({ to: '/login' });
  };

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-slate-800 bg-slate-950/60 p-4">
        <div className="mb-6 flex items-center gap-2">
          <span className="inline-block h-6 w-6 rounded-md bg-blue-600" />
          <span className="text-sm font-semibold text-slate-100">Liquor OS</span>
        </div>
        <nav className="space-y-1">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === '/' }}
              className="block rounded-md px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-slate-100 [&.active]:bg-slate-800 [&.active]:text-slate-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 min-w-0">
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950/40 px-6 py-3">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            {user?.org_id ? `Org ${user.org_id.slice(0, 8)}…` : ''}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-300">
              {user?.name ?? '—'} <span className="text-slate-500">({user?.role})</span>
            </span>
            <Button variant="ghost" onClick={logout}>
              Sign out
            </Button>
          </div>
        </header>
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
