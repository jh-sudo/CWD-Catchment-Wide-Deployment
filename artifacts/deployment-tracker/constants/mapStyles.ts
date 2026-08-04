import type { MapStyleElement } from "react-native-maps";

// Dark custom map style for Android Google Maps.
// userInterfaceStyle handles iOS (Apple Maps), but Android needs customMapStyle.
// Matches the STYLE_DEFAULT used in the web dashboard manager.
export const DARK_MAP_STYLE: MapStyleElement[] = [
  { elementType: "geometry", stylers: [{ color: "#1a1d27" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#7a7f9a" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0f1117" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#2a2d3a" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#0f1117" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0f1117" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

// Empty array resets Google Maps (Android) to its default light style.
export const LIGHT_MAP_STYLE: MapStyleElement[] = [];
