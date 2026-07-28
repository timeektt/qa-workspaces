# Commit convention — QA Workspaces

repo นี้ใช้ **Conventional Commits** — subject สั้น + imperative + body บอก "ทำไม" + footer อ้าง Jira
(อ้างอิง: `agent-data/shared/research/commit-messages-best-practices.md`)

## รูปแบบ

```
type(scope): subject        ← imperative, ≤50 ตัว, ขึ้นด้วยกริยา (Add/Fix/Refactor)

<body — อธิบาย "ทำไม" ไม่ใช่ "อะไร"; wrap ~72 ตัว>   ← optional

Refs <JIRA-KEY>             ← footer, อ้าง issue
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

## type ที่ใช้

| type | ใช้เมื่อ |
|------|---------|
| `feat` | ฟีเจอร์/ความสามารถใหม่ (POM, helper, endpoint, skill) |
| `fix` | แก้บั๊ก / selector เปราะ / flaky |
| `test` | เพิ่ม/แก้เทสต์อย่างเดียว |
| `docs` | เอกสารอย่างเดียว (CLAUDE.md, rules, guide) |
| `chore` | งาน engine/config/deps ที่ไม่เข้าข้ออื่น (jira-client, .env, server) |
| `refactor` | ขยับโครงโดยไม่เปลี่ยนพฤติกรรม |

scope = ส่วนที่แตะ (lowercase): `jira-client` · `qa-workspace` · `dedup` · `routing` · `skill:jira-issue`

## กติกา (สำคัญ)

- **imperative mood เสมอ** — "Fix flaky drop", ไม่ใช่ "Fixed…" / "Fixes…"
- **1 commit = 1 logical change** — บั๊ก 2 ตัว = 2 commits อย่ายัดรวม
- **body ตอบ "ทำไม"** — โค้ด diff บอก "อะไร" อยู่แล้ว; commit เติมเหตุผล/บริบท
  - โดยเฉพาะ selector เปราะ (ไม่มี data-testid + custom dropdown/swal2/cascade) → บอกว่าทำไมต้อง wait/retry แบบนั้น
- **commit เมื่อผู้ใช้สั่งเท่านั้น** (ตาม CLAUDE.md/harness) — ถ้าอยู่บน `main` ให้ branch ก่อน
- **footer ปิดท้ายด้วย `Co-Authored-By: Claude …` เสมอ** (harness requirement)

## ตัวอย่าง

```
fix(routing): guard epic lookup when project key missing

Multi-project cascade เดิม throw ถ้า .env ไม่มี epic ของ project นั้น;
เปลี่ยนเป็น fallback ไป DEFAULT_BUG_EPIC แทนการ crash.

Refs TWA2-230
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

```
test(dedup): add fuzzy-component match case for Thai labels

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```
