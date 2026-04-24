import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, ErrorNote, Input } from '../components/ui';
import { api, ApiError, tokens } from '../lib/api';

export const Route = createFileRoute('/login')({
  beforeLoad: () => {
    if (tokens.user()) throw redirect({ to: '/' });
  },
  component: LoginPage,
});

interface LoginResp {
  access_token: string;
  refresh_token: string;
  user: { id: string; role: string; org_id: string; name?: string };
}

function LoginPage() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('123456');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const verify = async () => {
    setError(null);
    setLoading(true);
    try {
      const resp = await api.post<LoginResp>(
        '/auth/login',
        { phone, otp, device_id: navigator.userAgent.slice(0, 80) },
        { auth: false },
      );
      tokens.set(resp.access_token, resp.refresh_token, {
        sub: resp.user.id,
        role: resp.user.role as never,
        org_id: resp.user.org_id,
        name: resp.user.name,
      });
      navigate({ to: '/' });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-slate-800 bg-slate-900/70 p-8 shadow-xl">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Liquor OS</h1>
          <p className="mt-1 text-sm text-slate-400">Admin — sign in</p>
        </div>

        {error && <ErrorNote message={error} />}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (phone.length >= 10 && otp.length === 6) void verify();
          }}
          className="space-y-3"
        >
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
              Phone number
            </span>
            <Input
              autoFocus
              type="tel"
              placeholder="9876543210"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^0-9+]/g, ''))}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
              6-digit OTP
            </span>
            <Input
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ''))}
            />
            <p className="mt-1 text-xs text-slate-500">Dev mode: OTP is 123456</p>
          </label>
          <Button
            type="submit"
            disabled={loading || phone.length < 10 || otp.length !== 6}
            className="w-full"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}
