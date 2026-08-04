import { pgTable, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Replaces ph-rot-state.json — the worse persistence gap found during
// scoping (saveRotState() never called uploadToCloud at all; purely
// local-disk, lost on any container replacement).
export const phRotationStateTable = pgTable("ph_rotation_state", {
  year: integer("year").primaryKey(),
  cursorIndex: integer("cursor_index").notNull(),
});

export const insertPhRotationStateSchema = createInsertSchema(phRotationStateTable);
export type InsertPhRotationState = z.infer<typeof insertPhRotationStateSchema>;
export type PhRotationState = typeof phRotationStateTable.$inferSelect;
