Type: cleanup
Status: done

> *Found during the same two-axis code review as [ticket 37](37-admin-password-still-hardcoded.md),
> flagged against [ADR 0001](../../../docs/adr/0001-roster-dashboard-navigation-redesign.md)'s
> "gate role access once, at the route table" decision. In [ticket 31](31-ph-builder.md)'s commit
> (`22fb8be`).*

## What's wrong

[PHHoliday.tsx](../../../artifacts/roster-dashboard/src/pages/PHHoliday.tsx) added
`const canSeeBuilder = user?.role === "admin" || user?.role === "manager" || user?.role === "ic";`
to conditionally show the new PH Builder tab — a fresh re-derivation of the exact tri-state role
check `App.tsx` already computes once as `isManagement` for route-level gating. Confirmed this
isn't a live security hole: the PH Builder API routes
(`/ph-roster-ref/builder-config`, `/ph-roster-ref/builder-presets`) are already behind
`requireManager` server-side, which only recognizes accounts in the `managers` table — crew
accounts authenticate through an entirely separate session mechanism (`requireCrew`) and can't
reach these endpoints regardless of what the frontend tab shows. Purely a
maintainability/consistency gap: the same three-way role check now exists in two places with no
shared definition, risking drift if the management role set ever changes.

## Fix — done

Extracted `isManagementRole(role)` to `AuthContext.tsx` (next to `AccountRole`) as the single
source of truth, and pointed both `App.tsx`'s `isManagement` and `PHHoliday.tsx`'s `canSeeBuilder`
at it instead of each re-deriving the same comparison.
