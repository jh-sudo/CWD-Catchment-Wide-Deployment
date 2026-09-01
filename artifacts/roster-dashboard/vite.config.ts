import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

// SSP as-9/as-10: this is a pure React SPA (no inline <script> content, no
// dangerouslySetInnerHTML anywhere in src/) built and served as static
// assets, so unlike api-server's server-rendered pages it can run a real
// script-src without 'unsafe-inline'. style-src still needs it — Tailwind/
// React inline `style={{...}}` props compile to inline style attributes,
// which CSP's style-src also gates, and there's no practical nonce/hash
// story for those.
const CSP =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com; " +
  "img-src 'self' data:; " +
  "connect-src 'self'; " +
  "object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
const securityHeaders = {
  "Content-Security-Policy": CSP,
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  // Local-dev-only proxy to a locally-running api-server, same pattern
  // apa/inspector had before they were removed. In production this is
  // inert — GOV PaaS's path-based routing sends /api/*, /manager/* to
  // api-server's own container before a request ever reaches this
  // service, so these rules never actually fire there.
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
    proxy: {
      "/api": "http://localhost:8080",
      "/manager": "http://localhost:8080",
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    headers: securityHeaders,
    proxy: {
      "/api": "http://localhost:8080",
      "/manager": "http://localhost:8080",
    },
  },
});
