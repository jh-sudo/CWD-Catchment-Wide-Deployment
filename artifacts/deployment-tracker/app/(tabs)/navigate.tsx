import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://cwd.pub-soarhco.stg.paas.sandbox.gov.sg";

export default function CrmsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { userInfo } = useApp();

  const [myCrmsCases, setMyCrmsCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [crmsComment, setCrmsComment] = useState<Record<string, string>>({});
  const [crmsCommentSending, setCrmsCommentSending] = useState<Record<string, boolean>>({});
  const [crmsResolving, setCrmsResolving] = useState<Record<string, boolean>>({});
  const [crmsResolvePending, setCrmsResolvePending] = useState<Record<string, boolean>>({});

  const loadCases = async (quiet = false) => {
    if (!userInfo) return;
    if (!quiet) setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/crms`, { cache: "no-store" });
      const d = await r.json();
      setMyCrmsCases((d.cases ?? []).filter((c: any) => c.assignedVehicleId === userInfo.vehicleId && c.status !== "RESOLVED"));
    } catch {}
    if (!quiet) setLoading(false);
  };

  useEffect(() => {
    loadCases();
    const id = setInterval(() => loadCases(true), 20000);
    return () => clearInterval(id);
  }, [userInfo?.vehicleId]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadCases(true);
    setRefreshing(false);
  };

  const sendCrmsComment = async (caseId: string) => {
    const text = crmsComment[caseId]?.trim();
    if (!text || !userInfo) return;
    setCrmsCommentSending(p => ({ ...p, [caseId]: true }));
    try {
      await fetch(`${API_BASE}/api/crms/${caseId}/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicleId: userInfo.vehicleId, unitCode: userInfo.unitCode, text }),
      });
      setCrmsComment(p => ({ ...p, [caseId]: "" }));
      await loadCases(true);
    } catch {}
    setCrmsCommentSending(p => ({ ...p, [caseId]: false }));
  };

  const resolveCrmsCase = async (caseId: string) => {
    if (!userInfo) return;
    if (!crmsResolvePending[caseId]) {
      setCrmsResolvePending(p => ({ ...p, [caseId]: true }));
      setTimeout(() => setCrmsResolvePending(p => ({ ...p, [caseId]: false })), 5000);
      return;
    }
    setCrmsResolvePending(p => ({ ...p, [caseId]: false }));
    setCrmsResolving(p => ({ ...p, [caseId]: true }));
    try {
      const res = await fetch(`${API_BASE}/api/crms/${caseId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicleId: userInfo.vehicleId, unitCode: userInfo.unitCode }),
      });
      if (res.ok) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setMyCrmsCases(p => p.filter(c => c.id !== caseId));
      } else {
        const err = await res.json().catch(() => ({}));
        Alert.alert("Could not resolve", err.error ?? "Server error — try again.");
      }
    } catch {
      Alert.alert("Error", "Could not reach server. Check your connection.");
    }
    setCrmsResolving(p => ({ ...p, [caseId]: false }));
  };

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16),
      paddingHorizontal: 20,
      paddingBottom: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.card,
    },
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    headerLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#a78bfa", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 3 },
    headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: colors.foreground },
    badgePill: {
      backgroundColor: "#7c3aed33",
      borderRadius: 20,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderWidth: 1,
      borderColor: "#7c3aed88",
    },
    badgeText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#c4b5fd" },
    scroll: { flex: 1 },
    scrollContent: { padding: 16, paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 20 },
    emptyBox: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80, paddingHorizontal: 40 },
    emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: colors.foreground, textAlign: "center", marginTop: 16, marginBottom: 8 },
    emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center", lineHeight: 20 },
    card: {
      backgroundColor: "#0f0c24",
      borderRadius: 14,
      borderWidth: 1,
      borderColor: "rgba(124,58,237,0.3)",
      padding: 14,
      marginBottom: 14,
    },
    cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
    caseNum: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#c4b5fd" },
    statusPill: { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 },
    statusText: { fontSize: 10, fontFamily: "Inter_700Bold" },
    address: { fontSize: 12, color: colors.mutedForeground, marginBottom: 4 },
    person: { fontSize: 12, color: colors.foreground, marginBottom: 2 },
    details: { fontSize: 11, color: colors.mutedForeground, marginBottom: 10 },
    commentItem: {
      backgroundColor: colors.secondary,
      borderRadius: 6,
      padding: 7,
      marginBottom: 5,
    },
    commentMeta: { fontSize: 10, color: colors.mutedForeground, marginBottom: 2 },
    commentText: { fontSize: 12, color: colors.foreground },
    inputRow: { flexDirection: "row", gap: 8, alignItems: "flex-end", marginBottom: 10 },
    textInput: {
      flex: 1,
      backgroundColor: colors.input,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      color: colors.foreground,
      padding: 8,
      fontSize: 12,
      minHeight: 38,
    },
    sendBtn: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
    sendBtnText: { color: "#7c3aed", fontSize: 13, fontFamily: "Inter_600SemiBold" },
    resolveRow: { flexDirection: "row", gap: 8 },
    resolveBtn: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 10,
      paddingVertical: 11,
      borderWidth: 1.5,
    },
    resolveBtnText: { fontSize: 13, fontFamily: "Inter_700Bold" },
    cancelBtn: {
      paddingHorizontal: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.secondary,
      borderRadius: 10,
      paddingVertical: 11,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cancelBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground },
    singleResolveBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      backgroundColor: "#166534",
      borderRadius: 10,
      paddingVertical: 11,
      borderWidth: 1,
      borderColor: "#16a34a",
    },
  });

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.headerLabel}>Field Cases</Text>
        <View style={s.headerRow}>
          <Text style={s.headerTitle}>My CRMS Cases</Text>
          {myCrmsCases.length > 0 && (
            <View style={s.badgePill}>
              <Text style={s.badgeText}>{myCrmsCases.length}</Text>
            </View>
          )}
        </View>
      </View>

      {loading ? (
        <View style={s.emptyBox}>
          <ActivityIndicator size="large" color="#7c3aed" />
        </View>
      ) : myCrmsCases.length === 0 ? (
        <ScrollView
          contentContainerStyle={s.emptyBox}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#7c3aed" />}
        >
          <Feather name="clipboard" size={48} color={colors.mutedForeground} />
          <Text style={s.emptyTitle}>No Cases Assigned</Text>
          <Text style={s.emptyText}>
            Cases assigned to your vehicle will appear here. Pull down to refresh.
          </Text>
        </ScrollView>
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#7c3aed" />}
        >
          {myCrmsCases.map(c => (
            <View key={c.id} style={s.card}>
              <View style={s.cardHeader}>
                <Text style={s.caseNum}>{c.isWog ? "WOG " : ""}CRMS #{c.caseNumber}</Text>
                <View style={[s.statusPill, { backgroundColor: c.status === "OPEN" ? "#ef444433" : "#f59e0b33" }]}>
                  <Text style={[s.statusText, { color: c.status === "OPEN" ? "#fca5a5" : "#fcd34d" }]}>{c.status}</Text>
                </View>
              </View>

              <Text style={s.address}>📍 {c.address}</Text>
              <Text style={s.person}>👤 {c.fpName} · {c.fpContact}</Text>
              {c.details ? <Text style={s.details}>{c.details}</Text> : null}

              {c.comments?.length > 0 && (
                <View style={{ marginBottom: 8 }}>
                  {c.comments.map((cm: any) => (
                    <View key={cm.commentId} style={s.commentItem}>
                      <Text style={s.commentMeta}>{cm.unitCode} · {new Date(cm.createdAt).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" })}</Text>
                      <Text style={s.commentText}>{cm.text}</Text>
                    </View>
                  ))}
                </View>
              )}

              <View style={s.inputRow}>
                <TextInput
                  style={s.textInput}
                  value={crmsComment[c.id] ?? ""}
                  onChangeText={t => setCrmsComment(p => ({ ...p, [c.id]: t }))}
                  placeholder="Add field comment…"
                  placeholderTextColor="#475569"
                  multiline
                />
                <TouchableOpacity
                  onPress={() => sendCrmsComment(c.id)}
                  disabled={!crmsComment[c.id]?.trim() || crmsCommentSending[c.id]}
                  style={[s.sendBtn, { backgroundColor: crmsComment[c.id]?.trim() ? "#7c3aed" : "#1e1b4b", opacity: crmsCommentSending[c.id] ? 0.6 : 1 }]}
                >
                  <Text style={s.sendBtnText}>{crmsCommentSending[c.id] ? "…" : "Send"}</Text>
                </TouchableOpacity>
              </View>

              {crmsResolvePending[c.id] ? (
                <View style={s.resolveRow}>
                  <TouchableOpacity
                    onPress={() => resolveCrmsCase(c.id)}
                    style={[s.resolveBtn, { flex: 1, backgroundColor: "#15803d", borderColor: "#4ade80" }]}
                  >
                    <Text style={[s.resolveBtnText, { color: "#4ade80" }]}>✅  Confirm Resolved</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setCrmsResolvePending(p => ({ ...p, [c.id]: false }))}
                    style={s.cancelBtn}
                  >
                    <Text style={s.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => resolveCrmsCase(c.id)}
                  disabled={crmsResolving[c.id]}
                  style={[s.singleResolveBtn, { opacity: crmsResolving[c.id] ? 0.5 : 1 }]}
                >
                  {crmsResolving[c.id]
                    ? <ActivityIndicator size="small" color="#4ade80" />
                    : <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: "#4ade80" }}>✅  Mark Case Resolved</Text>
                  }
                </TouchableOpacity>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
