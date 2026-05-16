import { useGetDashboardSummary, useGetMyProfile } from "@workspace/api-client-react";
import { apiUrl } from "@/lib/apiBase";
import { PageTransition } from "@/components/PageTransition";
import {
  TrendingUp, Star, Clock, IndianRupee, MessageCircle,
  Phone, Users, BarChart3, Wallet, ArrowDownToLine, CheckCircle2,
  XCircle, AlertCircle, Info, PhoneMissed, PhoneCall, PhoneOff, RefreshCw, Video,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { GradientButton } from "@/components/GradientButton";
import firebaseApp from "@/lib/firebase";
import { getDatabase, ref, onValue } from "firebase/database";

type ListenerProfile = {
  displayName: string;
  photoUrl: string;
  applicationStatus: string;
};

const MIN_WITHDRAWAL = 200;
const MAX_WITHDRAWAL = 2000;

type WithdrawalRequest = {
  id: string;
  amountRupees: number;
  upiId: string;
  status: "pending" | "paid" | "rejected";
  adminNote: string | null;
  decidedAt: string | null;
  createdAt: string;
};

type CallbackRequest = {
  id: string;
  userAnonymousName: string;
  note: string | null;
  listenerId: string | null;
  listenerDisplayName: string | null;
  status: string;
  createdAt: string;
};

function StatCard({ icon: Icon, label, value, sub, gradient }: { icon: React.ElementType; label: string; value: string; sub?: string; gradient: string }) {
  return (
    <div className="glass-card rounded-2xl p-5 flex flex-col gap-2">
      <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center mb-1", gradient)}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      <p className="text-3xl font-black tracking-tight">{value}</p>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      {sub && <p className="text-xs text-primary font-semibold">{sub}</p>}
    </div>
  );
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex-1 flex flex-col items-center gap-1">
      <div className="w-full flex flex-col-reverse rounded-full overflow-hidden bg-muted h-20">
        <div className={cn("rounded-full transition-all duration-700", color)} style={{ height: `${pct}%` }} />
      </div>
      <span className="text-[9px] text-muted-foreground font-medium">{value}</span>
    </div>
  );
}

// Status badge for withdrawal
function WithdrawalStatusBadge({ status }: { status: string }) {
  if (status === "pending") return (
    <span className="text-[9px] font-black px-2 py-1 rounded-full uppercase bg-orange-500/15 text-orange-600">Pending</span>
  );
  if (status === "paid") return (
    <span className="text-[9px] font-black px-2 py-1 rounded-full uppercase bg-green-500/15 text-green-600">Paid</span>
  );
  return (
    <span className="text-[9px] font-black px-2 py-1 rounded-full uppercase bg-red-500/15 text-red-500">Rejected</span>
  );
}

export default function Earnings() {
  const { data: profile } = useGetMyProfile();
  const { data: summary, isLoading } = useGetDashboardSummary();

  const [listenerProfile, setListenerProfile] = useState<ListenerProfile | null>(null);
  const [earningsData, setEarningsData] = useState<{ earningsBalanceRupees: number; totalEarningsRupees: number } | null>(null);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [showWithdrawForm, setShowWithdrawForm] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawUpi, setWithdrawUpi] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [callbackRequests, setCallbackRequests] = useState<CallbackRequest[]>([]);
  const [actingCbId, setActingCbId] = useState<string | null>(null);

  const fetchEarnings = () => {
    fetch(apiUrl("/api/listener/earnings"), { credentials: "include" })
      .then(r => r.json())
      .then(d => { if (d.earningsBalanceRupees !== undefined) setEarningsData(d); })
      .catch(() => {});
  };

  const fetchWithdrawals = () => {
    fetch(apiUrl("/api/listener/withdrawals"), { credentials: "include" })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setWithdrawals(d); })
      .catch(() => {});
  };

  const fetchCallbacks = () => {
    fetch(apiUrl("/api/listener/callback-requests"), { credentials: "include" })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setCallbackRequests(d); })
      .catch(() => {});
  };

  useEffect(() => {
    if (profile?.role !== "listener") return;
    // Fetch listener's own display profile (name + photo)
    fetch(apiUrl("/api/listener/me"), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then((d: ListenerProfile | null) => { if (d?.displayName) setListenerProfile(d); })
      .catch(() => {});
    fetchEarnings();
    fetchWithdrawals();
    fetchCallbacks();
    // Slow poll as fallback (only used if Firebase RTDB push is offline).
    const t = setInterval(() => { fetchEarnings(); fetchWithdrawals(); fetchCallbacks(); }, 30_000);
    return () => clearInterval(t);
  }, [profile?.role]);

  // ── Real-time earnings via Firebase Realtime Database ─────────────────────
  // Server pushes to listeners/{userId}/earnings after EVERY billed minute
  // (including welcome-bonus minutes). Dashboard updates instantly with no refresh.
  useEffect(() => {
    if (profile?.role !== "listener" || !profile?.id) return;
    try {
      const db = getDatabase(firebaseApp);
      const earningsRef = ref(db, `listeners/${profile.id}/earnings`);
      // onValue returns an unsubscribe function — call it directly on cleanup.
      const unsubscribe = onValue(earningsRef, (snap) => {
        const v = snap.val();
        if (!v) return;
        const balRupees =
          typeof v.earningsBalanceRupees === "number"
            ? v.earningsBalanceRupees
            : (Number(v.earningsBalancePaise) || 0) / 100;
        const totalRupees =
          typeof v.totalEarningsRupees === "number"
            ? v.totalEarningsRupees
            : (Number(v.totalEarningsPaise) || 0) / 100;
        setEarningsData({ earningsBalanceRupees: balRupees, totalEarningsRupees: totalRupees });
        // Subtle toast when a fresh credit lands
        const credit = Number(v.lastCreditRupees) || 0;
        const updatedAt = Number(v.updatedAt) || 0;
        if (credit > 0 && Date.now() - updatedAt < 10_000) {
          toast.success(`+ ₹${credit.toFixed(2)} earned 🎉`, { duration: 2200 });
        }
      });
      return () => { unsubscribe(); };
    } catch {
      // Firebase RTDB unavailable — polling above still keeps the UI fresh.
      return;
    }
  }, [profile?.role, profile?.id]);

  const handleCallback = async (id: string, action: "accept" | "done" | "dismiss") => {
    setActingCbId(id);
    try {
      const res = await fetch(apiUrl(`/api/listener/callback-requests/${id}/${action}`), {
        method: "POST", credentials: "include",
      });
      if (!res.ok) { toast.error("Action failed"); return; }
      toast.success(
        action === "accept" ? "Accepted! The user will be notified." :
        action === "done"   ? "Marked as called — great work!" :
        "Request dismissed."
      );
      fetchCallbacks();
    } catch { toast.error("Network error"); } finally { setActingCbId(null); }
  };

  const handleWithdraw = async () => {
    const amount = Number(withdrawAmount);
    if (!amount || amount < MIN_WITHDRAWAL) {
      toast.error(`Minimum withdrawal is ₹${MIN_WITHDRAWAL}`);
      return;
    }
    if (amount > MAX_WITHDRAWAL) {
      toast.error(`Maximum withdrawal per request is ₹${MAX_WITHDRAWAL}`);
      return;
    }
    const balance = earningsData?.earningsBalanceRupees ?? 0;
    if (amount > balance) {
      toast.error(`Insufficient balance. Available: ₹${balance.toFixed(2)}`);
      return;
    }
    if (!withdrawUpi.trim() || !withdrawUpi.includes("@")) {
      toast.error("Please enter a valid UPI ID (e.g. name@upi)");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(apiUrl("/api/listener/withdrawal"), {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountRupees: amount, upiId: withdrawUpi.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Withdrawal failed"); return; }
      toast.success(`Payout request of ₹${amount} submitted! Admin will review within 24 hours.`);
      setShowWithdrawForm(false);
      setWithdrawAmount("");
      setWithdrawUpi("");
      fetchEarnings();
      fetchWithdrawals();
    } catch {
      toast.error("Network error, please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (profile?.role !== "listener") {
    return (
      <PageTransition className="flex-1 flex items-center justify-center p-6 text-center pb-24">
        <div>
          <BarChart3 className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="font-semibold text-lg mb-1">Listener-only page</p>
          <p className="text-sm text-muted-foreground">Switch to a listener account to see earnings.</p>
        </div>
      </PageTransition>
    );
  }

  if (isLoading) {
    return (
      <PageTransition className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      </PageTransition>
    );
  }

  const sessions = summary?.totalSessions ?? 0;
  const rating = summary?.averageRating ?? 0;
  const active = summary?.activeSessions ?? 0;
  const recent = summary?.recentSessions ?? [];
  const balanceRupees = earningsData?.earningsBalanceRupees ?? 0;
  const totalRupees = earningsData?.totalEarningsRupees ?? 0;

  const chartData = recent.slice(0, 7).map((s) => ({ minutes: s.billedMinutes ?? 0, cost: s.totalCostInRupees ?? 0, kind: s.kind }));
  const maxMinutes = Math.max(...chartData.map((d) => d.minutes), 1);
  const recentBilledMinutes = recent.reduce((sum, s) => sum + (s.billedMinutes ?? 0), 0);

  // Determine the max the listener can withdraw this request
  const maxThisRequest = Math.min(Math.floor(balanceRupees), MAX_WITHDRAWAL);
  const canWithdraw = balanceRupees >= MIN_WITHDRAWAL;
  const hasPendingWithdrawal = withdrawals.some(w => w.status === "pending");

  return (
    <PageTransition className="flex-1 flex flex-col pb-24">
      {/* Header — listener identity */}
      <div className="px-4 pt-4 pb-3 flex items-center gap-3">
        {listenerProfile?.photoUrl ? (
          <img
            src={listenerProfile.photoUrl}
            alt={listenerProfile.displayName}
            className="w-12 h-12 rounded-2xl object-cover shadow-md border-2 border-primary/20"
          />
        ) : (
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-pink-500 to-orange-400 flex items-center justify-center shrink-0">
            <TrendingUp className="w-6 h-6 text-white" />
          </div>
        )}
        <div>
          <h1 className="text-xl font-bold leading-tight">
            {listenerProfile?.displayName ?? "My Earnings"}
          </h1>
          <p className="text-xs text-muted-foreground">Listener dashboard</p>
        </div>
      </div>

      <div className="px-4 space-y-5">

        {/* ── Missed Call Requests ─────────────────────────────────────────── */}
        {callbackRequests.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold flex items-center gap-2">
                <PhoneMissed className="w-4 h-4 text-purple-500" />
                Missed Call Requests
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-purple-500 text-white text-[10px] font-black">
                  {callbackRequests.length}
                </span>
              </h2>
              <button onClick={fetchCallbacks} className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> Refresh
              </button>
            </div>
            <div className="space-y-2">
              {callbackRequests.map(cb => (
                <div key={cb.id} className="glass-card rounded-2xl border border-purple-500/20 overflow-hidden">
                  <div className="flex items-start gap-3 px-4 py-3">
                    <div className="w-9 h-9 rounded-full bg-purple-500/15 flex items-center justify-center shrink-0 mt-0.5">
                      <PhoneMissed className="w-4 h-4 text-purple-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold">{cb.userAnonymousName}</p>
                      {cb.note && <p className="text-xs text-muted-foreground mt-0.5 italic">"{cb.note}"</p>}
                      <p className="text-[10px] text-muted-foreground mt-1">{formatRelativeTime(cb.createdAt)}</p>
                    </div>
                  </div>
                  <div className="flex border-t border-border/30">
                    <button
                      onClick={() => handleCallback(cb.id, "accept")}
                      disabled={actingCbId === cb.id}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold text-green-600 hover:bg-green-500/10 transition-colors border-r border-border/30"
                    >
                      <PhoneCall className="w-3.5 h-3.5" /> Accept
                    </button>
                    <button
                      onClick={() => handleCallback(cb.id, "done")}
                      disabled={actingCbId === cb.id}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold text-blue-600 hover:bg-blue-500/10 transition-colors border-r border-border/30"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Called
                    </button>
                    <button
                      onClick={() => handleCallback(cb.id, "dismiss")}
                      disabled={actingCbId === cb.id}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold text-muted-foreground hover:bg-muted/50 transition-colors"
                    >
                      <PhoneOff className="w-3.5 h-3.5" /> Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      {/* ── Earnings balance card ────────────────────────────────────────── */}
        <div className="rounded-3xl bg-gradient-to-br from-pink-500 via-fuchsia-500 to-orange-400 p-6 text-white shadow-lg shadow-pink-500/20">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-sm font-semibold text-white/80 mb-1 tracking-wide">Available to Withdraw</p>
              <p className="text-5xl font-black tracking-tight">₹{balanceRupees.toFixed(2)}</p>
            </div>
            <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center">
              <Wallet className="w-7 h-7 text-white" />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-white/80">
              <IndianRupee className="w-4 h-4" />
              <span>Total earned: ₹{totalRupees.toFixed(2)}</span>
            </div>
            <button
              onClick={() => {
                if (hasPendingWithdrawal) { toast.error("You already have a pending payout request."); return; }
                if (!canWithdraw) { toast.error(`Minimum balance required: ₹${MIN_WITHDRAWAL}`); return; }
                setShowWithdrawForm(v => !v);
              }}
              className={cn(
                "flex items-center gap-1.5 font-bold text-xs px-3 py-1.5 rounded-full transition-colors",
                canWithdraw && !hasPendingWithdrawal ? "bg-white text-pink-600 hover:bg-white/90" : "bg-white/30 text-white/60 cursor-not-allowed"
              )}>
              <ArrowDownToLine className="w-3.5 h-3.5" />
              {hasPendingWithdrawal ? "Payout Pending" : canWithdraw ? "Request Payout" : `Need ₹${MIN_WITHDRAWAL} min`}
            </button>
          </div>
        </div>

        {/* ── Pending payout notice ─────────────────────────────────────────── */}
        {hasPendingWithdrawal && (
          <div className="glass-card rounded-2xl px-4 py-3 flex items-start gap-3 border border-orange-400/20 bg-orange-50/30">
            <AlertCircle className="w-4 h-4 text-orange-500 mt-0.5 shrink-0" />
            <p className="text-xs text-orange-700 leading-relaxed">
              You have a <strong>pending payout request</strong>. You can submit another once it's processed by admin (within 24 hours).
            </p>
          </div>
        )}

        {/* ── Payout limits info ───────────────────────────────────────────── */}
        <div className="glass-card rounded-2xl px-4 py-3 flex items-start gap-3">
          <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Payout limits: <strong className="text-foreground">Min ₹{MIN_WITHDRAWAL}</strong> · <strong className="text-foreground">Max ₹{MAX_WITHDRAWAL}</strong> per request. Funds reach your account within 24 hours of admin approval.
          </p>
        </div>

        {/* ── Earnings split ───────────────────────────────────────────────── */}
        <div className="glass-card rounded-2xl px-4 py-3.5">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">Your Earnings Rate</p>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-pink-500" />
                <span className="font-medium">Audio Call</span>
              </div>
              <span className="font-bold text-primary">₹2 / min</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Video className="w-4 h-4 text-violet-500" />
                <span className="font-medium">Video Call</span>
              </div>
              <span className="font-bold text-primary">₹5 / min</span>
            </div>
          </div>
        </div>

        {/* ── Withdraw form ────────────────────────────────────────────────── */}
        {showWithdrawForm && (
          <div className="glass-card rounded-2xl p-4 space-y-3 border border-primary/20">
            <p className="font-bold text-sm">Request Payout</p>

            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">
                Amount (₹{MIN_WITHDRAWAL}–₹{MAX_WITHDRAWAL})
              </label>
              <input
                type="number"
                value={withdrawAmount}
                onChange={e => setWithdrawAmount(String(Math.floor(Number(e.target.value))))}
                placeholder={`e.g. ${maxThisRequest}`}
                max={maxThisRequest}
                min={MIN_WITHDRAWAL}
                step={1}
                className="w-full rounded-xl border border-border/50 bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <div className="flex justify-between text-[10px] mt-1 text-muted-foreground px-1">
                <span>Min: ₹{MIN_WITHDRAWAL}</span>
                <span>Max this request: ₹{maxThisRequest}</span>
              </div>
              {/* Quick-fill buttons */}
              {maxThisRequest >= MIN_WITHDRAWAL && (
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {[
                    { label: `₹${MIN_WITHDRAWAL}`, val: MIN_WITHDRAWAL },
                    ...(maxThisRequest >= 500 ? [{ label: "₹500", val: 500 }] : []),
                    ...(maxThisRequest >= 1000 ? [{ label: "₹1000", val: 1000 }] : []),
                    { label: `Max ₹${maxThisRequest}`, val: maxThisRequest },
                  ].filter((item, idx, arr) => arr.findIndex(x => x.val === item.val) === idx).map(btn => (
                    <button
                      key={btn.val}
                      type="button"
                      onClick={() => setWithdrawAmount(String(btn.val))}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors",
                        String(btn.val) === withdrawAmount
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/50 text-muted-foreground hover:border-primary/40 hover:text-primary"
                      )}>
                      {btn.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Your UPI ID</label>
              <input
                type="text"
                value={withdrawUpi}
                onChange={e => setWithdrawUpi(e.target.value)}
                placeholder="yourname@upi"
                className="w-full rounded-xl border border-border/50 bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            <p className="text-xs text-muted-foreground bg-muted/30 rounded-xl px-3 py-2.5 leading-relaxed">
              Your balance will be deducted immediately. Admin reviews within <strong>24 hours</strong> — you'll see the status update here once approved.
            </p>

            <div className="flex gap-2">
              <GradientButton onClick={handleWithdraw} isLoading={submitting} className="flex-1 py-3">
                Submit Request
              </GradientButton>
              <button onClick={() => { setShowWithdrawForm(false); setWithdrawAmount(""); setWithdrawUpi(""); }}
                className="px-4 py-3 rounded-xl border border-border/50 text-sm font-medium hover:bg-muted/50 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Stat cards ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <StatCard icon={Users} label="Total Sessions" value={String(sessions)} sub={active > 0 ? `${active} active now` : undefined} gradient="bg-gradient-to-br from-blue-500 to-cyan-400" />
          <StatCard icon={Star} label="Avg Rating" value={rating > 0 ? rating.toFixed(1) : "—"} sub={rating > 0 ? "from reviews" : "no reviews yet"} gradient="bg-gradient-to-br from-yellow-400 to-orange-400" />
          <StatCard icon={Clock} label="Recent Mins" value={`${recentBilledMinutes}m`} sub="last 5 sessions" gradient="bg-gradient-to-br from-violet-500 to-pink-500" />
          <StatCard icon={IndianRupee} label="Total Earned" value={`₹${totalRupees.toFixed(0)}`} sub="lifetime" gradient="bg-gradient-to-br from-emerald-500 to-teal-400" />
        </div>

        {/* ── Mini bar chart ───────────────────────────────────────────────── */}
        {chartData.length > 0 && (
          <div>
            <h2 className="text-sm font-bold mb-3">Recent Sessions (minutes)</h2>
            <div className="glass-card rounded-2xl p-4">
              <div className="flex items-end gap-2 h-24">
                {chartData.map((d, i) => (
                  <MiniBar key={i} value={d.minutes} max={maxMinutes} color={d.kind === "call" ? "bg-gradient-to-t from-pink-500 to-orange-400" : "bg-gradient-to-t from-blue-500 to-cyan-400"} />
                ))}
              </div>
              <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border/40">
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-gradient-to-br from-pink-500 to-orange-400" /><span className="text-xs text-muted-foreground">Call</span></div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-gradient-to-br from-blue-500 to-cyan-400" /><span className="text-xs text-muted-foreground">Chat</span></div>
              </div>
            </div>
          </div>
        )}

        {/* ── Withdrawal history ───────────────────────────────────────────── */}
        {withdrawals.length > 0 && (
          <div>
            <h2 className="text-sm font-bold mb-3">Payout Requests</h2>
            <div className="space-y-2">
              {withdrawals.map(w => (
                <div key={w.id} className={cn("glass-card rounded-xl border overflow-hidden", {
                  "border-orange-500/20": w.status === "pending",
                  "border-green-500/20": w.status === "paid",
                  "border-red-500/20": w.status === "rejected",
                })}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0", {
                      "bg-orange-500/15": w.status === "pending",
                      "bg-green-500/15": w.status === "paid",
                      "bg-red-500/15": w.status === "rejected",
                    })}>
                      {w.status === "pending" ? <AlertCircle className="w-4 h-4 text-orange-500" /> :
                       w.status === "paid" ? <CheckCircle2 className="w-4 h-4 text-green-500" /> :
                       <XCircle className="w-4 h-4 text-red-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">₹{w.amountRupees.toFixed(2)} → {w.upiId}</p>
                      <p className="text-xs text-muted-foreground">{formatRelativeTime(w.createdAt)}</p>
                    </div>
                    <WithdrawalStatusBadge status={w.status} />
                  </div>

                  {/* Status message */}
                  {w.status === "pending" && (
                    <div className="px-4 py-2.5 bg-orange-500/5 border-t border-orange-500/10">
                      <p className="text-xs text-orange-600 font-medium flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" /> Under review — funds will be sent within 24 hours of approval.
                      </p>
                    </div>
                  )}
                  {w.status === "paid" && (
                    <div className="px-4 py-2.5 bg-green-500/5 border-t border-green-500/10">
                      <p className="text-xs text-green-600 font-medium flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Approved — funds will reach your account within 24 hours.
                      </p>
                    </div>
                  )}
                  {w.status === "rejected" && (
                    <div className="px-4 py-2.5 bg-red-500/5 border-t border-red-500/10">
                      <p className="text-xs text-red-500 font-medium flex items-center gap-1.5">
                        <XCircle className="w-3.5 h-3.5" /> {w.adminNote ? `Rejected: ${w.adminNote}` : "Rejected — balance refunded."}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Recent sessions ──────────────────────────────────────────────── */}
        <div>
          <h2 className="text-sm font-bold mb-3">Recent Activity</h2>
          {recent.length === 0 ? (
            <div className="glass-card rounded-2xl p-6 text-center">
              <Phone className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No sessions yet.</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Go online to start receiving calls and chats.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recent.map((s) => (
                <div key={s.id} className="flex items-center gap-3 glass-card rounded-xl px-4 py-3">
                  <div className={cn("w-9 h-9 rounded-full flex items-center justify-center shrink-0", s.kind === "call" ? "bg-pink-500/15" : "bg-blue-500/15")}>
                    {s.kind === "call" ? <Phone className="w-4 h-4 text-pink-500" /> : <MessageCircle className="w-4 h-4 text-blue-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{s.userName ?? "Anonymous"}</p>
                    <p className="text-xs text-muted-foreground">{s.billedMinutes}m · {formatRelativeTime(s.startedAt)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-primary">
                      {s.kind === "call" ? `₹${(s.billedMinutes * 2).toFixed(0)}` : `₹${(s.billedMinutes * 1.5).toFixed(1)}`}
                    </p>
                    <p className={cn("text-[10px] font-medium", s.status === "active" ? "text-green-500" : "text-muted-foreground")}>
                      {s.status === "active" ? "live" : "ended"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
