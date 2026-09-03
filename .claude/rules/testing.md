# Testing convention — QA Workspaces

repo นี้ใช้ **`node --test`** (built-in Node 18+) เป็น test runner — **ไม่เพิ่ม dependency**

```bash
npm test          # = node --test → รันทุกไฟล์ใน test/
```

## กติกา (สำคัญ — ไม่เห็นจากไฟล์เทสต์เอง)

- **เทสต์ต้องไม่ยิง Jira จริง** — เขียนได้เฉพาะ:
  - **pure function** (`parseIssueKey`, `dice`, `classifyDuplicates`, `resolveComponentFuzzy`, ADF builders)
  - **`createDraftIssue(..., { dryRun: true })`** — คืน `{ fields }` โดยไม่ยิง network (return ก่อน `fetch`)
- **env-agnostic** — อย่า hardcode ค่าเฉพาะเครื่อง เช่น `TWA2-230` หรือ `TWA2`
  - ใช้ `JC.JIRA_PROJECT_KEY` / `JC.DEFAULT_BUG_EPIC` ในการ assert
  - ค่าที่อาจว่าง (default epic) → assert แบบมีเงื่อนไข: `if (JC.DEFAULT_BUG_EPIC) assert... else assert undefined`
- **ส่วนที่แตะ network** (`jira()`, `getComponents`, `findDuplicates`, `rejectIssue`) — ถ้าจะเทสต์ ให้ stub `global.fetch` (Node 18+ มี `fetch` เป็น global)
- **อย่า `require('../tools/qa-workspace/server/server.js')` ในเทสต์** — มันจะ `server.listen()` ทันทีตอน require (ชน port)
  - logic ที่อยากเทสต์จาก server → ย้ายไป `scripts/jira/jira-client.js` แล้ว export (เช่นที่ทำกับ `parseIssueKey`)

## โครงสร้าง
- ไฟล์เทสต์: `test/<หัวข้อ>.test.js` · ใช้ `node:test` + `node:assert/strict`
- ชุดปัจจุบัน: `parse-issue-key`, `dedup`, `create-routing` (23 เทสต์ — routing/epic-guard multi-project ถูกล็อกไว้แล้ว)
