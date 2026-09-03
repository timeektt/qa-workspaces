# QA Workspaces — Jira

หน้าเว็บภายในสำหรับทีม QA: เปิดบั๊กเข้า Jira และ reject การ์ดที่ dev ส่งมา retest
มี 2 แท็บ — **Create Issue** (วางข้อความ+รูป → สร้าง issue) และ **Jira List** (ดูการ์ดที่เราสร้าง + reject)

## หลักการทำงาน (สำคัญ)

หน้าเว็บนี้ **ไม่ได้ยิง Jira โดยตรง** — มันเขียนแค่ "draft" ลงโฟลเดอร์ `agent-data/jira-drafts/`
คนที่ยิง Jira จริง (สร้าง issue / comment + ย้ายสถานะ) คือ **Claude** ผ่าน skill `/jira-issue`

```
[หน้าเว็บ]  วางบั๊ก+รูป / กด reject   ─►  เขียน draft ลงโฟลเดอร์
[ผู้ใช้]    กดปุ่มคัดลอกคำสั่ง        ─►  วางให้ Claude
[Claude]   "ประมวลผล Jira intake / reject ที่ค้างทั้งหมด"  ─►  อ่าน draft → ยิง Jira → ลบ draft
```

- แท็บ **Create Issue** → ปุ่ม "ประมวลผล Jira intake ที่ค้างทั้งหมด"
- แท็บ **Jira List** → ปุ่ม "ประมวลผล reject ที่ค้างทั้งหมด"

## ติดตั้ง

```bash
npm install                 # ติดตั้ง dotenv
cp .env.example .env        # แล้วกรอกค่า Jira (ดูด้านล่าง)
npm start                   # เปิด server ที่ http://localhost:3060
```

เปิดเบราว์เซอร์ไปที่ **http://localhost:3060/**

### ค่าใน `.env`

| ตัวแปร | คำอธิบาย |
|--------|---------|
| `JIRA_BASE_URL` | เช่น `https://your-domain.atlassian.net` |
| `JIRA_EMAIL` | อีเมล Atlassian ของบัญชีที่จะเป็น reporter |
| `JIRA_API_TOKEN` | API token ([สร้างที่นี่](https://id.atlassian.com/manage-profile/security/api-tokens)) |
| `JIRA_PROJECT_KEY` | key ของ project เช่น `ABC` |
| `JIRA_DEFAULT_EPIC` | (ไม่บังคับ) epic ที่ผูก issue ใหม่ — ว่าง = ไม่ผูก |
| `JIRA_SPRINT_FIELD` | (ไม่บังคับ) custom field id ของ Sprint — default `customfield_10020` |
| `PORT` | (ไม่บังคับ) default `3060` |

> **Sprint field id** ต่างกันแต่ละ Jira instance — ถ้า sprint ไม่ลงถูก sprint ให้เช็ค id จริงจาก Jira admin แล้วตั้ง `JIRA_SPRINT_FIELD`

## วิธีใช้

**เปิดบั๊กใหม่:**
1. แท็บ Create Issue → เลือก Bug/Improvement → วางรูป (paste) + พิมพ์คำอธิบาย → เลือก component/epic/sprint → **บันทึก intake**
2. กด **📋 คัดลอก "ประมวลผล Jira intake ที่ค้างทั้งหมด"** → วางให้ Claude → Claude สร้าง issue แล้วคืนลิงก์

**Reject การ์ดที่ dev ส่ง retest:**
1. แท็บ Jira List → ค้นหาการ์ด (key/url/เลข) หรือหาจากรายการ → กด **🚫 reject**
2. เขียนเหตุผล (+ รูป) → **บันทึก reject intake**
3. กด **📋 คัดลอก "ประมวลผล reject ที่ค้างทั้งหมด"** → วางให้ Claude → Claude comment + ย้ายสถานะการ์ด

## โครงสร้าง

```
tools/qa-workspace/      หน้าเว็บ + server
  server.js              HTTP server + REST endpoints (/api/jira/*)
  index.html             หน้า Jira (2 แท็บ)
  jira.css               style (dark theme)
  jira-common.js         helper ฝั่ง browser (JCommon: api/esc/dice/…)
  jira-intake.js         แท็บ Create Issue
  jira-reject.js         แท็บ Jira List + reject modal
  bootstrap.js           เรียก init ทั้ง 2 แท็บตอนโหลดหน้า
scripts/jira/
  jira-client.js         engine — Jira REST + ADF builders + intake store
.claude/skills/jira-issue/  skill ที่ Claude ใช้ประมวลผล draft
agent-data/jira-drafts/  draft ที่ยังไม่ประมวลผล (gitignored)
```

## ต้องมี Claude Code

skill `/jira-issue` รันบน [Claude Code](https://claude.com/claude-code) — ทีมต้องมี Claude Code เปิดใน repo นี้เพื่อประมวลผล draft
รายละเอียดกลไกฝั่ง Claude อยู่ใน `CLAUDE.md` + `.claude/skills/jira-issue/`
