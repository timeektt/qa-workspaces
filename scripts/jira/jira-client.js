#!/usr/bin/env node
/**
 * Shared Jira client — REST helper + ADF builders + intake/reject store
 *
 * ใช้โดย tools/qa-workspace/server/server.js (Jira intake/list/reject endpoints)
 * และ skill /jira-issue (ประมวลผล draft → สร้าง issue / reject การ์ด)
 *
 * config อ่านจาก .env:
 *   JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY (บังคับ)
 *   JIRA_DEFAULT_EPIC  — epic key ที่ผูก issue ใหม่เป็นค่าเริ่มต้น (ว่าง = ไม่ผูก epic)
 *   JIRA_SPRINT_FIELD  — custom field id ของ Sprint บน create screen (default customfield_10020)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
require(path.join(ROOT, 'node_modules/dotenv')).config({ path: path.join(ROOT, '.env'), quiet: true });

const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY } = process.env;

// ---------- config สำหรับ direct bug (จาก /jira-issue) ----------
const DEFAULT_BUG_EPIC = process.env.JIRA_DEFAULT_EPIC || '';      // Epic ที่ผูก issue ใหม่ (ว่าง = ไม่ผูก)
const SPRINT_FIELD = process.env.JIRA_SPRINT_FIELD || 'customfield_10020'; // field Sprint บน create screen

// ---------- REST helpers ----------
const base = (JIRA_BASE_URL || '').replace(/\/+$/, '');
const auth = 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');

function envReady() {
  return Boolean(JIRA_BASE_URL && JIRA_EMAIL && JIRA_API_TOKEN && JIRA_PROJECT_KEY);
}

async function jira(method, pathname, body) {
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json };
}

/**
 * อัปโหลดไฟล์เป็น attachment ของ issue (multipart)
 * ต้องมี header X-Atlassian-Token: no-check
 */
async function uploadAttachment(issueKey, filePath, asName) {
  const buf = fs.readFileSync(filePath);
  const filename = asName || path.basename(filePath);
  const form = new FormData();
  form.append('file', new Blob([buf]), filename);
  const res = await fetch(`${base}/rest/api/3/issue/${issueKey}/attachments`, {
    method: 'POST',
    headers: { Authorization: auth, Accept: 'application/json', 'X-Atlassian-Token': 'no-check' },
    body: form,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json };
}

/** ชื่อไฟล์ attachment ทั้งหมดของ issue (ไว้กันชื่อชนตอนฝังรูป inline ด้วย !filename!) */
async function getAttachmentNames(issueKey) {
  const r = await jira('GET', `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=attachment`);
  if (!r.ok) return [];
  return (r.json.fields.attachment || []).map((a) => a.filename);
}

/** คืนชื่อไฟล์ที่ยังไม่ชนกับ used (ถ้าชน เติม _2, _3, ... ก่อนนามสกุล) */
function uniqueAttachmentName(name, used) {
  if (!used.has(name)) return name;
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let n = 2;
  while (used.has(`${stem}_${n}${ext}`)) n++;
  return `${stem}_${n}${ext}`;
}

// ---------- read-only lookups ----------
async function getMyself() {
  return jira('GET', '/rest/api/3/myself');
}

/** component ทั้งหมดของ project (สำหรับ dropdown) */
async function getComponents(projectKey = JIRA_PROJECT_KEY) {
  const r = await jira('GET', `/rest/api/3/project/${projectKey}/components`);
  if (!r.ok) return { ok: false, status: r.status, components: [] };
  const components = (r.json || []).map(c => ({ id: c.id, name: c.name }));
  return { ok: true, components };
}

/** board แรกที่ผูกกับ project (คืน id หรือ null) */
async function getBoardId(projectKey = JIRA_PROJECT_KEY) {
  const boards = await jira('GET', `/rest/agile/1.0/board?projectKeyOrId=${projectKey}`);
  return boards.json?.values?.[0]?.id || null;
}

/**
 * หา active sprint ของ board แรกที่ผูกกับ project
 * คืน { id, name } หรือ null ถ้าไม่มี active sprint / board
 */
async function getActiveSprint(projectKey = JIRA_PROJECT_KEY) {
  const boardId = await getBoardId(projectKey);
  if (!boardId) return null;
  const sprints = await jira('GET', `/rest/agile/1.0/board/${boardId}/sprint?state=active`);
  const sp = sprints.json?.values?.[0];
  return sp ? { id: sp.id, name: sp.name, boardId } : null;
}

/** sprint ที่ active + future (สำหรับ dropdown) — เรียง active ก่อน */
async function getSprints(projectKey = JIRA_PROJECT_KEY) {
  const boardId = await getBoardId(projectKey);
  if (!boardId) return { sprints: [] };
  const r = await jira('GET', `/rest/agile/1.0/board/${boardId}/sprint?state=active,future`);
  const sprints = (r.json?.values || []).map(s => ({ id: s.id, name: s.name, state: s.state }));
  sprints.sort((a, b) => (a.state === 'active' ? -1 : 0) - (b.state === 'active' ? -1 : 0));
  return { sprints };
}

/** epic ใน project ที่ยังไม่ Done (สำหรับ dropdown) */
async function getEpics(projectKey = JIRA_PROJECT_KEY) {
  const jql = `project = ${projectKey} AND issuetype = Epic AND statusCategory != Done ORDER BY created DESC`;
  const r = await jira('POST', '/rest/api/3/search/jql', { jql, maxResults: 100, fields: ['summary'] });
  if (!r.ok) return { ok: false, status: r.status, epics: [] };
  const epics = (r.json?.issues || []).map(i => ({ key: i.key, summary: i.fields?.summary || i.key }));
  return { ok: true, epics };
}

/** project ทั้งหมดที่บัญชีนี้เห็น (สำหรับ dropdown "ระบบที่พบปัญหา") — เรียงตามชื่อ */
async function getProjects() {
  const r = await jira('GET', '/rest/api/3/project/search?maxResults=100&orderBy=name&status=live');
  if (!r.ok) return { ok: false, status: r.status, projects: [] };
  const projects = (r.json?.values || []).map(p => ({ key: p.key, name: p.name }));
  return { ok: true, projects };
}

// ---------- ADF: header colors (ตรงกับ import-feedback เดิม) ----------
function headerColor(t) {
  if (/^Details/i.test(t)) return '#FF991F';           // ส้ม
  if (/^Step/i.test(t)) return '#0065FF';              // น้ำเงิน
  if (/^จุดที่ปรับ/.test(t)) return '#6554C0';          // ม่วง
  if (/^Actual Result/i.test(t)) return '#DE350B';     // แดง (Bug)
  if (/^Expected Result/i.test(t)) return '#36B37E';   // เขียว (Bug)
  if (/^Current Behavior/i.test(t)) return '#FF991F';  // ส้ม (Improvement: สภาพปัจจุบัน)
  if (/^Proposed Change/i.test(t)) return '#6554C0';   // ม่วง (Improvement: จุดที่เสนอ)
  if (/^Benefit/i.test(t)) return '#36B37E';           // เขียว (Improvement: ผลดี)
  return null;
}

// ---------- ADF: body lines -> content nodes ----------
// รองรับ: **Header:** -> heading (มีสี), • bullet -> bulletList,
//         _text_ -> paragraph em, | a | b | -> table, อื่นๆ -> paragraph
function bodyLinesToContent(lines) {
  const content = [];
  let bullets = null;
  let tableRows = null;
  const flushBullets = () => {
    if (bullets && bullets.length) {
      content.push({
        type: 'bulletList',
        content: bullets.map(t => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }],
        })),
      });
    }
    bullets = null;
  };
  const flushTable = () => {
    if (tableRows && tableRows.length) content.push(tableToNode(tableRows));
    tableRows = null;
  };
  const flushAll = () => { flushBullets(); flushTable(); };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // markdown table row
    if (/^\|.*\|$/.test(line)) {
      // ข้ามเส้นคั่น | --- | --- |
      if (/^\|[\s:|-]+\|$/.test(line)) continue;
      flushBullets();
      const cells = line.slice(1, -1).split('|').map(c => c.trim());
      (tableRows = tableRows || []).push(cells);
      continue;
    }
    flushTable();

    const ref = line.match(/^_(.*)_$/);
    if (ref) { flushBullets(); content.push({ type: 'paragraph', content: [{ type: 'text', text: ref[1], marks: [{ type: 'em' }] }] }); continue; }

    // heading: **Header:** (import-feedback) หรือ ## Header (draft store)
    const head = line.match(/^\*\*(.+?):?\*\*\s*$/) || line.match(/^#{2,3}\s+(.+?)\s*$/);
    if (head) {
      flushBullets();
      const title = head[1].replace(/:$/, '');
      const color = headerColor(title);
      const marks = [{ type: 'strong' }];
      if (color) marks.push({ type: 'textColor', attrs: { color } });
      content.push({ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: title, marks }] });
      continue;
    }

    if (/^[•⚠]/.test(line)) { (bullets = bullets || []).push(line.replace(/^•\s?/, '').trim()); continue; }

    flushBullets();
    content.push({ type: 'paragraph', content: [{ type: 'text', text: line }] });
  }
  flushAll();
  return content;
}

// markdown table rows (array of cell-arrays) -> ADF table node
// แถวแรก = header row
function tableToNode(rows) {
  const cellNode = (text, isHeader) => ({
    type: isHeader ? 'tableHeader' : 'tableCell',
    attrs: {},
    content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
  });
  return {
    type: 'table',
    attrs: { isNumberColumnEnabled: false, layout: 'default' },
    content: rows.map((cells, ri) => ({
      type: 'tableRow',
      content: cells.map(c => cellNode(c, ri === 0)),
    })),
  };
}

// ---------- ADF: media (ภาพ inline บนสุด) ----------
// อ่านขนาด PNG จาก IHDR (bytes 16-24) — คืน null ถ้าไม่ใช่ PNG
function pngSize(filePath) {
  try {
    const b = fs.readFileSync(filePath);
    const isPng = b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    if (!isPng) return null;
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  } catch { return null; }
}

// ---------- attachment type helpers ----------
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']);
function isImageFile(name) {
  return IMAGE_EXTS.has(path.extname(String(name || '')).slice(1).toLowerCase());
}
// บรรทัด/โหนดชี้ไฟล์เอกสาร (ไม่ใช่รูป) → แนบเป็น attachment เท่านั้น ฝัง inline ไม่ได้
function docPointerNode(docNames) {
  return {
    type: 'paragraph',
    content: [{
      type: 'text',
      text: `📎 ไฟล์แนบ ${docNames.length} ไฟล์ (${docNames.join(', ')}) — ดูใน Attachments ของ issue นี้`,
      marks: [{ type: 'em' }],
    }],
  };
}
// wiki v2: `[^ชื่อไฟล์]` → Jira แปลงเป็น mediaGroup (การ์ดไฟล์กดดาวน์โหลดได้ในคอมเมนต์/คำอธิบาย)
// ต้องขึ้นบรรทัดใหม่ (มีบรรทัดว่างคั่นก่อน) ไม่งั้นถูกดูดเข้า list ก่อนหน้า
function docPointerWikiLine(docNames) {
  return `📎 ไฟล์แนบ: ${docNames.map((n) => `[^${n}]`).join(' ')}`;
}

// ---------- Task 2: decodeDataUri + MAX_ATTACH_BYTES ----------
const MAX_ATTACH_BYTES = 25 * 1024 * 1024;
// map mime → นามสกุล (ใช้ตอน name ไม่มีนามสกุล)
const MIME_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'application/pdf': 'pdf',
  'text/csv': 'csv', 'text/plain': 'txt', 'application/zip': 'zip',
};
function decodeDataUri(dataUri, name) {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUri || '');
  if (!m) return { error: 'รูปแบบ data URI ไม่ถูกต้อง' };
  let buffer;
  try { buffer = Buffer.from(m[2], 'base64'); } catch { return { error: 'ถอด base64 ไม่ได้' }; }
  if (buffer.length > MAX_ATTACH_BYTES) return { error: 'ไฟล์ใหญ่เกิน 25MB' };
  let finalName = path.basename(String(name || '')).replace(/^\.+$/, '');
  if (!finalName || !path.extname(finalName)) {
    const ext = MIME_EXT[m[1]] || 'bin';
    finalName = `${finalName || Date.now()}.${ext}`;
  }
  return { name: finalName, buffer };
}

// สร้าง mediaSingle node จาก attachment id (+ ขนาดถ้ารู้)
function mediaSingleNode(attachmentId, filePath, alt) {
  const size = filePath ? pngSize(filePath) : null;
  const attrs = { type: 'file', id: String(attachmentId), collection: '' };
  if (alt) attrs.alt = alt;
  if (size) { attrs.width = size.width; attrs.height = size.height; }
  return { type: 'mediaSingle', attrs: { layout: 'center' }, content: [{ type: 'media', attrs }] };
}

// เดินทั้ง ADF (description/comment) ตั้งทุก mediaSingle เป็น layout=full-width (ภาพเต็มความกว้างคอลัมน์)
// ใช้หลัง Jira แปลง wiki !name! → media UUID จริงแล้วเท่านั้น (attachment id ตรงๆ ตั้ง layout ไม่ได้)
// dims = [{width,height}, …] ขนาดจริงของภาพเรียงตามลำดับที่ฝัง — จำเป็นเพราะ Jira แปลง wiki แล้ว
//   ตั้ง media dims เป็น placeholder 200×183 (เกือบจตุรัส) พอ full-width frame สูงตามสัดส่วนผิด
//   เกิดที่ว่างบน-ล่างภาพแนวนอน; set ขนาดจริงให้สัดส่วน frame ตรงภาพ. คงเฉพาะ localId — คืนจำนวน node ที่แก้
function mediaSinglesToFullWidth(node, dims = [], cursor = { i: 0 }) {
  if (!node || typeof node !== 'object') return 0;
  let count = 0;
  if (node.type === 'mediaSingle') {
    node.attrs = { ...(node.attrs && node.attrs.localId ? { localId: node.attrs.localId } : {}), layout: 'full-width' };
    const d = dims[cursor.i++];
    if (d && d.width && d.height && node.content && node.content[0]) {
      node.content[0].attrs.width = d.width;
      node.content[0].attrs.height = d.height;
    }
    count++;
  }
  if (Array.isArray(node.content)) for (const child of node.content) count += mediaSinglesToFullWidth(child, dims, cursor);
  return count;
}

// ---------- ADF builders (public) ----------
/** body ธรรมดา (ไม่มีภาพ) — ใช้โดย import-feedback */
function bodyToADF(lines) {
  const content = bodyLinesToContent(lines);
  if (!content.length) content.push({ type: 'paragraph', content: [{ type: 'text', text: '(no description)' }] });
  return { type: 'doc', version: 1, content };
}

/** description ของ draft = mediaSingle(ภาพ) บนสุด + body */
function buildDraftDescriptionADF(bodyLines, mediaNodes = []) {
  const content = [...mediaNodes, ...bodyLinesToContent(bodyLines)];
  if (!content.length) content.push({ type: 'paragraph', content: [{ type: 'text', text: '(no description)' }] });
  return { type: 'doc', version: 1, content };
}

// แปลง bodyLines → wiki markup string (สำหรับ v2 endpoint) + แนบ !filename! ฝังรูป inline
// (ADF v3 ฝังรูป inline ไม่ได้ — ต้อง media UUID ที่ lookup ไม่ได้; v2 wiki map รูปด้วยชื่อไฟล์)
function bodyLinesToWiki(lines, imageNames = []) {
  const out = [];
  const arr = lines || [];
  for (let i = 0; i < arr.length; i++) {
    const line = String(arr[i]).trim();
    if (!line) { out.push(''); continue; }
    const head = line.match(/^\*\*(.+?):?\*\*\s*$/) || line.match(/^#{2,3}\s+(.+?)\s*$/);
    if (head) {
      // blank line ก่อน heading เสมอ (ยกเว้นบรรทัดแรก) — กัน Jira wiki ดูด heading เข้า list ก่อนหน้า
      if (out.length && out[out.length - 1] !== '') out.push('');
      out.push(`h3. ${head[1].replace(/:$/, '')}`);
      continue;
    }
    if (/^[•⚠]/.test(line)) { out.push(`* ${line.replace(/^[•⚠]\s?/, '').trim()}`); continue; }
    if (/^\|.*\|$/.test(line)) {
      if (/^\|[\s:|-]+\|$/.test(line)) continue; // ข้ามเส้นคั่น markdown separator
      const cells = line.slice(1, -1).split('|').map((c) => c.trim());
      // header row = แถวที่ตามด้วยเส้นคั่น markdown (| --- |) → wiki ใช้ ||...||
      const isHeader = /^\|[\s:|-]+\|$/.test(String(arr[i + 1] || '').trim());
      // blank line ก่อนเริ่มตาราง — กัน Jira wiki ดูดตารางเข้า list/paragraph ก่อนหน้า (ไม่งั้นตารางไม่ render)
      if (isHeader && out.length && out[out.length - 1] !== '') out.push('');
      out.push(isHeader ? `||${cells.join('||')}||` : `|${cells.join('|')}|`);
      continue;
    }
    out.push(line);
  }
  const imgs = (imageNames || []).map((n) => `!${n}!`);
  if (imgs.length) {
    // วางรูปก่อน section "Details" (หลัง Environment) — ถ้าไม่มี Details วางบนสุด
    const di = out.findIndex((l) => /^h3\. Details\b/i.test(l));
    if (di >= 0) out.splice(di, 0, ...imgs, '');
    else out.unshift(...imgs, '');
  }
  return out.join('\n');
}

// ---------- parse issues.md (draft store จาก /jira-issue) ----------
// รูปแบบ: # draft-NNN + บรรทัด **Key:** value + body (## heading)
function parseDraftsMd(mdPath) {
  if (!fs.existsSync(mdPath)) return [];
  const text = fs.readFileSync(mdPath, 'utf8');
  const blocks = text.split(/^# (?=draft-)/m).slice(1); // ตัดหัวก่อน draft-แรก
  const drafts = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const id = (lines[0] || '').trim(); // "draft-001"
    const meta = {};
    let bodyStart = lines.length;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^##\s/.test(line)) { bodyStart = i; break; }
      const m = line.match(/^\*\*(.+?):\*\*\s*(.*)$/);
      if (m) meta[m[1].trim().toLowerCase()] = m[2].trim();
    }
    const bodyLines = lines.slice(bodyStart);
    const images = (meta['images'] || '').split(',').map(s => s.trim()).filter(Boolean);
    drafts.push({
      id,
      summary: meta['summary'] || '',
      type: /improve/i.test(meta['type'] || '') ? 'Improvement' : 'Bug',
      priority: meta['priority'] || 'Medium',
      system: meta['system'] || '',
      module: meta['module'] || '',
      status: (meta['status'] || 'draft').toLowerCase(),
      jiraKey: meta['jira key'] || '',
      hint: meta['hint'] || '',
      images,
      bodyLines,
    });
  }
  return drafts;
}

/**
 * เขียนสถานะกลับลง issues.md (status: created + jira key) สำหรับ draft ที่ระบุ
 * แก้เฉพาะ 2 บรรทัดในบล็อกของ draftId นั้น ไม่แตะบล็อกอื่น
 */
function writeBackStatus(mdPath, draftId, jiraKey) {
  const text = fs.readFileSync(mdPath, 'utf8');
  const lines = text.split(/\r?\n/);
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^# draft-/.test(lines[i])) inBlock = lines[i].trim() === `# ${draftId}`;
    if (!inBlock) continue;
    if (/^\*\*Status:\*\*/.test(lines[i])) lines[i] = '**Status:** created';
    if (/^\*\*Jira Key:\*\*/.test(lines[i])) lines[i] = `**Jira Key:** ${jiraKey}`;
  }
  fs.writeFileSync(mdPath, lines.join('\n'));
}

// ลบ block ของ draft ทิ้งจาก issues.md (คืน true ถ้าเจอ+ลบ)
function deleteDraft(mdPath, draftId) {
  const text = fs.readFileSync(mdPath, 'utf8');
  const parts = text.split(/(?=^# draft-)/m).filter((p) => p.trim());
  const kept = parts.filter((p) => p.split(/\r?\n/)[0].trim() !== `# ${draftId}`);
  if (kept.length === parts.length) return false;
  fs.writeFileSync(mdPath, kept.join('').replace(/\s*$/, '') + '\n');
  return true;
}

// ---------- สร้าง bug จาก draft (Jira tab) ----------
const DRAFTS_DIR = path.join(ROOT, 'agent-data/jira-drafts');

// บรรทัดชี้ไปที่ภาพใน Attachments (Jira ไม่เปิด media UUID ผ่าน public REST → ฝัง inline ไม่ได้)
function attachmentPointerNode(images) {
  const names = images.map(r => path.basename(r)).join(', ');
  return {
    type: 'paragraph',
    content: [{
      type: 'text',
      text: `📎 ไฟล์แนบ ${images.length} ไฟล์ (${names}) — ดูใน Attachments ของ issue นี้`,
      marks: [{ type: 'em' }],
    }],
  };
}

/**
 * สร้าง Jira bug จาก draft object (จาก parseDraftsMd)
 * opts: { componentId?, epicKey?, sprintId?, dryRun? }
 *   epicKey  — default DEFAULT_BUG_EPIC
 *   sprintId — ตัวเลข = ใส่ sprint นั้น · '' / null = backlog (ไม่ใส่ sprint)
 * flow: create issue (มีบรรทัดชี้ภาพถ้ามี) → upload ภาพเป็น attachment
 * คืน { dryRun, fields } (dry-run) หรือ { key, url } (สร้างจริง) หรือ { error }
 */
async function createDraftIssue(draft, opts = {}) {
  const { componentId = null, epicKey = null, sprintId = undefined, dryRun = false, embedInline = false, projectKey = JIRA_PROJECT_KEY } = opts;
  const summary = draft.summary.length > 255 ? draft.summary.slice(0, 252) + '…' : draft.summary;

  const description = buildDraftDescriptionADF(draft.bodyLines, []);
  const imgFiles = draft.images.filter(isImageFile);
  const docFiles = draft.images.filter((n) => !isImageFile(n));
  // รูป: pointer เฉพาะเมื่อไม่ embed inline (embed จะ PUT wiki ทับทีหลัง)
  if (imgFiles.length && !embedInline) description.content.push(attachmentPointerNode(imgFiles));
  // เอกสาร: ไม่มีทางฝัง inline → pointer เสมอ (ถ้า embedInline+มีรูป จะถูก wiki ทับด้วยบรรทัด docPointerWikiLine แทน)
  if (docFiles.length && !(embedInline && imgFiles.length)) description.content.push(docPointerNode(docFiles.map((r) => path.basename(r))));

  const sprintVal = sprintId === undefined ? null : sprintId; // undefined = ไม่ระบุจาก caller
  const issueType = draft.type === 'Improvement' ? 'Improvement' : 'Bug';
  // ว่าง = ไม่ผูก parent · DEFAULT_BUG_EPIC ใช้ได้เฉพาะ project หลัก (epic ผูก project — ข้าม project อื่นจะ invalid)
  const parentEpic = epicKey || (projectKey === JIRA_PROJECT_KEY ? DEFAULT_BUG_EPIC : '');
  const fields = {
    project: { key: projectKey },
    issuetype: { name: issueType },
    ...(parentEpic ? { parent: { key: parentEpic } } : {}),
    summary,
    priority: { name: draft.priority || 'Medium' },
    ...(componentId ? { components: [{ id: String(componentId) }] } : {}),
    ...(sprintVal ? { [SPRINT_FIELD]: Number(sprintVal) } : {}),
    description,
  };

  if (dryRun) {
    return { dryRun: true, fields, imageCount: draft.images.length };
  }

  // 1) create
  const created = await jira('POST', '/rest/api/3/issue', { fields });
  if (!created.ok) {
    return { error: created.json?.errors || created.json?.errorMessages || created.json, status: created.status };
  }
  const key = created.json.key;

  // 2) upload ภาพเป็น attachment (โผล่ใน panel Attachments) + เก็บชื่อไฟล์ที่ขึ้นสำเร็จ
  const imageErrors = [];
  const attachedNames = [];
  const attachedDims = []; // ขนาดจริงของภาพ (เรียงตาม attachedNames) ไว้ set media dims ตอน full-width
  const used = new Set(); // กันชื่อไฟล์ชนกันเองในชุด (issue เพิ่งสร้าง ยังไม่มี attachment เดิม)
  for (const rel of draft.images) {
    const abs = path.join(DRAFTS_DIR, rel);
    if (!fs.existsSync(abs)) { imageErrors.push(`${rel} (ไม่พบไฟล์)`); continue; }
    const name = uniqueAttachmentName(path.basename(rel), used);
    const up = await uploadAttachment(key, abs, name);
    if (!up.ok || !Array.isArray(up.json) || !up.json[0]) { imageErrors.push(`${rel} (upload fail ${up.status})`); continue; }
    const finalName = up.json[0].filename || name;
    used.add(finalName);
    attachedNames.push(finalName);
    attachedDims.push(pngSize(abs));
  }

  // 3) embedInline: PUT คำอธิบายเป็น wiki markup (v2) ที่มี !filename! ฝังรูป inline ท้ายคำอธิบาย
  //    (attachment ต้องมีก่อน จึงทำหลัง upload; Jira แปลง wiki→ADF map รูปด้วยชื่อไฟล์)
  // แยก: รูปฝัง inline ได้ · เอกสารแนบเป็น attachment เท่านั้น
  const attachedImageNames = attachedNames.filter(isImageFile);
  const attachedDocNames = attachedNames.filter((n) => !isImageFile(n));
  const imageDims = attachedNames
    .map((n, idx) => ({ n, d: attachedDims[idx] }))
    .filter((x) => isImageFile(x.n))
    .map((x) => x.d);

  // embedInline: PUT คำอธิบายเป็น wiki (v2) ฝัง !filename! เฉพาะรูป + บรรทัดชี้เอกสาร
  if (embedInline && attachedImageNames.length) {
    let wiki = bodyLinesToWiki(draft.bodyLines, attachedImageNames);
    if (attachedDocNames.length) wiki += `\n\n${docPointerWikiLine(attachedDocNames)}`;
    const upd = await jira('PUT', `/rest/api/2/issue/${key}`, { fields: { description: wiki } });
    if (!upd.ok) imageErrors.push(`embed inline (v2) fail ${upd.status}`);
    else {
      // 4) ภาพเต็มความกว้าง: GET ADF (media เป็น UUID จริงหลังแปลง wiki) → full-width → PUT v3
      const g = await jira('GET', `/rest/api/3/issue/${key}?fields=description`);
      const doc = g.ok && g.json.fields && g.json.fields.description;
      if (doc && mediaSinglesToFullWidth(doc, imageDims)) {
        const fw = await jira('PUT', `/rest/api/3/issue/${key}`, { fields: { description: doc } });
        if (!fw.ok) imageErrors.push(`full-width fail ${fw.status}`);
      }
    }
  } else if (attachedDocNames.length && !attachedImageNames.length) {
    // มีแต่เอกสาร ไม่มีรูป (ทั้งกรณี embedInline และไม่ embed) → PUT คำอธิบายเป็น wiki v2 + `[^ชื่อไฟล์]`
    // ให้เอกสารขึ้นเป็นการ์ดไฟล์กดดาวน์โหลดได้ ไม่ใช่แค่ข้อความชื่อไฟล์
    const wiki = `${bodyLinesToWiki(draft.bodyLines, [])}\n\n${docPointerWikiLine(attachedDocNames)}`;
    const upd = await jira('PUT', `/rest/api/2/issue/${key}`, { fields: { description: wiki } });
    if (!upd.ok) imageErrors.push(`doc pointer update fail ${upd.status}`);
  }

  return { key, url: `${base}/browse/${key}`, imageErrors };
}

// ---------- fuzzy match (Dice bigram similarity) ----------
function bigrams(s) {
  const t = String(s || '').toLowerCase().replace(/\s+/g, '');
  const map = new Map();
  for (let i = 0; i < t.length - 1; i++) {
    const bg = t.slice(i, i + 2);
    map.set(bg, (map.get(bg) || 0) + 1);
  }
  return map;
}

function dice(a, b) {
  const A = String(a || '').toLowerCase().replace(/\s+/g, '');
  const B = String(b || '').toLowerCase().replace(/\s+/g, '');
  if (!A.length || !B.length) return 0;
  if (A.length === 1 || B.length === 1) return A === B ? 1 : 0;
  const ba = bigrams(A), bb = bigrams(B);
  let inter = 0, total = 0;
  for (const [bg, c] of ba) { total += c; if (bb.has(bg)) inter += Math.min(c, bb.get(bg)); }
  for (const [, c] of bb) total += c;
  return (2 * inter) / total;
}

function resolveComponentFuzzy(target, components, threshold = 0.5) {
  let best = null, bestScore = 0;
  for (const c of (components || [])) {
    const score = dice(target, c.name);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore >= threshold ? best : null;
}

// แปลง input ช่อง search (key เปล่า / url เต็ม) → issue key ตัวใหญ่ ทุก project · คืน '' ถ้าไม่ใช่รูป key
// เลขล้วน (2023) ไม่แปลงที่นี่ — endpoint จัดการแยก (หาเลขนั้นในทุก project)
function parseIssueKey(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/([A-Za-z][A-Za-z0-9_]+-\d+)/); // ABC-123 หรือใน .../browse/ABC-123 (ทุก project)
  return m ? m[1].toUpperCase() : '';
}

// ---------- intake store ----------
const INTAKE_DIR = path.join(DRAFTS_DIR, 'intake');
const REJECT_DIR = path.join(DRAFTS_DIR, 'reject'); // intake สำหรับ QA reject (แยกจาก intake สร้าง issue)

// เขียนรูปลงโฟลเดอร์ intake/reject + คืนชื่อไฟล์ (กันชื่อซ้ำเขียนทับกัน) — ใช้ร่วม writeIntake/writeReject
function writeStampImages(dir, images) {
  const imageNames = [];
  for (const img of (images || [])) {
    const rawName = path.basename(String(img.name || '')).replace(/^\.+$/, '');
    const base = rawName || `${imageNames.length + 1}.png`;
    let name = base;
    if (imageNames.includes(name)) {
      const ext = path.extname(base);
      const stem = base.slice(0, base.length - ext.length);
      let n = 1;
      do { name = `${stem}-${n}${ext}`; n += 1; } while (imageNames.includes(name));
    }
    fs.writeFileSync(path.join(dir, name), img.buffer);
    imageNames.push(name);
  }
  return imageNames;
}

function writeIntake(intakeDir, { text = '', type = '', system = '', projectKey = '', component = '', componentId = '', epicKey = '', sprintId = '', sprintLabel = '', images = [] }, stamp) {
  const id = stamp || String(Date.now());
  const dir = path.join(intakeDir, id);
  fs.mkdirSync(dir, { recursive: true });
  const imageNames = writeStampImages(dir, images);
  // system = ชื่อ project (โชว์) · projectKey = key ที่ใช้ยิง issue จริง (ว่าง = ใช้ default จาก .env)
  const meta = { stamp: id, text, type, system, projectKey, component, componentId, epicKey, sprintId, sprintLabel, status: 'pending', createdAt: id, images: imageNames };
  fs.writeFileSync(path.join(dir, 'intake.json'), JSON.stringify(meta, null, 2));
  return { stamp: id, dir };
}

// intake สำหรับ QA reject — ผูก issueKey/issueSummary + เหตุผล(reason) + รูป
// เก็บ meta ในไฟล์ intake.json (ชื่อเดียวกับ intake สร้าง) → reuse readIntake/listIntakes/deleteIntake/readIntakeImages ได้ตรงๆ
function writeReject(rejectDir, { issueKey = '', issueSummary = '', reason = '', images = [] }, stamp) {
  const id = stamp || String(Date.now());
  const dir = path.join(rejectDir, id);
  fs.mkdirSync(dir, { recursive: true });
  const imageNames = writeStampImages(dir, images);
  const meta = { stamp: id, kind: 'reject', issueKey, issueSummary, reason, status: 'pending', createdAt: id, images: imageNames };
  fs.writeFileSync(path.join(dir, 'intake.json'), JSON.stringify(meta, null, 2));
  return { stamp: id, dir };
}

function readIntake(intakeDir, stamp) {
  const p = path.join(intakeDir, stamp, 'intake.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// อ่านรูปของ intake กลับมาเป็น data URI (ใช้ตอนโหลด intake เข้าฟอร์มแก้ไข)
const IMG_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
function readIntakeImages(intakeDir, stamp) {
  const meta = readIntake(intakeDir, stamp);
  if (!meta) return [];
  const dir = path.join(intakeDir, stamp);
  return (meta.images || []).map((name) => {
    const fp = path.join(dir, name);
    if (!fs.existsSync(fp)) return null;
    const ext = path.extname(name).toLowerCase();
    const mime = IMG_MIME[ext] || 'application/octet-stream';
    const b64 = fs.readFileSync(fp).toString('base64');
    return { name, dataUri: `data:${mime};base64,${b64}` };
  }).filter(Boolean);
}

function listIntakes(intakeDir, status) {
  if (!fs.existsSync(intakeDir)) return [];
  return fs.readdirSync(intakeDir)
    .map((stamp) => readIntake(intakeDir, stamp))
    .filter((m) => m && (!status || m.status === status))
    .sort((a, b) => String(b.stamp).localeCompare(String(a.stamp)));
}

function deleteIntake(intakeDir, stamp) {
  const root = path.resolve(intakeDir);
  const dir = path.resolve(intakeDir, String(stamp));
  if (dir === root || !dir.startsWith(root + path.sep)) return false;
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

// ---------- Jira create-issue prefill URL ----------
// ประกอบลิงก์เปิดหน้า Jira create issue ที่ prefill ฟิลด์ไว้ให้ (รีวิวก่อนกด Create เอง)
// endpoint คลาสสิก secure/CreateIssueDetails!init.jspa รับ id ตัวเลข (pid/issuetype/priority)
function buildCreatePrefillUrl(baseUrl, { pid, issueTypeId, priorityId, componentId, summary, descriptionText } = {}) {
  const p = new URLSearchParams();
  if (pid) p.set('pid', String(pid));
  if (issueTypeId) p.set('issuetype', String(issueTypeId));
  if (summary) p.set('summary', summary);
  if (descriptionText) p.set('description', descriptionText);
  if (priorityId) p.set('priority', String(priorityId));
  if (componentId) p.set('components', String(componentId));
  return `${String(baseUrl).replace(/\/+$/, '')}/secure/CreateIssueDetails!init.jspa?${p.toString()}`;
}

// ดึง id ตัวเลขที่ prefill URL ต้องใช้: project id + issue type ids + priority ids
async function getCreateMeta() {
  const [proj, pri] = await Promise.all([
    jira('GET', `/rest/api/3/project/${JIRA_PROJECT_KEY}`),
    jira('GET', '/rest/api/3/priority'),
  ]);
  const projectId = proj.ok ? proj.json.id : null;
  const issueTypes = proj.ok ? (proj.json.issueTypes || []).map((t) => ({ id: t.id, name: t.name })) : [];
  const priRaw = pri.ok ? (Array.isArray(pri.json) ? pri.json : (pri.json.values || [])) : [];
  const priorities = priRaw.map((p) => ({ id: p.id, name: p.name }));
  return { projectId, issueTypes, priorities };
}

// resolve ชื่อ → id แล้วประกอบ prefill URL (fuzzy match component)
async function createPrefillUrl({ summary, descriptionText, typeName = 'Bug', priorityName = 'Medium', componentName = '' } = {}) {
  const meta = await getCreateMeta();
  const norm = (s) => String(s || '').toLowerCase().trim();
  const it = meta.issueTypes.find((t) => norm(t.name) === norm(typeName))
    || meta.issueTypes.find((t) => norm(t.name) === 'bug');
  const pr = meta.priorities.find((p) => norm(p.name) === norm(priorityName));
  let componentId = null;
  if (componentName) {
    const comps = await getComponents();
    const best = resolveComponentFuzzy(componentName, comps.components || []);
    componentId = best ? best.id : null;
  }
  const url = buildCreatePrefillUrl(base, {
    pid: meta.projectId,
    issueTypeId: it ? it.id : null,
    priorityId: pr ? pr.id : null,
    componentId,
    summary,
    descriptionText,
  });
  return { url, resolved: { projectId: meta.projectId, issueTypeId: it ? it.id : null, priorityId: pr ? pr.id : null, componentId } };
}

// ---------- dedup (หา issue ซ้ำก่อนสร้าง — เลียนแบบ ARIS) ----------
// จัดกลุ่ม candidate ตาม Dice similarity บน summary: SIMILAR (เตือน) / STRONG (block)
function classifyDuplicates(summary, candidates, { similar = 0.45, strong = 0.68 } = {}) {
  const scored = (candidates || [])
    .map((c) => ({
      key: c.key,
      summary: c.summary,
      status: c.status,
      score: Number(dice(summary, c.summary).toFixed(3)),
    }))
    .filter((c) => c.score >= similar)
    .sort((a, b) => b.score - a.score)
    .map((c) => ({ ...c, level: c.score >= strong ? 'STRONG' : 'SIMILAR' }));
  return { candidates: scored, strongDup: scored.some((c) => c.level === 'STRONG') };
}

// ยิง JQL หา Jira live แล้ว classify (ใช้ /search/jql — /search เดิม deprecate 410)
// ดึง issue ล่าสุด N ใบมา dice ในเครื่อง (ไม่พึ่ง text search — Jira tokenize ไทยไม่ได้ dup ไทยเลย match ไม่ติด)
async function findDuplicates(summary, opts = {}) {
  const jql = `project = ${opts.projectKey || JIRA_PROJECT_KEY} ORDER BY created DESC`;
  const r = await jira('POST', '/rest/api/3/search/jql', { jql, maxResults: opts.max || 100, fields: ['summary', 'status'] });
  const candidates = (r.ok ? r.json.issues || [] : []).map((it) => ({
    key: it.key,
    summary: it.fields.summary,
    status: it.fields.status && it.fields.status.name,
  }));
  return { ...classifyDuplicates(summary, candidates, opts), searched: r.ok, scanned: candidates.length };
}

// ---------- retest / reopen (comment + transition ใบเดิม) ----------
// flow: dev แก้ → RELEASED TO QA → QA retest fail → comment ผลทดสอบซ้ำ + reopen ใบเดิม
//       (ไม่สร้างใบใหม่ — กัน duplicate ของเรื่องเดียวกัน)

/**
 * ดึง issue เดิมมาดู (สำหรับ retest — เทียบอาการเดิม vs ปัจจุบัน)
 * คืน { ok, key, summary, status, priority, issuetype, components:[{id,name}], description, reporter }
 * reporter คืนก็ต่อเมื่อร้องขอ field 'reporter' มาด้วย (ไม่ขอ = null)
 */
async function getIssue(key, fields = ['summary', 'description', 'status', 'priority', 'issuetype', 'components']) {
  const r = await jira('GET', `/rest/api/3/issue/${encodeURIComponent(key)}?fields=${fields.join(',')}`);
  if (!r.ok) return { ok: false, status: r.status, error: r.json };
  const f = r.json.fields || {};
  return {
    ok: true,
    key: r.json.key,
    summary: f.summary || '',
    status: f.status && f.status.name,
    statusCategory: f.status && f.status.statusCategory && f.status.statusCategory.key,
    priority: f.priority && f.priority.name,
    issuetype: f.issuetype && f.issuetype.name,
    components: (f.components || []).map(c => ({ id: c.id, name: c.name })),
    description: f.description || null,
    reporter: f.reporter ? (f.reporter.displayName || f.reporter.emailAddress || null) : null,
  };
}

/**
 * โพสต์ comment ลง issue เดิม (ผลทดสอบซ้ำ / หมายเหตุ)
 * bodyLines = array บรรทัดสไตล์ description (heading **..**, bullet •, table |..|)
 * opts.images = array absolute path ของรูป — upload เป็น attachment แล้วฝัง inline ผ่าน v2 wiki
 * คืน { ok, id?, imageErrors } หรือ { ok:false, error }
 */
async function addComment(key, bodyLines, opts = {}) {
  const images = opts.images || [];
  const imageErrors = [];
  const attachedNames = [];
  const attachedDims = []; // ขนาดจริงของภาพ (เรียงตาม attachedNames) ไว้ set media dims ตอน full-width
  // กันชื่อไฟล์ชนกับ attachment เดิมของ issue — ไม่งั้น !filename! ใน wiki จะฝังรูปเก่าที่ชื่อซ้ำแทน
  const used = new Set(await getAttachmentNames(key));
  for (const abs of images) {
    if (!fs.existsSync(abs)) { imageErrors.push(`${path.basename(abs)} (ไม่พบไฟล์)`); continue; }
    const name = uniqueAttachmentName(path.basename(abs), used);
    const up = await uploadAttachment(key, abs, name);
    if (!up.ok || !Array.isArray(up.json) || !up.json[0]) { imageErrors.push(`${path.basename(abs)} (upload fail ${up.status})`); continue; }
    const finalName = up.json[0].filename || name;
    used.add(finalName);
    attachedNames.push(finalName);
    attachedDims.push(pngSize(abs));
  }
  const attachedImageNames = attachedNames.filter(isImageFile);
  const attachedDocNames = attachedNames.filter((n) => !isImageFile(n));
  const imageDims = attachedNames
    .map((n, idx) => ({ n, d: attachedDims[idx] }))
    .filter((x) => isImageFile(x.n))
    .map((x) => x.d);
  let res;
  if (attachedImageNames.length) {
    // v2 wiki ฝัง !filename! เฉพาะรูป + บรรทัดชี้เอกสาร
    let wiki = bodyLinesToWiki(bodyLines, attachedImageNames);
    if (attachedDocNames.length) wiki += `\n\n${docPointerWikiLine(attachedDocNames)}`;
    res = await jira('POST', `/rest/api/2/issue/${encodeURIComponent(key)}/comment`, { body: wiki });
    if (res.ok && res.json && res.json.id) {
      const cid = res.json.id;
      const g = await jira('GET', `/rest/api/3/issue/${encodeURIComponent(key)}/comment/${cid}`);
      const doc = g.ok && g.json.body;
      if (doc && mediaSinglesToFullWidth(doc, imageDims)) {
        const fw = await jira('PUT', `/rest/api/3/issue/${encodeURIComponent(key)}/comment/${cid}`, { body: doc });
        if (!fw.ok) imageErrors.push(`full-width fail ${fw.status}`);
      }
    }
  } else if (attachedDocNames.length) {
    // มีแต่เอกสาร (ไม่มีรูป) → v2 wiki + `[^ชื่อไฟล์]` เพื่อให้ได้การ์ดไฟล์ในคอมเมนต์
    // (ADF ฝัง media ด้วย attachment id ตรงๆ ไม่ได้ — Jira ตอบ ATTACHMENT_VALIDATION_ERROR)
    const wiki = `${bodyLinesToWiki(bodyLines, [])}\n\n${docPointerWikiLine(attachedDocNames)}`;
    res = await jira('POST', `/rest/api/2/issue/${encodeURIComponent(key)}/comment`, { body: wiki });
  } else {
    res = await jira('POST', `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { body: bodyToADF(bodyLines) });
  }
  if (!res.ok) return { ok: false, status: res.status, error: res.json, imageErrors };
  return { ok: true, id: res.json && res.json.id, imageErrors };
}

/** transition ที่ทำได้ของ issue ปัจจุบัน — คืน [{id, name, to}] (ชื่อ status ปลายทาง) */
async function getTransitions(key) {
  const r = await jira('GET', `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`);
  if (!r.ok) return { ok: false, status: r.status, transitions: [] };
  const transitions = (r.json.transitions || []).map(t => ({ id: t.id, name: t.name, to: t.to && t.to.name }));
  return { ok: true, transitions };
}

/** ย้าย status ของ issue ด้วย transition id (reopen ฯลฯ) — id ได้จาก getTransitions */
async function transitionIssue(key, transitionId) {
  const r = await jira('POST', `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, { transition: { id: String(transitionId) } });
  if (!r.ok) return { ok: false, status: r.status, error: r.json };
  return { ok: true };
}

// ---------- QA reject (list การ์ดที่เราสร้าง + comment + ย้ายสถานะ QA REJECT) ----------

/**
 * list issue ใน project ที่บัญชีปัจจุบันเป็น reporter (สำหรับแท็บ Jira List)
 * /search/jql cap 100 ใบ/หน้า → วน nextPageToken จนครบ (isLast) หรือถึงเพดาน max กันดึงไม่จบ
 * คืน [{ key, summary, status, statusCategory, created }] เรียง created ใหม่→เก่า
 */
async function listMyReportedIssues(max = 2000) {
  const jql = `project = ${JIRA_PROJECT_KEY} AND reporter = currentUser() ORDER BY created DESC`;
  const issues = [];
  let nextPageToken;
  do {
    const body = { jql, maxResults: 100, fields: ['summary', 'status', 'created'] };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const r = await jira('POST', '/rest/api/3/search/jql', body);
    if (!r.ok) return { ok: false, status: r.status, error: r.json, issues };
    for (const it of (r.json.issues || [])) {
      issues.push({
        key: it.key,
        summary: it.fields.summary || '',
        status: it.fields.status && it.fields.status.name,
        statusCategory: it.fields.status && it.fields.status.statusCategory && it.fields.status.statusCategory.key,
        created: it.fields.created || '',
      });
    }
    nextPageToken = r.json.isLast ? null : r.json.nextPageToken;
  } while (nextPageToken && issues.length < max);
  return { ok: true, issues, capped: Boolean(nextPageToken) };
}

/**
 * list ทุกใบที่บัญชี .env มีสิทธิ์เห็น (ทุก project) เรียงตามวันที่สร้างล่าสุด
 * pagination แบบ cursor: ส่ง pageToken (จากรอบก่อน) เพื่อโหลดหน้าถัดไป
 * คืน { ok, issues, nextPageToken } — nextPageToken=null คือหมดแล้ว
 */
async function listAllVisibleIssues({ pageToken, max = 100 } = {}) {
  // Jira ห้าม JQL ไม่มีเงื่อนไข → bound ด้วย project in (ทุก project ที่เห็นได้)
  const pk = await listProjectKeys();
  if (!pk.ok) return { ok: false, status: pk.status, error: pk.error, issues: [] };
  if (!pk.keys.length) return { ok: true, issues: [], nextPageToken: null };
  const jql = `project in (${pk.keys.map((k) => `"${k}"`).join(',')}) ORDER BY created DESC`;
  const body = { jql, maxResults: max, fields: ['summary', 'status', 'created'] };
  if (pageToken) body.nextPageToken = pageToken;
  const r = await jira('POST', '/rest/api/3/search/jql', body);
  if (!r.ok) return { ok: false, status: r.status, error: r.json, issues: [] };
  const issues = (r.json.issues || []).map((it) => ({
    key: it.key,
    summary: it.fields.summary || '',
    status: it.fields.status && it.fields.status.name,
    statusCategory: it.fields.status && it.fields.status.statusCategory && it.fields.status.statusCategory.key,
    created: it.fields.created || '',
  }));
  return { ok: true, issues, nextPageToken: r.json.isLast ? null : (r.json.nextPageToken || null) };
}

/** list key ของทุก project ที่บัญชี .env เห็นได้ (paginate /project/search) */
async function listProjectKeys() {
  const keys = [];
  let startAt = 0;
  for (;;) {
    const r = await jira('GET', `/rest/api/3/project/search?maxResults=50&startAt=${startAt}`);
    if (!r.ok) return { ok: false, status: r.status, error: r.json, keys };
    for (const p of (r.json.values || [])) if (p.key) keys.push(p.key);
    if (r.json.isLast || !(r.json.values || []).length) break;
    startAt += (r.json.values || []).length;
  }
  return { ok: true, keys };
}

/**
 * เลขล้วน (เช่น 2023) → หาทุกใบที่ลงท้ายเลขนั้นในทุก project ที่เห็นได้
 * ไล่ getIssue ทีละ ${projectKey}-${num} แบบขนาน แล้วเก็บเฉพาะใบที่มีจริง
 * คืน { ok, issues } เรียงตาม project key
 */
async function findIssuesByNumber(num) {
  const pk = await listProjectKeys();
  if (!pk.ok) return { ok: false, status: pk.status, error: pk.error, issues: [] };
  const results = await Promise.all(pk.keys.map(async (k) => {
    const iss = await getIssue(`${k}-${num}`, ['summary', 'status']);
    return iss.ok ? { key: iss.key, summary: iss.summary, status: iss.status, statusCategory: iss.statusCategory } : null;
  }));
  const issues = results.filter(Boolean).sort((a, b) => a.key.localeCompare(b.key));
  return { ok: true, issues };
}

/**
 * reject issue: post comment (ฝังรูป inline ถ้ามี) แล้วย้ายสถานะเป็น "QA REJECT"
 * bodyLines = array บรรทัดสไตล์ description · opts.images = absolute path ของรูป
 * คง comment ที่ post แล้วเสมอ — ถ้าย้ายสถานะไม่ได้ (ไม่มี transition) คืน transitioned:false + transitionError
 * คืน { ok, url, commented, transitioned, transitionError?, imageErrors, statusFrom?, statusTo? }
 */
async function rejectIssue(key, bodyLines, opts = {}) {
  const REJECT_STATUS = 'QA REJECT';
  const c = await addComment(key, bodyLines, { images: opts.images || [] });
  if (!c.ok) return { ok: false, commented: false, error: c.error, status: c.status };

  const t = await getTransitions(key);
  // จับคู่ status ปลายทาง/ชื่อ transition ที่สื่อถึง QA reject — workflow จริงใช้ status "QA Rejected"
  // (transition ชื่อ "rejected") → match แบบ contains กันชื่อไม่ตรงเป๊ะ ("QA REJECT" vs "QA Rejected")
  const norm = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();
  const tr = (t.transitions || []).find((x) => {
    const to = norm(x.to), nm = norm(x.name);
    return to.includes('QAREJECT') || to.includes('REJECT') || nm.includes('REJECT');
  });
  if (!tr) {
    return {
      ok: true, url: `${base}/browse/${key}`, commented: true, transitioned: false,
      transitionError: `ไม่พบ transition ไป "${REJECT_STATUS}" (transition ที่ทำได้ตอนนี้: ${(t.transitions || []).map((x) => x.to).join(', ') || 'ไม่มี'})`,
      imageErrors: c.imageErrors || [],
    };
  }
  const moved = await transitionIssue(key, tr.id);
  return {
    ok: true, url: `${base}/browse/${key}`, commented: true,
    transitioned: moved.ok, transitionError: moved.ok ? undefined : JSON.stringify(moved.error),
    statusTo: tr.to, imageErrors: c.imageErrors || [],
  };
}

module.exports = {
  // config
  ROOT, DRAFTS_DIR, JIRA_PROJECT_KEY, DEFAULT_BUG_EPIC, SPRINT_FIELD, base, envReady,
  // rest
  jira, uploadAttachment, getAttachmentNames, uniqueAttachmentName, getMyself, getComponents, getActiveSprint, getBoardId, getSprints, getEpics, getProjects,
  // retest / reopen
  getIssue, addComment, getTransitions, transitionIssue,
  // qa reject
  listMyReportedIssues, listAllVisibleIssues, listProjectKeys, findIssuesByNumber, rejectIssue,
  // adf
  headerColor, bodyToADF, buildDraftDescriptionADF, bodyLinesToWiki, mediaSingleNode, mediaSinglesToFullWidth, pngSize,
  // attachment type helpers
  isImageFile, docPointerNode, docPointerWikiLine, decodeDataUri, MAX_ATTACH_BYTES,
  // drafts
  parseDraftsMd, writeBackStatus, createDraftIssue, deleteDraft,
  // fuzzy
  dice, resolveComponentFuzzy, parseIssueKey,
  // intake store
  INTAKE_DIR, REJECT_DIR, writeIntake, writeReject, readIntake, readIntakeImages, listIntakes, deleteIntake,
  // prefill url
  buildCreatePrefillUrl, getCreateMeta, createPrefillUrl,
  // dedup
  classifyDuplicates, findDuplicates,
};
