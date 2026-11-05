# WP 8.4: Store apps (Google Play / Apple App Store) (design, not built)

## What exists today
- A PWA with offline queue/caches, web push (8.3, needs VAPID keys) and an offline rollout doc (`docs/OFFLINE_ROLLOUT.md`). Production domain educoreafrica.com.
- The Vercel build budget is tight (see Handover #12 section 0.2); a wrapper project must not trigger production builds of the main app.

## Options
| Option | Android | iOS | Effort | Notes |
|---|---|---|---|---|
| A. Trusted Web Activity (Bubblewrap/PWABuilder) | yes | no | days | Wraps the live PWA; needs `/.well-known/assetlinks.json` on the domain (a `public/` change = one app build); updates are instant (it is the website). |
| B. Capacitor wrapper | yes | yes | 1-2 weeks | Separate repo/project; adds native push (FCM/APNs), file handling; Apple review is stricter: must show real native-feeling value, not just a website. |
| C. Native rewrite | yes | yes | months | Not recommended. |

**Recommendation:** A first (Android is the dominant device in Kenya), B only if iOS demand is real.

## Proposed plan (A)
1. New repo `educore-android` (separate, so no Vercel build is triggered). 2. Generate the TWA, signing key held by the owner (never in chat or the repo). 3. One app PR in the main repo adds `public/.well-known/assetlinks.json` (one build). 4. Internal testing track on Google Play with 5 staff. 5. Store listing text, screenshots, privacy policy URL (the Privacy Policy is still DRAFT pending legal review; Play requires a final one).

## STOP items
- Owner holds the developer account (Google Play one-off fee; Apple annual fee), legal entity registration (business registration is underway, name not final) and the final Privacy Policy/Data Safety form answers (the Supabase eu-central-1 residency question under DPA 2019 s.50 is still open and must be answered truthfully in the form).

## Rollback
Unpublish the listing; the PWA is unaffected.

## Approval question
**Which store first (Google Play or Apple), and who holds the developer account? (name them)**
