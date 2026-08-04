import { pgTable, text, numeric, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Replaces wls.json (WLSReading). PK confirmed via readings.set(r.stationId, r).
export const wlsReadingsTable = pgTable(
  "wls_readings",
  {
    stationId: text("station_id").primaryKey(),
    rawLevel: text("raw_level").notNull(),
    alertLevel: text("alert_level").notNull(),
    direction: text("direction").notNull(),
    // mode: "number" — matches crms_cases.lat/lng convention, avoids
    // string<->number conversion boilerplate at every call site.
    waterLevelM: numeric("water_level_m", { mode: "number" as const }),
    copeM: numeric("cope_m", { mode: "number" as const }),
    criticalM: numeric("critical_m", { mode: "number" as const }),
    // Clean station name for WLS_ALERT; full content block for TIDE_GATE.
    locationName: text("location_name").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    senderName: text("sender_name"),
    messageType: text("message_type").notNull(),
  },
  (table) => [
    check(
      "wls_readings_alert_level_check",
      sql`${table.alertLevel} IN ('CRITICAL', 'FULL', 'HIGH', 'MEDIUM', 'NORMAL')`,
    ),
    check("wls_readings_direction_check", sql`${table.direction} IN ('RISE', 'FALL', 'STABLE')`),
    check(
      "wls_readings_message_type_check",
      sql`${table.messageType} IN ('WLS_ALERT', 'TIDE_GATE')`,
    ),
  ],
);

export const insertWlsReadingSchema = createInsertSchema(wlsReadingsTable);
export type InsertWlsReading = z.infer<typeof insertWlsReadingSchema>;
export type WlsReading = typeof wlsReadingsTable.$inferSelect;
