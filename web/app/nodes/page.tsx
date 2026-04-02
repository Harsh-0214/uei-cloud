'use client';

import { useEffect, useState } from 'react';
import Header from '../components/Header';

interface Node {
  node_id:  string;
  org_name: string;
}

interface Me {
  email:    string;
  role:     string;
  org_name: string;
}

export default function NodesPage() {
  const [nodes,    setNodes]    = useState<Node[]>([]);
  const [pvIds,    setPvIds]    = useState<Set<string>>(new Set());
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [me,       setMe]       = useState<Me | null>(null);

  // Add-node form state
  const [newNodeId,  setNewNodeId]  = useState('');
  const [newOrgName, setNewOrgName] = useState('');
  const [adding,     setAdding]     = useState(false);
  const [addError,   setAddError]   = useState('');

  // Confirm-delete state
  const [confirmId,  setConfirmId]  = useState<string | null>(null);
  const [deleting,   setDeleting]   = useState(false);

  async function loadNodes() {
    try {
      const [telRes, regRes, pvRes] = await Promise.all([
        fetch('/api/telemetry/nodes', { cache: 'no-store' }),
        fetch('/api/admin/nodes',     { cache: 'no-store' }),
        fetch('/api/pv/latest',       { cache: 'no-store' }),
      ]);

      const telIds: string[]   = telRes.ok ? await telRes.json() : [];
      const regNodes: Node[]   = regRes.ok ? await regRes.json() : [];
      const pvLatest: { node_id: string }[] = pvRes.ok ? await pvRes.json() : [];

      const orgMap: Record<string, string> = {};
      if (Array.isArray(regNodes)) {
        for (const n of regNodes) orgMap[n.node_id] = n.org_name;
      }

      const pvIdSet = new Set(Array.isArray(pvLatest) ? pvLatest.map(r => r.node_id) : []);
      setPvIds(pvIdSet);

      const allIds = Array.from(new Set([
        ...(Array.isArray(telIds) ? telIds : []),
        ...(Array.isArray(regNodes) ? regNodes.map(n => n.node_id) : []),
        ...Array.from(pvIdSet),
      ])).sort();

      setNodes(allIds.map(id => ({ node_id: id, org_name: orgMap[id] ?? '' })));
    } catch {
      setError('Network error.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setMe(data); })
      .catch(() => {});
    loadNodes();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setAddError('');
    try {
      const r = await fetch('/api/admin/nodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: newNodeId.trim(), org_name: newOrgName.trim() }),
      });
      const data = await r.json();
      if (!r.ok) { setAddError(data.detail ?? 'Failed to add node.'); return; }
      setNewNodeId('');
      setNewOrgName('');
      await loadNodes();
    } catch {
      setAddError('Network error.');
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(node_id: string) {
    setDeleting(true);
    try {
      const r = await fetch(`/api/admin/nodes/${encodeURIComponent(node_id)}`, { method: 'DELETE' });
      const data = await r.json();
      if (!r.ok) { setError(data.detail ?? 'Failed to delete node.'); }
      else { setConfirmId(null); await loadNodes(); }
    } catch {
      setError('Network error.');
    } finally {
      setDeleting(false);
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  }

  // Group by org; nodes with no org go under "Unregistered"
  const orgs: Record<string, Node[]> = {};
  for (const n of nodes) {
    const key = n.org_name || 'Unregistered';
    (orgs[key] ??= []).push(n);
  }

  // Unique org names (excluding "Unregistered") for the add-form datalist
  const orgNames = Object.keys(orgs).filter(k => k !== 'Unregistered').sort();

  const isAdmin = me?.role === 'admin' || me?.role === 'superadmin';

  return (
    <div style={{ width: '100%', padding: '32px 5vw', minHeight: '100vh' }}>

      <Header
        crumbs={[{ label: 'UEI Cloud', href: '/overview' }, { label: 'Nodes' }]}
        nav={[
          { label: 'Overview',   href: '/overview' },
          { label: 'Dashboard',  href: '/dashboard' },
          { label: 'Logs',       href: '/logs' },
          { label: 'Algorithms', href: '/algorithms' },
        ]}
        user={me}
        onLogout={handleLogout}
      />

      {loading && (
        <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--txt2)', fontSize: '0.9rem' }}>
          Loading nodes…
        </div>
      )}

      {error && (
        <div style={{ padding: '14px 18px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8, fontSize: '0.85rem', color: 'var(--err)', marginBottom: 24 }}>
          {error}
        </div>
      )}

      {!loading && (
        <>
          {/* Summary row */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 32, flexWrap: 'wrap' }}>
            {[
              { label: 'Total nodes',    value: nodes.length },
              { label: 'Organizations',  value: orgNames.length },
            ].map(({ label, value }) => (
              <div key={label} style={{ flex: '1 1 140px', background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '18px 20px' }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--txt3)', marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--txt)', lineHeight: 1 }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Node list grouped by org */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginBottom: 32 }}>
            {Object.entries(orgs).map(([orgName, members]) => (
              <div key={orgName} style={{ background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--r)', overflow: 'hidden' }}>
                {/* Org header */}
                <div style={{ padding: '13px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--txt)' }}>{orgName}</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--txt3)', fontWeight: 500 }}>
                    {members.length} {members.length === 1 ? 'node' : 'nodes'}
                  </span>
                </div>

                {/* Node rows */}
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Node ID', ...(isAdmin ? [''] : [])].map(h => (
                        <th key={h} style={{ padding: '9px 20px', textAlign: 'left', fontSize: '0.68rem', fontWeight: 600, color: 'var(--txt3)', letterSpacing: '0.04em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((n, i) => (
                      <tr key={n.node_id} style={{ borderBottom: i < members.length - 1 ? '1px solid var(--border)' : 'none' }}>
                        <td style={{ padding: '11px 20px', fontSize: '0.82rem', color: 'var(--txt)', fontFamily: "'DM Mono', monospace" }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            {n.node_id}
                            {pvIds.has(n.node_id) && (
                              <span style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.06em', color: '#facc15', background: 'rgba(250,204,21,0.1)', border: '1px solid rgba(250,204,21,0.25)', borderRadius: 4, padding: '1px 6px', fontFamily: 'var(--ff-sans)' }}>
                                PV
                              </span>
                            )}
                            {!n.org_name && (
                              <span style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--txt3)', background: 'var(--surf2)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px', fontFamily: 'var(--ff-sans)' }}>
                                telemetry only
                              </span>
                            )}
                          </span>
                        </td>
                        {isAdmin && (
                          <td style={{ padding: '11px 20px', textAlign: 'right' }}>
                            {confirmId === n.node_id ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: '0.72rem', color: 'var(--txt3)' }}>Remove?</span>
                                <button
                                  disabled={deleting}
                                  onClick={() => handleDelete(n.node_id)}
                                  style={{ fontFamily: 'var(--ff-sans)', fontSize: '0.72rem', fontWeight: 700, background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 6, color: 'var(--err)', padding: '4px 12px', cursor: 'pointer' }}
                                >
                                  {deleting ? '…' : 'Yes, remove'}
                                </button>
                                <button
                                  onClick={() => setConfirmId(null)}
                                  style={{ fontFamily: 'var(--ff-sans)', fontSize: '0.72rem', fontWeight: 600, background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--txt3)', padding: '4px 12px', cursor: 'pointer' }}
                                >
                                  Cancel
                                </button>
                              </span>
                            ) : (
                              <button
                                onClick={() => setConfirmId(n.node_id)}
                                style={{ fontFamily: 'var(--ff-sans)', fontSize: '0.72rem', fontWeight: 600, background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--txt3)', padding: '4px 12px', cursor: 'pointer', transition: 'all 0.15s' }}
                                onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.color = 'var(--err)'; b.style.borderColor = 'rgba(248,113,113,0.3)'; }}
                                onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.color = 'var(--txt3)'; b.style.borderColor = 'var(--border)'; }}
                              >
                                Remove
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

            {nodes.length === 0 && !error && (
              <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--txt3)', fontSize: '0.85rem' }}>
                No nodes registered yet.
              </div>
            )}
          </div>

          {/* Add node form — admin only */}
          {isAdmin && (
            <div style={{ background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--r)', overflow: 'hidden' }}>
              <div style={{ padding: '13px 20px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--txt)' }}>Add node</span>
              </div>
              <form onSubmit={handleAdd} style={{ padding: '20px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 180px' }}>
                  <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--txt3)', letterSpacing: '0.04em' }}>NODE ID</span>
                  <input
                    required
                    value={newNodeId}
                    onChange={e => setNewNodeId(e.target.value)}
                    placeholder="e.g. pi_bms_real"
                    style={{ fontFamily: "'DM Mono', monospace", fontSize: '0.82rem', background: 'var(--surf2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', color: 'var(--txt)', outline: 'none' }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 180px' }}>
                  <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--txt3)', letterSpacing: '0.04em' }}>ORGANIZATION</span>
                  <input
                    required
                    list="org-list"
                    value={newOrgName}
                    onChange={e => setNewOrgName(e.target.value)}
                    placeholder="e.g. Capstone"
                    style={{ fontFamily: 'var(--ff-sans)', fontSize: '0.82rem', background: 'var(--surf2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', color: 'var(--txt)', outline: 'none' }}
                  />
                  <datalist id="org-list">
                    {orgNames.map(o => <option key={o} value={o} />)}
                  </datalist>
                </label>
                <button
                  type="submit"
                  disabled={adding}
                  style={{ fontFamily: 'var(--ff-sans)', fontSize: '0.82rem', fontWeight: 700, background: 'var(--accent)', border: 'none', borderRadius: 6, color: '#000', padding: '8px 20px', cursor: adding ? 'not-allowed' : 'pointer', opacity: adding ? 0.6 : 1, alignSelf: 'flex-end', marginBottom: 0 }}
                >
                  {adding ? 'Adding…' : 'Add node'}
                </button>
                {addError && (
                  <div style={{ width: '100%', fontSize: '0.8rem', color: 'var(--err)', marginTop: 4 }}>{addError}</div>
                )}
              </form>
            </div>
          )}
        </>
      )}

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 40, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
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
