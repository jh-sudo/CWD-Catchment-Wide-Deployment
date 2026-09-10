# code-review-sept

Ultrareview run on `phase-b/medium-features`, 2026-09-08.

## Scope note

The review was **requested** to cover `b45d04b..HEAD` (34 commits: Replit-parity
Phase A-E, SSP remediation, the 2026-09-01 crash-loop fixes, crew.ts
continuous-tracking WIP, and the same day's `/roster` QA fixes) — the last
full review before this one covered `b45d04b` and earlier
(`.scratch/full-repo-review/`).

The review tool **actually diffed** local working-tree changes against
`8455c5a` (the second-most-recent commit) — 15 files, 779 insertions(+), 134
deletions(-). That's the tail end of the requested range (today's `/roster`
QA fixes), not the full 34 commits. The bulk of the requested range —
Phase A-E, SSP remediation, and the crash-loop `startupMigration.ts` fix —
was **not reviewed** by this run.

All 4 findings below fall within the actually-reviewed diff, and 3 of the 4
are inside the note's named "today's `/roster` QA fixes" / "crew.ts
continuous-tracking WIP" batches. None cover the older committed range.

**Follow-up:** if review of the Phase A-E / SSP-remediation / crash-loop
commits (`b45d04b..8455c5a`) is still wanted, that needs a separate run
scoped explicitly to that commit range (e.g. `git diff b45d04b 8455c5a` or
per-commit), since the standard diff-based review only looks at working-tree
changes against the previous commit.

## Findings

1. [`01-implement-preview-includes-already-inactive-officers.md`](issues/01-implement-preview-includes-already-inactive-officers.md) — bug, normal severity
2. [`02-implement-preview-fetch-failure-silently-swallowed.md`](issues/02-implement-preview-fetch-failure-silently-swallowed.md) — bug, nit severity
3. [`03-pin-help-text-stale-after-alphanumeric-widen.md`](issues/03-pin-help-text-stale-after-alphanumeric-widen.md) — quality, nit
4. [`04-crew-position-push-duplicates-body-building.md`](issues/04-crew-position-push-duplicates-body-building.md) — quality, nit
