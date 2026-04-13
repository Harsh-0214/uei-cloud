'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Header from '../components/Header';

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
  const r = 80;
  const cx = 100, cy = 100;
  const startX = cx - r, startY = cy;
  const endX   = cx + pct * 2 * r - r;
  const angle  = pct * Math.PI;
  const endY   = cy - Math.sin(angle) * r;
  const largeArc = pct > 0.5 ? 1 : 0;

  const trackD = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const valueD = pct === 0
    ? ''
    : pct >= 1
      ? `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`
      : `M ${startX} ${startY} A ${r} ${r} 0 ${largeArc} 1 ${endX} ${endY}`;

  return (
    <svg viewBox="0 0 200 110" style={{ width: '100%', maxWidth: 260, display: 'block', margin: '0 auto' }}>
      <path d={trackD} fill="none" stroke="rgba(128,128,128,0.15)" strokeWidth="16" strokeLinecap="round" />
      {valueD && (
        <path d={valueD} fill="none" stroke={color} strokeWidth="16" strokeLinecap="round"
          style={{ transition: 'all 0.6s ease' }} />
      )}
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

// ── CAC card body ─────────────────────────────────────────────────────────────

function CacBody({ cac }: { cac: CacOutput | null }) {
  if (!cac) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--txt3)', fontSize: '0.82rem' }}>
        No CAC data yet
      </div>
    );
  }
  const color = ACTION_COLOR[cac.action] ?? 'var(--txt2)';
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
        <span style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: '1.05rem', fontWeight: 800, letterSpacing: '0.06em',
          padding: '10px 22px', borderRadius: 10,
          background: color + '18', color,
          border: `1.5px solid ${color}44`,
          transition: 'all 0.4s',
        }}>
          {cac.action.replace(/_/g, ' ')}
        </span>
      </div>

      <AnimBar
        label="Adjusted Current Limit"
        value={cac.adjusted_current_limit}
        max={200}
        color={color}
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
  );
}

// ── RDA card body ─────────────────────────────────────────────────────────────

function RdaBody({ rda }: { rda: RdaOutput | null }) {
  if (!rda) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--txt3)', fontSize: '0.82rem' }}>
        No RDA data yet
      </div>
    );
  }
  const color = rda.derating_level === 'CRITICAL' ? '#f87171' : rda.derating_level === 'WARNING' ? '#fb923c' : '#4ade80';
  return (
    <>
      <RiskGauge score={rda.risk_score} level={rda.derating_level} />

      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, margin: '12px 0 18px', alignItems: 'center' }}>
        <span style={{
          padding: '4px 14px', borderRadius: 99, fontSize: '0.72rem', fontWeight: 700,
          background: color + '22', color, letterSpacing: '0.04em',
          border: `1px solid ${color}44`,
        }}>
          {rda.derating_level}
        </span>
        {rda.alert_flag && (
          <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#f87171', animation: 'pulse 1s infinite' }}>
            ⚠ ALERT
          </span>
        )}
      </div>

      <AnimBar
        label={`Power Cap — ${(rda.derating_factor * 100).toFixed(0)}%`}
        value={rda.derating_factor * 100}
        max={100}
        color={color}
      />

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
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AlgorithmsPage() {
  const [nodes,       setNodes]       = useState<string[]>([]);
  const [nodeId,      setNodeId]      = useState('');
  const [cac,         setCac]         = useState<CacOutput | null>(null);
  const [rda,         setRda]         = useState<RdaOutput | null>(null);
  const [lastTs,      setLastTs]      = useState<string | null>(null);
  const [pulse,       setPulse]       = useState(false);
  const nodeIdRef = useRef('');

  // Compare state
  const [compareMode, setCompareMode] = useState(false);
  const [compareId,   setCompareId]   = useState('');
  const [compareCac,  setCompareCac]  = useState<CacOutput | null>(null);
  const [compareRda,  setCompareRda]  = useState<RdaOutput | null>(null);
  const compareIdRef   = useRef('');
  const compareModeRef = useRef(false);

  // Load node list — BMS nodes + PV nodes combined
  useEffect(() => {
    Promise.allSettled([
      fetch('/api/telemetry/nodes', { cache: 'no-store' }).then(r => r.ok ? r.json() : []),
      fetch('/api/pv/latest',       { cache: 'no-store' }).then(r => r.ok ? r.json() : []),
    ]).then(([bmsR, pvR]) => {
      const bmsIds: string[] = bmsR.status === 'fulfilled' && Array.isArray(bmsR.value) ? bmsR.value : [];
      const pvIds: string[]  = pvR.status  === 'fulfilled' && Array.isArray(pvR.value)
        ? pvR.value.map((row: { node_id: string }) => row.node_id) : [];
      const allIds = Array.from(new Set([...bmsIds, ...pvIds])).sort();
      if (allIds.length) {
        setNodes(allIds);
        setNodeId(allIds[0]);
        nodeIdRef.current = allIds[0];
        const cmpId = allIds.length > 1 ? allIds[1] : allIds[0];
        setCompareId(cmpId);
        compareIdRef.current = cmpId;
      }
    }).catch(() => {});
  }, []);

  // Fetch algorithms for a given node id, returns [cac, rda]
  async function fetchNodeAlgo(id: string): Promise<[CacOutput | null, RdaOutput | null]> {
    const [cacR, rdaR] = await Promise.allSettled([
      fetch(`/api/algo/latest?node_id=${encodeURIComponent(id)}&algo=CAC`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
      fetch(`/api/algo/latest?node_id=${encodeURIComponent(id)}&algo=RDA`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
    ]);
    const cacOut = cacR.status === 'fulfilled' && Array.isArray(cacR.value) && cacR.value[0]
      ? cacR.value[0].output as CacOutput : null;
    const rdaOut = rdaR.status === 'fulfilled' && Array.isArray(rdaR.value) && rdaR.value[0]
      ? rdaR.value[0].output as RdaOutput : null;
    return [cacOut, rdaOut];
  }

  const fetchAlgo = useCallback(async () => {
    const id = nodeIdRef.current;
    if (!id) return;
    try {
      const [cacOut, rdaOut] = await fetchNodeAlgo(id);
      let updated = false;
      if (cacOut) { setCac(cacOut); updated = true; }
      if (rdaOut) { setRda(rdaOut); updated = true; }
      if (updated) {
        setLastTs(new Date().toISOString());
        setPulse(true);
        setTimeout(() => setPulse(false), 600);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchCompareAlgo = useCallback(async () => {
    if (!compareModeRef.current) return;
    const id = compareIdRef.current;
    if (!id) return;
    try {
      const [cacOut, rdaOut] = await fetchNodeAlgo(id);
      setCompareCac(cacOut);
      setCompareRda(rdaOut);
    } catch { /* ignore */ }
  }, []);

  // Poll every 2s for primary node
  useEffect(() => {
    if (!nodeId) return;
    nodeIdRef.current = nodeId;
    setCac(null); setRda(null);
    fetchAlgo();
    const t = setInterval(fetchAlgo, 2000);
    return () => clearInterval(t);
  }, [nodeId, fetchAlgo]);

  // Poll every 2s for compare node when compareMode is active
  useEffect(() => {
    compareModeRef.current = compareMode;
    if (!compareMode || !compareId) {
      setCompareCac(null);
      setCompareRda(null);
      return;
    }
    compareIdRef.current = compareId;
    setCompareCac(null); setCompareRda(null);
    fetchCompareAlgo();
    const t = setInterval(fetchCompareAlgo, 2000);
    return () => clearInterval(t);
  }, [compareMode, compareId, fetchCompareAlgo]);

  function toggleCompare() {
    setCompareMode(prev => !prev);
  }

  return (
    <div style={{ width: '100%', padding: '32px 5vw', minHeight: '100vh' }}>

      <Header
        crumbs={[{ label: 'UEI Cloud', href: '/overview' }, { label: 'Algorithms' }]}
        nav={[
          { label: 'Overview',  href: '/overview' },
          { label: 'Dashboard', href: `/dashboard?node=${encodeURIComponent(nodeId)}` },
          { label: 'Nodes',     href: '/nodes' },
          { label: 'Logs',      href: '/logs' },
        ]}
        extra={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* Live pulse */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                background: pulse ? '#4ade80' : lastTs ? '#4ade80' : 'var(--txt3)',
                boxShadow: pulse ? '0 0 10px #4ade80' : lastTs ? '0 0 6px #4ade80' : 'none',
                transition: 'box-shadow 0.3s',
              }} />
              <span style={{ fontSize: '0.65rem', color: 'var(--txt3)', whiteSpace: 'nowrap' }}>
                {lastTs ? `updated ${ageLabel(lastTs)}` : 'waiting…'}
              </span>
            </div>

            {/* Primary node dot (shown when comparing) */}
            {compareMode && (
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e09a20', flexShrink: 0, display: 'inline-block' }} />
            )}

            {/* Primary node selector */}
            <select
              value={nodeId}
              onChange={e => setNodeId(e.target.value)}
              style={{
                fontFamily: 'var(--ff-mono)', fontSize: '0.8rem', fontWeight: 600,
                background: 'var(--surf2)',
                border: compareMode ? '1px solid rgba(224,154,32,0.4)' : '1px solid var(--border)',
                borderRadius: 8,
                color: compareMode ? '#e09a20' : 'var(--txt)',
                padding: '5px 10px', cursor: 'pointer',
              }}
            >
              {nodes.map(n => <option key={n} value={n}>{n}</option>)}
            </select>

            {/* Compare node selector (visible only in compare mode) */}
            {compareMode && (
              <>
                <span style={{ fontSize: '0.72rem', color: 'var(--txt3)', fontWeight: 500 }}>vs</span>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#38bdf8', flexShrink: 0, display: 'inline-block' }} />
                <select
                  value={compareId}
                  onChange={e => { setCompareId(e.target.value); compareIdRef.current = e.target.value; }}
                  style={{
                    fontFamily: 'var(--ff-mono)', fontSize: '0.8rem', fontWeight: 600,
                    background: 'var(--surf2)', border: '1px solid rgba(56,189,248,0.4)',
                    borderRadius: 8, color: '#38bdf8', padding: '5px 10px', cursor: 'pointer',
                  }}
                >
                  {nodes.filter(n => n !== nodeId).map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </>
            )}

            {/* Compare toggle button */}
            {nodes.length > 1 && (
              <button
                onClick={toggleCompare}
                style={{
                  fontFamily: 'var(--ff-sans)', fontSize: '0.75rem', fontWeight: 600,
                  padding: '5px 12px', borderRadius: 6, cursor: 'pointer', transition: 'all 0.15s',
                  background: compareMode ? 'rgba(56,189,248,0.12)' : 'transparent',
                  border: compareMode ? '1px solid rgba(56,189,248,0.4)' : '1px solid var(--border)',
                  color: compareMode ? '#38bdf8' : 'var(--txt2)',
                }}
              >
                {compareMode ? '× Compare' : '⇄ Compare'}
              </button>
            )}
          </div>
        }
      />

      {nodes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--txt3)', fontSize: '0.9rem' }}>
          No nodes found. Start the simulator or connect a Pi.
        </div>
      ) : !compareMode ? (

        /* ── Single node view ── */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>

          {/* CAC */}
          <Card>
            <CardLabel>CAC · Context-Aware Adaptive Control</CardLabel>
            <CacBody cac={cac} />
          </Card>

          {/* RDA */}
          <Card alert={rda?.alert_flag}>
            <CardLabel>RDA · Risk-Indexed Derating Algorithm</CardLabel>
            <RdaBody rda={rda} />
          </Card>

        </div>

      ) : (

        /* ── Compare mode: two-column layout ── */
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

          {/* Primary node column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 14px',
              background: 'rgba(224,154,32,0.06)', border: '1px solid rgba(224,154,32,0.2)',
              borderRadius: 8,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e09a20', boxShadow: '0 0 8px #e09a20', flexShrink: 0 }} />
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#e09a20', fontFamily: 'var(--ff-mono)', letterSpacing: '0.02em' }}>
                {nodeId}
              </span>
            </div>
            <Card>
              <CardLabel>CAC · Context-Aware Adaptive Control</CardLabel>
              <CacBody cac={cac} />
            </Card>
            <Card alert={rda?.alert_flag}>
              <CardLabel>RDA · Risk-Indexed Derating Algorithm</CardLabel>
              <RdaBody rda={rda} />
            </Card>
          </div>

          {/* Compare node column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 14px',
              background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.2)',
              borderRadius: 8,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 8px #38bdf8', flexShrink: 0 }} />
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#38bdf8', fontFamily: 'var(--ff-mono)', letterSpacing: '0.02em' }}>
                {compareId}
              </span>
            </div>
            <Card>
              <CardLabel>CAC · Context-Aware Adaptive Control</CardLabel>
              <CacBody cac={compareCac} />
            </Card>
            <Card alert={compareRda?.alert_flag}>
              <CardLabel>RDA · Risk-Indexed Derating Algorithm</CardLabel>
              <RdaBody rda={compareRda} />
            </Card>
          </div>

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
