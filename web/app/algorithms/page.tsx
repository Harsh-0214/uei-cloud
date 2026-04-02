'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import ThemeToggle from '../components/ThemeToggle';

interface CacOutput {
  action: string;
  adjusted_current_limit: number;
  thermal_directive: string;
  profile_source: string;
  timestamp: string;
}

interface RdaOutput {
  risk_score: number;
  derating_level: string;
  derating_factor: number;
  alert_flag: boolean;
  subscores: Record<string, number>;
  timestamp: string;
}

interface SohForecast {
  current_soh: number;
  forecast_30d: number;
  forecast_60d: number;
  forecast_90d: number;
  computed_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ageLabel(ts: string | null): string {
  if (!ts) return '—';
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 5000)   return 'just now';
  if (ms < 60000)  return `${Math.floor(ms / 1000)}s ago`;
  return `${Math.floor(ms / 60000)}m ago`;
}

// ── Gauge (SVG semicircle) ────────────────────────────────────────────────────

function RiskGauge({ score, level }: { score: number; level: string }) {
  const color = level === 'CRITICAL' ? '#f87171' : level === 'WARNING' ? '#fb923c' : '#4ade80';
  const pct   = Math.min(100, Math.max(0, score)) / 100;
  // Semicircle: cx=100, cy=100, r=80, start=-180deg, sweep=180deg
  const r = 80;
  const cx = 100, cy = 100;
  const startX = cx - r, startY = cy;
  const endX   = cx + pct * 2 * r - r;
  const angle  = pct * Math.PI;
  const endY   = cy - Math.sin(angle) * r;
  const largeArc = pct > 0.5 ? 1 : 0;

  // Track arc (full semicircle)
  const trackD = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  // Value arc
  const valueD = pct === 0
    ? ''
    : pct >= 1
      ? `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`
      : `M ${startX} ${startY} A ${r} ${r} 0 ${largeArc} 1 ${endX} ${endY}`;

  return (
    <svg viewBox="0 0 200 110" style={{ width: '100%', maxWidth: 260, display: 'block', margin: '0 auto' }}>
      {/* Track */}
      <path d={trackD} fill="none" stroke="rgba(128,128,128,0.15)" strokeWidth="16" strokeLinecap="round" />
      {/* Value */}
      {valueD && (
        <path d={valueD} fill="none" stroke={color} strokeWidth="16" strokeLinecap="round"
          style={{ transition: 'all 0.6s ease' }} />
      )}
      {/* Score text */}
      <text x="100" y="88" textAnchor="middle" fill={color}
        style={{ fontFamily: "'DM Mono', monospace", fontSize: 34, fontWeight: 800, transition: 'fill 0.4s' }}>
        {Math.round(score)}
      </text>
      <text x="100" y="105" textAnchor="middle" fill="rgba(128,128,120,0.6)"
        style={{ fontFamily: 'sans-serif', fontSize: 10 }}>
        / 100
      </text>
    </svg>
  );
}

// ── SOH Arc ───────────────────────────────────────────────────────────────────

function SohArc({ soh }: { soh: number }) {
  const color = soh >= 80 ? '#4ade80' : soh >= 60 ? '#fb923c' : '#f87171';
  const pct   = Math.min(100, Math.max(0, soh)) / 100;
  const r = 70, cx = 90, cy = 90;
  const trackD = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const angle  = pct * Math.PI;
  const valueD = pct <= 0 ? '' : pct >= 1
    ? `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`
    : `M ${cx - r} ${cy} A ${r} ${r} 0 ${pct > 0.5 ? 1 : 0} 1 ${cx - r + Math.cos(Math.PI - angle) * r + r * (1 - Math.cos(0))} ${cy - Math.sin(angle) * r}`;

  // Simpler approach: use stroke-dasharray
  const circumHalf = Math.PI * r;
  const dash = pct * circumHalf;

  return (
    <svg viewBox="0 0 180 100" style={{ width: '100%', maxWidth: 220, display: 'block', margin: '0 auto' }}>
      <path d={trackD} fill="none" stroke="rgba(128,128,128,0.15)" strokeWidth="14" strokeLinecap="round" />
      <path d={trackD} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round"
        strokeDasharray={`${dash} ${circumHalf}`}
        style={{ transition: 'stroke-dasharray 0.6s ease, stroke 0.4s' }} />
      <text x="90" y="78" textAnchor="middle" fill={color}
        style={{ fontFamily: "'DM Mono', monospace", fontSize: 28, fontWeight: 800, transition: 'fill 0.4s' }}>
        {soh.toFixed(1)}%
      </text>
      <text x="90" y="94" textAnchor="middle" fill="rgba(128,128,120,0.6)"
        style={{ fontFamily: 'sans-serif', fontSize: 9 }}>
        State of Health
      </text>
    </svg>
  );
}

// ── Animated bar ──────────────────────────────────────────────────────────────

function AnimBar({ label, value, max = 100, color = 'var(--accent)' }: {
  label: string; value: number; max?: number; color?: string;
}) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: '0.68rem', color: 'var(--txt2)', fontWeight: 600 }}>{label}</span>
        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '0.72rem', color, fontWeight: 700 }}>
          {value.toFixed(1)}
        </span>
      </div>
      <div style={{ height: 6, background: 'var(--surf2)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 99, background: color,
          width: `${pct}%`, transition: 'width 0.5s ease',
        }} />
      </div>
    </div>
  );
}

// ── Card wrapper ──────────────────────────────────────────────────────────────

function Card({ children, alert }: { children: React.ReactNode; alert?: boolean }) {
  return (
    <div style={{
      background: 'var(--surf)',
      border: `1px solid ${alert ? 'rgba(248,113,113,0.35)' : 'var(--border)'}`,
      borderRadius: 'var(--r)',
      padding: '22px 24px',
      transition: 'border-color 0.3s',
    }}>
      {children}
    </div>
  );
}

function CardLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>
      {children}
    </div>
  );
}

// ── CAC action colors ─────────────────────────────────────────────────────────

const ACTION_COLOR: Record<string, string> = {
  NORMAL:               '#4ade80',
  PRIORITIZE_DISCHARGE: '#38bdf8',
  CAP_OUTPUT:           '#fb923c',
  TEMP_WARN_DERATE:     '#fb923c',
  OVERTEMP_DERATE:      '#f87171',
  FAULT_DERATE:         '#f87171',
};

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AlgorithmsPage() {
  const [nodes,    setNodes]    = useState<string[]>([]);
  const [nodeId,   setNodeId]   = useState('');
  const [cac,      setCac]      = useState<CacOutput | null>(null);
  const [rda,      setRda]      = useState<RdaOutput | null>(null);
  const [forecast, setForecast] = useState<SohForecast | null>(null);
  const [lastTs,   setLastTs]   = useState<string | null>(null);
  const [pulse,    setPulse]    = useState(false);
  const nodeIdRef = useRef('');

  // Load node list
  useEffect(() => {
    fetch('/api/telemetry/nodes', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : [])
      .then((data: string[]) => {
        if (Array.isArray(data) && data.length) {
          setNodes(data);
          setNodeId(data[0]);
          nodeIdRef.current = data[0];
        }
      })
      .catch(() => {});
  }, []);

  const fetchAlgo = useCallback(async () => {
    const id = nodeIdRef.current;
    if (!id) return;
    try {
      const [cacR, rdaR, fcastR] = await Promise.allSettled([
        fetch(`/api/algo/latest?node_id=${encodeURIComponent(id)}&algo=CAC`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
        fetch(`/api/algo/latest?node_id=${encodeURIComponent(id)}&algo=RDA`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
        fetch(`/api/forecast?node_id=${encodeURIComponent(id)}`,             { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
      ]);

      let updated = false;
      if (cacR.status === 'fulfilled' && Array.isArray(cacR.value) && cacR.value[0]) {
        setCac(cacR.value[0].output as CacOutput);
        updated = true;
      }
      if (rdaR.status === 'fulfilled' && Array.isArray(rdaR.value) && rdaR.value[0]) {
        setRda(rdaR.value[0].output as RdaOutput);
        updated = true;
      }
      if (fcastR.status === 'fulfilled' && fcastR.value && !fcastR.value.error && fcastR.value.current_soh != null) {
        setForecast(fcastR.value as SohForecast);
      }

      if (updated) {
        setLastTs(new Date().toISOString());
        setPulse(true);
        setTimeout(() => setPulse(false), 600);
      }
    } catch { /* ignore */ }
  }, []);

  // Poll every 2 s
  useEffect(() => {
    if (!nodeId) return;
    nodeIdRef.current = nodeId;
    setCac(null); setRda(null); setForecast(null);
    fetchAlgo();
    const t = setInterval(fetchAlgo, 2000);
    return () => clearInterval(t);
  }, [nodeId, fetchAlgo]);

  const rdaColor = rda
    ? (rda.derating_level === 'CRITICAL' ? '#f87171' : rda.derating_level === 'WARNING' ? '#fb923c' : '#4ade80')
    : 'var(--txt3)';
  const cacColor = cac ? (ACTION_COLOR[cac.action] ?? 'var(--txt2)') : 'var(--txt3)';

  return (
    <div style={{ width: '100%', padding: '32px 5vw', minHeight: '100vh' }}>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ height: 3, background: 'linear-gradient(90deg, var(--txt2) 0%, rgba(128,128,120,0.1) 60%, transparent 100%)', borderRadius: 99, marginBottom: 24 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <a href="/overview" style={{ fontSize: '1.85rem', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1, background: 'var(--title-grad)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', textDecoration: 'none' }}>
                UEI Cloud
              </a>
              <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--txt)', background: 'var(--surf2)', border: '1px solid var(--border-hi)', padding: '3px 8px', borderRadius: 4 }}>
                Algorithms
              </span>
              {/* Live pulse */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 8 }}>
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: pulse ? '#4ade80' : lastTs ? '#4ade80' : 'var(--txt3)',
                  boxShadow: pulse ? '0 0 10px #4ade80' : lastTs ? '0 0 6px #4ade80' : 'none',
                  transition: 'box-shadow 0.3s',
                }} />
                <span style={{ fontSize: '0.65rem', color: 'var(--txt3)' }}>
                  {lastTs ? `updated ${ageLabel(lastTs)}` : 'waiting…'}
                </span>
              </div>
            </div>
            <p style={{ fontSize: '0.72rem', fontWeight: 500, color: 'var(--txt3)', margin: 0 }}>
              Real-time CAC · RDA · RHF outputs
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            {/* Node selector */}
            <select
              value={nodeId}
              onChange={e => setNodeId(e.target.value)}
              style={{
                fontFamily: 'var(--ff-mono)', fontSize: '0.82rem', fontWeight: 600,
                background: 'var(--surf2)', border: '1px solid var(--border)',
                borderRadius: 8, color: 'var(--txt)', padding: '6px 12px', cursor: 'pointer',
              }}
            >
              {nodes.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            {[
              { label: '← Overview', href: '/overview' },
              { label: 'Dashboard',  href: `/dashboard?node=${encodeURIComponent(nodeId)}` },
              { label: 'Logs',       href: '/logs' },
            ].map(({ label, href }) => (
              <a key={href} href={href} style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--txt2)', textDecoration: 'none' }}
                onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--txt)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--txt2)'; }}>
                {label}
              </a>
            ))}
            <ThemeToggle />
          </div>
        </div>
        <div style={{ height: 1, background: 'var(--border)', marginTop: 20 }} />
      </div>

      {nodes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--txt3)', fontSize: '0.9rem' }}>
          No nodes found. Start the simulator or connect a Pi.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>

          {/* ── CAC ── */}
          <Card>
            <CardLabel>CAC · Context-Aware Adaptive Control</CardLabel>
            {cac ? (
              <>
                {/* Action badge */}
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
                  <span style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: '1.05rem', fontWeight: 800, letterSpacing: '0.06em',
                    padding: '10px 22px', borderRadius: 10,
                    background: cacColor + '18', color: cacColor,
                    border: `1.5px solid ${cacColor}44`,
                    transition: 'all 0.4s',
                  }}>
                    {cac.action.replace(/_/g, ' ')}
                  </span>
                </div>

                {/* Adjusted current limit bar */}
                <AnimBar
                  label="Adjusted Current Limit"
                  value={cac.adjusted_current_limit}
                  max={200}
                  color={cacColor}
                />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
                  <div style={{ background: 'var(--surf2)', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: '0.6rem', color: 'var(--txt3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Thermal</div>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '0.75rem', fontWeight: 700, color: cac.thermal_directive === 'NONE' ? 'var(--txt3)' : cac.thermal_directive === 'FAULT_ACTIVE' ? '#f87171' : '#fb923c' }}>
                      {cac.thermal_directive.replace(/_/g, ' ')}
                    </div>
                  </div>
                  <div style={{ background: 'var(--surf2)', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: '0.6rem', color: 'var(--txt3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Profile</div>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '0.75rem', fontWeight: 700, color: 'var(--txt2)' }}>
                      {cac.profile_source}
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 14, fontSize: '0.62rem', color: 'var(--txt3)', textAlign: 'right', fontFamily: "'DM Mono', monospace" }}>
                  {ageLabel(cac.timestamp)}
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--txt3)', fontSize: '0.82rem' }}>
                No CAC data yet
              </div>
            )}
          </Card>

          {/* ── RDA ── */}
          <Card alert={rda?.alert_flag}>
            <CardLabel>RDA · Risk-Indexed Derating Algorithm</CardLabel>
            {rda ? (
              <>
                {/* Gauge */}
                <RiskGauge score={rda.risk_score} level={rda.derating_level} />

                {/* Level badge */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: 10, margin: '12px 0 18px', alignItems: 'center' }}>
                  <span style={{
                    padding: '4px 14px', borderRadius: 99, fontSize: '0.72rem', fontWeight: 700,
                    background: rdaColor + '22', color: rdaColor, letterSpacing: '0.04em',
                    border: `1px solid ${rdaColor}44`,
                  }}>
                    {rda.derating_level}
                  </span>
                  {rda.alert_flag && (
                    <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#f87171', animation: 'pulse 1s infinite' }}>
                      ⚠ ALERT
                    </span>
                  )}
                </div>

                {/* Derating factor bar */}
                <AnimBar
                  label={`Power Cap — ${(rda.derating_factor * 100).toFixed(0)}%`}
                  value={rda.derating_factor * 100}
                  max={100}
                  color={rdaColor}
                />

                {/* Subscores */}
                {rda.subscores && Object.keys(rda.subscores).length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: '0.6rem', color: 'var(--txt3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                      Risk Subscores
                    </div>
                    {Object.entries(rda.subscores).map(([k, v]) => (
                      <AnimBar
                        key={k}
                        label={k.replace(/_/g, ' ')}
                        value={Number(v)}
                        max={100}
                        color={Number(v) > 70 ? '#f87171' : Number(v) > 40 ? '#fb923c' : '#4ade80'}
                      />
                    ))}
                  </div>
                )}

                <div style={{ marginTop: 10, fontSize: '0.62rem', color: 'var(--txt3)', textAlign: 'right', fontFamily: "'DM Mono', monospace" }}>
                  {ageLabel(rda.timestamp)}
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--txt3)', fontSize: '0.82rem' }}>
                No RDA data yet
              </div>
            )}
          </Card>

          {/* ── RHF ── */}
          <Card>
            <CardLabel>RHF · Rolling Health Forecast</CardLabel>
            {forecast && forecast.current_soh != null ? (
              <>
                <SohArc soh={forecast.current_soh} />

                {/* Forecast bars */}
                <div style={{ marginTop: 18 }}>
                  <div style={{ fontSize: '0.6rem', color: 'var(--txt3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                    SoH Forecast
                  </div>
                  {[
                    { label: '30-Day forecast', value: forecast.forecast_30d },
                    { label: '60-Day forecast', value: forecast.forecast_60d },
                    { label: '90-Day forecast', value: forecast.forecast_90d },
                  ].map(({ label, value }) => value != null && (
                    <AnimBar
                      key={label}
                      label={`${label}  Δ${((value - forecast.current_soh) >= 0 ? '+' : '')}${(value - forecast.current_soh).toFixed(2)}%`}
                      value={value}
                      max={100}
                      color={value >= 80 ? '#4ade80' : value >= 60 ? '#fb923c' : '#f87171'}
                    />
                  ))}
                </div>

                <div style={{ marginTop: 14, fontSize: '0.62rem', color: 'var(--txt3)', textAlign: 'right', fontFamily: "'DM Mono', monospace" }}>
                  computed {new Date(forecast.computed_at).toLocaleDateString()}
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--txt3)', fontSize: '0.82rem' }}>
                No forecast yet
              </div>
            )}
          </Card>

        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
