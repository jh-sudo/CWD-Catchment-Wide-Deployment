import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Callout, Circle, Marker, Overlay, Polyline, PROVIDER_DEFAULT } from "react-native-maps";
import { DARK_MAP_STYLE, LIGHT_MAP_STYLE } from "@/constants/mapStyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getGetDeploymentStateQueryKey,
  getGetLocationsQueryKey,
  useAssignCrew,
  useCreateLocation,
  useDeleteLocation,
  useGetLocations,
  useResetDeployment,
  useUpdateLocation,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useApp } from "@/context/AppContext";
import { useTheme } from "@/context/ThemeContext";
import { useColors } from "@/hooks/useColors";
import { haversineDistance } from "@/data/presetLocations";
import type { PresetLocation, VehiclePosition } from "@workspace/api-client-react";

type LightningSector = { name: string; lat: number; lng: number; cat: string };
function catCircleColors(cat: string) {
  if (cat === "1") return { fill: "rgba(220,38,38,0.38)", stroke: "#dc2626" };
  if (cat === "2") return { fill: "rgba(234,179,8,0.28)", stroke: "#ca8a04" };
  return { fill: "rgba(22,163,74,0.1)", stroke: "rgba(22,163,74,0.3)" };
}

function weatherEmoji(w: string | null | undefined) {
  if (!w) return null;
  if (w.toLowerCase().includes("heavy")) return { emoji: "🔴", color: "#ef4444" };
  if (w.toLowerCase().includes("moderate")) return { emoji: "🟠", color: "#f97316" };
  return { emoji: "🟢", color: "#10b981" };
}

const UNIT_ORDER_MAP: Record<string, number> = { BU: 0, PJ: 1, WK: 2, CP: 3, KG: 4 };
const unitSortKey = (code: string): number => {
  const prefix = code.replace(/\d.*$/, "");
  const num = parseInt(code.replace(/^\D+/, ""), 10) || 0;
  return (UNIT_ORDER_MAP[prefix] ?? 99) * 1000 + num;
};

const UNIT_COLORS: Record<string, string> = {
  BU: "#FFFFCC",
  PJ: "#EDEDED",
  WK: "#FCE4D6",
  CP: "#E2EFDA",
  KG: "#DDEBF7",
};
function unitColor(unitCode: string): string {
  const prefix = (unitCode ?? "").replace(/\d.*$/, "").toUpperCase();
  return UNIT_COLORS[prefix] ?? "#cbd5e1";
}
function unitFg(_code: string): string { return "#1a1a1a"; }

type ViewMode = "map" | "list" | "locations" | "roster" | "alert" | "wls" | "crms";

interface LocationFormData {
  name: string;
  address: string;
  lat: string;
  lng: string;
}
const EMPTY_FORM: LocationFormData = { name: "", address: "", lat: "", lng: "" };

export default function ManagerScreen() {
  const colors = useColors();
  const { isDark, toggle: toggleTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { deploymentState, logout, managerPin } = useApp();
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const [viewMode, setViewMode] = useState<ViewMode>("map");
  const [mapRefreshing, setMapRefreshing] = useState(false);
  const [rosterViewFilter, setRosterViewFilter] = useState<Set<string>>(new Set());
  const [clearPending, setClearPending] = useState(false);
  const [clearCountdown, setClearCountdown] = useState(5);
  const clearTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // When navigated to via Map or CRMS bottom tabs, apply the requested mode
  useFocusEffect(
    React.useCallback(() => {
      if (mode === "crms" || mode === "map" || mode === "list" || mode === "locations" || mode === "roster" || mode === "alert" || mode === "wls") {
        setViewMode(mode as ViewMode);
        router.setParams({ mode: undefined });
      }
    }, [mode])
  );


  // Location form modal
  const [locModalVisible, setLocModalVisible] = useState(false);
  const [editingLocation, setEditingLocation] = useState<PresetLocation | null>(null);
  const [form, setForm] = useState<LocationFormData>(EMPTY_FORM);
  const [formError, setFormError] = useState("");

  // Selected location on map (bottom panel)
  const [selectedMapLoc, setSelectedMapLoc] = useState<PresetLocation | null>(null);

  // Assign crew modal
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [assigningLocation, setAssigningLocation] = useState<PresetLocation | null>(null);

  // Reassign vehicle modal (vehicle-first: pick a new location for an already-deployed crew)
  const [reassignVehicleModalVisible, setReassignVehicleModalVisible] = useState(false);
  const [reassigningVehicle, setReassigningVehicle] = useState<{ vehicleId: string; vehicleNumber: string; unitCode: string; partner?: string; shift?: string } | null>(null);

  // Toast / snackbar for reassignment confirmation
  const [toastMessage, setToastMessage] = useState("");
  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastMessage(msg);
    toastAnim.setValue(0);
    Animated.sequence([
      Animated.timing(toastAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.delay(2800),
      Animated.timing(toastAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
    toastTimer.current = setTimeout(() => setToastMessage(""), 3400);
  }, [toastAnim]);

  // Active shifts (from server state)
  const activeShifts: string[] = (deploymentState as any)?.activeShifts ?? ["DAY", "PD", "ND"];

  // Local pending selection for the roster shift picker (before saving)
  const [pendingShifts, setPendingShifts] = useState<Set<string>>(new Set(["DAY", "PD", "ND"]));

  // Dropped-pin state (for long-press or tap-to-place on map)
  const [droppedPin, setDroppedPin] = useState<{ lat: number; lng: number } | null>(null);
  const [pinNameModalVisible, setPinNameModalVisible] = useState(false);
  const [pinName, setPinName] = useState("");
  const [placementMode, setPlacementMode] = useState(false);

  // WLS data
  const [wlsData, setWlsData] = useState<{
    readings: any[];
    grouped: Record<string, any[]>;
    count: number;
    lastUpdated: string | null;
    tideGate: any[];
  } | null>(null);
  const [wlsError, setWlsError] = useState<string | null>(null);

  useEffect(() => {
    const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://example-project.example-team.stg.paas.sandbox.gov.sg";
    const load = () =>
      fetch(`${API_BASE}/api/wls`, { cache: "no-store" })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then((d) => { setWlsData(d); setWlsError(null); })
        .catch((e) => setWlsError(String(e)));
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  // WLS manual ingest
  const [wlsPasteText, setWlsPasteText] = useState("");
  const [wlsIngestLoading, setWlsIngestLoading] = useState(false);
  const [wlsIngestResult, setWlsIngestResult] = useState<string | null>(null);

  // CRMS case management
  const [crmsCases, setCrmsCases] = useState<any[]>([]);
  const [crmsPasteText, setCrmsPasteText] = useState("");
  const [crmsIngestLoading, setCrmsIngestLoading] = useState(false);
  const [crmsIngestResult, setCrmsIngestResult] = useState<string | null>(null);
  const [crmsRefreshing, setCrmsRefreshing] = useState(false);
  const [selectedCrmsCase, setSelectedCrmsCase] = useState<any | null>(null);
  const [assigningCrmsCase, setAssigningCrmsCase] = useState<any | null>(null);
  const [crmsDetailCase, setCrmsDetailCase] = useState<any | null>(null);
  const [crmsDetailVisible, setCrmsDetailVisible] = useState(false);
  const [crmsStatusUpdating, setCrmsStatusUpdating] = useState(false);
  const [crmsDeleteConfirm, setCrmsDeleteConfirm] = useState(false);
  const [crmsEditMode, setCrmsEditMode] = useState(false);
  const [crmsEditForm, setCrmsEditForm] = useState({ fpName: "", fpContact: "", address: "", details: "", lat: "", lng: "" });
  const [crmsEditSaving, setCrmsEditSaving] = useState(false);
  const [crmsRegeocoding, setCrmsRegeocoding] = useState(false);
  // Map pin picker for CRMS edit
  const [crmsMapPinVisible, setCrmsMapPinVisible] = useState(false);
  // Use a ref (not state) so map panning doesn't cause re-renders that reset the MapView
  const crmsMapPinRef = useRef<{ lat: number; lng: number }>({ lat: 1.3521, lng: 103.8198 });
  const [crmsMapPinDisplay, setCrmsMapPinDisplay] = useState<{ lat: number; lng: number } | null>(null);
  // Hide resolved toggle
  const [crmsHideResolved, setCrmsHideResolved] = useState(false);
  // Undo for clear/delete
  const [crmsUndoData, setCrmsUndoData] = useState<{ type: "clear_resolved" | "delete"; cases: any[]; label: string } | null>(null);
  const crmsUndoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [crmsCommentText, setCrmsCommentText] = useState("");
  const [crmsCommentSending, setCrmsCommentSending] = useState(false);

  const API_BASE_CRMS = process.env.EXPO_PUBLIC_API_URL ?? "https://example-project.example-team.stg.paas.sandbox.gov.sg";
  const crmsAuthHeaders = (): Record<string, string> => ({
    "Content-Type": "application/json",
    ...(managerPin ? { "X-Manager-Pin": managerPin } : {}),
  });

  const loadCrmsCases = async () => {
    try {
      const r = await fetch(`${API_BASE_CRMS}/api/crms`, { cache: "no-store" });
      const d = await r.json();
      setCrmsCases(d.cases ?? []);
    } catch { /* ignore */ }
  };

  // Undo helper — commits a pending undo delete/clear to the server after 10s
  const commitCrmsUndo = (data: { type: "clear_resolved" | "delete"; cases: any[] }, headers: Record<string, string>) => {
    if (crmsUndoTimer.current) clearTimeout(crmsUndoTimer.current);
    crmsUndoTimer.current = setTimeout(async () => {
      setCrmsUndoData(null);
      if (data.type === "clear_resolved") {
        await fetch(`${API_BASE_CRMS}/api/crms`, { method: "DELETE", headers });
        await loadCrmsCases();
      } else {
        for (const c of data.cases) {
          await fetch(`${API_BASE_CRMS}/api/crms/${c.id}`, { method: "DELETE", headers });
        }
        await loadCrmsCases();
      }
    }, 10000);
  };

  const handleCrmsIngest = async () => {
    if (!crmsPasteText.trim()) return;
    setCrmsIngestLoading(true);
    setCrmsIngestResult(null);
    try {
      const res = await fetch(`${API_BASE_CRMS}/api/crms/ingest`, {
        method: "POST",
        headers: crmsAuthHeaders(),
        body: JSON.stringify({ text: crmsPasteText.trim() }),
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) {
        setCrmsIngestResult(`Error: ${json.error ?? "Unknown"}`);
      } else {
        setCrmsIngestResult(`✓ ${json.added} case${json.added !== 1 ? "s" : ""} added${json.skipped?.length ? ` · ${json.skipped.length} duplicate(s) skipped` : ""}`);
        setCrmsPasteText("");
        await loadCrmsCases();
      }
    } catch (e) {
      setCrmsIngestResult(`Error: ${String(e)}`);
    } finally {
      setCrmsIngestLoading(false);
    }
  };

  useEffect(() => {
    loadCrmsCases();
    const id = setInterval(loadCrmsCases, 10000);
    return () => clearInterval(id);
  }, []);

  const handleWlsIngest = async () => {
    if (!wlsPasteText.trim()) return;
    setWlsIngestLoading(true);
    setWlsIngestResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/wls/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ smsText: wlsPasteText.trim() }),
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) {
        setWlsIngestResult(`Error: ${json.error ?? "Unknown"}`);
      } else {
        setWlsIngestResult(`✓ ${json.count ?? 1} station${(json.count ?? 1) !== 1 ? "s" : ""} ingested`);
        setWlsPasteText("");
        // Refresh WLS data immediately
        fetch(`${API_BASE}/api/wls`, { cache: "no-store" })
          .then((r) => r.json()).then((d) => { setWlsData(d); setWlsError(null); }).catch(() => {});
      }
    } catch (e) {
      setWlsIngestResult(`Error: ${String(e)}`);
    } finally {
      setWlsIngestLoading(false);
    }
  };

  // Tide data
  interface TideData {
    height: number;
    rising: boolean;
    ratePerHour: number;
    nextHigh: { local: string; height: number } | null;
    nextLow:  { local: string; height: number } | null;
  }
  const [tideData, setTideData] = useState<TideData | null>(null);
  useEffect(() => {
    const base = process.env.EXPO_PUBLIC_API_URL ?? "https://example-project.example-team.stg.paas.sandbox.gov.sg";
    const load = () =>
      fetch(`${base}/api/tide`)
        .then((r) => r.json())
        .then((t) => setTideData({
          height: t.height,
          rising: t.rising,
          ratePerHour: t.ratePerHour ?? 0,
          nextHigh: t.nextHigh ? { local: t.nextHigh.local, height: t.nextHigh.height } : null,
          nextLow:  t.nextLow  ? { local: t.nextLow.local,  height: t.nextLow.height  } : null,
        }))
        .catch(() => {});
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, []);

  // Rain radar overlay
  const [showRadar, setShowRadar] = useState(false);
  const [radarUrl, setRadarUrl] = useState<string | null>(null);
  const [radarWideUrl, setRadarWideUrl] = useState<string | null>(null);
  const [radarLabel, setRadarLabel] = useState("");

  // 70km primary bounds — accurate Singapore coverage (exact NEA calculatePosition values)
  const [radarBounds, setRadarBounds] = useState<[[number, number], [number, number]]>([
    [1.4572, 103.565],  // NW fallback
    [1.145,  104.130],  // SE fallback
  ]);
  // 240km wide bounds — regional context (Malaysia, Strait of Malacca, Riau Islands)
  const [radarWideBounds, setRadarWideBounds] = useState<[[number, number], [number, number]]>([
    [3.558,  101.908],  // NW fallback
    [-0.754, 106.221],  // SE fallback
  ]);

  useEffect(() => {
    if (!showRadar) return;
    const fetchRadar = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/rain-radar/frames`);
        const json = await res.json();
        const latest = json.frames?.[0];
        if (latest) {
          setRadarUrl(`${API_BASE}/api/rain-radar?at=${latest.at}`);
          setRadarWideUrl(`${API_BASE}/api/rain-radar-wide?at=${latest.at}`);
          setRadarLabel(latest.label);
        }
        if (json.bounds?.nw && json.bounds?.se) {
          setRadarBounds([json.bounds.nw, json.bounds.se]);
        }
        if (json.wideBounds?.nw && json.wideBounds?.se) {
          setRadarWideBounds([json.wideBounds.nw, json.wideBounds.se]);
        }
      } catch {}
    };
    fetchRadar();
    const id = setInterval(fetchRadar, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [showRadar]);

  // Lightning risk layer
  const [showLightning, setShowLightning] = useState(false);
  const [lightningSectors, setLightningSectors] = useState<LightningSector[]>([]);
  const worstCat = lightningSectors.length
    ? Math.min(...lightningSectors.map(s => parseInt(s.cat) || 3))
    : 3;
  useEffect(() => {
    if (!showLightning) return;
    const load = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/lightning/sectors`);
        const j = await r.json();
        if (Array.isArray(j.sectors)) setLightningSectors(j.sectors);
      } catch {}
    };
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [showLightning]);

  // Rain-based auto-assign
  const [rainAssigning, setRainAssigning] = useState(false);
  const handleRainAutoAssign = async () => {
    if (!rosterTeams.length) {
      Alert.alert("No Roster", "Load a roster first before running rain-based assign.");
      return;
    }
    setRainAssigning(true);
    try {
      const res = await fetch(`${API_BASE}/api/deployments/rain-auto-assign`, { method: "POST" });
      const json = await res.json();
      await qc.invalidateQueries({ queryKey: getGetDeploymentStateQueryKey() });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (!json.count) {
        Alert.alert("Rain Assign", "No assignments made — check rain data or roster.");
      } else {
        const lines = json.assignments?.map((a: any) => `${a.unitCode} → ${a.locationName}`).join("\n") ?? "";
        Alert.alert("Rain Assign Complete", `${json.count} assignment${json.count === 1 ? "" : "s"}:\n\n${lines}`);
      }
    } catch {
      Alert.alert("Error", "Rain assign failed. Check your connection.");
    } finally {
      setRainAssigning(false);
    }
  };

  // Address search
  const mapRef = useRef<MapView>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchPreview, setSearchPreview] = useState<{ lat: number; lng: number; label: string } | null>(null);

  // Roster state
  const [rosterText, setRosterText] = useState("");
  const [rosterError, setRosterError] = useState("");
  const [rosterLoading, setRosterLoading] = useState(false);

  // Alert state
  const [alertText, setAlertText] = useState("");
  const [alertError, setAlertError] = useState("");
  const [alertLoading, setAlertLoading] = useState(false);

  const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://example-project.example-team.stg.paas.sandbox.gov.sg";

  // Roster/alert data comes from the polled deployment state
  const rosterTeams = (deploymentState as any)?.rosterTeams ?? [];
  const activeAlert = (deploymentState as any)?.activeAlert ?? null;

  const importRoster = async () => {
    if (!rosterText.trim()) { setRosterError("Paste a deployment list first."); return; }
    setRosterLoading(true); setRosterError("");
    try {
      const res = await fetch(`${API_BASE}/api/roster/import`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: rosterText.trim() }),
      });
      const json = await res.json();
      if (!res.ok) { setRosterError(json.message || "Parse failed."); return; }
      setRosterText("");
      await qc.invalidateQueries({ queryKey: getGetDeploymentStateQueryKey() });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setRosterError(`✓ ${json.count} team${json.count === 1 ? "" : "s"} loaded for today.`);
    } catch { setRosterError("Request failed. Check your connection."); }
    finally { setRosterLoading(false); }
  };

  const clearRoster = async () => {
    await fetch(`${API_BASE}/api/roster`, { method: "DELETE" });
    await qc.invalidateQueries({ queryKey: getGetDeploymentStateQueryKey() });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  };

  const broadcastAlert = async () => {
    if (!alertText.trim()) { setAlertError("Paste the NEA message first."); return; }
    setAlertLoading(true); setAlertError("");
    try {
      const res = await fetch(`${API_BASE}/api/alert/broadcast`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: alertText.trim() }),
      });
      const json = await res.json();
      if (!res.ok) { setAlertError(json.message || "Broadcast failed."); return; }
      setAlertText("");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch { setAlertError("Request failed. Check your connection."); }
    finally { setAlertLoading(false); }
  };

  const clearAlert = async () => {
    await fetch(`${API_BASE}/api/alert`, { method: "DELETE" });
    await qc.invalidateQueries({ queryKey: getGetDeploymentStateQueryKey() });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  };

  const resetMutation = useResetDeployment();
  const createMutation = useCreateLocation();
  const updateMutation = useUpdateLocation();
  const deleteMutation = useDeleteLocation();
  const assignCrewMutation = useAssignCrew();

  const { data: locationsData, refetch: refetchLocations } = useGetLocations({
    query: {
      queryKey: getGetLocationsQueryKey(),
      refetchInterval: 60000,
      staleTime: 30000,
    },
  });

  const entries = deploymentState?.entries ?? [];
  const vehicles = deploymentState?.vehicles ?? [];
  const allLocations = locationsData?.locations ?? deploymentState?.presetLocations ?? [];
  const acceptedIds = entries.map((e) => e.locationId);
  const deployedVehicleIds = new Set(entries.map((e) => e.vehicleId));
  const pendingAssignments: any[] = Object.values((deploymentState as any)?.assignments ?? {})
    .filter((a: any) => a.status === "pending" && !deployedVehicleIds.has(a.vehicleId))
    .sort((a: any, b: any) => unitSortKey(a.unitCode) - unitSortKey(b.unitCode));
  const pendingLocIds = new Set<string>(pendingAssignments.map((a: any) => a.locationId));
  const reassignmentHistory: any[] = (deploymentState as any)?.reassignmentHistory ?? [];

  // Active vehicles (have reported a GPS position)
  const activeVehicles = vehicles;

  // ─── Handlers ────────────────────────────────────────────────────────────────

  const handleReset = async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    await resetMutation.mutateAsync({});
    await qc.invalidateQueries({ queryKey: getGetDeploymentStateQueryKey() });
    await qc.invalidateQueries({ queryKey: getGetLocationsQueryKey() });
  };

  const [autoAssigning, setAutoAssigning] = useState(false);
  const handleAutoAssign = async () => {
    if (!rosterTeams.length) {
      Alert.alert("No Roster", "Load a roster first before running auto-assign.");
      return;
    }
    setAutoAssigning(true);
    try {
      const res = await fetch(`${API_BASE}/api/deployments/auto-assign`, { method: "POST" });
      const json = await res.json();
      await qc.invalidateQueries({ queryKey: getGetDeploymentStateQueryKey() });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (json.count === 0) {
        Alert.alert("Auto-Assign", "No new assignments — all crews are already assigned or no matching region locations available.");
      } else {
        const lines = json.assignments.map((a: any) => `${a.unitCode} → ${a.locationName}`).join("\n");
        Alert.alert("Auto-Assign Complete", `${json.count} assignment${json.count === 1 ? "" : "s"} sent:\n\n${lines}`);
      }
    } catch {
      Alert.alert("Error", "Auto-assign failed. Check your connection.");
    } finally {
      setAutoAssigning(false);
    }
  };

  const openAddModal = () => {
    setEditingLocation(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setLocModalVisible(true);
  };

  const openEditModal = (loc: PresetLocation) => {
    setEditingLocation(loc);
    setForm({ name: loc.name, address: loc.address, lat: String(loc.lat), lng: String(loc.lng) });
    setFormError("");
    setLocModalVisible(true);
  };

  const handleSaveLocation = async () => {
    const { name, address, lat, lng } = form;
    if (!name.trim()) { setFormError("Location name is required"); return; }
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (isNaN(latNum) || latNum < -90 || latNum > 90) { setFormError("Enter a valid latitude (e.g. 1.3521)"); return; }
    if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) { setFormError("Enter a valid longitude (e.g. 103.8198)"); return; }
    setFormError("");
    try {
      if (editingLocation) {
        await updateMutation.mutateAsync({ id: editingLocation.id, data: { name: name.trim(), address: address.trim() || name.trim(), lat: latNum, lng: lngNum } });
      } else {
        await createMutation.mutateAsync({ data: { name: name.trim(), address: address.trim() || name.trim(), lat: latNum, lng: lngNum } });
      }
      await qc.invalidateQueries({ queryKey: getGetLocationsQueryKey() });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setLocModalVisible(false);
    } catch {
      setFormError("Failed to save. Please try again.");
    }
  };

  const handleDeleteLocation = async (loc: PresetLocation) => {
    await deleteMutation.mutateAsync({ id: loc.id });
    await qc.invalidateQueries({ queryKey: getGetLocationsQueryKey() });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  };

  const serverActiveTeams: string[] = (deploymentState as any)?.activeTeams ?? [];

  // Sync pending shifts & team filter whenever server state changes
  React.useEffect(() => {
    setPendingShifts(new Set(activeShifts));
  }, [activeShifts.join(",")]);

  React.useEffect(() => {
    setRosterViewFilter(serverActiveTeams.length > 0 ? new Set(serverActiveTeams) : new Set());
  }, [serverActiveTeams.join(",")]);

  const togglePendingShift = (s: string) => {
    setPendingShifts(prev => {
      const next = new Set(prev);
      if (next.has(s) && next.size > 1) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const saveActiveShifts = async () => {
    const shifts = Array.from(pendingShifts);
    const teams = Array.from(rosterViewFilter); // save current team selection
    await Promise.all([
      fetch(`${API_BASE}/api/roster/active-shifts`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shifts }),
      }),
      fetch(`${API_BASE}/api/roster/active-teams`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teams }),
      }),
    ]);
    await qc.invalidateQueries({ queryKey: getGetDeploymentStateQueryKey() });
  };

  const openAssignModal = (loc: PresetLocation) => {
    setAssigningLocation(loc);
    setAssigningCrmsCase(null);
    setAssignModalVisible(true);
  };

  const openReassignVehicleModal = (entry: { vehicleId: string; vehicleNumber: string; unitCode: string; partner?: string; shift?: string }) => {
    setReassigningVehicle(entry);
    setReassignVehicleModalVisible(true);
  };

  const handleReassignToLocation = async (loc: PresetLocation) => {
    if (!reassigningVehicle) return;
    const occupied = entries.find((e: any) => e.locationId === loc.id && e.vehicleId !== reassigningVehicle.vehicleId);
    if (occupied) {
      Alert.alert(
        "Location Occupied",
        `${occupied.unitCode} is already at ${loc.name}. Reassign anyway?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Reassign Anyway",
            style: "destructive",
            onPress: () => doReassignVehicle(loc, true),
          },
        ]
      );
      return;
    }
    await doReassignVehicle(loc, false);
  };

  const doReassignVehicle = async (loc: PresetLocation, force: boolean) => {
    if (!reassigningVehicle) return;
    try {
      const res = await fetch(`${API_BASE}/api/deployments/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleId: reassigningVehicle.vehicleId,
          locationId: loc.id,
          locationName: loc.name,
          lat: loc.lat,
          lng: loc.lng,
          assignedBy: "Manager",
          force,
        }),
      });
      if (res.ok) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await qc.invalidateQueries({ queryKey: getGetDeploymentStateQueryKey() });
        showToast(`${reassigningVehicle.unitCode} reassigned to ${loc.name} — waiting for crew to accept`);
        setReassignVehicleModalVisible(false);
        setReassigningVehicle(null);
      } else {
        const err = await res.json().catch(() => ({}));
        Alert.alert("Reassign failed", err.message ?? `Server error ${res.status}`);
      }
    } catch (e: any) {
      Alert.alert("Reassign failed", e?.message ?? "Could not reach server");
    }
  };

  const openCrmsAssignModal = (crmsCase: any) => {
    setAssigningCrmsCase(crmsCase);
    setAssigningLocation(null);
    setAssignModalVisible(true);
  };

  const openCrmsDetail = (c: any) => {
    setCrmsDetailCase(c);
    setCrmsDeleteConfirm(false);
    setCrmsEditMode(false);
    setCrmsEditForm({
      fpName: c.fpName ?? "",
      fpContact: c.fpContact ?? "",
      address: c.address ?? "",
      details: c.details ?? "",
      lat: c.lat != null ? String(c.lat) : "",
      lng: c.lng != null ? String(c.lng) : "",
    });
    setCrmsDetailVisible(true);
  };

  const handleCrmsEditSave = async () => {
    if (!crmsDetailCase) return;
    setCrmsEditSaving(true);
    try {
      // Build body — lat/lng live directly in crmsEditForm now
      const { lat: latStr, lng: lngStr, ...textFields } = crmsEditForm;
      const body: Record<string, any> = { ...textFields };
      const parsedLat = parseFloat(latStr);
      const parsedLng = parseFloat(lngStr);
      if (!isNaN(parsedLat) && !isNaN(parsedLng)) {
        body.lat = parsedLat;
        body.lng = parsedLng;
        body.locationName = `${parsedLat.toFixed(5)}, ${parsedLng.toFixed(5)}`;
      }
      const res = await fetch(`${API_BASE_CRMS}/api/crms/${crmsDetailCase.id}`, {
        method: "PUT",
        headers: crmsAuthHeaders(),
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const savedCase: any = await res.json().catch(() => ({ ...crmsDetailCase, ...body }));
        setCrmsDetailCase(savedCase);
        setSelectedCrmsCase(savedCase);
        await loadCrmsCases();
        setCrmsEditMode(false);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        const err = await res.json().catch(() => ({}));
        Alert.alert("Save failed", err.error ?? `Server error ${res.status}`);
      }
    } catch (e: any) {
      Alert.alert("Save failed", e?.message ?? "Could not reach server");
    } finally { setCrmsEditSaving(false); }
  };

  const handleCrmsRegeocode = async () => {
    if (!crmsDetailCase) return;
    setCrmsRegeocoding(true);
    try {
      const res = await fetch(`${API_BASE_CRMS}/api/crms/${crmsDetailCase.id}/regeocode`, {
        method: "POST",
        headers: crmsAuthHeaders(),
      });
      if (res.ok) {
        const { case: updated } = await res.json();
        setCrmsDetailCase(updated);
        setSelectedCrmsCase(updated);
        // Sync geocoded coords back into edit form so they show in the lat/lng fields
        setCrmsEditForm(f => ({
          ...f,
          lat: updated.lat != null ? String(updated.lat) : f.lat,
          lng: updated.lng != null ? String(updated.lng) : f.lng,
        }));
        await loadCrmsCases();
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        const { error } = await res.json();
        Alert.alert("Re-geocode failed", error ?? "Address not found on OneMap");
      }
    } catch { Alert.alert("Error", "Could not reach server"); } finally { setCrmsRegeocoding(false); }
  };

  const handleCrmsStatusUpdate = async (newStatus: string) => {
    if (!crmsDetailCase) return;
    setCrmsStatusUpdating(true);
    try {
      const res = await fetch(`${API_BASE_CRMS}/api/crms/${crmsDetailCase.id}`, {
        method: "PUT",
        headers: crmsAuthHeaders(),
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        await loadCrmsCases();
        const updated = { ...crmsDetailCase, status: newStatus };
        setCrmsDetailCase(updated);
        setSelectedCrmsCase(updated);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch { /* silent */ } finally {
      setCrmsStatusUpdating(false);
    }
  };

  const handleCrmsAddComment = async () => {
    if (!crmsDetailCase || !crmsCommentText.trim()) return;
    setCrmsCommentSending(true);
    try {
      const res = await fetch(`${API_BASE_CRMS}/api/crms/${crmsDetailCase.id}/comment`, {
        method: "POST",
        headers: crmsAuthHeaders(),
        body: JSON.stringify({ text: crmsCommentText.trim(), unitCode: "Manager" }),
      });
      if (res.ok) {
        const data = await res.json();
        setCrmsDetailCase((prev: any) => ({ ...prev, comments: [...(prev.comments ?? []), data.comment] }));
        setCrmsCases(prev => prev.map(c => c.id === crmsDetailCase.id
          ? { ...c, comments: [...(c.comments ?? []), data.comment] }
          : c
        ));
        setCrmsCommentText("");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } finally {
      setCrmsCommentSending(false);
    }
  };

  const handleCrmsDelete = () => {
    if (!crmsDetailCase) return;
    const caseToDelete = crmsDetailCase;
    // Optimistically remove from list, set undo state
    setCrmsCases(prev => prev.filter(c => c.id !== caseToDelete.id));
    setCrmsDetailVisible(false);
    setCrmsCommentText("");
    setSelectedCrmsCase(null);
    const undoPayload = { type: "delete" as const, cases: [caseToDelete], label: `CRMS #${caseToDelete.caseNumber}` };
    setCrmsUndoData(undoPayload);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    commitCrmsUndo(undoPayload, crmsAuthHeaders());
  };

  const handleAssign = async (vehicle: VehiclePosition) => {
    if (assigningCrmsCase) {
      // Assign to CRMS case
      try {
        await fetch(`${API_BASE_CRMS}/api/crms/${assigningCrmsCase.id}`, {
          method: "PUT",
          headers: crmsAuthHeaders(),
          body: JSON.stringify({ assignedVehicleId: vehicle.vehicleId, assignedUnitCode: vehicle.unitCode, status: "TEAM_ACKNOWLEDGE_OTW" }),
        });
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setAssignModalVisible(false);
        setAssigningCrmsCase(null);
        setSelectedCrmsCase(null);
        await loadCrmsCases();
      } catch { /* silent */ }
      return;
    }
    if (!assigningLocation) return;
    try {
      await assignCrewMutation.mutateAsync({
        data: {
          vehicleId: vehicle.vehicleId,
          locationId: assigningLocation.id,
          locationName: assigningLocation.name,
          lat: assigningLocation.lat,
          lng: assigningLocation.lng,
          assignedBy: "Manager",
        } as any,
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAssignModalVisible(false);
    } catch {
      // silent — modal stays open if assignment fails
    }
  };

  const handleAddressSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    setSearchPreview(null);
    try {
      const res = await fetch(`${API_BASE}/api/search/sg?q=${encodeURIComponent(searchQuery.trim())}`);
      const json = await res.json();
      const results: any[] = json.results ?? [];
      if (results.length > 0) {
        const top = results[0];
        const lat = top.lat as number;
        const lng = top.lng as number;
        const label = (top.label || top.sub || searchQuery.trim()) as string;
        setSearchPreview({ lat, lng, label });
        mapRef.current?.animateToRegion({ latitude: lat, longitude: lng, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 600);
      } else {
        setSearchPreview(null);
        Alert.alert("Not found", "No results found. Try a different address or postal code.");
      }
    } catch {
      setSearchPreview(null);
    } finally {
      setSearchLoading(false);
    }
  };

  const confirmSearchPreview = () => {
    if (!searchPreview) return;
    setDroppedPin({ lat: searchPreview.lat, lng: searchPreview.lng });
    setPinName(searchPreview.label);
    setSearchPreview(null);
    setSearchQuery("");
    setPinNameModalVisible(true);
  };

  const dropPinAt = (latitude: number, longitude: number) => {
    setDroppedPin({ lat: latitude, lng: longitude });
    setPinName("");
    setPlacementMode(false);
    setPinNameModalVisible(true);
  };

  // Long-press on map → always drops a pin
  const handleMapLongPress = (event: any) => {
    const { latitude, longitude } = event.nativeEvent.coordinate;
    dropPinAt(latitude, longitude);
  };

  // Single tap on map → only drops if placement mode is active
  const handleMapPress = (event: any) => {
    if (!placementMode) return;
    const { latitude, longitude } = event.nativeEvent.coordinate;
    dropPinAt(latitude, longitude);
  };

  const handleConfirmPin = async () => {
    if (!droppedPin || !pinName.trim()) return;
    try {
      const result = await createMutation.mutateAsync({
        data: { name: pinName.trim(), address: pinName.trim(), lat: droppedPin.lat, lng: droppedPin.lng },
      });
      await qc.invalidateQueries({ queryKey: getGetLocationsQueryKey() });
      setPinNameModalVisible(false);
      // Open assign modal for the newly created location
      if (result?.location) {
        setAssigningLocation(result.location);
        setAssignModalVisible(true);
      }
    } catch {
      setFormError("Failed to create location. Please try again.");
    }
  };

  // ─── Styles ──────────────────────────────────────────────────────────────────
  const tabBarH = insets.bottom + 84;

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0),
      paddingHorizontal: 12, paddingBottom: 8,
      borderBottomWidth: 1, borderBottomColor: colors.border,
      backgroundColor: colors.background,
    },
    headerRow1: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
    headerRow2: { flexDirection: "row", alignItems: "center", gap: 6 },
    headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: colors.foreground },
    tabs: { flexDirection: "row", gap: 6 },
    tabBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 1 },
    resetBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.destructive, alignItems: "center", justifyContent: "center" },
    map: { flex: 1 },
    statsBar: { position: "absolute", bottom: tabBarH + 8, left: 12, flexDirection: "row", gap: 8, zIndex: 5, flexWrap: "wrap" },
    locPanel: {
      position: "absolute", bottom: tabBarH + 52, left: 12, right: 12, zIndex: 10,
      backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
      flexDirection: "row", alignItems: "center", padding: 12, gap: 10,
      shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 8, elevation: 4,
    },
    locPanelName: { fontSize: 14, fontFamily: "Inter_700Bold", color: colors.foreground },
    locPanelSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.accent, marginTop: 2 },
    locPanelBtn: {
      flexDirection: "row", alignItems: "center", gap: 5,
      backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7,
    },
    locPanelBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#FFF" },
    statCard: { backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 6 },
    statDot: { width: 8, height: 8, borderRadius: 4 },
    statText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    scrollContent: { padding: 16, paddingBottom: tabBarH + 20 },
    pasteInput: {
      backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
      color: colors.foreground, padding: 12, fontSize: 13, fontFamily: "Inter_400Regular",
      textAlignVertical: "top", minHeight: 80,
    },
    sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
    sectionTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 1, textTransform: "uppercase" },
    addBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.primary, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 7 },
    addBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#FFF" },
    locRow: { backgroundColor: colors.card, borderRadius: colors.radius, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 8, flexDirection: "row", alignItems: "center" },
    locInfo: { flex: 1 },
    locName: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground, marginBottom: 2 },
    locMeta: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    acceptedDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, marginRight: 8 },
    locActions: { flexDirection: "row", gap: 6, marginLeft: 10 },
    iconBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 1 },
    listItem: { backgroundColor: colors.card, borderRadius: colors.radius, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center" },
    listIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginRight: 12 },
    listInfo: { flex: 1 },
    listTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.foreground, marginBottom: 2 },
    listSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    listEta: { fontSize: 13, fontFamily: "Inter_700Bold", color: colors.accent },
    emptyBox: { alignItems: "center", padding: 40 },
    emptyText: { fontSize: 14, fontFamily: "Inter_500Medium", color: colors.mutedForeground, marginTop: 12, textAlign: "center" },
    // Modals
    modalOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)", zIndex: 998 },
    modalSheet: { position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 999, backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: insets.bottom + (Platform.OS === "web" ? 90 : 16) },
    modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: 20 },
    modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: colors.foreground, marginBottom: 4 },
    modalSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginBottom: 20 },
    label: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 },
    input: { backgroundColor: colors.background, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: "Inter_500Medium", color: colors.foreground, marginBottom: 14 },
    coordRow: { flexDirection: "row", gap: 10 },
    coordField: { flex: 1 },
    hintText: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginBottom: 16 },
    errorText: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.destructive, marginBottom: 12 },
    modalBtns: { flexDirection: "row", gap: 10 },
    cancelBtn: { flex: 1, borderRadius: colors.radius, paddingVertical: 14, alignItems: "center", backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
    cancelBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    saveBtn: { flex: 2, borderRadius: colors.radius, paddingVertical: 14, alignItems: "center", backgroundColor: colors.primary },
    saveBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFF" },
    // Assign vehicle row
    vehicleRow: { backgroundColor: colors.background, borderRadius: colors.radius, padding: 14, marginBottom: 8, flexDirection: "row", alignItems: "center" },
    vehicleIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginRight: 12 },
    vehicleInfo: { flex: 1 },
    vehicleTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    vehicleSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    vehicleAssignBtn: { backgroundColor: colors.accent, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
    vehicleAssignTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#FFF" },
    hintBox: { backgroundColor: colors.background, borderRadius: 10, padding: 12, marginBottom: 12 },
    hintBoxText: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center" },
    addPinFab: {
      position: "absolute",
      bottom: tabBarH + 16,
      right: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      backgroundColor: colors.primary,
      borderRadius: 24,
      paddingHorizontal: 18,
      paddingVertical: 12,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
      elevation: 6,
    },
    addPinFabText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFF" },
    placementBanner: {
      position: "absolute",
      bottom: tabBarH + 16,
      left: 16,
      right: 16,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.accent,
      borderRadius: 14,
      paddingHorizontal: 16,
      paddingVertical: 13,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
      elevation: 6,
    },
    placementBannerText: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFF" },
    placementCancel: { padding: 4 },
    // Roster / Alert panels
    pasteArea: {
      borderWidth: 1, borderRadius: 10, padding: 14, fontSize: 13,
      fontFamily: "Inter_500Medium", height: 160, marginBottom: 8,
    },
    actionBtn: { borderRadius: 12, paddingVertical: 15, alignItems: "center", justifyContent: "center", marginTop: 4 },
    actionBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFF" },
    rosterActiveBox: { borderRadius: 12, borderWidth: 1, borderColor: colors.accent + "55", backgroundColor: colors.accent + "11", padding: 14, marginBottom: 20 },
    rosterActiveHeader: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
    rosterActiveLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 1.5 },
    rosterActiveSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
    rosterRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, gap: 10 },
    rosterAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
    rosterAvatarText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#1a1a1a" },
    rosterUnit: { fontSize: 14, fontFamily: "Inter_700Bold" },
    rosterPartner: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
    shiftPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
    shiftPillText: { fontSize: 11, fontFamily: "Inter_700Bold" },
    clearBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
    clearBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
    alertActiveBox: { borderRadius: 12, borderWidth: 1, borderColor: "rgba(239,68,68,0.4)", backgroundColor: "rgba(239,68,68,0.08)", padding: 14, marginBottom: 20 },
    alertActiveHeader: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
    alertActiveLabel: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#ef4444", letterSpacing: 1.5 },
    alertActiveSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
    alertText: { fontSize: 14, fontFamily: "Inter_500Medium", lineHeight: 20 },
    alertAckList: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 8 },
    weatherPill: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
    weatherPillText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
    assignSectionLabel: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 1.2, marginBottom: 6, marginTop: 2 },
    // Search bar
    searchBar: {
      position: "absolute",
      top: 10,
      left: 12,
      right: 12,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.card,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 6,
      elevation: 5,
      zIndex: 10,
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
      paddingVertical: 0,
    },
    searchGoBtn: {
      backgroundColor: colors.primary,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 5,
      marginLeft: 6,
    },
    searchGoText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#FFF" },
    // Search preview card
    previewCard: {
      position: "absolute",
      top: 66,
      left: 12,
      right: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 6,
      elevation: 5,
      zIndex: 9,
    },
    previewIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    previewLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground, marginBottom: 2 },
    previewCoords: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    previewUseBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6, alignItems: "center" },
    previewUseBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#FFF" },
    previewCancelText: { fontSize: 15, color: colors.mutedForeground, textAlign: "center" },
    // Reassignment toast
    toastContainer: {
      position: "absolute",
      bottom: 28,
      left: 20,
      right: 20,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "#1a1a2e",
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 16,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 10,
      zIndex: 9999,
    },
    toastText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#FFF", flex: 1, flexWrap: "wrap" },
  });

  const tabButton = (mode: ViewMode, icon: string) => (
    <TouchableOpacity
      key={mode}
      style={[s.tabBtn, { backgroundColor: viewMode === mode ? colors.primary : colors.card, borderColor: viewMode === mode ? colors.primary : colors.border }]}
      onPress={() => setViewMode(mode)}
    >
      <Feather name={icon as any} size={15} color={viewMode === mode ? "#FFF" : colors.mutedForeground} />
    </TouchableOpacity>
  );

  return (
    <View style={s.container}>
      <View style={s.header}>
        {/* Row 1: Sign Out  |  Manager  |  Clear */}
        <View style={s.headerRow1}>
          <TouchableOpacity
            onPress={() => {
              logout();
              if (Platform.OS === "web") {
                (window as any).location.href = "/";
              } else {
                router.replace("/");
              }
            }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}
          >
            <Feather name="log-out" size={14} color={colors.mutedForeground} />
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground }}>Sign Out</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle}>Manager</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <TouchableOpacity
              onPress={toggleTheme}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={{ padding: 6 }}
            >
              <Feather name={isDark ? "sun" : "moon"} size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
            {/* Clear deployment button */}
            <TouchableOpacity
              onPress={() => {
                if (clearPending) return;
                setClearPending(true);
                setClearCountdown(5);
                let count = 5;
                clearTimerRef.current = setInterval(() => {
                  count -= 1;
                  setClearCountdown(count);
                  if (count <= 0) {
                    if (clearTimerRef.current) clearInterval(clearTimerRef.current);
                    clearTimerRef.current = null;
                    setClearPending(false);
                    handleReset();
                  }
                }, 1000);
              }}
              style={{ paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.destructive, backgroundColor: "transparent" }}
            >
              <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: colors.destructive }}>Clear</Text>
            </TouchableOpacity>
          </View>
        </View>
        {/* 5-second undo banner */}
        {clearPending && (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.destructive + "18", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, marginTop: 4, borderWidth: 1, borderColor: colors.destructive + "55" }}>
            <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.destructive }}>
              Clearing deployments in {clearCountdown}s…
            </Text>
            <TouchableOpacity
              onPress={() => {
                if (clearTimerRef.current) { clearInterval(clearTimerRef.current); clearTimerRef.current = null; }
                setClearPending(false);
              }}
              style={{ paddingHorizontal: 14, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.destructive }}
            >
              <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" }}>Undo</Text>
            </TouchableOpacity>
          </View>
        )}
        {/* Row 2: View mode tabs */}
        <View style={s.headerRow2}>
          {tabButton("map", "map")}
          {/* List tab — badge when pending */}
          <TouchableOpacity
            style={[s.tabBtn, { backgroundColor: viewMode === "list" ? colors.primary : colors.card, borderColor: viewMode === "list" ? colors.primary : pendingAssignments.length > 0 ? colors.primary : colors.border }]}
            onPress={() => setViewMode("list")}
          >
            <Feather name="list" size={15} color={viewMode === "list" ? "#FFF" : pendingAssignments.length > 0 ? colors.primary : colors.mutedForeground} />
            {pendingAssignments.length > 0 && viewMode !== "list" && (
              <View style={{ position: "absolute", top: -4, right: -4, backgroundColor: colors.primary, borderRadius: 8, minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 }}>
                <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: "#FFF" }}>{pendingAssignments.length}</Text>
              </View>
            )}
          </TouchableOpacity>
          {tabButton("roster", "users")}
          <TouchableOpacity
            style={[s.tabBtn, {
              backgroundColor: viewMode === "alert" ? "#ef4444" : activeAlert ? "rgba(239,68,68,0.15)" : colors.card,
              borderColor: viewMode === "alert" ? "#ef4444" : activeAlert ? "#ef4444" : colors.border,
            }]}
            onPress={() => setViewMode("alert")}
          >
            <Feather name="alert-triangle" size={15} color={viewMode === "alert" ? "#FFF" : activeAlert ? "#ef4444" : colors.mutedForeground} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.tabBtn, {
              backgroundColor: viewMode === "wls" ? "#0ea5e9" : (wlsData?.count ?? 0) > 0 ? "rgba(14,165,233,0.15)" : colors.card,
              borderColor: viewMode === "wls" ? "#0ea5e9" : (wlsData?.count ?? 0) > 0 ? "#0ea5e9" : colors.border,
            }]}
            onPress={() => setViewMode("wls")}
          >
            <Text style={{ fontSize: 14 }}>🌊</Text>
            {(wlsData?.count ?? 0) > 0 && viewMode !== "wls" && (
              <View style={{ position: "absolute", top: -4, right: -4, backgroundColor: "#ef4444", borderRadius: 8, minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 }}>
                <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: "#FFF" }}>{wlsData!.count}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.tabBtn, {
              backgroundColor: viewMode === "crms" ? "#7c3aed" : crmsCases.filter(c => c.status !== "RESOLVED").length > 0 ? "rgba(124,58,237,0.15)" : colors.card,
              borderColor: viewMode === "crms" ? "#7c3aed" : crmsCases.filter(c => c.status !== "RESOLVED").length > 0 ? "#7c3aed" : colors.border,
            }]}
            onPress={() => setViewMode("crms")}
          >
            <Text style={{ fontSize: 14 }}>📋</Text>
            {crmsCases.filter(c => c.status !== "RESOLVED").length > 0 && viewMode !== "crms" && (
              <View style={{ position: "absolute", top: -4, right: -4, backgroundColor: "#7c3aed", borderRadius: 8, minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 }}>
                <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: "#FFF" }}>{crmsCases.filter(c => c.status !== "RESOLVED").length}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* ── MAP VIEW ── */}
      {viewMode === "map" && (
        <View style={{ flex: 1 }}>
          <MapView
            key={isDark ? "mgr-map-dark" : "mgr-map-light"}
            ref={mapRef}
            style={s.map}
            provider={PROVIDER_DEFAULT}
            initialRegion={{ latitude: 1.3521, longitude: 103.8198, latitudeDelta: 0.4, longitudeDelta: 0.4 }}
            onLongPress={handleMapLongPress}
            onPress={(e) => { handleMapPress(e); setSelectedMapLoc(null); }}
            userInterfaceStyle={isDark ? "dark" : "light"}
            customMapStyle={Platform.OS === "android" ? (isDark ? DARK_MAP_STYLE : LIGHT_MAP_STYLE) : undefined}
          >
            {allLocations.map((loc) => {
              const entry = entries.find((e) => e.locationId === loc.id);
              const isSelected = selectedMapLoc?.id === loc.id;
              const isPending = !entry && pendingLocIds.has(loc.id);
              return (
                <Marker
                  key={loc.id}
                  coordinate={{ latitude: loc.lat, longitude: loc.lng }}
                  pinColor={isSelected ? "#2563EB" : entry ? "#10B981" : isPending ? "#7DD3FC" : "#6B7280"}
                  title={loc.name}
                  onPress={() => setSelectedMapLoc(loc)}
                />
              );
            })}
            {droppedPin && (
              <Marker
                coordinate={{ latitude: droppedPin.lat, longitude: droppedPin.lng }}
                pinColor="#F59E0B"
                title="New Location"
              />
            )}
            {searchPreview && !droppedPin && (
              <Marker
                coordinate={{ latitude: searchPreview.lat, longitude: searchPreview.lng }}
                pinColor="#F59E0B"
                title={searchPreview.label}
              />
            )}
            {vehicles.map((v) => {
              const activeCrms = crmsCases.find(
                (c) => c.assignedVehicleId === v.vehicleId && c.status !== "RESOLVED"
              );
              const pinColor = activeCrms ? "#7c3aed" : "#2563EB";
              const titleLabel = activeCrms
                ? `${v.unitCode} → CRMS #${activeCrms.caseNumber}`
                : `${v.unitCode} - ${v.vehicleNumber}`;
              return (
                <Marker
                  key={v.vehicleId}
                  coordinate={{ latitude: v.lat, longitude: v.lng }}
                  pinColor={pinColor}
                  title={titleLabel}
                  description={activeCrms ? activeCrms.address ?? activeCrms.fpName : undefined}
                  zIndex={activeCrms ? 60 : 10}
                />
              );
            })}
            {/* Route lines: vehicle GPS → CRMS case (if assigned) or → deployment location */}
            {vehicles.map((v) => {
              const activeCrms = crmsCases.find(
                (c) => c.assignedVehicleId === v.vehicleId && c.status !== "RESOLVED"
              );
              if (activeCrms && activeCrms.lat && activeCrms.lng) {
                // En-route to CRMS case — draw purple dashed line
                return (
                  <Polyline
                    key={`route-${v.vehicleId}`}
                    coordinates={[
                      { latitude: v.lat, longitude: v.lng },
                      { latitude: activeCrms.lat, longitude: activeCrms.lng },
                    ]}
                    strokeColor="#7c3aed"
                    strokeWidth={2.5}
                    lineDashPattern={[8, 6]}
                  />
                );
              }
              // Normal: vehicle GPS → assigned deployment location
              const entry = entries.find((e) => e.vehicleId === v.vehicleId);
              if (!entry) {
                // Manager assigned but crew hasn't accepted yet — draw line immediately
                const pending = pendingAssignments.find((a: any) => a.vehicleId === v.vehicleId);
                if (!pending) return null;
                const clr = unitColor(v.unitCode);
                return (
                  <Polyline
                    key={`route-${v.vehicleId}`}
                    coordinates={[
                      { latitude: v.lat, longitude: v.lng },
                      { latitude: pending.lat, longitude: pending.lng },
                    ]}
                    strokeColor={clr}
                    strokeWidth={2}
                    lineDashPattern={[8, 6]}
                  />
                );
              }
              const loc = allLocations.find((l) => l.id === entry.locationId);
              if (!loc) return null;
              const clr = unitColor(v.unitCode);
              return (
                <Polyline
                  key={`route-${v.vehicleId}`}
                  coordinates={[
                    { latitude: v.lat, longitude: v.lng },
                    { latitude: loc.lat, longitude: loc.lng },
                  ]}
                  strokeColor={clr}
                  strokeWidth={2.5}
                  lineDashPattern={(entry as any).arrived ? undefined : [8, 6]}
                />
              );
            })}
            {/* CRMS case markers — all statuses; green=resolved, orange=in-progress, violet=open */}
            {crmsCases.filter(c => c.lat && c.lng).map((c) => (
              <Marker
                key={`crms-${c.id}`}
                coordinate={{ latitude: c.lat, longitude: c.lng }}
                pinColor={c.status === "RESOLVED" ? "green" : c.status === "ASSISTANCE_PROVIDED" ? "purple" : c.status === "FP_UPDATED" ? "blue" : c.status === "TEAM_ACKNOWLEDGE_OTW" ? "orange" : "red"}
                title={`📋 CRMS #${c.caseNumber}${c.status === "RESOLVED" ? " ✓" : ""}`}
                description={c.address || c.fpName}
                zIndex={50}
                onPress={() => { setSelectedCrmsCase(c); setSelectedMapLoc(null); }}
              />
            ))}
            {/* Rain radar — dual layer: 240km wide context (faded) + 70km local (sharp) */}
            {showRadar && radarWideUrl && (
              <Overlay
                bounds={radarWideBounds}
                image={{ uri: radarWideUrl }}
                opacity={0.35}
              />
            )}
            {showRadar && radarUrl && (
              <Overlay
                bounds={radarBounds}
                image={{ uri: radarUrl }}
                opacity={0.65}
              />
            )}
            {/* Lightning risk circles — 32 army sectors */}
            {showLightning && lightningSectors.map((s) => {
              const { fill, stroke } = catCircleColors(s.cat);
              return (
                <Circle
                  key={s.name}
                  center={{ latitude: s.lat, longitude: s.lng }}
                  radius={3800}
                  fillColor={fill}
                  strokeColor={stroke}
                  strokeWidth={1}
                />
              );
            })}
          </MapView>
          {/* Rain radar toggle */}
          <TouchableOpacity
            onPress={() => setShowRadar(r => !r)}
            style={{
              position: "absolute", top: 76, right: 12, zIndex: 10,
              flexDirection: "row", alignItems: "center", gap: 6,
              backgroundColor: showRadar ? "#0ea5e9" : colors.card,
              borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
              borderWidth: 1, borderColor: showRadar ? "#0ea5e9" : colors.border,
              shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 4, elevation: 3,
            }}
          >
            <Text style={{ fontSize: 14 }}>🌧</Text>
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: showRadar ? "#FFF" : colors.mutedForeground }}>
              {showRadar ? (radarLabel || "Radar ON") : "Radar"}
            </Text>
          </TouchableOpacity>
          {/* Lightning risk toggle */}
          <TouchableOpacity
            onPress={() => setShowLightning(l => !l)}
            style={{
              position: "absolute", top: 120, right: 12, zIndex: 10,
              flexDirection: "row", alignItems: "center", gap: 6,
              backgroundColor: showLightning
                ? (worstCat === 1 ? "#dc2626" : worstCat === 2 ? "#ca8a04" : "#16a34a")
                : colors.card,
              borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
              borderWidth: 1,
              borderColor: showLightning
                ? (worstCat === 1 ? "#dc2626" : worstCat === 2 ? "#ca8a04" : "#16a34a")
                : colors.border,
              shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 4, elevation: 3,
            }}
          >
            <Text style={{ fontSize: 14 }}>⚡</Text>
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: showLightning ? "#FFF" : colors.mutedForeground }}>
              {showLightning ? `CAT ${worstCat}` : "Lightning"}
            </Text>
          </TouchableOpacity>

          {/* Refresh button */}
          <TouchableOpacity
            onPress={async () => {
              setMapRefreshing(true);
              await qc.invalidateQueries({ queryKey: getGetDeploymentStateQueryKey() });
              await refetchLocations();
              setMapRefreshing(false);
            }}
            style={{
              position: "absolute", top: 76, left: 12, zIndex: 10,
              flexDirection: "row", alignItems: "center", gap: 6,
              backgroundColor: colors.card,
              borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
              borderWidth: 1, borderColor: colors.border,
              shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 4, elevation: 3,
            }}
          >
            {mapRefreshing
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Feather name="refresh-cw" size={14} color={colors.mutedForeground} />}
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground }}>
              {mapRefreshing ? "Updating…" : "Refresh"}
            </Text>
          </TouchableOpacity>
          {/* Search bar */}
          <View style={s.searchBar}>
            <Feather name="search" size={15} color={colors.mutedForeground} style={{ marginRight: 8 }} />
            <TextInput
              style={s.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search address…"
              placeholderTextColor={colors.mutedForeground}
              returnKeyType="search"
              onSubmitEditing={handleAddressSearch}
              clearButtonMode="while-editing"
            />
            {searchLoading
              ? <ActivityIndicator size="small" color={colors.primary} />
              : searchQuery.trim().length > 0 && (
                  <TouchableOpacity onPress={handleAddressSearch} style={s.searchGoBtn}>
                    <Text style={s.searchGoText}>Go</Text>
                  </TouchableOpacity>
                )
            }
          </View>

          {/* Search preview card */}
          {searchPreview && (
            <View style={s.previewCard}>
              <View style={s.previewIcon}><Feather name="map-pin" size={16} color="#FFF" /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.previewLabel} numberOfLines={2}>{searchPreview.label}</Text>
                <Text style={s.previewCoords}>{searchPreview.lat.toFixed(5)}, {searchPreview.lng.toFixed(5)}</Text>
              </View>
              <View style={{ gap: 6 }}>
                <TouchableOpacity style={s.previewUseBtn} onPress={confirmSearchPreview}>
                  <Text style={s.previewUseBtnText}>Use</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setSearchPreview(null); setSearchQuery(""); }}>
                  <Text style={s.previewCancelText}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Selected location panel */}
          {selectedMapLoc && !searchPreview && (() => {
            const entry = entries.find((e) => e.locationId === selectedMapLoc.id);
            const w = entry ? weatherEmoji((entry as any).weather) : null;
            return (
              <View style={s.locPanel}>
                <View style={{ flex: 1 }}>
                  <Text style={s.locPanelName}>{selectedMapLoc.name}</Text>
                  {entry ? (
                    <Text style={s.locPanelSub}>
                      {entry.unitCode} · {entry.partner} · ETA {entry.eta}
                      {w ? `  ${w.emoji}` : ""}
                    </Text>
                  ) : (
                    <Text style={[s.locPanelSub, { color: colors.mutedForeground }]}>Available — no crew assigned</Text>
                  )}
                </View>
                {entry ? (
                  <TouchableOpacity
                    style={[s.locPanelBtn, { backgroundColor: "#f59e0b" }]}
                    onPress={() => openReassignVehicleModal(entry as any)}
                  >
                    <Feather name="refresh-cw" size={13} color="#FFF" />
                    <Text style={s.locPanelBtnText}>Reassign</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={s.locPanelBtn}
                    onPress={() => openAssignModal(selectedMapLoc)}
                  >
                    <Feather name="send" size={13} color="#FFF" />
                    <Text style={s.locPanelBtnText}>Assign</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => setSelectedMapLoc(null)} style={{ padding: 6 }}>
                  <Feather name="x" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>
            );
          })()}

          {/* Selected CRMS case panel */}
          {selectedCrmsCase && !selectedMapLoc && !searchPreview && (
            <View style={[s.locPanel, { borderColor: "#7c3aed", borderWidth: 1.5 }]}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <View style={{
                    backgroundColor: selectedCrmsCase.status === "RESOLVED" ? "#22c55e" : selectedCrmsCase.status === "ASSISTANCE_PROVIDED" ? "#8b5cf6" : selectedCrmsCase.status === "FP_UPDATED" ? "#3b82f6" : selectedCrmsCase.status === "TEAM_ACKNOWLEDGE_OTW" ? "#f59e0b" : "#ef4444",
                    borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1,
                  }}>
                    <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: "#fff", textTransform: "uppercase" }}>
                      {({ TO_BE_ASSIGNED: "To Be Assigned", TEAM_ACKNOWLEDGE_OTW: "Team OTW", FP_UPDATED: "FP Updated", ASSISTANCE_PROVIDED: "Assistance Given", RESOLVED: "Resolved" } as Record<string,string>)[selectedCrmsCase.status] ?? selectedCrmsCase.status}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: "#c4b5fd" }}>
                    {selectedCrmsCase.isWog ? "WOG " : ""}CRMS #{selectedCrmsCase.caseNumber}
                  </Text>
                </View>
                <Text style={s.locPanelName} numberOfLines={1}>{selectedCrmsCase.address}</Text>
                <Text style={[s.locPanelSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                  👤 {selectedCrmsCase.fpName} · {selectedCrmsCase.fpContact}
                  {selectedCrmsCase.assignedUnitCode ? `  🚒 ${selectedCrmsCase.assignedUnitCode}` : ""}
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <TouchableOpacity
                  style={[s.locPanelBtn, { backgroundColor: "rgba(124,58,237,0.15)", borderWidth: 1, borderColor: "#7c3aed" }]}
                  onPress={() => openCrmsDetail(selectedCrmsCase)}
                >
                  <Feather name="info" size={13} color="#a78bfa" />
                  <Text style={[s.locPanelBtnText, { color: "#a78bfa" }]}>Details</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.locPanelBtn, { backgroundColor: "#7c3aed" }]}
                  onPress={() => openCrmsAssignModal(selectedCrmsCase)}
                >
                  <Feather name="send" size={13} color="#FFF" />
                  <Text style={s.locPanelBtnText}>Assign</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={() => setSelectedCrmsCase(null)} style={{ padding: 6 }}>
                <Feather name="x" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
          )}

          {/* Deployed units ETA strip */}
          {entries.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ position: "absolute", bottom: tabBarH + 52, left: 0, right: 0, zIndex: 5 }}
              contentContainerStyle={{ paddingHorizontal: 12, gap: 8, paddingVertical: 4 }}
            >
              {[...entries].sort((a, b) => unitSortKey(a.unitCode) - unitSortKey(b.unitCode)).map((e) => {
                const loc = allLocations.find((l) => l.id === e.locationId);
                const arrived = (e as any).arrived;
                const arrivedAt = (e as any).arrivedAt;
                const eta = (e as any).eta;
                const timeLabel = arrived && arrivedAt ? `✅ ${arrivedAt}` : `ETA ${eta}`;
                return (
                  <TouchableOpacity
                    key={e.vehicleId}
                    onPress={() => {
                      const l = allLocations.find(l => l.id === e.locationId);
                      if (l) setSelectedMapLoc(l);
                    }}
                    style={{
                      backgroundColor: colors.card,
                      borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
                      borderWidth: 1.5, borderColor: unitColor(e.unitCode),
                      shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 3, elevation: 2,
                      minWidth: 110,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 2 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: unitColor(e.unitCode) }} />
                      <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: colors.foreground }}>{e.unitCode} {e.vehicleNumber}</Text>
                    </View>
                    <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular", color: colors.mutedForeground }} numberOfLines={1}>
                      📍 {loc?.name ?? e.locationId}
                    </Text>
                    <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: arrived ? colors.accent : colors.primary }}>
                      {timeLabel} hrs
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* Stats */}
          <View style={s.statsBar}>
            <View style={s.statCard}><View style={[s.statDot, { backgroundColor: colors.accent }]} /><Text style={s.statText}>{entries.length} deployed</Text></View>
            {pendingAssignments.length > 0 && (
              <TouchableOpacity style={[s.statCard, { borderColor: colors.primary }]} onPress={() => setViewMode("list")}>
                <View style={[s.statDot, { backgroundColor: colors.primary }]} />
                <Text style={[s.statText, { color: colors.primary }]}>{pendingAssignments.length} pending ›</Text>
              </TouchableOpacity>
            )}
            <View style={s.statCard}><View style={[s.statDot, { backgroundColor: colors.mutedForeground }]} /><Text style={s.statText}>{vehicles.length} live</Text></View>
          </View>
          {/* Placement mode banner */}
          {placementMode && (
            <View style={s.placementBanner}>
              <Feather name="crosshair" size={16} color="#FFF" style={{ marginRight: 8 }} />
              <Text style={s.placementBannerText}>Tap the map to drop a pin</Text>
              <TouchableOpacity onPress={() => setPlacementMode(false)} style={s.placementCancel}>
                <Feather name="x" size={16} color="#FFF" />
              </TouchableOpacity>
            </View>
          )}

          {/* Add Location button */}
          {!placementMode && (
            <TouchableOpacity style={s.addPinFab} onPress={() => setPlacementMode(true)}>
              <Feather name="map-pin" size={16} color="#FFF" />
              <Text style={s.addPinFabText}>Add Location</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ── LIST VIEW ── */}
      {viewMode === "list" && (
        <ScrollView contentContainerStyle={s.scrollContent}>
          {/* Auto / Rain assign action bar */}
          {rosterTeams.length > 0 && (
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
              <TouchableOpacity
                style={[s.addBtn, { flex: 1, justifyContent: "center", backgroundColor: rainAssigning ? colors.mutedForeground : "#0ea5e9", paddingVertical: 11 }]}
                onPress={handleRainAutoAssign}
                disabled={rainAssigning}
              >
                <Feather name="cloud-rain" size={15} color="#FFF" />
                <Text style={s.addBtnText}>{rainAssigning ? "Assigning…" : "Rain Assign"}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.addBtn, { flex: 1, justifyContent: "center", backgroundColor: autoAssigning ? colors.mutedForeground : colors.primary, paddingVertical: 11 }]}
                onPress={handleAutoAssign}
                disabled={autoAssigning}
              >
                <Feather name="zap" size={15} color="#FFF" />
                <Text style={s.addBtnText}>{autoAssigning ? "Assigning…" : "Auto Assign"}</Text>
              </TouchableOpacity>
            </View>
          )}

          {entries.length === 0 && pendingAssignments.length === 0 && (
            <View style={s.emptyBox}><Feather name="users" size={40} color={colors.mutedForeground} /><Text style={s.emptyText}>No units deployed or assigned yet</Text></View>
          )}

          {/* Deployed (confirmed) entries */}
          {entries.length > 0 && (
            <>
              <View style={s.sectionHeader}>
                <Text style={[s.sectionTitle, { color: colors.accent }]}>✅ DEPLOYED ({entries.length})</Text>
              </View>
              {[...entries].sort((a, b) => a.unitCode.localeCompare(b.unitCode)).map((entry) => {
                const loc = allLocations.find((l) => l.id === entry.locationId);
                return (
                  <View key={entry.vehicleId} style={s.listItem}>
                    <View style={[s.listIcon, { backgroundColor: unitColor(entry.unitCode) }]}><Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: unitFg(entry.unitCode) }}>{entry.unitCode.slice(0, 2)}</Text></View>
                    <View style={s.listInfo}>
                      <Text style={s.listTitle}>{entry.unitCode} · {entry.vehicleNumber}</Text>
                      <Text style={s.listSub}>{entry.partner} · {entry.shift}</Text>
                      <Text style={s.listSub}>{loc?.name ?? entry.locationId}</Text>
                      {(entry as any).assignedBy ? (
                        <Text style={[s.listSub, { fontSize: 10, color: colors.mutedForeground }]}>via {(entry as any).assignedBy}</Text>
                      ) : null}
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 4 }}>
                      <Text style={s.listEta}>{entry.eta} hrs</Text>
                      {(entry as any).weather && (() => {
                        const w = weatherEmoji((entry as any).weather);
                        return w ? (
                          <View style={[s.weatherPill, { borderColor: w.color + "88", backgroundColor: w.color + "18" }]}>
                            <Text style={[s.weatherPillText, { color: w.color }]}>{w.emoji} {(entry as any).weather}</Text>
                          </View>
                        ) : null;
                      })()}
                      <TouchableOpacity
                        style={{ backgroundColor: "#f59e0b22", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: "#f59e0b" }}
                        onPress={() => openReassignVehicleModal(entry as any)}
                      >
                        <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#f59e0b" }}>Reassign</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </>
          )}

          {/* Pending assignments (assigned but crew not yet arrived) */}
          {pendingAssignments.length > 0 && (
            <>
              <View style={[s.sectionHeader, { marginTop: entries.length > 0 ? 12 : 0 }]}>
                <Text style={[s.sectionTitle, { color: colors.primary }]}>⏳ PENDING ({pendingAssignments.length})</Text>
              </View>
              {pendingAssignments.map((a) => {
                const assignedAt = new Date(a.assignedAt);
                const minsAgo = Math.round((Date.now() - assignedAt.getTime()) / 60000);
                const agoLabel = minsAgo < 60 ? `${minsAgo}m ago` : `${Math.floor(minsAgo / 60)}h ago`;
                const rosterTeam = rosterTeams.find((t: any) =>
                  `${t.unitCode}-${t.vehicleNumber}` === a.vehicleId || t.unitCode === a.unitCode
                );
                return (
                  <View key={a.vehicleId} style={[s.listItem, { borderLeftWidth: 3, borderLeftColor: unitColor(a.unitCode ?? "") }]}>
                    <View style={[s.listIcon, { backgroundColor: unitColor(a.unitCode ?? "") }]}>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: unitFg(a.unitCode ?? "") }}>{a.unitCode?.slice(0, 2)}</Text>
                    </View>
                    <View style={s.listInfo}>
                      <Text style={s.listTitle}>{a.unitCode} · {a.vehicleNumber}</Text>
                      {rosterTeam && <Text style={s.listSub}>{rosterTeam.partner} · {rosterTeam.shift}</Text>}
                      <Text style={s.listSub}>→ {a.locationName}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 4 }}>
                      <View style={{ backgroundColor: colors.primary + "20", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3, borderWidth: 1, borderColor: colors.primary + "60" }}>
                        <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: colors.primary }}>Assigned</Text>
                      </View>
                      <Text style={[s.listSub, { fontSize: 10 }]}>{agoLabel}</Text>
                    </View>
                  </View>
                );
              })}
            </>
          )}

          {/* Reassignment history */}
          {reassignmentHistory.length > 0 && (
            <>
              <View style={[s.sectionHeader, { marginTop: 12 }]}>
                <Text style={[s.sectionTitle, { color: "#a78bfa" }]}>🔁 REASSIGNMENTS ({reassignmentHistory.length})</Text>
              </View>
              {[...reassignmentHistory].reverse().map((r: any, idx: number) => {
                const d = new Date(r.reassignedAt);
                const h = String((d.getUTCHours() + 8) % 24).padStart(2, "0");
                const m = String(d.getUTCMinutes()).padStart(2, "0");
                const timeLabel = `${h}${m} hrs`;
                return (
                  <View key={idx} style={[s.listItem, { borderLeftWidth: 3, borderLeftColor: "#a78bfa" }]}>
                    <View style={[s.listIcon, { backgroundColor: unitColor(r.unitCode ?? "") }]}>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: unitFg(r.unitCode ?? "") }}>{r.unitCode?.slice(0, 2)}</Text>
                    </View>
                    <View style={s.listInfo}>
                      <Text style={s.listTitle}>{r.unitCode} · {r.vehicleNumber}</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                        <Text style={[s.listSub, { color: colors.mutedForeground }]}>{r.fromLocationName}</Text>
                        <Text style={{ fontSize: 12, color: "#a78bfa" }}>→</Text>
                        <Text style={[s.listSub, { color: colors.foreground }]}>{r.toLocationName}</Text>
                      </View>
                      {r.reassignedBy ? (
                        <Text style={[s.listSub, { fontSize: 10, color: colors.mutedForeground }]}>via {r.reassignedBy}</Text>
                      ) : null}
                    </View>
                    <Text style={[s.listEta, { color: "#a78bfa", fontSize: 12 }]}>{timeLabel}</Text>
                  </View>
                );
              })}
            </>
          )}
        </ScrollView>
      )}

      {/* ── LOCATIONS VIEW ── */}
      {viewMode === "locations" && (
        <ScrollView contentContainerStyle={s.scrollContent}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>{allLocations.length} Locations</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity
                style={[s.addBtn, { backgroundColor: rainAssigning ? colors.mutedForeground : "#0ea5e9", paddingHorizontal: 10 }]}
                onPress={handleRainAutoAssign}
                disabled={rainAssigning}
              >
                <Text style={{ fontSize: 12 }}>🌧</Text>
                <Text style={s.addBtnText}>{rainAssigning ? "…" : "Rain"}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.addBtn, { backgroundColor: autoAssigning ? colors.mutedForeground : colors.primary, paddingHorizontal: 10 }]}
                onPress={handleAutoAssign}
                disabled={autoAssigning}
              >
                <Feather name="zap" size={13} color="#FFF" />
                <Text style={s.addBtnText}>{autoAssigning ? "…" : "Auto"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.addBtn} onPress={openAddModal}>
                <Feather name="plus" size={14} color="#FFF" />
                <Text style={s.addBtnText}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
          {allLocations.length === 0 ? (
            <View style={s.emptyBox}><Feather name="map-pin" size={40} color={colors.mutedForeground} /><Text style={s.emptyText}>No locations yet. Tap "Add" to create your first deployment point.</Text></View>
          ) : (
            allLocations.map((loc) => {
              const isAccepted = acceptedIds.includes(loc.id);
              const region = (loc as any).region as string | undefined;
              const priority = (loc as any).priority as number | undefined;
              return (
                <View key={loc.id} style={s.locRow}>
                  {isAccepted && <View style={s.acceptedDot} />}
                  <View style={s.locInfo}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {region && (
                        <View style={{ backgroundColor: colors.primary + "22", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: colors.primary + "55" }}>
                          <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: colors.primary }}>{region}{priority != null ? ` P${priority}` : ""}</Text>
                        </View>
                      )}
                      <Text style={s.locName}>{loc.name}</Text>
                    </View>
                    <Text style={s.locMeta}>{loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}{isAccepted ? "  ·  Accepted" : ""}</Text>
                  </View>
                  <View style={s.locActions}>
                    <TouchableOpacity style={[s.iconBtn, { backgroundColor: colors.accent, borderColor: colors.accent }]} onPress={() => openAssignModal(loc)}>
                      <Feather name="send" size={13} color="#FFF" />
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.iconBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => openEditModal(loc)}>
                      <Feather name="edit-2" size={13} color={colors.foreground} />
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.iconBtn, { backgroundColor: colors.destructive, borderColor: colors.destructive }]} onPress={() => handleDeleteLocation(loc)}>
                      <Feather name="trash-2" size={13} color="#FFF" />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {/* ── ROSTER VIEW ── */}
      {viewMode === "roster" && (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
            {/* Active roster */}
            {rosterTeams.length > 0 && (
              <View style={s.rosterActiveBox}>
                <View style={s.rosterActiveHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.rosterActiveLabel, { color: colors.accent }]}>✓ ROSTER ACTIVE</Text>
                    <Text style={[s.rosterActiveSub, { color: colors.mutedForeground }]}>{rosterTeams.length} teams loaded — crews see team picker on login</Text>
                    {deploymentState?.deploymentDate ? (
                      <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 }}>
                        📅 {deploymentState.deploymentDate}
                      </Text>
                    ) : null}
                  </View>
                  <TouchableOpacity onPress={clearRoster} style={[s.clearBtn, { borderColor: colors.destructive }]}>
                    <Text style={[s.clearBtnText, { color: colors.destructive }]}>Clear</Text>
                  </TouchableOpacity>
                </View>

                {/* Team filter chips — multi-select */}
                <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: 10, marginTop: 4 }}>
                  {(["ALL", ...["BU","PJ","WK","CP","KG"].filter(p => rosterTeams.some((r: any) => r.unitCode.startsWith(p)))] as string[]).map((chip) => {
                    const isAll = chip === "ALL";
                    const active = isAll ? rosterViewFilter.size === 0 : rosterViewFilter.has(chip);
                    return (
                      <TouchableOpacity
                        key={chip}
                        onPress={() => {
                          if (isAll) {
                            setRosterViewFilter(new Set());
                          } else {
                            setRosterViewFilter(prev => {
                              const next = new Set(prev);
                              if (next.has(chip)) next.delete(chip); else next.add(chip);
                              return next;
                            });
                          }
                        }}
                        style={{
                          paddingHorizontal: 12, paddingVertical: 4, borderRadius: 14,
                          borderWidth: 1,
                          borderColor: active ? colors.primary : colors.border,
                          backgroundColor: active ? colors.primary : "transparent",
                        }}
                      >
                        <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: active ? "#fff" : colors.mutedForeground }}>
                          {chip}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {rosterTeams.filter((t: any) => rosterViewFilter.size === 0 || rosterViewFilter.has(t.unitCode.slice(0, 2))).map((t: any) => (
                  <View key={t.id} style={[s.rosterRow, { borderColor: colors.border }]}>
                    <View style={[s.rosterAvatar, { backgroundColor: unitColor(t.unitCode) }]}>
                      <Text style={s.rosterAvatarText}>{t.unitCode.slice(0, 2)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.rosterUnit, { color: colors.foreground }]}>{t.unitCode}{t.vehicleNumber ? `  ${t.vehicleNumber}` : ""}</Text>
                      <Text style={[s.rosterPartner, { color: colors.mutedForeground }]}>{t.partner}</Text>
                    </View>
                    <View style={[s.shiftPill, { backgroundColor: colors.primary + "20" }]}>
                      <Text style={[s.shiftPillText, { color: colors.primary }]}>{t.shift}</Text>
                    </View>
                  </View>
                ))}

                {/* On-duty shift selector */}
                <View style={{ marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>
                    On Duty Shifts for Deployment
                  </Text>
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                    {(["DAY", "PD", "ND"] as const).map((s) => {
                      const active = pendingShifts.has(s);
                      return (
                        <TouchableOpacity
                          key={s}
                          onPress={() => togglePendingShift(s)}
                          style={{
                            paddingHorizontal: 18, paddingVertical: 7, borderRadius: 20,
                            borderWidth: 1,
                            borderColor: active ? colors.primary : colors.border,
                            backgroundColor: active ? colors.primary : "transparent",
                          }}
                        >
                          <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: active ? "#FFF" : colors.mutedForeground }}>
                            {s}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <TouchableOpacity
                    onPress={saveActiveShifts}
                    style={{ backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 18, alignSelf: "flex-start" }}
                  >
                    <Text style={{ color: "#FFF", fontSize: 13, fontFamily: "Inter_600SemiBold" }}>Save Selection</Text>
                  </TouchableOpacity>
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 8 }}>
                    Saved: {serverActiveTeams.length > 0 ? serverActiveTeams.join(" + ") : "ALL teams"}{"  ·  "}{activeShifts.join(" + ")}
                  </Text>
                </View>
              </View>
            )}

            {/* Paste new roster */}
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>{rosterTeams.length > 0 ? "Replace Roster" : "Load Roster"}</Text>
            </View>
            <Text style={[s.hintText, { color: colors.mutedForeground, marginBottom: 10 }]}>
              Paste today's deployment list. One entry per line:{"\n"}
              <Text style={{ fontFamily: "Inter_600SemiBold" }}>BU1 TST0004A: Officer-37 & Officer-26 (DAY)</Text>
            </Text>
            <TextInput
              style={[s.pasteArea, { backgroundColor: colors.card, borderColor: rosterError ? colors.destructive : colors.border, color: colors.foreground }]}
              value={rosterText}
              onChangeText={setRosterText}
              placeholder={"BU1 TST0004A: Officer-37 & Officer-26 (DAY)\nWK3 SFB991Y: Officer-28 (ND)\nCP2 : Officer-14 & Farhan (PD)"}
              placeholderTextColor={colors.mutedForeground}
              multiline
              textAlignVertical="top"
            />
            {rosterError ? <Text style={[s.errorText, { color: colors.destructive }]}>{rosterError}</Text> : null}
            <TouchableOpacity
              style={[s.actionBtn, { backgroundColor: colors.primary, opacity: rosterLoading ? 0.7 : 1 }]}
              onPress={importRoster}
              disabled={rosterLoading}
            >
              {rosterLoading
                ? <ActivityIndicator color="#FFF" size="small" />
                : <Text style={s.actionBtnText}>Parse & Save Roster</Text>
              }
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* ── ALERT VIEW ── */}
      {viewMode === "alert" && (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
            {/* Active alert */}
            {activeAlert && (
              <View style={s.alertActiveBox}>
                <View style={s.alertActiveHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.alertActiveLabel}>🔴 ACTIVE ALERT</Text>
                    <Text style={[s.alertActiveSub, { color: colors.mutedForeground }]}>
                      {activeAlert.acknowledgments?.length ?? 0} team{(activeAlert.acknowledgments?.length ?? 0) === 1 ? "" : "s"} acknowledged
                    </Text>
                  </View>
                  <TouchableOpacity onPress={clearAlert} style={[s.clearBtn, { borderColor: colors.destructive }]}>
                    <Text style={[s.clearBtnText, { color: colors.destructive }]}>Clear</Text>
                  </TouchableOpacity>
                </View>
                <Text style={[s.alertText, { color: colors.foreground }]}>{activeAlert.extracted}</Text>
                {activeAlert.acknowledgments?.length > 0 && (
                  <Text style={[s.alertAckList, { color: colors.accent }]}>
                    {activeAlert.acknowledgments.join(" · ")}
                  </Text>
                )}
              </View>
            )}

            {/* Paste new alert */}
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>{activeAlert ? "Replace Alert" : "Broadcast Alert"}</Text>
            </View>
            <Text style={[s.hintText, { color: colors.mutedForeground, marginBottom: 10 }]}>
              Paste the full NEA message. Irrelevant lines (Frm:, automated messages) are stripped automatically.
            </Text>
            <TextInput
              style={[s.pasteArea, { backgroundColor: colors.card, borderColor: alertError ? colors.destructive : colors.border, color: colors.foreground }]}
              value={alertText}
              onChangeText={setAlertText}
              placeholder={"National Environment Agency\n---\nHEAVY RAIN WARNING\n..."}
              placeholderTextColor={colors.mutedForeground}
              multiline
              textAlignVertical="top"
            />
            {alertError ? <Text style={[s.errorText, { color: colors.destructive }]}>{alertError}</Text> : null}
            <TouchableOpacity
              style={[s.actionBtn, { backgroundColor: "#ef4444", opacity: alertLoading ? 0.7 : 1 }]}
              onPress={broadcastAlert}
              disabled={alertLoading}
            >
              {alertLoading
                ? <ActivityIndicator color="#FFF" size="small" />
                : <Text style={s.actionBtnText}>📢 Extract & Broadcast to Crews</Text>
              }
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* ── WLS VIEW ── */}
      {viewMode === "wls" && (
        <ScrollView contentContainerStyle={s.scrollContent}>
          {/* Header */}
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 14, gap: 8 }}>
            <View style={{ backgroundColor: "#0ea5e9", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: 0.5 }}>🌊 WLS ALERT</Text>
            </View>
            {wlsData?.count ? (
              <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: colors.mutedForeground }}>
                {wlsData.count} station{wlsData.count !== 1 ? "s" : ""}
              </Text>
            ) : null}
            {wlsData?.lastUpdated && (
              <Text style={{ fontSize: 11, color: colors.mutedForeground, marginLeft: "auto" }}>
                {new Date(wlsData.lastUpdated).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" })}
              </Text>
            )}
          </View>

          {/* ── Tide widget ── */}
          {tideData && (
            <View style={{
              backgroundColor: "#0c1a2e", borderRadius: 12, borderWidth: 1,
              borderColor: "#0ea5e966", padding: 14, marginBottom: 14,
            }}>
              <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#38bdf8", letterSpacing: 1.2, marginBottom: 10 }}>
                🌊 TIDE — MARINA BARRAGE
              </Text>
              {/* Main row: height + direction + rate */}
              <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 12, marginBottom: 10 }}>
                <Text style={{ fontSize: 36, fontFamily: "Inter_700Bold", color: "#38bdf8", lineHeight: 40 }}>
                  {tideData.height.toFixed(2)}
                  <Text style={{ fontSize: 16, color: "#7dd3fc" }}>m</Text>
                </Text>
                <View style={{ paddingBottom: 4 }}>
                  <Text style={{ fontSize: 28, lineHeight: 34, color: tideData.rising ? "#34d399" : "#f87171" }}>
                    {tideData.rising ? "↑" : "↓"}
                  </Text>
                </View>
                <View style={{ paddingBottom: 6 }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: tideData.rising ? "#34d399" : "#f87171" }}>
                    {tideData.rising ? "Rising" : "Falling"}
                  </Text>
                  <Text style={{ fontSize: 11, color: "#7dd3fc", marginTop: 2 }}>
                    {tideData.ratePerHour > 0 ? "+" : ""}{tideData.ratePerHour.toFixed(3)} m/hr
                  </Text>
                </View>
              </View>
              {/* Next high / next low */}
              <View style={{ flexDirection: "row", gap: 8 }}>
                {tideData.nextHigh && (
                  <View style={{ flex: 1, backgroundColor: "#34d39915", borderRadius: 8, padding: 8, borderWidth: 1, borderColor: "#34d39944" }}>
                    <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#34d399", letterSpacing: 0.8, marginBottom: 3 }}>
                      ▲ NEXT HIGH
                    </Text>
                    <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" }}>{tideData.nextHigh.local}</Text>
                    <Text style={{ fontSize: 12, color: "#34d399", marginTop: 1 }}>{tideData.nextHigh.height.toFixed(1)}m</Text>
                  </View>
                )}
                {tideData.nextLow && (
                  <View style={{ flex: 1, backgroundColor: "#f8717115", borderRadius: 8, padding: 8, borderWidth: 1, borderColor: "#f8717144" }}>
                    <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#f87171", letterSpacing: 0.8, marginBottom: 3 }}>
                      ▼ NEXT LOW
                    </Text>
                    <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" }}>{tideData.nextLow.local}</Text>
                    <Text style={{ fontSize: 12, color: "#f87171", marginTop: 1 }}>{tideData.nextLow.height.toFixed(1)}m</Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* Fetch error banner */}
          {wlsError && (
            <View style={{ backgroundColor: "#ef444420", borderRadius: 8, borderWidth: 1, borderColor: "#ef4444", padding: 10, marginBottom: 10 }}>
              <Text style={{ fontSize: 12, color: "#ef4444", fontFamily: "Inter_500Medium" }}>⚠ Fetch error: {wlsError}</Text>
            </View>
          )}

          {/* ── SECTION 1: WLS ALERTS ── */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: colors.mutedForeground, letterSpacing: 1, textTransform: "uppercase" }}>
              Water Level Alerts
            </Text>
            {wlsData?.lastUpdated && (
              <Text style={{ fontSize: 10, color: colors.mutedForeground }}>
                Updated {new Date(wlsData.lastUpdated).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" })} · auto-clears after 1 hr
              </Text>
            )}
          </View>

          {(!wlsData || wlsData.count === 0) ? (
            <View style={{ backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 16, alignItems: "center", marginBottom: 16 }}>
              <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_500Medium" }}>No active water level alerts</Text>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 4 }}>Alerts auto-clear 1 hour after last SMS</Text>
            </View>
          ) : (
            <View style={{ marginBottom: 16 }}>
              {[
                { key: "CRITICAL", label: "🔴 CRITICAL",    color: "#EF4444", bg: "#EF444415", border: "#EF4444AA" },
                { key: "FULL",     label: "🔴 FULL (100%)", color: "#EF4444", bg: "#EF444415", border: "#EF4444AA" },
                { key: "HIGH",     label: "🟠 HIGH (90%)",  color: "#F97316", bg: "#F9731615", border: "#F97316AA" },
                { key: "MEDIUM",   label: "🟡 MEDIUM (75%)",color: "#EAB308", bg: "#EAB30815", border: "#EAB308AA" },
              ].map(({ key, label, color, bg, border }) => {
                const stations: any[] = wlsData.grouped?.[key] ?? [];
                if (!stations.length) return null;
                return (
                  <View key={key} style={{ backgroundColor: bg, borderRadius: 10, borderWidth: 1, borderColor: border, padding: 12, marginBottom: 8 }}>
                    <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color, letterSpacing: 0.5, marginBottom: 6 }}>
                      {label}
                    </Text>
                    {stations.map((st: any) => (
                      <View key={st.stationId} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 3 }}>
                        <Text style={{ fontSize: 14, lineHeight: 18 }}>{st.direction === "RISE" ? "⬆️" : st.direction === "FALL" ? "⬇️" : "→"}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>
                            {st.locationName}
                          </Text>
                          {st.waterLevelM != null && (
                            <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{st.waterLevelM.toFixed(3)} m</Text>
                          )}
                        </View>
                      </View>
                    ))}
                  </View>
                );
              })}
            </View>
          )}

          {/* ── SECTION 2: TIDE GATE STATUS ── */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: colors.mutedForeground, letterSpacing: 1, textTransform: "uppercase" }}>
              Tide Gate Status
            </Text>
            {wlsData?.tideGate?.length ? (
              <Text style={{ fontSize: 10, color: colors.mutedForeground }}>
                {new Date(wlsData.tideGate[0].receivedAt).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" })}
              </Text>
            ) : null}
          </View>

          {(!wlsData?.tideGate?.length) ? (
            <View style={{ backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 16, alignItems: "center", marginBottom: 16 }}>
              <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_500Medium" }}>No tide gate status received</Text>
            </View>
          ) : (
            <View style={{ marginBottom: 16 }}>
              {wlsData.tideGate.map((tg: any) => (
                <View key={tg.stationId} style={{ backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#6B7280", letterSpacing: 0.8 }}>
                      TIDE GATE · {tg.timestamp || tg.senderName}
                    </Text>
                    <Text style={{ fontSize: 10, color: colors.mutedForeground }}>
                      {new Date(tg.receivedAt).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" })}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: "Inter_400Regular", lineHeight: 20 }}>
                    {tg.locationName}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* ── Manual paste form ── */}
          <View style={{ backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8 }}>
            <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: colors.mutedForeground, letterSpacing: 0.5, marginBottom: 8 }}>
              PASTE SMS
            </Text>
            <TextInput
              style={{
                backgroundColor: colors.background, borderRadius: 8, borderWidth: 1,
                borderColor: colors.border, color: colors.foreground,
                padding: 10, fontSize: 12, fontFamily: "Inter_400Regular",
                minHeight: 70, textAlignVertical: "top", marginBottom: 8,
              }}
              value={wlsPasteText}
              onChangeText={setWlsPasteText}
              placeholder={"Paste WLS Alert or Tide Gate SMS here…"}
              placeholderTextColor={colors.mutedForeground}
              multiline
            />
            {wlsIngestResult ? (
              <Text style={{
                fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 6,
                color: wlsIngestResult.startsWith("✓") ? colors.accent : "#ef4444",
              }}>
                {wlsIngestResult}
              </Text>
            ) : null}
            <TouchableOpacity
              style={[s.actionBtn, { backgroundColor: "#0ea5e9", opacity: wlsIngestLoading || !wlsPasteText.trim() ? 0.6 : 1 }]}
              onPress={handleWlsIngest}
              disabled={wlsIngestLoading || !wlsPasteText.trim()}
            >
              {wlsIngestLoading
                ? <ActivityIndicator color="#FFF" size="small" />
                : <Text style={s.actionBtnText}>📥 Ingest SMS</Text>
              }
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* ── CRMS VIEW ── */}
      {viewMode === "crms" && (
        <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10, gap: 8 }}>
            <View style={{ backgroundColor: "#7c3aed", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: 0.5 }}>📋 CRMS</Text>
            </View>
            <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: colors.mutedForeground, flex: 1 }}>
              {crmsCases.length} case{crmsCases.length !== 1 ? "s" : ""} · {crmsCases.filter(c => c.status !== "RESOLVED").length} open
            </Text>
            {/* Refresh icon button */}
            <TouchableOpacity
              onPress={async () => { setCrmsRefreshing(true); await loadCrmsCases(); setCrmsRefreshing(false); }}
              style={{ padding: 7, backgroundColor: "rgba(124,58,237,0.15)", borderRadius: 8, borderWidth: 1, borderColor: "rgba(124,58,237,0.3)" }}
            >
              {crmsRefreshing
                ? <ActivityIndicator size="small" color="#a78bfa" />
                : <Feather name="refresh-cw" size={15} color="#a78bfa" />}
            </TouchableOpacity>
          </View>

          {/* Action toolbar */}
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
            <TouchableOpacity
              onPress={async () => {
                const lines: string[] = [
                  "CRMS CASE SUMMARY",
                  `${new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore" })}`,
                  `Total: ${crmsCases.length} case${crmsCases.length !== 1 ? "s" : ""} · ${crmsCases.filter(c => c.status !== "RESOLVED").length} open`,
                  "=".repeat(50),
                ];
                for (const c of crmsCases) {
                  lines.push(`\n[${c.status}] ${c.isWog ? "WOG " : ""}CRMS #${c.caseNumber}`);
                  lines.push(`FP: ${c.fpName} | ${c.fpContact}`);
                  lines.push(`Address: ${c.address || "—"}`);
                  if (c.assignedUnitCode) lines.push(`Assigned: ${c.assignedUnitCode}`);
                  if (c.details) lines.push(`Details: ${c.details}`);
                  if (c.comments?.length > 0) {
                    lines.push("Field Comments:");
                    for (const cm of c.comments) {
                      const t = new Date(cm.createdAt).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" });
                      lines.push(`  [${t}] ${cm.unitCode}: ${cm.text}`);
                    }
                  }
                  lines.push("-".repeat(40));
                }
                await Clipboard.setStringAsync(lines.join("\n"));
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                Alert.alert("Copied", "Case summary copied to clipboard");
              }}
              style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.card, borderRadius: 9, paddingVertical: 9, borderWidth: 1, borderColor: colors.border }}
            >
              <Feather name="copy" size={13} color={colors.foreground} />
              <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>Copy Summary</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={async () => {
                try {
                  const res = await fetch(`${API_BASE_CRMS}/api/crms/report?format=text`, { cache: "no-store" });
                  const text = await res.text();
                  await Share.share({ message: text, title: "CRMS Case Report" });
                } catch {
                  Alert.alert("Error", "Could not export report");
                }
              }}
              style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.card, borderRadius: 9, paddingVertical: 9, borderWidth: 1, borderColor: colors.border }}
            >
              <Feather name="share" size={13} color={colors.foreground} />
              <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>Export Report</Text>
            </TouchableOpacity>

            {/* Hide/Show Resolved toggle */}
            {crmsCases.some(c => c.status === "RESOLVED") && (
              <TouchableOpacity
                onPress={() => setCrmsHideResolved(h => !h)}
                style={{ paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: crmsHideResolved ? "rgba(124,58,237,0.2)" : colors.card, borderRadius: 9, paddingVertical: 9, borderWidth: 1, borderColor: crmsHideResolved ? "#7c3aed" : colors.border }}
              >
                <Feather name={crmsHideResolved ? "eye-off" : "eye"} size={13} color={crmsHideResolved ? "#c4b5fd" : colors.mutedForeground} />
                <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: crmsHideResolved ? "#c4b5fd" : colors.mutedForeground }}>
                  {crmsHideResolved ? "Show Resolved" : "Hide Resolved"}
                </Text>
              </TouchableOpacity>
            )}

            {/* Clear Resolved — with 10 s undo */}
            {crmsCases.some(c => c.status === "RESOLVED") && (
              <TouchableOpacity
                onPress={() => {
                  const resolved = crmsCases.filter(c => c.status === "RESOLVED");
                  setCrmsCases(prev => prev.filter(c => c.status !== "RESOLVED"));
                  const undoPayload = { type: "clear_resolved" as const, cases: resolved, label: `${resolved.length} resolved case${resolved.length !== 1 ? "s" : ""}` };
                  setCrmsUndoData(undoPayload);
                  commitCrmsUndo(undoPayload, crmsAuthHeaders());
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                }}
                style={{ paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: "rgba(239,68,68,0.1)", borderRadius: 9, paddingVertical: 9, borderWidth: 1, borderColor: "#ef444466" }}
              >
                <Feather name="trash-2" size={13} color="#ef4444" />
              </TouchableOpacity>
            )}
          </View>

          {/* Undo banner */}
          {crmsUndoData && (
            <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#1e2233", borderRadius: 10, borderWidth: 1, borderColor: "#f59e0b66", padding: 12, marginBottom: 12, gap: 10 }}>
              <Feather name="clock" size={15} color="#fcd34d" />
              <Text style={{ flex: 1, fontSize: 12, color: "#fcd34d", fontFamily: "Inter_500Medium" }}>
                {crmsUndoData.type === "delete" ? `Deleting ${crmsUndoData.label}` : `Cleared ${crmsUndoData.label}`} — 10 s to undo
              </Text>
              <TouchableOpacity
                onPress={() => {
                  if (crmsUndoTimer.current) clearTimeout(crmsUndoTimer.current);
                  setCrmsCases(prev => {
                    const existingIds = new Set(prev.map(c => c.id));
                    return [...prev, ...crmsUndoData.cases.filter(c => !existingIds.has(c.id))];
                  });
                  setCrmsUndoData(null);
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }}
                style={{ backgroundColor: "#f59e0b", borderRadius: 7, paddingHorizontal: 12, paddingVertical: 6 }}
              >
                <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: "#1e2233" }}>↩ Undo</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Ingest box */}
          <View style={{ backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: "rgba(124,58,237,0.3)", padding: 14, marginBottom: 16 }}>
            <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#a78bfa", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }}>Ingest CRMS Message</Text>
            <TextInput
              style={[s.pasteInput, { borderColor: "rgba(124,58,237,0.3)", minHeight: 80 }]}
              value={crmsPasteText}
              onChangeText={setCrmsPasteText}
              placeholder={"Paste forwarded SMS/email…\n\nFrom xyz@pub.gov.sg\nWOG CRMS: 12345 FP: John, 91234567 Add: 123 Orchard Rd S238801 Details: Flooding reported"}
              placeholderTextColor={colors.mutedForeground}
              multiline
            />
            {crmsIngestResult && (
              <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 6, color: crmsIngestResult.startsWith("✓") ? "#86efac" : "#ef4444" }}>
                {crmsIngestResult}
              </Text>
            )}
            <TouchableOpacity
              style={[s.actionBtn, { backgroundColor: "#7c3aed", opacity: crmsIngestLoading || !crmsPasteText.trim() ? 0.6 : 1 }]}
              onPress={handleCrmsIngest}
              disabled={crmsIngestLoading || !crmsPasteText.trim()}
            >
              {crmsIngestLoading
                ? <ActivityIndicator color="#FFF" size="small" />
                : <Text style={s.actionBtnText}>📥 Parse & Geocode</Text>
              }
            </TouchableOpacity>
          </View>

          {/* Case list */}
          <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: colors.mutedForeground, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>Cases</Text>
          {crmsCases.length === 0 ? (
            <View style={{ backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 16, alignItems: "center" }}>
              <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_500Medium" }}>No CRMS cases yet</Text>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 4 }}>Paste a forwarded CRMS SMS above to get started</Text>
            </View>
          ) : (
            crmsCases.filter(c => crmsHideResolved ? c.status !== "RESOLVED" : true).map(c => {
              const CRMS_STATUS_COLOR: Record<string,string> = { TO_BE_ASSIGNED:"#ef4444", TEAM_ACKNOWLEDGE_OTW:"#f59e0b", FP_UPDATED:"#3b82f6", ASSISTANCE_PROVIDED:"#8b5cf6", RESOLVED:"#22c55e" };
              const CRMS_STATUS_LABEL: Record<string,string> = { TO_BE_ASSIGNED:"To Be Assigned", TEAM_ACKNOWLEDGE_OTW:"Team OTW", FP_UPDATED:"FP Updated", ASSISTANCE_PROVIDED:"Assistance Given", RESOLVED:"Resolved" };
              const statusColor = CRMS_STATUS_COLOR[c.status] ?? "#7c3aed";
              const statusLabel = CRMS_STATUS_LABEL[c.status] ?? c.status;
              return (
                <TouchableOpacity
                  key={c.id}
                  activeOpacity={0.8}
                  onPress={() => openCrmsDetail(c)}
                  onLongPress={() => {
                    setCrmsDetailCase(c);
                    setCrmsEditMode(false);
                    setCrmsEditForm({ fpName: c.fpName ?? "", fpContact: c.fpContact ?? "", address: c.address ?? "", details: c.details ?? "", lat: c.lat != null ? String(c.lat) : "", lng: c.lng != null ? String(c.lng) : "" });
                    setCrmsDeleteConfirm(true);
                    setCrmsDetailVisible(true);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                  }}
                  style={{ backgroundColor: colors.card, borderRadius: 11, borderWidth: 1, borderColor: "rgba(124,58,237,0.25)", padding: 12, marginBottom: 10 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: "#c4b5fd" }}>
                      {c.isWog ? "WOG " : ""}CRMS #{c.caseNumber}
                    </Text>
                    <View style={{ backgroundColor: statusColor + "25", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: statusColor + "66" }}>
                      <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: statusColor, textTransform: "uppercase", letterSpacing: 0.5 }}>{statusLabel}</Text>
                    </View>
                    {c.assignedUnitCode && (
                      <Text style={{ fontSize: 10, color: "#7c3aed", fontFamily: "Inter_600SemiBold", marginLeft: "auto" }}>🚒 {c.assignedUnitCode}</Text>
                    )}
                  </View>
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, marginBottom: 3 }} numberOfLines={2}>{c.address}</Text>
                  <Text style={{ fontSize: 12, color: colors.foreground }}>👤 {c.fpName} · {c.fpContact}</Text>
                  {c.details ? <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 3 }} numberOfLines={2}>{c.details}</Text> : null}
                  {c.comments?.length > 0 && (
                    <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
                      <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#7c3aed", marginBottom: 5, letterSpacing: 0.5 }}>FIELD COMMENTS</Text>
                      {c.comments.slice(0, 2).map((cm: any) => (
                        <View key={cm.commentId} style={{ backgroundColor: colors.secondary, borderRadius: 6, padding: 7, marginBottom: 5 }}>
                          <Text style={{ fontSize: 10, color: colors.mutedForeground, marginBottom: 2 }}>
                            {cm.unitCode} · {new Date(cm.createdAt).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" })}
                          </Text>
                          <Text style={{ fontSize: 12, color: colors.foreground }}>{cm.text}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  <Text style={{ fontSize: 10, color: colors.mutedForeground, marginTop: 6, textAlign: "right" }}>Tap for details · Hold to delete</Text>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      )}

      {/* ── CRMS CASE DETAIL MODAL ── */}
      {crmsDetailVisible && crmsDetailCase && (
        <>
          <Pressable style={s.modalOverlay} onPress={() => { setCrmsDetailVisible(false); setCrmsDeleteConfirm(false); setCrmsCommentText(""); }} />
          <View style={[s.modalSheet, { maxHeight: "90%", paddingBottom: insets.bottom + 16 }]}>
            <View style={s.modalHandle} />

            {/* Header */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <View style={{
                backgroundColor: ({ TO_BE_ASSIGNED:"#ef4444", TEAM_ACKNOWLEDGE_OTW:"#f59e0b", FP_UPDATED:"#3b82f6", ASSISTANCE_PROVIDED:"#8b5cf6", RESOLVED:"#22c55e" } as Record<string,string>)[crmsDetailCase.status] ?? "#7c3aed",
                borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
              }}>
                <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff", textTransform: "uppercase" }}>
                  {({ TO_BE_ASSIGNED:"To Be Assigned", TEAM_ACKNOWLEDGE_OTW:"Team OTW", FP_UPDATED:"FP Updated", ASSISTANCE_PROVIDED:"Assistance Given", RESOLVED:"Resolved" } as Record<string,string>)[crmsDetailCase.status] ?? crmsDetailCase.status}
                </Text>
              </View>
              <Text style={[s.modalTitle, { marginBottom: 0, flex: 1 }]}>
                {crmsDetailCase.isWog ? "WOG " : ""}CRMS #{crmsDetailCase.caseNumber}
              </Text>
              <TouchableOpacity
                onPress={() => { setCrmsEditMode(m => !m); setCrmsDeleteConfirm(false); }}
                style={{ padding: 4, marginRight: 4 }}
              >
                <Feather name={crmsEditMode ? "eye" : "edit-2"} size={17} color={crmsEditMode ? "#a78bfa" : colors.mutedForeground} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setCrmsDetailVisible(false); setCrmsDeleteConfirm(false); setCrmsEditMode(false); setCrmsCommentText(""); }}>
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            {/* Delete confirmation banner — always visible at top, never hidden by scroll */}
            {crmsDeleteConfirm && !crmsEditMode && (
              <View style={{ backgroundColor: "rgba(239,68,68,0.12)", borderRadius: 10, borderWidth: 1.5, borderColor: "#ef4444", padding: 14, marginTop: 8, marginBottom: 4 }}>
                <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: "#ef4444", marginBottom: 4 }}>Delete this case?</Text>
                <Text style={{ fontSize: 12, color: "#fca5a5", marginBottom: 12 }}>
                  CRMS #{crmsDetailCase.caseNumber} will be removed. You'll have 10 s to undo.
                </Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: "#ef4444", borderRadius: 9, paddingVertical: 11, alignItems: "center" }}
                    onPress={handleCrmsDelete}
                  >
                    <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" }}>Delete</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flex: 1, backgroundColor: colors.secondary, borderRadius: 9, paddingVertical: 11, alignItems: "center", borderWidth: 1, borderColor: colors.border }}
                    onPress={() => setCrmsDeleteConfirm(false)}
                  >
                    <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground }}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
              <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8 }}>

                {crmsEditMode ? (
                  /* ─── EDIT FORM ─── */
                  <>
                    {[
                      { label: "Focal Point Name", key: "fpName", placeholder: "e.g. John Tan" },
                      { label: "Focal Point Contact", key: "fpContact", placeholder: "e.g. 91234567" },
                      { label: "Address", key: "address", placeholder: "e.g. 100 Bukit Timah Road S229835", multi: true },
                      { label: "Details", key: "details", placeholder: "Incident details...", multi: true },
                    ].map(({ label, key, placeholder, multi }) => (
                      <View key={key} style={{ marginBottom: 12 }}>
                        <Text style={s.label}>{label}</Text>
                        <TextInput
                          style={[s.input, multi ? { minHeight: 60, textAlignVertical: "top" } : {}]}
                          value={(crmsEditForm as any)[key]}
                          onChangeText={(v) => setCrmsEditForm(f => ({ ...f, [key]: v }))}
                          placeholder={placeholder}
                          placeholderTextColor={colors.mutedForeground}
                          multiline={multi}
                        />
                      </View>
                    ))}

                    {/* Map Pin — direct lat/lng fields + map picker button */}
                    <View style={{ marginBottom: 12 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <Text style={s.label}>Map Pin (Lat / Lng)</Text>
                        <TouchableOpacity
                          onPress={() => {
                            const seedLat = parseFloat(crmsEditForm.lat) || crmsDetailCase?.lat || 1.3521;
                            const seedLng = parseFloat(crmsEditForm.lng) || crmsDetailCase?.lng || 103.8198;
                            crmsMapPinRef.current = { lat: seedLat, lng: seedLng };
                            setCrmsMapPinDisplay({ lat: seedLat, lng: seedLng });
                            setCrmsMapPinVisible(true);
                          }}
                          style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(124,58,237,0.15)", borderRadius: 7, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: "rgba(124,58,237,0.35)" }}
                        >
                          <Feather name="map" size={12} color="#c4b5fd" />
                          <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#c4b5fd" }}>Pick on Map</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <TextInput
                          style={[s.input, { flex: 1 }]}
                          value={crmsEditForm.lat}
                          onChangeText={(v) => setCrmsEditForm(f => ({ ...f, lat: v }))}
                          placeholder="Latitude  e.g. 1.35000"
                          placeholderTextColor={colors.mutedForeground}
                          keyboardType="numeric"
                        />
                        <TextInput
                          style={[s.input, { flex: 1 }]}
                          value={crmsEditForm.lng}
                          onChangeText={(v) => setCrmsEditForm(f => ({ ...f, lng: v }))}
                          placeholder="Longitude  e.g. 103.82000"
                          placeholderTextColor={colors.mutedForeground}
                          keyboardType="numeric"
                        />
                      </View>
                    </View>

                    {/* Re-geocode helper */}
                    <View style={{ backgroundColor: "rgba(14,165,233,0.08)", borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: "rgba(14,165,233,0.25)" }}>
                      <Text style={{ fontSize: 11, color: "#7dd3fc", marginBottom: 8 }}>
                        Edit address above, then tap Re-geocode to auto-fill the map pin from OneMap.
                      </Text>
                      <TouchableOpacity
                        onPress={async () => { await handleCrmsEditSave(); handleCrmsRegeocode(); }}
                        disabled={crmsRegeocoding || crmsEditSaving}
                        style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#0ea5e9", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, alignSelf: "flex-start", opacity: crmsRegeocoding || crmsEditSaving ? 0.6 : 1 }}
                      >
                        {crmsRegeocoding ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="map-pin" size={13} color="#fff" />}
                        <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" }}>Save & Re-geocode</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  /* ─── VIEW MODE ─── */
                  <>
                    {[
                      { label: "Address", value: crmsDetailCase.address || "—" },
                      { label: "Focal Point", value: `${crmsDetailCase.fpName} · ${crmsDetailCase.fpContact}` },
                      { label: "Details", value: crmsDetailCase.details || "—" },
                      { label: "Assigned", value: crmsDetailCase.assignedUnitCode || "Not assigned" },
                      { label: "Map Pin", value: crmsDetailCase.lat ? `${crmsDetailCase.lat.toFixed(5)}, ${crmsDetailCase.lng.toFixed(5)}` : "⚠️ Not geocoded — tap ✏️ to edit address" },
                      { label: "Received", value: new Date(crmsDetailCase.receivedAt).toLocaleString("en-SG", { timeZone: "Asia/Singapore", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) },
                    ].map(({ label, value }) => (
                      <View key={label} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 10 }}>
                        <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 }}>{label}</Text>
                        <Text style={{ fontSize: 13, color: label === "Map Pin" && !crmsDetailCase.lat ? "#f59e0b" : colors.foreground, fontFamily: "Inter_400Regular" }}>{value}</Text>
                      </View>
                    ))}

                    {/* Field comments */}
                    {crmsDetailCase.comments?.length > 0 && (
                      <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
                        <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#7c3aed", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>Field Comments</Text>
                        {crmsDetailCase.comments.map((cm: any) => (
                          <View key={cm.commentId} style={{ backgroundColor: colors.secondary, borderRadius: 8, padding: 10, marginBottom: 6 }}>
                            <Text style={{ fontSize: 10, color: colors.mutedForeground, marginBottom: 3 }}>
                              {cm.unitCode} · {new Date(cm.createdAt).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" })}
                            </Text>
                            <Text style={{ fontSize: 13, color: colors.foreground }}>{cm.text}</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Add comment */}
                    <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, marginTop: 10 }}>
                      <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#7c3aed", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>Add Comment</Text>
                      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
                        <TextInput
                          value={crmsCommentText}
                          onChangeText={setCrmsCommentText}
                          placeholder="Add a field note or instruction…"
                          placeholderTextColor={colors.mutedForeground}
                          multiline
                          style={{
                            flex: 1,
                            borderWidth: 1,
                            borderColor: colors.border,
                            borderRadius: 8,
                            padding: 10,
                            fontSize: 13,
                            color: colors.foreground,
                            backgroundColor: colors.secondary,
                            minHeight: 42,
                            maxHeight: 100,
                            fontFamily: "Inter_400Regular",
                          }}
                        />
                        <TouchableOpacity
                          onPress={handleCrmsAddComment}
                          disabled={crmsCommentSending || !crmsCommentText.trim()}
                          style={{
                            backgroundColor: crmsCommentText.trim() ? "#7c3aed" : colors.border,
                            borderRadius: 8,
                            paddingHorizontal: 14,
                            paddingVertical: 11,
                            opacity: crmsCommentSending ? 0.6 : 1,
                          }}
                        >
                          {crmsCommentSending
                            ? <ActivityIndicator color="#fff" size="small" />
                            : <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" }}>Send</Text>
                          }
                        </TouchableOpacity>
                      </View>
                    </View>

                    {/* Status update buttons */}
                    <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 14, marginBottom: 8 }}>Update Status</Text>
                    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                      {(["OPEN", "IN_PROGRESS", "RESOLVED"] as const).map(st => {
                        const isActive = crmsDetailCase.status === st;
                        const stColor = st === "OPEN" ? "#ef4444" : st === "IN_PROGRESS" ? "#f59e0b" : "#22c55e";
                        const stLabel = st === "IN_PROGRESS" ? "In Progress" : st.charAt(0) + st.slice(1).toLowerCase();
                        return (
                          <TouchableOpacity
                            key={st}
                            onPress={() => handleCrmsStatusUpdate(st)}
                            disabled={isActive || crmsStatusUpdating}
                            style={{
                              borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8,
                              backgroundColor: isActive ? stColor : stColor + "22",
                              borderWidth: 1, borderColor: stColor,
                              opacity: isActive || crmsStatusUpdating ? 0.7 : 1,
                            }}
                          >
                            <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: isActive ? "#fff" : stColor }}>{stLabel}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                )}
              </ScrollView>
            </KeyboardAvoidingView>

            {/* Action buttons */}
            {crmsEditMode ? (
              <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                <TouchableOpacity
                  style={[s.actionBtn, { flex: 1, backgroundColor: colors.primary, paddingVertical: 13, opacity: crmsEditSaving ? 0.6 : 1 }]}
                  onPress={handleCrmsEditSave}
                  disabled={crmsEditSaving}
                >
                  {crmsEditSaving ? <ActivityIndicator color="#fff" /> : <Text style={s.actionBtnText}>Save Changes</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.actionBtn, { flex: 0.45, backgroundColor: colors.secondary, borderWidth: 1, borderColor: colors.border, paddingVertical: 13 }]}
                  onPress={() => setCrmsEditMode(false)}
                >
                  <Text style={[s.actionBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                <TouchableOpacity
                  style={[s.actionBtn, { flex: 1, backgroundColor: "#7c3aed", paddingVertical: 13 }]}
                  onPress={() => { setCrmsDetailVisible(false); openCrmsAssignModal(crmsDetailCase); }}
                >
                  <Text style={s.actionBtnText}>🚒 Assign Team</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.actionBtn, { flex: 0.45, backgroundColor: "rgba(239,68,68,0.1)", borderWidth: 1, borderColor: "#ef4444", paddingVertical: 13 }]}
                  onPress={handleCrmsDelete}
                >
                  <Text style={[s.actionBtnText, { color: "#ef4444" }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </>
      )}

      {/* ── CRMS MAP PIN PICKER ── */}
      <Modal visible={crmsMapPinVisible} animationType="slide" statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          {/* Header */}
          <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <TouchableOpacity onPress={() => setCrmsMapPinVisible(false)} style={{ padding: 4 }}>
                <Feather name="x" size={22} color={colors.mutedForeground} />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: colors.foreground }}>Set Case Location</Text>
                <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 2 }}>
                  {crmsMapPinDisplay
                    ? `📍 ${crmsMapPinDisplay.lat.toFixed(5)}, ${crmsMapPinDisplay.lng.toFixed(5)}`
                    : "Tap the map or drag the pin"}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  // Always read from ref — guaranteed to have latest value regardless of render cycle
                  const pin = crmsMapPinRef.current;
                  setCrmsEditForm(f => ({
                    ...f,
                    lat: String(pin.lat),
                    lng: String(pin.lng),
                  }));
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  setCrmsMapPinVisible(false);
                }}
                style={{ backgroundColor: "#7c3aed", borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9 }}
              >
                <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" }}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Map — tap anywhere or drag the purple marker */}
          <MapView
            key={isDark ? "crms-map-dark" : "crms-map-light"}
            style={{ flex: 1 }}
            provider={PROVIDER_DEFAULT}
            userInterfaceStyle={isDark ? "dark" : "light"}
            customMapStyle={Platform.OS === "android" ? (isDark ? DARK_MAP_STYLE : LIGHT_MAP_STYLE) : undefined}
            initialRegion={{
              latitude: crmsMapPinRef.current.lat,
              longitude: crmsMapPinRef.current.lng,
              latitudeDelta: 0.02,
              longitudeDelta: 0.02,
            }}
            onPress={(e) => {
              const { latitude, longitude } = e.nativeEvent.coordinate;
              // Write to ref immediately (no re-render) then update display state
              crmsMapPinRef.current = { lat: latitude, lng: longitude };
              setCrmsMapPinDisplay({ lat: latitude, lng: longitude });
            }}
            onRegionChangeComplete={(r) => {
              crmsMapPinRef.current = { lat: r.latitude, lng: r.longitude };
              setCrmsMapPinDisplay({ lat: r.latitude, lng: r.longitude });
            }}
          >
            {crmsMapPinDisplay && (
              <Marker
                coordinate={{ latitude: crmsMapPinDisplay.lat, longitude: crmsMapPinDisplay.lng }}
                pinColor="#7c3aed"
                draggable
                onDragEnd={(e) => {
                  const { latitude, longitude } = e.nativeEvent.coordinate;
                  crmsMapPinRef.current = { lat: latitude, lng: longitude };
                  setCrmsMapPinDisplay({ lat: latitude, lng: longitude });
                }}
              />
            )}
          </MapView>

          {/* Hint bar */}
          <View style={{ paddingHorizontal: 16, paddingVertical: 12, paddingBottom: insets.bottom + 12, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border, alignItems: "center" }}>
            <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Tap map to place pin · Drag pin to adjust · Confirm to save</Text>
          </View>
        </View>
      </Modal>

      {/* ── LOCATION FORM MODAL ── */}
      {locModalVisible && (
        <>
          <Pressable style={s.modalOverlay} onPress={() => setLocModalVisible(false)} />
          <KeyboardAvoidingView style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 999 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <View style={s.modalSheet}>
              <View style={s.modalHandle} />
              <Text style={s.modalTitle}>{editingLocation ? "Edit Location" : "Add Location"}</Text>
              <Text style={s.label}>Name</Text>
              <TextInput style={s.input} value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="e.g. Yarwood Ave" placeholderTextColor={colors.mutedForeground} />
              <Text style={s.label}>Address (optional)</Text>
              <TextInput style={s.input} value={form.address} onChangeText={(v) => setForm((f) => ({ ...f, address: v }))} placeholder="e.g. Yarwood Ave, Singapore" placeholderTextColor={colors.mutedForeground} />
              <Text style={s.label}>Coordinates</Text>
              <Text style={s.hintText}>Open Google Maps → long-press any spot → copy the numbers at the bottom.</Text>
              <View style={s.coordRow}>
                <View style={s.coordField}><TextInput style={s.input} value={form.lat} onChangeText={(v) => setForm((f) => ({ ...f, lat: v }))} placeholder="Lat  1.3833" placeholderTextColor={colors.mutedForeground} keyboardType="numeric" /></View>
                <View style={s.coordField}><TextInput style={s.input} value={form.lng} onChangeText={(v) => setForm((f) => ({ ...f, lng: v }))} placeholder="Lng  103.8452" placeholderTextColor={colors.mutedForeground} keyboardType="numeric" /></View>
              </View>
              {formError ? <Text style={s.errorText}>{formError}</Text> : null}
              <View style={s.modalBtns}>
                <Pressable style={s.cancelBtn} onPress={() => setLocModalVisible(false)}><Text style={s.cancelBtnText}>Cancel</Text></Pressable>
                <Pressable style={s.saveBtn} onPress={handleSaveLocation}><Text style={s.saveBtnText}>{editingLocation ? "Save" : "Add Location"}</Text></Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </>
      )}

      {/* ── DROP-PIN NAME MODAL ── */}
      {pinNameModalVisible && (
        <>
          <Pressable style={s.modalOverlay} onPress={() => setPinNameModalVisible(false)} />
          <KeyboardAvoidingView style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 999 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <View style={s.modalSheet}>
              <View style={s.modalHandle} />
              <Text style={s.modalTitle}>New Deployment Point</Text>
              <Text style={s.modalSub}>
                Pinned at {droppedPin?.lat.toFixed(5)}, {droppedPin?.lng.toFixed(5)}
              </Text>
              <Text style={s.label}>Location Name</Text>
              <TextInput
                style={s.input}
                value={pinName}
                onChangeText={setPinName}
                placeholder="e.g. Sembawang Park"
                placeholderTextColor={colors.mutedForeground}
                autoFocus
              />
              <View style={s.modalBtns}>
                <Pressable style={s.cancelBtn} onPress={() => { setPinNameModalVisible(false); setDroppedPin(null); }}><Text style={s.cancelBtnText}>Cancel</Text></Pressable>
                <Pressable style={[s.saveBtn, { opacity: !pinName.trim() ? 0.5 : 1 }]} onPress={handleConfirmPin} disabled={!pinName.trim()}><Text style={s.saveBtnText}>Save & Assign Crew</Text></Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </>
      )}

      {/* ── ASSIGN CREW MODAL ── */}
      {assignModalVisible && (
        <>
          <Pressable style={s.modalOverlay} onPress={() => setAssignModalVisible(false)} />
          <View style={[s.modalSheet, { maxHeight: "88%" }]}>
              <View style={s.modalHandle} />
              <Text style={s.modalTitle}>
                {assigningCrmsCase
                  ? `Assign to CRMS #${assigningCrmsCase.caseNumber}`
                  : `Assign to ${assigningLocation?.name}`}
              </Text>
              <Text style={s.modalSub}>
                {assigningCrmsCase
                  ? `📍 ${assigningCrmsCase.address}`
                  : "Select a crew to deploy. Live crews show their distance from this location."}
              </Text>

              <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginBottom: 10 }}>
                On duty: <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold" }}>{activeShifts.join(" + ")}</Text>
              </Text>

              {/* Crew list: Live (GPS active ≤10 min) | Pre-assign (offline or not yet logged in) */}
              {(() => {
                const ACTIVE_MS = 10 * 60 * 1000;
                const now = Date.now();

                // Show ALL vehicles regardless of shift — manager decides who to reassign
                // Truly live = sent GPS in last 10 min
                const liveVehicles = vehicles.filter(
                  (v) => now - new Date((v as any).updatedAt ?? 0).getTime() < ACTIVE_MS
                );
                // Offline = logged in this session but GPS stale
                const offlineVehicles = vehicles.filter(
                  (v) => now - new Date((v as any).updatedAt ?? 0).getTime() >= ACTIVE_MS
                );

                // Sort live by distance
                const assignTarget = assigningCrmsCase
                  ? { lat: assigningCrmsCase.lat, lng: assigningCrmsCase.lng }
                  : assigningLocation
                    ? { lat: assigningLocation.lat, lng: assigningLocation.lng }
                    : null;
                const sortedLive = assignTarget
                  ? [...liveVehicles].sort((a, b) =>
                      haversineDistance(a.lat, a.lng, assignTarget.lat, assignTarget.lng) -
                      haversineDistance(b.lat, b.lng, assignTarget.lat, assignTarget.lng)
                    )
                  : [...liveVehicles];

                // Roster teams not yet seen live — show ALL roster teams for pre-assignment
                // (no shift filter: manager picks manually and knows who is on duty)
                const allVehicleIds = new Set(vehicles.map((v) => v.vehicleId));
                // Show roster teams that have never sent GPS at all (not in vehicles list)
                // — no shift filter so manager can pre-assign any crew
                const rosterNeverSeen = rosterTeams.filter(
                  (t: any) => !allVehicleIds.has(`${t.unitCode}-${t.vehicleNumber}`) &&
                               !allVehicleIds.has(t.unitCode)
                );

                // All offline vehicles (GPS stale), regardless of shift
                const allOfflineVehicles = vehicles.filter(
                  (v) => now - new Date((v as any).updatedAt ?? 0).getTime() >= ACTIVE_MS
                );

                // Pre-assign pool = offline vehicles + roster teams not yet live
                const hasPreAssign = allOfflineVehicles.length > 0 || rosterNeverSeen.length > 0;
                const noData = sortedLive.length === 0 && !hasPreAssign;

                // Helper: build a synthetic vehicle for pre-assignment
                const preAssignVehicle = (v: VehiclePosition) => v;
                const rosterToVehicle = (t: any): VehiclePosition => ({
                  vehicleId: `${t.unitCode}-${t.vehicleNumber || t.id}`,
                  vehicleNumber: t.vehicleNumber || t.unitCode,
                  unitCode: t.unitCode,
                  partner: t.partner,
                  shift: t.shift,
                  lat: assignTarget?.lat ?? 1.3521,
                  lng: assignTarget?.lng ?? 103.8198,
                  updatedAt: new Date().toISOString(),
                  acceptedLocationId: null,
                } as any);

                const crewRows = (
                  <>
                    {noData && (
                      <View style={s.hintBox}>
                        <Text style={s.hintBoxText}>No crews available to assign.</Text>
                        <Text style={[s.hintBoxText, { marginTop: 6 }]}>
                          • Load a roster (Roster tab) to pre-assign before crews log in{"\n"}
                          • Or wait for a crew to log in with GPS active
                        </Text>
                        <TouchableOpacity
                          style={{ marginTop: 12, backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, alignSelf: "flex-start" }}
                          onPress={() => { setAssignModalVisible(false); setViewMode("roster"); }}
                        >
                          <Text style={{ color: "#FFF", fontSize: 13, fontFamily: "Inter_600SemiBold" }}>Go to Roster →</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* ── LIVE section ── */}
                    {sortedLive.length > 0 && (
                      <>
                        <Text style={[s.assignSectionLabel, { color: colors.accent }]}>🟢 LIVE — GPS ACTIVE</Text>
                        {sortedLive.map((v) => {
                          const distM = assignTarget
                            ? haversineDistance(v.lat, v.lng, assignTarget.lat, assignTarget.lng)
                            : null;
                          const distLabel = distM !== null
                            ? distM >= 1000 ? `${(distM / 1000).toFixed(1)} km` : `${Math.round(distM)} m`
                            : "";
                          const deployedEntry = entries.find((e: any) => e.vehicleId === v.vehicleId);
                          const currentLocName = deployedEntry
                            ? (allLocations.find((l) => l.id === deployedEntry.locationId)?.name ?? deployedEntry.locationId)
                            : v.acceptedLocationId
                              ? (allLocations.find((l) => l.id === v.acceptedLocationId)?.name ?? v.acceptedLocationId)
                              : null;
                          const isDeployed = !!deployedEntry;
                          const activeCrms = crmsCases.find(
                            c => c.assignedVehicleId === v.vehicleId && c.status !== "RESOLVED" && c.id !== assigningCrmsCase?.id
                          );
                          const btnLabel = activeCrms ? "Reassign" : isDeployed ? "Reassign" : "Assign";
                          const btnColor = isDeployed || activeCrms ? "#f59e0b" : colors.primary;
                          return (
                            <View key={v.vehicleId} style={s.vehicleRow}>
                              <View style={[s.vehicleIcon, { backgroundColor: activeCrms ? "#7c3aed" : unitColor(v.unitCode ?? "") }]}>
                                <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: activeCrms ? "#FFF" : unitFg(v.unitCode ?? "") }}>{v.unitCode?.slice(0, 2) ?? "—"}</Text>
                              </View>
                              <View style={s.vehicleInfo}>
                                <Text style={s.vehicleTitle}>{v.unitCode} · {v.vehicleNumber}</Text>
                                <Text style={s.vehicleSub}>
                                  {activeCrms
                                    ? `📋 On CRMS #${activeCrms.caseNumber} (${({ TO_BE_ASSIGNED:"To Be Assigned", TEAM_ACKNOWLEDGE_OTW:"Team OTW", FP_UPDATED:"FP Updated", ASSISTANCE_PROVIDED:"Assistance Given", RESOLVED:"Resolved" } as Record<string,string>)[activeCrms.status] ?? activeCrms.status})${distLabel ? ` · ${distLabel}` : ""}`
                                    : `${distLabel ? `${distLabel} away` : ""}${currentLocName ? `${distLabel ? " · " : ""}📍 ${currentLocName}` : ""}${!distLabel && !currentLocName ? "Available" : ""}`
                                  }
                                </Text>
                              </View>
                              <TouchableOpacity style={[s.vehicleAssignBtn, { backgroundColor: btnColor + "22", borderColor: btnColor }]} onPress={() => handleAssign(v)}>
                                <Text style={[s.vehicleAssignTxt, { color: btnColor }]}>{btnLabel}</Text>
                              </TouchableOpacity>
                            </View>
                          );
                        })}
                      </>
                    )}

                    {/* ── PRE-ASSIGN section (offline + never logged in) ── */}
                    {hasPreAssign && (
                      <>
                        <Text style={[s.assignSectionLabel, { color: colors.primary, marginTop: sortedLive.length > 0 ? 14 : 0 }]}>
                          📋 PRE-ASSIGN — OFFLINE / NOT YET ONLINE
                        </Text>

                        {allOfflineVehicles.map((v: VehiclePosition) => {
                          const minsAgo = Math.round((now - new Date((v as any).updatedAt).getTime()) / 60000);
                          const agoLabel = minsAgo < 60 ? `${minsAgo}m ago` : `${Math.floor(minsAgo / 60)}h ago`;
                          const currentLocName = v.acceptedLocationId
                            ? (allLocations.find((l: PresetLocation) => l.id === v.acceptedLocationId)?.name ?? v.acceptedLocationId)
                            : null;
                          const activeCrms = crmsCases.find(
                            c => c.assignedVehicleId === v.vehicleId && c.status !== "RESOLVED" && c.id !== assigningCrmsCase?.id
                          );
                          return (
                            <View key={v.vehicleId} style={s.vehicleRow}>
                              <View style={[s.vehicleIcon, { backgroundColor: activeCrms ? "#7c3aed" : unitColor(v.unitCode ?? "") }]}>
                                <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: activeCrms ? "#FFF" : unitFg(v.unitCode ?? "") }}>{v.unitCode?.slice(0, 2) ?? "—"}</Text>
                              </View>
                              <View style={s.vehicleInfo}>
                                <Text style={s.vehicleTitle}>{v.unitCode} · {v.vehicleNumber}</Text>
                                <Text style={s.vehicleSub}>
                                  {activeCrms
                                    ? `📋 On CRMS #${activeCrms.caseNumber} · Last seen ${agoLabel}`
                                    : `${currentLocName ? `At ${currentLocName} · ` : ""}Last seen ${agoLabel}`}
                                </Text>
                              </View>
                              <TouchableOpacity
                                style={[s.vehicleAssignBtn, { backgroundColor: (activeCrms ? "#7c3aed" : colors.primary) + "22", borderColor: activeCrms ? "#7c3aed" : colors.primary }]}
                                onPress={() => handleAssign(preAssignVehicle(v))}
                              >
                                <Text style={[s.vehicleAssignTxt, { color: activeCrms ? "#a78bfa" : colors.primary }]}>{activeCrms ? "Reassign" : "Pre-assign"}</Text>
                              </TouchableOpacity>
                            </View>
                          );
                        })}

                        {rosterNeverSeen.map((t: any) => (
                          <View key={t.id} style={s.vehicleRow}>
                            <View style={[s.vehicleIcon, { backgroundColor: unitColor(t.unitCode) }]}>
                              <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#FFF" }}>{t.unitCode.slice(0, 2)}</Text>
                            </View>
                            <View style={s.vehicleInfo}>
                              <Text style={s.vehicleTitle}>{t.unitCode}{t.vehicleNumber ? ` · ${t.vehicleNumber}` : ""}</Text>
                              <Text style={s.vehicleSub}>{t.partner} · {t.shift} · Not logged in yet</Text>
                            </View>
                            <TouchableOpacity
                              style={[s.vehicleAssignBtn, { backgroundColor: colors.primary + "22", borderColor: colors.primary }]}
                              onPress={() => handleAssign(rosterToVehicle(t))}
                            >
                              <Text style={[s.vehicleAssignTxt, { color: colors.primary }]}>Pre-assign</Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                      </>
                    )}
                  </>
                );

                if (Platform.OS === "web") {
                  return (
                    // @ts-ignore — native div for guaranteed mouse-wheel scroll on web
                    <div style={{ maxHeight: 220, overflowY: "auto", overflowX: "hidden" }}>
                      {crewRows}
                    </div>
                  );
                }
                return (
                  <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator persistentScrollbar>
                    {crewRows}
                  </ScrollView>
                );
              })()}

              <Pressable style={[s.cancelBtn, { marginTop: 12 }]} onPress={() => setAssignModalVisible(false)}>
                <Text style={s.cancelBtnText}>Close</Text>
              </Pressable>
          </View>
        </>
      )}

      {/* ── REASSIGN VEHICLE MODAL (pick a new location for a deployed crew) ─── */}
      {reassignVehicleModalVisible && reassigningVehicle && (
        <>
          <Pressable style={s.modalOverlay} onPress={() => { setReassignVehicleModalVisible(false); setReassigningVehicle(null); }} />
          <View style={[s.modalSheet, { maxHeight: "88%" }]}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>Reassign {reassigningVehicle.unitCode}</Text>
            <Text style={s.modalSub}>
              Currently at{" "}
              {(() => {
                const e = entries.find((en: any) => en.vehicleId === reassigningVehicle.vehicleId);
                return e ? (allLocations.find((l: PresetLocation) => l.id === e.locationId)?.name ?? e.locationId) : "unknown";
              })()}
              . Pick a new destination — crew will be notified to accept.
            </Text>

            {(() => {
              const occupiedLocIds = new Set(
                entries
                  .filter((e: any) => e.vehicleId !== reassigningVehicle.vehicleId)
                  .map((e: any) => e.locationId)
              );
              const availableLocs = allLocations.filter((l: PresetLocation) => !occupiedLocIds.has(l.id));
              const occupiedLocs = allLocations.filter((l: PresetLocation) => occupiedLocIds.has(l.id));

              const locRows = (
                <>
                  {availableLocs.length === 0 && occupiedLocs.length === 0 && (
                    <View style={s.hintBox}>
                      <Text style={s.hintBoxText}>No locations configured.</Text>
                    </View>
                  )}

                  {availableLocs.length > 0 && (
                    <>
                      <Text style={[s.assignSectionLabel, { color: colors.accent }]}>🟢 AVAILABLE</Text>
                      {availableLocs.map((loc: PresetLocation) => (
                        <TouchableOpacity
                          key={loc.id}
                          style={[s.vehicleRow, { borderWidth: 1, borderColor: colors.border }]}
                          onPress={() => handleReassignToLocation(loc)}
                        >
                          <View style={[s.vehicleIcon, { backgroundColor: colors.accent }]}>
                            <Feather name="map-pin" size={15} color="#FFF" />
                          </View>
                          <View style={s.vehicleInfo}>
                            <Text style={s.vehicleTitle}>{loc.name}</Text>
                            <Text style={s.vehicleSub}>{loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}</Text>
                          </View>
                          <View style={[s.vehicleAssignBtn, { backgroundColor: colors.accent + "22", borderWidth: 1, borderColor: colors.accent }]}>
                            <Text style={[s.vehicleAssignTxt, { color: colors.accent }]}>Select</Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </>
                  )}

                  {occupiedLocs.length > 0 && (
                    <>
                      <Text style={[s.assignSectionLabel, { color: colors.mutedForeground, marginTop: availableLocs.length > 0 ? 14 : 0 }]}>
                        🔴 OCCUPIED — WILL DISPLACE EXISTING CREW
                      </Text>
                      {occupiedLocs.map((loc: PresetLocation) => {
                        const occupyingEntry = entries.find((e: any) => e.locationId === loc.id);
                        return (
                          <TouchableOpacity
                            key={loc.id}
                            style={[s.vehicleRow, { borderWidth: 1, borderColor: "#f59e0b44" }]}
                            onPress={() => handleReassignToLocation(loc)}
                          >
                            <View style={[s.vehicleIcon, { backgroundColor: "#f59e0b" }]}>
                              <Feather name="map-pin" size={15} color="#FFF" />
                            </View>
                            <View style={s.vehicleInfo}>
                              <Text style={s.vehicleTitle}>{loc.name}</Text>
                              <Text style={[s.vehicleSub, { color: "#f59e0b" }]}>
                                {occupyingEntry ? `${occupyingEntry.unitCode} deployed here` : "Occupied"}
                              </Text>
                            </View>
                            <View style={[s.vehicleAssignBtn, { backgroundColor: "#f59e0b22", borderWidth: 1, borderColor: "#f59e0b" }]}>
                              <Text style={[s.vehicleAssignTxt, { color: "#f59e0b" }]}>Force</Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </>
                  )}
                </>
              );

              if (Platform.OS === "web") {
                return (
                  // @ts-ignore
                  <div style={{ maxHeight: 260, overflowY: "auto", overflowX: "hidden" }}>
                    {locRows}
                  </div>
                );
              }
              return (
                <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator persistentScrollbar>
                  {locRows}
                </ScrollView>
              );
            })()}

            <Pressable style={[s.cancelBtn, { marginTop: 12 }]} onPress={() => { setReassignVehicleModalVisible(false); setReassigningVehicle(null); }}>
              <Text style={s.cancelBtnText}>Close</Text>
            </Pressable>
          </View>
        </>
      )}

      {/* ── REASSIGNMENT TOAST ─────────────────────────────────────────────── */}
      {toastMessage !== "" && (
        <Animated.View
          pointerEvents="none"
          style={[
            s.toastContainer,
            {
              opacity: toastAnim,
              transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
            },
          ]}
        >
          <Feather name="check-circle" size={15} color="#FFF" style={{ marginRight: 8 }} />
          <Text style={s.toastText}>{toastMessage}</Text>
        </Animated.View>
      )}
    </View>
  );
}
