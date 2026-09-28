# GTM setup: make the admin funnel rows populate

Container: **GTM-MGV2XHBB**. The site already pushes these events to `dataLayer`; GTM just needs to forward them to GA4.

## Events to forward
| Event name (exact, case-sensitive) | Feeds funnel row |
|---|---|
| Contact CTA Click | CTA Clicks |
| WhatsApp CTA Click | CTA Clicks |
| Email CTA Click | CTA Clicks |
| Trial CTA Click | CTA Clicks |
| Demo Form Started | Demo Form Started |
| Demo Form Contact Step Completed | (not on funnel yet; useful in GA4) |
| Demo Request Submitted | Demo Request Submitted / key event |

## Steps (one tag per event, or one tag for all)

**Option A: single tag (fastest)**
1. GTM > Triggers > New > type **Custom Event**.
   - Event name: `^(Contact CTA Click|WhatsApp CTA Click|Email CTA Click|Trial CTA Click|Demo Form Started|Demo Form Contact Step Completed|Demo Request Submitted)$`
   - Tick **Use regex matching**. Name it `CE - Funnel events`.
2. GTM > Tags > New > **Google Analytics: GA4 Event**.
   - Configuration tag / Measurement ID: your existing GA4 config (same one the page_view uses).
   - Event Name: `{{Event}}` (built-in variable; enable it under Variables > Configure if missing).
   - Optional event parameters: `cta_location` = `{{DLV - cta_location}}`, `cta_label` = `{{DLV - cta_label}}` (Data Layer Variables with those names).
   - Trigger: `CE - Funnel events`.
3. **Preview** the container on your site (Tag Assistant). Click a "Book a Demo" link and focus a form field. Confirm the tag fires for `Contact CTA Click` and `Demo Form Started`.
4. **Submit** the container version, then check GA4 > Admin > DebugView / Realtime for the events.
5. GA4 > Admin > Key events: mark `Demo Request Submitted` (and `sign_up`) as key events.

**Option B:** one tag per event with a plain Custom Event trigger each. Same result, more clicks.

## Caveats
- Consent: the marketing layout sets consent defaults (`ConsentDefaults`). Visitors who decline analytics cookies won't send these events, so GA4 numbers will be lower than real traffic. The database-backed rows (Contact Details Saved, Demo Request Submitted fallback) are not affected.
- GA4 Data API results lag hours behind. Test events may take several hours to show on the admin dashboard.
- The dashboard's "Demo Request Submitted" row prefers the GA4 count and only falls back to the database count if GA4 has none. Once GA4 has the event, the GA4 number (which can undercount) replaces the database one. If you want the database count to always win, change `demoFormSubmitted ?? demoRequestCount` in `admin/analytics/page.tsx` to `demoRequestCount`.
