/* qa-search-select.js — เปลี่ยน <select> ให้เป็น combobox ที่ "พิมพ์ค้นหา" ได้
 *
 * ใช้: QASearchSelect.enhance(document.getElementById('jin-component'));
 *
 * หลักการ: ไม่แทนที่ <select> เดิม — ซ่อนไว้แล้วใช้เป็น source of truth ต่อไป
 * โค้ดเดิมจึงยังอ่าน/เขียนได้เหมือนเดิมทุกอย่าง (sel.value, sel.innerHTML,
 * sel.selectedOptions[0].dataset, event 'change') โดยไม่ต้องแก้
 *   - เขียน sel.innerHTML ใหม่  → MutationObserver อัปเดตปุ่มให้เอง
 *   - เขียน sel.value ตรง ๆ     → instance setter อัปเดตปุ่มให้เอง
 *   - ผู้ใช้เลือกจากรายการ      → เซ็ตค่าใน <select> แล้ว dispatch 'change'
 */
(function () {
  'use strict';

  let seq = 0;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ไฮไลต์ช่วงที่ตรงคำค้น (เทียบแบบไม่สนตัวพิมพ์เล็ก/ใหญ่)
  function highlight(text, query) {
    if (!query) return esc(text);
    const i = text.toLowerCase().indexOf(query.toLowerCase());
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + query.length)) + '</mark>' +
      esc(text.slice(i + query.length));
  }

  function enhance(sel, opts) {
    if (!sel || sel.dataset.qssReady === '1') return null;
    const o = opts || {};
    const id = 'qss-' + (++seq);
    sel.dataset.qssReady = '1';

    // ชื่อของช่องนี้ (จาก <label> ที่ครอบอยู่) ใช้เป็น aria-label ของปุ่ม
    const labelEl = sel.closest('label');
    let fieldName = o.label || '';
    if (!fieldName && labelEl) {
      for (const n of labelEl.childNodes) {
        if (n.nodeType === Node.TEXT_NODE && n.textContent.trim()) { fieldName = n.textContent.trim(); break; }
      }
    }

    // ---- โครง DOM: ห่อ <select> เดิมไว้ในกล่อง แล้ววางปุ่ม + แผงค้นหาไว้ข้าง ๆ ----
    const wrap = document.createElement('div');
    wrap.className = 'qss';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    sel.classList.add('qss-native');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'qss-btn ' + (sel.className.replace('qss-native', '').trim() || 'jm-select');
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', id + '-list');
    if (fieldName) btn.setAttribute('aria-label', fieldName);
    btn.innerHTML = '<span class="qss-value"></span><span class="qss-caret" aria-hidden="true">▾</span>';
    wrap.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'qss-panel';
    panel.hidden = true;
    panel.innerHTML =
      '<div class="qss-search-row"><input type="text" class="qss-search" autocomplete="off" spellcheck="false"' +
      ' placeholder="' + esc(o.searchPlaceholder || 'พิมพ์เพื่อค้นหา…') + '"' +
      ' aria-label="ค้นหาตัวเลือก' + (fieldName ? ' — ' + esc(fieldName) : '') + '"' +
      ' aria-controls="' + id + '-list" aria-autocomplete="list"></div>' +
      '<ul class="qss-list" id="' + id + '-list" role="listbox" tabindex="-1"></ul>' +
      '<p class="qss-msg" hidden></p>';
    wrap.appendChild(panel);

    const search = panel.querySelector('.qss-search');
    const list = panel.querySelector('.qss-list');
    const msg = panel.querySelector('.qss-msg');
    const valueEl = btn.querySelector('.qss-value');

    let items = [];      // option ที่ผ่านการกรองแล้ว (ตามลำดับที่แสดง)
    let activeIdx = -1;  // แถวที่ไฮไลต์ด้วยคีย์บอร์ด

    // ---- ปุ่ม: แสดงค่าที่เลือกอยู่ของ <select> ----
    function syncButton() {
      const opt = sel.selectedOptions[0];
      valueEl.textContent = opt ? opt.textContent : (o.emptyLabel || '—');
      valueEl.classList.toggle('is-placeholder', !!opt && opt.value === '');
      btn.disabled = sel.disabled || sel.options.length === 0;
    }

    // ---- รายการตัวเลือก ----
    function renderList() {
      const q = search.value.trim();
      const all = Array.from(sel.options);
      items = q ? all.filter((op) => op.textContent.toLowerCase().includes(q.toLowerCase())) : all;

      if (!all.length) {                       // ยังไม่มีตัวเลือกเลย (ยังโหลดไม่เสร็จ/ไม่มีข้อมูล)
        list.innerHTML = ''; msg.hidden = false; msg.textContent = o.emptyMessage || '— ไม่มีตัวเลือก —';
      } else if (!items.length) {              // มีตัวเลือก แต่คำค้นไม่ตรงอะไรเลย
        list.innerHTML = ''; msg.hidden = false; msg.textContent = 'ไม่พบผลค้นหา “' + q + '”';
      } else {
        msg.hidden = true;
        list.innerHTML = items.map((op, i) => {
          const on = op.selected;
          return '<li role="option" id="' + id + '-op' + i + '" data-i="' + i + '"' +
            ' class="qss-op' + (on ? ' is-selected' : '') + '" aria-selected="' + (on ? 'true' : 'false') + '">' +
            '<span class="qss-tick" aria-hidden="true">' + (on ? '✓' : '') + '</span>' +
            '<span class="qss-op-text">' + highlight(op.textContent, q) + '</span></li>';
        }).join('');
      }
      const selIdx = items.findIndex((op) => op.selected);
      setActive(items.length ? (selIdx >= 0 ? selIdx : 0) : -1, false);
    }

    function setActive(i, scroll) {
      activeIdx = i;
      list.querySelectorAll('.qss-op').forEach((li) => li.classList.remove('is-active'));
      if (i < 0) { search.removeAttribute('aria-activedescendant'); return; }
      const li = list.querySelector('[data-i="' + i + '"]');
      if (!li) return;
      li.classList.add('is-active');
      search.setAttribute('aria-activedescendant', li.id);
      if (scroll !== false) li.scrollIntoView({ block: 'nearest' });
    }

    function choose(i) {
      const op = items[i];
      if (!op) return;
      sel.value = op.value;                    // ผ่าน setter ด้านล่าง → syncButton ให้เอง
      if (sel.value !== op.value) { op.selected = true; syncButton(); }  // เผื่อ value ซ้ำกันหลาย option
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      close(true);
    }

    // ---- เปิด/ปิดแผง ----
    function open() {
      if (!panel.hidden || btn.disabled) return;
      panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      search.value = '';
      renderList();
      search.focus();
      document.addEventListener('mousedown', onDocDown, true);
    }

    function close(focusBtn) {
      if (panel.hidden) return;
      panel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', onDocDown, true);
      if (focusBtn) btn.focus();
    }

    function onDocDown(e) { if (!wrap.contains(e.target)) close(false); }

    // ---- events ----
    btn.addEventListener('click', () => (panel.hidden ? open() : close(true)));
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); }
    });

    search.addEventListener('input', renderList);
    search.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) setActive((activeIdx + 1) % items.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) setActive((activeIdx - 1 + items.length) % items.length); }
      else if (e.key === 'Home') { e.preventDefault(); if (items.length) setActive(0); }
      else if (e.key === 'End') { e.preventDefault(); if (items.length) setActive(items.length - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(activeIdx); }
      else if (e.key === 'Escape') { e.preventDefault(); close(true); }
      else if (e.key === 'Tab') { close(false); }
    });

    list.addEventListener('mousemove', (e) => {
      const li = e.target.closest('.qss-op');
      if (li) setActive(+li.dataset.i, false);
    });
    list.addEventListener('click', (e) => {
      const li = e.target.closest('.qss-op');
      if (li) choose(+li.dataset.i);
    });

    // คลิกที่ข้อความ <label> → โฟกัสปุ่ม (ของเดิมพาไป <select> ที่ตอนนี้ซ่อนอยู่)
    if (labelEl) labelEl.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) { e.preventDefault(); btn.focus(); }
    });

    // ---- ให้ปุ่มตามค่าของ <select> เสมอ แม้โค้ดอื่นเขียนค่าเข้ามาตรง ๆ ----
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(sel, 'value', {
      configurable: true,
      get() { return desc.get.call(sel); },
      set(v) { desc.set.call(sel, v); syncButton(); },
    });
    new MutationObserver(() => {                 // เขียน innerHTML ใหม่ (โหลด meta / เปลี่ยน project)
      syncButton();
      if (!panel.hidden) renderList();
    }).observe(sel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });
    sel.addEventListener('change', syncButton);

    syncButton();
    return { sync: syncButton, open, close };
  }

  window.QASearchSelect = { enhance };
})();
