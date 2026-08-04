/* jira-reject.js — แท็บ "Jira List": ค้นหา/แสดงการ์ดที่เราสร้าง + เขียน reject intake ให้ Claude ประมวลต่อ */
(function () {
  'use strict';
  const { api, esc, setTabBadge } = window.JCommon;
  const $ = (id) => document.getElementById(id);

  let images = [];           // { name, dataUri, size } ของ reject form ปัจจุบัน
  let modalCtx = null;       // { issueKey, issueSummary, editStamp } ระหว่างเปิด modal

  const ALLOWED_EXT = new Set(['png','jpg','jpeg','gif','webp','svg','bmp','pdf','xls','xlsx','csv','doc','docx','txt','zip']);
  const IMAGE_EXT = new Set(['png','jpg','jpeg','gif','webp','svg','bmp']);
  const MAX_BYTES = 25 * 1024 * 1024;
  const extOf = (n) => (String(n).split('.').pop() || '').toLowerCase();
  const isImg = (n) => IMAGE_EXT.has(extOf(n));
  const fileIcon = (n) => {
    const e = extOf(n);
    if (e === 'pdf') return '📄';
    if (['xls','xlsx','csv'].includes(e)) return '📊';
    if (['doc','docx','txt'].includes(e)) return '📝';
    if (e === 'zip') return '🗜';
    return '📎';
  };
  const humanSize = (b) => b >= 1048576 ? (b/1048576).toFixed(1)+' MB' : Math.max(1,Math.round(b/1024))+' KB';

  let searchTimer = null;    // debounce ช่อง search (autosearch)
  let listPageToken = null;  // cursor สำหรับ "โหลดเพิ่ม" กลุ่มทั้งหมด

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
    $('jrj-thumbs').innerHTML = images.map((im, i) => {
      if (isImg(im.name)) {
        return `<div class="jin-thumb"><img src="${im.dataUri}" alt="${esc(im.name)}" data-i="${i}"><button class="jin-rm" data-i="${i}" title="ลบไฟล์">✕</button></div>`;
      }
      const size = im.size ? humanSize(im.size) : '';
      return `<div class="jin-file-chip"><span class="fc-ic">${fileIcon(im.name)}</span><span class="fc-meta"><span class="fc-name" title="${esc(im.name)}">${esc(im.name)}</span><span class="fc-size">${esc(size)}</span></span><button class="jin-rm" data-i="${i}" title="ลบไฟล์">✕</button></div>`;
    }).join('');
    $('jrj-thumbs').querySelectorAll('.jin-rm').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); images.splice(+b.dataset.i, 1); renderThumbs(); }));
  }
  async function addFiles(fileList) {
    const rejected = [];
    for (const f of fileList) {
      if (!ALLOWED_EXT.has(extOf(f.name))) { rejected.push(`${f.name} (ชนิดไม่รองรับ)`); continue; }
      if (f.size > MAX_BYTES) { rejected.push(`${f.name} (เกิน 25MB)`); continue; }
      const dataUri = await fileToDataUri(f);
      images.push({ name: f.name || `paste-${images.length + 1}.png`, dataUri, size: f.size });
    }
    renderThumbs();
    if (rejected.length && $('jrj-note')) $('jrj-note').textContent = '✗ ข้ามไฟล์: ' + rejected.join(', ');
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

  // ---------- search (autosearch: พิมพ์ key/url/เลขล้วน แล้วค้นเอง ไม่ต้องกดปุ่ม) ----------
  async function doSearch() {
    const q = $('jrl-q').value.trim();
    const box = $('jrl-search-result');
    if (!q) { box.innerHTML = ''; return; }
    box.innerHTML = '<p class="jm-note">⏳ กำลังค้นหา…</p>';
    const r = await api(`/api/jira/issue?q=${encodeURIComponent(q)}`);
    if (q !== $('jrl-q').value.trim()) return; // ค่าเปลี่ยนระหว่างรอผล — ทิ้งผลเก่า กันแสดงข้ามคำ
    if (!r.ok) {
      box.innerHTML = `<p class="jrl-notfound">✗ ${esc((r.json && r.json.error) || 'ค้นหาไม่สำเร็จ')}</p>`;
      return;
    }
    const issues = (r.json && r.json.issues) || [];
    if (!issues.length) { box.innerHTML = `<p class="jrl-notfound">✗ ไม่พบการ์ด (พิมพ์เลขการ์ด, key หรือ url)</p>`; return; }
    box.innerHTML = issues.map((it) => renderCard(it, r.json.browseBase)).join('');
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

  async function loadList() {
    const box = $('jrl-list');
    box.innerHTML = '<p class="jm-note">⏳ กำลังโหลดรายการจาก Jira…</p>';
    listPageToken = null;
    // หน้าแรก 100 ใบ (ทุก project เรียงสร้างล่าสุด) — พอสำหรับกลุ่มวันนี้/สัปดาห์นี้ · "ทั้งหมด" โหลดเพิ่มด้วย cursor
    const r = await api('/api/jira/my-issues');
    if (!r.ok) { box.innerHTML = `<p class="jrl-notfound">✗ ${esc((r.json && r.json.error) || 'โหลดไม่สำเร็จ')}</p>`; return; }
    renderGroups(box, r.json.issues || [], r.json.browseBase || '', r.json.nextPageToken || null);
  }

  function renderGroups(box, issues, browseBase, nextToken) {
    listPageToken = nextToken;
    const today0 = startOfToday();
    const DAY = 24 * 3600 * 1000;
    const monday0 = today0 - ((new Date().getDay() + 6) % 7) * DAY; // 00:00 วันจันทร์ของสัปดาห์นี้
    const nextMonday0 = monday0 + 7 * DAY; // ขอบบน exclusive = 23:59:59.999 วันอาทิตย์
    const ts = (it) => { const t = Date.parse(it.created); return isNaN(t) ? 0 : t; };
    const today = issues.filter((it) => ts(it) >= today0);
    const week = issues.filter((it) => ts(it) >= monday0 && ts(it) < nextMonday0);
    const cards = (arr) => arr.map((it) => renderCard(it, browseBase)).join('');
    const group = (title, arr) => {
      const body = arr.length ? cards(arr) : '<p class="jm-note">— ไม่มี —</p>';
      return `<div class="jrl-group"><h4 class="jrl-group-hd" role="button" tabindex="0"><span class="jrl-caret">▾</span> ${title} <span class="jrl-count">${arr.length}</span></h4><div class="jrl-group-body">${body}</div></div>`;
    };
    // กลุ่ม "ทั้งหมด" — cursor pagination: โชว์ที่โหลดมา + ปุ่ม "โหลดเพิ่ม" ต่อท้ายถ้ายังมีหน้า
    const loadMore = nextToken ? `<button class="jrl-loadmore jm-btn ghost">▾ โหลดเพิ่ม</button>` : '';
    const allBody = issues.length ? cards(issues) : '<p class="jm-note">— ไม่มี —</p>';
    const allGroup = `<div class="jrl-group"><h4 class="jrl-group-hd" role="button" tabindex="0"><span class="jrl-caret">▾</span> 📋 ทั้งหมด <span class="jrl-count">${issues.length}${nextToken ? '+' : ''}</span></h4><div class="jrl-group-body"><div class="jrl-all-cards">${allBody}</div>${loadMore}</div></div>`;
    box.innerHTML = group('📅 วันนี้', today) + group('🗓 สัปดาห์นี้ (จ.–อา.)', week) + allGroup;
    wireCards(box);
    box.querySelectorAll('.jrl-group-hd').forEach((h) => {
      const toggle = () => h.parentElement.classList.toggle('collapsed');
      h.addEventListener('click', toggle);
      h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    });
    // "โหลดเพิ่ม" — ดึงหน้าถัดไปด้วย cursor token แล้วต่อท้ายกลุ่ม "ทั้งหมด"
    const btn = box.querySelector('.jrl-loadmore');
    if (btn) btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!listPageToken) return;
      btn.textContent = '⏳ กำลังโหลด…'; btn.disabled = true;
      const rr = await api(`/api/jira/my-issues?pageToken=${encodeURIComponent(listPageToken)}`);
      if (!rr.ok) { btn.textContent = '✗ โหลดไม่สำเร็จ — ลองใหม่'; btn.disabled = false; return; }
      const more = rr.json.issues || [];
      const cardsWrap = btn.parentElement.querySelector('.jrl-all-cards');
      cardsWrap.insertAdjacentHTML('beforeend', cards(more));
      wireCards(cardsWrap);
      listPageToken = rr.json.nextPageToken || null;
      const shown = cardsWrap.querySelectorAll('.jrl-card').length;
      const badge = btn.closest('.jrl-group').querySelector('.jrl-count');
      if (badge) badge.textContent = `${shown}${listPageToken ? '+' : ''}`;
      if (listPageToken) { btn.textContent = '▾ โหลดเพิ่ม'; btn.disabled = false; }
      else btn.remove();
    });
  }

  // ---------- pending reject intakes ----------
  async function loadPending() {
    const box = $('jrl-pending');
    const r = await api('/api/jira/rejects');
    const list = (r.ok && r.json.rejects) || [];
    setTabBadge('list', list.length);
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

    $('jrl-refresh').addEventListener('click', () => { loadList(); loadPending(); });

    // autosearch — พิมพ์แล้ว debounce 350ms ค่อยยิง (ไม่มีปุ่มค้นหา) · Enter = ค้นทันที
    const q = $('jrl-q');
    q.addEventListener('input', () => {
      clearTimeout(searchTimer);
      if (!q.value.trim()) { $('jrl-search-result').innerHTML = ''; return; }
      searchTimer = setTimeout(doSearch, 350);
    });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(searchTimer); doSearch(); } });

    $('jrj-save').addEventListener('click', saveReject);
    $('jrj-cancel').addEventListener('click', closeModal);
    $('jrj-close').addEventListener('click', closeModal);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('jrj-modal').hidden) closeModal(); });

    const drop = $('jrj-drop');
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('drag'); addFiles(e.dataTransfer.files); });

    const fileInput = $('jrj-file-input');
    drop.addEventListener('click', () => fileInput.click());
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
    fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });

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

    loadPending(); // โหลด badge จำนวน reject ค้างตั้งแต่เปิด (แท็บเริ่มที่ intake ไม่ได้เรียก loadPending ของ list เอง)
  };
})();
