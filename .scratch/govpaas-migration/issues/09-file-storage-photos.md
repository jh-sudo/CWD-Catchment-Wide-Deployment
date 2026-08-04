Type: grilling
Status: resolved
Blocked by: 01, 05

## Question

Decide where inspection photo *binary data* actually lives once off Replit, using the platform facts from [GOV PaaS platform capabilities](01-govpaas-platform-capabilities.md) (does GOV PaaS offer an S3-compatible object store, a mountable persistent volume, or neither?) and the schema/reference shape decided in [inspections & push schema](05-schema-inspections-push.md).

Options to weigh with the user: a GOV PaaS object storage service (closest analog to what Replit provided), Postgres `bytea`/large-object storage (simpler ops, no extra service, but bloats the DB and is a poor fit for images), or a persistent volume mount (only viable if GOV PaaS supports one and the app isn't horizontally scaled). Note the 20MB per-file limit currently enforced by multer in `inspections.ts` as a sizing input.

## Answer

### Decision: Northflank's managed MinIO addon

Chosen over a persistent volume (whose access mode — Single or Multi Read/Write — is fixed at creation, meaning picking Single-RW now would block horizontally scaling `api-server` later) and over Postgres `bytea` (bloats the DB, poor fit for images). MinIO is S3-compatible, so standard tooling (`@aws-sdk/client-s3` or the `minio` npm package) applies — no bespoke integration.

### Upload flow

Multer's current `diskStorage` engine (writing to local `uploads/inspections/`) is replaced with `memoryStorage` — files stay in memory just long enough to pass the existing validation (`fileFilter` for image mimetype, 20MB `fileSize` limit — both unchanged) and then get uploaded to MinIO via a `PutObject` call. Object key scheme: `inspections/{inspectionId}/{photoId}.{ext}` — a clean namespaced key, replacing the current flat `uploads/inspections/{uuid}.jpg`. `inspection_photos.filename` (from the [inspections & push schema](05-schema-inspections-push.md)) stores this key.

### Serving flow: proxy through api-server, not presigned URLs

`GET /inspections/:id/photos/:photoId/file` is currently **unauthenticated** — no `requireManager`, relying on UUIDs being hard to guess. Given that existing (weak) security model, the lowest-risk translation is to keep api-server as the proxy: it fetches the object from MinIO and streams it back, same as it streams from local disk today. This preserves current behavior exactly rather than silently changing the access model. Presigned direct-to-MinIO URLs would reduce api-server's bandwidth load and are a reasonable future optimization, but they're a genuine security-model change (time-limited public URLs vs. app-mediated access) that deserves its own decision later, not bundled into this migration.

### No backfill needed

Consistent with the [inspections & push schema](05-schema-inspections-push.md) finding — inspections are in-memory only today, so there's no durable photo metadata to migrate. Any photo files still sitting in Replit's local `uploads/inspections/` disk are orphaned already (their in-memory `Inspection` records don't survive restarts) and aren't worth recovering.

### Credentials

MinIO addon connection details (endpoint, access key, secret key, bucket name) get added to the `api-server` secret group — this was already flagged as a follow-up in the [secrets & config migration](08-secrets-config-migration.md) ticket; this decision resolves that follow-up.
