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
    'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium shadow-sm transition focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-slate-50 disabled:opacity-50';
  const variants = {
    primary: 'bg-amber-600 hover:bg-amber-700 text-white focus:ring-amber-500',
    secondary:
      'bg-white hover:bg-slate-50 text-slate-800 ring-1 ring-inset ring-slate-300 focus:ring-slate-400',
    ghost: 'bg-transparent shadow-none hover:bg-slate-100 text-slate-700 focus:ring-slate-300',
    danger: 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500',
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function Input({
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder-slate-400 shadow-sm transition focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 ${className}`}
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
      className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm transition focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 ${className}`}
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
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-black/[0.02] ${className}`}
    >
      {title && (
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
          <h3 className="text-sm font-semibold tracking-tight text-slate-900">{title}</h3>
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
    slate: 'bg-slate-100 text-slate-700 ring-slate-200',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    // "amber" tone = warning, uses orange so it doesn't collide with the primary amber
    amber: 'bg-orange-50 text-orange-700 ring-orange-200',
    red: 'bg-red-50 text-red-700 ring-red-200',
    // "blue" tone = primary, renders with brand amber (gold)
    blue: 'bg-amber-50 text-amber-800 ring-amber-200',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ring-1 ring-inset ${tones[tone]}`}
    >
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
      className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-black/[0.02] border-l-4 ${
        tone ? accent[tone] : 'border-l-slate-300'
      }`}
    >
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 tabular">
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
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
