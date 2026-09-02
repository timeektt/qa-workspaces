// tools/qa-workspace/rounds-fs.js — เก็บ "รอบติดตาม issue" ลง JSON ไฟล์เดียว (Node built-in only)
// โครงไฟล์: { "rounds": [ { id, name, dueDate:"YYYY-MM-DD", createdAt, issues:[{key,summary,addedAt}] } ] }
// เก็บแค่ key + summary — สถานะ (เสร็จ/ยังไม่เสร็จ) ดึงสดจาก Jira ทุกครั้ง ไม่เก็บค้างในไฟล์
const fs = require('fs');
const path = require('path');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const normKey = (k) => String(k || '').trim().toUpperCase();

/** "2026-09-15" → "15/09/2026" (ใช้ตั้งชื่อรอบเริ่มต้น) */
function thaiDate(iso) {
  const [y, m, d] = String(iso).split('-');
  return `${d}/${m}/${y}`;
}

/** อ่านรอบทั้งหมด — ไฟล์หาย/พัง = คืนลิสต์ว่าง (ไม่ throw ให้ server ล้ม) */
function readRounds(file) {
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(json.rounds) ? json.rounds : [];
  } catch {
    return [];
  }
}

function writeRounds(file, rounds) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ rounds }, null, 2), 'utf8');
}

function findRound(rounds, id) {
  return rounds.find((r) => String(r.id) === String(id)) || null;
}

/** สร้างรอบใหม่ — dueDate บังคับ (YYYY-MM-DD) · ไม่ใส่ชื่อ = ตั้งจากวันครบกำหนดให้ */
function createRound(file, { name = '', dueDate = '' } = {}) {
  const due = String(dueDate || '').trim();
  if (!ISO_DATE.test(due)) return { ok: false, error: 'ต้องระบุวันครบกำหนดในรูปแบบ YYYY-MM-DD' };
  const rounds = readRounds(file);
  const round = {
    id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 7),
    name: String(name || '').trim() || `รอบ ${thaiDate(due)}`,
    dueDate: due,
    createdAt: new Date().toISOString(),
    issues: [],
  };
  rounds.unshift(round); // รอบใหม่สุดขึ้นก่อน
  writeRounds(file, rounds);
  return { ok: true, round };
}

/** แก้ชื่อ/วันครบกำหนดของรอบ */
function updateRound(file, id, { name = '', dueDate = '' } = {}) {
  const due = String(dueDate || '').trim();
  if (!ISO_DATE.test(due)) return { ok: false, error: 'ต้องระบุวันครบกำหนดในรูปแบบ YYYY-MM-DD' };
  const rounds = readRounds(file);
  const round = findRound(rounds, id);
  if (!round) return { ok: false, error: 'ไม่พบรอบนี้' };
  round.name = String(name || '').trim() || `รอบ ${thaiDate(due)}`;
  round.dueDate = due;
  writeRounds(file, rounds);
  return { ok: true, round };
}

/** ลบรอบทิ้งถาวร (พร้อมการ์ดทั้งหมดในรอบ) */
function deleteRound(file, id) {
  const rounds = readRounds(file);
  const next = rounds.filter((r) => String(r.id) !== String(id));
  if (next.length === rounds.length) return { ok: false, error: 'ไม่พบรอบนี้' };
  writeRounds(file, next);
  return { ok: true };
}

/** เพิ่มการ์ดเข้ารอบ — key ซ้ำในรอบเดียวกันไม่ได้ (เทียบแบบไม่สนตัวพิมพ์) */
function addIssue(file, id, { key = '', summary = '' } = {}) {
  const k = normKey(key);
  if (!k) return { ok: false, error: 'ต้องระบุ issue key' };
  const rounds = readRounds(file);
  const round = findRound(rounds, id);
  if (!round) return { ok: false, error: 'ไม่พบรอบนี้' };
  if (!Array.isArray(round.issues)) round.issues = [];
  if (round.issues.some((it) => normKey(it.key) === k)) return { ok: false, error: `${k} อยู่ในรอบนี้แล้ว` };
  round.issues.push({ key: k, summary: String(summary || '').trim(), addedAt: new Date().toISOString() });
  writeRounds(file, rounds);
  return { ok: true, round };
}

/** เอาการ์ดออกจากรอบ */
function removeIssue(file, id, key) {
  const k = normKey(key);
  const rounds = readRounds(file);
  const round = findRound(rounds, id);
  if (!round) return { ok: false, error: 'ไม่พบรอบนี้' };
  const before = (round.issues || []).length;
  round.issues = (round.issues || []).filter((it) => normKey(it.key) !== k);
  if (round.issues.length === before) return { ok: false, error: 'ไม่พบการ์ดนี้ในรอบ' };
  writeRounds(file, rounds);
  return { ok: true, round };
}

module.exports = { readRounds, createRound, updateRound, deleteRound, addIssue, removeIssue };
