import { pgTable, text, boolean, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { officersTable } from "./officers";

// Replaces managers.json (ManagerAccount).
export const managersTable = pgTable(
  "managers",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull(),
    approved: boolean("approved").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    // crew: link to roster officer (roster & leave schema domain).
    officerId: text("officer_id").references(() => officersTable.id),
    officerName: text("officer_name"),
    // ic: which catchments they can approve for.
    catchments: text("catchments").array(),
    pendingResetPasswordHash: text("pending_reset_password_hash"),
    pendingResetRequestedAt: timestamp("pending_reset_requested_at", { withTimezone: true }),
    // TOTP-based MFA (admin/manager/ic only — see
    // .scratch/flood-commander-web/issues/09-manager-mfa-totp.md). Unlike
    // passwordHash this can't be a one-way hash: the server has to read the
    // real secret back to check codes, so it's encrypted (AES-256-GCM, see
    // lib/mfa.ts) rather than hashed. Null until the account has gone through
    // /manager/auth/mfa/setup.
    mfaSecret: text("mfa_secret"),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  },
  (table) => [
    check("managers_role_check", sql`${table.role} IN ('admin', 'manager', 'ic', 'crew')`),
  ],
);

export const insertManagerSchema = createInsertSchema(managersTable);
export type InsertManager = z.infer<typeof insertManagerSchema>;
export type Manager = typeof managersTable.$inferSelect;
