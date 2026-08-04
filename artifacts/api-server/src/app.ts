import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import session from "express-session";
import pinoHttp from "pino-http";
import router, { managerRouter, authRouter, lightningPublicRouter } from "./routes";
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

app.use(session({
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
app.use(lightningPublicRouter);

export default app;
