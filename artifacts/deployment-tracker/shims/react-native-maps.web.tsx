import L from "leaflet";

// Inject Leaflet CSS via CDN since Metro web bundler doesn't handle CSS imports
if (typeof document !== "undefined") {
  const id = "leaflet-css";
  if (!document.getElementById(id)) {
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
    document.head.appendChild(link);
  }
}
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { StyleSheet, View } from "react-native";
import {
  Circle as LCircle,
  ImageOverlay,
  MapContainer,
  Marker as LMarker,
  Polygon as LPolygon,
  Polyline as LPolyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";

export const PROVIDER_DEFAULT = null;
export const PROVIDER_GOOGLE = "google";

// Fix leaflet default icon paths broken by bundlers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta?: number;
  longitudeDelta?: number;
};

type RNMapEvent = { nativeEvent: { coordinate: { latitude: number; longitude: number } } };

type MapViewProps = {
  style?: any;
  children?: React.ReactNode;
  initialRegion?: Region;
  showsUserLocation?: boolean;
  showsMyLocationButton?: boolean;
  provider?: string | null;
  userInterfaceStyle?: "light" | "dark";
  customMapStyle?: any;
  onPress?: (e: RNMapEvent) => void;
  onLongPress?: (e: RNMapEvent) => void;
};

function makeMapEvent(lat: number, lng: number): RNMapEvent {
  return { nativeEvent: { coordinate: { latitude: lat, longitude: lng } } };
}

function MapEventHandler({
  onPress,
  onLongPress,
}: {
  onPress?: (e: RNMapEvent) => void;
  onLongPress?: (e: RNMapEvent) => void;
}) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const pendingLatLng = useRef<{ lat: number; lng: number } | null>(null);

  useMapEvents({
    mousedown(e) {
      if (!onLongPress) return;
      pendingLatLng.current = { lat: e.latlng.lat, lng: e.latlng.lng };
      longPressFired.current = false;
      longPressTimer.current = setTimeout(() => {
        longPressFired.current = true;
        if (pendingLatLng.current) {
          onLongPress(makeMapEvent(pendingLatLng.current.lat, pendingLatLng.current.lng));
        }
      }, 600);
    },
    mouseup() {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    },
    mousemove() {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    },
    click(e) {
      // Don't fire onPress if we just fired a long press
      if (longPressFired.current) { longPressFired.current = false; return; }
      if (onPress) onPress(makeMapEvent(e.latlng.lat, e.latlng.lng));
    },
    contextmenu(e) {
      // Right-click on desktop = long press fallback
      if (onLongPress) onLongPress(makeMapEvent(e.latlng.lat, e.latlng.lng));
    },
  });

  return null;
}

type MapViewHandle = {
  animateToRegion: (region: Region) => void;
};

function colorToHex(color: string | undefined): string {
  if (!color) return "#2563EB";
  const map: Record<string, string> = {
    red: "#EF4444",
    green: "#10B981",
    blue: "#2563EB",
    orange: "#F97316",
    yellow: "#EAB308",
    purple: "#8B5CF6",
    cyan: "#06B6D4",
    gray: "#6B7280",
    grey: "#6B7280",
  };
  return map[color.toLowerCase()] ?? color;
}

function makePinIcon(color: string) {
  const hex = colorToHex(color);
  const size = 22;
  const r = size / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${r}" cy="${r}" r="${r - 1}" fill="${hex}" stroke="white" stroke-width="2.5"/>
  </svg>`;
  return L.divIcon({
    className: "",
    html: svg,
    iconSize: [size, size],
    iconAnchor: [r, r],
    popupAnchor: [0, -r - 4],
  });
}

function UserLocationDot({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);

  const icon = L.divIcon({
    className: "",
    html: `<div style="width:16px;height:16px;border-radius:50%;background:#2563EB;border:3px solid white;box-shadow:0 0 0 3px rgba(37,99,235,0.3)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });

  useEffect(() => {
    if (!markerRef.current) {
      markerRef.current = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(map);
    } else {
      markerRef.current.setLatLng([lat, lng]);
    }
    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
    };
  }, [lat, lng]);

  return null;
}

function MapController({
  controllerRef,
  userLat,
  userLng,
}: {
  controllerRef: React.MutableRefObject<MapViewHandle | null>;
  userLat: number | null;
  userLng: number | null;
}) {
  const map = useMap();

  useImperativeHandle(controllerRef, () => ({
    animateToRegion(region: Region) {
      map.flyTo([region.latitude, region.longitude], 14, { animate: true, duration: 0.8 });
    },
  }));

  return userLat && userLng ? <UserLocationDot lat={userLat} lng={userLng} /> : null;
}

const TILE_DARK = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_LIGHT = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

const MapView = forwardRef<MapViewHandle, MapViewProps>(
  ({ style, children, initialRegion, showsUserLocation, userInterfaceStyle, onPress, onLongPress }, ref) => {
    const center: [number, number] = initialRegion
      ? [initialRegion.latitude, initialRegion.longitude]
      : [1.3521, 103.8198];
    const zoom = initialRegion?.latitudeDelta ? Math.round(Math.log2(360 / initialRegion.latitudeDelta)) : 12;

    const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
    const controllerRef = useRef<MapViewHandle | null>(null);

    useImperativeHandle(ref, () => ({
      animateToRegion: (region: Region) => controllerRef.current?.animateToRegion(region),
    }));

    useEffect(() => {
      if (!showsUserLocation) return;
      const id = navigator.geolocation.watchPosition(
        (pos) => setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { enableHighAccuracy: true }
      );
      return () => navigator.geolocation.clearWatch(id);
    }, [showsUserLocation]);

    // Bounds wide enough to show the 70km NEA radar fully (1.145–1.457°N, 103.565–104.130°E)
    const SG_BOUNDS: L.LatLngBoundsExpression = [[1.13, 103.555], [1.470, 104.140]];

    const tileUrl = userInterfaceStyle === "light" ? TILE_LIGHT : TILE_DARK;

    return (
      <View style={[styles.container, style]}>
        <MapContainer
          center={center}
          zoom={zoom}
          minZoom={10}
          maxZoom={19}
          maxBounds={SG_BOUNDS}
          maxBoundsViscosity={0.85}
          style={{ width: "100%", height: "100%" }}
          zoomControl={false}
        >
          <TileLayer
            key={tileUrl}
            url={tileUrl}
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
            subdomains="abcd"
          />
          <MapController
            controllerRef={controllerRef}
            userLat={userPos?.lat ?? null}
            userLng={userPos?.lng ?? null}
          />
          <MapEventHandler onPress={onPress} onLongPress={onLongPress} />
          {children}
        </MapContainer>
      </View>
    );
  }
);

MapView.displayName = "MapView";
export default MapView;

type MarkerProps = {
  coordinate: { latitude: number; longitude: number };
  pinColor?: string;
  title?: string;
  children?: React.ReactNode;
  onPress?: () => void;
  anchor?: { x: number; y: number };
};

export function Marker({ coordinate, pinColor, title, children, onPress }: MarkerProps) {
  const icon = makePinIcon(pinColor ?? "#9CA3AF");
  const eventHandlers = onPress
    ? { click: (e: any) => { e.originalEvent?.stopPropagation(); onPress(); } }
    : undefined;

  // Only put Callout children into the Leaflet Popup (skip native View circles etc.)
  const calloutChildren = React.Children.toArray(children).filter(
    (child) => React.isValidElement(child) && (child.type as any) === Callout
  );

  return (
    <LMarker
      position={[coordinate.latitude, coordinate.longitude]}
      icon={icon}
      title={title}
      eventHandlers={eventHandlers}
    >
      {calloutChildren.length > 0 ? <Popup>{calloutChildren}</Popup> : null}
    </LMarker>
  );
}

export function Callout({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

type PolylineProps = {
  coordinates: { latitude: number; longitude: number }[];
  strokeColor?: string;
  strokeWidth?: number;
  lineDashPattern?: number[];
};

export function Polyline({ coordinates, strokeColor, strokeWidth, lineDashPattern }: PolylineProps) {
  const positions = coordinates.map((c) => [c.latitude, c.longitude] as [number, number]);
  const dashArray = lineDashPattern ? lineDashPattern.join(" ") : undefined;
  return (
    <LPolyline
      positions={positions}
      pathOptions={{ color: strokeColor ?? "#10B981", weight: strokeWidth ?? 3, dashArray }}
    />
  );
}

type CircleProps = {
  center: { latitude: number; longitude: number };
  radius: number;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
};

export function Circle({ center, radius, fillColor, strokeColor, strokeWidth }: CircleProps) {
  const fill = fillColor ?? "rgba(59,130,246,0.2)";
  const stroke = strokeColor ?? "#3b82f6";
  const weight = strokeWidth ?? 1;
  const fillOpacity = (() => {
    const m = fill.match(/rgba?\([^)]+,\s*([\d.]+)\)/);
    return m ? parseFloat(m[1]) : 0.2;
  })();
  const solidFill = fill.startsWith("rgba") ? fill.replace(/,\s*[\d.]+\)$/, ",1)") : fill;
  return (
    <LCircle
      center={[center.latitude, center.longitude]}
      radius={radius}
      pathOptions={{ color: stroke, fillColor: solidFill, fillOpacity, weight }}
    />
  );
}

type PolygonProps = {
  coordinates: { latitude: number; longitude: number }[];
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
};

export function Polygon({ coordinates, fillColor, strokeColor, strokeWidth }: PolygonProps) {
  const positions = coordinates.map((c) => [c.latitude, c.longitude] as [number, number]);
  const fill = fillColor ?? "rgba(59,130,246,0.2)";
  const fillOpacity = (() => {
    const m = fill.match(/rgba?\([^)]+,\s*([\d.]+)\)/);
    return m ? parseFloat(m[1]) : 0.2;
  })();
  const solidFill = fill.startsWith("rgba") ? fill.replace(/,\s*[\d.]+\)$/, ",1)") : fill;
  return (
    <LPolygon
      positions={positions}
      pathOptions={{ color: strokeColor ?? "#3b82f6", fillColor: solidFill, fillOpacity, weight: strokeWidth ?? 1 }}
    />
  );
}

type OverlayProps = {
  bounds: [[number, number], [number, number]];
  image: { uri: string } | number;
  opacity?: number;
};

export function Overlay({ bounds, image, opacity = 1 }: OverlayProps) {
  const url = typeof image === "object" && "uri" in image ? image.uri : "";
  if (!url) return null;
  return <ImageOverlay url={url} bounds={bounds as L.LatLngBoundsExpression} opacity={opacity} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: "hidden",
  },
});
