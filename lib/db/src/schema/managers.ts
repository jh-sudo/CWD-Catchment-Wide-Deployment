import { pgTable, text, boolean, integer, timestamp, check } from "drizzle-orm/pg-core";
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
    // manager: which of the fixed MANAGER_GROUPS enum (meetings.ts) this
    // account belongs to — self-tagged, used to filter the meeting-scheduler
    // attendee picker. Unrelated to meeting_groups (an organizer's own
    // reusable named attendee lists). .scratch/replit-resync-2026-09-21/issues/33.
    meetingGroups: text("meeting_groups").array(),
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
    // SSP ac-6/as-15: forces a password change on next login. Set true by
    // seedAdmin() for the auto-seeded fallback admin (ac-6 — a known default
    // credential shouldn't stay valid indefinitely), and by the login route
    // when failedLoginCount crosses FAILED_LOGIN_MUST_CHANGE_THRESHOLD right
    // before a correct password finally succeeds (as-15 — "detect signs of
    // account compromise, such as ... multiple failed login attempts").
    // Cleared the moment the account completes a forced change (see
    // /manager/auth/force-change-password).
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    // SSP as-15 — consecutive failed login attempts on *this account*,
    // regardless of source IP (the existing rate limiter is IP-scoped, so it
    // doesn't catch a slow/distributed guesser). Reset to 0 on every
    // successful login.
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    // SSP ac-3/ac-4 — set on every fully-authenticated login (after MFA, not
    // at the password step) so admins have something to review dormant
    // accounts against; there's no automated disablement here, this only
    // makes the information visible (see /manager/auth/managers' "Last
    // Login" column) for a human-driven access review.
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (table) => [
    check("managers_role_check", sql`${table.role} IN ('admin', 'manager', 'ic', 'crew')`),
    // Backstops the mfa/setup -> mfa/verify-setup two-step flow in auth.ts:
    // mfaEnabled is only ever flipped true alongside mfaSecret being set
    // (see verify-setup), and mfaSecret is only ever cleared alongside
    // mfaEnabled being flipped false (see mfa/disable and
    // managers/:id/disable-mfa) — this constraint just makes that
    // invariant unbreakable at the DB level too, so a row can never end up
    // requiring an MFA code that can never be verified.
    check(
      "managers_mfa_enabled_requires_secret_check",
      sql`${table.mfaEnabled} = false OR ${table.mfaSecret} IS NOT NULL`,
    ),
  ],
);

export const insertManagerSchema = createInsertSchema(managersTable);
export type InsertManager = z.infer<typeof insertManagerSchema>;
export type Manager = typeof managersTable.$inferSelect;
