import { Router } from "express";
import { requireManager, getManager } from "./auth";
import { logger } from "../lib/logger";

const router = Router();

// Client-facing Google Maps JS API key — not a secret leak per se (it's
// embedded in a <script src> shipped straight to the browser below), but
// hardcoding it made per-environment keys and rotation harder than an env
// var would. No hard fail if unset: the map on /manager degrading (the
// script tag just won't load) is preferable to the whole dashboard being
// unusable in an environment where nobody's set this up yet.
const MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY ?? "";
if (!MAPS_KEY) {
  logger.warn("[manager] GOOGLE_MAPS_API_KEY is not set — the map on /manager will not load");
}

// ── Manager service worker (must be served from same origin as dashboard) ──────
router.get("/sw-manager.js", (_req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Service-Worker-Allowed", "/");
  res.send(`
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Deployment Manager';
  const options = {
    body: data.body || '',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: data.tag || 'manager-push',
    renotify: true,
    data: { url: data.url || '/manager' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/manager';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
    for (var c of list) { if (c.url.includes('/manager') && 'focus' in c) { return c.focus(); } }
    if (clients.openWindow) return clients.openWindow(url);
  }));
});
`);
});

router.get("/manager", requireManager, (req, res) => {
  const me = getManager(req.session.managerId!);
  const currentUser = JSON.stringify({ username: me?.username ?? "", role: me?.role ?? "manager", mfaEnabled: me?.mfaEnabled ?? false });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.send(/* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Deployment Manager</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0f1117; --card: #1a1d27; --border: #2a2d3a;
      --fg: #f0f2f8; --muted: #7a7f9a; --primary: #4f6ef7;
      --green: #10b981; --amber: #f59e0b; --red: #ef4444;
      --radius: 10px; font-family: system-ui, -apple-system, sans-serif;
    }
    :root[data-theme="light"] {
      --bg: #f1f5f9; --card: #ffffff; --border: #cbd5e1;
      --fg: #0f172a; --muted: #64748b; --primary: #2563eb;
      --green: #059669; --amber: #d97706; --red: #dc2626;
    }
    /* Light mode overrides for hardcoded-dark overlay panels */
    :root[data-theme="light"] #wls-panel {
      background: rgba(255,255,255,0.97); border-color: rgba(239,68,68,0.35);
      color: #1e293b;
    }
    :root[data-theme="light"] #wls-header { border-bottom-color: rgba(0,0,0,.09); }
    :root[data-theme="light"] .wls-station-row { background: rgba(0,0,0,.04); color: #1e293b; }
    :root[data-theme="light"] .wls-group-title { color: #1e293b; }
    :root[data-theme="light"] .wls-badge { background: #dc2626; }
    :root[data-theme="light"] #wls-station-count,
    :root[data-theme="light"] #wls-chevron { color: #64748b; }
    :root[data-theme="light"] .wls-empty { color: #94a3b8; }

    :root[data-theme="light"] #tide-widget {
      background: rgba(248,250,252,0.98); border-color: rgba(2,132,199,0.35); color: #1e293b;
    }
    :root[data-theme="light"] #tide-widget .tw-badge { background: #0284c7; }
    :root[data-theme="light"] #tide-widget .tw-level { color: #0369a1; }
    :root[data-theme="light"] #tide-widget .tw-dir { color: #334155; }
    :root[data-theme="light"] #tide-widget .tw-row { color: #475569; }
    :root[data-theme="light"] #tide-widget .tw-row strong { color: #1e293b; }
    :root[data-theme="light"] #tw-status { color: #64748b; }
    :root[data-theme="light"] #tw-update { color: #94a3b8; }

    :root[data-theme="light"] #crms-detail-box {
      background: #ffffff; border-color: rgba(124,58,237,.3); color: #1e293b;
    }
    :root[data-theme="light"] #crms-detail-box h3 { color: #7c3aed; }
    :root[data-theme="light"] .crms-detail-value { color: #1e293b; }
    :root[data-theme="light"] .crms-detail-label { color: #64748b; }
    :root[data-theme="light"] .crms-comment-item { background: rgba(0,0,0,.04); }
    :root[data-theme="light"] .crms-comment-item .cc-meta { color: #94a3b8; }
    :root[data-theme="light"] .crms-assign-select { background: #f8fafc; color: #1e293b; border-color: rgba(124,58,237,.3); }
    :root[data-theme="light"] .crms-assign-select option,
    :root[data-theme="light"] .crms-assign-select optgroup { background: #f8fafc; color: #1e293b; }
    :root[data-theme="light"] .crms-status-select { background: #f8fafc; color: #1e293b; border-color: rgba(124,58,237,.3); }
    :root[data-theme="light"] .crms-status-select option { background: #f8fafc; color: #1e293b; }
    :root[data-theme="light"] .crms-edit-field { background: #f8fafc; color: #1e293b; border-color: rgba(0,0,0,.15); }
    :root[data-theme="light"] #crms-paste-area { background: rgba(0,0,0,.03); color: #1e293b; }
    :root[data-theme="light"] .crms-card { background: rgba(0,0,0,.02); }
    :root[data-theme="light"] .crms-card:hover { background: rgba(124,58,237,.05); }
    :root[data-theme="light"] .crms-card-addr { color: #475569; }
    :root[data-theme="light"] .crms-card-fp { color: #1e293b; }
    :root[data-theme="light"] .crms-no-cases { color: #94a3b8; }
    :root[data-theme="light"] .crms-clear-btns button { border-color: #cbd5e1; color: #64748b; background: rgba(0,0,0,.03); }
    :root[data-theme="light"] .crms-divider { border-color: rgba(0,0,0,.08); }
    :root[data-theme="light"] #crms-undo-bar { background: #fff1f2; border-color: rgba(239,68,68,.4); color: #b91c1c; }

    :root[data-theme="light"] #rain-timestamp { background: rgba(255,255,255,.92); color: #334155; }
    :root[data-theme="light"] .roster-table td { border-bottom-color: rgba(0,0,0,.06); }
    :root[data-theme="light"] .roster-table tr:hover td { background: #f8fafc; }
    body { background: var(--bg); color: var(--fg); min-height: 100vh; }

    /* ── Header ── */
    header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 24px; border-bottom: 1px solid var(--border);
      background: var(--card); position: sticky; top: 0; z-index: 100;
    }
    .brand { font-size: 17px; font-weight: 700; letter-spacing: -.2px; }
    .brand span { color: var(--primary); }
    .stats { display: flex; gap: 12px; }
    .stat { background: var(--bg); border: 1px solid var(--border); border-radius: 20px;
      padding: 5px 14px; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; }
    .actions { display: flex; gap: 8px; }
    button { cursor: pointer; border: none; font-family: inherit; }
    .btn { padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; }
    .btn-primary { background: var(--primary); color: #fff; }
    .btn-danger { background: var(--red); color: #fff; }
    .btn-sm { padding: 5px 12px; font-size: 12px; border-radius: 6px; }
    .btn-outline { background: transparent; color: var(--fg); border: 1px solid var(--border); }
    .btn:hover { opacity: .85; }

    /* ── Layout ── */
    main { display: grid; grid-template-columns: 1fr 420px; height: calc(100vh - 57px); }
    #map { width: 100%; height: 100%; background: #1a1d27; position: relative; }
    #map-placeholder { position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; color: var(--muted); gap: 8px; font-size: 14px; }

    /* ── Search bar on map ── */
    .map-search {
      position: absolute; top: 14px; left: 50%; transform: translateX(-50%);
      z-index: 10; width: 380px; max-width: calc(100% - 28px);
    }
    .map-search input {
      width: 100%; background: var(--card); border: 1px solid var(--border);
      color: var(--fg); padding: 11px 16px; border-radius: 10px; font-size: 14px;
      font-family: inherit; outline: none; box-shadow: 0 2px 8px rgba(0,0,0,.4);
      box-sizing: border-box;
    }
    .map-search input:focus { border-color: var(--primary); }
    /* Custom autocomplete dropdown */
    .ac-dropdown {
      position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 20;
      background: var(--card); border: 1px solid var(--border); border-radius: 10px;
      box-shadow: 0 4px 16px rgba(0,0,0,.6); overflow: hidden; display: none;
    }
    .ac-item {
      padding: 11px 16px; font-size: 13px; color: var(--fg); cursor: pointer;
      border-top: 1px solid var(--border); line-height: 1.4;
    }
    .ac-item:first-child { border-top: none; }
    .ac-item:hover { background: var(--bg); }
    .ac-item-main { font-weight: 600; }
    .ac-item-sub { font-size: 11px; color: var(--muted); margin-top: 1px; }
    .ac-empty { padding: 12px 16px; font-size: 13px; color: var(--muted); text-align: center; }

    /* ── Sidebar ── */
    aside { border-left: 1px solid var(--border); overflow-y: auto; background: var(--card); display: flex; flex-direction: column; }

    /* ── Tabs ── */
    .tabs { display: flex; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--card); z-index: 10; }
    .tab { flex: 1; padding: 13px; font-size: 13px; font-weight: 600; color: var(--muted);
      background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; }
    .tab.active { color: var(--primary); border-bottom-color: var(--primary); }

    /* ── Panels ── */
    .panel { display: none; padding: 16px; flex-direction: column; gap: 10px; }
    .panel.active { display: flex; }

    /* ── Cards / rows ── */
    .card { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; }
    .row { display: flex; align-items: center; gap: 12px; }
    .avatar { width: 38px; height: 38px; border-radius: 50%; background: #6b7280;
      display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: #fff; flex-shrink: 0; }
    .avatar[data-unit="BU"] { background: #3b82f6; }
    .avatar[data-unit="PJ"] { background: #06b6d4; }
    .avatar[data-unit="WK"] { background: #8b5cf6; }
    .avatar[data-unit="CP"] { background: #f97316; }
    .avatar[data-unit="KG"] { background: #22c55e; }
    .info { flex: 1; min-width: 0; }
    .info strong { display: block; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .info small { color: var(--muted); font-size: 12px; }
    .badge { padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 700; flex-shrink: 0; }
    .badge-green { background: rgba(16,185,129,.15); color: var(--green); }
    .badge-amber { background: rgba(245,158,11,.15); color: var(--amber); }
    .badge-muted { background: rgba(122,127,154,.1); color: var(--muted); }

    /* ── Location rows ── */
    .loc-row { display: flex; align-items: center; gap: 10px; padding: 10px 14px;
      background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); }
    .loc-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .loc-info { flex: 1; min-width: 0; }
    .loc-name { font-size: 13px; font-weight: 600; }
    .loc-meta { font-size: 11px; color: var(--muted); }
    .loc-actions { display: flex; gap: 6px; }
    .icon-btn { width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center;
      justify-content: center; border: 1px solid var(--border); background: transparent; cursor: pointer; color: var(--fg); }
    .icon-btn:hover { background: var(--card); }
    .icon-btn.assign { background: var(--green); border-color: var(--green); color: #fff; }
    .icon-btn.del { background: var(--red); border-color: var(--red); color: #fff; }

    /* ── Section header ── */
    .sec-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
    .sec-title { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .8px; }
    .sec-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .8px; }

    /* ── Empty ── */
    .empty { text-align: center; color: var(--muted); padding: 32px; font-size: 13px; }

    /* ── ETA badge ── */
    .eta { font-size: 14px; font-weight: 700; color: var(--green); flex-shrink: 0; }

    /* ── Modal ── */
    .overlay { position: fixed; inset: 0; background: rgba(0,0,0,.7); z-index: 1000;
      display: none; align-items: center; justify-content: center; }
    .overlay.open { display: flex; }
    .modal { background: var(--card); border: 1px solid var(--border); border-radius: 16px;
      padding: 28px; width: 400px; max-width: 95vw; max-height: 85vh; display: flex; flex-direction: column; }
    #vehicle-picker { overflow-y: auto; flex: 1 1 auto; min-height: 0; }
    .modal h3 { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
    .modal p { color: var(--muted); font-size: 13px; margin-bottom: 20px; }
    label { display: block; font-size: 11px; font-weight: 600; color: var(--muted);
      text-transform: uppercase; letter-spacing: .8px; margin-bottom: 6px; }
    input[type=text], input[type=number] {
      width: 100%; background: var(--bg); border: 1px solid var(--border);
      color: var(--fg); padding: 10px 12px; border-radius: 8px; font-size: 14px;
      font-family: inherit; outline: none; margin-bottom: 14px;
    }
    input:focus { border-color: var(--primary); }
    .coord-row { display: flex; gap: 10px; }
    .coord-row > div { flex: 1; }
    .modal-btns { display: flex; gap: 10px; margin-top: 4px; }
    .modal-btns button { flex: 1; padding: 12px; }
    .error-msg { color: var(--red); font-size: 12px; margin-bottom: 10px; }
    /* Modal search */
    .modal-search-wrap { position: relative; margin-bottom: 14px; }
    .modal-search-wrap input[type=text] { margin-bottom: 0; }
    .modal-ac-dropdown {
      position: absolute; top: calc(100% + 2px); left: 0; right: 0; z-index: 200;
      background: var(--card); border: 1px solid var(--primary); border-radius: 10px;
      box-shadow: 0 4px 16px rgba(0,0,0,.7); overflow: hidden; display: none;
    }
    .loc-confirmed {
      display: flex; align-items: center; gap: 8px; padding: 9px 12px;
      background: rgba(16,185,129,.1); border: 1px solid rgba(16,185,129,.3);
      border-radius: 8px; margin-bottom: 14px; font-size: 12px; color: var(--green);
    }
    .loc-confirmed span { flex: 1; word-break: break-all; }
    .loc-change { font-size: 11px; color: var(--primary); cursor: pointer; white-space: nowrap; }
    .loc-change:hover { text-decoration: underline; }
    .edit-coords { font-size: 12px; color: var(--muted); margin-bottom: 14px; padding: 8px 12px;
      background: var(--bg); border-radius: 8px; border: 1px solid var(--border); }
    /* ── Roster + Alert panels ── */
    .paste-area {
      width: 100%; height: 160px; background: var(--bg); border: 1px solid var(--border);
      border-radius: 8px; color: var(--fg); font-size: 12px; font-family: monospace;
      padding: 10px 12px; resize: vertical; outline: none; box-sizing: border-box;
    }
    .paste-area:focus { border-color: var(--primary); }
    .roster-status { font-size: 12px; color: var(--green); margin-bottom: 10px; }
    .sf-sel { padding: 5px 16px; border-radius: 20px; border: 1px solid var(--border); background: transparent; color: var(--fg); font-size: 13px; font-weight: 600; cursor: pointer; transition: background .15s, color .15s; }
    .sf-sel.active { background: var(--primary); color: #fff; border-color: var(--primary); }
    .roster-table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
    .roster-table th { color: var(--muted); text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--border); }
    .roster-table td { padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,.04); }
    .roster-table tr:hover td { background: var(--bg); }
    .alert-active-box { background: rgba(239,68,68,.1); border: 1px solid var(--red); border-radius: 8px;
      padding: 12px; margin-bottom: 12px; }
    .alert-active-label { font-size: 11px; font-weight: 700; color: var(--red); margin-bottom: 6px; letter-spacing: 1px; }
    .alert-text { font-size: 13px; color: var(--fg); white-space: pre-wrap; margin: 0 0 8px; font-family: monospace; }
    .alert-ack { font-size: 12px; color: var(--muted); }
    .alert-ack-list { font-size: 11px; color: var(--green); margin-top: 4px; line-height: 1.6; }

    /* ── Vehicle picker ── */
    .veh-row { display: flex; align-items: center; gap: 10px; padding: 10px;
      border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px; background: var(--bg); }
    .veh-row button { margin-left: auto; flex-shrink: 0; }

    /* ── Refresh indicator ── */
    .refresh-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
    @keyframes spin { to { transform: rotate(360deg); } }
    .rain-spinner { width:22px; height:22px; border:3px solid rgba(14,165,233,.25); border-top-color:#0ea5e9; border-radius:50%; animation:spin .75s linear infinite; display:inline-block; vertical-align:middle; }

    /* ── Add location via map button ── */
    .map-tip {
      position: absolute; bottom: 16px; left: 16px; z-index: 10;
      background: var(--card); border: 1px solid var(--border); border-radius: 10px;
      padding: 8px 14px; font-size: 12px; color: var(--muted);
    }

    /* ── Report tab ── */
    .report-header { font-size: 13px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .8px; margin-bottom: 8px; }
    .report-date { font-size: 15px; font-weight: 700; color: var(--fg); margin-bottom: 12px; }
    .report-sep { border: none; border-top: 1px solid var(--border); margin: 8px 0 12px; }
    .report-line {
      font-size: 13px; font-family: 'SF Mono', 'Fira Code', monospace;
      color: var(--fg); padding: 7px 10px; border-radius: 6px;
      background: var(--bg); border: 1px solid var(--border); margin-bottom: 6px;
      word-break: break-all; line-height: 1.5;
    }
    .report-line.arrived { border-left: 3px solid var(--green); }
    .report-line.pending { border-left: 3px solid var(--muted); }
    .copy-btn {
      width: 100%; padding: 10px; border-radius: 8px; font-size: 13px; font-weight: 600;
      background: var(--primary); color: #fff; border: none; cursor: pointer; margin-top: 4px;
    }
    .copy-btn:hover { opacity: .85; }
    .arrived-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--green); margin-right: 4px; }

    /* ── Users panel ── */
    .user-row { display: flex; align-items: center; gap: 10px; padding: 10px 14px;
      background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 8px; }
    .user-row .info { flex: 1; min-width: 0; }
    .user-row .info strong { display: block; font-size: 13px; font-weight: 600; }
    .user-row .info small { font-size: 11px; color: var(--muted); }
    .user-actions { display: flex; gap: 6px; }
    .badge-admin { background: rgba(79,110,247,.18); color: #818cf8; }
    .badge-pending { background: rgba(245,158,11,.12); color: var(--amber); }

    /* ── Header user pill ── */
    .user-pill { display: flex; align-items: center; gap: 8px; background: var(--bg); border: 1px solid var(--border);
      border-radius: 20px; padding: 5px 14px; font-size: 13px; font-weight: 600; }
    .logout-btn { padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;
      background: transparent; border: 1px solid var(--border); color: var(--muted); cursor: pointer; }
    .logout-btn:hover { border-color: var(--red); color: var(--red); }

    /* ── WLS Panel (bottom-left of map) ── */
    #wls-panel {
      position: absolute; bottom: 10px; left: 10px; z-index: 5;
      background: rgba(14,16,27,0.92); border: 1px solid rgba(239,68,68,0.3);
      border-radius: 12px; min-width: 280px; max-width: 400px;
      backdrop-filter: blur(6px); box-shadow: 0 4px 20px rgba(0,0,0,.45);
      overflow: hidden; transition: max-height .3s ease;
      max-height: 460px;
    }
    #wls-panel.collapsed { max-height: 38px; overflow: hidden; border-color: rgba(100,116,139,0.3); }
    #wls-header {
      display: flex; align-items: center; gap: 7px; padding: 7px 12px;
      cursor: pointer; border-bottom: 1px solid rgba(255,255,255,.07); user-select: none;
    }
    #wls-panel.collapsed #wls-header { border-bottom-color: transparent; }
    .wls-badge { background: #ef4444; color: #fff; font-size: 10px; font-weight: 700;
      letter-spacing: .5px; padding: 2px 7px; border-radius: 6px; text-transform: uppercase; }
    #wls-station-count { font-size: 10px; color: #94a3b8; margin-left: auto; }
    #wls-chevron { font-size: 10px; color: #64748b; transition: transform .25s; }
    #wls-panel.collapsed #wls-chevron { transform: rotate(180deg); }
    #wls-body { padding: 10px 14px 12px; overflow-y: auto; max-height: 410px; }
    .wls-group { margin-bottom: 14px; }
    .wls-group:last-child { margin-bottom: 0; }
    .wls-group-title { font-size: 12px; font-weight: 700; margin-bottom: 6px; letter-spacing: 0.3px; }
    .wls-station-row { display: flex; align-items: flex-start; gap: 6px;
      padding: 5px 8px; margin-bottom: 3px;
      background: rgba(255,255,255,0.04); border-radius: 6px;
      color: #e2e8f0; font-size: 12px; line-height: 1.45; }
    .wls-station-row:last-child { margin-bottom: 0; }
    .wls-dir { flex-shrink: 0; font-size: 14px; line-height: 1.3; }
    .wls-loc { flex: 1; word-break: break-word; }
    .wls-empty { color: #475569; text-align: center; padding: 14px 0; font-size: 12px; }
    .wls-clear-btn { font-size: 10px; color: #64748b; background: none; border: none;
      cursor: pointer; padding: 0; margin-left: 6px; }
    .wls-clear-btn:hover { color: #ef4444; }

    /* ── Mobile responsive ── */
    #mob-toggle { display: none; }
    @media (max-width: 768px) {
      header { padding: 8px 12px; flex-wrap: wrap; gap: 5px; }
      .brand { font-size: 16px; }
      .stats { display: none; }
      .actions { gap: 5px; flex-wrap: wrap; }
      /* Hide less-important actions; keep theme, sign-out, notif, mob-toggle */
      .actions .btn-outline:not(.logout-btn):not(#notif-btn):not(#theme-btn):not(#refresh-btn) { display: none; }
      #refresh-btn { padding: 6px 10px; font-size: 11px; }
      #theme-btn { padding: 6px 10px; font-size: 16px; }
      .logout-btn { padding: 6px 11px; font-size: 12px; }
      #mob-toggle {
        display: flex; align-items: center; gap: 5px;
        padding: 7px 13px; background: var(--primary); color: #fff;
        border: none; border-radius: 8px; font-size: 12px; font-weight: 700;
        cursor: pointer; white-space: nowrap;
      }
      main {
        display: flex; flex-direction: column;
        height: auto; min-height: calc(100vh - 57px);
      }
      main > div:first-child { height: 45vh; flex-shrink: 0; position: relative; }
      #map { height: 100%; }
      aside {
        flex: 1; border-left: none; border-top: 1px solid var(--border);
        overflow-y: auto; min-height: 55vh;
      }
      /* Map-only / panel-only modes */
      main.mob-map-only > div:first-child { height: calc(100vh - 57px); }
      main.mob-map-only aside { display: none; }
      main.mob-panel-only > div:first-child { height: 0; overflow: hidden; }
      main.mob-panel-only aside { min-height: calc(100vh - 57px); border-top: none; }
      /* Floating map panels — collapsed & compact on mobile */
      #wls-panel {
        left: 8px; bottom: 8px; max-width: calc(100vw - 164px); min-width: 0;
        max-height: 38px; overflow: hidden; border-color: rgba(100,116,139,0.3);
      }
      #wls-panel #wls-chevron { transform: rotate(180deg); }
      #wls-panel.expanded {
        max-height: 220px; overflow: hidden; border-color: rgba(239,68,68,0.3);
      }
      #wls-panel.expanded #wls-chevron { transform: rotate(0deg); }
      #wls-body { max-height: 170px; }
      #tide-widget {
        right: 8px !important; bottom: 8px !important;
        min-width: 0 !important; font-size: 11px;
        padding: 5px 9px !important;
        display: flex !important; align-items: center; gap: 6px;
      }
      #tide-widget .tw-header,
      #tide-widget #tw-status,
      #tide-widget .tw-row,
      #tide-widget .tw-divider { display: none !important; }
      #tide-widget .tw-level { font-size: 14px !important; font-weight: 700; }
      #tide-widget .tw-dir { font-size: 13px !important; }

      /* ── Tabs: horizontal scroll, no wrapping, big tap targets ── */
      .tabs { overflow-x: auto; flex-wrap: nowrap; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
      .tabs::-webkit-scrollbar { display: none; }
      .tab { flex: 0 0 auto; padding: 13px 16px; font-size: 13px; font-weight: 600; white-space: nowrap; min-height: 46px; }

      /* ── Panel body: larger text and bigger touch targets ── */
      .panel { padding: 14px; }
      .info strong { font-size: 15px; }
      .info small { font-size: 13px; }
      .loc-name { font-size: 14px; }
      .loc-meta { font-size: 12px; }
      .icon-btn { width: 36px; height: 36px; font-size: 15px; }
      .loc-row { padding: 12px 14px; }
      .report-line { font-size: 14px; padding: 10px 12px; line-height: 1.6; }
      .copy-btn { padding: 14px; font-size: 14px; }
      .avatar { width: 42px; height: 42px; font-size: 13px; }
      .btn { padding: 10px 18px; font-size: 13px; }
      .btn-sm { padding: 8px 14px; font-size: 12px; }
      .sec-title { font-size: 12px; }
      .badge { font-size: 12px; padding: 4px 12px; }
      .empty { font-size: 14px; }
      .paste-area { font-size: 13px; }
      .veh-row { padding: 12px; }
      .user-row { padding: 12px 14px; }
      .user-row .info strong { font-size: 14px; }
      .user-row .info small { font-size: 12px; }
    }

    /* ── Tide widget ── */
    #tide-widget {
      position: absolute; bottom: 80px; right: 10px; z-index: 5;
      background: rgba(14,16,27,0.92); border: 1px solid rgba(56,189,248,0.25);
      border-radius: 12px; padding: 10px 14px; min-width: 172px;
      backdrop-filter: blur(6px); color: #e2e8f0; font-size: 12px; line-height: 1.5;
      box-shadow: 0 4px 20px rgba(0,0,0,.4);
    }
    #tide-widget .tw-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
    #tide-widget .tw-badge { background: #0ea5e9; color: #fff; font-size: 10px; font-weight: 700;
      letter-spacing: .5px; padding: 2px 7px; border-radius: 6px; text-transform: uppercase; }
    #tide-widget .tw-level { font-size: 22px; font-weight: 700; color: #38bdf8; line-height: 1; }
    #tide-widget .tw-dir { font-size: 13px; }
    #tide-widget .tw-row { display: flex; align-items: baseline; gap: 4px; margin-top: 4px; font-size: 11px; color: #94a3b8; }
    #tide-widget .tw-row strong { color: #e2e8f0; font-size: 12px; }
    #tide-widget .tw-divider { border: none; border-top: 1px solid rgba(255,255,255,.08); margin: 8px 0 6px; }

    /* ── CRMS Tab Panel ── */
    .crms-badge { background: #7c3aed; color: #fff; font-size: 10px; font-weight: 700;
      letter-spacing: .5px; padding: 2px 8px; border-radius: 6px; text-transform: uppercase; }
    #crms-case-count { font-size: 10px; color: #94a3b8; }
    .crms-section-title { font-size: 11px; font-weight: 700; color: #a78bfa;
      letter-spacing: .6px; text-transform: uppercase; margin: 0 0 8px; }
    #crms-tab-badge { background:#7c3aed;color:#fff;border-radius:10px;padding:1px 6px;font-size:10px;margin-left:4px; }
    #tab-crms { color: #a78bfa; }
    #tab-crms.active { color: #c4b5fd; border-bottom-color: #7c3aed; }
    #crms-paste-area {
      width: 100%; box-sizing: border-box; background: rgba(255,255,255,.04);
      border: 1px solid rgba(168,85,247,0.25); border-radius: 8px;
      color: #e2e8f0; font-family: monospace; font-size: 11px; padding: 8px 10px;
      resize: vertical; min-height: 90px; outline: none;
    }
    #crms-paste-area:focus { border-color: rgba(168,85,247,0.6); }
    #crms-ingest-btn {
      width: 100%; margin-top: 8px; background: #7c3aed; color: #fff;
      border: none; border-radius: 8px; padding: 8px; font-size: 13px;
      font-weight: 600; cursor: pointer; transition: background .2s;
    }
    #crms-ingest-btn:disabled { opacity: .5; cursor: not-allowed; }
    #crms-ingest-btn:not(:disabled):hover { background: #6d28d9; }
    #crms-ingest-msg { font-size: 11px; margin-top: 5px; min-height: 16px; }
    .crms-divider { border: none; border-top: 1px solid rgba(255,255,255,.07); margin: 12px 0; }
    .crms-card {
      background: rgba(255,255,255,.04); border: 1px solid rgba(168,85,247,.2);
      border-radius: 9px; padding: 9px 11px; margin-bottom: 8px; cursor: pointer;
      transition: border-color .15s, background .15s;
    }
    .crms-card:hover { background: rgba(168,85,247,.07); border-color: rgba(168,85,247,.5); }
    .crms-card-top { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
    .crms-case-num { font-size: 12px; font-weight: 700; color: #c4b5fd; }
    .crms-status-badge {
      font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 5px;
      text-transform: uppercase; letter-spacing: .5px;
    }
    .crms-status-TO_BE_ASSIGNED { background: rgba(239,68,68,.2); color: #fca5a5; border: 1px solid rgba(239,68,68,.4); }
    .crms-status-TEAM_ACKNOWLEDGE_OTW { background: rgba(245,158,11,.2); color: #fcd34d; border: 1px solid rgba(245,158,11,.4); }
    .crms-status-FP_UPDATED { background: rgba(59,130,246,.2); color: #93c5fd; border: 1px solid rgba(59,130,246,.4); }
    .crms-status-ASSISTANCE_PROVIDED { background: rgba(139,92,246,.2); color: #c4b5fd; border: 1px solid rgba(139,92,246,.4); }
    .crms-status-RESOLVED { background: rgba(34,197,94,.2); color: #86efac; border: 1px solid rgba(34,197,94,.4); }
    .crms-card-addr { font-size: 11px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .crms-card-fp { font-size: 11px; color: #e2e8f0; margin-top: 3px; }
    .crms-card-assign { font-size: 10px; color: #7c3aed; margin-top: 2px; }
    .crms-no-cases { text-align: center; color: #475569; font-size: 12px; padding: 20px 0; }
    .crms-clear-btns { display: flex; gap: 6px; margin-top: 8px; }
    .crms-clear-btns button { flex: 1; font-size: 11px; padding: 5px; border-radius: 6px;
      border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.05);
      color: #94a3b8; cursor: pointer; }
    .crms-clear-btns button:hover { border-color: #ef4444; color: #ef4444; }
    #crms-report-btn {
      width: 100%; margin-top: 8px; background: transparent; color: #a78bfa;
      border: 1px solid rgba(168,85,247,.4); border-radius: 8px; padding: 7px;
      font-size: 12px; font-weight: 600; cursor: pointer;
    }
    #crms-report-btn:hover { background: rgba(168,85,247,.1); }

    /* CRMS detail modal */
    #crms-detail-modal {
      display: none; position: fixed; inset: 0; background: rgba(0,0,0,.6);
      z-index: 1100; align-items: center; justify-content: center;
    }
    #crms-detail-modal.open { display: flex; }
    #crms-detail-box {
      background: #0f1117; border: 1px solid rgba(168,85,247,.4);
      border-radius: 14px; padding: 20px 22px; width: 460px; max-width: 95vw;
      max-height: 85vh; overflow-y: auto;
    }
    #crms-detail-box h3 { margin: 0 0 14px; font-size: 16px; color: #c4b5fd; }
    .crms-detail-row { display: flex; gap: 8px; font-size: 13px; margin-bottom: 8px; }
    .crms-detail-label { color: #64748b; min-width: 80px; flex-shrink: 0; }
    .crms-detail-value { color: #e2e8f0; word-break: break-word; }
    .crms-comment-list { margin-top: 10px; border-top: 1px solid rgba(255,255,255,.07); padding-top: 10px; }
    .crms-comment-item { background: rgba(255,255,255,.04); border-radius: 7px;
      padding: 7px 10px; margin-bottom: 6px; font-size: 12px; }
    .crms-comment-item .cc-meta { color: #64748b; font-size: 10px; margin-bottom: 3px; }
    .crms-assign-select {
      width: 100%; background: #1e2233; border: 1px solid rgba(168,85,247,.3);
      border-radius: 8px; color: #e2e8f0; padding: 7px 10px; font-size: 13px; outline: none;
    }
    .crms-assign-select option, .crms-assign-select optgroup {
      background: #1e2233; color: #e2e8f0;
    }
    .crms-status-select {
      background: #1e2233; border: 1px solid rgba(168,85,247,.3);
      border-radius: 8px; color: #e2e8f0; padding: 5px 8px; font-size: 12px; outline: none;
    }
    .crms-status-select option { background: #1e2233; color: #e2e8f0; }
    .crms-edit-field {
      width: 100%; background: #1a1d2e; border: 1px solid rgba(255,255,255,.15);
      border-radius: 7px; color: #e2e8f0; padding: 6px 9px; font-size: 12px;
      outline: none; box-sizing: border-box; margin-top: 3px;
    }
    .crms-edit-field:focus { border-color: rgba(168,85,247,.6); }
    #crms-pin-banner {
      display: none; position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
      background: #7c3aed; color: #fff; text-align: center; padding: 10px 16px;
      font-size: 13px; font-weight: 600; cursor: pointer;
    }
    #crms-undo-bar {
      display: none; background: #1e2233; border: 1px solid rgba(239,68,68,.4);
      border-radius: 8px; padding: 8px 12px; margin: 8px 0 4px; font-size: 12px;
      color: #fca5a5; display: flex; align-items: center; gap: 8px;
    }
    #crms-hide-resolved-btn.active { background: rgba(168,85,247,.25); color: #c4b5fd; border-color: rgba(168,85,247,.5); }
  </style>
</head>
<body>

<!-- ── Header ── -->
<script>window.CURRENT_USER = ${currentUser};</script>
<header>
  <div class="brand">Deployment <span>Manager</span></div>
  <div class="stats">
    <div class="stat"><div class="dot" style="background:var(--green)"></div><span id="stat-deployed">0 deployed</span></div>
    <div class="stat"><div class="dot" style="background:var(--primary)"></div><span id="stat-live">0 online</span></div>
    <div class="stat"><div class="dot" style="background:var(--muted)"></div><span id="stat-free">0 free slots</span></div>
    <div class="stat"><div class="refresh-dot"></div><span id="last-update">–</span></div>
  </div>
  <div class="actions" style="gap:10px;">
    <div class="user-pill">
      <div class="dot" style="background:var(--green)"></div>
      <span id="header-username"></span>
    </div>
    <button id="theme-btn" class="btn btn-outline btn-sm" onclick="toggleTheme()" title="Toggle light/dark mode" style="font-size:16px;padding:5px 10px;">🌙</button>
    <button class="logout-btn" onclick="openModal('chpw-modal')" title="Change password" style="margin-right:2px;">🔑</button>
    <button id="mfa-header-btn" class="logout-btn" onclick="openMfaModal()" title="Two-factor authentication" style="margin-right:2px;">🛡️</button>
    <button class="logout-btn" onclick="logOut()">Sign out</button>
    <button id="notif-btn" class="btn btn-outline btn-sm" onclick="togglePush()" title="Enable push notifications" style="display:none;">🔔 Notifications</button>
    <button id="refresh-btn" class="btn btn-outline btn-sm" onclick="manualRefresh()" title="Refresh crew positions and data">⟳ Refresh</button>
    <button id="mob-toggle" onclick="cycleMobileView()">🗺 Map</button>
  </div>
</header>

<!-- ── Main ── -->
<main>
  <!-- Map -->
  <div style="position:relative;">
    <div id="map"></div>
    <div class="map-search">
      <input id="search-input" type="text" placeholder="Search address or postal code…" autocomplete="off" />
      <div class="ac-dropdown" id="ac-dropdown"></div>
    </div>
    <div style="position:absolute;bottom:210px;right:10px;z-index:10;display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
      <button id="rain-toggle" onclick="toggleRainRadar()" title="Toggle NEA rain radar" style="background:var(--card);border:1px solid var(--border);color:var(--fg);padding:6px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap;">
        🌧 Rain Radar <span id="rain-status" style="font-weight:400;color:var(--muted);font-size:10px;">OFF</span>
      </button>
      <button id="lightning-toggle" onclick="toggleLightning()" title="Toggle CAT lightning risk layer" style="background:var(--card);border:1px solid var(--border);color:var(--fg);padding:6px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap;">
        ⚡ Lightning <span id="lightning-status" style="font-weight:400;color:var(--muted);font-size:10px;">OFF</span>
      </button>
      <button id="fit-rain-btn" onclick="fitRainRadar()" title="Zoom to full NEA 240km radar coverage" style="display:none;background:var(--card);border:1px solid #38bdf8;color:#38bdf8;padding:6px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;">🌍 Full Radar View</button>
      <button id="sg-view-btn" onclick="returnToSingapore()" title="Return to Singapore view" style="display:none;background:var(--card);border:1px solid var(--primary);color:var(--primary);padding:6px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;">📍 SG View</button>
      <div id="rain-timestamp" style="display:none;background:rgba(0,0,0,.72);color:#7a9cc4;padding:4px 12px;border-radius:6px;font-size:11px;white-space:nowrap;display:flex;align-items:center;gap:8px;"></div>
    </div>

    <!-- ── Map Legend (top-left, collapsible) ── -->
    <div id="map-legend" style="position:absolute;top:14px;left:10px;z-index:10;background:rgba(14,16,27,0.92);border:1px solid rgba(255,255,255,.12);border-radius:10px;backdrop-filter:blur(6px);box-shadow:0 2px 10px rgba(0,0,0,.4);overflow:hidden;">
      <div id="map-legend-header" onclick="toggleLegend()" style="display:flex;align-items:center;gap:7px;padding:6px 10px;cursor:pointer;user-select:none;white-space:nowrap;">
        <span style="font-size:13px;">🗂</span>
        <span style="font-size:11px;font-weight:700;color:#e2e8f0;letter-spacing:.4px;">Map Key</span>
        <span id="map-legend-chevron" style="font-size:9px;color:#64748b;margin-left:2px;transition:transform .2s;">▼</span>
      </div>
      <div id="map-legend-body" style="display:none;padding:4px 12px 10px;border-top:1px solid rgba(255,255,255,.07);">
        <div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:.8px;margin-bottom:7px;">LOCATION PINS</div>
        <div style="display:flex;flex-direction:column;gap:5px;">
          <div style="display:flex;align-items:center;gap:7px;"><span style="width:12px;height:12px;border-radius:50%;background:#6B7280;border:1.5px solid rgba(255,255,255,.4);flex-shrink:0;"></span><span style="font-size:11px;color:#cbd5e1;">Available</span></div>
          <div style="display:flex;align-items:center;gap:7px;"><span style="width:12px;height:12px;border-radius:50%;background:#A78BFA;border:1.5px solid rgba(255,255,255,.4);flex-shrink:0;"></span><span style="font-size:11px;color:#cbd5e1;">Assigned — awaiting crew</span></div>
          <div style="display:flex;align-items:center;gap:7px;"><span style="width:12px;height:12px;border-radius:50%;background:#0EA5E9;border:1.5px solid rgba(255,255,255,.4);flex-shrink:0;"></span><span style="font-size:11px;color:#cbd5e1;">En Route (accepted)</span></div>
          <div style="display:flex;align-items:center;gap:7px;"><span style="width:12px;height:12px;border-radius:50%;background:#86EFAC;border:1.5px solid rgba(255,255,255,.4);flex-shrink:0;"></span><span style="font-size:11px;color:#cbd5e1;">Arrived · No Rain</span></div>
          <div style="display:flex;align-items:center;gap:7px;"><span style="width:12px;height:12px;border-radius:50%;background:#22C55E;border:1.5px solid rgba(255,255,255,.4);flex-shrink:0;"></span><span style="font-size:11px;color:#cbd5e1;">Arrived · Light Rain</span></div>
          <div style="display:flex;align-items:center;gap:7px;"><span style="width:12px;height:12px;border-radius:50%;background:#F97316;border:1.5px solid rgba(255,255,255,.4);flex-shrink:0;"></span><span style="font-size:11px;color:#cbd5e1;">Arrived · Moderate Rain</span></div>
          <div style="display:flex;align-items:center;gap:7px;"><span style="width:12px;height:12px;border-radius:50%;background:#EF4444;border:1.5px solid rgba(255,255,255,.4);flex-shrink:0;"></span><span style="font-size:11px;color:#cbd5e1;">Arrived · Heavy Rain</span></div>
        </div>
        <div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:.8px;margin:9px 0 6px;">VEHICLES</div>
        <div style="display:flex;flex-direction:column;gap:5px;">
          <div style="display:flex;align-items:center;gap:7px;"><span style="font-size:13px;">🚔</span><span style="font-size:11px;color:#cbd5e1;">Car icon — coloured by unit code</span></div>
          <div style="display:flex;align-items:center;gap:7px;"><span style="font-size:13px;">🚔🟢</span><span style="font-size:11px;color:#10b981;">Green dot = Arrived on site</span></div>
        </div>
      </div>
    </div>

    <!-- ── WLS Panel (bottom-left) ── -->
    <div id="wls-panel">
      <div id="wls-header" onclick="toggleWLS()">
        <span class="wls-badge">🌊 WLS</span>
        <span id="wls-title-text" style="font-size:12px;font-weight:600;color:#e2e8f0;">Alert</span>
        <span id="wls-station-count" style="font-size:10px;color:#94a3b8;margin-left:auto;"></span>
        <button class="wls-clear-btn" onclick="event.stopPropagation();clearWLS()" title="Clear all WLS">✕</button>
        <span id="wls-chevron">▲</span>
      </div>
      <div id="wls-body"><div class="wls-empty">No WLS alerts received</div></div>
    </div>

    <!-- ── Tide Widget ── -->
    <div id="tide-widget">
      <div class="tw-header">
        <span class="tw-badge">🌊 Tide</span>
        <span id="tw-update" style="font-size:10px;color:#64748b;margin-left:auto;"></span>
      </div>
      <div style="display:flex;align-items:baseline;gap:8px;">
        <span class="tw-level" id="tw-level">–</span>
        <span class="tw-dir" id="tw-dir"></span>
      </div>
      <div id="tw-status" style="font-size:11px;color:#94a3b8;margin-top:2px;"></div>
      <hr class="tw-divider"/>
      <div class="tw-row" id="tw-high-row"><span>↑ High</span><strong id="tw-high-h">–</strong><span id="tw-high-t" style="margin-left:auto;"></span></div>
      <div class="tw-row" id="tw-low-row" style="margin-top:3px;"><span>↓ Low</span><strong id="tw-low-h">–</strong><span id="tw-low-t" style="margin-left:auto;"></span></div>
    </div>

  </div>

  <!-- ── CRMS Pin-Mode Banner ── -->
  <div id="crms-pin-banner" onclick="crmsExitPinMode()">📍 Click anywhere on the map to set location for this case &nbsp;·&nbsp; Click here or press Esc to cancel</div>

  <!-- ── CRMS Detail Modal ── -->
  <div id="crms-detail-modal" onclick="if(event.target===this)closeCrmsDetail()">
    <div id="crms-detail-box">
      <h3 id="crms-detail-title">CRMS Case</h3>

      <!-- VIEW mode -->
      <div id="crms-view-panel">
        <div class="crms-detail-row">
          <span class="crms-detail-label">Status</span>
          <span class="crms-detail-value">
            <select class="crms-status-select" id="crms-detail-status" onchange="crmsUpdateStatus(this.value)">
              <option value="TO_BE_ASSIGNED">To Be Assigned</option>
              <option value="TEAM_ACKNOWLEDGE_OTW">Team Acknowledge OTW</option>
              <option value="FP_UPDATED">FP Updated</option>
              <option value="ASSISTANCE_PROVIDED">Assistance Provided</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </span>
        </div>
        <div class="crms-detail-row"><span class="crms-detail-label">FP Name</span><span class="crms-detail-value" id="crms-detail-fp"></span></div>
        <div class="crms-detail-row"><span class="crms-detail-label">Contact</span><span class="crms-detail-value" id="crms-detail-contact"></span></div>
        <div class="crms-detail-row"><span class="crms-detail-label">Address</span><span class="crms-detail-value" id="crms-detail-addr"></span></div>
        <div class="crms-detail-row"><span class="crms-detail-label">Details</span><span class="crms-detail-value" id="crms-detail-desc"></span></div>
        <div class="crms-detail-row"><span class="crms-detail-label">Received</span><span class="crms-detail-value" id="crms-detail-received"></span></div>
        <div class="crms-detail-row" id="crms-detail-ack-row" style="display:none;"><span class="crms-detail-label">Team Ack OTW ⏱</span><span class="crms-detail-value" id="crms-detail-ack"></span></div>
        <div class="crms-detail-row" id="crms-detail-fpupdated-row" style="display:none;"><span class="crms-detail-label">FP Updated ⏱</span><span class="crms-detail-value" id="crms-detail-fpupdated"></span></div>
        <div class="crms-detail-row" id="crms-detail-assistance-row" style="display:none;"><span class="crms-detail-label">Assistance Given ⏱</span><span class="crms-detail-value" id="crms-detail-assistance"></span></div>
        <div class="crms-detail-row" id="crms-detail-resolved-row" style="display:none;"><span class="crms-detail-label">Resolved ⏱</span><span class="crms-detail-value" id="crms-detail-resolved"></span></div>
        <div class="crms-detail-row" style="flex-direction:column;gap:4px;">
          <span class="crms-detail-label">Update Provided to FP</span>
          <div style="display:flex;gap:6px;align-items:flex-start;">
            <textarea id="crms-detail-update-fp" rows="2" placeholder="Enter update provided to FP…" style="flex:1;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#e2e8f0;font-size:12px;padding:6px 8px;resize:vertical;font-family:inherit;"></textarea>
            <button onclick="crmsSaveUpdateFP()" style="padding:6px 10px;border-radius:6px;background:rgba(59,130,246,.2);border:1px solid rgba(59,130,246,.4);color:#93c5fd;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap;flex-shrink:0;">💾 Save</button>
          </div>
        </div>
        <div class="crms-detail-row" style="flex-direction:column;gap:4px;">
          <span class="crms-detail-label">Flood Assessment</span>
          <div style="display:flex;gap:6px;align-items:flex-start;">
            <textarea id="crms-detail-flood" rows="2" placeholder="Enter flood assessment…" style="flex:1;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#e2e8f0;font-size:12px;padding:6px 8px;resize:vertical;font-family:inherit;"></textarea>
            <button onclick="crmsSaveFloodAssessment()" style="padding:6px 10px;border-radius:6px;background:rgba(124,58,237,.2);border:1px solid rgba(124,58,237,.4);color:#c4b5fd;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap;flex-shrink:0;">💾 Save</button>
          </div>
        </div>
        <div class="crms-detail-row">
          <span class="crms-detail-label">Assign</span>
          <span class="crms-detail-value" style="flex:1;">
            <select class="crms-assign-select" id="crms-assign-select" onchange="crmsAssign(this.value)">
              <option value="">— Unassigned —</option>
            </select>
          </span>
        </div>
        <div class="crms-comment-list" id="crms-comment-list"></div>
        <div style="display:flex;gap:6px;margin-top:12px;">
          <button onclick="closeCrmsDetail()" style="flex:1;padding:8px;border-radius:8px;background:transparent;border:1px solid rgba(255,255,255,.15);color:#94a3b8;cursor:pointer;">Close</button>
          <button onclick="crmsOpenEdit()" style="flex:1;padding:8px;border-radius:8px;background:rgba(168,85,247,.15);border:1px solid rgba(168,85,247,.4);color:#c4b5fd;cursor:pointer;">✏️ Edit</button>
          <button onclick="crmsDeleteCase()" style="padding:8px 12px;border-radius:8px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);color:#fca5a5;cursor:pointer;">🗑</button>
        </div>
      </div>

      <!-- EDIT mode (hidden by default) -->
      <div id="crms-edit-panel" style="display:none;">
        <div style="font-size:11px;font-weight:700;color:#a78bfa;letter-spacing:.6px;text-transform:uppercase;margin-bottom:10px;">Edit Case</div>
        <label style="font-size:11px;color:#94a3b8;">FP Name</label>
        <input id="crms-edit-fp" class="crms-edit-field" type="text" />
        <label style="font-size:11px;color:#94a3b8;margin-top:8px;display:block;">Contact</label>
        <input id="crms-edit-contact" class="crms-edit-field" type="text" />
        <label style="font-size:11px;color:#94a3b8;margin-top:8px;display:block;">Address</label>
        <input id="crms-edit-addr" class="crms-edit-field" type="text" />
        <label style="font-size:11px;color:#94a3b8;margin-top:8px;display:block;">Details</label>
        <textarea id="crms-edit-desc" class="crms-edit-field" rows="3" style="resize:vertical;"></textarea>
        <div style="display:flex;gap:6px;margin-top:12px;">
          <button onclick="crmsEditSave()" style="flex:1;padding:8px;border-radius:8px;background:rgba(79,110,247,.2);border:1px solid rgba(79,110,247,.4);color:#93c5fd;cursor:pointer;font-weight:600;">💾 Save</button>
          <button onclick="crmsEditCancel()" style="flex:1;padding:8px;border-radius:8px;background:transparent;border:1px solid rgba(255,255,255,.15);color:#94a3b8;cursor:pointer;">Cancel</button>
          <button onclick="crmsEnterPinMode()" title="Click on map to set coordinates" style="padding:8px 12px;border-radius:8px;background:rgba(168,85,247,.15);border:1px solid rgba(168,85,247,.4);color:#c4b5fd;cursor:pointer;">📍</button>
          <button onclick="crmsZoomTo()" title="Zoom to current location" style="padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#64748b;cursor:pointer;font-size:13px;">🔍</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Sidebar -->
  <aside>
    <div class="tabs" style="flex-wrap:wrap;">
      <button class="tab active" onclick="switchTab('deployed',this)">Deployed</button>
      <button class="tab" onclick="switchTab('vehicles',this)">Vehicles</button>
      <button class="tab" onclick="switchTab('locations',this)">Locations</button>
      <button class="tab" onclick="switchTab('report',this)">Report</button>
      <button class="tab" onclick="switchTab('roster',this)" id="tab-roster">Roster</button>
      <button class="tab" onclick="switchTab('alert',this)" id="tab-alert">Alert <span id="alert-badge" style="display:none;background:var(--red);color:#fff;border-radius:10px;padding:1px 6px;font-size:10px;margin-left:4px;">!</span></button>
      <button class="tab" onclick="switchTab('users',this)" id="tab-users" style="display:none;">Users <span id="users-badge" style="display:none;background:var(--amber);color:#fff;border-radius:10px;padding:1px 6px;font-size:10px;margin-left:4px;"></span></button>
      <button class="tab" onclick="switchTab('crms',this)" id="tab-crms" style="color:#a78bfa;">📋 CRMS <span id="crms-tab-badge" style="display:none;"></span></button>
    </div>

    <!-- Deployed panel -->
    <div class="panel active" id="panel-deployed">
      <div id="deployed-panel-header" class="sec-header" style="display:none;margin-bottom:10px;">
        <span class="sec-title">Active Deployment</span>
        <button id="reset-btn" class="btn btn-danger btn-sm" onclick="confirmReset()">↺ Clear All</button>
      </div>
      <div id="deployed-list"><div class="empty">Loading…</div></div>
    </div>

    <!-- Vehicles panel -->
    <div class="panel" id="panel-vehicles">
      <div id="vehicles-list"><div class="empty">Loading…</div></div>
    </div>

    <!-- Locations panel -->
    <div class="panel" id="panel-locations">
      <div class="sec-header">
        <span class="sec-title" id="loc-count">Locations</span>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-primary btn-sm" id="auto-assign-btn" onclick="autoAssign()">⚡ Auto-Assign</button>
          <button class="btn btn-sm" id="rain-assign-btn" onclick="openRainAssignModal()" style="background:#082f49;color:#38bdf8;border:1px solid #0284c7;">⛈ Rain</button>
          <button class="btn btn-sm" onclick="clearAssignments()" style="background:#1a1d2e;color:#f87171;border:1px solid #7f1d1d;" title="Clear all pending assignments">✕ Clear</button>
          <button class="btn btn-primary btn-sm" onclick="openAddModal()">+ Add</button>
        </div>
      </div>
      <div id="locations-list"><div class="empty">Loading…</div></div>
    </div>

    <!-- Report panel -->
    <div class="panel" id="panel-report">
      <div class="report-header">Deployment Report</div>
      <div id="report-date" class="report-date">–</div>
      <hr class="report-sep" />
      <div id="report-lines"><div class="empty">No deployments yet.</div></div>
      <button class="copy-btn" onclick="copyReport()">Copy Report</button>
    </div>

    <!-- Roster panel -->
    <div class="panel" id="panel-roster">
      <div class="sec-header">
        <span class="sec-title">Daily Roster</span>
        <button class="btn btn-danger btn-sm" onclick="clearRoster()">Clear</button>
      </div>
      <div id="roster-status" class="roster-status"></div>
      <div id="roster-date" style="font-size:11px;color:var(--muted);margin-bottom:6px;display:none;"></div>
      <textarea id="roster-input" class="paste-area" placeholder="Paste your deployment list here…
e.g.
BU1 TST0004A: Officer-14 &amp; Officer-16 (DAY)
WK3 : Officer-28 (ND)"></textarea>
      <button class="btn btn-primary" style="width:100%;margin-top:8px;" onclick="importRoster()">Parse &amp; Save Roster</button>
      <div id="roster-error" class="error-msg" style="margin-top:8px;"></div>
      <div id="roster-team-filter" style="display:none;flex-direction:row;flex-wrap:wrap;gap:6px;margin-top:12px;margin-bottom:4px;"></div>
      <div id="roster-table"></div>

      <!-- Shift selector — shown after roster is loaded -->
      <div id="shift-selector" style="display:none;margin-top:16px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--muted);letter-spacing:.8px;margin-bottom:8px;">On Duty Shifts for Deployment</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          <button id="sf-DAY"  class="sf-sel" data-shift="DAY"  onclick="toggleShift('DAY')" >DAY</button>
          <button id="sf-PD"   class="sf-sel" data-shift="PD"   onclick="toggleShift('PD')"  >PD</button>
          <button id="sf-ND"   class="sf-sel" data-shift="ND"   onclick="toggleShift('ND')"  >ND</button>
        </div>
        <button class="btn btn-primary btn-sm" onclick="saveActiveShifts()">Save</button>
        <span id="shift-save-msg" style="font-size:12px;color:var(--green);margin-left:10px;"></span>
      </div>
    </div>

    <!-- Alert panel -->
    <div class="panel" id="panel-alert">
      <div class="sec-header">
        <span class="sec-title">NEA Alert Broadcast</span>
        <button class="btn btn-danger btn-sm" onclick="clearAlert()">Clear</button>
      </div>
      <div id="alert-active-box" style="display:none;" class="alert-active-box">
        <div class="alert-active-label">🔴 ACTIVE ALERT</div>
        <pre id="alert-active-text" class="alert-text"></pre>
        <div id="alert-ack-count" class="alert-ack"></div>
        <div id="alert-ack-list" class="alert-ack-list"></div>
      </div>
      <textarea id="alert-input" class="paste-area" placeholder="Paste NEA message here…
e.g.
National Environment Agency
---
HEAVY RAIN WARNING
Moderate/heavy showers .south,west areas...
Frm:MSS,1529H 7Jan26
---
This is an automated message…"></textarea>
      <button class="btn btn-danger" style="width:100%;margin-top:8px;" onclick="broadcastAlert()">📢 Extract &amp; Broadcast to Crews</button>
      <div id="alert-error" class="error-msg" style="margin-top:8px;"></div>
    </div>

    <!-- Users panel (admin only) -->
    <div class="panel" id="panel-users">
      <div class="sec-header" style="margin-bottom:12px;">
        <span class="sec-title">Manager Accounts</span>
        <button class="btn btn-primary btn-sm" onclick="loadUsers()">↻ Refresh</button>
      </div>
      <div id="users-list"><div class="empty">Loading…</div></div>

      <!-- Mobile Manager PIN -->
      <div style="margin-top:20px;border-top:1px solid var(--border);padding-top:16px;">
        <div class="sec-header" style="margin-bottom:8px;">
          <span class="sec-title" style="font-size:13px;">Mobile Manager PIN</span>
        </div>
        <p style="font-size:12px;color:var(--muted);margin:0 0 10px;">4–8 digit PIN required to access the Manager tab on the phone app.</p>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="password" id="pin-input" maxlength="8" placeholder="Current PIN hidden" style="flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:14px;background:var(--bg);color:var(--fg);" />
          <button class="btn btn-primary btn-sm" onclick="updatePin()">Save PIN</button>
        </div>
        <div id="pin-msg" style="font-size:12px;margin-top:6px;display:none;"></div>
      </div>

      <!-- Mobile Crew PIN -->
      <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:16px;">
        <div class="sec-header" style="margin-bottom:8px;">
          <span class="sec-title" style="font-size:13px;">Mobile Crew PIN</span>
        </div>
        <p style="font-size:12px;color:var(--muted);margin:0 0 10px;">4–8 digit PIN required for crew members to log in on the phone app.</p>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="password" id="crew-pin-input" maxlength="8" placeholder="Current PIN hidden" style="flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:14px;background:var(--bg);color:var(--fg);" />
          <button class="btn btn-primary btn-sm" onclick="updateCrewPin()">Save PIN</button>
        </div>
        <div id="crew-pin-msg" style="font-size:12px;margin-top:6px;display:none;"></div>
      </div>
    </div>

    <!-- ── CRMS Panel ── -->
    <div class="panel" id="panel-crms" style="gap:0;padding:0;">

      <!-- Ingest section -->
      <div style="padding:14px 16px 12px;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <span class="crms-badge">📋 CRMS</span>
          <span style="font-size:13px;font-weight:600;color:#e2e8f0;">Case Management</span>
          <span id="crms-case-count" style="font-size:11px;color:#64748b;margin-left:auto;"></span>
        </div>
        <p class="crms-section-title">Ingest CRMS Message</p>
        <textarea id="crms-paste-area" placeholder="Paste forwarded email/SMS here…&#10;&#10;From xyz@pub.gov.sg&#10;WOG CRMS: 12345 FP: John Tan, 91234567 Add: 1 Orchard Rd Singapore 238801 Details: Flooding at entrance"></textarea>
        <button id="crms-ingest-btn" onclick="crmsIngest()">📥 Parse &amp; Geocode</button>
        <div id="crms-ingest-msg" style="font-size:12px;margin-top:6px;min-height:18px;"></div>
      </div>

      <!-- Cases section -->
      <div style="padding:14px 16px 0;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <p class="crms-section-title" style="margin:0;">Active Cases <span id="crms-open-count" style="font-weight:400;color:#64748b;text-transform:none;letter-spacing:0;font-size:11px;"></span></p>
          <button onclick="crmsRefreshManual()" title="Refresh cases" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:18px;line-height:1;padding:0;">↻</button>
        </div>
        <div id="crms-cases-list"><div class="crms-no-cases">No cases yet</div></div>
      </div>

      <!-- Action buttons -->
      <div style="padding:10px 16px 14px;margin-top:4px;">
        <div class="crms-clear-btns">
          <button id="crms-hide-resolved-btn" onclick="crmsToggleHideResolved()" title="Toggle visibility of resolved cases">Hide Resolved</button>
          <button onclick="crmsClearAll()" title="Clear ALL cases" style="color:#ef4444;">Clear All</button>
        </div>
        <div id="crms-undo-bar" style="display:none;">
          <span id="crms-undo-msg" style="flex:1;">All cases cleared.</span>
          <button onclick="crmsClearAllUndo()" style="background:#7c3aed;color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;font-weight:600;">↩ Undo (<span id="crms-undo-sec">10</span>s)</button>
        </div>
        <div style="display:flex;gap:6px;margin-top:6px;">
          <button id="crms-report-btn" onclick="crmsDownloadReport()" style="flex:1;">⬇ Download Report</button>
          <button onclick="crmsCopySummary()" title="Copy summary to clipboard" style="padding:6px 10px;border-radius:8px;background:rgba(79,110,247,.15);border:1px solid rgba(79,110,247,.4);color:#93c5fd;cursor:pointer;font-size:12px;font-weight:600;">📋 Copy</button>
        </div>
      </div>
    </div>
  </aside>
</main>

<!-- ── Add/Edit Location Modal ── -->
<div class="overlay" id="loc-modal">
  <div class="modal">
    <h3 id="modal-title">Add Location</h3>
    <p id="modal-sub">Search for the spot on the map, then give it a name.</p>

    <!-- Search (Add mode) -->
    <div id="modal-search-section">
      <label>Search Location</label>
      <div class="modal-search-wrap">
        <input type="text" id="modal-loc-search" placeholder="Address, road name or postal code…" autocomplete="off" />
        <div id="modal-ac-dropdown" class="modal-ac-dropdown"></div>
      </div>
      <!-- Confirmed location pill (shown after picking a result) -->
      <div id="loc-confirmed" class="loc-confirmed" style="display:none;">
        📍 <span id="loc-confirmed-text"></span>
        <span class="loc-change" onclick="clearModalLocation()">Change</span>
      </div>
    </div>

    <!-- Edit mode: show current coords read-only -->
    <div id="loc-edit-coords" class="edit-coords" style="display:none;"></div>

    <!-- Hidden coordinate storage -->
    <input type="hidden" id="loc-lat" />
    <input type="hidden" id="loc-lng" />

    <label>Name <small style="font-weight:400;color:var(--muted);font-size:11px;">(auto-filled, rename if needed)</small></label>
    <input type="text" id="loc-name" placeholder="e.g. Yarwood Ave" />

    <div style="display:flex;gap:10px;">
      <div style="flex:1;">
        <label>Region <small style="font-weight:400;color:var(--muted);font-size:11px;">(e.g. BU, PJ, WK, KG, CP)</small></label>
        <input type="text" id="loc-region" placeholder="BU" style="text-transform:uppercase;" />
      </div>
      <div style="flex:1;">
        <label>Priority <small style="font-weight:400;color:var(--muted);font-size:11px;">(1 = highest)</small></label>
        <input type="number" id="loc-priority" placeholder="1" min="1" max="99" />
      </div>
    </div>

    <div class="error-msg" id="loc-error"></div>
    <div class="modal-btns">
      <button class="btn btn-outline" onclick="closeModal('loc-modal');if(pendingMarker){pendingMarker.setMap(null);pendingMarker=null;pendingPin=null;}">Cancel</button>
      <button class="btn btn-primary" onclick="saveLocation()">Save</button>
    </div>
  </div>
</div>

<!-- ── Generic Confirm Modal ── -->
<div class="overlay" id="confirm-modal">
  <div class="modal" style="max-width:340px;">
    <h3 id="confirm-title" style="margin-bottom:10px;">Confirm</h3>
    <p id="confirm-body" style="color:var(--muted);font-size:14px;margin-bottom:20px;"></p>
    <div class="modal-btns">
      <button class="btn btn-outline" onclick="closeModal('confirm-modal');_confirmReject&&_confirmReject();">Cancel</button>
      <button class="btn" id="confirm-ok-btn" style="background:#ef4444;color:#fff;border:none;" onclick="closeModal('confirm-modal');_confirmResolve&&_confirmResolve();">Delete</button>
    </div>
  </div>
</div>

<!-- ── Assign Crew Modal ── -->
<div class="overlay" id="chpw-modal">
  <div class="modal" style="max-width:380px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <h3>Change Password</h3>
      <button onclick="closeModal('chpw-modal')" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted);line-height:1;padding:0;">×</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <input id="chpw-current" type="password" placeholder="Current password"
        style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--fg);padding:10px 14px;border-radius:8px;font-size:14px;font-family:inherit;outline:none;" />
      <input id="chpw-new" type="password" placeholder="New password (min 8 chars)"
        style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--fg);padding:10px 14px;border-radius:8px;font-size:14px;font-family:inherit;outline:none;" />
      <input id="chpw-confirm" type="password" placeholder="Confirm new password"
        style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--fg);padding:10px 14px;border-radius:8px;font-size:14px;font-family:inherit;outline:none;" />
      <div id="chpw-msg" style="font-size:13px;min-height:18px;"></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px;">
      <button class="btn btn-outline" style="flex:1;" onclick="closeModal('chpw-modal')">Cancel</button>
      <button class="btn btn-primary" style="flex:1;" onclick="submitChangePassword()">Update Password</button>
    </div>
  </div>
</div>

<!-- Two-factor authentication (TOTP) modal -->
<div class="overlay" id="mfa-modal">
  <div class="modal" style="max-width:380px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <h3>Two-Factor Authentication</h3>
      <button onclick="closeModal('mfa-modal')" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted);line-height:1;padding:0;">×</button>
    </div>

    <!-- Enabled state: offer to disable -->
    <div id="mfa-enabled-view" style="display:none;">
      <p style="font-size:13px;color:var(--green);margin-bottom:14px;">✓ Two-factor authentication is ON for this account.</p>
      <p style="font-size:12px;color:var(--muted);margin-bottom:10px;">Enter a current code from your authenticator app to turn it off.</p>
      <input id="mfa-disable-code" type="text" inputmode="numeric" maxlength="6" placeholder="123456"
        style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--fg);padding:10px 14px;border-radius:8px;font-size:14px;font-family:inherit;outline:none;letter-spacing:2px;" />
      <div id="mfa-disable-msg" style="font-size:13px;min-height:18px;margin-top:8px;"></div>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button class="btn btn-outline" style="flex:1;" onclick="closeModal('mfa-modal')">Close</button>
        <button class="btn" style="flex:1;background:var(--red);color:#fff;border:none;" onclick="submitMfaDisable()">Disable</button>
      </div>
    </div>

    <!-- Not set up yet: offer to start enrollment -->
    <div id="mfa-intro-view">
      <p style="font-size:12px;color:var(--muted);margin-bottom:14px;">Adds a 6-digit code from an authenticator app (Microsoft Authenticator, Google Authenticator, etc.) as a second step at login.</p>
      <button class="btn btn-primary" style="width:100%;" onclick="startMfaSetup()">Set Up Two-Factor Authentication</button>
    </div>

    <!-- Enrollment in progress: show QR + manual key, ask for a confirmation code -->
    <div id="mfa-setup-view" style="display:none;">
      <p style="font-size:12px;color:var(--muted);margin-bottom:10px;">Scan this with your authenticator app, or choose "enter a setup key" and type the code below.</p>
      <div style="text-align:center;margin-bottom:10px;">
        <img id="mfa-qr-img" alt="MFA setup QR code" style="width:180px;height:180px;border-radius:8px;background:#fff;padding:8px;" />
      </div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">Setup key</div>
      <div id="mfa-secret-text" style="font-family:monospace;font-size:13px;letter-spacing:1px;word-break:break-all;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-bottom:14px;"></div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">Enter the 6-digit code it shows</div>
      <input id="mfa-verify-code" type="text" inputmode="numeric" maxlength="6" placeholder="123456"
        style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--fg);padding:10px 14px;border-radius:8px;font-size:14px;font-family:inherit;outline:none;letter-spacing:2px;" />
      <div id="mfa-setup-msg" style="font-size:13px;min-height:18px;margin-top:8px;"></div>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button class="btn btn-outline" style="flex:1;" onclick="closeModal('mfa-modal')">Cancel</button>
        <button class="btn btn-primary" style="flex:1;" onclick="submitMfaVerifySetup()">Confirm &amp; Enable</button>
      </div>
      <div style="text-align:center;margin-top:10px;">
        <a href="javascript:void(0)" onclick="restartMfaSetup()" style="font-size:11px;color:var(--muted);text-decoration:underline;">Scan didn't work? Get a new QR code</a>
      </div>
    </div>
  </div>
</div>

<!-- Reset Password modal (admin only) -->
<div class="overlay" id="reset-pw-modal">
  <div class="modal" style="max-width:380px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
      <h3>Reset Password</h3>
      <button onclick="closeModal('reset-pw-modal')" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted);line-height:1;padding:0;">×</button>
    </div>
    <div id="reset-pw-username" style="font-size:13px;color:var(--muted);margin-bottom:14px;"></div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <input id="reset-pw-new" type="password" placeholder="New password (min 8 chars)"
        style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--fg);padding:10px 14px;border-radius:8px;font-size:14px;font-family:inherit;outline:none;" />
      <input id="reset-pw-confirm" type="password" placeholder="Confirm new password"
        style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--fg);padding:10px 14px;border-radius:8px;font-size:14px;font-family:inherit;outline:none;" />
      <div id="reset-pw-msg" style="font-size:13px;min-height:18px;"></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px;">
      <button class="btn btn-outline" style="flex:1;" onclick="closeModal('reset-pw-modal')">Cancel</button>
      <button class="btn btn-primary" style="flex:1;" onclick="submitResetPassword()">Set Password</button>
    </div>
  </div>
</div>

<div class="overlay" id="assign-modal">
  <div class="modal">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:4px;">
      <div>
        <h3 style="margin-bottom:2px;">Assign Crew</h3>
        <p id="assign-sub" style="margin-bottom:0;">Select a vehicle to send to this location.</p>
      </div>
      <button onclick="closeModal('assign-modal')" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted);line-height:1;padding:0 0 0 12px;flex-shrink:0;" title="Close">×</button>
    </div>
    <div id="assign-loc-pill" style="background:var(--primary);color:#fff;border-radius:8px;padding:6px 14px;font-size:13px;font-weight:600;margin:12px 0 16px;display:none;"></div>
    <div id="vehicle-picker" style="overflow-y:auto;flex:1 1 auto;min-height:0;"><div id="vehicle-picker-list"><div class="empty">No vehicles online.</div></div></div>
    <div style="margin-top:14px;flex-shrink:0;">
      <button class="btn btn-outline" style="width:100%" onclick="closeModal('assign-modal')">Close</button>
    </div>
  </div>
</div>

<script>
const API = '/api';
const ME = window.CURRENT_USER || {};

// ── Auth init ─────────────────────────────────────────────────────────────────
(function initAuth() {
  var el = document.getElementById('header-username');
  if (el) el.textContent = ME.username || '';
  if (ME.role === 'admin') {
    var tab = document.getElementById('tab-users');
    if (tab) tab.style.display = '';
    var deployedHeader = document.getElementById('deployed-panel-header');
    if (deployedHeader) deployedHeader.style.display = '';
  }
})();

// ── Mobile view toggle ──────────────────────────────────────────────────────
var mobViewState = 'split'; // 'split' | 'map' | 'panel'
function cycleMobileView() {
  var main = document.querySelector('main');
  var btn = document.getElementById('mob-toggle');
  if (mobViewState === 'split') {
    mobViewState = 'map';
    main.classList.remove('mob-panel-only');
    main.classList.add('mob-map-only');
    btn.textContent = '☰ Panel';
  } else if (mobViewState === 'map') {
    mobViewState = 'panel';
    main.classList.remove('mob-map-only');
    main.classList.add('mob-panel-only');
    btn.textContent = '⊞ Split';
  } else {
    mobViewState = 'split';
    main.classList.remove('mob-map-only', 'mob-panel-only');
    btn.textContent = '🗺 Map';
  }
  // Invalidate Leaflet map so tiles re-render after resize
  setTimeout(function() { try { map && map.invalidateSize(); } catch(e) {} }, 100);
}

async function logOut() {
  await fetch('/manager/auth/logout', { method: 'POST' });
  window.location.href = '/manager/login';
}

async function submitChangePassword() {
  var cur = document.getElementById('chpw-current').value;
  var nw  = document.getElementById('chpw-new').value;
  var cfm = document.getElementById('chpw-confirm').value;
  var msg = document.getElementById('chpw-msg');
  msg.style.color = 'var(--red)';
  if (!cur || !nw || !cfm) { msg.textContent = 'All fields are required.'; return; }
  if (nw.length < 8)       { msg.textContent = 'New password must be at least 8 characters.'; return; }
  if (nw !== cfm)          { msg.textContent = 'New passwords do not match.'; return; }
  msg.style.color = 'var(--muted)';
  msg.textContent = 'Updating…';
  try {
    var r = await fetch('/manager/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: cur, newPassword: nw }),
    });
    var d = await r.json();
    if (!r.ok) { msg.style.color='var(--red)'; msg.textContent = d.error || 'Failed.'; return; }
    msg.style.color = 'var(--green)';
    msg.textContent = '✓ Password updated successfully.';
    document.getElementById('chpw-current').value = '';
    document.getElementById('chpw-new').value = '';
    document.getElementById('chpw-confirm').value = '';
    setTimeout(function() { closeModal('chpw-modal'); msg.textContent=''; }, 1800);
  } catch(e) {
    msg.style.color = 'var(--red)';
    msg.textContent = 'Network error — please try again.';
  }
}

// ── Two-factor authentication (self-service) ────────────────────────────────
// Caches the QR/secret from the most recent /mfa/setup call so reopening the
// modal (e.g. after tabbing away to an authenticator app) resumes the same
// in-progress enrollment instead of silently resetting to the intro screen —
// which used to also mean the *next* "Set Up" click minted a brand-new
// secret, invalidating whatever had just been scanned.
var _mfaSetupPending = null;

function openMfaModal() {
  document.getElementById('mfa-disable-code').value = '';
  document.getElementById('mfa-disable-msg').textContent = '';
  if (ME.mfaEnabled) {
    document.getElementById('mfa-enabled-view').style.display = '';
    document.getElementById('mfa-intro-view').style.display = 'none';
    document.getElementById('mfa-setup-view').style.display = 'none';
  } else if (_mfaSetupPending) {
    document.getElementById('mfa-enabled-view').style.display = 'none';
    document.getElementById('mfa-intro-view').style.display = 'none';
    document.getElementById('mfa-setup-view').style.display = '';
    document.getElementById('mfa-qr-img').src = _mfaSetupPending.qrCodeDataUrl;
    document.getElementById('mfa-secret-text').textContent = _mfaSetupPending.secret;
    document.getElementById('mfa-verify-code').value = '';
    document.getElementById('mfa-setup-msg').textContent = '';
  } else {
    document.getElementById('mfa-enabled-view').style.display = 'none';
    document.getElementById('mfa-intro-view').style.display = '';
    document.getElementById('mfa-setup-view').style.display = 'none';
  }
  openModal('mfa-modal');
}

async function startMfaSetup() {
  try {
    var r = await fetch('/manager/auth/mfa/setup', { method: 'POST' });
    var d = await r.json();
    if (!r.ok) { alert(d.error || 'Could not start MFA setup.'); return; }
    _mfaSetupPending = { qrCodeDataUrl: d.qrCodeDataUrl, secret: d.secret };
    document.getElementById('mfa-qr-img').src = d.qrCodeDataUrl;
    document.getElementById('mfa-secret-text').textContent = d.secret;
    document.getElementById('mfa-verify-code').value = '';
    document.getElementById('mfa-setup-msg').textContent = '';
    document.getElementById('mfa-intro-view').style.display = 'none';
    document.getElementById('mfa-setup-view').style.display = '';
  } catch(e) {
    alert('Network error — please try again.');
  }
}

async function submitMfaVerifySetup() {
  var code = document.getElementById('mfa-verify-code').value.trim();
  var msg = document.getElementById('mfa-setup-msg');
  msg.style.color = 'var(--red)';
  if (!/^[0-9]{6}$/.test(code)) { msg.textContent = 'Enter the 6-digit code.'; return; }
  msg.style.color = 'var(--muted)';
  msg.textContent = 'Verifying…';
  try {
    var r = await fetch('/manager/auth/mfa/verify-setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code }),
    });
    var d = await r.json();
    if (!r.ok) { msg.style.color = 'var(--red)'; msg.textContent = d.error || 'Incorrect code.'; return; }
    _mfaSetupPending = null;
    ME.mfaEnabled = true;
    msg.style.color = 'var(--green)';
    msg.textContent = '✓ Two-factor authentication is now on.';
    setTimeout(function() { closeModal('mfa-modal'); msg.textContent = ''; }, 1800);
  } catch(e) {
    msg.style.color = 'var(--red)';
    msg.textContent = 'Network error — please try again.';
  }
}

// Scraps the in-progress secret/QR and gets a fresh one — for when a scan
// genuinely didn't take, rather than the accidental-reset case above.
function restartMfaSetup() {
  _mfaSetupPending = null;
  startMfaSetup();
}

async function submitMfaDisable() {
  var code = document.getElementById('mfa-disable-code').value.trim();
  var msg = document.getElementById('mfa-disable-msg');
  msg.style.color = 'var(--red)';
  if (!/^[0-9]{6}$/.test(code)) { msg.textContent = 'Enter the 6-digit code.'; return; }
  msg.style.color = 'var(--muted)';
  msg.textContent = 'Verifying…';
  try {
    var r = await fetch('/manager/auth/mfa/disable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code }),
    });
    var d = await r.json();
    if (!r.ok) { msg.style.color = 'var(--red)'; msg.textContent = d.error || 'Incorrect code.'; return; }
    ME.mfaEnabled = false;
    msg.style.color = 'var(--green)';
    msg.textContent = '✓ Two-factor authentication turned off.';
    setTimeout(function() { closeModal('mfa-modal'); msg.textContent = ''; }, 1800);
  } catch(e) {
    msg.style.color = 'var(--red)';
    msg.textContent = 'Network error — please try again.';
  }
}

async function loadUsers() {
  var list = document.getElementById('users-list');
  if (!list) return;
  list.innerHTML = '<div class="empty">Loading…</div>';
  try {
    var res = await fetch('/manager/auth/managers');
    if (!res.ok) { list.innerHTML = '<div class="empty">Failed to load users.</div>'; return; }
    var users = await res.json();
    if (!users.length) { list.innerHTML = '<div class="empty">No accounts yet.</div>'; return; }

    // Badge: pending approvals + pending reset requests
    var pending = users.filter(function(u) { return !u.approved && u.role !== 'admin'; });
    var pendingResets = users.filter(function(u) { return u.hasPendingReset; });
    var totalBadge = pending.length + pendingResets.length;
    var badge = document.getElementById('users-badge');
    if (badge) {
      badge.textContent = totalBadge > 0 ? String(totalBadge) : '';
      badge.style.display = totalBadge > 0 ? '' : 'none';
    }

    list.innerHTML = users.map(function(u) {
      var roleClass = u.role === 'admin' ? 'badge badge-admin' : (u.approved ? 'badge badge-green' : 'badge badge-pending');
      var roleLabel = u.role === 'admin' ? 'Admin' : (u.approved ? 'Manager' : 'Pending');
      var date = u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-SG', { day:'numeric', month:'short', year:'numeric' }) : '';
      var actions = '';
      // Pending reset request — show approve/decline prominently
      if (u.hasPendingReset) {
        var resetTime = u.resetRequestedAt ? ' (' + new Date(u.resetRequestedAt).toLocaleTimeString('en-SG', { hour:'2-digit', minute:'2-digit' }) + ')' : '';
        actions += '<span style="font-size:10px;color:var(--amber);font-weight:700;margin-right:4px;">🔑 Reset req' + resetTime + '</span>';
        actions += '<button class="btn btn-primary btn-sm" onclick="approveReset(\\''+u.id+'\\',\\''+u.username+'\\')">Approve</button>';
        actions += '<button class="btn btn-sm" style="background:var(--red);color:#fff;" onclick="declineReset(\\''+u.id+'\\')">Decline</button>';
      } else if (u.role !== 'admin') {
        if (!u.approved) {
          actions += '<button class="btn btn-primary btn-sm" onclick="approveUser(\\''+u.id+'\\')">Approve</button>';
        } else {
          actions += '<button class="btn btn-outline btn-sm" style="color:var(--amber);border-color:var(--amber);" onclick="revokeUser(\\''+u.id+'\\')">Revoke</button>';
        }
        actions += '<button class="btn btn-outline btn-sm" style="color:var(--primary);border-color:var(--primary);" onclick="resetUserPassword(\\''+u.id+'\\',\\''+u.username+'\\')">Reset PW</button>';
        if (u.mfaEnabled) {
          actions += '<button class="btn btn-outline btn-sm" style="color:var(--amber);border-color:var(--amber);" onclick="resetUserMfa(\\''+u.id+'\\',\\''+u.username+'\\')" title="Clear their MFA if they lost their device">Reset MFA</button>';
        }
        actions += '<button class="btn btn-sm" style="background:var(--red);color:#fff;" onclick="deleteUser(\\''+u.id+'\\')">Delete</button>';
      } else {
        actions += '<button class="btn btn-outline btn-sm" style="color:var(--primary);border-color:var(--primary);" onclick="resetUserPassword(\\''+u.id+'\\',\\''+u.username+'\\')">Reset PW</button>';
        if (u.mfaEnabled) {
          actions += '<button class="btn btn-outline btn-sm" style="color:var(--amber);border-color:var(--amber);" onclick="resetUserMfa(\\''+u.id+'\\',\\''+u.username+'\\')" title="Clear their MFA if they lost their device">Reset MFA</button>';
        }
      }
      var mfaBadge = u.mfaEnabled ? ' <span title="Two-factor authentication is on" style="font-size:11px;">🛡️</span>' : '';
      return '<div class="user-row"><div class="info"><strong>'+u.username+mfaBadge+'</strong><small>'+date+'</small></div><span class="'+roleClass+'">'+roleLabel+'</span><div class="user-actions">'+actions+'</div></div>';
    }).join('');
  } catch(e) {
    list.innerHTML = '<div class="empty">Error loading users.</div>';
  }
}

async function approveUser(id) {
  await fetch('/manager/auth/managers/'+id+'/approve', { method: 'POST' });
  loadUsers();
}

async function revokeUser(id) {
  if (!confirm('Revoke access for this manager?')) return;
  await fetch('/manager/auth/managers/'+id+'/revoke', { method: 'POST' });
  loadUsers();
}

async function deleteUser(id) {
  if (!confirm('Permanently delete this account?')) return;
  await fetch('/manager/auth/managers/'+id, { method: 'DELETE' });
  loadUsers();
}

async function resetUserMfa(id, username) {
  if (!confirm('Clear two-factor authentication for ' + username + '? They will need to set it up again on next login.')) return;
  var r = await fetch('/manager/auth/managers/'+id+'/disable-mfa', { method: 'POST' });
  if (r.ok) { loadUsers(); } else { alert('Failed to reset MFA.'); }
}

async function approveReset(id, username) {
  if (!confirm('Approve password reset for ' + username + '? This will update their password to the one they requested.')) return;
  var r = await fetch('/manager/auth/managers/'+id+'/approve-reset', { method: 'POST' });
  if (r.ok) { loadUsers(); } else { alert('Failed to approve reset.'); }
}

async function declineReset(id) {
  if (!confirm('Decline this password reset request?')) return;
  var r = await fetch('/manager/auth/managers/'+id+'/decline-reset', { method: 'POST' });
  if (r.ok) { loadUsers(); } else { alert('Failed to decline reset.'); }
}

var _resetPwTargetId = null;
function resetUserPassword(id, username) {
  _resetPwTargetId = id;
  document.getElementById('reset-pw-username').textContent = 'Setting new password for: ' + username;
  document.getElementById('reset-pw-new').value = '';
  document.getElementById('reset-pw-confirm').value = '';
  document.getElementById('reset-pw-msg').textContent = '';
  openModal('reset-pw-modal');
}

async function submitResetPassword() {
  var nw  = document.getElementById('reset-pw-new').value;
  var cfm = document.getElementById('reset-pw-confirm').value;
  var msg = document.getElementById('reset-pw-msg');
  msg.style.color = 'var(--red)';
  if (!nw || !cfm)   { msg.textContent = 'Both fields are required.'; return; }
  if (nw.length < 8) { msg.textContent = 'Password must be at least 8 characters.'; return; }
  if (nw !== cfm)    { msg.textContent = 'Passwords do not match.'; return; }
  msg.style.color = 'var(--muted)';
  msg.textContent = 'Updating…';
  try {
    var r = await fetch('/manager/auth/managers/' + _resetPwTargetId + '/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword: nw }),
    });
    var d = await r.json();
    if (!r.ok) { msg.style.color = 'var(--red)'; msg.textContent = d.error || 'Failed.'; return; }
    msg.style.color = 'var(--green)';
    msg.textContent = '✓ Password reset for ' + (d.username || '') + '.';
    setTimeout(function() { closeModal('reset-pw-modal'); msg.textContent = ''; }, 1800);
  } catch(e) {
    msg.style.color = 'var(--red)';
    msg.textContent = 'Network error — please try again.';
  }
}

async function updatePin() {
  var pinInput = document.getElementById('pin-input');
  var msg = document.getElementById('pin-msg');
  var pin = pinInput.value.trim();
  msg.style.display = 'none';
  if (!/^\d{4,8}$/.test(pin)) {
    msg.textContent = 'PIN must be 4–8 digits.';
    msg.style.color = '#ef4444'; msg.style.display = 'block'; return;
  }
  var res = await fetch('/manager/auth/pin', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin })
  });
  if (res.ok) {
    pinInput.value = '';
    msg.textContent = 'PIN updated successfully.';
    msg.style.color = '#10b981'; msg.style.display = 'block';
  } else {
    var d = await res.json();
    msg.textContent = d.error || 'Failed to update PIN.';
    msg.style.color = '#ef4444'; msg.style.display = 'block';
  }
}

async function updateCrewPin() {
  var pinInput = document.getElementById('crew-pin-input');
  var msg = document.getElementById('crew-pin-msg');
  var pin = pinInput.value.trim();
  msg.style.display = 'none';
  if (!/^\d{4,8}$/.test(pin)) {
    msg.textContent = 'PIN must be 4–8 digits.';
    msg.style.color = '#ef4444'; msg.style.display = 'block'; return;
  }
  var res = await fetch('/manager/auth/crew-pin', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin })
  });
  if (res.ok) {
    pinInput.value = '';
    msg.textContent = 'PIN updated successfully.';
    msg.style.color = '#10b981'; msg.style.display = 'block';
  } else {
    var d = await res.json();
    msg.textContent = d.error || 'Failed to update PIN.';
    msg.style.color = '#ef4444'; msg.style.display = 'block';
  }
}

let state = null;
let locations = [];
let crmsCases = [];   // shared with CRMS IIFE so renderReport can reference it
let map, markers = {}, vehicleMarkers = {}, routeCache = {}, pendingPin = null, pendingMarker = null;
let hoverIW = null, hoverCloseTimer = null;
let editingLocId = null;
let assigningLoc = null;
let radarOn = false;

// ── Map styles ────────────────────────────────────────────────────────────────
const STYLE_DEFAULT = [
  { elementType: 'geometry', stylers: [{ color: '#1a1d27' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#7a7f9a' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0f1117' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a2d3a' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#0f1117' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f1117' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];
// When radar is on: brighter roads and labels so they punch through the overlay
const STYLE_RADAR_ON = [
  { elementType: 'geometry', stylers: [{ color: '#1e2236' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#dce4ff' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#080b14' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#4a5278' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#6a73a8' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#0f1117' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#080b14' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

// ── Light map style ────────────────────────────────────────────────────────────
const STYLE_LIGHT = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];
// Light map with boosted road contrast so roads punch through the radar overlay
const STYLE_LIGHT_RADAR_ON = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#b0bec5' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#cfd8dc' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#b3d4f5' }] },
];

// ── Helper: current map style based on theme + radar state ───────────────────
function currentMapStyle() {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  if (theme === 'light') return radarOn ? STYLE_LIGHT_RADAR_ON : STYLE_LIGHT;
  return radarOn ? STYLE_RADAR_ON : STYLE_DEFAULT;
}
// ── Helper: update map-overlay buttons to match current theme ─────────────────
function applyRadarBtnTheme() {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const isLight = theme === 'light';
  const btn = document.getElementById('rain-toggle');
  const fitBtn = document.getElementById('fit-rain-btn');
  const sgBtn = document.getElementById('sg-view-btn');
  const baseBg   = isLight ? 'var(--card)' : '#1e2130';
  const baseClr  = isLight ? 'var(--fg)'   : '#7a9cc4';
  const baseBdr  = isLight ? 'var(--border)': '#2a2d3a';
  if (btn && !radarOn) {
    btn.style.background = baseBg; btn.style.color = baseClr; btn.style.borderColor = baseBdr;
  }
  if (fitBtn) { fitBtn.style.background = baseBg; }
  if (sgBtn)  { sgBtn.style.background  = baseBg; }
}
// ── Theme toggle ───────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = theme === 'light' ? '🌙' : '☀️';
  if (map) map.setOptions({ styles: currentMapStyle() });
  applyRadarBtnTheme();
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem('mgr_theme', next);
  applyTheme(next);
}
(function restoreTheme() {
  const saved = localStorage.getItem('mgr_theme') || 'dark';
  applyTheme(saved);
})();

// ── Radar blend-mode observer ─────────────────────────────────────────────────
// NEA radar PNGs have a solid black background. mix-blend-mode:screen makes
// black pixels fully transparent, so only rain colours overlay the map.
let _radarBlendObserver = null;
function _applyBlendToImg(img) {
  if (img.src && img.src.includes('/api/rain-radar')) {
    img.style.mixBlendMode = 'screen';
  }
}
function startRadarBlendMode() {
  const mapDiv = document.getElementById('map');
  if (!mapDiv) return;
  // Apply to any already-present radar images
  mapDiv.querySelectorAll('img').forEach(_applyBlendToImg);
  // Watch for images added later (each frame swap inserts/removes overlays)
  _radarBlendObserver = new MutationObserver(() => {
    mapDiv.querySelectorAll('img').forEach(_applyBlendToImg);
  });
  _radarBlendObserver.observe(mapDiv, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
}
function stopRadarBlendMode() {
  if (_radarBlendObserver) { _radarBlendObserver.disconnect(); _radarBlendObserver = null; }
  document.querySelectorAll('#map img').forEach(img => { img.style.mixBlendMode = ''; });
}

// ── Google Maps init ──────────────────────────────────────────────────────────
window.initMap = function () {
  const savedTheme = localStorage.getItem('mgr_theme') || 'dark';
  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 1.3521, lng: 103.8198 }, zoom: 12,
    minZoom: 10, maxZoom: 19,
    restriction: {
      latLngBounds: { north: 1.48, south: 1.15, east: 104.05, west: 103.58 },
      strictBounds: false,
    },
    styles: savedTheme === 'light' ? STYLE_LIGHT : STYLE_DEFAULT
  });

  applyRadarBtnTheme();

  hoverIW = new google.maps.InfoWindow({ disableAutoPan: true, pixelOffset: new google.maps.Size(0, -6) });

  map.addListener('click', function (e) {
    const lat = e.latLng.lat(), lng = e.latLng.lng();
    // CRMS pin-mode: set location for a case
    if (window._crmsPinModeId && window._crmsPinModeId()) {
      window._crmsPinSet(lat, lng);
      return;
    }
    if (pendingMarker) pendingMarker.setMap(null);
    pendingMarker = new google.maps.Marker({
      map, position: { lat, lng },
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: '#f59e0b', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
      title: 'New location',
    });
    openAddModal(lat.toFixed(6), lng.toFixed(6));
  });
};

// ── NEA Rain Radar animated overlay ──────────────────────────────────────────
// Dual-layer: wide 240km context (low opacity) + sharp 70km Singapore primary (high opacity)
// 70km: exact NEA bounds from calculatePosition() — NW=(1.4572°N,103.565°E), SE=(1.145°N,104.130°E)
// 240km: pixel-calibrated — NW=(3.558°N,101.908°E), SE=(-0.754°N,106.221°E)
const RADAR_BOUNDS = { north: 1.4572, south: 1.145, east: 104.130, west: 103.565 };   // 70km primary
const RADAR_BOUNDS_WIDE = { north: 3.558, south: -0.754, east: 106.221, west: 101.908 }; // 240km context
const RADAR_OPACITY = 0.65;       // 70km local radar — sharp and accurate
const RADAR_OPACITY_WIDE = 0.35;  // 240km wide radar — faded context
const RADAR_FRAME_INTERVAL = 1000;  // ms per frame
const RADAR_REFRESH_INTERVAL = 5 * 60 * 1000; // reload frames every 5 min

let radarFrames = [];        // [{ at, label }] oldest→newest (index 5→0)
let radarOverlays = [];      // 70km GroundOverlay objects per frame
let radarWideOverlays = [];  // 240km GroundOverlay objects per frame
let radarFrameIdx = 0;
let radarAnimTimer = null;
let radarTimer = null;
let radarLoading = false;

function radarSetStatus(on) {
  const btn = document.getElementById('rain-toggle');
  const statusEl = document.getElementById('rain-status');
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const isLight = theme === 'light';
  if (on) {
    btn.style.background = isLight ? 'var(--card)' : '#1e2130';
    btn.style.borderColor = '#38bdf8'; btn.style.color = '#38bdf8';
    statusEl.textContent = 'ON'; statusEl.style.color = '#38bdf8';
  } else {
    btn.style.background    = isLight ? 'var(--card)' : '#1e2130';
    btn.style.borderColor   = isLight ? 'var(--border)' : '#2a2d3a';
    btn.style.color         = isLight ? 'var(--fg)' : '#7a9cc4';
    statusEl.textContent = 'OFF'; statusEl.style.color = 'var(--muted)';
  }
}

function radarClearOverlays() {
  radarOverlays.forEach(o => o && o.setMap(null));
  radarOverlays = [];
  radarWideOverlays.forEach(o => o && o.setMap(null));
  radarWideOverlays = [];
}

// radarOverlays[i] corresponds to radarFrameLabels[i], both ordered oldest→newest
let radarFrameLabels = [];

function radarShowFrame(idx) {
  // Show wide 240km layer beneath primary 70km layer
  radarWideOverlays.forEach((o, i) => o && o.setMap(i === idx ? map : null));
  radarOverlays.forEach((o, i) => o && o.setMap(i === idx ? map : null));
  const tsEl = document.getElementById('rain-timestamp');
  if (radarFrameLabels[idx]) {
    const total = radarFrameLabels.length;
    const isLatest = idx === total - 1;
    const dots = radarFrameLabels.map((_, i) => {
      if (i === idx) return isLatest
        ? '<span style="color:#34d399;font-size:9px;">●</span>'
        : '<span style="color:#38bdf8;font-size:9px;">●</span>';
      return '<span style="color:#374151;font-size:9px;">●</span>';
    }).join('');
    const badge = isLatest
      ? '<span style="background:#064e3b;color:#34d399;font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;border:1px solid #065f46;letter-spacing:.5px;">LATEST</span>'
      : '';
    tsEl.innerHTML = '<span>🌧 ' + radarFrameLabels[idx] + '</span><span style="display:flex;align-items:center;gap:2px;">' + dots + '</span>' + badge;
    tsEl.style.display = 'flex';
    tsEl.style.color = isLatest ? '#a7f3d0' : '#7a9cc4';
  }
}

async function loadRainRadarFrames() {
  if (radarLoading) return;
  radarLoading = true;
  try {
    const res = await fetch(API + '/rain-radar/frames?t=' + Date.now());
    if (!res.ok) { radarLoading = false; return; }
    const data = await res.json();
    const frames = data.frames;  // [{at,label}] index 0 = newest
    if (!frames || !frames.length) { radarLoading = false; return; }

    if (radarAnimTimer) { clearInterval(radarAnimTimer); radarAnimTimer = null; }
    radarClearOverlays();

    // Reverse so index 0 = oldest (we animate forward in time)
    const ordered = [...frames].reverse(); // index 0=oldest, last=newest
    radarFrameLabels = ordered.map(f => f.label);
    // 70km primary overlays (sharp, accurate Singapore)
    radarOverlays = ordered.map(f =>
      new google.maps.GroundOverlay(API + '/rain-radar?at=' + f.at, RADAR_BOUNDS, { opacity: RADAR_OPACITY, clickable: false })
    );
    // 240km wide overlays (regional context, low opacity)
    radarWideOverlays = ordered.map(f =>
      new google.maps.GroundOverlay(API + '/rain-radar-wide?at=' + f.at, RADAR_BOUNDS_WIDE, { opacity: RADAR_OPACITY_WIDE, clickable: false })
    );
    radarFrameIdx = 0;
    radarShowFrame(radarFrameIdx);

    radarAnimTimer = setInterval(() => {
      radarFrameIdx = (radarFrameIdx + 1) % radarOverlays.length;
      radarShowFrame(radarFrameIdx);
    }, RADAR_FRAME_INTERVAL);
  } catch { /* silent */ }
  radarLoading = false;
}

const SG_RESTRICTION = { latLngBounds: { north: 1.48, south: 1.15, east: 104.05, west: 103.58 }, strictBounds: false };

function fitRainRadar() {
  // Zoom to the NEA 240km radar coverage area (Malaysia, Singapore, Riau Islands)
  map.fitBounds(new google.maps.LatLngBounds(
    { lat: RADAR_BOUNDS_WIDE.south, lng: RADAR_BOUNDS_WIDE.west },
    { lat: RADAR_BOUNDS_WIDE.north, lng: RADAR_BOUNDS_WIDE.east }
  ));
}

function returnToSingapore() {
  map.panTo({ lat: 1.3521, lng: 103.8198 });
  map.setZoom(12);
}

function toggleRainRadar() {
  radarOn = !radarOn;
  const tsEl = document.getElementById('rain-timestamp');
  const fitBtn = document.getElementById('fit-rain-btn');
  const sgBtn = document.getElementById('sg-view-btn');
  if (radarOn) {
    // Remove restriction so full 240km radar (Malaysia/Riau) is visible on scroll
    map.setOptions({ restriction: null, minZoom: 10, styles: currentMapStyle() });
    fitBtn.style.display = 'block';
    sgBtn.style.display = 'block';
    radarSetStatus(true);
    startRadarBlendMode();
    loadRainRadarFrames();
    radarTimer = setInterval(loadRainRadarFrames, RADAR_REFRESH_INTERVAL);
  } else {
    // Restore Singapore-focused restriction and correct theme style
    map.setOptions({ restriction: SG_RESTRICTION, minZoom: 10, styles: currentMapStyle() });
    stopRadarBlendMode();
    returnToSingapore();
    fitBtn.style.display = 'none';
    sgBtn.style.display = 'none';
    radarSetStatus(false);
    if (radarAnimTimer) { clearInterval(radarAnimTimer); radarAnimTimer = null; }
    if (radarTimer) { clearInterval(radarTimer); radarTimer = null; }
    radarClearOverlays();
    radarFrameLabels = [];
    tsEl.style.display = 'none';
  }
}

// ── Lightning risk layer ───────────────────────────────────────────────────────
let lightningOn = false;
let lightningPolygons = [];
let lightningLabels = [];
let lightningTimer = null;
let lightningFeatures = null; // cached polygon boundaries

const LIGHTNING_COLORS = {
  '1':       { fill: '#dc2626', stroke: '#991b1b', fillOpacity: 0.42 },
  '2':       { fill: '#ca8a04', stroke: '#92400e', fillOpacity: 0.35 },
  '3':       { fill: '#16a34a', stroke: '#14532d', fillOpacity: 0.18 },
};
const LIGHTNING_BTN_COLORS = { '1': '#dc2626', '2': '#ca8a04', '3': '#16a34a' };
const LIGHTNING_LEGEND_HTML = \`
  <div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:.8px;margin-bottom:7px;">⚡ LIGHTNING RISK (CAT)</div>
  <div style="display:flex;flex-direction:column;gap:5px;">
    <div style="display:flex;align-items:center;gap:7px;"><span style="width:14px;height:14px;border-radius:2px;background:#dc2626;border:1.5px solid #991b1b;flex-shrink:0;"></span><span style="font-size:11px;color:#cbd5e1;"><b>CAT 1</b> — Lightning / No outdoor activity</span></div>
    <div style="display:flex;align-items:center;gap:7px;"><span style="width:14px;height:14px;border-radius:2px;background:#ca8a04;border:1.5px solid #92400e;flex-shrink:0;"></span><span style="font-size:11px;color:#cbd5e1;"><b>CAT 2</b> — Conduct structure decides</span></div>
    <div style="display:flex;align-items:center;gap:7px;"><span style="width:14px;height:14px;border-radius:2px;background:#16a34a;border:1.5px solid #14532d;flex-shrink:0;"></span><span style="font-size:11px;color:#cbd5e1;"><b>CAT 3</b> — Outdoor activities allowed</span></div>
  </div>
\`;

async function getLightningFeatures() {
  if (lightningFeatures) return lightningFeatures;
  const res = await fetch(API + '/lightning/features');
  lightningFeatures = await res.json();
  return lightningFeatures;
}

function clearLightningLayer() {
  lightningPolygons.forEach(p => p.setMap(null));
  lightningPolygons = [];
  lightningLabels.forEach(l => l.setMap(null));
  lightningLabels = [];
}

async function loadLightningSectors() {
  try {
    const [sectorsRes, features] = await Promise.all([
      fetch(API + '/lightning/sectors').then(r => r.json()),
      getLightningFeatures(),
    ]);
    const sectors = sectorsRes.sectors || [];
    // Build a name→cat map
    const catMap = {};
    sectors.forEach(s => { catMap[s.name] = s.cat || '3'; });

    clearLightningLayer();

    let worst = '3';
    features.forEach(feat => {
      const cat = catMap[feat.name] || '3';
      if (parseInt(cat) < parseInt(worst)) worst = cat;
      const { fill, stroke, fillOpacity } = LIGHTNING_COLORS[cat] || LIGHTNING_COLORS['3'];

      // Draw one Google Maps Polygon per polygon shape in this sector
      (feat.polygons || []).forEach(rings => {
        const paths = rings.map(ring => ring.map(([lat, lng]) => ({ lat, lng })));
        const poly = new google.maps.Polygon({
          map,
          paths,
          fillColor: fill,
          fillOpacity,
          strokeColor: stroke,
          strokeOpacity: 0.8,
          strokeWeight: 1.2,
          clickable: false,
          zIndex: 1,
        });
        lightningPolygons.push(poly);
      });

      // Sector name label — find center from sectors list
      const sec = sectors.find(s => s.name === feat.name);
      if (sec) {
        const label = new google.maps.Marker({
          map,
          position: { lat: sec.lat, lng: sec.lng },
          label: {
            text: feat.name,
            color: '#fff',
            fontWeight: '700',
            fontSize: '11px',
          },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 0,
          },
          clickable: false,
          zIndex: 2,
        });
        lightningLabels.push(label);
      }
    });

    // Update button colour to worst CAT
    const btn = document.getElementById('lightning-toggle');
    const statusEl = document.getElementById('lightning-status');
    if (btn && lightningOn) {
      const col = LIGHTNING_BTN_COLORS[worst] || LIGHTNING_BTN_COLORS['3'];
      btn.style.background = col; btn.style.borderColor = col; btn.style.color = '#fff';
      if (statusEl) { statusEl.textContent = 'CAT ' + worst; statusEl.style.color = 'rgba(255,255,255,0.75)'; }
    }
    // Inject legend into map legend body if not already there
    const legBody = document.getElementById('map-legend-body');
    if (legBody && !legBody.querySelector('#lightning-legend-section')) {
      const sep = document.createElement('div');
      sep.id = 'lightning-legend-section';
      sep.style.cssText = 'border-top:1px solid rgba(255,255,255,.07);margin-top:10px;padding-top:10px;';
      sep.innerHTML = LIGHTNING_LEGEND_HTML;
      legBody.appendChild(sep);
    }
    // Auto-open legend so user sees it
    const legBody2 = document.getElementById('map-legend-body');
    if (legBody2 && legBody2.style.display === 'none') toggleLegend();
  } catch (e) {
    console.warn('Lightning fetch failed:', e);
  }
}

function toggleLightning() {
  lightningOn = !lightningOn;
  const btn = document.getElementById('lightning-toggle');
  const statusEl = document.getElementById('lightning-status');
  if (lightningOn) {
    loadLightningSectors();
    lightningTimer = setInterval(loadLightningSectors, 5 * 60 * 1000);
  } else {
    clearLightningLayer();
    if (lightningTimer) { clearInterval(lightningTimer); lightningTimer = null; }
    if (btn) { btn.style.background = 'var(--card)'; btn.style.borderColor = 'var(--border)'; btn.style.color = 'var(--fg)'; }
    if (statusEl) { statusEl.textContent = 'OFF'; statusEl.style.color = 'var(--muted)'; }
    // Remove lightning legend section
    const sec = document.getElementById('lightning-legend-section');
    if (sec) sec.remove();
  }
}

// ── Shared OneMap Singapore search (free, no API key, great postal code support) ─
async function sgSearch(q) {
  try {
    const res = await fetch(API + '/search/sg?q=' + encodeURIComponent(q));
    const json = await res.json();
    return json.results ?? [];
  } catch { return []; }
}

// ── Map search bar ────────────────────────────────────────────────────────────
(function () {
  const input = document.getElementById('search-input');
  const dropdown = document.getElementById('ac-dropdown');
  let debounceTimer = null;

  function showDropdown(html) { dropdown.innerHTML = html; dropdown.style.display = 'block'; }
  function hideDropdown() { dropdown.style.display = 'none'; dropdown.innerHTML = ''; }

  function selectResult(lat, lng, label) {
    hideDropdown(); input.value = '';
    map.panTo({ lat, lng }); map.setZoom(17);
    if (pendingMarker) pendingMarker.setMap(null);
    pendingPin = { lat, lng };
    pendingMarker = new google.maps.Marker({
      map, position: { lat, lng },
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: '#f59e0b', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
      title: label,
    });
    openAddModal(lat.toFixed(6), lng.toFixed(6), label);
  }

  input.addEventListener('input', function () {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (!q || q.length < 2) { hideDropdown(); return; }
    showDropdown('<div class="ac-empty">Searching…</div>');
    debounceTimer = setTimeout(async function() {
      const results = await sgSearch(q);
      if (!results.length) { showDropdown('<div class="ac-empty">No results — try another search</div>'); return; }
      showDropdown(results.map((r, i) => \`<div class="ac-item" data-i="\${i}">
        <div class="ac-item-main">\${esc(r.label)}</div>
        \${r.sub && r.sub !== r.label ? '<div class="ac-item-sub">' + esc(r.sub) + '</div>' : ''}
      </div>\`).join(''));
      dropdown.querySelectorAll('.ac-item').forEach((item, i) => {
        item.addEventListener('mousedown', function(e) {
          e.preventDefault();
          const r = results[i];
          selectResult(r.lat, r.lng, r.label);
        });
      });
    }, 350);
  });

  input.addEventListener('blur', () => setTimeout(hideDropdown, 150));
  input.addEventListener('keydown', e => { if (e.key === 'Escape') { hideDropdown(); input.blur(); } });
})();

// ── Modal location search ─────────────────────────────────────────────────────
(function () {
  let mdTimer = null;

  function mdShowDropdown(html) {
    const dd = document.getElementById('modal-ac-dropdown');
    dd.innerHTML = html; dd.style.display = 'block';
  }
  function mdHideDropdown() {
    const dd = document.getElementById('modal-ac-dropdown');
    dd.style.display = 'none'; dd.innerHTML = '';
  }

  document.getElementById('modal-loc-search').addEventListener('input', function () {
    clearTimeout(mdTimer);
    const q = this.value.trim();
    if (!q || q.length < 2) { mdHideDropdown(); return; }
    mdShowDropdown('<div class="ac-empty">Searching…</div>');
    mdTimer = setTimeout(async function() {
      const results = await sgSearch(q);
      if (!results.length) {
        mdShowDropdown('<div class="ac-empty">No results — try a different search</div>');
        return;
      }
      mdShowDropdown(results.map((r, i) => \`<div class="ac-item" data-i="\${i}">
        <div class="ac-item-main">\${esc(r.label)}</div>
        \${r.sub && r.sub !== r.label ? '<div class="ac-item-sub">' + esc(r.sub) + '</div>' : ''}
      </div>\`).join(''));
      document.getElementById('modal-ac-dropdown').querySelectorAll('.ac-item').forEach((item, i) => {
        item.addEventListener('mousedown', function(e) {
          e.preventDefault();
          const r = results[i];
          mdHideDropdown();
          const nameEl = document.getElementById('loc-name');
          if (!nameEl.value.trim()) nameEl.value = r.label;
          _setModalLocationConfirmed(r.lat, r.lng, r.label);
          setTimeout(() => nameEl.select(), 60);
        });
      });
    }, 350);
  });

  document.getElementById('modal-loc-search').addEventListener('blur', () => setTimeout(mdHideDropdown, 160));
  document.getElementById('modal-loc-search').addEventListener('keydown', e => {
    if (e.key === 'Escape') { mdHideDropdown(); }
  });
})();

// ── Polling ───────────────────────────────────────────────────────────────────
var _lastStateEtag = '';
var _lastLocationsAt = 0;
async function fetchAll() {
  if (document.hidden) return; // skip when tab not visible
  try {
    var headers = _lastStateEtag ? { 'If-None-Match': _lastStateEtag } : {};
    var stateRes = await fetch(API + '/deployments/state', { headers: headers });
    if (stateRes.status === 200) {
      state = await stateRes.json();
      window._lastDeployState = state;
      _lastStateEtag = stateRes.headers.get('ETag') || '';
      render();
      document.getElementById('last-update').textContent = 'updated ' + new Date().toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    // Refresh locations only every 2 minutes (they rarely change)
    var now = Date.now();
    if (now - _lastLocationsAt > 120000) {
      var lr = await fetch(API + '/deployments/locations');
      if (lr.ok) {
        var lrData = (await lr.json()).locations;
        if (Array.isArray(lrData) && lrData.length > 0) {
          locations = lrData;
          _lastLocationsAt = now;
          if (state) render(); // re-draw map pins with fresh locations
        }
      }
    }
  } catch(e) { console.error(e); }
}

setInterval(fetchAll, 10000);
fetchAll();

// Manual refresh button
async function manualRefresh() {
  var btn = document.getElementById('refresh-btn');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.style.opacity = '0.6';
  btn.innerHTML = '<span style="display:inline-block;animation:spin .6s linear infinite;">⟳</span> Refreshing…';
  try {
    // Force bypass ETag cache
    _lastStateEtag = '';
    await Promise.all([fetchAll(), fetchWLS()]);
  } catch(e) {}
  btn.disabled = false;
  btn.style.opacity = '';
  btn.innerHTML = '⟳ Refresh';
}

// Re-fetch immediately when tab becomes visible
document.addEventListener('visibilitychange', function() {
  if (!document.hidden) { fetchAll(); fetchWLS(); }
});

// ── Tide widget ────────────────────────────────────────────────────────────────
let latestTide = null;

function formatInMs(ms) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return h + 'hr ' + m + 'min';
  return m + 'min';
}

async function fetchTide() {
  try {
    const t = await fetch(API + '/tide').then(r => r.json());
    latestTide = t;
    const rising = t.rising;
    document.getElementById('tw-level').textContent = t.height.toFixed(2) + 'm';
    document.getElementById('tw-dir').textContent = rising ? '↑' : '↓';
    document.getElementById('tw-dir').style.color = rising ? '#34d399' : '#f87171';
    document.getElementById('tw-status').textContent = 'Tide is ' + (rising ? 'rising' : 'falling');
    document.getElementById('tw-update').textContent = new Date().toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' });

    if (t.nextHigh) {
      document.getElementById('tw-high-h').textContent = t.nextHigh.height.toFixed(2) + 'm';
      document.getElementById('tw-high-t').textContent = t.nextHigh.local + ' · ' + formatInMs(t.nextHigh.inMs);
    }
    if (t.nextLow) {
      document.getElementById('tw-low-h').textContent = t.nextLow.height.toFixed(2) + 'm';
      document.getElementById('tw-low-t').textContent = t.nextLow.local + ' · ' + formatInMs(t.nextLow.inMs);
    }
  } catch(e) {
    document.getElementById('tw-status').textContent = 'Tide data unavailable';
  }
}

fetchTide();
setInterval(fetchTide, 60000);

// ── WLS Panel ─────────────────────────────────────────────────────────────────
const WLS_LEVELS = [
  { key: 'CRITICAL', label: '🔴 CRITICAL',    color: '#EF4444' },
  { key: 'FULL',     label: '🔴 FULL (100%)', color: '#EF4444' },
  { key: 'HIGH',     label: '🟠 HIGH (90%)',  color: '#F97316' },
  { key: 'MEDIUM',   label: '🟡 MEDIUM (75%)',color: '#EAB308' },
];

function wlsDir(dir) {
  return dir === 'RISE' ? '⬆️' : dir === 'FALL' ? '⇩' : '→';
}

function renderWLS(data) {
  const body = document.getElementById('wls-body');
  const countEl = document.getElementById('wls-station-count');
  const panel = document.getElementById('wls-panel');

  const total = data.count ?? 0;
  const tideGates = data.tideGate ?? [];
  const hasTide = tideGates.length > 0;
  countEl.textContent = total ? \`\${total} station\${total !== 1 ? 's' : ''}\` : '';

  // Update panel title to reflect content
  const titleEl = document.getElementById('wls-title-text');
  if (titleEl) {
    if (hasTide && total > 0) titleEl.textContent = 'Tide Gate + Alert';
    else if (hasTide) titleEl.textContent = 'Tide Gate';
    else titleEl.textContent = 'Alert';
  }

  // Red border when CRITICAL/FULL active; orange when tide gate present
  const hasCritical = (data.grouped?.CRITICAL?.length || 0) + (data.grouped?.FULL?.length || 0);
  if (hasCritical) panel.style.borderColor = 'rgba(239,68,68,0.55)';
  else if (hasTide) panel.style.borderColor = 'rgba(251,146,60,0.55)';
  else panel.style.borderColor = 'rgba(100,116,139,0.3)';

  let html = '';

  // ── Tide Gate section ──────────────────────────────────────────────────────
  if (hasTide) {
    html += \`<div class="wls-group">
      <div class="wls-group-title" style="color:#fb923c;">🚪 Tide Gate Status:</div>
      \${tideGates.map(tg => {
        const time = tg.receivedAt
          ? new Date(tg.receivedAt).toLocaleTimeString('en-SG', { hour:'2-digit', minute:'2-digit' })
          : '';
        const label = tg.timestamp || tg.senderName || '';
        return \`<div class="wls-station-row" style="flex-direction:column;align-items:flex-start;gap:2px;margin-bottom:6px;">
          <div style="display:flex;gap:6px;align-items:center;width:100%;">
            <span style="font-size:9px;font-weight:700;color:#6b7280;letter-spacing:0.6px;text-transform:uppercase;">TIDE GATE \${label ? '· '+esc(label) : ''}</span>
            <span style="font-size:9px;color:#475569;margin-left:auto;">\${esc(time)}</span>
          </div>
          <div style="font-size:12px;color:#e2e8f0;line-height:1.45;white-space:pre-wrap;">\${esc(tg.locationName)}</div>
        </div>\`;
      }).join('')}
    </div>\`;
  }

  // ── WLS Alert stations ─────────────────────────────────────────────────────
  for (const { key, label, color } of WLS_LEVELS) {
    const stations = data.grouped?.[key] ?? [];
    if (!stations.length) continue;
    html += \`<div class="wls-group">
      <div class="wls-group-title" style="color:\${color};">\${label}:</div>
      \${stations.map(s => \`<div class="wls-station-row">
        <span class="wls-dir">\${wlsDir(s.direction)}</span>
        <span class="wls-loc">\${esc(s.locationName)}</span>
      </div>\`).join('')}
    </div>\`;
  }

  if (!html) {
    html = '<div class="wls-empty">No WLS alerts received</div>';
  }

  // Add last-updated footer
  if (data.lastUpdated) {
    const t = new Date(data.lastUpdated).toLocaleTimeString('en-SG', { hour:'2-digit', minute:'2-digit' });
    html += \`<div style="font-size:10px;color:#475569;margin-top:8px;text-align:right;">Updated \${t}</div>\`;
  }

  body.innerHTML = html;
}

function toggleWLS() {
  const panel = document.getElementById('wls-panel');
  if (window.innerWidth < 768) {
    panel.classList.toggle('expanded');
  } else {
    panel.classList.toggle('collapsed');
  }
}

function toggleLegend() {
  const body = document.getElementById('map-legend-body');
  const chevron = document.getElementById('map-legend-chevron');
  const open = body.style.display === 'none' || body.style.display === '';
  body.style.display = open ? 'block' : 'none';
  chevron.style.transform = open ? 'rotate(180deg)' : '';
}

async function clearWLS() {
  if (!confirm('Clear all WLS station data?')) return;
  await fetch(API + '/wls', { method: 'DELETE' });
  renderWLS({ count: 0, grouped: {}, lastUpdated: null });
}

async function fetchWLS() {
  try {
    const data = await fetch(API + '/wls').then(r => r.json());
    renderWLS(data);
  } catch(e) {
    console.warn('WLS fetch failed', e);
  }
}

fetchWLS();
setInterval(fetchWLS, 30000);

// ── Haversine distance in metres between two GPS points ───────────────────────
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2)
    + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180)
    * Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Car-shaped SVG vehicle marker (top-down car silhouette + unit label pill) ──
// Positions are intermittent by design now (officer-initiated updates, not a
// continuous background stream — see .scratch/flood-commander-web/spec.md),
// so a dot on this map is a snapshot, not a guaranteed live feed. Grey out
// anything older than this so staleness is visible rather than implied-live.
var STALE_THRESHOLD_MIN = 30;

function buildCarIcon(unitCode, _colorIgnored, opts) {
  var UNIT_COLORS = {BU:'#3b82f6',PJ:'#06b6d4',WK:'#8b5cf6',CP:'#f97316',KG:'#22c55e'};
  var prefix  = ((unitCode || '') + '').replace(/[0-9].*$/, '').toUpperCase();
  var color   = (opts && opts.stale) ? '#94a3b8' : (UNIT_COLORS[prefix] || '#6b7280');
  var arrived = !!(opts && opts.arrived);
  var small   = !!(opts && opts.small);
  var iconOpacity = (opts && opts.stale) ? ' opacity="0.55"' : '';

  // SVG canvas & car body (56% of original size)
  var W   = small ? 24 : 30;   // total SVG width
  var cx  = W / 2;
  var bw  = small ? 16 : 20;   // car body width
  var bh  = small ? 22 : 27;   // car body height
  var bx  = (W - bw) / 2;      // body x (centered)
  var brx = small ? 5 : 6;     // body corner radius

  // Wheels
  var ww  = small ? 3 : 4;     // wheel width
  var wh2 = small ? 7 : 8;     // wheel height
  var wlx = bx - ww + 1;       // left wheel x
  var wrx = bx + bw - 1;       // right wheel x
  var wfy = small ? 3 : 4;     // front wheel y
  var wry = bh - wfy - wh2;    // rear wheel y

  // Windows
  var winX = bx + 2;
  var winW = bw - 4;
  var wsY  = small ? 3 : 4;    // front windshield y
  var wsH  = small ? 6 : 8;    // windshield height
  var rwY  = bh - wsY - (small ? 5 : 6);   // rear window y
  var rwH  = small ? 5 : 6;

  // Headlights & taillights
  var hlW  = Math.round(winW * 0.36);
  var hlGp = winW - 2 * hlW;

  // Label pill below car (2 px gap) — 25% larger than car body scale
  var PW  = small ? 25 : 33;
  var PH  = small ? 12 : 14;
  var AH  = 5;
  var px  = (W - PW) / 2;
  var py  = bh + 2;
  var fs  = small ? 11 : 14;
  var totalH = py + PH + AH;
  var pillTextY = Math.round(py + PH / 2 + fs * 0.38);
  var ap  = cx;
  var arrowPts = (ap-5)+','+(py+PH)+' '+(ap+5)+','+(py+PH)+' '+ap+','+(py+PH+AH);

  // Arrived green badge (top-right of car)
  var dR  = small ? 7 : 9;
  var dCX = bx + bw + dR - 2;
  var dCY = dR + 1;
  var arrivedBadge = arrived
    ? '<circle cx="'+dCX+'" cy="'+dCY+'" r="'+dR+'" fill="#10b981" stroke="#fff" stroke-width="1.5"/>'
      + '<text x="'+dCX+'" y="'+(dCY+4)+'" text-anchor="middle" font-family="system-ui" font-size="10" font-weight="800" fill="#fff">&#x2713;</text>'
    : '';

  var extraW = arrived ? dR * 2 : 0;
  var svgW   = W + extraW;

  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="'+svgW+'" height="'+totalH+'"'+iconOpacity+'>'
    // ── Car body ──
    + '<rect x="'+bx+'" y="0" width="'+bw+'" height="'+bh+'" rx="'+brx+'" fill="'+color+'" stroke="#fff" stroke-width="2"/>'
    // ── Wheels (4) ──
    + '<rect x="'+wlx+'" y="'+wfy+'" width="'+ww+'" height="'+wh2+'" rx="3" fill="#1e293b" stroke="#fff" stroke-width="1"/>'
    + '<rect x="'+wrx+'" y="'+wfy+'" width="'+ww+'" height="'+wh2+'" rx="3" fill="#1e293b" stroke="#fff" stroke-width="1"/>'
    + '<rect x="'+wlx+'" y="'+wry+'" width="'+ww+'" height="'+wh2+'" rx="3" fill="#1e293b" stroke="#fff" stroke-width="1"/>'
    + '<rect x="'+wrx+'" y="'+wry+'" width="'+ww+'" height="'+wh2+'" rx="3" fill="#1e293b" stroke="#fff" stroke-width="1"/>'
    // ── Windshield (front, top) ──
    + '<rect x="'+winX+'" y="'+wsY+'" width="'+winW+'" height="'+wsH+'" rx="4" fill="rgba(255,255,255,0.38)"/>'
    // ── Rear window (bottom) ──
    + '<rect x="'+winX+'" y="'+rwY+'" width="'+winW+'" height="'+rwH+'" rx="3" fill="rgba(255,255,255,0.22)"/>'
    // ── Headlights (top) ──
    + '<rect x="'+winX+'" y="1" width="'+hlW+'" height="3" rx="1.5" fill="#fef08a"/>'
    + '<rect x="'+(winX+hlW+hlGp)+'" y="1" width="'+hlW+'" height="3" rx="1.5" fill="#fef08a"/>'
    // ── Taillights (bottom) ──
    + '<rect x="'+winX+'" y="'+(bh-4)+'" width="'+hlW+'" height="3" rx="1.5" fill="#f87171"/>'
    + '<rect x="'+(winX+hlW+hlGp)+'" y="'+(bh-4)+'" width="'+hlW+'" height="3" rx="1.5" fill="#f87171"/>'
    // ── Unit code on label pill ──
    + '<rect x="'+px+'" y="'+py+'" width="'+PW+'" height="'+PH+'" rx="'+(PH/2)+'" fill="'+color+'" stroke="#fff" stroke-width="2"/>'
    + '<polygon points="'+arrowPts+'" fill="'+color+'"/>'
    + '<text x="'+cx+'" y="'+pillTextY+'" text-anchor="middle" font-family="system-ui,sans-serif" font-size="'+fs+'" font-weight="800" fill="#fff" letter-spacing="0.5">'+(unitCode||'?')+'</text>'
    // ── Arrived badge ──
    + arrivedBadge
    + '</svg>';

  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(svgW, totalH),
    anchor: new google.maps.Point(Math.round(cx), totalH),
  };
}

function buildVehicleTooltip(v, entry, locations) {
  var loc = entry ? locations.find(function(l) { return l.id === entry.locationId; }) : null;
  var html = '<div style="font-family:system-ui,sans-serif;font-size:12px;line-height:1.6;min-width:160px;">';
  html += '<strong style="font-size:13px;">' + esc(v.unitCode) + ' &nbsp;·&nbsp; ' + esc(v.vehicleNumber) + '</strong>';
  if (v.partner) {
    html += '<div style="color:#555;">' + esc(v.partner);
    if (v.shift) html += ' &nbsp;<span style="background:#e5e7eb;border-radius:4px;padding:1px 5px;font-size:10px;font-weight:600;">' + esc(v.shift) + '</span>';
    html += '</div>';
  }
  if (entry) {
    if (entry.arrived) {
      html += '<div style="margin-top:5px;color:#10b981;font-weight:600;">✅ Arrived ' + esc(entry.arrivedAt || '') + ' hrs</div>';
    } else {
      html += '<div style="margin-top:5px;color:#0ea5e9;font-weight:600;">🚗 ETA ' + esc(entry.eta) + ' hrs';
      if (entry.fromRoad) html += ' <span style="color:#888;font-weight:400;">from ' + esc(entry.fromRoad) + '</span>';
      html += '</div>';
    }
    if (loc) html += '<div style="color:#666;margin-top:2px;">📍 ' + esc(loc.name) + '</div>';
    if (entry.weather) html += '<div style="margin-top:2px;">' + weatherEmoji(entry.weather) + ' ' + esc(entry.weather) + '</div>';
  } else {
    html += '<div style="color:#999;margin-top:5px;">Not deployed</div>';
  }
  // Positions are officer-initiated, not continuous — show how stale this
  // dot is rather than letting it imply a live feed.
  if (v.updatedAt) {
    var staleMin = Math.round((Date.now() - new Date(v.updatedAt).getTime()) / 60000);
    var staleLabel = staleMin <= 0 ? 'just now' : (staleMin === 1 ? '1 min ago' : staleMin + ' min ago');
    var staleColor = staleMin > STALE_THRESHOLD_MIN ? '#ef4444' : '#888';
    html += '<div style="margin-top:5px;color:' + staleColor + ';font-size:11px;">🕐 Updated ' + staleLabel + '</div>';
  }
  html += '</div>';
  return html;
}

// ── Unit sort order: BU → PJ → WK → CP → KG ──────────────────────────────────
const UNIT_ORDER_MAP = {BU:0,PJ:1,WK:2,CP:3,KG:4};
function unitSortKey(code) {
  const prefix = code.replace(/[0-9].*$/, '');
  const num = parseInt(code.replace(/^[^0-9]+/, ''), 10) || 0;
  return (UNIT_ORDER_MAP[prefix] ?? 99) * 1000 + num;
}
const UNIT_COLORS = {BU:'#3b82f6',PJ:'#06b6d4',WK:'#8b5cf6',CP:'#f97316',KG:'#22c55e'};
function unitColor(code) {
  var p = (code||'').replace(/[0-9].*$/,'').toUpperCase();
  return UNIT_COLORS[p] || '#6b7280';
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  if (!state) return;
  const entries = state.entries ?? [];
  const vehicles = state.vehicles ?? [];
  const acceptedIds = entries.map(e => e.locationId);
  const deployedVehicleIds = new Set(entries.map(e => e.vehicleId));
  const allAssignments = Object.values(state.assignments ?? {});
  const pendingAssignments = allAssignments
    .filter(a => a.status === 'pending' && !deployedVehicleIds.has(a.vehicleId))
    .sort((a, b) => unitSortKey(a.unitCode) - unitSortKey(b.unitCode));

  // Stats
  const arrivedCount = entries.filter(e => e.arrived).length;
  document.getElementById('stat-deployed').textContent = entries.length + ' deployed';
  document.getElementById('stat-live').textContent = vehicles.length + ' online';
  document.getElementById('stat-free').textContent = arrivedCount + '/' + entries.length + ' arrived';

  // Roster + alert — restore active-teams chip state before rendering
  if (Array.isArray(state.activeTeams) && state.activeTeams.length > 0) {
    _rosterFilter = new Set(state.activeTeams);
  } else {
    _rosterFilter = new Set();
  }
  renderRosterTable(state.rosterTeams ?? []);
  if (state.rosterTeams?.length) {
    document.getElementById('roster-status').textContent = '✓ ' + state.rosterTeams.length + ' teams loaded';
    var rdEl = document.getElementById('roster-date');
    if (rdEl) {
      if (state.deploymentDate) {
        rdEl.textContent = '📅 Roster date: ' + state.deploymentDate;
        rdEl.style.display = '';
      } else {
        rdEl.style.display = 'none';
      }
    }
    renderShiftSelector(state.activeShifts ?? ['DAY', 'PD', 'ND']);
  }
  renderActiveAlert(state.activeAlert ?? null);

  // Map markers for locations — 7-colour status scheme
  // Red=Arrived+HeavyRain  Orange=Arrived+ModerateRain  Green=Arrived+LightRain
  // LightGreen=Arrived+Nil  Cyan=Accepted(OnTheWay)  Violet=Assigned  Grey=Unassigned
  const pendingLocIds = new Set(allAssignments.map(a => a.locationId));
  const seenLoc = new Set();
  locations.forEach(loc => {
    seenLoc.add(loc.id);
    const entry = entries.find(e => e.locationId === loc.id);
    const isPending = !entry && pendingLocIds.has(loc.id);
    let color = '#6B7280'; // Grey — unassigned
    let scale = 10;
    if (entry) {
      if (entry.arrived) {
        scale = 12;
        const w = (entry.weather ?? '').toLowerCase();
        if (w.includes('heavy'))    color = '#EF4444'; // Red
        else if (w.includes('moderate')) color = '#F97316'; // Orange
        else if (w.includes('light'))    color = '#22C55E'; // Green
        else                             color = '#86EFAC'; // Light Green — Nil / not reported
      } else {
        scale = 12;
        color = '#0EA5E9'; // Bright cyan — Accepted, en route (vivid, distinct from grey)
      }
    } else if (isPending) {
      color = '#A78BFA'; // Violet — Assigned, awaiting crew (distinct from cyan and grey)
    }
    const icon = { path: google.maps.SymbolPath.CIRCLE, scale, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 };
    if (!markers[loc.id]) {
      markers[loc.id] = new google.maps.Marker({
        map, position: { lat: loc.lat, lng: loc.lng },
        title: loc.name,
        icon,
      });
      const iw = new google.maps.InfoWindow({ content: buildInfoWindow(loc, entry) });
      markers[loc.id].addListener('click', () => { iw.setContent(buildInfoWindow(loc, entries.find(e => e.locationId === loc.id))); iw.open(map, markers[loc.id]); });
    } else {
      markers[loc.id].setIcon(icon);
    }
  });
  // Remove old markers
  Object.keys(markers).forEach(id => { if (!seenLoc.has(id)) { markers[id].setMap(null); delete markers[id]; } });

  // Vehicle markers — car-shaped SVG coloured by unit; ETA shown on hover only
  const seenVeh = new Set();
  vehicles.forEach(v => {
    seenVeh.add(v.vehicleId);
    const entry   = entries.find(e => e.vehicleId === v.vehicleId);
    const arrived = !!(entry && entry.arrived);
    const color   = unitColor(v.unitCode);
    const staleMin = v.updatedAt ? (Date.now() - new Date(v.updatedAt).getTime()) / 60000 : 0;
    const stale   = staleMin > STALE_THRESHOLD_MIN;
    const icon    = buildCarIcon(v.unitCode, color, { arrived, small: !entry, stale });

    if (!vehicleMarkers[v.vehicleId]) {
      const marker = new google.maps.Marker({
        map, position: { lat: v.lat, lng: v.lng },
        title: v.unitCode + ' · ' + v.vehicleNumber + (stale ? ' (stale)' : ''),
        icon,
      });
      vehicleMarkers[v.vehicleId] = marker;

      marker.addListener('mouseover', function() {
        clearTimeout(hoverCloseTimer);
        const sv = (state && state.vehicles || []).find(x => x.vehicleId === v.vehicleId);
        const se = (state && state.entries  || []).find(x => x.vehicleId === v.vehicleId);
        const sl = state && (state.locations || []).concat(state.presetLocations || []);
        if (hoverIW && sv) { hoverIW.setContent(buildVehicleTooltip(sv, se, sl || [])); hoverIW.open(map, marker); }
      });
      marker.addListener('mouseout', function() {
        hoverCloseTimer = setTimeout(function() { if (hoverIW) hoverIW.close(); }, 250);
      });
    } else {
      vehicleMarkers[v.vehicleId].setPosition({ lat: v.lat, lng: v.lng });
      vehicleMarkers[v.vehicleId].setIcon(icon);
    }

    // Route line: vehicle GPS → accepted destination via Google Directions API
    // Use v.acceptedLocationId first; fall back to the deployed entry's locationId
    const routeDestId = v.acceptedLocationId || (entry && !arrived ? entry.locationId : null);
    if (entry && !arrived && routeDestId) {
      const destLoc = locations.find(l => l.id === routeDestId)
        || (state.presetLocations ?? []).find(l => l.id === routeDestId);
      if (destLoc) {
        const cached      = routeCache[v.vehicleId];
        const destChanged = !cached || cached.destLocId !== routeDestId;
        const movedFar    = !cached || haversineM(v.lat, v.lng, cached.lat, cached.lng) > 50;

        // Self-contained colour lookup — use [0-9] not \d (template literal drops backslash)
        var _uc = (v.unitCode||'').replace(/[0-9].*$/, '').toUpperCase();
        var routeColor = ({BU:'#3b82f6',PJ:'#06b6d4',WK:'#8b5cf6',CP:'#f97316',KG:'#22c55e'})[_uc] || '#3b82f6';

        var colorChanged = cached && cached.routeColor !== routeColor;
        if (destChanged || movedFar || colorChanged) {
          // Clear old polyline before re-fetching
          if (cached && cached.polyline) cached.polyline.setMap(null);
          routeCache[v.vehicleId] = { lat: v.lat, lng: v.lng, destLocId: routeDestId, routeColor: routeColor, polyline: null };
          const vid = v.vehicleId;
          const toLatLng = { lat: destLoc.lat, lng: destLoc.lng };

          new google.maps.DirectionsService().route({
            origin:      new google.maps.LatLng(v.lat, v.lng),
            destination: new google.maps.LatLng(destLoc.lat, destLoc.lng),
            travelMode:  google.maps.TravelMode.DRIVING,
          }, (result, status) => {
            if (!routeCache[vid]) return; // vehicle gone while request in-flight
            if (status === 'OK' && result.routes.length) {
              routeCache[vid].polyline = new google.maps.Polyline({
                map,
                path:           result.routes[0].overview_path,
                strokeColor:    routeCache[vid].routeColor,
                strokeOpacity:  0.85,
                strokeWeight:   4,
              });
            } else {
              // Fallback: straight dashed line
              var fc = routeCache[vid].routeColor;
              routeCache[vid].polyline = new google.maps.Polyline({
                map,
                path:          [new google.maps.LatLng(routeCache[vid].lat, routeCache[vid].lng), new google.maps.LatLng(toLatLng.lat, toLatLng.lng)],
                strokeColor:   fc,
                strokeOpacity: 0,
                strokeWeight:  3,
                icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, scale: 4, strokeColor: fc }, offset: '0', repeat: '18px' }],
              });
            }
          });
        }
        // If vehicle hasn't moved and colour hasn't changed, reuse existing polyline
      }
    } else {
      // Arrived or no destination — remove route
      if (routeCache[v.vehicleId] && routeCache[v.vehicleId].polyline) routeCache[v.vehicleId].polyline.setMap(null);
      delete routeCache[v.vehicleId];
    }
  });
  // Remove markers/routes for vehicles no longer online
  Object.keys(vehicleMarkers).forEach(id => { if (!seenVeh.has(id)) { vehicleMarkers[id].setMap(null); delete vehicleMarkers[id]; } });
  Object.keys(routeCache).forEach(id => { if (!seenVeh.has(id)) { if (routeCache[id].polyline) routeCache[id].polyline.setMap(null); delete routeCache[id]; } });

  // Panels
  renderDeployed(entries, pendingAssignments);
  renderVehicles(vehicles);
  renderLocations(locations.length ? locations : (state.presetLocations ?? []), acceptedIds);
  renderReport(entries, state.deploymentDate);
}

function buildInfoWindow(loc, entry) {
  window._infoWindowLoc = loc;
  return '<div style="color:#111;min-width:160px;">' +
    '<b>' + esc(loc.name) + '</b><br/>' +
    (entry
      ? '<span style="color:#10b981;">' + esc(entry.unitCode) + ' · ' + esc(entry.vehicleNumber) + '</span><br/>' +
        '<span>' + esc(entry.partner) + ' · ETA ' + esc(entry.eta) + ' hrs</span>'
      : '<span style="color:#888;">Available</span>') +
    '<br/><button onclick="window._assignLoc()" style="margin-top:8px;padding:6px 14px;background:#10b981;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">Assign crew →</button>' +
    '</div>';
}
window._assignLoc = function() {
  if (window._infoWindowLoc) openAssignModal(window._infoWindowLoc);
};

function weatherEmoji(w) {
  if (w === 'Heavy Rain') return '🔴';
  if (w === 'Moderate Rain') return '🟠';
  if (w === 'Light Rain' || w === 'Nil Rain') return '🟢';
  return '';
}

function renderDeployed(entries, pendingAssignments) {
  const el = document.getElementById('deployed-list');
  if (!entries.length && !pendingAssignments.length) {
    el.innerHTML = '<div class="empty">No units deployed yet.</div>';
    return;
  }
  let html = '';
  if (entries.length) {
    html += \`<div class="sec-label" style="color:var(--green);margin-bottom:6px;">✅ DEPLOYED (\${entries.length})</div>\`;
    html += [...entries].sort((a,b)=>unitSortKey(a.unitCode)-unitSortKey(b.unitCode)).map(e => {
      const loc = locations.find(l => l.id === e.locationId);
      const timeStr = e.arrived && e.arrivedAt ? e.arrivedAt + ' hrs ✓' : e.eta + ' hrs ETA';
      const wBadge = e.weather ? \`<span style="font-size:14px;margin-left:4px;">\${weatherEmoji(e.weather)}</span>\` : '';
      return \`<div class="card row">
        <div class="avatar" data-unit="\${(e.unitCode||'').replace(/\\d.*\$/,'')}" \${e.arrived ? 'style="outline:2px solid var(--green);outline-offset:2px;"' : ''}>\${esc(e.unitCode.slice(0,2))}</div>
        <div class="info">
          <strong>\${esc(e.unitCode)} · \${esc(e.vehicleNumber)}</strong>
          <small>\${esc(e.partner)} · \${esc(e.shift)}</small>
          <small>\${esc(loc?.name ?? e.locationId)}</small>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div class="eta" style="font-size:12px;">\${esc(timeStr)}</div>
          \${wBadge}
        </div>
      </div>\`;
    }).join('');
  }
  if (pendingAssignments.length) {
    html += \`<div class="sec-label" style="color:var(--primary);margin-top:\${entries.length?'14px':'0'};margin-bottom:6px;">⏳ PENDING (\${pendingAssignments.length})</div>\`;
    const rosterTeams = state.rosterTeams ?? [];
    html += pendingAssignments.map(a => {
      const team = rosterTeams.find(t => \`\${t.unitCode}-\${t.vehicleNumber}\` === a.vehicleId || t.unitCode === a.unitCode);
      const assignedAt = new Date(a.assignedAt);
      const minsAgo = Math.round((Date.now() - assignedAt.getTime()) / 60000);
      const agoLabel = minsAgo < 60 ? minsAgo + 'm ago' : Math.floor(minsAgo/60) + 'h ago';
      const activeCrms = crmsCases.find(c => c.assignedVehicleId === a.vehicleId && c.status !== 'RESOLVED');
      const displayLoc = activeCrms
        ? \`Attend Case "\${activeCrms.address || activeCrms.locationName || '#' + activeCrms.caseNumber}"\`
        : a.locationName;
      return \`<div class="card row" style="border-left:3px solid var(--primary);">
        <div class="avatar" data-unit="\${(a.unitCode||'').replace(/\\d.*\$/,'')}">\${esc(a.unitCode.slice(0,2))}</div>
        <div class="info">
          <strong>\${esc(a.unitCode)} · \${esc(a.vehicleNumber)}</strong>
          \${team ? \`<small>\${esc(team.partner)} · \${esc(team.shift)}</small>\` : ''}
          <small>→ \${esc(displayLoc)}</small>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <span style="font-size:11px;padding:2px 7px;border-radius:6px;background:rgba(79,110,247,0.15);color:var(--primary);border:1px solid rgba(79,110,247,0.4);">Assigned</span>
          <div style="font-size:10px;color:var(--muted);margin-top:3px;">\${agoLabel}</div>
        </div>
      </div>\`;
    }).join('');
  }
  el.innerHTML = html;
}

async function autoAssign() {
  const btn = document.getElementById('auto-assign-btn');
  btn.disabled = true;
  btn.textContent = 'Assigning…';
  try {
    const res = await fetch(API + '/deployments/auto-assign', { method: 'POST' });
    const json = await res.json();
    await fetchAll();
    if (json.count === 0) {
      var reason = json.reason || '';
      var msg = 'No new assignments.';
      if (reason === 'no_roster') {
        msg = 'No roster loaded. Paste your deployment list in the Roster tab first, then click Import.';
      } else if (reason === 'all_locations_occupied') {
        msg = 'All locations are already assigned or have crews checked in.';
      } else if (reason === 'no_available_teams') {
        msg = 'Roster loaded (' + (json.rosterSize||0) + ' teams) but all are already assigned. Clear assignments first if you want to re-assign.';
      }
      alert(msg);
    } else {
      const lines = json.assignments.map(a => a.unitCode + ' \u2192 ' + a.locationName).join('\\n');
      alert('Auto-Assign Complete: ' + json.count + ' assignment(s) sent:\\n\\n' + lines);
    }
  } catch(e) {
    alert('Auto-assign failed. Check your connection.');
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Auto-Assign';
  }
}

function renderReport(entries, date) {
  document.getElementById('report-date').textContent = 'Deployment: ' + (date ?? '–');
  const el = document.getElementById('report-lines');
  const allAssignments = Object.values(state?.assignments ?? {});
  const deployedVehicleIds = new Set(entries.map(e => e.vehicleId));
  const pendingOnly = allAssignments.filter(a => a.status === 'pending' && !deployedVehicleIds.has(a.vehicleId))
    .sort((a, b) => unitSortKey(a.unitCode) - unitSortKey(b.unitCode));
  if (!entries.length && !pendingOnly.length) { el.innerHTML = '<div class="empty">No deployments yet.</div>'; return; }

  // HRW + Tide info banner
  const alert = state?.activeAlert;
  let infoHtml = '';
  if (alert?.extracted || latestTide) {
    infoHtml += \`<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">\`;
    if (alert?.extracted) {
      infoHtml += \`<div style="flex:1;min-width:180px;background:#ef444418;border:1px solid #ef4444aa;border-radius:8px;padding:10px 12px;display:flex;align-items:flex-start;gap:8px;">
        <span style="font-size:15px;">🚨</span>
        <div><div style="font-size:10px;font-weight:700;color:#ef4444;letter-spacing:.6px;margin-bottom:3px;">HRW — MSS</div>
        <div style="font-size:12px;color:#e2e8f0;line-height:1.5;">\${esc(alert.extracted)}</div></div></div>\`;
    }
    if (latestTide) {
      const dirColor = latestTide.rising ? '#34d399' : '#f87171';
      infoHtml += \`<div style="background:#0ea5e918;border:1px solid #0ea5e9aa;border-radius:8px;padding:10px 16px;display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:90px;">
        <div style="font-size:10px;font-weight:700;color:#38bdf8;letter-spacing:.6px;margin-bottom:4px;">🌊 TIDE</div>
        <div style="font-size:22px;font-weight:700;color:#38bdf8;line-height:1;">\${latestTide.height.toFixed(2)}m</div>
        <div style="font-size:18px;font-weight:700;color:\${dirColor};margin-top:2px;">\${latestTide.rising ? '↑' : '↓'}</div>
      </div>\`;
    }
    infoHtml += \`</div>\`;
  }

  // Build combined list (accepted + pending), sorted by unit
  const allItems = [];
  for (const e of [...entries].sort((a,b)=>unitSortKey(a.unitCode)-unitSortKey(b.unitCode))) {
    const loc = locations.find(l => l.id === e.locationId);
    const locName = loc?.name ?? e.locationId;
    const timeStr = e.arrived && e.arrivedAt ? \`\${e.arrivedAt} hrs\` : \`ETA \${e.eta} hrs\${e.fromRoad && !e.arrived ? ' from ' + e.fromRoad : ''}\`;
    const wSuffix = e.weather ? \` | \${weatherEmoji(e.weather)} \${e.weather}\` : '';
    const line = \`*\${e.unitCode}* \${e.vehicleNumber} (\${e.shift}): \${e.partner} → *\${locName}* | \${timeStr}\${wSuffix}\`;
    const cls = e.arrived ? 'arrived' : 'pending';
    const byTag = e.assignedBy ? \`<span style="font-size:10px;color:var(--muted);margin-left:6px;">via \${esc(e.assignedBy)}</span>\` : '';
    allItems.push({ sortKey: unitSortKey(e.unitCode), html: \`<div class="report-line \${cls}">\${esc(line)}\${byTag}</div>\` });
  }
  for (const a of pendingOnly) {
    const rosterTeam = (state?.rosterTeams ?? []).find(t => \`\${t.unitCode}-\${t.vehicleNumber}\` === a.vehicleId || t.unitCode === a.unitCode);
    const partner = rosterTeam?.partner ?? '';
    const shift = a.shift ?? rosterTeam?.shift ?? '';
    const activeCrms = crmsCases.find(c => c.assignedVehicleId === a.vehicleId && c.status !== 'RESOLVED');
    const displayLoc = activeCrms
      ? \`Attend Case "\${activeCrms.address || activeCrms.locationName || '#' + activeCrms.caseNumber}"\`
      : a.locationName;
    const line = \`*\${a.unitCode}* \${a.vehicleNumber}\${shift?' ('+shift+')':''}: \${partner ? partner+' → ' : '→ '}*\${displayLoc}*\`;
    allItems.push({ sortKey: unitSortKey(a.unitCode), html: \`<div class="report-line pending">\${esc(line)}</div>\` });
  }
  allItems.sort((a,b) => a.sortKey - b.sortKey);

  let html = infoHtml;
  if (allItems.length) {
    html += \`<div style="font-size:11px;font-weight:700;color:var(--green);letter-spacing:.8px;text-transform:uppercase;margin-bottom:6px;">✅ DEPLOYED (\${allItems.length})</div>\`;
    html += allItems.map(i => i.html).join('');
  }
  el.innerHTML = html;
}

function copyReport() {
  const entries = state?.entries ?? [];
  const date = state?.deploymentDate ?? '';
  const allAssignments = Object.values(state?.assignments ?? {});
  const deployedVehicleIds = new Set(entries.map(e => e.vehicleId));
  const pendingOnly = allAssignments.filter(a => a.status === 'pending' && !deployedVehicleIds.has(a.vehicleId));
  if (!entries.length && !pendingOnly.length) { alert('Nothing to copy yet.'); return; }
  const sep = '─'.repeat(48);
  const today = date || new Date().toLocaleDateString('en-SG', { day:'2-digit', month:'long', year:'numeric' });
  const lines = [\`*DEPLOYMENT REPORT — \${today}*\`];
  if (state?.activeAlert?.extracted) {
    lines.push(\`🚨 HRW: \${state.activeAlert.extracted}\`);
  }
  if (latestTide) {
    lines.push(\`🌊 Tide Level: \${latestTide.height.toFixed(2)}m \${latestTide.rising ? '↑' : '↓'}\`);
  }

  // Build combined sorted list (accepted + pending)
  const allItems = [];
  for (const e of entries) {
    const loc = locations.find(l => l.id === e.locationId);
    const locName = loc?.name ?? e.locationId;
    const timeStr = e.arrived && e.arrivedAt ? \`\${e.arrivedAt} hrs\` : \`ETA \${e.eta} hrs\${e.fromRoad && !e.arrived ? ' from ' + e.fromRoad : ''}\`;
    const wSuffix = e.weather ? \` | \${weatherEmoji(e.weather)} \${e.weather}\` : '';
    allItems.push({ sortKey: unitSortKey(e.unitCode), line: \`*\${e.unitCode}* \${e.vehicleNumber} (\${e.shift}): \${e.partner} → *\${locName}* | \${timeStr}\${wSuffix}\` });
  }
  for (const a of pendingOnly) {
    const rosterTeam = (state?.rosterTeams ?? []).find(t => \`\${t.unitCode}-\${t.vehicleNumber}\` === a.vehicleId || t.unitCode === a.unitCode);
    const partner = rosterTeam?.partner ?? '';
    const shift = a.shift ?? rosterTeam?.shift ?? '';
    const activeCrms = crmsCases.find(c => c.assignedVehicleId === a.vehicleId && c.status !== 'RESOLVED');
    const displayLoc = activeCrms
      ? \`Attend Case "\${activeCrms.address || activeCrms.locationName || '#' + activeCrms.caseNumber}"\`
      : a.locationName;
    allItems.push({ sortKey: unitSortKey(a.unitCode), line: \`*\${a.unitCode}* \${a.vehicleNumber}\${shift?' ('+shift+')':''}: \${partner ? partner+' → ' : '→ '}*\${displayLoc}*\` });
  }
  allItems.sort((a,b) => a.sortKey - b.sortKey);

  lines.push(sep, \`✅ DEPLOYED (\${allItems.length})\`);
  allItems.forEach(i => lines.push(i.line));
  lines.push(sep, \`📍 \${entries.filter(e=>e.arrived).length}/\${entries.length} arrived | \${pendingOnly.length} pending\`);
  const text = lines.join('\\n');
  navigator.clipboard.writeText(text).then(() => alert('Report copied to clipboard!')).catch(() => alert('Copy failed.'));
}

// ── Roster functions ──────────────────────────────────────────────────────────
async function importRoster() {
  const text = document.getElementById('roster-input').value.trim();
  const errEl = document.getElementById('roster-error');
  errEl.textContent = '';
  if (!text) { errEl.textContent = 'Please paste the deployment list first.'; return; }
  try {
    // Use merge mode when a roster already exists so a second paste adds without wiping
    const isMerge = _allRosterTeams.length > 0;
    const res = await fetch(API + '/roster/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, merge: isMerge }),
    });
    const json = await res.json();
    if (!res.ok) { errEl.textContent = json.message || 'Parse failed.'; return; }
    document.getElementById('roster-input').value = '';
    renderRosterTable(json.teams);
    const totalCount = json.teams.length;
    const newCount = json.count;
    const msg = isMerge
      ? '✓ ' + newCount + ' team(s) merged — ' + totalCount + ' total'
      : '✓ ' + totalCount + ' teams saved for today';
    document.getElementById('roster-status').textContent = msg;
  } catch(e) { errEl.textContent = 'Request failed.'; }
}

async function clearRoster() {
  await fetch(API + '/roster', { method: 'DELETE' });
  document.getElementById('roster-status').textContent = '';
  document.getElementById('roster-table').innerHTML = '';
  document.getElementById('shift-selector').style.display = 'none';
}

let _allRosterTeams = [];
let _rosterFilter = new Set(); // empty = ALL

function renderRosterTable(teams) {
  _allRosterTeams = teams || [];
  const el = document.getElementById('roster-table');
  if (!_allRosterTeams.length) {
    el.innerHTML = '<div class="empty" style="margin-top:12px;">No roster loaded.</div>';
    document.getElementById('shift-selector').style.display = 'none';
    document.getElementById('roster-team-filter').style.display = 'none';
    return;
  }
  const filterDiv = document.getElementById('roster-team-filter');
  const presentTeams = ['BU','PJ','WK','CP','KG'].filter(p => _allRosterTeams.some(t => t.unitCode.startsWith(p)));
  filterDiv.style.display = 'flex';
  const chips = ['ALL', ...presentTeams];
  filterDiv.innerHTML = chips.map(chip => {
    const isAll = chip === 'ALL';
    const active = isAll ? _rosterFilter.size === 0 : _rosterFilter.has(chip);
    return \`<button onclick="toggleRosterFilter('\${chip}')" id="rf-\${chip}" style="padding:3px 12px;border-radius:14px;border:1px solid \${active?'var(--primary)':'var(--border)'};background:\${active?'var(--primary)':'transparent'};color:\${active?'#fff':'var(--muted)'};font-size:12px;font-weight:600;cursor:pointer;">\${chip}</button>\`;
  }).join('');
  applyRosterFilter();
  document.getElementById('shift-selector').style.display = 'block';
}

function toggleRosterFilter(chip) {
  if (chip === 'ALL') {
    _rosterFilter = new Set();
  } else {
    if (_rosterFilter.has(chip)) _rosterFilter.delete(chip); else _rosterFilter.add(chip);
  }
  renderRosterTable(_allRosterTeams);
  saveActiveTeams();
}

async function saveActiveTeams() {
  const teams = _rosterFilter.size === 0 ? [] : Array.from(_rosterFilter);
  try {
    await fetch(API + '/roster/active-teams', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teams }),
    });
  } catch { /* non-fatal */ }
}

function applyRosterFilter() {
  const el = document.getElementById('roster-table');
  const filtered = _rosterFilter.size === 0 ? _allRosterTeams : _allRosterTeams.filter(t => _rosterFilter.has(t.unitCode.slice(0,2)));
  el.innerHTML = \`<table class="roster-table">
    <thead><tr><th>Unit</th><th>Vehicle</th><th>Officers</th><th>Shift</th></tr></thead>
    <tbody>\${filtered.map(t => \`<tr>
      <td><strong>\${esc(t.unitCode)}</strong></td>
      <td>\${esc(t.vehicleNumber || '–')}</td>
      <td>\${esc(t.partner)}</td>
      <td><span style="color:var(--primary)">\${esc(t.shift)}</span></td>
    </tr>\`).join('')}</tbody>
  </table>\`;
}

// ── Shift selector ─────────────────────────────────────────────────────────────
let _pendingShifts = new Set(['DAY', 'PD', 'ND']);

function renderShiftSelector(active) {
  _pendingShifts = new Set(Array.isArray(active) && active.length ? active : ['DAY', 'PD', 'ND']);
  ['DAY', 'PD', 'ND'].forEach(s => {
    const btn = document.getElementById('sf-' + s);
    if (btn) btn.classList.toggle('active', _pendingShifts.has(s));
  });
}

function toggleShift(s) {
  if (_pendingShifts.has(s)) {
    if (_pendingShifts.size > 1) _pendingShifts.delete(s); // keep at least one
  } else {
    _pendingShifts.add(s);
  }
  ['DAY', 'PD', 'ND'].forEach(sh => {
    const btn = document.getElementById('sf-' + sh);
    if (btn) btn.classList.toggle('active', _pendingShifts.has(sh));
  });
  document.getElementById('shift-save-msg').textContent = '';
}

async function saveActiveShifts() {
  const shifts = Array.from(_pendingShifts);
  const r = await fetch(API + '/roster/active-shifts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shifts }),
  });
  if (r.ok) {
    const msg = document.getElementById('shift-save-msg');
    msg.textContent = '✓ Saved — ' + shifts.join(' + ') + ' on duty';
    setTimeout(() => { msg.textContent = ''; }, 3000);
    await fetchAll();
  }
}

// ── Alert functions ───────────────────────────────────────────────────────────
async function broadcastAlert() {
  const text = document.getElementById('alert-input').value.trim();
  const errEl = document.getElementById('alert-error');
  errEl.textContent = '';
  if (!text) { errEl.textContent = 'Please paste the NEA message first.'; return; }
  try {
    const res = await fetch(API + '/alert/broadcast', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const json = await res.json();
    if (!res.ok) { errEl.textContent = json.message || 'Broadcast failed.'; return; }
    document.getElementById('alert-input').value = '';
    renderActiveAlert({ extracted: json.extracted, broadcastAt: new Date().toISOString(), acknowledgments: [] });
  } catch(e) { errEl.textContent = 'Request failed.'; }
}

async function clearAlert() {
  await fetch(API + '/alert', { method: 'DELETE' });
  renderActiveAlert(null);
  document.getElementById('alert-badge').style.display = 'none';
}

function renderActiveAlert(alert) {
  const box = document.getElementById('alert-active-box');
  const badge = document.getElementById('alert-badge');
  if (!alert) {
    box.style.display = 'none'; badge.style.display = 'none'; return;
  }
  box.style.display = '';
  badge.style.display = '';
  document.getElementById('alert-active-text').textContent = alert.extracted;
  const acks = alert.acknowledgments ?? [];
  document.getElementById('alert-ack-count').textContent = acks.length + ' team' + (acks.length===1?'':'s') + ' acknowledged';
  document.getElementById('alert-ack-list').textContent = acks.join(' · ');
}

function renderVehicles(vehicles) {
  const el = document.getElementById('vehicles-list');
  // "Online" here means "has reported a position at some point" — positions
  // are officer-initiated now, not a continuous connection, so this list can
  // include vehicles whose last report is old. The per-row staleness label
  // below is what actually tells you if a position is current.
  if (!vehicles.length) { el.innerHTML = '<div class="empty">No positions reported yet.</div>'; return; }
  const entries = state?.entries ?? [];
  el.innerHTML = vehicles.map(v => {
    const deployed = entries.find(e => e.vehicleId === v.vehicleId);
    const staleMin = v.updatedAt ? Math.round((Date.now() - new Date(v.updatedAt).getTime()) / 60000) : null;
    const staleLabel = staleMin === null ? '' : staleMin <= 0 ? 'just now' : staleMin + ' min ago';
    const staleClass = staleMin !== null && staleMin > STALE_THRESHOLD_MIN ? 'color:#ef4444;' : 'color:#888;';
    return \`<div class="card row">
      <div class="avatar" data-unit="\${(v.unitCode||'').replace(/\\d.*\$/,'')}">\${esc((v.unitCode||'?').slice(0,2))}</div>
      <div class="info">
        <strong>\${esc(v.unitCode)} · \${esc(v.vehicleNumber)}</strong>
        <small>\${esc(v.partner || '')} · \${esc(v.shift || '')}</small>
        \${staleLabel ? \`<small style="\${staleClass}">🕐 \${staleLabel}</small>\` : ''}
      </div>
      <span class="badge \${deployed ? 'badge-green' : 'badge-muted'}">\${deployed ? 'Deployed' : 'Available'}</span>
    </div>\`;
  }).join('');
}

function renderLocations(locs, acceptedIds) {
  document.getElementById('loc-count').textContent = locs.length + ' Locations';
  const el = document.getElementById('locations-list');
  if (!locs.length) { el.innerHTML = '<div class="empty">No locations yet.</div>'; return; }

  // Group by region, preserve original order for ungrouped
  const regionOrder = [];
  const byRegion = {};
  locs.forEach(loc => {
    const r = loc.region || '—';
    if (!byRegion[r]) { byRegion[r] = []; regionOrder.push(r); }
    byRegion[r].push(loc);
  });

  // Sort each region's locations by priority (nulls last)
  regionOrder.forEach(r => {
    byRegion[r].sort((a, b) => {
      if (a.priority == null && b.priority == null) return 0;
      if (a.priority == null) return 1;
      if (b.priority == null) return -1;
      return a.priority - b.priority;
    });
  });

  // Sort regions alphabetically, with ungrouped (—) last
  regionOrder.sort((a, b) => {
    if (a === '—') return 1;
    if (b === '—') return -1;
    return a.localeCompare(b);
  });

  let html = '';
  regionOrder.forEach(region => {
    const group = byRegion[region];
    html += \`<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);padding:10px 4px 4px;border-top:1px solid var(--border);margin-top:4px;">\${esc(region)}</div>\`;
    group.forEach((loc, idx) => {
      const accepted = acceptedIds.includes(loc.id);
      const isFirst = idx === 0;
      const isLast  = idx === group.length - 1;
      const locJson = JSON.stringify(loc).replace(/"/g,'&quot;');
      const prevLoc = !isFirst ? JSON.stringify(group[idx-1]).replace(/"/g,'&quot;') : null;
      const nextLoc = !isLast  ? JSON.stringify(group[idx+1]).replace(/"/g,'&quot;') : null;
      const pBadge = loc.priority != null
        ? \`<span title="Click to edit priority" style="cursor:pointer;min-width:24px;text-align:center;font-size:11px;font-weight:700;color:var(--primary);background:rgba(79,110,247,0.13);border:1px solid rgba(79,110,247,0.35);border-radius:4px;padding:1px 6px;" onclick="inlinePriority('\${loc.id}',\${loc.priority},'\${esc(region)}')">\${loc.priority}</span>\`
        : \`<span title="Click to set priority" style="cursor:pointer;min-width:24px;text-align:center;font-size:11px;color:var(--muted);background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:1px 6px;" onclick="inlinePriority('\${loc.id}',null,'\${esc(region)}')">—</span>\`;
      html += \`<div class="loc-row" style="align-items:center;">
        <div style="display:flex;flex-direction:column;gap:1px;margin-right:4px;">
          <button class="icon-btn" title="Move up" style="padding:1px 5px;font-size:10px;\${isFirst?'opacity:.25;cursor:default':''}" \${isFirst?'disabled':''} onclick="swapLocPriority(\${locJson},\${prevLoc})">▲</button>
          <button class="icon-btn" title="Move down" style="padding:1px 5px;font-size:10px;\${isLast?'opacity:.25;cursor:default':''}" \${isLast?'disabled':''} onclick="swapLocPriority(\${locJson},\${nextLoc})">▼</button>
        </div>
        \${pBadge}
        <div class="loc-dot" style="background:\${accepted?'var(--green)':'var(--muted)'};margin-left:6px;"></div>
        <div class="loc-info" style="flex:1;min-width:0;">
          <div class="loc-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">\${esc(loc.name)}</div>
          <div class="loc-meta">\${loc.lat.toFixed(4)}, \${loc.lng.toFixed(4)}\${accepted?' · Accepted':''}</div>
        </div>
        <div class="loc-actions">
          <button class="icon-btn assign" title="Assign crew" onclick="openAssignModal(\${locJson})">→</button>
          <button class="icon-btn" title="Edit" onclick="openEditModal(\${locJson})">✎</button>
          <button class="icon-btn del" title="Delete" onclick="deleteLocation('\${loc.id}','\${esc(loc.name)}')">✕</button>
        </div>
      </div>\`;
    });
  });

  el.innerHTML = html;
}

// Force a fresh locations fetch (bypasses the 2-min throttle) then re-render
async function refreshLocations() {
  _lastLocationsAt = 0;
  await fetchAll();
}

async function swapLocPriority(locA, locB) {
  if (!locA || !locB) return;
  const pA = locA.priority != null ? locA.priority : 999;
  const pB = locB.priority != null ? locB.priority : 999;
  await Promise.all([
    fetch(API + '/deployments/locations/' + locA.id, {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({...locA, priority: pB})
    }),
    fetch(API + '/deployments/locations/' + locB.id, {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({...locB, priority: pA})
    }),
  ]);
  await refreshLocations();
}

function inlinePriority(id, currentPriority, region) {
  const val = prompt(\`Set priority for this location in region \${region}\\n(1 = highest; leave blank to clear)\`, currentPriority != null ? currentPriority : '');
  if (val === null) return;
  const priority = val.trim() === '' ? null : parseInt(val.trim());
  if (val.trim() !== '' && (isNaN(priority) || priority < 1)) { alert('Please enter a number ≥ 1'); return; }
  const loc = (locations || []).find(l => l.id === id);
  if (!loc) return;
  fetch(API + '/deployments/locations/' + id, {
    method: 'PUT', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({...loc, priority: priority ?? undefined})
  }).then(() => refreshLocations());
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function switchTab(name, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('panel-' + name).classList.add('active');
  if (name === 'users') loadUsers();
  if (name === 'crms' && typeof window.crmsRefresh === 'function') window.crmsRefresh();
}

// ── Add / Edit modal ──────────────────────────────────────────────────────────
function _setModalLocationConfirmed(lat, lng, label) {
  document.getElementById('loc-lat').value = lat;
  document.getElementById('loc-lng').value = lng;
  document.getElementById('loc-confirmed-text').textContent = label + '  ·  ' + parseFloat(lat).toFixed(5) + ', ' + parseFloat(lng).toFixed(5);
  document.getElementById('loc-confirmed').style.display = 'flex';
  document.getElementById('modal-loc-search').style.display = 'none';
  document.getElementById('modal-ac-dropdown').style.display = 'none';
}

function clearModalLocation() {
  document.getElementById('loc-lat').value = '';
  document.getElementById('loc-lng').value = '';
  document.getElementById('loc-confirmed').style.display = 'none';
  const si = document.getElementById('modal-loc-search');
  si.style.display = '';
  si.value = '';
  si.focus();
}

function openAddModal(prefillLat, prefillLng, prefillName) {
  editingLocId = null;
  document.getElementById('modal-title').textContent = 'Add Location';
  document.getElementById('modal-sub').textContent = 'Search for the spot, then give it a name.';
  document.getElementById('loc-error').textContent = '';
  document.getElementById('modal-search-section').style.display = '';
  document.getElementById('loc-edit-coords').style.display = 'none';

  if (prefillLat && prefillLng) {
    // Came from map click or map search bar — skip search, show confirmed pill
    document.getElementById('loc-name').value = prefillName ?? '';
    _setModalLocationConfirmed(prefillLat, prefillLng, prefillName ?? (prefillLat + ', ' + prefillLng));
  } else {
    // Fresh open — show search input, clear everything
    document.getElementById('loc-name').value = '';
    document.getElementById('loc-lat').value = '';
    document.getElementById('loc-lng').value = '';
    document.getElementById('loc-confirmed').style.display = 'none';
    const si = document.getElementById('modal-loc-search');
    si.style.display = '';
    si.value = '';
  }
  openModal('loc-modal');
  if (!prefillLat) setTimeout(() => document.getElementById('modal-loc-search').focus(), 80);
  else setTimeout(() => document.getElementById('loc-name').focus(), 80);
}

function openEditModal(loc) {
  editingLocId = loc.id;
  document.getElementById('modal-title').textContent = 'Edit Location';
  document.getElementById('modal-sub').textContent = 'Update details for ' + loc.name;
  document.getElementById('loc-name').value = loc.name;
  document.getElementById('loc-lat').value = loc.lat;
  document.getElementById('loc-lng').value = loc.lng;
  document.getElementById('loc-region').value = loc.region || '';
  document.getElementById('loc-priority').value = loc.priority != null ? loc.priority : '';
  document.getElementById('loc-error').textContent = '';
  // Hide search, show current coords as info
  document.getElementById('modal-search-section').style.display = 'none';
  const cd = document.getElementById('loc-edit-coords');
  cd.textContent = '📍 Current location: ' + parseFloat(loc.lat).toFixed(5) + ', ' + parseFloat(loc.lng).toFixed(5);
  cd.style.display = '';
  openModal('loc-modal');
  setTimeout(() => document.getElementById('loc-name').focus(), 80);
}

async function saveLocation() {
  const name = document.getElementById('loc-name').value.trim();
  const lat = parseFloat(document.getElementById('loc-lat').value);
  const lng = parseFloat(document.getElementById('loc-lng').value);
  const region = (document.getElementById('loc-region').value || '').trim().toUpperCase() || undefined;
  const priorityRaw = document.getElementById('loc-priority').value.trim();
  const priority = priorityRaw !== '' ? parseInt(priorityRaw) : undefined;
  if (!name) { document.getElementById('loc-error').textContent = 'Name is required.'; return; }
  if (isNaN(lat)||lat<-90||lat>90) { document.getElementById('loc-error').textContent = 'Please search and select a location first.'; return; }
  if (isNaN(lng)||lng<-180||lng>180) { document.getElementById('loc-error').textContent = 'Please search and select a location first.'; return; }
  const body = { name, address: name, lat, lng, region, priority };
  const url = editingLocId ? API + '/deployments/locations/' + editingLocId : API + '/deployments/locations';
  const method = editingLocId ? 'PUT' : 'POST';
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) { document.getElementById('loc-error').textContent = 'Failed to save.'; return; }
  closeModal('loc-modal');
  if (pendingMarker) { pendingMarker.setMap(null); pendingMarker = null; pendingPin = null; }
  await refreshLocations();
}

var _confirmResolve = null, _confirmReject = null;
function showConfirm(title, body, okLabel) {
  return new Promise((res, rej) => {
    _confirmResolve = res; _confirmReject = rej;
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-body').textContent = body;
    if (okLabel) document.getElementById('confirm-ok-btn').textContent = okLabel;
    openModal('confirm-modal');
  });
}

async function deleteLocation(id, name) {
  try { await showConfirm('Delete location?', 'Remove "' + name + '" from the list?', 'Delete'); }
  catch { return; }
  const r = await fetch(API + '/deployments/locations/' + id, { method: 'DELETE' });
  if (!r.ok) { alert('Delete failed — location may be in use.'); return; }
  await refreshLocations();
}

// ── Assign crew ───────────────────────────────────────────────────────────────
function openAssignModal(loc) {
  assigningLoc = loc;
  const activeShifts = new Set(state?.activeShifts ?? ['DAY', 'PD', 'ND']);
  document.getElementById('assign-sub').textContent =
    'On duty: ' + Array.from(activeShifts).join(' + ');
  const pill = document.getElementById('assign-loc-pill');
  pill.textContent = '📍 ' + loc.name;
  pill.style.display = 'block';

  const vehicles = state?.vehicles ?? [];
  const allLocs = locations ?? [];
  const entries = state?.entries ?? [];
  // Show ALL roster teams regardless of active shift — manager decides who to reassign
  const roster = state?.rosterTeams ?? [];
  const existingAssignments = state?.assignments ?? [];

  const locNameById = {};
  allLocs.forEach(l => { locNameById[l.id] = l.name; });

  // Show ALL vehicles regardless of shift — deployed ones appear with "Reassign" label
  const deployedEntryByVid = {};
  entries.forEach(e => { deployedEntryByVid[e.vehicleId] = e; });
  const free = vehicles.filter(v => !deployedEntryByVid[v.vehicleId] && (!v.acceptedLocationId || !entries.find(e => e.locationId === v.acceptedLocationId)));
  const deployed = vehicles.filter(v => deployedEntryByVid[v.vehicleId] || (v.acceptedLocationId && entries.find(e => e.locationId === v.acceptedLocationId)));
  const sortedVeh = [...free, ...deployed];

  const assignmentByVid = {};
  (Array.isArray(existingAssignments) ? existingAssignments : Object.values(existingAssignments)).forEach(a => {
    assignmentByVid[a.vehicleId] = a.locationName || a.locationId;
  });

  let html = '';

  if (sortedVeh.length) {
    html += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--muted);padding:4px 0 6px;">🔴 Live GPS</div>';
    html += sortedVeh.map(v => {
      const currentLoc = v.acceptedLocationId ? (locNameById[v.acceptedLocationId] || v.acceptedLocationId) : null;
      const subLabel = currentLoc
        ? \`<small style="color:var(--amber);">📍 At \${esc(currentLoc)}</small>\`
        : \`<small>\${esc(v.partner||'')} · \${esc(v.shift||'')}</small>\`;
      const btnLabel = currentLoc ? 'Reassign' : 'Assign';
      const btnStyle = currentLoc ? 'background:var(--amber);border-color:var(--amber);color:#000;' : '';
      return \`<div class="veh-row">
        <div class="avatar" data-unit="\${(v.unitCode||'').replace(/\\d.*\$/,'')}" style="width:32px;height:32px;font-size:10px;">\${esc((v.unitCode||'?').slice(0,2))}</div>
        <div class="info">
          <strong style="font-size:13px;">\${esc(v.unitCode)} · \${esc(v.vehicleNumber)}</strong>
          \${subLabel}
        </div>
        <button class="btn btn-primary btn-sm" style="\${btnStyle}" onclick="assignVehicle('\${v.vehicleId}')">\${btnLabel}</button>
      </div>\`;
    }).join('');
  }

  if (roster.length) {
    html += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--muted);padding:' + (sortedVeh.length ? '12px' : '4px') + ' 0 6px;">📋 Roster Pre-Assign</div>';
    html += roster.map(t => {
      const vid = t.unitCode + '-' + (t.vehicleNumber || 'NA');
      const currentAssign = assignmentByVid[vid];
      const subLabel = currentAssign
        ? \`<small style="color:var(--amber);">→ \${esc(currentAssign)}</small>\`
        : \`<small>\${esc(t.partner||'')} · \${esc(t.shift||'')}</small>\`;
      const btnLabel = currentAssign ? 'Reassign' : 'Pre-Assign';
      const btnStyle = currentAssign ? 'background:var(--amber);border-color:var(--amber);color:#000;' : '';
      return \`<div class="veh-row">
        <div class="avatar" data-unit="\${(t.unitCode||'').replace(/\\d.*\$/,'')}" style="width:32px;height:32px;font-size:10px;">\${esc(t.unitCode.slice(0,2))}</div>
        <div class="info">
          <strong style="font-size:13px;">\${esc(t.unitCode)}\${t.vehicleNumber ? ' · ' + esc(t.vehicleNumber) : ''}</strong>
          \${subLabel}
        </div>
        <button class="btn btn-primary btn-sm" style="\${btnStyle}" onclick="preAssignRoster('\${vid}','\${esc(t.unitCode)}','\${esc(t.vehicleNumber||'')}')">
          \${btnLabel}
        </button>
      </div>\`;
    }).join('');
  }

  if (!html) {
    const hasRoster = (state?.rosterTeams ?? []).length > 0;
    const noRosterMsg = !hasRoster
      ? '<p style="margin:8px 0 0;font-size:11px;color:#94a3b8;">No roster imported yet. Go to the <strong>Roster</strong> tab, paste your team list in the format:<br><code style="font-size:10px;background:#0f1117;padding:2px 6px;border-radius:4px;display:inline-block;margin-top:4px;">BU1 GBL1234A: John & Jane (DAY)</code><br>then click <em>Parse &amp; Save Roster</em>.</p>'
      : '<p style="margin:8px 0 0;font-size:11px;color:#94a3b8;">All imported teams are on shifts not currently active. Open the <strong>Roster</strong> tab and check the on-duty shift selector.</p>';
    html = \`<div style="text-align:center;padding:16px 0;">
      <div style="font-size:28px;margin-bottom:8px;">👥</div>
      <div style="font-size:13px;font-weight:600;color:#e2e8f0;">No teams available to assign</div>
      \${noRosterMsg}
      <button onclick="closeModal('assign-modal');switchTab('roster',document.getElementById('tab-roster'));"
        style="margin-top:14px;padding:7px 16px;background:#4f6ef7;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;">
        📋 Open Roster Tab
      </button>
    </div>\`;
  }
  document.getElementById('vehicle-picker-list').innerHTML = html;
  openModal('assign-modal');
}

async function preAssignRoster(vehicleId, unitCode, vehicleNumber) {
  if (!assigningLoc) return;
  const r = await fetch(API + '/deployments/pre-assign', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vehicleId, unitCode, vehicleNumber, locationId: assigningLoc.id, locationName: assigningLoc.name, lat: assigningLoc.lat, lng: assigningLoc.lng, assignedBy: ME.username || null }),
  });
  const data = await r.json();
  closeModal('assign-modal');
  if (r.ok) { await fetchAll(); alert('Pre-assigned: ' + unitCode + ' \u2192 ' + assigningLoc.name); }
  else { alert('Failed: ' + (data.error || 'unknown error')); }
}

async function assignVehicle(vehicleId) {
  if (!assigningLoc) return;
  const v = (state?.vehicles ?? []).find(x => x.vehicleId === vehicleId);
  if (!v) return;
  const r = await fetch(API + '/deployments/assign', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vehicleId, locationId: assigningLoc.id, locationName: assigningLoc.name, lat: assigningLoc.lat, lng: assigningLoc.lng, assignedBy: ME.username || null }),
  });
  closeModal('assign-modal');
  if (r.ok) { alert('Assignment sent to ' + v.unitCode + ' · ' + v.vehicleNumber + '. They will receive an alert on their phone.'); }
  else { alert('Failed to send assignment.'); }
}



// ── Clear assignments (keep deployed entries intact) ──────────────────────────
async function clearAssignments() {
  if (!confirm('Clear all pending assignments? Deployed crews already on site are not affected.')) return;
  await fetch(API + '/deployments/clear-assignments', { method: 'POST' });
  await fetchAll();
}

// ── Reset ─────────────────────────────────────────────────────────────────────
async function confirmReset() {
  if (!confirm('Reset ALL accepted locations and vehicle positions? This cannot be undone.')) return;
  await fetch(API + '/deployments/reset', { method: 'POST' });
  fetchAll();
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.addEventListener('click', e => {
  if (e.target.classList.contains('overlay')) {
    e.target.classList.remove('open');
    if (e.target.id === 'loc-modal' && pendingMarker) {
      pendingMarker.setMap(null); pendingMarker = null; pendingPin = null;
    }
  }
});

function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
</script>

<script>
// ── Rain-Path Auto-Assign ────────────────────────────────────────────────────
// Radar image bounds — must match RADAR_BOUNDS above (70km radar, 217×120 px)
const RBOUNDS = { w: 103.565, e: 104.130, n: 1.4572, s: 1.145, px: 217, py: 120 };
let rainAnalysis = null;

function lngToPx(lng) { return (lng - RBOUNDS.w) / (RBOUNDS.e - RBOUNDS.w) * RBOUNDS.px; }
function latToPx(lat) { return (RBOUNDS.n - lat) / (RBOUNDS.n - RBOUNDS.s) * RBOUNDS.py; }

// Returns a heavy-rain score (0–1) only for RED and PURPLE/MAGENTA pixels.
// Light blue, green, yellow and orange pixels score 0 — matching NEA radar
// where red = very heavy rain and purple/magenta = extreme rain.
function pixelHeavyRainScore(rr, g, b, a) {
  if (a < 20) return 0;
  var rn = rr / 255, gn = g / 255, bn = b / 255;
  var max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn), d = max - min;
  if (max < 0.25 || d < 0.25) return 0; // too dark or achromatic
  var sat = d / max;
  if (sat < 0.5) return 0; // not vivid enough
  // Hue (0–360°)
  var h;
  if (max === rn)      h = ((gn - bn) / d + 6) % 6 * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else                 h = ((rn - gn) / d + 4) * 60;
  // Only accept red (0–30°) and purple/magenta (280–360°) — skip orange, yellow, green, cyan, blue
  if (h > 30 && h < 280) return 0;
  return sat * max; // bright, saturated red/purple → score near 1
}

// Sample heavy-rain intensity from ImageData at pixel (px,py) with a radius neighbourhood
function sampleRain(imgData, px, py, r) {
  r = r || 5;
  var sum = 0, cnt = 0;
  for (var dy = -r; dy <= r; dy++) {
    for (var dx = -r; dx <= r; dx++) {
      var x = Math.round(px + dx), y = Math.round(py + dy);
      if (x < 0 || x >= RBOUNDS.px || y < 0 || y >= RBOUNDS.py) continue;
      var i = (y * RBOUNDS.px + x) * 4;
      sum += pixelHeavyRainScore(imgData.data[i], imgData.data[i+1], imgData.data[i+2], imgData.data[i+3]);
      cnt++;
    }
  }
  return cnt > 0 ? sum / cnt : 0;
}

// Weighted centre-of-mass of RED/PURPLE pixels only (used for movement direction)
function radarCentroid(imgData) {
  var wx = 0, wy = 0, w = 0, d = imgData.data;
  for (var y = 0; y < RBOUNDS.py; y++) {
    for (var x = 0; x < RBOUNDS.px; x++) {
      var i = (y * RBOUNDS.px + x) * 4;
      var v = pixelHeavyRainScore(d[i], d[i+1], d[i+2], d[i+3]);
      if (v > 0) { wx += x * v; wy += y * v; w += v; }
    }
  }
  return w > 1 ? { x: wx / w, y: wy / w, w: w } : null;
}

// Load one radar frame URL onto an offscreen canvas and return its ImageData
function loadFrameCanvas(at) {
  return new Promise(function(resolve, reject) {
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
      var c = document.createElement('canvas');
      c.width = RBOUNDS.px; c.height = RBOUNDS.py;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, RBOUNDS.px, RBOUNDS.py);
      try {
        resolve(ctx.getImageData(0, 0, RBOUNDS.px, RBOUNDS.py));
      } catch(e) {
        reject(new Error('Canvas read blocked (CORS): ' + e.message));
      }
    };
    img.onerror = function() { reject(new Error('Frame load failed: ' + at)); };
    img.src = API + '/rain-radar?at=' + at + '&cb=' + Date.now();
  });
}

async function runRainAnalysis() {
  var fr = await fetch(API + '/rain-radar/frames?t=' + Date.now());
  if (!fr.ok) throw new Error('Radar frames unavailable');
  var jf = await fr.json();
  var frames = jf.frames; // newest-first [{at, label}]
  if (!frames || !frames.length) throw new Error('No radar frames returned');

  // Load pixel data for all frames in parallel (frames[0]=newest, frames[5]=oldest)
  var pixData = await Promise.all(frames.map(function(f) { return loadFrameCanvas(f.at); }));

  // Centroid per frame
  var centroids = pixData.map(radarCentroid);

  // Movement vector: average(centroid[i] - centroid[i+1]) newest→older direction
  var tdx = 0, tdy = 0, mvCnt = 0;
  for (var ci = 0; ci < centroids.length - 1; ci++) {
    if (centroids[ci] && centroids[ci + 1]) {
      tdx += centroids[ci].x - centroids[ci + 1].x;
      tdy += centroids[ci].y - centroids[ci + 1].y;
      mvCnt++;
    }
  }
  var mvx = mvCnt > 0 ? tdx / mvCnt : 0; // px/5-min, positive = east
  var mvy = mvCnt > 0 ? tdy / mvCnt : 0; // px/5-min, positive = south

  // Score each location
  var locScores = locations.map(function(loc) {
    var px = lngToPx(loc.lng), py = latToPx(loc.lat);
    // series[0]=current intensity, series[5]=25-min-ago intensity
    var series = pixData.map(function(pd) { return sampleRain(pd, px, py); });
    var current = series[0];
    var trend = current - series[series.length - 1]; // positive = rain arriving

    // Incoming bonus: where was the rain 15 min ago (3 steps back in movement direction)
    // that is now heading toward this location?
    var originPx = px - 3 * mvx;
    var originPy = py - 3 * mvy;
    var incoming = sampleRain(pixData[pixData.length - 1], originPx, originPy);

    var score = current + 1.5 * Math.max(0, trend) + 2.0 * incoming;
    return { id: loc.id, name: loc.name, score: score, current: current, trend: trend, incoming: incoming };
  });

  // Convert movement to human-readable direction
  var degPerPxLng = (RBOUNDS.e - RBOUNDS.w) / RBOUNDS.px;
  var moveLng = mvx * degPerPxLng;
  var moveLat = -mvy * (RBOUNDS.n - RBOUNDS.s) / RBOUNDS.py;
  var bearing = Math.atan2(moveLng, moveLat) * 180 / Math.PI;
  var dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  var dir = dirs[Math.round(((bearing % 360) + 360) % 360 / 45) % 8];
  var speedKmh = Math.round(Math.sqrt(mvx * mvx + mvy * mvy) * degPerPxLng * 111 * 60 / 5);
  var hasRain = locScores.some(function(ls) { return ls.score > 0.02; });

  return {
    frames: frames, locScores: locScores, dir: dir, speedKmh: speedKmh,
    hasRain: hasRain,
    latestLabel: frames[0] ? frames[0].label : '',
    oldestLabel: frames[frames.length - 1] ? frames[frames.length - 1].label : '',
  };
}

function openRainAssignModal() {
  document.getElementById('rain-modal-loading').style.display = 'block';
  document.getElementById('rain-modal-content').style.display = 'none';
  document.getElementById('rain-modal-error').style.display = 'none';
  document.getElementById('rain-modal').style.display = 'flex';
  rainAnalysis = null;

  runRainAnalysis().then(function(data) {
    rainAnalysis = data;
    renderRainModal(data);
  }).catch(function(err) {
    document.getElementById('rain-modal-loading').style.display = 'none';
    var el = document.getElementById('rain-modal-error');
    el.textContent = 'Could not analyse radar: ' + (err.message || 'unknown error');
    el.style.display = 'block';
  });
}

function closeRainModal() { document.getElementById('rain-modal').style.display = 'none'; }

function renderRainModal(data) {
  document.getElementById('rain-modal-loading').style.display = 'none';
  document.getElementById('rain-modal-content').style.display = 'block';

  var mvEl = document.getElementById('rain-movement');
  var btn = document.getElementById('rain-confirm-btn');
  if (data.speedKmh > 3 && data.hasRain) {
    mvEl.innerHTML = 'Heavy rain moving <strong>' + data.dir + '</strong> at ~<strong>' + data.speedKmh + ' km/h</strong>';
    mvEl.style.background = '#3b0f0f'; mvEl.style.borderColor = '#ef4444'; mvEl.style.color = '#fca5a5';
    btn.textContent = '\u26C8 Rain-Path Assign'; btn.style.background = '#dc2626';
  } else if (data.hasRain) {
    mvEl.innerHTML = '&#8635; Heavy rain patch appears <strong>relatively stationary</strong>';
    mvEl.style.background = '#3b0f0f'; mvEl.style.borderColor = '#ef4444'; mvEl.style.color = '#fca5a5';
    btn.textContent = '\u26C8 Rain-Path Assign'; btn.style.background = '#dc2626';
  } else {
    mvEl.innerHTML = '&#9728; <strong>No heavy rain (red/purple) detected.</strong> Standard auto-assign will be used instead.';
    mvEl.style.background = '#0c2d48'; mvEl.style.borderColor = '#0284c7'; mvEl.style.color = '#7dd3fc';
    btn.textContent = '\u26A1 Standard Auto-Assign'; btn.style.background = '#0284c7';
  }
  document.getElementById('rain-frame-info').textContent = 'Radar ' + data.oldestLabel + ' \u2192 ' + data.latestLabel;

  var sorted = data.locScores.slice().sort(function(a, b) { return b.score - a.score; });
  var maxScore = Math.max.apply(null, sorted.map(function(s) { return s.score; }).concat([0.001]));
  var listEl = document.getElementById('rain-loc-list');
  listEl.innerHTML = sorted.map(function(ls) {
    var pct = Math.min(100, (ls.score / maxScore) * 100);
    var col = pct > 65 ? '#ef4444' : pct > 35 ? '#f97316' : pct > 10 ? '#eab308' : '#4ade80';
    var label = pct > 65 ? '&#127783; High' : pct > 35 ? '&#9928; Moderate' : pct > 10 ? '&#9925; Low' : '&#9728; Clear';
    var tag = ls.incoming > 0.05 ? '<span style="font-size:10px;background:#082f49;color:#38bdf8;border-radius:4px;padding:1px 5px;margin-left:4px;">incoming &#8679;</span>' : '';
    return '<div style="display:flex;align-items:center;gap:8px;padding:5px 2px;border-bottom:1px solid var(--border);">'
      + '<div style="width:52px;flex-shrink:0;background:#1a1d2e;border-radius:3px;height:5px;">'
      + '<div style="width:' + pct + '%;background:' + col + ';height:100%;border-radius:3px;"></div></div>'
      + '<span style="flex:1;font-size:12px;">' + ls.name + tag + '</span>'
      + '<span style="font-size:11px;color:' + col + ';white-space:nowrap;">' + label + '</span>'
      + '</div>';
  }).join('');
}

async function confirmRainAssign() {
  if (!rainAnalysis) return;
  var btn = document.getElementById('rain-confirm-btn');
  btn.textContent = '\u23F3 Assigning\u2026'; btn.disabled = true;
  try {
    // No heavy rain detected — fall back to standard auto-assign
    if (!rainAnalysis.hasRain) {
      var res2 = await fetch(API + '/deployments/auto-assign', { method: 'POST' });
      var data2 = await res2.json();
      closeRainModal();
      await fetchAll();
      if (data2.count > 0) {
        var lines2 = data2.assignments.map(function(a) { return a.unitCode + ' \u2192 ' + a.locationName; }).join('\\n');
        alert('\u26A1 Standard Auto-Assign: ' + data2.count + ' assignment(s) sent:\\n\\n' + lines2);
      } else {
        var reason2 = data2.reason;
        var msg2 = reason2 === 'no_roster' ? 'No roster loaded. Import a roster first.' :
                   reason2 === 'all_locations_occupied' ? 'All locations are already assigned.' :
                   reason2 === 'no_available_teams' ? 'All roster teams are already assigned.' :
                   'No assignments made \u2014 check roster is loaded.';
        alert(msg2);
      }
      btn.textContent = '\u26A1 Standard Auto-Assign'; btn.disabled = false;
      return;
    }
    // Heavy rain detected — use rain-path assignment
    var res = await fetch(API + '/deployments/rain-auto-assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationScores: rainAnalysis.locScores.map(function(ls) { return { id: ls.id, score: ls.score }; }) }),
    });
    var data = await res.json();
    closeRainModal();
    await fetchAll();
    if (data.count > 0) {
      var lines = data.assignments.map(function(a) { return a.unitCode + ' \u2192 ' + a.locationName; }).join('\\n');
      alert('\u26C8 Rain-Path Assign: ' + data.count + ' assignment(s) sent:\\n\\n' + lines);
    } else {
      alert('No vehicles assigned \u2014 check that a roster is loaded and crews are not already deployed.');
    }
  } catch(e) {
    alert('Auto-assign failed. Check your connection.');
  }
  btn.textContent = rainAnalysis && rainAnalysis.hasRain ? '\u26C8 Rain-Path Assign' : '\u26A1 Standard Auto-Assign';
  btn.disabled = false;
}
</script>

<!-- Rain-Path Auto-Assign Modal -->
<div id="rain-modal" style="display:none;position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.78);align-items:center;justify-content:center;">
  <div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:22px;width:410px;max-width:93vw;max-height:88vh;overflow-y:auto;position:relative;">
    <button onclick="closeRainModal()" style="position:absolute;top:10px;right:12px;background:none;border:none;color:var(--muted);cursor:pointer;font-size:20px;line-height:1;">&#x2715;</button>
    <h3 style="margin:0 0 4px;font-size:16px;font-weight:700;">&#x26C8; Rain-Path Auto-Assign</h3>
    <p style="margin:0 0 14px;font-size:12px;color:var(--muted);">Analyses the last 30 min of radar to detect rain movement and prioritise locations in its projected path. Cluster rules still apply.</p>

    <div id="rain-modal-loading" style="text-align:center;padding:28px 0;color:var(--muted);font-size:13px;">
      <span class="rain-spinner"></span>
      <div style="margin-top:12px;">Loading radar frames &amp; analysing&hellip;</div>
    </div>

    <div id="rain-modal-content" style="display:none;">
      <div id="rain-movement" style="background:#0c2d48;border:1px solid #0284c7;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:#7dd3fc;"></div>
      <div id="rain-frame-info" style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:8px;"></div>
      <div style="font-size:12px;font-weight:600;color:var(--muted);margin-bottom:6px;">Location Rain Risk (sorted by priority)</div>
      <div id="rain-loc-list" style="margin-bottom:14px;max-height:260px;overflow-y:auto;"></div>
      <p style="margin:0 0 14px;font-size:11px;color:var(--muted);">High-risk &amp; incoming-rain locations are assigned first. Same-cluster teams are used wherever possible.</p>
      <div style="display:flex;gap:8px;">
        <button onclick="closeRainModal()" style="flex:1;padding:9px;background:var(--card);border:1px solid var(--border);color:var(--fg);border-radius:8px;cursor:pointer;font-size:13px;">Cancel</button>
        <button id="rain-confirm-btn" onclick="confirmRainAssign()" style="flex:2;padding:9px;background:#0284c7;border:none;color:#fff;border-radius:8px;cursor:pointer;font-weight:700;font-size:13px;">&#x26C8; Assign Now</button>
      </div>
    </div>

    <div id="rain-modal-error" style="display:none;padding:20px;text-align:center;color:#f87171;font-size:13px;"></div>
  </div>
</div>

<script async defer src="https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&callback=initMap"></script>

<script>
(async function initPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  var btn = document.getElementById('notif-btn');
  if (btn) btn.style.display = '';

  function updateBtn(state) {
    if (!btn) return;
    if (state === 'granted')      { btn.textContent = '\uD83D\uDD14 Notif: ON';  btn.style.opacity='1'; btn.style.color='#34d399'; btn.disabled=false; }
    else if (state === 'denied') { btn.textContent = '\uD83D\uDD15 Notif: Blocked'; btn.style.opacity='.5'; btn.style.color=''; btn.disabled=true; }
    else                          { btn.textContent = '\uD83D\uDD15 Notif: OFF'; btn.style.opacity='1'; btn.style.color=''; btn.disabled=false; }
  }
  updateBtn(Notification.permission);

  var swReg = null;
  try { swReg = await navigator.serviceWorker.register('/sw-manager.js', {scope:'/'}); }
  catch(e) { console.warn('SW register failed', e); return; }

  if (Notification.permission === 'granted') await subscribePush(swReg);

  window.togglePush = async function() {
    if (Notification.permission === 'denied') {
      alert('Notifications are blocked in your browser. Please enable them in browser settings, then refresh.'); return;
    }
    var existing = await swReg.pushManager.getSubscription();
    if (existing) {
      await existing.unsubscribe();
      await fetch('/api/push/unsubscribe', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:existing.endpoint})});
      updateBtn('default');
    } else {
      var perm = await Notification.requestPermission();
      updateBtn(perm);
      if (perm === 'granted') await subscribePush(swReg);
    }
  };

  async function subscribePush(reg) {
    try {
      var resp = await fetch('/api/push/vapid-key').then(function(r){return r.json();});
      var sub = await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:urlBase64ToUint8Array(resp.publicKey)});
      await fetch('/api/push/subscribe', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription:sub, type:'manager'})});
      updateBtn('granted');
    } catch(e) { console.warn('Push subscribe failed', e); }
  }

  function urlBase64ToUint8Array(b64) {
    var pad = '='.repeat((4 - b64.length % 4) % 4);
    var base64 = (b64 + pad).replace(/-/g,'+').replace(/_/g,'/');
    var raw = atob(base64);
    return Uint8Array.from(Array.from(raw).map(function(c){return c.charCodeAt(0);}));
  }
})();

// ── CRMS Case Management ──────────────────────────────────────────────────────
(function() {
  // crmsCases is declared at global scope so renderReport can access it
  var crmsMarkers = {};   // id → google.maps.Marker
  var crmsDetailId = null;

  function sgTime(iso) {
    return new Date(iso).toLocaleString('en-SG', {
      timeZone: 'Asia/Singapore', day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
  }

  // ── Manual refresh button ─────────────────────────────────────────────────
  window.crmsRefreshManual = function() { crmsRefresh(); };

  // ── Ingest ────────────────────────────────────────────────────────────────
  window.crmsIngest = async function() {
    var msg = document.getElementById('crms-ingest-msg');
    var text = (document.getElementById('crms-paste-area').value || '').trim();
    if (!text) {
      msg.style.color = '#f87171';
      msg.textContent = '⚠ Paste a CRMS message first, then click Parse & Geocode.';
      return;
    }
    var btn = document.getElementById('crms-ingest-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Parsing…';
    msg.style.color = '#94a3b8';
    msg.textContent = 'Geocoding via OneMap…';
    try {
      var resp = await fetch('/api/crms/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text })
      });
      var data = await resp.json();
      if (!resp.ok) {
        msg.style.color = '#f87171';
        msg.textContent = '✕ ' + (data.error || 'Parse error — check message format.');
      } else {
        msg.style.color = '#86efac';
        var txt = '✓ ' + data.added + ' case' + (data.added !== 1 ? 's' : '') + ' added';
        if (data.skipped && data.skipped.length) txt += ' · ' + data.skipped.length + ' skipped (duplicate)';
        msg.textContent = txt;
        document.getElementById('crms-paste-area').value = '';
        crmsCases = crmsCases.concat(data.cases);
        crmsRenderList();
        data.cases.forEach(function(c) { crmsPlaceMarker(c); });
      }
    } catch(e) {
      msg.style.color = '#f87171';
      msg.textContent = '✕ Network error — check connection.';
    }
    btn.disabled = false;
    btn.textContent = '📥 Parse & Geocode';
  };

  // ── Refresh from server (exported so switchTab can call it) ──────────────
  async function crmsRefresh() {
    try {
      var r = await fetch('/api/crms');
      var data = await r.json();
      crmsCases = data.cases || [];
      crmsRenderList();
      // Re-place markers for any we don't have yet
      crmsCases.forEach(function(c) {
        if (!crmsMarkers[c.id]) crmsPlaceMarker(c);
      });
      // Remove markers whose cases are gone
      Object.keys(crmsMarkers).forEach(function(id) {
        if (!crmsCases.find(function(c){ return c.id === id; })) {
          crmsMarkers[id].setMap(null);
          delete crmsMarkers[id];
        }
      });
    } catch(e) { /* ignore */ }
  }
  window.crmsRefresh = crmsRefresh; // expose so switchTab can call it

  // ── Hide-resolved toggle ──────────────────────────────────────────────────
  var crmsHideResolved = false;
  window.crmsToggleHideResolved = function() {
    crmsHideResolved = !crmsHideResolved;
    var btn = document.getElementById('crms-hide-resolved-btn');
    if (btn) btn.classList.toggle('active', crmsHideResolved);
    crmsRenderList();
  };

  // ── Copy summary ──────────────────────────────────────────────────────────
  window.crmsCopySummary = function() {
    var date = new Date().toLocaleString('en-SG', { timeZone: 'Asia/Singapore', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
    var lines = ['CRMS Case Summary — ' + date, '='.repeat(50)];
    var STATUS_ORDER = ['TO_BE_ASSIGNED','TEAM_ACKNOWLEDGE_OTW','FP_UPDATED','ASSISTANCE_PROVIDED','RESOLVED'];
    var byStatus = { TO_BE_ASSIGNED: [], TEAM_ACKNOWLEDGE_OTW: [], FP_UPDATED: [], ASSISTANCE_PROVIDED: [], RESOLVED: [] };
    crmsCases.forEach(function(c) { (byStatus[c.status] || byStatus.TO_BE_ASSIGNED).push(c); });
    STATUS_ORDER.forEach(function(s) {
      var grp = byStatus[s];
      if (!grp.length) return;
      lines.push('');
      lines.push('--- ' + crmsStatusLabel(s) + ' ---');
      grp.forEach(function(c) {
        var assigned = c.assignedUnitCode ? ' [' + c.assignedUnitCode + ']' : '';
        lines.push('#' + c.caseNumber + ' ' + (c.address || c.details || 'No address') + assigned);
        if (c.fpName) lines.push('  FP: ' + c.fpName + (c.fpContact ? ' · ' + c.fpContact : ''));
        if (c.details) lines.push('  Details: ' + c.details);
      });
    });
    var text = lines.join('\\n');
    navigator.clipboard.writeText(text).then(function() {
      var btn = document.querySelector('[onclick="crmsCopySummary()"]');
      if (btn) { var orig = btn.textContent; btn.textContent = '✓ Copied!'; setTimeout(function(){ btn.textContent = orig; }, 1500); }
    }).catch(function() { alert(text); });
  };

  // ── Render case list ──────────────────────────────────────────────────────
  function crmsRenderList() {
    var list = document.getElementById('crms-cases-list');
    var countEl = document.getElementById('crms-case-count');
    var openEl = document.getElementById('crms-open-count');
    countEl.textContent = crmsCases.length ? crmsCases.length + ' total' : '';
    var open = crmsCases.filter(function(c){ return c.status !== 'RESOLVED'; }).length;
    openEl.textContent = open ? '(' + open + ' open)' : '(all resolved)';
    // Update tab badge
    var badge = document.getElementById('crms-tab-badge');
    if (badge) { badge.textContent = open || ''; badge.style.display = open ? '' : 'none'; }
    var displayCases = crmsHideResolved ? crmsCases.filter(function(c){ return c.status !== 'RESOLVED'; }) : crmsCases;
    if (!displayCases.length) {
      list.innerHTML = crmsHideResolved && crmsCases.length
        ? '<div class="crms-no-cases">All resolved cases hidden</div>'
        : '<div class="crms-no-cases">No cases yet</div>';
      return;
    }
    list.innerHTML = displayCases.map(function(c) {
      var statusCls = 'crms-status-' + c.status;
      var label = crmsStatusLabel(c.status);
      var wog = c.isWog ? '<span style="font-size:9px;color:#94a3b8;font-weight:600;">WOG</span>' : '';
      var assignTxt = c.assignedUnitCode ? '<div class="crms-card-assign">🚒 ' + c.assignedUnitCode + '</div>' : '';
      return '<div class="crms-card" onclick="crmsOpenDetail(\\x27' + c.id + '\\x27)">'
        + '<div class="crms-card-top">'
        + '<span class="crms-case-num">CRMS #' + c.caseNumber + '</span>'
        + (wog ? wog : '')
        + '<span class="crms-status-badge ' + statusCls + '">' + label + '</span>'
        + '</div>'
        + '<div class="crms-card-addr">' + escHtml(c.address) + '</div>'
        + '<div class="crms-card-fp">👤 ' + escHtml(c.fpName) + ' · ' + escHtml(c.fpContact) + '</div>'
        + assignTxt
        + '</div>';
    }).join('');
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Map markers ───────────────────────────────────────────────────────────
  function crmsPlaceMarker(c) {
    if (!c.lat || !c.lng) return;
    if (crmsMarkers[c.id]) { crmsMarkers[c.id].setMap(null); }
    var marker = new google.maps.Marker({
      position: { lat: c.lat, lng: c.lng },
      map: map,
      title: 'CRMS #' + c.caseNumber + ' — ' + c.address,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 10,
        fillColor: statusColor(c.status),
        fillOpacity: 0.92,
        strokeColor: '#fff',
        strokeWeight: 2,
      },
      label: { text: '📋', fontSize: '14px' },
      zIndex: 120,
    });
    marker.addListener('click', function() { crmsOpenDetail(c.id); });
    crmsMarkers[c.id] = marker;
  }

  function statusColor(status) {
    if (status === 'TO_BE_ASSIGNED') return '#ef4444';
    if (status === 'TEAM_ACKNOWLEDGE_OTW') return '#f59e0b';
    if (status === 'FP_UPDATED') return '#3b82f6';
    if (status === 'ASSISTANCE_PROVIDED') return '#8b5cf6';
    return '#22c55e';
  }

  var STATUS_LABEL = {
    TO_BE_ASSIGNED: 'To Be Assigned',
    TEAM_ACKNOWLEDGE_OTW: 'Team Acknowledge OTW',
    FP_UPDATED: 'FP Updated',
    ASSISTANCE_PROVIDED: 'Assistance Provided',
    RESOLVED: 'Resolved'
  };
  function crmsStatusLabel(status) { return STATUS_LABEL[status] || status; }

  // ── Detail modal ──────────────────────────────────────────────────────────
  window.crmsOpenDetail = function(id) {
    var c = crmsCases.find(function(x){ return x.id === id; });
    if (!c) return;
    crmsDetailId = id;
    document.getElementById('crms-detail-title').textContent = (c.isWog ? 'WOG ' : '') + 'CRMS #' + c.caseNumber;
    document.getElementById('crms-detail-status').value = c.status;
    document.getElementById('crms-detail-fp').textContent = c.fpName;
    document.getElementById('crms-detail-contact').textContent = c.fpContact;
    document.getElementById('crms-detail-addr').textContent = c.address;
    document.getElementById('crms-detail-desc').textContent = c.details;
    document.getElementById('crms-detail-received').textContent = sgTime(c.receivedAt);
    var ackRow = document.getElementById('crms-detail-ack-row');
    if (c.acknowledgedAt) { ackRow.style.display = ''; document.getElementById('crms-detail-ack').textContent = sgTime(c.acknowledgedAt); } else { ackRow.style.display = 'none'; }
    var fpUpdRow = document.getElementById('crms-detail-fpupdated-row');
    if (c.fpUpdatedAt) { fpUpdRow.style.display = ''; document.getElementById('crms-detail-fpupdated').textContent = sgTime(c.fpUpdatedAt); } else { fpUpdRow.style.display = 'none'; }
    var assistRow = document.getElementById('crms-detail-assistance-row');
    if (c.assistanceProvidedAt) { assistRow.style.display = ''; document.getElementById('crms-detail-assistance').textContent = sgTime(c.assistanceProvidedAt); } else { assistRow.style.display = 'none'; }
    var resolvedRow = document.getElementById('crms-detail-resolved-row');
    if (c.resolvedAt) {
      resolvedRow.style.display = '';
      document.getElementById('crms-detail-resolved').textContent = sgTime(c.resolvedAt);
    } else { resolvedRow.style.display = 'none'; }
    document.getElementById('crms-detail-update-fp').value = c.updateProvidedToFP || '';
    document.getElementById('crms-detail-flood').value = c.floodAssessment || '';

    // Populate assign dropdown from current deployment state
    var sel = document.getElementById('crms-assign-select');
    sel.innerHTML = '<option value="">— Unassigned —</option>';
    var state = window._lastDeployState;
    var activeShifts = (state && state.activeShifts) ? state.activeShifts : ['DAY','PD','ND'];

    // ── Live GPS vehicles (Expo app connected) ──
    if (state && state.vehicles && state.vehicles.length) {
      var grpLive = document.createElement('optgroup');
      grpLive.label = '📡 Live GPS';
      state.vehicles.forEach(function(v) {
        var opt = document.createElement('option');
        opt.value = v.vehicleId;
        opt.textContent = v.unitCode + ' ' + (v.vehicleNumber || '') + (v.partner ? ' – ' + v.partner : '');
        if (c.assignedVehicleId === v.vehicleId) opt.selected = true;
        grpLive.appendChild(opt);
      });
      sel.appendChild(grpLive);
    }

    // ── Roster teams on active shift ──
    var rosterTeams = (state && state.rosterTeams) ? state.rosterTeams : [];
    var onDuty = rosterTeams.filter(function(t) { return activeShifts.indexOf(t.shift) !== -1; });
    if (onDuty.length) {
      var grpRoster = document.createElement('optgroup');
      grpRoster.label = '📋 Roster (' + activeShifts.join('/') + ')';
      onDuty.forEach(function(t) {
        var vehicleId = t.unitCode + '-' + (t.vehicleNumber || 'NA');
        var opt = document.createElement('option');
        opt.value = vehicleId;
        opt.textContent = t.unitCode + ' ' + (t.vehicleNumber || '') + (t.partner ? ' – ' + t.partner : '') + ' [' + t.shift + ']';
        if (c.assignedVehicleId === vehicleId) opt.selected = true;
        grpRoster.appendChild(opt);
      });
      sel.appendChild(grpRoster);
    }

    if (!sel.options.length || sel.options.length === 1) {
      var placeholder = document.createElement('option');
      placeholder.disabled = true;
      placeholder.textContent = 'No teams on duty — import roster first';
      sel.appendChild(placeholder);
    }

    // Comments
    var cl = document.getElementById('crms-comment-list');
    if (!c.comments || !c.comments.length) {
      cl.innerHTML = '<div style="color:#475569;font-size:11px;text-align:center;padding:8px 0;">No field comments yet</div>';
    } else {
      cl.innerHTML = '<div style="font-size:11px;font-weight:600;color:#a78bfa;margin-bottom:6px;">Field Comments</div>'
        + c.comments.map(function(cm) {
          return '<div class="crms-comment-item">'
            + '<div class="cc-meta">' + escHtml(cm.unitCode) + ' · ' + sgTime(cm.createdAt) + '</div>'
            + '<div>' + escHtml(cm.text) + '</div></div>';
        }).join('');
    }

    document.getElementById('crms-detail-modal').classList.add('open');
  };

  window.closeCrmsDetail = function() {
    document.getElementById('crms-detail-modal').classList.remove('open');
    document.getElementById('crms-edit-panel').style.display = 'none';
    document.getElementById('crms-view-panel').style.display = '';
    crmsDetailId = null;
  };

  window.crmsUpdateStatus = async function(status) {
    if (!crmsDetailId) return;
    try {
      var r = await fetch('/api/crms/' + crmsDetailId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      var updated = await r.json();
      var idx = crmsCases.findIndex(function(c){ return c.id === crmsDetailId; });
      if (idx >= 0) crmsCases[idx] = updated;
      // Refresh all transition timestamps in view
      var ackRow = document.getElementById('crms-detail-ack-row');
      if (updated.acknowledgedAt) { ackRow.style.display = ''; document.getElementById('crms-detail-ack').textContent = sgTime(updated.acknowledgedAt); } else { ackRow.style.display = 'none'; }
      var fpUpdRow = document.getElementById('crms-detail-fpupdated-row');
      if (updated.fpUpdatedAt) { fpUpdRow.style.display = ''; document.getElementById('crms-detail-fpupdated').textContent = sgTime(updated.fpUpdatedAt); } else { fpUpdRow.style.display = 'none'; }
      var assistRow = document.getElementById('crms-detail-assistance-row');
      if (updated.assistanceProvidedAt) { assistRow.style.display = ''; document.getElementById('crms-detail-assistance').textContent = sgTime(updated.assistanceProvidedAt); } else { assistRow.style.display = 'none'; }
      var resolvedRow = document.getElementById('crms-detail-resolved-row');
      if (updated.resolvedAt) { resolvedRow.style.display = ''; document.getElementById('crms-detail-resolved').textContent = sgTime(updated.resolvedAt); } else { resolvedRow.style.display = 'none'; }
      crmsRenderList();
      crmsPlaceMarker(updated);
    } catch(e) { /* ignore */ }
  };

  window.crmsSaveUpdateFP = async function() {
    if (!crmsDetailId) return;
    var text = document.getElementById('crms-detail-update-fp').value.trim();
    try {
      var r = await fetch('/api/crms/' + crmsDetailId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updateProvidedToFP: text })
      });
      var updated = await r.json();
      var idx = crmsCases.findIndex(function(c){ return c.id === crmsDetailId; });
      if (idx >= 0) crmsCases[idx] = updated;
      var btn = document.querySelector('button[onclick="crmsSaveUpdateFP()"]');
      if (btn) { var orig = btn.textContent; btn.textContent = '✓ Saved'; setTimeout(function(){ btn.textContent = orig; }, 1500); }
    } catch(e) { /* ignore */ }
  };

  window.crmsSaveFloodAssessment = async function() {
    if (!crmsDetailId) return;
    var text = document.getElementById('crms-detail-flood').value.trim();
    try {
      var r = await fetch('/api/crms/' + crmsDetailId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ floodAssessment: text })
      });
      var updated = await r.json();
      var idx = crmsCases.findIndex(function(c){ return c.id === crmsDetailId; });
      if (idx >= 0) crmsCases[idx] = updated;
      crmsRenderList();
      // Brief visual confirmation
      var btn = document.querySelector('button[onclick="crmsSaveFloodAssessment()"]');
      if (btn) { var orig = btn.textContent; btn.textContent = '✓ Saved'; setTimeout(function(){ btn.textContent = orig; }, 1500); }
    } catch(e) { /* ignore */ }
  };

  window.crmsAssign = async function(vehicleId) {
    if (!crmsDetailId) return;
    var state = window._lastDeployState;
    // Try live GPS vehicle first, then fall back to roster team
    var liveV = state && state.vehicles && state.vehicles.find(function(x){ return x.vehicleId === vehicleId; });
    var rosterT = !liveV && state && state.rosterTeams && state.rosterTeams.find(function(t){
      return (t.unitCode + '-' + (t.vehicleNumber || 'NA')) === vehicleId;
    });
    var unitCode = liveV ? liveV.unitCode : (rosterT ? rosterT.unitCode : null);
    var body = { assignedVehicleId: vehicleId || null, assignedUnitCode: unitCode };
    if (vehicleId && body.assignedVehicleId) body.status = 'TEAM_ACKNOWLEDGE_OTW';
    try {
      var r = await fetch('/api/crms/' + crmsDetailId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      var updated = await r.json();
      var idx = crmsCases.findIndex(function(c){ return c.id === crmsDetailId; });
      if (idx >= 0) crmsCases[idx] = updated;
      crmsRenderList();
      crmsPlaceMarker(updated);
      document.getElementById('crms-detail-status').value = updated.status;
    } catch(e) { /* ignore */ }
  };

  window.crmsZoomTo = function() {
    var c = crmsCases.find(function(x){ return x.id === crmsDetailId; });
    if (!c || !c.lat || !c.lng) return;
    map.setCenter({ lat: c.lat, lng: c.lng });
    map.setZoom(16);
    closeCrmsDetail();
  };

  window.crmsDeleteCase = async function() {
    if (!crmsDetailId) return;
    if (!confirm('Delete this CRMS case?')) return;
    await fetch('/api/crms/' + crmsDetailId, { method: 'DELETE' });
    if (crmsMarkers[crmsDetailId]) {
      crmsMarkers[crmsDetailId].setMap(null);
      delete crmsMarkers[crmsDetailId];
    }
    crmsCases = crmsCases.filter(function(c){ return c.id !== crmsDetailId; });
    crmsRenderList();
    closeCrmsDetail();
  };

  // ── Clear All with Undo ───────────────────────────────────────────────────
  var crmsUndoSnapshot = null;
  var crmsUndoTimer = null;
  var crmsUndoSeconds = 0;

  window.crmsClearAll = async function() {
    if (!confirm('Clear ALL CRMS cases? You will have 10 seconds to undo.')) return;
    crmsUndoSnapshot = JSON.parse(JSON.stringify(crmsCases));
    Object.keys(crmsMarkers).forEach(function(id){ crmsMarkers[id].setMap(null); });
    crmsMarkers = {};
    crmsCases = [];
    crmsRenderList();
    closeCrmsDetail();
    // Show undo bar
    crmsUndoSeconds = 10;
    var bar = document.getElementById('crms-undo-bar');
    var sec = document.getElementById('crms-undo-sec');
    bar.style.display = 'flex';
    sec.textContent = crmsUndoSeconds;
    clearInterval(crmsUndoTimer);
    crmsUndoTimer = setInterval(async function() {
      crmsUndoSeconds--;
      sec.textContent = crmsUndoSeconds;
      if (crmsUndoSeconds <= 0) {
        clearInterval(crmsUndoTimer);
        bar.style.display = 'none';
        crmsUndoSnapshot = null;
        // Commit delete to server
        await fetch('/api/crms?all=1', { method: 'DELETE' });
      }
    }, 1000);
  };

  window.crmsClearAllUndo = async function() {
    clearInterval(crmsUndoTimer);
    document.getElementById('crms-undo-bar').style.display = 'none';
    if (!crmsUndoSnapshot) return;
    crmsCases = crmsUndoSnapshot;
    crmsUndoSnapshot = null;
    crmsRenderList();
    crmsCases.forEach(function(c){ crmsPlaceMarker(c); });
  };

  // ── Edit case functions ───────────────────────────────────────────────────
  window.crmsOpenEdit = function() {
    var c = crmsCases.find(function(x){ return x.id === crmsDetailId; });
    if (!c) return;
    document.getElementById('crms-edit-fp').value = c.fpName || '';
    document.getElementById('crms-edit-contact').value = c.fpContact || '';
    document.getElementById('crms-edit-addr').value = c.address || '';
    document.getElementById('crms-edit-desc').value = c.details || '';
    document.getElementById('crms-view-panel').style.display = 'none';
    document.getElementById('crms-edit-panel').style.display = '';
  };

  window.crmsEditCancel = function() {
    document.getElementById('crms-edit-panel').style.display = 'none';
    document.getElementById('crms-view-panel').style.display = '';
  };

  window.crmsEditSave = async function() {
    if (!crmsDetailId) return;
    var body = {
      fpName: document.getElementById('crms-edit-fp').value.trim(),
      fpContact: document.getElementById('crms-edit-contact').value.trim(),
      address: document.getElementById('crms-edit-addr').value.trim(),
      details: document.getElementById('crms-edit-desc').value.trim(),
    };
    try {
      var r = await fetch('/api/crms/' + crmsDetailId, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      var updated = await r.json();
      var idx = crmsCases.findIndex(function(c){ return c.id === crmsDetailId; });
      if (idx >= 0) crmsCases[idx] = updated;
      // Refresh view panel fields
      document.getElementById('crms-detail-fp').textContent = updated.fpName;
      document.getElementById('crms-detail-contact').textContent = updated.fpContact;
      document.getElementById('crms-detail-addr').textContent = updated.address;
      document.getElementById('crms-detail-desc').textContent = updated.details;
      crmsRenderList();
      crmsPlaceMarker(updated);
      crmsEditCancel();
    } catch(e) { alert('Save failed. Check connection.'); }
  };

  // ── Pin-mode: click map to set CRMS case location ────────────────────────
  var crmsPinModeId = null;
  window.crmsEnterPinMode = function() {
    if (!crmsDetailId) return;
    crmsPinModeId = crmsDetailId;
    document.getElementById('crms-detail-modal').classList.remove('open');
    document.getElementById('crms-pin-banner').style.display = '';
    if (map) map.setOptions({ draggableCursor: 'crosshair' });
  };

  window.crmsExitPinMode = function() {
    crmsPinModeId = null;
    document.getElementById('crms-pin-banner').style.display = 'none';
    if (map) map.setOptions({ draggableCursor: '' });
  };

  // Keyboard Esc exits pin mode
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && crmsPinModeId) crmsExitPinMode();
  });

  // Expose pin mode ID for map click handler
  window._crmsPinModeId = function() { return crmsPinModeId; };
  window._crmsPinSet = async function(lat, lng) {
    var id = crmsPinModeId;
    crmsExitPinMode();
    try {
      var r = await fetch('/api/crms/' + id, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: lat, lng: lng })
      });
      var updated = await r.json();
      var idx = crmsCases.findIndex(function(c){ return c.id === id; });
      if (idx >= 0) crmsCases[idx] = updated;
      crmsPlaceMarker(updated);
      // Re-open detail
      crmsOpenDetail(id);
    } catch(e) { /* ignore */ }
  };

  window.crmsDownloadReport = async function() {
    var r = await fetch('/api/crms/report');
    var buf = await r.arrayBuffer();
    var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'CRMS_Report_' + new Date().toISOString().slice(0,10) + '.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Initial load + background polling (keeps tab badge live even on other tabs)
  setTimeout(crmsRefresh, 2000);
  setInterval(crmsRefresh, 30000);
})();
</script>
</body>
</html>`);
});

export default router;
