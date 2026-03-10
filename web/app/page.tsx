import Link from 'next/link';

// ── Feature data ───────────────────────────────────────────────

const features = [
  {
    title: 'Live Telemetry',
    desc:  'SOC, pack voltage, current, and cell temperatures refreshed every 5 seconds across every registered BMS node.',
    icon: (
      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
      </svg>
    ),
  },
  {
    title: 'Fault Detection',
    desc:  'Instant fault banners and color-coded status when a BMS reports an active condition. No polling required.',
    icon: (
      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    ),
  },
  {
    title: 'Historical Trends',
    desc:  'Visualize SOC, pack voltage, and temperature over 1h, 6h, or 24h windows. Powered by Grafana and PostgreSQL.',
    icon: (
      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
  },
  {
    title: 'AI Data Assistant',
    desc:  'Ask plain-English questions about your battery data. The assistant queries the database and explains trends, faults, and anomalies.',
    icon: (
      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
      </svg>
    ),
  },
  {
    title: 'Multi-Tenant Access',
    desc:  'Organizations, admin roles, and node assignment. Each team sees only their own hardware — fully isolated.',
    icon: (
      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87"/>
        <path d="M16 3.13a4 4 0 010 7.75"/>
      </svg>
    ),
  },
  {
    title: 'Cloud Native',
    desc:  'FastAPI backend, PostgreSQL, Grafana, Docker Compose, and a Next.js frontend deployed on Vercel.',
    icon: (
      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <rect x="2" y="3" width="20" height="14" rx="2"/>
        <path d="M8 21h8M12 17v4"/>
      </svg>
    ),
  },
];

// ── Page ───────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--txt)', fontFamily: 'var(--ff-sans)', overflowX: 'hidden' }}>

      {/* ── Background glow ── */}
      <div aria-hidden style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        background: `
          radial-gradient(ellipse 80% 50% at 20% -10%, rgba(224,154,32,0.08) 0%, transparent 60%),
          radial-gradient(ellipse 60% 40% at 80% 110%, rgba(167,139,250,0.05) 0%, transparent 55%)
        `,
      }} />

      {/* ── Navbar ── */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 32px', height: 60,
        background: 'rgba(17,17,17,0.85)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />
          <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--txt)', letterSpacing: '-0.01em' }}>
            UEI Cloud
          </span>
        </div>
        <Link href="/login" style={{
          fontFamily: 'var(--ff-sans)', fontSize: '0.82rem', fontWeight: 600,
          color: 'var(--txt2)', textDecoration: 'none', padding: '6px 14px',
          border: '1px solid var(--border)', borderRadius: 8,
          transition: 'all 0.15s',
        }}>
          Sign in →
        </Link>
      </nav>

      {/* ── Hero ── */}
      <section style={{ position: 'relative', zIndex: 1, maxWidth: 780, margin: '0 auto', padding: '96px 32px 80px', textAlign: 'center' }}>

        <div className="anim-fade-up" style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          background: 'rgba(224,154,32,0.1)', border: '1px solid rgba(224,154,32,0.2)',
          borderRadius: 99, padding: '4px 14px', marginBottom: 32,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
          <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--accent)', letterSpacing: '0.04em' }}>
            Battery Management Platform
          </span>
        </div>

        <h1 className="anim-fade-up anim-delay-1" style={{
          fontSize: 'clamp(2.4rem, 6vw, 3.6rem)',
          fontWeight: 800,
          lineHeight: 1.1,
          letterSpacing: '-0.03em',
          margin: '0 0 24px',
          color: 'var(--txt)',
        }}>
          Monitor your batteries.{' '}
          <span style={{ color: 'var(--accent)' }}>Stay ahead of faults.</span>
        </h1>

        <p className="anim-fade-up anim-delay-2" style={{
          fontSize: '1.05rem', lineHeight: 1.7,
          color: 'var(--txt2)', margin: '0 auto 40px',
          maxWidth: 580,
        }}>
          UEI Cloud gives your engineering team real-time visibility into BMS telemetry —
          live state of charge, voltage, temperature trending, fault detection, and
          AI-powered data analysis, all in one place.
        </p>

        <div className="anim-fade-up anim-delay-3" style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/login" style={{
            display: 'inline-block',
            padding: '12px 28px',
            background: 'var(--accent)',
            color: '#111',
            borderRadius: 10,
            fontFamily: 'var(--ff-sans)',
            fontSize: '0.92rem',
            fontWeight: 700,
            textDecoration: 'none',
            letterSpacing: '-0.01em',
            boxShadow: '0 4px 24px rgba(224,154,32,0.3)',
            transition: 'all 0.15s',
          }}>
            Get started free
          </Link>
          <Link href="/login" style={{
            display: 'inline-block',
            padding: '12px 28px',
            background: 'transparent',
            color: 'var(--txt)',
            borderRadius: 10,
            border: '1px solid var(--border)',
            fontFamily: 'var(--ff-sans)',
            fontSize: '0.92rem',
            fontWeight: 600,
            textDecoration: 'none',
            transition: 'all 0.15s',
          }}>
            Sign in
          </Link>
        </div>
      </section>

      {/* ── Divider ── */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 32px' }}>
        <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, var(--border), transparent)' }} />
      </div>

      {/* ── Stats strip ── */}
      <section className="anim-fade-in anim-delay-4" style={{
        position: 'relative', zIndex: 1,
        maxWidth: 900, margin: '0 auto',
        padding: '40px 32px',
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 0,
      }}>
        {[
          { value: '5s',    label: 'Telemetry refresh rate' },
          { value: 'n-org', label: 'Multi-tenant organizations' },
          { value: 'Claude', label: 'AI-powered data assistant' },
        ].map(({ value, label }, i) => (
          <div key={i} style={{
            textAlign: 'center',
            padding: '20px 16px',
            borderRight: i < 2 ? '1px solid var(--border)' : 'none',
          }}>
            <div style={{ fontFamily: 'var(--ff-mono)', fontSize: '1.5rem', fontWeight: 500, color: 'var(--txt)', marginBottom: 4 }}>
              {value}
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--txt3)' }}>
              {label}
            </div>
          </div>
        ))}
      </section>

      {/* ── Divider ── */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 32px' }}>
        <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, var(--border), transparent)' }} />
      </div>

      {/* ── Features ── */}
      <section style={{ position: 'relative', zIndex: 1, maxWidth: 960, margin: '0 auto', padding: '72px 32px' }}>
        <p style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--txt2)', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          What's included
        </p>
        <h2 style={{ fontSize: 'clamp(1.5rem, 3vw, 2rem)', fontWeight: 700, color: 'var(--txt)', margin: '0 0 48px', letterSpacing: '-0.02em' }}>
          Everything you need to monitor your fleet
        </h2>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 16,
        }}>
          {features.map(({ title, desc, icon }) => (
            <div key={title} style={{
              background: 'var(--surf)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '24px 22px',
              transition: 'border-color 0.2s, box-shadow 0.2s',
            }}>
              <div style={{
                width: 40, height: 40,
                background: 'rgba(224,154,32,0.1)',
                border: '1px solid rgba(224,154,32,0.18)',
                borderRadius: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--accent)',
                marginBottom: 16,
              }}>
                {icon}
              </div>
              <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--txt)', margin: '0 0 8px', letterSpacing: '-0.01em' }}>
                {title}
              </h3>
              <p style={{ fontSize: '0.8rem', lineHeight: 1.65, color: 'var(--txt2)', margin: 0 }}>
                {desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA Banner ── */}
      <section style={{ position: 'relative', zIndex: 1, maxWidth: 960, margin: '0 auto 80px', padding: '0 32px' }}>
        <div style={{
          background: 'var(--surf)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: '48px 40px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 24,
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Subtle glow inside card */}
          <div aria-hidden style={{
            position: 'absolute', top: -60, right: -60,
            width: 240, height: 240,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(224,154,32,0.08) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />

          <div style={{ position: 'relative' }}>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--txt)', margin: '0 0 8px', letterSpacing: '-0.02em' }}>
              Ready to connect your BMS?
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--txt2)', margin: 0, lineHeight: 1.6 }}>
              Register your organization, add your nodes, and start monitoring in minutes.
            </p>
          </div>

          <Link href="/login" style={{
            display: 'inline-block', flexShrink: 0,
            padding: '11px 26px',
            background: 'var(--accent)',
            color: '#111',
            borderRadius: 10,
            fontFamily: 'var(--ff-sans)',
            fontSize: '0.88rem', fontWeight: 700,
            textDecoration: 'none',
            boxShadow: '0 4px 20px rgba(224,154,32,0.25)',
            position: 'relative',
          }}>
            Get started free
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{
        position: 'relative', zIndex: 1,
        borderTop: '1px solid var(--border)',
        padding: '28px 32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
        maxWidth: '100%',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', opacity: 0.7 }} />
          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--txt3)' }}>UEI Cloud</span>
        </div>
        <p style={{ fontSize: '0.72rem', color: 'var(--txt3)', margin: 0 }}>
          Capstone Project · Unified Energy Interface · Battery Management System Monitor
        </p>
        <Link href="/login" style={{ fontSize: '0.78rem', color: 'var(--txt2)', textDecoration: 'none', fontWeight: 500 }}>
          Sign in →
        </Link>
      </footer>

    </div>
  );
}
