# GTM funnel events: status and verification

Container `GTM-MGV2XHBB` (Version 13, live since 2026-09-21) already forwards the site's funnel events to GA4
(property tag `G-ELJYHRD57M`). One GA4 Event tag + one Custom Event trigger exists per event:

| Event (exact name) | Feeds admin funnel row |
|---|---|
| Contact CTA Click / WhatsApp CTA Click / Email CTA Click / Trial CTA Click | CTA Clicks |
| Demo Form Started | Demo Form Started |
| Demo Form Contact Step Completed | (GA4 only; "Contact Details Saved" comes from the database) |
| Demo Request Submitted | Demo Request Submitted / key event |

Do NOT add duplicate tags or triggers for these: it would double-count events.

## Verify after any GTM change
1. GTM > Preview > enter the live site URL.
2. Click a "Book a Demo" link and focus a field in the demo form.
3. In Tag Assistant confirm `Contact CTA Click` and `Demo Form Started` appear, with their GA4 Event tags under "Tags Fired".
4. Submit the container version, then allow several hours for the GA4 Data API to reflect new events.

## Interpreting the admin funnel
- Zeros on low-traffic periods are real, not a bug. Compare with the 30d / 90d range.
- "Contact Details Saved" and the demo request count come from the database and update immediately.
- Visitors who decline cookies send no GA4 events, so GA4 rows undercount.
- The Demo Request Submitted row prefers the GA4 count when present. To always show the database count, change
  `demoFormSubmitted ?? demoRequestCount` to `demoRequestCount` in `src/app/(admin)/admin/analytics/page.tsx`.
