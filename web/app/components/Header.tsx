'use client';

import ThemeToggle from './ThemeToggle';
import AlertBell from './AlertBell';

interface Crumb {
  label: string;
  href?: string;
}

interface HeaderProps {
  /** Breadcrumb path — last item is current page (no href needed) */
  crumbs: Crumb[];
  /** Standard nav links rendered on the right */
  nav?: Crumb[];
  /** Authenticated user info */
  user?: { email: string; org_name: string; role: string } | null;
  /** Any extra content injected between nav and user (live dot, node selector…) */
  extra?: React.ReactNode;
  /** Called when Sign out is clicked — omit to hide the button */
  onLogout?: () => void;
}

const NAV_STYLE: React.CSSProperties = {
  fontSize: '0.8rem',
  fontWeight: 600,
  color: 'var(--txt2)',
  textDecoration: 'none',
  padding: '5px 13px',
  border: '1px solid var(--border)',
  borderRadius: 20,
  transition: 'color 0.15s, border-color 0.15s',
  whiteSpace: 'nowrap' as const,
};

export default function Header({ crumbs, nav = [], user, extra, onLogout }: HeaderProps) {
  return (
    <div style={{ marginBottom: 32 }}>
      {/* Top accent bar */}
      <div style={{
        height: 3,
        background: 'linear-gradient(90deg, var(--txt2) 0%, rgba(128,128,120,0.08) 60%, transparent 100%)',
        borderRadius: 99,
        marginBottom: 22,
      }} />

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 14,
      }}>

        {/* ── Breadcrumb ── */}
        <nav style={{ display: 'flex', alignItems: 'center', gap: 0 }} aria-label="breadcrumb">
          {crumbs.map((crumb, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
                {/* Separator */}
                {i > 0 && (
                  <span style={{
                    margin: '0 10px',
                    color: 'rgba(128,128,120,0.35)',
                    fontSize: '1.1rem',
                    fontWeight: 300,
                    lineHeight: 1,
                    userSelect: 'none',
                  }}>
                    /
                  </span>
                )}

                {/* Crumb */}
                {!isLast && crumb.href ? (
                  <a
                    href={crumb.href}
                    style={{
                      fontSize: i === 0 ? '1.35rem' : '1rem',
                      fontWeight: i === 0 ? 800 : 600,
                      letterSpacing: i === 0 ? '-0.02em' : '-0.01em',
                      background: i === 0 ? 'var(--title-grad)' : 'none',
                      WebkitBackgroundClip: i === 0 ? 'text' : undefined,
                      WebkitTextFillColor: i === 0 ? 'transparent' : undefined,
                      color: i === 0 ? undefined : 'var(--txt3)',
                      textDecoration: 'none',
                      transition: 'opacity 0.15s',
                      lineHeight: 1,
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '0.7'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '1'; }}
                  >
                    {crumb.label}
                  </a>
                ) : (
                  <span style={{
                    fontSize: i === 0 ? '1.35rem' : '1rem',
                    fontWeight: 800,
                    letterSpacing: i === 0 ? '-0.02em' : '-0.01em',
                    color: 'var(--txt)',
                    lineHeight: 1,
                    background: isLast && i === 0 ? 'var(--title-grad)' : 'none',
                    WebkitBackgroundClip: isLast && i === 0 ? 'text' : undefined,
                    WebkitTextFillColor: isLast && i === 0 ? 'transparent' : undefined,
                  }}>
                    {crumb.label}
                  </span>
                )}
              </div>
            );
          })}
        </nav>

        {/* ── Right side ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>

          {/* Extra slot (live dot, node selector, etc.) */}
          {extra}

          {/* Nav links */}
          {nav.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {nav.map(n => (
                <a
                  key={n.label}
                  href={n.href}
                  style={NAV_STYLE}
                  onMouseEnter={e => {
                    const a = e.currentTarget as HTMLAnchorElement;
                    a.style.color = 'var(--txt)';
                    a.style.borderColor = 'var(--border-hi)';
                  }}
                  onMouseLeave={e => {
                    const a = e.currentTarget as HTMLAnchorElement;
                    a.style.color = 'var(--txt2)';
                    a.style.borderColor = 'var(--border)';
                  }}
                >
                  {n.label}
                </a>
              ))}
            </div>
          )}

          {/* Divider */}
          {(nav.length > 0 || extra) && user && (
            <div style={{ width: 1, height: 22, background: 'var(--border)', flexShrink: 0 }} />
          )}

          {/* User info */}
          {user && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--txt)', lineHeight: 1.2 }}>
                  {user.email}
                </div>
                <div style={{ fontSize: '0.66rem', color: 'var(--txt3)', marginTop: 2 }}>
                  {user.org_name}
                  {' · '}
                  <span style={{ color: 'var(--accent)', textTransform: 'capitalize' }}>{user.role}</span>
                </div>
              </div>
              {onLogout && (
                <button
                  onClick={onLogout}
                  style={{
                    fontFamily: 'var(--ff-sans)', fontSize: '0.7rem', fontWeight: 600,
                    background: 'transparent', border: '1px solid var(--border)',
                    borderRadius: 6, color: 'var(--txt3)', padding: '4px 12px',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    const b = e.currentTarget as HTMLButtonElement;
                    b.style.color = 'var(--err)';
                    b.style.borderColor = 'rgba(248,113,113,0.3)';
                  }}
                  onMouseLeave={e => {
                    const b = e.currentTarget as HTMLButtonElement;
                    b.style.color = 'var(--txt3)';
                    b.style.borderColor = 'var(--border)';
                  }}
                >
                  Sign out
                </button>
              )}
            </div>
          )}

          <AlertBell />
          <ThemeToggle />
        </div>
      </div>

      {/* Bottom divider */}
      <div style={{ height: 1, background: 'var(--border)', marginTop: 18 }} />
    </div>
  );
}
