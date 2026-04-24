import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, Card, ErrorNote, Field, Input, Select } from '../components/ui';
import { api, ApiError } from '../lib/api';

export const Route = createFileRoute('/_app/customers/new')({
  component: NewCustomer,
});

interface Route {
  id: string;
  name: string;
}
interface PaymentTerm {
  id: string;
  code: string;
  type: string;
  days: number;
}
interface PriceList {
  id: string;
  name: string;
  is_default: boolean;
}

interface CreateBody {
  code: string;
  name: string;
  type: string;
  phone?: string;
  address?: string;
  credit_limit: number;
  route_id?: string;
  payment_term_id?: string;
  price_list_id?: string;
  high_value: boolean;
}

function NewCustomer() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    code: '',
    name: '',
    type: 'outlet',
    phone: '',
    address: '',
    credit_limit: '0',
    route_id: '',
    payment_term_id: '',
    price_list_id: '',
    high_value: false,
  });
  const [error, setError] = useState<string | null>(null);

  const routesQ = useQuery({
    queryKey: ['masters', 'routes'],
    queryFn: () => api.get<{ items: Route[] }>('/routes'),
  });
  const termsQ = useQuery({
    queryKey: ['masters', 'payment-terms'],
    queryFn: () => api.get<{ items: PaymentTerm[] }>('/payment-terms'),
  });
  const listsQ = useQuery({
    queryKey: ['masters', 'price-lists'],
    queryFn: () => api.get<{ items: PriceList[] }>('/price-lists'),
  });

  const create = useMutation({
    mutationFn: (body: CreateBody) => api.post<{ id: string }>('/customers', body),
    onSuccess: (res) => {
      void navigate({ to: '/customers/$id', params: { id: res.id } });
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : 'Could not create customer');
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const body: CreateBody = {
      code: form.code.trim(),
      name: form.name.trim(),
      type: form.type,
      credit_limit: Number(form.credit_limit) || 0,
      high_value: form.high_value,
    };
    if (form.phone.trim()) body.phone = form.phone.trim();
    if (form.address.trim()) body.address = form.address.trim();
    if (form.route_id) body.route_id = form.route_id;
    if (form.payment_term_id) body.payment_term_id = form.payment_term_id;
    if (form.price_list_id) body.price_list_id = form.price_list_id;
    create.mutate(body);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">New customer</h1>
        <Link to="/customers" className="text-sm text-indigo-600 hover:underline">
          ← All customers
        </Link>
      </div>

      {error && <ErrorNote message={error} />}

      <Card>
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Code">
            <Input
              required
              autoFocus
              maxLength={50}
              placeholder="C-009"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
          </Field>

          <Field label="Name">
            <Input
              required
              maxLength={200}
              placeholder="Peshawar Club Bar"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>

          <Field label="Type">
            <Select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              <option value="outlet">Outlet</option>
              <option value="bar">Bar</option>
              <option value="hotel">Hotel</option>
              <option value="retailer">Retailer</option>
              <option value="other">Other</option>
            </Select>
          </Field>

          <Field label="Phone" optional>
            <Input
              type="tel"
              placeholder="+923001234567"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>

          <Field label="Address" optional>
            <Input
              placeholder="Street, city"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </Field>

          <Field label="Credit limit" hint="PKR">
            <Input
              type="number"
              min="0"
              step="1"
              value={form.credit_limit}
              onChange={(e) => setForm({ ...form, credit_limit: e.target.value })}
            />
          </Field>

          <Field label="Route" optional>
            <Select
              value={form.route_id}
              onChange={(e) => setForm({ ...form, route_id: e.target.value })}
            >
              <option value="">— none —</option>
              {routesQ.data?.items.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Payment term" optional>
            <Select
              value={form.payment_term_id}
              onChange={(e) => setForm({ ...form, payment_term_id: e.target.value })}
            >
              <option value="">— none —</option>
              {termsQ.data?.items.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code} ({t.type}, {t.days}d)
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Price list"
            optional
            hint="Overrides the default list — e.g. Customer A pays 800, B pays 900"
          >
            <Select
              value={form.price_list_id}
              onChange={(e) => setForm({ ...form, price_list_id: e.target.value })}
            >
              <option value="">— use default —</option>
              {listsQ.data?.items.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.is_default ? ' (default)' : ''}
                </option>
              ))}
            </Select>
          </Field>

          <label className="col-span-full flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.high_value}
              onChange={(e) => setForm({ ...form, high_value: e.target.checked })}
            />
            High-value customer (boosts collector priority score)
          </label>

          <div className="col-span-full flex justify-end gap-2">
            <Link to="/customers">
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create customer'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
