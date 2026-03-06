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
    .replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre style="background:#0f172a;padding:8px;border-radius:6px;font-size:0.75rem;overflow-x:auto;margin:4px 0">$1</pre>')
    .replace(/`([^`]+)`/g, '<code style="background:#0f172a;padding:1px 5px;border-radius:3px;font-size:0.8em">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^\s*[-*]\s+(.+)$/gm, '<li style="margin-left:12px">$1</li>')
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
      backgroundColor: '#1e293b',
      titleColor: '#94a3b8',
      bodyColor: '#e2e8f0',
      borderColor: '#334155',
      borderWidth: 1,
    },
  },
  scales: {
    x: { ticks: { color: '#475569', maxTicksLimit: 6, font: { size: 10 } }, grid: { color: '#1e293b' } },
    y: { ticks: { color: '#475569', font: { size: 10 } }, grid: { color: '#1e293b' } },
  },
};

// ── MetricCard ─────────────────────────────────────────────────

function MetricCard({
  label, value, unit = '', bar = null, highlight = 'normal',
}: {
  label: string; value: string; unit?: string;
  bar?: number | null; highlight?: 'normal' | 'warning' | 'danger' | 'success';
}) {
  const colors = { normal: '#f1f5f9', warning: '#fbbf24', danger: '#f87171', success: '#34d399' };
  const barColor = highlight === 'danger' ? '#f87171' : highlight === 'warning' ? '#fbbf24' : '#06b6d4';
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div style={{ color: colors[highlight] }}>
        <span className="metric-value">{value}</span>
        <span className="metric-unit">{unit}</span>
      </div>
      {bar !== null && bar !== undefined && (
        <div className="bar-bg">
          <div className="bar-fg" style={{ width: `${Math.min(100, Math.max(0, bar))}%`, background: barColor }} />
        </div>
      )}
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────

export default function Dashboard() {
  const [nodes, setNodes] = useState<TelemetryRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [timeRange, setTimeRange] = useState<'1h' | '6h' | '24h'>('1h');
  const [initialized, setInitialized] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');

  const [chatOpen, setChatOpen] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMsg[]>([]);
  const [streamingState, setStreamingState] = useState<StreamingState | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(true);

  const socRef    = useRef<HTMLCanvasElement>(null);
  const voltRef   = useRef<HTMLCanvasElement>(null);
  const tempRef   = useRef<HTMLCanvasElement>(null);
  const chartsRef = useRef<Record<string, Chart>>({});
  const chatBoxRef = useRef<HTMLDivElement>(null);
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
      backgroundColor: l.color + '18',
      borderWidth: 2,
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
      if (chartsRef.current.soc)     updateChart(chartsRef.current.soc,     soc,  [{ key: 'value', label: 'SOC',     color: '#06b6d4' }]);
      if (chartsRef.current.voltage) updateChart(chartsRef.current.voltage, volt, [{ key: 'value', label: 'Voltage', color: '#a78bfa' }]);
      if (chartsRef.current.temp)    updateChart(chartsRef.current.temp,    temp, [
        { key: 'high', label: 'Temp High', color: '#f97316' },
        { key: 'low',  label: 'Temp Low',  color: '#60a5fa' },
      ]);
    } catch { /* ignore */ }
  }, []);

  const fetchLatest = useCallback(async () => {
    try {
      const resp = await fetch('/api/latest');
      const data = await resp.json();
      const rows: TelemetryRow[] = Array.isArray(data) ? data : [data];
      setNodes(rows);
      setLastUpdated('Updated ' + new Date().toLocaleTimeString());
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

  // Scroll chat to bottom when streaming updates
  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
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
      <div className="max-w-7xl mx-auto p-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-cyan-400 tracking-tight">UEI Cloud Dashboard</h1>
            <p className="text-slate-500 text-xs mt-1">{lastUpdated}</p>
          </div>
          {initialized && (
            <div className="flex items-center gap-3">
              <span className="text-slate-400 text-sm">Node</span>
              <select
                id="node-select"
                value={selectedId}
                onChange={e => handleNodeChange(e.target.value)}
                className="bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500"
              >
                {nodes.map(n => <option key={n.node_id} value={n.node_id}>{n.node_id}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Loading */}
        {!initialized && (
          <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
            Connecting to UEI Cloud…
          </div>
        )}

        {initialized && currentNode && (
          <>
            {/* Fault Banner */}
            {currentNode.fault_active && (
              <div className="mb-6 bg-red-950 border border-red-600 rounded-xl p-4 flex items-center gap-3">
                <span className="text-red-400 font-bold text-lg">!</span>
                <div>
                  <p className="text-red-300 font-semibold">Fault Active — {currentNode.bms_id}</p>
                  <p className="text-red-400 text-sm">Last cleared {fmt(currentNode.faults_cleared_min)} min ago</p>
                </div>
              </div>
            )}

            {/* Metric Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
              <MetricCard label="State of Charge" value={fmt(currentNode.soc)}          unit="%" bar={currentNode.soc}
                highlight={currentNode.soc >= 30 ? 'normal' : currentNode.soc >= 15 ? 'warning' : 'danger'} />
              <MetricCard label="Pack Voltage"    value={fmt(currentNode.pack_voltage)}  unit="V" />
              <MetricCard label="Pack Current"    value={fmt(currentNode.pack_current)}  unit="A" />
              <MetricCard label="Temp High"       value={fmt(currentNode.temp_high)}     unit="°C"
                highlight={currentNode.temp_high > 45 ? 'danger' : 'normal'} />
              <MetricCard label="Temp Low"        value={fmt(currentNode.temp_low)}      unit="°C" />
              <MetricCard label="Highest Cell"    value={fmt(currentNode.highest_cell_v, 3)} unit="V" />
              <MetricCard label="Lowest Cell"     value={fmt(currentNode.lowest_cell_v, 3)}  unit="V" />
              <MetricCard label="CCL"             value={fmt(currentNode.ccl)}           unit="A" />
              <MetricCard label="DCL"             value={fmt(currentNode.dcl)}           unit="A" />
              <MetricCard label="Fault Status"    value={currentNode.fault_active ? 'ACTIVE' : 'Clear'}
                highlight={currentNode.fault_active ? 'danger' : 'success'} />
            </div>

            {/* Time Range */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-slate-400 text-sm">Range</span>
              {(['1h', '6h', '24h'] as const).map(r => (
                <button key={r} onClick={() => handleRangeChange(r)}
                  className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                    timeRange === r ? 'bg-cyan-500 text-slate-950' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >{r}</button>
              ))}
            </div>

            {/* Charts */}
            <div className="flex flex-col gap-4">
              <div className="bg-slate-900 rounded-xl p-4">
                <p className="text-slate-400 text-xs mb-3 font-medium uppercase tracking-wide">State of Charge</p>
                <div className="chart-container"><canvas ref={socRef} /></div>
              </div>
              <div className="bg-slate-900 rounded-xl p-4">
                <p className="text-slate-400 text-xs mb-3 font-medium uppercase tracking-wide">Pack Voltage</p>
                <div className="chart-container"><canvas ref={voltRef} /></div>
              </div>
              <div className="bg-slate-900 rounded-xl p-4">
                <p className="text-slate-400 text-xs mb-3 font-medium uppercase tracking-wide">Temperature</p>
                <div className="chart-container"><canvas ref={tempRef} /></div>
              </div>
            </div>

            <div className="mt-8 text-center text-slate-700 text-xs">
              UEI Cloud Platform · {currentNode.bms_id ?? '—'}
            </div>
          </>
        )}
      </div>

      {/* ── Chatbot ── */}

      {/* Bubble */}
      <button onClick={() => setChatOpen(o => !o)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-cyan-500 hover:bg-cyan-400 shadow-lg flex items-center justify-center transition-colors"
        title="Ask AI">
        {chatOpen ? (
          <svg className="w-5 h-5 text-slate-950" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12"/>
          </svg>
        ) : (
          <svg className="w-6 h-6 text-slate-950" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/>
          </svg>
        )}
      </button>

      {/* Panel */}
      {chatOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-96 h-[560px] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 flex-shrink-0">
            <div>
              <p className="text-sm font-semibold text-cyan-400">UEI Data Assistant</p>
              <p className="text-xs text-slate-500">Ask about your telemetry data</p>
            </div>
            <button onClick={newChat}
              className="text-xs text-slate-500 hover:text-slate-300 border border-slate-700 hover:border-slate-500 rounded-lg px-2 py-1 transition-colors">
              New chat
            </button>
          </div>

          {/* Messages */}
          <div ref={chatBoxRef} id="chat-messages" className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3">

            {/* Suggestions */}
            {showSuggestions && chatHistory.length === 0 && !streamingState && (
              <div className="flex flex-col gap-2 pt-1">
                <p className="text-xs text-slate-500 text-center mb-1">Suggestions</p>
                {[
                  'How many nodes are reporting?',
                  'Show the latest SOC for all nodes',
                  'Are there any active faults?',
                  'What is the average pack voltage?',
                  'Show temp trends in the last hour',
                ].map(s => (
                  <button key={s} className="suggestion-btn" onClick={() => sendChat(s)}>{s}</button>
                ))}
              </div>
            )}

            {/* History */}
            {chatHistory.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-cyan-700 text-cyan-50 rounded-br-sm'
                    : 'bg-slate-800 text-slate-200 rounded-bl-sm'
                }`}>
                  {msg.role === 'assistant' && msg.queries?.map((q, qi) => (
                    <div key={qi} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 8, padding: '5px 8px', fontSize: '0.7rem', fontFamily: 'monospace', color: '#7dd3fc', marginBottom: 4, wordBreak: 'break-all' }}>
                      <span style={{ color: '#22d3ee', flexShrink: 0 }}>▶</span>
                      <span>{q.sql.trim()}</span>
                      <span style={{ color: '#475569', marginLeft: 'auto', paddingLeft: 6, flexShrink: 0 }}>{q.rows}r</span>
                    </div>
                  ))}
                  {msg.role === 'assistant'
                    ? <div dangerouslySetInnerHTML={{ __html: renderMd(msg.text) }} />
                    : msg.text}
                </div>
              </div>
            ))}

            {/* Streaming bubble */}
            {streamingState && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed bg-slate-800 text-slate-200 rounded-bl-sm">
                  {streamingState.queries.map((q, qi) => (
                    <div key={qi} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 8, padding: '5px 8px', fontSize: '0.7rem', fontFamily: 'monospace', color: '#7dd3fc', marginBottom: 4, wordBreak: 'break-all' }}>
                      <span style={{ color: '#22d3ee', flexShrink: 0 }}>▶</span>
                      <span>{q.sql.trim()}</span>
                      <span style={{ color: '#475569', marginLeft: 'auto', paddingLeft: 6, flexShrink: 0 }}>{q.rows}r</span>
                    </div>
                  ))}
                  {streamingState.text
                    ? <div dangerouslySetInnerHTML={{ __html: renderMd(streamingState.text) }} />
                    : <span style={{ color: '#64748b', fontStyle: 'italic' }}>Thinking…</span>}
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <form onSubmit={e => { e.preventDefault(); sendChat(chatInput); }}
            className="flex gap-2 px-3 py-3 border-t border-slate-800 flex-shrink-0">
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              placeholder="Ask anything…"
              autoComplete="off"
              className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
            />
            <button type="submit" disabled={chatBusy}
              className="bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-xl px-3 py-2 text-xs font-semibold transition-colors">
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}
