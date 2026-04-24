import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

export function Button({
  className = '',
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  const base =
    'inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-offset-0 disabled:opacity-50';
  const variants = {
    primary: 'bg-amber-600 hover:bg-amber-500 text-white focus:ring-amber-400',
    secondary: 'bg-slate-200 hover:bg-slate-300 text-slate-900 focus:ring-slate-400',
    ghost: 'bg-transparent hover:bg-slate-100 text-slate-700',
    danger: 'bg-red-600 hover:bg-red-500 text-white focus:ring-red-400',
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function Input({
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder-slate-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 ${className}`}
      {...props}
    />
  );
}

export function Select({
  className = '',
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  optional = false,
}: {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-600">
        <span>{label}</span>
        {optional && <span className="text-slate-400">optional</span>}
      </span>
      {children}
      {hint && !error && <span className="block text-xs text-slate-500">{hint}</span>}
      {error && <span className="block text-xs text-red-600">{error}</span>}
    </label>
  );
}

export function Card({
  title,
  children,
  actions,
  className = '',
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white ${className}`}>
      {title && (
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

const CURRENCY_PREFIX: Record<string, string> = {
  PKR: 'Rs ',
  INR: '₹',
  USD: '$',
};

export function Money({
  value,
  currency = 'PKR',
}: {
  value: number | string | null | undefined;
  currency?: string;
}) {
  if (value === null || value === undefined) return <span className="text-slate-500">—</span>;
  const n = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(n)) return <span className="text-slate-500">—</span>;
  const prefix = CURRENCY_PREFIX[currency] ?? `${currency} `;
  const neg = n < 0;
  return (
    <span className={neg ? 'text-red-600' : 'text-slate-800'}>
      {prefix}
      {Math.abs(n).toLocaleString('en-US', {
        maximumFractionDigits: 2,
        minimumFractionDigits: 0,
      })}
    </span>
  );
}

export function Badge({
  children,
  tone = 'slate',
}: {
  children: ReactNode;
  tone?: 'slate' | 'green' | 'amber' | 'red' | 'blue';
}) {
  const tones = {
    slate: 'bg-slate-200 text-slate-700',
    green: 'bg-emerald-100 text-emerald-700',
    // "amber" tone = warning, uses orange so it doesn't collide with the primary amber
    amber: 'bg-orange-100 text-orange-700',
    red: 'bg-red-100 text-red-700',
    // "blue" tone = primary, renders with brand amber (gold)
    blue: 'bg-amber-100 text-amber-700',
  };
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'green' | 'amber' | 'red' | 'blue';
}) {
  const accent = {
    green: 'border-l-emerald-600',
    // warning = orange (primary is amber — don't collide)
    amber: 'border-l-orange-500',
    red: 'border-l-red-500',
    // primary = amber/gold
    blue: 'border-l-amber-500',
  };
  return (
    <div
      className={`rounded-lg border border-slate-200 bg-white p-4 border-l-4 ${
        tone ? accent[tone] : 'border-l-slate-300'
      }`}
    >
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-600">{sub}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-600">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-amber-500" />
      {label && <span>{label}</span>}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      {message}
    </div>
  );
}
