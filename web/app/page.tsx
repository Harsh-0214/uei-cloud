'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

// ── Types ──────────────────────────────────────────────────────

interface TelemetryRow {
  node_id: string;
  bms_id: string;
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
      '<pre style="background:rgba(0,200,240,0.04);border:1px solid rgba(0,200,240,0.12);padding:8px;font-size:0.7rem;overflow-x:auto;margin:6px 0;font-family:\'Share Tech Mono\',monospace;color:#c8dff0">$1</pre>',
    )
    .replace(
      /`([^`]+)`/g,
      '<code style="background:rgba(0,200,240,0.07);padding:1px 5px;font-family:\'Share Tech Mono\',monospace;font-size:0.8em">$1</code>',
    )
    .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#c8dff0">$1</strong>')
    .replace(/^\s*[-*]\s+(.+)$/gm, '<li style="margin-left:12px;margin-bottom:2px">$1</li>')
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
      backgroundColor: '#0a1520',
      titleColor: '#4d7a9a',
      bodyColor: '#c8dff0',
      borderColor: 'rgba(0, 200, 240, 0.15)',
      borderWidth: 1,
      cornerRadius: 0,
      titleFont: { family: "'Share Tech Mono', monospace", size: 10 },
      bodyFont:  { family: "'Share Tech Mono', monospace", size: 10 },
    },
  },
  scales: {
    x: {
      ticks: { color: '#253a4e', maxTicksLimit: 6, font: { size: 10, family: "'Share Tech Mono', monospace" } },
      grid:  { color: 'rgba(0, 200, 240, 0.05)' },
      border: { color: 'rgba(0, 200, 240, 0.08)' },
    },
    y: {
      ticks: { color: '#253a4e', font: { size: 10, family: "'Share Tech Mono', monospace" } },
      grid:  { color: 'rgba(0, 200, 240, 0.05)' },
      border: { color: 'rgba(0, 200, 240, 0.08)' },
    },
  },
};

// ── Sub-components ─────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      marginBottom: 12,
      fontFamily: 'var(--ff-ui)', fontSize: '0.58rem',
      color: 'var(--c-txt3)', letterSpacing: '0.15em', textTransform: 'uppercase',
    }}>
      <span>{children}</span>
      <div style={{ flex: 1, height: 1, background: 'rgba(0, 200, 240, 0.07)' }} />
    </div>
  );
}

function QueryBadge({ q }: { q: { sql: string; rows: number } }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 6,
      background: 'rgba(0, 200, 240, 0.03)',
      border: '1px solid rgba(0, 200, 240, 0.1)',
      padding: '4px 8px', marginBottom: 5,
      fontFamily: "'Share Tech Mono', monospace", fontSize: '0.63rem',
      color: 'rgba(0, 229, 255, 0.55)', wordBreak: 'break-all',
    }}>
      <span style={{ color: '#00e5ff', flexShrink: 0 }}>▶</span>
      <span>{q.sql.trim()}</span>
      <span style={{ color: '#253a4e', marginLeft: 'auto', paddingLeft: 6, flexShrink: 0 }}>{q.rows}r</span>
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
  const valColor = {
    normal:  'var(--c-txt)',
    warning: 'var(--c-warn)',
    danger:  'var(--c-err)',
    success: 'var(--c-ok)',
  }[highlight];
  const barColor = {
    normal:  'var(--c-accent)',
    warning: 'var(--c-warn)',
    danger:  'var(--c-err)',
    success: 'var(--c-ok)',
  }[highlight];
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
  const [nodes,      setNodes]      = useState<TelemetryRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [timeRange,  setTimeRange]  = useState<'1h' | '6h' | '24h'>('1h');
  const [initialized, setInitialized] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');

  const [chatOpen,       setChatOpen]       = useState(false);
  const [chatBusy,       setChatBusy]       = useState(false);
  const [chatInput,      setChatInput]      = useState('');
  const [chatHistory,    setChatHistory]    = useState<ChatMsg[]>([]);
  const [streamingState, setStreamingState] = useState<StreamingState | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(true);

  const socRef    = useRef<HTMLCanvasElement>(null);
  const voltRef   = useRef<HTMLCanvasElement>(null);
  const tempRef   = useRef<HTMLCanvasElement>(null);
  const chartsRef = useRef<Record<string, Chart>>({});
  const chatBoxRef     = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

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
  ) {
    if (!data?.length) return;
    chart.data.labels = data.map(d => new Date(d.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    chart.data.datasets = lines.map(l => ({
      label: l.label,
      data: data.map(d => d[l.key]),
      borderColor: l.color,
      backgroundColor: l.color + '14',
      borderWidth: 1.5,
      pointRadius: 0,
      fill: true,
      tension: 0.3,
    }));
    chart.update('none');
  }

  // ── Data fetching ───────────────────────────────────────────

  const fetchCharts = useCallback(async (id: string, range: string) => {
    if (!id) return;
    const base = `/api/metrics?node_id=${encodeURIComponent(id)}&range=${range}`;
    try {
      const [soc, volt, temp] = await Promise.all([
        fetch(`${base}&metric=soc`).then(r => r.json()),
        fetch(`${base}&metric=pack_voltage`).then(r => r.json()),
        fetch(`${base}&metric=temperature`).then(r => r.json()),
      ]);
      if (chartsRef.current.soc)     updateChart(chartsRef.current.soc,     soc,  [{ key: 'value', label: 'SOC',     color: '#00e5ff' }]);
      if (chartsRef.current.voltage) updateChart(chartsRef.current.voltage, volt, [{ key: 'value', label: 'Voltage', color: '#b06bff' }]);
      if (chartsRef.current.temp)    updateChart(chartsRef.current.temp,    temp, [
        { key: 'high', label: 'Temp High', color: '#ff6635' },
        { key: 'low',  label: 'Temp Low',  color: '#3b9eff' },
      ]);
    } catch { /* ignore */ }
  }, []);

  const fetchLatest = useCallback(async () => {
    try {
      const resp = await fetch('/api/latest');
      const data = await resp.json();
      const rows: TelemetryRow[] = Array.isArray(data) ? data : [data];
      setNodes(rows);
      setLastUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      if (!initializedRef.current && rows.length) {
        initializedRef.current = true;
        setInitialized(true);
        setSelectedId(rows[0].node_id);
        setTimeout(() => {
          initCharts();
          fetchCharts(rows[0].node_id, '1h');
        }, 50);
      }
    } catch { /* ignore */ }
  }, [initCharts, fetchCharts]);

  useEffect(() => {
    fetchLatest();
    const i1 = setInterval(fetchLatest, 5000);
    const i2 = setInterval(() => {
      if (initializedRef.current) {
        const sel = document.getElementById('node-select') as HTMLSelectElement | null;
        fetchCharts(sel?.value ?? '', '1h');
      }
    }, 30000);
    return () => { clearInterval(i1); clearInterval(i2); };
  }, [fetchLatest, fetchCharts]);

  useEffect(() => {
    if (chatBoxRef.current) chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
  }, [streamingState, chatHistory]);

  // ── Helpers ─────────────────────────────────────────────────

  const currentNode = nodes.find(n => n.node_id === selectedId);

  function handleRangeChange(r: '1h' | '6h' | '24h') {
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

    let accumulated = '';
    let finalQueries: { sql: string; rows: number }[] = [];

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: historySnapshot.map(m => ({ role: m.role, content: m.text })) }),
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
            const t = (event.assistantText as string) || accumulated;
            setChatHistory(prev => [...prev, { role: 'assistant', text: t, queries: finalQueries }]);
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
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '28px 24px' }}>

        {/* Header */}
        <div style={{ marginBottom: 28, paddingBottom: 20, borderBottom: '1px solid rgba(0,200,240,0.08)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div style={{ fontFamily: 'var(--ff-data)', fontSize: '0.55rem', color: 'var(--c-txt3)', letterSpacing: '0.25em', marginBottom: 6, textTransform: 'uppercase' }}>
                UNIFIED ENERGY INTERFACE · CLOUD MONITOR
              </div>
              <h1 style={{ fontFamily: 'var(--ff-hud)', fontSize: '1.4rem', fontWeight: 700, color: 'var(--c-accent)', letterSpacing: '0.08em', margin: 0, lineHeight: 1 }}>
                UEI CLOUD
              </h1>
              <div style={{ fontFamily: 'var(--ff-ui)', fontSize: '0.62rem', color: 'var(--c-txt3)', marginTop: 6, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                Battery Management System Dashboard
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
              {lastUpdated && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="live-dot" />
                  <span style={{ fontFamily: 'var(--ff-data)', fontSize: '0.68rem', color: 'var(--c-txt2)' }}>{lastUpdated}</span>
                </div>
              )}
              {initialized && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--ff-ui)', fontSize: '0.6rem', color: 'var(--c-txt3)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Node</span>
                  <select
                    id="node-select"
                    value={selectedId}
                    onChange={e => handleNodeChange(e.target.value)}
                    style={{
                      background: 'var(--c-surf)',
                      border: '1px solid rgba(0,200,240,0.15)',
                      color: 'var(--c-accent)',
                      fontFamily: 'var(--ff-data)',
                      fontSize: '0.72rem',
                      padding: '4px 8px',
                      outline: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {nodes.map(n => <option key={n.node_id} value={n.node_id}>{n.node_id}</option>)}
                  </select>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Loading */}
        {!initialized && (
          <div style={{ textAlign: 'center', padding: '80px 0', fontFamily: 'var(--ff-data)', fontSize: '0.8rem', color: 'var(--c-txt3)' }}>
            <span style={{ color: 'var(--c-accent)' }}>▶</span>&nbsp;CONNECTING TO UEI CLOUD…
          </div>
        )}

        {initialized && currentNode && (
          <>
            {/* Fault Banner */}
            {currentNode.fault_active && (
              <div style={{
                marginBottom: 24,
                background: 'rgba(255,51,85,0.05)',
                border: '1px solid rgba(255,51,85,0.25)',
                borderLeft: '3px solid var(--c-err)',
                padding: '10px 16px',
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <span style={{ fontFamily: 'var(--ff-hud)', fontSize: '0.65rem', color: 'var(--c-err)', letterSpacing: '0.1em' }}>
                  ⚠ FAULT ACTIVE
                </span>
                <span style={{ fontFamily: 'var(--ff-data)', fontSize: '0.72rem', color: 'rgba(255,51,85,0.65)' }}>
                  {currentNode.bms_id} · CLEARED {fmt(currentNode.faults_cleared_min)} MIN AGO
                </span>
              </div>
            )}

            {/* Telemetry section */}
            <SectionLabel>Telemetry</SectionLabel>

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
              <MetricCard label="Fault Status"    value={currentNode.fault_active ? 'ACTIVE' : 'CLEAR'}
                highlight={currentNode.fault_active ? 'danger' : 'success'} />
            </div>

            {/* Historical section */}
            <SectionLabel>Historical Data</SectionLabel>

            {/* Time Range */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <span style={{ fontFamily: 'var(--ff-ui)', fontSize: '0.6rem', color: 'var(--c-txt3)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Range</span>
              {(['1h', '6h', '24h'] as const).map(r => (
                <button key={r} onClick={() => handleRangeChange(r)} style={{
                  fontFamily: 'var(--ff-data)', fontSize: '0.7rem',
                  padding: '3px 12px',
                  background: timeRange === r ? 'var(--c-accent)' : 'transparent',
                  color:      timeRange === r ? '#060b11'         : 'var(--c-txt2)',
                  border:    `1px solid ${timeRange === r ? 'var(--c-accent)' : 'rgba(0,200,240,0.12)'}`,
                  cursor: 'pointer',
                  fontWeight: timeRange === r ? 700 : 400,
                  transition: 'all 0.15s',
                }}>{r}</button>
              ))}
            </div>

            {/* Charts */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { title: 'STATE OF CHARGE', canvasRef: socRef },
                { title: 'PACK VOLTAGE',    canvasRef: voltRef },
                { title: 'TEMPERATURE',     canvasRef: tempRef },
              ].map(({ title, canvasRef }) => (
                <div key={title} style={{
                  background: 'var(--c-surf)',
                  border: '1px solid rgba(0,200,240,0.08)',
                  borderTop: '1px solid rgba(0,200,240,0.14)',
                  padding: '14px 16px',
                }}>
                  <div style={{ fontFamily: 'var(--ff-ui)', fontSize: '0.58rem', color: 'var(--c-txt3)', letterSpacing: '0.15em', marginBottom: 10, textTransform: 'uppercase' }}>
                    {title}
                  </div>
                  <div className="chart-container"><canvas ref={canvasRef} /></div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div style={{ marginTop: 28, paddingTop: 16, borderTop: '1px solid rgba(0,200,240,0.06)', textAlign: 'center', fontFamily: 'var(--ff-data)', fontSize: '0.6rem', color: 'var(--c-txt3)', letterSpacing: '0.1em' }}>
              UEI CLOUD PLATFORM · {currentNode.bms_id ?? '—'} · AUTO-REFRESH 5s
            </div>
          </>
        )}
      </div>

      {/* ── Chat Bubble ── */}
      <button
        onClick={() => setChatOpen(o => !o)}
        title="UEI Data Assistant"
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 50,
          width: 48, height: 48,
          background: chatOpen ? 'rgba(0,229,255,0.08)' : 'var(--c-accent)',
          border: `1px solid ${chatOpen ? 'var(--c-accent)' : 'transparent'}`,
          color: chatOpen ? 'var(--c-accent)' : '#060b11',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', transition: 'all 0.2s',
          clipPath: 'polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px)',
          boxShadow: chatOpen ? '0 0 20px rgba(0,229,255,0.18)' : '0 0 14px rgba(0,229,255,0.25)',
        }}
      >
        {chatOpen ? (
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        ) : (
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/>
          </svg>
        )}
      </button>

      {/* ── Chat Panel ── */}
      {chatOpen && (
        <div style={{
          position: 'fixed', bottom: 84, right: 24, zIndex: 50,
          width: 384, height: 560,
          background: '#070d14',
          border: '1px solid rgba(0,200,240,0.18)',
          borderBottom: '2px solid var(--c-accent)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 0 40px rgba(0,200,240,0.07)',
        }}>

          {/* Panel Header */}
          <div style={{
            padding: '10px 14px',
            borderBottom: '1px solid rgba(0,200,240,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'rgba(0,0,0,0.2)',
          }}>
            <div>
              <div style={{ fontFamily: 'var(--ff-hud)', fontSize: '0.62rem', color: 'var(--c-accent)', letterSpacing: '0.1em' }}>
                UEI DATA ASSISTANT
              </div>
              <div style={{ fontFamily: 'var(--ff-ui)', fontSize: '0.62rem', color: 'var(--c-txt3)', marginTop: 2 }}>
                Natural language telemetry queries
              </div>
            </div>
            <button onClick={newChat} style={{
              fontFamily: 'var(--ff-data)', fontSize: '0.6rem',
              background: 'transparent',
              border: '1px solid rgba(0,200,240,0.15)',
              color: 'var(--c-txt2)', padding: '3px 8px',
              cursor: 'pointer', letterSpacing: '0.08em',
            }}>RESET</button>
          </div>

          {/* Messages */}
          <div ref={chatBoxRef} style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>

            {/* Suggestions */}
            {showSuggestions && chatHistory.length === 0 && !streamingState && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ fontFamily: 'var(--ff-data)', fontSize: '0.58rem', color: 'var(--c-txt3)', letterSpacing: '0.15em', textAlign: 'center', marginBottom: 4 }}>
                  SUGGESTED QUERIES
                </div>
                {[
                  'How many nodes are reporting?',
                  'Show the latest SOC for all nodes',
                  'Are there any active faults?',
                  'What is the average pack voltage?',
                  'Show temp trends in the last hour',
                ].map(s => (
                  <button key={s} className="sug-btn" onClick={() => sendChat(s)}>{s}</button>
                ))}
              </div>
            )}

            {/* History */}
            {chatHistory.map((msg, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '88%', padding: '8px 12px',
                  fontSize: '0.75rem', lineHeight: '1.5',
                  ...(msg.role === 'user' ? {
                    background: 'rgba(0,229,255,0.07)',
                    border: '1px solid rgba(0,229,255,0.15)',
                    borderRight: '2px solid var(--c-accent)',
                    fontFamily: 'var(--ff-ui)', color: 'var(--c-txt)',
                  } : {
                    background: 'rgba(0,0,0,0.2)',
                    border: '1px solid rgba(0,200,240,0.07)',
                    borderLeft: '2px solid rgba(0,229,255,0.25)',
                    fontFamily: 'var(--ff-ui)', color: 'var(--c-txt2)',
                  }),
                }}>
                  {msg.role === 'assistant' && msg.queries?.map((q, qi) => (
                    <QueryBadge key={qi} q={q} />
                  ))}
                  {msg.role === 'assistant'
                    ? <div dangerouslySetInnerHTML={{ __html: renderMd(msg.text) }} />
                    : msg.text}
                </div>
              </div>
            ))}

            {/* Streaming bubble */}
            {streamingState && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{
                  maxWidth: '88%', padding: '8px 12px',
                  fontSize: '0.75rem', lineHeight: '1.5',
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid rgba(0,200,240,0.07)',
                  borderLeft: '2px solid rgba(0,229,255,0.25)',
                  fontFamily: 'var(--ff-ui)', color: 'var(--c-txt2)',
                }}>
                  {streamingState.queries.map((q, qi) => <QueryBadge key={qi} q={q} />)}
                  {streamingState.text
                    ? <div dangerouslySetInnerHTML={{ __html: renderMd(streamingState.text) }} />
                    : <span style={{ fontFamily: 'var(--ff-data)', fontSize: '0.7rem', color: 'var(--c-txt3)' }}>PROCESSING…</span>}
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <form
            onSubmit={e => { e.preventDefault(); sendChat(chatInput); }}
            style={{
              display: 'flex', gap: 6, padding: '10px 12px',
              borderTop: '1px solid rgba(0,200,240,0.08)',
              background: 'rgba(0,0,0,0.15)',
            }}
          >
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              placeholder="query //"
              autoComplete="off"
              style={{
                flex: 1,
                background: 'rgba(0,200,240,0.04)',
                border: '1px solid rgba(0,200,240,0.12)',
                color: 'var(--c-txt)',
                fontFamily: 'var(--ff-data)',
                fontSize: '0.72rem',
                padding: '6px 10px',
                outline: 'none',
              }}
            />
            <button type="submit" disabled={chatBusy} style={{
              background: chatBusy ? 'rgba(0,200,240,0.1)' : 'var(--c-accent)',
              color: chatBusy ? 'var(--c-txt3)' : '#060b11',
              fontFamily: 'var(--ff-data)', fontSize: '0.68rem',
              padding: '6px 12px', border: 'none',
              cursor: chatBusy ? 'not-allowed' : 'pointer',
              fontWeight: 700, letterSpacing: '0.05em',
              transition: 'all 0.15s',
            }}>RUN</button>
          </form>
        </div>
      )}
    </>
  );
}
