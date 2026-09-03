#!/usr/bin/env node
/**
 * QA Workspace — Jira server (standalone)
 *
 * เสิร์ฟหน้า Jira (Create Issue + Jira List/Reject) + REST endpoints ที่คุยกับ Jira
 * ตัว UI เขียนแค่ "draft" (intake / reject intake) ลงโฟลเดอร์ agent-data/jira-drafts
 * ตัวที่ยิง Jira จริง (สร้าง issue / comment+ย้ายสถานะ) คือ Claude ผ่าน skill /jira-issue
 *
 *   node tools/qa-workspace/server/server.js          # เปิดที่ port 3060
 *   PORT=xxxx node tools/qa-workspace/server/server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const JC = require('../../../scripts/jira/jira-client');
const JStats = require('../../../scripts/jira/jira-stats');
const RStore = require('./rounds-store');   // ชั้นกลาง — เลือกเก็บ Google Sheet หรือไฟล์ ตาม .env

const MAP_DIR = path.join(__dirname, '..'); // เสิร์ฟไฟล์ static ของ tools/qa-workspace (โฟลเดอร์แม่ของ server/)
const INTAKE_DIR = path.join(JC.DRAFTS_DIR, 'intake');
const REJECT_DIR = JC.REJECT_DIR; // agent-data/jira-drafts/reject
const ROUNDS_FILE = path.join(JC.DRAFTS_DIR, 'rounds.json'); // แท็บ "ติดตาม issue" — รอบติดตาม + การ์ดในรอบ
const PORT = process.env.PORT || 3060;
// HOST=0.0.0.0 (หรือ SHARE=1) = เปิดให้เครื่องอื่นในวง LAN เข้าใช้ร่วมกันได้ — ค่าเริ่มต้นยังเป็น 127.0.0.1 (เครื่องตัวเองเท่านั้น)
// หมายเหตุความปลอดภัย: หน้านี้ไม่มี login — เปิดแล้วทุกคนที่เข้าถึงเครื่องนี้ในวงเดียวกันใช้ได้ทันที
const HOST = process.env.HOST || (process.env.SHARE ? '0.0.0.0' : '127.0.0.1');

const parseIssueKey = JC.parseIssueKey; // ย้ายไป engine แล้ว (เทสต์ได้โดยไม่ต้อง require server)

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
};

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function sendFile(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404); res.end('Not found'); return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
    'Cache-Control': 'no-cache, no-store, must-revalidate', // dev tool — กัน browser cache CSS/JS เก่า
  });
  fs.createReadStream(filePath).pipe(res);
}

// ถอด data URI ของไฟล์แนบจาก payload → buffer (รับทั้งรูปและเอกสาร; ตรรกะแกนอยู่ที่ JC.decodeDataUri)
function decodeImages(images) {
  const decoded = [];
  const warnings = [];
  (Array.isArray(images) ? images : []).forEach((img, i) => {
    const r = JC.decodeDataUri(img.dataUri || '', img.name);
    if (r.error) { warnings.push(`ไฟล์ที่ ${i + 1} ${r.error}`); return; }
    decoded.push({ name: r.name, buffer: r.buffer });
  });
  return { decoded, warnings };
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    // ---------- Intake API (Create Issue tab) ----------
    // meta: user + active sprint + component/epic/sprint สำหรับ dropdown หน้า Intake
    if (pathname === '/api/jira/meta' && req.method === 'GET') {
      if (!JC.envReady()) return sendJson(res, 500, { error: '.env Jira ไม่ครบ' });
      const [me, sprint, comps, epics, sprints, projects] = await Promise.all([
        JC.getMyself(), JC.getActiveSprint(), JC.getComponents(), JC.getEpics(), JC.getSprints(), JC.getProjects(),
      ]);
      return sendJson(res, 200, {
        user: me.ok ? me.json.displayName : null,
        defaultEpic: JC.DEFAULT_BUG_EPIC,
        activeSprint: sprint ? { id: sprint.id, name: sprint.name } : null,
        components: comps.components,
        epics: epics.epics,
        sprints: sprints.sprints,
        projects: projects.projects,
        defaultProjectKey: JC.JIRA_PROJECT_KEY,
        browseBase: `${JC.base}/browse/`,
      });
    }

    // project-meta: component/epic/sprint ของ project ที่เลือก (สำหรับ cascade เมื่อเปลี่ยน "ระบบ")
    if (pathname === '/api/jira/project-meta' && req.method === 'GET') {
      if (!JC.envReady()) return sendJson(res, 500, { error: '.env Jira ไม่ครบ' });
      const key = (url.searchParams.get('key') || '').trim().toUpperCase() || JC.JIRA_PROJECT_KEY;
      const [comps, epics, sprints, sprint] = await Promise.all([
        JC.getComponents(key), JC.getEpics(key), JC.getSprints(key), JC.getActiveSprint(key),
      ]);
      return sendJson(res, 200, {
        projectKey: key,
        components: comps.components,
        epics: epics.epics,
        sprints: sprints.sprints,
        activeSprint: sprint ? { id: sprint.id, name: sprint.name } : null,
        // default epic ใช้ได้เฉพาะ project หลัก
        defaultEpic: key === JC.JIRA_PROJECT_KEY ? JC.DEFAULT_BUG_EPIC : '',
      });
    }

    // intake: บันทึกข้อความ+รูปดิบ (pending) ให้ Claude ประมวลต่อผ่าน /jira-issue
    if (pathname === '/api/jira/intake' && req.method === 'POST') {
      const body = await readBody(req);
      const text = (body.text || '').trim();
      const images = Array.isArray(body.images) ? body.images : [];
      if (!text && !images.length) return sendJson(res, 400, { error: 'ต้องมีข้อความหรือรูปอย่างน้อยหนึ่งอย่าง' });
      const { decoded, warnings } = decodeImages(images);
      if (!text && !decoded.length) return sendJson(res, 400, { error: 'ต้องมีข้อความหรือรูปที่ถอดได้อย่างน้อยหนึ่งอย่าง' });
      const { stamp } = JC.writeIntake(INTAKE_DIR, {
        text, type: body.type || '', system: body.system || '', projectKey: body.projectKey || '',
        component: body.component || '', componentId: body.componentId || '',
        epicKey: body.epicKey || '', sprintId: body.sprintId || '', sprintLabel: body.sprintLabel || '',
        images: decoded,
      });
      return sendJson(res, 200, { ok: true, stamp, warnings });
    }

    // intake: list เฉพาะ pending
    if (pathname === '/api/jira/intakes' && req.method === 'GET') {
      return sendJson(res, 200, { intakes: JC.listIntakes(INTAKE_DIR, 'pending') });
    }

    // intake: อ่านตัวเดียว (meta + รูปเป็น data URI) สำหรับโหลดเข้าฟอร์มแก้ไข
    const mIntakeOne = pathname.match(/^\/api\/jira\/intake\/([\w.-]+)$/);
    if (mIntakeOne && req.method === 'GET') {
      const meta = JC.readIntake(INTAKE_DIR, mIntakeOne[1]);
      if (!meta) return sendJson(res, 404, { error: 'ไม่พบ intake' });
      return sendJson(res, 200, { intake: meta, images: JC.readIntakeImages(INTAKE_DIR, mIntakeOne[1]) });
    }

    // intake: แก้ไข — เขียนทับ stamp เดิม (ลบของเก่าก่อน ไม่ให้รูปเก่าค้าง)
    if (mIntakeOne && req.method === 'PUT') {
      if (!JC.readIntake(INTAKE_DIR, mIntakeOne[1])) return sendJson(res, 404, { error: 'ไม่พบ intake' });
      const body = await readBody(req);
      const text = (body.text || '').trim();
      const { decoded, warnings } = decodeImages(body.images);
      if (!text && !decoded.length) return sendJson(res, 400, { error: 'ต้องมีข้อความหรือรูปที่ถอดได้อย่างน้อยหนึ่งอย่าง' });
      JC.deleteIntake(INTAKE_DIR, mIntakeOne[1]);
      const { stamp } = JC.writeIntake(INTAKE_DIR, {
        text, type: body.type || '', system: body.system || '', projectKey: body.projectKey || '',
        component: body.component || '', componentId: body.componentId || '',
        epicKey: body.epicKey || '', sprintId: body.sprintId || '', sprintLabel: body.sprintLabel || '',
        images: decoded,
      }, mIntakeOne[1]);
      return sendJson(res, 200, { ok: true, stamp, warnings });
    }

    // intake: ลบทิ้งถาวร
    if (mIntakeOne && req.method === 'DELETE') {
      const ok = JC.deleteIntake(INTAKE_DIR, mIntakeOne[1]);
      return ok ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'ไม่พบ intake' });
    }

    // ---------- Jira List / QA Reject API ----------
    // list ทุกใบที่บัญชี .env เห็นได้ (ทุก project) เรียงตามวันที่สร้าง — ฝั่งเว็บจัดกลุ่มวันนี้/สัปดาห์นี้/ทั้งหมดเอง
    // pagination แบบ cursor: ?pageToken=<token จากรอบก่อน> โหลดหน้าถัดไปของกลุ่ม "ทั้งหมด"
    if (pathname === '/api/jira/my-issues' && req.method === 'GET') {
      if (!JC.envReady()) return sendJson(res, 500, { error: '.env Jira ไม่ครบ' });
      const pageToken = url.searchParams.get('pageToken') || undefined;
      const r = await JC.listAllVisibleIssues({ pageToken, max: 100 });
      if (!r.ok) return sendJson(res, 502, { error: 'ดึงรายการจาก Jira ไม่สำเร็จ', detail: r.error });
      return sendJson(res, 200, { issues: r.issues, nextPageToken: r.nextPageToken, browseBase: `${JC.base}/browse/` });
    }

    // stats: สถิติรายคน/ราย bucket (QA: created/rejected/closed · Dev: assigned/resolved/rejected)
    if (pathname === '/api/jira/stats' && req.method === 'GET') {
      if (!JC.envReady()) return sendJson(res, 500, { error: '.env Jira ไม่ครบ' });
      const window = String(url.searchParams.get('window') || 'month');
      const r = await JStats.collect(window);
      if (!r.ok) return sendJson(res, 502, r);
      return sendJson(res, 200, r);
    }

    // search: วาง key/url (ทุก project) → ใบเดียว · เลขล้วน → ทุกใบที่เลขตรงกันในทุก project · คืน { issues: [...] } เสมอ
    if (pathname === '/api/jira/issue' && req.method === 'GET') {
      if (!JC.envReady()) return sendJson(res, 500, { error: '.env Jira ไม่ครบ' });
      const q = String(url.searchParams.get('q') || '').trim();
      const browseBase = `${JC.base}/browse/`;
      const key = parseIssueKey(q);
      if (key) { // key เต็ม/url → ใบเดียว
        const iss = await JC.getIssue(key, ['summary', 'status']);
        return sendJson(res, 200, { issues: iss.ok ? [{ key: iss.key, summary: iss.summary, status: iss.status, statusCategory: iss.statusCategory }] : [], browseBase });
      }
      if (/^\d+$/.test(q)) { // เลขล้วน → หาทุก project
        const r = await JC.findIssuesByNumber(q);
        if (!r.ok) return sendJson(res, 502, { error: 'ค้นหาไม่สำเร็จ', detail: r.error });
        return sendJson(res, 200, { issues: r.issues, browseBase });
      }
      return sendJson(res, 200, { issues: [], browseBase }); // ไม่ใช่ key/url/เลข → ไม่ค้น
    }

    // reject intake: บันทึก (issueKey + เหตุผล + รูป) ให้ Claude ประมวลต่อ
    if (pathname === '/api/jira/reject' && req.method === 'POST') {
      const body = await readBody(req);
      const issueKey = parseIssueKey(body.issueKey);
      const reason = (body.reason || '').trim();
      if (!issueKey) return sendJson(res, 400, { error: 'ต้องระบุ issue key' });
      if (!reason) return sendJson(res, 400, { error: 'ต้องกรอกเหตุผล reject' });
      const { decoded, warnings } = decodeImages(body.images);
      const { stamp } = JC.writeReject(REJECT_DIR, { issueKey, issueSummary: body.issueSummary || '', reason, images: decoded });
      return sendJson(res, 200, { ok: true, stamp, warnings });
    }

    // reject intake: list เฉพาะ pending
    if (pathname === '/api/jira/rejects' && req.method === 'GET') {
      return sendJson(res, 200, { rejects: JC.listIntakes(REJECT_DIR, 'pending') });
    }

    // reject intake: อ่านตัวเดียว (meta + รูป data URI) สำหรับโหลดเข้าฟอร์มแก้ไข
    const mRejectOne = pathname.match(/^\/api\/jira\/reject\/([\w.-]+)$/);
    if (mRejectOne && req.method === 'GET') {
      const meta = JC.readIntake(REJECT_DIR, mRejectOne[1]);
      if (!meta) return sendJson(res, 404, { error: 'ไม่พบ reject intake' });
      return sendJson(res, 200, { reject: meta, images: JC.readIntakeImages(REJECT_DIR, mRejectOne[1]) });
    }

    // reject intake: แก้ไข — เขียนทับ stamp เดิม
    if (mRejectOne && req.method === 'PUT') {
      const old = JC.readIntake(REJECT_DIR, mRejectOne[1]);
      if (!old) return sendJson(res, 404, { error: 'ไม่พบ reject intake' });
      const body = await readBody(req);
      const reason = (body.reason || '').trim();
      if (!reason) return sendJson(res, 400, { error: 'ต้องกรอกเหตุผล reject' });
      const { decoded, warnings } = decodeImages(body.images);
      JC.deleteIntake(REJECT_DIR, mRejectOne[1]);
      const { stamp } = JC.writeReject(REJECT_DIR, {
        issueKey: parseIssueKey(body.issueKey) || old.issueKey,
        issueSummary: body.issueSummary || old.issueSummary || '',
        reason, images: decoded,
      }, mRejectOne[1]);
      return sendJson(res, 200, { ok: true, stamp, warnings });
    }

    // reject intake: ลบทิ้งถาวร
    if (mRejectOne && req.method === 'DELETE') {
      const ok = JC.deleteIntake(REJECT_DIR, mRejectOne[1]);
      return ok ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'ไม่พบ reject intake' });
    }

    // ---------- Jira Rounds API (แท็บ "ติดตาม issue") ----------
    // รอบ = ชุดการ์ดที่ต้องแก้ให้เสร็จภายในวันครบกำหนดหนึ่งวัน · เก็บแค่ key+summary — สถานะดึงสดจาก Jira
    if (pathname === '/api/jira/rounds' && req.method === 'GET') {
      try {
        return sendJson(res, 200, { rounds: await RStore.readRounds(ROUNDS_FILE), backend: RStore.backend() });
      } catch (e) {
        return sendJson(res, 502, { error: e.message });
      }
    }

    if (pathname === '/api/jira/rounds' && req.method === 'POST') {
      const body = await readBody(req);
      const r = await RStore.createRound(ROUNDS_FILE, { name: body.name || '', dueDate: body.dueDate || '' });
      return r.ok ? sendJson(res, 200, r) : sendJson(res, 400, { error: r.error });
    }

    // สถานะสดของทุกการ์ดในรอบ — ยิง Jira ทีละใบแบบขนาน (ทีละ 8 ใบ กัน rate limit)
    const mRoundStatus = pathname.match(/^\/api\/jira\/round\/([\w.-]+)\/status$/);
    if (mRoundStatus && req.method === 'GET') {
      if (!JC.envReady()) return sendJson(res, 500, { error: '.env Jira ไม่ครบ' });
      let round;
      try {
        round = (await RStore.readRounds(ROUNDS_FILE)).find((x) => String(x.id) === mRoundStatus[1]);
      } catch (e) {
        return sendJson(res, 502, { error: e.message });
      }
      if (!round) return sendJson(res, 404, { error: 'ไม่พบรอบนี้' });
      const keys = (round.issues || []).map((it) => it.key);
      const out = [];
      for (let i = 0; i < keys.length; i += 8) {
        const chunk = await Promise.all(keys.slice(i, i + 8).map(async (key) => {
          const iss = await JC.getIssue(key, ['summary', 'status', 'reporter']);
          return iss.ok
            ? { key, summary: iss.summary, status: iss.status, statusCategory: iss.statusCategory, reporter: iss.reporter }
            : { key, summary: '', status: null, statusCategory: null, reporter: null, error: 'ดึงสถานะไม่สำเร็จ' };
        }));
        out.push(...chunk);
      }
      return sendJson(res, 200, { issues: out, browseBase: `${JC.base}/browse/` });
    }

    // เพิ่มการ์ดเข้ารอบ
    const mRoundIssues = pathname.match(/^\/api\/jira\/round\/([\w.-]+)\/issues$/);
    if (mRoundIssues && req.method === 'POST') {
      const body = await readBody(req);
      const key = parseIssueKey(body.key);
      if (!key) return sendJson(res, 400, { error: 'ต้องระบุ issue key' });
      const r = await RStore.addIssue(ROUNDS_FILE, mRoundIssues[1], { key, summary: body.summary || '' });
      return r.ok ? sendJson(res, 200, r) : sendJson(res, 400, { error: r.error });
    }

    // เอาการ์ดออกจากรอบ
    const mRoundIssueOne = pathname.match(/^\/api\/jira\/round\/([\w.-]+)\/issue\/([\w.-]+)$/);
    if (mRoundIssueOne && req.method === 'DELETE') {
      const r = await RStore.removeIssue(ROUNDS_FILE, mRoundIssueOne[1], mRoundIssueOne[2]);
      return r.ok ? sendJson(res, 200, r) : sendJson(res, 404, { error: r.error });
    }

    // แก้ชื่อ/วันครบกำหนดของรอบ · ลบรอบทิ้ง
    const mRoundOne = pathname.match(/^\/api\/jira\/round\/([\w.-]+)$/);
    if (mRoundOne && req.method === 'PUT') {
      const body = await readBody(req);
      const r = await RStore.updateRound(ROUNDS_FILE, mRoundOne[1], { name: body.name || '', dueDate: body.dueDate || '' });
      return r.ok ? sendJson(res, 200, r) : sendJson(res, 400, { error: r.error });
    }
    if (mRoundOne && req.method === 'DELETE') {
      const r = await RStore.deleteRound(ROUNDS_FILE, mRoundOne[1]);
      return r.ok ? sendJson(res, 200, r) : sendJson(res, 404, { error: r.error });
    }

    // ---------- static: หน้า Jira ----------
    const rel = pathname === '/' ? 'menu.html' : pathname.replace(/^\//, '');
    const filePath = path.normalize(path.join(MAP_DIR, rel));
    if (!filePath.startsWith(MAP_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
    return sendFile(res, filePath);
  } catch (e) {
    return sendJson(res, 500, { error: e.message });
  }
});

// ที่อยู่ IPv4 ของเครื่องในวง LAN (ไม่เอา loopback/virtual) — ไว้พิมพ์ลิงก์ให้ทีมกดต่อ
function lanAddresses() {
  const nets = require('os').networkInterfaces();
  const out = [];
  for (const list of Object.values(nets)) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

server.listen(PORT, HOST, () => {
  console.log(`QA Workspace — Jira: http://localhost:${PORT}/`);
  if (HOST === '127.0.0.1') {
    console.log(`(อยากให้ทีมเข้าใช้ร่วมกันในวง LAN: SHARE=1 node tools/qa-workspace/server/server.js)`);
  } else {
    console.log(`(bind ${HOST} — เปิดให้เครื่องอื่นในวง LAN เข้าได้)`);
    for (const ip of lanAddresses()) console.log(`   ส่งลิงก์นี้ให้ทีม: http://${ip}:${PORT}/`);
    console.log('   ⚠️  หน้านี้ไม่มี login — ทุกคนที่เข้าถึงวงเน็ตเดียวกันเปิดได้ และอ่าน Jira ผ่านบัญชีใน .env ของเครื่องนี้');
  }
  if (!JC.envReady()) console.log('⚠️  .env Jira ยังไม่ครบ — คัดลอก .env.example เป็น .env แล้วกรอกค่า');
});
