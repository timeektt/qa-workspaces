/* jira-stats-view.js — modal "📈 สถิติ" ในแท็บ Jira List
   ดึง GET /api/jira/stats?window=… แล้ววาด line chart กลุ่มละ 3 (เส้น = คน) ด้วย d3
   กลุ่ม QA: สร้าง / reject / ปิดงาน · กลุ่ม Dev: ถูก assign / resolve / ถูก reject
   เลือก window: 1 สัปดาห์ / 1 เดือน / 3 เดือน / 1 ปี */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const api = (window.JCommon && window.JCommon.api) || null;

  const METRICS = {
    qa: [
      { key: 'created', title: 'issue ที่แจ้งใหม่' },
      { key: 'rejected', title: 'issue ที่ถูกตีกลับ (QA Rejected)' },
      { key: 'closed', title: 'issue ที่ปิดสำเร็จ (Done)' },
    ],
    dev: [
      { key: 'assigned', title: 'งานที่รับผิดชอบ (ถูก assign)' },
      { key: 'resolved', title: 'งานที่แก้เสร็จ (Done)' },
      { key: 'rejected', title: 'งานที่ถูกตีกลับ (QA Rejected)' },
    ],
  };
  const WIN_LABEL = { week: '1 สัปดาห์', month: '1 เดือน', quarter: '3 เดือน', year: '1 ปี' };
  const PALETTE = (window.d3 && d3.schemeTableau10) || ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'];

  let state = { group: 'qa', window: 'week' };
  const cache = {};              // window → data ที่ดึงมาแล้ว
  const colorMap = {};           // accountId → สี (คงที่ทั้ง session modal)
  const hidden = new Set();      // accountId ที่ถูกซ่อน (คลิก legend)
  let colorSeq = 0;

  const colorFor = (id) => (colorMap[id] || (colorMap[id] = PALETTE[colorSeq++ % PALETTE.length]));

  function openModal() {
    $('jst-modal').hidden = false;
    load();
  }
  function closeModal() { $('jst-modal').hidden = true; }

  async function load() {
    const win = state.window;
    const box = $('jst-charts');
    $('jst-meta').hidden = true;
    if (cache[win]) return render();
    box.innerHTML = '';
    const hide = window.QASpinner ? QASpinner.overlay(box, 'กำลังดึงสถิติจาก Jira…') : () => {};
    const r = await api('/api/jira/stats?window=' + win, { timeoutMs: 120000 }); // year ดึงนาน
    hide();
    if (!r.ok || !r.json || !r.json.ok) {
      box.innerHTML = '<p class="jst-empty">⚠️ ดึงสถิติไม่สำเร็จ — ' + ((r.json && (r.json.error)) || 'ตรวจว่า server รันอยู่และ .env Jira ครบ') + '</p>';
      return;
    }
    cache[win] = r.json;
    render();
  }

  // personmap { id:{name,values} } → [{id,name,values,color}] เรียงตามผลรวมมาก→น้อย
  function seriesOf(metricMap) {
    return Object.keys(metricMap || {}).map((id) => ({
      id, name: metricMap[id].name, values: metricMap[id].values.slice(), color: colorFor(id),
      total: metricMap[id].values.reduce((a, b) => a + b, 0),
    })).sort((a, b) => b.total - a.total);
  }

  function render() {
    const data = cache[state.window];
    const box = $('jst-charts');
    box.innerHTML = '';
    if (!data) return;

    // meta: จำนวนการ์ด + เตือน truncated
    const meta = $('jst-meta');
    meta.hidden = false;
    meta.textContent = `ช่วง ${WIN_LABEL[state.window]} · อ้างอิงวันที่ทำจริง (changelog) · ประมวลจาก ${data.issueCount} การ์ด`
      + (data.truncated ? ` · ⚠️ การ์ดเกินเพดาน ${data.issueCount} ใบ (เอาที่อัปเดตล่าสุดก่อน) — ช่วงเวลาเก่าอาจนับได้ต่ำกว่าจริง` : '');

    const g = data.groups[state.group];
    const metrics = METRICS[state.group];

    // legend รวมของกลุ่ม (ทุกคนที่โผล่ใน 3 metric) สีคงที่ คลิกสลับซ่อน
    const persons = {};
    for (const m of metrics) for (const id of Object.keys(g[m.key] || {})) {
      if (!persons[id]) persons[id] = { id, name: g[m.key][id].name };
    }
    const personList = Object.values(persons).sort((a, b) => a.name.localeCompare(b.name, 'th'));

    if (!personList.length) {
      box.innerHTML = '<p class="jst-empty">ยังไม่มีข้อมูลในช่วงนี้</p>';
      return;
    }

    const legend = document.createElement('div');
    legend.className = 'jst-legend';
    for (const p of personList) {
      const item = document.createElement('button');
      item.className = 'jst-leg-item' + (hidden.has(p.id) ? ' off' : '');
      item.innerHTML = `<span class="jst-swatch" style="background:${colorFor(p.id)}"></span>${escapeHtml(p.name)}`;
      item.addEventListener('click', () => {
        if (hidden.has(p.id)) hidden.delete(p.id); else hidden.add(p.id);
        render();
      });
      legend.appendChild(item);
    }
    box.appendChild(legend);

    for (const m of metrics) {
      const card = document.createElement('div');
      card.className = 'jst-chart';
      const total = Object.values(g[m.key] || {}).reduce((s, p) => s + p.values.reduce((a, b) => a + b, 0), 0);
      const h = document.createElement('div');
      h.className = 'jst-chart-title';
      h.innerHTML = `${escapeHtml(m.title)} <span class="jst-chart-total">รวม ${total}</span>`;
      card.appendChild(h);
      const svgWrap = document.createElement('div');
      svgWrap.className = 'jst-svg-wrap';
      card.appendChild(svgWrap);
      box.appendChild(card);
      drawChart(svgWrap, data.buckets.map((b) => b.label), seriesOf(g[m.key]).filter((s) => !hidden.has(s.id)));
    }
  }

  function drawChart(wrap, labels, series) {
    if (!window.d3) { wrap.textContent = 'โหลด d3 ไม่ได้'; return; }
    const W = Math.max(wrap.clientWidth || 640, 360);
    const H = 210;
    const m = { top: 12, right: 12, bottom: labels.length > 8 ? 46 : 28, left: 34 };
    const iw = W - m.left - m.right;
    const ih = H - m.top - m.bottom;

    const svg = d3.select(wrap).append('svg')
      .attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');
    const gRoot = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    const x = d3.scalePoint().domain(labels.map((_, i) => i)).range([0, iw]).padding(0.5);
    const maxV = d3.max(series, (s) => d3.max(s.values)) || 0;
    const y = d3.scaleLinear().domain([0, Math.max(1, maxV)]).nice().range([ih, 0]);

    // grid + แกน Y (จำนวนเต็ม)
    const yticks = Math.min(5, Math.max(1, Math.ceil(y.domain()[1])));
    gRoot.append('g').attr('class', 'jst-axis jst-grid')
      .call(d3.axisLeft(y).ticks(yticks).tickFormat(d3.format('d')).tickSize(-iw));
    // แกน X (label bucket)
    const xAxis = gRoot.append('g').attr('class', 'jst-axis').attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x).tickFormat((i) => labels[i]));
    if (labels.length > 8) {
      xAxis.selectAll('text').attr('transform', 'rotate(-40)').style('text-anchor', 'end');
    }

    const line = d3.line().x((_, i) => x(i)).y((v) => y(v));
    for (const s of series) {
      gRoot.append('path').attr('fill', 'none').attr('stroke', s.color).attr('stroke-width', 2)
        .attr('d', line(s.values));
      gRoot.selectAll(null).data(s.values).enter().append('circle')
        .attr('cx', (_, i) => x(i)).attr('cy', (v) => y(v)).attr('r', 3).attr('fill', s.color);
    }

    // ---- hover tooltip: ชี้ที่กราฟ → เส้นไกด์ตั้ง + กล่องแสดงค่าทุกคน ณ bucket นั้น ----
    const xs = labels.map((_, i) => x(i));
    const tip = document.createElement('div');
    tip.className = 'jst-tooltip'; tip.hidden = true;
    wrap.style.position = 'relative';
    wrap.appendChild(tip);
    const guide = gRoot.append('line').attr('class', 'jst-guide').attr('y1', 0).attr('y2', ih).style('display', 'none');
    const dots = gRoot.append('g');
    gRoot.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent').style('cursor', 'crosshair')
      .on('mousemove', function (ev) {
        const [mx, my] = d3.pointer(ev, this);
        let bi = 0, best = Infinity;
        for (let i = 0; i < xs.length; i++) { const d = Math.abs(mx - xs[i]); if (d < best) { best = d; bi = i; } }
        guide.attr('x1', xs[bi]).attr('x2', xs[bi]).style('display', null);
        const rows = series.map((s) => ({ name: s.name, color: s.color, v: s.values[bi] })).filter((r) => r.v > 0).sort((a, b) => b.v - a.v);
        dots.selectAll('circle').data(rows).join('circle')
          .attr('cx', xs[bi]).attr('cy', (r) => y(r.v)).attr('r', 4.5).attr('fill', (r) => r.color)
          .attr('stroke', '#fff').attr('stroke-width', 1.5);
        tip.innerHTML = `<div class="jst-tt-title">${escapeHtml(labels[bi])}</div>`
          + (rows.length ? rows.map((r) => `<div class="jst-tt-row"><span class="jst-swatch" style="background:${r.color}"></span>${escapeHtml(r.name)}<b>${r.v}</b></div>`).join('') : '<div class="jst-tt-row jst-tt-zero">— ไม่มี —</div>');
        tip.hidden = false;
        const px = xs[bi] + m.left, py = my + m.top;
        const tw = tip.offsetWidth, flip = px + 14 + tw > wrap.clientWidth;
        tip.style.left = (flip ? px - tw - 12 : px + 14) + 'px';
        tip.style.top = Math.max(0, py - 10) + 'px';
      })
      .on('mouseleave', () => { tip.hidden = true; guide.style('display', 'none'); dots.selectAll('circle').remove(); });
  }

  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function setGroup(gp) {
    if (state.group === gp) return;
    state.group = gp;
    document.querySelectorAll('.jst-seg-btn').forEach((b) => {
      const on = b.dataset.group === gp;
      b.classList.toggle('active', on); b.setAttribute('aria-checked', on);
    });
    render();
  }
  function setWindow(win) {
    if (state.window === win) return;
    state.window = win;
    document.querySelectorAll('.jst-win-btn').forEach((b) => {
      const on = b.dataset.window === win;
      b.classList.toggle('active', on); b.setAttribute('aria-checked', on);
    });
    load();
  }

  let wired = false;
  window.initJiraStats = function initJiraStats() {
    if (location.protocol === 'file:') { const b = $('jst-open'); if (b) b.hidden = true; return; }
    if (wired) return;
    wired = true;
    $('jst-open').addEventListener('click', openModal);
    $('jst-close').addEventListener('click', closeModal);
    $('jst-modal').addEventListener('click', (e) => { if (e.target === $('jst-modal')) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('jst-modal').hidden) closeModal(); });
    document.querySelectorAll('.jst-seg-btn').forEach((b) => b.addEventListener('click', () => setGroup(b.dataset.group)));
    document.querySelectorAll('.jst-win-btn').forEach((b) => b.addEventListener('click', () => setWindow(b.dataset.window)));
    window.addEventListener('resize', () => { if (!$('jst-modal').hidden) render(); });
  };
})();
