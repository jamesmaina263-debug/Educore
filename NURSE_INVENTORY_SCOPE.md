# Scoping: Nurse Inventory Workflow (Rectify list item 2)

Status: **design only — not yet built**. Written for review before implementation.

## The ask

> Nurses should be able to manage their own inventory, but with restricted permissions:
> - Stock transfers into the nurse's inventory must originate from the main store/inventory.
> - The nurse's inventory should reflect what has been transferred from the main store.
> - The nurse can only remove/issue stock (e.g., to students) — she cannot add stock directly.
> - Additions must be initiated by the main store; the nurse then accepts the transfer after
>   physically confirming the stock.

## Current state (confirmed by reading the code, not assumed)

- `inventory_items` is flat: one row per item, one `quantity` column, a free-text `location`
  field (not a structured location). There is no concept of "Main Store" vs "Nurse's store" as
  separate stock pools.
- `inventory_stock_movements` is a simple in/out ledger against that single `quantity`.
- The Health module's own inventory screen (`src/components/health/inventory-section.tsx`)
  currently has both a `+In` and a `−Out` adjustment button with no restriction — the Nurse can
  add stock directly today, which is the opposite of what's being asked for.
- There is no transfer-request-and-accept mechanism anywhere in the schema.

This is a real architectural gap, not a small tweak — it needs a genuine multi-location
inventory model.

## Proposed design

### 1. Locations

New table `inventory_locations` (id, school_id, name, kind — `main_store` | `health` | future
kinds). Every school gets a `main_store` row by default; a `health` row is created when the
Health module is set up (or lazily on first use). Modeling this as a real table rather than
hardcoding two locations means a similar pattern (e.g. a boarding house wanting its own small
stock pool later) doesn't need new tables, just a new location row.

### 2. Stock becomes location-scoped, item catalog stays shared

Rather than duplicating item rows per location (which would duplicate name/unit/category
metadata and make "is this the same kind of item at two locations" ambiguous), split the
existing `inventory_items` table into:

- `inventory_items` — the catalog entry itself (name, unit, category, reorder_level). Stays
  mostly as-is; `quantity` and `location` columns are dropped from here.
- `inventory_stock` (new) — `(item_id, location_id, quantity)`, one row per item per location
  it actually exists at. This is the "how much of X is at location Y" ledger. Reorder-level
  alerts (already used on the Dashboard and in Trimora/Educore AI) key off `inventory_items`
  as before, summed across the item's stock rows or scoped to a specific location depending on
  the view.

`inventory_stock_movements` gets a `location_id` column (which location the in/out happened
at) and a nullable `transfer_id` (set when the movement was caused by an accepted transfer,
null for a direct Main Store adjustment) — extends the existing ledger rather than replacing
it, so movement history keeps working.

### 3. Transfers

New table `inventory_transfers`:

| column | notes |
|---|---|
| `item_id`, `quantity_requested` | what Main Store is sending |
| `from_location_id`, `to_location_id` | always Main Store → Health for this feature, but not hardcoded, so the same table works if another location pairing is needed later |
| `status` | `pending` \| `accepted` \| `rejected` |
| `quantity_confirmed` | set on accept — lets the Nurse record what she actually counted, which may differ from what was requested |
| `initiated_by`, `initiated_at` | Main Store staff |
| `accepted_by` / `rejected_by`, `accepted_at` / `rejected_at`, `rejection_reason` | |

A transfer **does not move stock at creation**. Stock only moves when the Nurse accepts it —
a single `accept_inventory_transfer(transfer_id, quantity_confirmed)` SECURITY DEFINER
function that, in one transaction: decrements `inventory_stock` at Main Store, increments (or
creates) the `inventory_stock` row at Health for `quantity_confirmed` (not necessarily the
originally requested quantity — this is the "confirming the stock physically" step), writes
two `inventory_stock_movements` rows (one `out` at Main Store, one `in` at Health, both tagged
with the transfer), and marks the transfer `accepted`. A `reject_inventory_transfer(transfer_id,
reason)` function marks it `rejected` without touching stock at all — nothing was ever removed
from Main Store, so there's nothing to reverse.

### 4. Permissions

- Existing `inventory.write` (Main Store / Inventory Officer): can add/remove stock directly at
  Main Store, can initiate a transfer to Health, can see all locations for oversight.
- New, narrower `inventory.health.issue`: lets the Nurse remove/issue stock from the Health
  location only (the existing `−Out` action, now location-scoped) and accept/reject incoming
  transfers addressed to Health. Deliberately does **not** include any direct-add capability —
  the RLS/RPC layer for "add stock to a location" only accepts writes from
  `accept_inventory_transfer()` (which runs as SECURITY DEFINER, bypassing the normal
  `inventory.write` gate) for any location other than Main Store. A Nurse holding only
  `inventory.health.issue` has no path to add stock to her own location except by accepting a
  transfer — enforced at the RLS/function layer, not just hidden in the UI.
- `health.read_any` (already exists, already granted to the Nurse role) continues to gate
  simply *viewing* the Health location's stock.

### 5. UI changes

- **Main Store (`/inventory`)**: each item gets a "Transfer to Health" action (quantity input →
  creates a `pending` transfer). A new "Transfers" tab shows outgoing transfers and their
  status (pending / accepted with confirmed quantity / rejected with reason).
- **Health (`/health` inventory tab)**: the existing `+In` button is removed entirely. `−Out`
  stays, now scoped to the Health location. A new "Incoming Transfers" panel lists `pending`
  transfers addressed to Health with **Accept** (confirm a quantity, defaulting to what was
  requested but editable) and **Reject** (with a required reason) actions.

## What this touches

New migration (locations, stock-by-location, transfers table, two RPCs, RLS, permission grant),
changes to `inventory_items`/`inventory_stock_movements` consumers wherever they currently read
a flat `quantity` (the main `/inventory` page, the Dashboard's low-stock KPI, the AI's
`low_stock_inventory` intent, Reports if it ever surfaces inventory) — all of those need to
either specify a location or sum across locations, so this is a schema change with several
downstream call sites, not an isolated one. Estimate: a full phase-sized piece of work, not a
quick fix.

## Open question for Lucy before building

Should Main Store's own stock additions (the very first entry of a new item into the system)
also go through some kind of approval, or does Main Store keep unrestricted add/remove as the
ultimate source of truth (as scoped above)? The rectify list only restricts the *Nurse's* side,
so this design assumes Main Store keeps direct add/remove — flagging it explicitly rather than
assuming silently.
