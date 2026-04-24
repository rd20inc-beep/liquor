import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge, Button, Card, ErrorNote, Spinner } from '../components/ui';
import { api, ApiError, tokens } from '../lib/api';

export const Route = createFileRoute('/_app/approvals')({
  component: Approvals,
});

interface Approval {
  id: string;
  type: string;
  ref_type: string;
  ref_id: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reason: string | null;
  payload: unknown;
  created_at: string;
  requested_by_name: string | null;
  approver_name: string | null;
}

function Approvals() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const user = tokens.user();
  const canDecide = user?.role === 'admin' || user?.role === 'owner';

  const listQ = useQuery({
    queryKey: ['approvals', 'pending'],
    queryFn: () => api.get<{ items: Approval[] }>('/approvals?status=pending&limit=100'),
  });

  const decide = useMutation({
    mutationFn: (args: { id: string; decision: 'approve' | 'reject' }) =>
      api.post(`/approvals/${args.id}/decide`, { decision: args.decision }),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['approvals'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : 'Decision failed');
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Approvals</h1>
      {error && <ErrorNote message={error} />}
      <Card>
        {listQ.isLoading ? (
          <Spinner label="Loading" />
        ) : listQ.data?.items.length === 0 ? (
          <div className="text-sm text-slate-500">No pending approvals.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 text-left">Type</th>
                <th className="text-left">Reason</th>
                <th className="text-left">Requested by</th>
                <th className="text-left">Created</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {listQ.data?.items.map((a) => (
                <tr key={a.id} className="border-t border-slate-200">
                  <td className="py-2">
                    <Badge tone="blue">{a.type}</Badge>
                  </td>
                  <td className="text-slate-700">{a.reason ?? '—'}</td>
                  <td className="text-slate-600">{a.requested_by_name ?? 'unknown'}</td>
                  <td className="text-xs text-slate-500">
                    {new Date(a.created_at).toLocaleString()}
                  </td>
                  <td>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        disabled={!canDecide || decide.isPending}
                        onClick={() =>
                          decide.mutate({ id: a.id, decision: 'reject' })
                        }
                      >
                        Reject
                      </Button>
                      <Button
                        disabled={!canDecide || decide.isPending}
                        onClick={() =>
                          decide.mutate({ id: a.id, decision: 'approve' })
                        }
                      >
                        Approve
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!canDecide && (
          <div className="mt-3 text-xs text-slate-500">
            Only admin or owner can decide approvals.
          </div>
        )}
      </Card>
    </div>
  );
}
