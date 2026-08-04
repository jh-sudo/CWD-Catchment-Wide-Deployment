Type: grilling
Status: resolved

## Question

Design the relational Postgres schema for the PH (public holiday) roster domain — currently `ph-roster.json`, `ph-roster-ref.json`, `ph-faq.json`, and `ph-ballot.json` in `cloudPersistence.ts`.

Read the current shape of each file and the relevant route handler (`artifacts/api-server/src/routes/phRoster.ts`) to understand what these hold and how `ph-faq`/`ph-ballot` relate (if at all) to `ph-roster`/`ph-roster-ref`, then work through with the user: what tables replace this set of files, and whether the lower-stakes config-ish ones (`ph-faq`, `ph-ballot`) genuinely need full normalization or are reasonable as simpler structured tables (this domain was flagged during scoping as possibly simpler than roster & leave — confirm rather than assume).

## Answer

### Findings that expanded scope

Two more persistence gaps, both holding real, already-progressing state (confirmed by reading the actual data files, not just the code):

- **`ph-hr-ballot.json`** (Hari Raya OIL ballot draw pool — 27 of 35 eligible officers currently still in the pool, meaning real draws have already happened) — `saveHRBallotState()` does call `uploadToCloud`, but the filename is missing from `cloudPersistence.ts`'s `PERSISTED_FILES` restore list, so uploads succeed but nothing downloads it back on restart. Silently resets to the default pool.
- **`ph-rot-state.json`** (fairness rotation cursor — currently `{"2027": 23}`) — worse: `saveRotState()` never calls `uploadToCloud` at all. Purely local-disk, lost on any container replacement.

**Decision: both included in scope**, same reasoning as the inspections and deployments-state gaps.

Also found: `ALL_MUSLIM_OFFICERS` (and the derived ballot pool) is a hardcoded officer-name list disclosing religious affiliation — a more sensitive category than the names/plate-number PII already covered by the earlier "private repo, fine as-is" decision. **Decision: confirmed to be covered by the same private-repo reasoning**, no additional handling needed — asked explicitly rather than assumed.

### Decisions made

- **Domain content stays as code**: `PH_YEAR_SLOTS` (SG public holiday calendar), `PH_ROTATION_SEQUENCE`/`PH_2027_ROT_START` (fairness rotation order), `UNIT_DEFAULTS`, exclusion rules (`CNY_EXCLUDED`, `DEEPAVALI_EXCLUDED`, `HR_FIXED_DAY`), `ALL_MUSLIM_OFFICERS`, `HR_BALLOT_POOL_2027_INITIAL` — consistent with the roster & leave domain's decision to keep the weekly duty-rotation templates as code, not DB rows. These change rarely and a code review + deploy is a reasonable bar for fairness-sensitive rule changes.
- **`UNIT_DEFAULTS` gets deleted** once confirmed redundant with the `officers` table — same treatment as `DEFAULT_OFFICERS` in the roster & leave domain.

### Proposed tables

- **`ph_roster_ref`** — replaces `ph-roster-ref.json` (`PHRosterRef`, real data, 62KB today): `date DATE NOT NULL`, `row_index INT NOT NULL`, `sub_catchment TEXT`, `shift TEXT`, `scheduled_name TEXT`, `actual_name TEXT`, `remarks TEXT`, `PRIMARY KEY (date, row_index)`
- **`ph_roster_overrides`** — replaces `ph-roster.json` (`PHRosterOverrides`, currently empty): `date DATE NOT NULL`, `slot_key TEXT NOT NULL` (the inner Record key — exact semantics, e.g. whether it matches `ph_roster_ref.row_index` or a unit code, aren't fully pinned down by the code alone; confirm against real usage during backfill), `actual_officer_name TEXT`, `actual_officer_id TEXT REFERENCES officers(id)`, `swap_done BOOLEAN`, `remarks TEXT`, `PRIMARY KEY (date, slot_key)`
- **`ph_ballot`** — replaces `ph-ballot.json` (`BallotEntry`, currently empty): `id TEXT PRIMARY KEY`, `date DATE NOT NULL`, `unit_code TEXT`, `shift TEXT`, `officer_name TEXT`
- **`ph_faq`** — replaces `ph-faq.json`, singleton row: `text TEXT NOT NULL` (the in-code `DEFAULT_FAQ` fallback can stay as the seed value / fallback-if-table-empty, matching current behavior)
- **`ph_hr_ballot_state`** — replaces `ph-hr-ballot.json` (the gap), singleton row: `pool TEXT[] NOT NULL` (ordered — draw order matters), `initialized BOOLEAN NOT NULL`
- **`ph_rotation_state`** — replaces `ph-rot-state.json` (the worse gap): `year INT PRIMARY KEY`, `cursor_index INT NOT NULL`

This feeds into [data backfill & cutover](11-data-backfill-cutover.md) for the files with real data today: `ph-roster-ref.json`, `ph-faq.json`, `ph-hr-ballot.json`, `ph-rot-state.json`. `ph-roster.json` and `ph-ballot.json` currently hold no data to migrate.
