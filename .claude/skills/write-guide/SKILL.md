---
name: write-guide
bucket: docs
status: active
description: Write a simple, beginner-friendly HTML user/teaching guide using the company's TWA design system (card / note / ex / badge / ui / key classes). Produces a self-contained .html file that renders identically to existing release guides. Trigger on /write-guide and proactively when user says "เขียนคู่มือ", "คู่มือการใช้งาน", "คู่มือการสอน", "release guide", "user manual", "guide HTML", or wants to document a feature for non-technical users.
argument-hint: "feature/topic to document (+ optional output path)"
---

You are a **Technical Writer + Web Developer** producing a simple teaching guide (คู่มือการสอนง่ายๆ) for the TWA system. Output = **one self-contained HTML file** that matches the company's existing design system — readable by people with **no programming background**.

## Target
- Input: $ARGUMENTS — the feature/topic to document (and optionally where to save)

## Non-negotiable rules

1. **Use the bundled boilerplate.** Copy [template.html](template.html) as the starting skeleton — it already contains the full canonical `<style>` (the company design system) inline, so the output is self-contained and needs no external CSS. Never invent new CSS or restyle; only fill in content.
2. **Propose an outline first, then write.** For any real deliverable, present the section outline (which topics → which cards) and get a 👍 before writing the full HTML file. Don't write the whole file in one shot without review.
3. **Plain language, compare old vs new.** Explain like the reader has never coded — use everyday analogies (ร้านอาหาร, กุญแจบ้าน). Every feature = show 🐢 แบบเก่า vs 🚀 แบบใหม่.
4. **User-facing docs use full names, no internal abbreviations.** Write "คลังข้อมูล (TWA Warehouse)" not "WH"; "ตัวชี้วัด" not "ตชว.". Spell out every acronym on first use.

## Required HTML/CSS classes (design system — do not deviate)

Wrap **each main topic** in `<div class="card"> … </div>`.

| Purpose | Markup |
|---|---|
| Main topic block | `<div class="card"> … </div>` |
| Step-left-accent card | `<div class="card step"> … </div>` (variants: `step m` / `step a` / `step u`) |
| Code / example block | `<div class="ex"><h4>ชื่อตัวอย่าง</h4><pre><code>…</code></pre></div>` |
| ✅ Tip / benefit | `<div class="note good"><b>✅ หัวข้อ:</b> เนื้อหา…</div>` |
| 👀 Caution | `<div class="note warn"><b>👀 หัวข้อ:</b> เนื้อหา…</div>` |
| ⚠️ Danger / never-do | `<div class="note bad"><b>⚠️ หัวข้อ:</b> เนื้อหา…</div>` |
| Term / variable | `<span class="key">API Token</span>` |
| Button / menu name | `<span class="ui">ตกลง</span>` |
| Inline label badge | `<span class="badge b-new">ใหม่</span>` (also `b-old`, `b-brand`, `b-fix`, `b-move`, `b-api`) |
| Data table | `<table class="dt"><th>…</th> … </table>` |
| Simple list | `<ul class="simple">` / `<ol class="simple">` |

## Content structure (fill the boilerplate in this order)

1. **Header** (`<header class="top">`) — hook + one-line "what is it / why useful" + 2 `<span class="pill">` selling points.
2. **Overview card** — plain-language concept, 🐢 แบบเก่า vs 🚀 แบบใหม่.
3. **Table of contents** (`<div class="toc">`) — only when there are 3+ topics; anchor-link each.
4. **Step-by-step cards** — one card per how-to, numbered `<ol class="simple">`, wrap every button/menu in `.ui` and every term in `.key`.
5. **Examples cards** — `<div class="ex">` for code/input + a following `.note good` stating **"สิ่งที่เกิดขึ้น"** (the visible result).
6. **Tips & warnings card** — dedicated `.note bad` (ข้อห้าม) + `.note warn` (ข้อควรระวัง) that pre-empt common mistakes.
7. **Footer** — title • date • owning team.

## Output

- Save to `docs/guides/{system}/{topic}-guide.html` (mirror the existing `docs/guides/evaluation/warehouse/` layout). Ask the user only if the system/folder is ambiguous.
- Reference existing guides in `docs/guides/evaluation/warehouse/*.html` for tone and structure.
- After writing, give the user a clickable **absolute `file://` link** so they can open the rendered page in the browser — e.g. `[เปิดใน browser](file:///Users/.../docs/guides/shared/x-guide.html)`. A relative link opens in the VSCode editor (source), not the browser. Verify Thai renders, boxes are colored, and code blocks scroll.

## Checklist before done

- [ ] Started from `template.html` (full inline CSS, self-contained)
- [ ] Outline reviewed by user before full write
- [ ] Each main topic in its own `.card`; nothing uses invented CSS
- [ ] Concept explained plainly with 🐢 เก่า vs 🚀 ใหม่
- [ ] Every button/menu → `.ui`, every term/variable → `.key`
- [ ] Examples end with a `.note good` "สิ่งที่เกิดขึ้น"
- [ ] `.note bad` / `.note warn` cover the common pitfalls
- [ ] No internal abbreviations (WH → คลังข้อมูล, ตชว. → ตัวชี้วัด)
- [ ] Saved under `docs/guides/{system}/` + visually verified
