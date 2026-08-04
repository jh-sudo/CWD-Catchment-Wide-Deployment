Type: grilling
Status: resolved

## Question

What is this map's destination, and which apps/data are in scope for the Replit → GitHub + GOV PaaS migration plan?

## Answer

- **Destination**: a migration spec/plan, not the executed migration. Actual code changes and cutover happen later, driven by this plan.
- **Hosting scope (GOV PaaS)**: `api-server`, `roster-dashboard`, `apa`, `inspector`. Confirmed by reading source: apa and inspector are wired to live auth (`/manager/auth/*`) and live API routes (`/api/inspections/*`) — production, not stubs.
- **Excluded** (see map's Out of scope): `mockup-sandbox` (zero backend calls in source — static mockup), `deployment-tracker` and `wls-android-forwarder` (mobile clients, not hosted services).
- **Database approach**: proper relational Postgres schema, not a lift-and-shove JSONB-per-file approach. The existing `@workspace/db` (Drizzle) package is unused scaffolding and will hold the real schema.
- **Scope includes fixing two persistence gaps** found during investigation, not just translating the existing JSON files:
  - Inspections (`artifacts/api-server/src/routes/inspections.ts`) are currently held in an in-memory `Map`, never persisted at all.
  - VAPID push keys (`artifacts/api-server/src/routes/push.ts`) autogenerate to a local file not covered by `cloudPersistence.ts`, so they silently regenerate (breaking push subscriptions) on every restart.
- **Data cutover**: existing Replit data is real and must be migrated into the new schema, not discarded.
- **Repo hygiene**: stale root binaries (`cwd-fleet-app-template.{zip,tar,dat,encrypted.zip,txt}`, `roster-dashboard-source.zip`, `wls-sms-forwarder.zip`, `roster-dashboard-code.docx`, `locations.xlsx`) get dropped, not carried into the new GitHub repo.
- **GitHub repo**: does not exist yet. Creating it is a deploy-time execution step, out of scope for this planning map.
- **GOV PaaS platform facts**: not directly crawlable. Northflank's docs (https://northflank.com/docs) serve as an imperfect proxy reference since the user described GOV PaaS as "Northflank-adjacent." User has limited firsthand GOV PaaS experience and will supply anything platform-specific they can find.
