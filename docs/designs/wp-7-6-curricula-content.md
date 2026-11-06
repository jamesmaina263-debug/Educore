# WP 7.6: External curricula content (design / decision, nothing to build until content exists)

## What exists today
- Grade scales: PR #795 shipped A*-G and 9-1 presets as DATA with gap/overlap warnings. Schools pick a scale; no external curriculum text is bundled.
- KICD/curriculum content: each school's management imports/publishes its own content (PR #496); Scheme of Work uses the school's own content first, then platform-wide.

## The decision
Curriculum documents (Cambridge IGCSE/A-Level syllabi, Edexcel, IB, American) are copyrighted by their boards. EduCore must not ship or scrape them. Permitted routes:
1. **School-supplied:** the school uploads the syllabus it is licensed to use (exists today via #496; extend the same screen with a "Cambridge / IB / other" label and per-school visibility only).
2. **Licensed:** the owner signs a licence or partnership with a board or publisher; content then ships as platform-wide data.
3. **Own-words topic lists:** EduCore authors short topic outlines in its own words, with no copied text, no copied code tables; each flagged "outline, check your official syllabus". Needs a subject expert reviewer and a legal read.

## Proposed build once the route is chosen
- Route 1 needs only labels and a template (small app PR, one build).
- Routes 2/3 need an import pipeline into the existing curriculum tables (additive, platform-wide rows) and a `source` + `licence` column on content rows for provenance (additive).

## STOP items
- Any licence or copyright decision is the owner's, and anything that copies board text is out.

## Approval question
**Which curricula first (e.g. Cambridge IGCSE, IB), and will schools supply their own licensed syllabi in v1 (route 1)? (name them)**
