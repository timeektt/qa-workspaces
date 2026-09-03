'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const JC = require('../scripts/jira/jira-client');

// parseIssueKey: input ช่อง search → issue key ตัวใหญ่ · '' = parse ไม่ได้
test('parseIssueKey — key เต็มถูกทำเป็นตัวใหญ่', () => {
  assert.equal(JC.parseIssueKey('twa2-1979'), 'TWA2-1979');
  assert.equal(JC.parseIssueKey('TWA2-1979'), 'TWA2-1979');
});

test('parseIssueKey — ดึง key จาก browse URL', () => {
  assert.equal(JC.parseIssueKey('https://x.atlassian.net/browse/CP2-42'), 'CP2-42');
  assert.equal(JC.parseIssueKey('  https://x.atlassian.net/browse/cp2-42?foo=bar '), 'CP2-42');
});

// เลขล้วนไม่แปลงที่นี่ — เลขเดียวกันมีได้หลาย project ปลายทางจึงเป็นหน้าที่ของ
// endpoint /api/jira/issues ที่เรียก findIssuesByNumber() ไปค้นทุก project แทน
test('parseIssueKey — เลขล้วนคืนสตริงว่าง (endpoint ไปค้นทุก project ต่อเอง)', () => {
  assert.equal(JC.parseIssueKey('1979'), '');
  assert.equal(JC.parseIssueKey('  42  '), '');
});

test('parseIssueKey — trim ช่องว่างหัวท้าย', () => {
  assert.equal(JC.parseIssueKey('  KIS-7  '), 'KIS-7');
});

test('parseIssueKey — input ที่ parse ไม่ได้คืนสตริงว่าง', () => {
  for (const bad of ['', '   ', 'not a key', 'ABC-', '-123', null, undefined]) {
    assert.equal(JC.parseIssueKey(bad), '', `expected '' for ${JSON.stringify(bad)}`);
  }
});
