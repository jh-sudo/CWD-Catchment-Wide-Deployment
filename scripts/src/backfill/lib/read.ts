import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// artifacts/api-server/data — the git-committed JSON export of the Replit
// flat-file "database". Safe to read directly for dev/dry-run per the
// data-backfill ticket's finding; the real cutover run instead does one
// final live pull via restoreFromCloud()'s logic before running this script
// against that freshly-restored copy of the same directory.
export const DATA_DIR = path.resolve(__dirname, "../../../../artifacts/api-server/data");

/** Reads and parses a JSON file from the data dir. Missing file -> fallback (not an error — several of these files are "currently empty" and were never written to disk at all). */
export function readJson<T>(filename: string, fallback: T): T {
  // Every call site passes a hardcoded literal filename ("managers.json",
  // "roster-officers.json", …) — this is a one-off local CLI backfill
  // script with no network listener or user input, not a server route.
  const filePath = path.join(DATA_DIR, filename); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  if (!fs.existsSync(filePath)) return fallback;
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) return fallback;
  return JSON.parse(raw) as T;
}
