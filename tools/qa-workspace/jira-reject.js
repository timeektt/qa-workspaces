/* jira-reject.js — แท็บ "Jira List": ค้นหา/แสดงการ์ดที่เราสร้าง + เขียน reject intake ให้ Claude ประมวลต่อ */
(function () {
  'use strict';
  const { api, esc } = window.JCommon;
  const $ = (id) => document.getElementById(id);

  let images = [];           // { name, dataUri } ของ reject form ปัจจุบัน
  let modalCtx = null;       // { issueKey, issueSummary, editStamp } ระหว่างเปิด modal

  // ---------- tabs ----------
  function switchTab(name) {
    document.querySelectorAll('.jv-tab').forEach((b) => b.classList.toggle('active', b.dataset.jtab === name));
    const intake = $('jv-sub-intake'), list = $('jv-sub-list');
    if (intake) intake.hidden = name !== 'intake';
    if (list) list.hidden = name !== 'list';
    if (name === 'list') { loadList(); loadPending(); } // โหลดใหม่ทุกครั้งที่เข้าแท็บ — ข้อมูลสดเสมอ
  }

  // ---------- images (paste/drop) — mirror ของ jira-intake ----------
  function fileToDataUri(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }
  function renderThumbs() {
    $('jrj-thumbs').innerHTML = images.map((im, i) =>
      `<div class="jin-thumb"><img src="${im.dataUri}" alt="${esc(im.name)}" data-i="${i}"><button class="jin-rm" data-i="${i}" title="ลบรูป">✕</button></div>`).join('');
    $('jrj-thumbs').querySelectorAll('.jin-rm').forEach((b) =>
      b.addEventListener('click', () => { images.splice(+b.dataset.i, 1); renderThumbs(); }));
  }
  async function addFiles(fileList) {
    for (const f of fileList) {
      if (!f.type.startsWith('image/')) continue;
      const dataUri = await fileToDataUri(f);
      images.push({ name: f.name || `paste-${images.length + 1}.png`, dataUri });
    }
    renderThumbs();
  }

  // ---------- status badge ----------
  function statusBadge(status, cat) {
    const s = String(status || '—');
    let cls = 'jrl-badge';
    if (/reject/i.test(s)) cls += ' rej';
    else if (cat === 'done') cls += ' done';
    else if (cat === 'indeterminate') cls += ' prog';
    else cls += ' todo';
    return `<span class="${cls}">${esc(s)}</span>`;
  }

  // ---------- reject modal ----------
  function openModal({ issueKey, issueSummary, editStamp = null }) {
    modalCtx = { issueKey, issueSummary, editStamp };
    $('jrj-issue-key').textContent = issueKey;
    $('jrj-issue-summary').textContent = issueSummary ? '· ' + issueSummary : '';
    $('jrj-reason').value = '';
    images = []; renderThumbs();
    $('jrj-note').textContent = '';
    $('jrj-save').textContent = editStamp ? '💾 อัปเดต reject intake' : 'บันทึก reject intake';
    $('jrj-modal').hidden = false;
    $('jrj-reason').focus();
  }
  function closeModal() { $('jrj-modal').hidden = true; modalCtx = null; images = []; }

  async function openEdit(stamp) {
    const r = await api(`/api/jira/reject/${stamp}`);
    if (!r.ok) { window.alert('โหลด reject intake ไม่สำเร็จ: ' + (r.json.error || r.status)); return; }
    const rj = r.json.reject || {};
    openModal({ issueKey: rj.issueKey, issueSummary: rj.issueSummary, editStamp: stamp });
    $('jrj-reason').value = rj.reason || '';
    images = (r.json.images || []).map((im) => ({ name: im.name, dataUri: im.dataUri }));
    renderThumbs();
  }

  async function saveReject() {
    if (!modalCtx) return;
    const reason = $('jrj-reason').value.trim();
    if (!reason) { $('jrj-note').textContent = '✗ ต้องกรอกเหตุผล reject'; return; }
    const isEdit = !!modalCtx.editStamp;
    const btn = $('jrj-save'); btn.disabled = true; btn.textContent = isEdit ? 'กำลังอัปเดต…' : 'กำลังบันทึก…';
    const r = await api(isEdit ? `/api/jira/reject/${modalCtx.editStamp}` : '/api/jira/reject', {
      method: isEdit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueKey: modalCtx.issueKey, issueSummary: modalCtx.issueSummary, reason, images }),
    });
    btn.disabled = false; btn.textContent = isEdit ? '💾 อัปเดต reject intake' : 'บันทึก reject intake';
    if (r.ok && r.json.ok) {
      closeModal();
      $('jrl-note').textContent = `✓ บันทึก reject ${modalCtx && modalCtx.issueKey || ''} แล้ว — สั่ง Claude "ประมวลผล reject ที่ค้างทั้งหมด"`;
      loadPending();
    } else {
      $('jrj-note').textContent = `✗ บันทึกไม่สำเร็จ: ${esc(r.json.error || r.status)}`;
    }
  }

  // ---------- search ----------
  async function doSearch() {
    const q = $('jrl-q').value.trim();
    const box = $('jrl-search-result');
    if (!q) { box.innerHTML = ''; return; }
    box.innerHTML = '<p class="jm-note">⏳ กำลังค้นหา…</p>';
    const r = await api(`/api/jira/issue?q=${encodeURIComponent(q)}`);
    if (!r.ok || !r.json.issue) {
      box.innerHTML = `<p class="jrl-notfound">✗ ${esc((r.json && r.json.error) || 'ไม่พบข้อมูล / ไม่มี Card นี้')}</p>`;
      return;
    }
    box.innerHTML = renderCard(r.json.issue, r.json.browseBase);
    wireCards(box);
  }

  // ---------- list (3 กลุ่ม) ----------
  function renderCard(it, browseBase) {
    const url = (browseBase || '') + it.key;
    return `<div class="jrl-card">
      <span class="jrl-card-main"><a href="${esc(url)}" target="_blank" rel="noopener"><b>${esc(it.key)}</b></a> ${statusBadge(it.status, it.statusCategory)}<br><small>${esc(it.summary || '')}</small></span>
      <button class="jrl-reject-btn jm-btn" data-key="${esc(it.key)}" data-summary="${esc(it.summary || '')}">🚫 reject</button>
    </div>`;
  }
  function wireCards(scope) {
    scope.querySelectorAll('.jrl-reject-btn').forEach((b) =>
      b.addEventListener('click', () => openModal({ issueKey: b.dataset.key, issueSummary: b.dataset.summary })));
  }
  function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }

  const LIST_PAGE = 50; // จำนวนที่แสดงก่อนในกลุ่ม "ทั้งหมด" — ที่เหลือโหลดตอนกด "ดูทั้งหมด"

  async function loadList() {
    const box = $('jrl-list');
    box.innerHTML = '<p class="jm-note">⏳ กำลังโหลดรายการจาก Jira…</p>';
    // โหลดหน้าแรกก่อน (100 ใบ) — เร็ว ไม่ดึง 800+ รวด
    const r = await api('/api/jira/my-issues');
    if (!r.ok) { box.innerHTML = `<p class="jrl-notfound">✗ ${esc((r.json && r.json.error) || 'โหลดไม่สำเร็จ')}</p>`; return; }
    renderGroups(box, r.json.issues || [], r.json.browseBase || '', !!r.json.hasMore);
  }

  function renderGroups(box, issues, browseBase, hasMore) {
    const today0 = startOfToday();
    const DAY = 24 * 3600 * 1000;
    const monday0 = today0 - ((new Date().getDay() + 6) % 7) * DAY; // 00:00 วันจันทร์ของสัปดาห์นี้
    const nextMonday0 = monday0 + 7 * DAY; // ขอบบน exclusive = 23:59:59.999 วันอาทิตย์
    const ts = (it) => { const t = Date.parse(it.created); return isNaN(t) ? 0 : t; };
    const today = issues.filter((it) => ts(it) >= today0);
    const week = issues.filter((it) => ts(it) >= monday0 && ts(it) < nextMonday0);
    const cards = (arr) => arr.map((it) => renderCard(it, browseBase)).join('');
    // กลุ่ม "ทั้งหมด": โชว์ LIST_PAGE ใบแรก + ปุ่มถ้ายังมีต่อ (hasMore) หรือโหลดมาเกิน LIST_PAGE แล้ว
    const allShowBtn = hasMore || issues.length > LIST_PAGE;
    const allCount = hasMore ? `${issues.length}+` : String(issues.length);
    const group = (title, arr, opts = {}) => {
      const shown = opts.limited ? arr.slice(0, LIST_PAGE) : arr;
      const more = opts.showBtn ? `<button class="jrl-showall jm-btn ghost">▾ ดูทั้งหมด</button>` : '';
      const body = arr.length ? cards(shown) + more : '<p class="jm-note">— ไม่มี —</p>';
      const count = opts.count != null ? opts.count : arr.length;
      return `<div class="jrl-group"><h4 class="jrl-group-hd" role="button" tabindex="0"><span class="jrl-caret">▾</span> ${title} <span class="jrl-count">${count}</span></h4><div class="jrl-group-body">${body}</div></div>`;
    };
    box.innerHTML = group('📅 วันนี้', today) + group('🗓 สัปดาห์นี้ (จ.–อา.)', week)
      + group('📋 ทั้งหมด', issues, { limited: true, showBtn: allShowBtn, count: allCount });
    wireCards(box);
    box.querySelectorAll('.jrl-group-hd').forEach((h) => {
      const toggle = () => h.parentElement.classList.toggle('collapsed');
      h.addEventListener('click', toggle);
      h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    });
    // ปุ่ม "ดูทั้งหมด" — ตอนนี้ค่อยดึงทุกใบจาก Jira (?all=1) แล้ว render + อัปเดตตัวเลข
    box.querySelectorAll('.jrl-showall').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const body = b.parentElement;
      b.textContent = '⏳ กำลังโหลดทั้งหมด…'; b.disabled = true;
      const rr = await api('/api/jira/my-issues?all=1');
      if (!rr.ok) { b.textContent = '✗ โหลดไม่สำเร็จ — ลองใหม่'; b.disabled = false; return; }
      const all = rr.json.issues || [];
      body.innerHTML = cards(all);
      wireCards(body);
      const badge = body.parentElement.querySelector('.jrl-count');
      if (badge) badge.textContent = all.length;
    }));
  }

  // ---------- pending reject intakes ----------
  async function loadPending() {
    const box = $('jrl-pending');
    const r = await api('/api/jira/rejects');
    const list = (r.ok && r.json.rejects) || [];
    if (!list.length) { box.innerHTML = '<p class="jm-note">— ยังไม่มี reject intake ค้าง —</p>'; return; }
    box.innerHTML = list.map((it) => {
      const preview = esc((it.reason || '').slice(0, 80)) + ((it.reason || '').length > 80 ? '…' : '');
      const img = it.images && it.images.length ? ` · 🖼 ${it.images.length}` : '';
      return `<div class="jin-item"><span><b>${esc(it.issueKey || '?')}</b> · <small>${esc(it.issueSummary || '')}</small>${img}<br><small>${preview}</small></span><span class="jin-item-actions"><button class="jrl-edit-item" data-stamp="${esc(it.stamp)}">✏️ แก้ไข</button><button class="jrl-rm-item" data-stamp="${esc(it.stamp)}">🗑 ลบ</button></span></div>`;
    }).join('');
    box.querySelectorAll('.jrl-edit-item').forEach((b) => b.addEventListener('click', () => openEdit(b.dataset.stamp)));
    box.querySelectorAll('.jrl-rm-item').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!window.confirm(`ลบ reject intake นี้ทิ้งถาวร?`)) return;
        const r = await api(`/api/jira/reject/${b.dataset.stamp}`, { method: 'DELETE' });
        if (!r.ok) { window.alert('ลบไม่สำเร็จ: ' + (r.json.error || r.status)); return; }
        loadPending();
      }));
  }

  // เรียกจาก enterJira() ทุกครั้งที่เข้าแท็บ Jira — reset ไปแท็บ intake, wiring ครั้งเดียว
  let wired = false;
  window.initJiraReject = function initJiraReject() {
    if (location.protocol === 'file:') return;
    switchTab('intake');
    if (wired) return;
    wired = true;

    document.querySelectorAll('.jv-tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.jtab)));

    $('jrl-search-btn').addEventListener('click', doSearch);
    $('jrl-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
    $('jrl-refresh').addEventListener('click', () => { loadList(); loadPending(); });

    $('jrj-save').addEventListener('click', saveReject);
    $('jrj-cancel').addEventListener('click', closeModal);
    $('jrj-close').addEventListener('click', closeModal);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('jrj-modal').hidden) closeModal(); });

    const drop = $('jrj-drop');
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('drag'); addFiles(e.dataTransfer.files); });
    document.addEventListener('paste', (e) => {
      if ($('jrj-modal').hidden) return; // รับ paste เฉพาะตอน modal เปิด
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) { e.preventDefault(); addFiles(files); }
    });

    const copyBtn = $('jrl-copy-cmd');
    const LABEL = '📋 คัดลอก “ประมวลผล reject ที่ค้างทั้งหมด”';
    copyBtn.addEventListener('click', async () => {
      const cmd = 'ประมวลผล reject ที่ค้างทั้งหมด';
      try { await navigator.clipboard.writeText(cmd); }
      catch { const ta = document.createElement('textarea'); ta.value = cmd; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
      copyBtn.textContent = '✓ คัดลอกแล้ว';
      setTimeout(() => { copyBtn.textContent = LABEL; }, 1500);
    });
  };
})();
