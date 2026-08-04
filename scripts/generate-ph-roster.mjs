/**
 * PH Roster Generator — 2026 & 2027
 * Run: node scripts/generate-ph-roster.mjs
 *
 * Regenerates ph-roster-ref.json for 2026 and 2027 following:
 *  - 3 DAY + 3 PD units (12 officers total) per actual PH
 *  - Racial holiday exclusions
 *  - Sequential unit rotation (no consecutive back-to-back)
 *  - In-lieu dates copy from their originating Sunday/Saturday
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "artifacts", "api-server", "data");
const OFFICERS_FILE = path.join(DATA_DIR, "roster-officers.json");
const REF_FILE = path.join(DATA_DIR, "ph-roster-ref.json");

// ── Rotation sequence (20 units) ─────────────────────────────────────────────
const PH_ROTATION_SEQUENCE = [
  "CP1","KG1","BU1","PJ1","WK1",
  "CP2","KG2","BU2","PJ2","WK2",
  "CP3","KG3","BU3","PJ3","WK3",
  "CP4","KG4","BU4","PJ4",
  "BU5",
];

// ── Racial rules ─────────────────────────────────────────────────────────────
const RACIAL_RULES = {
  CNY_EXCLUDED:       ["Chuiguang", "Matthew", "Azriel"],
  HARI_RAYA_DAY_ONLY: ["Chuiguang", "Ben", "Matthew", "Azriel"],
  DEEPAVALI_EXCLUDED: ["Ben"],
};

// ── PH slots per year (actual PHs + in-lieu copies) ──────────────────────────
const PH_YEAR_SLOTS = {
  2026: [
    { date: "2026-01-01", phName: "New Year's Day",               isOilCopy: false },
    { date: "2026-02-17", phName: "Chinese New Year Day 1",       isOilCopy: false },
    { date: "2026-02-18", phName: "Chinese New Year Day 2",       isOilCopy: false },
    { date: "2026-03-21", phName: "Hari Raya Puasa",              isOilCopy: false },
    { date: "2026-04-03", phName: "Good Friday",                  isOilCopy: false },
    { date: "2026-05-01", phName: "Labour Day",                   isOilCopy: false },
    { date: "2026-05-27", phName: "Hari Raya Haji",               isOilCopy: false },
    { date: "2026-05-31", phName: "Vesak Day",                    isOilCopy: false },
    { date: "2026-06-01", phName: "Vesak Day (In Lieu)",          isOilCopy: true,  copyFromDate: "2026-05-31" },
    { date: "2026-08-09", phName: "National Day",                 isOilCopy: false },
    { date: "2026-08-10", phName: "National Day (In Lieu)",       isOilCopy: true,  copyFromDate: "2026-08-09" },
    { date: "2026-11-08", phName: "Deepavali",                    isOilCopy: false },
    { date: "2026-11-09", phName: "Deepavali (In Lieu)",          isOilCopy: true,  copyFromDate: "2026-11-08" },
    { date: "2026-12-25", phName: "Christmas Day",                isOilCopy: false },
  ],
  2027: [
    { date: "2027-01-01", phName: "New Year's Day",               isOilCopy: false },
    { date: "2027-02-06", phName: "Chinese New Year Day 1",       isOilCopy: false },
    { date: "2027-02-07", phName: "Chinese New Year Day 2",       isOilCopy: false },
    { date: "2027-02-08", phName: "Chinese New Year Day 1 (In Lieu)", isOilCopy: true, copyFromDate: "2027-02-06" },
    { date: "2027-02-09", phName: "Chinese New Year Day 2 (In Lieu)", isOilCopy: true, copyFromDate: "2027-02-07" },
    { date: "2027-03-09", phName: "Hari Raya Puasa",              isOilCopy: false },
    { date: "2027-03-26", phName: "Good Friday",                  isOilCopy: false },
    { date: "2027-05-01", phName: "Labour Day",                   isOilCopy: false },
    { date: "2027-05-03", phName: "Labour Day (In Lieu)",         isOilCopy: true,  copyFromDate: "2027-05-01" },
    { date: "2027-05-16", phName: "Hari Raya Haji",               isOilCopy: false },
    { date: "2027-05-17", phName: "Hari Raya Haji (In Lieu)",     isOilCopy: true,  copyFromDate: "2027-05-16" },
    { date: "2027-05-20", phName: "Vesak Day",                    isOilCopy: false },
    { date: "2027-08-09", phName: "National Day",                 isOilCopy: false },
    { date: "2027-10-28", phName: "Deepavali",                    isOilCopy: false },
    { date: "2027-12-25", phName: "Christmas Day",                isOilCopy: false },
    { date: "2027-12-27", phName: "Christmas Day (In Lieu)",      isOilCopy: true,  copyFromDate: "2027-12-25" },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const isCNY       = (n) => /chinese new year/i.test(n);
const isHariRaya  = (n) => /hari raya/i.test(n);
const isDeepavali = (n) => /deepavali/i.test(n);

function autoAllocate(officers, slots, rotationStartIndex) {
  const officersByUnit = new Map();
  for (const o of officers) {
    if (!o.unitCode || o.unitCode === "TBC") continue;
    const arr = officersByUnit.get(o.unitCode) ?? [];
    arr.push(o.name);
    officersByUnit.set(o.unitCode, arr);
  }

  const cnyExcludedUnits    = new Set();
  const hrDayOnlyUnits      = new Set();
  const deepavaliExcludedUnits = new Set();
  for (const [unit, names] of officersByUnit) {
    if (names.some(n => RACIAL_RULES.CNY_EXCLUDED.includes(n)))       cnyExcludedUnits.add(unit);
    if (names.some(n => RACIAL_RULES.HARI_RAYA_DAY_ONLY.includes(n))) hrDayOnlyUnits.add(unit);
    if (names.some(n => RACIAL_RULES.DEEPAVALI_EXCLUDED.includes(n))) deepavaliExcludedUnits.add(unit);
  }

  console.log("  CNY excluded units:", [...cnyExcludedUnits]);
  console.log("  Hari Raya DAY-only units:", [...hrDayOnlyUnits]);
  console.log("  Deepavali excluded units:", [...deepavaliExcludedUnits]);

  const result = {};
  let rotIdx = rotationStartIndex % PH_ROTATION_SEQUENCE.length;

  for (const slot of slots) {
    if (slot.isOilCopy && slot.copyFromDate) {
      result[slot.date] = (result[slot.copyFromDate] ?? []).map(r => ({ ...r }));
      console.log(`  ${slot.date} ${slot.phName}: COPY from ${slot.copyFromDate} (${result[slot.date].length} rows)`);
      continue;
    }

    const cny = isCNY(slot.phName);
    const hr  = isHariRaya(slot.phName);
    const dp  = isDeepavali(slot.phName);

    const excludedUnits = new Set([
      ...(cny ? cnyExcludedUnits : []),
      ...(dp  ? deepavaliExcludedUnits : []),
    ]);

    const selected = [];
    const usedInPH = new Set();
    const LIMIT = PH_ROTATION_SEQUENCE.length * 4;

    let scanPos = rotIdx;
    while (selected.length < 6 && scanPos < rotIdx + LIMIT) {
      const candidate = PH_ROTATION_SEQUENCE[scanPos % PH_ROTATION_SEQUENCE.length];
      scanPos++;
      if (excludedUnits.has(candidate) || usedInPH.has(candidate)) continue;
      selected.push({ unit: candidate, shift: "DAY" });
      usedInPH.add(candidate);
    }

    rotIdx = (rotIdx + 6) % PH_ROTATION_SEQUENCE.length;

    if (hr) {
      const forced  = selected.filter(s => hrDayOnlyUnits.has(s.unit));
      const flex    = selected.filter(s => !hrDayOnlyUnits.has(s.unit));
      const ordered = [...forced, ...flex].slice(0, 6);
      for (let i = 0; i < ordered.length; i++) ordered[i].shift = i < 3 ? "DAY" : "PD";
      selected.splice(0, selected.length, ...ordered);
    } else {
      for (let i = 0; i < selected.length; i++) selected[i].shift = i < 3 ? "DAY" : "PD";
    }

    const rows = [];
    let rowIndex = 0;
    for (const { unit, shift } of selected) {
      const unitOfficers = officersByUnit.get(unit) ?? [];
      if (unitOfficers.length === 0) {
        rows.push({ rowIndex: rowIndex++, subCatchment: unit, shift, scheduledName: `${unit} (TBC)`, actualName: "", remarks: "No officers found" });
      } else {
        for (const name of unitOfficers) {
          let remarks;
          if (cny && RACIAL_RULES.CNY_EXCLUDED.includes(name))
            remarks = `⚠ Excluded from CNY — swap required`;
          else if (hr && shift === "PD" && RACIAL_RULES.HARI_RAYA_DAY_ONLY.includes(name))
            remarks = `⚠ Must be DAY on Hari Raya — verify shift`;
          else if (dp && RACIAL_RULES.DEEPAVALI_EXCLUDED.includes(name))
            remarks = `⚠ Excluded from Deepavali — swap required`;
          rows.push({ rowIndex: rowIndex++, subCatchment: unit, shift, scheduledName: name, actualName: name, ...(remarks ? { remarks } : {}) });
        }
      }
    }
    result[slot.date] = rows;

    const units3day = selected.filter(s => s.shift === "DAY").map(s => s.unit);
    const units3pd  = selected.filter(s => s.shift === "PD").map(s => s.unit);
    console.log(`  ${slot.date} ${slot.phName}: DAY[${units3day.join(",")}] PD[${units3pd.join(",")}] (rotIdx→${rotIdx})`);
  }

  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const officers = JSON.parse(fs.readFileSync(OFFICERS_FILE, "utf-8"));
const existing = JSON.parse(fs.readFileSync(REF_FILE, "utf-8"));

// 2026: start at rotIdx=0
console.log("\n=== Generating 2026 (rotationStartIndex=0) ===");
const gen2026 = autoAllocate(officers, PH_YEAR_SLOTS[2026], 0);

// 2026 has 11 actual PHs → rotIdx after = (0 + 11*6) % 20 = 66 % 20 = 6
// 2027: continue from rotIdx=6
console.log("\n=== Generating 2027 (rotationStartIndex=6) ===");
const gen2027 = autoAllocate(officers, PH_YEAR_SLOTS[2027], 6);

// Merge into existing (overwrite only 2026 and 2027 dates)
const updated = { ...existing };
for (const [date, rows] of Object.entries(gen2026)) updated[date] = rows;
for (const [date, rows] of Object.entries(gen2027)) updated[date] = rows;

// Sort keys chronologically
const sorted = Object.fromEntries(Object.entries(updated).sort(([a], [b]) => a.localeCompare(b)));

fs.writeFileSync(REF_FILE, JSON.stringify(sorted, null, 2));
console.log("\n✅ Wrote", REF_FILE);

// ── Summary: count per officer per year ──────────────────────────────────────
const inLieuPattern = /in lieu/i;
const actual2026 = PH_YEAR_SLOTS[2026].filter(s => !s.isOilCopy && !inLieuPattern.test(s.phName)).map(s => s.date);
const actual2027 = PH_YEAR_SLOTS[2027].filter(s => !s.isOilCopy && !inLieuPattern.test(s.phName)).map(s => s.date);

const counts = {};
for (const date of actual2026) {
  for (const row of (gen2026[date] ?? [])) {
    const n = row.scheduledName;
    if (!n) continue;
    counts[n] = counts[n] ?? {};
    counts[n]["2026"] = (counts[n]["2026"] ?? 0) + 1;
  }
}
for (const date of actual2027) {
  for (const row of (gen2027[date] ?? [])) {
    const n = row.scheduledName;
    if (!n) continue;
    counts[n] = counts[n] ?? {};
    counts[n]["2027"] = (counts[n]["2027"] ?? 0) + 1;
  }
}

console.log("\n=== PH duty count per officer ===");
console.log(`Actual PHs: 2026=${actual2026.length}, 2027=${actual2027.length}`);
const sortedOfficers = Object.keys(counts).sort();
const allCounts2026 = sortedOfficers.map(o => counts[o]["2026"] ?? 0);
const allCounts2027 = sortedOfficers.map(o => counts[o]["2027"] ?? 0);
console.log(`2026 range: min=${Math.min(...allCounts2026)} max=${Math.max(...allCounts2026)}`);
console.log(`2027 range: min=${Math.min(...allCounts2027)} max=${Math.max(...allCounts2027)}`);
for (const o of sortedOfficers) {
  console.log(`  ${o.padEnd(14)} 2026=${counts[o]["2026"]??0}  2027=${counts[o]["2027"]??0}`);
}
