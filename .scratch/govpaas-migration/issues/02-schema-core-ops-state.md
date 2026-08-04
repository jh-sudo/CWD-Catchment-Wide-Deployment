Type: grilling
Status: resolved

## Question

Design the relational Postgres schema for the "core ops state" domain — currently the flat files `state.json`, `crms.json`, `wls.json`, and `managers.json` in `artifacts/api-server/src/lib/cloudPersistence.ts`, each loaded whole into memory and rewritten whole on every change.

Read the current shape of each file (or the route handlers / types that produce them, e.g. `artifacts/api-server/src/routes/*.ts`) to understand what data they actually hold, then work through with the user: what tables, columns, relations, and constraints replace each blob. Cover concurrent-write safety (today's whole-file overwrite has no locking) and note anywhere the current shape is ambiguous enough to need a follow-up decision.

## Answer

### Findings that expanded scope

Same pattern as the inspections gap found earlier: `deployments.ts` (backing the live flood-ops deployment tracker) holds real operational data — deployment entries, live vehicle positions, swap requests, the active flood alert, and a reassignment audit log — entirely in-memory, none of it in `cloudPersistence.ts`'s sync list. `config.json` (manager/crew shared login PINs) is also a gap: present on local disk but, unlike `managers.json`, never cloud-synced. **Decision: include all of this in scope**, same reasoning as inspections — this is real accountability/operational data for a flood-ops app, not disposable.

### Decisions made

- **Vehicle positions**: latest-position-only, upserted per vehicle (not a full ping history). Matches what the app actually displays today; avoids the current "vehicles vanish from the map after every restart" bug without taking on unnecessary write volume.
- **Login PINs** (`config.json`): a DB settings row, not a GOV PaaS secret/env var — these are mutable app data changeable in-app, not deploy-time credentials.
- **Alert history**: expanded to keep every broadcast alert (not just the current one) — today a new broadcast silently discards the previous `activeAlert`, which cuts against the same accountability reasoning used to justify persisting this domain at all.
- **Alert acknowledgments**: added an `acknowledged_at` timestamp (not present today — acknowledgments are currently just a bare list of unit codes) — small addition, clearly useful for the accountability record this table exists for.

### Proposed tables

**From the originally-scoped files:**

- **`crms_cases`** — replaces `crms.json` (`CrmsCase`): `id TEXT PK`, `case_number TEXT`, `is_wog BOOLEAN`, `fp_name TEXT`, `fp_contact TEXT`, `address TEXT`, `postal_code TEXT`, `lat NUMERIC`, `lng NUMERIC`, `location_name TEXT`, `details TEXT`, `status TEXT CHECK (status IN ('TO_BE_ASSIGNED','TEAM_ACKNOWLEDGE_OTW','FP_UPDATED','ASSISTANCE_PROVIDED','RESOLVED'))`, `assigned_vehicle_id TEXT`, `assigned_unit_code TEXT`, `received_at TIMESTAMPTZ NOT NULL`, `acknowledged_at`/`fp_updated_at`/`assistance_provided_at`/`resolved_at TIMESTAMPTZ`, `flood_assessment TEXT`, `update_provided_to_fp TEXT`, `reported_by TEXT`
- **`crms_comments`** — child of `crms_cases` (`CrmsComment`): `comment_id TEXT PK`, `case_id TEXT NOT NULL REFERENCES crms_cases(id)`, `vehicle_id TEXT`, `unit_code TEXT`, `text TEXT`, `created_at TIMESTAMPTZ`
- **`wls_readings`** — replaces `wls.json` (`WLSReading`): `station_id TEXT PRIMARY KEY` (confirmed via `readings.set(r.stationId, r)`), `raw_level TEXT`, `alert_level TEXT CHECK (... IN ('CRITICAL','FULL','HIGH','MEDIUM','NORMAL'))`, `direction TEXT CHECK (... IN ('RISE','FALL','STABLE'))`, `water_level_m NUMERIC`, `cope_m NUMERIC`, `critical_m NUMERIC`, `location_name TEXT`, `timestamp TIMESTAMPTZ`, `received_at TIMESTAMPTZ`, `sender_name TEXT`, `message_type TEXT CHECK (... IN ('WLS_ALERT','TIDE_GATE'))`
- **`managers`** — replaces `managers.json` (`ManagerAccount`): `id TEXT PK`, `username TEXT UNIQUE NOT NULL`, `password_hash TEXT NOT NULL`, `role TEXT CHECK (role IN ('admin','manager','ic','crew'))`, `approved BOOLEAN`, `created_at TIMESTAMPTZ`, `officer_id TEXT REFERENCES officers(id)` (cross-domain FK — see [roster & leave schema](03-schema-roster-leave.md)), `officer_name TEXT`, `catchments TEXT[]`, `pending_reset_password_hash TEXT`, `pending_reset_requested_at TIMESTAMPTZ`
- **`app_config`** — replaces `config.json` (the persistence gap), singleton row: `manager_pin TEXT NOT NULL`, `crew_pin TEXT NOT NULL`

**From `deployments.ts` (the newly-included gap):**

- **`deployment_teams`** — replaces `state.json`'s `roster` (`RosterTeam`): `id TEXT PK`, `vehicle_id TEXT`, `unit_code TEXT`, `vehicle_number TEXT`, `partner TEXT` (free-text names, **not** FK'd to `officers` — matches current behavior, not a decision to normalize further here), `shift TEXT`
- **`deployment_settings`** — replaces `state.json`'s `activeShifts`/`activeTeams` + in-memory `deploymentDate`, singleton row: `active_shifts TEXT[]`, `active_teams TEXT[]`, `deployment_date DATE`
- **`deployment_locations`** — replaces `state.json`'s `customLocations` (user-added only; presets stay CSV-seeded at boot, unchanged): `id TEXT PK`, `name TEXT`, `address TEXT`, `lat NUMERIC`, `lng NUMERIC`, `region TEXT`, `priority INT`
- **`deployment_assignments`** — replaces `state.json`'s `assignments` (`Assignment`), `PK: vehicle_id` (confirmed via `assignments.set(vehicleId, ...)`): `vehicle_id TEXT PK`, `vehicle_number TEXT`, `unit_code TEXT`, `location_id TEXT`, `location_name TEXT`, `lat NUMERIC`, `lng NUMERIC`, `assigned_at TIMESTAMPTZ`, `status TEXT CHECK (status IN ('pending','accepted','declined'))`, `assigned_by TEXT`, `previous_location_id TEXT`, `previous_location_name TEXT`
- **`deployment_entries`** — replaces in-memory `deploymentEntries` (`DeploymentEntry`), current-state table matching today's delete-on-move behavior: `PRIMARY KEY (location_id, vehicle_id)`, `vehicle_number TEXT`, `unit_code TEXT`, `partner TEXT`, `shift TEXT`, `accepted_at TIMESTAMPTZ`, `eta TEXT`, `eta_minutes INT`, `arrived BOOLEAN`, `arrived_at TIMESTAMPTZ`, `weather TEXT`, `from_road TEXT`, `assigned_by TEXT`, `previous_location_id TEXT`, `previous_location_name TEXT`, `reassigned_at TIMESTAMPTZ`
- **`deployment_reassignment_history`** — replaces in-memory `reassignmentHistory` (`ReassignmentRecord`), append-only: `id UUID PK DEFAULT gen_random_uuid()` (no id in the source shape — synthetic), `vehicle_id TEXT`, `vehicle_number TEXT`, `unit_code TEXT`, `from_location_id TEXT`, `from_location_name TEXT`, `to_location_id TEXT`, `to_location_name TEXT`, `reassigned_at TIMESTAMPTZ`, `reassigned_by TEXT`
- **`deployment_vehicle_positions`** — replaces in-memory `vehiclePositions` (`VehiclePosition`), latest-only per decision above: `vehicle_id TEXT PK`, `vehicle_number TEXT`, `unit_code TEXT`, `partner TEXT`, `shift TEXT`, `lat NUMERIC`, `lng NUMERIC`, `updated_at TIMESTAMPTZ`, `accepted_location_id TEXT`
- **`deployment_swap_requests`** — replaces in-memory `swapRequests` (`SwapRequest`), pending-only, deleted on resolution (matches current behavior — no status field in the source shape): `id TEXT PK`, `from_vehicle_id TEXT`, `from_unit_code TEXT`, `from_vehicle_number TEXT`, `from_location_id TEXT`, `from_location_name TEXT`, `to_vehicle_id TEXT`, `to_unit_code TEXT`, `to_vehicle_number TEXT`, `to_location_id TEXT`, `to_location_name TEXT`, `created_at TIMESTAMPTZ`
- **`deployment_alerts`** — replaces in-memory `activeAlert` (`AlertRecord`), **expanded to full history** (see decision above): `id TEXT PK`, `extracted TEXT`, `broadcast_at TIMESTAMPTZ`
- **`deployment_alert_acknowledgments`** — child of `deployment_alerts`, new `acknowledged_at` column added (see decision above): `alert_id TEXT NOT NULL REFERENCES deployment_alerts(id)`, `unit_code TEXT NOT NULL`, `acknowledged_at TIMESTAMPTZ NOT NULL`, `PRIMARY KEY (alert_id, unit_code)`

Cross-domain note: `managers.officer_id` FKs into `officers`, defined in [roster & leave schema](03-schema-roster-leave.md) — confirm that FK direction holds once both are implemented. This feeds into [data backfill & cutover](11-data-backfill-cutover.md) for the two files with real data today (`state.json`'s roster, `managers.json`); everything else in this domain currently holds empty/no data to migrate.
