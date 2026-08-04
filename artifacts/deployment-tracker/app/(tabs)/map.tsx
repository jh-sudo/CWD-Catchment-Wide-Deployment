import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import MapView, { Callout, Circle, Marker, Overlay, Polygon, Polyline, PROVIDER_DEFAULT } from "react-native-maps";
import { DARK_MAP_STYLE, LIGHT_MAP_STYLE } from "@/constants/mapStyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { useQueryClient } from "@tanstack/react-query";
import { getGetDeploymentStateQueryKey } from "@workspace/api-client-react";

import { useApp } from "@/context/AppContext";
import { useTheme } from "@/context/ThemeContext";
import { useColors } from "@/hooks/useColors";
import { PRESET_LOCATIONS } from "@/data/presetLocations";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://cwd.pub-soarhco.stg.paas.sandbox.gov.sg";

type LightningSector = { name: string; lat: number; lng: number; cat: string };
type LightningFeature = { name: string; polygons: [number, number][][][] };
function catCircleColors(cat: string) {
  if (cat === "1") return { fill: "rgba(220,38,38,0.38)", stroke: "#dc2626" };
  if (cat === "2") return { fill: "rgba(234,179,8,0.28)", stroke: "#ca8a04" };
  return { fill: "rgba(22,163,74,0.1)", stroke: "rgba(22,163,74,0.3)" };
}

function weatherEmoji(w: string | null | undefined) {
  if (!w) return "";
  if (w.toLowerCase().includes("heavy")) return "🔴";
  if (w.toLowerCase().includes("moderate")) return "🟠";
  return "🟢";
}

const WEATHER_OPTIONS = [
  { label: "Heavy Rain", emoji: "🔴" },
  { label: "Moderate Rain", emoji: "🟠" },
  { label: "Light Rain", emoji: "🟢" },
  { label: "Nil Rain", emoji: "🟢" },
];

export default function MapScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { isDark, toggle: toggleTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const {
    userInfo, currentLat, currentLng, locationError,
    nearestLocationId, nearestDistanceM, etaString, etaMinutes,
    isAccepting, acceptNearestLocation, acceptedLocationId, deploymentState,
    pendingAssignment, acceptAssignment, declineAssignment,
    hasArrived, currentWeather, markArrived, updateWeather, logout,
    isLoadingState,
  } = useApp();

  const [showAssignmentModal, setShowAssignmentModal] = useState(false);
  const [showWeatherModal, setShowWeatherModal] = useState(false);
  const [weatherPromptLabel, setWeatherPromptLabel] = useState("Report Weather");
  const [pushEnabled, setPushEnabled] = useState<boolean | null>(null);

  // Location swap state
  const [showSwapPickerModal, setShowSwapPickerModal] = useState(false);
  const [showSwapIncomingModal, setShowSwapIncomingModal] = useState(false);
  const [swapBusy, setSwapBusy] = useState(false);
  const lastSwapRequestIdRef = useRef<string | null>(null);

  // Lightning risk layer
  const [showLightning, setShowLightning] = useState(false);
  const [lightningSectors, setLightningSectors] = useState<LightningSector[]>([]);
  const [lightningFeatures, setLightningFeatures] = useState<LightningFeature[]>([]);
  const worstCat = lightningSectors.length
    ? Math.min(...lightningSectors.map(s => parseInt(s.cat) || 3))
    : 3;
  useEffect(() => {
    if (!showLightning) return;
    const load = async () => {
      try {
        const [rSectors, rFeatures] = await Promise.all([
          fetch(`${API_BASE}/api/lightning/sectors`),
          fetch(`${API_BASE}/api/lightning/features`),
        ]);
        const jSectors = await rSectors.json();
        if (Array.isArray(jSectors.sectors)) setLightningSectors(jSectors.sectors);
        const jFeatures = await rFeatures.json();
        if (Array.isArray(jFeatures)) setLightningFeatures(jFeatures);
      } catch {}
    };
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [showLightning]);

  // Rain radar layer (web only)
  const [showRadar, setShowRadar] = useState(false);
  const [radarUrl, setRadarUrl] = useState<string | null>(null);
  const [radarLabel, setRadarLabel] = useState("");
  const radarFramesRef = useRef<{ at: string; label: string }[]>([]);
  const radarIdxRef = useRef(0);
  const radarAnimTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!showRadar || Platform.OS !== "web") return;
    const loadFrames = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/rain-radar/frames?t=${Date.now()}`);
        const d = await r.json();
        const frames: { at: string; label: string }[] = d.frames || [];
        if (!frames.length) return;
        radarFramesRef.current = [...frames].reverse(); // oldest→newest
        radarIdxRef.current = 0;
        const first = radarFramesRef.current[0];
        setRadarUrl(`${API_BASE}/api/rain-radar?at=${first.at}`);
        setRadarLabel(first.label);
      } catch {}
    };
    loadFrames();
    const refreshId = setInterval(loadFrames, 5 * 60 * 1000);
    radarAnimTimerRef.current = setInterval(() => {
      const frames = radarFramesRef.current;
      if (!frames.length) return;
      radarIdxRef.current = (radarIdxRef.current + 1) % frames.length;
      const f = frames[radarIdxRef.current];
      setRadarUrl(`${API_BASE}/api/rain-radar?at=${f.at}`);
      setRadarLabel(f.label);
    }, 700);
    return () => {
      if (radarAnimTimerRef.current) clearInterval(radarAnimTimerRef.current);
      clearInterval(refreshId);
      setRadarUrl(null);
      setRadarLabel("");
      radarFramesRef.current = [];
    };
  }, [showRadar]);
  // Inject mix-blend-mode so NEA radar black bg becomes transparent
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const id = "radar-blend-css";
    if (showRadar) {
      if (!document.getElementById(id)) {
        const s = document.createElement("style");
        s.id = id;
        s.textContent = ".leaflet-image-layer { mix-blend-mode: screen !important; }";
        document.head.appendChild(s);
      }
    } else {
      document.getElementById(id)?.remove();
    }
  }, [showRadar]);

  useEffect(() => {
    if (Platform.OS !== "web" || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setPushEnabled(!!sub))
      .catch(() => {});
  }, []);

  const toggleNotifications = async () => {
    if (Platform.OS !== "web") {
      Alert.alert(
        "Enable Push Alerts",
        "To receive CAT 1 lightning push notifications, open the crew app in your phone's browser (Safari or Chrome) and tap the bell icon there.",
        [{ text: "OK" }]
      );
      return;
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      Alert.alert("Not supported", "Push notifications are not supported in this browser.");
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await existing.unsubscribe();
        setPushEnabled(false);
      } else {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          Alert.alert("Blocked", "Enable notifications in your browser or device settings, then try again.");
          return;
        }
        const { publicKey } = await fetch(`${API_BASE}/api/push/vapid-key`).then((r) => r.json());
        const urlBase64ToUint8Array = (base64: string) => {
          const padded = base64.replace(/-/g, "+").replace(/_/g, "/").padEnd(base64.length + (4 - base64.length % 4) % 4, "=");
          const raw = atob(padded);
          return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
        };
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
        await fetch(`${API_BASE}/api/push/subscribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: sub, type: "crew", vehicleId: userInfo?.vehicleId }),
        });
        setPushEnabled(true);
      }
    } catch {
      Alert.alert("Error", "Could not toggle notifications. Please try again.");
    }
  };
  const weatherIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mapRef = useRef<MapView>(null);
  const [permissionStatus, setPermissionStatus] = useState<string | null>(null);
  const lastAlertIdRef = useRef<string | null>(null);

  // CRMS case assigned to this vehicle
  const [assignedCrmsCase, setAssignedCrmsCase] = useState<any | null>(null);
  const [showCrmsAlert, setShowCrmsAlert] = useState(false);
  const lastCrmsIdRef = useRef<string | null>(null);
  const [crmsFloodDraft, setCrmsFloodDraft] = useState("");
  const [crmsFloodSaving, setCrmsFloodSaving] = useState(false);

  // Road-following route geometry (from OSRM)
  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);

  // Show assignment modal on new assignment
  useEffect(() => {
    if (pendingAssignment) {
      setShowAssignmentModal(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } else {
      setShowAssignmentModal(false);
    }
  }, [pendingAssignment?.locationId]);

  // When arrived, set 15-minute repeating weather prompt
  useEffect(() => {
    if (hasArrived) {
      if (weatherIntervalRef.current) clearInterval(weatherIntervalRef.current);
      // Prompt immediately on first arrival if no weather set
      if (!currentWeather) {
        setWeatherPromptLabel("Report Weather on Arrival");
        setShowWeatherModal(true);
      }
      weatherIntervalRef.current = setInterval(() => {
        setWeatherPromptLabel("Update Weather (15 min)");
        setShowWeatherModal(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }, 15 * 60 * 1000);
    } else {
      if (weatherIntervalRef.current) clearInterval(weatherIntervalRef.current);
    }
    return () => { if (weatherIntervalRef.current) clearInterval(weatherIntervalRef.current); };
  }, [hasArrived]);

  // Alert popup: show native modal when a new alert is broadcast while crew is logged in
  const activeAlert = (deploymentState as any)?.activeAlert ?? null;
  useEffect(() => {
    if (!userInfo || !activeAlert) return;
    if (lastAlertIdRef.current === activeAlert.id) return;
    lastAlertIdRef.current = activeAlert.id;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      `⚠️ NEA Weather Alert`,
      activeAlert.extracted,
      [
        {
          text: "Acknowledge",
          style: "default",
          onPress: async () => {
            try {
              await fetch(`${API_BASE}/api/alert/acknowledge`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ unitCode: userInfo.unitCode }),
              });
            } catch { /* ignore */ }
          },
        },
        { text: "Dismiss", style: "cancel" },
      ],
      { cancelable: true }
    );
  }, [activeAlert?.id, userInfo]);

  // Poll for CRMS cases assigned to this vehicle
  useEffect(() => {
    if (!userInfo?.vehicleId) return;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/crms`);
        if (!res.ok) return;
        const data = await res.json();
        const all: any[] = data.cases ?? data ?? [];
        // Prefer active case; fall back to most-recent resolved so it stays visible
        const mine =
          all.find((c: any) => c.assignedVehicleId === userInfo.vehicleId && c.status !== "RESOLVED") ??
          all.filter((c: any) => c.assignedVehicleId === userInfo.vehicleId && c.status === "RESOLVED")
             .sort((a: any, b: any) => new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() - new Date(a.updatedAt ?? a.createdAt ?? 0).getTime())[0] ??
          null;
        setAssignedCrmsCase(mine ?? null);
        // Only reset the draft when it's a brand-new case — never overwrite what the user is typing
        if (mine && mine.id !== lastCrmsIdRef.current) {
          lastCrmsIdRef.current = mine.id;
          setCrmsFloodDraft(mine?.floodAssessment ?? "");
          setShowCrmsAlert(true);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        } else if (!mine) {
          setCrmsFloodDraft("");
        }
      } catch { /* ignore */ }
    };
    poll();
    const t = setInterval(poll, 10_000);
    return () => clearInterval(t);
  }, [userInfo?.vehicleId]);

  // Derive swap requests from state
  const allSwapRequests: any[] = (deploymentState as any)?.swapRequests ?? [];
  const incomingSwapRequest = userInfo?.vehicleId
    ? allSwapRequests.find((sr: any) => sr.toVehicleId === userInfo.vehicleId)
    : null;

  // Show incoming swap modal when a new swap request arrives
  useEffect(() => {
    if (!incomingSwapRequest) return;
    if (lastSwapRequestIdRef.current === incomingSwapRequest.id) return;
    lastSwapRequestIdRef.current = incomingSwapRequest.id;
    setShowSwapIncomingModal(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, [incomingSwapRequest?.id]);

  // Build unified swap candidate list from roster + assignments + deployed entries
  const rosterTeams: any[] = (deploymentState as any)?.rosterTeams ?? [];
  const deployedEntries: any[] = (deploymentState as any)?.entries ?? [];
  const managerAssignments: any[] = (deploymentState as any)?.assignments ?? [];
  const myVehicleId = userInfo?.vehicleId;

  // Collect all known vehicles (excluding self) keyed by vehicleId
  const candidateMap = new Map<string, any>();
  // 1. Roster teams — use vehicleId if present, fall back to id (same format: "UNIT-PLATE")
  for (const t of rosterTeams) {
    const vid: string | undefined = t.vehicleId ?? t.id;
    if (vid && vid !== myVehicleId) candidateMap.set(vid, { vehicleId: vid, unitCode: t.unitCode, vehicleNumber: t.vehicleNumber, partner: t.partner2 ? `${t.partner1} & ${t.partner2}` : t.partner1 });
  }
  // 2. Manager assignments (adds teams not in roster)
  for (const a of managerAssignments) {
    if (a.vehicleId && a.vehicleId !== myVehicleId && !candidateMap.has(a.vehicleId)) {
      candidateMap.set(a.vehicleId, { vehicleId: a.vehicleId, unitCode: a.unitCode, vehicleNumber: a.vehicleNumber, partner: null });
    }
  }
  // 3. Deployed entries (adds teams not in roster or assignments)
  for (const e of deployedEntries) {
    if (e.vehicleId && e.vehicleId !== myVehicleId && !candidateMap.has(e.vehicleId)) {
      candidateMap.set(e.vehicleId, { vehicleId: e.vehicleId, unitCode: e.unitCode, vehicleNumber: e.vehicleNumber, partner: e.partner ?? null });
    }
  }
  // Annotate each candidate with their deployed entry AND manager assignment (if any)
  const swapCandidates = Array.from(candidateMap.values()).map((c) => {
    const entry = deployedEntries.find((e: any) => e.vehicleId === c.vehicleId) ?? null;
    const assignment = managerAssignments.find((a: any) => a.vehicleId === c.vehicleId) ?? null;
    return { ...c, currentEntry: entry, assignment };
  });

  const allLocations = deploymentState?.presetLocations ?? PRESET_LOCATIONS;
  const acceptedIds = deploymentState?.entries?.map((e) => e.locationId) ?? [];
  const nearestLocation = allLocations.find((l) => l.id === nearestLocationId);
  const myAcceptedLocation = acceptedLocationId
    ? allLocations.find((l) => l.id === acceptedLocationId)
    : null;

  // Fetch road-following route geometry from OSRM whenever position or destination changes
  useEffect(() => {
    if (!myAcceptedLocation || !currentLat || !currentLng || hasArrived) {
      setRouteCoords([]);
      return;
    }
    let cancelled = false;
    const fromLng = currentLng;
    const fromLat = currentLat;
    const toLng = myAcceptedLocation.lng;
    const toLat = myAcceptedLocation.lat;
    fetch(
      `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`
    )
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.code === "Ok" && json.routes?.[0]?.geometry?.coordinates) {
          setRouteCoords(
            (json.routes[0].geometry.coordinates as [number, number][]).map(
              ([lng, lat]) => ({ latitude: lat, longitude: lng })
            )
          );
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [acceptedLocationId, myAcceptedLocation?.lat, myAcceptedLocation?.lng, currentLat, currentLng, hasArrived]);

  // Current weather from deploymentState (source of truth)
  const myEntry = acceptedLocationId
    ? deploymentState?.entries?.find((e) => e.locationId === acceptedLocationId)
    : null;
  const displayWeather = myEntry?.weather ?? currentWeather;

  const requestPermission = async () => {
    if (Platform.OS === "web") return;
    const { status } = await Location.requestForegroundPermissionsAsync();
    setPermissionStatus(status);
  };

  const handleAccept = async () => {
    if (acceptedLocationId) {
      Alert.alert("Already Accepted", "You have already accepted a location for this deployment.");
      return;
    }
    await acceptNearestLocation();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const ARRIVE_RADIUS_M = 1000;
  // Only block when GPS is available AND we know they're too far away
  const tooFarToArrive = !!acceptedLocationId && nearestDistanceM !== null && nearestDistanceM > ARRIVE_RADIUS_M;

  const handleArrive = async () => {
    if (tooFarToArrive) {
      const dist = nearestDistanceM! >= 1000
        ? `${(nearestDistanceM! / 1000).toFixed(1)}km`
        : `${nearestDistanceM}m`;
      Alert.alert(
        "Too Far Away",
        `You must be within 1km of the deployment location to mark arrival.\n\nYou are currently ${dist} away.`,
        [{ text: "OK" }]
      );
      return;
    }
    await markArrived();
  };

  const handleNavigate = () => {
    if (!myAcceptedLocation) return;
    const url = Platform.select({
      ios: `maps://app?daddr=${myAcceptedLocation.lat},${myAcceptedLocation.lng}&dirflg=d`,
      android: `google.navigation:q=${myAcceptedLocation.lat},${myAcceptedLocation.lng}`,
      default: `https://maps.google.com/maps?daddr=${myAcceptedLocation.lat},${myAcceptedLocation.lng}`,
    });
    Linking.openURL(url ?? "");
  };

  const centerOnUser = () => {
    if (currentLat && currentLng) {
      mapRef.current?.animateToRegion({
        latitude: currentLat,
        longitude: currentLng,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      });
    }
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    map: { flex: 1 },
    header: {
      position: "absolute",
      top: insets.top + (Platform.OS === "web" ? 67 : 0),
      left: 0,
      right: 0,
      paddingHorizontal: 16,
      paddingTop: 16,
      zIndex: 10,
    },
    headerCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    headerDot: { width: 10, height: 10, borderRadius: 5 },
    headerText: { flex: 1 },
    headerTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    headerSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 1 },
    centerBtn: {
      position: "absolute",
      right: 16,
      top: insets.top + (Platform.OS === "web" ? 67 : 0) + 80,
      backgroundColor: colors.card,
      borderRadius: 24,
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
      zIndex: 10,
    },
    bottomPanel: {
      position: "absolute",
      bottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 90,
      left: 16,
      right: 16,
      zIndex: 10,
    },
    acceptedCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      padding: 16,
      borderWidth: 1.5,
      borderColor: colors.accent,
      marginBottom: 10,
    },
    acceptedLabel: {
      fontSize: 11,
      fontFamily: "Inter_600SemiBold",
      color: colors.accent,
      letterSpacing: 1,
      textTransform: "uppercase",
      marginBottom: 4,
    },
    acceptedName: { fontSize: 18, fontFamily: "Inter_700Bold", color: colors.foreground, marginBottom: 2 },
    acceptedEta: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    arrivedRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
    arrivedBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: `${colors.accent}20`,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    arrivedBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.accent },
    weatherBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: colors.background,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderWidth: 1,
      borderColor: colors.border,
    },
    weatherBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    nearestCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 10,
    },
    nearestLabel: {
      fontSize: 11,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
      letterSpacing: 1,
      textTransform: "uppercase",
      marginBottom: 4,
    },
    nearestRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    nearestName: { fontSize: 18, fontFamily: "Inter_700Bold", color: colors.foreground, flex: 1 },
    nearestDist: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.mutedForeground, marginTop: 2 },
    etaBadge: { backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, marginLeft: 10 },
    etaText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
    etaMapOverlay: {
      position: "absolute",
      // Position below the header card (header sits at insets.top + 16 padding, card ~60px tall)
      top: insets.top + (Platform.OS === "web" ? 67 : 0) + 96,
      alignSelf: "center",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: "rgba(16,185,129,0.94)",
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 8,
      zIndex: 20,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
      elevation: 6,
    },
    etaMapOverlayText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
    btnRow: { flexDirection: "row", gap: 10, marginTop: 0 },
    acceptBtn: {
      flex: 1,
      borderRadius: colors.radius,
      paddingVertical: 15,
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "center",
      gap: 8,
    },
    acceptBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
    navBtn: {
      flex: 1,
      borderRadius: colors.radius,
      paddingVertical: 15,
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "center",
      gap: 8,
      backgroundColor: colors.accent,
    },
    arriveBtn: {
      flex: 1,
      borderRadius: colors.radius,
      paddingVertical: 15,
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "center",
      gap: 8,
      backgroundColor: "#10B981",
    },
    weatherBtn: {
      flex: 1,
      borderRadius: colors.radius,
      paddingVertical: 15,
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "center",
      gap: 8,
      backgroundColor: colors.secondary,
      borderWidth: 1,
      borderColor: colors.border,
    },
    weatherBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    permissionContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
    permissionTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: colors.foreground, textAlign: "center", marginBottom: 12 },
    permissionText: { fontSize: 15, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center", marginBottom: 24 },
    permissionBtn: { backgroundColor: colors.primary, borderRadius: colors.radius, paddingHorizontal: 24, paddingVertical: 14 },
    permissionBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
    noUserText: { fontSize: 15, fontFamily: "Inter_500Medium", color: colors.mutedForeground, textAlign: "center" },
    // Assignment modal
    assignOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-end" },
    assignSheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 28,
      paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 16,
      borderTopWidth: 2,
      borderTopColor: colors.warning,
      alignItems: "center",
    },
    assignIconWrap: {
      width: 64, height: 64, borderRadius: 32,
      backgroundColor: `${colors.warning}20`,
      alignItems: "center", justifyContent: "center", marginBottom: 16,
    },
    assignTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: colors.foreground, marginBottom: 6 },
    assignSub: { fontSize: 14, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginBottom: 16 },
    assignLocationCard: {
      backgroundColor: colors.background, borderRadius: colors.radius, padding: 16,
      width: "100%", alignItems: "center", marginBottom: 14,
    },
    assignLocationName: { fontSize: 20, fontFamily: "Inter_700Bold", color: colors.foreground, marginBottom: 4, textAlign: "center" },
    assignLocationCoords: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    assignNote: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center", marginBottom: 24 },
    assignBtns: { flexDirection: "row", gap: 12, width: "100%" },
    assignDeclineBtn: {
      flex: 1, borderRadius: colors.radius, paddingVertical: 15, alignItems: "center",
      backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
    },
    assignDeclineTxt: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    assignAcceptBtn: {
      flex: 2, borderRadius: colors.radius, paddingVertical: 15, alignItems: "center",
      backgroundColor: colors.accent, flexDirection: "row", justifyContent: "center", gap: 8,
    },
    assignAcceptTxt: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
    // Weather modal
    weatherOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-end" },
    weatherSheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 28,
      paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 16,
      borderTopWidth: 2,
      borderTopColor: "#3B82F6",
    },
    weatherSheetTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: colors.foreground, marginBottom: 4, textAlign: "center" },
    weatherSheetSub: { fontSize: 14, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center", marginBottom: 20 },
    weatherOption: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      backgroundColor: colors.background,
      borderRadius: colors.radius,
      padding: 16,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: colors.border,
    },
    weatherOptionEmoji: { fontSize: 22 },
    weatherOptionLabel: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: colors.foreground },
  });

  if (!userInfo) {
    return (
      <View style={[styles.container, styles.permissionContainer]}>
        <Text style={styles.noUserText}>Please log in to access the map</Text>
      </View>
    );
  }

  if (locationError && Platform.OS !== "web") {
    return (
      <View style={[styles.container, styles.permissionContainer]}>
        <Feather name="map-pin" size={48} color={colors.mutedForeground} />
        <Text style={styles.permissionTitle}>Location Required</Text>
        <Text style={styles.permissionText}>{locationError}</Text>
        <Pressable style={styles.permissionBtn} onPress={requestPermission}>
          <Text style={styles.permissionBtnText}>Grant Permission</Text>
        </Pressable>
      </View>
    );
  }

  const mapRegion = currentLat && currentLng
    ? { latitude: currentLat, longitude: currentLng, latitudeDelta: 0.08, longitudeDelta: 0.08 }
    : { latitude: 1.3521, longitude: 103.8198, latitudeDelta: 0.2, longitudeDelta: 0.2 };

  return (
    <View style={styles.container}>
      <MapView
        key={isDark ? "map-dark" : "map-light"}
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={mapRegion}
        showsUserLocation
        showsMyLocationButton={false}
        userInterfaceStyle={isDark ? "dark" : "light"}
        customMapStyle={Platform.OS === "android" ? (isDark ? DARK_MAP_STYLE : LIGHT_MAP_STYLE) : undefined}
      >
        {allLocations.map((loc) => {
          const isNearest = loc.id === nearestLocationId && !acceptedLocationId;

          // 7-colour status scheme — mirrors web dashboard
          const entry = (deploymentState?.entries ?? []).find((e: any) => e.locationId === loc.id);
          const assignment = Object.values((deploymentState as any)?.assignments ?? {})
            .find((a: any) => a.locationId === loc.id && a.status === "pending");

          let dotColor = "#9CA3AF"; // Grey — unassigned
          let dotSize  = 20;
          let calloutStatus = "Available";
          let calloutColor  = "#9CA3AF";

          if (entry) {
            const arrived: boolean = (entry as any).arrived ?? false;
            const weather: string  = ((entry as any).weather ?? "").toLowerCase();
            if (arrived) {
              dotSize = 24;
              if (weather.includes("heavy"))    { dotColor = "#EF4444"; calloutStatus = "Arrived · Heavy Rain"; calloutColor = "#EF4444"; }
              else if (weather.includes("moderate")) { dotColor = "#F97316"; calloutStatus = "Arrived · Moderate Rain"; calloutColor = "#F97316"; }
              else if (weather.includes("light"))    { dotColor = "#22C55E"; calloutStatus = "Arrived · Light Rain";    calloutColor = "#22C55E"; }
              else                                   { dotColor = "#86EFAC"; calloutStatus = "Arrived · Nil Rain";      calloutColor = "#22C55E"; }
            } else {
              dotSize = 22;
              dotColor = "#2563EB"; calloutStatus = "Accepted · On the Way"; calloutColor = "#2563EB";
            }
          } else if (assignment) {
            dotColor = "#7DD3FC"; calloutStatus = "Assigned · Awaiting Crew"; calloutColor = "#0ea5e9";
          } else if (isNearest) {
            calloutStatus = "Nearest · Available"; calloutColor = "#9CA3AF";
          }

          const r = dotSize / 2;

          return (
            <Marker
              key={loc.id}
              coordinate={{ latitude: loc.lat, longitude: loc.lng }}
              title={loc.name}
              anchor={{ x: 0.5, y: 0.5 }}
              pinColor={dotColor}
            >
              {/* Circle marker — 7-colour status scheme */}
              <View
                style={{
                  width: dotSize,
                  height: dotSize,
                  borderRadius: r,
                  backgroundColor: dotColor,
                  borderWidth: 2.5,
                  borderColor: "#FFFFFF",
                  shadowColor: "#000",
                  shadowOffset: { width: 0, height: 1 },
                  shadowOpacity: 0.35,
                  shadowRadius: 2,
                  elevation: 4,
                }}
              />
              <Callout>
                <View style={{ padding: 6, minWidth: 130 }}>
                  <Text style={{ fontWeight: "bold", marginBottom: 3, fontSize: 13 }}>{loc.name}</Text>
                  <Text style={{ color: calloutColor, fontSize: 12 }}>{calloutStatus}</Text>
                </View>
              </Callout>
            </Marker>
          );
        })}

        {/* Route line: GPS → accepted destination (road-following via OSRM, or straight-line fallback) */}
        {(!assignedCrmsCase || assignedCrmsCase.status === "RESOLVED") && acceptedLocationId && myAcceptedLocation && currentLat && currentLng && !hasArrived && (
          <Polyline
            coordinates={
              routeCoords.length >= 2
                ? routeCoords
                : [
                    { latitude: currentLat, longitude: currentLng },
                    { latitude: myAcceptedLocation.lat, longitude: myAcceptedLocation.lng },
                  ]
            }
            strokeColor={colors.accent}
            strokeWidth={3}
            lineDashPattern={routeCoords.length >= 2 ? undefined : [8, 6]}
          />
        )}

        {/* CRMS case pin on crew map */}
        {assignedCrmsCase?.lat && assignedCrmsCase?.lng && (
          <Marker
            coordinate={{ latitude: assignedCrmsCase.lat, longitude: assignedCrmsCase.lng }}
            pinColor="violet"
            title={`📋 CRMS #${assignedCrmsCase.caseNumber}`}
            description={assignedCrmsCase.address || assignedCrmsCase.fpName}
          />
        )}
        {/* Lightning risk polygons — 32 army sectors */}
        {showLightning && lightningFeatures.map((feature) => {
          const sector = lightningSectors.find(s => s.name === feature.name);
          const cat = sector?.cat ?? "3";
          const { fill, stroke } = catCircleColors(cat);
          return feature.polygons.map((poly, pi) => (
            <Polygon
              key={`${feature.name}-${pi}`}
              coordinates={poly[0].map(([lat, lng]) => ({ latitude: lat, longitude: lng }))}
              fillColor={fill}
              strokeColor={stroke}
              strokeWidth={1}
            />
          ));
        })}
        {/* NEA rain radar — web only, animates through frames */}
        {Platform.OS === "web" && showRadar && radarUrl && (
          <Overlay
            bounds={[[1.145, 103.565], [1.4572, 104.130]] as any}
            image={{ uri: radarUrl }}
            opacity={0.75}
          />
        )}
      </MapView>

      {/* Live ETA badge overlaid on the map when en-route — hidden when active CRMS case takes priority */}
      {(!assignedCrmsCase || assignedCrmsCase.status === "RESOLVED") && acceptedLocationId && myAcceptedLocation && !hasArrived && etaString && (
        <View style={styles.etaMapOverlay}>
          <Feather name="clock" size={13} color="#FFFFFF" />
          <Text style={styles.etaMapOverlayText}>ETA {etaString} hrs · {etaMinutes} min</Text>
        </View>
      )}

      <View style={styles.header}>
        <View style={styles.headerCard}>
          <View style={[styles.headerDot, { backgroundColor: currentLat ? colors.accent : colors.mutedForeground }]} />
          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>{userInfo.unitCode} · {userInfo.vehicleNumber}</Text>
            <Text style={styles.headerSub}>
              {userInfo.partner1}{userInfo.partner2 ? ` & ${userInfo.partner2}` : ""} · {userInfo.shift}
            </Text>
          </View>
          {!currentLat && <ActivityIndicator size="small" color={colors.mutedForeground} />}
          {pushEnabled !== null && (
            <Pressable
              onPress={toggleNotifications}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: 8,
                paddingVertical: 5,
                borderRadius: 10,
                backgroundColor: pushEnabled ? `${colors.accent}20` : colors.background,
                borderWidth: 1,
                borderColor: pushEnabled ? colors.accent : colors.border,
              }}
            >
              <Feather
                name={pushEnabled ? "bell" : "bell-off"}
                size={14}
                color={pushEnabled ? colors.accent : colors.mutedForeground}
              />
              <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: pushEnabled ? colors.accent : colors.mutedForeground }}>
                {pushEnabled ? "ON" : "OFF"}
              </Text>
            </Pressable>
          )}
          <Pressable
            onPress={toggleTheme}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={{ padding: 8 }}
          >
            <Feather name={isDark ? "sun" : "moon"} size={18} color={colors.mutedForeground} />
          </Pressable>
          <Pressable
            onPress={() => { router.replace("/"); logout(); }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={{ padding: 8 }}
          >
            <Feather name="log-out" size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>
      </View>

      <Pressable style={styles.centerBtn} onPress={centerOnUser}>
        <Feather name="crosshair" size={20} color={colors.foreground} />
      </Pressable>

      {/* ── Map overlay toggles — rendered after header so they sit on top (zIndex 20) ── */}
      {/* ⚡ Lightning */}
      <Pressable
        onPress={() => setShowLightning(l => !l)}
        style={{
          position: "absolute",
          top: insets.top + (Platform.OS === "web" ? 67 : 0) + 80 + 44 + 10,
          right: 12, zIndex: 20,
          flexDirection: "row", alignItems: "center", gap: 5,
          backgroundColor: showLightning
            ? (worstCat === 1 ? "#dc2626" : worstCat === 2 ? "#ca8a04" : "#16a34a")
            : colors.card,
          borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
          borderWidth: 1,
          borderColor: showLightning
            ? (worstCat === 1 ? "#dc2626" : worstCat === 2 ? "#ca8a04" : "#16a34a")
            : colors.border,
          shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 4, elevation: 3,
        }}
      >
        <Text style={{ fontSize: 13 }}>⚡</Text>
        <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: showLightning ? "#FFF" : colors.mutedForeground }}>
          {showLightning ? `CAT ${worstCat}` : "Lightning"}
        </Text>
      </Pressable>
      {/* 🌧 Rain radar (web only) */}
      {Platform.OS === "web" && (
        <Pressable
          onPress={() => setShowRadar(r => !r)}
          style={{
            position: "absolute",
            top: insets.top + (Platform.OS === "web" ? 67 : 0) + 80 + 44 + 10 + 38 + 8,
            right: 12, zIndex: 20,
            flexDirection: "row", alignItems: "center", gap: 5,
            backgroundColor: showRadar ? "#0ea5e9" : colors.card,
            borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
            borderWidth: 1,
            borderColor: showRadar ? "#0ea5e9" : colors.border,
            shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 4, elevation: 3,
          }}
        >
          <Text style={{ fontSize: 13 }}>🌧</Text>
          <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: showRadar ? "#FFF" : colors.mutedForeground }}>
            {showRadar && radarLabel ? radarLabel.slice(11, 16) : "Radar"}
          </Text>
        </Pressable>
      )}

      <View style={styles.bottomPanel}>
        {/* CRMS case assigned to this crew — shown above deployment location */}
        {assignedCrmsCase && (() => {
          const isResolved = assignedCrmsCase.status === "RESOLVED";
          const statusColorMap: Record<string, string> = {
            TO_BE_ASSIGNED: "#7c3aed", TEAM_ACKNOWLEDGE_OTW: "#f59e0b",
            FP_UPDATED: "#3b82f6", ASSISTANCE_PROVIDED: "#8b5cf6", RESOLVED: "#22c55e",
          };
          const statusBgMap: Record<string, string> = {
            TO_BE_ASSIGNED: "rgba(124,58,237,0.12)", TEAM_ACKNOWLEDGE_OTW: "rgba(245,158,11,0.12)",
            FP_UPDATED: "rgba(59,130,246,0.12)", ASSISTANCE_PROVIDED: "rgba(139,92,246,0.12)", RESOLVED: "rgba(34,197,94,0.10)",
          };
          const statusLabelMap: Record<string, string> = {
            TO_BE_ASSIGNED: "To Be Assigned", TEAM_ACKNOWLEDGE_OTW: "Team OTW",
            FP_UPDATED: "FP Updated", ASSISTANCE_PROVIDED: "Assistance Given", RESOLVED: "Resolved ✓",
          };
          const accentColor = statusColorMap[assignedCrmsCase.status] ?? "#7c3aed";
          const bgColor = statusBgMap[assignedCrmsCase.status] ?? "rgba(124,58,237,0.12)";
          const badgeLabel = statusLabelMap[assignedCrmsCase.status] ?? assignedCrmsCase.status;
          const titleColor = isResolved ? "#86efac" : "#c4b5fd";
          return (
            <View style={{ backgroundColor: bgColor, borderRadius: 14, borderWidth: 1.5, borderColor: accentColor, padding: 12, marginBottom: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <View style={{ backgroundColor: accentColor, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 }}>
                  <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff", textTransform: "uppercase" }}>
                    {badgeLabel}
                  </Text>
                </View>
                <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: titleColor, flex: 1 }}>
                  📋 CRMS #{assignedCrmsCase.caseNumber}
                </Text>
              </View>
              <Text style={{ fontSize: 12, color: colors.foreground, fontFamily: "Inter_500Medium" }} numberOfLines={2}>
                {assignedCrmsCase.address || assignedCrmsCase.details || "No address"}
              </Text>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 2 }}>
                FP: {assignedCrmsCase.fpName} · {assignedCrmsCase.fpContact}
              </Text>
              {/* Flood Assessment input */}
              <View style={{ marginTop: 10 }}>
                <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, marginBottom: 4 }}>
                  🌊 Flood Assessment
                </Text>
                {assignedCrmsCase.floodAssessment && !crmsFloodDraft ? null : null}
                <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
                  <TextInput
                    value={crmsFloodDraft}
                    onChangeText={setCrmsFloodDraft}
                    placeholder="Describe flood conditions…"
                    placeholderTextColor={colors.mutedForeground}
                    multiline
                    numberOfLines={2}
                    style={{
                      flex: 1, fontSize: 12, fontFamily: "Inter_400Regular",
                      color: colors.foreground, backgroundColor: "rgba(255,255,255,0.06)",
                      borderRadius: 8, borderWidth: 1, borderColor: "rgba(124,58,237,0.3)",
                      padding: 8, minHeight: 52, textAlignVertical: "top",
                    }}
                  />
                  <Pressable
                    onPress={async () => {
                      if (!assignedCrmsCase?.id) return;
                      setCrmsFloodSaving(true);
                      try {
                        const r = await fetch(`${API_BASE}/api/crms/${assignedCrmsCase.id}`, {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ floodAssessment: crmsFloodDraft.trim() }),
                        });
                        if (r.ok) {
                          const updated = await r.json();
                          setAssignedCrmsCase((prev: any) => ({ ...prev, floodAssessment: updated.floodAssessment }));
                        }
                      } catch { /* ignore */ } finally { setCrmsFloodSaving(false); }
                    }}
                    style={{ backgroundColor: "rgba(124,58,237,0.2)", borderWidth: 1, borderColor: "rgba(124,58,237,0.4)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, alignSelf: "flex-start" }}
                  >
                    <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#c4b5fd" }}>
                      {crmsFloodSaving ? "…" : "💾"}
                    </Text>
                  </Pressable>
                </View>
              </View>
              {!isResolved && (
                <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                  <Pressable
                    onPress={() => {
                      const hasCoords = assignedCrmsCase.lat && assignedCrmsCase.lng;
                      const dest = hasCoords
                        ? `${assignedCrmsCase.lat},${assignedCrmsCase.lng}`
                        : encodeURIComponent(assignedCrmsCase.address || assignedCrmsCase.locationName || "Singapore");
                      const url = hasCoords
                        ? Platform.select({
                            ios: `maps://app?daddr=${dest}&dirflg=d`,
                            android: `google.navigation:q=${dest}`,
                            default: `https://maps.google.com/maps?daddr=${dest}`,
                          })
                        : `https://maps.google.com/maps?q=${dest}`;
                      Linking.openURL(url ?? "");
                    }}
                    style={{ flex: 1, backgroundColor: "#7c3aed", borderRadius: 10, paddingVertical: 9, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}
                  >
                    <Feather name="navigation" size={14} color="#fff" />
                    <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" }}>Navigate</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => mapRef.current?.animateToRegion({
                      latitude: assignedCrmsCase.lat ?? 1.3521,
                      longitude: assignedCrmsCase.lng ?? 103.8198,
                      latitudeDelta: 0.01, longitudeDelta: 0.01,
                    })}
                    style={{ paddingHorizontal: 12, backgroundColor: colors.secondary, borderRadius: 10, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 5 }}
                  >
                    <Feather name="map-pin" size={14} color="#7c3aed" />
                    <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#7c3aed" }}>Show</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })()}

        {(!assignedCrmsCase || assignedCrmsCase.status === "RESOLVED") && acceptedLocationId && myAcceptedLocation ? (
          <>
            <View style={styles.acceptedCard}>
              <Text style={styles.acceptedLabel}>{hasArrived ? "On Site" : "Accepted Location"}</Text>
              {/* Previous location (crossed out) shown when this is a reassignment */}
              {!!(myEntry as any)?.previousLocationName && (
                <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: colors.mutedForeground, textDecorationLine: "line-through", marginBottom: 2, opacity: 0.7 }}>
                  {(myEntry as any).previousLocationName}
                </Text>
              )}
              <Text style={styles.acceptedName}>{myAcceptedLocation.name}</Text>
              {!hasArrived && etaString && (
                <Text style={styles.acceptedEta}>ETA: {etaString} hrs · {etaMinutes} min away</Text>
              )}
              {hasArrived && (
                <View style={styles.arrivedRow}>
                  <View style={styles.arrivedBadge}>
                    <Feather name="check-circle" size={13} color={colors.accent} />
                    <Text style={styles.arrivedBadgeText}>
                      Arrived {myEntry?.arrivedAt ? `${myEntry.arrivedAt} hrs` : ""}
                    </Text>
                  </View>
                  {displayWeather && (
                    <Pressable style={[styles.weatherBadge, {
                      borderColor: displayWeather.toLowerCase().includes("heavy") ? "#ef4444"
                        : displayWeather.toLowerCase().includes("moderate") ? "#f97316" : colors.border,
                    }]} onPress={() => { setWeatherPromptLabel("Update Weather"); setShowWeatherModal(true); }}>
                      <Text style={styles.weatherBadgeText}>
                        {weatherEmoji(displayWeather)} {displayWeather}
                      </Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>
            <View style={styles.btnRow}>
              {!hasArrived ? (
                <>
                  <Pressable style={styles.navBtn} onPress={handleNavigate}>
                    <Feather name="navigation" size={18} color="#FFFFFF" />
                    <Text style={styles.acceptBtnText}>Navigate</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.navBtn, { backgroundColor: colors.secondary, borderWidth: 1, borderColor: colors.border }]}
                    onPress={() => setShowSwapPickerModal(true)}
                  >
                    <Feather name="repeat" size={16} color={colors.foreground} />
                    <Text style={[styles.acceptBtnText, { color: colors.foreground }]}>Swap</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.arriveBtn, tooFarToArrive && { opacity: 0.45, backgroundColor: colors.mutedForeground }]}
                    onPress={handleArrive}
                  >
                    <Feather name="check-circle" size={18} color="#FFFFFF" />
                    <View style={{ alignItems: "center" }}>
                      <Text style={styles.acceptBtnText}>Arrive</Text>
                      {tooFarToArrive && nearestDistanceM !== null && (
                        <Text style={{ fontSize: 10, color: "rgba(255,255,255,0.9)", marginTop: 1 }}>
                          {nearestDistanceM >= 1000
                            ? `${(nearestDistanceM / 1000).toFixed(1)}km away`
                            : `${nearestDistanceM}m away`}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                </>
              ) : (
                <>
                  <Pressable style={styles.navBtn} onPress={handleNavigate}>
                    <Feather name="navigation" size={18} color="#FFFFFF" />
                    <Text style={styles.acceptBtnText}>Navigate</Text>
                  </Pressable>
                  <Pressable style={styles.weatherBtn} onPress={() => { setWeatherPromptLabel("Update Weather"); setShowWeatherModal(true); }}>
                    <Feather name="cloud-rain" size={18} color={colors.foreground} />
                    <Text style={styles.weatherBtnText}>Weather</Text>
                  </Pressable>
                </>
              )}
            </View>
          </>
        ) : (
          (!assignedCrmsCase || assignedCrmsCase.status === "RESOLVED") && (
            !currentLat ? (
              <View style={styles.nearestCard}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.nearestLabel, { marginTop: 8 }]}>Acquiring GPS...</Text>
              </View>
            ) : nearestLocation ? (
              <>
                <View style={styles.nearestCard}>
                  <Text style={styles.nearestLabel}>Nearest Location</Text>
                  <View style={styles.nearestRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.nearestName}>{nearestLocation.name}</Text>
                      {nearestDistanceM !== null && (
                        <Text style={styles.nearestDist}>
                          {nearestDistanceM >= 1000
                            ? `${(nearestDistanceM / 1000).toFixed(1)} km away`
                            : `${nearestDistanceM} m away`}
                          {etaString ? `  ·  ETA ${etaString} hrs` : ""}
                        </Text>
                      )}
                    </View>
                    {etaString && (
                      <View style={styles.etaBadge}>
                        <Text style={styles.etaText}>{etaString}</Text>
                      </View>
                    )}
                  </View>
                </View>
                <Pressable
                  style={[styles.acceptBtn, { backgroundColor: colors.primary, opacity: isAccepting ? 0.7 : 1 }]}
                  onPress={handleAccept}
                  disabled={isAccepting}
                >
                  {isAccepting
                    ? <ActivityIndicator size="small" color="#FFF" />
                    : <Feather name="check-circle" size={18} color="#FFFFFF" />}
                  <Text style={styles.acceptBtnText}>{isAccepting ? "Accepting…" : "Accept Location"}</Text>
                </Pressable>
              </>
            ) : null
          )
        )}
      </View>

      {/* Assignment modal */}
      <Modal visible={showAssignmentModal && !!pendingAssignment} transparent animationType="slide" onRequestClose={() => {}}>
        <View style={styles.assignOverlay}>
          <View style={styles.assignSheet}>
            {(() => {
              const isReassignment = !!(pendingAssignment as any)?.previousLocationName;
              const prevLocName = (pendingAssignment as any)?.previousLocationName as string | undefined;
              return (
                <>
                  <View style={[styles.assignIconWrap, isReassignment && { backgroundColor: `${colors.primary}20` }]}>
                    <Feather name={isReassignment ? "refresh-cw" : "bell"} size={28} color={isReassignment ? colors.primary : colors.warning} />
                  </View>
                  <Text style={styles.assignTitle}>{isReassignment ? "📍 You've Been Reassigned" : "New Assignment"}</Text>
                  {isReassignment ? (
                    <Text style={styles.assignSub}>Your manager has moved you to a new location:</Text>
                  ) : (
                    <Text style={styles.assignSub}>Your manager has assigned you to:</Text>
                  )}
                  {isReassignment && prevLocName && (
                    <View style={[styles.assignLocationCard, { backgroundColor: colors.background, opacity: 0.65, marginBottom: 6 }]}>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Previous Location (Freed)</Text>
                      <Text style={{ fontSize: 16, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, textDecorationLine: "line-through" }}>{prevLocName}</Text>
                    </View>
                  )}
                  {isReassignment && prevLocName && (
                    <View style={{ alignItems: "center", marginBottom: 6 }}>
                      <Feather name="arrow-down" size={16} color={colors.primary} />
                    </View>
                  )}
                  <View style={[styles.assignLocationCard, isReassignment && { borderColor: colors.primary, borderWidth: 1.5 }]}>
                    <Text style={styles.assignLocationName}>{pendingAssignment?.locationName}</Text>
                    <Text style={styles.assignLocationCoords}>
                      {pendingAssignment?.lat.toFixed(4)}, {pendingAssignment?.lng.toFixed(4)}
                    </Text>
                  </View>
                  <Text style={styles.assignNote}>
                    {isReassignment
                      ? "Accepting will move you to this location. Your previous location is already freed."
                      : "Accepting will claim this location and start your navigation."}
                  </Text>
                  <View style={styles.assignBtns}>
                    <Pressable style={styles.assignDeclineBtn} onPress={async () => { await declineAssignment(); setShowAssignmentModal(false); }}>
                      <Text style={styles.assignDeclineTxt}>Decline</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.assignAcceptBtn, { opacity: isAccepting ? 0.7 : 1 }, isReassignment && { backgroundColor: colors.primary }]}
                      onPress={async () => { await acceptAssignment(); setShowAssignmentModal(false); }}
                      disabled={isAccepting}
                    >
                      {isAccepting ? <ActivityIndicator size="small" color="#FFF" /> : <Feather name="check" size={16} color="#FFF" />}
                      <Text style={styles.assignAcceptTxt}>{isReassignment ? "Accept Reassignment" : "Accept"}</Text>
                    </Pressable>
                  </View>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* CRMS case assigned alert */}
      <Modal visible={showCrmsAlert} transparent animationType="slide" onRequestClose={() => setShowCrmsAlert(false)}>
        <View style={styles.assignOverlay}>
          <View style={[styles.assignSheet, { borderTopColor: "#7c3aed" }]}>
            <View style={[styles.assignIconWrap, { backgroundColor: "rgba(124,58,237,0.15)" }]}>
              <Text style={{ fontSize: 28 }}>📋</Text>
            </View>
            <Text style={styles.assignTitle}>CRMS Case Assigned</Text>
            <Text style={styles.assignSub}>Your manager has assigned you a new case:</Text>
            {assignedCrmsCase && (
              <View style={[styles.assignLocationCard, { borderWidth: 1, borderColor: "rgba(124,58,237,0.3)" }]}>
                <Text style={[styles.assignLocationName, { fontSize: 16, color: "#c4b5fd" }]}>
                  #{assignedCrmsCase.caseNumber}
                </Text>
                <Text style={[styles.assignLocationCoords, { fontSize: 13, color: colors.foreground, marginTop: 4 }]} numberOfLines={3}>
                  {assignedCrmsCase.address || assignedCrmsCase.details || "No address on file"}
                </Text>
                <Text style={[styles.assignLocationCoords, { marginTop: 6 }]}>
                  FP: {assignedCrmsCase.fpName} · {assignedCrmsCase.fpContact}
                </Text>
              </View>
            )}
            <Text style={styles.assignNote}>
              The case details and navigation appear in the panel below the map.
            </Text>
            <Pressable
              style={[styles.assignAcceptBtn, { width: "100%" }]}
              onPress={() => setShowCrmsAlert(false)}
            >
              <Feather name="check" size={16} color="#FFF" />
              <Text style={styles.assignAcceptTxt}>Got It</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Swap picker modal — choose a team to propose a location swap with */}
      <Modal visible={showSwapPickerModal} transparent animationType="slide" onRequestClose={() => setShowSwapPickerModal(false)}>
        <View style={styles.assignOverlay}>
          <View style={[styles.assignSheet, { borderTopColor: "#0ea5e9" }]}>
            <View style={[styles.assignIconWrap, { backgroundColor: "rgba(14,165,233,0.12)" }]}>
              <Feather name="repeat" size={26} color="#0ea5e9" />
            </View>
            <Text style={styles.assignTitle}>Propose Location Swap</Text>
            <Text style={styles.assignSub}>
              Select a team to swap locations with.{"\n"}They will receive a request to accept or decline.
            </Text>
            {swapCandidates.length === 0 && (
              <View style={[styles.assignLocationCard, { alignItems: "center", paddingVertical: 18 }]}>
                <Feather name="users" size={22} color={colors.mutedForeground} style={{ marginBottom: 8 }} />
                <Text style={{ fontSize: 13, color: colors.mutedForeground, textAlign: "center", fontFamily: "Inter_500Medium" }}>
                  No other teams found.{"\n"}Ask your manager to import the roster.
                </Text>
              </View>
            )}
            {swapCandidates.map((team: any) => {
              const entry = team.currentEntry;
              const assignment = team.assignment;
              // Show deployed location first; fall back to manager-assigned location
              const hasAccepted = !!entry?.locationId;
              const hasAssigned = !!assignment?.locationId;
              const loc = hasAccepted ? allLocations.find((l: any) => l.id === entry.locationId) : null;
              const locName = hasAccepted
                ? (loc?.name ?? entry.locationId)
                : hasAssigned
                  ? (assignment.locationName ?? assignment.locationId)
                  : null;
              const locStatus = hasAccepted ? "✅" : hasAssigned ? "📋" : "⏳";
              const locLabel = hasAccepted
                ? `${locStatus} ${locName}`
                : hasAssigned
                  ? `${locStatus} Assigned: ${locName}`
                  : "⏳ No location yet";
              const canSwap = hasAccepted || hasAssigned; // allow swap for deployed OR manager-assigned
              const displayName = `${team.unitCode ?? entry?.unitCode ?? "?"} · ${team.vehicleNumber ?? entry?.vehicleNumber ?? "?"}`;
              const partner = team.partner
                ? team.partner
                : entry?.partner ?? null;
              return (
                <Pressable
                  key={team.vehicleId ?? entry?.vehicleId}
                  style={[
                    styles.assignLocationCard,
                    { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, opacity: canSwap ? 1 : 0.5 },
                  ]}
                  onPress={async () => {
                    if (!canSwap) {
                      Alert.alert("Cannot Swap", hasAssigned
                        ? `${displayName} has been assigned ${locName} but hasn't accepted yet. Ask them to accept first.`
                        : `${displayName} has not been assigned a location yet.`);
                      return;
                    }
                    if (swapBusy || !userInfo?.vehicleId) return;
                    setSwapBusy(true);
                    try {
                      const res = await fetch(`${API_BASE}/api/deployments/swap-request`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ fromVehicleId: userInfo.vehicleId, toVehicleId: team.vehicleId }),
                      });
                      const data = await res.json();
                      if (!res.ok) {
                        Alert.alert("Swap Failed", data.error ?? "Could not send swap request.");
                      } else {
                        Alert.alert("Request Sent", `Swap proposal sent to ${displayName}. Waiting for their response.`);
                        setShowSwapPickerModal(false);
                      }
                    } catch {
                      Alert.alert("Error", "Network error. Please try again.");
                    } finally {
                      setSwapBusy(false);
                    }
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.assignLocationName, { fontSize: 15 }]}>{displayName}</Text>
                    <Text style={[styles.assignLocationCoords, { marginTop: 3 }]}>{locLabel}</Text>
                    {partner && <Text style={[styles.assignLocationCoords, { marginTop: 1 }]}>👤 {partner}</Text>}
                  </View>
                  {canSwap
                    ? <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                    : <Feather name="clock" size={16} color={colors.mutedForeground} />}
                </Pressable>
              );
            })}
            <Pressable style={[styles.assignDeclineBtn, { width: "100%", marginTop: 8 }]} onPress={() => setShowSwapPickerModal(false)}>
              <Text style={styles.assignDeclineTxt}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Incoming swap request modal — shown when another team proposes a swap */}
      <Modal visible={showSwapIncomingModal && !!incomingSwapRequest} transparent animationType="slide" onRequestClose={() => setShowSwapIncomingModal(false)}>
        <View style={styles.assignOverlay}>
          <View style={[styles.assignSheet, { borderTopColor: "#f97316" }]}>
            <View style={[styles.assignIconWrap, { backgroundColor: "rgba(249,115,22,0.12)" }]}>
              <Feather name="repeat" size={26} color="#f97316" />
            </View>
            <Text style={styles.assignTitle}>Swap Request</Text>
            <Text style={styles.assignSub}>
              {incomingSwapRequest?.fromUnitCode} {incomingSwapRequest?.fromVehicleNumber} wants to swap locations with you.
            </Text>
            {incomingSwapRequest && (
              <View style={{ width: "100%", gap: 8, marginVertical: 8 }}>
                <View style={[styles.assignLocationCard, { flexDirection: "row", alignItems: "center", gap: 10 }]}>
                  <Text style={{ fontSize: 13, color: colors.mutedForeground, width: 38 }}>They</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.assignLocationName, { fontSize: 14 }]}>{incomingSwapRequest.fromUnitCode} {incomingSwapRequest.fromVehicleNumber}</Text>
                    <Text style={[styles.assignLocationCoords, { marginTop: 2 }]}>📍 {incomingSwapRequest.fromLocationName}</Text>
                  </View>
                </View>
                <View style={{ alignItems: "center" }}>
                  <Feather name="repeat" size={16} color={colors.mutedForeground} />
                </View>
                <View style={[styles.assignLocationCard, { flexDirection: "row", alignItems: "center", gap: 10 }]}>
                  <Text style={{ fontSize: 13, color: colors.mutedForeground, width: 38 }}>You</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.assignLocationName, { fontSize: 14 }]}>{incomingSwapRequest.toUnitCode} {incomingSwapRequest.toVehicleNumber}</Text>
                    <Text style={[styles.assignLocationCoords, { marginTop: 2 }]}>📍 {incomingSwapRequest.toLocationName}</Text>
                  </View>
                </View>
              </View>
            )}
            <Text style={styles.assignNote}>Accepting will move both teams to the other's location.</Text>
            <View style={styles.assignBtns}>
              <Pressable
                style={styles.assignDeclineBtn}
                disabled={swapBusy}
                onPress={async () => {
                  if (!incomingSwapRequest || !userInfo?.vehicleId) return;
                  setSwapBusy(true);
                  try {
                    await fetch(`${API_BASE}/api/deployments/swap-decline`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ swapRequestId: incomingSwapRequest.id, vehicleId: userInfo.vehicleId }),
                    });
                  } catch { /* ignore */ }
                  setSwapBusy(false);
                  setShowSwapIncomingModal(false);
                }}
              >
                <Text style={styles.assignDeclineTxt}>Decline</Text>
              </Pressable>
              <Pressable
                style={[styles.assignAcceptBtn, { opacity: swapBusy ? 0.7 : 1, backgroundColor: "#f97316" }]}
                disabled={swapBusy}
                onPress={async () => {
                  if (!incomingSwapRequest || !userInfo?.vehicleId) return;
                  setSwapBusy(true);
                  try {
                    const res = await fetch(`${API_BASE}/api/deployments/swap-accept`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ swapRequestId: incomingSwapRequest.id, vehicleId: userInfo.vehicleId }),
                    });
                    const data = await res.json();
                    if (!res.ok) {
                      Alert.alert("Swap Failed", data.error ?? "Could not complete swap.");
                    } else {
                      // Force immediate refetch so AppContext syncs acceptedLocationId
                      await queryClient.invalidateQueries({ queryKey: getGetDeploymentStateQueryKey() });
                      Alert.alert("Swap Complete!", `You are now at ${incomingSwapRequest.fromLocationName}.`);
                    }
                  } catch {
                    Alert.alert("Error", "Network error. Please try again.");
                  }
                  setSwapBusy(false);
                  setShowSwapIncomingModal(false);
                }}
              >
                {swapBusy ? <ActivityIndicator size="small" color="#FFF" /> : <Feather name="check" size={16} color="#FFF" />}
                <Text style={styles.assignAcceptTxt}>Accept Swap</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Weather modal */}
      <Modal visible={showWeatherModal} transparent animationType="slide" onRequestClose={() => setShowWeatherModal(false)}>
        <View style={styles.weatherOverlay}>
          <View style={styles.weatherSheet}>
            <Text style={styles.weatherSheetTitle}>{weatherPromptLabel}</Text>
            <Text style={styles.weatherSheetSub}>
              {myAcceptedLocation?.name ?? "your location"}
            </Text>
            {WEATHER_OPTIONS.map((opt) => (
              <Pressable
                key={opt.label}
                style={[
                  styles.weatherOption,
                  displayWeather === opt.label && { borderColor: colors.accent, borderWidth: 2 },
                ]}
                onPress={async () => {
                  await updateWeather(opt.label);
                  setShowWeatherModal(false);
                }}
              >
                <Text style={styles.weatherOptionEmoji}>{opt.emoji}</Text>
                <Text style={styles.weatherOptionLabel}>{opt.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}
