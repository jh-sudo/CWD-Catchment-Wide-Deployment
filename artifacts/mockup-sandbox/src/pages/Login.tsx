import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store";
import { Warehouse, Eye, EyeOff, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { cn } from "../lib/utils";

type Tab = "signin" | "register";

export default function Login() {
  const { login, register } = useStore();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("signin");

  // Sign-in state
  const [siEmail, setSiEmail] = useState("");
  const [siPassword, setSiPassword] = useState("");
  const [siShowPw, setSiShowPw] = useState(false);
  const [siError, setSiError] = useState("");
  const [siLoading, setSiLoading] = useState(false);

  // Registration state
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirm, setRegConfirm] = useState("");
  const [regShowPw, setRegShowPw] = useState(false);
  const [regError, setRegError] = useState("");
  const [regLoading, setRegLoading] = useState(false);
  const [regSuccess, setRegSuccess] = useState(false);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setSiError("");
    setSiLoading(true);
    await new Promise(r => setTimeout(r, 400));
    const ok = login(siEmail, siPassword);
    setSiLoading(false);
    if (ok) navigate("/dashboard");
    else setSiError("Invalid email or password.");
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError("");
    if (regPassword !== regConfirm) {
      setRegError("Passwords do not match.");
      return;
    }
    setRegLoading(true);
    await new Promise(r => setTimeout(r, 400));
    const result = register(regEmail, regPassword, regName);
    setRegLoading(false);
    if (result.ok) {
      setRegSuccess(true);
    } else {
      setRegError(result.error ?? "Registration failed.");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-500 mb-4 shadow-lg">
            <Warehouse className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Warehouse IMS</h1>
          <p className="text-slate-400 text-sm mt-1">Flood Response Inventory System</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-slate-100">
            {(["signin", "register"] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => { setTab(t); setSiError(""); setRegError(""); setRegSuccess(false); }}
                className={cn(
                  "flex-1 py-3.5 text-sm font-medium transition-colors",
                  tab === t
                    ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50"
                    : "text-slate-500 hover:text-slate-700"
                )}
              >
                {t === "signin" ? "Sign In" : "Create Account"}
              </button>
            ))}
          </div>

          <div className="p-6">
            {/* ── Sign In ── */}
            {tab === "signin" && (
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="si-email" className="text-sm text-slate-700">Email</Label>
                  <Input
                    id="si-email" type="email" value={siEmail}
                    onChange={e => setSiEmail(e.target.value)}
                    placeholder="you@example.gov.sg" required className="h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="si-password" className="text-sm text-slate-700">Password</Label>
                  <div className="relative">
                    <Input
                      id="si-password" type={siShowPw ? "text" : "password"} value={siPassword}
                      onChange={e => setSiPassword(e.target.value)} placeholder="••••••••" required
                      className="h-10 pr-10"
                    />
                    <button type="button" onClick={() => setSiShowPw(!siShowPw)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      {siShowPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {siError && (
                  <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {siError}
                  </div>
                )}

                <Button type="submit" className="w-full h-10 bg-blue-600 hover:bg-blue-700" disabled={siLoading}>
                  {siLoading ? "Signing in…" : "Sign In"}
                </Button>
              </form>
            )}

            {/* ── Create Account ── */}
            {tab === "register" && (
              <>
                {regSuccess ? (
                  <div className="py-6 text-center space-y-3">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-green-100 mb-1">
                      <CheckCircle2 className="w-7 h-7 text-green-600" />
                    </div>
                    <h3 className="font-semibold text-slate-800">Account Submitted</h3>
                    <p className="text-sm text-slate-500 leading-relaxed">
                      Your account is pending administrator approval. You will be able to sign in once it has been reviewed.
                    </p>
                    <button
                      onClick={() => { setTab("signin"); setRegSuccess(false); }}
                      className="text-sm text-blue-600 hover:underline mt-1"
                    >
                      Back to Sign In
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleRegister} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-name" className="text-sm text-slate-700">Full Name</Label>
                      <Input
                        id="reg-name" type="text" value={regName}
                        onChange={e => setRegName(e.target.value)}
                        placeholder="Your full name" required className="h-10"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-email" className="text-sm text-slate-700">Email</Label>
                      <Input
                        id="reg-email" type="email" value={regEmail}
                        onChange={e => setRegEmail(e.target.value)}
                        placeholder="you@example.gov.sg" required className="h-10"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-password" className="text-sm text-slate-700">Password</Label>
                      <div className="relative">
                        <Input
                          id="reg-password" type={regShowPw ? "text" : "password"} value={regPassword}
                          onChange={e => setRegPassword(e.target.value)}
                          placeholder="Min. 8 characters" required minLength={8} className="h-10 pr-10"
                        />
                        <button type="button" onClick={() => setRegShowPw(!regShowPw)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                          {regShowPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-confirm" className="text-sm text-slate-700">Confirm Password</Label>
                      <Input
                        id="reg-confirm" type="password" value={regConfirm}
                        onChange={e => setRegConfirm(e.target.value)}
                        placeholder="Re-enter password" required className="h-10"
                      />
                    </div>

                    {regError && (
                      <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {regError}
                      </div>
                    )}

                    <Button type="submit" className="w-full h-10 bg-blue-600 hover:bg-blue-700" disabled={regLoading}>
                      {regLoading ? "Creating account…" : "Create Account"}
                    </Button>
                    <p className="text-xs text-slate-400 text-center">
                      New accounts require administrator approval before access is granted.
                    </p>
                  </form>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
