# Data Protection Impact Assessment: AI tutor, learner questions

**DRAFT for legal review. Not legal advice.** Prepared 6 Nov 2026 from the design in `docs/designs/wp-8-2-part-3-learner-qa.md` and the code on `main`. Items marked **VERIFY** are facts nobody has confirmed from a contract, a console or a lawyer. Statute references are to the Kenya Data Protection Act, 2019 (DPA) and must be checked by counsel.

Each school is the data controller and signs its own copy. EduCore is the processor. A school ticks "DPIA completed" in EduCore only after it has read this, adapted it and signed section 10.

## 1. The processing
A learner (or a parent for their child) types a short question (at most 300 characters) in the learning portal. The system answers only from the class's teacher-approved study guides, using an AI service, or says "ask your teacher". Teachers can see every question and answer. A fixed safeguarding message is shown if the question suggests the child is in danger, and a teacher is shown the message.

| Item | Fact (from the code unless marked) |
|---|---|
| Who can ask | A learner's own account, or a parent/guardian linked to that learner. Nobody else |
| What is stored | The question text (personal details masked), the answer, the guides it cited, a status, a review flag, a timestamp. Which learner and which account asked |
| What is sent to the AI service | The question text and up to 3 approved guide texts. **No learner name, ID, class, school or account details are sent** |
| AI service | Google Gemini API, model `gemini-3.5-flash-lite`. Request is made server-side by EduCore |
| Where stored | Supabase, Frankfurt (eu-central-1). Not in Kenya |
| Retention | 90 days by default (school may set 30 to 365). Hidden at once, deleted on the next save or by a purge function |
| Limits | 10 questions per learner per day (school may set 1 to 30) |
| Audit log | Deliberately NOT written for questions, because the audit log cannot be deleted from |
| Switches | Per-school feature flag; per-school confirmations (safeguarding contact, this DPIA, parent notice); platform-wide kill switch `PLATFORM_AI_DISABLED` |

## 2. Why this is needed, and why it is proportionate
Purpose: help a learner understand material their own teacher has approved, outside lesson time. Less intrusive options considered: (A) no chat, a guide with "check yourself" questions (built in part 2 and offered first); (B) this feature; (C) open chat (rejected). B was chosen by the platform owner. Proportionality rests on: answers limited to approved guides; no identity sent to the AI service; short retention; teacher visibility; a daily limit; a safeguarding path; the ability for a school to switch it off.
**Lawful basis (school to decide with counsel):** options include consent of the parent or guardian given through the notice, or performance of the school's educational function. Because the data subjects are children (s.33), treat parent/guardian involvement as required. **VERIFY with counsel.**

## 3. Roles and contracts
- School: controller. EduCore (Educore Africa, business registration in progress): processor. Google: sub-processor for the AI call.
- **VERIFY:** (a) the Google API terms in force for the key EduCore uses, in particular whether prompts and responses are used to improve Google products or retained. Free-tier keys have in the past been treated differently from paid keys; confirm the tier and the data-use terms in writing. **If prompts can be used for training, do not enable this feature.** (b) A processor agreement between each school and EduCore, listing Google and Supabase as sub-processors. (c) Whether EduCore is registered as a processor with the Office of the Data Protection Commissioner.

## 4. Data protection principles (s.25) checked
| Principle | How met | Gap |
|---|---|---|
| Lawfulness, fairness, transparency | Parent notice; on-screen text tells the child that answers are AI-written, teachers can see questions, and not to type personal details | Notice must actually be sent (owner action) |
| Purpose limitation | Used only to answer from guides and for safeguarding follow-up | None found |
| Data minimisation | No identity sent to AI; personal details blocked and masked; 300-character cap | Free text can still contain things we do not recognise (names are not reliably detectable) |
| Accuracy | Answers limited to approved guides; shown to be AI-written; teacher can read them | AI can still be wrong; the answer is not teacher-approved before the child sees it |
| Storage limitation | 90-day default, enforced in the database | Purge is lazy (on the next save); a scheduled purge job is not yet set up |
| Integrity and confidentiality | Row-level security: a learner or parent sees only their own; staff of the same school see their school; functions locked to service role where internal | Teacher access is school-wide, not class-by-class |
| Accountability | This DPIA, tests, settings audited | Sign-off pending |

## 5. International transfer (ss.48 to 50)
Question text is sent to Google, whose processing location is not confirmed (**VERIFY**), and stored in Frankfurt. This is a cross-border transfer of children's data. Counsel to confirm the safeguard relied on (for example contractual safeguards or adequacy) and whether the school must record consent for the transfer. The existing open item on hosting location under s.50 applies equally here.

## 6. Risks and mitigations
| # | Risk | Likelihood | Severity | Mitigation built | Residual | Action |
|---|---|---|---|---|---|---|
| R1 | A child discloses abuse, self-harm, bullying or violence | Medium | High | Phrase filter (English and Kiswahili) shown before the AI; fixed kind message; flagged to the teacher screen even at the daily limit; contact named in set-up | Medium: no push notification, filter is not complete | Contact checks the screen daily; build a notification (design first) |
| R2 | A child types personal details | High | Medium | Phone, email, ID-like numbers, links and "my name is" are blocked before the AI and masked before storage; the database masks again | Low to medium: names alone are not detectable | Teacher glances at questions; keep the on-screen warning |
| R3 | AI answers from outside the guides, or wrongly, or unsuitably | Medium | Medium | Prompt forbids outside knowledge; an answer must cite a supplied guide or it is replaced by "ask your teacher"; no links, numbers or markup allowed | Medium: the model can still misstate a guide | Run the red-team set before enabling; teacher reviews samples |
| R4 | Prompt injection or jailbreak by a curious learner | Medium | Medium | Question and guides are quoted as data; citation check; output checks | Low to medium | Red-team set, rerun after every prompt change |
| R5 | Children's questions kept too long or seen by the wrong person | Low | High | Retention limit; row-level security; no audit copy; parent sees only own child | Low | Set up a scheduled purge |
| R6 | Data used by the AI provider to train models | **Unknown** | High | None possible in code | **Unknown** | **VERIFY the Google terms before enabling (section 3)** |
| R7 | Data leaves Kenya | Certain | Medium | Contract, minimal data, no identity sent | Medium | Counsel to confirm basis (section 5) |
| R8 | Over-reliance or doing homework by AI | Medium | Low | Prompt gives hints for "check yourself" questions rather than final answers | Low | Teachers set expectations |
| R9 | A family wants their child excluded or their data deleted | Medium | Medium | School can switch the feature off for the whole school | Medium: **no per-child opt-out and no self-serve deletion yet** | Build a per-learner opt-out and a delete function; until then handle by request to EduCore support |
| R10 | Cost or abuse by repeated questions | Low | Low | Daily limit in the database; kill switch | Low | None |
| R11 | Personal data breach | Low | High | Standard platform controls | Low | Follow the school breach procedure (notify the Commissioner within 72 hours where required, s.43; **VERIFY**) |

## 7. Data subject rights
Access, correction, objection and deletion requests go to the school, which asks EduCore support. EduCore can produce or delete a learner's questions on request (manual database action today). **A per-child opt-out in the product is not built yet**; until it is, a parent who objects is handled by asking EduCore to switch off the learner's access, or the school may keep the feature off.

## 8. Consultation
Record here who was consulted: parents' representatives, teachers, the safeguarding contact, the school's lawyer or data protection officer. ______

## 9. Conclusion and conditions
Proceed only if: section 3 **VERIFY** items are resolved in writing (R6 especially); the parent notice (`parent-notice-ai-tutor.md`) has been sent; a safeguarding contact is named and has read `safeguarding-procedure-ai-tutor.md`; the red-team set has been run and recorded; and a pilot class is used first.

## 10. Sign-off (school)
School: ____________  Controller representative: ____________  Date: ________
Safeguarding contact: ____________  Data protection lead or counsel: ____________  Date: ________
Only after this is signed should the owner or principal tick "DPIA completed" on the set-up screen.

## Appendix A: wording for the school's privacy notice
"Our learning portal can answer short study questions from your child's class study guides using an AI service. A question your child types, and the answer, is stored for 90 days, can be read by your child's teachers, and is processed on our behalf by EduCore, which uses Google's AI service. We do not send your child's name or any account details to that service. We ask children not to type personal details. If a message suggests a child may be in danger, a member of staff follows our safeguarding procedure. To ask about, object to, or delete your child's questions, contact the school office." (Counsel to review.)
