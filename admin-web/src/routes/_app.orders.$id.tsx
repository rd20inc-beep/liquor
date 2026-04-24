import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, Money, Select, Spinner, Tile } from '../components/ui';
import { api, ApiError } from '../lib/api';

export const Route = createFileRoute('/_app/orders/$id')({
  component: OrderDetail,
});

interface OrderDetailPayload {
  id: string;
  org_id: string;
  order_no: string;
  order_date: string;
  channel: string;
  status: 'draft' | 'held' | 'approved' | 'confirmed' | 'invoiced' | 'cancelled' | 'fulfilled';
  credit_decision: 'approve' | 'hold' | 'reject' | null;
  credit_reasons: string[] | null;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  subtotal: string;
  tax_total: string;
  total: string;
  approved_by: string | null;
  override_reason_code: string | null;
  override_note: string | null;
  notes: string | null;
  lines: Array<{
    id: string;
    product_id: string;
    sku: string;
    product_name: string;
    qty: number;
    unit_price: string;
    discount_pct: string;
    tax_rate: string;
    line_total: string;
  }>;
}

interface Warehouse {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface Invoice {
  id: string;
  invoice_no: string;
  order_id: string | null;
  total: string;
  outstanding: string;
  status: string;
  due_date: string;
  days_overdue: number;
}

interface AuditEntry {
  id: number;
  ts: string;
  action: string;
  entity: string;
  entity_id: string;
  user_id: string | null;
  user_name: string | null;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
}

const statusTone: Record<string, 'slate' | 'green' | 'amber' | 'red' | 'blue'> = {
  draft: 'slate',
  held: 'amber',
  approved: 'blue',
  confirmed: 'blue',
  invoiced: 'green',
  fulfilled: 'green',
  cancelled: 'red',
};

function summarizeEvent(evt: AuditEntry): string {
  const after = evt.after_json ?? {};
  switch (evt.action) {
    case 'create': {
      const total = (after as { total?: string | number }).total;
      const decision = (after as { decision?: string }).decision;
      const reasons = (after as { reasons?: string[] }).reasons;
      const parts: string[] = [`Order created`];
      if (total) parts.push(`total Rs ${Number(total).toLocaleString('en-US')}`);
      if (decision) parts.push(`credit ${decision}`);
      if (reasons?.length) parts.push(`(${reasons.join(', ')})`);
      return parts.join(' · ');
    }
    case 'override': {
      const code = (after as { reason_code?: string }).reason_code;
      const note = (after as { note?: string }).note;
      return `Admin override applied${code ? ` · ${code}` : ''}${note ? ` — ${note}` : ''}`;
    }
    case 'update': {
      const before = evt.before_json ?? {};
      const prev = (before as { status?: string }).status;
      const next = (after as { status?: string }).status;
      const reason = (after as { reason?: string }).reason;
      if (prev && next && prev !== next) {
        return `Status ${prev} → ${next}${reason ? ` · ${reason}` : ''}`;
      }
      return `Updated${reason ? ` · ${reason}` : ''}`;
    }
    case 'approve':
      return 'Approved';
    case 'reject':
      return 'Rejected';
    default:
      return evt.action;
  }
}

function OrderDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [showOverride, setShowOverride] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const [showCancel, setShowCancel] = useState(false);

  const [overrideCode, setOverrideCode] = useState('management_override');
  const [overrideNote, setOverrideNote] = useState('');
  const [invoiceWarehouse, setInvoiceWarehouse] = useState('');
  const [cancelReason, setCancelReason] = useState('');

  const [actionError, setActionError] = useState<string | null>(null);

  const orderQ = useQuery({
    queryKey: ['order', id],
    queryFn: () => api.get<OrderDetailPayload>(`/orders/${id}`),
  });
  const whQ = useQuery({
    queryKey: ['masters', 'warehouses'],
    queryFn: () => api.get<{ items: Warehouse[] }>('/warehouses'),
  });
  // Find the invoice tied to this order (if any) — filter client-side by order_id
  const invoiceQ = useQuery({
    queryKey: ['invoices', 'for-order', id],
    queryFn: () =>
      api.get<{ items: Invoice[] }>(
        `/invoices?customer_id=${orderQ.data?.customer_id ?? ''}&limit=50`,
      ),
    enabled: !!orderQ.data && orderQ.data.status === 'invoiced',
  });

  // Timeline (audit_log for this order). Gracefully hide if role lacks audit:read.
  const timelineQ = useQuery({
    queryKey: ['audit', 'sales_order', id],
    queryFn: () =>
      api.get<{ items: AuditEntry[] }>(
        `/audit?entity=sales_order&entity_id=${id}&limit=50`,
      ),
    retry: false,
  });

  const override = useMutation({
    mutationFn: (body: { reason_code: string; note: string }) =>
      api.post(`/orders/${id}/override`, body),
    onSuccess: () => {
      setShowOverride(false);
      setActionError(null);
      qc.invalidateQueries({ queryKey: ['order', id] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) =>
      setActionError(e instanceof ApiError ? e.message : 'Override failed'),
  });

  const postInvoice = useMutation({
    mutationFn: (body: { warehouse_id: string }) =>
      api.post<{ invoice_id: string; invoice_no: string }>(`/orders/${id}/invoice`, body),
    onSuccess: () => {
      setShowInvoice(false);
      setActionError(null);
      qc.invalidateQueries({ queryKey: ['order', id] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) =>
      setActionError(e instanceof ApiError ? e.message : 'Invoice posting failed'),
  });

  const cancel = useMutation({
    mutationFn: (body: { reason: string }) => api.post(`/orders/${id}/cancel`, body),
    onSuccess: () => {
      setShowCancel(false);
      setActionError(null);
      qc.invalidateQueries({ queryKey: ['order', id] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) =>
      setActionError(e instanceof ApiError ? e.message : 'Cancel failed'),
  });

  if (orderQ.isLoading) return <Spinner label="Loading order" />;
  if (orderQ.isError || !orderQ.data) {
    const msg =
      orderQ.error instanceof ApiError
        ? `${orderQ.error.code} · ${orderQ.error.message}`
        : orderQ.error instanceof Error
          ? orderQ.error.message
          : 'Order not found.';
    return (
      <div className="space-y-2">
        <ErrorNote message={`Could not load order (id=${id}): ${msg}`} />
        <Link to="/orders" className="text-sm text-blue-400 hover:underline">
          ← Back to orders
        </Link>
      </div>
    );
  }

  const o = orderQ.data;
  const canOverride = o.status === 'held' || o.status === 'draft';
  const canInvoice = o.status === 'approved' || o.status === 'confirmed';
  const canCancel = !['invoiced', 'fulfilled', 'cancelled'].includes(o.status);

  // Pick the invoice whose order_id === this order
  const tiedInvoice = invoiceQ.data?.items.find((i) => i.order_id === id);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Order</div>
          <h1 className="text-2xl font-semibold text-slate-100">
            {o.order_no}{' '}
            <Badge tone={statusTone[o.status] ?? 'slate'}>{o.status}</Badge>
          </h1>
          <div className="mt-1 text-sm text-slate-400">
            <Link
              to="/customers/$id"
              params={{ id: o.customer_id }}
              className="hover:text-blue-400"
            >
              {o.customer_name}
            </Link>{' '}
            <span className="text-slate-500">({o.customer_code})</span> · {o.order_date} · {o.channel}
          </div>
        </div>
        <Link to="/orders" className="text-sm text-blue-400 hover:underline">
          ← Orders
        </Link>
      </div>

      {actionError && <ErrorNote message={actionError} />}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tile label="Subtotal" value={<Money value={o.subtotal} />} />
        <Tile label="Tax" value={<Money value={o.tax_total} />} />
        <Tile label="Total" value={<Money value={o.total} />} tone="blue" />
        <Tile
          label="Credit"
          value={o.credit_decision ?? '—'}
          tone={
            o.credit_decision === 'approve'
              ? 'green'
              : o.credit_decision === 'hold'
                ? 'amber'
                : o.credit_decision === 'reject'
                  ? 'red'
                  : undefined
          }
          sub={o.credit_reasons?.[0] ?? undefined}
        />
      </div>

      {o.override_reason_code && (
        <Card title="Override">
          <div className="space-y-1 text-sm">
            <div className="text-slate-400">
              Reason code:{' '}
              <span className="font-mono text-slate-200">{o.override_reason_code}</span>
            </div>
            <div className="text-slate-300">{o.override_note ?? '—'}</div>
          </div>
        </Card>
      )}

      {o.credit_reasons && o.credit_reasons.length > 0 && (
        <Card title="Credit engine reasons">
          <ul className="space-y-0.5 font-mono text-xs text-slate-300">
            {o.credit_reasons.map((r) => (
              <li key={r}>· {r}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Lines">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="py-1 text-left">Product</th>
              <th className="text-left">SKU</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Unit</th>
              <th className="text-right">Disc %</th>
              <th className="text-right">Tax %</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {o.lines.map((line) => (
              <tr key={line.id} className="border-t border-slate-800/60">
                <td className="py-1.5 text-slate-200">{line.product_name}</td>
                <td className="font-mono text-xs text-slate-400">{line.sku}</td>
                <td className="text-right">{line.qty}</td>
                <td className="text-right">
                  <Money value={line.unit_price} />
                </td>
                <td className="text-right text-slate-400">{Number(line.discount_pct)}</td>
                <td className="text-right text-slate-400">{Number(line.tax_rate)}</td>
                <td className="text-right">
                  <Money value={line.line_total} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {tiedInvoice && (
        <Card title="Invoice">
          {(() => {
            const total = Number(tiedInvoice.total);
            const outstanding = Number(tiedInvoice.outstanding);
            const paid = Math.max(0, total - outstanding);
            const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
            return (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <a
                      href={`/invoices/${tiedInvoice.id}`}
                      className="font-mono text-sm text-blue-400 hover:underline"
                    >
                      {tiedInvoice.invoice_no}
                    </a>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                      <Badge
                        tone={
                          tiedInvoice.status === 'paid'
                            ? 'green'
                            : tiedInvoice.status === 'disputed'
                              ? 'red'
                              : 'amber'
                        }
                      >
                        {tiedInvoice.status}
                      </Badge>
                      <span>due {tiedInvoice.due_date?.slice(0, 10)}</span>
                      {tiedInvoice.days_overdue > 0 && (
                        <span className="text-red-400">
                          ({tiedInvoice.days_overdue}d overdue)
                        </span>
                      )}
                    </div>
                  </div>
                  <a
                    href={`/invoices/${tiedInvoice.id}`}
                    className="rounded-md bg-slate-700 px-3 py-1.5 text-sm text-slate-100 no-underline hover:bg-slate-600"
                  >
                    Open →
                  </a>
                </div>
                {/* Payment coverage bar */}
                <div>
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>
                      Paid <Money value={paid} /> of <Money value={total} />
                    </span>
                    <span className={pct === 100 ? 'text-emerald-300' : 'text-amber-300'}>
                      {pct}%
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={`h-full ${pct === 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {outstanding > 0 && (
                    <div className="mt-1 text-xs text-slate-500">
                      Outstanding: <Money value={outstanding} />
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </Card>
      )}

      {/* Timeline — hidden silently if role lacks audit:read */}
      {!timelineQ.isError && (timelineQ.isLoading || (timelineQ.data?.items.length ?? 0) > 0) && (
        <Card title="Timeline">
          {timelineQ.isLoading ? (
            <Spinner />
          ) : (
            <ol className="relative space-y-3 border-l border-slate-800 pl-5">
              {timelineQ.data!.items
                .slice()
                .reverse()
                .map((evt) => {
                  const icon =
                    evt.action === 'create'
                      ? { sym: '+', tone: 'bg-blue-600' }
                      : evt.action === 'override'
                        ? { sym: '!', tone: 'bg-amber-500' }
                        : evt.action === 'approve'
                          ? { sym: '✓', tone: 'bg-emerald-600' }
                          : evt.action === 'reject'
                            ? { sym: '✕', tone: 'bg-red-600' }
                            : { sym: '·', tone: 'bg-slate-600' };
                  const summary = summarizeEvent(evt);
                  return (
                    <li key={evt.id} className="relative">
                      <span
                        className={`absolute -left-[27px] flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white ${icon.tone}`}
                      >
                        {icon.sym}
                      </span>
                      <div className="text-xs text-slate-500">
                        {new Date(evt.ts).toLocaleString()} ·{' '}
                        <span className="font-mono uppercase text-slate-400">{evt.action}</span>
                        {' · '}
                        {evt.user_name ?? 'system'}
                      </div>
                      <div className="mt-0.5 text-sm text-slate-200">{summary}</div>
                    </li>
                  );
                })}
            </ol>
          )}
        </Card>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {canOverride && (
          <Button onClick={() => setShowOverride((v) => !v)}>
            {showOverride ? 'Close' : 'Override (approve)'}
          </Button>
        )}
        {canInvoice && (
          <Button onClick={() => setShowInvoice((v) => !v)}>
            {showInvoice ? 'Close' : 'Post invoice'}
          </Button>
        )}
        {canCancel && (
          <Button variant="danger" onClick={() => setShowCancel((v) => !v)}>
            {showCancel ? 'Close' : 'Cancel order'}
          </Button>
        )}
      </div>

      {showOverride && (
        <Card title="Admin override — approve held order">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              override.mutate({ reason_code: overrideCode, note: overrideNote });
            }}
          >
            <Field
              label="Reason code"
              hint="Short tag — e.g. management_override, one_time_exception"
            >
              <Input
                required
                maxLength={50}
                value={overrideCode}
                onChange={(e) => setOverrideCode(e.target.value)}
              />
            </Field>
            <Field label="Note" hint="Why the credit decision is being overridden">
              <Input
                required
                value={overrideNote}
                onChange={(e) => setOverrideNote(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowOverride(false)}
              >
                Close
              </Button>
              <Button type="submit" disabled={override.isPending}>
                {override.isPending ? 'Approving…' : 'Approve + reserve stock'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {showInvoice && (
        <Card title="Post invoice">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              postInvoice.mutate({ warehouse_id: invoiceWarehouse });
            }}
          >
            <Field
              label="Ship from warehouse"
              hint="Must hold the reserved stock for this order"
            >
              <Select
                required
                value={invoiceWarehouse}
                onChange={(e) => setInvoiceWarehouse(e.target.value)}
              >
                <option value="">— pick —</option>
                {whQ.data?.items
                  .filter((w) => w.type === 'warehouse')
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowInvoice(false)}
              >
                Close
              </Button>
              <Button type="submit" disabled={postInvoice.isPending}>
                {postInvoice.isPending ? 'Posting…' : 'Post invoice'}
              </Button>
            </div>
          </form>
          <p className="mt-2 text-xs text-slate-500">
            Posting the invoice consumes reserved stock (FEFO), appends an AR ledger debit, and locks the invoice.
          </p>
        </Card>
      )}

      {showCancel && (
        <Card title="Cancel order">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              cancel.mutate({ reason: cancelReason });
            }}
          >
            <Field label="Reason">
              <Input
                required
                placeholder="e.g. customer changed mind"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowCancel(false)}
              >
                Close
              </Button>
              <Button type="submit" variant="danger" disabled={cancel.isPending}>
                {cancel.isPending ? 'Cancelling…' : 'Confirm cancel'}
              </Button>
            </div>
          </form>
          {(o.status === 'approved' || o.status === 'confirmed') && (
            <p className="mt-2 text-xs text-slate-500">
              Reserved stock will be released back to free.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
