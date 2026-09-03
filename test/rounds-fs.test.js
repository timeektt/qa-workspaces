// test/rounds-fs.test.js — เก็บ "รอบติดตาม issue" (แท็บ ติดตาม issue)
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('../tools/qa-workspace/server/rounds-fs.js');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rounds-fs-'));
  return path.join(dir, 'nested', 'rounds.json'); // nested = ทดสอบว่าสร้างโฟลเดอร์ให้เอง
}

test('readRounds: ไฟล์ยังไม่มี → คืนลิสต์ว่าง ไม่ throw', () => {
  assert.deepEqual(R.readRounds(tmpFile()), []);
});

test('readRounds: ไฟล์พังอ่านไม่ออก → คืนลิสต์ว่าง ไม่ throw', () => {
  const fp = tmpFile();
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, '{ พัง', 'utf8');
  assert.deepEqual(R.readRounds(fp), []);
});

test('createRound: สร้างรอบใหม่ พร้อม id/issues ว่าง แล้วอ่านกลับได้', () => {
  const fp = tmpFile();
  const r = R.createRound(fp, { name: 'รอบแก้ก่อน UAT', dueDate: '2026-09-15' });
  assert.equal(r.ok, true);
  assert.equal(r.round.name, 'รอบแก้ก่อน UAT');
  assert.equal(r.round.dueDate, '2026-09-15');
  assert.deepEqual(r.round.issues, []);
  assert.ok(r.round.id);
  assert.equal(R.readRounds(fp).length, 1);
});

test('createRound: ไม่ใส่ชื่อ → ตั้งชื่อจากวันครบกำหนดให้เอง', () => {
  const r = R.createRound(tmpFile(), { name: '', dueDate: '2026-09-15' });
  assert.equal(r.ok, true);
  assert.equal(r.round.name, 'รอบ 15/09/2026');
});

test('createRound: dueDate ผิดรูปแบบ → error', () => {
  assert.equal(R.createRound(tmpFile(), { name: 'x', dueDate: '15/09/2026' }).ok, false);
  assert.equal(R.createRound(tmpFile(), { name: 'x', dueDate: '' }).ok, false);
});

test('createRound: เรียงรอบใหม่สุดขึ้นก่อน', () => {
  const fp = tmpFile();
  R.createRound(fp, { name: 'เก่า', dueDate: '2026-09-01' });
  R.createRound(fp, { name: 'ใหม่', dueDate: '2026-09-20' });
  assert.deepEqual(R.readRounds(fp).map((x) => x.name), ['ใหม่', 'เก่า']);
});

test('updateRound: แก้ชื่อ/วันครบกำหนดได้ · id ไม่มีจริง → error', () => {
  const fp = tmpFile();
  const id = R.createRound(fp, { name: 'ก', dueDate: '2026-09-15' }).round.id;
  const u = R.updateRound(fp, id, { name: 'ข', dueDate: '2026-10-01' });
  assert.equal(u.ok, true);
  assert.equal(u.round.name, 'ข');
  assert.equal(R.readRounds(fp)[0].dueDate, '2026-10-01');
  assert.equal(R.updateRound(fp, 'ไม่มีจริง', { name: 'ค', dueDate: '2026-10-01' }).ok, false);
});

test('deleteRound: ลบรอบทิ้ง · id ไม่มีจริง → error', () => {
  const fp = tmpFile();
  const id = R.createRound(fp, { name: 'ก', dueDate: '2026-09-15' }).round.id;
  assert.equal(R.deleteRound(fp, id).ok, true);
  assert.equal(R.readRounds(fp).length, 0);
  assert.equal(R.deleteRound(fp, id).ok, false);
});

test('addIssue: เพิ่มการ์ดเข้ารอบ เก็บ key/summary/addedAt', () => {
  const fp = tmpFile();
  const id = R.createRound(fp, { name: 'ก', dueDate: '2026-09-15' }).round.id;
  const a = R.addIssue(fp, id, { key: 'TWA2-1979', summary: 'ปุ่มบันทึกไม่ทำงาน' });
  assert.equal(a.ok, true);
  assert.equal(a.round.issues.length, 1);
  assert.equal(a.round.issues[0].key, 'TWA2-1979');
  assert.equal(a.round.issues[0].summary, 'ปุ่มบันทึกไม่ทำงาน');
  assert.ok(a.round.issues[0].addedAt);
});

test('addIssue: การ์ดซ้ำในรอบเดียวกัน → error ไม่เพิ่มซ้ำ', () => {
  const fp = tmpFile();
  const id = R.createRound(fp, { name: 'ก', dueDate: '2026-09-15' }).round.id;
  R.addIssue(fp, id, { key: 'TWA2-1979', summary: 'x' });
  const dup = R.addIssue(fp, id, { key: 'twa2-1979', summary: 'x' }); // ตัวพิมพ์เล็กก็ถือว่าซ้ำ
  assert.equal(dup.ok, false);
  assert.equal(R.readRounds(fp)[0].issues.length, 1);
});

test('addIssue: ไม่มี key หรือรอบไม่มีจริง → error', () => {
  const fp = tmpFile();
  const id = R.createRound(fp, { name: 'ก', dueDate: '2026-09-15' }).round.id;
  assert.equal(R.addIssue(fp, id, { key: '', summary: 'x' }).ok, false);
  assert.equal(R.addIssue(fp, 'ไม่มีจริง', { key: 'TWA2-1', summary: 'x' }).ok, false);
});

test('removeIssue: เอาการ์ดออกจากรอบ · key ไม่อยู่ในรอบ → error', () => {
  const fp = tmpFile();
  const id = R.createRound(fp, { name: 'ก', dueDate: '2026-09-15' }).round.id;
  R.addIssue(fp, id, { key: 'TWA2-1979', summary: 'x' });
  assert.equal(R.removeIssue(fp, id, 'twa2-1979').ok, true); // case-insensitive
  assert.equal(R.readRounds(fp)[0].issues.length, 0);
  assert.equal(R.removeIssue(fp, id, 'TWA2-1979').ok, false);
});
