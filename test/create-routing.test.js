'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const JC = require('../scripts/jira/jira-client');

// createDraftIssue({dryRun:true}) คืน { fields } โดยไม่ยิง network — ตรวจ field ที่ประกอบได้
const draft = { summary: 'ตัวอย่างบั๊ก', type: 'Bug', bodyLines: ['**Details:**', '• x'], images: [] };
const dry = (opts) => JC.createDraftIssue(draft, { ...opts, dryRun: true });

test('routing — projectKey อื่น → issue เข้า project นั้น', async () => {
  const r = await dry({ projectKey: 'CP2' });
  assert.equal(r.fields.project.key, 'CP2');
});

test('routing — ไม่ระบุ projectKey → ใช้ project หลักจาก .env', async () => {
  const r = await dry({});
  assert.equal(r.fields.project.key, JC.JIRA_PROJECT_KEY);
});

test('epic guard — project อื่น + ไม่ระบุ epic → ไม่ผูก parent (default epic เป็นของ project หลัก)', async () => {
  const r = await dry({ projectKey: 'CP2' });
  assert.equal(r.fields.parent, undefined);
});

test('epic guard — project อื่น + ระบุ epicKey เอง → ผูกตามที่ระบุ', async () => {
  const r = await dry({ projectKey: 'CP2', epicKey: 'CP2-9' });
  assert.deepEqual(r.fields.parent, { key: 'CP2-9' });
});

test('epic guard — project หลัก + ไม่ระบุ epic → ใช้ DEFAULT_BUG_EPIC (ถ้าตั้งไว้)', async () => {
  const r = await dry({});
  if (JC.DEFAULT_BUG_EPIC) assert.deepEqual(r.fields.parent, { key: JC.DEFAULT_BUG_EPIC });
  else assert.equal(r.fields.parent, undefined);
});

test('issuetype — Improvement คงเป็น Improvement, อื่นๆ เป็น Bug', async () => {
  const imp = await JC.createDraftIssue({ ...draft, type: 'Improvement' }, { dryRun: true });
  assert.equal(imp.fields.issuetype.name, 'Improvement');
  const bug = await JC.createDraftIssue({ ...draft, type: '' }, { dryRun: true });
  assert.equal(bug.fields.issuetype.name, 'Bug');
});

test('componentId → components field · sprintId → custom field เป็นตัวเลข', async () => {
  const r = await dry({ componentId: '123', sprintId: 456 });
  assert.deepEqual(r.fields.components, [{ id: '123' }]);
  assert.equal(r.fields[JC.SPRINT_FIELD], 456);
});

test('ไม่ระบุ sprint → ไม่มี sprint field (backlog)', async () => {
  const r = await dry({});
  assert.equal(r.fields[JC.SPRINT_FIELD], undefined);
});
