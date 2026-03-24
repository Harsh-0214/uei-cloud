'use client';

import { useEffect, useRef, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

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

interface CurrentUser {
  email: string;
  role: string;
  org_name: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const RANGES = ['5m', '15m', '30m', '1h', '6h', '24h'] as const;
type Range = typeof RANGES[number];

const COLUMNS = [
  { key: 'ts_utc',            label: 'Timestamp',       mono: true  },
  { key: 'node_id',           label: 'Node',            mono: true  },
  { key: 'bms_id',            label: 'BMS ID',          mono: true  },
  { key: 'soc',               label: 'SOC %',           mono: true  },
  { key: 'pack_voltage',      label: 'Pack V',          mono: true  },
  { key: 'pack_current',      label: 'Pack A',          mono: true  },
  { key: 'temp_high',         label: 'Temp Hi °C',      mono: true  },
  { key: 'temp_low',          label: 'Temp Lo °C',      mono: true  },
  { key: 'highest_cell_v',    label: 'Cell Hi V',       mono: true  },
  { key: 'lowest_cell_v',     label: 'Cell Lo V',       mono: true  },
  { key: 'ccl',               label: 'CCL A',           mono: true  },
  { key: 'dcl',               label: 'DCL A',           mono: true  },
  { key: 'fault_active',      label: 'Fault',           mono: false },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(v: number | undefined | null, d = 2): string {
  return v !== undefined && v !== null ? Number(v).toFixed(d) : '—';
}

function cellValue(row: TelemetryRow, key: string): string {
  switch (key) {
    case 'ts_utc':         return row.ts_utc;
    case 'node_id':        return row.node_id;
    case 'bms_id':         return row.bms_id;
    case 'soc':            return fmt(row.soc, 2);
    case 'pack_voltage':   return fmt(row.pack_voltage, 3);
    case 'pack_current':   return fmt(row.pack_current, 3);
    case 'temp_high':      return fmt(row.temp_high, 2);
    case 'temp_low':       return fmt(row.temp_low, 2);
    case 'highest_cell_v': return fmt(row.highest_cell_v, 3);
    case 'lowest_cell_v':  return fmt(row.lowest_cell_v, 3);
    case 'ccl':            return fmt(row.ccl, 1);
    case 'dcl':            return fmt(row.dcl, 1);
    case 'fault_active':   return row.fault_active ? 'ACTIVE' : 'Clear';
    default:               return '—';
  }
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function LogsPage() {
  const [user, setUser]       = useState<CurrentUser | null>(null);
  const [rows, setRows]       = useState<TelemetryRow[]>([]);
  const [nodes, setNodes]     = useState<string[]>([]);
  const [range, setRange]     = useState<Range>('1h');
  const [nodeFilter, setNode] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLast]  = useState<string>('');
  const [exporting, setExp]   = useState(false);
  const timerRef              = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auth
  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(u => { if (!u) window.location.href = '/login'; else setUser(u); })
      .catch(() => { window.location.href = '/login'; });
  }, []);

  // Fetch available nodes
  useEffect(() => {
    fetch('/api/latest')
      .then(r => r.json())
      .then((data: TelemetryRow[]) => {
        if (Array.isArray(data)) setNodes(data.map(r => r.node_id).sort());
      })
      .catch(() => {});
  }, []);

  // Fetch logs
  const fetchLogs = () => {
    const params = new URLSearchParams({ range });
    if (nodeFilter !== 'all') params.set('node_id', nodeFilter);
    params.set('limit', '2000');

    fetch(`/api/logs?${params}`)
      .then(r => r.json())
      .then((data: TelemetryRow[]) => {
        if (Array.isArray(data)) setRows(data);
        setLast(new Date().toLocaleTimeString());
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    setLoading(true);
    fetchLogs();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(fetchLogs, 10_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, nodeFilter]);

  // PDF export
  const exportPdf = async () => {
    setExp(true);
    try {
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;

      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

      // Title block
      doc.setFontSize(14);
      doc.setTextColor(40, 40, 40);
      doc.text('UEI Cloud — Telemetry Logs', 40, 40);
      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);
      const meta = [
        `Range: ${range}`,
        `Node: ${nodeFilter === 'all' ? 'All nodes' : nodeFilter}`,
        `Rows: ${rows.length}`,
        `Exported: ${new Date().toLocaleString()}`,
      ].join('   ·   ');
      doc.text(meta, 40, 58);

      // Table
      const head = [COLUMNS.map(c => c.label)];
      const body = rows.map(row => COLUMNS.map(c => cellValue(row, c.key)));

      autoTable(doc, {
        head,
        body,
        startY: 72,
        styles: {
          font: 'courier',
          fontSize: 7,
          cellPadding: 3,
          textColor: [30, 30, 30],
        },
        headStyles: {
          fillColor: [20, 20, 20],
          textColor: [230, 230, 230],
          fontStyle: 'bold',
          fontSize: 7.5,
        },
        alternateRowStyles: { fillColor: [248, 248, 248] },
        didParseCell: (data) => {
          // Highlight fault rows
          if (data.column.index === 12 && data.cell.raw === 'ACTIVE') {
            data.cell.styles.textColor = [220, 50, 50];
            data.cell.styles.fontStyle = 'bold';
          }
        },
        margin: { left: 40, right: 40 },
      });

      const rangeLabel = range.replace(/\//g, '-');
      const nodeLabel  = nodeFilter === 'all' ? 'all-nodes' : nodeFilter;
      doc.save(`uei-logs-${nodeLabel}-${rangeLabel}.pdf`);
    } finally {
      setExp(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────

  const btn = (label: string, active: boolean, onClick: () => void, accent = false) => (
    <button
      key={label}
      onClick={onClick}
      style={{
        padding: '5px 12px',
        borderRadius: 6,
        border: `1px solid ${active ? (accent ? '#e09a20' : 'rgba(255,255,255,0.25)') : 'rgba(255,255,255,0.08)'}`,
        background: active ? (accent ? 'rgba(224,154,32,0.15)' : 'rgba(255,255,255,0.08)') : 'transparent',
        color: active ? (accent ? '#e09a20' : '#e8e8e6') : '#88887e',
        fontSize: '0.78rem',
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: "'DM Mono', monospace",
        transition: 'all 0.15s',
        whiteSpace: 'nowrap' as const,
      }}
    >
      {label}
    </button>
  );

  const faultRows   = rows.filter(r => r.fault_active).length;
  const uniqueNodes = Array.from(new Set(rows.map(r => r.node_id))).length;

  return (
    <div style={{ width: '100%', padding: '32px 5vw', minHeight: '100vh' }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        {/* Top accent bar */}
        <div style={{ height: 3, background: 'linear-gradient(90deg, #88887e 0%, rgba(136,136,126,0.1) 60%, transparent 100%)', borderRadius: 99, marginBottom: 24 }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          {/* Brand + page badge */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <h1 style={{ fontSize: '1.85rem', fontWeight: 800, margin: 0, letterSpacing: '-0.03em', lineHeight: 1, background: 'linear-gradient(135deg, #e8e8e6 30%, #88887e 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                UEI Cloud
              </h1>
              <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#e8e8e6', background: '#252523', border: '1px solid rgba(255,255,255,0.12)', padding: '3px 8px', borderRadius: 4 }}>
                Logs
              </span>
            </div>
            <p style={{ fontSize: '0.72rem', fontWeight: 500, color: '#454540', margin: 0 }}>
              Unified Energy Interface
            </p>
          </div>

          {/* Right: user + nav */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            {user && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#e8e8e6' }}>{user.email}</div>
                  <div style={{ fontSize: '0.68rem', color: '#454540', marginTop: 2 }}>
                    {user.org_name} · <span style={{ color: '#e09a20', textTransform: 'capitalize' }}>{user.role}</span>
                  </div>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <a href="/dashboard" style={{ fontSize: '0.75rem', fontWeight: 600, color: '#88887e', textDecoration: 'none', padding: '4px 12px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, transition: 'all 0.15s' }}
                onMouseEnter={e => { const a = e.currentTarget as HTMLAnchorElement; a.style.color='#e8e8e6'; a.style.borderColor='rgba(255,255,255,0.2)'; }}
                onMouseLeave={e => { const a = e.currentTarget as HTMLAnchorElement; a.style.color='#88887e'; a.style.borderColor='rgba(255,255,255,0.08)'; }}>
                ← Dashboard
              </a>
              <a href="/users" style={{ fontSize: '0.75rem', fontWeight: 600, color: '#88887e', textDecoration: 'none', padding: '4px 12px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, transition: 'all 0.15s' }}
                onMouseEnter={e => { const a = e.currentTarget as HTMLAnchorElement; a.style.color='#e8e8e6'; a.style.borderColor='rgba(255,255,255,0.2)'; }}
                onMouseLeave={e => { const a = e.currentTarget as HTMLAnchorElement; a.style.color='#88887e'; a.style.borderColor='rgba(255,255,255,0.08)'; }}>
                Users
              </a>
            </div>
          </div>
        </div>

        <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', marginTop: 24 }} />
      </div>

      {/* Controls bar */}
      <div style={{
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20,
        padding: '14px 18px',
        background: '#1c1c1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10,
      }}>
        {/* Range */}
        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#454540', marginRight: 4 }}>RANGE</span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {RANGES.map(r => btn(r, range === r, () => setRange(r)))}
        </div>

        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.08)', margin: '0 4px' }} />

        {/* Node filter */}
        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#454540' }}>NODE</span>
        <select
          value={nodeFilter}
          onChange={e => setNode(e.target.value)}
          style={{
            background: '#252523', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
            color: '#e8e8e6', fontSize: '0.78rem', padding: '4px 10px',
            fontFamily: "'DM Mono', monospace", cursor: 'pointer',
          }}
        >
          <option value="all">All nodes</option>
          {nodes.map(n => <option key={n} value={n}>{n}</option>)}
        </select>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Export */}
        <button
          onClick={exportPdf}
          disabled={exporting || rows.length === 0}
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '6px 16px', borderRadius: 6,
            border: '1px solid rgba(224,154,32,0.4)',
            background: exporting ? 'rgba(224,154,32,0.05)' : 'rgba(224,154,32,0.12)',
            color: exporting ? '#88887e' : '#e09a20',
            fontSize: '0.78rem', fontWeight: 700,
            cursor: exporting || rows.length === 0 ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
            <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
            <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
          </svg>
          {exporting ? 'Exporting…' : 'Export PDF'}
        </button>
      </div>

      {/* Summary pills */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Total rows',    value: rows.length.toLocaleString() },
          { label: 'Nodes',         value: String(uniqueNodes) },
          { label: 'Fault events',  value: String(faultRows), danger: faultRows > 0 },
          { label: 'Last refresh',  value: lastFetch || '…' },
        ].map(p => (
          <div key={p.label} style={{
            padding: '8px 14px', background: '#1c1c1a',
            border: `1px solid ${p.danger ? 'rgba(248,113,113,0.3)' : 'rgba(255,255,255,0.07)'}`,
            borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 2,
          }}>
            <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#454540', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {p.label}
            </span>
            <span style={{
              fontFamily: "'DM Mono', monospace", fontSize: '1rem', fontWeight: 400,
              color: p.danger ? '#f87171' : '#e8e8e6',
            }}>
              {p.value}
            </span>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{
        background: '#1c1c1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10,
        overflow: 'hidden',
      }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#454540', fontSize: '0.9rem' }}>
            Loading logs…
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#454540', fontSize: '0.9rem' }}>
            No data for the selected range and node.
          </div>
        ) : (
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table style={{
              width: '100%', borderCollapse: 'collapse',
              fontFamily: "'DM Mono', monospace", fontSize: '0.78rem',
              minWidth: 1100,
            }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  {COLUMNS.map(c => (
                    <th
                      key={c.key}
                      style={{
                        padding: '10px 14px', textAlign: 'left',
                        fontSize: '0.65rem', fontWeight: 700,
                        color: '#454540', textTransform: 'uppercase',
                        letterSpacing: '0.07em', whiteSpace: 'nowrap',
                        background: '#161614',
                      }}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const fault   = row.fault_active;
                  const warnSoc = row.soc < 15;
                  const warnTmp = row.temp_high > 45;
                  const rowBg   = fault
                    ? 'rgba(248,113,113,0.04)'
                    : i % 2 === 1
                    ? 'rgba(255,255,255,0.015)'
                    : 'transparent';

                  return (
                    <tr
                      key={`${row.node_id}-${row.ts_utc}-${i}`}
                      style={{
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                        background: rowBg,
                      }}
                    >
                      {COLUMNS.map(c => {
                        const val   = cellValue(row, c.key);
                        let color   = '#e8e8e6';
                        if (c.key === 'fault_active') color = fault ? '#f87171' : '#4ade80';
                        if (c.key === 'soc'          && warnSoc) color = '#fb923c';
                        if (c.key === 'temp_high'    && warnTmp) color = '#f87171';
                        return (
                          <td
                            key={c.key}
                            style={{
                              padding: '7px 14px',
                              color,
                              fontWeight: c.key === 'fault_active' ? 700 : 400,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {val}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ marginTop: 40, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <span style={{ fontSize: '0.72rem', color: '#454540', fontWeight: 500 }}>
          UEI Cloud · Telemetry Logs · auto-refreshes every 10 s
        </span>
        <a href="/login" style={{ fontSize: '0.72rem', fontWeight: 600, color: '#454540', textDecoration: 'none', padding: '5px 14px', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6, transition: 'all 0.15s' }}
          onMouseEnter={e => { const a = e.currentTarget as HTMLAnchorElement; a.style.color='#f87171'; a.style.borderColor='rgba(248,113,113,0.3)'; }}
          onMouseLeave={e => { const a = e.currentTarget as HTMLAnchorElement; a.style.color='#454540'; a.style.borderColor='rgba(255,255,255,0.06)'; }}
          onClick={async e => {
            e.preventDefault();
            await fetch('/api/auth/logout', { method: 'POST' });
            window.location.href = '/login';
          }}
        >
          Sign out
        </a>
      </div>
    </div>
  );
}
