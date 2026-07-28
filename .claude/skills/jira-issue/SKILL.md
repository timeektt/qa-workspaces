---
name: jira-issue
description: ประมวลผล draft ที่หน้า QA Workspace (Create Issue + Jira List) เขียนไว้ แล้วยิงเข้า Jira จริง — intake → สร้าง Bug/Improvement, reject intake → comment + ย้ายสถานะการ์ด. Trigger เมื่อผู้ใช้พิมพ์ "ประมวลผล intake ที่ค้างทั้งหมด", "ประมวลผล reject ที่ค้างทั้งหมด", "เปิด Jira", "create bug", "reject การ์ด" หรือวาง failure ที่ต้องเปิด issue.
---

# jira-issue

หน้า QA Workspace (`tools/qa-workspace/`) เขียนได้แค่ **draft** ลงโฟลเดอร์ `agent-data/jira-drafts/`
สกิลนี้คือ **ฝั่งที่ยิง Jira จริง** — อ่าน draft → สร้าง issue / comment + ย้ายสถานะ → ลบ draft ที่ทำเสร็จ

ทุกอย่างคุยกับ Jira ผ่าน engine `scripts/jira/jira-client.js` (REST + ADF builders + intake store)
config มาจาก `.env` (`JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`)

> วิธีเรียก engine: เขียนสคริปต์ Node สั้นๆ ที่ `require('./scripts/jira/jira-client')` แล้วเรียกฟังก์ชัน (ดู `reference.md` สำหรับ API เต็ม) — อย่าเดา REST เอง

---

## 1. "ประมวลผล intake ที่ค้างทั้งหมด" → สร้าง issue

**Trigger:** ผู้ใช้พิมพ์ "ประมวลผล intake ที่ค้างทั้งหมด" (ปุ่มคัดลอกในแท็บ Create Issue)

ทำ **ทุก** intake ที่ `status: pending` (ไม่ใช่แค่ล่าสุด) — วนทีละใบ:

1. **อ่าน pending intakes** — `JC.listIntakes(JC.INTAKE_DIR, 'pending')` คืน array ของ meta
   แต่ละ meta: `{ stamp, text, type, system, projectKey, component, componentId, epicKey, sprintId, sprintLabel, images:[ชื่อไฟล์] }`
   - `system` = ชื่อ project ที่เลือก (โชว์เฉยๆ) · `projectKey` = key ปลายทางที่ต้องยิง issue เข้า (ว่าง = ใช้ `JC.JIRA_PROJECT_KEY` จาก .env)

2. **แต่ง draft object** จาก `text` ของ intake:
   - `summary` — พาดหัวสั้น กระชับ สื่อปัญหา (≤255 ตัว)
   - `type` — `'Bug'` หรือ `'Improvement'` (ถ้า intake ระบุมาใช้ตามนั้น; ว่าง = เดาจากเนื้อหา: ปัญหา/ผิดพลาด = Bug, ข้อเสนอปรับปรุง = Improvement)
   - `priority` — default `'Medium'`
   - `bodyLines` — array บรรทัดคำอธิบาย ใช้รูปแบบ heading `**Header:**` + bullet `•` + ตาราง `| a | b |`
     - **Bug:** `**Steps to Reproduce:**`, `**Actual Result:**`, `**Expected Result:**`, `**Details:**`
     - **Improvement:** `**Current Behavior:**`, `**Proposed Change:**`, `**Benefit:**`
   - `images` — path ของรูป **relative จาก `agent-data/jira-drafts/`** เช่น `intake/<stamp>/<file>` (ต่อ prefix เอง — meta.images เก็บแค่ชื่อไฟล์)

3. **เช็ค duplicate ก่อนสร้าง** — `await JC.findDuplicates(summary, { projectKey: meta.projectKey || undefined })`
   - **สแกน dup ใน project ปลายทางเดียวกับที่จะสร้าง** (ส่ง `projectKey` ของ intake ไปด้วย; ว่าง = project หลัก)
   - คืน `{ candidates:[{key,summary,status,score,level}], strongDup }`
   - เจอใบใกล้เคียง (SIMILAR/STRONG) → print URL ให้ผู้ใช้เป็น markdown link พร้อม level+score
   - `strongDup === true` (score ≥ 0.68) → **หยุด ไม่สร้าง** แจ้งผู้ใช้ว่าซ้ำกับใบไหน
   - SIMILAR อย่างเดียว → เตือนแต่สร้างต่อได้

4. **สร้าง issue** — `await JC.createDraftIssue(draft, { projectKey, componentId, epicKey, sprintId, embedInline:true })`
   - `projectKey` จาก intake ถ้ามี; ว่าง → default `JC.JIRA_PROJECT_KEY` — **issue จะถูกสร้างเข้า project นี้** (component/epic/sprint ที่ UI เลือกมาก็เป็นของ project เดียวกัน)
   - `componentId` จาก intake ถ้ามี; ว่าง → `JC.resolveComponentFuzzy(name, comps)` (fuzzy match) หรือข้าม
   - `epicKey` จาก intake ถ้ามี; ว่าง → default `JC.DEFAULT_BUG_EPIC` เฉพาะเมื่อ projectKey = project หลัก (project อื่น = ไม่ผูก epic เว้นแต่ intake ระบุมา)
   - `sprintId` จาก intake ถ้ามี; ว่าง = backlog
   - `embedInline:true` = ถ้ามีรูป จะฝัง inline ในคำอธิบาย (upload attachment ก่อน แล้ว PUT คำอธิบายเป็น wiki v2 `!filename!`)
   - คืน `{ key, url, imageErrors }` หรือ `{ error }`

5. **print browse URL** ที่ได้เป็น markdown link กดได้ เช่น `✅ สร้างแล้ว: [ABC-123](<url>)` + สรุปสั้นว่าใช้ type/priority/component/epic/sprint อะไร

6. **ลบ intake ที่สร้างสำเร็จ** — `JC.deleteIntake(JC.INTAKE_DIR, stamp)` (สำเร็จแล้วไม่เก็บค้าง; ถ้า error ตอนสร้าง = อย่าลบ)

---

## 2. "ประมวลผล reject ที่ค้างทั้งหมด" → comment + ย้ายสถานะ

**Trigger:** ผู้ใช้พิมพ์ "ประมวลผล reject ที่ค้างทั้งหมด" (ปุ่มคัดลอกในแท็บ Jira List)

ทำ **ทุก** reject intake ที่ `status: pending` — วนทีละใบ:

1. **อ่าน pending rejects** — `JC.listIntakes(JC.REJECT_DIR, 'pending')`
   แต่ละ meta: `{ stamp, kind:'reject', issueKey, issueSummary, reason, images:[ชื่อไฟล์] }`

2. **แต่ง comment body** (`bodyLines`) จาก `reason` — แยกเป็น 3 หัวข้อให้ dev อ่านง่าย:
   - `**ปัญหาที่พบ:**` — สิ่งที่การ์ดนี้ยังทำไม่ถูก
   - `**ขั้นตอนเกิดปัญหา:**` — reproduce เป็นขั้น (ถ้า reason มีบอก)
   - `**ผลที่คาดหวัง:**` — ควรเป็นยังไงถึงจะผ่าน

3. **comment + ย้ายสถานะ** — `await JC.rejectIssue(issueKey, bodyLines, { images:[absolute path ของรูป] })`
   - post comment (ฝังรูป inline ถ้ามี) แล้วหา transition ที่ปลายทางสื่อถึง "reject" (match แบบ contains: `QAREJECT`/`REJECT`) → ย้ายสถานะ
   - คืน `{ ok, url, commented, transitioned, transitionError?, statusTo?, imageErrors }`
   - **comment ที่ post แล้วคงอยู่เสมอ** — ถ้าย้ายสถานะไม่ได้ (ไม่มี transition ที่เข้าเงื่อนไขจาก status ปัจจุบัน) จะได้ `transitioned:false` + `transitionError` → แจ้งผู้ใช้ว่า comment แล้วแต่ย้ายสถานะไม่ได้ (อาจเพราะการ์ดไม่ได้อยู่สถานะที่ reject ได้)

4. **print ผล** เป็น markdown link + บอกว่าย้ายเป็นสถานะอะไร (หรือย้ายไม่ได้เพราะอะไร)

5. **ลบ reject intake ที่ทำเสร็จ** — `JC.deleteIntake(JC.REJECT_DIR, stamp)` (comment สำเร็จแล้วลบ; comment fail = อย่าลบ)

---

## 3. หลักการทั่วไป

- **path รูป:** `writeIntake`/`writeReject` เก็บรูปเป็นไฟล์ในโฟลเดอร์ stamp + เก็บแค่ชื่อไฟล์ใน `meta.images`
  - intake: absolute = `agent-data/jira-drafts/intake/<stamp>/<file>` · `createDraftIssue` รับ relative จาก `DRAFTS_DIR` (`intake/<stamp>/<file>`)
  - reject: `rejectIssue` รับ **absolute path** ของรูป
- **ลบเมื่อสำเร็จเท่านั้น** — สร้าง/comment ไม่สำเร็จ อย่าลบ draft (ผู้ใช้จะได้แก้แล้วสั่งใหม่)
- **ทุก URL ที่ตอบผู้ใช้ = markdown link กดได้**
- **ทำทีละใบจนครบ** ทุก pending — ไม่ใช่แค่ใบล่าสุด
- ดู `reference.md` สำหรับ signature ของฟังก์ชัน engine ทั้งหมด
