import { pgTable, integer, jsonb, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Replaces ph-hr-ballot.json. Singleton row (id is always 1).
//
// Puasa and Haji are independent exhaustion pools (see hrBallot.ts in
// api-server), so this stores both under one `pools` column rather than
// the single flat pool/initialized columns this table originally had —
// that shape couldn't represent "two holidays, two separate cycles."
// Shape: Record<"puasa" | "haji", { pool: string[]; initialized: boolean;
// cycle: "green" | "orange"; drawHistory: Record<date, Record<officer,
// cycle>> }> — kept as jsonb rather than normalized columns/tables since
// it's always read and written as one unit (see phRoster.ts's
// createHRBallotStateFromRoster) and is functionally just a cache: the
// pools are re-derived from the actual scheduled PH roster both on every
// auto-allocate run and on every GET /ph-roster-ref/hr-ballot-pool read
// (the schedule is the source of truth, not this row) — this table exists
// as a record of what the last auto-allocate run actually drew, not as
// something any route trusts blindly.
export const phHrBallotStateTable = pgTable(
  "ph_hr_ballot_state",
  {
    id: integer("id").primaryKey().default(1),
    pools: jsonb("pools").notNull(),
  },
  (table) => [check("ph_hr_ballot_state_singleton_check", sql`${table.id} = 1`)],
);

export const insertPhHrBallotStateSchema = createInsertSchema(phHrBallotStateTable);
export type InsertPhHrBallotState = z.infer<typeof insertPhHrBallotStateSchema>;
export type PhHrBallotState = typeof phHrBallotStateTable.$inferSelect;
