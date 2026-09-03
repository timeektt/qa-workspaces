/* jira-weekly.js — แท็บ "Jira List": ปุ่ม "สรุป weekly report"
   เปิด modal เลือกช่วงสัปดาห์ (จ.–อา.) แล้วคัดลอกคำสั่ง `/weekly-report START..END`
   ไปวางในแชท Claude Code (skill weekly-report ประมวลผลต่อ) — ตัวหน้านี้ไม่ดึง Jira เอง */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const TH_MONTH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // local date (ไม่ใช้ toISOString กัน UTC shift)

  // จันทร์ 00:00 ของสัปดาห์ที่ d อยู่ (getDay: 0=อา.)
  function mondayOf(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  // "10 – 16 ส.ค. 2569" (ปี พ.ศ.) · ข้ามเดือน = "30 ส.ค. – 5 ก.ย. 2569"
  function fmtRange(mon, sun) {
    const be = (y) => y + 543;
    const left = mon.getMonth() === sun.getMonth()
      ? `${mon.getDate()}`
      : `${mon.getDate()} ${TH_MONTH[mon.getMonth()]}`;
    return `${left} – ${sun.getDate()} ${TH_MONTH[sun.getMonth()]} ${be(sun.getFullYear())}`;
  }

  function ranges() {
    const monThis = mondayOf(new Date());
    const monLast = addDays(monThis, -7);
    return {
      this: { mon: monThis, sun: addDays(monThis, 6) },
      last: { mon: monLast, sun: addDays(monLast, 6) },
    };
  }

  let R = null;
  function openModal() {
    R = ranges();
    $('jrw-this-dates').textContent = fmtRange(R.this.mon, R.this.sun);
    $('jrw-last-dates').textContent = fmtRange(R.last.mon, R.last.sun);
    const first = document.querySelector('input[name="jrw-range"][value="this"]');
    if (first) first.checked = true;
    $('jrw-hint').hidden = true;
    $('jrw-hint').textContent = '';
    $('jrw-modal').hidden = false;
  }
  function closeModal() { $('jrw-modal').hidden = true; }

  async function run() {
    if (!R) return;
    const sel = document.querySelector('input[name="jrw-range"]:checked');
    const pick = R[(sel && sel.value) || 'this'];
    const cmd = `/weekly-report ${iso(pick.mon)}..${iso(pick.sun)}`;
    try { await navigator.clipboard.writeText(cmd); }
    catch { const ta = document.createElement('textarea'); ta.value = cmd; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    const hint = $('jrw-hint');
    hint.hidden = false;
    hint.innerHTML = `✓ คัดลอกแล้ว: <code>${cmd}</code><br>วางในแชท Claude Code แล้วส่ง — Claude จะสรุปรายงานให้ในแชท`;
    const btn = $('jrw-run');
    const label = btn.textContent;
    btn.textContent = '✓ คัดลอกแล้ว';
    setTimeout(() => { btn.textContent = label; }, 1500);
  }

  let wired = false;
  window.initJiraWeekly = function initJiraWeekly() {
    if (location.protocol === 'file:') return;
    if (wired) return;
    wired = true;
    $('jrw-open').addEventListener('click', openModal);
    $('jrw-close').addEventListener('click', closeModal);
    $('jrw-cancel').addEventListener('click', closeModal);
    $('jrw-run').addEventListener('click', run);
    $('jrw-modal').addEventListener('click', (e) => { if (e.target === $('jrw-modal')) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('jrw-modal').hidden) closeModal(); });
  };
})();
