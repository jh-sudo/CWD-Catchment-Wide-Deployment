Type: feature
Status: done

> *Approved new-capability item from `map.md` (item 14).*

## What this is

A small, crew-role-only read-only view of the Master/Excel grid, at `/master-view` ("Excel" in
the crew nav, Eye icon). Previously crew had no way to see the Master grid at all.

## What changed

- Exported `OverrideEditor` from `UploadBrief.tsx` (was file-local). It already gates
  Save/editing behind `isReadOnly = !user || user.role === "crew"`, so no changes were needed to
  the grid itself — a crew viewer already gets a correctly read-only render.
- Added `MasterView.tsx`: a thin wrapper — header ("Excel" + "View only" badge) + `<OverrideEditor />`.
  Deliberately doesn't include `UploadBrief`'s "excel" (upload/import) tab — crew can look, not
  import or export.
- Wired the route (`/master-view`, crew-only) into `App.tsx` and the nav link into `Layout.tsx`'s
  crew nav array, matching Replit's route path, label, and icon exactly.
