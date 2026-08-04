import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import {
  getGetDeploymentStateQueryKey,
  useAcceptLocation,
  useGetDeploymentState,
  useRespondToAssignment,
  useUpdateVehiclePosition,
} from "@workspace/api-client-react";

import { PRESET_LOCATIONS, haversineDistance } from "@/data/presetLocations";

export interface UserInfo {
  vehicleId: string;
  vehicleNumber: string;
  unitCode: string;
  partner1: string;
  partner2: string;
  shift: string;
}

interface AppState {
  userInfo: UserInfo | null;
  isManager: boolean;
  acceptedLocationId: string | null;
  currentLat: number | null;
  currentLng: number | null;
  locationError: string | null;
  nearestLocationId: string | null;
  nearestDistanceM: number | null;
  etaMinutes: number | null;
  etaString: string | null;
  isAccepting: boolean;
  pendingAssignment: import("@workspace/api-client-react").Assignment | null;
  hasArrived: boolean;
  currentWeather: string | null;
  managerPin: string | null;
  login: (info: UserInfo) => void;
  loginAsManager: (pin?: string) => void;
  logout: () => void;
  acceptNearestLocation: () => Promise<void>;
  acceptAssignment: () => Promise<void>;
  declineAssignment: () => Promise<void>;
  markArrived: () => Promise<void>;
  updateWeather: (weather: string) => Promise<void>;
  deploymentState: ReturnType<typeof useGetDeploymentState>["data"];
  isLoadingState: boolean;
}

const AppContext = createContext<AppState | null>(null);

const STORAGE_KEY = "deployment_user_info";
const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

// Always format time in SGT (UTC+8) regardless of device timezone
function toSGTLabel(epochMs: number): string {
  const SGT_OFFSET = 8 * 60 * 60 * 1000;
  const d = new Date(epochMs + SGT_OFFSET);
  const hrs = d.getUTCHours().toString().padStart(2, "0");
  const mins = d.getUTCMinutes().toString().padStart(2, "0");
  return `${hrs}${mins}`;
}

async function fetchFromRoad(lat: number, lng: number): Promise<string | null> {
  try {
    const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (results.length > 0) {
      const r = results[0];
      // Try fields in priority order — Singapore often returns road in street or name
      const road = r.street ?? r.name ?? r.district ?? r.subregion ?? r.city ?? null;
      if (road) return road; // only return if we actually got a name — otherwise fall through to OneMap
    }
  } catch {
    // fall through to OneMap
  }
  // Fallback: Nominatim (OpenStreetMap) reverse geocode — no auth required
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "CWDFloodOps/1.0 (flood-ops-sg)" },
    });
    if (res.ok) {
      const json = await res.json();
      const road = json?.address?.road ?? json?.address?.pedestrian ?? json?.address?.path ?? null;
      if (road) return road as string;
    }
  } catch {
    // ignore
  }
  return null;
}

async function fetchETA(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
): Promise<{ minutes: number; label: string }> {
  // 1. Try Google Maps Directions API if key is available
  if (GOOGLE_MAPS_API_KEY) {
    try {
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${fromLat},${fromLng}&destination=${toLat},${toLng}&mode=driving&key=${GOOGLE_MAPS_API_KEY}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.routes && json.routes.length > 0) {
        const durationSec = json.routes[0].legs[0].duration.value as number;
        const minutes = Math.ceil(durationSec / 60);
        return { minutes, label: toSGTLabel(Date.now() + durationSec * 1000) };
      }
    } catch {
      // fall through to OSRM
    }
  }

  // 2. OSRM public router — free, road-based, no API key required
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=false`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.code === "Ok" && json.routes && json.routes.length > 0) {
      const durationSec = Math.round(json.routes[0].duration as number);
      const minutes = Math.ceil(durationSec / 60);
      return { minutes, label: toSGTLabel(Date.now() + durationSec * 1000) };
    }
  } catch {
    // fall through to straight-line fallback
  }

  // 3. Last resort: straight-line haversine at 30 km/h average
  return straightLineFallback(fromLat, fromLng, toLat, toLng);
}

function straightLineFallback(lat1: number, lng1: number, lat2: number, lng2: number) {
  const distM = haversineDistance(lat1, lng1, lat2, lng2);
  // 30 km/h average for Singapore urban driving = 500 m/min
  const minutes = Math.ceil(distM / 500);
  return { minutes, label: toSGTLabel(Date.now() + minutes * 60 * 1000) };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(Array.from(raw).map(c => c.charCodeAt(0)));
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [isManager, setIsManager] = useState(false);
  const [acceptedLocationId, setAcceptedLocationId] = useState<string | null>(null);
  const [currentLat, setCurrentLat] = useState<number | null>(null);
  const [currentLng, setCurrentLng] = useState<number | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [nearestLocationId, setNearestLocationId] = useState<string | null>(null);
  const [nearestDistanceM, setNearestDistanceM] = useState<number | null>(null);
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  const [etaString, setEtaString] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [currentWeather, setCurrentWeather] = useState<string | null>(null);
  const [managerPin, setManagerPin] = useState<string | null>(null);
  const locationWatchRef = useRef<Location.LocationSubscription | null>(null);
  const positionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const API_BASE =
    process.env.EXPO_PUBLIC_API_URL ??
    "https://cwd.pub-soarhco.stg.paas.sandbox.gov.sg";

  const queryClient = useQueryClient();

  const [appActive, setAppActive] = useState(true);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setAppActive(s === "active"));
    return () => sub.remove();
  }, []);

  const { data: deploymentState, isLoading: isLoadingState } = useGetDeploymentState({
    query: {
      refetchInterval: appActive ? 12000 : false,
      enabled: (!!userInfo || isManager) && appActive,
      queryKey: getGetDeploymentStateQueryKey(),
      staleTime: 8000,
    },
  });

  const acceptLocationMutation = useAcceptLocation();
  const updatePositionMutation = useUpdateVehiclePosition();
  const respondToAssignmentMutation = useRespondToAssignment();

  // Derive pending assignment for the current vehicle
  const pendingAssignment =
    userInfo && deploymentState?.assignments
      ? (deploymentState.assignments.find(
          (a) => a.vehicleId === userInfo.vehicleId && a.status === "pending"
        ) ?? null)
      : null;

  // Clear any persisted session on startup — role picker always shows fresh
  useEffect(() => {
    AsyncStorage.removeItem(STORAGE_KEY);
  }, []);

  const startLocationTracking = useCallback(async () => {
    if (Platform.OS === "web") {
      if (!navigator.geolocation) {
        setLocationError("Geolocation not supported");
        return;
      }
      navigator.geolocation.watchPosition(
        (pos) => {
          setCurrentLat(pos.coords.latitude);
          setCurrentLng(pos.coords.longitude);
          setLocationError(null);
        },
        (err) => setLocationError(err.message),
        { enableHighAccuracy: true }
      );
      return;
    }

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      setLocationError("Location permission denied");
      return;
    }

    locationWatchRef.current?.remove();
    locationWatchRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
      (loc) => {
        setCurrentLat(loc.coords.latitude);
        setCurrentLng(loc.coords.longitude);
        setLocationError(null);
      }
    );
  }, []);

  useEffect(() => {
    if (userInfo) startLocationTracking();
    return () => { locationWatchRef.current?.remove(); };
  }, [userInfo, startLocationTracking]);

  useEffect(() => {
    if (!userInfo || !currentLat || !currentLng) return;

    const allLocations = deploymentState?.presetLocations ?? PRESET_LOCATIONS;

    // When a location is already accepted, always show ETA to that destination
    if (acceptedLocationId) {
      const dest = allLocations.find((l) => l.id === acceptedLocationId);
      if (dest) {
        const distM = Math.round(haversineDistance(currentLat, currentLng, dest.lat, dest.lng));
        setNearestDistanceM(distM);
        fetchETA(currentLat, currentLng, dest.lat, dest.lng).then(({ minutes, label }) => {
          setEtaMinutes(minutes);
          setEtaString(label);
        });
      }
      return;
    }

    // Pre-acceptance: find nearest available location
    const acceptedIds = deploymentState?.entries?.map((e) => e.locationId) ?? [];
    const available = allLocations.filter((loc) => !acceptedIds.includes(loc.id));

    if (available.length === 0) {
      setNearestLocationId(null);
      setNearestDistanceM(null);
      return;
    }

    let minDist = Infinity;
    let nearest = available[0];
    for (const loc of available) {
      const d = haversineDistance(currentLat, currentLng, loc.lat, loc.lng);
      if (d < minDist) {
        minDist = d;
        nearest = loc;
      }
    }

    setNearestLocationId(nearest.id);
    setNearestDistanceM(Math.round(minDist));
    fetchETA(currentLat, currentLng, nearest.lat, nearest.lng).then(({ minutes, label }) => {
      setEtaMinutes(minutes);
      setEtaString(label);
    });
  }, [currentLat, currentLng, deploymentState, acceptedLocationId]);

  useEffect(() => {
    if (!userInfo || !currentLat || !currentLng) return;

    const sendPosition = async () => {
      // If the vehicle has accepted a location, compute a fresh ETA from current position
      let liveEta: string | undefined;
      let liveEtaMinutes: number | undefined;
      if (acceptedLocationId) {
        const allLocations = deploymentState?.presetLocations ?? PRESET_LOCATIONS;
        const dest = allLocations.find((l) => l.id === acceptedLocationId);
        if (dest) {
          const eta = await fetchETA(currentLat, currentLng, dest.lat, dest.lng);
          liveEta = eta.label;
          liveEtaMinutes = eta.minutes;
          // Update local state too so map/navigate panel stays current
          setEtaString(eta.label);
          setEtaMinutes(eta.minutes);
        }
      }

      updatePositionMutation.mutate({
        data: {
          vehicleId: userInfo.vehicleId,
          vehicleNumber: userInfo.vehicleNumber,
          unitCode: userInfo.unitCode,
          lat: currentLat,
          lng: currentLng,
          acceptedLocationId: acceptedLocationId ?? null,
          ...(liveEta !== undefined ? { eta: liveEta, etaMinutes: liveEtaMinutes } : {}),
        } as any,
      });
    };

    sendPosition();
    positionIntervalRef.current = setInterval(sendPosition, 20000);
    return () => { if (positionIntervalRef.current) clearInterval(positionIntervalRef.current); };
  }, [userInfo, currentLat, currentLng, acceptedLocationId]);

  // ── Web Push subscription (only on web platform, after login) ────────────────
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (!userInfo) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    const apiBase = API_BASE;
    const vehicleId = userInfo.vehicleId;

    (async () => {
      try {
        // Compute SW path relative to the app's base (e.g. /crew/sw.js when hosted at /crew)
        const appBase = window.location.pathname.split('/').slice(0, 2).join('/'); // "" or "/crew"
        const swPath = appBase ? `${appBase}/sw.js` : '/sw.js';
        const swScope = appBase ? `${appBase}/` : '/';
        const reg = await navigator.serviceWorker.register(swPath, { scope: swScope });
        // Request permission if not yet decided — small delay so it doesn't pop instantly on login
        if (Notification.permission === 'default') {
          await new Promise(resolve => setTimeout(resolve, 2000));
          await Notification.requestPermission();
        }
        if (Notification.permission !== 'granted') return;
        const { publicKey } = await fetch(`${apiBase}/api/push/vapid-key`).then(r => r.json());
        const existing = await reg.pushManager.getSubscription();
        const sub = existing ?? await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        await fetch(`${apiBase}/api/push/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: sub, type: 'crew', vehicleId }),
        });
      } catch (e) { /* non-fatal */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userInfo?.vehicleId]);

  const login = useCallback((info: UserInfo) => {
    setUserInfo(info);
    setIsManager(false);
    setAcceptedLocationId(null);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ userInfo: info, acceptedLocationId: null }));
  }, []);

  const loginAsManager = useCallback((pin?: string) => {
    setIsManager(true);
    setUserInfo(null);
    setAcceptedLocationId(null);
    if (pin) setManagerPin(pin);
  }, []);

  const logout = useCallback(() => {
    setUserInfo(null);
    setIsManager(false);
    setAcceptedLocationId(null);
    locationWatchRef.current?.remove();
    if (positionIntervalRef.current) clearInterval(positionIntervalRef.current);
    AsyncStorage.removeItem(STORAGE_KEY);
  }, []);

  const acceptNearestLocation = useCallback(async () => {
    if (!userInfo || !nearestLocationId || !currentLat || !currentLng) return;
    setIsAccepting(true);
    try {
      const allLocations = deploymentState?.presetLocations ?? PRESET_LOCATIONS;
      const location = allLocations.find((l) => l.id === nearestLocationId);
      if (!location) return;
      const [eta, fromRoad] = await Promise.all([
        fetchETA(currentLat, currentLng, location.lat, location.lng),
        fetchFromRoad(currentLat, currentLng),
      ]);
      const partner = userInfo.partner2
        ? `${userInfo.partner1} & ${userInfo.partner2}`
        : userInfo.partner1;
      await acceptLocationMutation.mutateAsync({
        data: {
          vehicleId: userInfo.vehicleId,
          vehicleNumber: userInfo.vehicleNumber,
          unitCode: userInfo.unitCode,
          partner,
          shift: userInfo.shift,
          locationId: nearestLocationId,
          eta: eta.label,
          etaMinutes: eta.minutes,
          fromRoad,
        },
      });
      setAcceptedLocationId(nearestLocationId);
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ userInfo, acceptedLocationId: nearestLocationId }));
      await queryClient.invalidateQueries({ queryKey: getGetDeploymentStateQueryKey() });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsAccepting(false);
    }
  }, [userInfo, nearestLocationId, currentLat, currentLng, acceptLocationMutation, queryClient, deploymentState]);

  const acceptAssignment = useCallback(async () => {
    if (!userInfo || !pendingAssignment || !currentLat || !currentLng) return;
    setIsAccepting(true);
    try {
      const [eta, fromRoad] = await Promise.all([
        fetchETA(currentLat, currentLng, pendingAssignment.lat, pendingAssignment.lng),
        fetchFromRoad(currentLat, currentLng),
      ]);
      const partner = userInfo.partner2
        ? `${userInfo.partner1} & ${userInfo.partner2}`
        : userInfo.partner1;
      await respondToAssignmentMutation.mutateAsync({
        data: {
          vehicleId: userInfo.vehicleId,
          vehicleNumber: userInfo.vehicleNumber,
          unitCode: userInfo.unitCode,
          partner,
          shift: userInfo.shift,
          accepted: true,
          eta: eta.label,
          etaMinutes: eta.minutes,
          fromRoad,
        },
      });
      setAcceptedLocationId(pendingAssignment.locationId);
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ userInfo, acceptedLocationId: pendingAssignment.locationId }));
      await queryClient.invalidateQueries({ queryKey: getGetDeploymentStateQueryKey() });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsAccepting(false);
    }
  }, [userInfo, pendingAssignment, currentLat, currentLng, respondToAssignmentMutation, queryClient]);

  const declineAssignment = useCallback(async () => {
    if (!userInfo || !pendingAssignment) return;
    try {
      await respondToAssignmentMutation.mutateAsync({
        data: { vehicleId: userInfo.vehicleId, accepted: false },
      });
      await queryClient.invalidateQueries({ queryKey: getGetDeploymentStateQueryKey() });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch {
      // ignore
    }
  }, [userInfo, pendingAssignment, respondToAssignmentMutation, queryClient]);

  // Keep acceptedLocationId in sync with the server.
  // Handles: first login / second device restore, AND location swaps where the
  // server moves the vehicle to a new locationId without the client knowing.
  useEffect(() => {
    if (!userInfo) return;
    const serverEntry = deploymentState?.entries?.find(
      (e) => e.vehicleId === userInfo.vehicleId
    );
    if (serverEntry && serverEntry.locationId !== acceptedLocationId) {
      setAcceptedLocationId(serverEntry.locationId);
      AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ userInfo, acceptedLocationId: serverEntry.locationId })
      );
    }
  }, [userInfo, deploymentState?.entries]);

  // Derive hasArrived from live deployment state
  const hasArrived = !!(
    userInfo &&
    acceptedLocationId &&
    deploymentState?.entries?.find(
      (e) => e.locationId === acceptedLocationId && e.vehicleId === userInfo.vehicleId
    )?.arrived
  );

  const markArrived = useCallback(async () => {
    if (!userInfo || !acceptedLocationId) return;
    try {
      await fetch(`${API_BASE}/api/deployments/arrive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicleId: userInfo.vehicleId, locationId: acceptedLocationId }),
      });
      await queryClient.invalidateQueries({ queryKey: getGetDeploymentStateQueryKey() });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      // ignore
    }
  }, [userInfo, acceptedLocationId, queryClient, API_BASE]);

  const updateWeather = useCallback(async (weather: string) => {
    if (!userInfo || !acceptedLocationId) return;
    try {
      await fetch(`${API_BASE}/api/deployments/weather`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicleId: userInfo.vehicleId, locationId: acceptedLocationId, weather }),
      });
      setCurrentWeather(weather);
      await queryClient.invalidateQueries({ queryKey: getGetDeploymentStateQueryKey() });
    } catch {
      // ignore
    }
  }, [userInfo, acceptedLocationId, queryClient, API_BASE]);

  return (
    <AppContext.Provider value={{
      userInfo,
      isManager,
      acceptedLocationId,
      currentLat,
      currentLng,
      locationError,
      nearestLocationId,
      nearestDistanceM,
      etaMinutes,
      etaString,
      isAccepting,
      pendingAssignment: pendingAssignment ?? null,
      hasArrived,
      currentWeather,
      managerPin,
      login,
      loginAsManager,
      logout,
      acceptNearestLocation,
      acceptAssignment,
      declineAssignment,
      markArrived,
      updateWeather,
      deploymentState,
      isLoadingState,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
