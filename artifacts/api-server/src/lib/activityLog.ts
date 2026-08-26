// In-app notification feed backing store — replaces Replit's JSON-file
// activity-log.json with the Postgres activity_log table. Two event types:
// "leave-applied" (emitted from rosterPlan.ts's POST /roster-plan/leave) and
// "roster-implement" (reserved for RosterBuilder — see activityLog schema's
// header comment).
import { randomUUID } from "crypto";
import { desc, inArray } from "drizzle-orm";
import { db, activityLogTable, type ActivityLogEntry } from "@workspace/db";

export type { ActivityLogEntry };

export async function appendActivityLog(entry: Omit<ActivityLogEntry, "id">): Promise<void> {
  await db.insert(activityLogTable).values({ id: randomUUID(), ...entry });
  // Keep the table from growing unbounded — same 300-entry cap Replit's
  // JSON file enforced, just expressed as an occasional prune instead of a
  // splice-on-every-write (a table scan on every append would be wasteful).
  const count = await db.$count(activityLogTable);
  if (count > 300) {
    const overflow = await db
      .select({ id: activityLogTable.id })
      .from(activityLogTable)
      .orderBy(desc(activityLogTable.createdAt))
      .offset(300);
    if (overflow.length > 0) {
      await db.delete(activityLogTable).where(inArray(activityLogTable.id, overflow.map((o) => o.id)));
    }
  }
}

export async function getActivityLog(limit = 50): Promise<ActivityLogEntry[]> {
  return db
    .select()
    .from(activityLogTable)
    .orderBy(desc(activityLogTable.createdAt))
    .limit(limit);
}
