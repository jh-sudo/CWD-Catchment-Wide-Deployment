# 08 — Retire deployment-tracker as a distributed app

Status: not-started
Depends on: 02, 03 (web equivalents must cover everything first)

`deployment-tracker` has never been built into a real APK/distributed — decide
whether to formally retire it (remove from the repo, like `wls-android-forwarder`)
or keep the source around dev-only/never published. Either way, no EAS build should
ship once the web versions cover its functionality, since publishing it would
re-trigger the Archetype 4 mobile-app rule this whole effort exists to avoid.
