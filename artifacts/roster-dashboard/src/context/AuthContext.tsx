import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

export type AccountRole = "admin" | "manager" | "ic" | "crew";

// Single source of truth for "is this a management-side role", per ADR 0001
// (docs/adr/0001-roster-dashboard-navigation-redesign.md) — gating should be
// checked once against this, not re-derived as a fresh tri-state comparison
// at each call site.
export function isManagementRole(role: AccountRole | undefined): boolean {
  return role === "admin" || role === "manager" || role === "ic";
}

export interface AuthUser {
  id: string;
  username: string;
  role: AccountRole;
  officerId?: string;
  officerName?: string;
  catchments?: string[];
}

// Returned by login() when the session isn't authenticated yet and the
// caller (Login.tsx) must drive a further step first: a default/unset
// credential that must be changed (SSP ac-6 — see auth.ts's
// pendingPasswordChangeManagerId), or mandatory/enabled MFA (see auth.ts's
// pendingMfaManagerId). forceChangePassword() can itself resolve to an
// MFA step next, since ac-6 is checked before MFA on the server too.
export type AuthStep =
  | { step: "changePassword" }
  | { step: "challenge" }
  | { step: "enroll"; username: string };

export interface MfaSetupInfo {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  /** Resolves to an AuthStep if a further step is required, or null once fully authenticated. */
  login: (username: string, password: string) => Promise<AuthStep | null>;
  /** Sets a new password for an account with a forced change pending (data.mustChangePassword === true). May itself resolve to an MFA AuthStep next. */
  forceChangePassword: (newPassword: string) => Promise<AuthStep | null>;
  /** Completes login for an already-enrolled account (data.mfaStep === "challenge"). */
  mfaChallenge: (code: string) => Promise<void>;
  /** Starts enrollment for an account that doesn't have MFA set up yet (data.mfaStep === "enroll"). */
  mfaSetup: () => Promise<MfaSetupInfo>;
  /** Confirms the code from mfaSetup() and completes login. */
  mfaVerifySetup: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  login: async () => null,
  forceChangePassword: async () => null,
  mfaChallenge: async () => {},
  mfaSetup: async () => { throw new Error("Not implemented"); },
  mfaVerifySetup: async () => {},
  logout: async () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/manager/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Shared by login() and forceChangePassword() — both endpoints can hand
  // back the same {mustChangePassword|mfaStep} shape for what comes next.
  // Sets `user` and returns null once the session is actually authenticated;
  // otherwise resolves the AuthStep the caller needs to drive.
  const resolveAuthStep = useCallback(async (data: any, fallbackUsername: string): Promise<AuthStep | null> => {
    // Password verified (or just set) but the account still needs a further
    // step — no session was authenticated yet (server holds it in a pending
    // state), so don't set `user` here.
    if (data.mustChangePassword) return { step: "changePassword" };
    if (data.mfaStep === "challenge") return { step: "challenge" };
    if (data.mfaStep === "enroll") return { step: "enroll", username: data.username ?? fallbackUsername };
    setUser({
      id: data.id ?? fallbackUsername,
      username: data.username ?? fallbackUsername,
      role: data.role,
      officerId: data.officerId,
      officerName: data.officerName,
      catchments: data.catchments,
    });
    await refresh();
    return null;
  }, [refresh]);

  const login = useCallback(async (username: string, password: string): Promise<AuthStep | null> => {
    const res = await fetch("/manager/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");
    return resolveAuthStep(data, username);
  }, [resolveAuthStep]);

  const forceChangePassword = useCallback(async (newPassword: string): Promise<AuthStep | null> => {
    const res = await fetch("/manager/auth/force-change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ newPassword }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not set password");
    return resolveAuthStep(data, data.username);
  }, [resolveAuthStep]);

  const mfaChallenge = useCallback(async (code: string) => {
    const res = await fetch("/manager/auth/mfa/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Incorrect code");
    setUser({
      id: data.id ?? data.username,
      username: data.username,
      role: data.role,
      officerId: data.officerId,
      officerName: data.officerName,
      catchments: data.catchments,
    });
    await refresh();
  }, [refresh]);

  const mfaSetup = useCallback(async (): Promise<MfaSetupInfo> => {
    const res = await fetch("/manager/auth/mfa/setup", { method: "POST", credentials: "include" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not start MFA setup");
    return { secret: data.secret, otpauthUrl: data.otpauthUrl, qrCodeDataUrl: data.qrCodeDataUrl };
  }, []);

  const mfaVerifySetup = useCallback(async (code: string) => {
    const res = await fetch("/manager/auth/mfa/verify-setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Incorrect code");
    setUser({
      id: data.id ?? data.username,
      username: data.username,
      role: data.role,
      officerId: data.officerId,
      officerName: data.officerName,
      catchments: data.catchments,
    });
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await fetch("/manager/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, forceChangePassword, mfaChallenge, mfaSetup, mfaVerifySetup, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
