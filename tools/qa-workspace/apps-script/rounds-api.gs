/**
 * rounds-api.gs — Web App เก็บข้อมูลแท็บ "ติดตาม issue" ของ qa-workspace ลง Google Sheet
 *
 * ที่มา/วิธีติดตั้ง: ดู apps-script/README.md ใน repo (tools/qa-workspace/apps-script/README.md)
 * สรุปสั้น: สร้างชีตใหม่ → ส่วนขยาย > Apps Script → วางไฟล์นี้ทับ Code.gs → ตั้ง SHARED_TOKEN
 *          → Deploy > New deployment > Web app (Execute as: Me · Who has access: Anyone)
 *          → เอา URL กับ token ไปใส่ .env ของทุกคนในทีม
 *
 * โครงข้อมูล (สร้างให้เองอัตโนมัติครั้งแรกที่เรียก):
 *   แผ่น "rounds"        : id | name | dueDate | createdAt
 *   แผ่น "round_issues"  : round_id | issue_key | summary | addedAt
 *
 * ทุกคำขอเป็น POST JSON: { token, action, ... } — คืน { ok: true, ... } หรือ { ok: false, error }
 * การเขียนทุกครั้งจับ LockService ไว้ = คำขอที่เข้ามาพร้อมกันจะถูกจัดคิวทีละอัน ไม่เขียนทับกัน
 */

// 🔴 เปลี่ยนค่านี้เป็นข้อความสุ่มยาวๆ ของทีมก่อน deploy แล้วใส่ค่าเดียวกันใน .env (ROUNDS_SHEET_TOKEN)
var SHARED_TOKEN = 'เปลี่ยนค่านี้ก่อนใช้งาน';

var ROUNDS_SHEET = 'rounds';
var ISSUES_SHEET = 'round_issues';
var ROUNDS_HEADER = ['id', 'name', 'dueDate', 'createdAt'];
var ISSUES_HEADER = ['round_id', 'issue_key', 'summary', 'addedAt'];
var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function doGet() {
  return json({ ok: true, service: 'qa-workspace rounds', note: 'ใช้ POST เท่านั้น' });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json({ ok: false, error: 'อ่าน JSON ของคำขอไม่ได้' });
  }
  if (String(body.token || '') !== SHARED_TOKEN) return json({ ok: false, error: 'token ไม่ถูกต้อง' });

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // คำขออื่นที่เข้ามาพร้อมกันรอคิวตรงนี้ (กันเขียนทับกัน)
  } catch (err) {
    return json({ ok: false, error: 'ระบบกำลังถูกใช้งานพร้อมกัน กรุณาลองใหม่อีกครั้ง' });
  }
  try {
    return json(handle(body));
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  } finally {
    lock.releaseLock();
  }
}

function handle(body) {
  switch (String(body.action || '')) {
    case 'list':        return { ok: true, rounds: readRounds() };
    case 'create':      return createRound(body.name, body.dueDate);
    case 'update':      return updateRound(body.id, body.name, body.dueDate);
    case 'delete':      return deleteRound(body.id);
    case 'addIssue':    return addIssue(body.id, body.key, body.summary);
    case 'removeIssue': return removeIssue(body.id, body.key);
    case 'import':      return importRounds(body.rounds); // ย้ายข้อมูลจากไฟล์เดิมครั้งเดียว
    default:            return { ok: false, error: 'ไม่รู้จักคำสั่ง: ' + body.action };
  }
}

// ---------- ชีต ----------
function sheetOf(name, header) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function rowsOf(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
}

function asText(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v == null ? '' : v);
}

function readRounds() {
  var rSheet = sheetOf(ROUNDS_SHEET, ROUNDS_HEADER);
  var iSheet = sheetOf(ISSUES_SHEET, ISSUES_HEADER);
  var byId = {};
  var out = rowsOf(rSheet).filter(function (r) { return asText(r[0]); }).map(function (r) {
    var round = { id: asText(r[0]), name: asText(r[1]), dueDate: asText(r[2]), createdAt: asText(r[3]), issues: [] };
    byId[round.id] = round;
    return round;
  });
  rowsOf(iSheet).forEach(function (r) {
    var round = byId[asText(r[0])];
    if (round) round.issues.push({ key: asText(r[1]), summary: asText(r[2]), addedAt: asText(r[3]) });
  });
  return out;
}

function findRound(id) {
  var rounds = readRounds();
  for (var i = 0; i < rounds.length; i++) if (rounds[i].id === String(id)) return rounds[i];
  return null;
}

function rowIndexOf(sh, col, value) {
  var rows = rowsOf(sh);
  for (var i = 0; i < rows.length; i++) if (asText(rows[i][col]) === String(value)) return i + 2; // +2 = ข้ามหัวตาราง
  return -1;
}

function thaiDate(iso) {
  var p = String(iso).split('-');
  return p[2] + '/' + p[1] + '/' + p[0];
}

// ---------- คำสั่ง ----------
function createRound(name, dueDate) {
  var due = String(dueDate || '').trim();
  if (!ISO_DATE.test(due)) return { ok: false, error: 'ต้องระบุวันครบกำหนดในรูปแบบ YYYY-MM-DD' };
  var sh = sheetOf(ROUNDS_SHEET, ROUNDS_HEADER);
  var round = {
    id: String(new Date().getTime()) + '-' + Math.random().toString(36).slice(2, 7),
    name: String(name || '').trim() || ('รอบ ' + thaiDate(due)),
    dueDate: due,
    createdAt: new Date().toISOString(),
    issues: [],
  };
  sh.insertRowBefore(2); // แถวใหม่อยู่บนสุด = รอบใหม่สุดขึ้นก่อน (ตรงกับลำดับในหน้าเว็บ)
  sh.getRange(2, 1, 1, ROUNDS_HEADER.length).setValues([[round.id, round.name, "'" + round.dueDate, round.createdAt]]);
  return { ok: true, round: round };
}

function updateRound(id, name, dueDate) {
  var due = String(dueDate || '').trim();
  if (!ISO_DATE.test(due)) return { ok: false, error: 'ต้องระบุวันครบกำหนดในรูปแบบ YYYY-MM-DD' };
  var sh = sheetOf(ROUNDS_SHEET, ROUNDS_HEADER);
  var row = rowIndexOf(sh, 0, id);
  if (row < 0) return { ok: false, error: 'ไม่พบรอบนี้' };
  sh.getRange(row, 2).setValue(String(name || '').trim() || ('รอบ ' + thaiDate(due)));
  sh.getRange(row, 3).setValue("'" + due);
  return { ok: true, round: findRound(id) };
}

function deleteRound(id) {
  var sh = sheetOf(ROUNDS_SHEET, ROUNDS_HEADER);
  var row = rowIndexOf(sh, 0, id);
  if (row < 0) return { ok: false, error: 'ไม่พบรอบนี้' };
  sh.deleteRow(row);
  var iSheet = sheetOf(ISSUES_SHEET, ISSUES_HEADER);
  var rows = rowsOf(iSheet);
  for (var i = rows.length - 1; i >= 0; i--) {                 // ไล่จากล่างขึ้นบน เลขแถวจะได้ไม่เลื่อน
    if (asText(rows[i][0]) === String(id)) iSheet.deleteRow(i + 2);
  }
  return { ok: true };
}

function addIssue(id, key, summary) {
  var k = String(key || '').trim().toUpperCase();
  if (!k) return { ok: false, error: 'ต้องระบุ issue key' };
  var round = findRound(id);
  if (!round) return { ok: false, error: 'ไม่พบรอบนี้' };
  for (var i = 0; i < round.issues.length; i++) {
    if (round.issues[i].key.toUpperCase() === k) return { ok: false, error: k + ' อยู่ในรอบนี้แล้ว' };
  }
  sheetOf(ISSUES_SHEET, ISSUES_HEADER)
    .appendRow([String(id), k, String(summary || '').trim(), new Date().toISOString()]);
  return { ok: true, round: findRound(id) };
}

function removeIssue(id, key) {
  var k = String(key || '').trim().toUpperCase();
  var sh = sheetOf(ISSUES_SHEET, ISSUES_HEADER);
  var rows = rowsOf(sh);
  var removed = false;
  for (var i = rows.length - 1; i >= 0; i--) {
    if (asText(rows[i][0]) === String(id) && asText(rows[i][1]).toUpperCase() === k) { sh.deleteRow(i + 2); removed = true; }
  }
  if (!removed) return { ok: false, error: 'ไม่พบการ์ดนี้ในรอบ' };
  return { ok: true, round: findRound(id) };
}

/** ย้ายข้อมูลจาก rounds.json เดิมเข้าชีต — ข้ามรอบที่มี id ซ้ำอยู่แล้ว (เรียกซ้ำได้ไม่พัง) */
function importRounds(rounds) {
  if (!rounds || !rounds.length) return { ok: false, error: 'ไม่มีข้อมูลให้นำเข้า' };
  var rSheet = sheetOf(ROUNDS_SHEET, ROUNDS_HEADER);
  var iSheet = sheetOf(ISSUES_SHEET, ISSUES_HEADER);
  var existing = {};
  readRounds().forEach(function (r) { existing[r.id] = true; });
  var added = 0;
  rounds.forEach(function (r) {
    if (!r || !r.id || existing[String(r.id)]) return;
    rSheet.appendRow([String(r.id), String(r.name || ''), "'" + String(r.dueDate || ''), String(r.createdAt || '')]);
    (r.issues || []).forEach(function (it) {
      iSheet.appendRow([String(r.id), String(it.key || '').toUpperCase(), String(it.summary || ''), String(it.addedAt || '')]);
    });
    added++;
  });
  return { ok: true, added: added, rounds: readRounds() };
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
