'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface Alert {
  id: number;
  ts_utc: string;
  node_id: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  alert_type: string;
  message: string;
  source: string;
  resolved: boolean;
  resolved_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 10)  return 'just now';
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function severityColor(severity: string): string {
  if (severity === 'CRITICAL') return '#f87171';
  if (severity === 'WARNING')  return '#fb923c';
  return 'var(--txt3)';
}

// ── Bell SVG ──────────────────────────────────────────────────────────────────

function BellIcon({ pulsing }: { pulsing: boolean }) {
  return (
    <svg
      width="18" height="18" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
      style={{
        transition: 'color 0.3s',
        animation: pulsing ? 'bell-pulse 0.6s ease-in-out' : 'none',
      }}
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AlertBell() {
  const [alerts, setAlerts]         = useState<Alert[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());
  const [open, setOpen]             = useState(false);
  const [pulsing, setPulsing]       = useState(false);
  const [hidden, setHidden]         = useState(false);   // 401 → hide entirely
  const [times, setTimes]           = useState(0);       // tick counter for relative times

  const prevCountRef = useRef(0);
  const wrapperRef   = useRef<HTMLDivElement>(null);

  // ── Fetch active alerts ───────────────────────────────────────────────────

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/alerts/active', { cache: 'no-store' });
      if (res.status === 401) { setHidden(true); return; }
      if (!res.ok) return;
      const data: Alert[] = await res.json();
      setAlerts(data);

      // Clean up dismissedIds — remove IDs that are no longer in the active list
      setDismissedIds(prev => {
        if (prev.size === 0) return prev;
        const activeIds = new Set(data.map(a => a.id));
        const cleaned = new Set([...prev].filter(id => activeIds.has(id)));
        return cleaned.size === prev.size ? prev : cleaned;
      });

      // Pulse bell if a new CRITICAL appeared
      const critCount = data.filter(a => a.severity === 'CRITICAL').length;
      const prevCount = prevCountRef.current;
      if (critCount > 0 && data.length > prevCount) {
        setPulsing(true);
        setTimeout(() => setPulsing(false), 700);
      }
      prevCountRef.current = data.length;
    } catch {
      // API down — show bell with no badge, don't crash
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const id = setInterval(fetchAlerts, 5000);
    return () => clearInterval(id);
  }, [fetchAlerts]);

  // Tick relative times every 30 s so "2m ago" stays fresh
  useEffect(() => {
    const id = setInterval(() => setTimes(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // ── Close on outside click ────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // ── Resolve alert ─────────────────────────────────────────────────────────

  async function resolveAlert(id: number) {
    // Optimistic dismiss — hide immediately, clean up from dismissed set when server confirms
    setDismissedIds(prev => new Set([...prev, id]));
    try {
      await fetch(`/api/alerts/${id}/resolve`, { method: 'PATCH' });
    } catch {
      // silent — next poll will re-show if still active
    }
  }

  if (hidden) return null;

  const visibleAlerts = alerts.filter(a => !dismissedIds.has(a.id));
  const count = visibleAlerts.length;
  const badgeLabel = count > 9 ? '9+' : String(count);

  return (
    <>
      {/* Pulse keyframe injected once */}
      <style>{`
        @keyframes bell-pulse {
          0%   { color: var(--txt2); }
          30%  { color: #f87171; transform: rotate(-12deg) scale(1.15); }
          60%  { color: #f87171; transform: rotate(10deg) scale(1.15); }
          100% { color: var(--txt2); transform: rotate(0deg) scale(1); }
        }
      `}</style>

      <div ref={wrapperRef} style={{ position: 'relative', display: 'inline-flex' }}>

        {/* ── Bell button ── */}
        <button
          onClick={() => setOpen(o => !o)}
          aria-label={`Alerts — ${count} active`}
          style={{
            position: 'relative',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 34, height: 34,
            background: open ? 'var(--surf2, rgba(128,128,120,0.08))' : 'transparent',
            border: '1px solid ' + (open ? 'var(--border)' : 'transparent'),
            borderRadius: 8,
            color: 'var(--txt2)',
            cursor: 'pointer',
            transition: 'background 0.15s, border-color 0.15s, color 0.15s',
            flexShrink: 0,
          }}
          onMouseEnter={e => {
            const b = e.currentTarget as HTMLButtonElement;
            b.style.background = 'var(--surf2, rgba(128,128,120,0.08))';
            b.style.borderColor = 'var(--border)';
          }}
          onMouseLeave={e => {
            if (open) return;
            const b = e.currentTarget as HTMLButtonElement;
            b.style.background = 'transparent';
            b.style.borderColor = 'transparent';
          }}
        >
          <BellIcon pulsing={pulsing} />

          {/* Badge */}
          {count > 0 && (
            <span style={{
              position: 'absolute',
              top: 3, right: 3,
              minWidth: 14, height: 14,
              background: '#f87171',
              borderRadius: 99,
              fontSize: '0.55rem',
              fontWeight: 700,
              color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 3px',
              lineHeight: 1,
              pointerEvents: 'none',
              fontFamily: 'var(--ff-mono)',
            }}>
              {badgeLabel}
            </span>
          )}
        </button>

        {/* ── Dropdown panel ── */}
        {open && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: 360,
            maxHeight: 400,
            overflowY: 'auto',
            background: 'var(--surf)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
            zIndex: 100,
          }}>

            {/* Panel header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '11px 16px 10px',
              borderBottom: '1px solid var(--border)',
              position: 'sticky', top: 0,
              background: 'var(--surf)',
              zIndex: 1,
            }}>
              <span style={{
                fontSize: '0.78rem', fontWeight: 700,
                color: 'var(--txt)', letterSpacing: '-0.01em',
              }}>
                Active Alerts
              </span>
              {count > 0 && (
                <span style={{
                  fontSize: '0.65rem', fontWeight: 600,
                  color: count > 0 ? '#f87171' : 'var(--txt3)',
                  fontFamily: 'var(--ff-mono)',
                }}>
                  {count} unresolved
                </span>
              )}
            </div>

            {/* Alert rows */}
            {visibleAlerts.length === 0 ? (
              <div style={{
                padding: '24px 16px',
                textAlign: 'center',
                fontSize: '0.8rem',
                color: 'var(--txt3)',
              }}>
                No active alerts
              </div>
            ) : (
              visibleAlerts.map((alert, i) => (
                <div
                  key={alert.id}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '12px 16px',
                    borderBottom: i < visibleAlerts.length - 1 ? '1px solid var(--border)' : 'none',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLDivElement).style.background = 'var(--surf2, rgba(128,128,120,0.06))';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                  }}
                >
                  {/* Severity dot */}
                  <div style={{
                    width: 8, height: 8,
                    borderRadius: '50%',
                    background: severityColor(alert.severity),
                    flexShrink: 0,
                    marginTop: 4,
                    boxShadow: alert.severity === 'CRITICAL'
                      ? '0 0 6px rgba(248,113,113,0.5)'
                      : 'none',
                  }} />

                  {/* Text content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '0.82rem',
                      color: 'var(--txt)',
                      lineHeight: 1.4,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}>
                      {alert.message}
                    </div>

                    {/* Meta row */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      marginTop: 5, flexWrap: 'wrap',
                    }}>
                      {/* Source badge */}
                      <span style={{
                        fontSize: '0.6rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        background: 'var(--surf2, rgba(128,128,120,0.1))',
                        border: '1px solid var(--border)',
                        borderRadius: 4,
                        padding: '1px 6px',
                        color: 'var(--txt3)',
                        fontFamily: 'var(--ff-mono)',
                      }}>
                        {alert.source}
                      </span>

                      {/* Node */}
                      <span style={{
                        fontSize: '0.6rem',
                        color: 'var(--txt3)',
                        fontFamily: 'var(--ff-mono)',
                      }}>
                        {alert.node_id}
                      </span>

                      {/* Time */}
                      <span style={{
                        fontSize: '0.65rem',
                        color: 'var(--txt3)',
                        fontFamily: 'var(--ff-mono)',
                        marginLeft: 'auto',
                      }}>
                        {/* times in deps forces re-render on tick */}
                        {timeAgo(alert.ts_utc)}
                        {times < 0 ? '' : ''}
                      </span>
                    </div>
                  </div>

                  {/* Resolve button */}
                  <button
                    onClick={() => resolveAlert(alert.id)}
                    title="Mark resolved"
                    style={{
                      flexShrink: 0,
                      width: 24, height: 24,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      color: 'var(--txt3)',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      transition: 'all 0.15s',
                      marginTop: 1,
                      fontFamily: 'var(--ff-sans)',
                    }}
                    onMouseEnter={e => {
                      const b = e.currentTarget as HTMLButtonElement;
                      b.style.color = 'var(--ok, #4ade80)';
                      b.style.borderColor = 'rgba(74,222,128,0.4)';
                      b.style.background = 'rgba(74,222,128,0.07)';
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
        )}
      </div>
    </>
  );
}
