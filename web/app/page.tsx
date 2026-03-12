import Link from 'next/link';

// ── Energy source data ─────────────────────────────────────────

const sources = [
  {
    label: 'Solar PV',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4"/>
        <line x1="12" y1="2" x2="12" y2="4"/>
        <line x1="12" y1="20" x2="12" y2="22"/>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
        <line x1="2" y1="12" x2="4" y2="12"/>
        <line x1="20" y1="12" x2="22" y2="12"/>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
      </svg>
    ),
  },
  {
    label: 'Wind',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/>
      </svg>
    ),
  },
  {
    label: 'Battery Storage',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <rect x="2" y="7" width="18" height="11" rx="2"/>
        <path d="M20 11h2v3h-2"/>
        <line x1="7" y1="11" x2="7" y2="14"/>
        <line x1="12" y1="11" x2="12" y2="14"/>
      </svg>
    ),
  },
  {
    label: 'Grid',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
      </svg>
    ),
  },
  {
    label: 'EV Charging',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <rect x="3" y="11" width="13" height="10" rx="2"/>
        <path d="M5 11V7a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v4"/>
        <line x1="9" y1="7" x2="9" y2="4"/>
        <line x1="13" y1="7" x2="13" y2="4"/>
        <path d="M16 13h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2"/>
      </svg>
    ),
  },
  {
    label: 'Generator',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3"/>
        <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
      </svg>
    ),
  },
];

// ── Feature data ───────────────────────────────────────────────

const features = [
  {
    title: 'Multi-Source Telemetry',
    desc: 'Solar, wind, grid, battery, EV chargers — every node streams live data in a single unified view, refreshed every 5 seconds.',
    icon: (
      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
  },
  {
    title: 'Fault & Anomaly Detection',
    desc: 'Instant alerts across any asset type. Color-coded banners surface faults the moment a node reports an abnormal condition.',
    icon: (
      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    ),
  },
  {
    title: 'Generation vs. Consumption',
    desc: 'Compare output, storage state, and grid draw side-by-side over 1h, 6h, or 24h windows. Spot imbalances before they compound.',
    icon: (
      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <line x1="18" y1="20" x2="18" y2="10"/>
        <line x1="12" y1="20" x2="12" y2="4"/>
        <line x1="6" y1="20" x2="6" y2="14"/>
      </svg>
    ),
  },
  {
    title: 'AI Energy Assistant',
    desc: 'Ask plain-English questions across your entire energy dataset. The assistant queries the database and explains trends, anomalies, and efficiency gaps.',
    icon: (
      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
      </svg>
    ),
  },
  {
    title: 'Multi-Tenant Access',
    desc: 'Organizations, admin roles, and per-node assignment. Each team sees only their own infrastructure — fully isolated, fully auditable.',
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
    title: 'Cloud Native Stack',
    desc: 'FastAPI backend, PostgreSQL time-series storage, Grafana dashboards, Docker Compose, and a Next.js frontend on Vercel.',
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

      {/* ── Background glows ── */}
      <div aria-hidden style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        background: `
          radial-gradient(ellipse 70% 50% at 15% -5%, rgba(224,154,32,0.10) 0%, transparent 60%),
          radial-gradient(ellipse 50% 40% at 85% 100%, rgba(167,139,250,0.06) 0%, transparent 55%),
          radial-gradient(ellipse 40% 30% at 55% 50%, rgba(74,222,128,0.03) 0%, transparent 60%)
        `,
      }} />

      {/* ── Navbar ── */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 5vw', height: 60,
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
      <section style={{
        position: 'relative', zIndex: 1,
        width: '100%',
        padding: '100px 5vw 80px',
        textAlign: 'center',
      }}>

        <div className="anim-fade-up" style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          background: 'rgba(224,154,32,0.1)', border: '1px solid rgba(224,154,32,0.2)',
          borderRadius: 99, padding: '4px 14px', marginBottom: 32,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
          <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--accent)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Unified Energy Interface
          </span>
        </div>

        <h1 className="anim-fade-up anim-delay-1" style={{
          fontSize: 'clamp(2.6rem, 7vw, 4.2rem)',
          fontWeight: 800,
          lineHeight: 1.08,
          letterSpacing: '-0.035em',
          margin: '0 auto 28px',
          maxWidth: 820,
          color: 'var(--txt)',
        }}>
          One interface for{' '}
          <span style={{ color: 'var(--accent)' }}>every energy source.</span>
        </h1>

        <p className="anim-fade-up anim-delay-2" style={{
          fontSize: '1.1rem', lineHeight: 1.7,
          color: 'var(--txt2)', margin: '0 auto 44px',
          maxWidth: 640,
        }}>
          UEI Cloud gives your team real-time visibility across solar, wind, battery storage,
          grid, EV charging, and backup generation — live telemetry, fault detection,
          and AI-powered analysis in a single platform.
        </p>

        <div className="anim-fade-up anim-delay-3" style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/login" style={{
            display: 'inline-block',
            padding: '13px 32px',
            background: 'var(--accent)',
            color: '#111',
            borderRadius: 10,
            fontFamily: 'var(--ff-sans)',
            fontSize: '0.95rem',
            fontWeight: 700,
            textDecoration: 'none',
            letterSpacing: '-0.01em',
            boxShadow: '0 4px 28px rgba(224,154,32,0.35)',
            transition: 'all 0.15s',
          }}>
            Get started free
          </Link>
          <Link href="/login" style={{
            display: 'inline-block',
            padding: '13px 32px',
            background: 'transparent',
            color: 'var(--txt)',
            borderRadius: 10,
            border: '1px solid var(--border)',
            fontFamily: 'var(--ff-sans)',
            fontSize: '0.95rem',
            fontWeight: 600,
            textDecoration: 'none',
            transition: 'all 0.15s',
          }}>
            Sign in
          </Link>
        </div>
      </section>

      {/* ── Energy sources strip ── */}
      <section className="anim-fade-in anim-delay-4" style={{
        position: 'relative', zIndex: 1,
        width: '100%',
        borderTop: '1px solid var(--border)',
        borderBottom: '1px solid var(--border)',
        background: 'rgba(255,255,255,0.015)',
        padding: '28px 5vw',
      }}>
        <p style={{ textAlign: 'center', fontSize: '0.68rem', fontWeight: 600, color: 'var(--txt3)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 20 }}>
          Energy sources supported
        </p>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: 12,
        }}>
          {sources.map(({ label, icon }) => (
            <div key={label} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 18px',
              background: 'var(--surf)',
              border: '1px solid var(--border)',
              borderRadius: 99,
              color: 'var(--txt2)',
            }}>
              <span style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center' }}>{icon}</span>
              <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Stats strip ── */}
      <section style={{
        position: 'relative', zIndex: 1,
        width: '100%',
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        borderBottom: '1px solid var(--border)',
      }}>
        {[
          { value: '5s',     label: 'Telemetry refresh' },
          { value: '6+',     label: 'Energy source types' },
          { value: 'n-org',  label: 'Multi-tenant orgs' },
          { value: 'Claude', label: 'AI-powered assistant' },
        ].map(({ value, label }, i) => (
          <div key={i} style={{
            textAlign: 'center',
            padding: '32px 20px',
            borderRight: i < 3 ? '1px solid var(--border)' : 'none',
          }}>
            <div style={{ fontFamily: 'var(--ff-mono)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--txt)', marginBottom: 6 }}>
              {value}
            </div>
            <div style={{ fontSize: '0.72rem', fontWeight: 500, color: 'var(--txt3)', letterSpacing: '0.02em' }}>
              {label}
            </div>
          </div>
        ))}
      </section>

      {/* ── Features ── */}
      <section style={{ position: 'relative', zIndex: 1, width: '100%', padding: '80px 5vw' }}>
        <p style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--txt2)', marginBottom: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Platform capabilities
        </p>
        <h2 style={{ fontSize: 'clamp(1.6rem, 3.5vw, 2.2rem)', fontWeight: 700, color: 'var(--txt)', margin: '0 0 52px', letterSpacing: '-0.025em', maxWidth: 600 }}>
          Everything you need to manage your energy infrastructure
        </h2>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 16,
        }}>
          {features.map(({ title, desc, icon }) => (
            <div key={title} style={{
              background: 'var(--surf)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              padding: '28px 24px',
              transition: 'border-color 0.2s, box-shadow 0.2s',
            }}>
              <div style={{
                width: 42, height: 42,
                background: 'rgba(224,154,32,0.1)',
                border: '1px solid rgba(224,154,32,0.18)',
                borderRadius: 11,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--accent)',
                marginBottom: 18,
              }}>
                {icon}
              </div>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--txt)', margin: '0 0 10px', letterSpacing: '-0.01em' }}>
                {title}
              </h3>
              <p style={{ fontSize: '0.82rem', lineHeight: 1.7, color: 'var(--txt2)', margin: 0 }}>
                {desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Full-width CTA banner ── */}
      <section style={{
        position: 'relative', zIndex: 1,
        width: '100%',
        borderTop: '1px solid var(--border)',
        background: 'var(--surf)',
        overflow: 'hidden',
      }}>
        {/* Wide glow behind CTA */}
        <div aria-hidden style={{
          position: 'absolute', top: -120, left: '50%', transform: 'translateX(-50%)',
          width: '60%', height: 300,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(224,154,32,0.07) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        <div style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 28,
          padding: '60px 5vw',
        }}>
          <div>
            <h2 style={{ fontSize: 'clamp(1.4rem, 3vw, 2rem)', fontWeight: 700, color: 'var(--txt)', margin: '0 0 10px', letterSpacing: '-0.025em' }}>
              Ready to connect your energy infrastructure?
            </h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--txt2)', margin: 0, lineHeight: 1.6, maxWidth: 520 }}>
              Register your organization, add your nodes across any energy type, and start monitoring in minutes.
            </p>
          </div>

          <Link href="/login" style={{
            display: 'inline-block', flexShrink: 0,
            padding: '13px 30px',
            background: 'var(--accent)',
            color: '#111',
            borderRadius: 10,
            fontFamily: 'var(--ff-sans)',
            fontSize: '0.92rem', fontWeight: 700,
            textDecoration: 'none',
            boxShadow: '0 4px 24px rgba(224,154,32,0.3)',
          }}>
            Get started free
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{
        position: 'relative', zIndex: 1,
        borderTop: '1px solid var(--border)',
        padding: '28px 5vw',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', opacity: 0.7 }} />
          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--txt3)' }}>UEI Cloud</span>
        </div>
        <p style={{ fontSize: '0.72rem', color: 'var(--txt3)', margin: 0 }}>
          Capstone Project · Unified Energy Interface · Multi-Source Energy Management
        </p>
        <Link href="/login" style={{ fontSize: '0.78rem', color: 'var(--txt2)', textDecoration: 'none', fontWeight: 500 }}>
          Sign in →
        </Link>
      </footer>

    </div>
  );
}
