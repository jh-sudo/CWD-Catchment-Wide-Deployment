Type: feature
Status: done — per-sector subscription and lightning-auto-enabled shipped; tile-provider swap
deliberately NOT ported, needs a decision

> *Approved new-capability item from `map.md` (item 11).*

## What this is

Three sub-changes on the public `/lightning` page: (1) tap a CAT1 sector zone on the map to only
be alerted for that sector, instead of always getting alerted for every active sector; (2) the
lightning radar/sector overlay shown by default on page load instead of requiring a manual
toggle click first; (3) Replit also swapped the base map tile provider from CARTO to OSM.

## What changed

**Backend**
- `lib/db/src/schema/pushSubscriptions.ts`: added `lightningSectors: text("lightning_sectors").array()`.
  Migration statement added to `lib/db/src/startupMigration.ts` (additive, matches this repo's
  established pattern — no live DB access in this session to actually apply it, so it'll run on
  next boot).
- `push.ts`: added `LIGHTNING_SECTOR_CODES` (exported, for validation), `lightningSectors` on the
  `PushSub` interface and `toPushSub()`, validation in `POST /push/subscribe` (rejects unknown
  codes, empty selection normalizes to "all sectors" for backward compatibility). Widened
  `sendTo()` to accept either a flat payload or a `(sub) => payload | null` function, and added
  `sendLightningToCrew(sectorCodes, createPayload)` — matches every currently-active sector
  against each subscriber's saved preference (no preference = matches everything), skipping a
  subscriber entirely if nothing matches.
- `lightning-monitor.ts`: `checkLightningAndNotify()`'s CAT1-active branch now calls
  `sendLightningToCrew` instead of `broadcastToCrew` for the crew audience — each subscriber's
  push body shows only their selected sectors' details (name + per-sector end time, reusing
  ticket 17's `formatCat1End()`). Managers are unaffected — still get the full unfiltered list via
  `sendToManagers`. The "all sectors now CAT 2 or lower" all-clear message is unaffected too
  (nothing to filter by sector once nothing is active).

**Frontend (`routes/lightning.ts`, the public page)**
- Added `selectedLightningSectors` (persisted to `localStorage`), `LIGHTNING_SECTOR_NAMES`,
  `updateSelectionSummary()`, `saveSectorPreference()`, `toggleSectorSelection()`,
  `clearSectorSelection()` — same shape as Replit's version.
- Sector polygons are now `interactive: true` with a tooltip and click handler (previously
  `interactive: false`, un-clickable); selected sectors render with a highlighted stroke/fill.
- `updatePushBtn()`/`togglePush()` now include `lightningSectors: selectedLightningSectors` in
  the subscribe request body and describe the selection in the button label.
- Added the `#selection-box`/`#selection-summary`/`#clear-sectors` UI (CSS + HTML) to the
  existing `#subscribe-bar`.
- Added `toggleLightning();` to the page's init sequence (alongside the existing `initPush();`) so
  the sector overlay shows automatically — previously required a manual click on the "Lightning"
  button first.

**Verification note**: this whole page is one large template-literal string `tsc` never validates.
Beyond the usual manual read, extracted the actual `<script>` block and ran it through Node's
`new Function(js)` to confirm it parses as valid JS (balanced braces, no stray syntax) without
executing it — a real syntax check, not just eyeballing.

## Deliberately not ported — needs a decision, not silently applied

**CARTO → OSM tile swap.** Investigated before touching it: this repo's current CARTO tiles
(`basemaps.cartocdn.com`) support separate dark/light variants; standard `tile.openstreetmap.org`
does not — swapping wholesale would lose dark-mode map tiles, a real regression. OSM's own tile
usage policy also explicitly discourages direct hotlinking of `tile.openstreetmap.org` for
production traffic (rate-limiting/blocking risk as usage grows) — a different operational risk
than "which CDN looks nicer." Given both of those, this needs an explicit decision rather than a
default port: keep CARTO as-is, or move to OSM only for light mode (keeping CARTO's dark tiles),
or set up a self-hosted/paid tile source if OSM is wanted for both.
