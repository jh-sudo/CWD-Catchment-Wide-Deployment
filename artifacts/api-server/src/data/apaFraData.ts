// Static reference data for the apa (APA1 Operations FRA Map) frontend —
// deployment points, flood-risk-area clusters, and flood dot coordinates.
// Served only from GET /api/apa/fra-data (requireAdmin) instead of being
// bundled into apa's static JS chunk — see
// .scratch/full-repo-review/issues/08-apa-data-exposed-in-public-bundle.md.
// Moved verbatim from artifacts/apa/src/data/{presetLocations,catchments}.ts.

export type Catchment = "BU" | "CP" | "KG" | "PJ" | "WK";

export interface PresetLocation {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export const PRESET_LOCATIONS: PresetLocation[] = [
  { id: "yarwood", name: "Yarwood Ave", address: "Yarwood Ave, Singapore", lat: 1.3833, lng: 103.8452 },
  { id: "rifle-range", name: "Rifle Range Road", address: "Rifle Range Rd, Singapore", lat: 1.3307, lng: 103.7816 },
  { id: "craig-road", name: "Craig Road", address: "Craig Rd, Tanjong Pagar", lat: 1.2768, lng: 103.8378 },
  { id: "boon-lay-ave", name: "Boon Lay Ave", address: "Boon Lay Ave, Singapore", lat: 1.3411, lng: 103.7016 },
  { id: "cck-ave1", name: "CCK Ave 1", address: "Choa Chu Kang Ave 1", lat: 1.3840, lng: 103.7470 },
  { id: "yishun-ave7", name: "Yishun Ave 7", address: "Yishun Ave 7, Singapore", lat: 1.4369, lng: 103.8246 },
  { id: "tpe", name: "TPE", address: "Tampines Expressway", lat: 1.3602, lng: 103.9418 },
  { id: "kpe", name: "KPE", address: "Kallang-Paya Lebar Expressway", lat: 1.3138, lng: 103.8825 },
  { id: "ubi-ave1", name: "Ubi Ave 1", address: "Ubi Ave 1, Singapore", lat: 1.3260, lng: 103.8927 },
  { id: "seaview", name: "Seaview", address: "Seaview, Katong", lat: 1.3027, lng: 103.8979 },
  { id: "toa-payoh", name: "Toa Payoh Central", address: "Toa Payoh Central", lat: 1.3329, lng: 103.8490 },
  { id: "clementi-ave3", name: "Clementi Ave 3", address: "Clementi Ave 3, Singapore", lat: 1.3115, lng: 103.7649 },
  { id: "hougang-ave10", name: "Hougang Ave 10", address: "Hougang Ave 10, Singapore", lat: 1.3725, lng: 103.8904 },
  { id: "jurong-east-ave1", name: "Jurong East Ave 1", address: "Jurong East Ave 1", lat: 1.3334, lng: 103.7398 },
  { id: "bedok-north-ave4", name: "Bedok North Ave 4", address: "Bedok North Ave 4", lat: 1.3250, lng: 103.9295 },
  { id: "amk-ave8", name: "Ang Mo Kio Ave 8", address: "Ang Mo Kio Ave 8", lat: 1.3717, lng: 103.8560 },
  { id: "bukit-timah-rd", name: "Bukit Timah Road", address: "Bukit Timah Rd, Singapore", lat: 1.3408, lng: 103.7754 },
  { id: "orchard-rd", name: "Orchard Road", address: "Orchard Rd, Singapore", lat: 1.3041, lng: 103.8322 },
  { id: "punggol-central", name: "Punggol Central", address: "Punggol Central, Singapore", lat: 1.4043, lng: 103.9022 },
  { id: "woodlands-ave12", name: "Woodlands Ave 12", address: "Woodlands Ave 12, Singapore", lat: 1.4394, lng: 103.7865 },
  { id: "tampines-ave7", name: "Tampines Ave 7", address: "Tampines Ave 7, Singapore", lat: 1.3538, lng: 103.9458 },
  { id: "pasir-ris-dr6", name: "Pasir Ris Drive 6", address: "Pasir Ris Dr 6, Singapore", lat: 1.3720, lng: 103.9480 },
  { id: "serangoon-ave3", name: "Serangoon Ave 3", address: "Serangoon Ave 3, Singapore", lat: 1.3570, lng: 103.8697 },
  { id: "bishan-st13", name: "Bishan Street 13", address: "Bishan St 13, Singapore", lat: 1.3504, lng: 103.8480 },
  { id: "queenstown-rd", name: "Queenstown Road", address: "Queenstown Rd, Singapore", lat: 1.2950, lng: 103.8066 },
];

export const CATCHMENT_LABELS: Record<Catchment, string> = {
  BU: "BU – Bukit Timah / S'pore River",
  CP: "CP – Changi / Punggol",
  KG: "KG – Kallang / Geylang",
  PJ: "PJ – Jurong / Pandan",
  WK: "WK – Woodlands / Kranji",
};

export const CATCHMENT_COLORS: Record<Catchment, { fill: string; stroke: string; text: string }> = {
  BU: { fill: "#f97316", stroke: "#c2410c", text: "#9a3412" },
  CP: { fill: "#3b82f6", stroke: "#1d4ed8", text: "#1e3a8a" },
  KG: { fill: "#a855f7", stroke: "#7e22ce", text: "#581c87" },
  PJ: { fill: "#22c55e", stroke: "#15803d", text: "#166534" },
  WK: { fill: "#ef4444", stroke: "#b91c1c", text: "#7f1d1d" },
};

export const LOCATION_CATCHMENT: Record<string, Catchment> = {
  "yarwood":           "BU",
  "rifle-range":       "BU",
  "craig-road":        "BU",
  "boon-lay-ave":      "PJ",
  "cck-ave1":          "PJ",
  "yishun-ave7":       "WK",
  "tpe":               "CP",
  "kpe":               "KG",
  "ubi-ave1":          "KG",
  "seaview":           "KG",
  "toa-payoh":         "BU",
  "clementi-ave3":     "PJ",
  "hougang-ave10":     "CP",
  "jurong-east-ave1":  "PJ",
  "bedok-north-ave4":  "CP",
  "amk-ave8":          "BU",
  "bukit-timah-rd":    "BU",
  "orchard-rd":        "BU",
  "punggol-central":   "CP",
  "woodlands-ave12":   "WK",
  "tampines-ave7":     "CP",
  "pasir-ris-dr6":     "CP",
  "serangoon-ave3":    "KG",
  "bishan-st13":       "BU",
  "queenstown-rd":     "BU",
};

export const FRA_COLOR = {
  fill:   "#06b6d4",
  stroke: "#0e7490",
  text:   "#164e63",
};

export interface FRACluster {
  id: string;
  label: string;
  lat: number;
  lng: number;
  areas: string;
}

export const FRA_CLUSTERS: FRACluster[] = [
  {
    id: "FRA-1",
    label: "APA1-FRA-1",
    lat: 1.283,
    lng: 103.840,
    areas: "Sentosa · Anson Rd · Shenton Way · Bencoolen",
  },
  {
    id: "FRA-2",
    label: "APA1-FRA-2",
    lat: 1.305,
    lng: 103.879,
    areas: "Stadium · Nicoll Hwy · Tanjong Rhu · Tanjong Katong",
  },
  {
    id: "FRA-3",
    label: "APA1-FRA-3",
    lat: 1.336,
    lng: 103.849,
    areas: "Bukit Timah · PIE/Kallang Bahru · Upper Thomson",
  },
  {
    id: "FRA-4",
    label: "APA1-FRA-4",
    lat: 1.333,
    lng: 103.911,
    areas: "Upper Paya Lebar · Eastwood Rd",
  },
];

export const FLOOD_DOTS: [number, number][] = [
  [1.327, 103.810],
  [1.329, 103.813],
  [1.332, 103.815],
  [1.334, 103.809],
  [1.326, 103.807],

  [1.320, 103.849],
  [1.323, 103.854],
  [1.326, 103.852],
  [1.329, 103.857],
  [1.319, 103.846],
  [1.322, 103.860],

  [1.344, 103.833],
  [1.347, 103.837],
  [1.350, 103.840],
  [1.353, 103.843],
  [1.355, 103.838],
  [1.345, 103.842],

  [1.343, 103.876],
  [1.347, 103.880],
  [1.350, 103.883],
  [1.353, 103.887],
  [1.355, 103.889],
  [1.344, 103.882],

  [1.299, 103.862],
  [1.302, 103.866],
  [1.305, 103.869],
  [1.308, 103.873],
  [1.310, 103.877],
  [1.298, 103.868],
  [1.304, 103.861],

  [1.299, 103.841],
  [1.301, 103.845],
  [1.303, 103.848],
  [1.305, 103.850],
  [1.298, 103.847],

  [1.285, 103.847],
  [1.283, 103.849],
  [1.281, 103.851],
  [1.279, 103.848],
  [1.278, 103.852],
  [1.284, 103.853],

  [1.278, 103.842],
  [1.276, 103.845],
  [1.279, 103.840],

  [1.274, 103.816],
  [1.276, 103.820],
  [1.278, 103.823],
  [1.273, 103.821],

  [1.296, 103.882],
  [1.297, 103.886],
  [1.298, 103.880],
  [1.299, 103.889],
  [1.300, 103.884],
  [1.301, 103.892],
  [1.302, 103.888],
  [1.303, 103.895],
  [1.304, 103.882],
  [1.305, 103.898],
  [1.306, 103.886],
  [1.307, 103.891],
  [1.308, 103.895],
  [1.309, 103.899],
  [1.310, 103.886],
  [1.311, 103.903],
  [1.312, 103.892],
  [1.313, 103.897],
  [1.314, 103.903],
  [1.315, 103.888],
  [1.316, 103.908],
  [1.317, 103.894],
  [1.318, 103.901],
  [1.304, 103.906],
  [1.306, 103.878],
  [1.300, 103.896],
  [1.302, 103.903],
  [1.308, 103.880],

  [1.301, 103.863],
  [1.303, 103.868],
  [1.304, 103.873],
  [1.306, 103.877],
  [1.307, 103.881],
  [1.302, 103.878],
  [1.305, 103.864],

  [1.315, 103.934],
  [1.317, 103.938],
  [1.319, 103.942],
  [1.316, 103.946],
  [1.321, 103.936],
  [1.313, 103.940],
];
