import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { UserInfo, useApp } from "@/context/AppContext";

const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ?? "https://example-project.example-team.stg.paas.sandbox.gov.sg";

const UNIT_CODES = [
  "BU1", "BU2", "BU3", "BU4", "BU5",
  "PJ1", "PJ2", "PJ3", "PJ4", "PJ5",
  "WK1", "WK2", "WK3",
  "CP1", "CP2", "CP3", "CP4", "CP5",
  "KG1", "KG2", "KG3", "KG4", "KG5",
];

const TEAMS = ["BU", "PJ", "WK", "CP", "KG"];

const SHIFTS = ["PD", "Day", "ND"];

interface RosterTeam {
  id: string;
  unitCode: string;
  vehicleNumber: string;
  partner: string;
  shift: string;
}

interface AlertData {
  id: string;
  extracted: string;
  broadcastAt: string;
  acknowledgments: string[];
}

// role → crew loading/picker/form, or manager direct
type Screen = "role" | "loading" | "alert" | "roster" | "manual";

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { login, loginAsManager, userInfo } = useApp();

  const [screen, setScreen] = useState<Screen>("loading");
  const [rosterTeams, setRosterTeams] = useState<RosterTeam[]>([]);
  const [alertData, setAlertData] = useState<AlertData | null>(null);
  const [rosterFilter, setRosterFilter] = useState<Set<string>>(new Set());

  // Crew PIN modal
  const [crewPinModalVisible, setCrewPinModalVisible] = useState(false);
  const [crewPinValue, setCrewPinValue] = useState("");
  const [crewPinError, setCrewPinError] = useState("");
  const [crewPinLoading, setCrewPinLoading] = useState(false);

  // Manager PIN modal
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinLoading, setPinLoading] = useState(false);

  // Manual form state
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [selectedTeam, setSelectedTeam] = useState("BU");
  const [selectedUnit, setSelectedUnit] = useState("BU1");
  const [partner1, setPartner1] = useState("");
  const [partner2, setPartner2] = useState("");
  const [selectedShift, setSelectedShift] = useState("PD");
  const [error, setError] = useState("");

  // Auto-start crew flow on mount — /crew is crew-only, no role picker needed
  useEffect(() => { startCrewFlow(); }, []);

  const goCrew = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCrewPinValue("");
    setCrewPinError("");
    setCrewPinModalVisible(true);
  };

  const submitCrewPin = async () => {
    if (!crewPinValue.trim()) { setCrewPinError("Enter the crew PIN."); return; }
    setCrewPinLoading(true); setCrewPinError("");
    try {
      const res = await fetch(`${API_BASE}/api/crew-pin/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: crewPinValue.trim() }),
      });
      if (res.ok) {
        setCrewPinModalVisible(false);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        startCrewFlow();
      } else {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setCrewPinError("Incorrect PIN. Try again.");
      }
    } catch {
      setCrewPinError("Could not connect. Check your connection.");
    } finally {
      setCrewPinLoading(false);
    }
  };

  const startCrewFlow = () => {
    setScreen("loading");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    fetch(`${API_BASE}/api/deployments/state`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        clearTimeout(timer);
        const activeShifts: string[] = data.activeShifts ?? [];
        const allTeams: RosterTeam[] = data.rosterTeams ?? [];
        // Only show teams whose shift is currently active (as set by the manager)
        const teams = activeShifts.length > 0
          ? allTeams.filter((t) => activeShifts.includes(t.shift))
          : allTeams;
        const alert: AlertData | null = data.activeAlert ?? null;
        setRosterTeams(teams);
        setAlertData(alert);
        if (alert) {
          setScreen("alert");
        } else if (teams.length > 0) {
          setScreen("roster");
        } else {
          setScreen("manual");
        }
      })
      .catch(() => { clearTimeout(timer); setScreen("manual"); });
  };

  const goManager = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPinValue("");
    setPinError("");
    setPinModalVisible(true);
  };

  const submitPin = async () => {
    if (!pinValue.trim()) { setPinError("Enter the manager PIN."); return; }
    setPinLoading(true); setPinError("");
    try {
      const res = await fetch(`${API_BASE}/api/manager-pin/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pinValue.trim() }),
      });
      if (res.ok) {
        setPinModalVisible(false);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        loginAsManager(pinValue.trim());
        router.replace("/(tabs)/manager");
      } else {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setPinError("Incorrect PIN. Try again.");
      }
    } catch {
      setPinError("Could not connect. Check your connection.");
    } finally {
      setPinLoading(false);
    }
  };

  const handleTeamSelect = async (team: RosterTeam) => {
    if (screen === "alert" && alertData) {
      try {
        await fetch(`${API_BASE}/api/alert/acknowledge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unitCode: team.unitCode }),
        });
      } catch {
        // ignore
      }
    }
    const vehicleId = team.vehicleNumber
      ? `${team.unitCode}-${team.vehicleNumber}`
      : `${team.unitCode}-${Date.now()}`;
    const parts = team.partner.split(" & ");
    const info: UserInfo = {
      vehicleId,
      vehicleNumber: team.vehicleNumber || team.unitCode,
      unitCode: team.unitCode,
      partner1: parts[0]?.trim() ?? team.partner,
      partner2: parts[1]?.trim() ?? "",
      shift: team.shift,
    };
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    login(info);
    router.replace("/(tabs)/map");
  };

  const handleManualStart = async () => {
    if (!vehicleNumber.trim()) { setError("Please enter a vehicle number"); return; }
    if (!partner1.trim()) { setError("Please enter at least one officer name"); return; }
    setError("");
    const info: UserInfo = {
      vehicleId: `${selectedUnit}-${vehicleNumber.trim().toUpperCase()}`,
      vehicleNumber: vehicleNumber.trim().toUpperCase(),
      unitCode: selectedUnit,
      partner1: partner1.trim(),
      partner2: partner2.trim(),
      shift: selectedShift,
    };
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    login(info);
    router.replace("/(tabs)/map");
  };

  const c = colors;
  const pad = insets.top + (Platform.OS === "web" ? 67 : 24);

  // ── Role picker ────────────────────────────────────────────────────────────
  if (screen === "role") {
    return (
      <>
        <View style={[st.fill, { backgroundColor: c.background }]}>
          <ScrollView contentContainerStyle={[st.rolePad, { paddingTop: pad, paddingBottom: insets.bottom + 32 }]}>
            <Text style={[st.appTag, { color: c.primary }]}>Deployment System</Text>
            <Text style={[st.bigTitle, { color: c.foreground }]}>Who are you?</Text>
            <Text style={[st.bigSub, { color: c.mutedForeground }]}>
              Select your role to continue
            </Text>

            {/* Crew card */}
            <TouchableOpacity
              style={[st.roleCard, { backgroundColor: c.card, borderColor: c.primary }]}
              onPress={goCrew}
              activeOpacity={0.8}
            >
              <View style={[st.roleIcon, { backgroundColor: c.primary + "22" }]}>
                <Text style={st.roleEmoji}>🚔</Text>
              </View>
              <View style={st.roleText}>
                <Text style={[st.roleTitle, { color: c.foreground }]}>Crew Member</Text>
                <Text style={[st.roleSub, { color: c.mutedForeground }]}>
                  Log in with your unit, vehicle and shift details
                </Text>
              </View>
              <Text style={[st.roleArrow, { color: c.primary }]}>›</Text>
            </TouchableOpacity>

            {/* Manager card */}
            <TouchableOpacity
              style={[st.roleCard, { backgroundColor: c.card, borderColor: c.border }]}
              onPress={goManager}
              activeOpacity={0.8}
            >
              <View style={[st.roleIcon, { backgroundColor: c.mutedForeground + "22" }]}>
                <Text style={st.roleEmoji}>🗺️</Text>
              </View>
              <View style={st.roleText}>
                <Text style={[st.roleTitle, { color: c.foreground }]}>Manager</Text>
                <Text style={[st.roleSub, { color: c.mutedForeground }]}>
                  View live vehicle positions, assign locations and load rosters
                </Text>
              </View>
              <Text style={[st.roleArrow, { color: c.mutedForeground }]}>›</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>

        {/* ── Crew PIN Modal ── */}
        <Modal
          visible={crewPinModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => { if (!crewPinLoading) setCrewPinModalVisible(false); }}
        >
          <View style={st.pinOverlay}>
            <View style={[st.pinBox, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[st.pinTitle, { color: c.foreground }]}>Crew Access</Text>
              <Text style={[st.pinSub, { color: c.mutedForeground }]}>Enter the crew PIN to continue</Text>
              <TextInput
                style={[st.pinInput, { backgroundColor: c.background, borderColor: c.border, color: c.foreground }]}
                value={crewPinValue}
                onChangeText={setCrewPinValue}
                placeholder="PIN"
                placeholderTextColor={c.mutedForeground}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={8}
                autoFocus
                onSubmitEditing={submitCrewPin}
              />
              {crewPinError ? <Text style={st.pinError}>{crewPinError}</Text> : null}
              <View style={st.pinActions}>
                <TouchableOpacity
                  style={[st.pinBtn, { backgroundColor: c.mutedForeground + "22" }]}
                  onPress={() => { if (!crewPinLoading) { setCrewPinModalVisible(false); setCrewPinValue(""); setCrewPinError(""); } }}
                  disabled={crewPinLoading}
                >
                  <Text style={[st.pinBtnText, { color: c.mutedForeground }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[st.pinBtn, { backgroundColor: c.primary, opacity: crewPinLoading ? 0.6 : 1 }]}
                  onPress={submitCrewPin}
                  disabled={crewPinLoading}
                >
                  {crewPinLoading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={[st.pinBtnText, { color: "#fff" }]}>Enter</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* ── Manager PIN Modal ── */}
        <Modal
          visible={pinModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => { if (!pinLoading) setPinModalVisible(false); }}
        >
          <View style={st.pinOverlay}>
            <View style={[st.pinBox, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[st.pinTitle, { color: c.foreground }]}>Manager Access</Text>
              <Text style={[st.pinSub, { color: c.mutedForeground }]}>Enter the manager PIN to continue</Text>
              <TextInput
                style={[st.pinInput, { backgroundColor: c.background, borderColor: c.border, color: c.foreground }]}
                value={pinValue}
                onChangeText={setPinValue}
                placeholder="PIN"
                placeholderTextColor={c.mutedForeground}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={8}
                autoFocus
                onSubmitEditing={submitPin}
              />
              {pinError ? <Text style={st.pinError}>{pinError}</Text> : null}
              <View style={st.pinActions}>
                <TouchableOpacity
                  style={[st.pinBtn, { backgroundColor: c.mutedForeground + "22" }]}
                  onPress={() => { if (!pinLoading) { setPinModalVisible(false); setPinValue(""); setPinError(""); } }}
                  disabled={pinLoading}
                >
                  <Text style={[st.pinBtnText, { color: c.mutedForeground }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[st.pinBtn, { backgroundColor: c.primary, opacity: pinLoading ? 0.6 : 1 }]}
                  onPress={submitPin}
                  disabled={pinLoading}
                >
                  {pinLoading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={[st.pinBtnText, { color: "#fff" }]}>Enter</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (screen === "loading") {
    return (
      <View style={[st.fill, st.center, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.primary} size="large" />
        <Text style={[st.loadingText, { color: c.mutedForeground }]}>Checking today's roster…</Text>
      </View>
    );
  }

  // ── Alert or roster picker ─────────────────────────────────────────────────
  if (screen === "alert" || screen === "roster") {
    return (
      <ScrollView
        style={[st.fill, { backgroundColor: c.background }]}
        contentContainerStyle={[st.rolePad, { paddingTop: pad, paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[st.appTag, { color: c.primary }]}>Crew Login</Text>

        {screen === "alert" && alertData ? (
          <>
            <Text style={[st.bigTitle, { color: c.foreground }]}>⚠️ Alert Active</Text>
            <Text style={[st.bigSub, { color: c.mutedForeground }]}>
              Acknowledge by selecting your team below
            </Text>
            <View style={[st.alertBanner, { borderColor: "rgba(239,68,68,0.5)", backgroundColor: "rgba(239,68,68,0.1)" }]}>
              <Text style={st.alertLabel}>NEA WEATHER ALERT</Text>
              <Text style={[st.alertBody, { color: c.foreground }]}>{alertData.extracted}</Text>
            </View>
          </>
        ) : (
          <>
            <Text style={[st.bigTitle, { color: c.foreground }]}>Select Your Team</Text>
            <Text style={[st.bigSub, { color: c.mutedForeground }]}>
              Today's roster — tap your team to continue
            </Text>
          </>
        )}

        <Text style={[st.listLabel, { color: c.mutedForeground }]}>
          {screen === "alert" ? "TAP TO ACKNOWLEDGE & ENTER" : "TODAY'S DEPLOYMENT"}
        </Text>

        {/* Team filter chips — multi-select */}
        {rosterTeams.length > 0 && (
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {["ALL", ...TEAMS.filter(t => rosterTeams.some(r => r.unitCode.startsWith(t)))].map((chip) => {
              const isAll = chip === "ALL";
              const active = isAll ? rosterFilter.size === 0 : rosterFilter.has(chip);
              return (
                <TouchableOpacity
                  key={chip}
                  onPress={() => {
                    if (isAll) {
                      setRosterFilter(new Set());
                    } else {
                      setRosterFilter(prev => {
                        const next = new Set(prev);
                        if (next.has(chip)) next.delete(chip); else next.add(chip);
                        return next;
                      });
                    }
                  }}
                  style={{
                    paddingHorizontal: 14, paddingVertical: 5, borderRadius: 16,
                    borderWidth: 1,
                    borderColor: active ? c.primary : c.border,
                    backgroundColor: active ? c.primary : "transparent",
                  }}
                >
                  <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: active ? "#fff" : c.mutedForeground }}>
                    {chip}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {rosterTeams.filter(team => rosterFilter.size === 0 || rosterFilter.has(team.unitCode.slice(0, 2))).map((team) => (
          <TouchableOpacity
            key={team.id}
            style={[st.teamRow, { backgroundColor: c.card, borderColor: c.border }]}
            onPress={() => handleTeamSelect(team)}
            activeOpacity={0.75}
          >
            <View style={[st.avatar, { backgroundColor: c.primary }]}>
              <Text style={st.avatarText}>{team.unitCode.slice(0, 2)}</Text>
            </View>
            <View style={st.teamInfo}>
              <Text style={[st.teamUnit, { color: c.foreground }]}>
                {team.unitCode}{team.vehicleNumber ? `  ${team.vehicleNumber}` : ""}
              </Text>
              <Text style={[st.teamPartner, { color: c.mutedForeground }]}>{team.partner}</Text>
            </View>
            <View style={[st.shiftBadge, { backgroundColor: c.primary + "20" }]}>
              <Text style={[st.shiftBadgeText, { color: c.primary }]}>{team.shift}</Text>
            </View>
          </TouchableOpacity>
        ))}

        <TouchableOpacity style={st.switchRow} onPress={() => setScreen("manual")}>
          <Text style={[st.switchText, { color: c.mutedForeground }]}>
            Not listed? <Text style={[st.switchBold, { color: c.primary }]}>Enter manually →</Text>
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={st.switchRow} onPress={() => startCrewFlow()}>
          <Text style={[st.switchText, { color: c.mutedForeground }]}>← Refresh roster</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ── Manual form ────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={[st.fill, { backgroundColor: c.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[st.rolePad, { paddingTop: pad, paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity onPress={() => setScreen(rosterTeams.length > 0 || alertData ? (alertData ? "alert" : "roster") : "loading")}>
          <Text style={[st.backLink, { color: c.primary }]}>
            ← {rosterTeams.length > 0 || alertData ? "Back to roster" : "Refresh roster"}
          </Text>
        </TouchableOpacity>

        <View style={{ marginBottom: 28, marginTop: 8 }}>
          <Text style={[st.appTag, { color: c.primary }]}>Crew Login</Text>
          <Text style={[st.bigTitle, { color: c.foreground }]}>Manual Sign In</Text>
          <Text style={[st.bigSub, { color: c.mutedForeground }]}>Enter your vehicle and unit details</Text>
        </View>

        {/* Vehicle plate */}
        <View style={st.field}>
          <Text style={[st.fieldLabel, { color: c.mutedForeground }]}>Vehicle Plate Number</Text>
          <TextInput
            style={[st.input, { backgroundColor: c.card, borderColor: c.border, color: c.foreground }]}
            value={vehicleNumber}
            onChangeText={setVehicleNumber}
            placeholder="e.g. TST0004A"
            placeholderTextColor={c.mutedForeground}
            autoCapitalize="characters"
            returnKeyType="next"
          />
        </View>

        {/* Team */}
        <View style={st.field}>
          <Text style={[st.fieldLabel, { color: c.mutedForeground }]}>Team</Text>
          <View style={st.shiftRow}>
            {TEAMS.map((team) => (
              <TouchableOpacity
                key={team}
                style={[st.shiftBtn, {
                  backgroundColor: selectedTeam === team ? c.accent : c.card,
                  borderColor: selectedTeam === team ? c.accent : c.border,
                }]}
                onPress={() => {
                  setSelectedTeam(team);
                  const first = UNIT_CODES.find((u) => u.startsWith(team));
                  if (first) setSelectedUnit(first);
                }}
              >
                <Text style={[st.shiftBtnText, { color: selectedTeam === team ? "#fff" : c.mutedForeground }]}>
                  {team}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Unit code — filtered by team */}
        <View style={st.field}>
          <Text style={[st.fieldLabel, { color: c.mutedForeground }]}>Unit Code</Text>
          <View style={st.chipGrid}>
            {UNIT_CODES.filter((code) => code.startsWith(selectedTeam)).map((code) => (
              <TouchableOpacity
                key={code}
                style={[st.chip, {
                  backgroundColor: selectedUnit === code ? c.primary : c.card,
                  borderColor: selectedUnit === code ? c.primary : c.border,
                }]}
                onPress={() => setSelectedUnit(code)}
              >
                <Text style={[st.chipText, { color: selectedUnit === code ? "#fff" : c.mutedForeground }]}>
                  {code}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Officer 1 */}
        <View style={st.field}>
          <Text style={[st.fieldLabel, { color: c.mutedForeground }]}>Officer 1 Name</Text>
          <TextInput
            style={[st.input, { backgroundColor: c.card, borderColor: c.border, color: c.foreground }]}
            value={partner1}
            onChangeText={setPartner1}
            placeholder="First officer"
            placeholderTextColor={c.mutedForeground}
            autoCapitalize="words"
          />
        </View>

        {/* Officer 2 */}
        <View style={st.field}>
          <Text style={[st.fieldLabel, { color: c.mutedForeground }]}>Officer 2 Name (optional)</Text>
          <TextInput
            style={[st.input, { backgroundColor: c.card, borderColor: c.border, color: c.foreground }]}
            value={partner2}
            onChangeText={setPartner2}
            placeholder="Second officer"
            placeholderTextColor={c.mutedForeground}
            autoCapitalize="words"
          />
        </View>

        {/* Shift */}
        <View style={st.field}>
          <Text style={[st.fieldLabel, { color: c.mutedForeground }]}>Shift</Text>
          <View style={st.shiftRow}>
            {SHIFTS.map((shift) => (
              <TouchableOpacity
                key={shift}
                style={[st.shiftBtn, {
                  backgroundColor: selectedShift === shift ? c.primary : c.card,
                  borderColor: selectedShift === shift ? c.primary : c.border,
                }]}
                onPress={() => setSelectedShift(shift)}
              >
                <Text style={[st.shiftBtnText, { color: selectedShift === shift ? "#fff" : c.mutedForeground }]}>
                  {shift}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {error ? <Text style={st.errorText}>{error}</Text> : null}

        <Pressable
          style={({ pressed }) => [st.submitBtn, { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 }]}
          onPress={handleManualStart}
          testID="start-deployment-btn"
        >
          <Text style={st.submitBtnText}>Start Deployment</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Static styles (no dynamic colors — those are applied inline above)
const st = StyleSheet.create({
  fill: { flex: 1 },
  center: { justifyContent: "center", alignItems: "center" },
  rolePad: { paddingHorizontal: 20 },

  appTag: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 3, textTransform: "uppercase", marginBottom: 6 },
  bigTitle: { fontSize: 26, fontFamily: "Inter_700Bold", marginBottom: 6 },
  bigSub: { fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 28, lineHeight: 20 },
  loadingText: { marginTop: 16, fontSize: 14, fontFamily: "Inter_500Medium" },

  // Continue banner (quick session resume)
  continueBanner: {
    flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1.5,
    padding: 14, marginBottom: 18, gap: 12,
  },
  continueAvatar: { width: 40, height: 40, borderRadius: 20, justifyContent: "center", alignItems: "center" },
  continueAvatarText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" },
  continueTitle: { fontSize: 14, fontFamily: "Inter_700Bold", marginBottom: 2 },
  continueSub: { fontSize: 12, fontFamily: "Inter_400Regular" },

  // Role cards
  roleCard: {
    flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1.5,
    padding: 18, marginBottom: 14, gap: 14,
  },
  roleIcon: { width: 52, height: 52, borderRadius: 14, justifyContent: "center", alignItems: "center" },
  roleEmoji: { fontSize: 26 },
  roleText: { flex: 1 },
  roleTitle: { fontSize: 17, fontFamily: "Inter_700Bold", marginBottom: 3 },
  roleSub: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  roleArrow: { fontSize: 28, fontFamily: "Inter_600SemiBold" },

  // Alert banner
  alertBanner: { borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 20 },
  alertLabel: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#ef4444", letterSpacing: 2, marginBottom: 6 },
  alertBody: { fontSize: 14, fontFamily: "Inter_500Medium", lineHeight: 20 },

  // Team list
  listLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 },
  teamRow: { flexDirection: "row", alignItems: "center", borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 8, gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, justifyContent: "center", alignItems: "center" },
  avatarText: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" },
  teamInfo: { flex: 1 },
  teamUnit: { fontSize: 14, fontFamily: "Inter_700Bold" },
  teamPartner: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  shiftBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  shiftBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold" },

  switchRow: { paddingVertical: 10 },
  switchText: { textAlign: "center", fontSize: 13, fontFamily: "Inter_500Medium" },
  switchBold: { fontFamily: "Inter_600SemiBold" },

  // Manual form
  backLink: { fontSize: 13, fontFamily: "Inter_600SemiBold", paddingVertical: 8 },
  field: { marginBottom: 20 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, fontFamily: "Inter_500Medium" },
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  shiftRow: { flexDirection: "row", gap: 10 },
  shiftBtn: { flex: 1, paddingVertical: 13, borderRadius: 10, borderWidth: 1, alignItems: "center" },
  shiftBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  errorText: { color: "#ef4444", fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 12 },
  submitBtn: { borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  submitBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },

  // Manager PIN modal
  pinOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center", padding: 32 },
  pinBox: { width: "100%", borderRadius: 16, borderWidth: 1, padding: 24 },
  pinTitle: { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 4, textAlign: "center" },
  pinSub: { fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 20, textAlign: "center" },
  pinInput: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 14, fontSize: 24, fontFamily: "Inter_700Bold", textAlign: "center", letterSpacing: 8, marginBottom: 8 },
  pinError: { color: "#ef4444", fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "center", marginBottom: 8 },
  pinActions: { flexDirection: "row", gap: 12, marginTop: 12 },
  pinBtn: { flex: 1, borderRadius: 10, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  pinBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
