/* jira-intake.js — Intake sub-tab: จับ text+รูปดิบ ส่งเข้า store ให้ Claude ประมวลต่อ */
(function () {
  'use strict';
  const { api, esc, setTabBadge } = window.JCommon;
  const $ = (id) => document.getElementById(id);
  let images = []; // { name, dataUri }
  let editingStamp = null; // stamp ของ intake ที่กำลังแก้ไข (null = โหมดสร้างใหม่)

  function fileToDataUri(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  function openPreview(dataUri, name) {
    let ov = $('jin-lightbox');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'jin-lightbox';
      ov.className = 'jin-lightbox';
      ov.innerHTML = '<figure><img alt=""><figcaption></figcaption></figure><button class="jin-lb-close" title="ปิด (Esc)">✕</button>';
      document.body.appendChild(ov);
      const close = () => { ov.classList.remove('open'); };
      ov.addEventListener('click', (e) => { if (e.target === ov || e.target.classList.contains('jin-lb-close')) close(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    }
    ov.querySelector('img').src = dataUri;
    ov.querySelector('figcaption').textContent = name || '';
    ov.classList.add('open');
  }

  function renderThumbs() {
    $('jin-thumbs').innerHTML = images.map((im, i) =>
      `<div class="jin-thumb"><img src="${im.dataUri}" alt="${esc(im.name)}" title="คลิกเพื่อดูภาพเต็ม" data-i="${i}"><button class="jin-rm" data-i="${i}" title="ลบรูป">✕</button></div>`).join('');
    $('jin-thumbs').querySelectorAll('.jin-thumb img').forEach((img) =>
      img.addEventListener('click', () => { const im = images[+img.dataset.i]; if (im) openPreview(im.dataUri, im.name); }));
    $('jin-thumbs').querySelectorAll('.jin-rm').forEach((b) =>
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

  let metaLoaded = false;
  let defaultEpicKey = '';
  let defaultSprintId = '';
  let defaultSystem = '';
  let defaultProjectKey = ''; // project หลักจาก .env — fallback เมื่อ "ระบบ" = ไม่ระบุ
  let defaultProjectMeta = null; // meta ของ project หลัก (cache ไว้ reset ฟอร์มแบบ sync)

  // เติม dropdown component/epic/sprint จาก meta ของ "project ที่เลือก" (children ของ hierarchy)
  // m: { components, epics, sprints, activeSprint, defaultEpic }
  function applyProjectMeta(m) {
    const cs = $('jin-component');
    if (cs) {
      const comps = m.components || [];
      cs.innerHTML = comps.length
        ? '<option value="">— ไม่ระบุ (ให้ระบบเดาเอง) —</option>' +
          comps.map((c) => `<option value="${esc(c.id)}" data-name="${esc(c.name)}">${esc(c.name)}</option>`).join('')
        : '<option value="">— ไม่มี component —</option>';
    }

    const es = $('jin-epic');
    if (es) {
      defaultEpicKey = m.defaultEpic || '';
      const epics = m.epics || [];
      let html = epics.map((e) =>
        `<option value="${esc(e.key)}"${e.key === defaultEpicKey ? ' selected' : ''}>${esc(e.key)} — ${esc(e.summary)}${e.key === defaultEpicKey ? ' (ค่าเริ่มต้น)' : ''}</option>`).join('');
      if (defaultEpicKey && !epics.some((e) => e.key === defaultEpicKey)) {
        html = `<option value="${esc(defaultEpicKey)}" selected>${esc(defaultEpicKey)} (ค่าเริ่มต้น)</option>` + html;
      }
      es.innerHTML = html || '<option value="">— ไม่มี epic —</option>';
    }

    const ss = $('jin-sprint');
    if (ss) {
      const sprints = m.sprints || [];
      const act = m.activeSprint;
      defaultSprintId = act ? String(act.id) : '';
      ss.innerHTML = `<option value="">— Backlog (ไม่ใส่ sprint) —</option>` +
        sprints.map((s) => `<option value="${esc(s.id)}" data-name="${esc(s.name)}"${act && s.id === act.id ? ' selected' : ''}>${esc(s.name)}${act && s.id === act.id ? ' (ค่าเริ่มต้น · active)' : ''}</option>`).join('');
    }
  }

  // key ของ project ที่ "ระบบ" กำลังเลือก (data-key ของ option) — ว่าง = ใช้ default
  function selectedProjectKey() {
    const sys = $('jin-system');
    const opt = sys && sys.selectedOptions[0];
    return (opt && opt.dataset.key) || '';
  }

  // โหลด component/epic/sprint ของ project ที่เลือกใหม่ (cascade เมื่อเปลี่ยน "ระบบ")
  async function reloadProjectMeta(projectKey) {
    const key = projectKey || defaultProjectKey;
    const r = await api(`/api/jira/project-meta?key=${encodeURIComponent(key)}`);
    if (r.ok) applyProjectMeta(r.json);
    return r.ok ? r.json : null;
  }

  async function loadMeta() {
    if (metaLoaded) return;
    const r = await api('/api/jira/meta');
    if (!r.ok) return;
    const m = r.json;

    // ระบบที่พบปัญหา (parent ของ hierarchy) — ดึง project ทั้งหมด · ค่าเริ่มต้น: project หลักจาก .env
    const sys = $('jin-system');
    if (sys) {
      const projects = m.projects || [];
      defaultProjectKey = m.defaultProjectKey || '';
      const dftProj = projects.find((p) => p.key === defaultProjectKey);
      defaultSystem = dftProj ? dftProj.name : '';
      sys.innerHTML = '<option value="" data-key="">— ไม่ระบุ (ใช้ project หลัก) —</option>' +
        projects.map((p) =>
          `<option value="${esc(p.name)}" data-key="${esc(p.key)}"${p.key === defaultProjectKey ? ' selected' : ''}>${esc(p.name)} (${esc(p.key)})${p.key === defaultProjectKey ? ' · ค่าเริ่มต้น' : ''}</option>`).join('');
      // เปลี่ยนระบบ → โหลด component/epic/sprint ของ project นั้นใหม่
      sys.addEventListener('change', () => reloadProjectMeta(selectedProjectKey()));
    }

    // children เริ่มต้น = project หลัก (meta หน้าแรกส่ง components/epics/sprints/activeSprint/defaultEpic ของ default มาแล้ว)
    defaultProjectMeta = m;
    applyProjectMeta(m);
    metaLoaded = true;
  }

  async function loadPending() {
    const r = await api('/api/jira/intakes');
    const list = (r.ok && r.json.intakes) || [];
    setTabBadge('intake', list.length);
    if (!list.length) { $('jin-pending').innerHTML = '<p class="jm-note">— ยังไม่มี intake ค้าง —</p>'; return; }
    $('jin-pending').innerHTML = list.map((it) => {
      const preview = esc((it.text || '').slice(0, 80)) + ((it.text || '').length > 80 ? '…' : '');
      const img = it.images && it.images.length ? ` · 🖼 ${it.images.length}` : '';
      const type = it.type ? ` · 🐞 ${esc(it.type)}` : ' · 🤖 auto';
      const comp = it.component ? ` · 🏷 ${esc(it.component)}` : '';
      const sprint = it.sprintId ? ` · 🏃 ${esc(it.sprintLabel || it.sprintId)}` : '';
      const editing = it.stamp === editingStamp ? ' jin-item-editing' : '';
      return `<div class="jin-item${editing}"><span><b>${esc(it.stamp)}</b> · ${esc(it.system || '—')}${type}${comp}${sprint}${img}<br><small>${preview}</small></span><span class="jin-item-actions"><button class="jin-edit-item" data-stamp="${esc(it.stamp)}">✏️ แก้ไข</button><button class="jin-rm-item" data-stamp="${esc(it.stamp)}">🗑 ลบ</button></span></div>`;
    }).join('');
    $('jin-pending').querySelectorAll('.jin-edit-item').forEach((b) =>
      b.addEventListener('click', () => startEdit(b.dataset.stamp)));
    $('jin-pending').querySelectorAll('.jin-rm-item').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!window.confirm(`ลบ intake ${b.dataset.stamp} ทิ้งถาวร?`)) return;
        const r = await api(`/api/jira/intake/${b.dataset.stamp}`, { method: 'DELETE' });
        if (!r.ok) { window.alert('ลบไม่สำเร็จ: ' + (r.json.error || r.status)); return; }
        if (b.dataset.stamp === editingStamp) cancelEdit();
        loadPending();
      }));
  }

  // โหลด intake กลับเข้าฟอร์มด้านบนเพื่อแก้ไข
  async function startEdit(stamp) {
    const r = await api(`/api/jira/intake/${stamp}`);
    if (!r.ok) { window.alert('โหลด intake ไม่สำเร็จ: ' + (r.json.error || r.status)); return; }
    const it = r.json.intake || {};
    editingStamp = stamp;
    $('jin-text').value = it.text || '';
    images = (r.json.images || []).map((im) => ({ name: im.name, dataUri: im.dataUri }));
    renderThumbs();
    const typeSel = $('jin-type'); if (typeSel) typeSel.value = it.type || '';
    const sysSel = $('jin-system'); if (sysSel) sysSel.value = it.system || '';
    // โหลด component/epic/sprint ตาม project ของ intake ก่อน แล้วค่อยเซ็ตค่าที่เลือกไว้
    const pk = it.projectKey || defaultProjectKey;
    if (pk && pk !== defaultProjectKey) await reloadProjectMeta(pk);
    else if (defaultProjectMeta) applyProjectMeta(defaultProjectMeta);
    const compSel = $('jin-component'); if (compSel) compSel.value = it.componentId || '';
    const epicSel = $('jin-epic'); if (epicSel) epicSel.value = it.epicKey || defaultEpicKey;
    const sprintSel = $('jin-sprint'); if (sprintSel) sprintSel.value = it.sprintId || '';
    setEditMode(true);
    loadPending(); // ไฮไลต์ card ที่กำลังแก้
    $('jv-sub-intake').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function cancelEdit() {
    editingStamp = null;
    setEditMode(false);
    resetForm();
    loadPending();
  }

  function setEditMode(on) {
    const save = $('jin-save');
    if (save) save.textContent = on ? '💾 อัปเดต intake' : 'บันทึก intake';
    const cancel = $('jin-cancel-edit');
    if (cancel) cancel.style.display = on ? '' : 'none';
    if (on) $('jin-note').textContent = `✏️ กำลังแก้ไข intake ${editingStamp}`;
  }

  // ล้างฟอร์มกลับค่าเริ่มต้น (ใช้ทั้งหลังสร้าง/อัปเดตสำเร็จ และตอนยกเลิกแก้ไข)
  function resetForm() {
    $('jin-text').value = ''; images = []; renderThumbs();
    const typeSel = $('jin-type'); if (typeSel) typeSel.value = 'Bug';
    const sysSel = $('jin-system'); if (sysSel) sysSel.value = defaultSystem;
    // กลับไป children ของ project หลัก (default epic/sprint ถูกเลือกให้ใน applyProjectMeta)
    if (defaultProjectMeta) applyProjectMeta(defaultProjectMeta);
  }

  async function save() {
    const text = $('jin-text').value.trim();
    if (!text && !images.length) { $('jin-note').textContent = '✗ ต้องมีข้อความหรือรูปอย่างน้อยหนึ่งอย่าง'; return; }
    const isEdit = !!editingStamp;
    const btn = $('jin-save'); btn.disabled = true; btn.textContent = isEdit ? 'กำลังอัปเดต…' : 'กำลังบันทึก…';
    const compSel = $('jin-component');
    const compOpt = compSel && compSel.selectedOptions[0];
    const epicSel = $('jin-epic');
    const sprintSel = $('jin-sprint');
    const sprintOpt = sprintSel && sprintSel.selectedOptions[0];
    const r = await api(isEdit ? `/api/jira/intake/${editingStamp}` : '/api/jira/intake', {
      method: isEdit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text, type: ($('jin-type') && $('jin-type').value) || '', system: $('jin-system').value,
        projectKey: selectedProjectKey(), images,
        componentId: (compSel && compSel.value) || '',
        component: (compOpt && compOpt.dataset.name) || '',
        epicKey: (epicSel && epicSel.value) || '',
        sprintId: (sprintSel && sprintSel.value) || '',
        sprintLabel: (sprintOpt && sprintOpt.dataset.name) || '',
      }),
    });
    btn.disabled = false;
    if (r.ok && r.json.ok) {
      editingStamp = null;
      setEditMode(false);
      resetForm();
      const w = (r.json.warnings || []).length ? ` (⚠️ ${r.json.warnings.join(', ')})` : '';
      $('jin-note').textContent = isEdit
        ? `✓ อัปเดตแล้ว: ${r.json.stamp}${w}`
        : `✓ บันทึกแล้ว: ${r.json.stamp}${w} — สั่ง Claude "ประมวลผล intake ที่ค้างทั้งหมด"`;
      loadPending();
    } else {
      btn.textContent = isEdit ? '💾 อัปเดต intake' : 'บันทึก intake';
      $('jin-note').textContent = `✗ ${isEdit ? 'อัปเดต' : 'บันทึก'}ไม่สำเร็จ: ${esc(r.json.error || r.status)}`;
    }
  }

  window.initJiraIntake = function initJiraIntake() {
    if (location.protocol === 'file:') { $('jin-pending').innerHTML = '<p class="jm-note">ต้องเปิดผ่าน server (node tools/qa-workspace/server.js)</p>'; return; }
    const refreshBtn = $('jin-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      const orig = refreshBtn.textContent; refreshBtn.textContent = '⏳ กำลังโหลด…';
      await loadPending();
      refreshBtn.textContent = orig; refreshBtn.disabled = false;
    });
    loadMeta();
    loadPending();
  };

  document.addEventListener('DOMContentLoaded', () => {
    const drop = $('jin-drop');
    if (!drop) return;
    $('jin-save').addEventListener('click', save);
    const cancelBtn = $('jin-cancel-edit');
    if (cancelBtn) cancelBtn.addEventListener('click', cancelEdit);

    // ปุ่มคัดลอกคำสั่ง "ประมวลผล intake ที่ค้างทั้งหมด" (แสดงตลอด ไม่ต้องรอบันทึก)
    const copyBtn = $('jin-copy-cmd');
    const COPY_LABEL = '📋 คัดลอก “ประมวลผล intake ที่ค้างทั้งหมด”';
    if (copyBtn) copyBtn.addEventListener('click', async () => {
      const cmd = 'ประมวลผล intake ที่ค้างทั้งหมด';
      try { await navigator.clipboard.writeText(cmd); }
      catch { const ta = document.createElement('textarea'); ta.value = cmd; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
      copyBtn.textContent = '✓ คัดลอกแล้ว';
      setTimeout(() => { copyBtn.textContent = COPY_LABEL; }, 1500);
    });
    document.addEventListener('paste', (e) => {
      const pane = $('jv-sub-intake');
      if (!pane || pane.offsetParent === null) return;
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) { e.preventDefault(); addFiles(files); }
    });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('drag'); addFiles(e.dataTransfer.files); });
  });
})();
