'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const JC = require('../scripts/jira/jira-client');

// dice — Dice bigram similarity (ค่าคงที่ ตรวจได้แน่นอน)
test('dice — เหมือนกันเป๊ะ = 1, ไม่มี bigram ร่วม = 0', () => {
  assert.equal(JC.dice('abc', 'abc'), 1);
  assert.equal(JC.dice('abc', 'xyz'), 0);
});

test('dice — case/ช่องว่างไม่มีผล', () => {
  assert.equal(JC.dice('Data Source', 'datasource'), 1);
});

test('dice — สตริงว่างคืน 0', () => {
  assert.equal(JC.dice('', 'abc'), 0);
  assert.equal(JC.dice('abc', ''), 0);
});

// classifyDuplicates — จัดกลุ่ม SIMILAR/STRONG + ธง strongDup
test('classifyDuplicates — เหมือนเป๊ะ = STRONG + strongDup true', () => {
  const r = JC.classifyDuplicates('ปุ่ม save ค้าง', [
    { key: 'TWA2-1', summary: 'ปุ่ม save ค้าง', status: 'To Do' },
  ]);
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].level, 'STRONG');
  assert.equal(r.candidates[0].score, 1);
  assert.equal(r.strongDup, true);
});

test('classifyDuplicates — คะแนนต่ำกว่า strong = SIMILAR, ไม่ strongDup', () => {
  // night/nacht → dice 0.25 · ตั้ง threshold ให้ผ่าน similar แต่ไม่ถึง strong
  const r = JC.classifyDuplicates('night', [
    { key: 'X-1', summary: 'nacht', status: 'To Do' },
  ], { similar: 0.1, strong: 0.9 });
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].level, 'SIMILAR');
  assert.equal(r.strongDup, false);
});

test('classifyDuplicates — ตัวที่ต่ำกว่า similar ถูกกรองทิ้ง + เรียงคะแนนมาก→น้อย', () => {
  const r = JC.classifyDuplicates('abc', [
    { key: 'A', summary: 'abc', status: 'To Do' }, // 1.0
    { key: 'B', summary: 'abd', status: 'To Do' }, // 0.5
    { key: 'C', summary: 'zzzzz', status: 'To Do' }, // ~0 → ถูกกรอง
  ]);
  assert.deepEqual(r.candidates.map((c) => c.key), ['A', 'B']);
  assert.ok(r.candidates[0].score >= r.candidates[1].score);
  assert.equal(r.strongDup, true);
});

test('classifyDuplicates — ไม่มี candidate = ว่าง + strongDup false', () => {
  const r = JC.classifyDuplicates('anything', []);
  assert.deepEqual(r.candidates, []);
  assert.equal(r.strongDup, false);
});

// resolveComponentFuzzy — จับ component ที่ใกล้สุดเหนือ threshold
test('resolveComponentFuzzy — ชื่อตรงเป๊ะได้ตัวนั้น', () => {
  const comps = [{ id: '1', name: 'Dashboard' }, { id: '2', name: 'Data Source' }];
  assert.deepEqual(JC.resolveComponentFuzzy('Data Source', comps), { id: '2', name: 'Data Source' });
});

test('resolveComponentFuzzy — ไม่มีตัวไหนถึง threshold คืน null', () => {
  const comps = [{ id: '1', name: 'Dashboard' }];
  assert.equal(JC.resolveComponentFuzzy('zzzzzz', comps), null);
});

test('resolveComponentFuzzy — list ว่างคืน null', () => {
  assert.equal(JC.resolveComponentFuzzy('x', []), null);
});
