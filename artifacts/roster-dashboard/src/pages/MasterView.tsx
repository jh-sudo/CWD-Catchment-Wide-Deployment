import { Eye } from "lucide-react";
import { OverrideEditor } from "@/pages/UploadBrief";

// Read-only Excel/Master schedule grid for crew. Reuses the same grid the
// management "Excel" page renders (OverrideEditor already hides Save/editing
// for the "crew" role) but skips the Upload/Download tab entirely — crew can
// look, not edit or export. .scratch/replit-resync-2026-09-21/issues/23.
export default function MasterView() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="shrink-0 border-b px-4 py-3 bg-card flex items-center gap-2">
        <Eye className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Excel</h2>
        <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">View only</span>
      </header>
      <OverrideEditor />
    </div>
  );
}
