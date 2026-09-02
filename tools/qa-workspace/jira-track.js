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

  // ทุกคำสั่งที่แตะข้อมูลรอบต้องวิ่งผ่าน Google Sheet (Apps Script) ซึ่งตอนถูกปลุกครั้งแรก
  // ใช้เวลาได้ถึงสิบกว่าวินาที — ค่า 20 วินาทีเริ่มต้นของ api() สั้นเกินจนหน้าจอฟ้องหมดเวลา
  // ทั้งที่ฝั่ง server ยังทำงานปกติ
  const SHEET_TIMEOUT_MS = 60000;

  const currentRound = () => rounds.find((r) => String(r.id) === String(currentId)) || null;

  // ป้ายบอกว่าข้อมูลรอบเก็บที่ไหน — กันเข้าใจผิดว่าทำไมเพื่อนไม่เห็นรอบที่เราสร้าง
  function renderBackend(kind) {
    const el = $('jtk-backend');
    if (!el || !kind) return;
    const sheet = kind === 'sheet';
    el.hidden = false;
    el.className = 'jtk-backend' + (sheet ? ' shared' : '');
    el.textContent = sheet ? '🔗 เก็บบน Google Sheet — ทีมเห็นข้อมูลชุดเดียวกัน' : '💻 เก็บในเครื่องนี้เท่านั้น — คนอื่นไม่เห็น';
    el.title = sheet
      ? 'ข้อมูลรอบอยู่บน Google Sheet ที่ตั้งไว้ใน .env (ROUNDS_SHEET_URL)'
      : 'ยังไม่ได้ตั้ง ROUNDS_SHEET_URL ใน .env — ดูวิธีที่ tools/qa-workspace/apps-script/README.md';
  }
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
    $('jtk-copy-left').disabled = none;
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
    const badge = st.pending
      ? '<span class="jrl-badge prog">กำลังบันทึก…</span>'
      : st.error
        ? `<span class="jrl-badge rej" title="${esc(st.error)}">ดึงสถานะไม่ได้</span>`
        : statusBadge(st.status, st.statusCategory);
    // ผู้แจ้ง (reporter) ดึงมาพร้อมสถานะ — การ์ดที่เพิ่งเพิ่ม (pending) หรือดึงสถานะไม่สำเร็จ จะยังไม่มีชื่อ
    const reporter = st.reporter
      ? `<br><small class="jtk-reporter" title="ผู้แจ้งการ์ดนี้ใน Jira">👤 ผู้แจ้ง: ${esc(st.reporter)}</small>`
      : '';
    return `<div class="jrl-card">
      <span class="jrl-card-main"><a href="${esc(url)}" target="_blank" rel="noopener"><b>${esc(st.key)}</b></a> ${badge}<br><small>${esc(st.summary || '')}</small>${reporter}</span>
      <span class="jtk-card-actions">
        <button class="jtk-reject-btn jrl-reject-btn jm-btn" data-key="${esc(st.key)}" data-summary="${esc(st.summary || '')}" title="เขียน reject intake ของ ${esc(st.key)}">🚫 reject</button>
        <button class="jtk-rm-btn jm-btn ghost" data-key="${esc(st.key)}" title="เอา ${esc(st.key)} ออกจากรอบนี้">🗑 เอาออก</button>
      </span>
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
    // cls แยกสีพื้นแผงต่อกลุ่ม (เสร็จแล้ว = เขียวอ่อน)
    const group = (title, arr, empty, cls) => {
      const body = arr.length ? arr.map(issueRow).join('') : `<p class="jm-note">— ${empty} —</p>`;
      return `<div class="jrl-group ${cls}"><h4 class="jrl-group-hd" role="button" tabindex="0"><span class="jrl-caret">▾</span> ${title} <span class="jrl-count">${arr.length}</span></h4><div class="jrl-group-body">${body}</div></div>`;
    };
    box.innerHTML = group('🔧 ยังไม่เสร็จ', left, 'เสร็จครบทุกใบแล้ว 🎉', 'jtk-g-left')
      + group('✅ เสร็จแล้ว', done, 'ยังไม่มีใบไหนเสร็จ', 'jtk-g-done');
    box.querySelectorAll('.jrl-group-hd').forEach((h) => {
      const toggle = () => h.parentElement.classList.toggle('collapsed');
      h.addEventListener('click', toggle);
      h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    });
    box.querySelectorAll('.jtk-rm-btn').forEach((b) => b.addEventListener('click', () => removeIssue(b, b.dataset.key)));
    // reject = หน้าต่างเดียวกับแท็บ Jira List · สิ่งที่บันทึกไปโผล่ใน "รายการ reject ที่ค้าง" ของแท็บนั้นเหมือนเดิม
    box.querySelectorAll('.jtk-reject-btn').forEach((b) => b.addEventListener('click', () => {
      if (!window.JiraReject) { $('jtk-note').textContent = '✗ เปิดหน้าต่าง reject ไม่ได้ — ลองรีเฟรชหน้า'; return; }
      $('jtk-note').textContent = '';
      window.JiraReject.openModal({ issueKey: b.dataset.key, issueSummary: b.dataset.summary, noteId: 'jtk-note' });
    }));
  }

  // ---------- คัดลอกรายการที่ยังไม่เสร็จ ----------
  // รูปแบบบรรทัดละใบ: "<ชื่อการ์ด> [<url>]" — เอาไปวางในแชท/อีเมลแล้วอ่านรู้เรื่องโดยไม่ต้องเปิดหน้านี้
  function leftoverText() {
    return statuses
      .filter((st) => !isDone(st))
      .map((st, i) => `${i + 1}. ${(st.summary || st.key).trim()} [${(browseBase || '') + st.key}]`)
      .join('\n');
  }

  async function copyLeftover() {
    const btn = $('jtk-copy-left');
    const note = $('jtk-note');
    const round = currentRound();
    if (!round) { note.textContent = '✗ ยังไม่ได้เลือกรอบ'; return; }
    const text = leftoverText();
    if (!text) { note.textContent = 'ℹ️ ไม่มีรายการค้าง — เสร็จครบทุกใบแล้ว'; return; }
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    const n = text.split('\n').length;
    note.textContent = `✓ คัดลอกรายการที่ยังไม่เสร็จ ${n} ใบแล้ว`;
    const label = btn.textContent;
    btn.textContent = '✓ คัดลอกแล้ว';
    setTimeout(() => { btn.textContent = label; }, 1500);
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
    box.innerHTML = QASpinner.inline('กำลังโหลดรอบติดตาม… (ครั้งแรกอาจรอสิบกว่าวินาที ระหว่างปลุก Google Sheet)');
    const r = await api('/api/jira/rounds', { timeoutMs: SHEET_TIMEOUT_MS });
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
    renderBackend(r.json.backend);
    const remembered = keepSelection ? (currentId || safeGet(LAST_KEY)) : currentId;
    currentId = rounds.some((x) => String(x.id) === String(remembered)) ? remembered : (rounds[0] && rounds[0].id) || null;
    safeSet(LAST_KEY, currentId || '');
    renderRoundBar();
    renderSummary();
    await loadStatus();
    if (!rounds.length) setTabBadge('track', 0);
    refreshSearchButtons();
  }

  // ---------- อัปเดตเงียบๆ ทุก 2 นาที (ใช้ร่วมกันหลายคน — เห็นสิ่งที่คนอื่นเพิ่ม/เอาออกโดยไม่ต้องกดรีเฟรช) ----------
  // ไม่โชว์ spinner ไม่ล้างหน้าจอ · ข้ามรอบเมื่อแท็บถูกซ่อน/สลับไปแท็บอื่น/เปิดหน้าต่างแก้รอบอยู่
  const POLL_MS = 120000;
  let pollTimer = null;
  let pollBusy = false;

  function pollPaused() {
    const sub = $('jv-sub-track');
    return !sub || sub.hidden || document.visibilityState !== 'visible'
      || !$('jtk-modal').hidden || pollBusy;
  }

  async function refreshQuiet() {
    if (pollPaused()) return;
    pollBusy = true;
    try {
      const r = await api('/api/jira/rounds', { timeoutMs: SHEET_TIMEOUT_MS });
      if (!r.ok) return;                       // ต่อ server ไม่ได้ชั่วคราว — เงียบไว้ รอบหน้าค่อยลองใหม่
      rounds = r.json.rounds || [];
      renderBackend(r.json.backend);
      if (!rounds.some((x) => String(x.id) === String(currentId))) currentId = (rounds[0] && rounds[0].id) || null;
      renderRoundBar();
      renderSummary();
      refreshSearchButtons();
      const round = currentRound();
      if (!round || !(round.issues || []).length) { renderList(); return; }
      const s = await api(`/api/jira/round/${encodeURIComponent(round.id)}/status`, { timeoutMs: 60000 });
      if (!s.ok || String(currentId) !== String(round.id)) return;
      statuses = s.json.issues || [];
      browseBase = s.json.browseBase || browseBase;
      renderSummary();
      renderList();
    } finally {
      pollBusy = false;
    }
  }

  const safeGet = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* โหมด private = ข้ามไป */ } };

  // ---------- คำสั่งที่เขียนข้อมูล ----------
  // เก็บข้อมูลบน Google Sheet อาจใช้เวลาหลายวินาที (Apps Script) จึงทำ 2 อย่าง:
  //   1) วาดผลบนหน้าจอทันทีที่กด แล้วค่อยยิงเบื้องหลัง — พลาดเมื่อไรค่อยถอนกลับ (optimistic)
  //   2) ยิงพลาด/หมดเวลา ไม่ด่วนสรุปว่าล้มเหลว — ดึงข้อมูลจริงมาดูก่อนว่าบันทึกไปแล้วหรือยัง
  const WRITE_TIMEOUT_MS = SHEET_TIMEOUT_MS;
  const writeApi = (path, opts = {}) => api(path, { timeoutMs: WRITE_TIMEOUT_MS, ...opts });

  /** ดึงรายการรอบสดจาก server (ข้ามแคชฝั่งหน้าเว็บ) — ใช้ตรวจว่าคำสั่งที่ยิงพลาดนั้น "ผ่านจริงไหม" */
  async function fetchRoundsFresh() {
    const r = await api('/api/jira/rounds', { timeoutMs: WRITE_TIMEOUT_MS });
    return r.ok ? (r.json.rounds || []) : null;
  }

  /**
   * ยิงคำสั่งเขียน แล้วถ้าไม่สำเร็จให้ตรวจกับข้อมูลจริงก่อนสรุป
   * landed(rounds) = ฟังก์ชันตอบว่า "ผลที่ต้องการเกิดขึ้นแล้วหรือยัง" เมื่อดูจากข้อมูลจริง
   * คืน { ok, round?, error? } — ok:true ทั้งกรณียิงผ่าน และกรณียิงพลาดแต่ข้อมูลจริงเปลี่ยนแล้ว
   */
  async function writeThenVerify(request, landed) {
    const r = await request();
    if (r.ok && r.json && r.json.ok) return { ok: true, round: r.json.round };
    const fresh = await fetchRoundsFresh();
    if (fresh) {
      const round = landed(fresh);
      if (round) return { ok: true, round, recovered: true };
    }
    return { ok: false, error: (r.json && r.json.error) || r.status || 'บันทึกไม่สำเร็จ' };
  }

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
    const K = String(key).toUpperCase();

    // วาดผลทันที: การ์ดเด้งเข้ากลุ่ม "ยังไม่เสร็จ" ก่อน แล้วค่อยเติมสถานะจริงทีหลัง
    round.issues.push({ key: K, summary, addedAt: new Date().toISOString() });
    statuses.push({ key: K, summary, status: null, statusCategory: null, pending: true });
    renderRoundBar(); renderSummary(); renderList(); refreshSearchButtons();
    $('jtk-note').textContent = `กำลังบันทึก ${K} เข้ารอบ…`;
    const restore = QASpinner.button(btn, 'กำลังเพิ่ม…');

    const res = await writeThenVerify(
      () => writeApi(`/api/jira/round/${encodeURIComponent(round.id)}/issues`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, summary }),
      }),
      (fresh) => {
        const r2 = fresh.find((x) => String(x.id) === String(round.id));
        return r2 && (r2.issues || []).some((it) => String(it.key).toUpperCase() === K) ? r2 : null;
      });
    restore();

    if (!res.ok) {   // ถอนสิ่งที่วาดไว้กลับ เพราะของจริงไม่ได้บันทึก
      round.issues = round.issues.filter((it) => String(it.key).toUpperCase() !== K);
      statuses = statuses.filter((st) => String(st.key).toUpperCase() !== K);
      renderRoundBar(); renderSummary(); renderList(); refreshSearchButtons();
      $('jtk-note').textContent = `✗ เพิ่มไม่สำเร็จ: ${res.error}`;
      return;
    }

    round.issues = res.round.issues;
    $('jtk-note').textContent = `✓ เพิ่ม ${K} เข้ารอบ “${round.name}” แล้ว`;
    // ถามสถานะเฉพาะใบที่เพิ่งเพิ่ม (ไม่ถาม Jira ซ้ำทุกใบในรอบ)
    const one = await api(`/api/jira/issue?q=${encodeURIComponent(K)}`);
    const found = (one.ok && one.json.issues && one.json.issues[0]) || null;
    const slot = statuses.find((st) => String(st.key).toUpperCase() === K);
    const filled = found
      ? { key: found.key, summary: found.summary, status: found.status, statusCategory: found.statusCategory }
      : { key: K, summary, status: null, statusCategory: null, error: 'ดึงสถานะไม่สำเร็จ' };
    if (slot) Object.assign(slot, filled, { pending: false });
    else statuses.push(filled);
    renderRoundBar(); renderSummary(); renderList(); refreshSearchButtons();
  }

  async function removeIssue(btn, key) {
    const round = currentRound();
    if (!round) return;
    const K = String(key).toUpperCase();
    if (!window.confirm(`เอา ${K} ออกจากรอบ “${round.name}”?`)) return;

    // เอาออกจากหน้าจอก่อน แล้วค่อยยิง — พลาดค่อยใส่กลับ
    const keptIssues = round.issues.slice();
    const keptStatuses = statuses.slice();
    round.issues = round.issues.filter((it) => String(it.key).toUpperCase() !== K);
    statuses = statuses.filter((st) => String(st.key).toUpperCase() !== K);
    renderRoundBar(); renderSummary(); renderList(); refreshSearchButtons();
    $('jtk-note').textContent = `กำลังเอา ${K} ออกจากรอบ…`;

    const res = await writeThenVerify(
      () => writeApi(`/api/jira/round/${encodeURIComponent(round.id)}/issue/${encodeURIComponent(K)}`, { method: 'DELETE' }),
      (fresh) => {
        const r2 = fresh.find((x) => String(x.id) === String(round.id));
        return r2 && !(r2.issues || []).some((it) => String(it.key).toUpperCase() === K) ? r2 : null;
      });

    if (!res.ok) {
      round.issues = keptIssues;
      statuses = keptStatuses;
      renderRoundBar(); renderSummary(); renderList(); refreshSearchButtons();
      $('jtk-note').textContent = `✗ เอาออกไม่สำเร็จ: ${res.error}`;
      return;
    }
    round.issues = res.round.issues;
    $('jtk-note').textContent = `✓ เอา ${K} ออกจากรอบแล้ว`;
    renderRoundBar(); renderSummary(); renderList(); refreshSearchButtons();
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

    const res = await writeThenVerify(
      () => writeApi(editing ? `/api/jira/round/${encodeURIComponent(editing)}` : '/api/jira/rounds', {
        method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, dueDate }),
      }),
      (fresh) => editing
        ? fresh.find((x) => String(x.id) === String(editing) && x.dueDate === dueDate && (!name || x.name === name))
        : fresh.find((x) => x.dueDate === dueDate && x.name === (name || `รอบ ${dueDate.split('-').reverse().join('/')}`)));
    restore();

    if (!res.ok) { $('jtk-f-note').textContent = `✗ บันทึกไม่สำเร็จ: ${res.error}`; return; }

    closeModal();
    $('jtk-note').textContent = editing ? '✓ แก้ไขรอบแล้ว' : `✓ สร้างรอบ “${res.round.name}” แล้ว`;
    if (editing) {
      const round = rounds.find((x) => String(x.id) === String(editing));
      if (round) { round.name = res.round.name; round.dueDate = res.round.dueDate; }
      renderRoundBar();
      renderSummary();
      return;                       // แก้แค่ชื่อ/วันที่ — การ์ดกับสถานะเดิมยังใช้ได้ ไม่ต้องโหลดใหม่
    }
    rounds.unshift(res.round);      // รอบใหม่ยังไม่มีการ์ด จึงไม่ต้องถาม Jira เลย
    currentId = res.round.id;
    safeSet(LAST_KEY, currentId);
    statuses = [];
    renderRoundBar();
    renderSummary();
    renderList();
    refreshSearchButtons();
  }

  async function deleteRound() {
    const round = currentRound();
    if (!round) return;
    const n = (round.issues || []).length;
    if (!window.confirm(`ลบรอบ “${round.name}” ทิ้งถาวร?${n ? ` (การ์ด ${n} ใบในรอบจะหายไปจากการติดตามด้วย — ตัวการ์ดใน Jira ไม่ถูกแตะ)` : ''}`)) return;

    const kept = rounds.slice();
    const keptStatuses = statuses.slice();
    const keptId = currentId;
    rounds = rounds.filter((x) => String(x.id) !== String(round.id));   // เอาออกจากหน้าจอก่อน
    currentId = (rounds[0] && rounds[0].id) || null;
    statuses = [];
    renderRoundBar(); renderSummary(); renderList();
    $('jtk-note').textContent = `กำลังลบรอบ “${round.name}”…`;
    const restore = QASpinner.button($('jtk-del'), 'กำลังลบ…');

    const res = await writeThenVerify(
      () => writeApi(`/api/jira/round/${encodeURIComponent(round.id)}`, { method: 'DELETE' }),
      (fresh) => fresh.some((x) => String(x.id) === String(round.id)) ? null : { id: round.id });
    restore();

    if (!res.ok) {                                                       // ใส่กลับ เพราะของจริงยังอยู่
      rounds = kept;
      currentId = keptId;
      statuses = keptStatuses;
      renderRoundBar(); renderSummary(); renderList(); refreshSearchButtons();
      $('jtk-note').textContent = `✗ ลบไม่สำเร็จ: ${res.error}`;
      return;
    }
    safeSet(LAST_KEY, currentId || '');
    $('jtk-note').textContent = `✓ ลบรอบ “${round.name}” แล้ว`;
    refreshSearchButtons();
    await loadStatus();             // ดึงสถานะของรอบที่เลื่อนขึ้นมาแทน (ถ้าไม่มีรอบเหลือก็จบตรงนี้)
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
    $('jtk-copy-left').addEventListener('click', copyLeftover);
    $('jtk-refresh').title = 'ดึงสถานะล่าสุดของทุกการ์ดในรอบจาก Jira (หน้านี้อัปเดตให้เองทุก 2 นาทีอยู่แล้ว)';

    $('jtk-f-save').addEventListener('click', saveRound);
    $('jtk-f-cancel').addEventListener('click', closeModal);
    $('jtk-modal-close').addEventListener('click', closeModal);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('jtk-modal').hidden) closeModal();
    });

    // autosearch — debounce 350ms (เหมือนแท็บ Jira List) · Enter = ค้นทันที
    const q = $('jtk-q');
    q.addEventListener('input', () => {
      clearTimeout(searchTimer);
      if (!q.value.trim()) { $('jtk-search-result').innerHTML = ''; return; }
      searchTimer = setTimeout(doSearch, 350);
    });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(searchTimer); doSearch(); } });

    if (!pollTimer) pollTimer = setInterval(refreshQuiet, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshQuiet(); });
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
      const r = await api('/api/jira/rounds', { timeoutMs: SHEET_TIMEOUT_MS });
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
