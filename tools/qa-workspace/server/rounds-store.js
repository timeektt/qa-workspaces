// tools/qa-workspace/server/rounds-store.js — ชั้นกลางของข้อมูล "รอบติดตาม issue"
// เลือกที่เก็บจาก .env: ตั้ง ROUNDS_SHEET_URL + ROUNDS_SHEET_TOKEN = เก็บบน Google Sheet (ทีมเห็นร่วมกัน)
//                        ไม่ตั้ง = เก็บไฟล์ agent-data/jira-drafts/rounds.json ในเครื่องเหมือนเดิม
// ทุกฟังก์ชันเป็น async เพื่อให้ route ฝั่ง server เรียกแบบเดียวกันไม่ว่าเก็บที่ไหน
'use strict';

const RF = require('./rounds-fs');
const RS = require('./rounds-sheets');

/** 'sheet' เมื่อ .env ตั้งค่าครบ · 'file' เมื่อยังไม่ตั้ง (อ่าน env สดทุกครั้ง — server reload .env ระหว่างรันได้) */
function backend(env = process.env) {
  return RS.configFromEnv(env) ? 'sheet' : 'file';
}

function cfg(env = process.env) {
  return RS.configFromEnv(env);
}

// แคชสั้นๆ เฉพาะโหมดชีต — หนึ่งหน้าจอเรียกอ่านรอบติดๆ กัน 2 ครั้ง (รายการรอบ + สถานะ)
// ทั้งที่ Apps Script ตอบครั้งละ ~2.5 วินาที · ล้างแคชทุกครั้งที่มีการเขียน จึงไม่เห็นข้อมูลเก่าหลังกดแก้เอง
const CACHE_MS = 10000;
let cache = { at: 0, rounds: null };
const invalidate = () => { cache = { at: 0, rounds: null }; };

async function readRounds(file, env = process.env) {
  const c = cfg(env);
  if (!c) return RF.readRounds(file);
  if (cache.rounds && Date.now() - cache.at < CACHE_MS) return cache.rounds;
  const rounds = await RS.readRounds(c);
  cache = { at: Date.now(), rounds };
  return rounds;
}

async function createRound(file, data, env = process.env) {
  const c = cfg(env);
  if (c) { invalidate(); return RS.createRound(c, data); }
  return RF.createRound(file, data);
}

async function updateRound(file, id, data, env = process.env) {
  const c = cfg(env);
  if (c) { invalidate(); return RS.updateRound(c, id, data); }
  return RF.updateRound(file, id, data);
}

async function deleteRound(file, id, env = process.env) {
  const c = cfg(env);
  if (c) { invalidate(); return RS.deleteRound(c, id); }
  return RF.deleteRound(file, id);
}

async function addIssue(file, id, data, env = process.env) {
  const c = cfg(env);
  if (c) { invalidate(); return RS.addIssue(c, id, data); }
  return RF.addIssue(file, id, data);
}

async function removeIssue(file, id, key, env = process.env) {
  const c = cfg(env);
  if (c) { invalidate(); return RS.removeIssue(c, id, key); }
  return RF.removeIssue(file, id, key);
}

module.exports = { backend, invalidate, readRounds, createRound, updateRound, deleteRound, addIssue, removeIssue };
