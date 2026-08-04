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

export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
