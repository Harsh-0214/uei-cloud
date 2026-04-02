'use client';

import { useEffect, useRef, useState } from 'react';
import ThemeToggle from '../components/ThemeToggle';

interface TelemetryRow {
  node_id:           string;
  bms_id:            string;
  ts_utc:            string;
  soc:               number;
  pack_voltage:      number;
  pack_current:      number;
  temp_high:         number;
  temp_low:          number;
  ccl:               number;
  dcl:               number;
  fault_active:      boolean;
  faults_cleared_min: number;
  highest_cell_v:    number;
  lowest_cell_v:     number;
}

interface LogRow {
  ts_utc:       string;
  node_id:      string;
  soc:          number;
  pack_voltage: number;
  temp_high:    number;
  fault_active: boolean;
}

interface Me {
  email:    string;
  role:     string;
  org_name: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseUtcMs(ts: string | null | undefined): number {
  if (!ts) return 0;
  const s = ts.includes('Z') || ts.includes('+') ? ts : ts.replace(' ', 'T') + 'Z';
  return new Date(s).getTime();
}

function ageLabel(ts: string | null | undefined): string {
  const ms = Date.now() - parseUtcMs(ts);
  if (ms < 5000)   return 'just now';
  if (ms < 60000)  return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  return `${Math.floor(ms / 3600000)}h ago`;
}

function fmtTime(ts: string): string {
  const ms = parseUtcMs(ts);
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function socColor(soc: number): string {
  if (soc >= 60) return 'var(--ok)';
  if (soc >= 30) return 'var(--warn)';
  return 'var(--err)';
}

function tempColor(t: number): string {
  if (t >= 50) return 'var(--err)';
  if (t >= 40) return 'var(--warn)';
  return 'var(--txt)';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function NodeCard({ row, stale }: { row: TelemetryRow; stale: boolean }) {
  const [hovered, setHovered] = useState(false);
  const ageSec = (Date.now() - parseUtcMs(row.ts_utc)) / 1000;
  const isLive  = ageSec < 10;

  return (
    <a
      href={`/dashboard?node=${encodeURIComponent(row.node_id)}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        textDecoration: 'none',
        display: 'block',
        background: 'var(--surf)',
        border: `1px solid ${hovered ? 'var(--border-hi)' : 'var(--border)'}`,
        borderRadius: 'var(--r)',
        padding: '20px 22px',
        cursor: 'pointer',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: hovered ? '0 4px 20px rgba(0,0,0,0.18)' : 'none',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Fault stripe at top */}
      {row.fault_active && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'var(--err)' }} />
      )}

      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--txt)', fontFamily: "'DM Mono', monospace", marginBottom: 2 }}>
            {row.node_id}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--txt3)' }}>{row.bms_id}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          {/* Live / stale dot */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: isLive ? '#4ade80' : stale ? 'var(--warn)' : 'var(--txt3)',
              boxShadow: isLive ? '0 0 6px #4ade80' : 'none',
            }} />
            <span style={{ fontSize: '0.65rem', color: 'var(--txt3)' }}>{ageLabel(row.ts_utc)}</span>
          </div>
          {/* Fault badge */}
          {row.fault_active ? (
            <span style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--err)', background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 4, padding: '1px 7px' }}>
              FAULT
            </span>
          ) : (
            <span style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--ok)', background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 4, padding: '1px 7px' }}>
              OK
            </span>
          )}
        </div>
      </div>

      {/* SOC bar */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
          <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--txt3)', letterSpacing: '0.04em' }}>STATE OF CHARGE</span>
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: socColor(row.soc ?? 0), fontFamily: "'DM Mono', monospace" }}>
            {row.soc != null ? row.soc.toFixed(1) : '—'}%
          </span>
        </div>
        <div style={{ height: 5, background: 'var(--surf2)', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(100, row.soc ?? 0)}%`, background: socColor(row.soc ?? 0), borderRadius: 99, transition: 'width 0.4s ease' }} />
        </div>
      </div>

      {/* Key metrics grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px 0' }}>
        {[
          { label: 'Voltage',  value: row.pack_voltage != null ? `${row.pack_voltage.toFixed(1)} V` : '—',  color: 'var(--txt)' },
          { label: 'Current',  value: row.pack_current != null ? `${row.pack_current.toFixed(1)} A` : '—',  color: 'var(--txt)' },
          { label: 'Temp',     value: row.temp_high    != null ? `${row.temp_high.toFixed(1)} °C`   : '—',  color: tempColor(row.temp_high ?? 0) },
        ].map(({ label, value, color }) => (
          <div key={label}>
            <div style={{ fontSize: '0.62rem', color: 'var(--txt3)', fontWeight: 600, letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: '0.82rem', fontWeight: 600, color, fontFamily: "'DM Mono', monospace" }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Click hint */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
        <span style={{ fontSize: '0.68rem', color: hovered ? 'var(--accent)' : 'var(--txt3)', transition: 'color 0.15s', fontWeight: 600 }}>
          View details →
        </span>
      </div>
    </a>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const [nodes,      setNodes]      = useState<TelemetryRow[]>([]);
  const [logs,       setLogs]       = useState<LogRow[]>([]);
  const [me,         setMe]         = useState<Me | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [stale,      setStale]      = useState(false);
  const [carbon,     setCarbon]     = useState<Record<string, unknown> | null>(null);

  const esRef = useRef<EventSource | null>(null);

  // Parse age from ts_utc (first node used for stale check)
  function applyRows(rows: TelemetryRow[]) {
    setNodes(rows);
    const ageSec = rows[0]?.ts_utc ? (Date.now() - parseUtcMs(rows[0].ts_utc)) / 1000 : 999;
    setStale(ageSec > 10);
    setLastUpdate(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  }

  async function fetchLogs() {
    try {
      const r = await fetch('/api/logs?range=5m&limit=40', { cache: 'no-store' });
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data)) setLogs(data.slice(0, 40));
      }
    } catch { /* ignore */ }
  }

  async function fetchCarbon() {
    try {
      const r = await fetch('/api/carbon?range=1h', { cache: 'no-store' });
      if (r.ok) {
        const data = await r.json();
        if (!data.error) setCarbon(data as Record<string, unknown>);
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setMe(d); })
      .catch(() => {});

    fetchLogs();
    fetchCarbon();
    const logInterval = setInterval(fetchLogs, 10000);
    const carbonInterval = setInterval(fetchCarbon, 30000);

    function connect() {
      const es = new EventSource('/api/stream');
      esRef.current = es;
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.error) return;
          const rows: TelemetryRow[] = Array.isArray(data) ? data : [data];
          if (rows.length) applyRows(rows);
        } catch { /* ignore */ }
      };
      es.onerror = () => {
        es.close();
        setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      esRef.current?.close();
      clearInterval(logInterval);
      clearInterval(carbonInterval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  }

  const faultCount  = nodes.filter(n => n.fault_active).length;
  const activeCount = nodes.filter(n => (Date.now() - parseUtcMs(n.ts_utc)) < 15000).length;

  return (
    <div style={{ width: '100%', padding: '32px 5vw', minHeight: '100vh' }}>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ height: 3, background: 'linear-gradient(90deg, var(--txt2) 0%, rgba(128,128,120,0.1) 60%, transparent 100%)', borderRadius: 99, marginBottom: 24 }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <h1 style={{ fontSize: '1.85rem', fontWeight: 800, margin: 0, letterSpacing: '-0.03em', lineHeight: 1, background: 'var(--title-grad)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                UEI Cloud
              </h1>
              <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--txt)', background: 'var(--surf2)', border: '1px solid var(--border-hi)', padding: '3px 8px', borderRadius: 4 }}>
                Overview
              </span>
            </div>
            <p style={{ fontSize: '0.72rem', fontWeight: 500, color: 'var(--txt3)', margin: 0 }}>
              Unified Energy Interface
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            {/* Nav */}
            {[{ label: 'Nodes', href: '/nodes' }, { label: 'Logs', href: '/logs' }, { label: 'Users', href: '/users' }].map(({ label, href }) => (
              <a key={href} href={href} style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--txt2)', textDecoration: 'none', transition: 'color 0.15s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--txt)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--txt2)'; }}>
                {label}
              </a>
            ))}
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

      {/* Summary stats */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 32, flexWrap: 'wrap' }}>
        {[
          { label: 'Total nodes',  value: nodes.length,  color: 'var(--txt)' },
          { label: 'Live',         value: activeCount,   color: 'var(--ok)'  },
          { label: 'Faults',       value: faultCount,    color: faultCount > 0 ? 'var(--err)' : 'var(--txt)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ flex: '1 1 140px', background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '18px 20px' }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--txt3)', marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
          </div>
        ))}
        {/* Live indicator */}
        <div style={{ flex: '1 1 140px', background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '18px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--txt3)', marginBottom: 6 }}>Last update</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            {lastUpdate && (
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: stale ? 'var(--warn)' : '#4ade80', boxShadow: stale ? 'none' : '0 0 6px #4ade80', flexShrink: 0 }} />
            )}
            <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--txt)', fontFamily: "'DM Mono', monospace" }}>
              {lastUpdate || '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Node cards */}
      {nodes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--txt3)', fontSize: '0.9rem' }}>
          Waiting for telemetry…
        </div>
      ) : (
        <>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--txt3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
            Nodes · click to open dashboard
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 16,
            marginBottom: 40,
          }}>
            {nodes.map(row => (
              <NodeCard key={row.node_id} row={row} stale={stale} />
            ))}
          </div>
        </>
      )}

      {/* Recent logs */}
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--txt3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
        Recent activity · last 5 min
      </div>
      <div style={{ background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--r)', overflow: 'hidden', marginBottom: 40 }}>
        {logs.length === 0 ? (
          <div style={{ padding: '24px 20px', fontSize: '0.82rem', color: 'var(--txt3)' }}>No recent logs.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Time (UTC)', 'Node', 'SoC', 'Voltage', 'Temp', 'Fault'].map(h => (
                    <th key={h} style={{ padding: '9px 16px', textAlign: 'left', fontSize: '0.65rem', fontWeight: 600, color: 'var(--txt3)', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map((row, i) => (
                  <tr
                    key={i}
                    onClick={() => { window.location.href = `/dashboard?node=${encodeURIComponent(row.node_id)}`; }}
                    style={{ borderBottom: i < logs.length - 1 ? '1px solid var(--border)' : 'none', cursor: 'pointer', transition: 'background 0.1s' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--surf2)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'transparent'; }}
                  >
                    <td style={{ padding: '9px 16px', color: 'var(--txt3)', fontFamily: "'DM Mono', monospace", whiteSpace: 'nowrap' }}>{fmtTime(row.ts_utc)}</td>
                    <td style={{ padding: '9px 16px', color: 'var(--txt)', fontFamily: "'DM Mono', monospace', fontWeight: 600" }}>{row.node_id}</td>
                    <td style={{ padding: '9px 16px', color: socColor(row.soc ?? 0), fontFamily: "'DM Mono', monospace" }}>{row.soc != null ? `${row.soc.toFixed(1)}%` : '—'}</td>
                    <td style={{ padding: '9px 16px', color: 'var(--txt)', fontFamily: "'DM Mono', monospace" }}>{row.pack_voltage != null ? `${row.pack_voltage.toFixed(2)} V` : '—'}</td>
                    <td style={{ padding: '9px 16px', color: tempColor(row.temp_high ?? 0), fontFamily: "'DM Mono', monospace" }}>{row.temp_high != null ? `${row.temp_high.toFixed(1)} °C` : '—'}</td>
                    <td style={{ padding: '9px 16px' }}>
                      {row.fault_active ? (
                        <span style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--err)', background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 4, padding: '1px 6px', letterSpacing: '0.05em' }}>FAULT</span>
                      ) : (
                        <span style={{ fontSize: '0.62rem', color: 'var(--txt3)' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Carbon Emissions */}
      {carbon && (() => {
        const co2_g         = Number(carbon.co2_g         ?? carbon.total_co2_g         ?? 0);
        const co2_avoided_g = Number(carbon.co2_avoided_g ?? carbon.total_co2_avoided_g ?? 0);
        const net           = Number(carbon.net_co2_saved_g ?? 0);
        const gridKwh       = Number(carbon.total_grid_kwh ?? 0);
        const solarKwh      = Number(carbon.total_solar_kwh ?? 0);
        const intensity     = Number(carbon.carbon_intensity ?? carbon.avg_carbon_intensity ?? 400);
        const solarFrac     = Number(carbon.solar_fraction ?? 0);
        const solarPct      = solarFrac * 100;
        const netColor   = net >= 0 ? 'var(--ok)' : 'var(--err)';
        const solarColor = solarPct >= 50 ? 'var(--ok)' : solarPct >= 20 ? 'var(--warn)' : 'var(--txt2)';
        return (
          <>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--txt3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
              Carbon Emissions · All nodes · last hour
            </div>
            <div style={{ background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '18px 20px', marginBottom: 40 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 16 }}>
                {[
                  { label: 'CO₂ Emitted',  value: (co2_g / 1000).toFixed(3),         unit: 'kg',  sub: `${co2_g.toFixed(1)} g total`,         color: 'var(--err)' },
                  { label: 'CO₂ Avoided',  value: (co2_avoided_g / 1000).toFixed(3),  unit: 'kg',  sub: 'by solar generation',                  color: 'var(--ok)'  },
                  { label: 'Net Impact',   value: `${net >= 0 ? '+' : ''}${(net / 1000).toFixed(3)}`, unit: 'kg', sub: net >= 0 ? 'net saved' : 'net emitted', color: netColor },
                  { label: 'Solar Fraction', value: solarPct.toFixed(1),              unit: '%',   sub: `${solarKwh.toFixed(3)} kWh solar`,     color: solarColor },
                ].map(({ label, value, unit, sub, color }, i) => (
                  <div key={label} style={{ borderLeft: i > 0 ? '1px solid var(--border)' : 'none', paddingLeft: i > 0 ? 16 : 0 }}>
                    <div style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 6 }}>{label}</div>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '1.5rem', fontWeight: 800, color, lineHeight: 1 }}>
                      {value}<span style={{ fontSize: '0.72rem', fontWeight: 500, marginLeft: 3 }}>{unit}</span>
                    </div>
                    <div style={{ fontSize: '0.62rem', color: 'var(--txt3)', marginTop: 4 }}>{sub}</div>
                  </div>
                ))}
              </div>
              <div style={{ paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                {[
                  { label: 'Grid Import', value: gridKwh.toFixed(4) + ' kWh' },
                  { label: 'Intensity',   value: intensity.toFixed(0) + ' gCO₂/kWh' },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: '0.62rem', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '0.82rem', fontWeight: 600, color: 'var(--txt2)' }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        );
      })()}

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--txt3)' }}>UEI Cloud · Unified Energy Interface</span>
        <button
          onClick={handleLogout}
          style={{ fontFamily: 'var(--ff-sans)', fontSize: '0.72rem', fontWeight: 600, background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--txt3)', padding: '5px 14px', cursor: 'pointer', transition: 'all 0.15s' }}
          onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.color='var(--err)'; b.style.borderColor='rgba(248,113,113,0.3)'; }}
          onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.color='var(--txt3)'; b.style.borderColor='var(--border)'; }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
