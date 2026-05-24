import { useGetAdminSummary, useListListenerApplications, useListAllTransactions, useDecideListenerApplication, getListListenerApplicationsQueryKey, getGetAdminSummaryQueryKey, getListAllTransactionsQueryKey } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useCallback } from "react";
import { apiUrl } from "@/lib/apiBase";
import { toast } from "sonner";
import { signInWithPopup } from "firebase/auth";
import { firebaseAuth, GoogleAuthProvider } from "@/lib/firebase";
import {
  ShieldCheck, LayoutDashboard, Users, ListChecks, IndianRupee,
  Activity, ArrowDownToLine, LogOut, CheckCircle2, XCircle, Phone,
  MessageCircle, Circle, Wallet, RefreshCw, Clock,
  UserCheck, AlertCircle, ScrollText, TrendingUp, Percent,
  CheckCheck, Ban, Eye, EyeOff, ArrowRightLeft, ShieldAlert, ShieldOff,
  TriangleAlert, UserX, UserCheck2, PhoneMissed, PhoneCall, FlaskConical,
  UserCog, Hourglass, Trash2, Send, Smartphone,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Admin theme tokens (dark navy + gold) ─────────────────────────────────────
const A = {
  bg:       "#0b0f1a",
  surface:  "#111827",
  card:     "#161d2e",
  cardHov:  "#1c2540",
  border:   "#1e2a42",
  border2:  "#253352",
  gold:     "#f5a623",
  gold2:    "#e89b1b",
  goldDim:  "rgba(245,166,35,0.12)",
  goldGlow: "rgba(245,166,35,0.25)",
  text:     "#e8edf8",
  sub:      "#8a9bbf",
  dim:      "#4a5a7a",
  green:    "#22c55e",
  red:      "#ef4444",
  orange:   "#f97316",
  blue:     "#3b82f6",
  purple:   "#a855f7",
};

function ACard({ children, className = "", style = {} }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={cn("rounded-2xl border p-4", className)} style={{ background: A.card, borderColor: A.border, ...style }}>
      {children}
    </div>
  );
}

function ABadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string }> = {
    pending:  { bg: "rgba(249,115,22,0.15)", text: A.orange },
    approved: { bg: "rgba(34,197,94,0.15)",  text: A.green },
    rejected: { bg: "rgba(239,68,68,0.15)",  text: A.red },
    active:   { bg: "rgba(34,197,94,0.15)",  text: A.green },
    ended:    { bg: "rgba(74,90,122,0.2)",    text: A.dim },
    paid:     { bg: "rgba(34,197,94,0.15)",  text: A.green },
    online:   { bg: "rgba(34,197,94,0.15)",  text: A.green },
    offline:  { bg: "rgba(74,90,122,0.2)",   text: A.dim },
    user:     { bg: "rgba(59,130,246,0.15)", text: A.blue },
    listener: { bg: "rgba(168,85,247,0.15)", text: A.purple },
  };
  const c = map[status] ?? { bg: "rgba(74,90,122,0.2)", text: A.sub };
  return (
    <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full" style={{ background: c.bg, color: c.text }}>
      {status}
    </span>
  );
}

type Tab = "overview" | "live" | "applications" | "payments" | "revenue" | "payouts" | "users" | "transactions" | "audit" | "violations" | "safety" | "callbacks";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "overview",      label: "Overview",       icon: LayoutDashboard },
  { id: "live",          label: "Live",           icon: Activity },
  { id: "applications",  label: "Applications",   icon: ListChecks },
  { id: "payments",      label: "Payments",       icon: IndianRupee },
  { id: "revenue",       label: "Revenue",        icon: TrendingUp },
  { id: "payouts",       label: "Payouts",        icon: ArrowDownToLine },
  { id: "users",         label: "Users",          icon: Users },
  { id: "transactions",  label: "Transactions",   icon: Wallet },
  { id: "audit",         label: "Audit Log",      icon: ScrollText },
  { id: "violations",    label: "Violations",     icon: ShieldAlert },
  { id: "safety",        label: "Safety Alerts",  icon: ShieldCheck },
  { id: "callbacks",     label: "Missed Calls",   icon: PhoneMissed },
];

function fmtRupees(n: number) { return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 !== 0 ? 2 : 0 })}`; }
function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function fmtAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN PIN LOCK SCREEN
// ═══════════════════════════════════════════════════════════════════════════════
const PIN_SESSION_KEY = "admin_pin_verified";

function AdminPinLock({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const locked = attempts >= 5;

  const handleDigit = (d: string) => {
    if (locked || pin.length >= 6) return;
    const next = pin + d;
    setPin(next);
    setError("");
    if (next.length >= 4) {
      // auto-submit once 4+ digits entered (try immediately)
      submitPin(next);
    }
  };

  const handleDelete = () => { setPin(p => p.slice(0, -1)); setError(""); };

  const submitPin = async (value: string) => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/admin/verify-pin"), {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: value }),
      });
      if (res.ok) {
        localStorage.setItem(PIN_SESSION_KEY, "1");
        onUnlock();
      } else {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        setPin("");
        setError(newAttempts >= 5 ? "Too many wrong attempts. Refresh to try again." : `Wrong PIN (${5 - newAttempts} attempts left)`);
      }
    } catch {
      setError("Network error. Try again.");
      setPin("");
    } finally {
      setLoading(false);
    }
  };

  const digits = ["1","2","3","4","5","6","7","8","9","","0","⌫"];

  return (
    <div style={{ background: A.bg, minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
      <div style={{ width: "100%", maxWidth: 320, textAlign: "center" }}>
        {/* Logo */}
        <div style={{ width: 64, height: 64, borderRadius: 20, background: `linear-gradient(135deg, ${A.gold}, ${A.gold2})`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 1.5rem" }}>
          <ShieldCheck size={32} color="#000" />
        </div>
        <p style={{ color: A.gold, fontWeight: 900, fontSize: 18, marginBottom: 4 }}>Admin Access</p>
        <p style={{ color: A.sub, fontSize: 13, marginBottom: 32 }}>Enter your secret PIN to continue</p>

        {/* PIN dots */}
        <div style={{ display: "flex", gap: 14, justifyContent: "center", marginBottom: 32 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{
              width: 16, height: 16, borderRadius: "50%",
              background: i < pin.length ? A.gold : "transparent",
              border: `2px solid ${i < pin.length ? A.gold : A.border2}`,
              transition: "all 0.15s",
            }} />
          ))}
        </div>

        {/* Error */}
        {error && (
          <p style={{ color: A.red, fontSize: 12, marginBottom: 20, fontWeight: 700 }}>{error}</p>
        )}

        {/* Numpad */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {digits.map((d, i) => {
            if (d === "") return <div key={i} />;
            const isDelete = d === "⌫";
            return (
              <button
                key={i}
                onClick={() => isDelete ? handleDelete() : handleDigit(d)}
                disabled={locked || loading || (!isDelete && pin.length >= 6)}
                style={{
                  height: 64, borderRadius: 16, border: `1px solid ${A.border2}`,
                  background: isDelete ? "transparent" : A.card,
                  color: isDelete ? A.sub : A.text,
                  fontSize: isDelete ? 20 : 22, fontWeight: 700,
                  cursor: locked || loading ? "not-allowed" : "pointer",
                  opacity: locked ? 0.4 : 1,
                  transition: "background 0.12s",
                }}
                onMouseDown={e => { (e.currentTarget as HTMLButtonElement).style.background = isDelete ? A.border : A.cardHov; }}
                onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.background = isDelete ? "transparent" : A.card; }}
              >
                {loading && !isDelete && d === pin[pin.length - 1] ? "·" : d}
              </button>
            );
          })}
        </div>

        {pin.length > 0 && !loading && (
          <button
            onClick={() => submitPin(pin)}
            style={{ marginTop: 20, width: "100%", height: 52, borderRadius: 16, background: `linear-gradient(135deg, ${A.gold}, ${A.gold2})`, color: "#000", fontWeight: 900, fontSize: 15, border: "none", cursor: "pointer" }}
          >
            Unlock →
          </button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN LOGIN  (Email → PIN — no Firebase/Google needed)
// ═══════════════════════════════════════════════════════════════════════════════
// Wrapper defined OUTSIDE AdminGoogleLogin so its reference is stable across
// re-renders — prevents React from unmounting/remounting the email input on
// every keystroke (which caused focus to jump away while typing).
function AdminLoginWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: A.bg, minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "1.5rem", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 360, textAlign: "center" }}>
        <div style={{ width: 72, height: 72, borderRadius: 24, background: `linear-gradient(135deg, ${A.gold}, ${A.gold2})`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 1.25rem", boxShadow: `0 0 48px ${A.goldGlow}` }}>
          <ShieldCheck size={36} color="#000" />
        </div>
        <p style={{ color: A.text, fontWeight: 900, fontSize: 22, letterSpacing: "-0.5px", margin: "0 0 4px" }}>SunoSathi</p>
        <p style={{ color: A.gold, fontWeight: 700, fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", margin: "0 0 2rem" }}>Owner Admin Portal</p>
        {children}
      </div>
    </div>
  );
}

type LoginStep = "init" | "email" | "pin" | "denied";

function AdminGoogleLogin({ onSuccess }: { onSuccess: (email: string) => void }) {
  const [step, setStep]       = useState<LoginStep>("init");
  const [email, setEmail]     = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [pin, setPin]         = useState("");
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const locked = attempts >= 5;

  // On mount: check if already authenticated as admin
  useEffect(() => {
    fetch(apiUrl("/api/me"), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then((p: { isAdmin?: boolean; email?: string | null; id?: string } | null) => {
        if (p?.isAdmin) {
          setEmail(p.email ?? "");
          setStep("pin");
        } else {
          setStep("email");
        }
      })
      .catch(() => setStep("email"));
  }, []);

  function handleEmailNext() {
    const trimmed = emailInput.trim().toLowerCase();
    if (!trimmed.includes("@")) { setError("Valid email daalo."); return; }
    setEmail(trimmed);
    setError("");
    setStep("pin");
  }

  async function handleAdminLogin(pinValue: string) {
    if (loading || locked) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(apiUrl("/api/auth/admin-login"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, pin: pinValue }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (res.ok) {
        localStorage.setItem(PIN_SESSION_KEY, "1");
        onSuccess(email);
      } else {
        const next = attempts + 1;
        setAttempts(next);
        setPin("");
        if (data?.error?.includes("email")) {
          setStep("email");
          setError(data.error);
        } else {
          setError(next >= 5 ? "Too many wrong attempts. Refresh to try again." : (data?.error ?? `Wrong PIN (${5 - next} left)`));
        }
      }
    } catch {
      setError("Network error. Try again.");
      setPin("");
    } finally {
      setLoading(false);
    }
  }

  const handleDigit = (d: string) => {
    if (locked || pin.length >= 6) return;
    const next = pin + d;
    setPin(next);
    setError("");
    if (next.length >= 4) handleAdminLogin(next);
  };

  const handleDelete = () => { setPin(p => p.slice(0, -1)); setError(""); };
  const digits = ["1","2","3","4","5","6","7","8","9","","0","⌫"];

  // ── Loading / checking session
  if (step === "init") {
    return (
      <AdminLoginWrapper>
        <div className="w-10 h-10 rounded-full border-4 animate-spin mx-auto" style={{ borderColor: A.gold, borderTopColor: "transparent" }} />
      </AdminLoginWrapper>
    );
  }

  // ── Email entry step
  if (step === "email") {
    return (
      <AdminLoginWrapper>
        <div style={{ background: A.card, borderRadius: 24, padding: "2rem", border: `1px solid ${A.border}`, boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
          <p style={{ color: A.sub, fontSize: 13, margin: "0 0 1.5rem" }}>Apna owner email daalo to continue</p>

          <input
            type="email"
            value={emailInput}
            onChange={e => { setEmailInput(e.target.value); setError(""); }}
            onKeyDown={e => e.key === "Enter" && handleEmailNext()}
            placeholder="admin@gmail.com"
            autoFocus
            autoComplete="email"
            style={{
              width: "100%", height: 52, borderRadius: 14, border: `1.5px solid ${A.border2}`,
              background: A.bg, color: A.text, fontSize: 15, padding: "0 16px",
              outline: "none", boxSizing: "border-box", marginBottom: "1rem",
            }}
          />

          <button
            onClick={handleEmailNext}
            style={{ width: "100%", height: 52, borderRadius: 14, background: `linear-gradient(135deg, ${A.gold}, ${A.gold2})`, border: "none", color: "#000", fontWeight: 900, fontSize: 15, cursor: "pointer" }}
          >
            Aage Badho →
          </button>

          {error && (
            <div style={{ marginTop: "1rem", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 10, padding: "10px 14px", color: A.red, fontSize: 13, fontWeight: 600 }}>
              {error}
            </div>
          )}
        </div>
        <p style={{ color: A.dim, fontSize: 11, marginTop: "1.5rem", letterSpacing: "0.05em" }}>
          Restricted access · SunoSathi Owner Only
        </p>
      </AdminLoginWrapper>
    );
  }

  // ── PIN entry step
  return (
    <AdminLoginWrapper>
      <p style={{ color: A.sub, fontSize: 13, marginBottom: 8 }}>
        Email: <span style={{ color: A.gold, fontWeight: 700 }}>{email}</span>
      </p>
      <p style={{ color: A.sub, fontSize: 13, marginBottom: 28 }}>Admin PIN daalo</p>

      {/* PIN dots */}
      <div style={{ display: "flex", gap: 14, justifyContent: "center", marginBottom: 28 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ width: 16, height: 16, borderRadius: "50%", background: i < pin.length ? A.gold : "transparent", border: `2px solid ${i < pin.length ? A.gold : A.border2}`, transition: "all 0.15s" }} />
        ))}
      </div>

      {error && <p style={{ color: A.red, fontSize: 12, marginBottom: 16, fontWeight: 700 }}>{error}</p>}

      {/* Numpad */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, maxWidth: 260, margin: "0 auto" }}>
        {digits.map((d, i) => {
          if (d === "") return <div key={i} />;
          const isDel = d === "⌫";
          return (
            <button key={i} onClick={() => isDel ? handleDelete() : handleDigit(d)}
              disabled={locked || loading || (!isDel && pin.length >= 6)}
              style={{ height: 60, borderRadius: 14, border: `1px solid ${A.border2}`, background: isDel ? "transparent" : A.card, color: isDel ? A.sub : A.text, fontSize: isDel ? 20 : 22, fontWeight: 700, cursor: locked || loading ? "not-allowed" : "pointer", opacity: locked ? 0.4 : 1 }}
            >
              {loading && !isDel && d === pin[pin.length - 1] ? "·" : d}
            </button>
          );
        })}
      </div>

      {pin.length > 0 && !loading && (
        <button onClick={() => handleAdminLogin(pin)}
          style={{ marginTop: 20, width: "100%", maxWidth: 260, margin: "16px auto 0", display: "block", height: 50, borderRadius: 14, background: `linear-gradient(135deg, ${A.gold}, ${A.gold2})`, color: "#000", fontWeight: 900, fontSize: 14, border: "none", cursor: "pointer" }}>
          Unlock →
        </button>
      )}

      <button onClick={() => { setStep("email"); setPin(""); setError(""); setAttempts(0); }}
        style={{ marginTop: 20, background: "none", border: "none", color: A.dim, fontSize: 12, cursor: "pointer", display: "block", width: "100%", textAlign: "center" }}>
        ← Email change karein
      </button>
    </AdminLoginWrapper>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ADMIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════
type AdminStage = "checking" | "login" | "dashboard";

export default function Admin() {
  const [stage, setStage]       = useState<AdminStage>(() =>
    localStorage.getItem(PIN_SESSION_KEY) === "1" ? "checking" : "login"
  );
  const [adminEmail, setAdminEmail] = useState<string>("");
  const [activeTab, setActiveTab]   = useState<Tab>("overview");
  const isDashboard = stage === "dashboard";

  // Data hooks — all gated on dashboard stage to avoid 401s pre-login
  const { data: apps } = useListListenerApplications({ query: { enabled: isDashboard, queryKey: getListListenerApplicationsQueryKey() } });

  // If a PIN session token exists in localStorage, verify server session is still valid
  useEffect(() => {
    if (stage !== "checking") return;
    fetch(apiUrl("/api/me"), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then((p: { isAdmin?: boolean; email?: string | null } | null) => {
        if (p?.isAdmin) {
          setAdminEmail(p.email ?? "");
          setStage("dashboard");
        } else {
          localStorage.removeItem(PIN_SESSION_KEY);
          setStage("login");
        }
      })
      .catch(() => { localStorage.removeItem(PIN_SESSION_KEY); setStage("login"); });
  }, [stage]);

  const handleLogout = () => {
    localStorage.removeItem(PIN_SESSION_KEY);
    fetch(apiUrl("/api/auth/google/logout"), { method: "POST", credentials: "include" }).catch(() => {});
    setStage("login");
  };

  if (stage === "checking") {
    return (
      <div style={{ background: A.bg, minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: A.gold, borderTopColor: "transparent" }} />
      </div>
    );
  }

  if (stage === "login") {
    return <AdminGoogleLogin onSuccess={(email) => { setAdminEmail(email); setStage("dashboard"); }} />;
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────
  const pendingApps = apps?.filter(a => a.status === "pending").length ?? 0;

  return (
    <div style={{ background: A.bg, minHeight: "100dvh", color: A.text, fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* ── Admin Header ─────────────────────────────────────────────────────── */}
      <header style={{ background: A.surface, borderBottom: `1px solid ${A.border}`, padding: "0 1rem" }}
        className="sticky top-0 z-50 flex items-center justify-between h-14">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${A.gold}, ${A.gold2})` }}>
            <ShieldCheck className="w-4 h-4 text-black" />
          </div>
          <div>
            <p className="font-black text-sm leading-none" style={{ color: A.gold }}>SunoSathi Admin</p>
            <p className="text-[10px] leading-none mt-0.5" style={{ color: A.sub }}>Owner Control Panel</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold" style={{ background: A.goldDim, color: A.gold, border: `1px solid rgba(245,166,35,0.2)` }}>
            <ShieldCheck className="w-3 h-3" />
            {adminEmail || "Owner"}
          </div>
          <button onClick={handleLogout} className="p-1.5 rounded-lg transition-colors hover:bg-white/5" title="Log out">
            <LogOut className="w-4 h-4" style={{ color: A.sub }} />
          </button>
        </div>
      </header>

      <div className="flex" style={{ minHeight: "calc(100dvh - 56px)" }}>
        {/* ── Sidebar nav (desktop) ─────────────────────────────────────────── */}
        <aside className="hidden md:flex flex-col w-48 shrink-0 sticky top-14 self-start h-[calc(100dvh-56px)] overflow-y-auto"
          style={{ background: A.surface, borderRight: `1px solid ${A.border}` }}>
          <nav className="p-3 space-y-1 flex-1">
            {TABS.map(tab => {
              const isActive = activeTab === tab.id;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all text-sm font-semibold"
                  style={{
                    background: isActive ? A.goldDim : "transparent",
                    color: isActive ? A.gold : A.sub,
                    border: isActive ? `1px solid rgba(245,166,35,0.2)` : "1px solid transparent",
                  }}>
                  <tab.icon className="w-4 h-4 shrink-0" />
                  <span>{tab.label}</span>
                  {tab.id === "applications" && pendingApps > 0 && (
                    <span className="ml-auto w-5 h-5 rounded-full text-[9px] font-black flex items-center justify-center" style={{ background: A.orange, color: "white" }}>
                      {pendingApps}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* ── Main content ─────────────────────────────────────────────────── */}
        <main className="flex-1 overflow-x-hidden">
          {/* Mobile tab scrollbar */}
          <div className="md:hidden overflow-x-auto border-b" style={{ borderColor: A.border, background: A.surface }}>
            <div className="flex px-3 py-2 gap-1 min-w-max">
              {TABS.map(tab => {
                const isActive = activeTab === tab.id;
                return (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all"
                    style={{
                      background: isActive ? A.goldDim : "transparent",
                      color: isActive ? A.gold : A.sub,
                      border: isActive ? `1px solid rgba(245,166,35,0.25)` : "1px solid transparent",
                    }}>
                    <tab.icon className="w-3.5 h-3.5" />
                    {tab.label}
                    {tab.id === "applications" && pendingApps > 0 && (
                      <span className="w-4 h-4 rounded-full text-[9px] font-black flex items-center justify-center" style={{ background: A.orange, color: "white" }}>
                        {pendingApps}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-4 max-w-5xl mx-auto">
            {activeTab === "overview"      && <OverviewTab />}
            {activeTab === "live"          && <LiveTab />}
            {activeTab === "applications"  && <ApplicationsTab />}
            {activeTab === "payments"      && <PaymentsTab />}
            {activeTab === "revenue"       && <RevenueTab />}
            {activeTab === "payouts"       && <PayoutsTab />}
            {activeTab === "users"         && <UsersTab />}
            {activeTab === "transactions"  && <TransactionsTab />}
            {activeTab === "audit"         && <AuditLogTab />}
            {activeTab === "violations"    && <ViolationsTab />}
            {activeTab === "safety"        && <SafetyAlertsTab />}
            {activeTab === "callbacks"     && <CallbacksTab />}
          </div>
        </main>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════════════════════════════════
type AdminSummary = {
  totalUsers: number; totalListeners: number; pendingApplications: number;
  onlineListeners: number; totalRevenueInRupees: number; totalSessionRevenue: number;
  totalListenerEarningsRupees: number; adminProfitRupees: number;
  sessionsToday: number; activeSessions: number;
};

function OverviewTab() {
  const { data: s, isLoading } = useGetAdminSummary() as { data: AdminSummary | undefined; isLoading: boolean };

  const statCards = s ? [
    { icon: Users,       label: "Total Users",          value: s.totalUsers,              color: A.blue,   glow: "rgba(59,130,246,0.15)" },
    { icon: UserCheck,   label: "Verified Listeners",   value: s.totalListeners,          color: A.purple, glow: "rgba(168,85,247,0.15)" },
    { icon: Circle,      label: "Online Now",           value: s.onlineListeners,         color: A.green,  glow: "rgba(34,197,94,0.15)" },
    { icon: Activity,    label: "Active Sessions",      value: s.activeSessions,          color: A.gold,   glow: A.goldDim },
    { icon: Clock,       label: "Sessions Today",       value: s.sessionsToday,           color: A.orange, glow: "rgba(249,115,22,0.15)" },
    { icon: AlertCircle, label: "Pending Applications", value: s.pendingApplications,     color: A.orange, glow: "rgba(249,115,22,0.15)" },
  ] : [];

  const financialCards = s ? [
    { label: "Total Recharge Revenue", value: fmtRupees(s.totalRevenueInRupees),       desc: "Sum of all UPI top-ups",         color: A.blue },
    { label: "Session Revenue",        value: fmtRupees(s.totalSessionRevenue),         desc: "All billed session charges",     color: A.purple },
    { label: "Admin Net Profit",       value: fmtRupees(s.adminProfitRupees),           desc: "Revenue after listener payouts", color: A.gold },
    { label: "Listener Payouts",       value: fmtRupees(s.totalListenerEarningsRupees), desc: "Total earnings credited",        color: A.green },
  ] : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xs font-black uppercase tracking-widest mb-3" style={{ color: A.sub }}>Platform Stats</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {isLoading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-2xl p-4 animate-pulse h-20" style={{ background: A.card, border: `1px solid ${A.border}` }} />
              ))
            : statCards.map(c => (
                <ACard key={c.label} className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: c.glow }}>
                    <c.icon className="w-5 h-5" style={{ color: c.color }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] leading-tight mb-0.5" style={{ color: A.sub }}>{c.label}</p>
                    <p className="text-2xl font-black leading-none" style={{ color: c.color }}>{c.value}</p>
                  </div>
                </ACard>
              ))
          }
        </div>
      </div>

      <div>
        <h2 className="text-xs font-black uppercase tracking-widest mb-3" style={{ color: A.sub }}>Financial Breakdown</h2>
        <div className="grid grid-cols-2 gap-3">
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-2xl p-4 animate-pulse h-24" style={{ background: A.card, border: `1px solid ${A.border}` }} />
              ))
            : financialCards.map(c => (
                <ACard key={c.label}>
                  <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: A.sub }}>{c.label}</p>
                  <p className="text-2xl font-black" style={{ color: c.color }}>{c.value}</p>
                  <p className="text-[10px] mt-1" style={{ color: A.dim }}>{c.desc}</p>
                </ACard>
              ))
          }
        </div>
      </div>

      {s && s.totalSessionRevenue > 0 && (
        <div>
          <h2 className="text-xs font-black uppercase tracking-widest mb-3" style={{ color: A.sub }}>Revenue Split</h2>
          <ACard>
            <div className="flex justify-between text-[10px] mb-2" style={{ color: A.sub }}>
              <span>Admin Profit</span>
              <span>Listener Earnings</span>
            </div>
            <div className="w-full rounded-full overflow-hidden h-4 flex" style={{ background: A.border }}>
              {(() => {
                const total = s.adminProfitRupees + s.totalListenerEarningsRupees;
                const adminPct = total > 0 ? Math.round((s.adminProfitRupees / total) * 100) : 67;
                return (
                  <>
                    <div className="h-full rounded-l-full transition-all duration-700" style={{ width: `${adminPct}%`, background: `linear-gradient(90deg, ${A.gold}, ${A.gold2})` }} />
                    <div className="h-full flex-1 rounded-r-full" style={{ background: A.green }} />
                  </>
                );
              })()}
            </div>
            <div className="flex justify-between text-[11px] font-bold mt-2">
              <span style={{ color: A.gold }}>{fmtRupees(s.adminProfitRupees)}</span>
              <span style={{ color: A.green }}>{fmtRupees(s.totalListenerEarningsRupees)}</span>
            </div>
          </ACard>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIVE ACTIVITY TAB
// ═══════════════════════════════════════════════════════════════════════════════
type LiveData = {
  activeSessions: { id: string; kind: string; startedAt: string; billedMinutes: number; totalCostInRupees: number; userName: string; listenerName: string }[];
  onlineListeners: { id: string; displayName: string; photoUrl: string; gender: string; earningsBalanceRupees: number }[];
  onlineUsers: { userId: string; anonymousUsername: string; role: string; walletBalanceInRupees: number; lastActiveAt: string }[];
  recentSessions: { id: string; kind: string; status: string; startedAt: string; endedAt: string | null; billedMinutes: number; totalCostInRupees: number; userName: string; listenerName: string }[];
  serverTime: string;
};

// Live duration ticker — updates every second, no parent re-render needed
function LiveDuration({ startedAt }: { startedAt: string }) {
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force(x => x + 1), 1000); return () => clearInterval(t); }, []);
  const ms = Date.now() - new Date(startedAt).getTime();
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60), s = total % 60;
  return <span className="font-mono tabular-nums">{m}:{String(s).padStart(2, "0")}</span>;
}

function LiveTab() {
  const [data, setData] = useState<LiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const fetchData = useCallback(() => {
    fetch(apiUrl("/api/admin/live-activity"), { credentials: "include" })
      .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(d => { setData(d); setLastRefresh(new Date()); setError(null); })
      .catch(e => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(); const t = setInterval(fetchData, 10_000); return () => clearInterval(t); }, [fetchData]);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-2xl p-4 animate-pulse h-24" style={{ background: A.card, border: `1px solid ${A.border}` }} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: error ? A.red : A.green }} />
          <p className="text-[10px]" style={{ color: A.dim }}>
            {error ? `Connection error — ${error}` : `Live · refreshes every 10s · ${lastRefresh.toLocaleTimeString("en-IN")}`}
          </p>
        </div>
        <button onClick={fetchData} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors" style={{ color: A.gold, background: A.goldDim }}>
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Snapshot row */}
      <div className="grid grid-cols-3 gap-2">
        <ACard style={{ padding: "10px 12px" }}>
          <p className="text-[9px] uppercase tracking-widest font-bold" style={{ color: A.dim }}>On Calls</p>
          <p className="text-2xl font-black" style={{ color: A.red }}>{data?.activeSessions.length ?? 0}</p>
        </ACard>
        <ACard style={{ padding: "10px 12px" }}>
          <p className="text-[9px] uppercase tracking-widest font-bold" style={{ color: A.dim }}>Online Listeners</p>
          <p className="text-2xl font-black" style={{ color: A.green }}>{data?.onlineListeners.length ?? 0}</p>
        </ACard>
        <ACard style={{ padding: "10px 12px" }}>
          <p className="text-[9px] uppercase tracking-widest font-bold" style={{ color: A.dim }}>Online Users</p>
          <p className="text-2xl font-black" style={{ color: A.gold }}>{data?.onlineUsers?.length ?? 0}</p>
        </ACard>
      </div>

      {/* Active sessions with live ticking duration */}
      <div>
        <h2 className="text-xs font-black uppercase tracking-widest mb-3 flex items-center gap-2" style={{ color: A.sub }}>
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: A.red }} />
          Active Sessions ({data?.activeSessions?.length ?? 0})
        </h2>
        {(data?.activeSessions?.length ?? 0) === 0 ? (
          <ACard><p className="text-sm text-center py-4" style={{ color: A.dim }}>No active sessions</p></ACard>
        ) : (
          <div className="space-y-2">
            {(data?.activeSessions ?? []).map(s => (
              <ACard key={s.id} className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: s.kind === "call" ? "rgba(239,68,68,0.15)" : "rgba(59,130,246,0.15)" }}>
                  {s.kind === "call" ? <Phone className="w-4 h-4 text-red-400" /> : <MessageCircle className="w-4 h-4 text-blue-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate" style={{ color: A.text }}>{s.userName} ↔ {s.listenerName}</p>
                  <p className="text-[10px]" style={{ color: A.sub }}>
                    <LiveDuration startedAt={s.startedAt} /> live · {s.billedMinutes}m billed
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-black" style={{ color: A.gold }}>{fmtRupees(s.totalCostInRupees)}</p>
                  <ABadge status="active" />
                </div>
                <button
                  onClick={() => {
                    void navigator.clipboard?.writeText(s.id);
                    toast.success(`Session ID copied: ${s.id.slice(0, 8)}…`);
                  }}
                  className="shrink-0 p-1.5 rounded-lg transition-colors"
                  style={{ color: A.sub, background: A.surface, border: `1px solid ${A.border}` }}
                  title="Copy session ID for support / forensics">
                  <Eye className="w-3.5 h-3.5" />
                </button>
              </ACard>
            ))}
          </div>
        )}
      </div>

      {/* Online listeners */}
      <div>
        <h2 className="text-xs font-black uppercase tracking-widest mb-3 flex items-center gap-2" style={{ color: A.sub }}>
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: A.green }} />
          Online Listeners ({data?.onlineListeners?.length ?? 0})
        </h2>
        {(data?.onlineListeners?.length ?? 0) === 0 ? (
          <ACard><p className="text-sm text-center py-4" style={{ color: A.dim }}>No listeners online</p></ACard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {(data?.onlineListeners ?? []).map(l => (
              <ACard key={l.id} className="flex items-center gap-3">
                <img src={l.photoUrl} alt={l.displayName} className="w-10 h-10 rounded-full object-cover shrink-0" style={{ border: `2px solid ${A.green}` }} />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm truncate" style={{ color: A.text }}>{l.displayName}</p>
                  <p className="text-[10px]" style={{ color: A.sub }}>{l.gender} · Earnings: {fmtRupees(l.earningsBalanceRupees)}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: A.green }} />
                  <span className="text-[10px] font-bold" style={{ color: A.green }}>Online</span>
                </div>
              </ACard>
            ))}
          </div>
        )}
      </div>

      {/* Online users (heartbeat-driven) */}
      <div>
        <h2 className="text-xs font-black uppercase tracking-widest mb-3 flex items-center gap-2" style={{ color: A.sub }}>
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: A.gold }} />
          Online Users ({data?.onlineUsers?.length ?? 0})
        </h2>
        {(!data?.onlineUsers || data.onlineUsers.length === 0) ? (
          <ACard><p className="text-sm text-center py-4" style={{ color: A.dim }}>No users active in the last 2 minutes</p></ACard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {data.onlineUsers.map(u => (
              <ACard key={u.userId} className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full flex items-center justify-center font-black text-xs shrink-0"
                  style={{ background: u.role === "listener" ? "rgba(168,85,247,0.15)" : "rgba(59,130,246,0.15)", color: u.role === "listener" ? A.purple : A.blue }}>
                  {u.anonymousUsername.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate" style={{ color: A.text }}>{u.role === "listener" && u.firstName ? u.firstName : u.anonymousUsername}</p>
                  <p className="text-[10px]" style={{ color: A.sub }}>{u.role} · active {fmtAgo(u.lastActiveAt)}</p>
                </div>
                {u.role === "user" && (
                  <p className="text-xs font-bold shrink-0" style={{ color: A.gold }}>{fmtRupees(u.walletBalanceInRupees)}</p>
                )}
              </ACard>
            ))}
          </div>
        )}
      </div>

      {/* Recent sessions */}
      <div>
        <h2 className="text-xs font-black uppercase tracking-widest mb-3" style={{ color: A.sub }}>Recent Sessions</h2>
        <div className="space-y-2">
          {(data?.recentSessions ?? []).map(s => (
            <ACard key={s.id} className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: s.kind === "call" ? "rgba(239,68,68,0.15)" : "rgba(59,130,246,0.15)" }}>
                {s.kind === "call" ? <Phone className="w-3.5 h-3.5 text-red-400" /> : <MessageCircle className="w-3.5 h-3.5 text-blue-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold truncate" style={{ color: A.text }}>{s.userName} ↔ {s.listenerName}</p>
                <p className="text-[10px]" style={{ color: A.sub }}>{s.billedMinutes}m · {fmtAgo(s.startedAt)}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs font-bold" style={{ color: A.gold }}>{fmtRupees(s.totalCostInRupees)}</p>
                <ABadge status={s.status} />
              </div>
            </ACard>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// APPLICATIONS TAB
// ═══════════════════════════════════════════════════════════════════════════════
function ApplicationsTab() {
  const { data: apps, isLoading } = useListListenerApplications();
  const decide = useDecideListenerApplication();
  const queryClient = useQueryClient();
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleDecision = (id: string, decision: "approve" | "reject") => {
    setDecidingId(id);
    decide.mutate({ id, data: { decision } }, {
      onSuccess: () => {
        toast.success(decision === "approve" ? "Listener approved!" : "Application rejected");
        queryClient.invalidateQueries({ queryKey: getListListenerApplicationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAdminSummaryQueryKey() });
      },
      onError: () => toast.error("Action failed"),
      onSettled: () => setDecidingId(null),
    });
  };

  const handleDelete = async (id: string, name: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(apiUrl(`/api/admin/listeners/${id}`), { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        toast.error(err.error ?? "Delete failed");
        return;
      }
      toast.success(`${name} permanently removed`);
      setConfirmDeleteId(null);
      queryClient.invalidateQueries({ queryKey: getListListenerApplicationsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetAdminSummaryQueryKey() });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    } catch { toast.error("Network error"); } finally { setDeletingId(null); }
  };

  const counts = {
    all: apps?.length ?? 0,
    pending: apps?.filter(a => a.status === "pending").length ?? 0,
    approved: apps?.filter(a => a.status === "approved").length ?? 0,
    rejected: apps?.filter(a => a.status === "rejected").length ?? 0,
  };
  const filtered = (apps ?? []).filter(a => filter === "all" ? true : a.status === filter);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {(["pending", "approved", "rejected", "all"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className="px-3 py-1 rounded-full text-xs font-bold border transition-all"
            style={{
              background: filter === f ? (f === "pending" ? A.orange : f === "approved" ? A.green : f === "rejected" ? A.red : A.gold) : A.card,
              color: filter === f ? "#000" : A.sub,
              borderColor: filter === f ? "transparent" : A.border,
            }}>
            {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
          </button>
        ))}
      </div>

      {isLoading ? Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-2xl p-4 animate-pulse h-24" style={{ background: A.card, border: `1px solid ${A.border}` }} />
      )) : filtered.length === 0 ? (
        <ACard><p className="text-sm text-center py-8" style={{ color: A.dim }}>No {filter !== "all" ? filter : ""} applications</p></ACard>
      ) : filtered.map(app => {
        const isExpanded = expandedId === app.id;
        const contactNum = app.contactNumber;
        const authEmail = (app as any).authEmail as string | null;
        const waNumber = contactNum ? contactNum.replace(/\D/g, "") : null;

        return (
          <div key={app.id} className="rounded-2xl overflow-hidden transition-all" style={{ background: A.card, border: `1px solid ${isExpanded ? A.border2 : A.border}` }}>

            {/* ── Clickable header row ── */}
            <button
              className="w-full text-left"
              onClick={() => setExpandedId(isExpanded ? null : app.id)}
            >
              <div className="flex gap-3 p-4 items-start">
                <img src={app.photoUrl} alt={app.displayName} className="w-14 h-14 rounded-2xl object-cover shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <h3 className="font-black text-sm leading-tight" style={{ color: A.text }}>{app.displayName}</h3>
                    <div className="flex items-center gap-2">
                      <ABadge status={app.status} />
                      <span style={{ color: A.dim, fontSize: 16 }}>{isExpanded ? "▲" : "▼"}</span>
                    </div>
                  </div>
                  <p className="text-[10px] capitalize" style={{ color: A.sub }}>{app.gender} · Applied {fmtAgo(app.submittedAt)}</p>
                  <p className="text-[11px] mt-1 line-clamp-1" style={{ color: A.sub }}>{app.bio}</p>
                  {/* Always-visible contact pill */}
                  {waNumber ? (
                    <div className="flex items-center gap-1.5 mt-2">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="#25D166"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                      <span className="text-[11px] font-black" style={{ color: "#25D166" }}>+91 {waNumber}</span>
                    </div>
                  ) : authEmail ? (
                    <div className="flex items-center gap-1.5 mt-2">
                      <span className="text-[10px]" style={{ color: A.blue }}>✉</span>
                      <span className="text-[11px] font-bold" style={{ color: A.blue }}>{authEmail}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 mt-2">
                      <span className="text-[10px] font-bold" style={{ color: A.dim }}>No contact info</span>
                    </div>
                  )}
                </div>
              </div>
            </button>

            {/* ── Expanded detail panel ── */}
            {isExpanded && (
              <div className="border-t" style={{ borderColor: A.border2 }}>
                {/* Big photo + full details */}
                <div className="p-4 space-y-4">
                  {/* Photo large */}
                  <div className="flex gap-4 items-start">
                    <img src={app.photoUrl} alt={app.displayName} className="w-24 h-24 rounded-2xl object-cover shrink-0" style={{ border: `2px solid ${A.border2}` }} />
                    <div className="flex-1">
                      <p className="font-black text-lg" style={{ color: A.text }}>{app.displayName}</p>
                      <p className="text-xs capitalize mt-0.5" style={{ color: A.sub }}>Gender: <span style={{ color: A.text }}>{app.gender}</span></p>
                      <p className="text-xs mt-0.5" style={{ color: A.sub }}>Applied: <span style={{ color: A.text }}>{fmtTime(app.submittedAt)}</span></p>
                      {app.decidedAt && <p className="text-xs mt-0.5" style={{ color: A.sub }}>Decided: <span style={{ color: A.text }}>{fmtTime(app.decidedAt)}</span></p>}
                      <div className="mt-2"><ABadge status={app.status} /></div>
                    </div>
                  </div>

                  {/* WhatsApp / Contact — BIG and prominent */}
                  <div className="rounded-xl p-3" style={{ background: waNumber ? "rgba(37,211,102,0.08)" : "rgba(59,130,246,0.08)", border: `1px solid ${waNumber ? "rgba(37,211,102,0.3)" : "rgba(59,130,246,0.25)"}` }}>
                    <p className="text-[9px] font-black uppercase tracking-widest mb-1.5" style={{ color: waNumber ? "#25D166" : A.blue }}>
                      {waNumber ? "WhatsApp Contact (typed by applicant)" : "Email Contact"}
                    </p>
                    {waNumber ? (
                      <a
                        href={`https://wa.me/91${waNumber}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3"
                        onClick={e => e.stopPropagation()}
                      >
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="#25D166"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                        <div>
                          <p className="text-xl font-black" style={{ color: "#25D166" }}>+91 {waNumber}</p>
                          <p className="text-[10px]" style={{ color: "rgba(37,211,102,0.7)" }}>Tap to open WhatsApp → verify this person</p>
                        </div>
                      </a>
                    ) : authEmail ? (
                      <p className="text-base font-black" style={{ color: A.blue }}>{authEmail}</p>
                    ) : (
                      <p className="text-sm" style={{ color: A.dim }}>No contact info provided</p>
                    )}
                  </div>

                  {/* Bio */}
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: A.dim }}>Bio / About</p>
                    <p className="text-sm leading-relaxed" style={{ color: A.text }}>{app.bio}</p>
                  </div>

                  {/* Skills */}
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: A.dim }}>Skills / Expertise</p>
                    <div className="flex flex-wrap gap-2">
                      {app.skills.length > 0 ? app.skills.map(s => (
                        <span key={s} className="text-xs font-bold px-3 py-1 rounded-full" style={{ background: A.goldDim, color: A.gold, border: `1px solid rgba(245,166,35,0.2)` }}>{s}</span>
                      )) : <span className="text-xs" style={{ color: A.dim }}>No skills listed</span>}
                    </div>
                  </div>

                  {/* Rejection reason if rejected */}
                  {app.status === "rejected" && app.rejectionReason && (
                    <div className="rounded-xl p-3" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                      <p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: A.red }}>Rejection Reason</p>
                      <p className="text-sm" style={{ color: A.text }}>{app.rejectionReason}</p>
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                {app.status === "pending" && (
                  <div className="flex border-t" style={{ borderColor: A.border }}>
                    <button onClick={() => handleDecision(app.id, "approve")} disabled={decidingId === app.id}
                      className="flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-black transition-colors disabled:opacity-50"
                      style={{ color: A.green, borderRight: `1px solid ${A.border}` }}
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(34,197,94,0.12)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      {decidingId === app.id ? <span className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: A.green, borderTopColor: "transparent" }} /> : <CheckCircle2 className="w-4 h-4" />}
                      Approve
                    </button>
                    <button onClick={() => handleDecision(app.id, "reject")} disabled={decidingId === app.id}
                      className="flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-black transition-colors disabled:opacity-50"
                      style={{ color: A.red, borderRight: `1px solid ${A.border}` }}
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(239,68,68,0.1)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <XCircle className="w-4 h-4" /> Reject
                    </button>
                    <button onClick={() => setConfirmDeleteId(confirmDeleteId === app.id ? null : app.id)}
                      className="flex items-center justify-center gap-1.5 px-4 py-3.5 text-sm font-black transition-colors"
                      style={{ color: A.dim }}
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(239,68,68,0.07)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <UserX className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {app.status !== "pending" && (
                  <div className="flex border-t" style={{ borderColor: A.border }}>
                    <button onClick={() => setConfirmDeleteId(confirmDeleteId === app.id ? null : app.id)}
                      className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-black transition-colors"
                      style={{ color: A.dim }}
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(239,68,68,0.08)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <UserX className="w-4 h-4" /> Delete Listener
                    </button>
                  </div>
                )}

                {/* Confirm delete */}
                {confirmDeleteId === app.id && (
                  <div className="border-t px-4 py-3 flex items-center gap-3" style={{ borderColor: A.border, background: "rgba(239,68,68,0.06)" }}>
                    <p className="flex-1 text-xs font-bold" style={{ color: A.red }}>
                      Permanently delete <span style={{ color: A.text }}>{app.displayName}</span>? Cannot be undone.
                    </p>
                    <button onClick={() => handleDelete(app.id, app.displayName)} disabled={deletingId === app.id}
                      className="px-3 py-1.5 rounded-lg text-xs font-black disabled:opacity-50"
                      style={{ background: A.red, color: "#fff" }}>
                      {deletingId === app.id ? "Deleting…" : "Yes, Delete"}
                    </button>
                    <button onClick={() => setConfirmDeleteId(null)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold"
                      style={{ background: A.card, color: A.sub, border: `1px solid ${A.border}` }}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── Collapsed state: show action bar only for pending ── */}
            {!isExpanded && app.status === "pending" && (
              <div className="flex border-t" style={{ borderColor: A.border }}>
                <button onClick={(e) => { e.stopPropagation(); handleDecision(app.id, "approve"); }} disabled={decidingId === app.id}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-black transition-colors disabled:opacity-50"
                  style={{ color: A.green, borderRight: `1px solid ${A.border}` }}
                  onMouseEnter={e => (e.currentTarget.style.background = "rgba(34,197,94,0.1)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  {decidingId === app.id ? <span className="w-3 h-3 rounded-full border-2 animate-spin" style={{ borderColor: A.green, borderTopColor: "transparent" }} /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Approve
                </button>
                <button onClick={(e) => { e.stopPropagation(); handleDecision(app.id, "reject"); }} disabled={decidingId === app.id}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-black transition-colors disabled:opacity-50"
                  style={{ color: A.red }}
                  onMouseEnter={e => (e.currentTarget.style.background = "rgba(239,68,68,0.1)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  <XCircle className="w-3.5 h-3.5" /> Reject
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAYMENTS TAB
// ═══════════════════════════════════════════════════════════════════════════════
type RechargeRow = { id: string; userId: string; username: string; email: string | null; amountInRupees: number; utrNumber: string; status: string; adminNote: string | null; decidedAt: string | null; createdAt: string };

function PaymentsTab() {
  const [rows, setRows] = useState<RechargeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const fetch2 = useCallback(() => {
    setLoading(true);
    fetch(apiUrl("/api/admin/recharge-requests"), { credentials: "include" })
      .then(r => r.json()).then(d => setRows(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { fetch2(); }, [fetch2]);

  const total = rows.reduce((s, r) => s + r.amountInRupees, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="rounded-xl px-4 py-2.5" style={{ background: A.goldDim, border: `1px solid rgba(245,166,35,0.2)` }}>
          <p className="text-[10px] font-bold uppercase" style={{ color: A.sub }}>Total Recharges</p>
          <p className="text-xl font-black" style={{ color: A.gold }}>{fmtRupees(total)}</p>
        </div>
        <button onClick={fetch2} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg" style={{ color: A.gold, background: A.goldDim }}>
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      <p className="text-xs" style={{ color: A.dim }}>All recharges are auto-approved on UTR submission. This is the audit log.</p>

      {loading ? Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-2xl p-4 animate-pulse h-20" style={{ background: A.card, border: `1px solid ${A.border}` }} />
      )) : rows.length === 0 ? (
        <ACard><p className="text-sm text-center py-8" style={{ color: A.dim }}>No recharge records</p></ACard>
      ) : rows.map(r => (
        <ACard key={r.id} className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(34,197,94,0.15)" }}>
            <IndianRupee className="w-4 h-4" style={{ color: A.green }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm" style={{ color: A.text }}>{r.username}</p>
            <p className="text-[10px] font-mono" style={{ color: A.sub }}>UTR: {r.utrNumber} · {fmtTime(r.createdAt)}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-lg font-black" style={{ color: A.green }}>+{fmtRupees(r.amountInRupees)}</p>
            <ABadge status={r.status} />
          </div>
        </ACard>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAYOUTS TAB
// ═══════════════════════════════════════════════════════════════════════════════
type ListenerBalance = { id: string; displayName: string; photoUrl: string; gender: string; isOnline: boolean; earningsBalanceRupees: number; totalEarningsRupees: number; earningsBalancePaise: number };
type WithdrawalRow = { id: string; amountRupees: number; upiId: string; status: string; adminNote: string | null; paymentReference: string | null; decidedAt: string | null; createdAt: string; listenerId: string; listenerName: string; listenerPhoto: string };

function PayoutsTab() {
  const queryClient = useQueryClient();
  const [balances, setBalances] = useState<ListenerBalance[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [section, setSection] = useState<"requests" | "balances">("requests");
  const [utrOpenId, setUtrOpenId] = useState<string | null>(null);
  const [utrValue, setUtrValue] = useState("");
  const [moneyOpenListenerId, setMoneyOpenListenerId] = useState<string | null>(null);
  const [moneyMode, setMoneyMode] = useState<"credit" | "adjust">("credit");
  const [moneyAmount, setMoneyAmount] = useState("");
  const [moneyNote, setMoneyNote] = useState("");
  const [moneyBusy, setMoneyBusy] = useState(false);
  // ── Instant Payout (admin sends money directly) ─────────────────────────
  const [payoutOpenId, setPayoutOpenId] = useState<string | null>(null);
  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutUpi, setPayoutUpi] = useState("");
  const [payoutUtr, setPayoutUtr] = useState("");
  const [payoutNote, setPayoutNote] = useState("");
  const [payoutBusy, setPayoutBusy] = useState(false);
  // ── Remove listener ─────────────────────────────────────────────────────
  const [removingListenerId, setRemovingListenerId] = useState<string | null>(null);

  const handleInstantPayout = async (l: ListenerBalance) => {
    const amt = parseInt(payoutAmount, 10);
    if (!Number.isFinite(amt) || amt < 1) { toast.error("Amount sahi daalo"); return; }
    if (!payoutUpi.includes("@") || payoutUpi.length < 4) { toast.error("UPI ID sahi daalo (e.g. name@bank)"); return; }
    if (payoutUtr.trim().length < 6) { toast.error("UTR (min 6 chars) zaroori hai"); return; }
    if (amt > l.earningsBalanceRupees) { toast.error(`Listener ke paas sirf ₹${l.earningsBalanceRupees.toFixed(0)} hain`); return; }
    setPayoutBusy(true);
    try {
      const res = await fetch(apiUrl(`/api/admin/listeners/${l.id}/instant-payout`), {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountInRupees: amt, upiId: payoutUpi.trim(), paymentReference: payoutUtr.trim(), note: payoutNote }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error ?? "Payout failed"); return; }
      toast.success(`Paid ₹${data.payoutRupees?.toFixed(0)} to ${l.displayName} · UTR ${data.paymentReference}`);
      setPayoutOpenId(null); setPayoutAmount(""); setPayoutUpi(""); setPayoutUtr(""); setPayoutNote("");
      fetchAll();
      queryClient.invalidateQueries({ queryKey: getGetAdminSummaryQueryKey() });
    } catch { toast.error("Network error"); } finally { setPayoutBusy(false); }
  };

  const handleRemoveListener = async (l: ListenerBalance) => {
    if (!confirm(`Pakka ${l.displayName} ko SunoSathi se permanently remove karein?\n\nUske saare sessions, reviews, earnings (₹${l.earningsBalanceRupees.toFixed(0)}) sab delete ho jayenge. Wapas nahi laaya ja sakta.`)) return;
    setRemovingListenerId(l.id);
    try {
      const res = await fetch(apiUrl(`/api/admin/listeners/${l.id}`), { method: "DELETE", credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error ?? "Failed to remove"); return; }
      toast.success(`${l.displayName} removed permanently.`);
      fetchAll();
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: getGetAdminSummaryQueryKey() });
    } catch { toast.error("Network error"); } finally { setRemovingListenerId(null); }
  };

  const fetchAll = useCallback(() => {
    Promise.all([
      fetch(apiUrl("/api/admin/withdrawal-requests"), { credentials: "include" }).then(r => r.json()),
      fetch(apiUrl("/api/admin/listener-balances"), { credentials: "include" }).then(r => r.json()),
    ]).then(([wRows, bRows]) => {
      setWithdrawals(Array.isArray(wRows) ? wRows : []);
      setBalances(Array.isArray(bRows) ? bRows : []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const reject = async (id: string) => {
    setDeciding(id);
    try {
      const res = await fetch(apiUrl(`/api/admin/withdrawal-requests/${id}/reject`), {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        toast.error(err.error ?? "Action failed");
        return;
      }
      toast.success("Request rejected.");
      fetchAll();
    } catch { toast.error("Network error"); } finally { setDeciding(null); }
  };

  const pay = async (id: string) => {
    const ref = utrValue.trim();
    if (ref.length < 6) { toast.error("Enter the UTR / payment reference (min 6 characters)"); return; }
    setDeciding(id);
    try {
      const res = await fetch(apiUrl(`/api/admin/withdrawal-requests/${id}/pay`), {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentReference: ref }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        toast.error(err.error ?? "Action failed");
        return;
      }
      const data = await res.json() as { payoutRupees?: number; commissionRupees?: number; paymentReference?: string };
      toast.success(`Marked paid. Sent ₹${data.payoutRupees?.toFixed(0)} (UTR: ${data.paymentReference}). ₹${data.commissionRupees?.toFixed(0)} commission retained.`);
      setUtrOpenId(null); setUtrValue("");
      fetchAll();
    } catch { toast.error("Network error"); } finally { setDeciding(null); }
  };

  const handleListenerMoney = async (l: ListenerBalance) => {
    const num = parseInt(moneyAmount, 10);
    if (!Number.isFinite(num)) { toast.error("Enter a valid amount"); return; }
    setMoneyBusy(true);
    try {
      const path = moneyMode === "credit"
        ? `/api/admin/listeners/${l.id}/credit`
        : `/api/admin/listeners/${l.id}/adjust`;
      const body = moneyMode === "credit"
        ? { amountInRupees: num, note: moneyNote }
        : { newBalanceInRupees: num, note: moneyNote };
      const res = await fetch(path, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; newBalanceRupees?: number };
      if (!res.ok) { toast.error(data.error ?? "Action failed"); return; }
      toast.success(`${l.displayName}: balance now ₹${data.newBalanceRupees}`);
      setMoneyOpenListenerId(null); setMoneyAmount(""); setMoneyNote("");
      fetchAll();
      queryClient.invalidateQueries({ queryKey: getGetAdminSummaryQueryKey() });
    } catch { toast.error("Network error"); } finally { setMoneyBusy(false); }
  };

  const pending = withdrawals.filter(w => w.status === "pending");
  const totalPendingRupees = pending.reduce((s, w) => s + w.amountRupees, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <ACard>
          <p className="text-[10px] font-bold uppercase mb-1" style={{ color: A.sub }}>Pending Payouts</p>
          <p className="text-2xl font-black" style={{ color: A.orange }}>{fmtRupees(totalPendingRupees)}</p>
          <p className="text-[10px] mt-1" style={{ color: A.dim }}>{pending.length} request{pending.length !== 1 ? "s" : ""}</p>
        </ACard>
        <ACard>
          <p className="text-[10px] font-bold uppercase mb-1" style={{ color: A.sub }}>Total Listener Balances</p>
          <p className="text-2xl font-black" style={{ color: A.gold }}>{fmtRupees(balances.reduce((s, b) => s + b.earningsBalanceRupees, 0))}</p>
          <p className="text-[10px] mt-1" style={{ color: A.dim }}>{balances.length} listener{balances.length !== 1 ? "s" : ""}</p>
        </ACard>
      </div>

      <div className="flex rounded-xl overflow-hidden" style={{ border: `1px solid ${A.border}` }}>
        {(["requests", "balances"] as const).map(s => (
          <button key={s} onClick={() => setSection(s)}
            className="flex-1 py-2.5 text-xs font-black uppercase tracking-wide transition-all"
            style={{ background: section === s ? A.goldDim : A.card, color: section === s ? A.gold : A.sub }}>
            {s === "requests" ? `Withdrawal Requests (${withdrawals.length})` : `Listener Balances (${balances.length})`}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-end">
        <button onClick={fetchAll} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg" style={{ color: A.gold, background: A.goldDim }}>
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {loading ? Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-2xl p-4 animate-pulse h-20" style={{ background: A.card, border: `1px solid ${A.border}` }} />
      )) : section === "requests" ? (
        withdrawals.length === 0 ? (
          <ACard><p className="text-sm text-center py-8" style={{ color: A.dim }}>No withdrawal requests</p></ACard>
        ) : withdrawals.map(w => (
          <div key={w.id} className="rounded-2xl overflow-hidden" style={{ background: A.card, border: `1px solid ${A.border}` }}>
            <div className="p-4 flex items-start gap-3">
              <img src={w.listenerPhoto} alt={w.listenerName} className="w-10 h-10 rounded-full object-cover shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div>
                    <p className="font-black text-sm" style={{ color: A.text }}>{w.listenerName}</p>
                    <p className="text-[10px] font-mono" style={{ color: A.sub }}>UPI: {w.upiId}</p>
                  </div>
                  <ABadge status={w.status} />
                </div>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <p className="text-xl font-black" style={{ color: A.gold }}>₹{w.amountRupees.toFixed(0)}</p>
                  <p className="text-xs" style={{ color: A.dim }}>requested</p>
                </div>
                <div className="flex gap-3 text-[11px] font-bold mt-0.5">
                  <span style={{ color: A.green }}>Pay ₹{(w.amountRupees * 0.9).toFixed(0)} to listener</span>
                  <span style={{ color: A.orange }}>+₹{(w.amountRupees * 0.1).toFixed(0)} commission</span>
                </div>
                <p className="text-[10px] mt-0.5" style={{ color: A.dim }}>{fmtTime(w.createdAt)}</p>
                {w.adminNote && <p className="text-[10px] mt-1" style={{ color: A.red }}>Note: {w.adminNote}</p>}
              </div>
            </div>
            {w.status === "pending" && utrOpenId !== w.id && (
              <div className="flex border-t" style={{ borderColor: A.border }}>
                <button onClick={() => { setUtrOpenId(w.id); setUtrValue(""); }} disabled={deciding === w.id}
                  className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-black transition-colors"
                  style={{ color: A.green, borderRight: `1px solid ${A.border}` }}
                  onMouseEnter={e => (e.currentTarget.style.background = "rgba(34,197,94,0.1)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  <CheckCircle2 className="w-4 h-4" />
                  Mark Paid — Pay ₹{(w.amountRupees * 0.9).toFixed(0)}
                </button>
                <button onClick={() => reject(w.id)} disabled={deciding === w.id}
                  className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-black transition-colors"
                  style={{ color: A.red }}
                  onMouseEnter={e => (e.currentTarget.style.background = "rgba(239,68,68,0.1)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  <XCircle className="w-4 h-4" /> Reject
                </button>
              </div>
            )}
            {w.status === "pending" && utrOpenId === w.id && (
              <div className="border-t p-3 space-y-2" style={{ borderColor: A.border, background: "rgba(34,197,94,0.04)" }}>
                <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: A.green }}>
                  Step 1: Send ₹{(w.amountRupees * 0.9).toFixed(0)} to {w.upiId} via your bank/UPI app
                </p>
                <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: A.gold }}>
                  Step 2: Paste the UTR / reference number below to mark paid
                </p>
                <input
                  type="text" value={utrValue}
                  onChange={e => setUtrValue(e.target.value)}
                  placeholder="UTR / Reference (e.g. 123456789012)"
                  maxLength={64}
                  className="w-full text-sm font-mono rounded-lg px-3 py-2 outline-none"
                  style={{ background: A.surface, color: A.text, border: `1px solid ${A.border}` }}
                />
                <div className="flex gap-2">
                  <button onClick={() => pay(w.id)} disabled={deciding === w.id || utrValue.trim().length < 6}
                    className="flex-1 py-2 rounded-lg text-xs font-black transition-all disabled:opacity-50"
                    style={{ background: A.green, color: "#000" }}>
                    {deciding === w.id ? "Marking…" : "Confirm Paid"}
                  </button>
                  <button onClick={() => { setUtrOpenId(null); setUtrValue(""); }}
                    className="px-3 py-2 rounded-lg text-xs font-bold"
                    style={{ background: A.card, color: A.sub, border: `1px solid ${A.border}` }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {w.status === "paid" && (
              <div className="px-4 pb-3 -mt-1">
                <p className="text-[10px] font-mono" style={{ color: A.green }}>
                  ✓ Paid {w.decidedAt ? `· ${fmtTime(w.decidedAt)}` : ""} · UTR: {w.paymentReference ?? "—"}
                </p>
              </div>
            )}
          </div>
        ))
      ) : (
        balances.length === 0 ? (
          <ACard><p className="text-sm text-center py-8" style={{ color: A.dim }}>No approved listeners</p></ACard>
        ) : balances.map(b => (
          <ACard key={b.id}>
            <div className="flex items-center gap-3">
              <div className="relative">
                <img src={b.photoUrl} alt={b.displayName} className="w-10 h-10 rounded-full object-cover shrink-0" />
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2" style={{ background: b.isOnline ? A.green : A.dim, borderColor: A.card }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm" style={{ color: A.text }}>{b.displayName}</p>
                <p className="text-[10px]" style={{ color: A.sub }}>Total earned: {fmtRupees(b.totalEarningsRupees)}</p>
              </div>
              <div className="text-right">
                <p className="font-black" style={{ color: b.earningsBalanceRupees >= 200 ? A.gold : A.sub }}>
                  {fmtRupees(b.earningsBalanceRupees)}
                </p>
                <p className="text-[9px]" style={{ color: A.dim }}>available</p>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <button
                  onClick={() => {
                    const opening = moneyOpenListenerId !== b.id;
                    setMoneyOpenListenerId(opening ? b.id : null);
                    setPayoutOpenId(null);
                    setMoneyMode("credit"); setMoneyAmount(""); setMoneyNote("");
                  }}
                  className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg transition-all"
                  style={moneyOpenListenerId === b.id
                    ? { background: A.gold, color: "#000" }
                    : { background: A.goldDim, color: A.gold, border: `1px solid rgba(245,166,35,0.25)` }}>
                  <IndianRupee className="w-3 h-3" /> Money
                </button>
                <button
                  onClick={() => {
                    const opening = payoutOpenId !== b.id;
                    setPayoutOpenId(opening ? b.id : null);
                    setMoneyOpenListenerId(null);
                    setPayoutAmount(opening ? String(Math.floor(b.earningsBalanceRupees)) : "");
                    setPayoutUpi(""); setPayoutUtr(""); setPayoutNote("");
                  }}
                  disabled={b.earningsBalanceRupees < 1}
                  className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg transition-all disabled:opacity-40"
                  style={payoutOpenId === b.id
                    ? { background: A.green, color: "#000" }
                    : { background: "rgba(34,197,94,0.12)", color: A.green, border: `1px solid rgba(34,197,94,0.3)` }}
                  title="Send instant payout to listener UPI">
                  <Send className="w-3 h-3" /> Pay Now
                </button>
                <button
                  onClick={() => handleRemoveListener(b)}
                  disabled={removingListenerId === b.id}
                  className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg transition-all disabled:opacity-50"
                  style={{ background: "rgba(239,68,68,0.1)", color: A.red, border: `1px solid rgba(239,68,68,0.3)` }}
                  title="Remove listener permanently">
                  <Trash2 className="w-3 h-3" /> {removingListenerId === b.id ? "…" : "Remove"}
                </button>
              </div>
              {b.earningsBalanceRupees >= 200 && (
                <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: A.gold }} title="Eligible for payout (min ₹200)" />
              )}
            </div>
            {payoutOpenId === b.id && (
              <div className="mt-3 pt-3 border-t space-y-2" style={{ borderColor: A.border, background: "rgba(34,197,94,0.04)" }}>
                <p className="text-[10px] font-black uppercase tracking-wide" style={{ color: A.green }}>
                  Instant Payout — Send Now
                </p>
                <p className="text-[10px] leading-relaxed" style={{ color: A.sub }}>
                  Pehle apne UPI app / bank se ₹X bhejo, fir UTR yahaan daalo. System earnings se deduct karke withdrawal record bana dega (10% commission already cut).
                </p>
                <div className="flex gap-2 items-center">
                  <span className="text-sm font-black" style={{ color: A.green }}>₹</span>
                  <input type="number" inputMode="numeric" value={payoutAmount} onChange={e => setPayoutAmount(e.target.value)}
                    placeholder="Amount (gross)" max={b.earningsBalanceRupees}
                    className="flex-1 text-sm rounded-lg px-3 py-2 outline-none"
                    style={{ background: A.surface, color: A.text, border: `1px solid ${A.border}` }} />
                </div>
                <input type="text" value={payoutUpi} onChange={e => setPayoutUpi(e.target.value)}
                  placeholder="Listener UPI ID (e.g. name@paytm)"
                  className="w-full text-sm rounded-lg px-3 py-2 outline-none"
                  style={{ background: A.surface, color: A.text, border: `1px solid ${A.border}` }} />
                <input type="text" value={payoutUtr} onChange={e => setPayoutUtr(e.target.value)}
                  placeholder="UTR / Transaction Reference"
                  className="w-full text-sm rounded-lg px-3 py-2 outline-none font-mono"
                  style={{ background: A.surface, color: A.text, border: `1px solid ${A.border}` }} />
                <input type="text" value={payoutNote} onChange={e => setPayoutNote(e.target.value)}
                  placeholder="Note (optional, audit-logged)" maxLength={200}
                  className="w-full text-xs rounded-lg px-3 py-2 outline-none"
                  style={{ background: A.surface, color: A.text, border: `1px solid ${A.border}` }} />
                {payoutAmount && Number(payoutAmount) > 0 && (
                  <p className="text-[10px]" style={{ color: A.dim }}>
                    Gross: ₹{Number(payoutAmount).toFixed(0)} · Commission (10%): ₹{(Number(payoutAmount) * 0.1).toFixed(0)} ·
                    <span style={{ color: A.green }}> Listener gets: ₹{(Number(payoutAmount) * 0.9).toFixed(0)}</span>
                  </p>
                )}
                <div className="flex gap-2">
                  <button onClick={() => handleInstantPayout(b)} disabled={payoutBusy || !payoutAmount || !payoutUpi || !payoutUtr}
                    className="flex-1 py-2 rounded-lg text-xs font-black transition-all disabled:opacity-50"
                    style={{ background: A.green, color: "#000" }}>
                    {payoutBusy ? "Recording…" : "Record Payout"}
                  </button>
                  <button onClick={() => setPayoutOpenId(null)}
                    className="px-3 py-2 rounded-lg text-xs font-bold"
                    style={{ background: A.card, color: A.sub, border: `1px solid ${A.border}` }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {moneyOpenListenerId === b.id && (
              <div className="mt-3 pt-3 border-t space-y-2" style={{ borderColor: A.border }}>
                <div className="flex gap-2">
                  {(["credit", "adjust"] as const).map(m => (
                    <button key={m} onClick={() => setMoneyMode(m)}
                      className="flex-1 py-1.5 rounded-lg text-[11px] font-black uppercase transition-all"
                      style={moneyMode === m
                        ? { background: A.gold, color: "#000" }
                        : { background: A.card, color: A.sub, border: `1px solid ${A.border}` }}>
                      {m === "credit" ? "+ / − Earnings" : "Set Earnings"}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 items-center">
                  <span className="text-sm font-black" style={{ color: A.gold }}>₹</span>
                  <input
                    type="number" inputMode="numeric"
                    value={moneyAmount}
                    onChange={e => setMoneyAmount(e.target.value)}
                    placeholder={moneyMode === "credit" ? "e.g. 100 or -50" : "e.g. 250 (new total)"}
                    className="flex-1 text-sm rounded-lg px-3 py-2 outline-none"
                    style={{ background: A.surface, color: A.text, border: `1px solid ${A.border}` }}
                  />
                </div>
                <input
                  type="text" value={moneyNote}
                  onChange={e => setMoneyNote(e.target.value)}
                  placeholder="Note (optional, audit-logged)"
                  maxLength={200}
                  className="w-full text-xs rounded-lg px-3 py-2 outline-none"
                  style={{ background: A.surface, color: A.text, border: `1px solid ${A.border}` }}
                />
                <div className="flex gap-2">
                  <button onClick={() => handleListenerMoney(b)} disabled={moneyBusy || !moneyAmount}
                    className="flex-1 py-2 rounded-lg text-xs font-black transition-all disabled:opacity-50"
                    style={{ background: A.green, color: "#000" }}>
                    {moneyBusy ? "Working…" : moneyMode === "credit" ? "Apply Credit/Debit" : "Set New Earnings"}
                  </button>
                  <button onClick={() => { setMoneyOpenListenerId(null); setMoneyAmount(""); setMoneyNote(""); }}
                    className="px-3 py-2 rounded-lg text-xs font-bold"
                    style={{ background: A.card, color: A.sub, border: `1px solid ${A.border}` }}>
                    Cancel
                  </button>
                </div>
                <p className="text-[10px]" style={{ color: A.dim }}>
                  Current earnings: <span style={{ color: A.gold }}>{fmtRupees(b.earningsBalanceRupees)}</span> · Audit-logged.
                </p>
              </div>
            )}
          </ACard>
        ))
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// USERS TAB
// ═══════════════════════════════════════════════════════════════════════════════
type AdminUser = { userId: string; anonymousUsername: string; role: string; isAdmin: boolean; walletBalanceInRupees: number; hasOnboarded: boolean; createdAt: string; email: string | null; phone: string | null; firstName: string | null; age: number | null; avatarSeed: string | null; isTestAccount: boolean; deviceId: string | null; lastActiveAt: string | null; spamCount: number; earningsBalanceRupees: number | null; totalEarningsRupees: number | null; };

function UsersTab() {
  const queryClient = useQueryClient();
  const { data: users, isLoading } = useQuery<AdminUser[]>({
    queryKey: ["admin-users"],
    queryFn: async () => { const r = await fetch(apiUrl("/api/admin/users"), { credentials: "include" }); return r.json(); },
    staleTime: 30_000,
  });
  const [filter, setFilter] = useState<"all" | "user" | "listener" | "test">("all");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [moneyOpenId, setMoneyOpenId] = useState<string | null>(null);
  const [moneyMode, setMoneyMode] = useState<"credit" | "adjust">("credit");
  const [moneyAmount, setMoneyAmount] = useState("");
  const [moneyNote, setMoneyNote] = useState("");
  const [moneySubmitting, setMoneySubmitting] = useState(false);
  // ── Remove user state ──────────────────────────────────────────────────
  const [removeOpenId, setRemoveOpenId] = useState<string | null>(null);
  const [removeBanDevice, setRemoveBanDevice] = useState(true);
  const [removeReason, setRemoveReason] = useState("");
  const [removeBusy, setRemoveBusy] = useState(false);

  const handleRemoveUser = async (u: AdminUser) => {
    if (!confirm(`Pakka ${u.firstName ?? u.anonymousUsername} ko SunoSathi se hamesha ke liye remove karein?\n\n${removeBanDevice ? "⚠️ Device bhi BAN hogi — yeh phone phir kabhi register nahi kar payega." : "Device ban nahi hogi — same phone se dobara register kar sakte hain."}`)) return;
    setRemoveBusy(true);
    try {
      const qs = new URLSearchParams({ banDevice: String(removeBanDevice), reason: removeReason });
      const res = await fetch(apiUrl(`/api/admin/users/${u.userId}?${qs}`), { method: "DELETE", credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error ?? "Failed to remove"); return; }
      toast.success(`${data.displayName ?? u.anonymousUsername} removed${data.deviceBanned ? " · Device BANNED" : ""}`);
      setRemoveOpenId(null); setRemoveReason("");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: getGetAdminSummaryQueryKey() });
    } catch { toast.error("Network error"); } finally { setRemoveBusy(false); }
  };

  const handleMoneyAction = async (u: AdminUser) => {
    const num = parseInt(moneyAmount, 10);
    if (!Number.isFinite(num)) { toast.error("Enter a valid amount"); return; }
    setMoneySubmitting(true);
    try {
      const path = moneyMode === "credit"
        ? `/api/admin/users/${u.userId}/credit`
        : `/api/admin/users/${u.userId}/adjust`;
      const body = moneyMode === "credit"
        ? { amountInRupees: num, note: moneyNote }
        : { newBalanceInRupees: num, note: moneyNote };
      const r = await fetch(path, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(data.error ?? "Action failed"); return; }
      toast.success(moneyMode === "credit"
        ? `Credited ${num >= 0 ? "+" : ""}₹${num} → ${u.anonymousUsername}. New balance ₹${data.newBalanceInRupees}.`
        : `Set ${u.anonymousUsername}'s balance to ₹${data.newBalanceInRupees}.`);
      setMoneyOpenId(null); setMoneyAmount(""); setMoneyNote("");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: getGetAdminSummaryQueryKey() });
    } catch { toast.error("Network error"); } finally { setMoneySubmitting(false); }
  };

  const filtered = (users ?? []).filter(u => {
    if (filter === "test") return u.isTestAccount;
    if (filter === "all")  return true;
    return u.role === filter;
  });

  const handleToggleTest = async (u: AdminUser) => {
    setTogglingId(u.userId);
    try {
      const res = await fetch(apiUrl(`/api/admin/users/${u.userId}/toggle-test`), { method: "POST", credentials: "include" });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Failed"); return; }
      toast.success(data.isTestAccount
        ? `${u.anonymousUsername} marked as test account — auth checks bypassed.`
        : `${u.anonymousUsername} is no longer a test account.`
      );
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    } catch { toast.error("Network error"); } finally { setTogglingId(null); }
  };

  const testCount = (users ?? []).filter(u => u.isTestAccount).length;

  return (
    <div className="space-y-4">
      {/* Filter chips */}
      <div className="flex gap-2 flex-wrap">
        {([
          { id: "all",      label: "All",       count: users?.length ?? 0 },
          { id: "user",     label: "Users",     count: users?.filter(u => u.role === "user").length ?? 0 },
          { id: "listener", label: "Listeners", count: users?.filter(u => u.role === "listener").length ?? 0 },
          { id: "test",     label: "🧪 Test",   count: testCount },
        ] as const).map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className="px-3 py-1 rounded-full text-xs font-bold border transition-all"
            style={{
              background: filter === f.id ? (f.id === "test" ? A.green : A.gold) : A.card,
              color:      filter === f.id ? "#000" : A.sub,
              borderColor: filter === f.id ? (f.id === "test" ? A.green : A.gold) : A.border,
            }}>
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      {/* Info banner for test filter */}
      {filter === "test" && (
        <div className="rounded-xl px-4 py-3 flex items-start gap-3" style={{ background: "rgba(34,197,94,0.08)", border: `1px solid rgba(34,197,94,0.2)` }}>
          <FlaskConical className="w-4 h-4 mt-0.5 shrink-0" style={{ color: A.green }} />
          <p className="text-xs leading-relaxed" style={{ color: A.green }}>
            Test accounts bypass signup/signin intent checks — the same phone number can be re-registered freely during QA. Toggle any account below.
          </p>
        </div>
      )}

      {/* User rows */}
      {isLoading ? Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-2xl p-4 animate-pulse h-16" style={{ background: A.card, border: `1px solid ${A.border}` }} />
      )) : filtered.length === 0 ? (
        <ACard>
          <p className="text-center text-sm py-6" style={{ color: A.dim }}>No {filter === "test" ? "test accounts" : filter === "all" ? "users" : filter + "s"} found.</p>
        </ACard>
      ) : filtered.map(u => (
        <ACard key={u.userId}>
          <div className="flex items-start gap-3">
            {/* Avatar */}
            <div className="relative shrink-0">
              {u.avatarSeed ? (
                <img
                  src={`https://api.dicebear.com/7.x/lorelei/svg?seed=${encodeURIComponent(u.avatarSeed)}&backgroundColor=7c3aed,be185d,f97316&backgroundType=gradientLinear&radius=50`}
                  alt="avatar" className="w-10 h-10 rounded-full"
                />
              ) : (
                <div className="w-10 h-10 rounded-full flex items-center justify-center font-black text-xs"
                  style={{ background: u.role === "listener" ? "rgba(168,85,247,0.15)" : "rgba(59,130,246,0.15)", color: u.role === "listener" ? A.purple : A.blue }}>
                  {(u.firstName ?? u.anonymousUsername).slice(0, 2).toUpperCase()}
                </div>
              )}
              {u.isTestAccount && (
                <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center" style={{ background: A.green }}>
                  <FlaskConical className="w-2.5 h-2.5 text-white" />
                </span>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                <p className="font-bold text-sm truncate" style={{ color: A.text }}>
                  {u.firstName ? u.firstName : u.anonymousUsername}
                </p>
                {u.firstName && (
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full" style={{ background: "rgba(245,166,35,0.12)", color: A.gold }}>
                    {u.anonymousUsername}
                  </span>
                )}
                {u.isTestAccount && (
                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wide"
                    style={{ background: "rgba(34,197,94,0.15)", color: A.green }}>
                    🧪 test
                  </span>
                )}
                {u.spamCount > 0 && (
                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wide flex items-center gap-0.5"
                    style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>
                    🚨 {u.spamCount} spam
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                {u.phone && (
                  <p className="text-[10px] flex items-center gap-1" style={{ color: A.sub }}>
                    <span style={{ color: A.green }}>📱</span>
                    <span className="font-medium">{u.phone}</span>
                  </p>
                )}
                {u.age && (
                  <p className="text-[10px]" style={{ color: A.sub }}>
                    Age: <span style={{ color: A.text }}>{u.age}</span>
                  </p>
                )}
                {u.email && (
                  <p className="text-[10px] truncate" style={{ color: A.sub }}>{u.email}</p>
                )}
                <p className="text-[10px]" style={{ color: A.dim }}>{fmtAgo(u.createdAt)}</p>
              </div>
            </div>

            {/* Right side */}
            <div className="shrink-0 flex flex-col items-end gap-1.5 max-w-[140px]">
              <ABadge status={u.role} />
              {u.role === "user" && (
                <div className="text-right">
                  <p className="text-[9px] uppercase tracking-wide" style={{ color: A.dim }}>Wallet</p>
                  <p className="text-xs font-bold" style={{ color: A.gold }}>{fmtRupees(u.walletBalanceInRupees)}</p>
                </div>
              )}
              {u.role === "listener" && (
                <div className="text-right">
                  <p className="text-[9px] uppercase tracking-wide" style={{ color: A.dim }}>Balance</p>
                  <p className="text-xs font-bold" style={{ color: u.earningsBalanceRupees != null && u.earningsBalanceRupees >= 200 ? A.gold : A.green }}>
                    {u.earningsBalanceRupees != null ? fmtRupees(u.earningsBalanceRupees) : "₹0"}
                  </p>
                  {u.totalEarningsRupees != null && u.totalEarningsRupees > 0 && (
                    <p className="text-[9px]" style={{ color: A.dim }}>Earned: {fmtRupees(u.totalEarningsRupees)}</p>
                  )}
                </div>
              )}
              {u.role === "listener" && (
                <div className="text-right">
                  <p className="text-[9px] uppercase tracking-wide" style={{ color: A.dim }}>Balance</p>
                  <p className="text-xs font-bold" style={{ color: u.earningsBalanceRupees != null && u.earningsBalanceRupees >= 200 ? A.gold : A.green }}>
                    {u.earningsBalanceRupees != null ? fmtRupees(u.earningsBalanceRupees) : "—"}
                  </p>
                  {u.totalEarningsRupees != null && u.totalEarningsRupees > 0 && (
                    <p className="text-[9px]" style={{ color: A.dim }}>Total: {fmtRupees(u.totalEarningsRupees)}</p>
                  )}
                </div>
              )}
              <div className="flex items-center gap-1 flex-wrap justify-end">
                {u.role === "user" && (
                  <button
                    onClick={() => {
                      const opening = moneyOpenId !== u.userId;
                      setMoneyOpenId(opening ? u.userId : null);
                      setMoneyMode("credit"); setMoneyAmount(""); setMoneyNote("");
                    }}
                    className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg transition-all"
                    style={moneyOpenId === u.userId
                      ? { background: A.gold, color: "#000" }
                      : { background: A.goldDim, color: A.gold, border: `1px solid rgba(245,166,35,0.25)` }}
                    title="Manual recharge / adjust balance">
                    <IndianRupee className="w-3 h-3" />
                    Money
                  </button>
                )}
                <button
                  onClick={() => handleToggleTest(u)}
                  disabled={togglingId === u.userId}
                  className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg transition-all"
                  style={u.isTestAccount
                    ? { background: "rgba(34,197,94,0.15)", color: A.green, border: `1px solid rgba(34,197,94,0.3)` }
                    : { background: A.card, color: A.dim, border: `1px solid ${A.border}` }}
                  title={u.isTestAccount ? "Click to remove test mode" : "Click to enable test mode"}
                >
                  <FlaskConical className="w-3 h-3" />
                  {togglingId === u.userId ? "..." : u.isTestAccount ? "Test ON" : "Test"}
                </button>
              </div>
            </div>
          </div>

          {/* Device ID strip + full-width Remove bar */}
          {(u.deviceId || !u.isAdmin) && (
            <div className="mt-2 pt-2 border-t flex items-center gap-2" style={{ borderColor: A.border }}>
              {u.deviceId ? (
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <Smartphone className="w-3 h-3 shrink-0" style={{ color: A.dim }} />
                  <span className="text-[9px] font-mono truncate" style={{ color: A.dim }}>
                    {u.deviceId.slice(0, 20)}{u.deviceId.length > 20 ? "…" : ""}
                  </span>
                </div>
              ) : <div className="flex-1" />}
              {!u.isAdmin && (
                <button
                  onClick={() => {
                    const opening = removeOpenId !== u.userId;
                    setRemoveOpenId(opening ? u.userId : null);
                    setRemoveBanDevice(true); setRemoveReason("");
                  }}
                  className="flex items-center gap-1.5 text-[11px] font-black px-3 py-1.5 rounded-lg transition-all shrink-0"
                  style={removeOpenId === u.userId
                    ? { background: A.red, color: "#fff" }
                    : { background: "rgba(239,68,68,0.15)", color: A.red, border: `1.5px solid ${A.red}` }}
                  title="Remove this user permanently">
                  <Trash2 className="w-3.5 h-3.5" /> REMOVE USER
                </button>
              )}
            </div>
          )}

          {/* Remove panel — confirm with ban-device toggle */}
          {removeOpenId === u.userId && (
            <div className="mt-3 pt-3 border-t space-y-2.5" style={{ borderColor: A.border, background: "rgba(239,68,68,0.04)" }}>
              <p className="text-[10px] font-black uppercase tracking-wide" style={{ color: A.red }}>
                ⚠️ Permanently Remove
              </p>
              <p className="text-[10px] leading-relaxed" style={{ color: A.sub }}>
                Yeh user, profile, wallet, sessions, transactions{u.role === "listener" ? ", listener profile, earnings, withdrawals" : ""} sab delete ho jayega. Wapas nahi laaya ja sakta.
              </p>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={removeBanDevice} onChange={e => setRemoveBanDevice(e.target.checked)}
                  className="mt-0.5" />
                <span className="text-[11px]" style={{ color: A.text }}>
                  <span className="font-bold" style={{ color: A.red }}>Device bhi BAN karein</span>
                  <span style={{ color: A.dim }}> — Same phone phir kabhi register nahi kar payega</span>
                </span>
              </label>
              <input type="text" value={removeReason} onChange={e => setRemoveReason(e.target.value)}
                placeholder="Reason (optional, audit-logged)"
                maxLength={200}
                className="w-full text-xs rounded-lg px-3 py-2 outline-none"
                style={{ background: A.surface, color: A.text, border: `1px solid ${A.border}` }} />
              <div className="flex gap-2">
                <button onClick={() => handleRemoveUser(u)} disabled={removeBusy}
                  className="flex-1 py-2 rounded-lg text-xs font-black transition-all disabled:opacity-50"
                  style={{ background: A.red, color: "#fff" }}>
                  {removeBusy ? "Removing…" : `Remove ${removeBanDevice ? "& Ban Device" : "Only"}`}
                </button>
                <button onClick={() => { setRemoveOpenId(null); setRemoveReason(""); }}
                  className="px-3 py-2 rounded-lg text-xs font-bold"
                  style={{ background: A.card, color: A.sub, border: `1px solid ${A.border}` }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Money panel — credit / adjust */}
          {moneyOpenId === u.userId && u.role === "user" && (
            <div className="mt-3 pt-3 border-t space-y-2" style={{ borderColor: A.border }}>
              <div className="flex gap-2">
                {(["credit", "adjust"] as const).map(m => (
                  <button key={m} onClick={() => setMoneyMode(m)}
                    className="flex-1 py-1.5 rounded-lg text-[11px] font-black uppercase transition-all"
                    style={moneyMode === m
                      ? { background: A.gold, color: "#000" }
                      : { background: A.card, color: A.sub, border: `1px solid ${A.border}` }}>
                    {m === "credit" ? "+ / − Amount" : "Set Balance"}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 items-center">
                <span className="text-sm font-black" style={{ color: A.gold }}>₹</span>
                <input
                  type="number" inputMode="numeric"
                  value={moneyAmount}
                  onChange={e => setMoneyAmount(e.target.value)}
                  placeholder={moneyMode === "credit" ? "e.g. 100 or -50" : "e.g. 250 (new total)"}
                  className="flex-1 text-sm rounded-lg px-3 py-2 outline-none"
                  style={{ background: A.surface, color: A.text, border: `1px solid ${A.border}` }}
                />
              </div>
              <input
                type="text"
                value={moneyNote}
                onChange={e => setMoneyNote(e.target.value)}
                placeholder="Note (optional, shown in transactions)"
                maxLength={200}
                className="w-full text-xs rounded-lg px-3 py-2 outline-none"
                style={{ background: A.surface, color: A.text, border: `1px solid ${A.border}` }}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleMoneyAction(u)}
                  disabled={moneySubmitting || !moneyAmount}
                  className="flex-1 py-2 rounded-lg text-xs font-black transition-all disabled:opacity-50"
                  style={{ background: A.green, color: "#000" }}>
                  {moneySubmitting ? "Working…" : moneyMode === "credit" ? "Apply Credit/Debit" : "Set New Balance"}
                </button>
                <button
                  onClick={() => { setMoneyOpenId(null); setMoneyAmount(""); setMoneyNote(""); }}
                  className="px-3 py-2 rounded-lg text-xs font-bold"
                  style={{ background: A.card, color: A.sub, border: `1px solid ${A.border}` }}>
                  Cancel
                </button>
              </div>
              <p className="text-[10px]" style={{ color: A.dim }}>
                Current balance: <span style={{ color: A.gold }}>{fmtRupees(u.walletBalanceInRupees)}</span> · All actions are audit-logged.
              </p>
            </div>
          )}
        </ACard>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSACTIONS TAB
// ═══════════════════════════════════════════════════════════════════════════════
// Transaction kind metadata: pretty label + color/glow for chips & badges.
const TX_KIND_META: Record<string, { label: string; color: string; bg: string }> = {
  recharge:      { label: "Recharge",        color: A.green,  bg: "rgba(34,197,94,0.15)"  },
  admin_credit:  { label: "Admin Credit",    color: A.gold,   bg: A.goldDim               },
  admin_adjust:  { label: "Admin Adjust",    color: A.gold,   bg: A.goldDim               },
  chat_charge:   { label: "Chat Charge",     color: A.blue,   bg: "rgba(59,130,246,0.15)" },
  call_charge:   { label: "Call Charge",     color: A.purple, bg: "rgba(168,85,247,0.15)" },
  withdrawal:    { label: "Withdrawal",      color: A.orange, bg: "rgba(249,115,22,0.15)" },
  payout:        { label: "Payout",          color: A.orange, bg: "rgba(249,115,22,0.15)" },
  refund:        { label: "Refund",          color: A.green,  bg: "rgba(34,197,94,0.15)"  },
};
const TX_KIND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "recharge",     label: "Recharge" },
  { value: "admin_credit", label: "Admin Credit" },
  { value: "admin_adjust", label: "Admin Adjust" },
  { value: "chat_charge",  label: "Chat Charge" },
  { value: "call_charge",  label: "Call Charge" },
  { value: "withdrawal",   label: "Withdrawal" },
  { value: "payout",       label: "Payout" },
  { value: "refund",       label: "Refund" },
];

function TransactionsTab() {
  // ── Filter state ────────────────────────────────────────────────────────
  // Inputs are kept separate from the "applied" state so typing the user ID
  // doesn't fire a request on every keystroke; clicking Apply commits them
  // and resets pagination back to page 1.
  const [userIdInput, setUserIdInput] = useState("");
  const [kindsInput, setKindsInput] = useState<string[]>([]);
  const [startInput, setStartInput] = useState("");
  const [endInput, setEndInput] = useState("");

  const [appliedUserId, setAppliedUserId] = useState("");
  const [appliedKinds, setAppliedKinds] = useState<string[]>([]);
  const [appliedStart, setAppliedStart] = useState("");
  const [appliedEnd, setAppliedEnd] = useState("");

  const [page, setPage] = useState(1);
  const pageSize = 50;

  // Build query params; convert local <input type="date"> values into ISO
  // boundaries (start = midnight, end = next-day midnight, exclusive).
  const params = (() => {
    const p: Record<string, string | number> = { page, pageSize };
    if (appliedUserId) p.userId = appliedUserId;
    if (appliedKinds.length > 0) p.kind = appliedKinds.join(",");
    if (appliedStart) p.startDate = new Date(`${appliedStart}T00:00:00`).toISOString();
    if (appliedEnd) {
      const d = new Date(`${appliedEnd}T00:00:00`);
      d.setDate(d.getDate() + 1);
      p.endDate = d.toISOString();
    }
    return p;
  })();

  const { data, isLoading, isFetching, dataUpdatedAt, refetch } = useListAllTransactions(params, {
    query: {
      queryKey: getListAllTransactionsQueryKey(params),
      refetchInterval: 10_000,
      refetchIntervalInBackground: false,
      placeholderData: (prev) => prev,
    },
  });

  const txs = data?.transactions ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const hasFilters =
    Boolean(appliedUserId) || appliedKinds.length > 0 || Boolean(appliedStart) || Boolean(appliedEnd);

  const apply = () => {
    setAppliedUserId(userIdInput.trim());
    setAppliedKinds(kindsInput);
    setAppliedStart(startInput);
    setAppliedEnd(endInput);
    setPage(1);
  };
  const reset = () => {
    setUserIdInput(""); setKindsInput([]); setStartInput(""); setEndInput("");
    setAppliedUserId(""); setAppliedKinds([]); setAppliedStart(""); setAppliedEnd("");
    setPage(1);
  };
  const toggleKind = (k: string) => {
    setKindsInput(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]);
  };

  const rangeStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, totalCount);

  return (
    <div className="space-y-3">
      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <ACard className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-black uppercase tracking-wider" style={{ color: A.text }}>Filters</p>
          <p className="text-[10px] flex items-center gap-1.5" style={{ color: A.dim }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: A.green }} />
            Live · {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("en-IN") : "—"}
          </p>
        </div>

        {/* User ID + date range */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <label className="block text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: A.sub }}>User ID</label>
            <input type="text" value={userIdInput} onChange={e => setUserIdInput(e.target.value)}
              placeholder="exact user id"
              className="w-full text-xs rounded-lg px-3 py-2 outline-none"
              style={{ background: A.surface, color: A.text, border: `1px solid ${A.border}` }}
            />
          </div>
          <div>
            <label className="block text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: A.sub }}>From</label>
            <input type="date" value={startInput} onChange={e => setStartInput(e.target.value)}
              className="w-full text-xs rounded-lg px-3 py-2 outline-none"
              style={{ background: A.surface, color: A.text, border: `1px solid ${A.border}` }}
            />
          </div>
          <div>
            <label className="block text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: A.sub }}>To</label>
            <input type="date" value={endInput} onChange={e => setEndInput(e.target.value)}
              className="w-full text-xs rounded-lg px-3 py-2 outline-none"
              style={{ background: A.surface, color: A.text, border: `1px solid ${A.border}` }}
            />
          </div>
        </div>

        {/* Kind chips */}
        <div>
          <label className="block text-[9px] font-bold uppercase tracking-wider mb-1.5" style={{ color: A.sub }}>Kind</label>
          <div className="flex flex-wrap gap-1.5">
            {TX_KIND_OPTIONS.map(opt => {
              const active = kindsInput.includes(opt.value);
              const meta = TX_KIND_META[opt.value];
              return (
                <button key={opt.value} onClick={() => toggleKind(opt.value)}
                  className="px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all"
                  style={{
                    background: active ? (meta?.color ?? A.gold) : A.card,
                    color:      active ? "#000" : A.sub,
                    borderColor: active ? (meta?.color ?? A.gold) : A.border,
                  }}>
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Apply / reset / refresh */}
        <div className="flex gap-2">
          <button onClick={apply}
            className="flex-1 py-2 rounded-lg text-xs font-black"
            style={{ background: A.gold, color: "#000" }}>
            Apply Filters
          </button>
          <button onClick={reset}
            className="px-3 py-2 rounded-lg text-xs font-bold"
            style={{ background: A.card, color: A.sub, border: `1px solid ${A.border}` }}>
            Reset
          </button>
          <button onClick={() => refetch()}
            className="px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1"
            style={{ background: A.goldDim, color: A.gold, border: `1px solid rgba(245,166,35,0.25)` }}
            title="Refresh">
            <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
          </button>
        </div>
      </ACard>

      {/* ── Result count + pagination header ───────────────────────────── */}
      <div className="flex items-center justify-between text-[10px]" style={{ color: A.dim }}>
        <p>
          {totalCount === 0
            ? (isLoading ? "Loading…" : "No transactions match these filters.")
            : <>Showing <span style={{ color: A.text }}>{rangeStart}–{rangeEnd}</span> of <span style={{ color: A.text }}>{totalCount.toLocaleString("en-IN")}</span>{hasFilters ? " filtered" : ""}</>}
        </p>
        <p>Page {page} / {totalPages}</p>
      </div>

      {/* ── Rows ───────────────────────────────────────────────────────── */}
      {isLoading ? Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-2xl p-3 animate-pulse h-16" style={{ background: A.card, border: `1px solid ${A.border}` }} />
      )) : txs.map(t => {
        const meta = TX_KIND_META[t.kind] ?? { label: t.kind, color: A.sub, bg: "rgba(74,90,122,0.2)" };
        return (
          <ACard key={t.id} className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
              style={{ background: t.amountInRupees > 0 ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.12)" }}>
              <IndianRupee className="w-3.5 h-3.5" style={{ color: t.amountInRupees > 0 ? A.green : A.red }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-xs font-bold truncate" style={{ color: A.text }}>{t.description}</p>
                <span className="text-[8.5px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ background: meta.bg, color: meta.color }}>
                  {meta.label}
                </span>
              </div>
              <p className="text-[10px] truncate" style={{ color: A.sub }}>
                {t.userName} · {fmtAgo(t.createdAt)}
                {t.adminEmail && (
                  <> · by <span style={{ color: A.gold }}>{t.adminEmail}</span></>
                )}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-black" style={{ color: t.amountInRupees > 0 ? A.green : A.red }}>
                {t.amountInRupees > 0 ? "+" : ""}{fmtRupees(t.amountInRupees)}
              </p>
              <p className="text-[9px]" style={{ color: A.dim }}>bal {fmtRupees(t.balanceAfter)}</p>
            </div>
          </ACard>
        );
      })}

      {/* ── Pagination footer ──────────────────────────────────────────── */}
      {totalCount > 0 && (
        <div className="flex items-center justify-between gap-2 pt-1">
          <button onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1 || isFetching}
            className="flex-1 py-2 rounded-lg text-xs font-bold disabled:opacity-40"
            style={{ background: A.card, color: A.text, border: `1px solid ${A.border}` }}>
            ← Prev
          </button>
          <p className="text-[10px] px-2" style={{ color: A.dim }}>{page} / {totalPages}</p>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || isFetching}
            className="flex-1 py-2 rounded-lg text-xs font-bold disabled:opacity-40"
            style={{ background: A.card, color: A.text, border: `1px solid ${A.border}` }}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT LOG TAB
// ═══════════════════════════════════════════════════════════════════════════════
type AuditEntry = {
  id: number;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId: string | null;
  details: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
};

const ACTION_META: Record<string, { label: string; icon: React.ElementType; color: string; glow: string }> = {
  approve_listener:  { label: "Approved Listener",       icon: CheckCheck,      color: "#22c55e", glow: "rgba(34,197,94,0.15)" },
  reject_listener:   { label: "Rejected Listener",       icon: Ban,             color: "#ef4444", glow: "rgba(239,68,68,0.15)" },
  pay_withdrawal:    { label: "Paid Withdrawal",         icon: IndianRupee,     color: "#f5a623", glow: "rgba(245,166,35,0.15)" },
  reject_withdrawal: { label: "Rejected Withdrawal",     icon: XCircle,         color: "#ef4444", glow: "rgba(239,68,68,0.15)" },
  manual_credit:           { label: "Manual Credit (User)",     icon: IndianRupee, color: "#f5a623", glow: "rgba(245,166,35,0.15)" },
  adjust_balance:          { label: "Adjusted Balance (User)",  icon: IndianRupee, color: "#f5a623", glow: "rgba(245,166,35,0.15)" },
  manual_credit_listener:  { label: "Manual Credit (Listener)", icon: IndianRupee, color: "#a855f7", glow: "rgba(168,85,247,0.15)" },
  adjust_balance_listener: { label: "Adjusted Earnings (Listener)", icon: IndianRupee, color: "#a855f7", glow: "rgba(168,85,247,0.15)" },
  view_users:        { label: "Viewed User List",        icon: Eye,             color: "#8a9bbf", glow: "rgba(138,155,191,0.1)" },
  view_audit_log:    { label: "Viewed Audit Log",        icon: ScrollText,      color: "#8a9bbf", glow: "rgba(138,155,191,0.1)" },
  request_wallet_action: { label: "Requested Wallet Action (pending)", icon: Hourglass, color: "#f97316", glow: "rgba(249,115,22,0.15)" },
  approve_wallet_action: { label: "Co-approved Wallet Action",         icon: CheckCheck, color: "#22c55e", glow: "rgba(34,197,94,0.15)" },
  reject_wallet_action:  { label: "Rejected Pending Action",           icon: Ban,        color: "#ef4444", glow: "rgba(239,68,68,0.15)" },
};

const MONEY_ACTIONS = ["manual_credit", "adjust_balance", "manual_credit_listener", "adjust_balance_listener", "pay_withdrawal", "reject_withdrawal"] as const;
const APPROVAL_ACTIONS = ["request_wallet_action", "approve_wallet_action", "reject_wallet_action"] as const;
const ACTION_GROUPS: Array<{ id: string; label: string; actions: string[] }> = [
  { id: "money",      label: "Money actions",   actions: [...MONEY_ACTIONS] },
  { id: "listeners",  label: "Listener review", actions: ["approve_listener", "reject_listener"] },
  { id: "views",      label: "Read events",     actions: ["view_users", "view_audit_log"] },
];

// ═══════════════════════════════════════════════════════════════════════════════
// APPROVALS TAB — two-person approval queue for large wallet adjustments
// ═══════════════════════════════════════════════════════════════════════════════
type PendingAction = {
  id: string;
  actionType: "user_credit" | "user_adjust" | "listener_credit" | "listener_adjust";
  targetType: "wallet" | "listener_balance";
  targetId: string;
  targetName: string;
  amountRupees: number;
  note: string;
  payload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  requestedByUserId: string;
  requestedByEmail: string;
  decidedByUserId: string | null;
  decidedByEmail: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  canApprove: boolean;
};
type PendingActionsResponse = {
  thresholdRupees: number;
  currentAdminUserId: string | null;
  actions: PendingAction[];
};

function actionTypeLabel(t: PendingAction["actionType"]) {
  switch (t) {
    case "user_credit":     return "User wallet credit";
    case "user_adjust":     return "User wallet — set balance";
    case "listener_credit": return "Listener earnings credit";
    case "listener_adjust": return "Listener earnings — set balance";
  }
}
// Snapshot the server takes when queueing a pending action. All fields are
// optional because the API is allowed to evolve the snapshot shape over time;
// `describeChange` falls back to the requested amount when fields are missing.
type PendingActionPayload = {
  previousBalanceInRupees?: number | string;
  previousBalancePaise?: number | string;
  projectedDeltaRupees?: number | string;
};
function readNum(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}
function describeChange(a: PendingAction): string {
  const isAdjust = a.actionType.endsWith("adjust");
  const isListener = a.actionType.startsWith("listener");
  const p = (a.payload ?? {}) as PendingActionPayload;
  if (isAdjust) {
    const prev = isListener ? readNum(p.previousBalancePaise) / 100 : readNum(p.previousBalanceInRupees);
    const delta = p.projectedDeltaRupees !== undefined ? readNum(p.projectedDeltaRupees) : (a.amountRupees - prev);
    return `Set balance: ₹${prev.toLocaleString("en-IN")} → ₹${a.amountRupees.toLocaleString("en-IN")} (${delta >= 0 ? "+" : ""}₹${delta.toLocaleString("en-IN")})`;
  }
  return a.amountRupees >= 0
    ? `Credit +₹${a.amountRupees.toLocaleString("en-IN")}`
    : `Debit −₹${Math.abs(a.amountRupees).toLocaleString("en-IN")}`;
}

function ApprovalsTab() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [decisionNote, setDecisionNote] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery<PendingActionsResponse>({
    queryKey: ["admin-pending-actions", statusFilter],
    queryFn: async () => {
      const r = await fetch(apiUrl(`/api/admin/pending-actions?status=${statusFilter}`), { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    staleTime: 15_000,
  });

  const decide = async (id: string, kind: "approve" | "reject") => {
    setBusyId(id);
    try {
      const r = await fetch(apiUrl(`/api/admin/pending-actions/${id}/${kind}`), {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: decisionNote[id] ?? "" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error ?? "Action failed"); return; }
      toast.success(kind === "approve" ? "Approved and applied." : "Rejected.");
      setDecisionNote(s => ({ ...s, [id]: "" }));
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: getGetAdminSummaryQueryKey() });
    } catch { toast.error("Network error"); } finally { setBusyId(null); }
  };

  const actions = data?.actions ?? [];
  // Only meaningful when viewing the "all" feed — for status-filtered views,
  // the API only returns rows with that status, so a "pending" count from
  // the filtered set would always be misleading.
  const pendingCount = statusFilter === "all" ? actions.filter(a => a.status === "pending").length : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-black" style={{ color: A.text }}>Pending Approvals</h2>
          <p className="text-[11px] mt-0.5" style={{ color: A.sub }}>
            Wallet/earnings changes greater than{" "}
            <span style={{ color: A.gold }}>{fmtRupees(data?.thresholdRupees ?? 5000)}</span>{" "}
            require a second admin to approve. The original admin cannot self-approve.
          </p>
        </div>
        <button onClick={() => refetch()}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg shrink-0"
          style={{ color: A.gold, background: A.goldDim }}>
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        {([
          { id: "pending", label: "Pending", color: A.orange },
          { id: "approved", label: "Approved", color: A.green },
          { id: "rejected", label: "Rejected", color: A.red },
          { id: "all", label: "All", color: A.gold },
        ] as const).map(s => (
          <button key={s.id} onClick={() => setStatusFilter(s.id)}
            className="px-3 py-1 rounded-full text-xs font-bold border transition-all"
            style={{
              background: statusFilter === s.id ? s.color : A.card,
              color: statusFilter === s.id ? "#000" : A.sub,
              borderColor: statusFilter === s.id ? s.color : A.border,
            }}>
            {s.label}
          </button>
        ))}
      </div>

      {statusFilter !== "pending" && pendingCount > 0 && (
        <div className="rounded-xl px-4 py-3 flex items-start gap-3" style={{ background: "rgba(249,115,22,0.08)", border: `1px solid rgba(249,115,22,0.2)` }}>
          <Hourglass className="w-4 h-4 mt-0.5 shrink-0" style={{ color: A.orange }} />
          <p className="text-xs leading-relaxed" style={{ color: A.orange }}>
            {pendingCount} pending action{pendingCount === 1 ? "" : "s"} still awaiting a second admin's decision.
          </p>
        </div>
      )}

      {/* Cards */}
      {isLoading ? Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-2xl p-4 animate-pulse h-28" style={{ background: A.card, border: `1px solid ${A.border}` }} />
      )) : actions.length === 0 ? (
        <ACard>
          <div className="flex flex-col items-center py-10 gap-3">
            <UserCog className="w-10 h-10" style={{ color: A.dim }} />
            <p className="text-sm font-bold" style={{ color: A.dim }}>No {statusFilter === "all" ? "" : statusFilter} approval requests</p>
            <p className="text-xs text-center" style={{ color: A.dim }}>
              Money actions above the threshold will queue here for a second admin's sign-off.
            </p>
          </div>
        </ACard>
      ) : actions.map(a => {
        const isPending = a.status === "pending";
        const sameAdmin = data?.currentAdminUserId === a.requestedByUserId;
        return (
          <ACard key={a.id}>
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: isPending ? "rgba(249,115,22,0.15)" : a.status === "approved" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)" }}>
                {isPending ? <Hourglass className="w-4 h-4" style={{ color: A.orange }} />
                  : a.status === "approved" ? <CheckCheck className="w-4 h-4" style={{ color: A.green }} />
                  : <Ban className="w-4 h-4" style={{ color: A.red }} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-black" style={{ color: A.text }}>{actionTypeLabel(a.actionType)}</p>
                  <ABadge status={a.status} />
                </div>
                <p className="text-xs mt-0.5" style={{ color: A.sub }}>
                  Target: <span style={{ color: A.text }}>{a.targetName}</span>
                  <span style={{ color: A.dim }}> · {a.targetId.slice(0, 12)}…</span>
                </p>
                <p className="text-sm font-bold mt-1.5" style={{ color: A.gold }}>
                  {describeChange(a)}
                </p>
                {a.note && <p className="text-xs mt-1 italic" style={{ color: A.dim }}>“{a.note}”</p>}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2 text-[10px]" style={{ color: A.dim }}>
                  <span>Requested by <span style={{ color: A.sub }}>{a.requestedByEmail}</span></span>
                  <span>· {fmtAgo(a.createdAt)}</span>
                  {a.decidedByEmail && (
                    <span>· {a.status === "approved" ? "Approved" : "Rejected"} by <span style={{ color: A.sub }}>{a.decidedByEmail}</span></span>
                  )}
                  {a.decidedAt && <span>· {fmtTime(a.decidedAt)}</span>}
                </div>
                {a.decisionNote && (
                  <p className="text-[11px] mt-1" style={{ color: A.sub }}>
                    <span style={{ color: A.dim }}>Decision note: </span>{a.decisionNote}
                  </p>
                )}

                {isPending && (
                  <div className="mt-3 pt-3 border-t space-y-2" style={{ borderColor: A.border }}>
                    {sameAdmin ? (
                      <p className="text-[11px]" style={{ color: A.orange }}>
                        You requested this action — a different admin must approve. You can still cancel it via Reject.
                      </p>
                    ) : (
                      <p className="text-[11px]" style={{ color: A.dim }}>
                        Verify the amount and target before approving. This applies the change immediately.
                      </p>
                    )}
                    <input type="text" maxLength={200}
                      value={decisionNote[a.id] ?? ""}
                      onChange={e => setDecisionNote(s => ({ ...s, [a.id]: e.target.value }))}
                      placeholder="Decision note (optional, audit-logged)"
                      className="w-full text-xs rounded-lg px-3 py-2 outline-none"
                      style={{ background: A.surface, color: A.text, border: `1px solid ${A.border}` }} />
                    <div className="flex gap-2">
                      <button onClick={() => decide(a.id, "approve")}
                        disabled={busyId === a.id || !a.canApprove}
                        title={!a.canApprove ? "A different admin must approve (two-person rule)" : "Approve and apply"}
                        className="flex-1 py-2 rounded-lg text-xs font-black transition-all disabled:opacity-40"
                        style={{ background: A.green, color: "#000" }}>
                        {busyId === a.id ? "Working…" : "Approve & Apply"}
                      </button>
                      <button onClick={() => decide(a.id, "reject")}
                        disabled={busyId === a.id}
                        className="flex-1 py-2 rounded-lg text-xs font-black transition-all disabled:opacity-40"
                        style={{ background: "rgba(239,68,68,0.15)", color: A.red, border: `1px solid rgba(239,68,68,0.3)` }}>
                        {sameAdmin ? "Cancel Request" : "Reject"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </ACard>
        );
      })}
    </div>
  );
}

function AuditLogTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // filter: "all" | group id (e.g. "money") | specific action (e.g. "manual_credit")
  const [filter, setFilter] = useState<string>("money");

  // Resolve the active filter into the set of action names to request from
  // the server. Sending the filter as a query param (instead of fetching all
  // and filtering in-memory) ensures we don't miss matching rows that fall
  // outside the most-recent 500 across all action types.
  const serverActionParam = (() => {
    if (filter === "all") return "";
    const group = ACTION_GROUPS.find(g => g.id === filter);
    if (group) return group.actions.join(",");
    return filter; // specific action id
  })();

  const fetchEntries = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams({ limit: "500" });
    if (serverActionParam) qs.set("action", serverActionParam);
    fetch(apiUrl(`/api/admin/audit-log?${qs.toString()}`), { credentials: "include" })
      .then(r => r.json())
      .then(d => setEntries(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [serverActionParam]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  // Server already filtered; rendering uses entries directly.
  const filtered = entries;

  const moneyCount = entries.filter(e => (MONEY_ACTIONS as readonly string[]).includes(e.action)).length;

  return (
    <div className="space-y-4">
      {/* Header + stats */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-black" style={{ color: A.text }}>Admin Audit Trail</h2>
          <p className="text-[11px] mt-0.5" style={{ color: A.sub }}>
            Every admin action is permanently recorded with timestamp and IP address.
          </p>
        </div>
        <button onClick={fetchEntries} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg shrink-0" style={{ color: A.gold, background: A.goldDim }}>
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Summary chips */}
      <div className="flex gap-2 flex-wrap">
        <div className="px-3 py-1.5 rounded-xl text-xs font-bold" style={{ background: A.goldDim, color: A.gold, border: `1px solid rgba(245,166,35,0.2)` }}>
          {entries.length} total entries
        </div>
        <div className="px-3 py-1.5 rounded-xl text-xs font-bold" style={{ background: "rgba(34,197,94,0.1)", color: A.green, border: `1px solid rgba(34,197,94,0.2)` }}>
          {moneyCount} money actions
        </div>
      </div>

      {/* Group filter pills */}
      <div className="flex gap-2 flex-wrap">
        {[{ id: "all", label: "All" }, ...ACTION_GROUPS.map(g => ({ id: g.id, label: g.label }))].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className="px-3 py-1 rounded-full text-xs font-bold border transition-all"
            style={{
              background: filter === f.id ? A.gold : A.card,
              color: filter === f.id ? "#000" : A.sub,
              borderColor: filter === f.id ? A.gold : A.border,
            }}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Specific action-type select */}
      <div className="flex items-center gap-2">
        <label className="text-[11px] font-bold" style={{ color: A.dim }}>Action:</label>
        <select
          value={ACTION_GROUPS.some(g => g.id === filter) || filter === "all" ? "" : filter}
          onChange={e => setFilter(e.target.value || "all")}
          className="text-xs px-2 py-1 rounded-lg border outline-none"
          style={{ background: A.card, color: A.text, borderColor: A.border }}
        >
          <option value="">— pick a specific action —</option>
          {Object.entries(ACTION_META).map(([id, meta]) => (
            <option key={id} value={id}>{meta.label}</option>
          ))}
        </select>
      </div>

      {/* Entries */}
      {loading ? (
        Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-2xl p-4 animate-pulse h-20" style={{ background: A.card, border: `1px solid ${A.border}` }} />
        ))
      ) : filtered.length === 0 ? (
        <ACard>
          <div className="flex flex-col items-center py-10 gap-3">
            <ScrollText className="w-10 h-10" style={{ color: A.dim }} />
            <p className="text-sm font-bold" style={{ color: A.dim }}>No audit entries yet</p>
            <p className="text-xs text-center" style={{ color: A.dim }}>
              Entries appear here as you perform admin actions — approvals, payouts, and decisions.
            </p>
          </div>
        </ACard>
      ) : (
        <div className="space-y-2">
          {filtered.map(entry => {
            const meta = ACTION_META[entry.action] ?? { label: entry.action, icon: ArrowRightLeft, color: A.sub, glow: "rgba(74,90,122,0.15)" };
            const Icon = meta.icon;
            const d = entry.details as any;

            return (
              <ACard key={entry.id} className="flex items-start gap-3">
                {/* Icon */}
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5" style={{ background: meta.glow }}>
                  <Icon className="w-4 h-4" style={{ color: meta.color }} />
                </div>

                {/* Body */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-black leading-tight" style={{ color: meta.color }}>{meta.label}</p>
                    <p className="text-[10px] shrink-0" style={{ color: A.dim }}>{fmtAgo(entry.createdAt)}</p>
                  </div>

                  {/* Details row */}
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                    {d.displayName && (
                      <p className="text-xs" style={{ color: A.text }}>
                        <span style={{ color: A.dim }}>Target: </span>{d.displayName}
                      </p>
                    )}
                    {d.amountRupees !== undefined && (
                      <p className="text-xs font-bold" style={{ color: A.gold }}>
                        ₹{Number(d.amountRupees).toFixed(2)}
                      </p>
                    )}
                    {(() => {
                      // Wallet adjust logs `delta`, listener adjust logs `deltaRupees`.
                      const delta = d.delta ?? d.deltaRupees;
                      if (delta === undefined || d.amountRupees !== undefined) return null;
                      return (
                        <p className="text-xs font-bold" style={{ color: Number(delta) >= 0 ? A.green : A.red }}>
                          {Number(delta) >= 0 ? "+" : ""}₹{Number(delta).toFixed(2)}
                        </p>
                      );
                    })()}
                    {(() => {
                      // User wallet actions log `previousBalance`/`newBalance`
                      // (rupees), listener actions log `previousBalanceRupees`/
                      // `newBalanceRupees`. Normalize both shapes.
                      const prev = d.previousBalance ?? d.previousBalanceRupees;
                      const next = d.newBalance ?? d.newBalanceRupees;
                      if (prev === undefined || next === undefined) return null;
                      return (
                        <p className="text-xs font-mono" style={{ color: A.sub }}>
                          <span style={{ color: A.dim }}>Bal: </span>
                          ₹{Number(prev).toFixed(2)}
                          <span style={{ color: A.dim }}> → </span>
                          <span style={{ color: A.text }}>₹{Number(next).toFixed(2)}</span>
                        </p>
                      );
                    })()}
                    {d.upiId && (
                      <p className="text-xs font-mono" style={{ color: A.sub }}>
                        UPI: {d.upiId}
                      </p>
                    )}
                    {d.reason && (
                      <p className="text-xs" style={{ color: A.red }}>
                        Reason: {String(d.reason)}
                      </p>
                    )}
                    {d.note && (
                      <p className="text-xs" style={{ color: A.orange }}>
                        Note: {String(d.note)}
                      </p>
                    )}
                    {d.refunded && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(249,115,22,0.15)", color: A.orange }}>
                        REFUNDED
                      </span>
                    )}
                  </div>

                  {/* Meta footer */}
                  <div className="flex gap-3 mt-1.5 flex-wrap">
                    <p className="text-[10px] font-mono" style={{ color: A.dim }}>
                      {new Date(entry.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </p>
                    <p className="text-[10px] font-mono truncate max-w-[180px]" style={{ color: A.dim }} title={entry.adminEmail}>
                      Admin: {entry.adminEmail}
                    </p>
                    {entry.ipAddress && (
                      <p className="text-[10px] font-mono" style={{ color: A.dim }}>
                        IP: {entry.ipAddress}
                      </p>
                    )}
                    {entry.targetId && (
                      <p className="text-[10px] font-mono truncate max-w-[120px]" style={{ color: A.dim }} title={entry.targetId}>
                        ID: {entry.targetId.slice(0, 8)}…
                      </p>
                    )}
                  </div>
                </div>
              </ACard>
            );
          })}
        </div>
      )}

      {/* Bottom note */}
      {filtered.length > 0 && (
        <p className="text-center text-[10px] py-2" style={{ color: A.dim }}>
          Showing {filtered.length} of {entries.length} entries · Last 500 fetched
        </p>
      )}
    </div>
  );
}

// ── Violations Tab ─────────────────────────────────────────────────────────────
type ViolationEntry = {
  id: number;
  userId: string | null;
  ipAddress: string | null;
  route: string;
  reason: string;
  hitCount: number;
  autoSuspended: boolean;
  suspendedUntil: string | null;
  createdAt: string;
};
type SuspendedUser = {
  userId: string;
  anonymousUsername: string;
  suspendedUntil: string;
  violationCount: number;
  email: string | null;
  minutesRemaining: number;
};
type AbuseStats = {
  totalViolations: number;
  currentlySuspended: number;
  autoSuspensions: number;
  violationsToday: number;
};

function ViolationsTab() {
  const [view, setView] = useState<"log" | "suspended">("log");
  const [suspendHours, setSuspendHours] = useState<Record<string, string>>({});
  const qc = useQueryClient();

  const statsQ = useQuery<AbuseStats>({
    queryKey: ["admin", "abuse-stats"],
    queryFn: () => fetch(apiUrl("/api/admin/abuse-stats"), { credentials: "include" }).then(r => r.json()),
    refetchInterval: 15_000,
  });
  const violationsQ = useQuery<ViolationEntry[]>({
    queryKey: ["admin", "violations"],
    queryFn: () => fetch(apiUrl("/api/admin/violations"), { credentials: "include" }).then(r => r.json()),
    refetchInterval: 15_000,
    enabled: view === "log",
  });
  const suspendedQ = useQuery<SuspendedUser[]>({
    queryKey: ["admin", "suspended"],
    queryFn: () => fetch(apiUrl("/api/admin/suspended"), { credentials: "include" }).then(r => r.json()),
    refetchInterval: 15_000,
    enabled: view === "suspended",
  });

  async function doSuspend(userId: string) {
    const hours = parseInt(suspendHours[userId] ?? "24", 10);
    const r = await fetch(apiUrl(`/api/admin/users/${userId}/suspend`), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours }),
    });
    if (r.ok) {
      toast.success(`User suspended for ${hours}h`);
      qc.invalidateQueries({ queryKey: ["admin"] });
    } else {
      toast.error("Failed to suspend user");
    }
  }

  async function doUnsuspend(userId: string) {
    const r = await fetch(apiUrl(`/api/admin/users/${userId}/unsuspend`), {
      method: "POST",
      credentials: "include",
    });
    if (r.ok) {
      toast.success("User unsuspended");
      qc.invalidateQueries({ queryKey: ["admin"] });
    } else {
      toast.error("Failed to unsuspend");
    }
  }

  const stats = statsQ.data;

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Violations Today",     value: stats?.violationsToday ?? "—",    color: A.orange, icon: TriangleAlert },
          { label: "Total Violations",      value: stats?.totalViolations ?? "—",    color: A.dim,    icon: ShieldOff },
          { label: "Currently Suspended",   value: stats?.currentlySuspended ?? "—", color: "#ef4444", icon: UserX },
          { label: "Auto-Suspensions",      value: stats?.autoSuspensions ?? "—",   color: A.gold,   icon: Ban },
        ].map(({ label, value, color, icon: Icon }) => (
          <ACard key={label} style={{ padding: "12px 14px" }}>
            <div className="flex items-center gap-2 mb-1">
              <Icon size={14} color={color} />
              <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: A.dim }}>{label}</p>
            </div>
            <p className="text-2xl font-black" style={{ color }}>{value}</p>
          </ACard>
        ))}
      </div>

      {/* View switcher */}
      <div className="flex gap-2">
        {(["log", "suspended"] as const).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className="px-4 py-1.5 rounded-full text-xs font-bold transition-all"
            style={view === v
              ? { background: A.gold, color: "#000" }
              : { background: A.card, color: A.dim, border: `1px solid ${A.border}` }}
          >
            {v === "log" ? "Violation Log" : "Suspended Accounts"}
          </button>
        ))}
      </div>

      {/* Violation Log */}
      {view === "log" && (
        <div className="space-y-2">
          {violationsQ.isLoading && <p className="text-center py-8" style={{ color: A.dim }}>Loading…</p>}
          {violationsQ.data?.length === 0 && (
            <ACard style={{ padding: "32px", textAlign: "center" }}>
              <ShieldCheck size={32} color={A.green} style={{ margin: "0 auto 8px" }} />
              <p style={{ color: A.dim, fontSize: 13 }}>No violations recorded — all clear!</p>
            </ACard>
          )}
          {violationsQ.data?.map(v => (
            <ACard key={v.id} style={{ padding: "10px 14px", borderLeft: `3px solid ${v.autoSuspended ? "#ef4444" : A.orange}` }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: A.surface, color: A.gold }}>
                      {v.route}
                    </span>
                    {v.autoSuspended && (
                      <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>
                        AUTO-SUSPENDED
                      </span>
                    )}
                    <span className="text-[10px]" style={{ color: A.dim }}>×{v.hitCount} hits</span>
                  </div>
                  <p className="text-xs mt-1 truncate" style={{ color: A.text }}>{v.reason}</p>
                  <div className="flex gap-3 mt-1 flex-wrap">
                    {v.userId && <p className="text-[10px] font-mono" style={{ color: A.dim }}>user:{v.userId.slice(0, 8)}…</p>}
                    {v.ipAddress && <p className="text-[10px] font-mono" style={{ color: A.dim }}>ip:{v.ipAddress}</p>}
                    <p className="text-[10px] font-mono" style={{ color: A.dim }}>
                      {new Date(v.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
                {v.userId && (
                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      type="number"
                      min={1} max={720}
                      placeholder="hrs"
                      value={suspendHours[v.userId] ?? ""}
                      onChange={e => setSuspendHours(p => ({ ...p, [v.userId!]: e.target.value }))}
                      className="w-14 text-xs rounded px-2 py-1 text-center"
                      style={{ background: A.surface, color: A.text, border: `1px solid ${A.border}` }}
                    />
                    <button
                      onClick={() => doSuspend(v.userId!)}
                      className="text-[10px] font-bold px-2 py-1 rounded"
                      style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}
                    >
                      Suspend
                    </button>
                  </div>
                )}
              </div>
            </ACard>
          ))}
          {violationsQ.data && violationsQ.data.length > 0 && (
            <p className="text-center text-[10px] py-2" style={{ color: A.dim }}>
              Showing last {violationsQ.data.length} violations
            </p>
          )}
        </div>
      )}

      {/* Suspended Accounts */}
      {view === "suspended" && (
        <div className="space-y-2">
          {suspendedQ.isLoading && <p className="text-center py-8" style={{ color: A.dim }}>Loading…</p>}
          {suspendedQ.data?.length === 0 && (
            <ACard style={{ padding: "32px", textAlign: "center" }}>
              <UserCheck2 size={32} color={A.green} style={{ margin: "0 auto 8px" }} />
              <p style={{ color: A.dim, fontSize: 13 }}>No accounts are currently suspended.</p>
            </ACard>
          )}
          {suspendedQ.data?.map(u => (
            <ACard key={u.userId} style={{ padding: "12px 14px", borderLeft: `3px solid #ef4444` }}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <UserX size={14} color="#ef4444" />
                    <p className="text-sm font-bold" style={{ color: A.text }}>{u.anonymousUsername}</p>
                    <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>
                      SUSPENDED
                    </span>
                  </div>
                  {u.email && <p className="text-xs mt-0.5" style={{ color: A.dim }}>{u.email}</p>}
                  <div className="flex gap-4 mt-1">
                    <p className="text-[10px]" style={{ color: A.orange }}>
                      {u.minutesRemaining >= 60
                        ? `${Math.ceil(u.minutesRemaining / 60)}h remaining`
                        : `${u.minutesRemaining}min remaining`}
                    </p>
                    <p className="text-[10px] font-mono" style={{ color: A.dim }}>
                      Expires: {new Date(u.suspendedUntil).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </p>
                    <p className="text-[10px]" style={{ color: A.dim }}>
                      Total offences: {u.violationCount}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <input
                    type="number"
                    min={1} max={720}
                    placeholder="hrs"
                    value={suspendHours[u.userId] ?? ""}
                    onChange={e => setSuspendHours(p => ({ ...p, [u.userId]: e.target.value }))}
                    className="w-14 text-xs rounded px-2 py-1 text-center"
                    style={{ background: A.surface, color: A.text, border: `1px solid ${A.border}` }}
                  />
                  <button
                    onClick={() => doSuspend(u.userId)}
                    className="text-[10px] font-bold px-2 py-1 rounded"
                    style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}
                  >
                    Extend
                  </button>
                  <button
                    onClick={() => doUnsuspend(u.userId)}
                    className="text-[10px] font-bold px-2 py-1 rounded"
                    style={{ background: "rgba(34,197,94,0.15)", color: A.green }}
                  >
                    Lift Ban
                  </button>
                </div>
              </div>
            </ACard>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SAFETY ALERTS TAB
// ═══════════════════════════════════════════════════════════════════════════════
type SafetyReport = {
  id: number;
  category: string;
  notes: string | null;
  autoBlocked: boolean;
  autoSuspendedUser: boolean;
  reviewedByAdmin: boolean;
  sessionId: string | null;
  reportedUserId: string;
  createdAt: string;
  listenerDisplayName: string | null;
  reportedUserName: string | null;
};

type SafetyStats = {
  totalReports: number;
  reportsToday: number;
  autoSuspended: number;
  uniqueUsersReported: number;
};

const CATEGORY_META: Record<string, { label: string; emoji: string; bg: string; text: string }> = {
  rude_abusive:       { label: "Rude / Abusive",      emoji: "😡", bg: "rgba(249,115,22,0.15)", text: "#f97316" },
  sexual_harassment:  { label: "Sexual Harassment",   emoji: "🚨", bg: "rgba(239,68,68,0.15)",  text: "#ef4444" },
  fake_caller:        { label: "Fake / Time-waster",  emoji: "🎭", bg: "rgba(245,166,35,0.15)", text: "#f5a623" },
};

function SafetyAlertsTab() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "unreviewed" | "auto_suspended">("unreviewed");

  const statsQ = useQuery<SafetyStats>({
    queryKey: ["admin", "safety-stats"],
    queryFn: () => fetch(apiUrl("/api/admin/safety-stats"), { credentials: "include" }).then(r => r.json()),
    refetchInterval: 20_000,
  });

  const reportsQ = useQuery<SafetyReport[]>({
    queryKey: ["admin", "safety-reports"],
    queryFn: () => fetch(apiUrl("/api/admin/safety-alerts"), { credentials: "include" }).then(r => r.json()),
    refetchInterval: 20_000,
  });

  const stats = statsQ.data;

  const filtered = (reportsQ.data ?? []).filter(r => {
    if (filter === "unreviewed") return !r.reviewedByAdmin;
    if (filter === "auto_suspended") return r.autoSuspendedUser;
    return true;
  });

  async function handleReview(id: number) {
    await fetch(apiUrl(`/api/admin/safety-alerts/${id}/review`), { method: "POST", credentials: "include" });
    qc.invalidateQueries({ queryKey: ["admin", "safety-reports"] });
    toast.success("Marked as reviewed");
  }

  async function handleSuspend(userId: string) {
    const r = await fetch(apiUrl(`/api/admin/users/${userId}/suspend`), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours: 24 }),
    });
    if (r.ok) {
      toast.success("User suspended for 24h");
      qc.invalidateQueries({ queryKey: ["admin"] });
    } else {
      toast.error("Failed to suspend user");
    }
  }

  return (
    <div className="space-y-4">
      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Reports",          value: stats?.totalReports ?? "—",        color: A.orange,  icon: ShieldAlert },
          { label: "Reports Today",          value: stats?.reportsToday ?? "—",        color: A.red,     icon: TriangleAlert },
          { label: "Users Auto-Suspended",   value: stats?.autoSuspended ?? "—",       color: "#ef4444", icon: UserX },
          { label: "Unique Users Reported",  value: stats?.uniqueUsersReported ?? "—", color: A.gold,    icon: Ban },
        ].map(({ label, value, color, icon: Icon }) => (
          <ACard key={label} style={{ padding: "12px 14px" }}>
            <div className="flex items-center gap-2 mb-1">
              <Icon size={14} color={color} />
              <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: A.dim }}>{label}</p>
            </div>
            <p className="text-2xl font-black" style={{ color }}>{value}</p>
          </ACard>
        ))}
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 flex-wrap items-center">
        {(["unreviewed", "all", "auto_suspended"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-4 py-1.5 rounded-full text-xs font-bold transition-all"
            style={filter === f
              ? { background: A.gold, color: "#000" }
              : { background: A.card, color: A.dim, border: `1px solid ${A.border}` }}
          >
            {f === "unreviewed" ? "Needs Review" : f === "all" ? "All Reports" : "Auto-Suspended"}
          </button>
        ))}
        <span className="ml-auto text-xs" style={{ color: A.dim }}>
          {filtered.length} report{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Loading / empty states */}
      {reportsQ.isLoading && (
        <p className="text-center py-10" style={{ color: A.dim }}>Loading…</p>
      )}
      {!reportsQ.isLoading && filtered.length === 0 && (
        <ACard style={{ padding: "40px", textAlign: "center" }}>
          <ShieldCheck size={36} color={A.green} style={{ margin: "0 auto 12px" }} />
          <p style={{ color: A.text }} className="font-bold text-lg">All clear!</p>
          <p style={{ color: A.dim }} className="text-sm mt-1">No reports match this filter.</p>
        </ACard>
      )}

      {/* Report cards */}
      <div className="space-y-3">
        {filtered.map(report => {
          const cat = CATEGORY_META[report.category] ?? { label: report.category, emoji: "⚠️", bg: "rgba(74,90,122,0.2)", text: A.sub };
          return (
            <ACard key={report.id} style={{ borderLeft: `3px solid ${cat.text}`, opacity: report.reviewedByAdmin ? 0.65 : 1 }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-2">
                  {/* Badges row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
                      style={{ background: cat.bg, color: cat.text }}>
                      {cat.emoji} {cat.label}
                    </span>
                    {report.autoSuspendedUser && (
                      <span className="text-[9px] font-black px-2 py-0.5 rounded-full"
                        style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>
                        AUTO-SUSPENDED
                      </span>
                    )}
                    {report.autoBlocked && (
                      <span className="text-[9px] font-black px-2 py-0.5 rounded-full"
                        style={{ background: "rgba(74,90,122,0.2)", color: A.sub }}>
                        BLOCKED
                      </span>
                    )}
                    {report.reviewedByAdmin && (
                      <span className="text-[9px] font-black px-2 py-0.5 rounded-full"
                        style={{ background: "rgba(34,197,94,0.15)", color: A.green }}>
                        REVIEWED
                      </span>
                    )}
                  </div>

                  {/* Reporter / Reported */}
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                    <div>
                      <p className="text-[9px] uppercase tracking-widest font-bold" style={{ color: A.dim }}>Reported by listener</p>
                      <p className="text-sm font-bold" style={{ color: A.text }}>{report.listenerDisplayName ?? "Unknown"}</p>
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-widest font-bold" style={{ color: A.dim }}>Reported user</p>
                      <p className="text-sm font-bold" style={{ color: A.text }}>{report.reportedUserName ?? "Unknown"}</p>
                    </div>
                  </div>

                  {report.notes && (
                    <p className="text-xs italic" style={{ color: A.sub }}>"{report.notes}"</p>
                  )}

                  <p className="text-[10px] font-mono" style={{ color: A.dim }}>
                    {fmtTime(report.createdAt)}
                    {report.sessionId && ` · Session …${report.sessionId.slice(-6)}`}
                  </p>
                </div>

                {/* Action buttons */}
                <div className="flex flex-col gap-2 shrink-0">
                  {!report.reviewedByAdmin && (
                    <button onClick={() => handleReview(report.id)}
                      className="text-[10px] font-bold px-3 py-1.5 rounded-lg whitespace-nowrap"
                      style={{ background: "rgba(34,197,94,0.15)", color: A.green }}>
                      ✓ Mark Reviewed
                    </button>
                  )}
                  {!report.autoSuspendedUser && (
                    <button onClick={() => handleSuspend(report.reportedUserId)}
                      className="text-[10px] font-bold px-3 py-1.5 rounded-lg whitespace-nowrap"
                      style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>
                      Suspend 24h
                    </button>
                  )}
                </div>
              </div>
            </ACard>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// REVENUE TAB
// ═══════════════════════════════════════════════════════════════════════════════
type RevenueData = {
  today: { sessions: number; revenueRupees: number; adminProfitRupees: number; listenerEarningsRupees: number };
  allTime: { sessions: number; revenueRupees: number; adminProfitRupees: number; listenerEarningsRupees: number; withdrawalCommissionRupees: number; totalPlatformProfitRupees: number };
};

function RevenueTab() {
  const [data, setData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const fetchData = useCallback(() => {
    setLoading(true);
    fetch(apiUrl("/api/admin/revenue"), { credentials: "include" })
      .then(r => r.json())
      .then(d => { setData(d); setLastRefresh(new Date()); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="w-8 h-8 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: A.gold, borderTopColor: "transparent" }} />
    </div>
  );
  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Refresh bar */}
      <div className="flex items-center justify-between">
        <p className="text-[11px]" style={{ color: A.dim }}>Last updated: {lastRefresh.toLocaleTimeString("en-IN")}</p>
        <button onClick={fetchData} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg" style={{ color: A.gold, background: A.goldDim }}>
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Today */}
      <div>
        <h2 className="text-xs font-black uppercase tracking-widest mb-3" style={{ color: A.sub }}>Today's Revenue</h2>
        <div className="grid grid-cols-2 gap-3">
          <ACard>
            <p className="text-[10px] font-bold uppercase mb-1" style={{ color: A.sub }}>Calls Today</p>
            <p className="text-3xl font-black" style={{ color: A.blue }}>{data.today.sessions}</p>
          </ACard>
          <ACard>
            <p className="text-[10px] font-bold uppercase mb-1" style={{ color: A.sub }}>User Revenue</p>
            <p className="text-3xl font-black" style={{ color: A.green }}>{fmtRupees(data.today.revenueRupees)}</p>
            <p className="text-[10px] mt-1" style={{ color: A.dim }}>₹6/min from users</p>
          </ACard>
          <ACard style={{ background: A.goldDim, borderColor: "rgba(245,166,35,0.3)" }}>
            <p className="text-[10px] font-bold uppercase mb-1" style={{ color: A.sub }}>Your Profit</p>
            <p className="text-3xl font-black" style={{ color: A.gold }}>{fmtRupees(data.today.adminProfitRupees)}</p>
            <p className="text-[10px] mt-1" style={{ color: A.dim }}>₹4/min platform fee</p>
          </ACard>
          <ACard>
            <p className="text-[10px] font-bold uppercase mb-1" style={{ color: A.sub }}>Listener Earnings</p>
            <p className="text-3xl font-black" style={{ color: A.purple }}>{fmtRupees(data.today.listenerEarningsRupees)}</p>
            <p className="text-[10px] mt-1" style={{ color: A.dim }}>₹2/min to listeners</p>
          </ACard>
        </div>
      </div>

      {/* All-time */}
      <div>
        <h2 className="text-xs font-black uppercase tracking-widest mb-3" style={{ color: A.sub }}>All-Time Revenue</h2>
        <div className="grid grid-cols-2 gap-3">
          <ACard>
            <p className="text-[10px] font-bold uppercase mb-1" style={{ color: A.sub }}>Total Sessions</p>
            <p className="text-3xl font-black" style={{ color: A.blue }}>{data.allTime.sessions}</p>
          </ACard>
          <ACard>
            <p className="text-[10px] font-bold uppercase mb-1" style={{ color: A.sub }}>Total Revenue</p>
            <p className="text-3xl font-black" style={{ color: A.green }}>{fmtRupees(data.allTime.revenueRupees)}</p>
          </ACard>
          <ACard>
            <p className="text-[10px] font-bold uppercase mb-1" style={{ color: A.sub }}>Session Profit (₹4/min)</p>
            <p className="text-3xl font-black" style={{ color: A.gold }}>{fmtRupees(data.allTime.adminProfitRupees)}</p>
          </ACard>
          <ACard>
            <p className="text-[10px] font-bold uppercase mb-1 flex items-center gap-1" style={{ color: A.sub }}>
              <Percent className="w-3 h-3" /> Withdrawal Commission (10%)
            </p>
            <p className="text-3xl font-black" style={{ color: A.orange }}>{fmtRupees(data.allTime.withdrawalCommissionRupees)}</p>
            <p className="text-[10px] mt-1" style={{ color: A.dim }}>Earned on listener payouts</p>
          </ACard>
        </div>
      </div>

      {/* Total profit highlight */}
      <ACard style={{ background: `linear-gradient(135deg, ${A.goldDim}, rgba(245,166,35,0.18))`, borderColor: "rgba(245,166,35,0.35)" }}>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: A.goldDim }}>
            <TrendingUp className="w-6 h-6" style={{ color: A.gold }} />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: A.sub }}>Total Platform Profit</p>
            <p className="text-4xl font-black" style={{ color: A.gold }}>{fmtRupees(data.allTime.totalPlatformProfitRupees)}</p>
            <p className="text-[10px] mt-0.5" style={{ color: A.dim }}>Session profit + withdrawal commissions</p>
          </div>
        </div>
      </ACard>

      {/* Revenue model breakdown */}
      <ACard>
        <p className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color: A.sub }}>Revenue Model (6/2/4 Rule)</p>
        <div className="space-y-2">
          {[
            { label: "User pays per minute", value: "₹6/min", color: A.blue },
            { label: "Listener earns per minute", value: "₹2/min", color: A.purple },
            { label: "Platform fee per minute", value: "₹4/min", color: A.gold },
            { label: "Withdrawal commission", value: "10% of payout", color: A.orange },
          ].map(row => (
            <div key={row.label} className="flex items-center justify-between">
              <p className="text-xs" style={{ color: A.sub }}>{row.label}</p>
              <p className="text-xs font-black" style={{ color: row.color }}>{row.value}</p>
            </div>
          ))}
        </div>
      </ACard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MISSED CALLS (CALLBACK REQUESTS) TAB
// ═══════════════════════════════════════════════════════════════════════════════
type AdminCallbackRequest = {
  id: string;
  userAnonymousName: string;
  listenerId: string | null;
  listenerDisplayName: string | null;
  status: string;
  note: string | null;
  respondedByListenerId: string | null;
  createdAt: string;
  respondedAt: string | null;
};

function CallbacksTab() {
  const [requests, setRequests] = useState<AdminCallbackRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "accepted" | "done" | "dismissed">("all");

  const fetchAll = useCallback(() => {
    setLoading(true);
    fetch(apiUrl("/api/admin/callback-requests"), { credentials: "include" })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setRequests(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleDismiss = async (id: string) => {
    setActing(id);
    try {
      const res = await fetch(apiUrl(`/api/admin/callback-requests/${id}/dismiss`), { method: "POST", credentials: "include" });
      if (res.ok) { toast.success("Dismissed"); fetchAll(); }
      else toast.error("Failed to dismiss");
    } catch { toast.error("Network error"); } finally { setActing(null); }
  };

  const filtered = filter === "all" ? requests : requests.filter(r => r.status === filter);

  const counts = {
    all: requests.length,
    pending: requests.filter(r => r.status === "pending").length,
    accepted: requests.filter(r => r.status === "accepted").length,
    done: requests.filter(r => r.status === "done").length,
    dismissed: requests.filter(r => r.status === "dismissed").length,
  };

  const statusColors: Record<string, string> = {
    pending: A.orange,
    accepted: A.blue,
    done: A.green,
    dismissed: A.dim,
  };

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="w-8 h-8 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: A.purple, borderTopColor: "transparent" }} />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3">
        <ACard style={{ background: A.goldDim }}>
          <p className="text-[10px] font-bold uppercase" style={{ color: A.sub }}>Total Requests</p>
          <p className="text-3xl font-black" style={{ color: A.gold }}>{requests.length}</p>
        </ACard>
        <ACard>
          <p className="text-[10px] font-bold uppercase" style={{ color: A.sub }}>Pending</p>
          <p className="text-3xl font-black" style={{ color: A.orange }}>{counts.pending}</p>
        </ACard>
        <ACard>
          <p className="text-[10px] font-bold uppercase" style={{ color: A.sub }}>Accepted / Called</p>
          <p className="text-3xl font-black" style={{ color: A.blue }}>{counts.accepted + counts.done}</p>
        </ACard>
        <ACard>
          <p className="text-[10px] font-bold uppercase" style={{ color: A.sub }}>Done</p>
          <p className="text-3xl font-black" style={{ color: A.green }}>{counts.done}</p>
        </ACard>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {(["all", "pending", "accepted", "done", "dismissed"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors"
            style={filter === f
              ? { background: A.purple, color: "#fff", borderColor: A.purple }
              : { background: "transparent", color: A.sub, borderColor: A.border }}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
          </button>
        ))}
        <button onClick={fetchAll} className="shrink-0 ml-auto flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg" style={{ color: A.gold, background: A.goldDim, border: `1px solid ${A.border}` }}>
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {/* Request list */}
      {filtered.length === 0 ? (
        <ACard>
          <div className="text-center py-8">
            <PhoneMissed className="w-10 h-10 mx-auto mb-3" style={{ color: A.dim }} />
            <p className="text-sm" style={{ color: A.sub }}>No {filter === "all" ? "" : filter} callback requests.</p>
          </div>
        </ACard>
      ) : (
        <div className="space-y-3">
          {filtered.map(r => (
            <ACard key={r.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(168,85,247,0.15)" }}>
                    <PhoneMissed className="w-4 h-4" style={{ color: A.purple }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-sm" style={{ color: A.text }}>{r.userAnonymousName}</p>
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-full uppercase"
                        style={{ background: `${statusColors[r.status]}22`, color: statusColors[r.status] }}>
                        {r.status}
                      </span>
                    </div>
                    {r.note && <p className="text-xs mt-0.5 italic" style={{ color: A.sub }}>"{r.note}"</p>}
                    {r.listenerDisplayName && (
                      <p className="text-[10px] mt-0.5" style={{ color: A.blue }}>
                        <PhoneCall className="w-3 h-3 inline mr-0.5" /> For: {r.listenerDisplayName}
                      </p>
                    )}
                    <p className="text-[10px] mt-1" style={{ color: A.dim }}>{fmtTime(r.createdAt)}</p>
                    {r.respondedAt && (
                      <p className="text-[10px]" style={{ color: A.green }}>Responded: {fmtTime(r.respondedAt)}</p>
                    )}
                  </div>
                </div>
                {r.status === "pending" && (
                  <button
                    onClick={() => handleDismiss(r.id)}
                    disabled={acting === r.id}
                    className="shrink-0 text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition-colors"
                    style={{ background: "rgba(239,68,68,0.12)", color: A.red }}
                  >
                    Dismiss
                  </button>
                )}
              </div>
            </ACard>
          ))}
        </div>
      )}
    </div>
  );
}
