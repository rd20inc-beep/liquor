import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, Card, ErrorNote, Field, Input } from '../components/ui';
import { api, ApiError } from '../lib/api';

export const Route = createFileRoute('/_app/price-lists/new')({
  component: NewPriceList,
});

function NewPriceList() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ id: string }>('/price-lists', body),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['price-lists'] });
      void navigate({ to: '/price-lists/$id', params: { id: r.id } });
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : 'Could not create price list'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">New price list</h1>
        <Link to="/price-lists" className="text-sm text-amber-400 hover:underline">
          ← All price lists
        </Link>
      </div>

      {error && <ErrorNote message={error} />}

      <Card>
        <form
          className="grid grid-cols-1 gap-4 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const body: Record<string, unknown> = {
              name: name.trim(),
              effective_from: from,
              is_default: isDefault,
            };
            if (to) body.effective_to = to;
            create.mutate(body);
          }}
        >
          <Field label="Name" hint="e.g. Marriott tier, Wholesale">
            <Input
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Marriott tier"
            />
          </Field>

          <div />

          <Field label="Effective from">
            <Input
              required
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>

          <Field label="Effective to" optional hint="Open-ended if blank">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>

          <label className="col-span-full flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
            />
            Make this the default price list (used when customer has no override)
          </label>

          <div className="col-span-full flex justify-end gap-2">
            <Link to="/price-lists">
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
