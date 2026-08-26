import { Router } from "express";
import { readFileSync } from "fs";
import { join } from "path";

const router = Router();

let featuresCache: unknown = null;
function getFeatures() {
  if (!featuresCache) {
    const p = join(__dirname, "../data/lightning_features.json");
    featuresCache = JSON.parse(readFileSync(p, "utf8"));
  }
  return featuresCache;
}

router.get("/lightning/sectors", async (_req, res) => {
  try {
    const r = await fetch("https://api.andewmole.com/cat1/getWeatherInfo", {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "FleetCoordinator/1.0" },
    });
    if (!r.ok) { res.status(502).json({ error: "Upstream unavailable" }); return; }
    const data = await r.json() as any;
    const armysectors = data?.data?.armysectors ?? {};
    const sectors = Object.values(armysectors).map((s: any) => ({
      name: (s.sector?.name ?? "Unknown").replace(/^Sector /, ""),
      lat: s.sector?.latitude as number,
      lng: s.sector?.longitude as number,
      cat: String(s.weather?.CAT ?? "3"),
      catStartOn: s.weather?.cat_start_on ?? null,
      catEndOn: s.weather?.cat_end_on ?? null,
    }));
    res.json({ sectors, updatedAt: new Date().toISOString() });
  } catch {
    res.status(502).json({ error: "Lightning data unavailable" });
  }
});

router.get("/lightning/features", (_req, res) => {
  try {
    res.json(getFeatures());
  } catch {
    res.status(500).json({ error: "Features unavailable" });
  }
});

// ── Public router (mounted at root, not /api) ─────────────────────────────────
const publicRouter = Router();

publicRouter.get("/sw-lightning.js", (_req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Service-Worker-Allowed", "/lightning");
  res.send(`
self.addEventListener('push', function(event) {
  var data = {};
  try { data = event.data.json(); } catch(e) {}
  var title = data.title || '⚡ Lightning Alert';
  var options = {
    body: data.body || 'CAT 1 lightning is active in your area.',
    tag: data.tag || 'lightning-cat1',
    requireInteraction: true,
    data: { url: data.url || '/lightning' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/lightning';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      for (var c of list) { if (c.url.includes('/lightning') && 'focus' in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
`);
});

publicRouter.get("/lightning", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(/* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Lightning & Rain — Singapore</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
  /* ── Theme tokens ─────────────────────────────────────────── */
  :root{
    --bg:#0f172a;--card:#1e293b;--border:#334155;--fg:#f1f5f9;
    --muted:#94a3b8;--shadow:rgba(0,0,0,.5);--map-bg:#0f172a;
    --ts-bg:rgba(15,23,42,.85);--ts-border:#334155;--ts-fg:#e2e8f0;
  }
  [data-theme="light"]{
    --bg:#f8fafc;--card:#ffffff;--border:#cbd5e1;--fg:#0f172a;
    --muted:#64748b;--shadow:rgba(0,0,0,.15);--map-bg:#e2e8f0;
    --ts-bg:rgba(255,255,255,.9);--ts-border:#cbd5e1;--ts-fg:#0f172a;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body,#map{width:100%;height:100%;background:var(--map-bg)}
  /* ── Controls bar ─────────────────────────────────────────── */
  #controls{position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:1000;
    display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;pointer-events:auto}
  .ctl-btn{display:flex;align-items:center;gap:6px;padding:7px 13px;border-radius:10px;
    border:1px solid var(--border);background:var(--card);color:var(--fg);font-size:12px;font-weight:700;
    cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s,color .15s;
    font-family:system-ui,-apple-system,sans-serif;box-shadow:0 2px 8px var(--shadow)}
  .ctl-btn .badge{font-size:10px;font-weight:400;color:var(--muted)}
  .ctl-btn.on{background:#0ea5e9;border-color:#0ea5e9;color:#fff}
  .ctl-btn.on .badge{color:rgba(255,255,255,.75)}
  .ctl-btn.cat1{background:#dc2626;border-color:#dc2626;color:#fff}
  .ctl-btn.cat2{background:#ca8a04;border-color:#ca8a04;color:#fff}
  .ctl-btn.cat3{background:#16a34a;border-color:#16a34a;color:#fff}
  /* ── Status banner ────────────────────────────────────────── */
  #cat-banner{position:absolute;top:58px;left:50%;transform:translateX(-50%);z-index:999;
    display:none;padding:6px 16px;border-radius:8px;font-size:12px;font-weight:700;
    font-family:system-ui,-apple-system,sans-serif;white-space:nowrap;
    box-shadow:0 2px 8px var(--shadow);pointer-events:none}
  #cat-banner.cat1{background:#dc2626;color:#fff;display:block}
  #cat-banner.cat2{background:#ca8a04;color:#fff;display:block}
  /* ── Radar timestamp ──────────────────────────────────────── */
  #radar-ts{position:absolute;bottom:80px;left:50%;transform:translateX(-50%);z-index:999;
    background:var(--ts-bg);color:var(--ts-fg);font-size:11px;font-weight:600;
    padding:5px 12px;border-radius:8px;display:none;pointer-events:none;
    font-family:system-ui,-apple-system,sans-serif;border:1px solid var(--ts-border)}
  /* ── Push subscribe bar ───────────────────────────────────── */
  #subscribe-bar{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);z-index:1000;
    display:none;align-items:center;gap:10px;background:var(--card);border:1px solid var(--border);
    border-radius:12px;padding:10px 16px;box-shadow:0 4px 16px var(--shadow);
    font-family:system-ui,-apple-system,sans-serif}
  #push-btn{padding:8px 16px;border-radius:8px;border:none;font-size:13px;font-weight:700;
    cursor:pointer;background:#3b82f6;color:#fff;white-space:nowrap}
  #push-btn.on{background:var(--card);color:var(--fg);border:1px solid var(--border)}
  #push-label{font-size:11px;color:var(--muted);max-width:220px;line-height:1.4}
  /* ── Leaflet overrides ────────────────────────────────────── */
  .leaflet-container{background:var(--map-bg)}
  .leaflet-control-zoom{border:1px solid var(--border)!important;box-shadow:none!important}
  .leaflet-control-zoom a{background:var(--card)!important;color:var(--fg)!important;border-color:var(--border)!important}
  .leaflet-control-attribution{background:var(--card)!important;color:var(--muted)!important}
  .leaflet-control-attribution a{color:var(--muted)!important}
  .radar-img{mix-blend-mode:screen}
  [data-theme="light"] .radar-img{mix-blend-mode:multiply}
  .lightning-label{background:transparent;border:none;box-shadow:none;color:#fff;
    font-size:10px;font-weight:700;text-shadow:0 1px 3px #000,0 0 6px #000;pointer-events:none}
  [data-theme="light"] .lightning-label{color:#1e293b;text-shadow:0 1px 2px rgba(255,255,255,.8)}
  #regional-lightning-status{position:absolute;top:98px;left:50%;transform:translateX(-50%);z-index:999;
    display:none;padding:5px 10px;border-radius:8px;border:1px solid #b45309;background:rgba(120,53,15,.9);
    color:#ffedd5;font-size:11px;font-weight:700;font-family:system-ui,-apple-system,sans-serif;
    white-space:nowrap;box-shadow:0 2px 8px var(--shadow);pointer-events:none}
  #regional-lightning-status.on{display:block}
  .regional-lightning-pin{background:transparent;border:0}
  .regional-lightning-pin span{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;
    background:#f97316;color:#fff;border:2px solid #fff;font:700 16px/1 system-ui,-apple-system,sans-serif;
    box-shadow:0 0 0 4px rgba(249,115,22,.28),0 2px 8px rgba(0,0,0,.48)}
  [data-theme="light"] .regional-lightning-pin span{border-color:#fff7ed}
</style>
</head>
<body>

<div id="map"></div>

<div id="controls">
  <button class="ctl-btn" id="rain-btn" onclick="toggleRain()">
    🌧 Rain Radar <span class="badge" id="rain-badge">OFF</span>
  </button>
  <button class="ctl-btn" id="lightning-btn" onclick="toggleLightning()">
    ⚡ Lightning <span class="badge" id="lightning-badge">OFF</span>
  </button>
  <button class="ctl-btn" id="theme-btn" onclick="toggleTheme()" title="Switch dark / light mode">
    <span id="theme-icon">☀️</span> <span id="theme-label">Light</span>
  </button>
</div>

<div id="cat-banner"></div>
<div id="radar-ts" id="radar-ts"></div>
<div id="regional-lightning-status" aria-live="polite"></div>

<div id="subscribe-bar">
  <button id="push-btn" onclick="togglePush()">🔔 Subscribe to CAT 1</button>
  <div id="push-label">Get a push alert every 5 min when CAT 1 is active.</div>
</div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
// ── Theme ─────────────────────────────────────────────────────────────────────
var TILE_DARK  = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
var TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
var TILE_ATTR  = '&copy; <a href="https://carto.com">CARTO</a> | nearby strikes: <a href="https://www.blitzortung.org/">Blitzortung.org</a> contributors';
var isDark = localStorage.getItem('lgtn-theme') !== 'light';

function applyTheme(dark) {
  isDark = dark;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  localStorage.setItem('lgtn-theme', dark ? 'dark' : 'light');
  var icon  = document.getElementById('theme-icon');
  var label = document.getElementById('theme-label');
  if (icon)  icon.textContent  = dark ? '☀️' : '🌙';
  if (label) label.textContent = dark ? 'Light' : 'Dark';
  if (tileLayer) {
    tileLayer.setUrl(dark ? TILE_DARK : TILE_LIGHT);
  }
}

function toggleTheme() { applyTheme(!isDark); }

// ── Map ───────────────────────────────────────────────────────────────────────
var map = L.map('map', {
  center: [1.3521, 103.8198],
  zoom: 12,
  zoomControl: true,
  attributionControl: true,
});

var tileLayer = L.tileLayer(isDark ? TILE_DARK : TILE_LIGHT, {
  attribution: TILE_ATTR,
  subdomains: 'abcd',
  maxZoom: 19,
}).addTo(map);

// Apply saved theme immediately (sets data-theme + button label)
applyTheme(isDark);

// ── Radar ─────────────────────────────────────────────────────────────────────
var RADAR_BOUNDS   = [[1.145, 103.565], [1.4572, 104.130]];
var RADAR_BOUNDS_W = [[-0.754, 101.908], [3.558, 106.221]];
var RADAR_OPACITY   = 0.7;
var RADAR_OPACITY_W = 0.35;
var RADAR_REFRESH   = 5 * 60 * 1000;

var radarOn = false;
var radarFrames = [];
var radarOverlays = [];
var radarWideOverlays = [];
var radarIdx = 0;
var radarAnimTimer = null;
var radarRefreshTimer = null;
var radarLoading = false;

function radarShowFrame(idx) {
  radarOverlays.forEach(function(o, i) {
    if (i === idx) o.addTo(map); else { try { map.removeLayer(o); } catch(e){} }
  });
  radarWideOverlays.forEach(function(o, i) {
    if (i === idx) o.addTo(map); else { try { map.removeLayer(o); } catch(e){} }
  });
  var ts = document.getElementById('radar-ts');
  if (radarFrames[idx]) {
    ts.textContent = '🌧 ' + radarFrames[idx].label;
    ts.style.display = 'block';
  }
}

function radarClear() {
  radarOverlays.forEach(function(o){ try { map.removeLayer(o); } catch(e){} });
  radarWideOverlays.forEach(function(o){ try { map.removeLayer(o); } catch(e){} });
  radarOverlays = []; radarWideOverlays = [];
}

async function loadRadarFrames() {
  if (radarLoading) return;
  radarLoading = true;
  try {
    var res = await fetch('/api/rain-radar/frames?t=' + Date.now());
    if (!res.ok) { radarLoading = false; return; }
    var data = await res.json();
    var frames = (data.frames || []).slice().reverse(); // oldest→newest
    if (!frames.length) { radarLoading = false; return; }

    if (radarAnimTimer) { clearInterval(radarAnimTimer); radarAnimTimer = null; }
    radarClear();

    radarFrames = frames;
    radarOverlays = frames.map(function(f) {
      return L.imageOverlay('/api/rain-radar?at=' + f.at, RADAR_BOUNDS,
        { opacity: RADAR_OPACITY, interactive: false, className: 'radar-img' });
    });
    radarWideOverlays = frames.map(function(f) {
      return L.imageOverlay('/api/rain-radar-wide?at=' + f.at, RADAR_BOUNDS_W,
        { opacity: RADAR_OPACITY_W, interactive: false, className: 'radar-img' });
    });

    radarIdx = 0;
    radarShowFrame(radarIdx);
    radarAnimTimer = setInterval(function() {
      radarIdx = (radarIdx + 1) % radarOverlays.length;
      radarShowFrame(radarIdx);
    }, 700);
  } catch(e) {}
  radarLoading = false;
}

function toggleRain() {
  radarOn = !radarOn;
  var btn = document.getElementById('rain-btn');
  var badge = document.getElementById('rain-badge');
  var ts = document.getElementById('radar-ts');
  if (radarOn) {
    btn.className = 'ctl-btn on';
    badge.textContent = 'ON';
    loadRadarFrames();
    radarRefreshTimer = setInterval(loadRadarFrames, RADAR_REFRESH);
  } else {
    btn.className = 'ctl-btn';
    badge.textContent = 'OFF';
    if (radarAnimTimer) { clearInterval(radarAnimTimer); radarAnimTimer = null; }
    if (radarRefreshTimer) { clearInterval(radarRefreshTimer); radarRefreshTimer = null; }
    radarClear();
    ts.style.display = 'none';
  }
}

// ── Lightning ─────────────────────────────────────────────────────────────────
var lightningOn = false;
var lightningLayers = [];
var lightningTimer2 = null;
var lightningFeaturesCache = null;
var regionalLightningLayers = [];
var regionalLightningWs = null;
var regionalLightningWsIndex = 0;
var regionalLightningReconnectTimer = null;
var regionalLightningPruneTimer = null;

// Nearby external strikes use the community Blitzortung live stream. The
// rectangle is deliberately a conservative Singapore exclusion zone: points
// within it are never shown by this layer, even if they are over nearby water.
// The 30 km distance is measured from the nearest point on that exclusion zone,
// so Johor and the northern Indonesian islands are included without mixing in
// Singapore's own lightning data.
var REGIONAL_LIGHTNING_WS = [
  'wss://ws1.blitzortung.org/',
  'wss://ws7.blitzortung.org/',
  'wss://ws8.blitzortung.org/',
];
var SINGAPORE_EXCLUSION = { south: 1.15, north: 1.48, west: 103.55, east: 104.10 };
var REGIONAL_LIGHTNING_RADIUS_KM = 30;
var REGIONAL_LIGHTNING_MAX_AGE_MS = 15 * 60 * 1000;

var CAT_COLORS = {
  '1': { fill: '#dc2626', stroke: '#991b1b', fillOpacity: 0.40 },
  '2': { fill: '#ca8a04', stroke: '#92400e', fillOpacity: 0.32 },
  '3': { fill: '#16a34a', stroke: '#14532d', fillOpacity: 0.16 },
};
var CAT_BTN_CLASS = { '1': 'cat1', '2': 'cat2', '3': 'cat3' };

async function getLightningFeatures() {
  if (lightningFeaturesCache) return lightningFeaturesCache;
  var res = await fetch('/api/lightning/features');
  lightningFeaturesCache = await res.json();
  return lightningFeaturesCache;
}

function clearLightningLayers() {
  lightningLayers.forEach(function(l){ try { map.removeLayer(l); } catch(e){} });
  lightningLayers = [];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function haversineKm(lat1, lng1, lat2, lng2) {
  var toRad = Math.PI / 180;
  var dLat = (lat2 - lat1) * toRad;
  var dLng = (lng2 - lng1) * toRad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearbyExternalDistanceKm(lat, lng) {
  if (
    lat >= SINGAPORE_EXCLUSION.south && lat <= SINGAPORE_EXCLUSION.north &&
    lng >= SINGAPORE_EXCLUSION.west && lng <= SINGAPORE_EXCLUSION.east
  ) return null;

  var nearestLat = clamp(lat, SINGAPORE_EXCLUSION.south, SINGAPORE_EXCLUSION.north);
  var nearestLng = clamp(lng, SINGAPORE_EXCLUSION.west, SINGAPORE_EXCLUSION.east);
  return haversineKm(lat, lng, nearestLat, nearestLng);
}

function regionalStrikeTime(strike) {
  // Blitzortung provides nanoseconds since Unix epoch. Treat malformed or
  // stale timestamps as untrusted rather than surfacing old alerts.
  var raw = Number(strike && strike.time);
  var timestamp = raw > 1e14 ? Math.floor(raw / 1000000) : raw;
  if (!Number.isFinite(timestamp) || timestamp < Date.now() - REGIONAL_LIGHTNING_MAX_AGE_MS || timestamp > Date.now() + 60000) {
    return null;
  }
  return timestamp;
}

function updateRegionalLightningStatus(text, state) {
  var status = document.getElementById('regional-lightning-status');
  if (!status) return;
  status.textContent = text;
  status.className = state === 'off' ? '' : 'on';
}

function refreshRegionalLightningStatus() {
  if (!lightningOn) return;
  var count = regionalLightningLayers.length;
  updateRegionalLightningStatus(
    count
      ? '⚡ Nearby external: ' + count + ' strike' + (count === 1 ? '' : 's') + ' in the last 15 min'
      : '⚡ Nearby external: watching Malaysia / Indonesia within 30 km',
    'on'
  );
}

function clearRegionalLightningLayers() {
  regionalLightningLayers.forEach(function(record) {
    try { map.removeLayer(record.layer); } catch(e) {}
  });
  regionalLightningLayers = [];
}

function pruneRegionalLightning() {
  var cutoff = Date.now() - REGIONAL_LIGHTNING_MAX_AGE_MS;
  regionalLightningLayers = regionalLightningLayers.filter(function(record) {
    if (record.timestamp >= cutoff) return true;
    try { map.removeLayer(record.layer); } catch(e) {}
    return false;
  });
  refreshRegionalLightningStatus();
}

// Blitzortung sends LZW-compressed JSON frames through its public live stream.
function decodeRegionalLightningFrame(frame) {
  var chars = ('' + frame).split('');
  if (!chars.length) return '';
  var current = chars[0];
  var first = current;
  var output = [current];
  var nextCode = 256;
  var dictionary = {};
  for (var i = 1; i < chars.length; i++) {
    var code = chars[i].charCodeAt(0);
    var entry = code < 256 ? chars[i] : (dictionary[code] ? dictionary[code] : first + current);
    output.push(entry);
    current = entry.charAt(0);
    dictionary[nextCode] = first + current;
    nextCode++;
    first = entry;
  }
  return output.join('');
}

function addNearbyExternalStrike(strike) {
  var lat = Number(strike && strike.lat);
  var lng = Number(strike && strike.lon);
  var timestamp = regionalStrikeTime(strike);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || timestamp === null) return;

  var distance = nearbyExternalDistanceKm(lat, lng);
  if (distance === null || distance > REGIONAL_LIGHTNING_RADIUS_KM) return;

  var duplicate = regionalLightningLayers.some(function(record) {
    return Math.abs(record.lat - lat) < 0.0001 && Math.abs(record.lng - lng) < 0.0001 &&
      Math.abs(record.timestamp - timestamp) < 1000;
  });
  if (duplicate) return;

  var observedAt = new Date(timestamp).toLocaleTimeString('en-SG', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  var marker = L.marker([lat, lng], {
    icon: L.divIcon({
      className: 'regional-lightning-pin',
      html: '<span>ϟ</span>',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    }),
    title: 'Nearby external lightning strike',
    keyboard: true,
  }).bindTooltip(
    'Nearby external lightning<br>' +
    Math.round(distance) + ' km from Singapore • ' + observedAt + ' SGT',
    { direction: 'top', offset: [0, -12], opacity: 0.95 }
  ).addTo(map);

  regionalLightningLayers.push({ lat: lat, lng: lng, timestamp: timestamp, layer: marker });
  pruneRegionalLightning();
}

function connectRegionalLightningStream() {
  if (!lightningOn || regionalLightningWs) return;
  updateRegionalLightningStatus('⚡ Nearby external: connecting to live strike feed…', 'on');
  var url = REGIONAL_LIGHTNING_WS[regionalLightningWsIndex % REGIONAL_LIGHTNING_WS.length];
  try {
    var ws = new WebSocket(url);
    regionalLightningWs = ws;
    ws.onopen = function() {
      if (ws !== regionalLightningWs) return;
      ws.send(JSON.stringify({ a: 111 }));
      refreshRegionalLightningStatus();
    };
    ws.onmessage = function(event) {
      try {
        addNearbyExternalStrike(JSON.parse(decodeRegionalLightningFrame(event.data)));
      } catch(e) {
        // The stream occasionally sends non-strike frames. Ignore them.
      }
    };
    ws.onerror = function() {
      try { ws.close(); } catch(e) {}
    };
    ws.onclose = function() {
      if (ws !== regionalLightningWs) return;
      regionalLightningWs = null;
      if (!lightningOn) return;
      regionalLightningWsIndex++;
      updateRegionalLightningStatus('⚡ Nearby external: reconnecting to live strike feed…', 'on');
      clearTimeout(regionalLightningReconnectTimer);
      regionalLightningReconnectTimer = setTimeout(connectRegionalLightningStream, 3000);
    };
  } catch(e) {
    regionalLightningWs = null;
    regionalLightningWsIndex++;
    if (lightningOn) {
      clearTimeout(regionalLightningReconnectTimer);
      regionalLightningReconnectTimer = setTimeout(connectRegionalLightningStream, 3000);
    }
  }
}

function startRegionalLightningStream() {
  clearTimeout(regionalLightningReconnectTimer);
  pruneRegionalLightning();
  connectRegionalLightningStream();
  if (!regionalLightningPruneTimer) {
    regionalLightningPruneTimer = setInterval(pruneRegionalLightning, 30000);
  }
}

function stopRegionalLightningStream() {
  clearTimeout(regionalLightningReconnectTimer);
  regionalLightningReconnectTimer = null;
  if (regionalLightningPruneTimer) {
    clearInterval(regionalLightningPruneTimer);
    regionalLightningPruneTimer = null;
  }
  var ws = regionalLightningWs;
  regionalLightningWs = null;
  if (ws) { try { ws.close(); } catch(e) {} }
  clearRegionalLightningLayers();
  updateRegionalLightningStatus('', 'off');
}

async function loadLightningSectors() {
  try {
    var sRes = await fetch('/api/lightning/sectors');
    var sData = await sRes.json();
    var sectors = sData.sectors || [];
    var features = await getLightningFeatures();

    var catMap = {};
    sectors.forEach(function(s){ catMap[s.name] = s.cat || '3'; });

    clearLightningLayers();

    var worst = '3';
    features.forEach(function(feat) {
      var cat = catMap[feat.name] || '3';
      if (parseInt(cat) < parseInt(worst)) worst = cat;
      var c = CAT_COLORS[cat] || CAT_COLORS['3'];

      (feat.polygons || []).forEach(function(rings) {
        // rings[0] = outer ring, rings[1..] = holes; each ring is [[lat,lng],...]
        var latlngs = rings.map(function(ring){ return ring.map(function(p){ return [p[0], p[1]]; }); });
        var poly = L.polygon(latlngs, {
          fillColor: c.fill,
          fillOpacity: c.fillOpacity,
          color: c.stroke,
          weight: 1.2,
          opacity: 0.85,
          interactive: false,
        }).addTo(map);
        lightningLayers.push(poly);
      });

      // Sector label
      var sec = sectors.find(function(s){ return s.name === feat.name; });
      if (sec) {
        var label = L.marker([sec.lat, sec.lng], {
          icon: L.divIcon({
            className: 'lightning-label',
            html: '<span>' + feat.name + '</span>',
            iconSize: null,
            iconAnchor: [0, 0],
          }),
          interactive: false,
          zIndexOffset: 100,
        }).addTo(map);
        lightningLayers.push(label);
      }
    });

    // Update button
    var btn = document.getElementById('lightning-btn');
    var badge = document.getElementById('lightning-badge');
    var banner = document.getElementById('cat-banner');
    if (lightningOn) {
      btn.className = 'ctl-btn ' + (CAT_BTN_CLASS[worst] || 'cat3');
      badge.textContent = 'CAT ' + worst;
      badge.style.color = 'rgba(255,255,255,.75)';
    }
    banner.className = worst === '1' ? 'cat1' : worst === '2' ? 'cat2' : '';
    banner.textContent = worst === '1' ? '⚡ CAT 1 ACTIVE — Seek shelter immediately'
      : worst === '2' ? '⚠️ CAT 2 — Monitor conditions' : '';
  } catch(e) {
    console.warn('Lightning load failed', e);
  }
}

function toggleLightning() {
  lightningOn = !lightningOn;
  var btn = document.getElementById('lightning-btn');
  var badge = document.getElementById('lightning-badge');
  var banner = document.getElementById('cat-banner');
  if (lightningOn) {
    loadLightningSectors();
    lightningTimer2 = setInterval(loadLightningSectors, 5 * 60 * 1000);
    startRegionalLightningStream();
  } else {
    clearLightningLayers();
    stopRegionalLightningStream();
    if (lightningTimer2) { clearInterval(lightningTimer2); lightningTimer2 = null; }
    btn.className = 'ctl-btn';
    badge.textContent = 'OFF';
    badge.style.color = '';
    banner.className = '';
    banner.textContent = '';
  }
}

// ── Push notifications ────────────────────────────────────────────────────────
var VAPID_KEY = null;
var SW_REG = null;
var pushState = 'off';

function urlBase64ToUint8Array(b) {
  var p = b.replace(/-/g,'+').replace(/_/g,'/').padEnd(b.length+(4-b.length%4)%4,'=');
  return Uint8Array.from([...atob(p)].map(function(c){ return c.charCodeAt(0); }));
}

function showBar() { document.getElementById('subscribe-bar').style.display = 'flex'; }

async function initPush() {
  var btn = document.getElementById('push-btn');
  var lbl = document.getElementById('push-label');

  // Service workers are blocked inside iframes — show a "open in tab" link instead
  if (window !== window.top) {
    btn.textContent = '🔔 Open for alerts';
    btn.onclick = function() { window.open(window.location.href, '_blank'); };
    lbl.textContent = 'Tap to open in a new tab, then subscribe for CAT 1 alerts.';
    showBar();
    return;
  }

  // Push not supported on this device/browser — silently skip, no error shown
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  try {
    SW_REG = await navigator.serviceWorker.register('/sw-lightning.js', { scope: '/lightning' });
    var existing = await SW_REG.pushManager.getSubscription();
    if (existing) { pushState = 'on'; }
    var vr = await fetch('/api/push/vapid-key');
    if (vr.ok) {
      VAPID_KEY = (await vr.json()).publicKey;
      updatePushBtn();
      showBar(); // only reveal the bar once everything is confirmed working
    }
  } catch(e) { console.error('Push init', e); }
}

function updatePushBtn() {
  var btn = document.getElementById('push-btn');
  var lbl = document.getElementById('push-label');
  if (pushState === 'on') {
    btn.textContent = '🔕 Unsubscribe';
    btn.className = 'on';
    lbl.textContent = 'You will be notified every 5 min while CAT 1 is active.';
  } else {
    btn.textContent = '🔔 Subscribe to CAT 1';
    btn.className = '';
    lbl.textContent = 'Get a push alert every 5 min when CAT 1 is active.';
  }
}

async function togglePush() {
  var btn = document.getElementById('push-btn');
  btn.disabled = true;
  try {
    if (!SW_REG) SW_REG = await navigator.serviceWorker.register('/sw-lightning.js', { scope: '/lightning' });
    var existing = await SW_REG.pushManager.getSubscription();
    if (pushState === 'on' || existing) {
      if (existing) {
        await fetch('/api/push/unsubscribe', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ endpoint: existing.endpoint }) });
        await existing.unsubscribe();
      }
      pushState = 'off';
    } else {
      var perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        document.getElementById('push-label').textContent = 'Blocked — enable notifications in browser settings.';
        btn.disabled = false; return;
      }
      if (!VAPID_KEY) VAPID_KEY = (await (await fetch('/api/push/vapid-key')).json()).publicKey;
      var sub = await SW_REG.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_KEY) });
      await fetch('/api/push/subscribe', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ subscription: sub, type: 'crew' }) });
      pushState = 'on';
    }
    updatePushBtn();
  } catch(e) {
    document.getElementById('push-label').textContent = 'Something went wrong — please try again.';
  }
  btn.disabled = false;
}

initPush();
</script>
</body>
</html>`);
});

export { router as lightningRouter, publicRouter as lightningPublicRouter };
