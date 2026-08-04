import { pgTable, text, integer, boolean, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Replaces ph-hr-ballot.json — a persistence gap found during scoping
// (uploadToCloud was called but the filename was missing from
// cloudPersistence.ts's restore list, so draws silently reset on restart).
// Singleton row (id is always 1). pool is ordered — draw order matters.
export const phHrBallotStateTable = pgTable(
  "ph_hr_ballot_state",
  {
    id: integer("id").primaryKey().default(1),
    pool: text("pool").array().notNull(),
    initialized: boolean("initialized").notNull(),
  },
  (table) => [check("ph_hr_ballot_state_singleton_check", sql`${table.id} = 1`)],
);

export const insertPhHrBallotStateSchema = createInsertSchema(phHrBallotStateTable);
export type InsertPhHrBallotState = z.infer<typeof insertPhHrBallotStateSchema>;
export type PhHrBallotState = typeof phHrBallotStateTable.$inferSelect;
