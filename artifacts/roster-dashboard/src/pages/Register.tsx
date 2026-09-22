import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, CheckCircle } from "lucide-react";
import { Link } from "wouter";

const CATCHMENT_OPTIONS = [
  "Bukit Timah & Urban",
  "Jurong & Pandan",
  "Kranji & Woodlands",
  "Changi & Punggol",
  "Kallang & Geylang",
];

interface Officer {
  id: string;
  name: string;
  unitCode?: string;
  catchment?: string;
}

export default function Register() {
  const [role, setRole] = useState<"crew" | "ic" | "">("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [officerId, setOfficerId] = useState("");
  const [selectedCatchments, setSelectedCatchments] = useState<string[]>([]);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // The full /officers endpoint is unauthenticated and returns every
    // column on the officer record — this signup page only needs a name to
    // pick from, so use the minimal, purpose-built picker endpoint instead.
    // activeOnly=1 preserves this page's existing active-only filtering
    // (the endpoint defaults to including inactive officers for
    // RosterBuilder.tsx's different needs). .scratch/replit-resync-2026-09-21/issues/21.
    fetch("/api/roster-plan/officer-names?activeOnly=1")
      .then(r => r.json())
      .then((all: Officer[]) => setOfficers(all))
      .catch(() => {});
  }, []);

  const toggleCatchment = (c: string) => {
    setSelectedCatchments(prev =>
      prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!role) { setError("Please select your role"); return; }
    if (password !== password2) { setError("Passwords do not match"); return; }
    if (password.length < 12) { setError("Password must be at least 12 characters"); return; }
    if (!/[0-9]/.test(password) && !/[^a-zA-Z0-9]/.test(password)) {
      setError("Password must include a number or special character"); return;
    }
    if (role === "crew" && !officerId) { setError("Please select your name from the roster"); return; }
    if (role === "ic" && selectedCatchments.length === 0) {
      setError("Please select at least one catchment group"); return;
    }

    setLoading(true);
    try {
      const res = await fetch("/manager/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          role,
          officerId: role === "crew" ? officerId : undefined,
          catchments: role === "ic" ? selectedCatchments : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");
      setDone(true);
    } catch (err: any) {
      setError(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
        <Card className="w-full max-w-sm text-center">
          <CardContent className="pt-8 pb-8 space-y-4">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
            <div>
              <p className="font-semibold text-lg">Request Submitted</p>
              <p className="text-sm text-muted-foreground mt-1">
                Your account is pending admin approval. You'll be able to log in once approved.
              </p>
            </div>
            <Link href="/login">
              <Button variant="outline" className="w-full">Back to Sign In</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-primary">Register</CardTitle>
          <CardDescription>Create your roster account</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            {/* Role selection */}
            <div className="space-y-1.5">
              <Label>I am a</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["crew", "ic"] as const).map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={`px-3 py-2.5 rounded-md border text-sm font-medium transition-colors ${
                      role === r
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {r === "crew" ? "Crew Officer" : "Roster IC"}
                  </button>
                ))}
              </div>
            </div>

            {/* Crew: pick officer from roster */}
            {role === "crew" && (
              <div className="space-y-1.5">
                <Label>Your name in the roster</Label>
                <Select value={officerId} onValueChange={setOfficerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select your name…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60 overflow-y-auto">
                    {officers
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map(o => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}{o.unitCode ? ` — ${o.unitCode}` : ""}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* IC: pick catchment groups */}
            {role === "ic" && (
              <div className="space-y-1.5">
                <Label>Groups you manage (select all that apply)</Label>
                <div className="space-y-2">
                  {CATCHMENT_OPTIONS.map(c => (
                    <label
                      key={c}
                      className="flex items-center gap-2.5 cursor-pointer text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selectedCatchments.includes(c)}
                        onChange={() => toggleCatchment(c)}
                        className="accent-primary h-4 w-4"
                      />
                      {c}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="reg-username">Username</Label>
              <Input
                id="reg-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Choose a username"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-pass">Password</Label>
              <Input
                id="reg-pass"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Min. 12 characters, with a number or symbol"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-pass2">Confirm Password</Label>
              <Input
                id="reg-pass2"
                type="password"
                autoComplete="new-password"
                value={password2}
                onChange={e => setPassword2(e.target.value)}
                placeholder="Repeat password"
                required
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Request Access
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="text-primary hover:underline font-medium">
                Sign in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
