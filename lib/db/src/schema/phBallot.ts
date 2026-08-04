import { pgTable, text, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Replaces ph-ballot.json (BallotEntry), currently empty.
export const phBallotTable = pgTable("ph_ballot", {
  id: text("id").primaryKey(),
  date: date("date").notNull(),
  unitCode: text("unit_code"),
  shift: text("shift"),
  officerName: text("officer_name"),
});

export const insertPhBallotSchema = createInsertSchema(phBallotTable);
export type InsertPhBallot = z.infer<typeof insertPhBallotSchema>;
export type PhBallot = typeof phBallotTable.$inferSelect;
