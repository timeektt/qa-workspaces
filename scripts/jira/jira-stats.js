#!/usr/bin/env node
/**
 * jira-stats.js — รวบข้อมูล Jira สำหรับ modal "สถิติ" (แท็บ Jira List, qa-workspace)
 *
 * ดึงการ์ด project TWA2 ที่ "ถูกแตะในหน้าต่างเวลา" (created / status เปลี่ยน / assignee เปลี่ยน — ทุกคน)
 * แล้วอ่าน changelog แยก event ตามคน+bucket ด้วย jira-stats-core.aggregate
 * อิง "วันที่ action เกิดจริง" เหมือน weekly-report.js
 *
 * ใช้ (CLI): node scripts/jira/jira-stats.js <window: week|month|quarter|year>
 * ใช้ (server): const { collect } = require('.../jira-stats'); await collect('month')
 * creds อ่านผ่าน jira-client (dotenv) — ไม่พิมพ์ค่า .env ออก stdout
 */
process.env.DOTENV_CONFIG_QUIET = 'true';
const J = require('./jira-client');
const core = require('./jira-stats-core');

const CAP = 3000;  // เพดานอ่าน changelog กันดึงไม่จบ (year จริง ~2500 ใบ — เผื่อโต)
const BATCH = 30;  // จำนวน changelog ที่ยิงขนานต่อรอบ (ยิ่งสูงยิ่งเร็ว แลกกับ burst Jira)
const CACHE_TTL = 5 * 60 * 1000; // cache ผลต่อ window 5 นาที (year ดึงนาน — เปิดซ้ำ/สลับกลุ่มให้ไว)
const cache = {}; // window → { at, data }
const pad = (n) => String(n).padStart(2, '0');
const jqlDate = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// วน nextPageToken ของ /search/jql จนครบ (ดึงแค่ key พอ)
async function searchAllKeys(jql) {
  const out = [];
  let token;
  for (let guard = 0; guard < 40; guard++) {
    const body = { jql, maxResults: 100, fields: ['key'] };
    if (token) body.nextPageToken = token;
    const r = await J.jira('POST', '/rest/api/3/search/jql', body);
    if (!r.ok) return { ok: false, status: r.status, error: r.json, keys: out };
    for (const it of (r.json.issues || [])) out.push(it.key);
    if (r.json.isLast || !r.json.nextPageToken) break;
    token = r.json.nextPageToken;
  }
  return { ok: true, keys: out };
}

// map ชื่อสถานะ → หมวด done (Set ของชื่อ lowercase)
async function doneStatusSet() {
  const r = await J.jira('GET', '/rest/api/3/status');
  const s = new Set();
  if (r.ok && Array.isArray(r.json)) {
    for (const st of r.json) {
      if (st.name && st.statusCategory && st.statusCategory.key === 'done') s.add(String(st.name).toLowerCase());
    }
  }
  return s;
}

async function collect(window, { noCache = false } = {}) {
  if (!['week', 'month', 'quarter', 'year'].includes(window)) return { ok: false, error: 'window ไม่ถูกต้อง (week|month|quarter|year)' };
  if (!J.envReady()) return { ok: false, error: '.env Jira ไม่ครบ (JIRA_BASE_URL/JIRA_EMAIL/JIRA_API_TOKEN/JIRA_PROJECT_KEY)' };

  const hit = cache[window];
  if (!noCache && hit && (Date.now() - hit.at) < CACHE_TTL) return { ...hit.data, cached: true };

  const now = Date.now();
  const { buckets } = core.buildBuckets(window, now);
  const startStr = jqlDate(buckets[0].start);
  const endStr = `${jqlDate(now)} 23:59`;
  const proj = J.JIRA_PROJECT_KEY;

  // การ์ดที่ถูกแตะในหน้าต่าง: สร้างใหม่ / เปลี่ยนสถานะ / เปลี่ยน assignee (ทุกคน)
  const jql = `project = ${proj} AND (created >= "${startStr}" OR status CHANGED DURING ("${startStr}", "${endStr}") OR assignee CHANGED DURING ("${startStr}", "${endStr}")) ORDER BY updated DESC`;
  const keysRes = await searchAllKeys(jql);
  if (!keysRes.ok) return { ok: false, error: 'JQL ค้นหาการ์ดล้มเหลว', detail: keysRes.error };

  const truncated = keysRes.keys.length > CAP;
  const keys = keysRes.keys.slice(0, CAP);
  const doneSet = await doneStatusSet();

  // อ่าน changelog แบบ batch ขนาน
  const issues = [];
  for (let i = 0; i < keys.length; i += BATCH) {
    const batch = keys.slice(i, i + BATCH);
    const rs = await Promise.all(batch.map((k) =>
      J.jira('GET', `/rest/api/3/issue/${k}?expand=changelog&fields=summary,created,reporter,assignee,components,status`)));
    for (const r of rs) if (r.ok && r.json && r.json.key) issues.push(r.json);
  }

  const agg = core.aggregate(issues, { window, now, doneSet });
  const data = { ok: true, window, generatedAt: now, issueCount: issues.length, truncated, ...agg };
  cache[window] = { at: Date.now(), data };
  return data;
}

module.exports = { collect };

if (require.main === module) {
  const window = process.argv[2] || 'month';
  collect(window)
    .then((r) => { console.log(JSON.stringify(r, null, 2)); })
    .catch((e) => { console.log(JSON.stringify({ ok: false, error: String(e && e.message || e) })); process.exit(1); });
}
