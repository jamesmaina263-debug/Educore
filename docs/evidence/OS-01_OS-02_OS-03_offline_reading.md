# OS-01 / OS-02 / OS-03 — Offline reading/caching evidence (GTM Readiness Protocol)

Date: 2026-09-03/04

## OS-01 — Open previously synchronised information without internet
**DoD:** Notices and selected records remain readable in airplane mode.

**Verified in code** (`public/sw.js`): a real service worker precaches the app shell
and caches every visited page navigation network-first in `RUNTIME_CACHE`. On a
failed fetch (offline), the last-cached copy of that exact page is served instead of
the browser's native error page; a genuinely never-visited page falls back to a
branded `/offline.html`. Next's content-hashed static JS/CSS is cached separately,
cache-first, in `STATIC_CACHE` — this is what lets a page served from cache actually
hydrate (become interactive) while offline, not just display static HTML.

**Status:** the infrastructure is real and correctly built, not just scaffolding —
confirmed by reading the actual fetch-handler logic, not just its presence. What I
could **not** do myself: an actual device-level airplane-mode test (no browser/device
tool available in this environment — same limitation as PR-14). Recommend: visit a
few key pages on a phone, enable airplane mode, confirm they still render, and record
that as the closing evidence.

## OS-02 — Keep announcements available after going offline
**DoD:** Previously loaded notices remain visible after closing and reopening the app.

Uses the exact same `RUNTIME_CACHE` mechanism as OS-01. The tracker's evidence row
(audited 2026-08-28) flagged this as depending on "the (thin) announcement feature in
PR-07/PA workstream" maturing first — that dependency is now resolved: PA-01 through
PA-13 (targeted announcements, delivery/read/acknowledged/completed tracking) are live
and tested as of this session. The caching layer needs no separate work for this item
beyond OS-01's own remaining device test.

## OS-03 — Download assignments and attachments for offline access
**DoD:** User can choose and reopen downloaded files offline.

**Before this session:** genuinely not built (confirmed — no "download for offline"
feature anywhere in the codebase). Opening an attachment always required a live
network round-trip: a Server Action to mint a fresh signed Supabase Storage URL, then
fetching that URL. The service worker never touches Storage bucket bytes, only page
navigations — so this DoD was structurally unreachable before now, not just untested.

**Built this session:**
- `src/lib/offline/downloads.ts` — new client-side module: fetches a file once (while
  online, via the existing signed-URL action), stores the bytes in a new IndexedDB
  store (`offline_files`, schema bumped v3→v4 in `db.ts`), and can later reconstruct a
  `blob:` object URL from it with zero network requests.
- Reuses the **same per-device AES-GCM key from OS-10** (`crypto.ts`) to encrypt the
  stored bytes at rest — an assignment/submission attachment can carry the same kind
  of identifiable content as any other offline-cached field, so it gets the same
  treatment, not a weaker one.
- Cleared on logout (`clear-on-logout.ts`), same reasoning as `cached_reads`: it's a
  read cache belonging to the session that chose to save it, not a not-yet-synced
  write, so it does not get `pending_mutations`' preservation treatment.
- Wired into the guardian-facing homework UI (`portal-homework.tsx`): each attachment
  (task file or submission file) now has a "Save offline" action; once saved it's
  labelled "Saved offline" and reopening it works with no network at all. If a file
  was never saved, behavior is unchanged (falls back to the existing live signed-URL
  flow).
- 6 new unit tests (`downloads.test.ts`), all passing: save+reopen round-trip,
  never-downloaded returns `undefined`, **bytes are actually encrypted at rest, not
  stored as plaintext** (asserted directly against the raw IndexedDB record), listing
  without needing to decrypt, removal, and a network-failure path that surfaces an
  error instead of silently storing nothing.
- Full existing offline suite (37 tests across queue/biometric-kiosk/crypto/form-data)
  still passes unchanged after the schema bump — confirmed, not assumed.

**Status:** Ready for Review. Same device-level-test caveat as OS-01: I verified the
mechanism end-to-end in a Node/vitest environment with mocked `fetch`, but a real
phone/browser confirmation (save a file online, go offline, reopen it) would close
this out fully.
