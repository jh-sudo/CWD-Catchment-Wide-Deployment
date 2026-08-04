import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getGetDeploymentReportQueryKey, useGetDeploymentReport } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/context/ThemeContext";
import { useApp } from "@/context/AppContext";

const UNIT_ORDER_MAP: Record<string, number> = { BU: 0, PJ: 1, WK: 2, CP: 3, KG: 4 };
const unitSortKey = (code: string): number => {
  const prefix = code.replace(/\d.*$/, "");
  const num = parseInt(code.replace(/^\D+/, ""), 10) || 0;
  return (UNIT_ORDER_MAP[prefix] ?? 99) * 1000 + num;
};

function weatherInfo(w: string | null | undefined): { emoji: string; color: string; label: string } {
  if (!w) return { emoji: "—", color: "#888", label: "Not reported" };
  if (w === "Heavy Rain")    return { emoji: "🔴", color: "#EF4444", label: "Heavy Rain" };
  if (w === "Moderate Rain") return { emoji: "🟠", color: "#F97316", label: "Moderate Rain" };
  if (w === "Light Rain")    return { emoji: "🟡", color: "#EAB308", label: "Light Rain" };
  if (w === "Nil Rain")      return { emoji: "🟢", color: "#22C55E", label: "Nil Rain" };
  return { emoji: "🌤", color: "#888", label: w };
}

function sgTime(date: Date): string {
  return date.toLocaleTimeString("en-SG", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Singapore",
  });
}

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://example-project.example-team.stg.paas.sandbox.gov.sg";

interface TideData {
  height: number;
  rising: boolean;
}

export default function ReportScreen() {
  const colors = useColors();
  const { isDark, toggle: toggleTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { userInfo, deploymentState, etaString: liveEtaString, etaMinutes: liveEtaMinutes, acceptedLocationId } = useApp();
  const [copied, setCopied] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [tide, setTide] = useState<TideData | null>(null);

  const { data: report, isLoading, refetch } = useGetDeploymentReport({
    query: {
      refetchInterval: 5000,
      enabled: !!userInfo,
      queryKey: getGetDeploymentReportQueryKey(),
    },
  });

  useEffect(() => {
    if (report) setLastUpdated(new Date());
  }, [report]);

  // Fetch tide on mount and every 60 s
  useEffect(() => {
    const load = () =>
      fetch(`${API_BASE}/api/tide`)
        .then((r) => r.json())
        .then((t) => setTide({ height: t.height, rising: t.rising }))
        .catch(() => {});
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, []);

  const activeAlert = (deploymentState as any)?.activeAlert ?? null;

  const entries = deploymentState?.entries ?? [];
  const allLocations: any[] = (deploymentState as any)?.presetLocations ?? [];
  const pendingAssignments: any[] = Object.values((deploymentState as any)?.assignments ?? {})
    .filter((a: any) => a.status === "pending")
    .sort((a: any, b: any) => unitSortKey(a.unitCode) - unitSortKey(b.unitCode));
  const deployedVehicleIds = new Set(entries.map((e) => e.vehicleId));
  const pendingOnly = pendingAssignments.filter((a) => !deployedVehicleIds.has(a.vehicleId));

  const weatherSummary = (() => {
    const counts: Record<string, number> = {};
    for (const e of entries) {
      const w = (e as any).weather;
      if (w) counts[w] = (counts[w] ?? 0) + 1;
    }
    const keys = Object.keys(counts);
    if (!keys.length) return null;
    return keys
      .sort((a, b) => {
        const order = ["Heavy Rain", "Moderate Rain", "Light Rain", "Nil Rain"];
        return order.indexOf(a) - order.indexOf(b);
      })
      .map((k) => `${weatherInfo(k).emoji} ${k}${counts[k] > 1 ? ` ×${counts[k]}` : ""}`)
      .join("  ");
  })();

  const handleCopy = async () => {
    if (!entries.length && !pendingOnly.length) return;

    const rosterDate = (deploymentState as any)?.deploymentDate ?? null;
    const today = rosterDate || new Date().toLocaleDateString("en-SG", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
    const sep = "─".repeat(48);

    const rosterTeams: any[] = (deploymentState as any)?.rosterTeams ?? [];
    const swapReqs: any[] = (deploymentState as any)?.swapRequests ?? [];
    const swapPendingIds = new Set<string>(
      swapReqs.flatMap((sr: any) => [sr.fromVehicleId, sr.toVehicleId])
    );

    type ReportItem = { sortKey: number; line: string };
    const allLines: ReportItem[] = [];

    for (const e of entries) {
      const loc = allLocations.find((l: any) => l.id === e.locationId);
      const locName = loc?.name ?? e.locationId;
      const arrived = (e as any).arrived;
      const arrivedAt = (e as any).arrivedAt;
      const eta = (e as any).eta;
      const fromRoad = (e as any).fromRoad as string | null;
      const timeStr = arrived && arrivedAt
        ? `${arrivedAt} hrs`
        : `ETA ${eta} hrs${fromRoad ? ` from ${fromRoad}` : ""}`;
      const w = (e as any).weather;
      const wStr = w ? ` | ${weatherInfo(w).emoji} ${w}` : "";
      const swapStr = swapPendingIds.has(e.vehicleId) ? " | ⇄ Swap" : "";
      allLines.push({
        sortKey: unitSortKey(e.unitCode),
        line: `*${e.unitCode}* ${e.vehicleNumber} (${e.shift}): ${e.partner} → *${locName}* | ${timeStr}${wStr}${swapStr}`,
      });
    }

    for (const a of pendingOnly) {
      const team = rosterTeams.find((t: any) =>
        `${t.unitCode}-${t.vehicleNumber}` === a.vehicleId || t.unitCode === a.unitCode
      );
      const partner = team?.partner ?? "";
      const shift = a.shift ?? team?.shift ?? "";
      allLines.push({
        sortKey: unitSortKey(a.unitCode),
        line: `*${a.unitCode}* ${a.vehicleNumber}${shift ? ` (${shift})` : ""}: ${partner ? `${partner} → ` : "→ "}*${a.locationName}*`,
      });
    }

    allLines.sort((a, b) => a.sortKey - b.sortKey);

    const arrivedCount = entries.filter((e: any) => e.arrived).length;
    const totalUnits = allLines.length;

    const sections: string[] = [
      `*DEPLOYMENT REPORT — ${today}*`,
    ];

    if (activeAlert?.extracted) {
      sections.push(`🚨 HRW: ${activeAlert.extracted}`);
    }
    if (tide) {
      sections.push(`🌊 Tide Level: ${tide.height.toFixed(2)}m ${tide.rising ? "↑" : "↓"}`);
    }

    sections.push(sep);
    sections.push(`✅ DEPLOYED (${totalUnits})`);
    sections.push(...allLines.map(r => r.line));

    sections.push(sep);
    sections.push(`📍 ${arrivedCount}/${entries.length} arrived | ${pendingOnly.length} pending`);

    const reassignmentLines: string[] = (report as any)?.reassignmentLines ?? [];
    if (reassignmentLines.length > 0) {
      sections.push(sep);
      sections.push(`🔁 REASSIGNMENTS (${reassignmentLines.length})`);
      sections.push(...reassignmentLines);
    }

    const text = sections.join("\n");
    await Clipboard.setStringAsync(text);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleRefresh = async () => {
    await refetch();
    setLastUpdated(new Date());
  };

  const today = new Date().toLocaleDateString("en-SG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const styles = StyleSheet.create({
    container:   { flex: 1, backgroundColor: colors.background },
    headerBar:   {
      paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16),
      paddingHorizontal: 20,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTopRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 6 },
    headerLeft:  { flex: 1 },
    headerLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 2, color: colors.primary, textTransform: "uppercase" },
    headerDate:  { fontSize: 18, fontFamily: "Inter_700Bold", color: colors.foreground, marginTop: 2 },
    headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
    updatedRow:  { flexDirection: "row", alignItems: "center", gap: 6 },
    updatedText: { fontSize: 12, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    copyBtn: {
      backgroundColor: colors.card,
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderWidth: 1,
      borderColor: copied ? colors.accent : colors.border,
    },
    copyBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: copied ? colors.accent : colors.foreground },
    refreshBtn:  { padding: 8 },
    content:     { flex: 1 },
    scrollContent: { padding: 20, paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 20 },
    summaryRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 8,
    },
    summaryLabel:  { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    summaryCount:  { fontSize: 22, fontFamily: "Inter_700Bold", color: colors.primary },
    weatherSummaryBox: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    weatherSummaryText: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.foreground, flex: 1 },
    divider:     { height: 1, backgroundColor: colors.border, marginBottom: 12 },
    entryRow:    {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      padding: 14,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    entryHeader: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
    unitBadge:   { backgroundColor: colors.primary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginRight: 8 },
    unitBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
    vehicleNum:  { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.foreground, flex: 1 },
    shiftBadge:  { backgroundColor: colors.secondary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
    shiftBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground },
    partnerText: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.mutedForeground, marginBottom: 8 },
    locationRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    locationName: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground, flex: 1 },
    statusChip: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
    statusChipText: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
    weatherRow: { flexDirection: "row", alignItems: "center", marginTop: 8, gap: 6 },
    weatherPill: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
    weatherPillText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
    emptyContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
    emptyText: { fontSize: 15, fontFamily: "Inter_500Medium", color: colors.mutedForeground, textAlign: "center", marginTop: 12 },
  });

  const arrivedCount = entries.filter((e: any) => e.arrived).length;

  return (
    <View style={styles.container}>
      <View style={styles.headerBar}>
        <View style={styles.headerTopRow}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerLabel}>Deployment Report</Text>
            <Text style={styles.headerDate}>{today}</Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.refreshBtn} onPress={toggleTheme}>
              <Feather name={isDark ? "sun" : "moon"} size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.refreshBtn} onPress={handleRefresh}>
              <Feather name="refresh-cw" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.copyBtn} onPress={handleCopy}>
              <Feather name={copied ? "check" : "copy"} size={14} color={copied ? colors.accent : colors.foreground} />
              <Text style={styles.copyBtnText}>{copied ? "Copied!" : "Copy"}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {lastUpdated && (
          <View style={styles.updatedRow}>
            <Feather name="clock" size={12} color={colors.mutedForeground} />
            <Text style={styles.updatedText}>Last updated: {sgTime(lastUpdated)} SGT</Text>
          </View>
        )}
      </View>

      {isLoading && entries.length === 0 ? (
        <View style={styles.emptyContainer}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
          <View style={styles.summaryRow}>
            <View style={{ alignItems: "center" }}>
              <Text style={styles.summaryLabel}>Deployed</Text>
              <Text style={styles.summaryCount}>{entries.length}</Text>
            </View>
            <View style={{ alignItems: "center" }}>
              <Text style={styles.summaryLabel}>Arrived</Text>
              <Text style={[styles.summaryCount, { color: colors.accent }]}>{arrivedCount}/{entries.length}</Text>
            </View>
            <View style={{ alignItems: "center" }}>
              <Text style={styles.summaryLabel}>Assigned</Text>
              <Text style={[styles.summaryCount, { color: colors.primary }]}>{pendingOnly.length}</Text>
            </View>
          </View>

          {weatherSummary && (
            <View style={styles.weatherSummaryBox}>
              <Feather name="cloud-rain" size={14} color={colors.mutedForeground} />
              <Text style={styles.weatherSummaryText}>{weatherSummary}</Text>
            </View>
          )}

          {/* ── HRW / Tide info row ── */}
          {(activeAlert?.extracted || tide) && (
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
              {activeAlert?.extracted && (
                <View style={{
                  flex: 1, flexDirection: "row", alignItems: "flex-start", gap: 6,
                  backgroundColor: "#EF444418", borderRadius: colors.radius,
                  borderWidth: 1, borderColor: "#EF4444AA",
                  padding: 10,
                }}>
                  <Text style={{ fontSize: 14, marginTop: 1 }}>🚨</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#EF4444", letterSpacing: 0.6, marginBottom: 2 }}>
                      HRW — MSS
                    </Text>
                    <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: colors.foreground, lineHeight: 17 }}>
                      {activeAlert.extracted}
                    </Text>
                  </View>
                </View>
              )}
              {tide && (
                <View style={{
                  alignItems: "center", justifyContent: "center",
                  backgroundColor: "#0ea5e918", borderRadius: colors.radius,
                  borderWidth: 1, borderColor: "#0ea5e9AA",
                  paddingHorizontal: 14, paddingVertical: 10, minWidth: 90,
                }}>
                  <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#38bdf8", letterSpacing: 0.6, marginBottom: 2 }}>
                    🌊 TIDE
                  </Text>
                  <Text style={{ fontSize: 20, fontFamily: "Inter_700Bold", color: "#38bdf8", lineHeight: 24 }}>
                    {tide.height.toFixed(2)}m
                  </Text>
                  <Text style={{ fontSize: 16, color: tide.rising ? "#34d399" : "#f87171", fontFamily: "Inter_700Bold" }}>
                    {tide.rising ? "↑" : "↓"}
                  </Text>
                </View>
              )}
            </View>
          )}

          <View style={styles.divider} />

          {entries.length === 0 && pendingOnly.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Feather name="file-text" size={40} color={colors.mutedForeground} />
              <Text style={styles.emptyText}>No deployments or assignments yet</Text>
            </View>
          ) : null}

          {/* ── Deployed (accepted) entries ── */}
          {entries.length > 0 && (
            <>
              <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.accent, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
                ✅ Deployed ({entries.length})
              </Text>
              {[...entries]
              .sort((a, b) => unitSortKey(a.unitCode) - unitSortKey(b.unitCode))
              .map((entry) => {
                const loc = deploymentState?.presetLocations?.find((l) => l.id === entry.locationId);
                const arrived = (entry as any).arrived as boolean;
                const arrivedAt = (entry as any).arrivedAt as string | null;
                const serverEta = (entry as any).eta as string;
                const weather = (entry as any).weather as string | null;
                const w = weatherInfo(weather);

                // For this crew member's own entry, use the live ETA from GPS context (updates every 15s)
                const isMyEntry = userInfo && entry.vehicleId === userInfo.vehicleId && entry.locationId === acceptedLocationId;
                const displayEta = isMyEntry && liveEtaString ? liveEtaString : serverEta;
                const displayEtaMin = isMyEntry && liveEtaMinutes != null ? liveEtaMinutes : null;

                return (
                  <View key={`${entry.locationId}-${entry.vehicleId}`} style={styles.entryRow}>
                    <View style={styles.entryHeader}>
                      <View style={styles.unitBadge}>
                        <Text style={styles.unitBadgeText}>{entry.unitCode}</Text>
                      </View>
                      <Text style={styles.vehicleNum}>{entry.vehicleNumber}</Text>
                      <View style={styles.shiftBadge}>
                        <Text style={styles.shiftBadgeText}>{entry.shift}</Text>
                      </View>
                    </View>

                    <Text style={styles.partnerText}>{entry.partner}</Text>

                    <View style={styles.locationRow}>
                      <Text style={styles.locationName}>{loc?.name ?? entry.locationId}</Text>
                      <View style={[
                        styles.statusChip,
                        { backgroundColor: arrived ? colors.accent : colors.primary },
                      ]}>
                        <Text style={styles.statusChipText}>
                          {arrived && arrivedAt
                            ? `✓ ${arrivedAt} hrs`
                            : `ETA ${displayEta} hrs${displayEtaMin != null ? ` · ${displayEtaMin}min` : ""}${!arrived && (entry as any).fromRoad ? ` from ${(entry as any).fromRoad}` : ""}`}
                        </Text>
                      </View>
                    </View>

                    {weather && (
                      <View style={styles.weatherRow}>
                        <View style={[styles.weatherPill, { borderColor: w.color + "88", backgroundColor: w.color + "18" }]}>
                          <Text style={{ fontSize: 13 }}>{w.emoji}</Text>
                          <Text style={[styles.weatherPillText, { color: w.color }]}>{w.label}</Text>
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}
            </>
          )}

          {/* ── Pending assignments (assigned but not yet accepted) ── */}
          {pendingOnly.length > 0 && (
            <>
              <View style={{ height: 12 }} />
              <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.primary, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
                ⏳ Assigned — Awaiting Crew ({pendingOnly.length})
              </Text>
              {pendingOnly.map((a) => {
                const rosterTeams: any[] = (deploymentState as any)?.rosterTeams ?? [];
                const team = rosterTeams.find((t: any) =>
                  `${t.unitCode}-${t.vehicleNumber}` === a.vehicleId || t.unitCode === a.unitCode
                );
                const partner = team?.partner ?? (a.partner ?? "");
                const shift = a.shift ?? team?.shift ?? "";
                return (
                  <View key={a.vehicleId} style={[styles.entryRow, { borderLeftWidth: 3, borderLeftColor: colors.primary }]}>
                    <View style={styles.entryHeader}>
                      <View style={[styles.unitBadge, { backgroundColor: colors.primary }]}>
                        <Text style={styles.unitBadgeText}>{a.unitCode}</Text>
                      </View>
                      <Text style={styles.vehicleNum}>{a.vehicleNumber}</Text>
                      {shift ? (
                        <View style={styles.shiftBadge}>
                          <Text style={styles.shiftBadgeText}>{shift}</Text>
                        </View>
                      ) : null}
                    </View>
                    {partner ? <Text style={styles.partnerText}>{partner}</Text> : null}
                    <View style={styles.locationRow}>
                      <Text style={styles.locationName}>📍 {a.locationName}</Text>
                      <View style={[styles.statusChip, { backgroundColor: colors.primary + "33", borderWidth: 1, borderColor: colors.primary }]}>
                        <Text style={[styles.statusChipText, { color: colors.primary }]}>Assigned</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}
