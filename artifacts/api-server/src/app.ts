import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import { pool } from "@workspace/db";
import router, { managerRouter, crewRouter, authRouter, lightningPublicRouter } from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Northflank terminates TLS at its edge proxy and forwards plain HTTP
// internally, so Express must trust the proxy's X-Forwarded-Proto header —
// otherwise req.secure is always false and the session cookie's
// `secure: true` in production silently refuses to set.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Security headers (SSP as-9 CSP, as-10 HSTS) ─────────────────────────────
// The server-rendered pages (manager.ts, crew.ts, lightning.ts) are entire
// pages built from one inline <script> block with inline onclick="..."
// handlers throughout — retrofitting a nonce/hash-based CSP that drops
// 'unsafe-inline' would mean rewriting every one of those handlers to
// addEventListener first, well beyond a header-only change. This CSP is
// "minimally permissive" for the architecture as it actually stands today:
// it keeps 'unsafe-inline' for script/style (required, see above) but still
// meaningfully narrows *which origins* can load anything at all — the known
// external hosts these pages actually use (Google Maps JS, Leaflet's unpkg
// CDN, CARTO map tiles, the Blitzortung WebSocket feed) and nothing else, so
// an XSS payload still can't pull in an arbitrary third-party script/image
// host. Revisit dropping 'unsafe-inline' if these pages are ever rewritten
// off inline event handlers.
const CSP =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' https://maps.googleapis.com https://unpkg.com; " +
  "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com; " +
  "img-src 'self' data: https://*.googleapis.com https://*.gstatic.com https://*.basemaps.cartocdn.com https://unpkg.com; " +
  "connect-src 'self' https://maps.googleapis.com; " +
  "object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
app.use((_req, res, next) => {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required but was not provided.");
}

// Backed by Postgres (reusing the same pool @workspace/db uses for everything
// else) rather than express-session's default in-memory store, which Node
// explicitly documents as not production-safe: it never prunes expired
// sessions, doesn't survive a process restart, and doesn't share state across
// replicas.
//
// Deliberately NOT using connect-pg-simple's own createTableIfMissing: it
// reads a table.sql file relative to its own package directory at runtime,
// which esbuild's bundling of this app into a single dist/index.mjs doesn't
// carry along — that option throws ENOENT in the built artifact even though
// it works fine running from source. Create the table ourselves instead
// (same DDL connect-pg-simple ships, idempotent) before wiring up the store.
await pool.query(`
  CREATE TABLE IF NOT EXISTS "session" (
    "sid" varchar NOT NULL COLLATE "default",
    "sess" json NOT NULL,
    "expire" timestamp(6) NOT NULL,
    CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
  );
  CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
`);

const PgSessionStore = connectPgSimple(session);

app.use(session({
  store: new PgSessionStore({ pool }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    // Northflank auto-provisions TLS on every custom domain, so HTTPS is
    // guaranteed (not optional) once deployed there.
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  },
}));

app.use(authRouter);

// ── security.txt (SSP st-3) ─────────────────────────────────────────────────
// Must be served at the true domain root per the security.txt standard
// (https://securitytxt.org), so this lives directly on `app`, not under any
// path-prefixed router. Points at the Government Vulnerability Disclosure
// Programme per this control's own default reporting channel.
const SECURITY_TXT = [
  "Contact: https://go.gov.sg/report-vulnerability",
  "Expires: 2027-08-27T00:00:00.000Z",
  "Preferred-Languages: en",
].join("\n") + "\n";
app.get(["/.well-known/security.txt", "/security.txt"], (_req: Request, res: Response) => {
  res.type("text/plain").send(SECURITY_TXT);
});

// ── Root — redirect to roster-dashboard ─────────────────────────────────────────
app.get("/", (_req: Request, res: Response) => {
  res.redirect(302, "/roster/");
});

app.use("/api", router);
app.use(managerRouter);
app.use(crewRouter);
app.use(lightningPublicRouter);

export default app;
