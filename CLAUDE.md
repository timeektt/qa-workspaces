# QA Workspaces — Jira (คู่มือสำหรับ Claude)

repo นี้คือหน้าเว็บภายในทีม QA สำหรับเปิดบั๊กเข้า Jira และ reject การ์ด retest

## สถาปัตยกรรม 2 ฝั่ง

หน้าเว็บ (`tools/qa-workspace/`) เขียนได้แค่ **draft** ลง `agent-data/jira-drafts/`
**Claude คือฝั่งที่ยิง Jira จริง** — เมื่อผู้ใช้สั่ง จะอ่าน draft → สร้าง issue / comment+ย้ายสถานะ → ลบ draft

- ผู้ใช้พิมพ์ **"ประมวลผล intake ที่ค้างทั้งหมด"** → invoke skill `/jira-issue` (ส่วนสร้าง issue)
- ผู้ใช้พิมพ์ **"ประมวลผล reject ที่ค้างทั้งหมด"** → invoke skill `/jira-issue` (ส่วน reject)

รายละเอียดขั้นตอน + API ของ engine อยู่ใน `.claude/skills/jira-issue/SKILL.md` + `reference.md` — **อ่านก่อนประมวลผลทุกครั้ง**

## Engine

ทุกอย่างที่คุยกับ Jira ผ่าน `scripts/jira/jira-client.js` (`require('./scripts/jira/jira-client')`)
config มาจาก `.env` (โหลดอัตโนมัติตอน require) — อย่ายิง REST เอง ใช้ฟังก์ชันของ engine

## กฎ

- **ลบ draft เมื่อสำเร็จเท่านั้น** — สร้าง/comment ไม่สำเร็จ อย่าลบ (ผู้ใช้จะได้แก้แล้วสั่งใหม่)
- **ทุก URL ที่ตอบผู้ใช้ = markdown link กดได้**
- **ทำทุก pending draft** ไม่ใช่แค่ใบล่าสุด
- **แก้ backend** (`server.js` / `jira-client.js`) แล้วต้อง **restart server** ถึงจะมีผล
- **แก้ CSS/JS ฝั่ง browser** — bump `?v=` ที่ `<link>`/`<script>` ใน `index.html` ไม่งั้น browser cache เก่า
- ระบบ TWA-specific ถูกตัดออกแล้ว — skill นี้เป็น generic (project key + epic จาก `.env`) ปรับหัวข้อ Bug/Improvement ตาม project ทีมได้

## รัน server

```bash
npm start          # node tools/qa-workspace/server.js → http://localhost:3060
                   # / = เมนูเลือก workspace · Jira tool อยู่ที่ /index.html
```
