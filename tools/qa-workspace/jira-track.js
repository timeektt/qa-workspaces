/* jira-track.js — แท็บ "ติดตาม issue": รวมการ์ด Jira ที่ต้องแก้ให้เสร็จเป็น "รอบ" แล้วดูสถานะสดว่าเหลือใบไหน */
(function () {
  'use strict';
  const { api, esc, setTabBadge } = window.JCommon;
  const $ = (id) => document.getElementById(id);

  let rounds = [];          // [{id,name,dueDate,issues:[{key,summary}]}] — จาก server (ไม่มีสถานะ)
  let currentId = null;     // รอบที่กำลังดู
  let statuses = [];        // [{key,summary,status,statusCategory,error?}] — สถานะสดจาก Jira ของรอบปัจจุบัน
  let browseBase = '';
  let searchTimer = null;
  let modalCtx = null;      // null = สร้างใหม่ · {id} = แก้ไขรอบนั้น
  const LAST_KEY = 'qa-workspace:jira-track:lastRound'; // จำรอบที่เปิดค้างไว้ข้ามการรีเฟรชหน้า

  const currentRound = () => rounds.find((r) => String(r.id) === String(currentId)) || null;
  const isDone = (st) => st && st.statusCategory === 'done';

  // ---------- วันที่ ----------
  const fmtDate = (iso) => { const [y, m, d] = String(iso || '').split('-'); return y ? `${d}/${m}/${y}` : '—'; };
  function daysLeft(iso) {
    const t = Date.parse(String(iso) + 'T00:00:00');
    if (isNaN(t)) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((t - today.getTime()) / 86400000);
  }
  function dueText(iso) {
    const n = daysLeft(iso);
    if (n === null) return '';
    if (n > 0) return `เหลืออีก ${n} วัน`;
    if (n === 0) return 'ครบกำหนดวันนี้';
    return `เลยกำหนดมา ${-n} วัน`;
  }

  // ---------- badge สถานะ (รูปแบบเดียวกับแท็บ Jira List) ----------
  function statusBadge(status, cat) {
    const s = String(status || '—');
    let cls = 'jrl-badge';
    if (/reject/i.test(s)) cls += ' rej';
    else if (cat === 'done') cls += ' done';
    else if (cat === 'indeterminate') cls += ' prog';
    else cls += ' todo';
    return `<span class="${cls}">${esc(s)}</span>`;
  }

  // ---------- แถบเลือกรอบ ----------
  function renderRoundBar() {
    const sel = $('jtk-round');
    if (!rounds.length) {
      sel.innerHTML = '<option value="">— ยังไม่มีรอบ —</option>';
      sel.value = '';
      sel.disabled = true;
    } else {
      sel.disabled = false;
      sel.innerHTML = rounds.map((r) =>
        `<option value="${esc(r.id)}">${esc(r.name)} · ครบกำหนด ${esc(fmtDate(r.dueDate))} (${r.issues ? r.issues.length : 0} ใบ)</option>`).join('');
      sel.value = String(currentId);
    }
    const none = !rounds.length;
    $('jtk-edit').disabled = none;
    $('jtk-del').disabled = none;
    $('jtk-refresh').disabled = none;
    $('jtk-q').disabled = none;
  }

  // ---------- แถบสรุป ----------
  function renderSummary() {
    const box = $('jtk-summary');
    const round = currentRound();
    if (!round) { box.innerHTML = ''; return; }
    const total = (round.issues || []).length;
    const done = statuses.filter(isDone).length;
    const left = Math.max(0, total - done);
    const pct = total ? Math.round((done / total) * 100) : 0;
    const over = (daysLeft(round.dueDate) || 0) < 0 && left > 0;
    const cleared = total > 0 && left === 0;
    box.innerHTML = `<div class="jtk-sum-head">
        <b class="jtk-sum-name">${esc(round.name)}</b>
        <span class="jtk-sum-due${over ? ' over' : ''}">ครบกำหนด ${esc(fmtDate(round.dueDate))} · ${esc(dueText(round.dueDate))}</span>
      </div>
      <div class="jtk-bar" role="img" aria-label="ความคืบหน้า ${pct} เปอร์เซ็นต์"><span class="jtk-bar-fill${cleared ? ' full' : ''}" style="width:${pct}%"></span></div>
      <p class="jtk-sum-line">${total ? `เสร็จแล้ว <b>${done}</b> จาก <b>${total}</b> ใบ · เหลืออีก <b class="${left ? 'jtk-left' : 'jtk-cleared'}">${left}</b> ใบ` : 'ยังไม่มีการ์ดในรอบนี้ — ค้นหาแล้วกด “＋ เพิ่มเข้ารอบ” ด้านล่าง'}</p>`;
    setTabBadge('track', left);
  }

  // ---------- รายการการ์ดในรอบ ----------
  function issueRow(st) {
    const url = (browseBase || '') + st.key;
    const badge = st.error
      ? `<span class="jrl-badge rej" title="${esc(st.error)}">ดึงสถานะไม่ได้</span>`
      : statusBadge(st.status, st.statusCategory);
    return `<div class="jrl-card">
      <span class="jrl-card-main"><a href="${esc(url)}" target="_blank" rel="noopener"><b>${esc(st.key)}</b></a> ${badge}<br><small>${esc(st.summary || '')}</small></span>
      <button class="jtk-rm-btn jm-btn ghost" data-key="${esc(st.key)}" title="เอา ${esc(st.key)} ออกจากรอบนี้">🗑 เอาออก</button>
    </div>`;
  }

  function renderList() {
    const box = $('jtk-list');
    const round = currentRound();
    if (!round) {
      box.innerHTML = '<p class="jm-note">— ยังไม่มีรอบติดตาม กด “＋ รอบใหม่” เพื่อเริ่มรอบแรก —</p>';
      return;
    }
    if (!(round.issues || []).length) {
      box.innerHTML = '<p class="jm-note">— ยังไม่มีการ์ดในรอบนี้ —</p>';
      return;
    }
    const left = statuses.filter((st) => !isDone(st));
    const done = statuses.filter(isDone);
    const group = (title, arr, empty) => {
      const body = arr.length ? arr.map(issueRow).join('') : `<p class="jm-note">— ${empty} —</p>`;
      return `<div class="jrl-group"><h4 class="jrl-group-hd" role="button" tabindex="0"><span class="jrl-caret">▾</span> ${title} <span class="jrl-count">${arr.length}</span></h4><div class="jrl-group-body">${body}</div></div>`;
    };
    box.innerHTML = group('🔧 ยังไม่เสร็จ', left, 'เสร็จครบทุกใบแล้ว 🎉')
      + group('✅ เสร็จแล้ว', done, 'ยังไม่มีใบไหนเสร็จ');
    box.querySelectorAll('.jrl-group-hd').forEach((h) => {
      const toggle = () => h.parentElement.classList.toggle('collapsed');
      h.addEventListener('click', toggle);
      h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    });
    box.querySelectorAll('.jtk-rm-btn').forEach((b) => b.addEventListener('click', () => removeIssue(b, b.dataset.key)));
  }

  // ---------- โหลดสถานะสดจาก Jira ----------
  async function loadStatus() {
    const round = currentRound();
    statuses = [];
    if (!round) { renderSummary(); renderList(); return; }
    if (!(round.issues || []).length) { renderSummary(); renderList(); return; }
    const box = $('jtk-list');
    box.innerHTML = QASpinner.inline('กำลังดึงสถานะล่าสุดจาก Jira…');
    const r = await api(`/api/jira/round/${encodeURIComponent(round.id)}/status`, { timeoutMs: 60000 });
    if (String(currentId) !== String(round.id)) return; // เปลี่ยนรอบระหว่างรอผล — ทิ้งผลเก่า
    if (!r.ok) {
      box.innerHTML = `<p class="jrl-notfound">✗ ${esc((r.json && r.json.error) || 'ดึงสถานะไม่สำเร็จ')}</p>
        <button class="jtk-retry jm-btn ghost">🔄 ลองใหม่</button>`;
      const retry = box.querySelector('.jtk-retry');
      if (retry) retry.addEventListener('click', loadStatus);
      return;
    }
    statuses = r.json.issues || [];
    browseBase = r.json.browseBase || browseBase;
    renderSummary();
    renderList();
  }

  // ---------- โหลดรอบทั้งหมด ----------
  async function loadRounds({ keepSelection = true } = {}) {
    const box = $('jtk-list');
    box.innerHTML = QASpinner.inline('กำลังโหลดรอบติดตาม…');
    const r = await api('/api/jira/rounds');
    if (!r.ok) {
      rounds = [];
      renderRoundBar();
      box.innerHTML = `<p class="jrl-notfound">✗ ${esc((r.json && r.json.error) || 'โหลดรอบไม่สำเร็จ')}</p>
        <button class="jtk-retry jm-btn ghost">🔄 ลองใหม่</button>`;
      const retry = box.querySelector('.jtk-retry');
      if (retry) retry.addEventListener('click', () => loadRounds());
      return;
    }
    rounds = r.json.rounds || [];
    const remembered = keepSelection ? (currentId || safeGet(LAST_KEY)) : currentId;
    currentId = rounds.some((x) => String(x.id) === String(remembered)) ? remembered : (rounds[0] && rounds[0].id) || null;
    safeSet(LAST_KEY, currentId || '');
    renderRoundBar();
    renderSummary();
    await loadStatus();
    if (!rounds.length) setTabBadge('track', 0);
    refreshSearchButtons();
  }

  const safeGet = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* โหมด private = ข้ามไป */ } };

  // ---------- ค้นหา + เพิ่มเข้ารอบ ----------
  function inRound(key) {
    const round = currentRound();
    return !!round && (round.issues || []).some((it) => String(it.key).toUpperCase() === String(key).toUpperCase());
  }
  function searchCard(it) {
    const url = (browseBase || '') + it.key;
    const already = inRound(it.key);
    return `<div class="jrl-card">
      <span class="jrl-card-main"><a href="${esc(url)}" target="_blank" rel="noopener"><b>${esc(it.key)}</b></a> ${statusBadge(it.status, it.statusCategory)}<br><small>${esc(it.summary || '')}</small></span>
      <button class="jtk-add-btn jm-btn primary" data-key="${esc(it.key)}" data-summary="${esc(it.summary || '')}"${already ? ' disabled' : ''}>${already ? '✓ อยู่ในรอบแล้ว' : '＋ เพิ่มเข้ารอบ'}</button>
    </div>`;
  }
  function refreshSearchButtons() {
    $('jtk-search-result').querySelectorAll('.jtk-add-btn').forEach((b) => {
      const already = inRound(b.dataset.key);
      b.disabled = already;
      b.textContent = already ? '✓ อยู่ในรอบแล้ว' : '＋ เพิ่มเข้ารอบ';
    });
  }
  async function doSearch() {
    const q = $('jtk-q').value.trim();
    const box = $('jtk-search-result');
    if (!q) { box.innerHTML = ''; return; }
    box.innerHTML = QASpinner.inline('กำลังค้นหา…');
    const r = await api(`/api/jira/issue?q=${encodeURIComponent(q)}`);
    if (q !== $('jtk-q').value.trim()) return; // ค่าเปลี่ยนระหว่างรอผล — ทิ้งผลเก่า
    if (!r.ok) { box.innerHTML = `<p class="jrl-notfound">✗ ${esc((r.json && r.json.error) || 'ค้นหาไม่สำเร็จ')}</p>`; return; }
    const issues = (r.json && r.json.issues) || [];
    browseBase = (r.json && r.json.browseBase) || browseBase;
    if (!issues.length) { box.innerHTML = '<p class="jrl-notfound">✗ ไม่พบการ์ด (พิมพ์เลขการ์ด, key หรือ url)</p>'; return; }
    box.innerHTML = issues.map(searchCard).join('');
    box.querySelectorAll('.jtk-add-btn').forEach((b) =>
      b.addEventListener('click', () => addIssue(b, b.dataset.key, b.dataset.summary)));
  }

  async function addIssue(btn, key, summary) {
    const round = currentRound();
    if (!round) { $('jtk-note').textContent = '✗ ยังไม่มีรอบ — กด “＋ รอบใหม่” ก่อน'; return; }
    const restore = QASpinner.button(btn, 'กำลังเพิ่ม…');
    const r = await api(`/api/jira/round/${encodeURIComponent(round.id)}/issues`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, summary }),
    });
    restore();
    if (!(r.ok && r.json.ok)) { $('jtk-note').textContent = `✗ เพิ่มไม่สำเร็จ: ${(r.json && r.json.error) || r.status}`; return; }
    round.issues = r.json.round.issues;
    $('jtk-note').textContent = `✓ เพิ่ม ${key} เข้ารอบ “${round.name}” แล้ว`;
    renderRoundBar();
    refreshSearchButtons();
    await loadStatus();
  }

  async function removeIssue(btn, key) {
    const round = currentRound();
    if (!round) return;
    if (!window.confirm(`เอา ${key} ออกจากรอบ “${round.name}”?`)) return;
    const restore = QASpinner.button(btn, 'กำลังเอาออก…');
    const r = await api(`/api/jira/round/${encodeURIComponent(round.id)}/issue/${encodeURIComponent(key)}`, { method: 'DELETE' });
    restore();
    if (!(r.ok && r.json.ok)) { $('jtk-note').textContent = `✗ เอาออกไม่สำเร็จ: ${(r.json && r.json.error) || r.status}`; return; }
    round.issues = r.json.round.issues;
    statuses = statuses.filter((st) => String(st.key).toUpperCase() !== String(key).toUpperCase());
    $('jtk-note').textContent = `✓ เอา ${key} ออกจากรอบแล้ว`;
    renderRoundBar();
    renderSummary();
    renderList();
    refreshSearchButtons();
  }

  // ---------- modal สร้าง/แก้ไขรอบ ----------
  function openModal(round) {
    modalCtx = round ? { id: round.id } : null;
    $('jtk-modal-title').textContent = round ? 'แก้ไขรอบ' : 'รอบใหม่';
    $('jtk-f-due').value = round ? round.dueDate : '';
    $('jtk-f-name').value = round ? round.name : '';
    $('jtk-f-note').textContent = '';
    $('jtk-f-save').textContent = round ? '💾 บันทึกการแก้ไข' : 'สร้างรอบ';
    $('jtk-modal').hidden = false;
    if (window.QAFocusTrap) QAFocusTrap($('jtk-modal').querySelector('.jrj-box'), { onEscape: closeModal });
    $('jtk-f-due').focus();
  }
  function closeModal() { $('jtk-modal').hidden = true; modalCtx = null; }

  async function saveRound() {
    const dueDate = $('jtk-f-due').value.trim();
    const name = $('jtk-f-name').value.trim();
    if (!dueDate) { $('jtk-f-note').textContent = '✗ ต้องเลือกวันครบกำหนดก่อน (ช่องบนสุด)'; $('jtk-f-due').focus(); return; }
    const editing = modalCtx && modalCtx.id;
    const btn = $('jtk-f-save');
    const restore = QASpinner.button(btn, 'กำลังบันทึก…');
    const r = await api(editing ? `/api/jira/round/${encodeURIComponent(editing)}` : '/api/jira/rounds', {
      method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, dueDate }),
    });
    restore();
    if (!(r.ok && r.json.ok)) { $('jtk-f-note').textContent = `✗ บันทึกไม่สำเร็จ: ${(r.json && r.json.error) || r.status}`; return; }
    currentId = r.json.round.id;
    closeModal();
    $('jtk-note').textContent = editing ? '✓ แก้ไขรอบแล้ว' : `✓ สร้างรอบ “${r.json.round.name}” แล้ว`;
    await loadRounds();
  }

  async function deleteRound() {
    const round = currentRound();
    if (!round) return;
    const n = (round.issues || []).length;
    if (!window.confirm(`ลบรอบ “${round.name}” ทิ้งถาวร?${n ? ` (การ์ด ${n} ใบในรอบจะหายไปจากการติดตามด้วย — ตัวการ์ดใน Jira ไม่ถูกแตะ)` : ''}`)) return;
    const btn = $('jtk-del');
    const restore = QASpinner.button(btn, 'กำลังลบ…');
    const r = await api(`/api/jira/round/${encodeURIComponent(round.id)}`, { method: 'DELETE' });
    restore();
    if (!(r.ok && r.json.ok)) { $('jtk-note').textContent = `✗ ลบไม่สำเร็จ: ${(r.json && r.json.error) || r.status}`; return; }
    currentId = null;
    $('jtk-note').textContent = `✓ ลบรอบ “${round.name}” แล้ว`;
    await loadRounds({ keepSelection: false });
  }

  // ---------- init ----------
  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;

    $('jtk-round').addEventListener('change', async (e) => {
      currentId = e.target.value;
      safeSet(LAST_KEY, currentId || '');
      renderSummary();
      refreshSearchButtons();
      await loadStatus();
    });
    $('jtk-new').addEventListener('click', () => openModal(null));
    $('jtk-edit').addEventListener('click', () => { const r = currentRound(); if (r) openModal(r); });
    $('jtk-del').addEventListener('click', deleteRound);
    $('jtk-refresh').addEventListener('click', () => loadRounds());

    $('jtk-f-save').addEventListener('click', saveRound);
    $('jtk-f-cancel').addEventListener('click', closeModal);
    $('jtk-modal-close').addEventListener('click', closeModal);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('jtk-modal').hidden) closeModal(); });

    // autosearch — debounce 350ms (เหมือนแท็บ Jira List) · Enter = ค้นทันที
    const q = $('jtk-q');
    q.addEventListener('input', () => {
      clearTimeout(searchTimer);
      if (!q.value.trim()) { $('jtk-search-result').innerHTML = ''; return; }
      searchTimer = setTimeout(doSearch, 350);
    });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(searchTimer); doSearch(); } });
  }

  window.JiraTrack = {
    // เรียกทุกครั้งที่เข้าแท็บ "ติดตาม issue" — โหลดรอบ + สถานะสดใหม่เสมอ
    enter() {
      if (location.protocol === 'file:') return;
      wire();
      $('jtk-note').textContent = '';
      loadRounds();
    },
    // เรียกตอนเข้าหน้า Jira ครั้งแรก — อัปเดต badge จำนวนใบที่ยังไม่เสร็จโดยไม่ต้องเปิดแท็บ
    async warmBadge() {
      if (location.protocol === 'file:') return;
      const r = await api('/api/jira/rounds');
      if (!r.ok) return;
      rounds = r.json.rounds || [];
      const remembered = safeGet(LAST_KEY);
      currentId = rounds.some((x) => String(x.id) === String(remembered)) ? remembered : (rounds[0] && rounds[0].id) || null;
      const round = currentRound();
      if (!round || !(round.issues || []).length) { setTabBadge('track', 0); return; }
      const s = await api(`/api/jira/round/${encodeURIComponent(round.id)}/status`, { timeoutMs: 60000 });
      if (!s.ok) return;
      setTabBadge('track', (s.json.issues || []).filter((st) => !isDone(st)).length);
    },
  };
})();
