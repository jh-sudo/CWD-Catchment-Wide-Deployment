import { Router } from "express";
import { readFileSync } from "fs";
import { join } from "path";
import { getLightningSectorStatus } from "../lightning-cat.js";

const router = Router();

let featuresCache: unknown = null;
function getFeatures() {
  if (!featuresCache) {
    const p = join(__dirname, "../data/lightning_features.json");
    featuresCache = JSON.parse(readFileSync(p, "utf8"));
  }
  return featuresCache;
}

router.get("/lightning/sectors", (_req, res) => {
  try {
    res.json({ sectors: getLightningSectorStatus(), updatedAt: new Date().toISOString() });
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
  #selection-box{min-width:190px;max-width:280px}
  #selection-title{font-size:12px;font-weight:700;color:var(--fg)}
  #selection-summary{font-size:10px;color:var(--muted);margin-top:2px;line-height:1.35}
  #clear-sectors{margin-top:3px;border:0;background:none;color:#60a5fa;font-size:10px;
    cursor:pointer;padding:0;text-decoration:underline}
  #push-btn{padding:8px 16px;border-radius:8px;border:none;font-size:13px;font-weight:700;
    cursor:pointer;background:#3b82f6;color:#fff;white-space:nowrap}
  #push-btn.on{background:var(--card);color:var(--fg);border:1px solid var(--border)}
  #push-label{font-size:11px;color:var(--muted);max-width:220px;line-height:1.4}
  @media(max-width:700px){
    #subscribe-bar{width:calc(100% - 24px);flex-wrap:wrap;justify-content:center}
    #selection-box{flex:1;max-width:none;min-width:180px}
  }
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

<div id="subscribe-bar">
  <div id="selection-box">
    <div id="selection-title">Tap zones on the map</div>
    <div id="selection-summary">No zones selected — alerts for all sectors</div>
    <button id="clear-sectors" type="button" onclick="clearSectorSelection()" style="display:none">Clear selection</button>
  </div>
  <button id="push-btn" onclick="togglePush()">🔔 Subscribe to CAT 1</button>
  <div id="push-label">Select one or more zones, then subscribe.</div>
</div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
// ── Theme ─────────────────────────────────────────────────────────────────────
var TILE_DARK  = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
var TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
var TILE_ATTR  = '&copy; <a href="https://carto.com">CARTO</a>';
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
        var isSelected = selectedLightningSectors.indexOf(feat.name) >= 0;
        var poly = L.polygon(latlngs, {
          fillColor: c.fill,
          fillOpacity: isSelected ? Math.max(c.fillOpacity, 0.52) : c.fillOpacity,
          color: isSelected ? '#38bdf8' : c.stroke,
          weight: isSelected ? 4 : 1.2,
          opacity: 0.85,
          // Tap a zone to only be alerted for that sector.
          // .scratch/replit-resync-2026-09-21/issues/24.
          interactive: true,
        }).addTo(map);
        poly.bindTooltip(
          'Sector ' + feat.name + ' — ' + (LIGHTNING_SECTOR_NAMES[feat.name] || feat.name) +
          '<br><b>' + (isSelected ? 'Selected for alerts' : 'Tap to select') + '</b>'
        );
        poly.on('click', function(e) {
          L.DomEvent.stopPropagation(e);
          toggleSectorSelection(feat.name);
        });
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
  } else {
    clearLightningLayers();
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
// Per-sector CAT1 alert selection — tap a zone on the map to only be
// notified for that sector instead of all of them. Empty means all sectors.
// .scratch/replit-resync-2026-09-21/issues/24.
var selectedLightningSectors = [];
try {
  selectedLightningSectors = JSON.parse(localStorage.getItem('lightning-alert-sectors') || '[]');
  if (!Array.isArray(selectedLightningSectors)) selectedLightningSectors = [];
} catch(e) { selectedLightningSectors = []; }

var LIGHTNING_SECTOR_NAMES = {
  '1N':'Tuas / Pioneer','1S':'Tuas','L1':'Tengah Reservoir / Pasir Laba',
  'L2':'Poyan Reservoir','L3':'Murai Reservoir','L4':'Sarimbun / Lim Chu Kang',
  '02':'Jurong West / Tengah','3S':'Choa Chu Kang','3N':'Kranji / Lim Chu Kang',
  '04':'Sungei Buloh / Woodlands West','05':'Bukit Panjang','06':'Mandai / Woodlands',
  '07':'Bukit Timah / Dairy Farm','8N':'Jurong Lake / Jurong East',
  '8S':'Jurong Island / Tuas South','09':'Southern Islands / Sentosa',
  '10N':'Woodlands / Mandai North','10S':'Upper Seletar / Mandai',
  '11W':'Sembawang / Woodlands East','11E':'Yishun / Sembawang',
  '12':'Bishan / Upper Thomson','13N':'Bukit Panjang East / Zhenghua',
  '13S':'Buona Vista / Holland','14':'Queenstown / Redhill','15':'Tampines / Bedok',
  '16N':'Sengkang / Punggol','16S':'Serangoon / Hougang','17':'Punggol North Coast',
  '18W':'Pasir Ris / Tampines East','18E':'Pasir Ris / Changi Village',
  '19N':'Pulau Ubin / NE Waters','19S':'Changi / Ubin South'
};

function updateSelectionSummary() {
  var summary = document.getElementById('selection-summary');
  var clear = document.getElementById('clear-sectors');
  if (!summary || !clear) return;
  if (!selectedLightningSectors.length) {
    summary.textContent = 'No zones selected — alerts for all sectors';
    clear.style.display = 'none';
  } else {
    summary.textContent = selectedLightningSectors.map(function(code){ return 'Sector ' + code; }).join(', ');
    clear.style.display = 'inline-block';
  }
}

async function saveSectorPreference() {
  localStorage.setItem('lightning-alert-sectors', JSON.stringify(selectedLightningSectors));
  updateSelectionSummary();
  if (!SW_REG) return;
  var existing = await SW_REG.pushManager.getSubscription();
  if (existing) {
    var response = await fetch('/api/push/subscribe', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        subscription:existing,
        type:'crew',
        lightningSectors:selectedLightningSectors
      })
    });
    if (response.ok) updatePushBtn();
  }
}

async function toggleSectorSelection(code) {
  var index = selectedLightningSectors.indexOf(code);
  if (index >= 0) selectedLightningSectors.splice(index, 1);
  else selectedLightningSectors.push(code);
  selectedLightningSectors.sort();
  await saveSectorPreference();
  loadLightningSectors();
}

async function clearSectorSelection() {
  selectedLightningSectors = [];
  await saveSectorPreference();
  loadLightningSectors();
}

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
    lbl.textContent = selectedLightningSectors.length
      ? 'Subscribed only to ' + selectedLightningSectors.map(function(code){ return 'Sector ' + code; }).join(', ') + '.'
      : 'Subscribed to all CAT 1 sectors.';
  } else {
    btn.textContent = '🔔 Subscribe to CAT 1';
    btn.className = '';
    lbl.textContent = selectedLightningSectors.length
      ? 'Subscribe only to ' + selectedLightningSectors.map(function(code){ return 'Sector ' + code; }).join(', ') + '.'
      : 'Subscribe for alerts in all CAT 1 sectors.';
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
      var response = await fetch('/api/push/subscribe', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          subscription: sub,
          type: 'crew',
          lightningSectors: selectedLightningSectors
        })
      });
      if (!response.ok) throw new Error('Unable to save CAT 1 subscription');
      pushState = 'on';
    }
    updatePushBtn();
  } catch(e) {
    document.getElementById('push-label').textContent = 'Something went wrong — please try again.';
  }
  btn.disabled = false;
}

// Lightning display now shown by default on page load, instead of requiring
// a manual "Lightning" button click first. .scratch/replit-resync-2026-09-21/issues/24.
toggleLightning();
updateSelectionSummary();
initPush();
</script>
</body>
</html>`);
});

export { router as lightningRouter, publicRouter as lightningPublicRouter };
