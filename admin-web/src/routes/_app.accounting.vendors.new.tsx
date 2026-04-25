import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, Card, ErrorNote, Field, Input } from '../components/ui';
import { api, ApiError } from '../lib/api';

export const Route = createFileRoute('/_app/accounting/vendors/new')({
  component: NewVendor,
});

function NewVendor() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    contact_phone: '',
    contact_email: '',
    address: '',
    ntn: '',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ id: string }>('/vendors', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vendors'] });
      void navigate({ to: '/accounting/vendors' });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not create vendor'),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    create.mutate({
      name: form.name.trim(),
      contact_phone: form.contact_phone.trim() || undefined,
      contact_email: form.contact_email.trim() || undefined,
      address: form.address.trim() || undefined,
      ntn: form.ntn.trim() || undefined,
      notes: form.notes.trim() || undefined,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">New vendor</h1>
        <Link to="/accounting/vendors" className="text-sm text-indigo-600 hover:underline">
          ← Vendors
        </Link>
      </div>

      {error && <ErrorNote message={error} />}

      <Card>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Name">
            <Input
              required
              autoFocus
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="PSO Filling Station"
            />
          </Field>

          <Field label="NTN" optional hint="National Tax Number">
            <Input
              value={form.ntn}
              onChange={(e) => setForm({ ...form, ntn: e.target.value })}
              placeholder="1234567-8"
            />
          </Field>

          <Field label="Phone" optional>
            <Input
              value={form.contact_phone}
              onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
              placeholder="+92 300 1234567"
            />
          </Field>

          <Field label="Email" optional>
            <Input
              type="email"
              value={form.contact_email}
              onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
            />
          </Field>

          <Field label="Address" optional>
            <Input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </Field>

          <Field label="Notes" optional>
            <Input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>

          <div className="col-span-full flex justify-end gap-2">
            <Link to="/accounting/vendors">
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create vendor'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
