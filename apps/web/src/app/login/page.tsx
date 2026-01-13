'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('Welcome-123');
  const [user, setUser] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function onLogin() {
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Login failed');

      setUser(body.user);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function onRefresh() {
    setError(null);
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Refresh failed');
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function onLogout() {
    setError(null);
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Logout failed');
      setUser(null);
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 520 }}>
      <h1>ERP Login</h1>

      <label>Email</label>
      <input
        style={{ width: '100%', padding: 8 }}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <label style={{ marginTop: 12, display: 'block' }}>Password</label>
      <input
        style={{ width: '100%', padding: 8 }}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={onLogin}>Login</button>
        <button onClick={onRefresh}>Refresh</button>
        <button onClick={onLogout}>Logout</button>
      </div>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      <h2>User</h2>
      <pre>{JSON.stringify(user, null, 2)}</pre>

      <p style={{ marginTop: 16 }}>
        After login, go to <a href="/accounting/trial-balance">Trial Balance</a> or{' '}
        <a href="/accounting/ledger">Ledger</a> or{' '}
        <a href="/accounting/grni">GRNI</a>.
      </p>
    </main>
  );
}