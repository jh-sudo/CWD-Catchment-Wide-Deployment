Type: grilling
Status: resolved
Blocked by: 06, 08, 11

## Question

[Repo hygiene](06-repo-hygiene-replit-surface.md) found that `artifacts/api-server/data/vapid.json`'s private VAPID key and `managers.json`'s bcrypt password hashes are committed to git history (surfaced via [data backfill & cutover](11-data-backfill-cutover.md)), and flagged — but never resolved — whether to scrub git history (e.g. `git filter-repo`) before the eventual GitHub push, or accept it given the repo/deployment will be private (matching the reasoning already applied to PII in [ticket 08](08-secrets-config-migration.md)). This never got its own ticket number and was left dangling in `spec.md`'s Open questions.

## Answer

**Scrub git history** before the eventual push to GitHub — `git filter-repo` (or BFG) run against `artifacts/api-server/data/vapid.json` and `managers.json` to strip the VAPID private key and password hashes from every historical commit, not just the current working tree.

**Reasoning**: credentials are a stricter risk category than the PII/plate-number data already accepted as-is. A private repo can still leak via a future access grant, an accidental visibility change, or a fork — and unlike names/plates, a leaked VAPID key or password hash is directly exploitable. This is sharper given [ticket 08](08-secrets-config-migration.md) already decided to **carry the existing VAPID key forward unrotated** — if history isn't scrubbed, that specific key stays permanently exposed in git history even after cutover, not just temporarily.

**Sequencing**: this must happen **before** the GitHub repo is created/pushed (per the map's note that the GitHub repo doesn't exist yet and is a future execution step) — rewriting history after collaborators/CI have cloned would require force-pushes and re-clones everywhere, which is why the map's [repo hygiene ticket](06-repo-hygiene-replit-surface.md) treated this as a pre-push prep step, not something to retrofit later.

**Not in scope for this ticket**: this only decides *whether* to scrub and *why it's ordered before the push* — the actual `git filter-repo` invocation and verification are execution-time work, per the map's "plan, don't do" convention.
