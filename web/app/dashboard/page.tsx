'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';

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

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false as const,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#252523',
      titleColor: '#88887e',
      bodyColor: '#e8e8e6',
      borderColor: 'rgba(255,255,255,0.1)',
      borderWidth: 1,
      cornerRadius: 6,
      titleFont: { family: "'DM Mono', monospace", size: 11 },
      bodyFont:  { family: "'DM Mono', monospace", size: 11 },
    },
  },
  scales: {
    x: {
      ticks: { color: '#454540', maxTicksLimit: 6, font: { size: 11, family: "'DM Mono', monospace" } },
      grid:  { color: 'rgba(255,255,255,0.04)' },
      border: { color: 'rgba(255,255,255,0.06)' },
    },
    y: {
      ticks: { color: '#454540', font: { size: 11, family: "'DM Mono', monospace" } },
      grid:  { color: 'rgba(255,255,255,0.04)' },
      border: { color: 'rgba(255,255,255,0.06)' },
    },
  },
};

// ── Sub-components ─────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--txt2)', marginBottom: 14 }}>
      {children}
    </p>
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

  // ── Charts ──────────────────────────────────────────────────

  const initCharts = useCallback(() => {
    if (!socRef.current || !voltRef.current || !tempRef.current) return;
    chartsRef.current.soc     = new Chart(socRef.current,  { type: 'line', data: { labels: [], datasets: [] }, options: { ...CHART_DEFAULTS } });
    chartsRef.current.voltage = new Chart(voltRef.current, { type: 'line', data: { labels: [], datasets: [] }, options: { ...CHART_DEFAULTS } });
    chartsRef.current.temp    = new Chart(tempRef.current, { type: 'line', data: { labels: [], datasets: [] }, options: { ...CHART_DEFAULTS } });
  }, []);

  function updateChart(
    chart: Chart,
    data: Record<string, number>[],
    lines: { key: string; label: string; color: string }[],
    range: string,
  ) {
    if (!data?.length) return;
    const shortRange = range === '5m' || range === '15m' || range === '30m';
    chart.data.labels = data.map(d => {
      const t = new Date(d.time);
      return shortRange
        ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    });
    chart.data.datasets = lines.map(l => ({
      label: l.label, data: data.map(d => d[l.key]),
      borderColor: l.color, backgroundColor: l.color + '18',
      borderWidth: 2, pointRadius: 0, fill: true, tension: 0.4,
    }));
    const maxTicks = shortRange ? 8 : range === '24h' ? 8 : 6;
    (chart.options.scales!.x as { ticks: { maxTicksLimit: number } }).ticks.maxTicksLimit = maxTicks;
    chart.update('none');
  }

  // ── Data fetching ───────────────────────────────────────────

  const fetchCharts = useCallback(async (id: string, range: string) => {
    if (!id) return;
    const base = `/api/metrics?node_id=${encodeURIComponent(id)}&range=${range}`;
    try {
      const [soc, volt, temp] = await Promise.all([
        fetch(`${base}&metric=soc`,          { cache: 'no-store' }).then(r => r.json()),
        fetch(`${base}&metric=pack_voltage`, { cache: 'no-store' }).then(r => r.json()),
        fetch(`${base}&metric=temperature`,  { cache: 'no-store' }).then(r => r.json()),
      ]);
      if (chartsRef.current.soc)     updateChart(chartsRef.current.soc,     soc,  [{ key: 'value', label: 'SOC',     color: '#e09a20' }], range);
      if (chartsRef.current.voltage) updateChart(chartsRef.current.voltage, volt, [{ key: 'value', label: 'Voltage', color: '#a78bfa' }], range);
      if (chartsRef.current.temp)    updateChart(chartsRef.current.temp,    temp, [
        { key: 'high', label: 'Temp High', color: '#f87171' },
        { key: 'low',  label: 'Temp Low',  color: '#60a5fa' },
      ], range);
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
      setSelectedId(rows[0].node_id);
      console.log('[UEI] Dashboard initialized with node:', rows[0].node_id);
      setTimeout(() => {
        initCharts();
        fetchCharts(rows[0].node_id, '1h');
      }, 50);
    }
  }

  // Fetch current user on mount
  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setCurrentUser(data); })
      .catch(() => {});
  }, []);

  // Keep refs in sync so intervals never have stale closures
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { timeRangeRef.current  = timeRange;  }, [timeRange]);

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
      if (initializedRef.current) fetchCharts(selectedIdRef.current, timeRangeRef.current);
    }, 500);

    return () => { es?.close(); clearInterval(i2); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (chatBoxRef.current) chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
  }, [streamingState, chatHistory]);

  // ── Auth ────────────────────────────────────────────────────

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  // ── Helpers ─────────────────────────────────────────────────

  const currentNode = nodes.find(n => n.node_id === selectedId);

  function handleRangeChange(r: '5m' | '15m' | '30m' | '1h' | '6h' | '24h') {
    setTimeRange(r);
    fetchCharts(selectedId, r);
  }

  function handleNodeChange(id: string) {
    setSelectedId(id);
    fetchCharts(id, timeRange);
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <p style={{ fontSize: '0.72rem', fontWeight: 500, color: 'var(--txt3)', margin: '0 0 6px' }}>
                Unified Energy Interface
              </p>
              <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--txt)', margin: 0, letterSpacing: '-0.02em', lineHeight: 1 }}>
                UEI Cloud
              </h1>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
              {/* User + org pill */}
              {currentUser && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--txt)' }}>
                      {currentUser.email}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--txt3)', marginTop: 1 }}>
                      {currentUser.org_name} · <span style={{ color: 'var(--accent)', textTransform: 'capitalize' }}>{currentUser.role}</span>
                    </div>
                  </div>
                  <a
                    href="/users"
                    title="View all users"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 30, height: 30, borderRadius: '50%',
                      background: 'var(--surf2)', border: '1px solid var(--border)',
                      color: 'var(--txt2)', textDecoration: 'none', fontSize: '0.75rem',
                      fontWeight: 700, flexShrink: 0,
                    }}
                  >
                    {currentUser.email[0].toUpperCase()}
                  </a>
                </div>
              )}
              {lastUpdated && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span className="live-dot" />
                  <span style={{ fontSize: '0.78rem', color: 'var(--txt2)', fontWeight: 500 }}>
                    Updated {lastUpdated}
                  </span>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {initialized && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--txt2)', fontWeight: 500 }}>Node</label>
                    <select
                      id="node-select"
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
                  </div>
                )}
              </div>
              <button
                onClick={handleLogout}
                style={{
                  alignSelf: 'flex-end',
                  fontFamily: 'var(--ff-sans)', fontSize: '0.75rem', fontWeight: 600,
                  background: 'transparent', border: '1px solid var(--border)',
                  borderRadius: 6, color: 'var(--txt3)', padding: '5px 12px',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                Sign out
              </button>
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
            <SectionLabel>Telemetry{stale && <span style={{ marginLeft: 10, fontSize: '0.68rem', color: 'var(--txt3)', fontWeight: 400 }}>— last known data</span>}</SectionLabel>
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
            <div style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid var(--border)', textAlign: 'center', fontSize: '0.72rem', color: 'var(--txt3)', fontWeight: 500 }}>
              UEI Cloud · Unified Energy Interface · {currentNode.node_id ?? '—'}
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
