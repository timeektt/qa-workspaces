# jira-client API reference

`scripts/jira/jira-client.js` — `const JC = require('./scripts/jira/jira-client')`
config มาจาก `.env` โหลดอัตโนมัติตอน require (dotenv)

## config / helpers
- `JC.envReady()` → boolean — `.env` Jira ครบไหม
- `JC.JIRA_PROJECT_KEY` — project key จาก env
- `JC.DEFAULT_BUG_EPIC` — epic เริ่มต้น (env `JIRA_DEFAULT_EPIC`; ว่าง = ไม่ผูก)
- `JC.base` — base url ที่ตัด `/` ท้ายแล้ว (ใช้ประกอบ `${JC.base}/browse/<key>`)
- `JC.DRAFTS_DIR` — `agent-data/jira-drafts` (absolute)
- `JC.INTAKE_DIR` / `JC.REJECT_DIR` — โฟลเดอร์ intake / reject

## intake store (อ่าน draft ที่ UI เขียน)
- `JC.listIntakes(dir, 'pending')` → `[meta]` เรียง stamp ใหม่→เก่า
- `JC.readIntake(dir, stamp)` → `meta | null`
- `JC.readIntakeImages(dir, stamp)` → `[{name, dataUri}]`
- `JC.deleteIntake(dir, stamp)` → boolean (มี path-traversal guard)

intake meta: `{ stamp, text, type, system, projectKey, component, componentId, epicKey, sprintId, sprintLabel, status, images:[ชื่อไฟล์] }`
(`system` = ชื่อ project ที่โชว์ · `projectKey` = key ปลายทางที่ยิง issue เข้า; ว่าง = ใช้ `JIRA_PROJECT_KEY`)
reject meta: `{ stamp, kind:'reject', issueKey, issueSummary, reason, status, images:[ชื่อไฟล์] }`

## lookups (สำหรับ dropdown / fuzzy)
- `await JC.getMyself()` → `{ok, json:{displayName,...}}`
- `await JC.getComponents(projectKey?)` → `{ok, components:[{id,name}]}` (default projectKey = env)
- `await JC.getEpics(projectKey?)` → `{ok, epics:[{key,summary}]}` (epic ที่ยังไม่ Done)
- `await JC.getActiveSprint(projectKey?)` → `{id,name} | null`
- `await JC.getSprints(projectKey?)` → `{sprints:[{id,name,state}]}`
- `await JC.getProjects()` → `{ok, projects:[{key,name}]}` (project ทั้งหมดที่บัญชีเห็น)
- `JC.resolveComponentFuzzy(name, components, threshold=0.5)` → `{id,name} | null`

## create issue
```js
await JC.createDraftIssue(draft, { projectKey, componentId, epicKey, sprintId, embedInline:true, dryRun:false })
```
- `projectKey` — project ปลายทาง (default = env `JIRA_PROJECT_KEY`) · `DEFAULT_BUG_EPIC` ใช้เป็น default เฉพาะ project หลัก
- `draft = { summary, type:'Bug'|'Improvement', priority:'Medium', bodyLines:[...], images:['intake/<stamp>/<file>'] }`
- `bodyLines` heading = `**Header:**` · bullet = `• ...` · table = `| a | b |` (+ `| --- | --- |` แถว separator)
- คืน `{ key, url, imageErrors }` (สร้างจริง) · `{ dryRun, fields }` (dryRun) · `{ error, status }` (fail)
- `embedInline:true` = มีรูป → ฝัง inline ในคำอธิบาย (attach ก่อน แล้ว PUT wiki v2 `!filename!`)

## dedup ก่อนสร้าง
```js
await JC.findDuplicates(summary)  // → { candidates:[{key,summary,status,score,level:'SIMILAR'|'STRONG'}], strongDup, scanned }
```
ดึง issue ล่าสุด 100 ใบใน project มา Dice similarity บน summary (ไม่พึ่ง text search — tokenize ไทยไม่ได้)
`strongDup` (score ≥ 0.68) = ควรหยุด · SIMILAR (≥ 0.45) = เตือน

## reject การ์ด (comment + ย้ายสถานะ)
```js
await JC.rejectIssue(issueKey, bodyLines, { images:[absolutePath] })
```
- post comment (ฝังรูป inline ถ้ามี) แล้วหา transition ปลายทางที่ contains `QAREJECT`/`REJECT` → ย้าย
- คืน `{ ok, url, commented, transitioned, transitionError?, statusTo?, imageErrors }`
- comment ที่ post แล้วคงอยู่เสมอ; ย้ายไม่ได้ = `transitioned:false` + `transitionError`

## retest / reopen (comment ใบเดิม + ย้ายสถานะเอง)
- `await JC.getIssue(key, fields?)` → `{ok, key, summary, status, priority, issuetype, components, description}`
- `await JC.addComment(key, bodyLines, {images})` → `{ok, id, imageErrors}`
- `await JC.getTransitions(key)` → `{ok, transitions:[{id,name,to}]}`
- `await JC.transitionIssue(key, transitionId)` → `{ok}`
