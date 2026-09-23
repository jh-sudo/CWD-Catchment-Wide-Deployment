import { Router } from "express";
import { requireCrew } from "./auth";
import { jsonForScriptTag } from "../lib/inlineJson";

const router = Router();

// ── Crew service worker (must be served from same origin as the crew page) ─────
// Mirrors /sw-manager.js (see manager.ts) — same push/notificationclick shape,
// just defaulting notifications back to /crew instead of /manager.
router.get("/sw-crew.js", (_req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Service-Worker-Allowed", "/");
  res.send(`
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Flood Commander Dashboard';
  const options = {
    body: data.body || '',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: data.tag || 'crew-push',
    renotify: true,
    data: { url: data.url || '/crew' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/crew';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
    for (var c of list) { if (c.url.includes('/crew') && 'focus' in c) { return c.focus(); } }
    if (clients.openWindow) return clients.openWindow(url);
  }));
});
`);
});

// ── Crew login page ─────────────────────────────────────────────────────────
// Mirrors /manager/login's shape (see auth.ts's LOGIN_HTML) but simpler —
// crew log in with their own officer ID + PIN (see
// POST /api/crew/auth/login), not a username/password. Also mirrors
// manager's MFA challenge/enroll panes (MFA is mandatory for every role now,
// see auth.ts's isMfaEligibleRole) — the /manager/auth/mfa/* endpoints are
// role-agnostic, so crew reuses them directly rather than duplicating them.
router.get("/crew/login", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(/* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Crew Login</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0f1117; color: #f0f2f8;
      min-height: 100dvh; display: flex; align-items: center; justify-content: center;
      padding: 20px;
    }
    .card {
      background: #1a1d27; border: 1px solid #2a2d3a; border-radius: 12px;
      padding: 32px 24px; width: 100%; max-width: 360px;
    }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
    .sub { font-size: 13px; color: #7a7f9a; margin-bottom: 24px; }
    label { display: block; font-size: 13px; color: #7a7f9a; margin-bottom: 5px; }
    input {
      width: 100%; padding: 14px 12px; border-radius: 8px;
      border: 1px solid #2a2d3a; background: #0f1117; color: #f0f2f8;
      font-size: 17px; outline: none; margin-bottom: 16px;
    }
    input:focus { border-color: #4f6ef7; }
    button {
      width: 100%; padding: 14px; border-radius: 8px; border: none;
      background: #4f6ef7; color: #fff; font-size: 16px; font-weight: 600;
      cursor: pointer;
    }
    button:disabled { opacity: 0.6; }
    .err { color: #ef4444; font-size: 13px; margin-bottom: 12px; min-height: 16px; }
    .pane { display: none; }
    .pane.active { display: block; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🚔 Crew Login</h1>
    <div class="sub">Flood Commander Dashboard</div>

    <!-- PIN login pane -->
    <div class="pane active" id="pane-login">
      <div class="err" id="err"></div>
      <form id="f">
        <label for="officerId">Officer ID</label>
        <input id="officerId" autocomplete="username" autocapitalize="off" placeholder="e.g. bu1a" />
        <label for="pin">PIN</label>
        <input id="pin" type="password" autocomplete="current-password" placeholder="••••" />
        <button type="submit" id="btn">Log In</button>
      </form>
    </div>

    <!-- MFA challenge pane — second step when this officer already has MFA enabled -->
    <div class="pane" id="pane-mfa">
      <div class="err" id="mfa-err"></div>
      <p class="sub" style="margin-bottom:16px;">Enter the 6-digit code from your authenticator app.</p>
      <label for="mfa-code">Authentication code</label>
      <input id="mfa-code" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="6" placeholder="123456" />
      <button id="mfa-btn">Verify</button>
    </div>

    <!-- MFA enrollment pane — shown instead of the dashboard when this officer doesn't have MFA set up yet (mandatory) -->
    <div class="pane" id="pane-mfa-enroll">
      <div class="err" id="mfa-enroll-err"></div>
      <p class="sub" style="margin-bottom:14px;">Two-factor authentication is required. Scan this with an authenticator app (Microsoft/Google Authenticator, etc.), or type the setup key below into it.</p>
      <div style="text-align:center;margin-bottom:12px;">
        <img id="mfa-enroll-qr" alt="MFA setup QR code" style="width:180px;height:180px;border-radius:8px;background:#fff;padding:8px;" />
      </div>
      <label style="margin-bottom:4px;">Setup key</label>
      <div id="mfa-enroll-secret" style="font-family:monospace;font-size:13px;letter-spacing:1px;word-break:break-all;background:#0f1117;border:1px solid #2a2d3a;border-radius:7px;padding:9px 11px;margin-bottom:16px;"></div>
      <label for="mfa-enroll-code">Enter the 6-digit code it shows</label>
      <input id="mfa-enroll-code" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="6" placeholder="123456" />
      <button id="mfa-enroll-btn">Confirm &amp; Continue</button>
    </div>
  </div>
  <script>
    function showPane(name) {
      document.querySelectorAll('.pane').forEach(function (p) { p.classList.remove('active'); });
      document.getElementById('pane-' + name).classList.add('active');
    }

    var f = document.getElementById('f');
    var err = document.getElementById('err');
    var btn = document.getElementById('btn');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var officerId = document.getElementById('officerId').value.trim();
      var pin = document.getElementById('pin').value.trim();
      if (!officerId || !pin) { err.textContent = 'Enter your officer ID and PIN.'; return; }
      btn.disabled = true; err.textContent = '';
      fetch('/api/crew/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ officerId: officerId, pin: pin }),
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (!res.ok) { err.textContent = res.d.error || 'Login failed'; btn.disabled = false; return; }
          if (res.d.mfaStep === 'challenge') { showPane('mfa'); document.getElementById('mfa-code').focus(); return; }
          if (res.d.mfaStep === 'enroll') { showPane('mfa-enroll'); startMfaEnrollment(); return; }
          window.location.href = '/crew';
        })
        .catch(function () { err.textContent = 'Could not connect. Check your connection.'; btn.disabled = false; });
    });

    function startMfaEnrollment() {
      var eerr = document.getElementById('mfa-enroll-err');
      eerr.textContent = '';
      fetch('/manager/auth/mfa/setup', { method: 'POST' })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (!res.ok) { eerr.textContent = res.d.error || 'Could not start MFA setup.'; return; }
          document.getElementById('mfa-enroll-qr').src = res.d.qrCodeDataUrl;
          document.getElementById('mfa-enroll-secret').textContent = res.d.secret;
        })
        .catch(function () { eerr.textContent = 'Network error — please try again.'; });
    }

    document.getElementById('mfa-enroll-btn').addEventListener('click', function () {
      var ebtn = document.getElementById('mfa-enroll-btn');
      var eerr = document.getElementById('mfa-enroll-err');
      var code = document.getElementById('mfa-enroll-code').value.trim();
      eerr.textContent = '';
      if (!/^[0-9]{6}$/.test(code)) { eerr.textContent = 'Enter the 6-digit code it shows.'; return; }
      ebtn.disabled = true; ebtn.textContent = 'Verifying…';
      fetch('/manager/auth/mfa/verify-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code }) })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (!res.ok) { eerr.textContent = res.d.error || 'Incorrect code.'; return; }
          window.location.href = '/crew';
        })
        .catch(function () { eerr.textContent = 'Network error — please try again.'; })
        .then(function () { ebtn.disabled = false; ebtn.textContent = 'Confirm & Continue'; });
    });

    document.getElementById('mfa-btn').addEventListener('click', function () {
      var mbtn = document.getElementById('mfa-btn');
      var merr = document.getElementById('mfa-err');
      var code = document.getElementById('mfa-code').value.trim();
      merr.textContent = '';
      if (!/^[0-9]{6}$/.test(code)) { merr.textContent = 'Enter the 6-digit code from your authenticator app.'; return; }
      mbtn.disabled = true; mbtn.textContent = 'Verifying…';
      fetch('/manager/auth/mfa/challenge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code }) })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (!res.ok) { merr.textContent = res.d.error || 'Verification failed.'; return; }
          window.location.href = '/crew';
        })
        .catch(function () { merr.textContent = 'Network error — please try again.'; })
        .then(function () { mbtn.disabled = false; mbtn.textContent = 'Verify'; });
    });
  </script>
</body>
</html>`);
});

// ── Crew main page ───────────────────────────────────────────────────────────
router.get("/crew", requireCrew, (req, res) => {
  const officer = jsonForScriptTag(req.officer);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.send(/* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>Crew — Flood Commander Dashboard</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    :root {
      --bg: #0f1117; --card: #1a1d27; --border: #2a2d3a;
      --fg: #f0f2f8; --muted: #7a7f9a; --primary: #4f6ef7;
      --green: #10b981; --amber: #f59e0b; --red: #ef4444;
      font-family: system-ui, -apple-system, sans-serif;
    }
    body { background: var(--bg); color: var(--fg); padding: 16px; padding-bottom: 40px; }
    .topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .topbar h1 { font-size: 18px; font-weight: 700; }
    .topbar .me { font-size: 12px; color: var(--muted); }
    .logout { font-size: 12px; color: var(--muted); background: none; border: none; text-decoration: underline; cursor: pointer; }
    .card {
      background: var(--card); border: 1px solid var(--border); border-radius: 12px;
      padding: 16px; margin-bottom: 12px;
    }
    .card h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin-bottom: 10px; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; }
    button.action {
      flex: 1; min-width: 120px; padding: 14px 10px; border-radius: 8px; border: none;
      background: var(--primary); color: #fff; font-size: 14px; font-weight: 600; cursor: pointer;
    }
    button.action.secondary { background: #2a2d3a; color: var(--fg); }
    button.action.green { background: var(--green); }
    button.action.amber { background: var(--amber); }
    button.action.red { background: var(--red); }
    button.action:disabled { opacity: 0.5; }
    select, textarea {
      width: 100%; padding: 12px; border-radius: 8px; border: 1px solid var(--border);
      background: var(--bg); color: var(--fg); font-size: 15px; margin-bottom: 10px;
    }
    .loc-item {
      padding: 12px; border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px;
      display: flex; justify-content: space-between; align-items: center; gap: 8px;
    }
    .loc-item .name { font-size: 14px; font-weight: 600; }
    .loc-item .addr { font-size: 12px; color: var(--muted); }
    .muted { color: var(--muted); font-size: 13px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
    .badge.green { background: rgba(16,185,129,0.15); color: var(--green); }
    .badge.amber { background: rgba(245,158,11,0.15); color: var(--amber); }
    .alert-banner {
      background: rgba(239,68,68,0.12); border: 1px solid var(--red); border-radius: 10px;
      padding: 12px; margin-bottom: 12px;
    }
    .stale { color: var(--muted); font-size: 11px; margin-top: 4px; }
    .crms-item { border-top: 1px solid var(--border); padding-top: 10px; margin-top: 10px; }
    .crms-item:first-child { border-top: none; padding-top: 0; margin-top: 0; }
    .toast {
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      background: var(--card); border: 1px solid var(--border); color: var(--fg);
      padding: 10px 16px; border-radius: 8px; font-size: 13px; opacity: 0; transition: opacity .2s;
      pointer-events: none; z-index: 50;
    }
    .toast.show { opacity: 1; }
    .overlay {
      display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6);
      align-items: center; justify-content: center; padding: 20px; z-index: 60;
    }
    .overlay.open { display: flex; }
    .modal {
      background: var(--card); border: 1px solid var(--border); border-radius: 12px;
      padding: 20px; width: 100%; max-width: 360px;
    }
    .modal h3 { font-size: 16px; margin-bottom: 4px; }
    .modal input {
      width: 100%; padding: 12px; border-radius: 8px; border: 1px solid var(--border);
      background: var(--bg); color: var(--fg); font-size: 15px; margin-top: 10px; letter-spacing: 2px;
    }

    /* ── Fleet map ─────────────────────────────────────────────────────────
       Full-screen overlay rather than a new page/tab — cheapest way to add a
       map to a single-scroll dashboard without restructuring it. Leaflet +
       CARTO dark tiles, same combination lightning.ts already uses (no API
       key, already vetted for this app). */
    #map-modal .modal { max-width: 100%; width: 100%; height: 100dvh; padding: 0; border-radius: 0; display: flex; flex-direction: column; }
    #map-modal .map-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; border-bottom: 1px solid var(--border);
    }
    #map-modal .map-head h3 { font-size: 15px; }
    #crew-map { flex: 1; background: var(--bg); }
    .leaflet-container { background: var(--bg); }
    .leaflet-popup-content-wrapper, .leaflet-popup-tip { background: var(--card); color: var(--fg); }
    .leaflet-popup-content { font-size: 12px; margin: 10px 12px; }
    .leaflet-popup-content b { font-size: 13px; }
    .leaflet-control-zoom a { background: var(--card) !important; color: var(--fg) !important; border-color: var(--border) !important; }
    .leaflet-control-attribution { background: var(--card) !important; color: var(--muted) !important; font-size: 10px !important; }
    .leaflet-control-attribution a { color: var(--muted) !important; }
    .pin-loc { width: 12px; height: 12px; background: #7a7f9a; border: 2px solid #0f1117; border-radius: 50%; }
    .pin-loc.t2 { border-radius: 2px; transform: rotate(45deg); }
    .pin-veh { width: 16px; height: 16px; border: 2px solid #0f1117; border-radius: 50%; background: var(--amber); box-shadow: 0 0 0 2px rgba(0,0,0,0.3); }
    .pin-veh.arrived { background: var(--green); }
    .pin-veh.mine { width: 20px; height: 20px; background: var(--primary); box-shadow: 0 0 0 4px rgba(79,110,247,0.35); }
  </style>
</head>
<body>
  <div class="topbar">
    <div>
      <h1 id="officerName"></h1>
      <div class="me" id="teamLine">No team selected</div>
      <div class="me" id="tideLine"></div>
    </div>
    <div style="display:flex; align-items:center; gap:12px;">
      <button class="logout" onclick="openMap()" title="Fleet map">🗺️ Map</button>
      <button class="logout" onclick="copyReportCrew()" title="Copy fleet deployment report to clipboard">📋 Report</button>
      <button class="logout" id="notif-btn" onclick="togglePush()" style="display:none">🔕 Notif: OFF</button>
      <button class="logout" onclick="openMfaSettings()" title="Two-factor authentication">🛡️</button>
      <button class="logout" id="change-team-btn" onclick="changeTeam()" style="display:none" title="Pick a different team/vehicle">🔄 Team</button>
      <button class="logout" onclick="logout()">Log out</button>
    </div>
  </div>

  <!-- MFA settings — disable-only, matching the "mandatory" policy: an
       authenticated crew session always already has MFA enabled (login
       forces enrollment before granting one, see auth.ts), so there's no
       separate "set up" view to show here, only "turn off" (which just
       means the next login will force re-enrollment, same as manager). -->
  <div class="overlay" id="mfa-modal">
    <div class="modal">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
        <h3>Two-Factor Authentication</h3>
        <button onclick="closeMfaSettings()" style="background:none; border:none; font-size:20px; cursor:pointer; color:var(--muted); line-height:1;">×</button>
      </div>
      <p class="muted" style="margin-bottom:10px;">Enter a current code from your authenticator app to turn it off. You'll be asked to set it up again next time you log in.</p>
      <input id="mfa-disable-code" type="text" inputmode="numeric" maxlength="6" placeholder="123456" />
      <div id="mfa-disable-msg" style="font-size:13px; min-height:18px; margin-top:8px;"></div>
      <div class="row" style="margin-top:12px;">
        <button class="action secondary" onclick="closeMfaSettings()">Close</button>
        <button class="action red" onclick="submitMfaDisable()">Disable</button>
      </div>
    </div>
  </div>

  <!-- Fleet map — read-mostly: preset location pins + team vehicle positions
       (mine highlighted). No editing, no weather-radar overlay (already
       covered by /manager and /lightning). -->
  <div class="overlay" id="map-modal">
    <div class="modal">
      <div class="map-head">
        <h3>🗺️ Fleet Map</h3>
        <button onclick="closeMap()" style="background:none; border:none; font-size:20px; cursor:pointer; color:var(--muted); line-height:1;">×</button>
      </div>
      <div id="crew-map"></div>
    </div>
  </div>

  <div id="alertBanner" style="display:none" class="alert-banner">
    <div style="font-weight:600; margin-bottom:6px;">⚠️ Weather Alert</div>
    <div id="alertText" style="font-size:13px; margin-bottom:10px;"></div>
    <button class="action amber" onclick="acknowledgeAlert()">Acknowledge</button>
  </div>

  <div class="card" id="teamPickerCard">
    <h2>Select Your Team / Vehicle</h2>
    <select id="teamSelect"></select>
    <button class="action" onclick="chooseTeam()">Confirm</button>
  </div>

  <div id="mainSections" style="display:none">
    <div class="card" id="deploymentCard"></div>
    <div class="card" id="swapCard" style="display:none">
      <h2>Swap Request</h2>
      <div id="swapBody"></div>
    </div>
    <div class="card" id="crmsCard">
      <h2>My CRMS Cases</h2>
      <div id="crmsBody" class="muted">Loading…</div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    var OFFICER = ${officer};
    var STORAGE_KEY = 'crew_vehicle_' + OFFICER.id;
    var vehicleId = localStorage.getItem(STORAGE_KEY) || null;
    var state = null; // last /deployments/state payload
    var crmsCases = []; // last /api/crms payload — shared with copyReportCrew()
    var latestTide = null; // last /api/tide payload — shared with copyReportCrew()

    document.getElementById('officerName').textContent = OFFICER.name;

    // Unit sort order: BU → PJ → WK → CP → KG (mirrors manager.ts's unitSortKey)
    var UNIT_ORDER_MAP = { BU: 0, PJ: 1, WK: 2, CP: 3, KG: 4 };
    function unitSortKey(code) {
      var prefix = code.replace(/[0-9].*$/, '');
      var num = parseInt(code.replace(/^[^0-9]+/, ''), 10) || 0;
      return (UNIT_ORDER_MAP[prefix] ?? 99) * 1000 + num;
    }
    function weatherEmoji(w) {
      if (w === 'Heavy Rain') return '🔴';
      if (w === 'Moderate Rain') return '🟠';
      if (w === 'Light Rain' || w === 'Nil Rain') return '🟢';
      return '';
    }

    // Safe way to embed a JSON-stringified value inside a double-quoted
    // onclick="..." HTML attribute — JSON.stringify's own double quotes would
    // otherwise prematurely close the attribute and silently break the
    // handler (the bug that made every Accept/Weather/Swap/CRMS button do
    // nothing on first deploy — caught via live testing, not locally).
    function attrArg(val) {
      return JSON.stringify(val).replace(/"/g, '&quot;');
    }

    // SSP as-3 — every server/DB-sourced string (location names/addresses,
    // CRMS case fields, comments) rendered into .innerHTML below goes
    // through this first. Same escaping manager.ts's own esc()/escHtml()
    // helpers do; this page just never had one.
    function esc(s) {
      return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function toast(msg) {
      var t = document.getElementById('toast');
      t.textContent = msg; t.classList.add('show');
      setTimeout(function () { t.classList.remove('show'); }, 2200);
    }

    // POST helper that resolves { ok, d } like the login/MFA panes on the login
    // page already do (see crew/login above) — every action button below used
    // to skip this and show a success toast regardless of the response status,
    // so a real failure (e.g. a 400 from missing roster fields) looked
    // identical to success and just silently didn't advance. The catch on the
    // json parse covers a non-JSON error body (e.g. a raw 500 HTML page).
    function postJson(url, body) {
      return fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; });
      });
    }
    // Pulls a human-readable message out of either error shape this API uses:
    // { error: "code", message: "readable" } or the older { error: "readable" }.
    function errMsg(d, fallback) {
      return (d && (d.message || d.error)) || fallback;
    }

    function logout() {
      stopLocationWatch();
      fetch('/manager/auth/logout', { method: 'POST' }).then(function () {
        window.location.href = '/crew/login';
      });
    }

    function myTeam() {
      if (!state || !vehicleId) return null;
      return (state.rosterTeams || []).find(function (t) { return t.vehicleId === vehicleId; }) || null;
    }
    function myEntry() {
      if (!state || !vehicleId) return null;
      return (state.entries || []).find(function (e) { return e.vehicleId === vehicleId; }) || null;
    }
    function myAssignment() {
      if (!state || !vehicleId) return null;
      var a = (state.assignments || []).find(function (a) { return a.vehicleId === vehicleId && a.status === 'pending'; });
      return a || null;
    }
    function locationById(id) {
      return (state && state.presetLocations || []).find(function (l) { return l.id === id; }) || null;
    }

    // ── Fleet map ────────────────────────────────────────────────────────────
    // New build, not a port — Replit's only equivalent (deployment-tracker's
    // React Native map.tsx, ~1,800 lines) can't translate to a browser. Scoped
    // to what a crew member actually needs here: preset-location pins + team
    // vehicle positions (mine highlighted), read-only. No editing, no radar
    // overlay (already covered by /manager and /lightning). Leaflet + the
    // same CARTO dark tiles lightning.ts already uses.
    var crewMap = null;
    var crewMapLayer = null;
    var mapOpen = false;

    function openMap() {
      document.getElementById('map-modal').classList.add('open');
      mapOpen = true;
      if (!crewMap) {
        crewMap = L.map('crew-map', { center: [1.3521, 103.8198], zoom: 12, zoomControl: true, attributionControl: true });
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
          attribution: '&copy; <a href="https://carto.com">CARTO</a>',
          subdomains: 'abcd', maxZoom: 19,
        }).addTo(crewMap);
        crewMapLayer = L.layerGroup().addTo(crewMap);
      }
      // Modal was display:none while the map initialized/last rendered — Leaflet
      // measures the container on init, so a 0×0 box needs an explicit refresh.
      setTimeout(function () { crewMap.invalidateSize(); }, 50);
      renderMapMarkers();
    }
    function closeMap() {
      document.getElementById('map-modal').classList.remove('open');
      mapOpen = false;
    }

    function pinIcon(cls) {
      return L.divIcon({ className: '', html: '<div class="' + cls + '"></div>', iconSize: [16, 16] });
    }
    function relativeTime(iso) {
      if (!iso) return '';
      var diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
      if (diffMin < 1) return 'just now';
      if (diffMin < 60) return diffMin + 'm ago';
      return Math.round(diffMin / 60) + 'h ago';
    }

    function renderMapMarkers() {
      if (!crewMap || !state) return;
      crewMapLayer.clearLayers();
      var bounds = [];

      // Preset locations — circle for Tier 1, diamond for Tier 2 (mirrors
      // manager.ts's tier marker convention, redrawn for Leaflet's divIcon
      // instead of Google Maps' SymbolPath).
      (state.presetLocations || []).forEach(function (loc) {
        if (loc.lat == null || loc.lng == null) return;
        var cls = 'pin-loc' + (loc.tier === 2 ? ' t2' : '');
        var m = L.marker([loc.lat, loc.lng], { icon: pinIcon(cls) }).addTo(crewMapLayer);
        m.bindPopup(
          '<b>' + esc(loc.name) + '</b><br/>' + esc(loc.address || '') +
          '<br/><a href="' + navUrl(loc.lat, loc.lng) + '" target="_blank">🧭 Navigate</a>'
        );
        bounds.push([loc.lat, loc.lng]);
      });

      // Team vehicle positions — mine highlighted, others by arrived/en-route.
      (state.vehicles || []).forEach(function (v) {
        if (v.lat == null || v.lng == null) return;
        var isMine = v.vehicleId === vehicleId;
        var entry = (state.entries || []).find(function (e) { return e.vehicleId === v.vehicleId; });
        var cls = 'pin-veh' + (isMine ? ' mine' : '') + (entry && entry.arrived ? ' arrived' : '');
        var m = L.marker([v.lat, v.lng], { icon: pinIcon(cls) }).addTo(crewMapLayer);
        var statusLine = entry
          ? (entry.arrived ? 'Arrived' + (entry.arrivedAt ? ' ' + entry.arrivedAt + ' hrs' : '') : 'ETA ' + entry.eta + ' hrs')
          : 'En route';
        m.bindPopup(
          '<b>' + (isMine ? 'You — ' : '') + esc(v.unitCode) + ' ' + esc(v.vehicleNumber) + '</b><br/>' +
          (v.partner ? esc(v.partner) + '<br/>' : '') + esc(statusLine) +
          '<br/><span style="color:var(--muted)">Updated ' + esc(relativeTime(v.updatedAt)) + '</span>'
        );
        bounds.push([v.lat, v.lng]);
      });

      if (bounds.length) crewMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
    }

    // ── Team selection ──────────────────────────────────────────────────────
    function renderTeamPicker() {
      var sel = document.getElementById('teamSelect');
      sel.innerHTML = '';
      (state.rosterTeams || []).forEach(function (t) {
        var opt = document.createElement('option');
        opt.value = t.vehicleId;
        opt.textContent = t.unitCode + ' ' + t.vehicleNumber + ' — ' + t.partner + ' (' + t.shift + ')';
        sel.appendChild(opt);
      });
      if (vehicleId) sel.value = vehicleId;
    }
    function chooseTeam() {
      var sel = document.getElementById('teamSelect');
      if (!sel.value) { toast('No team available — ask your commander to import today\\'s roster.'); return; }
      vehicleId = sel.value;
      localStorage.setItem(STORAGE_KEY, vehicleId);
      startLocationWatch();
      render();
    }
    // Team/vehicle is remembered per officer in localStorage independently of
    // login session (see .scratch/flood-commander-web/issues/02-crew-web-page.md)
    // so it survives a re-login mid-shift — but that also meant there was no
    // way to ever change it once picked, logout included. This is the explicit
    // escape hatch.
    function changeTeam() {
      if (!confirm('Switch to a different team/vehicle? Your current deployment record is unaffected — you can switch back anytime.')) return;
      stopLocationWatch();
      vehicleId = null;
      localStorage.removeItem(STORAGE_KEY);
      render();
    }

    // ── Nav handoff — universal links, not custom schemes, so they work from
    // a browser (see .scratch/flood-commander-web/spec.md) ──────────────────
    function navUrl(lat, lng) {
      var isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
      return isIOS
        ? 'https://maps.apple.com/?daddr=' + lat + ',' + lng
        : 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng;
    }

    // ── Rough straight-line ETA estimate ─────────────────────────────────────
    // No routing API on the crew side (unlike /manager's Google Directions
    // call) — this is a haversine distance / assumed speed estimate, padded
    // for the fact that roads aren't straight lines. Good enough for the
    // manager's ETA display; not meant to be precise.
    function haversineKm(lat1, lng1, lat2, lng2) {
      var R = 6371;
      var dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
      var a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
        + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    function sgHHMM(date) {
      var parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Singapore' }).formatToParts(date);
      var h = parts.find(function (p) { return p.type === 'hour'; }).value;
      var m = parts.find(function (p) { return p.type === 'minute'; }).value;
      return h + m;
    }
    var AVG_SPEED_KMH = 30; // rough urban estimate
    function estimateEta(curLat, curLng, destLat, destLng) {
      var km = haversineKm(curLat, curLng, destLat, destLng);
      var minutes = Math.max(1, Math.round((km / AVG_SPEED_KMH) * 60 * 1.3)); // +30% pad, straight-line vs road
      return { eta: sgHHMM(new Date(Date.now() + minutes * 60000)), etaMinutes: minutes };
    }

    // ── Continuous foreground tracking ──────────────────────────────────────
    // Adopted from the old Replit deployment-tracker's web build (it did run in
    // a mobile browser at /crew, not just as an installed native app — its
    // Platform.OS === 'web' branch used exactly this: a continuous
    // watchPosition() feed decoupled from a 20s setInterval that POSTs the
    // cached fix, rather than requesting a fresh GPS lock every push). Same
    // foreground-tab caveat as before (see spec.md) — a backgrounded/swapped-away
    // tab can still have this throttled or suspended by the browser — but while
    // the tab stays open, this keeps position current without the officer
    // tapping anything. Accept-ping, refocus-ping, and the manual button all
    // stay in place underneath this as the fallback for whenever a tab *was*
    // suspended (e.g. during the Maps handoff itself).
    var lastKnownPos = null; // {lat, lng} cache fed by watchPosition
    var geoWatchId = null;
    var positionPushInterval = null;

    function startLocationWatch() {
      if (geoWatchId != null || !vehicleId || !navigator.geolocation) return;
      geoWatchId = navigator.geolocation.watchPosition(
        function (pos) { lastKnownPos = { lat: pos.coords.latitude, lng: pos.coords.longitude }; },
        function () { /* non-fatal — refocus-ping/manual button still work */ },
        { enableHighAccuracy: true }
      );
      positionPushInterval = setInterval(pushLastKnownPosition, 20000);
    }
    function stopLocationWatch() {
      if (geoWatchId != null) { navigator.geolocation.clearWatch(geoWatchId); geoWatchId = null; }
      if (positionPushInterval) { clearInterval(positionPushInterval); positionPushInterval = null; }
      lastKnownPos = null;
    }
    // Shared by the continuous watch push and the manual/accept/refocus ping
    // below — one place defining what a position ping contains, so the two
    // paths can't silently diverge (.scratch/code-review-sept/issues/04-...).
    function buildPositionBody(t, entry, lat, lng) {
      var body = {
        vehicleId: t.vehicleId, vehicleNumber: t.vehicleNumber, unitCode: t.unitCode,
        partner: t.partner, shift: t.shift,
        lat: lat, lng: lng,
        acceptedLocationId: entry ? entry.locationId : null,
      };
      if (entry && !entry.arrived) {
        var destLoc = locationById(entry.locationId);
        if (destLoc) {
          var est = estimateEta(lat, lng, destLoc.lat, destLoc.lng);
          body.eta = est.eta;
          body.etaMinutes = est.etaMinutes;
        }
      }
      return body;
    }
    function pushLastKnownPosition() {
      var t = myTeam();
      var entry = myEntry();
      if (!t || !lastKnownPos) return;
      var body = buildPositionBody(t, entry, lastKnownPos.lat, lastKnownPos.lng);
      fetch('/api/deployments/position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }
    if (vehicleId) startLocationWatch();

    // ── Location update — accept-ping, tab-refocus-ping, manual button, all on
    // top of the continuous watch above. ────────────────────────────────────
    function updateLocation(silent) {
      var t = myTeam();
      var entry = myEntry();
      if (!t || !navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(function (pos) {
        var body = buildPositionBody(t, entry, pos.coords.latitude, pos.coords.longitude);
        postJson('/api/deployments/position', body)
          .then(function (res) {
            if (!silent) toast(res.ok ? 'Location updated' : errMsg(res.d, 'Could not update location.'));
          })
          .catch(function () { if (!silent) toast('Network error — please try again.'); });
      }, function () {
        if (!silent) toast('Could not get GPS location — check location permission.');
      }, { enableHighAccuracy: true, timeout: 10000 });
    }
    // Auto-ping whenever this tab regains focus (e.g. after the nav-app handoff)
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && vehicleId) updateLocation(true);
    });

    // ── Deployment card ─────────────────────────────────────────────────────
    function renderDeployment() {
      var card = document.getElementById('deploymentCard');
      var t = myTeam();
      var entry = myEntry();
      var assignment = myAssignment();

      if (entry) {
        var loc = locationById(entry.locationId);
        var name = loc ? loc.name : entry.locationId;
        var weatherOpts = ['Heavy Rain', 'Moderate Rain', 'Light Rain', 'Nil Rain'];
        card.innerHTML =
          '<h2>Your Deployment</h2>' +
          '<div style="font-size:16px; font-weight:700; margin-bottom:2px;">' + esc(name) + '</div>' +
          '<div class="muted" style="margin-bottom:12px;">' +
            (entry.arrived ? '<span class="badge green">Arrived ' + esc(entry.arrivedAt || '') + '</span>' : '<span class="badge amber">En route</span>') +
          '</div>' +
          '<div class="row" style="margin-bottom:10px;">' +
            (loc ? '<button class="action secondary" onclick="window.open(navUrl(' + loc.lat + ',' + loc.lng + '), \\'_blank\\')">🧭 Navigate</button>' : '') +
            (!entry.arrived ? '<button class="action green" onclick="markArrived()">✅ Mark Arrived</button>' : '') +
          '</div>' +
          '<div class="row" style="margin-bottom:10px;">' +
            weatherOpts.map(function (w) {
              return '<button class="action secondary" style="' + (entry.weather === w ? 'outline:2px solid var(--primary);' : '') + '" onclick="reportWeather(' + attrArg(w) + ')">' + w + '</button>';
            }).join('') +
          '</div>' +
          '<button class="action" onclick="updateLocation(false)">📍 Update My Location</button>' +
          '<div class="stale" id="posStale"></div>';
      } else if (assignment) {
        var aloc = locationById(assignment.locationId) || { name: assignment.locationName, lat: assignment.lat, lng: assignment.lng };
        card.innerHTML =
          '<h2>New Assignment</h2>' +
          '<div style="font-size:16px; font-weight:700; margin-bottom:12px;">' + esc(aloc.name) + '</div>' +
          '<button class="action green" onclick="acceptAssignment(' + attrArg(assignment.locationId) + ')">Accept</button>';
      } else if (t) {
        var available = (state.presetLocations || []).filter(function (l) {
          return !(state.entries || []).some(function (e) { return e.locationId === l.id; });
        });
        card.innerHTML =
          '<h2>Available Locations</h2>' +
          (available.length
            ? available.map(function (l) {
                return '<div class="loc-item"><div><div class="name">' + esc(l.name) + '</div><div class="addr">' + esc(l.address) + '</div></div>' +
                  '<button class="action green" style="flex:none; padding:10px 14px;" onclick="acceptLocation(' + attrArg(l.id) + ')">Accept</button></div>';
              }).join('')
            : '<div class="muted">No locations currently available.</div>');
      } else {
        card.innerHTML = '<div class="muted">Select your team above first.</div>';
      }
      renderStale();
    }

    function renderStale() {
      var el = document.getElementById('posStale');
      if (!el) return;
      var pos = (state.vehicles || []).find(function (v) { return v.vehicleId === vehicleId; });
      if (!pos) { el.textContent = 'No location reported yet.'; return; }
      var mins = Math.round((Date.now() - new Date(pos.updatedAt).getTime()) / 60000);
      el.textContent = mins <= 0 ? 'Location updated just now' : 'Last updated ' + mins + ' min ago';
      el.style.color = mins > 30 ? 'var(--red)' : 'var(--muted)';
    }

    function acceptLocation(locationId) {
      var t = myTeam(); if (!t) return;
      postJson('/api/deployments/accept', { vehicleId: t.vehicleId, vehicleNumber: t.vehicleNumber, unitCode: t.unitCode, partner: t.partner, shift: t.shift, locationId: locationId, eta: '', etaMinutes: 0 })
        .then(function (res) {
          if (!res.ok) { toast(errMsg(res.d, 'Could not accept location.')); return; }
          toast('Location accepted');
          // refresh() first — updateLocation() reads myEntry() from local
          // state, which doesn't have the just-created entry until this
          // resolves. Doing it in the other order meant the very first
          // position ping after accepting always skipped the ETA calculation.
          refresh().then(function () { updateLocation(true); });
        })
        .catch(function () { toast('Network error — please try again.'); });
    }
    function acceptAssignment(locationId) { acceptLocation(locationId); }
    function markArrived() {
      var t = myTeam(); if (!t) return;
      var entry = myEntry(); if (!entry) return;
      postJson('/api/deployments/arrive', { vehicleId: t.vehicleId, locationId: entry.locationId })
        .then(function (res) {
          if (!res.ok) { toast(errMsg(res.d, 'Could not mark arrived.')); return; }
          toast('Marked arrived'); refresh();
        })
        .catch(function () { toast('Network error — please try again.'); });
    }
    function reportWeather(weather) {
      var t = myTeam(); var entry = myEntry(); if (!t || !entry) return;
      postJson('/api/deployments/weather', { vehicleId: t.vehicleId, locationId: entry.locationId, weather: weather })
        .then(function (res) {
          if (!res.ok) { toast(errMsg(res.d, 'Could not report weather.')); return; }
          toast('Weather reported'); refresh();
        })
        .catch(function () { toast('Network error — please try again.'); });
    }
    function acknowledgeAlert() {
      var t = myTeam(); if (!t) return;
      postJson('/api/alert/acknowledge', { unitCode: t.unitCode })
        .then(function (res) {
          if (!res.ok) { toast(errMsg(res.d, 'Could not acknowledge alert.')); return; }
          toast('Alert acknowledged'); refresh();
        })
        .catch(function () { toast('Network error — please try again.'); });
    }

    // ── Swap ─────────────────────────────────────────────────────────────────
    function renderSwap() {
      var card = document.getElementById('swapCard');
      var body = document.getElementById('swapBody');
      var t = myTeam(); var entry = myEntry();
      var incoming = (state.swapRequests || []).find(function (s) { return s.toVehicleId === vehicleId; });
      var outgoing = (state.swapRequests || []).find(function (s) { return s.fromVehicleId === vehicleId; });

      if (incoming) {
        card.style.display = 'block';
        body.innerHTML =
          '<div class="muted" style="margin-bottom:10px;">' + esc(incoming.fromUnitCode) + ' wants to swap you into ' + esc(incoming.fromLocationName) + '</div>' +
          '<div class="row">' +
            '<button class="action green" onclick="swapAccept(' + attrArg(incoming.id) + ')">Accept Swap</button>' +
            '<button class="action red" onclick="swapDecline(' + attrArg(incoming.id) + ')">Decline</button>' +
          '</div>';
        return;
      }
      if (outgoing) {
        card.style.display = 'block';
        body.innerHTML = '<div class="muted">Waiting for ' + esc(outgoing.toUnitCode) + ' to respond to your swap request.</div>';
        return;
      }
      if (!t || !entry) { card.style.display = 'none'; return; }
      var others = (state.entries || []).filter(function (e) { return e.vehicleId !== vehicleId; });
      if (!others.length) { card.style.display = 'none'; return; }
      card.style.display = 'block';
      body.innerHTML =
        '<select id="swapTarget">' +
          others.map(function (e) {
            var loc = locationById(e.locationId);
            return '<option value="' + esc(e.vehicleId) + '">' + esc(e.unitCode) + ' — ' + esc(loc ? loc.name : e.locationId) + '</option>';
          }).join('') +
        '</select>' +
        '<button class="action" onclick="requestSwap()">Request Swap</button>';
    }
    function requestSwap() {
      var target = document.getElementById('swapTarget').value;
      postJson('/api/deployments/swap-request', { fromVehicleId: vehicleId, toVehicleId: target })
        .then(function (res) {
          if (!res.ok) { toast(errMsg(res.d, 'Could not request swap.')); return; }
          toast('Swap requested'); refresh();
        })
        .catch(function () { toast('Network error — please try again.'); });
    }
    function swapAccept(id) {
      postJson('/api/deployments/swap-accept', { swapRequestId: id, vehicleId: vehicleId })
        .then(function (res) {
          if (!res.ok) { toast(errMsg(res.d, 'Could not accept swap.')); return; }
          toast('Swap complete'); refresh();
        })
        .catch(function () { toast('Network error — please try again.'); });
    }
    function swapDecline(id) {
      postJson('/api/deployments/swap-decline', { swapRequestId: id, vehicleId: vehicleId })
        .then(function (res) {
          if (!res.ok) { toast(errMsg(res.d, 'Could not decline swap.')); return; }
          toast('Swap declined'); refresh();
        })
        .catch(function () { toast('Network error — please try again.'); });
    }

    // ── CRMS (own vehicle only) ─────────────────────────────────────────────
    // Field names below match the real CrmsCase shape (see crms.ts) — the
    // previous version of this card referenced c.title/c.description, which
    // don't exist on that type and always rendered blank.
    var CRMS_STATUS_LABEL = {
      TO_BE_ASSIGNED: 'To Be Assigned',
      TEAM_ACKNOWLEDGE_OTW: 'OTW',
      FP_UPDATED: 'FP Updated',
      ASSISTANCE_PROVIDED: 'Assistance Provided',
      RESOLVED: 'Resolved',
    };
    function crmsSgTime(iso) {
      return new Date(iso).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    }
    function loadCrms() {
      if (!vehicleId) return;
      fetch('/api/crms', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
        crmsCases = d.cases || [];
        var mine = crmsCases.filter(function (c) { return c.assignedVehicleId === vehicleId && c.status !== 'RESOLVED'; });
        var body = document.getElementById('crmsBody');
        if (!mine.length) { body.innerHTML = '<div class="muted">No open cases assigned to your vehicle.</div>'; return; }
        body.innerHTML = mine.map(function (c) {
          var comments = (c.comments || []).map(function (cm) {
            return '<div style="margin-top:6px; padding-top:6px; border-top:1px solid var(--border);">' +
              '<div class="muted" style="font-size:11px;">' + esc(cm.unitCode) + ' &middot; ' + crmsSgTime(cm.createdAt) + '</div>' +
              '<div style="font-size:13px;">' + esc(cm.text) + '</div>' +
            '</div>';
          }).join('');
          return '<div class="crms-item">' +
            '<div style="display:flex; justify-content:space-between; align-items:baseline; gap:8px;">' +
              '<div style="font-weight:600; font-size:13px;">' + (c.isWog ? 'WOG ' : '') + 'CRMS #' + esc(c.caseNumber) + '</div>' +
              '<span class="badge amber">' + esc(CRMS_STATUS_LABEL[c.status] || c.status) + '</span>' +
            '</div>' +
            '<div class="muted" style="font-size:12px; margin:4px 0;">📍 ' + esc(c.address || c.locationName || '') + '</div>' +
            (c.fpName || c.fpContact ? '<div class="muted" style="font-size:12px; margin-bottom:6px;">👤 ' + esc(c.fpName || '') + (c.fpContact ? ' &middot; ' + esc(c.fpContact) : '') + '</div>' : '') +
            (c.details ? '<div style="font-size:13px; margin-bottom:6px;">' + esc(c.details) + '</div>' : '') +
            comments +
            '<textarea placeholder="Add a comment…" id="cmt_' + c.id + '" rows="2" style="margin-top:8px;"></textarea>' +
            '<div class="row">' +
              '<button class="action secondary" onclick="crmsComment(' + attrArg(c.id) + ')">Comment</button>' +
              '<button class="action green" onclick="crmsResolve(' + attrArg(c.id) + ')">Resolve</button>' +
            '</div>' +
          '</div>';
        }).join('');
      }).catch(function () {});
    }
    function crmsComment(id) {
      var val = document.getElementById('cmt_' + id).value.trim();
      if (!val) return;
      var t = myTeam(); if (!t) return;
      postJson('/api/crms/' + id + '/comment', { text: val, vehicleId: t.vehicleId, unitCode: t.unitCode })
        .then(function (res) {
          if (!res.ok) { toast(errMsg(res.d, 'Could not add comment.')); return; }
          toast('Comment added'); loadCrms();
        })
        .catch(function () { toast('Network error — please try again.'); });
    }
    function crmsResolve(id) {
      var t = myTeam(); if (!t) return;
      postJson('/api/crms/' + id + '/resolve', { vehicleId: t.vehicleId, unitCode: t.unitCode })
        .then(function (res) {
          if (!res.ok) { toast(errMsg(res.d, 'Could not resolve case.')); return; }
          toast('Case resolved'); loadCrms();
        })
        .catch(function () { toast('Network error — please try again.'); });
    }

    // ── Top-level render / poll ─────────────────────────────────────────────
    function render() {
      var t = myTeam();
      document.getElementById('teamLine').textContent = t ? (t.unitCode + ' ' + t.vehicleNumber + ' — ' + t.partner) : 'No team selected';
      document.getElementById('teamPickerCard').style.display = vehicleId ? 'none' : 'block';
      document.getElementById('mainSections').style.display = vehicleId ? 'block' : 'none';
      document.getElementById('change-team-btn').style.display = vehicleId ? '' : 'none';
      renderTeamPicker();
      if (vehicleId) { renderDeployment(); renderSwap(); loadCrms(); }
      if (mapOpen) renderMapMarkers();

      if (state.activeAlert) {
        var t2 = myTeam();
        var acked = t2 && state.activeAlert.acknowledgments && state.activeAlert.acknowledgments.indexOf(t2.unitCode) !== -1;
        document.getElementById('alertBanner').style.display = acked ? 'none' : 'block';
        document.getElementById('alertText').textContent = state.activeAlert.extracted;
      } else {
        document.getElementById('alertBanner').style.display = 'none';
      }
    }

    function refresh() {
      return fetch('/api/deployments/state', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (d) { state = d; render(); })
        .catch(function () {});
    }

    refresh().then(function () {
      // First load after picking a team for the first time this session: get
      // an initial position on the board right away.
      if (vehicleId && myTeam() && !myEntry()) { /* no-op — wait for accept */ }
    });
    setInterval(refresh, 15000);

    // ── Tide — the /api/tide endpoint already existed (built for /manager's
    // report view) but was never surfaced here. Fetched independently of the
    // main 15s refresh loop since it changes far more slowly. ──────────────
    function loadTide() {
      fetch('/api/tide').then(function (r) { return r.json(); }).then(function (t) {
        latestTide = t;
        var el = document.getElementById('tideLine');
        if (!el || typeof t.height !== 'number') return;
        el.textContent = '🌊 Tide ' + t.height.toFixed(2) + 'm ' + (t.rising ? '↑' : '↓');
      }).catch(function () {});
    }
    loadTide();
    setInterval(loadTide, 60000);

    // ── Copy fleet deployment report to clipboard ───────────────────────────
    // Mirrors manager.ts's copyReport() — same text shape, built client-side
    // from the same /deployments/state payload crew.ts already polls, so a
    // crew member can paste the same-format SITREP into WhatsApp/Telegram
    // without needing to open /manager.
    function copyReportCrew() {
      if (!state) { toast('Report not ready yet — try again shortly.'); return; }
      var entries = state.entries || [];
      var date = state.deploymentDate || '';
      var allAssignments = state.assignments || [];
      var deployedVehicleIds = {};
      entries.forEach(function (e) { deployedVehicleIds[e.vehicleId] = true; });
      var pendingOnly = allAssignments.filter(function (a) {
        return a.status === 'pending' && !deployedVehicleIds[a.vehicleId];
      });
      if (!entries.length && !pendingOnly.length) { toast('Nothing to copy yet.'); return; }

      var sep = '─'.repeat(48);
      var today = date || new Date().toLocaleDateString('en-SG', { day: '2-digit', month: 'long', year: 'numeric' });
      var lines = ['*DEPLOYMENT REPORT — ' + today + '*'];
      if (state.activeAlert && state.activeAlert.extracted) {
        lines.push('🚨 HRW: ' + state.activeAlert.extracted);
      }
      if (latestTide) {
        lines.push('🌊 Tide Level: ' + latestTide.height.toFixed(2) + 'm ' + (latestTide.rising ? '↑' : '↓'));
      }

      var allItems = [];
      entries.forEach(function (e) {
        var loc = locationById(e.locationId);
        var locName = loc ? loc.name : e.locationId;
        var timeStr = e.arrived && e.arrivedAt ? (e.arrivedAt + ' hrs') : ('ETA ' + e.eta + ' hrs' + (e.fromRoad && !e.arrived ? ' from ' + e.fromRoad : ''));
        var wSuffix = e.weather ? (' | ' + weatherEmoji(e.weather) + ' ' + e.weather) : '';
        allItems.push({ sortKey: unitSortKey(e.unitCode), line: '*' + e.unitCode + '* ' + e.vehicleNumber + ' (' + e.shift + '): ' + e.partner + ' → *' + locName + '* | ' + timeStr + wSuffix });
      });
      pendingOnly.forEach(function (a) {
        var rosterTeam = (state.rosterTeams || []).find(function (t) { return (t.unitCode + '-' + t.vehicleNumber) === a.vehicleId || t.unitCode === a.unitCode; });
        var partner = rosterTeam ? rosterTeam.partner : '';
        var shift = a.shift || (rosterTeam ? rosterTeam.shift : '');
        var activeCrms = crmsCases.find(function (c) { return c.assignedVehicleId === a.vehicleId && c.status !== 'RESOLVED'; });
        var displayLoc = activeCrms ? ('Attend Case "' + (activeCrms.address || activeCrms.locationName || '#' + activeCrms.caseNumber) + '"') : a.locationName;
        allItems.push({ sortKey: unitSortKey(a.unitCode), line: '*' + a.unitCode + '* ' + a.vehicleNumber + (shift ? ' (' + shift + ')' : '') + ': ' + (partner ? partner + ' → ' : '→ ') + '*' + displayLoc + '*' });
      });
      allItems.sort(function (a, b) { return a.sortKey - b.sortKey; });

      lines.push(sep, '✅ DEPLOYED (' + allItems.length + ')');
      allItems.forEach(function (i) { lines.push(i.line); });
      lines.push(sep, '📍 ' + entries.filter(function (e) { return e.arrived; }).length + '/' + entries.length + ' arrived | ' + pendingOnly.length + ' pending');

      var text = lines.join('\\n');
      navigator.clipboard.writeText(text).then(function () { toast('Report copied to clipboard!'); }).catch(function () { toast('Copy failed.'); });
    }

    // ── MFA settings (disable-only — see the overlay markup above for why) ──
    function openMfaSettings() {
      document.getElementById('mfa-disable-code').value = '';
      document.getElementById('mfa-disable-msg').textContent = '';
      document.getElementById('mfa-modal').classList.add('open');
    }
    function closeMfaSettings() {
      document.getElementById('mfa-modal').classList.remove('open');
    }
    function submitMfaDisable() {
      var code = document.getElementById('mfa-disable-code').value.trim();
      var msg = document.getElementById('mfa-disable-msg');
      if (!/^[0-9]{6}$/.test(code)) { msg.style.color = 'var(--red)'; msg.textContent = 'Enter the 6-digit code.'; return; }
      msg.style.color = 'var(--muted)'; msg.textContent = 'Verifying…';
      fetch('/manager/auth/mfa/disable', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code }),
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (!res.ok) { msg.style.color = 'var(--red)'; msg.textContent = res.d.error || 'Incorrect code.'; return; }
          msg.style.color = 'var(--green)'; msg.textContent = '✓ Two-factor authentication turned off.';
          setTimeout(closeMfaSettings, 1800);
        })
        .catch(function () { msg.style.color = 'var(--red)'; msg.textContent = 'Network error — please try again.'; });
    }

    // ── Push notifications — mirrors /manager's initPush (see manager.ts),
    // scoped to this officer via type:'crew' + officerId so alerts/assignment
    // pushes still arrive even if the tab is backgrounded/closed. ──────────
    (async function initPush() {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
      var btn = document.getElementById('notif-btn');
      if (btn) btn.style.display = '';

      function updateBtn(state) {
        if (!btn) return;
        if (state === 'granted') { btn.textContent = '🔔 Notif: ON'; btn.style.opacity = '1'; btn.style.color = '#34d399'; btn.disabled = false; }
        else if (state === 'denied') { btn.textContent = '🔕 Notif: Blocked'; btn.style.opacity = '.5'; btn.style.color = ''; btn.disabled = true; }
        else { btn.textContent = '🔕 Notif: OFF'; btn.style.opacity = '1'; btn.style.color = ''; btn.disabled = false; }
      }
      updateBtn(Notification.permission);

      var swReg = null;
      try { swReg = await navigator.serviceWorker.register('/sw-crew.js', { scope: '/' }); }
      catch (e) { console.warn('SW register failed', e); return; }

      if (Notification.permission === 'granted') await subscribePush(swReg);

      window.togglePush = async function () {
        if (Notification.permission === 'denied') {
          alert('Notifications are blocked in your browser. Please enable them in browser settings, then refresh.'); return;
        }
        var existing = await swReg.pushManager.getSubscription();
        if (existing) {
          await existing.unsubscribe();
          await fetch('/api/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: existing.endpoint }) });
          updateBtn('default');
        } else {
          var perm = await Notification.requestPermission();
          updateBtn(perm);
          if (perm === 'granted') await subscribePush(swReg);
        }
      };

      async function subscribePush(reg) {
        try {
          var resp = await fetch('/api/push/vapid-key').then(function (r) { return r.json(); });
          var sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(resp.publicKey) });
          await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub, type: 'crew', officerId: OFFICER.id }) });
          updateBtn('granted');
        } catch (e) { console.warn('Push subscribe failed', e); }
      }

      function urlBase64ToUint8Array(b64) {
        var pad = '='.repeat((4 - b64.length % 4) % 4);
        var base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
        var raw = atob(base64);
        return Uint8Array.from(Array.from(raw).map(function (c) { return c.charCodeAt(0); }));
      }
    })();
  </script>
</body>
</html>`);
});

export default router;
