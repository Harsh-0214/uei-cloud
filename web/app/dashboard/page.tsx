'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import ThemeToggle from '../components/ThemeToggle';

Chart.register(...registerables);

// ── Types ──────────────────────────────────────────────────────

interface CurrentUser {
  id: number;
  email: string;
  role: string;
  org_name: string;
}

interface TelemetryRow {
  node_id: string;
  bms_id: string;
  ts_utc: string;
  soc: number;
  pack_voltage: number;
  pack_current: number;
  temp_high: number;
  temp_low: number;
  ccl: number;
  dcl: number;
  fault_active: boolean;
  faults_cleared_min: number;
  highest_cell_v: number;
  lowest_cell_v: number;
}

interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  queries?: { sql: string; rows: number }[];
}

interface StreamingState {
  text: string;
  queries: { sql: string; rows: number }[];
}

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
  node_id: string;
  bms_id: string;
  current_soh: number;
  forecast_30d: number;
  forecast_60d: number;
  forecast_90d: number;
  computed_at: string;
  stress_summary?: Record<string, unknown>;
}

interface CarbonSummary {
  node_id: string;
  range: string;
  co2_g: number;
  co2_avoided_g: number;
  net_co2_saved_g: number;
  total_grid_kwh: number;
  total_solar_kwh: number;
  solar_fraction: number;
  carbon_intensity: number;
  interval_count: number;
}

// ── Helpers ────────────────────────────────────────────────────

function fmt(v: number | undefined | null, d = 1): string {
  return v !== undefined && v !== null ? Number(v).toFixed(d) : '—';
}

function renderMd(text: string): string {
  return text
    .replace(
      /```[\w]*\n?([\s\S]*?)```/g,
      '<pre style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:10px;font-size:0.72rem;overflow-x:auto;margin:6px 0;font-family:\'DM Mono\',monospace;color:#e8e8e6">$1</pre>',
    )
    .replace(
      /`([^`]+)`/g,
      '<code style="background:rgba(255,255,255,0.08);padding:1px 6px;border-radius:4px;font-family:\'DM Mono\',monospace;font-size:0.82em">$1</code>',
    )
    .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#e8e8e6">$1</strong>')
    .replace(/^\s*[-*]\s+(.+)$/gm, '<li style="margin-left:14px;margin-bottom:3px">$1</li>')
    .replace(/\n/g, '<br>');
}

const escHtml = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function getChartDefaults() {
  const s   = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null;
  const v   = (name: string, fallback: string) => s ? s.getPropertyValue(name).trim() || fallback : fallback;
  const txt3    = v('--txt3', '#454540');
  const border  = v('--border', 'rgba(128,128,128,0.12)');
  const surf2   = v('--surf2', '#252523');
  const txt2    = v('--txt2', '#88887e');
  const txt     = v('--txt', '#e8e8e6');
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: surf2,
        titleColor: txt2,
        bodyColor: txt,
        borderColor: border,
        borderWidth: 1,
        cornerRadius: 6,
        titleFont: { family: "'DM Mono', monospace", size: 11 },
        bodyFont:  { family: "'DM Mono', monospace", size: 11 },
      },
    },
    scales: {
      x: {
        ticks: { color: txt3, maxTicksLimit: 6, font: { size: 11, family: "'DM Mono', monospace" } },
        grid:  { color: border },
        border: { color: border },
      },
      y: {
        ticks: { color: txt3, font: { size: 11, family: "'DM Mono', monospace" } },
        grid:  { color: border },
        border: { color: border },
      },
    },
  };
}

// ── Sub-components ─────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
      <div style={{ width: 3, height: 14, borderRadius: 99, background: 'var(--accent)', flexShrink: 0 }} />
      <p style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--txt2)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.09em' }}>
        {children}
      </p>
    </div>
  );
}

function QueryBadge({ q }: { q: { sql: string; rows: number } }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      background: 'rgba(255,255,255,0.04)', borderRadius: 6,
      padding: '5px 9px', marginBottom: 6,
      fontFamily: "'DM Mono', monospace", fontSize: '0.68rem',
      color: 'var(--txt2)', wordBreak: 'break-all',
    }}>
      <span style={{ color: 'var(--accent)', flexShrink: 0, fontWeight: 500 }}>SQL</span>
      <span style={{ flex: 1 }}>{q.sql.trim()}</span>
      <span style={{ color: 'var(--txt3)', flexShrink: 0 }}>{q.rows}r</span>
    </div>
  );
}

function MetricCard({
  label, value, unit = '', bar = null, highlight = 'normal',
}: {
  label: string; value: string; unit?: string;
  bar?: number | null; highlight?: 'normal' | 'warning' | 'danger' | 'success';
}) {
  const cls = { normal: '', warning: 'warn', danger: 'err', success: 'ok' }[highlight];
  const valColor = { normal: 'var(--txt)', warning: 'var(--warn)', danger: 'var(--err)', success: 'var(--ok)' }[highlight];
  const barColor = { normal: 'var(--accent)', warning: 'var(--warn)', danger: 'var(--err)', success: 'var(--ok)' }[highlight];
  return (
    <div className={`mc ${cls}`}>
      <div className="mc-label">{label}</div>
      <div>
        <span className="mc-value" style={{ color: valColor }}>{value}</span>
        <span className="mc-unit">{unit}</span>
      </div>
      {bar !== null && bar !== undefined && (
        <div className="mc-bar-bg">
          <div className="mc-bar-fg" style={{ width: `${Math.min(100, Math.max(0, bar))}%`, background: barColor }} />
        </div>
      )}
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────

export default function Dashboard() {
  // ── Data state ───────────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [nodes,       setNodes]       = useState<TelemetryRow[]>([]);
  const [selectedId,  setSelectedId]  = useState('');
  const [timeRange,   setTimeRange]   = useState<'5m' | '15m' | '30m' | '1h' | '6h' | '24h'>('1h');
  const [initialized, setInitialized] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');
  const [stale,       setStale]       = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareId,   setCompareId]   = useState('');

  const [cacOutput,     setCacOutput]     = useState<CacOutput | null>(null);
  const [rdaOutput,     setRdaOutput]     = useState<RdaOutput | null>(null);
  const [forecast,      setForecast]      = useState<SohForecast | null>(null);
  const [carbonSummary, setCarbonSummary] = useState<CarbonSummary | null>(null);
  const [nodeOrgMap,    setNodeOrgMap]    = useState<Record<string, string>>({});

  const [chatOpen,        setChatOpen]        = useState(false);
  const [chatBusy,        setChatBusy]        = useState(false);
  const [chatInput,       setChatInput]       = useState('');
  const [chatHistory,     setChatHistory]     = useState<ChatMsg[]>([]);
  const [streamingState,  setStreamingState]  = useState<StreamingState | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(true);

  const socRef    = useRef<HTMLCanvasElement>(null);
  const voltRef   = useRef<HTMLCanvasElement>(null);
  const tempRef   = useRef<HTMLCanvasElement>(null);
  const chartsRef      = useRef<Record<string, Chart>>({});
  const chatBoxRef     = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const selectedIdRef  = useRef('');
  const timeRangeRef   = useRef<string>('1h');
  const compareIdRef   = useRef('');
  // node requested via ?node= URL param (set once on mount)
  const requestedNodeRef = useRef<string>(
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('node') ?? ''
      : ''
  );
  const compareModeRef = useRef(false);

  // ── Charts ──────────────────────────────────────────────────

  const initCharts = useCallback(() => {
    if (!socRef.current || !voltRef.current || !tempRef.current) return;
    const cd = getChartDefaults();
    chartsRef.current.soc     = new Chart(socRef.current,  { type: 'line', data: { labels: [], datasets: [] }, options: { ...cd } });
    chartsRef.current.voltage = new Chart(voltRef.current, { type: 'line', data: { labels: [], datasets: [] }, options: { ...cd } });
    chartsRef.current.temp    = new Chart(tempRef.current, { type: 'line', data: { labels: [], datasets: [] }, options: { ...cd } });
  }, []);

  function updateChart(
    chart: Chart,
    data: Record<string, number>[],
    lines: { key: string; label: string; color: string }[],
    range: string,
  ) {
    const shortRange = range === '5m' || range === '15m' || range === '30m';
    chart.data.labels = (data ?? []).map(d => {
      const t = new Date(d.time);
      return shortRange
        ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    });
    chart.data.datasets = lines.map(l => ({
      label: l.label, data: (data ?? []).map(d => d[l.key]),
      borderColor: l.color, backgroundColor: l.color + '18',
      borderWidth: 2, pointRadius: 0, fill: true, tension: 0.4,
    }));
    const maxTicks = shortRange ? 8 : range === '24h' ? 8 : 6;
    (chart.options.scales!.x as { ticks: { maxTicksLimit: number } }).ticks.maxTicksLimit = maxTicks;
    chart.update('none');
  }

  function clearCharts() {
    for (const chart of Object.values(chartsRef.current)) {
      chart.data.labels = [];
      chart.data.datasets = [];
      chart.update('none');
    }
  }

  // ── Data fetching ───────────────────────────────────────────

  const fetchCharts = useCallback(async (id: string, range: string, cmpId = '') => {
    if (!id) return;
    const base    = `/api/metrics?node_id=${encodeURIComponent(id)}&range=${range}`;
    const cmpBase = cmpId ? `/api/metrics?node_id=${encodeURIComponent(cmpId)}&range=${range}` : '';

    try {
      const fetches: Promise<Record<string, number>[]>[] = [
        fetch(`${base}&metric=soc`,          { cache: 'no-store' }).then(r => r.json()),
        fetch(`${base}&metric=pack_voltage`, { cache: 'no-store' }).then(r => r.json()),
        fetch(`${base}&metric=temperature`,  { cache: 'no-store' }).then(r => r.json()),
        ...(cmpId ? [
          fetch(`${cmpBase}&metric=soc`,          { cache: 'no-store' }).then(r => r.json()),
          fetch(`${cmpBase}&metric=pack_voltage`, { cache: 'no-store' }).then(r => r.json()),
          fetch(`${cmpBase}&metric=temperature`,  { cache: 'no-store' }).then(r => r.json()),
        ] : []),
      ];

      const results = await Promise.all(fetches);
      const [soc, volt, temp] = results;
      const [cmpSoc, cmpVolt, cmpTemp] = cmpId ? results.slice(3) : [[], [], []];

      const shortRange = ['5m', '15m', '30m'].includes(range);
      const maxTicks   = shortRange ? 8 : range === '24h' ? 8 : 6;

      type DS = { key: string; label: string; color: string };
      function buildDatasets(
        primary: Record<string, number>[], pLines: DS[],
        compare: Record<string, number>[], cLines: DS[],
      ) {
        const ds = pLines.map(l => ({
          label: cmpId ? `${id} ${l.label}` : l.label,
          data: (primary ?? []).map(d => d[l.key]),
          borderColor: l.color, backgroundColor: l.color + '18',
          borderWidth: 2, pointRadius: 0, fill: true, tension: 0.4,
        }));
        if (cmpId) cLines.forEach(l => ds.push({
          label: `${cmpId} ${l.label}`,
          data: (compare ?? []).map(d => d[l.key]),
          borderColor: l.color, backgroundColor: l.color + '18',
          borderWidth: 2, pointRadius: 0, fill: true, tension: 0.4,
        }));
        return ds;
      }

      const labels = (soc ?? []).map((d: Record<string, number>) => {
        const t = new Date(d.time);
        return shortRange
          ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      });

      const configs: [string, ReturnType<typeof buildDatasets>][] = [
        ['soc',     buildDatasets(soc,  [{ key: 'value', label: 'SOC',     color: '#e09a20' }],
                                  cmpSoc, [{ key: 'value', label: 'SOC',     color: '#38bdf8' }])],
        ['voltage', buildDatasets(volt, [{ key: 'value', label: 'Voltage', color: '#a78bfa' }],
                                  cmpVolt,[{ key: 'value', label: 'Voltage', color: '#4ade80' }])],
        ['temp',    buildDatasets(temp, [{ key: 'high', label: 'High', color: '#f87171' }, { key: 'low', label: 'Low', color: '#60a5fa' }],
                                  cmpTemp,[{ key: 'high', label: 'High', color: '#fb923c' }, { key: 'low', label: 'Low', color: '#818cf8' }])],
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

  const fetchAlgo = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const [cacResp, rdaResp, fcastResp] = await Promise.allSettled([
        fetch(`/api/algo/latest?node_id=${encodeURIComponent(id)}&algo=CAC`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
        fetch(`/api/algo/latest?node_id=${encodeURIComponent(id)}&algo=RDA`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
        fetch(`/api/forecast?node_id=${encodeURIComponent(id)}`,             { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
      ]);
      if (cacResp.status === 'fulfilled' && Array.isArray(cacResp.value) && cacResp.value[0])
        setCacOutput(cacResp.value[0].output as CacOutput);
      if (rdaResp.status === 'fulfilled' && Array.isArray(rdaResp.value) && rdaResp.value[0])
        setRdaOutput(rdaResp.value[0].output as RdaOutput);
      if (fcastResp.status === 'fulfilled' && fcastResp.value && !fcastResp.value.error)
        setForecast(fcastResp.value as SohForecast);
    } catch { /* ignore */ }
  }, []);

  const fetchCarbon = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const r = await fetch(`/api/carbon?node_id=${encodeURIComponent(id)}&range=1h`, { cache: 'no-store' });
      if (r.ok) {
        const data = await r.json();
        if (!data.error) setCarbonSummary(data as CarbonSummary);
      }
    } catch { /* ignore */ }
  }, []);

  function parseUtcAge(ts_utc: string | undefined | null): number {
    if (!ts_utc) return Infinity;
    // PostgreSQL timestamps arrive as "YYYY-MM-DD HH:MM:SS[.fff]" — no timezone.
    // Append Z so the browser treats them as UTC rather than local time.
    const normalized = ts_utc.includes('Z') || ts_utc.includes('+')
      ? ts_utc
      : ts_utc.replace(' ', 'T') + 'Z';
    return Date.now() - new Date(normalized).getTime();
  }

  function applyRows(rows: TelemetryRow[]) {
    setNodes(rows);
    setStale(parseUtcAge(rows[0]?.ts_utc) > 3000);
    setLastUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    if (!initializedRef.current) {
      initializedRef.current = true;
      setInitialized(true);
      const requested = requestedNodeRef.current;
      const startNode = (requested && rows.find(r => r.node_id === requested))
        ? requested
        : rows[0].node_id;
      setSelectedId(startNode);
      console.log('[UEI] Dashboard initialized with node:', startNode);
      setTimeout(() => {
        initCharts();
        fetchCharts(startNode, '1h');
        fetchAlgo(startNode);
        fetchCarbon(startNode);
      }, 50);
    }
  }

  // Fetch current user and node→org map on mount
  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setCurrentUser(data); })
      .catch(() => {});

    fetch('/api/admin/nodes', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : [])
      .then((data: { node_id: string; org_name: string }[]) => {
        if (Array.isArray(data)) {
          const map: Record<string, string> = {};
          for (const n of data) map[n.node_id] = n.org_name;
          setNodeOrgMap(map);
        }
      })
      .catch(() => {});
  }, []);

  // Keep refs in sync so intervals never have stale closures
  useEffect(() => { selectedIdRef.current  = selectedId;  }, [selectedId]);
  useEffect(() => { timeRangeRef.current   = timeRange;   }, [timeRange]);
  useEffect(() => { compareIdRef.current   = compareId;   }, [compareId]);
  useEffect(() => { compareModeRef.current = compareMode; }, [compareMode]);

  useEffect(() => {
    // Use SSE stream for live 1-second telemetry pushes
    let es: EventSource | null = null;

    function connect() {
      es = new EventSource('/api/stream');

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.error) { console.warn('[UEI] stream error:', data.error); return; }
          const rows: TelemetryRow[] = Array.isArray(data) ? data : [data];
          if (!rows.length) return;
          applyRows(rows);
        } catch { /* ignore parse errors */ }
      };

      es.onerror = () => {
        console.warn('[UEI] SSE disconnected — retrying in 3s');
        es?.close();
        setTimeout(connect, 3000);
      };
    }

    connect();

    const i2 = setInterval(() => {
      if (initializedRef.current) {
        fetchCharts(selectedIdRef.current, timeRangeRef.current,
                    compareModeRef.current ? compareIdRef.current : '');
        fetchAlgo(selectedIdRef.current);
        fetchCarbon(selectedIdRef.current);
      }
    }, 5000);

    return () => { es?.close(); clearInterval(i2); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (chatBoxRef.current) chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
  }, [streamingState, chatHistory]);

  // ── Auth ────────────────────────────────────────────────────

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  }

  // ── Helpers ─────────────────────────────────────────────────

  const currentNode = nodes.find(n => n.node_id === selectedId);

  function handleRangeChange(r: '5m' | '15m' | '30m' | '1h' | '6h' | '24h') {
    setTimeRange(r);
    fetchCharts(selectedId, r, compareMode ? compareId : '');
  }

  function handleNodeChange(id: string) {
    setSelectedId(id);
    clearCharts();
    setCacOutput(null);
    setRdaOutput(null);
    setForecast(null);
    setCarbonSummary(null);
    fetchCharts(id, timeRange, compareMode ? compareId : '');
    fetchAlgo(id);
    fetchCarbon(id);
  }

  function handleCompareChange(id: string) {
    setCompareId(id);
    fetchCharts(selectedId, timeRange, id);
  }

  function toggleCompare() {
    if (compareMode) {
      setCompareMode(false);
      setCompareId('');
      clearCharts();
      fetchCharts(selectedId, timeRange);
    } else {
      const other = nodes.find(n => n.node_id !== selectedId);
      if (!other) return;
      setCompareMode(true);
      setCompareId(other.node_id);
      fetchCharts(selectedId, timeRange, other.node_id);
    }
  }

  // ── Chat ────────────────────────────────────────────────────

  async function sendChat(text: string) {
    if (!text.trim() || chatBusy) return;
    setChatInput('');
    setChatBusy(true);
    setShowSuggestions(false);

    const historySnapshot = chatHistory;
    setChatHistory(prev => [...prev, { role: 'user', text }]);
    setStreamingState({ text: '', queries: [] });

    let accumulated  = '';
    let finalQueries: { sql: string; rows: number }[] = [];

    try {
      const res = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: text, history: historySnapshot.map(m => ({ role: m.role, content: m.text })) }),
      });

      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let event: Record<string, unknown>;
          try { event = JSON.parse(line.slice(6)); } catch { continue; }

          if (event.type === 'text') {
            accumulated += event.text as string;
            setStreamingState(prev => ({ queries: prev?.queries ?? [], text: accumulated }));
          } else if (event.type === 'query') {
            const q = { sql: event.sql as string, rows: event.rows as number };
            finalQueries = [...finalQueries, q];
            setStreamingState(prev => ({ text: prev?.text ?? '', queries: [...(prev?.queries ?? []), q] }));
          } else if (event.type === 'done') {
            setChatHistory(prev => [...prev, { role: 'assistant', text: (event.assistantText as string) || accumulated, queries: finalQueries }]);
            setStreamingState(null);
          } else if (event.type === 'error') {
            setChatHistory(prev => [...prev, { role: 'assistant', text: `Error: ${escHtml(event.text as string)}` }]);
            setStreamingState(null);
          }
        }
      }
    } catch (err) {
      setChatHistory(prev => [...prev, { role: 'assistant', text: `Connection error: ${String(err)}` }]);
      setStreamingState(null);
    }

    setChatBusy(false);
  }

  function newChat() {
    setChatHistory([]);
    setStreamingState(null);
    setShowSuggestions(true);
  }

  // ── Render ──────────────────────────────────────────────────

  return (
    <>
      {/* ── Dashboard ── */}
      <div style={{ width: '100%', padding: '32px 5vw' }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          {/* Top accent bar */}
          <div style={{ height: 3, background: 'linear-gradient(90deg, var(--accent) 0%, rgba(224,154,32,0.15) 60%, transparent 100%)', borderRadius: 99, marginBottom: 24 }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
            {/* Left: brand + node selector + org + compare */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h1 style={{ fontSize: '1.85rem', fontWeight: 800, margin: 0, letterSpacing: '-0.03em', lineHeight: 1, background: 'var(--title-grad)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                  UEI Cloud
                </h1>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#111', background: 'var(--accent)', padding: '3px 8px', borderRadius: 4 }}>
                  Dashboard
                </span>
              </div>

              {initialized && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {/* Primary node selector */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {compareMode && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e09a20', flexShrink: 0, display: 'inline-block' }} />}
                    <label style={{ fontSize: '0.75rem', color: 'var(--txt2)', fontWeight: 500 }}>Node</label>
                    <select
                      value={selectedId}
                      onChange={e => handleNodeChange(e.target.value)}
                      style={{
                        background: 'var(--surf)', border: '1px solid var(--border)',
                        borderRadius: 6, color: 'var(--txt)',
                        fontFamily: 'var(--ff-sans)', fontSize: '0.8rem', fontWeight: 500,
                        padding: '5px 10px', outline: 'none', cursor: 'pointer',
                      }}
                    >
                      {nodes.map(n => <option key={n.node_id} value={n.node_id}>{n.node_id}</option>)}
                    </select>
                    {/* Org badge */}
                    {nodeOrgMap[selectedId] && (
                      <span style={{
                        fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.04em',
                        color: 'var(--accent)', background: 'rgba(224,154,32,0.1)',
                        border: '1px solid rgba(224,154,32,0.25)',
                        borderRadius: 4, padding: '2px 8px', whiteSpace: 'nowrap',
                      }}>
                        {nodeOrgMap[selectedId]}
                      </span>
                    )}
                  </div>

                  {/* Compare node selector */}
                  {compareMode && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--txt3)', fontWeight: 500 }}>vs</span>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#38bdf8', flexShrink: 0, display: 'inline-block' }} />
                      <select
                        value={compareId}
                        onChange={e => handleCompareChange(e.target.value)}
                        style={{
                          background: 'var(--surf)', border: '1px solid rgba(56,189,248,0.4)',
                          borderRadius: 6, color: '#38bdf8',
                          fontFamily: 'var(--ff-sans)', fontSize: '0.8rem', fontWeight: 500,
                          padding: '5px 10px', outline: 'none', cursor: 'pointer',
                        }}
                      >
                        {nodes.filter(n => n.node_id !== selectedId).map(n => (
                          <option key={n.node_id} value={n.node_id}>{n.node_id}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Compare toggle */}
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
              )}
            </div>

            {/* Right: user info + live status + nav */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
              {currentUser && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--txt)' }}>
                      {currentUser.email}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--txt3)', marginTop: 2 }}>
                      {currentUser.org_name} · <span style={{ color: 'var(--accent)', textTransform: 'capitalize' }}>{currentUser.role}</span>
                    </div>
                  </div>
                  <a
                    href="/users"
                    title="View all users"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 32, height: 32, borderRadius: '50%',
                      background: 'linear-gradient(135deg, var(--surf2), var(--surf))',
                      border: '1px solid var(--border-hi)',
                      color: 'var(--txt)', textDecoration: 'none', fontSize: '0.78rem',
                      fontWeight: 700, flexShrink: 0,
                    }}
                  >
                    {currentUser.email[0].toUpperCase()}
                  </a>
                  <ThemeToggle />
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {lastUpdated && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.15)', borderRadius: 20 }}>
                    <span className="live-dot" />
                    <span style={{ fontSize: '0.72rem', color: '#4ade80', fontWeight: 600 }}>
                      {lastUpdated}
                    </span>
                  </div>
                )}
                <a href="/overview" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--txt2)', textDecoration: 'none', padding: '4px 12px', border: '1px solid var(--border)', borderRadius: 20, transition: 'all 0.15s' }}
                  onMouseEnter={e => { const a = e.currentTarget as HTMLAnchorElement; a.style.color='var(--txt)'; a.style.borderColor='var(--border-hi)'; }}
                  onMouseLeave={e => { const a = e.currentTarget as HTMLAnchorElement; a.style.color='var(--txt2)'; a.style.borderColor='var(--border)'; }}>
                  ← Overview
                </a>
                <a href="/logs" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--txt2)', textDecoration: 'none', padding: '4px 12px', border: '1px solid var(--border)', borderRadius: 20, transition: 'all 0.15s' }}
                  onMouseEnter={e => { const a = e.currentTarget as HTMLAnchorElement; a.style.color='var(--txt)'; a.style.borderColor='var(--border-hi)'; }}
                  onMouseLeave={e => { const a = e.currentTarget as HTMLAnchorElement; a.style.color='var(--txt2)'; a.style.borderColor='var(--border)'; }}>
                  Logs
                </a>
                <a href="/nodes" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--txt2)', textDecoration: 'none', padding: '4px 12px', border: '1px solid var(--border)', borderRadius: 20, transition: 'all 0.15s' }}
                  onMouseEnter={e => { const a = e.currentTarget as HTMLAnchorElement; a.style.color='var(--txt)'; a.style.borderColor='var(--border-hi)'; }}
                  onMouseLeave={e => { const a = e.currentTarget as HTMLAnchorElement; a.style.color='var(--txt2)'; a.style.borderColor='var(--border)'; }}>
                  Nodes
                </a>
              </div>
            </div>
          </div>
          <div style={{ height: 1, background: 'var(--border)', marginTop: 24 }} />
        </div>

        {/* Loading */}
        {!initialized && (
          <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--txt2)', fontSize: '0.9rem' }}>
            Connecting to UEI Cloud…
          </div>
        )}

        {initialized && currentNode && (
          <>
            {/* Fault Banner */}
            {currentNode.fault_active && (
              <div style={{
                marginBottom: 24,
                background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)',
                borderRadius: 'var(--r)', padding: '14px 18px',
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--err)', flexShrink: 0 }} />
                <div>
                  <p style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--err)', margin: 0 }}>
                    Fault Active — {currentNode.bms_id}
                  </p>
                  <p style={{ fontSize: '0.75rem', color: 'rgba(248,113,113,0.6)', margin: '3px 0 0' }}>
                    Last cleared {fmt(currentNode.faults_cleared_min)} minutes ago
                  </p>
                </div>
              </div>
            )}

            {/* Telemetry */}
            <SectionLabel>
              {compareMode ? 'Node Comparison' : 'Telemetry'}
              {stale && <span style={{ marginLeft: 10, fontSize: '0.68rem', color: 'var(--txt3)', fontWeight: 400 }}>— last known data</span>}
            </SectionLabel>

            {!compareMode && (
              <div className="metrics-grid">
                <MetricCard label="State of Charge" value={fmt(currentNode.soc)}              unit="%" bar={currentNode.soc}
                  highlight={currentNode.soc >= 30 ? 'normal' : currentNode.soc >= 15 ? 'warning' : 'danger'} />
                <MetricCard label="Pack Voltage"    value={fmt(currentNode.pack_voltage)}    unit="V" />
                <MetricCard label="Pack Current"    value={fmt(currentNode.pack_current)}    unit="A" />
                <MetricCard label="Temp High"       value={fmt(currentNode.temp_high)}       unit="°C"
                  highlight={currentNode.temp_high > 45 ? 'danger' : 'normal'} />
                <MetricCard label="Temp Low"        value={fmt(currentNode.temp_low)}        unit="°C" />
                <MetricCard label="Highest Cell"    value={fmt(currentNode.highest_cell_v, 3)} unit="V" />
                <MetricCard label="Lowest Cell"     value={fmt(currentNode.lowest_cell_v, 3)}  unit="V" />
                <MetricCard label="CCL"             value={fmt(currentNode.ccl)}             unit="A" />
                <MetricCard label="DCL"             value={fmt(currentNode.dcl)}             unit="A" />
                <MetricCard label="Fault Status"    value={currentNode.fault_active ? 'Active' : 'Clear'}
                  highlight={currentNode.fault_active ? 'danger' : 'success'} />
              </div>
            )}

            {compareMode && (() => {
              const cmpNode = nodes.find(n => n.node_id === compareId);
              return (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 8 }}>
                  {[
                    { node: currentNode, label: selectedId, accent: '#e09a20', border: 'rgba(224,154,32,0.25)', bg: 'rgba(224,154,32,0.06)' },
                    { node: cmpNode,     label: compareId,  accent: '#38bdf8', border: 'rgba(56,189,248,0.25)',  bg: 'rgba(56,189,248,0.06)'  },
                  ].map(({ node, label, accent, border, bg }) => (
                    <div key={label} style={{ border: `1px solid ${border}`, borderRadius: 'var(--r)', overflow: 'hidden' }}>
                      <div style={{ padding: '10px 16px', background: bg, borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent, flexShrink: 0, display: 'inline-block', boxShadow: `0 0 8px ${accent}` }} />
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: accent, fontFamily: 'var(--ff-mono)', letterSpacing: '0.02em' }}>{label}</span>
                      </div>
                      {node ? (
                        <div className="metrics-grid-compact-scroll" style={{ padding: 12 }}>
                          <div className="metrics-grid-compact">
                            <MetricCard label="SOC"          value={fmt(node.soc)}              unit="%" bar={node.soc}
                              highlight={node.soc >= 30 ? 'normal' : node.soc >= 15 ? 'warning' : 'danger'} />
                            <MetricCard label="Pack Voltage"  value={fmt(node.pack_voltage)}    unit="V" />
                            <MetricCard label="Pack Current"  value={fmt(node.pack_current)}    unit="A" />
                            <MetricCard label="Temp High"     value={fmt(node.temp_high)}       unit="°C"
                              highlight={node.temp_high > 45 ? 'danger' : 'normal'} />
                            <MetricCard label="Temp Low"      value={fmt(node.temp_low)}        unit="°C" />
                            <MetricCard label="Highest Cell"  value={fmt(node.highest_cell_v, 3)} unit="V" />
                            <MetricCard label="Lowest Cell"   value={fmt(node.lowest_cell_v, 3)}  unit="V" />
                            <MetricCard label="CCL"           value={fmt(node.ccl)}             unit="A" />
                            <MetricCard label="DCL"           value={fmt(node.dcl)}             unit="A" />
                            <MetricCard label="Fault"         value={node.fault_active ? 'Active' : 'Clear'}
                              highlight={node.fault_active ? 'danger' : 'success'} />
                          </div>
                        </div>
                      ) : (
                        <div style={{ padding: 24, fontSize: '0.82rem', color: 'var(--txt3)', textAlign: 'center' }}>No data</div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* ── Edge Algorithms (CAC + RDA) ── */}
            {(cacOutput || rdaOutput) && (
              <>
                <SectionLabel>Edge Algorithms</SectionLabel>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 24 }}>

                  {/* CAC */}
                  {cacOutput && (() => {
                    const actionColor: Record<string, string> = {
                      NORMAL:               'var(--ok)',
                      PRIORITIZE_DISCHARGE: '#38bdf8',
                      CAP_OUTPUT:           'var(--warn)',
                      TEMP_WARN_DERATE:     'var(--warn)',
                      OVERTEMP_DERATE:      'var(--err)',
                      FAULT_DERATE:         'var(--err)',
                    };
                    const col = actionColor[cacOutput.action] ?? 'var(--txt2)';
                    const thermalColor = cacOutput.thermal_directive === 'NONE' ? 'var(--txt3)'
                      : cacOutput.thermal_directive === 'FAULT_ACTIVE' ? 'var(--err)' : 'var(--warn)';
                    return (
                      <div style={{ background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '16px 20px' }}>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--txt2)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 14 }}>
                          CAC · Adaptive Control
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                          <span style={{ padding: '3px 10px', borderRadius: 99, fontSize: '0.7rem', fontWeight: 700, background: col + '22', color: col, letterSpacing: '0.03em' }}>
                            {cacOutput.action.replace(/_/g, ' ')}
                          </span>
                          <span style={{ fontSize: '0.65rem', color: 'var(--txt3)', fontFamily: 'var(--ff-mono)' }}>src: {cacOutput.profile_source}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <span style={{ fontSize: '0.72rem', color: 'var(--txt2)' }}>Adjusted limit</span>
                            <span style={{ fontFamily: 'var(--ff-mono)', fontSize: '0.88rem', fontWeight: 700, color: col }}>{cacOutput.adjusted_current_limit} A</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <span style={{ fontSize: '0.72rem', color: 'var(--txt2)' }}>Thermal directive</span>
                            <span style={{ fontFamily: 'var(--ff-mono)', fontSize: '0.72rem', fontWeight: 600, color: thermalColor }}>
                              {cacOutput.thermal_directive.replace(/_/g, ' ')}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* RDA */}
                  {rdaOutput && (() => {
                    const rdaColor = rdaOutput.derating_level === 'CRITICAL' ? 'var(--err)'
                      : rdaOutput.derating_level === 'WARNING' ? 'var(--warn)' : 'var(--ok)';
                    const rdaBorder = rdaOutput.alert_flag
                      ? (rdaOutput.derating_level === 'CRITICAL' ? 'rgba(248,113,113,0.35)' : 'rgba(251,146,60,0.35)')
                      : 'var(--border)';
                    return (
                      <div style={{ background: 'var(--surf)', border: `1px solid ${rdaBorder}`, borderRadius: 'var(--r)', padding: '16px 20px' }}>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--txt2)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 14 }}>
                          RDA · Risk Score
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                          <span style={{ fontFamily: 'var(--ff-mono)', fontSize: '2rem', fontWeight: 800, color: rdaColor, lineHeight: 1 }}>
                            {rdaOutput.risk_score}
                          </span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--txt3)' }}>/100</span>
                          <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: '0.66rem', fontWeight: 700, background: rdaColor + '22', color: rdaColor }}>
                            {rdaOutput.derating_level}
                          </span>
                        </div>
                        <div style={{ height: 5, borderRadius: 99, background: 'var(--surf2)', marginBottom: 12, overflow: 'hidden' }}>
                          <div style={{ height: '100%', borderRadius: 99, background: rdaColor, width: `${rdaOutput.risk_score}%`, transition: 'width 0.4s ease' }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <span style={{ fontSize: '0.72rem', color: 'var(--txt2)' }}>Power cap</span>
                          <span style={{ fontFamily: 'var(--ff-mono)', fontSize: '0.95rem', fontWeight: 700, color: rdaColor }}>
                            {(rdaOutput.derating_factor * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </>
            )}

            {/* ── RHF Battery Health Forecast ── */}
            {forecast && forecast.current_soh != null && (() => {
              const soh = forecast.current_soh;
              const sohColor = soh >= 80 ? 'var(--ok)' : soh >= 60 ? 'var(--warn)' : 'var(--err)';
              function sohFmtColor(v: number) {
                return v >= 80 ? 'var(--ok)' : v >= 60 ? 'var(--warn)' : 'var(--err)';
              }
              return (
                <>
                  <SectionLabel>Battery Health Forecast</SectionLabel>
                  <div style={{ background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '18px 20px', marginBottom: 24 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 20, alignItems: 'end' }}>
                      {/* Current SoH */}
                      <div>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--txt2)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 6 }}>
                          Current SoH
                        </div>
                        <div style={{ fontFamily: 'var(--ff-mono)', fontSize: '2.4rem', fontWeight: 800, color: sohColor, lineHeight: 1 }}>
                          {soh.toFixed(1)}<span style={{ fontSize: '1rem', fontWeight: 500, marginLeft: 2 }}>%</span>
                        </div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--txt3)', marginTop: 6, fontFamily: 'var(--ff-mono)' }}>
                          last computed {new Date(forecast.computed_at).toLocaleDateString()}
                        </div>
                      </div>
                      {/* Forecasts */}
                      {([
                        { label: '30-Day', value: forecast.forecast_30d },
                        { label: '60-Day', value: forecast.forecast_60d },
                        { label: '90-Day', value: forecast.forecast_90d },
                      ] as { label: string; value: number | undefined }[]).map(({ label, value }) => (
                        <div key={label} style={{ borderLeft: '1px solid var(--border)', paddingLeft: 16 }}>
                          <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--txt3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
                          <div style={{ fontFamily: 'var(--ff-mono)', fontSize: '1.35rem', fontWeight: 700, color: value != null ? sohFmtColor(value) : 'var(--txt3)' }}>
                            {value != null ? value.toFixed(1) : '—'}<span style={{ fontSize: '0.75rem', fontWeight: 500 }}>%</span>
                          </div>
                          <div style={{ fontSize: '0.65rem', color: 'var(--txt3)', marginTop: 4 }}>
                            Δ {value != null ? (value - soh).toFixed(2) : '—'}%
                          </div>
                        </div>
                      ))}
                    </div>
                    {forecast.stress_summary && typeof forecast.stress_summary === 'object' && (
                      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                        {[
                          { k: 'days_analyzed',      label: 'Days analysed' },
                          { k: 'avg_temp_high',       label: 'Avg temp' },
                          { k: 'avg_dod',             label: 'Avg DoD' },
                          { k: 'avg_daily_soh_loss',  label: 'Daily SoH loss' },
                        ].map(({ k, label }) => {
                          const raw = (forecast.stress_summary as Record<string, unknown>)[k];
                          if (raw === undefined) return null;
                          const n = Number(raw);
                          return (
                            <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{ fontSize: '0.62rem', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
                              <span style={{ fontFamily: 'var(--ff-mono)', fontSize: '0.82rem', fontWeight: 600, color: 'var(--txt2)' }}>
                                {k === 'avg_daily_soh_loss' ? n.toFixed(4) + '%' : k === 'avg_temp_high' ? n.toFixed(1) + ' °C' : k === 'avg_dod' ? n.toFixed(1) + '%' : n}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}

            {/* ── Carbon Emissions ── */}
            {carbonSummary && (() => {
              const netSaved   = carbonSummary.net_co2_saved_g;
              const solarPct   = carbonSummary.solar_fraction * 100;
              const netColor   = netSaved >= 0 ? 'var(--ok)' : 'var(--err)';
              const solarColor = solarPct >= 50 ? 'var(--ok)' : solarPct >= 20 ? 'var(--warn)' : 'var(--txt2)';
              return (
                <>
                  <SectionLabel>Carbon Emissions · Last Hour</SectionLabel>
                  <div style={{ background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '18px 20px', marginBottom: 24 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}>
                      {/* CO₂ Emitted */}
                      <div>
                        <div style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 6 }}>CO₂ Emitted</div>
                        <div style={{ fontFamily: 'var(--ff-mono)', fontSize: '1.6rem', fontWeight: 800, color: 'var(--err)', lineHeight: 1 }}>
                          {(carbonSummary.co2_g / 1000).toFixed(3)}
                          <span style={{ fontSize: '0.72rem', fontWeight: 500, marginLeft: 4 }}>kg</span>
                        </div>
                        <div style={{ fontSize: '0.62rem', color: 'var(--txt3)', marginTop: 4 }}>
                          {carbonSummary.co2_g.toFixed(1)} g total
                        </div>
                      </div>
                      {/* CO₂ Avoided */}
                      <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: 16 }}>
                        <div style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 6 }}>CO₂ Avoided</div>
                        <div style={{ fontFamily: 'var(--ff-mono)', fontSize: '1.6rem', fontWeight: 800, color: 'var(--ok)', lineHeight: 1 }}>
                          {(carbonSummary.co2_avoided_g / 1000).toFixed(3)}
                          <span style={{ fontSize: '0.72rem', fontWeight: 500, marginLeft: 4 }}>kg</span>
                        </div>
                        <div style={{ fontSize: '0.62rem', color: 'var(--txt3)', marginTop: 4 }}>
                          by solar generation
                        </div>
                      </div>
                      {/* Net Impact */}
                      <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: 16 }}>
                        <div style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 6 }}>Net Impact</div>
                        <div style={{ fontFamily: 'var(--ff-mono)', fontSize: '1.6rem', fontWeight: 800, color: netColor, lineHeight: 1 }}>
                          {netSaved >= 0 ? '+' : ''}{(netSaved / 1000).toFixed(3)}
                          <span style={{ fontSize: '0.72rem', fontWeight: 500, marginLeft: 4 }}>kg</span>
                        </div>
                        <div style={{ fontSize: '0.62rem', color: 'var(--txt3)', marginTop: 4 }}>
                          {netSaved >= 0 ? 'net saved' : 'net emitted'}
                        </div>
                      </div>
                      {/* Solar Fraction */}
                      <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: 16 }}>
                        <div style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 6 }}>Solar Fraction</div>
                        <div style={{ fontFamily: 'var(--ff-mono)', fontSize: '1.6rem', fontWeight: 800, color: solarColor, lineHeight: 1 }}>
                          {solarPct.toFixed(1)}
                          <span style={{ fontSize: '0.72rem', fontWeight: 500, marginLeft: 2 }}>%</span>
                        </div>
                        <div style={{ height: 4, borderRadius: 99, background: 'var(--surf2)', marginTop: 8, overflow: 'hidden' }}>
                          <div style={{ height: '100%', borderRadius: 99, background: solarColor, width: `${Math.min(100, solarPct)}%`, transition: 'width 0.4s ease' }} />
                        </div>
                      </div>
                    </div>
                    {/* Footer row */}
                    <div style={{ paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                      {[
                        { label: 'Grid Import', value: carbonSummary.total_grid_kwh.toFixed(4) + ' kWh' },
                        { label: 'Solar Gen',   value: carbonSummary.total_solar_kwh.toFixed(4) + ' kWh' },
                        { label: 'Intensity',   value: carbonSummary.carbon_intensity.toFixed(0) + ' gCO₂/kWh' },
                        { label: 'Intervals',   value: String(carbonSummary.interval_count) },
                      ].map(({ label, value }) => (
                        <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: '0.62rem', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
                          <span style={{ fontFamily: 'var(--ff-mono)', fontSize: '0.82rem', fontWeight: 600, color: 'var(--txt2)' }}>{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              );
            })()}

            {/* History */}
            <SectionLabel>Historical Data</SectionLabel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--txt2)', fontWeight: 500, marginRight: 4 }}>Range</span>
              {(['5m', '15m', '30m', '1h', '6h', '24h'] as const).map(r => (
                <button key={r} onClick={() => handleRangeChange(r)} style={{
                  fontFamily: 'var(--ff-sans)', fontSize: '0.78rem', fontWeight: 500,
                  padding: '5px 14px', borderRadius: 99,
                  background: timeRange === r ? 'var(--accent)' : 'transparent',
                  color:      timeRange === r ? '#111' : 'var(--txt2)',
                  border:    `1px solid ${timeRange === r ? 'var(--accent)' : 'var(--border)'}`,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}>{r}</button>
              ))}
            </div>

            {/* Charts */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { title: 'State of Charge', canvasRef: socRef },
                { title: 'Pack Voltage',    canvasRef: voltRef },
                { title: 'Temperature',     canvasRef: tempRef },
              ].map(({ title, canvasRef }) => (
                <div key={title} style={{
                  background: 'var(--surf)', border: '1px solid var(--border)',
                  borderRadius: 'var(--r)', padding: '18px 20px',
                }}>
                  <p style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--txt2)', margin: '0 0 14px' }}>{title}</p>
                  <div className="chart-container"><canvas ref={canvasRef} /></div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div style={{ marginTop: 40, paddingTop: 20, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--txt3)', fontWeight: 500 }}>
                UEI Cloud · Unified Energy Interface ·{' '}
                {compareMode
                  ? <><span style={{ color: '#e09a20' }}>{selectedId}</span> vs <span style={{ color: '#38bdf8' }}>{compareId}</span></>
                  : currentNode.node_id ?? '—'}
              </span>
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
          </>
        )}
      </div>

      {/* ── Chat Bubble ── */}
      <button onClick={() => setChatOpen(o => !o)} title="Ask AI about your data" style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 50,
        width: 52, height: 52,
        background: chatOpen ? 'var(--surf2)' : 'var(--accent)',
        border: chatOpen ? '1px solid var(--border-hi)' : 'none',
        borderRadius: 14, color: chatOpen ? 'var(--txt)' : '#111',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', transition: 'all 0.2s',
        boxShadow: chatOpen ? 'none' : '0 4px 20px rgba(224,154,32,0.35)',
      }}>
        {chatOpen ? (
          <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        ) : (
          <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/>
          </svg>
        )}
      </button>

      {/* ── Chat Panel ── */}
      {chatOpen && (
        <div style={{
          position: 'fixed', bottom: 88, right: 24, zIndex: 50,
          width: 380, height: 560,
          background: '#1a1a18', border: '1px solid var(--border)',
          borderRadius: 14, display: 'flex', flexDirection: 'column',
          overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
        }}>
          {/* Panel Header */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--txt)', margin: 0 }}>Data Assistant</p>
              <p style={{ fontSize: '0.72rem', color: 'var(--txt2)', margin: '2px 0 0' }}>Ask about your energy data</p>
            </div>
            <button onClick={newChat} style={{
              fontFamily: 'var(--ff-sans)', fontSize: '0.72rem', fontWeight: 600,
              background: 'transparent', border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--txt2)', padding: '4px 10px', cursor: 'pointer',
            }}>New chat</button>
          </div>

          {/* Messages */}
          <div ref={chatBoxRef} style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {showSuggestions && chatHistory.length === 0 && !streamingState && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <p style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--txt2)', textAlign: 'center', marginBottom: 4 }}>Suggestions</p>
                {[
                  'How many nodes are reporting?',
                  'Show the latest SOC for all nodes',
                  'Are there any active faults?',
                  'What is the average pack voltage?',
                  'Which node has the highest energy output?',
                ].map(s => (
                  <button key={s} className="sug-btn" onClick={() => sendChat(s)}>{s}</button>
                ))}
              </div>
            )}

            {chatHistory.map((msg, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '86%', padding: '10px 14px',
                  fontSize: '0.82rem', lineHeight: '1.55',
                  ...(msg.role === 'user' ? {
                    background: 'rgba(224,154,32,0.12)', border: '1px solid rgba(224,154,32,0.2)',
                    borderRadius: '12px 12px 3px 12px', color: 'var(--txt)',
                  } : {
                    background: 'var(--surf2)', border: '1px solid var(--border)',
                    borderRadius: '3px 12px 12px 12px', color: 'var(--txt2)',
                  }),
                }}>
                  {msg.role === 'assistant' && msg.queries?.map((q, qi) => <QueryBadge key={qi} q={q} />)}
                  {msg.role === 'assistant'
                    ? <div dangerouslySetInnerHTML={{ __html: renderMd(msg.text) }} />
                    : msg.text}
                </div>
              </div>
            ))}

            {streamingState && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{
                  maxWidth: '86%', padding: '10px 14px', fontSize: '0.82rem', lineHeight: '1.55',
                  background: 'var(--surf2)', border: '1px solid var(--border)',
                  borderRadius: '3px 12px 12px 12px', color: 'var(--txt2)',
                }}>
                  {streamingState.queries.map((q, qi) => <QueryBadge key={qi} q={q} />)}
                  {streamingState.text
                    ? <div dangerouslySetInnerHTML={{ __html: renderMd(streamingState.text) }} />
                    : <span style={{ color: 'var(--txt3)', fontStyle: 'italic' }}>Thinking…</span>}
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <form onSubmit={e => { e.preventDefault(); sendChat(chatInput); }} style={{ display: 'flex', gap: 8, padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              placeholder="Ask about your energy data…"
              autoComplete="off"
              style={{
                flex: 1, background: 'rgba(255,255,255,0.05)',
                border: '1px solid var(--border)', borderRadius: 8,
                color: 'var(--txt)', fontFamily: 'var(--ff-sans)',
                fontSize: '0.85rem', padding: '8px 12px', outline: 'none',
              }}
            />
            <button type="submit" disabled={chatBusy} style={{
              background: chatBusy ? 'var(--surf2)' : 'var(--accent)',
              color: chatBusy ? 'var(--txt2)' : '#111',
              fontFamily: 'var(--ff-sans)', fontSize: '0.82rem', fontWeight: 600,
              padding: '8px 14px', border: 'none', borderRadius: 8,
              cursor: chatBusy ? 'not-allowed' : 'pointer', flexShrink: 0,
            }}>Send</button>
          </form>
        </div>
      )}
    </>
  );
}
