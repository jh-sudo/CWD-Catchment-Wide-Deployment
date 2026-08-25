import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

export type AccountRole = "admin" | "manager" | "ic" | "crew";

export interface AuthUser {
  id: string;
  username: string;
  role: AccountRole;
  officerId?: string;
  officerName?: string;
  catchments?: string[];
}

// Returned by login() when the account has mandatory/enabled MFA (see
// artifacts/api-server/src/routes/auth.ts's pendingMfaManagerId) — the
// session isn't authenticated yet, so the caller (Login.tsx) must drive a
// second step before treating the user as signed in.
export type MfaStep =
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
  /** Resolves to an MfaStep if a second step is required, or null once fully authenticated. */
  login: (username: string, password: string) => Promise<MfaStep | null>;
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

  const login = useCallback(async (username: string, password: string): Promise<MfaStep | null> => {
    const res = await fetch("/manager/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");
    // Password verified but the account still needs a second factor — no
    // session was authenticated yet (server holds it in a pending state), so
    // don't set `user` here. The caller drives mfaChallenge()/mfaSetup().
    if (data.mfaStep === "challenge") return { step: "challenge" };
    if (data.mfaStep === "enroll") return { step: "enroll", username: data.username ?? username };
    setUser({
      id: data.id ?? username,
      username: data.username ?? username,
      role: data.role,
      officerId: data.officerId,
      officerName: data.officerName,
      catchments: data.catchments,
    });
    await refresh();
    return null;
  }, [refresh]);

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
    <AuthContext.Provider value={{ user, loading, login, mfaChallenge, mfaSetup, mfaVerifySetup, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
