// node --test scripts/jira/jira-stats-core.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const C = require('./jira-stats-core');

// วันอ้างอิงคงที่: พุธ 19 ส.ค. 2026 (จันทร์ของสัปดาห์ = 17 ส.ค.)
const NOW = Date.parse('2026-08-19T10:00:00');
const ms = (s) => Date.parse(s);

// ---------- buildBuckets ----------

test('buildBuckets week: 7 ถังรายวัน จบที่วันนี้', () => {
  const b = C.buildBuckets('week', NOW);
  assert.equal(b.buckets.length, 7);
  assert.equal(b.buckets[6].label, '19/8');
  assert.equal(b.buckets[0].label, '13/8');
  assert.equal(b.index(ms('2026-08-19T10:00:00')), 6);
  assert.equal(b.index(ms('2026-08-16T12:00:00')), 3);
  assert.equal(b.index(ms('2026-08-12T23:59:59')), -1); // ก่อนหน้าต่าง
  assert.equal(b.index(ms('2026-08-20T00:00:00')), -1); // อนาคต
});

test('buildBuckets month: 4 ถังรายสัปดาห์ (จันทร์)', () => {
  const b = C.buildBuckets('month', NOW);
  assert.equal(b.buckets.length, 4);
  assert.equal(b.buckets[3].label, '17/8'); // จันทร์สัปดาห์นี้
  assert.equal(b.buckets[0].label, '27/7');
  assert.equal(b.index(ms('2026-08-19T00:00:00')), 3);
  assert.equal(b.index(ms('2026-08-10T00:00:00')), 2);
  assert.equal(b.index(ms('2026-07-27T00:00:00')), 0);
  assert.equal(b.index(ms('2026-07-26T23:59:59')), -1);
});

test('buildBuckets quarter: 13 ถังรายสัปดาห์', () => {
  const b = C.buildBuckets('quarter', NOW);
  assert.equal(b.buckets.length, 13);
  assert.equal(b.buckets[12].label, '17/8');
});

test('buildBuckets year: 12 ถังรายเดือน จบเดือนนี้', () => {
  const b = C.buildBuckets('year', NOW);
  assert.equal(b.buckets.length, 12);
  assert.equal(b.buckets[11].label, 'ส.ค.');
  assert.equal(b.buckets[0].label, 'ก.ย. 68'); // ก.ย. 2568
  assert.equal(b.index(ms('2026-08-19T00:00:00')), 11);
  assert.equal(b.index(ms('2025-09-15T00:00:00')), 0);
  assert.equal(b.index(ms('2025-08-31T23:59:59')), -1);
});

// ---------- aggregate ----------

const DONE = new Set(['done', 'closed']);
const opts = { window: 'week', now: NOW, doneSet: DONE };

const P = (id, name) => ({ accountId: id, displayName: name });
const statusHist = (author, when, to) => ({
  author, created: when, items: [{ field: 'status', toString: to }],
});
const assigneeHist = (author, when, fromP, toP) => ({
  author, created: when,
  items: [{ field: 'assignee', from: fromP && fromP.accountId, fromString: fromP && fromP.displayName, to: toP && toP.accountId, toString: toP && toP.displayName }],
});

test('QA.created: นับตาม reporter ลงถังวัน created', () => {
  const issues = [
    { key: 'T-1', fields: { created: '2026-08-19T09:00:00', reporter: P('qa1', 'QA หนึ่ง') }, changelog: { histories: [] } },
    { key: 'T-2', fields: { created: '2026-08-16T09:00:00', reporter: P('qa1', 'QA หนึ่ง') }, changelog: { histories: [] } },
    { key: 'T-3', fields: { created: '2026-08-01T09:00:00', reporter: P('qa2', 'QA สอง') }, changelog: { histories: [] } }, // นอกหน้าต่าง
  ];
  const r = C.aggregate(issues, opts);
  assert.deepEqual(r.groups.qa.created.qa1.values, [0, 0, 0, 1, 0, 0, 1]); // 16/8 = idx3, 19/8 = idx6
  assert.equal(r.groups.qa.created.qa1.name, 'QA หนึ่ง');
  assert.equal(r.groups.qa.created.qa2, undefined); // นอกหน้าต่างไม่โผล่
});

test('QA.rejected + QA.closed: นับตาม author ของ transition', () => {
  const issues = [
    { key: 'T-1', fields: { created: '2026-01-01T00:00:00', reporter: P('qa1', 'QA หนึ่ง') },
      changelog: { histories: [
        statusHist(P('qa1', 'QA หนึ่ง'), '2026-08-19T10:00:00', 'QA Rejected'),
        statusHist(P('qa2', 'QA สอง'), '2026-08-17T10:00:00', 'Done'),
        statusHist(P('qa1', 'QA หนึ่ง'), '2026-08-01T10:00:00', 'Done'), // นอกหน้าต่าง
      ] } },
  ];
  const r = C.aggregate(issues, opts);
  assert.deepEqual(r.groups.qa.rejected.qa1.values, [0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(r.groups.qa.closed.qa2.values, [0, 0, 0, 0, 1, 0, 0]); // 17/8 = idx4
  assert.equal(r.groups.qa.closed.qa1, undefined); // done นอกหน้าต่างไม่นับ
});

test('Dev.assigned: นับตามคนที่ถูกตั้งเป็น assignee', () => {
  const issues = [
    { key: 'T-1', fields: { created: '2026-01-01T00:00:00', reporter: P('qa1', 'QA หนึ่ง'), assignee: P('dev1', 'Dev หนึ่ง') },
      changelog: { histories: [
        assigneeHist(P('qa1', 'QA'), '2026-08-18T10:00:00', null, P('dev1', 'Dev หนึ่ง')),
      ] } },
  ];
  const r = C.aggregate(issues, opts);
  assert.deepEqual(r.groups.dev.assigned.dev1.values, [0, 0, 0, 0, 0, 1, 0]); // 18/8 = idx5
});

test('Dev.rejected: attribute ให้ assignee ณ เวลาที่โดน reject (reconstruct)', () => {
  const issues = [
    { key: 'T-1', fields: { created: '2026-01-01T00:00:00', reporter: P('qa1', 'QA'), assignee: P('dev2', 'Dev สอง') },
      changelog: { histories: [
        // เดิม dev1 → ย้ายเป็น dev2 วันที่ 18, reject เกิด 16 (ตอนนั้นยังเป็น dev1)
        assigneeHist(P('qa1', 'QA'), '2026-08-18T10:00:00', P('dev1', 'Dev หนึ่ง'), P('dev2', 'Dev สอง')),
        statusHist(P('qa1', 'QA'), '2026-08-16T10:00:00', 'QA Rejected'),
      ] } },
  ];
  const r = C.aggregate(issues, opts);
  // reject วันที่ 16 (idx3) ตอนนั้น assignee = dev1
  assert.deepEqual(r.groups.dev.rejected.dev1.values, [0, 0, 0, 1, 0, 0, 0]);
  assert.equal(r.groups.dev.rejected.dev2, undefined);
});
