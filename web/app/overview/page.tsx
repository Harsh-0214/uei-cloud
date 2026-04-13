'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Header from '../components/Header';

// ── Interfaces ────────────────────────────────────────────────────────────────

interface TelemetryRow {
  node_id:            string;
  bms_id:             string;
  ts_utc:             string;
  soc:                number;
  pack_voltage:       number;
  pack_current:       number;
  temp_high:          number;
  temp_low:           number;
  ccl:                number;
  dcl:                number;
  fault_active:       boolean;
  faults_cleared_min: number;
  highest_cell_v:     number;
  lowest_cell_v:      number;
}

interface PvRow {
  node_id: string;
  pv_id:   string;
  ts_utc:  string;
  invr1:   number;
  invr2:   number;
  ld1:     number;
  ld2:     number;
  ld3:     number;
  ld4:     number;
  bv1:     number;
  bv2:     number;
}

interface Me {
  email:    string;
  role:     string;
  org_name: string;
}

interface AlertRow {
  id:         number;
  ts_utc:     string;
  node_id:    string;
  severity:   'CRITICAL' | 'WARNING' | 'INFO';
  alert_type: string;
  message:    string;
  source:     string;
  resolved:   boolean;
}

interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  queries?: { sql: string; rows: number }[];
}

interface StreamingState {
  text:    string;
  queries: { sql: string; rows: number }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function wmoLabel(code: number): { desc: string; icon: string } {
  if (code === 0)                      return { desc: 'Clear',         icon: '☀️'  };
  if (code <= 3)                       return { desc: 'Partly cloudy', icon: '⛅'  };
  if (code >= 45 && code <= 48)        return { desc: 'Foggy',         icon: '🌫️' };
  if (code >= 51 && code <= 55)        return { desc: 'Drizzle',       icon: '🌧️' };
  if (code >= 61 && code <= 65)        return { desc: 'Rain',          icon: '🌧️' };
  if (code >= 71 && code <= 77)        return { desc: 'Snow',          icon: '❄️'  };
  if (code >= 80 && code <= 82)        return { desc: 'Showers',       icon: '🌧️' };
  if (code >= 95 && code <= 99)        return { desc: 'Thunderstorm',  icon: '⛈️' };
  return { desc: 'Cloudy', icon: '☁️' };
}

function severityColor(severity: string): string {
  if (severity === 'CRITICAL') return '#f87171';
  if (severity === 'WARNING')  return '#fb923c';
  return 'var(--txt3)';
}

// ── Chat helpers ──────────────────────────────────────────────────────────────

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

function QueryBadge({ q }: { q: { sql: string; rows: number } }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      background: 'rgba(255,255,255,0.04)', borderRadius: 6,
      padding: '5px 9px', marginBottom: 6,
    }}>
      <span style={{ fontSize: '0.62rem', color: 'var(--accent)', fontFamily: "'DM Mono', monospace", flexShrink: 0, marginTop: 1 }}>SQL</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <code style={{ fontSize: '0.68rem', color: 'var(--txt2)', fontFamily: "'DM Mono', monospace", wordBreak: 'break-all' }}>
          {q.sql}
        </code>
        <div style={{ fontSize: '0.62rem', color: 'var(--txt3)', marginTop: 2 }}>{q.rows} row{q.rows !== 1 ? 's' : ''}</div>
      </div>
    </div>
  );
}

// ── NodeCard ──────────────────────────────────────────────────────────────────

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
      {row.fault_active && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'var(--err)' }} />
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--txt)', fontFamily: "'DM Mono', monospace", marginBottom: 2 }}>{row.node_id}</div>
          <div style={{ fontSize: '0.68rem', color: 'var(--txt3)' }}>{row.bms_id}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: isLive ? '#4ade80' : stale ? 'var(--warn)' : 'var(--txt3)', boxShadow: isLive ? '0 0 6px #4ade80' : 'none' }} />
            <span style={{ fontSize: '0.65rem', color: 'var(--txt3)' }}>{ageLabel(row.ts_utc)}</span>
          </div>
          {row.fault_active ? (
            <span style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--err)', background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 4, padding: '1px 7px' }}>FAULT</span>
          ) : (
            <span style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--ok)', background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 4, padding: '1px 7px' }}>OK</span>
          )}
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
          <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--txt3)', letterSpacing: '0.04em' }}>STATE OF CHARGE</span>
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: socColor(row.soc ?? 0), fontFamily: "'DM Mono', monospace" }}>{row.soc != null ? row.soc.toFixed(1) : '—'}%</span>
        </div>
        <div style={{ height: 5, background: 'var(--surf2)', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(100, row.soc ?? 0)}%`, background: socColor(row.soc ?? 0), borderRadius: 99, transition: 'width 0.4s ease' }} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px 0' }}>
        {[
          { label: 'Voltage', value: row.pack_voltage != null ? `${row.pack_voltage.toFixed(1)} V` : '—', color: 'var(--txt)' },
          { label: 'Current', value: row.pack_current != null ? `${row.pack_current.toFixed(1)} A` : '—', color: 'var(--txt)' },
          { label: 'Temp',    value: row.temp_high    != null ? `${row.temp_high.toFixed(1)} °C` : '—',  color: tempColor(row.temp_high ?? 0) },
        ].map(({ label, value, color }) => (
          <div key={label}>
            <div style={{ fontSize: '0.62rem', color: 'var(--txt3)', fontWeight: 600, letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: '0.82rem', fontWeight: 600, color, fontFamily: "'DM Mono', monospace" }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
        <span style={{ fontSize: '0.68rem', color: hovered ? 'var(--accent)' : 'var(--txt3)', transition: 'color 0.15s', fontWeight: 600 }}>View details →</span>
      </div>
    </a>
  );
}

// ── PvNodeCard ────────────────────────────────────────────────────────────────

function PvNodeCard({ row }: { row: PvRow }) {
  const [hovered, setHovered] = useState(false);
  const ageSec = (Date.now() - parseUtcMs(row.ts_utc)) / 1000;
  const isLive = ageSec < 10;
  const invr1 = Number(row.invr1 ?? 0);
  const invr2 = Number(row.invr2 ?? 0);
  const ld1   = Number(row.ld1   ?? 0);
  const ld2   = Number(row.ld2   ?? 0);
  const ld3   = Number(row.ld3   ?? 0);
  const ld4   = Number(row.ld4   ?? 0);
  const bv1   = Number(row.bv1   ?? 0);
  const bv2   = Number(row.bv2   ?? 0);
  const totalLoad = ld1 + ld2 + ld3 + ld4;
  const totalInvr = invr1 + invr2;

  return (
    <a
      href={`/pv-dashboard?node=${encodeURIComponent(row.node_id)}`}
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
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, #facc15, #fb923c)' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--txt)', fontFamily: "'DM Mono', monospace", marginBottom: 2 }}>{row.node_id}</div>
          <div style={{ fontSize: '0.68rem', color: 'var(--txt3)' }}>{row.pv_id}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: isLive ? '#facc15' : 'var(--txt3)', boxShadow: isLive ? '0 0 6px #facc15' : 'none' }} />
            <span style={{ fontSize: '0.65rem', color: 'var(--txt3)' }}>{ageLabel(row.ts_utc)}</span>
          </div>
          <span style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em', color: '#facc15', background: 'rgba(250,204,21,0.1)', border: '1px solid rgba(250,204,21,0.25)', borderRadius: 4, padding: '1px 7px' }}>SOLAR</span>
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
          <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--txt3)', letterSpacing: '0.04em' }}>INVERTER OUTPUT</span>
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#fb923c', fontFamily: "'DM Mono', monospace" }}>{totalInvr.toFixed(2)} A</span>
        </div>
        <div style={{ height: 5, background: 'var(--surf2)', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(100, (totalInvr / 1000) * 100)}%`, background: 'linear-gradient(90deg, #facc15, #fb923c)', borderRadius: 99, transition: 'width 0.4s ease' }} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px 0' }}>
        {[
          { label: 'Invr 1',   value: `${invr1.toFixed(2)} A`,     color: 'var(--txt)'  },
          { label: 'Invr 2',   value: `${invr2.toFixed(2)} A`,     color: 'var(--txt)'  },
          { label: 'Load',     value: `${totalLoad.toFixed(2)} A`, color: 'var(--txt)'  },
          { label: 'Batt V1',  value: `${bv1.toFixed(4)} V`,       color: 'var(--txt)'  },
          { label: 'Batt V2',  value: `${bv2.toFixed(4)} V`,       color: 'var(--txt)'  },
          { label: 'Channels', value: '4 ch',                       color: 'var(--txt3)' },
        ].map(({ label, value, color }) => (
          <div key={label}>
            <div style={{ fontSize: '0.62rem', color: 'var(--txt3)', fontWeight: 600, letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: '0.82rem', fontWeight: 600, color, fontFamily: "'DM Mono', monospace" }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
        <span style={{ fontSize: '0.68rem', color: hovered ? '#facc15' : 'var(--txt3)', transition: 'color 0.15s', fontWeight: 600 }}>View details →</span>
      </div>
    </a>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const [nodes,        setNodes]        = useState<TelemetryRow[]>([]);
  const [pvNodes,      setPvNodes]      = useState<PvRow[]>([]);
  const [me,           setMe]           = useState<Me | null>(null);
  const [lastUpdate,   setLastUpdate]   = useState<string>('');
  const [stale,        setStale]        = useState(false);
  const [carbon,       setCarbon]       = useState<Record<string, unknown> | null>(null);
  const [weather,      setWeather]      = useState<{ temp: number; code: number } | null>(null);
  const [alerts,       setAlerts]       = useState<AlertRow[]>([]);
  const [alertsError,  setAlertsError]  = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());

  // Chat state
  const [chatOpen,        setChatOpen]        = useState(false);
  const [chatBusy,        setChatBusy]        = useState(false);
  const [chatInput,       setChatInput]       = useState('');
  const [chatHistory,     setChatHistory]     = useState<ChatMsg[]>([]);
  const [streamingState,  setStreamingState]  = useState<StreamingState | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(true);

  const esRef      = useRef<EventSource | null>(null);
  const chatBoxRef = useRef<HTMLDivElement>(null);

  // ── SSE row application ─────────────────────────────────────────────────────

  function applyRows(rows: TelemetryRow[]) {
    setNodes(rows);
    const ageSec = rows[0]?.ts_utc ? (Date.now() - parseUtcMs(rows[0].ts_utc)) / 1000 : 999;
    setStale(ageSec > 10);
    setLastUpdate(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  }

  // ── Fetch helpers ───────────────────────────────────────────────────────────

  async function fetchPv() {
    try {
      const r = await fetch('/api/pv/latest', { cache: 'no-store' });
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data)) setPvNodes(data);
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

  const fetchAlerts = useCallback(async () => {
    try {
      const r = await fetch('/api/alerts/active', { cache: 'no-store' });
      if (!r.ok) { setAlertsError(true); return; }
      const data: AlertRow[] = await r.json();
      // Sort: CRITICAL first, then WARNING, then by ts_utc desc
      data.sort((a, b) => {
        const order: Record<string, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
        const diff = (order[a.severity] ?? 2) - (order[b.severity] ?? 2);
        if (diff !== 0) return diff;
        return parseUtcMs(b.ts_utc) - parseUtcMs(a.ts_utc);
      });
      setAlerts(data);
      setAlertsError(false);
      // Clean dismissed IDs that the backend has confirmed are now resolved (gone from response)
      setDismissedIds(prev => {
        if (prev.size === 0) return prev;
        const activeIds = new Set(data.map(a => a.id));
        const cleaned = new Set([...prev].filter(id => activeIds.has(id)));
        return cleaned.size === prev.size ? prev : cleaned;
      });
    } catch {
      setAlertsError(true);
    }
  }, []);

  // ── Mount effects ───────────────────────────────────────────────────────────

  useEffect(() => {
    // Auth
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setMe(d); })
      .catch(() => {});

    // Weather (once)
    fetch('https://api.open-meteo.com/v1/forecast?latitude=43.8971&longitude=-78.8658&current=temperature_2m,weathercode&timezone=America/Toronto')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.current) setWeather({ temp: Math.round(d.current.temperature_2m), code: d.current.weathercode });
      })
      .catch(() => {});

    fetchPv();
    fetchCarbon();
    fetchAlerts();

    const pvInterval     = setInterval(fetchPv,      10000);
    const carbonInterval = setInterval(fetchCarbon,  30000);
    const alertInterval  = setInterval(fetchAlerts,  10000);

    // SSE stream
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
      es.onerror = () => { es.close(); setTimeout(connect, 3000); };
    }
    connect();

    return () => {
      esRef.current?.close();
      clearInterval(pvInterval);
      clearInterval(carbonInterval);
      clearInterval(alertInterval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Chat box auto-scroll
  useEffect(() => {
    if (chatBoxRef.current) chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
  }, [streamingState, chatHistory]);

  // ── Alert resolve ───────────────────────────────────────────────────────────

  async function resolveAlert(id: number) {
    // Optimistic: add to dismissed set immediately
    setDismissedIds(prev => new Set([...prev, id]));
    try {
      await fetch(`/api/alerts/${id}/resolve`, { method: 'PATCH' });
    } catch { /* silent */ }
  }

  // ── Logout ──────────────────────────────────────────────────────────────────

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  }

  // ── Chat ────────────────────────────────────────────────────────────────────

  async function sendChat(text: string) {
    if (!text.trim() || chatBusy) return;
    setChatInput('');
    setChatBusy(true);
    setShowSuggestions(false);

    const historySnapshot = chatHistory;
    setChatHistory(prev => [...prev, { role: 'user', text }]);
    setStreamingState({ text: '', queries: [] });

    let accumulated   = '';
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

  // ── Derived values ──────────────────────────────────────────────────────────

  const faultCount   = nodes.filter(n => n.fault_active).length;
  const activeCount  = nodes.filter(n => (Date.now() - parseUtcMs(n.ts_utc)) < 15000).length;
  const pvLiveCount  = pvNodes.filter(n => (Date.now() - parseUtcMs(n.ts_utc)) < 15000).length;
  const visibleAlerts = alerts.filter(a => !dismissedIds.has(a.id)).slice(0, 10);

  // ── Section label style (shared) ────────────────────────────────────────────

  const SECTION_LABEL: React.CSSProperties = {
    fontSize: '0.72rem', fontWeight: 700, color: 'var(--txt3)',
    letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14,
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <div style={{ width: '100%', padding: '32px 5vw', minHeight: '100vh' }}>

        {/* ── 1. Header ── */}
        <Header
          crumbs={[{ label: 'UEI Cloud', href: '/overview' }, { label: 'Overview' }]}
          nav={[
            { label: 'Dashboard',    href: '/dashboard'    },
            { label: 'PV Dashboard', href: '/pv-dashboard' },
            { label: 'Nodes',        href: '/nodes'        },
            { label: 'Logs',         href: '/logs'         },
            { label: 'Algorithms',   href: '/algorithms'   },
            { label: 'Users',        href: '/users'        },
          ]}
          user={me}
          onLogout={handleLogout}
        />

        {/* ── 2. Greeting + Weather ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>

          {/* Left: greeting */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div>
              <div style={{
                fontSize: '1.8rem', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.1,
                background: 'var(--title-grad)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>
                Hi, {me?.org_name ?? 'there'}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--txt3)', fontWeight: 500, marginTop: 4 }}>
                Welcome to UEI Cloud
              </div>
            </div>
            {/* AI chat shortcut icon */}
            <button
              onClick={() => setChatOpen(true)}
              title="Ask AI about your data"
              style={{
                background: 'transparent', border: 'none',
                color: 'var(--accent)', cursor: 'pointer',
                padding: 4, display: 'flex', alignItems: 'center',
                opacity: 0.85, transition: 'opacity 0.15s',
                marginTop: 2, flexShrink: 0,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.85'; }}
            >
              <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/>
              </svg>
            </button>
          </div>

          {/* Right: weather */}
          {weather && (() => {
            const { desc, icon } = wmoLabel(weather.code);
            return (
              <div style={{
                background: 'var(--surf)', border: '1px solid var(--border)',
                borderRadius: 'var(--r)', padding: '14px 22px',
                display: 'flex', flexDirection: 'column', gap: 2,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>{icon}</span>
                  <span style={{ fontFamily: 'var(--ff-mono)', fontSize: '1.5rem', fontWeight: 800, color: 'var(--txt)', lineHeight: 1 }}>
                    {weather.temp}°C
                  </span>
                  <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--txt2)' }}>{desc}</span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--txt3)', marginTop: 2 }}>Oshawa, ON</div>
              </div>
            );
          })()}
        </div>

        {/* ── 3. Summary stats ── */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 32, flexWrap: 'wrap' }}>
          {[
            { label: 'BMS nodes', value: nodes.length,              color: 'var(--txt)' },
            { label: 'PV nodes',  value: pvNodes.length,            color: '#facc15'    },
            { label: 'Live',      value: activeCount + pvLiveCount,  color: 'var(--ok)'  },
            { label: 'Faults',    value: faultCount,                 color: faultCount > 0 ? 'var(--err)' : 'var(--txt)' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ flex: '1 1 140px', background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '18px 20px' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--txt3)', marginBottom: 6 }}>{label}</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
            </div>
          ))}
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

        {/* ── 4. BMS node cards — horizontal scroll ── */}
        {nodes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--txt3)', fontSize: '0.9rem', marginBottom: 40 }}>
            Waiting for telemetry…
          </div>
        ) : (
          <>
            <div style={SECTION_LABEL}>Nodes · click to open dashboard</div>
            <div style={{ display: 'flex', flexDirection: 'row', gap: 16, overflowX: 'auto', paddingBottom: 8, marginBottom: 40, WebkitOverflowScrolling: 'touch' }}>
              {nodes.map(row => (
                <div key={row.node_id} style={{ flexShrink: 0, width: 300 }}>
                  <NodeCard row={row} stale={stale} />
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── 5. PV node cards — horizontal scroll ── */}
        {pvNodes.length > 0 && (
          <>
            <div style={SECTION_LABEL}>Solar / PV nodes</div>
            <div style={{ display: 'flex', flexDirection: 'row', gap: 16, overflowX: 'auto', paddingBottom: 8, marginBottom: 40, WebkitOverflowScrolling: 'touch' }}>
              {pvNodes.map(row => (
                <div key={row.node_id} style={{ flexShrink: 0, width: 300 }}>
                  <PvNodeCard row={row} />
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── 6. Active Alerts ── */}
        <div style={SECTION_LABEL}>
          Active Alerts {alerts.length > 0 ? `(${visibleAlerts.length})` : ''}
        </div>
        <div style={{ background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--r)', overflow: 'hidden', marginBottom: 40 }}>
          {alertsError ? (
            <div style={{ padding: '24px 20px', textAlign: 'center', fontSize: '0.82rem', color: 'var(--txt3)' }}>
              Unable to load alerts
            </div>
          ) : visibleAlerts.length === 0 ? (
            <div style={{ padding: '24px 20px', textAlign: 'center', fontSize: '0.85rem', color: 'var(--ok)' }}>
              ✓ All clear — no active alerts
            </div>
          ) : (
            visibleAlerts.map((alert, i) => (
              <div
                key={alert.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 20px',
                  borderBottom: i < visibleAlerts.length - 1 ? '1px solid var(--border)' : 'none',
                  background: alert.severity === 'CRITICAL' ? 'rgba(248,113,113,0.04)' : 'transparent',
                }}
              >
                {/* Severity dot */}
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: severityColor(alert.severity),
                  boxShadow: alert.severity === 'CRITICAL' ? '0 0 6px rgba(248,113,113,0.4)' : 'none',
                }} />

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.82rem', color: 'var(--txt)', lineHeight: 1.4 }}>
                    {alert.message}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--ff-mono)', fontSize: '0.68rem', color: 'var(--txt3)' }}>{alert.node_id}</span>
                    <span style={{ fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.06em', background: 'var(--surf2, rgba(128,128,120,0.1))', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px', color: 'var(--txt3)', fontFamily: 'var(--ff-mono)' }}>
                      {alert.source}
                    </span>
                    <span style={{ fontSize: '0.65rem', color: 'var(--txt3)', fontFamily: 'var(--ff-mono)' }}>
                      {ageLabel(alert.ts_utc)}
                    </span>
                  </div>
                </div>

                {/* Resolve button */}
                <button
                  onClick={() => resolveAlert(alert.id)}
                  title="Mark resolved"
                  style={{
                    flexShrink: 0,
                    background: 'transparent', border: '1px solid var(--border)',
                    borderRadius: 6, padding: '4px 10px',
                    fontSize: '0.72rem', color: 'var(--txt3)',
                    cursor: 'pointer', transition: 'all 0.15s',
                    fontFamily: 'var(--ff-sans)',
                  }}
                  onMouseEnter={e => {
                    const b = e.currentTarget as HTMLButtonElement;
                    b.style.color = 'var(--ok, #4ade80)';
                    b.style.borderColor = 'rgba(74,222,128,0.3)';
                    b.style.background = 'rgba(74,222,128,0.06)';
                  }}
                  onMouseLeave={e => {
                    const b = e.currentTarget as HTMLButtonElement;
                    b.style.color = 'var(--txt3)';
                    b.style.borderColor = 'var(--border)';
                    b.style.background = 'transparent';
                  }}
                >
                  ✓
                </button>
              </div>
            ))
          )}
        </div>

        {/* ── 7. Carbon Emissions + disclaimer ── */}
        {carbon && (() => {
          const co2_g         = Number(carbon.co2_g         ?? carbon.total_co2_g         ?? 0);
          const co2_avoided_g = Number(carbon.co2_avoided_g ?? carbon.total_co2_avoided_g ?? 0);
          const net           = Number(carbon.net_co2_saved_g ?? 0);
          const gridKwh       = Number(carbon.total_grid_kwh ?? 0);
          const solarKwh      = Number(carbon.total_solar_kwh ?? 0);
          const intensity     = Number(carbon.carbon_intensity ?? carbon.avg_carbon_intensity ?? 400);
          const solarFrac     = Number(carbon.solar_fraction ?? 0);
          const solarPct      = solarFrac * 100;
          const netColor      = net >= 0 ? 'var(--ok)' : 'var(--err)';
          const solarColor    = solarPct >= 50 ? 'var(--ok)' : solarPct >= 20 ? 'var(--warn)' : 'var(--txt2)';
          return (
            <>
              <div style={SECTION_LABEL}>Carbon Emissions · All nodes · last hour</div>
              <div style={{ background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '18px 20px', marginBottom: 0 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 16 }}>
                  {[
                    { label: 'CO₂ Emitted',    value: (co2_g / 1000).toFixed(3),                               unit: 'kg',  sub: `${co2_g.toFixed(1)} g total`,      color: 'var(--err)' },
                    { label: 'CO₂ Avoided',    value: (co2_avoided_g / 1000).toFixed(3),                        unit: 'kg',  sub: 'by solar generation',               color: 'var(--ok)'  },
                    { label: 'Net Impact',      value: `${net >= 0 ? '+' : ''}${(net / 1000).toFixed(3)}`,       unit: 'kg',  sub: net >= 0 ? 'net saved' : 'net emitted', color: netColor },
                    { label: 'Solar Fraction',  value: solarPct.toFixed(1),                                      unit: '%',   sub: `${solarKwh.toFixed(3)} kWh solar`,  color: solarColor },
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
              {/* Disclaimer */}
              <p style={{ fontSize: '0.68rem', color: 'var(--txt3)', fontStyle: 'italic', marginTop: 12, maxWidth: 600, lineHeight: 1.5, marginBottom: 40 }}>
                Emissions estimated using grid emission factor methodology (gCO₂/kWh × energy consumed).
                Static regional intensity values — real-time marginal emission rates would require
                integration with services such as ElectricityMaps or WattTime.
              </p>
            </>
          );
        })()}

        {/* ── 8. Footer ── */}
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
            <button onClick={newChat} style={{ fontFamily: 'var(--ff-sans)', fontSize: '0.72rem', fontWeight: 600, background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--txt2)', padding: '4px 10px', cursor: 'pointer' }}>
              New chat
            </button>
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
                <div style={{ maxWidth: '86%', padding: '10px 14px', fontSize: '0.82rem', lineHeight: '1.55', background: 'var(--surf2)', border: '1px solid var(--border)', borderRadius: '3px 12px 12px 12px', color: 'var(--txt2)' }}>
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
              style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--txt)', fontFamily: 'var(--ff-sans)', fontSize: '0.85rem', padding: '8px 12px', outline: 'none' }}
            />
            <button type="submit" disabled={chatBusy} style={{ background: chatBusy ? 'var(--surf2)' : 'var(--accent)', color: chatBusy ? 'var(--txt2)' : '#111', fontFamily: 'var(--ff-sans)', fontSize: '0.82rem', fontWeight: 600, padding: '8px 14px', border: 'none', borderRadius: 8, cursor: chatBusy ? 'not-allowed' : 'pointer', flexShrink: 0 }}>
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}
