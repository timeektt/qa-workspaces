/* jira-common.js — helper ร่วมของ Jira drafts + intake (โหลดก่อน 2 ไฟล์นั้น) */
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const imgUrl = (rel) => '/drafts-images/' + rel.replace(/^images\//, '');

  async function api(path, opts = {}) {
    // timeout กัน fetch ค้างไม่รู้จบ (server ล่ม/ช้า) — คืน {ok:false} แทน throw ให้ caller reset UI ได้
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 20000);
    try {
      const res = await fetch(path, { ...opts, signal: ctrl.signal });
      const json = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, json };
    } catch (e) {
      const error = e.name === 'AbortError'
        ? 'หมดเวลารอ server (20 วินาที) — server ยังรันอยู่ไหม? (node tools/qa-workspace/server.js)'
        : 'ต่อ server ไม่ได้ — ตรวจว่า server รันอยู่ (node tools/qa-workspace/server.js)';
      return { ok: false, status: 0, json: { error } };
    } finally {
      clearTimeout(timer);
    }
  }

  function textRun(nodes) {
    return (nodes || []).map((n) => {
      let t = esc(n.text || '');
      const marks = n.marks || [];
      if (marks.some((m) => m.type === 'em')) t = `<em>${t}</em>`;
      if (marks.some((m) => m.type === 'strong')) t = `<strong>${t}</strong>`;
      return t;
    }).join('');
  }

  function adfToHtml(doc) {
    if (!doc || !doc.content) return '';
    return doc.content.map((node) => {
      switch (node.type) {
        case 'heading': {
          const color = (node.content?.[0]?.marks || []).find((m) => m.type === 'textColor')?.attrs?.color;
          const style = color ? ` style="color:${esc(color)}"` : '';
          return `<h4${style}>${textRun(node.content)}</h4>`;
        }
        case 'paragraph':
          return `<p>${textRun(node.content)}</p>`;
        case 'bulletList':
          return '<ul>' + (node.content || []).map((li) =>
            '<li>' + (li.content || []).map((p) => textRun(p.content)).join(' ') + '</li>').join('') + '</ul>';
        case 'table':
          return '<table>' + (node.content || []).map((row) =>
            '<tr>' + (row.content || []).map((cell) => {
              const tag = cell.type === 'tableHeader' ? 'th' : 'td';
              const inner = (cell.content || []).map((p) => textRun(p.content)).join(' ');
              return `<${tag}>${inner}</${tag}>`;
            }).join('') + '</tr>').join('') + '</table>';
        default:
          return '';
      }
    }).join('');
  }

  // Dice bigram similarity (mirror ของ jira-client.js — ฝั่ง browser)
  function dice(a, b) {
    const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
    const A = norm(a), B = norm(b);
    if (!A.length || !B.length) return 0;
    if (A.length === 1 || B.length === 1) return A === B ? 1 : 0;
    const bg = (t) => { const m = new Map(); for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
    const ba = bg(A), bb = bg(B);
    let inter = 0, total = 0;
    for (const [g, c] of ba) { total += c; if (bb.has(g)) inter += Math.min(c, bb.get(g)); }
    for (const [, c] of bb) total += c;
    return (2 * inter) / total;
  }

  // อัปเดต badge จำนวนรายการค้างบนปุ่มแท็บ (intake/list) — ซ่อนเมื่อ 0
  function setTabBadge(tab, n) {
    const el = document.getElementById('jv-badge-' + tab);
    if (!el) return;
    el.textContent = n > 99 ? '99+' : String(n);
    el.hidden = !n;
  }

  window.JCommon = { api, esc, imgUrl, textRun, adfToHtml, dice, setTabBadge };
})();
