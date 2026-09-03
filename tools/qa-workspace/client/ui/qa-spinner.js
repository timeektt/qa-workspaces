/* qa-spinner.js — spinner กลางใช้ร่วมทั้ง QA Workspace
 * โหลดก่อน view อื่นใน index.html → window.QASpinner พร้อมใช้ทุก view
 * 3 โหมด:
 *   QASpinner.button(btn, label?)   → ใส่ spinner ในปุ่ม + disable · คืน restore() เรียกตอนเสร็จ
 *   QASpinner.overlay(el)           → คลุม spinner ทับ container (el ต้องมีขนาด) · คืน hide()
 *   QASpinner.full(label?)          → overlay ทับทั้งหน้า · คืน hide()
 * ทุกโหมด idempotent — เรียกซ้ำบน target เดิมไม่ซ้อน */
(function () {
  if (window.QASpinner) return;

  const CSS = `
  .qa-spin{display:inline-block;width:1em;height:1em;border:2px solid currentColor;border-right-color:transparent;
    border-radius:50%;animation:qa-spin .6s linear infinite;vertical-align:-2px;box-sizing:border-box}
  @keyframes qa-spin{to{transform:rotate(360deg)}}
  .qa-btn-spin{margin-right:7px}
  .qa-ovl{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:10px;
    background:rgba(255,255,255,.72);color:#101f52;font-size:13.5px;font-family:inherit;z-index:50;border-radius:inherit;
    backdrop-filter:saturate(1.1) blur(1px)}
  .qa-ovl .qa-spin{width:26px;height:26px;border-width:3px;color:#2f6bd8}
  .qa-ovl-full{position:fixed;inset:0;flex-direction:column;background:rgba(238,241,246,.82);z-index:99990;font-size:15px}
  .qa-ovl-full .qa-spin{width:40px;height:40px;border-width:4px}
  .qa-inline{display:flex;align-items:center;justify-content:center;gap:9px;color:#6b7280;font-size:13.5px;padding:16px 0;margin:0}
  .qa-inline .qa-spin{color:#2f6bd8;width:18px;height:18px;border-width:2px}
  `;

  const st = document.createElement('style');
  st.id = 'qa-spinner-css'; st.textContent = CSS;
  (document.head || document.documentElement).appendChild(st);

  function spinEl(cls) {
    const s = document.createElement('span');
    s.className = 'qa-spin' + (cls ? ' ' + cls : '');
    s.setAttribute('aria-hidden', 'true');
    return s;
  }

  // ---- โหมดปุ่ม: spinner ในปุ่ม + disable · คืน restore() ----
  function button(btn, label) {
    if (!btn || btn._qaBusy) return () => {};
    btn._qaBusy = true;
    const prevHtml = btn.innerHTML;
    const prevDisabled = btn.disabled;
    const txt = label != null ? label : (btn.dataset.busy || btn.textContent.trim());
    btn.innerHTML = '';
    btn.appendChild(spinEl('qa-btn-spin'));
    btn.appendChild(document.createTextNode(txt));
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    return function restore() {
      btn.innerHTML = prevHtml;
      btn.disabled = prevDisabled;
      btn.removeAttribute('aria-busy');
      btn._qaBusy = false;
    };
  }

  // ---- โหมด overlay: คลุม spinner ทับ container · คืน hide() ----
  function overlay(el, label) {
    if (!el) return () => {};
    if (el._qaOvl) return el._qaOvlHide;
    const cs = getComputedStyle(el);
    const restorePos = cs.position === 'static';
    if (restorePos) el.style.position = 'relative';
    const ov = document.createElement('div');
    ov.className = 'qa-ovl';
    ov.appendChild(spinEl());
    if (label) ov.appendChild(document.createTextNode(label));
    el.appendChild(ov);
    el._qaOvl = ov;
    const hide = function () {
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      if (restorePos) el.style.position = '';
      el._qaOvl = null; el._qaOvlHide = null;
    };
    el._qaOvlHide = hide;
    return hide;
  }

  // ---- โหมดเต็มหน้า ----
  let fullCount = 0, fullEl = null;
  function full(label) {
    fullCount++;
    if (!fullEl) {
      fullEl = document.createElement('div');
      fullEl.className = 'qa-ovl qa-ovl-full';
      fullEl.appendChild(spinEl());
      const t = document.createElement('div');
      t.textContent = label || 'กำลังโหลด…';
      fullEl.appendChild(t);
      document.body.appendChild(fullEl);
    }
    return function hide() {
      if (--fullCount <= 0 && fullEl) { fullEl.remove(); fullEl = null; fullCount = 0; }
    };
  }

  // ---- helper: ครอบ async fn ให้ปุ่มขึ้น spinner อัตโนมัติ ----
  async function wrap(btn, fn, label) {
    const restore = button(btn, label);
    try { return await fn(); }
    finally { restore(); }
  }

  // ---- inline: string HTML สำหรับใส่ในกล่องที่กำลังโหลด (เช่น list ว่างรอผล) ----
  function inline(label) {
    return '<p class="qa-inline"><span class="qa-spin" aria-hidden="true"></span>' + (label || 'กำลังโหลด…') + '</p>';
  }

  window.QASpinner = { button, overlay, full, wrap, inline };
})();
