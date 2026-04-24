import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge, Card, Input, Select, Spinner } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/audit')({
  component: AuditViewer,
});

interface AuditEntry {
  id: number;
  ts: string;
  action: 'create' | 'update' | 'delete' | 'override' | 'approve' | 'reject' | 'lock' | 'unlock';
  entity: string;
  entity_id: string;
  user_id: string | null;
  user_name: string | null;
  before_json: unknown;
  after_json: unknown;
  ip: string | null;
}

const actionTone: Record<string, 'slate' | 'green' | 'amber' | 'red' | 'blue'> = {
  create: 'blue',
  update: 'slate',
  delete: 'red',
  override: 'amber',
  approve: 'green',
  reject: 'red',
  lock: 'slate',
  unlock: 'amber',
};

const ENTITY_OPTIONS = [
  '', 'sales_order', 'invoice', 'payment', 'credit_note', 'customer', 'customer_credit',
  'route', 'route_sequence', 'warehouse', 'product', 'approval_request', 'stock_batch',
  'cycle_count',
];

function prettyJSON(v: unknown): string {
  if (v === null || v === undefined) return '—';
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function AuditViewer() {
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['audit', entity, action],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '200' });
      if (entity) params.set('entity', entity);
      if (action) params.set('action', action);
      return api.get<{ items: AuditEntry[] }>(`/audit?${params.toString()}`);
    },
    retry: false,
  });

  const items = (data?.items ?? []).filter((e) => {
    if (!q.trim()) return true;
    const n = q.trim().toLowerCase();
    return (
      e.entity.toLowerCase().includes(n) ||
      e.entity_id.toLowerCase().includes(n) ||
      (e.user_name ?? '').toLowerCase().includes(n)
    );
  });

  const toggle = (id: number) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (isError) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-slate-900">Audit log</h1>
        <Card>
          <div className="text-sm text-slate-600">
            {error instanceof Error ? error.message : 'Unable to load audit log'} — requires
            admin/owner role.
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Audit log</h1>

      <Card>
        <div className="mb-3 flex flex-wrap gap-3">
          <div className="w-48">
            <Select value={entity} onChange={(e) => setEntity(e.target.value)}>
              {ENTITY_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o || 'All entities'}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-40">
            <Select value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">All actions</option>
              <option value="create">create</option>
              <option value="update">update</option>
              <option value="override">override</option>
              <option value="approve">approve</option>
              <option value="reject">reject</option>
              <option value="delete">delete</option>
              <option value="lock">lock</option>
              <option value="unlock">unlock</option>
            </Select>
          </div>
          <div className="min-w-64 flex-1">
            <Input
              placeholder="Search entity id / user…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>

        {isLoading ? (
          <Spinner label="Loading audit entries" />
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">
            No audit entries match this filter.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((e) => {
              const isOpen = expanded.has(e.id);
              return (
                <div key={e.id}>
                  <button
                    type="button"
                    onClick={() => toggle(e.id)}
                    className="grid w-full grid-cols-[80px_170px_130px_130px_1fr_80px] items-center gap-x-3 py-2 text-left text-sm hover:bg-slate-100"
                  >
                    <div className="font-mono text-xs text-slate-500">#{e.id}</div>
                    <div className="text-xs text-slate-600">
                      {new Date(e.ts).toLocaleString()}
                    </div>
                    <div>
                      <Badge tone={actionTone[e.action] ?? 'slate'}>{e.action}</Badge>
                    </div>
                    <div className="text-slate-800">{e.entity}</div>
                    <div className="truncate font-mono text-xs text-slate-600">
                      {e.entity_id}
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      {e.user_name ?? 'system'} · {isOpen ? '▾' : '▸'}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="grid grid-cols-1 gap-3 border-t border-slate-100 bg-slate-50 p-3 md:grid-cols-2">
                      <div>
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          Before
                        </div>
                        <pre className="max-h-72 overflow-auto rounded-md border border-slate-200 bg-white p-2 text-xs text-slate-800">
                          {prettyJSON(e.before_json)}
                        </pre>
                      </div>
                      <div>
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          After
                        </div>
                        <pre className="max-h-72 overflow-auto rounded-md border border-slate-200 bg-white p-2 text-xs text-slate-800">
                          {prettyJSON(e.after_json)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
