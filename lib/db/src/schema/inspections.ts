import { pgTable, text, integer, numeric, jsonb, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Replaces the in-memory Map<string, Inspection> in inspections.ts.
export const inspectionsTable = pgTable(
  "inspections",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id"),
    teamName: text("team_name"),
    vehicleNumber: text("vehicle_number"),
    // Free text, matches source — not normalized to officer records.
    officers: text("officers"),
    shift: text("shift"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    status: text("status").notNull(),
  },
  (table) => [check("inspections_status_check", sql`${table.status} IN ('active', 'completed')`)],
);

export const insertInspectionSchema = createInsertSchema(inspectionsTable);
export type InsertInspection = z.infer<typeof insertInspectionSchema>;
export type Inspection = typeof inspectionsTable.$inferSelect;

// Child table — photos are individually addressed today
// (GET /inspections/:id/photos/:photoId/file), real entities with their
// own identity, not just an opaque blob array. filename is a reference
// into whichever storage the file storage for photos ticket picks.
export const inspectionPhotosTable = pgTable("inspection_photos", {
  photoId: text("photo_id").primaryKey(),
  inspectionId: text("inspection_id")
    .notNull()
    .references(() => inspectionsTable.id),
  filename: text("filename"),
  originalName: text("original_name"),
  label: text("label"),
  remarks: text("remarks"),
  // mode: "number" — matches crms_cases.lat/lng convention, avoids
  // string<->number conversion boilerplate at every call site.
  lat: numeric("lat", { mode: "number" as const }),
  lng: numeric("lng", { mode: "number" as const }),
  takenAt: timestamp("taken_at", { withTimezone: true }),
  pinNumber: integer("pin_number"),
});

export const insertInspectionPhotoSchema = createInsertSchema(inspectionPhotosTable);
export type InsertInspectionPhoto = z.infer<typeof insertInspectionPhotoSchema>;
export type InspectionPhoto = typeof inspectionPhotosTable.$inferSelect;

// Child table — lines have identity (lineId) but no individual sub-routes;
// points stays as JSONB since there's no per-point identity to normalize.
export const inspectionLinesTable = pgTable("inspection_lines", {
  lineId: text("line_id").primaryKey(),
  inspectionId: text("inspection_id")
    .notNull()
    .references(() => inspectionsTable.id),
  points: jsonb("points").notNull().$type<{ lat: number; lng: number }[]>(),
  color: text("color"),
  createdAt: timestamp("created_at", { withTimezone: true }),
});

export const insertInspectionLineSchema = createInsertSchema(inspectionLinesTable);
export type InsertInspectionLine = z.infer<typeof insertInspectionLineSchema>;
export type InspectionLine = typeof inspectionLinesTable.$inferSelect;
