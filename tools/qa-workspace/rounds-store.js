// tools/qa-workspace/rounds-store.js — ชั้นกลางของข้อมูล "รอบติดตาม issue"
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

async function readRounds(file, env = process.env) {
  const c = cfg(env);
  return c ? RS.readRounds(c) : RF.readRounds(file);
}

async function createRound(file, data, env = process.env) {
  const c = cfg(env);
  return c ? RS.createRound(c, data) : RF.createRound(file, data);
}

async function updateRound(file, id, data, env = process.env) {
  const c = cfg(env);
  return c ? RS.updateRound(c, id, data) : RF.updateRound(file, id, data);
}

async function deleteRound(file, id, env = process.env) {
  const c = cfg(env);
  return c ? RS.deleteRound(c, id) : RF.deleteRound(file, id);
}

async function addIssue(file, id, data, env = process.env) {
  const c = cfg(env);
  return c ? RS.addIssue(c, id, data) : RF.addIssue(file, id, data);
}

async function removeIssue(file, id, key, env = process.env) {
  const c = cfg(env);
  return c ? RS.removeIssue(c, id, key) : RF.removeIssue(file, id, key);
}

module.exports = { backend, readRounds, createRound, updateRound, deleteRound, addIssue, removeIssue };
