# Research: การเขียน git commit ที่ดี
Sources: 4 checked (3 usable) | Community: Google Testing Blog, Test Automation University, microsoft/playwright | Updated: 2026-07-28

## TL;DR
Commit ที่ดี = **subject สั้น + imperative mood** (บอกว่า commit นี้ "จะทำอะไร") + **body ที่อธิบาย "ทำไม" ไม่ใช่ "อะไร"** + footer อ้าง issue. ทั้ง official repo (Playwright) และ community เห็นตรงกันเรื่อง Conventional Commits (`type(scope): title`) และ 1 commit = 1 logical change.

## Official Recommendation (microsoft/playwright CONTRIBUTING)
รูปแบบ Semantic/Conventional Commits:
```
label(namespace): title

description (present tense)

footer  → Fixes #123, references #234
```
- label 6 แบบ: `fix` `feat` `docs` `test` `devops` `chore` — [microsoft/playwright]
- namespace = ส่วน/โมดูลที่แตะ (optional, lowercase) — [microsoft/playwright]
- Keep diffs small & readable; แยก PR ใหญ่เป็นหลายใบ; ต้องมี issue อ้างอิง — [microsoft/playwright]

## Community Consensus
- **Imperative mood เสมอ** — ถามตัวเองว่า "commit นี้จะทำอะไรเมื่อ apply?" ("Initialize the project", "Fix flaky login test") — [Test Automation University, GitHub consensus]
  - เข้ากับข้อความที่ git generate เอง (`git merge`, `git revert`)
- **3 ส่วน: Title / Body / Footer** — title สั้น precise ขึ้นต้นตัวใหญ่, body อธิบายเหตุผล, footer อ้าง JIRA/issue — [Test Automation University]
- **ให้ context "ทำไม" มากกว่า "อะไร"** — เช่น commit "Remove dead code" ควรบอกว่า dead code ถูกหาเจอได้ยังไง (tool อะไร) เผื่อ rollback — [Google Testing Blog]
- **1 commit = related changes เดียว** — bug 2 ตัว = 2 commits — [GitHub consensus]
- **ทีมตกลง convention ร่วมกัน + บังคับด้วย commitlint** — [GitHub consensus]

## Key Patterns from the Field
### Conventional Commits `type(scope): subject`
ใช้กันแพร่หลาย (Playwright, Angular ต้นแบบ). ทำให้ generate changelog/semver อัตโนมัติได้.
```
fix(login): retry OTP field when swal2 modal blocks focus
test(checkout): add cascading dropdown selection case
```

### 50/72 rule
subject ≤ 50 ตัวอักษร, body wrap ที่ 72 — อ่านง่ายบน terminal/`git log`.

### Explain the "why" in body
Google Testing Blog: reviewer/คนอ่านอนาคตต้องเข้าใจ **เจตนา** — โค้ดบอก "อะไร" อยู่แล้ว, commit ต้องเติม "ทำไม".

## Common Pitfalls
| Pitfall | พบบ่อย | วิธีแก้ |
|---------|:---:|--------|
| ใช้ past tense ("Fixed bug") | สูง | ใช้ imperative "Fix bug" |
| subject กว้าง ("update", "fix stuff") | สูง | ระบุ scope + สิ่งที่เปลี่ยนจริง |
| ยัดหลายเรื่องใน commit เดียว | สูง | แยกเป็น commit ละ logical change |
| มีแต่ "อะไร" ไม่มี "ทำไม" | กลาง | เติม body อธิบายเหตุผล/บริบท |

## Debates & Trade-offs
- **Squash review fixes vs เก็บ commit ไว้**: ฝั่ง A (Google) squash review-fix ก่อน merge ให้ history สะอาด | ฝั่ง B เก็บไว้เพื่อ trace ประวัติ | **แนะนำ**: squash "fix review comment" ย่อยๆ, แต่แยก logical change ที่คนละเรื่องไว้

## Applied to This Project (qa-workspaces / TWA Playwright E2E)
- ใช้ Conventional Commits: `test(...)` สำหรับเคส E2E, `fix(...)` แก้ selector/flaky, `feat(...)` เพิ่ม POM/helper, `chore(...)` งาน engine/config
- scope ตามโครงโปรเจกต์: `test(checkout)`, `fix(dropdown)`, `feat(pom)`, `chore(jira-client)`
- ไม่มี data-testid + custom dropdown/swal2/cascade → **body ต้องอธิบาย "ทำไม" selector เปราะ** เช่น
  `fix(dropdown): wait for swal2 close before selecting — custom dropdown re-renders on modal dismiss`
- footer อ้าง JIRA key (project ใช้ Jira อยู่แล้ว): `Refs TWA2-230`
- คุม 50/72 + imperative ให้ `git log --oneline` อ่านรู้เรื่อง

## Sources
- [Playwright CONTRIBUTING.md](https://github.com/microsoft/playwright/blob/main/CONTRIBUTING.md) — GitHub official repo
- [Code Health: Providing Context with Commit Messages](https://testing.googleblog.com/2017/09/code-health-providing-context-with.html) — Google Testing Blog
- [Git Tutorial Ch 3.2 — Committing and Pushing](https://testautomationu.applitools.com/git-tutorial/chapter3.2.html) — Test Automation University
- Stack Overflow — blocked (400), ข้ามตามกติกา
