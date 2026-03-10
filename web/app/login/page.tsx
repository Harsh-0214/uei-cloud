'use client';

import { useState } from 'react';

type Mode = 'login' | 'register';

export default function LoginPage() {
  const [mode,     setMode]     = useState<Mode>('login');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [orgName,  setOrgName]  = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body: Record<string, string> = { email, password };
      if (mode === 'register') body.org_name = orgName;

      const res = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.detail ?? 'Something went wrong.');
        return;
      }

      // Store token + org name for the dashboard
      localStorage.setItem('uei_token',    data.access_token);
      localStorage.setItem('uei_org_name', data.org_name);
      localStorage.setItem('uei_role',     data.role);

      window.location.href = '/dashboard';
    } catch {
      setError('Network error — could not reach the server.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      background: 'var(--bg)',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 400,
        background: 'var(--surf)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '36px 32px',
      }}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 500, color: 'var(--txt3)', margin: '0 0 4px' }}>
            Battery Management System
          </p>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--txt)', margin: 0, letterSpacing: '-0.02em' }}>
            UEI Cloud
          </h1>
        </div>

        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'var(--surf2)', borderRadius: 8, padding: 4 }}>
          {(['login', 'register'] as Mode[]).map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(''); }}
              style={{
                flex: 1,
                padding: '7px 0',
                borderRadius: 6,
                border: 'none',
                fontFamily: 'var(--ff-sans)',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s',
                background: mode === m ? 'var(--surf)' : 'transparent',
                color:      mode === m ? 'var(--txt)'  : 'var(--txt2)',
                boxShadow:  mode === m ? '0 1px 4px rgba(0,0,0,0.2)' : 'none',
              }}
            >
              {m === 'login' ? 'Sign in' : 'Register'}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {mode === 'register' && (
            <div>
              <label style={labelStyle}>Organization name</label>
              <input
                type="text"
                value={orgName}
                onChange={e => setOrgName(e.target.value)}
                placeholder="e.g. Team A"
                required
                style={inputStyle}
              />
            </div>
          )}

          <div>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
              style={inputStyle}
            />
          </div>

          {error && (
            <p style={{ fontSize: '0.78rem', color: 'var(--err)', margin: 0, padding: '8px 12px', background: 'rgba(248,113,113,0.08)', borderRadius: 6 }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 4,
              padding: '11px 0',
              background: loading ? 'var(--surf2)' : 'var(--accent)',
              color:      loading ? 'var(--txt2)'  : '#111',
              border: 'none',
              borderRadius: 8,
              fontFamily: 'var(--ff-sans)',
              fontSize:   '0.88rem',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        {mode === 'register' && (
          <p style={{ marginTop: 16, fontSize: '0.72rem', color: 'var(--txt3)', textAlign: 'center' }}>
            Creating a new organization makes you its admin.
            <br />
            Joining an existing org adds you as a member.
          </p>
        )}
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.72rem',
  fontWeight: 600,
  color: 'var(--txt2)',
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--txt)',
  fontFamily: 'var(--ff-sans)',
  fontSize: '0.88rem',
  padding: '9px 12px',
  outline: 'none',
  boxSizing: 'border-box',
};
