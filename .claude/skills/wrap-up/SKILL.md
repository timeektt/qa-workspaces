---
name: wrap-up
bucket: productivity
status: active
description: รีวิว session ก่อนปิด — คัดว่ามีอะไรที่ "ควรจดเก็บถาวร" (domain knowledge / feedback / user pref / project state) แล้ว route ไปที่เก็บที่ถูก (.claude/rules ทีมเห็น · auto-memory · handoff) เสนอ user ก่อนเขียนทุกครั้ง. Trigger on /wrap-up and proactively when user says "จบ session", "ปิด session แล้ว", "มีอะไรต้องจดเพิ่มไหม", "จะปิดแล้ว", "wrap up", "สรุป session", หรือก่อนปิดงานตอนท้ายบทสนทนา.
argument-hint: "(optional) ชี้เป้าสิ่งที่อยากให้จด เช่น 'จำเรื่อง selector ปุ่มแนบ'"
---

# Wrap-up — รีวิว session ก่อนปิด ว่ามีอะไรต้องจดเก็บถาวรไหม

แทนการที่ user ต้องพิมพ์เอง **"มีอะไรใน session นี้ต้องจดเพิ่มไหม ผมจะปิด session แล้ว"** ทุกครั้ง.
skill นี้ = ทบทวนบทสนทนาทั้ง session → คัดสิ่งที่ "จะมีค่าใน session/วันหลัง" → **route ไปที่เก็บที่ถูกต้อง** →
เสนอ user เป็นลิสต์ให้ยืนยันก่อนเขียนจริง (ไม่แอบเขียนเงียบ).

**หัวใจ:** ไม่ใช่ "จดทุกอย่าง" แต่ "คัดเฉพาะที่ผ่านเกณฑ์ + วางให้ถูกที่" — ผิดที่ = ทีมไม่เห็น / รก / หลอก session หน้า.

## ต่างจาก /handoff อย่างไร (อย่าสับสน)
| | **/wrap-up** (อันนี้) | **/handoff** |
|---|---|---|
| ขอบเขต | **ทุกชนิด** ที่ควรจด: knowledge, feedback, pref, project state | เฉพาะ "สถานะงานค้าง + วิธีทำต่อ" |
| ตัดสินใจ | คัด + **route หลายปลายทาง** (rules / memory / handoff) | เขียน note เดียวลง auto-memory |
| เมื่อไร | ปิด session / จบบทสนทนา ทบทวนว่าตกหล่นอะไร | จะพักงานที่ทำค้าง มาต่อพรุ่งนี้ |
- ถ้า wrap-up เจอว่ามี "งานค้างที่ต้องทำต่อ" → มันจะ **เรียก/ชี้ไป [handoff](../handoff/SKILL.md)** ไม่เขียน handoff note ซ้ำเอง

## ขั้นตอน

1. **ทบทวนทั้ง session** แล้วดึง "ผู้สมัคร" (candidates) ที่อาจต้องจด — มองหา:
   - **domain knowledge ใหม่**: selector/timing/gotcha/quirk ของระบบ, flow ที่เพิ่งเข้าใจ, ทางที่ลองแล้วไม่เวิร์ก
   - **feedback จาก user**: การแก้/ยืนยันวิธีทำงาน ("อย่าทำ X", "ทำแบบ Y ดีกว่า") + **เหตุผล (why)**
   - **user preference / ตัวตน**: บทบาท, ความชอบ, สไตล์การตอบ
   - **project state**: decision ที่ตกลงกันแล้ว, งานค้าง, constraint ที่ไม่มีในโค้ด/git
   - **reference**: URL / ticket / dashboard ที่จะใช้อีก
2. **กรองด้วย "เกณฑ์ควรจด"** (ดูข้างล่าง) — ตัดตัวที่ derive จาก repo ได้เอง / matter แค่ session นี้ออก
3. **route แต่ละตัวไปปลายทางที่ถูก** (ตารางด้านล่าง — 🔴 กฎเหล็ก: domain knowledge → `.claude/rules/` ไม่ใช่ auto-memory)
4. **เสนอ user เป็นลิสต์** ก่อนเขียน: `[ปลายทาง] สิ่งที่จะจด — เหตุผลสั้นๆ` ต่อบรรทัด + ถามว่าจะเอาอันไหน/แก้/เพิ่ม
5. **เขียนเฉพาะที่ user ยืนยัน** → ทุกไฟล์ auto-memory ต้องเพิ่ม/อัปเดตพอยน์เตอร์ 1 บรรทัดใน `MEMORY.md`
6. ถ้าไม่มีอะไรผ่านเกณฑ์เลย → บอกตรงๆ ว่า "ไม่มีอะไรต้องจดเพิ่ม" (อย่าเค้นจดของไร้ค่า)

## Route ไปที่ไหน — 🔴 เลือกให้ถูก

| candidate ประเภท | ปลายทาง | ทำไม |
|---|---|---|
| **domain knowledge เฉพาะระบบ** (selector/flow/quirk twp/cp2/smd) | `.claude/rules/<sys>-system.md` | ทีมต้องเห็นผ่าน git — **ห้ามลง auto-memory** (CLAUDE.md กฎเหล็ก) |
| **มาตรฐาน/กติกาข้ามระบบ** (capture, report, spec) | `.claude/rules/<rule>.md` ที่เกี่ยว | ของกลาง commit ลง git |
| **feedback วิธีทำงาน + why** | auto-memory `type: feedback` | guidance ส่วนตัวของ session/user นี้ |
| **ตัวตน/ความชอบ user** | auto-memory `type: user` | โปรไฟล์ผู้ใช้ |
| **decision/constraint/งานที่ยังทำอยู่** | auto-memory `type: project` | บริบทที่ไม่อยู่ในโค้ด |
| **งานค้าง + วิธีทำต่อทันที** | → ใช้ [/handoff](../handoff/SKILL.md) | นั่นคือหน้าที่ของ handoff โดยเฉพาะ |
| **URL/ticket/dashboard** | auto-memory `type: reference` | pointer ใช้ซ้ำ |

- auto-memory path + ฟอร์แมต frontmatter → ดูหัวข้อ **Memory** ใน system prompt (1 ไฟล์ = 1 fact + พอยน์เตอร์ใน `MEMORY.md`)
- feedback/project ในเนื้อไฟล์ให้ตามด้วยบรรทัด **Why:** และ **How to apply:** · link ที่เกี่ยวด้วย `[[name]]`

## เกณฑ์ควรจด (ผ่านทั้งคู่ = จด)
✅ **จะมีค่าใน session/วันหลัง** (ไม่ใช่แค่ตอบคำถามรอบนี้จบ) · ✅ **ไม่ derive จาก repo ได้เอง** (โครงโค้ด/fix ที่ commit แล้ว/git log/CLAUDE.md = ไม่ต้องจด)

## กฎเหล็ก
1. **เสนอก่อนเขียนเสมอ** — ลิสต์ให้ user เห็นว่าจะจดอะไร ที่ไหน แล้วค่อยเขียนตามที่ยืนยัน (นี่คือ intent ของ user: ให้ถามแทนพิมพ์เอง)
2. 🔴 **domain knowledge → `.claude/rules/` เท่านั้น ห้าม auto-memory** (ทีมอื่นไม่เห็น) — กฎเหล็ก CLAUDE.md
3. **เช็กซ้ำก่อนสร้างไฟล์ memory** — มีไฟล์เดิมครอบแล้ว → อัปเดตไฟล์นั้น ไม่สร้างซ้ำ · memory ที่พบว่าผิด → ลบ
4. **ห้ามเก็บ credential/token/PII** ทุกปลายทาง
5. **ไม่มีอะไรผ่านเกณฑ์ = พูดตรงๆ** ไม่เค้นจดให้ครบเพื่อดูขยัน

## เกี่ยวข้อง
- [handoff](../handoff/SKILL.md) — งานค้าง + resume (wrap-up route ไปเมื่อเจอสถานะงานค้าง)
- [.claude/rules/README.md](../../rules/README.md) — router ว่า domain knowledge ลง rule ไฟล์ไหน
- หัวข้อ **Memory** ใน system prompt — ฟอร์แมต/ชนิด auto-memory + path

## เป้าที่ user ชี้เพิ่ม
$ARGUMENTS
