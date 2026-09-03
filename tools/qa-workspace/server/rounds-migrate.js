#!/usr/bin/env node
// tools/qa-workspace/server/rounds-migrate.js — ย้ายรอบติดตามจากไฟล์ในเครื่องขึ้น Google Sheet (สั่งครั้งเดียว)
//
//   node tools/qa-workspace/server/rounds-migrate.js            # ดูว่าจะย้ายอะไรบ้าง (ไม่เขียนจริง)
//   node tools/qa-workspace/server/rounds-migrate.js --yes      # ย้ายจริง
//
// อ่านค่า ROUNDS_SHEET_URL / ROUNDS_SHEET_TOKEN จาก .env · รอบที่มี id อยู่บนชีตแล้วจะถูกข้าม (สั่งซ้ำได้)
'use strict';

const path = require('path');
const JC = require('../../scripts/jira/jira-client');
const RF = require('./rounds-fs');
const RS = require('./rounds-sheets');

require('dotenv').config({ path: path.join(JC.ROOT, '.env'), override: true, quiet: true });

const ROUNDS_FILE = path.join(JC.DRAFTS_DIR, 'rounds.json');

(async () => {
  const cfg = RS.configFromEnv();
  if (!cfg) {
    console.error('✗ ยังไม่ได้ตั้ง ROUNDS_SHEET_URL และ ROUNDS_SHEET_TOKEN ใน .env');
    console.error('  วิธีสร้างชีตและ deploy: tools/qa-workspace/apps-script/README.md');
    process.exit(1);
  }

  const local = RF.readRounds(ROUNDS_FILE);
  if (!local.length) {
    console.log('ไม่มีรอบในไฟล์เครื่องนี้ให้ย้าย (' + ROUNDS_FILE + ')');
    return;
  }

  let onSheet;
  try {
    onSheet = await RS.readRounds(cfg);
  } catch (e) {
    console.error('✗ ต่อชีตไม่สำเร็จ: ' + e.message);
    process.exit(1);
  }
  const have = new Set(onSheet.map((r) => String(r.id)));
  const todo = local.filter((r) => !have.has(String(r.id)));

  console.log(`ไฟล์ในเครื่องมี ${local.length} รอบ · บนชีตมีแล้ว ${onSheet.length} รอบ · จะย้ายเพิ่ม ${todo.length} รอบ`);
  todo.forEach((r) => console.log(`  • ${r.name} (ครบกำหนด ${r.dueDate}) — ${(r.issues || []).length} ใบ`));
  if (!todo.length) return;

  if (!process.argv.includes('--yes')) {
    console.log('\n(ยังไม่ได้เขียนอะไร — สั่งซ้ำพร้อม --yes เพื่อย้ายจริง)');
    return;
  }

  const r = await RS.importRounds(cfg, todo);
  if (!r.ok) {
    console.error('✗ ย้ายไม่สำเร็จ: ' + (r.error || 'ไม่ทราบสาเหตุ'));
    process.exit(1);
  }
  console.log(`✓ ย้ายขึ้นชีตแล้ว ${r.added} รอบ · ตอนนี้บนชีตมีทั้งหมด ${(r.rounds || []).length} รอบ`);
})();
