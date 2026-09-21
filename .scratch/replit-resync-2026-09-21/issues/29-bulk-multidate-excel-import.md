Type: feature
Status: done

> *Approved new-capability item from `map.md` (item 9).*

## What this is

`UploadBrief.tsx`'s Excel tab previously only understood a single-date import: one pasted grid,
one date (picked manually or auto-detected), applied/reverted as one unit. This ports Replit's
bulk multi-date capability: detect and import a whole sheet spanning many dates in one go,
per-date apply/revert reporting, a parse-debug panel, and a full-year export.

## What changed — all confined to `UploadBrief.tsx`, no backend or DB changes

Investigated first (before writing any code): does this need new Postgres schema or new routes?
No. `POST /roster-plan/import-brief` already takes one `{date, assignments, off, leave}` group and
`DELETE /roster-plan/import-brief` already accepts a `dates: string[]` array (both already existed
before this ticket) — bulk import is just calling the existing single-date endpoint once per parsed
date group, and bulk revert is just passing all the changed dates in one array. Confirmed via
`rosterPlan.ts:1771` and `:1970`.

**Horizontal multi-date parser** (`parseHorizontalBrief`) — new. Detects a different sheet layout
than the existing one: one officer per row, with each date as a repeating 4-column block
(Target/Actual/Covering/Vehicle), rather than one row per officer per day. Scans the first 12 rows
for a date-header row (label "Date"/"Month"/"Day" at col 2, valid dates at cols 3, 7, 11…), with a
fallback heuristic and a "month name + day number in a sibling row" variant for merged-header
sheets. Read via `XLSX.utils.sheet_to_json(ws, {header:1, raw:true})` on a `cellDates:true`
workbook so date cells arrive as JS `Date` objects — `cellToISO()` converts those (with a ±12h
shift to dodge the SGT sub-day-offset bug documented inline) rather than relying on formatted
strings.

**Vertical multi-date parser** — the existing single-date row parser, factored out to
`parseRows()`, now used per date-group when a Date column is detected (auto-detected either by
header label or, for merged-cell sheets where the date only appears on each group's first row, by
scanning for the column with the most parseable dates). `parseExcelBrief()` now tries horizontal
first, then vertical-with-date-column, then falls back to the original single-date behavior
unchanged.

**A real bug fixed while porting, not just new capability**: `parseRows()`'s OT/CVG column
handling now classifies unit-code vs. officer-name for *assignment* rows too (previously only
leave rows got `coveringOfficerName` — a shift-duty row's cross-post unit code in that column was
silently discarded on import). The backend (`assignments[].coveringUnitCode`) already supported
this field; the frontend just never sent it for non-leave rows.

**Bulk apply/revert** — `handleApply` now branches on `parsed.dateGroups`: multi-date mode loops
the existing import endpoint once per group and accumulates an `ImportRunResult`
(datesFound/Changed/Skipped/Errored, unmatchedNames, totalChanges); single-date mode still calls
it once, reshaped into the same `ImportRunResult` so the UI has one summary shape either way.
`handleRevert` now sends `importResult.datesChanged` (all dates the run actually wrote to) instead
of a single hardcoded date — works for both modes since it was already multi-date-capable
server-side.

**Parse-debug panel** — new, collapsed by default. Shows which parser matched, the detected
date-row/columns, and the first few raw + parsed rows. Ported as-is since diagnosing "why didn't
this sheet import" without visibility into what the auto-detection saw was a real gap, and this is
self-contained (no backend, pure display of already-computed parse state).

**Full-year export** — `handleDownloadXls` gained a `scope: "month" | "year"` parameter; year mode
loops 12 months, each becoming its own workbook tab (`XLSX.utils.book_append_sheet` per month),
same row shape as the existing month export. Also ported the week-batched fetch fix that came with
it: `/roster-plan/schedule?date=X` already returns a full week regardless of which day in it you
pass (confirmed at `rosterPlan.ts:812`), so fetching once per ISO week (Monday-anchored, deduped)
instead of once per calendar day cuts a month's export from ~30 API calls to ~5.

## Deliberately not ported

Reference's year-export rewrite also added `officerCode()`/`officerDisplayUnit()` (regex/keyword
unit-code inference) and a `canonicalName()` fuzzy-match resolver for the Covering column. These
are unit-code-derivation and display-name robustness improvements orthogonal to "add multi-date
import" — kept our existing simpler `unitCode.startsWith(catchmentCode)` officer-matching instead
of expanding this ticket's scope. Worth a look if inconsistent unit-code formatting turns out to be
a real problem in practice, but no evidence of that yet.

Reference also quietly dropped its own single-date preview (`PreviewTable`, listing each parsed
assignment/OFF/leave entry) from the JSX — the component is still defined in its source but never
called anymore, apparently leftover dead code from the multi-date rewrite rather than a deliberate
UX decision. Kept ours rendering for single-date mode (multi-date mode still shows only the
date-range summary, matching reference — a full per-officer preview across many dates would be
unreadably large).

## Worth knowing

- Bulk apply loops the import endpoint sequentially per date group (not parallelized) — matches
  reference exactly; a large multi-month sheet will take a few seconds longer than a single
  Promise.all batch would, but keeps error attribution per-date simple and avoids hammering the DB
  with concurrent transactions touching the same tables.
- `parseHorizontalBrief`'s "unknown actuals (P, WK1, etc.) — silently ignored" behavior is
  unchanged from reference — worth knowing if an unexpected duty code silently drops from an
  import rather than erroring.
