import { Router } from "express";
import { requireCrew } from "./auth";

const router = Router();

// ── Crew login page ─────────────────────────────────────────────────────────
// Mirrors /manager/login's shape (see auth.ts's LOGIN_HTML) but simpler —
// crew log in with their own officer ID + PIN (see
// POST /api/crew/auth/login), not a username/password.
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
  </style>
</head>
<body>
  <div class="card">
    <h1>🚔 Crew Login</h1>
    <div class="sub">Flood Commander Dashboard</div>
    <div class="err" id="err"></div>
    <form id="f">
      <label for="officerId">Officer ID</label>
      <input id="officerId" autocomplete="username" autocapitalize="off" placeholder="e.g. bu1a" />
      <label for="pin">PIN</label>
      <input id="pin" type="password" inputmode="numeric" autocomplete="current-password" placeholder="••••" />
      <button type="submit" id="btn">Log In</button>
    </form>
  </div>
  <script>
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
          window.location.href = '/crew';
        })
        .catch(function () { err.textContent = 'Could not connect. Check your connection.'; btn.disabled = false; });
    });
  </script>
</body>
</html>`);
});

// ── Crew main page ───────────────────────────────────────────────────────────
router.get("/crew", requireCrew, (req, res) => {
  const officer = JSON.stringify(req.officer);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.send(/* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>Crew — Flood Commander Dashboard</title>
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
  </style>
</head>
<body>
  <div class="topbar">
    <div>
      <h1 id="officerName"></h1>
      <div class="me" id="teamLine">No team selected</div>
    </div>
    <button class="logout" onclick="logout()">Log out</button>
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

  <script>
    var OFFICER = ${officer};
    var STORAGE_KEY = 'crew_vehicle_' + OFFICER.id;
    var vehicleId = localStorage.getItem(STORAGE_KEY) || null;
    var state = null; // last /deployments/state payload

    document.getElementById('officerName').textContent = OFFICER.name;

    // Safe way to embed a JSON-stringified value inside a double-quoted
    // onclick="..." HTML attribute — JSON.stringify's own double quotes would
    // otherwise prematurely close the attribute and silently break the
    // handler (the bug that made every Accept/Weather/Swap/CRMS button do
    // nothing on first deploy — caught via live testing, not locally).
    function attrArg(val) {
      return JSON.stringify(val).replace(/"/g, '&quot;');
    }

    function toast(msg) {
      var t = document.getElementById('toast');
      t.textContent = msg; t.classList.add('show');
      setTimeout(function () { t.classList.remove('show'); }, 2200);
    }

    function logout() {
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

    // ── Location update — accept-ping, tab-refocus-ping, manual button.
    // Deliberately NOT continuous/background — see spec.md for why. ─────────
    function updateLocation(silent) {
      var t = myTeam();
      var entry = myEntry();
      if (!t || !navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(function (pos) {
        fetch('/api/deployments/position', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vehicleId: t.vehicleId, vehicleNumber: t.vehicleNumber, unitCode: t.unitCode,
            partner: t.partner, shift: t.shift,
            lat: pos.coords.latitude, lng: pos.coords.longitude,
            acceptedLocationId: entry ? entry.locationId : null,
          }),
        }).then(function () { if (!silent) toast('Location updated'); });
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
          '<div style="font-size:16px; font-weight:700; margin-bottom:2px;">' + name + '</div>' +
          '<div class="muted" style="margin-bottom:12px;">' +
            (entry.arrived ? '<span class="badge green">Arrived ' + (entry.arrivedAt || '') + '</span>' : '<span class="badge amber">En route</span>') +
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
          '<div style="font-size:16px; font-weight:700; margin-bottom:12px;">' + aloc.name + '</div>' +
          '<button class="action green" onclick="acceptAssignment(' + attrArg(assignment.locationId) + ')">Accept</button>';
      } else if (t) {
        var available = (state.presetLocations || []).filter(function (l) {
          return !(state.entries || []).some(function (e) { return e.locationId === l.id; });
        });
        card.innerHTML =
          '<h2>Available Locations</h2>' +
          (available.length
            ? available.map(function (l) {
                return '<div class="loc-item"><div><div class="name">' + l.name + '</div><div class="addr">' + l.address + '</div></div>' +
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
      fetch('/api/deployments/accept', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleId: t.vehicleId, vehicleNumber: t.vehicleNumber, unitCode: t.unitCode, partner: t.partner, shift: t.shift, locationId: locationId, eta: '', etaMinutes: 0 }),
      }).then(function (r) { return r.json(); }).then(function () {
        toast('Location accepted'); updateLocation(true); refresh();
      });
    }
    function acceptAssignment(locationId) { acceptLocation(locationId); }
    function markArrived() {
      var t = myTeam(); if (!t) return;
      var entry = myEntry(); if (!entry) return;
      fetch('/api/deployments/arrive', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleId: t.vehicleId, locationId: entry.locationId }),
      }).then(function () { toast('Marked arrived'); refresh(); });
    }
    function reportWeather(weather) {
      var t = myTeam(); var entry = myEntry(); if (!t || !entry) return;
      fetch('/api/deployments/weather', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleId: t.vehicleId, locationId: entry.locationId, weather: weather }),
      }).then(function () { toast('Weather reported'); refresh(); });
    }
    function acknowledgeAlert() {
      var t = myTeam(); if (!t) return;
      fetch('/api/alert/acknowledge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitCode: t.unitCode }),
      }).then(function () { toast('Alert acknowledged'); refresh(); });
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
          '<div class="muted" style="margin-bottom:10px;">' + incoming.fromUnitCode + ' wants to swap you into ' + incoming.fromLocationName + '</div>' +
          '<div class="row">' +
            '<button class="action green" onclick="swapAccept(' + attrArg(incoming.id) + ')">Accept Swap</button>' +
            '<button class="action red" onclick="swapDecline(' + attrArg(incoming.id) + ')">Decline</button>' +
          '</div>';
        return;
      }
      if (outgoing) {
        card.style.display = 'block';
        body.innerHTML = '<div class="muted">Waiting for ' + outgoing.toUnitCode + ' to respond to your swap request.</div>';
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
            return '<option value="' + e.vehicleId + '">' + e.unitCode + ' — ' + (loc ? loc.name : e.locationId) + '</option>';
          }).join('') +
        '</select>' +
        '<button class="action" onclick="requestSwap()">Request Swap</button>';
    }
    function requestSwap() {
      var target = document.getElementById('swapTarget').value;
      fetch('/api/deployments/swap-request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromVehicleId: vehicleId, toVehicleId: target }),
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.error) { toast(d.error); return; }
        toast('Swap requested'); refresh();
      });
    }
    function swapAccept(id) {
      fetch('/api/deployments/swap-accept', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ swapRequestId: id, vehicleId: vehicleId }),
      }).then(function () { toast('Swap complete'); refresh(); });
    }
    function swapDecline(id) {
      fetch('/api/deployments/swap-decline', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ swapRequestId: id, vehicleId: vehicleId }),
      }).then(function () { toast('Swap declined'); refresh(); });
    }

    // ── CRMS (own vehicle only) ─────────────────────────────────────────────
    function loadCrms() {
      if (!vehicleId) return;
      fetch('/api/crms', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
        var mine = (d.cases || []).filter(function (c) { return c.assignedVehicleId === vehicleId && c.status !== 'RESOLVED'; });
        var body = document.getElementById('crmsBody');
        if (!mine.length) { body.innerHTML = '<div class="muted">No open cases assigned to your vehicle.</div>'; return; }
        body.innerHTML = mine.map(function (c) {
          return '<div class="crms-item">' +
            '<div style="font-weight:600; font-size:13px;">' + (c.title || c.id) + '</div>' +
            '<div class="muted" style="font-size:12px; margin-bottom:6px;">' + (c.description || '') + '</div>' +
            '<textarea placeholder="Add a comment…" id="cmt_' + c.id + '" rows="2"></textarea>' +
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
      fetch('/api/crms/' + id + '/comment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: val }),
      }).then(function () { toast('Comment added'); loadCrms(); });
    }
    function crmsResolve(id) {
      fetch('/api/crms/' + id + '/resolve', { method: 'POST' }).then(function () { toast('Case resolved'); loadCrms(); });
    }

    // ── Top-level render / poll ─────────────────────────────────────────────
    function render() {
      var t = myTeam();
      document.getElementById('teamLine').textContent = t ? (t.unitCode + ' ' + t.vehicleNumber + ' — ' + t.partner) : 'No team selected';
      document.getElementById('teamPickerCard').style.display = vehicleId ? 'none' : 'block';
      document.getElementById('mainSections').style.display = vehicleId ? 'block' : 'none';
      renderTeamPicker();
      if (vehicleId) { renderDeployment(); renderSwap(); loadCrms(); }

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
  </script>
</body>
</html>`);
});

export default router;
