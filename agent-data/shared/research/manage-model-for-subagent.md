# Research: การจัดโมเดล Claude ให้ subagent ใน Claude Code
Sources: Claude Code official docs + Claude API skill | Updated: 2026-07-28

## TL;DR
ตั้งโมเดลให้ subagent ผ่าน field `model:` ใน frontmatter ของ `.claude/agents/*.md` (ใส่ alias `sonnet`/`opus`/`haiku`, full model ID, หรือ `inherit`)
กฎเลือก: งานง่าย/read-only → Haiku + effort low, งาน balance → Sonnet, งานยาก/agentic ยาว → Opus + effort สูง
สำคัญ: **อย่าสลับโมเดลกลาง loop เดียว** (prompt cache หลุด) — ให้ spawn subagent ด้วยโมเดลถูกกว่าแทน

## Official Recommendation

### 1. ตั้งค่าใน frontmatter
```markdown
---
name: code-reviewer
model: sonnet          # alias | full model ID | inherit
effort: high           # low | medium | high | xhigh | max
tools: Read, Grep, Glob
---
Review code for quality issues.
```

**ค่าที่ `model:` รับได้**
- **Alias** (แนะนำ): `sonnet`, `opus`, `haiku`, `inherit` (สืบทอดจาก session แม่)
- **Full model ID** (pin เวอร์ชัน): `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5`, `claude-fable-5`
- alias จะ resolve ไปเป็น tier ล่าสุดที่มีจริงใน catalog (ตอนนี้ opus = Opus 4.8)

### 2. Precedence (สูง→ต่ำ)
1. `model` ที่ subagent frontmatter ระบุ
2. `model` param ตอน spawn (Agent/Task tool / SDK) — override frontmatter ได้
3. ข้อจำกัดระดับ org
4. โมเดลของ session แม่ (ค่า default ถ้าไม่ระบุอะไร)

### 3. Inheritance
- ไม่ใส่ `model:` → subagent ใช้โมเดลเดียวกับ session แม่
- built-in `Explore` มี cap ไม่เกิน Opus (ไม่แพงกว่า session)

### 4. Effort per subagent
- ใส่ `effort:` ใน frontmatter; ถ้าไม่ใส่ = สืบทอดจาก session
- ค่า: `low`/`medium`/`high`/`xhigh`/`max` (Opus 4.8/4.7, Sonnet 5, Fable 5 รองรับครบ; Opus 4.6/Sonnet 4.6 ไม่มี `xhigh`)

## Model catalog + pricing (per 1M tokens)
| โมเดล | Model ID | Input | Output | ใช้กับ subagent แบบไหน |
|---|---|---|---|---|
| Fable 5 | `claude-fable-5` | $10 | $50 | audit/agentic ยาวมาก, ต้องแม่นสุด |
| Opus 4.8 | `claude-opus-4-8` | $5 | $25 | reasoning ยาก, architecture, long-horizon |
| Sonnet 5 | `claude-sonnet-5` | $3 ($2 intro) | $15 ($10 intro) | code review/generate, งานทั่วไป |
| Haiku 4.5 | `claude-haiku-4-5` | $1 | $5 | ค้นโค้ด, parse log, งาน bounded read-only |

## Applied — ตารางเลือกโมเดลตามงาน
| งานของ subagent | โมเดล | เหตุผล |
|---|---|---|
| architecture / reasoning หลายขั้น | opus / fable | จัดการ logic ยาวได้ |
| code review / generate | sonnet | คุ้ม ~3x ถูกกว่า opus |
| ค้น function, extract data, อ่านไฟล์ | haiku | เร็ว/ถูก พอสำหรับงาน bounded |
| deep verify ครั้งเดียว | คงโมเดลเดิม + effort xhigh/max | ใช้ adaptive reasoning แทนสลับโมเดล |

## Caching pitfall (จาก agent-design guide)
- สลับโมเดลกลาง conversation = cache หลุดทั้ง prefix
- ทางแก้: main loop โมเดลเดียว, งานย่อยราคาถูก → spawn subagent โมเดลถูกกว่า
- subagent งานง่ายตั้ง effort `low` → tool call น้อย, preamble สั้น, ประหยัด token

## Sources
- Claude Code — Subagents config: https://code.claude.com/docs/en/sub-agents.md
- Claude Code — Model config (alias/effort/inheritance): https://code.claude.com/docs/en/model-config.md
- Claude Agent SDK — Subagents / AgentDefinition: https://code.claude.com/docs/en/agent-sdk/subagents.md
- Claude API — models overview: https://platform.claude.com/docs/en/about-claude/models/overview
- Claude API skill (bundled) — agent-design.md (caching for agents), models.md
