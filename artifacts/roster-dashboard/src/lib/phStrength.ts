import type { PHRefRow } from "@/lib/usePHActuals";

type StrengthCounts = {
  ndCount: number;
  dayCount: number;
  pdCount: number;
  totalStrength: number;
  targetStrength: number;
  targetNdCount: number;
  targetDayCount: number;
  targetPdCount: number;
  strengthOk: boolean;
};

/**
 * PH strength is defined by the PH reference roster, rather than the regular
 * daily schedule. A blank actual field means the scheduled officer worked, so
 * both saved PH Actual and saved PH OIL Actual rows count their recorded worker.
 */
export function getPHStrength(rows: PHRefRow[]): StrengthCounts {
  let ndCount = 0;
  let dayCount = 0;
  let pdCount = 0;
  let targetNdCount = 0;
  let targetDayCount = 0;
  let targetPdCount = 0;

  for (const row of rows) {
    const shift = row.shift.toUpperCase();
    const hasActualOfficer = Boolean((row.actualName || row.scheduledName)?.trim());
    const hasScheduledOfficer = Boolean(row.scheduledName?.trim());

    if (shift === "ND") {
      if (hasActualOfficer) ndCount++;
      if (hasScheduledOfficer) targetNdCount++;
    } else if (shift === "DAY") {
      if (hasActualOfficer) dayCount++;
      if (hasScheduledOfficer) targetDayCount++;
    } else if (shift === "PD") {
      if (hasActualOfficer) pdCount++;
      if (hasScheduledOfficer) targetPdCount++;
    }
  }

  const totalStrength = ndCount + dayCount + pdCount;
  const targetStrength = targetNdCount + targetDayCount + targetPdCount;

  return {
    ndCount,
    dayCount,
    pdCount,
    totalStrength,
    targetStrength,
    targetNdCount,
    targetDayCount,
    targetPdCount,
    strengthOk: totalStrength >= targetStrength,
  };
}
