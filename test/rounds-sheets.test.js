// test/rounds-sheets.test.js — ตัวต่อ Google Sheet (ยิงจริงไม่ได้ในเทสต์ จึงส่ง fetch ปลอมเข้าไป)
const { test } = require('node:test');
const assert = require('node:assert');
const RS = require('../tools/qa-workspace/server/rounds-sheets.js');
const RStore = require('../tools/qa-workspace/server/rounds-store.js');

const okFetch = (captured, body = { ok: true, rounds: [] }) => async (url, opts) => {
  captured.url = url;
  captured.opts = opts;
  captured.body = JSON.parse(opts.body);
  return { text: async () => JSON.stringify(body) };
};

test('configFromEnv: ตั้งครบทั้ง URL และ token ถึงจะใช้ชีต', () => {
  assert.equal(RS.configFromEnv({ ROUNDS_SHEET_URL: 'https://x/exec', ROUNDS_SHEET_TOKEN: 't' }).url, 'https://x/exec');
  assert.equal(RS.configFromEnv({ ROUNDS_SHEET_URL: 'https://x/exec' }), null);
  assert.equal(RS.configFromEnv({ ROUNDS_SHEET_TOKEN: 't' }), null);
  assert.equal(RS.configFromEnv({}), null);
});

test('call: ส่ง POST JSON พร้อม token และชื่อคำสั่งไปที่ URL ของชีต', async () => {
  const cap = {};
  const cfg = { url: 'https://script.google.com/x/exec', token: 'secret', fetchImpl: okFetch(cap) };
  await RS.addIssue(cfg, 'r1', { key: 'TWA2-1', summary: 'ทดสอบ' });
  assert.equal(cap.url, 'https://script.google.com/x/exec');
  assert.equal(cap.opts.method, 'POST');
  assert.equal(cap.opts.headers['Content-Type'], 'application/json');
  assert.deepEqual(cap.body, { token: 'secret', action: 'addIssue', id: 'r1', key: 'TWA2-1', summary: 'ทดสอบ' });
});

test('readRounds: คืนลิสต์รอบที่ชีตตอบกลับมา', async () => {
  const cfg = { url: 'https://x/exec', token: 't', fetchImpl: okFetch({}, { ok: true, rounds: [{ id: 'r1', issues: [] }] }) };
  assert.deepEqual(await RS.readRounds(cfg), [{ id: 'r1', issues: [] }]);
});

test('readRounds: ชีตตอบ error → throw พร้อมข้อความจากชีต', async () => {
  const cfg = { url: 'https://x/exec', token: 'ผิด', fetchImpl: okFetch({}, { ok: false, error: 'token ไม่ถูกต้อง' }) };
  await assert.rejects(() => RS.readRounds(cfg), /token ไม่ถูกต้อง/);
});

test('call: ได้ HTML กลับมา (deploy ผิดสิทธิ์) → บอกวิธีแก้ ไม่ throw', async () => {
  const cfg = { url: 'https://x/exec', token: 't', fetchImpl: async () => ({ text: async () => '<!DOCTYPE html><html>Sign in</html>' }) };
  const r = await RS.createRound(cfg, { name: 'x', dueDate: '2026-09-15' });
  assert.equal(r.ok, false);
  assert.match(r.error, /Anyone/);
});

test('call: ต่อไม่ได้ → คืน ok:false ไม่ throw', async () => {
  const cfg = { url: 'https://x/exec', token: 't', fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); } };
  const r = await RS.deleteRound(cfg, 'r1');
  assert.equal(r.ok, false);
  assert.match(r.error, /ต่อ Google Sheet ไม่ได้/);
});

test('store: ไม่ตั้ง env = ใช้ไฟล์ · ตั้งครบ = ใช้ชีต', () => {
  assert.equal(RStore.backend({}), 'file');
  assert.equal(RStore.backend({ ROUNDS_SHEET_URL: 'https://x/exec', ROUNDS_SHEET_TOKEN: 't' }), 'sheet');
});

test('store: โหมดไฟล์ยังอ่าน-เขียนไฟล์เดิมได้ (fallback ไม่พัง)', async () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rounds-store-')), 'rounds.json');
  const created = await RStore.createRound(file, { name: 'รอบทดสอบ', dueDate: '2026-09-15' }, {});
  assert.equal(created.ok, true);
  const rounds = await RStore.readRounds(file, {});
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].name, 'รอบทดสอบ');
});
