/**
 * Standalone production server for Expo static builds.
 *
 * Routes:
 * - GET /sw.js                              → crew push service worker (server/static/sw.js)
 * - GET / or /manifest (expo-platform hdr)  → native (iOS/Android) manifest JSON for Expo Go
 * - GET /                                   → web app index.html (if web build exists)
 *                                             else Expo Go landing page
 * - GET /<static asset>                     → file from static-build/web/ then static-build/
 * - GET /<any other path>                   → web SPA fallback (index.html)
 *
 * Zero external dependencies — uses only Node.js built-ins (http, fs, path).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const STATIC_ROOT   = path.resolve(__dirname, "..", "static-build");
const WEB_ROOT      = path.join(STATIC_ROOT, "web");
const TEMPLATE_PATH = path.resolve(__dirname, "templates", "landing-page.html");
const SERVER_STATIC = path.resolve(__dirname, "static");
const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json",
};

function hasWebBuild() {
  return fs.existsSync(path.join(WEB_ROOT, "index.html"));
}

function getAppName() {
  try {
    const appJsonPath = path.resolve(__dirname, "..", "app.json");
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf-8"));
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveManifest(platform, res) {
  const manifestPath = path.join(STATIC_ROOT, platform, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ error: `Manifest not found for platform: ${platform}` }),
    );
    return;
  }

  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.writeHead(200, {
    "content-type": "application/json",
    "expo-protocol-version": "1",
    "expo-sfv-version": "0",
  });
  res.end(manifest);
}

function serveLandingPage(req, res, landingPageTemplate, appName) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = forwardedProto || "https";
  const host = req.headers["x-forwarded-host"] || req.headers["host"];
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

function serveWebIndex(res) {
  const content = fs.readFileSync(path.join(WEB_ROOT, "index.html"));
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-cache, no-store, must-revalidate",
  });
  res.end(content);
}

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { "content-type": contentType });
  res.end(content);
}

const landingPageTemplate = fs.readFileSync(TEMPLATE_PATH, "utf-8");
const appName = getAppName();

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  let pathname = url.pathname;

  // Strip base path prefix (e.g. /crew → /)
  if (basePath && pathname.startsWith(basePath)) {
    pathname = pathname.slice(basePath.length) || "/";
  }

  // ── Service worker (must be served from same scope as the app) ──────────────
  if (pathname === "/sw.js") {
    const swPath = path.join(SERVER_STATIC, "sw.js");
    if (fs.existsSync(swPath)) {
      res.writeHead(200, {
        "content-type": "application/javascript; charset=utf-8",
        "service-worker-allowed": "/",
        "cache-control": "no-cache",
      });
      res.end(fs.readFileSync(swPath));
    } else {
      res.writeHead(404); res.end("Not Found");
    }
    return;
  }

  // ── Root / manifest — branch on requester type ──────────────────────────────
  if (pathname === "/" || pathname === "/manifest") {
    const platform = req.headers["expo-platform"];

    // Expo Go (native) client → serve mobile manifest
    if (platform === "ios" || platform === "android") {
      return serveManifest(platform, res);
    }

    // Regular browser → serve web app if built, else Expo Go landing page
    if (pathname === "/") {
      if (hasWebBuild()) {
        return serveWebIndex(res);
      }
      return serveLandingPage(req, res, landingPageTemplate, appName);
    }
  }

  // ── Static assets ────────────────────────────────────────────────────────────
  const safePath = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");

  // 1. Try web build assets first (e.g. _expo/static/js/web/bundle.js)
  const webFilePath = path.join(WEB_ROOT, safePath);
  if (
    webFilePath.startsWith(WEB_ROOT) &&
    fs.existsSync(webFilePath) &&
    !fs.statSync(webFilePath).isDirectory()
  ) {
    return serveFile(webFilePath, res);
  }

  // 2. Try native build assets (e.g. {timestamp}/_expo/static/js/ios/bundle.js)
  const nativeFilePath = path.join(STATIC_ROOT, safePath);
  if (
    nativeFilePath.startsWith(STATIC_ROOT) &&
    fs.existsSync(nativeFilePath) &&
    !fs.statSync(nativeFilePath).isDirectory()
  ) {
    return serveFile(nativeFilePath, res);
  }

  // 3. SPA fallback — web app client-side routing (only for browser requests)
  if (hasWebBuild() && !req.headers["expo-platform"]) {
    return serveWebIndex(res);
  }

  res.writeHead(404);
  res.end("Not Found");
});

const port = parseInt(process.env.PORT || "3000", 10);
server.listen(port, "0.0.0.0", () => {
  console.log(`Serving static Expo build on port ${port}`);
  console.log(`Web build available: ${hasWebBuild()}`);
});
