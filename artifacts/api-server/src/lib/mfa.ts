// TOTP-based MFA for manager/admin/ic accounts.
// See .scratch/flood-commander-web/issues/09-manager-mfa-totp.md for the
// design writeup (why TOTP instead of Entra ID SSO, rollout policy, etc).
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
// Namespace import (not named/default) — sidesteps any CJS/ESM interop
// question entirely and reads clearly at each call site (otplib.verify, …).
import * as otplib from "otplib";
// Namespace import, not default — qrcode is CJS with an `export =` type
// declaration, and this codebase's tsconfig doesn't set esModuleInterop.
import * as QRCode from "qrcode";

// A TOTP secret isn't a password — the server must be able to read the real
// value back to check a submitted code, so it can't be hashed like
// passwordHash elsewhere in this app. It's encrypted at rest instead
// (AES-256-GCM via Node's built-in crypto), which means a real key has to
// exist and — like SESSION_SECRET (see app.ts) — there is deliberately no
// hardcoded fallback: a baked-in default would defeat the point of
// encrypting the column at all (same class of problem as the hardcoded
// admin/manager-PIN defaults flagged in ticket 01).
//
// Generate one with: openssl rand -base64 32
const keyB64 = process.env.MFA_ENCRYPTION_KEY;
if (!keyB64) {
  throw new Error("MFA_ENCRYPTION_KEY environment variable is required but was not provided.");
}
const key = Buffer.from(keyB64, "base64");
if (key.length !== 32) {
  throw new Error("MFA_ENCRYPTION_KEY must be a base64-encoded 32-byte key (AES-256-GCM) — generate one with `openssl rand -base64 32`.");
}

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12; // recommended nonce length for GCM

/** Encrypts a TOTP secret for storage in managers.mfa_secret. */
export function encryptMfaSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Store iv:authTag:ciphertext, each base64 — self-contained, no separate
  // column needed for the nonce/tag.
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Reverses encryptMfaSecret. Throws if the value is malformed or the auth tag doesn't verify. */
export function decryptMfaSecret(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted MFA secret");
  }
  const [ivB64, tagB64, ctB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// ±30s tolerance either side of "now" to absorb ordinary clock drift between
// server and phone — one step each direction on the default 30s period.
// Explicit rather than left at otplib's default (0 / exact-step-only) so a
// legitimate code doesn't get rejected just because the two clocks disagree
// by a few seconds; a wider window would meaningfully weaken the brute-force
// protection the rate limiter above is providing.
const EPOCH_TOLERANCE_SECONDS = 30;

/** Generates a new base32 TOTP secret (not yet persisted/enabled). */
export function generateMfaSecret(): string {
  return otplib.generateSecret();
}

/**
 * otpauth:// URI for the secret — what an authenticator app reads out of a
 * QR code. "CWD" as issuer groups it sensibly in the app's account list;
 * username disambiguates between accounts if someone sets up MFA for more
 * than one CWD login on the same device.
 */
export function mfaKeyUri(username: string, secret: string): string {
  return otplib.generateURI({ issuer: "CWD Deployment Manager", label: username, secret });
}

/** Renders the otpauth:// URI as a data-URI PNG for embedding directly in server-rendered HTML/JSON. */
export function mfaQrCodeDataUrl(otpauthUri: string): Promise<string> {
  return QRCode.toDataURL(otpauthUri);
}

/** Verifies a 6-digit code against a secret. */
export async function verifyMfaCode(code: string, secret: string): Promise<boolean> {
  try {
    const result = await otplib.verify({ secret, token: code, epochTolerance: EPOCH_TOLERANCE_SECONDS });
    return result.valid;
  } catch {
    // otplib throws on malformed input (non-numeric, wrong length) rather
    // than returning false — treat that the same as an incorrect code.
    return false;
  }
}
