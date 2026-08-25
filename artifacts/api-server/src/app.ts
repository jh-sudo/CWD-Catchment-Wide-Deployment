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

// ── Root — redirect to roster-dashboard ─────────────────────────────────────────
app.get("/", (_req: Request, res: Response) => {
  res.redirect(302, "/roster/");
});

app.use("/api", router);
app.use(managerRouter);
app.use(crewRouter);
app.use(lightningPublicRouter);

export default app;
