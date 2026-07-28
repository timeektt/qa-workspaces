# Subagent model convention — QA Workspaces

เมื่อสร้าง custom subagent ใน `.claude/agents/*.md` ให้เลือก `model:` / `effort:` ตามหลักนี้
(catalog + ราคาเต็มที่ drift ง่าย: `agent-data/shared/research/manage-model-for-subagent.md`)

## ตั้งค่าใน frontmatter

```markdown
---
name: <ชื่อ>
model: sonnet          # alias | full ID | inherit  (ไม่ใส่ = สืบทอด session แม่)
effort: low            # low | medium | high | xhigh | max
tools: Bash, Read      # ให้เฉพาะที่จำเป็น — read-only subagent อย่าให้ Skill/Write
---
```

## เลือกโมเดลตามงาน (default ของ repo นี้)

| งานของ subagent | model | effort | ตัวอย่างในโปรเจกต์ |
|---|---|---|---|
| อ่าน/list/รายงาน (engine ทำ logic หนักแทนแล้ว) | `haiku` หรือ `sonnet` | `low` | สแกน dup, ดึงชื่อไฟล์รูป intake |
| แต่งเนื้อหาภาษาธรรมชาติ / จัดรูปแบบ | `sonnet` | `medium` | เขียน bodyLines จาก failure ดิบ |
| reasoning หลายขั้น / วิเคราะห์ภาพหลายใบ | `opus` | `high`/`xhigh` | วิเคราะห์ screenshot ประกอบ draft |

- **อย่าใช้ `opus`/`fable` กับงานที่ `jira-client.js` ทำ scoring/parsing ให้แล้ว** — จ่ายแพงเปล่า (dice/bigrams/ADF builders รันฝั่ง engine)
- งาน verify ครั้งเดียว → **คงโมเดลเดิม ขยับ `effort` ขึ้น** ดีกว่าสลับไป opus

## กฎที่มองไม่เห็นจาก frontmatter

- **อย่าสลับโมเดลกลาง loop เดียว** → prompt cache หลุดทั้ง prefix. งานย่อยราคาถูกให้ **spawn subagent โมเดลถูกกว่า** แทน (main loop คงโมเดลเดียว)
- **read-only subagent = ไม่มี `Skill`/`Write`/`Edit` ใน tools** — การยิง Jira จริงเป็นของ skill `/jira-issue` ฝั่งเดียวเท่านั้น (สอดคล้อง CLAUDE.md: หน้าเว็บเขียน draft, Claude ยิงจริง)
- **อย่าเพิ่ม subagent เผื่อ** — เพิ่มเมื่อเจอ pain จริง (ช้า/context ล้น/ต้องขนาน) งานหลักตอนนี้ครอบด้วย skill แล้ว (`jira-issue`, `research`, `write-guide`, `wrap-up`)

## alias resolve เป็นอะไร

`opus`/`sonnet`/`haiku` → tier ล่าสุดที่มีจริงใน catalog (ปัจจุบัน opus = Opus 4.8, ไม่มี "Opus 5")
อยาก pin เวอร์ชันแน่นอน → ใช้ full ID (`claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5`)
