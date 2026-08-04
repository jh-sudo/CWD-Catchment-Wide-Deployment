# 0001 — Roster dashboard navigation redesign (crew vs. management)

**Status:** Accepted (implemented)

## Context

The original roster-dashboard (git commit `a91319b`, "Roster Original") had a single flat navigation structure shared by every role:

- `/` → `Roster.tsx` — weekly duty grid
- `/officers` → `Officers.tsx` — drag-drop board + list
- `/swaps` → `Swaps.tsx` — swap request table
- `/schedule` → `OfficerSchedule.tsx` — 30-day list view with an officer picker
- `/my-leave` → `MyLeave.tsx` — crew leave submission
- `/approvals` → `Approvals.tsx` — cover + IC review
- `/users` → `Users.tsx` — admin only

Per-role nav in that structure:
- Admin/Manager: Roster, Officers, Swaps, Schedule, Approvals, (+ Users for admin)
- IC: Roster, Schedule, Approvals
- Crew: Roster, My Schedule, My Leave, Approvals

This mixed management-facing pages (officer/roster editing, approvals) and crew-facing pages (personal schedule, leave submission) in one route set, gated ad hoc per page rather than structurally.

## Decision

Redesign the navigation around a management/crew split, gated by `isManagement = role === "admin" || "manager" || "ic"` at the route-table level (`App.tsx`) rather than per-page:

- `/` — Today's Roster (all roles)
- `/roster-cycle`, `/public-holiday` — all roles
- `/crew-schedule`, `/applications`, `/upload-brief`, `/apply` — management only
- `/officers` — admin/manager only (not IC)
- `/users` — admin only
- `/schedule`, `/my-applications` — crew only

## Consequences

- Role-appropriate navigation is enforced once, at the route table, instead of scattered per-page checks.
- Crew and management now see structurally different apps rather than a shared page set with hidden sections — reduces the chance of a crew member landing on a management page that silently fails to load their data.
- Anyone referencing the old flat route names (`/swaps`, `/my-leave`, `/approvals`) from bookmarks, external links, or old documentation will hit `NotFound` — no redirect shim was added for the old paths.
