'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import Header from '../components/Header';

Chart.register(...registerables);

// ── Types ─────────────────────────────────────────────────────────────────────

interface Me {
  email: string;
  role: string;
  org_name: string;
}

interface PvRow {
  node_id: string;
  pv_id:   string;
  ts_utc:  string;
  invr1:   number | string;
  invr2:   number | string;
  ld1:     number | string;
  ld2:     number | string;
  ld3:     number | string;
  ld4:     number | string;
  bv1:     number | string;
  bv2:     number | string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function n(v: number | string | null | undefined): number {
  return Number(v ?? 0);
}

function fmt(v: number | string | null | undefined, dp = 2): string {
  const num = Number(v ?? 0);
  return isNaN(num) ? '—' : num.toFixed(dp);
}

function parseUtcMs(ts: string | null | undefined): number {
  if (!ts) return 0;
  const s = ts.includes('Z') || ts.includes('+') ? ts : ts.replace(' ', 'T') + 'Z';
  return new Date(s).getTime();
}

function ageLabel(ts: string | null | undefined): string {
  const ms = Date.now() - parseUtcMs(ts);
  if (ms < 5000)    return 'just now';
  if (ms < 60000)   return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  return `${Math.floor(ms / 3600000)}h ago`;
}

function getChartDefaults() {
  const s = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null;
  const v = (name: string, fallback: string) => s ? s.getPropertyValue(name).trim() || fallback : fallback;
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: { display: false, labels: { color: v('--txt3', '#454540'), font: { size: 11 }, boxWidth: 12 } },
      tooltip: {
        backgroundColor: v('--surf2', '#252523'),
        titleColor: v('--txt2', '#88887e'),
        bodyColor: v('--txt', '#e8e8e6'),
        borderColor: v('--border', 'rgba(128,128,128,0.12)'),
        borderWidth: 1,
      },
    },
    scales: {
      x: {
        ticks: { color: v('--txt3', '#454540'), font: { size: 10 }, maxTicksLimit: 6 },
        grid:  { color: v('--border', 'rgba(128,128,128,0.08)') },
      },
      y: {
        ticks: { color: v('--txt3', '#454540'), font: { size: 10 } },
        grid:  { color: v('--border', 'rgba(128,128,128,0.08)') },
      },
    },
  };
}

// ── PV Dashboard ──────────────────────────────────────────────────────────────

export default function PvDashboard() {
  const [me,          setMe]          = useState<Me | null>(null);
  const [pvNodes,     setPvNodes]     = useState<PvRow[]>([]);
  const [selectedId,  setSelectedId]  = useState('');
  const [current,     setCurrent]     = useState<PvRow | null>(null);
  const [timeRange,   setTimeRange]   = useState<'5m' | '15m' | '30m' | '1h' | '6h' | '24h'>('1h');
  const [lastUpdate,  setLastUpdate]  = useState('');
  const [stale,       setStale]       = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareId,   setCompareId]   = useState('');

  const invrRef   = useRef<HTMLCanvasElement>(null);
  const loadRef   = useRef<HTMLCanvasElement>(null);
  const battRef   = useRef<HTMLCanvasElement>(null);
  const chartsRef = useRef<Record<string, Chart>>({});

  const selectedIdRef  = useRef('');
  const timeRangeRef   = useRef('1h');
  const compareIdRef   = useRef('');
  const compareModeRef = useRef(false);
  const requestedNodeRef = useRef<string>(
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('node') ?? ''
      : ''
  );

  // Keep refs in sync so intervals never have stale closures
  useEffect(() => { selectedIdRef.current  = selectedId;  }, [selectedId]);
  useEffect(() => { timeRangeRef.current   = timeRange;   }, [timeRange]);
  useEffect(() => { compareIdRef.current   = compareId;   }, [compareId]);
  useEffect(() => { compareModeRef.current = compareMode; }, [compareMode]);

  // ── Chart init ────────────────────────────────────────────────────────────

  const initCharts = useCallback(() => {
    if (!invrRef.current || !loadRef.current || !battRef.current) return;
    const cd = getChartDefaults();
    chartsRef.current.invr = new Chart(invrRef.current, { type: 'line', data: { labels: [], datasets: [] }, options: { ...cd } });
    chartsRef.current.load = new Chart(loadRef.current, { type: 'line', data: { labels: [], datasets: [] }, options: { ...cd } });
    chartsRef.current.batt = new Chart(battRef.current, { type: 'line', data: { labels: [], datasets: [] }, options: { ...cd } });
  }, []);

  function clearCharts() {
    for (const chart of Object.values(chartsRef.current)) {
      chart.data.labels   = [];
      chart.data.datasets = [];
      chart.update('none');
    }
  }

  // ── Fetch history + update charts ────────────────────────────────────────

  const fetchCharts = useCallback(async (nodeId: string, range: string, cmpId = '') => {
    if (!nodeId) return;
    try {
      const [primaryRows, cmpRows] = await Promise.all([
        fetch(`/api/pv/telemetry?node_id=${encodeURIComponent(nodeId)}&range=${range}&limit=500`, { cache: 'no-store' }).then(r => r.ok ? r.json() : []),
        cmpId
          ? fetch(`/api/pv/telemetry?node_id=${encodeURIComponent(cmpId)}&range=${range}&limit=500`, { cache: 'no-store' }).then(r => r.ok ? r.json() : [])
          : Promise.resolve([]),
      ]);

      // rows come newest-first — reverse for charts
      const data    = [...(primaryRows as Record<string, number>[])].reverse().map(row => ({ ...row, time: row.ts_utc }));
      const cmpData = cmpId ? [...(cmpRows as Record<string, number>[])].reverse().map(row => ({ ...row, time: row.ts_utc })) : [];

      const shortRange = ['5m', '15m', '30m'].includes(range);
      const maxTicks   = shortRange ? 8 : range === '24h' ? 8 : 6;

      type DS = { key: string; label: string; color: string };
      function buildDatasets(
        primary: Record<string, number>[],
        pLines: DS[],
        compare: Record<string, number>[],
        cLines: DS[],
      ) {
        const ds = pLines.map(l => ({
          label: cmpId ? `${nodeId} ${l.label}` : l.label,
          data: (primary ?? []).map(d => Number(d[l.key])),
          borderColor: l.color, backgroundColor: l.color + '18',
          borderWidth: 2, pointRadius: 0, fill: true, tension: 0.4,
        }));
        if (cmpId) cLines.forEach(l => ds.push({
          label: `${cmpId} ${l.label}`,
          data: (compare ?? []).map(d => Number(d[l.key])),
          borderColor: l.color, backgroundColor: l.color + '18',
          borderWidth: 2, pointRadius: 0, fill: true, tension: 0.4,
        }));
        return ds;
      }

      const labels = data.map(d => {
        const t = new Date(d.time);
        return shortRange
          ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      });

      const configs: [string, ReturnType<typeof buildDatasets>][] = [
        ['invr', buildDatasets(data, [
          { key: 'invr1', label: 'Inverter 1 (A)', color: '#facc15' },
          { key: 'invr2', label: 'Inverter 2 (A)', color: '#fb923c' },
        ], cmpData, [
          { key: 'invr1', label: 'Inverter 1 (A)', color: '#38bdf8' },
          { key: 'invr2', label: 'Inverter 2 (A)', color: '#4ade80' },
        ])],
        ['load', buildDatasets(data, [
          { key: 'ld1', label: 'Load 1 (A)', color: '#60a5fa' },
          { key: 'ld2', label: 'Load 2 (A)', color: '#34d399' },
          { key: 'ld3', label: 'Load 3 (A)', color: '#a78bfa' },
          { key: 'ld4', label: 'Load 4 (A)', color: '#f87171' },
        ], cmpData, [
          { key: 'ld1', label: 'Load 1 (A)', color: '#93c5fd' },
          { key: 'ld2', label: 'Load 2 (A)', color: '#6ee7b7' },
          { key: 'ld3', label: 'Load 3 (A)', color: '#c4b5fd' },
          { key: 'ld4', label: 'Load 4 (A)', color: '#fca5a5' },
        ])],
        ['batt', buildDatasets(data, [
          { key: 'bv1', label: 'Battery V1 (V)', color: '#4ade80' },
          { key: 'bv2', label: 'Battery V2 (V)', color: '#2dd4bf' },
        ], cmpData, [
          { key: 'bv1', label: 'Battery V1 (V)', color: '#86efac' },
          { key: 'bv2', label: 'Battery V2 (V)', color: '#99f6e4' },
        ])],
      ];

      for (const [key, datasets] of configs) {
        const chart = chartsRef.current[key];
        if (!chart) continue;
        chart.data.labels   = labels;
        chart.data.datasets = datasets;
        (chart.options.scales!.x as { ticks: { maxTicksLimit: number } }).ticks.maxTicksLimit = maxTicks;
        (chart.options.plugins as { legend: { display: boolean } }).legend.display = !!cmpId;
        chart.update('none');
      }
    } catch { /* ignore */ }
  }, []);

  // ── Fetch latest for live card ─────────────────────────────────────────────

  const fetchLatest = useCallback(async (nodeId: string) => {
    if (!nodeId) return;
    try {
      const r = await fetch(`/api/pv/latest?node_id=${encodeURIComponent(nodeId)}`, { cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      const row: PvRow = Array.isArray(data) ? data[0] : data;
      if (!row) return;
      setCurrent(row);
      const ageSec = (Date.now() - parseUtcMs(row.ts_utc)) / 1000;
      setStale(ageSec > 15);
      setLastUpdate(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch { /* ignore */ }
  }, []);

  // ── Node list + initial load ───────────────────────────────────────────────

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setMe(d); })
      .catch(() => {});

    fetch('/api/pv/latest', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : [])
      .then((rows: PvRow[]) => {
        if (!Array.isArray(rows) || rows.length === 0) return;
        setPvNodes(rows);
        const requested = requestedNodeRef.current;
        const startNode = (requested && rows.find(r => r.node_id === requested))
          ? requested
          : rows[0].node_id;
        selectedIdRef.current = startNode;
        setSelectedId(startNode);
        initCharts();
        fetchLatest(startNode);
        fetchCharts(startNode, timeRangeRef.current);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reinit charts after DOM is ready
  useEffect(() => {
    if (selectedId) {
      initCharts();
      fetchCharts(selectedId, timeRange, compareModeRef.current ? compareIdRef.current : '');
      fetchLatest(selectedId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Poll latest every 5s
  useEffect(() => {
    if (!selectedId) return;
    const t = setInterval(() => fetchLatest(selectedIdRef.current), 5000);
    return () => clearInterval(t);
  }, [selectedId, fetchLatest]);

  function handleNodeChange(id: string) {
    selectedIdRef.current = id;
    setSelectedId(id);
    clearCharts();
    fetchLatest(id);
    fetchCharts(id, timeRangeRef.current, compareModeRef.current ? compareIdRef.current : '');
  }

  function handleRangeChange(r: typeof timeRange) {
    timeRangeRef.current = r;
    setTimeRange(r);
    fetchCharts(selectedIdRef.current, r, compareModeRef.current ? compareIdRef.current : '');
  }

  function handleCompareChange(id: string) {
    compareIdRef.current = id;
    setCompareId(id);
    fetchCharts(selectedIdRef.current, timeRangeRef.current, id);
  }

  function toggleCompare() {
    if (compareMode) {
      setCompareMode(false);
      setCompareId('');
      clearCharts();
      fetchCharts(selectedIdRef.current, timeRangeRef.current);
    } else {
      const other = pvNodes.find(n => n.node_id !== selectedId);
      if (!other) return;
      setCompareMode(true);
      setCompareId(other.node_id);
      fetchCharts(selectedIdRef.current, timeRangeRef.current, other.node_id);
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const invr1     = n(current?.invr1);
  const invr2     = n(current?.invr2);
  const ld1       = n(current?.ld1);
  const ld2       = n(current?.ld2);
  const ld3       = n(current?.ld3);
  const ld4       = n(current?.ld4);
  const bv1       = n(current?.bv1);
  const bv2       = n(current?.bv2);
  const totalInvr = invr1 + invr2;
  const totalLoad = ld1 + ld2 + ld3 + ld4;
  const ageSec    = current ? (Date.now() - parseUtcMs(current.ts_utc)) / 1000 : 999;
  const isLive    = ageSec < 10;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ width: '100%', padding: '32px 5vw', minHeight: '100vh' }}>

      <Header
        crumbs={[
          { label: 'UEI Cloud', href: '/overview' },
          { label: 'PV Dashboard' },
        ]}
        nav={[
          { label: 'Overview',   href: '/overview'   },
          { label: 'Dashboard',  href: '/dashboard'  },
          { label: 'Nodes',      href: '/nodes'       },
          { label: 'Logs',       href: '/logs'        },
          { label: 'Algorithms', href: '/algorithms'  },
        ]}
        user={me}
        onLogout={handleLogout}
        extra={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Live dot */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                background: isLive ? '#facc15' : stale ? 'var(--warn)' : 'var(--txt3)',
                boxShadow: isLive ? '0 0 6px #facc15' : 'none',
              }} />
              <span style={{ fontSize: '0.68rem', color: 'var(--txt3)' }}>
                {lastUpdate || '—'}
              </span>
            </div>

            {/* Primary node selector */}
            <select
              value={selectedId}
              onChange={e => handleNodeChange(e.target.value)}
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: '0.78rem',
                background: 'var(--surf2)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--txt)',
                padding: '5px 10px',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              {pvNodes.map(n => (
                <option key={n.node_id} value={n.node_id}>{n.node_id}</option>
              ))}
            </select>

            {/* Compare node selector — visible when compare mode is active */}
            {compareMode && (
              <select
                value={compareId}
                onChange={e => handleCompareChange(e.target.value)}
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: '0.78rem',
                  background: 'var(--surf2)',
                  border: '1px solid rgba(56,189,248,0.4)',
                  borderRadius: 6,
                  color: '#38bdf8',
                  padding: '5px 10px',
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                {pvNodes.filter(n => n.node_id !== selectedId).map(n => (
                  <option key={n.node_id} value={n.node_id}>{n.node_id}</option>
                ))}
              </select>
            )}

            {/* Compare toggle */}
            <button
              onClick={toggleCompare}
              disabled={pvNodes.length < 2}
              style={{
                fontFamily: 'var(--ff-sans)',
                fontSize: '0.72rem',
                fontWeight: 600,
                padding: '5px 12px',
                borderRadius: 6,
                cursor: pvNodes.length < 2 ? 'not-allowed' : 'pointer',
                border: compareMode ? '1px solid rgba(56,189,248,0.4)' : '1px solid var(--border)',
                background: compareMode ? 'rgba(56,189,248,0.1)' : 'transparent',
                color: compareMode ? '#38bdf8' : 'var(--txt3)',
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                opacity: pvNodes.length < 2 ? 0.4 : 1,
              }}
            >
              {compareMode && (
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#38bdf8', display: 'inline-block' }} />
              )}
              {compareMode ? '× Compare' : '⇄ Compare'}
            </button>
          </div>
        }
      />

      {/* Compare indicator */}
      {compareMode && compareId && (
        <div style={{ marginBottom: 16, fontSize: '0.78rem', color: 'var(--txt3)' }}>
          Comparing{' '}
          <span style={{ color: '#facc15', fontFamily: "'DM Mono', monospace", fontWeight: 700 }}>{selectedId}</span>
          {' vs '}
          <span style={{ color: '#38bdf8', fontFamily: "'DM Mono', monospace", fontWeight: 700 }}>{compareId}</span>
        </div>
      )}

      {pvNodes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--txt3)', fontSize: '0.9rem' }}>
          No PV data yet — run the simulator or connect a PV node.
        </div>
      ) : (
        <>
          {/* Live stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 32 }}>
            {[
              { label: 'Inverter 1',     value: fmt(invr1), unit: 'A',  color: '#facc15' },
              { label: 'Inverter 2',     value: fmt(invr2), unit: 'A',  color: '#fb923c' },
              { label: 'Total Output',   value: fmt(totalInvr), unit: 'A', color: '#fde68a' },
              { label: 'Total Load',     value: fmt(totalLoad), unit: 'A', color: '#60a5fa' },
              { label: 'Battery V1',     value: fmt(bv1, 4), unit: 'V', color: '#4ade80' },
              { label: 'Battery V2',     value: fmt(bv2, 4), unit: 'V', color: '#2dd4bf' },
            ].map(({ label, value, unit, color }) => (
              <div key={label} style={{ background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: color, opacity: 0.6 }} />
                <div style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{label}</div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '1.4rem', fontWeight: 800, color, lineHeight: 1 }}>
                  {value}<span style={{ fontSize: '0.72rem', fontWeight: 500, marginLeft: 3, color: 'var(--txt3)' }}>{unit}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Load channels detail */}
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--txt3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
            Load Channels
          </div>
          <div style={{ background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '18px 20px', marginBottom: 32 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16 }}>
              {[
                { label: 'LD 1', value: ld1, color: '#60a5fa' },
                { label: 'LD 2', value: ld2, color: '#34d399' },
                { label: 'LD 3', value: ld3, color: '#a78bfa' },
                { label: 'LD 4', value: ld4, color: '#f87171' },
              ].map(({ label, value, color }, i) => (
                <div key={label} style={{ borderLeft: i > 0 ? '1px solid var(--border)' : 'none', paddingLeft: i > 0 ? 16 : 0 }}>
                  <div style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 6 }}>{label}</div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '1.3rem', fontWeight: 800, color, lineHeight: 1 }}>
                    {value.toFixed(2)}<span style={{ fontSize: '0.7rem', fontWeight: 500, marginLeft: 3, color: 'var(--txt3)' }}>A</span>
                  </div>
                  {/* Mini bar */}
                  <div style={{ marginTop: 8, height: 4, background: 'var(--surf2)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(100, (value / 200) * 100)}%`, background: color, borderRadius: 99, transition: 'width 0.4s' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Time range selector */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--txt3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Historical Data
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['5m', '15m', '30m', '1h', '6h', '24h'] as const).map(r => (
                <button
                  key={r}
                  onClick={() => handleRangeChange(r)}
                  style={{
                    fontFamily: 'var(--ff-sans)', fontSize: '0.72rem', fontWeight: 600,
                    padding: '4px 10px', borderRadius: 5, cursor: 'pointer',
                    border: timeRange === r ? '1px solid #facc15' : '1px solid var(--border)',
                    background: timeRange === r ? 'rgba(250,204,21,0.12)' : 'transparent',
                    color: timeRange === r ? '#facc15' : 'var(--txt3)',
                    transition: 'all 0.15s',
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Charts */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 40 }}>
            {[
              { ref: invrRef, title: 'Inverter Output (A)' },
              { ref: loadRef, title: 'Load Channels (A)'   },
              { ref: battRef, title: 'Battery Voltages (V)' },
            ].map(({ ref, title }) => (
              <div key={title} style={{ background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '18px 20px' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--txt3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 14 }}>{title}</div>
                <div style={{ height: 200, position: 'relative' }}>
                  <canvas ref={ref} />
                </div>
              </div>
            ))}
          </div>

          {/* Node info */}
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--txt3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
            Node Info
          </div>
          <div style={{ background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '18px 20px', marginBottom: 40 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16 }}>
              {[
                { label: 'Node ID',    value: current?.node_id ?? '—' },
                { label: 'PV ID',      value: current?.pv_id   ?? '—' },
                { label: 'Last seen',  value: current ? ageLabel(current.ts_utc) : '—' },
                { label: 'Org',        value: me?.org_name ?? '—' },
              ].map(({ label, value }, i) => (
                <div key={label} style={{ borderLeft: i > 0 ? '1px solid var(--border)' : 'none', paddingLeft: i > 0 ? 16 : 0 }}>
                  <div style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 6 }}>{label}</div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '0.88rem', fontWeight: 600, color: 'var(--txt)' }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--txt3)' }}>UEI Cloud · Unified Energy Interface</span>
        <button
          onClick={handleLogout}
          style={{ fontFamily: 'var(--ff-sans)', fontSize: '0.72rem', fontWeight: 600, background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--txt3)', padding: '5px 14px', cursor: 'pointer', transition: 'all 0.15s' }}
          onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.color = 'var(--err)'; b.style.borderColor = 'rgba(248,113,113,0.3)'; }}
          onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.color = 'var(--txt3)'; b.style.borderColor = 'var(--border)'; }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
