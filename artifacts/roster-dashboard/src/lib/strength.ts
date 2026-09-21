export interface StrengthBand {
  minimum: number;
  full: number;
  shiftMinimums: {
    PD: number;
    DAY: number;
    ND: number;
  };
  /** Only ever set when this band came from a matched StrengthSpecialRule. */
  name?: string;
}

export interface StrengthSpecialRule extends StrengthBand {
  id: string;
  name: string;
  dates: string[];
}

export interface StrengthConfig {
  weekday: { default: StrengthBand; special: StrengthSpecialRule[] };
  weekend: { default: StrengthBand; special: StrengthSpecialRule[] };
  colors: { below: string; minimum: string; full: string };
}

export const DEFAULT_STRENGTH_COLORS = {
  below: "#fecaca",
  minimum: "#fef08a",
  full: "#bbf7d0",
};

export function defaultStrengthConfig(): StrengthConfig {
  return {
    weekday: {
      default: { minimum: 24, full: 27, shiftMinimums: { PD: 4, DAY: 8, ND: 1 } },
      special: [],
    },
    weekend: {
      default: { minimum: 12, full: 12, shiftMinimums: { PD: 3, DAY: 3, ND: 0 } },
      special: [],
    },
    colors: { ...DEFAULT_STRENGTH_COLORS },
  };
}

export function getStrengthRule(
  date: string,
  weekendOrPH: boolean,
  config?: Partial<StrengthConfig>,
  fallback = defaultStrengthConfig(),
): StrengthBand {
  const group = weekendOrPH ? config?.weekend : config?.weekday;
  const special = group?.special?.find(rule => rule.dates.includes(date));
  if (special) return special;
  const fallbackGroup = weekendOrPH ? fallback.weekend : fallback.weekday;
  return group?.default ?? fallbackGroup.default;
}

export type StrengthTier = "below" | "minimum" | "full";

export function getStrengthTier(actual: number, rule: StrengthBand): StrengthTier {
  if (actual < rule.minimum) return "below";
  if (actual < rule.full) return "minimum";
  return "full";
}

export function getStrengthColor(tier: StrengthTier, config?: Partial<StrengthConfig>): string {
  return config?.colors?.[tier] ?? DEFAULT_STRENGTH_COLORS[tier];
}

export function getContrastText(background: string): string {
  const hex = background.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return "#111827";
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#111827" : "#ffffff";
}

/**
 * Actual/target ND, DAY, PD headcounts for a day's roster — feeds both the
 * 3-tier strength badge (via getStrengthTier) and the target-vs-actual
 * comparison the badge falls back to when no StrengthConfig band applies.
 */
export function computeRosterStrength(
  officers: Array<{ id: string; unitCode?: string }>,
  dutyMap: Record<string, string>,
  targetDutyMap: Record<string, string>,
  leaveMap: Record<string, string> = {},
  ignoreManualLeave = false,
) {
  let ndCount = 0, dayCount = 0, pdCount = 0;
  let targetNdCount = 0, targetDayCount = 0, targetPdCount = 0;
  for (const officer of officers) {
    if ((officer.unitCode ?? "").toUpperCase().startsWith("TBC")) continue;
    const actualDuty = dutyMap[officer.id] ?? "";
    if (ignoreManualLeave || !leaveMap[officer.id]) {
      if (actualDuty === "PD") pdCount++;
      else if (actualDuty === "DAY") dayCount++;
      else if (actualDuty === "ND") ndCount++;
    }
    const targetDuty = targetDutyMap[officer.id] ?? "";
    if (targetDuty === "PD") targetPdCount++;
    else if (targetDuty === "DAY") targetDayCount++;
    else if (targetDuty === "ND") targetNdCount++;
  }
  const totalStrength = pdCount + dayCount + ndCount;
  const targetStrength = targetPdCount + targetDayCount + targetNdCount;
  return {
    ndCount, dayCount, pdCount, totalStrength,
    targetNdCount, targetDayCount, targetPdCount, targetStrength,
    strengthOk: totalStrength >= targetStrength,
  };
}
