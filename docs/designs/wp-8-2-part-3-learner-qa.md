# WP 8.2 part 3: learner question-and-answer (audit of parts 1-2 + child-safety review; NOT built)

## 0. Why this is a document and not a PR
Part 3/3 was recorded in #811 as "optional learner question-and-answer, which needs a child-safety review first". It lets a child type free text to an AI. That is the highest-risk feature in the backlog, and there is no definition of "safe enough" yet. This document is the review and the options, with one question for the owner. Nothing was built.

## 1. Audit of parts 1-2 (read from `main` on 6 Nov 2026; live state read from the production database)

**Live state:** `feature.learning.ai_tutor` is ON for 19 of 21 schools and `feature.learning.portal` for 18 (both switched on 3-4 Nov). The earlier ledger said "off everywhere"; that is stale. **No draft and no AI request exists yet** (`tutor_drafts` 0, `tutor_ai_requests` 0), so nothing has run for real.

**What is solid:** teacher-only generation; grounding enforced in SQL (1-20 published notes of the same school/class/subject, sources snapshotted); a source that is later unpublished, deleted or edited hides the guide and blocks approval; learners see only approved drafts (RLS); edits only while in draft; approve re-checks sources; output is plain text only; notes are treated as data in the prompt; every generation is audited with tokens and outcome; `PLATFORM_AI_DISABLED` kill switch; 15/hour/teacher rate limit; 9 unit tests + SQL test.

**Findings (none blocks parts 1-2 staying on; ordered by weight):**
1. **Grounding is an instruction, not a proof.** The check proves every cited note id was one we supplied. It does not prove each claim comes from the notes, and citations are by title. The teacher's read-through before approval is the real control. *Suggested fix (small, app code):* show the teacher a clear "read every line before approving" prompt and the list of notes it cites next to the Approve button. Do not treat approval as a formality in training.
2. **Notes go to a third-party AI outside Kenya.** Teacher notes are sent to Gemini. Notes normally contain no personal data, but nothing stops a teacher pasting a learner's name. Under the Data Protection Act 2019 this is a cross-border transfer; the draft Privacy Policy must name the AI provider and the purpose, and the Supabase eu-central-1 residency question (s.50) is still open. *Owner/legal item, not a code defect.*
3. **Rate limit fails open** if the admin client is not configured (the `catch` lets the request through). Low: the request is still permission-checked and idempotency-claimed. *Fix when next editing the file.*
4. **A request that crashes between claim and finish stays "pending".** Harmless (a new key works) but it will look odd in the audit table. Low.
5. **Any user with `academics.write` can edit and approve another teacher's draft** (by design). Confirm that is intended for a head of department; otherwise restrict to author.

## 2. Child-safety review for part 3 (a child typing to an AI)

**Risks:** (a) the model answers from outside the notes and is wrong or unsuitable for the age; (b) a child discloses something serious (abuse, self-harm, bullying) and nobody sees it; (c) a child types personal data (name, school, address, phone) that is then sent to a third party; (d) prompt injection or jailbreak by a curious learner; (e) inappropriate output; (f) over-reliance / homework cheating; (g) retention of children's conversations; (h) cost abuse.

**Legal frame:** Kenya DPA 2019 treats children's data as needing a lawful basis with parent/guardian involvement and a data-protection impact assessment for new high-risk processing; learner questions would be children's personal data sent cross-border. The school (not EduCore) is the controller, so each school must be able to switch it off and to point to its own notice.

## 3. Options

| Option | What the child can do | AI sees child's text? | Risk |
|---|---|---|---|
| **A. No chat (recommended first)** | Open an approved guide; tap "Check yourself" questions; the teacher supplies or approves model answers (no AI at read time) | No | Lowest; fully covered by the teacher-approval gate already built |
| **B. Guide-only Q&A** | Type a question; answer is built ONLY from the approved guide(s) of their own class; if not covered the reply is a fixed "ask your teacher" message | Yes | Medium; needs everything in section 4 |
| **C. Open Q&A** | Free chat | Yes | High; not recommended |

## 4. Minimum requirements for Option B (all must hold before any child uses it)
1. Separate flag `feature.learning.ai_tutor_qa`, **off by default**, per school; needs the school owner's written yes; first run on ONE test class with staff-supervised learners.
2. Answers are generated only from the learner's own class's **approved** guides (same RLS rule), must quote or cite them, and otherwise return the fixed fallback. No outside knowledge. Reject any answer whose cited ids are not among those supplied.
3. **Input filter before the model:** block or mask phone numbers, emails, addresses and obvious names; a blocked question is not sent anywhere.
4. **Safeguarding path:** a small fixed-keyword and classifier check for self-harm, abuse, bullying, violence; on a hit the child gets a fixed, kind message pointing to a trusted adult, the question is NOT answered by the AI, and a flag goes to the school's designated safeguarding person using the existing safeguarding module (no new notification channel; design with the school first).
5. **Teacher visibility:** every question and answer stored and visible to the class teacher; the learner is told this on screen. Retention 90 days then deleted (owner to confirm).
6. Rate limits per learner (e.g. 10 questions/day) and per school; `PLATFORM_AI_DISABLED` kill switch applies; per-request audit exactly like part 2.
7. Output length cap, plain text only, reading-level instruction, refusal of requests to do homework answers outright ("check yourself" style hints instead).
8. A written **red-team set** (jailbreaks, off-topic, rude, personal data, self-harm phrasing, Kiswahili and Sheng) run before launch and after every prompt change; results kept in the repo.
9. A DPIA and a privacy-notice update naming the AI provider, signed off by the owner (and ideally a lawyer) **before** the flag can be enabled for any school.
10. Parent/guardian notice (and consent where the school requires it) before a child's questions are processed.

## 5. Recommended path
1. Build Option A now if wanted: no AI at read time, no new risk (small app change).
2. Do NOT build Option B until the owner answers the question below and items 4.4, 4.9 and 4.10 have a named owner.
3. If approved, build Option B dark in this order: database (flag, tables with RLS, audit; free), edge function with filters and safeguarding (free), then one app PR (one build), then the red-team run, then one test class.

## 6. Rollback
Flag `feature.learning.ai_tutor_qa` off (never created yet); parts 1-2 are unaffected and stay controlled by `feature.learning.ai_tutor`.

## 7. Approval question
**Build Option A (guide self-check, no AI chat) now, and treat Option B as blocked until a safeguarding owner, DPIA and parent notice exist? (yes / no)**
