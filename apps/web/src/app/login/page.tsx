'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const returnTo = useMemo(() => searchParams.get('returnTo') ?? '/', [searchParams]);

  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('Welcome-123');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessionBusy, setSessionBusy] = useState<'refresh' | 'logout' | null>(null);

  async function onLogin() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Login failed');

      router.push(returnTo);
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  async function onRefresh() {
    setError(null);
    setSessionBusy('refresh');
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Refresh failed');
    } catch (e: any) {
      setError(e?.message ?? 'Refresh failed');
    } finally {
      setSessionBusy(null);
    }
  }

  async function onLogout() {
    setError(null);
    setSessionBusy('logout');
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Logout failed');
      router.push('/login');
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Logout failed');
    } finally {
      setSessionBusy(null);
    }
  }

  return (
    <div className="min-h-[calc(100vh-56px)] flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <div className="text-sm text-muted-foreground">ERP-PRO</div>
          <h1 className="text-2xl font-semibold">Sign in</h1>
          <p className="text-sm text-muted-foreground">Use your credentials to access the system.</p>
        </div>

        {error && <Alert variant="destructive">{error}</Alert>}

        <Card>
          <CardHeader>
            <CardTitle>Login</CardTitle>
            <CardDescription>JWT session is stored via the web API routes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            </div>

            <div className="space-y-2">
              <Label>Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>

            <Button className="w-full" onClick={onLogin} disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>

            <div className="text-xs text-muted-foreground">
              After login: <a className="underline" href="/accounting/ledger">Ledger</a> ·{' '}
              <a className="underline" href="/accounting/trial-balance">Trial Balance</a> ·{' '}
              <a className="underline" href="/accounting/grni">GRNI</a>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Session tools</CardTitle>
            <CardDescription>Useful during development.</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button
              variant="outline"
              onClick={onRefresh}
              disabled={sessionBusy !== null}
            >
              {sessionBusy === 'refresh' ? 'Refreshing…' : 'Refresh token'}
            </Button>
            <Button
              variant="destructive"
              onClick={onLogout}
              disabled={sessionBusy !== null}
            >
              {sessionBusy === 'logout' ? 'Logging out…' : 'Logout'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}