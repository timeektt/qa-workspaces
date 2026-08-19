/**
 * jira-stats-core.js — logic ล้วน (ไม่แตะเครือข่าย) สำหรับสถิติ Jira รายคน/ราย bucket
 *   - buildBuckets(window, now): สร้างถังเวลาตามโหมด + ฟังก์ชัน index(ms)
 *   - aggregate(issues, {window, now, doneSet}): แยก event จาก changelog ลง bucket ต่อคน
 *
 * อิง "วันที่ action เกิดจริง" จาก changelog เหมือน scripts/jira/weekly-report.js
 * แยกออกมาเป็น pure module เพื่อ unit test ได้ (jira-stats-core.test.js)
 */
'use strict';

const DAY = 24 * 3600 * 1000;
const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

// จำนวนถังต่อโหมด + ชนิดถัง
const WINDOWS = {
  week: { unit: 'day', count: 7 },
  month: { unit: 'week', count: 4 },
  quarter: { unit: 'week', count: 13 },
  year: { unit: 'month', count: 12 },
};

const midnight = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
// จันทร์ 00:00 ของสัปดาห์ที่ d อยู่ (getDay: 0=อา.)
function mondayOf(d) {
  const x = midnight(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
const dm = (d) => `${d.getDate()}/${d.getMonth() + 1}`;
// ติดปี พ.ศ. 2 หลัก เมื่อ withYear (ถังแรก) หรือขึ้นปีใหม่ (ม.ค.)
const monthLabel = (d, withYear) => (withYear || d.getMonth() === 0)
  ? `${TH_MONTH[d.getMonth()]} ${String((d.getFullYear() + 543) % 100).padStart(2, '0')}`
  : TH_MONTH[d.getMonth()];

/**
 * สร้างถังเวลา (เก่า→ใหม่) จบที่ปัจจุบัน + index(ms) คืน index ของถัง หรือ -1 ถ้านอกหน้าต่าง
 */
function buildBuckets(window, now) {
  const spec = WINDOWS[window] || WINDOWS.week;
  const nowD = new Date(now);
  const buckets = [];

  if (spec.unit === 'day') {
    const today = midnight(nowD);
    for (let i = spec.count - 1; i >= 0; i--) {
      const start = new Date(today); start.setDate(start.getDate() - i);
      const end = new Date(start); end.setDate(end.getDate() + 1);
      buckets.push({ start: start.getTime(), end: end.getTime(), label: dm(start) });
    }
  } else if (spec.unit === 'week') {
    const thisMon = mondayOf(nowD);
    for (let i = spec.count - 1; i >= 0; i--) {
      const start = new Date(thisMon); start.setDate(start.getDate() - i * 7);
      const end = new Date(start); end.setDate(end.getDate() + 7);
      buckets.push({ start: start.getTime(), end: end.getTime(), label: dm(start) });
    }
  } else { // month
    const thisMonth = new Date(nowD.getFullYear(), nowD.getMonth(), 1);
    for (let i = spec.count - 1; i >= 0; i--) {
      const start = new Date(thisMonth.getFullYear(), thisMonth.getMonth() - i, 1);
      const end = new Date(thisMonth.getFullYear(), thisMonth.getMonth() - i + 1, 1);
      buckets.push({ start: start.getTime(), end: end.getTime(), label: monthLabel(start, i === spec.count - 1) });
    }
  }

  const lo = buckets[0].start;
  const hi = buckets[buckets.length - 1].end;
  const index = (t) => {
    if (!(t >= lo) || t >= hi) return -1;
    // ถังเรียงต่อเนื่อง — หาแบบเชิงเส้น (count เล็ก)
    for (let i = 0; i < buckets.length; i++) if (t >= buckets[i].start && t < buckets[i].end) return i;
    return -1;
  };
  return { buckets, index };
}

const isReject = (name) => /reject/i.test(String(name || ''));

// เพิ่ม +1 ให้ person ใน metric ที่ bucket idx (สร้าง entry ถ้ายังไม่มี)
function bump(metric, personId, personName, idx, n) {
  if (!personId || idx < 0) return;
  let e = metric[personId];
  if (!e) { e = metric[personId] = { name: personName || personId, values: new Array(n).fill(0) }; }
  if (personName) e.name = personName;
  e.values[idx] += 1;
}

// assignee ณ เวลา T โดย reconstruct จาก assignee-change history (คืน {id,name} หรือ null)
function assigneeAt(changes, T, currentAssignee) {
  if (!changes.length) {
    return currentAssignee ? { id: currentAssignee.accountId, name: currentAssignee.displayName } : null;
  }
  let last = null;
  for (const c of changes) { // เรียง asc แล้ว
    if (c.at <= T) last = c.to;
    else { if (last === null) return c.from; break; }
  }
  return last || changes[changes.length - 1].to;
}

/**
 * aggregate(issues, {window, now, doneSet}) → { buckets:[{label}], groups:{qa:{created,rejected,closed}, dev:{assigned,resolved,rejected}} }
 * แต่ละ metric = { [accountId]: { name, values:number[N] } }
 */
function aggregate(issues, { window, now, doneSet }) {
  const { buckets, index } = buildBuckets(window, now);
  const n = buckets.length;
  const isDone = (name) => doneSet.has(String(name || '').toLowerCase());

  const groups = {
    qa: { created: {}, rejected: {}, closed: {} },
    dev: { assigned: {}, resolved: {}, rejected: {} },
  };

  for (const it of issues || []) {
    const f = it.fields || {};
    const histories = (it.changelog && it.changelog.histories) || [];

    // QA.created — reporter ณ วัน created
    if (f.reporter) {
      const idx = index(Date.parse(f.created));
      bump(groups.qa.created, f.reporter.accountId, f.reporter.displayName, idx, n);
    }

    // ไทม์ไลน์ assignee (asc) เพื่อ reconstruct assignee ณ เวลาที่โดน reject
    const assignChanges = [];
    for (const h of histories) {
      for (const item of (h.items || [])) {
        if (item.field !== 'assignee') continue;
        assignChanges.push({
          at: Date.parse(h.created),
          from: item.from ? { id: item.from, name: item.fromString } : null,
          to: item.to ? { id: item.to, name: item.toString } : null,
        });
      }
    }
    assignChanges.sort((a, b) => a.at - b.at);

    for (const h of histories) {
      const at = Date.parse(h.created);
      const idx = index(at);
      const author = h.author || {};
      for (const item of (h.items || [])) {
        if (item.field === 'status') {
          const to = item.toString;
          if (isReject(to)) {
            bump(groups.qa.rejected, author.accountId, author.displayName, idx, n);
            const a = assigneeAt(assignChanges, at, f.assignee);
            if (a && a.id) bump(groups.dev.rejected, a.id, a.name, idx, n);
          } else if (isDone(to)) {
            bump(groups.qa.closed, author.accountId, author.displayName, idx, n);
            bump(groups.dev.resolved, author.accountId, author.displayName, idx, n);
          }
        } else if (item.field === 'assignee' && item.to) {
          bump(groups.dev.assigned, item.to, item.toString, idx, n);
        }
      }
    }
  }

  return { buckets: buckets.map((b) => ({ label: b.label })), groups };
}

module.exports = { buildBuckets, aggregate, isReject, WINDOWS };
