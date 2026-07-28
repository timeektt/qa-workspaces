#!/usr/bin/env node
/**
 * QA Workspace — Jira server (standalone)
 *
 * เสิร์ฟหน้า Jira (Create Issue + Jira List/Reject) + REST endpoints ที่คุยกับ Jira
 * ตัว UI เขียนแค่ "draft" (intake / reject intake) ลงโฟลเดอร์ agent-data/jira-drafts
 * ตัวที่ยิง Jira จริง (สร้าง issue / comment+ย้ายสถานะ) คือ Claude ผ่าน skill /jira-issue
 *
 *   node tools/qa-workspace/server.js          # เปิดที่ port 3060
 *   PORT=xxxx node tools/qa-workspace/server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const JC = require('../../scripts/jira/jira-client');

const MAP_DIR = __dirname; // เสิร์ฟไฟล์ static ในโฟลเดอร์นี้
const INTAKE_DIR = path.join(JC.DRAFTS_DIR, 'intake');
const REJECT_DIR = JC.REJECT_DIR; // agent-data/jira-drafts/reject
const PORT = process.env.PORT || 3060;

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

// ถอด data URI ของรูปจาก payload → buffer (ใช้ทั้งตอนสร้างและแก้ไข intake/reject)
function decodeImages(images) {
  const decoded = [];
  const warnings = [];
  (Array.isArray(images) ? images : []).forEach((img, i) => {
    const m = /^data:(image\/\w+);base64,(.+)$/.exec(img.dataUri || '');
    if (!m) { warnings.push(`รูปที่ ${i + 1} รูปแบบไม่ถูกต้อง`); return; }
    try {
      const ext = m[1].split('/')[1].replace('jpeg', 'jpg');
      decoded.push({ name: img.name || `${i + 1}.${ext}`, buffer: Buffer.from(m[2], 'base64') });
    } catch { warnings.push(`รูปที่ ${i + 1} ถอดไม่ได้`); }
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
    // list การ์ดที่บัญชีปัจจุบันเป็น reporter — ฝั่งเว็บจัดกลุ่มวันนี้/สัปดาห์นี้/ทั้งหมดเอง
    if (pathname === '/api/jira/my-issues' && req.method === 'GET') {
      if (!JC.envReady()) return sendJson(res, 500, { error: '.env Jira ไม่ครบ' });
      const all = url.searchParams.get('all') === '1'; // ?all=1 = ดึงครบทุกใบ (ปุ่ม "ดูทั้งหมด")
      const r = await JC.listMyReportedIssues(all ? undefined : 100);
      if (!r.ok) return sendJson(res, 502, { error: 'ดึงรายการจาก Jira ไม่สำเร็จ', detail: r.error });
      return sendJson(res, 200, { issues: r.issues, hasMore: !!r.capped, browseBase: `${JC.base}/browse/` });
    }

    // search: วาง key/url → หาการ์ดใน project · ไม่เจอ/คนละ project = 404
    if (pathname === '/api/jira/issue' && req.method === 'GET') {
      if (!JC.envReady()) return sendJson(res, 500, { error: '.env Jira ไม่ครบ' });
      const key = parseIssueKey(url.searchParams.get('q'));
      if (!key || !key.startsWith(`${JC.JIRA_PROJECT_KEY}-`)) return sendJson(res, 404, { error: 'ไม่พบข้อมูล / ไม่มี Card นี้' });
      const iss = await JC.getIssue(key, ['summary', 'status']);
      if (!iss.ok) return sendJson(res, 404, { error: 'ไม่พบข้อมูล / ไม่มี Card นี้' });
      return sendJson(res, 200, { issue: { key: iss.key, summary: iss.summary, status: iss.status }, browseBase: `${JC.base}/browse/` });
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

    // ---------- static: หน้า Jira ----------
    const rel = pathname === '/' ? 'menu.html' : pathname.replace(/^\//, '');
    const filePath = path.normalize(path.join(MAP_DIR, rel));
    if (!filePath.startsWith(MAP_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
    return sendFile(res, filePath);
  } catch (e) {
    return sendJson(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`QA Workspace — Jira: http://localhost:${PORT}/`);
  if (!JC.envReady()) console.log('⚠️  .env Jira ยังไม่ครบ — คัดลอก .env.example เป็น .env แล้วกรอกค่า');
});
