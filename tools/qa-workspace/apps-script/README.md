# เก็บข้อมูลแท็บ "ติดตาม issue" บน Google Sheet

ค่าเริ่มต้น แท็บ **ติดตาม issue** เก็บรอบติดตามเป็นไฟล์ในเครื่องของแต่ละคน (`agent-data/jira-drafts/rounds.json`) จึงเห็นกันไม่ได้
ทำตามหน้านี้ครั้งเดียว แล้วทุกคนในทีมจะเห็นรอบเดียวกัน แม้ต่างคนต่างรัน server บนเครื่องตัวเอง

```
เครื่องของแต่ละคน (localhost:3040)  ──POST JSON──►  Apps Script Web App  ──►  Google Sheet
        server.js → rounds-store.js                  (rounds-api.gs)          rounds / round_issues
```

---

## ขั้นตอนติดตั้ง (ทำครั้งเดียว โดยคนใดคนหนึ่งในทีม)

**1. สร้างชีตใหม่** ที่ [sheets.new](https://sheets.new) ตั้งชื่อเช่น `QA — รอบติดตาม issue`
(ไม่ต้องสร้างหัวตารางเอง สคริปต์สร้างแผ่น `rounds` กับ `round_issues` ให้อัตโนมัติ)

**2. เปิดตัวแก้ไขสคริปต์** — เมนู **ส่วนขยาย › Apps Script**

**3. วางโค้ด** — ลบเนื้อหาในไฟล์ `Code.gs` ทิ้ง แล้วคัดลอกทั้งไฟล์ [`rounds-api.gs`](./rounds-api.gs) มาวางแทน

**4. ตั้งรหัสลับของทีม** — แก้บรรทัดบนสุดของสคริปต์
```js
var SHARED_TOKEN = 'ข้อความสุ่มยาว ๆ ของทีม';
```
สร้างค่าสุ่มด้วยคำสั่งนี้ก็ได้ (อย่าใช้คำง่าย ๆ เพราะมันคือสิ่งเดียวที่กันคนนอกเขียนข้อมูล)
```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

**5. กด Deploy** — ปุ่ม **Deploy › New deployment** เลือกชนิด **Web app** แล้วตั้งค่า
- **Execute as:** `Me` (เจ้าของชีต)
- **Who has access:** `Anyone`

กด **Deploy** แล้วอนุญาตสิทธิ์ตามที่ Google ถาม จะได้ URL หน้าตาแบบ
`https://script.google.com/macros/s/AKfy…/exec` — **คัดลอกเก็บไว้**

> **ทำไมต้อง `Anyone`** — server ของเราเรียกจากฝั่ง Node ไม่มีการล็อกอิน Google ถ้าตั้งเป็น
> "ทุกคนในองค์กร" Google จะเด้งหน้าล็อกอินและเราจะได้ HTML กลับมาแทน JSON
> สิ่งที่กันคนนอกจึงเป็น `SHARED_TOKEN` — **ห้ามเอา URL คู่กับ token ไปโพสต์ในที่สาธารณะ**
> (เห็น URL อย่างเดียวเขียนอะไรไม่ได้ เพราะทุกคำขอต้องแนบ token)

**6. แจกให้ทีม** — แต่ละคนใส่ 2 บรรทัดนี้ใน `.env` ของตัวเอง (ไฟล์นี้ไม่ถูก track ใน git)
```
ROUNDS_SHEET_URL=https://script.google.com/macros/s/AKfy…/exec
ROUNDS_SHEET_TOKEN=ค่าเดียวกับ SHARED_TOKEN
```
แล้ว restart server (`node tools/qa-workspace/server.js`) — แท็บติดตาม issue จะขึ้นป้ายว่ากำลังเก็บบน Google Sheet

**7. ย้ายข้อมูลเดิมขึ้นชีต** (ถ้าเคยสร้างรอบไว้ในเครื่องแล้ว — ทำเฉพาะคนที่มีข้อมูลเดิม)
```bash
node tools/qa-workspace/rounds-migrate.js         # ดูก่อนว่าจะย้ายอะไร
node tools/qa-workspace/rounds-migrate.js --yes   # ย้ายจริง
```

---

## แก้โค้ดฝั่งชีตทีหลัง

ไฟล์ [`rounds-api.gs`](./rounds-api.gs) ใน repo คือต้นฉบับ — แก้ที่นี่ก่อน แล้วคัดลอกไปวางทับใน Apps Script
จากนั้นกด **Deploy › Manage deployments › ✏️ › Version: New version › Deploy** (URL เดิมไม่เปลี่ยน จึงไม่ต้องแก้ `.env` ของใคร)

## เก็บข้อมูลอย่างไร

| แผ่น | คอลัมน์ |
|---|---|
| `rounds` | `id` · `name` · `dueDate` (YYYY-MM-DD) · `createdAt` |
| `round_issues` | `round_id` · `issue_key` · `summary` · `addedAt` |

- ทุกคำขอที่เขียนข้อมูลจับ `LockService` ไว้ = คนกดพร้อมกันจะถูกจัดคิวทีละคน ไม่เขียนทับกัน
- แก้ข้อมูลในชีตด้วยมือได้ แต่ **ห้ามลบ/สลับคอลัมน์และห้ามลบแถวหัวตาราง**
- ลบรอบผ่านหน้าเว็บจะลบแถวการ์ดของรอบนั้นให้ด้วย
- ชีตมี **ประวัติเวอร์ชัน** ของ Google อยู่แล้ว (ไฟล์ › ประวัติเวอร์ชัน) ใช้กู้ข้อมูลที่เผลอลบได้

## ถ้ามีปัญหา

| อาการ | สาเหตุที่พบบ่อย |
|---|---|
| หน้าเว็บขึ้น "Google Sheet ตอบกลับมาไม่ใช่ JSON" | Deploy ไม่ได้ตั้ง **Who has access: Anyone** หรือ URL ไม่ได้ลงท้ายด้วย `/exec` |
| ขึ้น "token ไม่ถูกต้อง" | `ROUNDS_SHEET_TOKEN` ใน `.env` ไม่ตรงกับ `SHARED_TOKEN` ในสคริปต์ |
| แก้สคริปต์แล้วไม่มีผล | ยังไม่ได้กด Deploy เวอร์ชันใหม่ (Manage deployments › New version) |
| อยากกลับไปเก็บไฟล์ในเครื่องชั่วคราว | ลบค่า `ROUNDS_SHEET_URL` ใน `.env` แล้ว restart server |
