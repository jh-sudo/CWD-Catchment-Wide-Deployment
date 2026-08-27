import React, { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import type { MfaSetupInfo } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { Link } from "wouter";

type Step =
  | { kind: "credentials" }
  | { kind: "change-password" }
  | { kind: "mfa-challenge" }
  | { kind: "mfa-enroll" };

export default function Login() {
  const { login, forceChangePassword, mfaChallenge, mfaSetup, mfaVerifySetup } = useAuth();
  const [step, setStep] = useState<Step>({ kind: "credentials" });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [enrollInfo, setEnrollInfo] = useState<MfaSetupInfo | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Shared by handleCredentialsSubmit and handleChangePasswordSubmit — both
  // can hand back the same AuthStep union for what comes next.
  const applyAuthStep = (result: Awaited<ReturnType<typeof login>>) => {
    if (result?.step === "changePassword") setStep({ kind: "change-password" });
    else if (result?.step === "challenge") setStep({ kind: "mfa-challenge" });
    else if (result?.step === "enroll") setStep({ kind: "mfa-enroll" });
    // result === null: the auth context already set the authenticated user —
    // the app shell re-renders away from this page on its own.
  };

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      applyAuthStep(await login(username, password));
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < 12) { setError("New password must be at least 12 characters"); return; }
    if (!/[0-9]/.test(newPassword) && !/[^a-zA-Z0-9]/.test(newPassword)) {
      setError("New password must include a number or special character"); return;
    }
    if (newPassword !== confirmPassword) { setError("Passwords do not match"); return; }
    setLoading(true);
    try {
      applyAuthStep(await forceChangePassword(newPassword));
    } catch (err: any) {
      setError(err.message || "Could not set password");
    } finally {
      setLoading(false);
    }
  };

  const handleChallengeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await mfaChallenge(code);
    } catch (err: any) {
      setError(err.message || "Incorrect code");
    } finally {
      setLoading(false);
    }
  };

  // Kick off enrollment (get the QR/secret) as soon as we land on that step.
  useEffect(() => {
    if (step.kind !== "mfa-enroll" || enrollInfo) return;
    setError("");
    mfaSetup()
      .then(setEnrollInfo)
      .catch((err) => setError(err.message || "Could not start MFA setup"));
  }, [step.kind, enrollInfo, mfaSetup]);

  const handleEnrollSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await mfaVerifySetup(code);
    } catch (err: any) {
      setError(err.message || "Incorrect code");
    } finally {
      setLoading(false);
    }
  };

  if (step.kind === "change-password") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold text-primary">Set a New Password</CardTitle>
            <CardDescription>This account still has a default password and must set a new one before continuing.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePasswordSubmit} className="space-y-4">
              {error && (
                <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
                  {error}
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Min. 12 characters, with a number or symbol"
                  autoFocus
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Set Password &amp; Continue
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step.kind === "mfa-challenge") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold text-primary">Two-Factor Authentication</CardTitle>
            <CardDescription>Enter the 6-digit code from your authenticator app</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChallengeSubmit} className="space-y-4">
              {error && (
                <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
                  {error}
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="mfa-code">Authentication code</Label>
                <Input
                  id="mfa-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  autoFocus
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Verify
              </Button>
              <button
                type="button"
                className="w-full text-center text-sm text-muted-foreground hover:underline"
                onClick={() => { setStep({ kind: "credentials" }); setCode(""); setError(""); }}
              >
                Back to sign in
              </button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step.kind === "mfa-enroll") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold text-primary">Set Up Two-Factor Authentication</CardTitle>
            <CardDescription>
              Required for this account. Scan the QR code with an authenticator app
              (Microsoft/Google Authenticator, etc.), or enter the setup key manually.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleEnrollSubmit} className="space-y-4">
              {error && (
                <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
                  {error}
                </div>
              )}
              {enrollInfo ? (
                <>
                  <div className="flex justify-center">
                    <img
                      src={enrollInfo.qrCodeDataUrl}
                      alt="MFA setup QR code"
                      className="w-44 h-44 rounded-md bg-white p-2"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Setup key</Label>
                    <div className="font-mono text-xs break-all bg-muted rounded-md px-3 py-2">
                      {enrollInfo.secret}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="mfa-enroll-code">Enter the 6-digit code it shows</Label>
                <Input
                  id="mfa-enroll-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  required
                  disabled={!enrollInfo}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading || !enrollInfo}>
                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Confirm &amp; Continue
              </Button>
              <button
                type="button"
                className="w-full text-center text-sm text-muted-foreground hover:underline"
                onClick={() => { setStep({ kind: "credentials" }); setCode(""); setEnrollInfo(null); setError(""); }}
              >
                Back to sign in
              </button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-primary">Duty Roster</CardTitle>
          <CardDescription>Sign in to your account</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCredentialsSubmit} className="space-y-4">
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
                {error}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Enter username"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter password"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Sign In
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Don't have an account?{" "}
              <Link href="/register" className="text-primary hover:underline font-medium">
                Register
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
