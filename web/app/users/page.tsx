'use client';

import { useEffect, useState } from 'react';
import ThemeToggle from '../components/ThemeToggle';

interface User {
  id: number;
  email: string;
  role: string;
  org_name: string;
}

interface Me {
  email: string;
  role: string;
  org_name: string;
}

const ROLE_COLOR: Record<string, string> = {
  superadmin: 'var(--err)',
  admin:      'var(--accent)',
  member:     'var(--txt2)',
};

export default function UsersPage() {
  const [users,   setUsers]   = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [me,      setMe]      = useState<Me | null>(null);

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setMe(data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/admin/users', { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setUsers(data);
        else setError(data.detail ?? 'Failed to load users.');
      })
      .catch(() => setError('Network error.'))
      .finally(() => setLoading(false));
  }, []);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  }

  // Group by org
  const orgs: Record<string, User[]> = {};
  for (const u of users) {
    (orgs[u.org_name] ??= []).push(u);
  }

  return (
    <div style={{ width: '100%', padding: '32px 5vw', minHeight: '100vh' }}>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ height: 3, background: 'linear-gradient(90deg, var(--txt2) 0%, rgba(128,128,120,0.1) 60%, transparent 100%)', borderRadius: 99, marginBottom: 24 }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          {/* Brand + badge */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <h1 style={{ fontSize: '1.85rem', fontWeight: 800, margin: 0, letterSpacing: '-0.03em', lineHeight: 1, background: 'var(--title-grad)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                UEI Cloud
              </h1>
              <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--txt)', background: 'var(--surf2)', border: '1px solid var(--border-hi)', padding: '3px 8px', borderRadius: 4 }}>
                Users
              </span>
            </div>
            <p style={{ fontSize: '0.72rem', fontWeight: 500, color: 'var(--txt3)', margin: 0 }}>
              Unified Energy Interface
            </p>
          </div>

          {/* Right: nav + user + theme */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <a
              href="/dashboard"
              style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--txt2)', textDecoration: 'none', transition: 'color 0.15s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--txt)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--txt2)'; }}
            >
              ← Dashboard
            </a>
            {me && (
              <>
                <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--txt)' }}>{me.email}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--txt3)', marginTop: 2 }}>
                    {me.org_name} · <span style={{ color: 'var(--accent)', textTransform: 'capitalize' }}>{me.role}</span>
                  </div>
                </div>
              </>
            )}
            <ThemeToggle />
          </div>
        </div>

        <div style={{ height: 1, background: 'var(--border)', marginTop: 20 }} />
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--txt2)', fontSize: '0.9rem' }}>
          Loading users…
        </div>
      )}

      {error && (
        <div style={{
          padding: '14px 18px', background: 'rgba(248,113,113,0.08)',
          border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8,
          fontSize: '0.85rem', color: 'var(--err)',
        }}>
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Summary row */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 32, flexWrap: 'wrap' }}>
            {[
              { label: 'Total users',         value: users.length },
              { label: 'Organizations',        value: Object.keys(orgs).length },
              { label: 'Admins',               value: users.filter(u => u.role === 'admin' || u.role === 'superadmin').length },
            ].map(({ label, value }) => (
              <div key={label} style={{
                flex: '1 1 140px',
                background: 'var(--surf)', border: '1px solid var(--border)',
                borderRadius: 'var(--r)', padding: '18px 20px',
              }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--txt3)', marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--txt)', lineHeight: 1 }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Per-org tables */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {Object.entries(orgs).map(([orgName, members]) => (
              <div key={orgName} style={{
                background: 'var(--surf)', border: '1px solid var(--border)',
                borderRadius: 'var(--r)', overflow: 'hidden',
              }}>
                {/* Org header */}
                <div style={{
                  padding: '13px 20px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--txt)' }}>
                    {orgName}
                  </span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--txt3)', fontWeight: 500 }}>
                    {members.length} {members.length === 1 ? 'user' : 'users'}
                  </span>
                </div>

                {/* User rows */}
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['ID', 'Email', 'Role'].map(h => (
                        <th key={h} style={{
                          padding: '9px 20px', textAlign: 'left',
                          fontSize: '0.68rem', fontWeight: 600,
                          color: 'var(--txt3)', letterSpacing: '0.04em',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((u, i) => (
                      <tr
                        key={u.id}
                        style={{
                          borderBottom: i < members.length - 1 ? '1px solid var(--border)' : 'none',
                        }}
                      >
                        <td style={{ padding: '11px 20px', fontSize: '0.75rem', color: 'var(--txt3)', fontFamily: "'DM Mono', monospace" }}>
                          {u.id}
                        </td>
                        <td style={{ padding: '11px 20px', fontSize: '0.82rem', color: 'var(--txt)' }}>
                          {u.email}
                        </td>
                        <td style={{ padding: '11px 20px' }}>
                          <span style={{
                            fontSize: '0.68rem', fontWeight: 700,
                            color: ROLE_COLOR[u.role] ?? 'var(--txt2)',
                            background: 'rgba(255,255,255,0.04)',
                            border: `1px solid ${ROLE_COLOR[u.role] ?? 'var(--border)'}33`,
                            borderRadius: 4, padding: '2px 8px',
                            textTransform: 'uppercase', letterSpacing: '0.06em',
                          }}>
                            {u.role}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Footer: sign out */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 40, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--txt3)' }}>UEI Cloud · Unified Energy Interface</span>
        <button
          onClick={handleLogout}
          style={{
            fontFamily: 'var(--ff-sans)', fontSize: '0.72rem', fontWeight: 600,
            background: 'transparent', border: '1px solid var(--border)',
            borderRadius: 6, color: 'var(--txt3)', padding: '5px 14px',
            cursor: 'pointer', transition: 'all 0.15s',
          }}
          onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.color='var(--err)'; b.style.borderColor='rgba(248,113,113,0.3)'; }}
          onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.color='var(--txt3)'; b.style.borderColor='var(--border)'; }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
