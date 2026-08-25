// Writes lib/api-zod/src/index.ts after orval regenerates lib/api-zod/src/generated/.
// A plain `echo '...' > file` shell one-liner (the previous approach) is not
// cross-platform: pnpm runs package.json scripts through cmd.exe on Windows,
// which doesn't strip single quotes the way POSIX shells do — the file ended
// up containing the literal quote characters, turning the intended `export *
// from "./generated/api";` into a no-op string-literal statement that
// silently exported nothing (a real, reproduced bug — see
// .scratch/full-repo-review/issues/10-api-contract-schema-drift.md).
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, "../api-zod/src/index.ts");
writeFileSync(target, 'export * from "./generated/api";\n');
