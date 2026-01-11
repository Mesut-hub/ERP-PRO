'use client';

import { useState } from 'react';
import { apiFetch } from '../../lib/api';

export default function LoginPage() {
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('Welcome-123');
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [me, setMe] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function onLogin() {
    setError(null);
    try {
      const r = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setAccessToken(r.accessToken);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function onMe() {
    setError(null);
    try {
      if (!accessToken) throw new Error('Login first');
      const r = await apiFetch('/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setMe(r);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function onRefresh() {
    setError(null);
    try {
      const r = await apiFetch('/auth/refresh', { method: 'POST' });
      if (r?.accessToken) setAccessToken(r.accessToken);
      else setAccessToken(null);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function onLogout() {
    setError(null);
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
      setAccessToken(null);
      setMe(null);
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
        <button onClick={onMe}>/me</button>
        <button onClick={onRefresh}>Refresh</button>
        <button onClick={onLogout}>Logout</button>
      </div>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      <h2>Access token</h2>
      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {accessToken ?? '(none)'}
      </pre>

      <h2>/me result</h2>
      <pre>{JSON.stringify(me, null, 2)}</pre>
    </main>
  );
}
