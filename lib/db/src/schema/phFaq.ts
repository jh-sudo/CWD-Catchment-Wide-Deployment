import { pgTable, text, integer, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Replaces ph-faq.json. Singleton row (id is always 1). The in-code
// DEFAULT_FAQ fallback can stay as the seed value / fallback-if-table-empty,
// matching current behavior.
export const phFaqTable = pgTable(
  "ph_faq",
  {
    id: integer("id").primaryKey().default(1),
    text: text("text").notNull(),
  },
  (table) => [check("ph_faq_singleton_check", sql`${table.id} = 1`)],
);

export const insertPhFaqSchema = createInsertSchema(phFaqTable);
export type InsertPhFaq = z.infer<typeof insertPhFaqSchema>;
export type PhFaq = typeof phFaqTable.$inferSelect;
