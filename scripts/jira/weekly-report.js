#!/usr/bin/env node
/**
 * weekly-report.js — รวบข้อมูล Jira สำหรับ "สรุป weekly report" (แท็บ Jira List, qa-workspace)
 *
 * ขอบเขต: เฉพาะ action ที่ "ผมเป็นคนลงมือ" (บัญชี JIRA_EMAIL ใน .env = currentUser())
 * ในช่วงสัปดาห์ จันทร์–อาทิตย์ ที่ระบุ — อิง "วันที่ action เกิดจริง" ไม่ใช่สถานะปัจจุบัน:
 *   - created  : issue ที่ผมเป็น reporter และถูกสร้างในช่วง
 *   - done     : issue ที่ผม transition ไปสถานะหมวด Done ในช่วง (อ่าน changelog)
 *   - rejected : issue ที่ผม transition ไป "QA Rejected" ในช่วง (อ่าน changelog)
 *
 * ใช้: node scripts/jira/weekly-report.js <START YYYY-MM-DD> <END YYYY-MM-DD>
 * ออก: JSON ก้อนเดียวทาง stdout ให้ Claude (skill weekly-report) อ่านไปเรียบเรียงเป็นพารากราฟ
 *
 * creds อ่านผ่าน jira-client (dotenv) — ไม่พิมพ์ค่า .env ออก stdout
 */
process.env.DOTENV_CONFIG_QUIET = 'true'; // กัน banner dotenv รั่วออก stdout (skill parse JSON ก้อนเดียว)
const J = require('./jira-client');

const DAY = 24 * 3600 * 1000;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// ---- วน nextPageToken ของ /search/jql จนครบ (weekly volume เล็ก แต่กันตกหล่น) ----
async function searchAll(jql, fields) {
  const out = [];
  let token;
  for (let guard = 0; guard < 20; guard++) {
    const body = { jql, maxResults: 100, fields };
    if (token) body.nextPageToken = token;
    const r = await J.jira('POST', '/rest/api/3/search/jql', body);
    if (!r.ok) return { ok: false, status: r.status, error: r.json, issues: out };
    out.push(...(r.json.issues || []));
    if (r.json.isLast || !r.json.nextPageToken) break;
    token = r.json.nextPageToken;
  }
  return { ok: true, issues: out };
}

// ---- map ชื่อสถานะ → หมวด (to-do / indeterminate / done) จาก /rest/api/3/status ----
async function statusCategoryMap() {
  const r = await J.jira('GET', '/rest/api/3/status');
  const m = new Map();
  if (r.ok && Array.isArray(r.json)) {
    for (const s of r.json) {
      const cat = s.statusCategory && s.statusCategory.key; // 'new' | 'indeterminate' | 'done'
      if (s.name) m.set(String(s.name).toLowerCase(), cat);
    }
  }
  return m;
}

const compNames = (fields) => ((fields && fields.components) || []).map((c) => c.name).filter(Boolean);
const slim = (it, extra = {}) => ({
  key: it.key,
  summary: (it.fields && it.fields.summary) || '',
  issuetype: (it.fields && it.fields.issuetype && it.fields.issuetype.name) || '',
  components: compNames(it.fields),
  ...extra,
});

async function main() {
  const [start, end] = process.argv.slice(2);
  if (!isDate(start) || !isDate(end)) {
    console.error('usage: node scripts/jira/weekly-report.js <START YYYY-MM-DD> <END YYYY-MM-DD>');
    process.exit(2);
  }
  if (!J.envReady()) {
    console.log(JSON.stringify({ ok: false, error: '.env Jira ไม่ครบ (JIRA_BASE_URL/JIRA_EMAIL/JIRA_API_TOKEN/JIRA_PROJECT_KEY)' }));
    return;
  }

  const startMs = Date.parse(start + 'T00:00:00');
  const endMs = Date.parse(end + 'T23:59:59.999');
  const endNext = new Date(endMs + 1).toISOString().slice(0, 10); // วันถัดจากอาทิตย์ (ขอบบน exclusive ของ created)
  const jqlWindow = `"${start}" , "${end} 23:59"`;

  const meRes = await J.getMyself();
  if (!meRes.ok) {
    console.log(JSON.stringify({ ok: false, error: 'ดึงบัญชีผู้ใช้ Jira ไม่สำเร็จ (getMyself)', detail: meRes.json }));
    return;
  }
  const me = { accountId: meRes.json.accountId, displayName: meRes.json.displayName, email: meRes.json.emailAddress };

  // (1) created — reporter = ผม, created ในช่วง
  const createdRes = await searchAll(
    `reporter = currentUser() AND created >= "${start}" AND created < "${endNext}" ORDER BY created DESC`,
    ['summary', 'issuetype', 'components', 'status', 'created'],
  );
  if (!createdRes.ok) { console.log(JSON.stringify({ ok: false, error: 'JQL created ล้มเหลว', detail: createdRes.error })); return; }
  const created = createdRes.issues.map((it) => slim(it, { status: it.fields.status && it.fields.status.name }));

  // (2)+(3) done / rejected — issue ที่ผมเปลี่ยนสถานะในช่วง แล้วอ่าน changelog แยกหมวด
  const changedRes = await searchAll(
    `status CHANGED BY currentUser() DURING (${jqlWindow}) ORDER BY updated DESC`,
    ['summary', 'issuetype', 'components'],
  );
  if (!changedRes.ok) { console.log(JSON.stringify({ ok: false, error: 'JQL status-changed ล้มเหลว', detail: changedRes.error })); return; }

  const catMap = await statusCategoryMap();
  const isReject = (name) => /reject/i.test(String(name || ''));
  const isDone = (name) => catMap.get(String(name || '').toLowerCase()) === 'done';

  const CAP = 300; // เพดานอ่าน changelog กันดึงไม่จบ (สัปดาห์ปกติต่ำกว่านี้มาก)
  const truncated = changedRes.issues.length > CAP;
  const targets = changedRes.issues.slice(0, CAP);
  const done = [];
  const rejected = [];
  const classify = (r) => {
    const histories = (r.json.changelog && r.json.changelog.histories) || [];
    let toDone = null, toReject = null;
    for (const h of histories) {
      if (!h.author || h.author.accountId !== me.accountId) continue; // เฉพาะที่ผมเป็นคนกด
      const t = Date.parse(h.created);
      if (isNaN(t) || t < startMs || t > endMs) continue; // เฉพาะในช่วงสัปดาห์
      for (const item of (h.items || [])) {
        if (item.field !== 'status') continue;
        const to = item.toString;
        if (isReject(to)) toReject = to;
        else if (isDone(to)) toDone = to;
      }
    }
    const base = { key: r.json.key, fields: r.json.fields };
    if (toReject) rejected.push(slim(base, { toStatus: toReject }));
    if (toDone) done.push(slim(base, { toStatus: toDone }));
  };
  // ยิง changelog เป็น batch ขนาน 10 ใบ กันช้าเมื่อ changed set ใหญ่
  for (let i = 0; i < targets.length; i += 10) {
    const batch = targets.slice(i, i + 10);
    const results = await Promise.all(batch.map((stub) =>
      J.jira('GET', `/rest/api/3/issue/${stub.key}?expand=changelog&fields=summary,issuetype,components`)));
    for (const r of results) if (r.ok) classify(r);
  }

  console.log(JSON.stringify({
    ok: true,
    range: { start, end },
    me,
    counts: { created: created.length, done: done.length, rejected: rejected.length },
    created, done, rejected,
    truncated, // true = issue ที่ผมแตะสถานะเกิน 80 ใบในสัปดาห์ (อ่าน changelog แค่ 80 แรก)
  }, null, 2));
}

main().catch((e) => { console.log(JSON.stringify({ ok: false, error: String(e && e.message || e) })); process.exit(1); });
