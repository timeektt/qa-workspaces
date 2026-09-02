// tools/qa-workspace/rounds-sheets.js — เก็บ "รอบติดตาม issue" ไว้บน Google Sheet ผ่าน Apps Script Web App
// โค้ดฝั่งชีตอยู่ที่ apps-script/rounds-api.gs (วิธีติดตั้งดู apps-script/README.md)
// ทุกคำสั่งเป็น POST JSON ก้อนเดียว { token, action, ... } → Apps Script จับ LockService ให้แล้ว
// interface ตรงกับ rounds-fs.js ทุกตัว ต่างแค่เป็น async และรับ cfg แทน path ไฟล์
'use strict';

const DEFAULT_TIMEOUT_MS = 20000;

/** อ่านค่าตั้งค่าจาก .env — คืน null ถ้ายังไม่ได้ตั้ง (แปลว่าให้ใช้ไฟล์ในเครื่องแทน) */
function configFromEnv(env = process.env) {
  const url = String(env.ROUNDS_SHEET_URL || '').trim();
  const token = String(env.ROUNDS_SHEET_TOKEN || '').trim();
  if (!url || !token) return null;
  return { url, token };
}

/**
 * ยิงคำสั่งไปที่ Apps Script — คืน object ที่สคริปต์ตอบกลับเสมอ ({ok:true,...} หรือ {ok:false,error})
 * ความผิดพลาดระดับเครือข่าย/หมดเวลา แปลงเป็น {ok:false,error} ให้ caller จัดการเหมือนกรณีอื่น
 */
async function call(cfg, action, payload = {}) {
  const doFetch = cfg.fetchImpl || globalThis.fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const res = await doFetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: cfg.token, action, ...payload }),
      signal: ctrl.signal,
      redirect: 'follow', // Apps Script ตอบ 302 ไป googleusercontent.com เสมอ
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      // ได้ HTML กลับมา = ปกติแปลว่า deployment ตั้งสิทธิ์ให้ต้องล็อกอิน Google ก่อน
      return { ok: false, error: 'Google Sheet ตอบกลับมาไม่ใช่ JSON — ตรวจว่า Deploy เป็น Web app แบบ "Anyone" และ URL ลงท้ายด้วย /exec' };
    }
    return json;
  } catch (e) {
    return {
      ok: false,
      error: e.name === 'AbortError'
        ? 'หมดเวลารอ Google Sheet — ลองใหม่อีกครั้ง'
        : 'ต่อ Google Sheet ไม่ได้: ' + e.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readRounds(cfg) {
  const r = await call(cfg, 'list');
  if (!r.ok) throw new Error(r.error || 'อ่านข้อมูลรอบจาก Google Sheet ไม่สำเร็จ');
  return r.rounds || [];
}

async function createRound(cfg, { name = '', dueDate = '' } = {}) {
  return call(cfg, 'create', { name, dueDate });
}

async function updateRound(cfg, id, { name = '', dueDate = '' } = {}) {
  return call(cfg, 'update', { id, name, dueDate });
}

async function deleteRound(cfg, id) {
  return call(cfg, 'delete', { id });
}

async function addIssue(cfg, id, { key = '', summary = '' } = {}) {
  return call(cfg, 'addIssue', { id, key, summary });
}

async function removeIssue(cfg, id, key) {
  return call(cfg, 'removeIssue', { id, key });
}

/** ย้ายข้อมูลจาก rounds.json เดิมขึ้นชีต (ข้ามรอบที่มีอยู่แล้ว — สั่งซ้ำได้) */
async function importRounds(cfg, rounds) {
  return call(cfg, 'import', { rounds });
}

module.exports = { configFromEnv, call, readRounds, createRound, updateRound, deleteRound, addIssue, removeIssue, importRounds };
