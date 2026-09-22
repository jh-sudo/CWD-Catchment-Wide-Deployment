import { logger } from "./logger.js";

// OneMap Singapore's reverse-geocode endpoint (unlike its search endpoint,
// already used elsewhere in this app without a key) requires a bearer token
// minted from a registered account — tokens are valid ~3 days. This module
// hides that entirely from callers: it caches the token in memory and
// silently re-authenticates whenever it's missing or close to expiry, so
// nothing downstream ever has to think about the TTL.
// .scratch/replit-resync-2026-09-21 (external-API confidentiality audit,
// 2026-09-22) — replaces Nominatim (a non-government third party) for
// reverse-geocoding live deployment/vehicle GPS with this official
// .gov.sg source.
const TOKEN_URL = "https://www.onemap.gov.sg/api/auth/post/getToken";
const REFRESH_MARGIN_MS = 10 * 60 * 1000; // re-auth a bit before real expiry
const DEFAULT_TTL_MS = 3 * 24 * 60 * 60 * 1000; // fallback if expiry_timestamp is ever unparseable

let cachedToken: string | null = null;
let cachedExpiryMs = 0;
let inFlight: Promise<string> | null = null;

function parseExpiry(raw: unknown, issuedAtMs: number): number {
  // OneMap's docs describe this as a Unix-seconds timestamp, but it isn't
  // independently verifiable without a live account — parse defensively
  // rather than trust one exact format.
  if (typeof raw === "string" || typeof raw === "number") {
    const asSeconds = Number(raw);
    if (Number.isFinite(asSeconds) && asSeconds > issuedAtMs / 1000) {
      return asSeconds * 1000;
    }
    const asMs = Date.parse(String(raw));
    if (Number.isFinite(asMs) && asMs > issuedAtMs) {
      return asMs;
    }
  }
  return issuedAtMs + DEFAULT_TTL_MS;
}

async function fetchNewToken(): Promise<string> {
  const email = process.env.ONEMAP_EMAIL;
  const password = process.env.ONEMAP_PASSWORD;
  if (!email || !password) {
    throw new Error("ONEMAP_EMAIL / ONEMAP_PASSWORD not configured");
  }
  const issuedAtMs = Date.now();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`OneMap token request failed: ${res.status}`);
  const data = (await res.json()) as { access_token?: string; expiry_timestamp?: string | number };
  if (!data.access_token) throw new Error("OneMap token response missing access_token");

  cachedToken = data.access_token;
  cachedExpiryMs = parseExpiry(data.expiry_timestamp, issuedAtMs);
  logger.info({ expiresAt: new Date(cachedExpiryMs).toISOString() }, "OneMap: refreshed access token");
  return cachedToken;
}

/** A valid OneMap bearer token, refreshed automatically as needed. Callers
 * never need to manage the ~3-day TTL themselves. */
export async function getOneMapToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedExpiryMs - REFRESH_MARGIN_MS) {
    return cachedToken;
  }
  // Collapse concurrent callers during a refresh into one outbound request.
  if (!inFlight) {
    inFlight = fetchNewToken().finally(() => { inFlight = null; });
  }
  return inFlight;
}
