// ── Dashboard state ───────────────────────────────────────────────────────────
let nodes        = [];
let selectedId   = '';
let timeRange    = '1h';
let charts       = {};
let initialized  = false;
let compareMode  = false;
let compareNodeIds = [];

// Color palettes [primary, secondary] per node index — used for dual-line charts
const NODE_PALETTES = [
  ['#06b6d4', '#60a5fa'],   // cyan / blue   (primary node)
  ['#34d399', '#6ee7b7'],   // emerald / teal
  ['#f59e0b', '#fcd34d'],   // amber / yellow
  ['#e879f9', '#c084fc'],   // fuchsia / violet
];

// ── Chart initialisation ──────────────────────────────────────────────────────
const chartBaseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  plugins: {
    legend: {
      display: false,
      labels: { color: '#94a3b8', font: { size: 10 }, boxWidth: 10 },
    },
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

function makeChart(id) {
  const ctx = document.getElementById(id).getContext('2d');
  return new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [] },
    options: JSON.parse(JSON.stringify(chartBaseOptions)),
  });
}

function initCharts() {
  charts.soc     = makeChart('chart-soc');
  charts.voltage = makeChart('chart-voltage');
  charts.temp    = makeChart('chart-temp');
}

// ── Chart rendering ───────────────────────────────────────────────────────────
function setNoData(chartId, hasData) {
  const el = document.getElementById('no-data-' + chartId);
  if (el) el.classList.toggle('hidden', hasData);
}

/**
 * Render one chart with data from one or more nodes.
 * @param {Chart} chart       Chart.js instance
 * @param {Array} results     Array of { nodeId, soc, volt, temp }
 * @param {string} dataKey    Which key on each result object holds the data
 * @param {Array} fields      [{ key, label }] — which fields to plot per dataset
 * @param {string} chartId    ID suffix for no-data overlay (e.g. 'soc')
 */
function renderMultiChart(chart, results, dataKey, fields, chartId) {
  const datasets  = [];
  let firstLabels = null;
  let hasData     = false;

  results.forEach((result, ni) => {
    const data = result[dataKey];
    if (!data || !data.length) return;
    hasData = true;

    const labels = data.map(d =>
      new Date(d.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );
    if (!firstLabels) firstLabels = labels;

    const palette = NODE_PALETTES[ni % NODE_PALETTES.length];

    fields.forEach((field, fi) => {
      const color = palette[fi % palette.length];
      // Show node name in legend only when comparing; always label field for temp (2 lines)
      const label = results.length > 1
        ? `${result.nodeId} ${field.label}`
        : field.label;

      datasets.push({
        label,
        data:            data.map(d => d[field.key]),
        borderColor:     color,
        backgroundColor: color + '18',
        borderWidth:     2,
        pointRadius:     0,
        fill:            ni === 0 && fi === 0,
        tension:         0.3,
      });
    });
  });

  setNoData(chartId, hasData);
  if (!hasData) return;

  chart.data.labels   = firstLabels || [];
  chart.data.datasets = datasets;
  // Show legend whenever there are multiple lines (compare mode OR temp dual-lines)
  chart.options.plugins.legend.display = datasets.length > 1;
  chart.update('none');
}

// ── Data fetching ─────────────────────────────────────────────────────────────
async function fetchLatest() {
  try {
    const resp = await fetch('/api/latest');
    const data = await resp.json();
    nodes = Array.isArray(data) ? data : [data];

    if (!initialized && nodes.length) {
      selectedId  = nodes[0].node_id;
      initialized = true;
      populateSelect();
      document.getElementById('loading').classList.add('hidden');
      document.getElementById('content').classList.remove('hidden');
      initCharts();
      fetchCharts();
    }
    renderCards();
    document.getElementById('last-updated').textContent =
      'Updated ' + new Date().toLocaleTimeString();
  } catch { /* retry on next tick */ }
}

async function fetchCharts() {
  if (!selectedId) return;
  const allNodeIds = compareMode ? [selectedId, ...compareNodeIds] : [selectedId];

  try {
    const results = await Promise.all(allNodeIds.map(async nodeId => {
      const base = `/api/metrics?node_id=${encodeURIComponent(nodeId)}&range=${timeRange}`;
      const [soc, volt, temp] = await Promise.all([
        fetch(`${base}&metric=soc`).then(r => r.json()),
        fetch(`${base}&metric=pack_voltage`).then(r => r.json()),
        fetch(`${base}&metric=temperature`).then(r => r.json()),
      ]);
      return { nodeId, soc, volt, temp };
    }));

    renderMultiChart(charts.soc,     results, 'soc',  [{ key: 'value', label: 'SOC' }],     'soc');
    renderMultiChart(charts.voltage, results, 'volt', [{ key: 'value', label: 'Voltage' }],  'voltage');
    renderMultiChart(charts.temp,    results, 'temp', [
      { key: 'high', label: 'High' },
      { key: 'low',  label: 'Low'  },
    ], 'temp');
  } catch (err) {
    console.error('Chart fetch error:', err);
  }
}

// ── Node selector & metric cards ─────────────────────────────────────────────
function populateSelect() {
  const sel = document.getElementById('node-select');
  sel.innerHTML = nodes.map(n => `<option value="${n.node_id}">${n.node_id}</option>`).join('');
  sel.value = selectedId;
  sel.onchange = () => {
    selectedId = sel.value;
    // Drop the newly-primary node from the compare list if it was there
    compareNodeIds = compareNodeIds.filter(id => id !== selectedId);
    renderCards();
    if (compareMode) renderComparePanel();
    fetchCharts();
  };
}

function fmt(v, d = 1) {
  return (v !== undefined && v !== null) ? Number(v).toFixed(d) : '—';
}

function card(label, value, unit = '', bar = null, highlight = 'normal') {
  const colors   = { normal: '#f1f5f9', warning: '#fbbf24', danger: '#f87171', success: '#34d399' };
  const color    = colors[highlight] || colors.normal;
  const pct      = (bar !== null && bar !== undefined) ? Math.min(100, Math.max(0, bar)) : null;
  const barColor = highlight === 'danger' ? '#f87171' : highlight === 'warning' ? '#fbbf24' : '#06b6d4';
  const barHtml  = pct !== null
    ? `<div class="bar-bg"><div class="bar-fg" style="width:${pct}%;background:${barColor}"></div></div>`
    : '';
  return `<div class="metric-card">
    <div class="metric-label">${label}</div>
    <div style="color:${color}">
      <span class="metric-value">${value}</span><span class="metric-unit">${unit}</span>
    </div>
    ${barHtml}
  </div>`;
}

function renderCards() {
  const row = nodes.find(n => n.node_id === selectedId);
  if (!row) return;

  const fault  = row.fault_active;
  const soc    = row.soc;
  const socHL  = soc === undefined ? 'normal' : soc >= 30 ? 'normal' : soc >= 15 ? 'warning' : 'danger';
  const tempHL = row.temp_high > 45 ? 'danger' : 'normal';

  document.getElementById('cards').innerHTML =
    card('State of Charge', fmt(soc),                '%',  soc,  socHL)   +
    card('Pack Voltage',    fmt(row.pack_voltage),    'V')                 +
    card('Pack Current',    fmt(row.pack_current),    'A')                 +
    card('Temp High',       fmt(row.temp_high),       '°C', null, tempHL)  +
    card('Temp Low',        fmt(row.temp_low),        '°C')                +
    card('Highest Cell',    fmt(row.highest_cell_v, 3), 'V')               +
    card('Lowest Cell',     fmt(row.lowest_cell_v, 3),  'V')               +
    card('CCL',             fmt(row.ccl),             'A')                 +
    card('DCL',             fmt(row.dcl),             'A')                 +
    card('Fault Status',    fault ? 'ACTIVE' : 'Clear', '', null, fault ? 'danger' : 'success');

  const banner = document.getElementById('fault-banner');
  if (fault) {
    document.getElementById('fault-title').textContent    = `Fault Active — ${row.bms_id}`;
    document.getElementById('fault-subtitle').textContent = `Last cleared ${fmt(row.faults_cleared_min)} min ago`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }

  document.getElementById('footer').textContent = `UEI Cloud Platform · ${row.bms_id ?? '—'}`;
}

// ── Compare mode ──────────────────────────────────────────────────────────────
function toggleCompareMode() {
  compareMode = !compareMode;
  const panel = document.getElementById('compare-panel');
  const btn   = document.getElementById('compare-btn');

  if (compareMode) {
    panel.classList.remove('hidden');
    btn.classList.add('bg-cyan-500', 'text-slate-950', 'border-cyan-500');
    btn.classList.remove('text-slate-400', 'border-slate-600');
    renderComparePanel();
  } else {
    panel.classList.add('hidden');
    btn.classList.remove('bg-cyan-500', 'text-slate-950', 'border-cyan-500');
    btn.classList.add('text-slate-400', 'border-slate-600');
    compareNodeIds = [];
    fetchCharts();
  }
}

function toggleCompareNode(nodeId) {
  if (compareNodeIds.includes(nodeId)) {
    compareNodeIds = compareNodeIds.filter(id => id !== nodeId);
  } else if (compareNodeIds.length < 3) {
    compareNodeIds.push(nodeId);
  }
  renderComparePanel();
  fetchCharts();
}

function renderComparePanel() {
  const list       = document.getElementById('compare-nodes-list');
  const otherNodes = nodes.filter(n => n.node_id !== selectedId);

  if (!otherNodes.length) {
    list.innerHTML = '<span class="text-slate-500 text-xs italic">No other nodes available to compare</span>';
    return;
  }

  list.innerHTML = otherNodes.map((n, i) => {
    const active = compareNodeIds.includes(n.node_id);
    const color  = NODE_PALETTES[(i + 1) % NODE_PALETTES.length][0];
    return `<button
      onclick="toggleCompareNode('${n.node_id}')"
      class="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
        active
          ? 'bg-slate-700 border-cyan-600 text-slate-100'
          : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-500 hover:text-slate-300'
      }"
    >
      <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
      ${n.node_id}
      ${active ? '<span style="color:#22d3ee;margin-left:2px">✓</span>' : ''}
    </button>`;
  }).join('');
}

// ── Time range ────────────────────────────────────────────────────────────────
function setRange(r) {
  timeRange = r;
  document.querySelectorAll('.range-btn').forEach(b => {
    const active = b.dataset.range === r;
    b.className = `range-btn px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
      active ? 'bg-cyan-500 text-slate-950' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
    }`;
  });
  resetChartTimer();
  fetchCharts();
}

// ── Polling ───────────────────────────────────────────────────────────────────
// Chart refresh interval adapts to range: fast for short ranges, slow for long ones
const CHART_INTERVALS = { '5m': 5000, '15m': 5000, '30m': 10000, '1h': 30000, '6h': 30000, '24h': 60000 };
let chartTimer = null;

function resetChartTimer() {
  if (chartTimer) clearInterval(chartTimer);
  chartTimer = setInterval(fetchCharts, CHART_INTERVALS[timeRange] ?? 30000);
}

fetchLatest();
setInterval(fetchLatest, 5000);
resetChartTimer();

// ── Chatbot ───────────────────────────────────────────────────────────────────
let chatOpen    = false;
let chatBusy    = false;
let chatHistory = [];

function toggleChat() {
  chatOpen = !chatOpen;
  document.getElementById('chat-panel').classList.toggle('hidden', !chatOpen);
  document.getElementById('icon-open').classList.toggle('hidden', chatOpen);
  document.getElementById('icon-close').classList.toggle('hidden', !chatOpen);
  if (chatOpen) document.getElementById('chat-input').focus();
}

function newChat() {
  chatHistory = [];
  document.getElementById('chat-messages').innerHTML = buildSuggestionsHtml();
}

function buildSuggestionsHtml() {
  const prompts = [
    'How many nodes are reporting?',
    'Show the latest SOC for all nodes',
    'Are there any active faults?',
    'What is the average pack voltage?',
    'Show temp trends in the last hour',
  ];
  return `<div id="suggestions" class="flex flex-col gap-2 pt-1">
    <p class="text-xs text-slate-500 text-center mb-1">Suggestions</p>
    ${prompts.map(p => `<button onclick="sendChat(this.textContent)" class="suggestion-btn">${p}</button>`).join('')}
  </div>`;
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMd(text) {
  return text
    .replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre style="background:#0f172a;padding:8px;border-radius:6px;font-size:0.75rem;overflow-x:auto;margin:4px 0">$1</pre>')
    .replace(/`([^`]+)`/g, '<code style="background:#0f172a;padding:1px 5px;border-radius:3px;font-size:0.8em">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^\s*[-*]\s+(.+)$/gm, '<li style="margin-left:12px">$1</li>')
    .replace(/\n/g, '<br>');
}

function appendMsg(role, html, id) {
  const msgs = document.getElementById('chat-messages');
  const div  = document.createElement('div');
  div.className = `flex ${role === 'user' ? 'justify-end' : 'justify-start'}`;
  div.innerHTML = `<div id="${id || ''}" class="max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
    role === 'user'
      ? 'bg-cyan-700 text-cyan-50 rounded-br-sm'
      : 'bg-slate-800 text-slate-200 rounded-bl-sm'
  }">${html}</div>`;
  msgs.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return div.querySelector(`#${id}`) || div.firstChild;
}

async function sendChat(text) {
  if (!text.trim() || chatBusy) return;
  document.getElementById('chat-input').value = '';
  chatBusy = true;
  document.getElementById('chat-btn').disabled = true;

  document.getElementById('suggestions')?.remove();
  appendMsg('user', escHtml(text));

  const msgId  = 'msg-' + Date.now();
  const bubble = appendMsg(
    'assistant',
    '<div style="display:flex;align-items:center;gap:6px;color:#64748b;font-style:italic">' +
    '<span style="width:6px;height:6px;border-radius:50%;background:#22d3ee;display:inline-block;animation:pulse 1s infinite"></span>' +
    'Thinking…</div>',
    msgId,
  );

  let accumulated = '';
  let hasContent  = false;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history: chatHistory }),
    });

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let event;
        try { event = JSON.parse(line.slice(6)); } catch { continue; }

        if (event.type === 'text') {
          if (!hasContent) { bubble.innerHTML = ''; hasContent = true; }
          accumulated += event.text;
          let tb = bubble.querySelector('.text-body');
          if (!tb) { tb = document.createElement('div'); tb.className = 'text-body'; bubble.appendChild(tb); }
          tb.innerHTML = renderMd(accumulated);
          bubble.scrollIntoView({ behavior: 'smooth', block: 'end' });

        } else if (event.type === 'query') {
          if (!hasContent) { bubble.innerHTML = ''; hasContent = true; }
          const badge = document.createElement('div');
          badge.style.cssText = 'display:flex;align-items:flex-start;gap:6px;background:#0f172a;border:1px solid #1e3a5f;border-radius:8px;padding:5px 8px;font-size:0.7rem;font-family:monospace;color:#7dd3fc;margin-bottom:4px;word-break:break-all';
          badge.innerHTML = `<span style="color:#22d3ee;flex-shrink:0">▶</span><span>${escHtml(event.sql.trim())}</span><span style="color:#475569;margin-left:auto;padding-left:6px;flex-shrink:0">${event.rows}r</span>`;
          bubble.insertBefore(badge, bubble.querySelector('.text-body') || null);

        } else if (event.type === 'done') {
          chatHistory = [...chatHistory,
            { role: 'user',      content: text },
            { role: 'assistant', content: event.assistantText || accumulated },
          ];
        } else if (event.type === 'error') {
          bubble.innerHTML = `<span style="color:#f87171">Error: ${escHtml(event.text)}</span>`;
        }
      }
    }
  } catch (err) {
    bubble.innerHTML = `<span style="color:#f87171">Connection error: ${escHtml(err.message)}</span>`;
  }

  chatBusy = false;
  document.getElementById('chat-btn').disabled = false;
  document.getElementById('chat-input').focus();
}

function submitChat(e) {
  e.preventDefault();
  sendChat(document.getElementById('chat-input').value.trim());
  return false;
}

// Initialise chat suggestions on load
newChat();
