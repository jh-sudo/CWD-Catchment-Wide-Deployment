Type: cleanup
Status: done

> *Found during the same two-axis code review as [ticket 37](37-admin-password-still-hardcoded.md).
> In [ticket 31](31-ph-builder.md)'s commit (`22fb8be`).*

## What's wrong

`PUT /ph-roster-ref/builder-config` and `POST /ph-roster-ref/builder-presets` in
[phRoster.ts](../../../artifacts/api-server/src/routes/phRoster.ts) each independently fetched
active officers and built the same two `Set`s (officer names, active unit codes) to pass into
`normalizePHBuilderConfig`, near-verbatim.

## Fix — done

Extracted `loadValidatedPHBuilderConfig(rawConfig)`, doing the officer fetch + `Set` construction
+ `normalizePHBuilderConfig` call once; both routes now call it with their respective raw config
(`req.body` / `req.body?.config`).
