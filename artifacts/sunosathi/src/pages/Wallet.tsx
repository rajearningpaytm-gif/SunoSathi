import { useGetWallet } from "@workspace/api-client-react";
import { apiUrl, API_ORIGIN } from "@/lib/apiBase";
import { PageTransition } from "@/components/PageTransition";
import { formatRupees, formatRelativeTime } from "@/lib/format";
import { GradientButton } from "@/components/GradientButton";
import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import {
  Wallet as WalletIcon, ArrowUpRight, ArrowDownLeft,
  RefreshCcw, HandCoins, CheckCircle2, XCircle,
  Clock, ShieldCheck, CreditCard, Zap, ExternalLink, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { getGetWalletQueryKey } from "@workspace/api-client-react";

const AMOUNTS = [25, 50, 100, 200, 1000];
const MIN_RECHARGE = 25;

// APK = VITE_API_ORIGIN is set at build time (Capacitor builds inject this).
// On web the env var is empty so it falls back to relative URLs.
const IS_APK = !!API_ORIGIN;

// Polling config
const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_MS = 5 * 60 * 1000; // 5 minutes max polling

type PayStep = "select" | "awaiting" | "done";

type RechargeRequest = {
  id: string;
  amountInRupees: number;
  utrNumber: string;
  status: "pending" | "approved" | "rejected";
  adminNote: string | null;
  createdAt: string;
};

export default function Wallet() {
  const { data: wallet, isLoading } = useGetWallet();
  const queryClient = useQueryClient();

  const [payStep, setPayStep] = useState<PayStep>("select");
  const [amount, setAmount]   = useState<number>(25);
  const [submitting, setSubmitting] = useState(false);
  const [requests, setRequests]     = useState<RechargeRequest[]>([]);
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [pollStatus, setPollStatus] = useState<string>("");

  // Refs to manage polling lifecycle without stale closures
  const pollTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartRef   = useRef<number>(0);
  const redirectVerifiedRef = useRef(false);

  const fetchRequests = () => {
    fetch(apiUrl("/api/wallet/recharge-requests"), { credentials: "include" })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setRequests(d as RechargeRequest[]); })
      .catch(() => {});
  };
  useEffect(() => { fetchRequests(); }, []);

  // ── Credit wallet once Cashfree confirms PAID ────────────────────────────────
  const creditWallet = useCallback(async (orderId: string) => {
    try {
      const res = await fetch(apiUrl("/api/wallet/cashfree/verify"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, amountInRupees: 0 }),
      });
      if (res.ok) {
        const data = await res.json() as { success: boolean; alreadyCredited?: boolean };
        setPayStep("done");
        queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
        fetchRequests();
        if (data.alreadyCredited) {
          toast.success("Wallet pehle se credited hai!");
        } else {
          toast.success("Wallet recharge successful!");
        }
      } else {
        const err = await res.json().catch(() => ({})) as { error?: string };
        toast.info(err.error ?? "Payment mila. Wallet jald update hoga.");
        setPayStep("select");
      }
    } catch {
      toast.info("Payment mila. Wallet jald update hoga.");
      setPayStep("select");
    } finally {
      setSubmitting(false);
    }
  }, [queryClient]);

  // ── Stop polling helper ───────────────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // ── Start polling Cashfree order status (APK mode) ───────────────────────────
  const startPolling = useCallback((orderId: string) => {
    stopPolling();
    pollStartRef.current = Date.now();
    setPollStatus("Checking payment…");

    pollTimerRef.current = setInterval(async () => {
      // Timeout check
      if (Date.now() - pollStartRef.current > POLL_MAX_MS) {
        stopPolling();
        setPollStatus("Time out. Click below to check manually.");
        setSubmitting(false);
        return;
      }

      try {
        const res = await fetch(apiUrl(`/api/wallet/cashfree/order-status/${orderId}`), {
          credentials: "include",
        });
        if (!res.ok) return; // Network blip — keep polling

        const data = await res.json() as { status?: string };
        if (data.status === "PAID") {
          stopPolling();
          setPollStatus("Payment confirmed!");
          await creditWallet(orderId);
        } else if (data.status === "EXPIRED" || data.status === "CANCELLED") {
          stopPolling();
          setPollStatus("Payment cancelled ya expired.");
          setSubmitting(false);
          setPayStep("select");
          toast.error("Payment cancel ho gaya. Dobara try karo.");
        } else {
          setPollStatus("Payment wait kar raha hoon…");
        }
      } catch {
        // Network error — keep polling silently
      }
    }, POLL_INTERVAL_MS);
  }, [stopPolling, creditWallet]);

  // Cleanup polling on unmount
  useEffect(() => () => stopPolling(), [stopPolling]);

  // ── Handle Cashfree redirect return (web only) ───────────────────────────────
  useEffect(() => {
    if (IS_APK) return; // APK uses polling, not redirect
    if (redirectVerifiedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get("cf_order_id") ?? sessionStorage.getItem("cf_pending_order_id");
    if (!orderId) return;
    redirectVerifiedRef.current = true;
    sessionStorage.removeItem("cf_pending_order_id");
    window.history.replaceState({}, "", window.location.pathname);

    setSubmitting(true);
    toast.loading("Payment verify ho raha hai…", { id: "cf-verify" });

    fetch(apiUrl("/api/wallet/cashfree/verify"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, amountInRupees: 0 }),
    })
      .then(async (res) => {
        toast.dismiss("cf-verify");
        if (res.ok) {
          const data = await res.json() as { success: boolean; alreadyCredited?: boolean };
          setPayStep("done");
          queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
          fetchRequests();
          toast.success(data.alreadyCredited ? "Wallet pehle se credited!" : "Wallet recharge successful!");
        } else {
          const err = await res.json().catch(() => ({})) as { error?: string };
          toast.info(err.error ?? "Payment mila. Wallet jald update hoga.");
        }
      })
      .catch(() => {
        toast.dismiss("cf-verify");
        toast.info("Payment mila. Wallet jald update hoga.");
      })
      .finally(() => setSubmitting(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Main payment handler ──────────────────────────────────────────────────────
  const handleCashfree = async () => {
    const amt = amount;
    if (!amt || amt < MIN_RECHARGE) { toast.error(`Minimum recharge ₹${MIN_RECHARGE} hai`); return; }
    setSubmitting(true);

    try {
      // Step 1: Create order on backend
      const orderRes = await fetch(apiUrl("/api/wallet/cashfree/order"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountInRupees: amt }),
      });

      if (!orderRes.ok) {
        const err = await orderRes.json().catch(() => ({})) as { error?: string };
        toast.error(err.error ?? "Order create nahi hua. Dobara try karo.");
        setSubmitting(false);
        return;
      }

      const { orderId, paymentSessionId, paymentLink, env } =
        await orderRes.json() as {
          orderId: string;
          paymentSessionId: string;
          paymentLink: string | null;
          env: string;
        };

      // ── APK MODE: open in system browser + poll ──────────────────────────────
      if (IS_APK) {
        // Build the Cashfree hosted checkout URL from the session ID
        const cfBase = env === "production"
          ? "https://payments.cashfree.com/order/#"
          : "https://payments-test.cashfree.com/order/#";
        const checkoutUrl = paymentLink ?? `${cfBase}${paymentSessionId}`;

        setPendingOrderId(orderId);
        sessionStorage.setItem("cf_pending_order_id", orderId);
        setPayStep("awaiting");

        // Open Cashfree checkout in system browser (bypasses localhost restriction)
        window.open(checkoutUrl, "_system");

        // Start polling for payment confirmation
        startPolling(orderId);
        return; // setSubmitting stays true — will be cleared by creditWallet/timeout
      }

      // ── WEB MODE: use Cashfree JS SDK (works on sunosathi.replit.app domain) ──
      sessionStorage.setItem("cf_pending_order_id", orderId);
      const { load } = await import("@cashfreepayments/cashfree-js");
      const cashfree = await load({ mode: env === "production" ? "production" : "sandbox" });
      await cashfree.checkout({ paymentSessionId, redirectTarget: "_self" });
      // Page will redirect — setSubmitting not called

    } catch (e) {
      const msg = e instanceof Error ? e.message : "Payment fail ho gaya. Dobara try karo.";
      toast.error(msg);
      setSubmitting(false);
    }
  };

  // ── Manual "I've paid" trigger ────────────────────────────────────────────────
  const handleManualCheck = async () => {
    if (!pendingOrderId) return;
    setSubmitting(true);
    setPollStatus("Checking payment…");
    stopPolling();
    await creditWallet(pendingOrderId);
  };

  const resetFlow = () => {
    stopPolling();
    setPayStep("select");
    setAmount(25);
    setPendingOrderId(null);
    setPollStatus("");
    setSubmitting(false);
    sessionStorage.removeItem("cf_pending_order_id");
  };

  if (isLoading) return (
    <div className="flex-1 flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
    </div>
  );
  if (!wallet) return null;

  return (
    <PageTransition className="flex-1 flex flex-col px-4 pb-24 pt-4 max-w-md mx-auto w-full">

      {/* ── Balance Card ───────────────────────────────────────────────────────── */}
      <div className="glass-card rounded-3xl p-7 mb-6 text-center relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-40 h-40 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-12 -left-12 w-40 h-40 bg-secondary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10">
          <div className="w-14 h-14 mx-auto rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mb-4 shadow-inner">
            <WalletIcon className="w-7 h-7 text-primary" />
          </div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-1">Available Balance</p>
          <h2 className="text-5xl font-black gradient-text mb-3">{formatRupees(wallet.balanceInRupees)}</h2>
          <div className="flex items-center justify-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-green-500" />
            <p className="text-xs text-green-600 dark:text-green-400 font-medium">Secured by Cashfree · Real-time balance</p>
          </div>
        </div>
      </div>

      {/* ── Add Money Card ─────────────────────────────────────────────────────── */}
      <div className="glass-card rounded-3xl p-5 mb-5">
        <h3 className="font-bold text-sm mb-4 flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" /> Add Money to Wallet
        </h3>

        {/* ── SELECT step ─────────────────────────────────────────────────────── */}
        {payStep === "select" && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2.5">
              {AMOUNTS.map(a => (
                <button
                  key={a}
                  onClick={() => setAmount(a)}
                  className={cn(
                    "py-3.5 rounded-2xl font-bold text-sm border-2 transition-all",
                    amount === a
                      ? "bg-primary/10 border-primary text-primary shadow-sm scale-[1.03]"
                      : "border-border/40 text-foreground hover:border-primary/30 hover:bg-primary/5"
                  )}
                >
                  ₹{a}
                </button>
              ))}
            </div>

            <GradientButton
              onClick={handleCashfree}
              isLoading={submitting}
              disabled={submitting || amount < MIN_RECHARGE}
              className="w-full py-4 rounded-2xl text-base font-bold"
            >
              <CreditCard className="w-4 h-4 mr-2 inline" />
              Recharge ₹{amount}
            </GradientButton>

            <div className="flex items-center justify-center gap-4 pt-1">
              {["UPI", "Cards", "NetBanking", "Wallets"].map(m => (
                <span key={m} className="text-[10px] text-muted-foreground font-medium">{m}</span>
              ))}
            </div>
          </div>
        )}

        {/* ── AWAITING step (APK polling mode) ────────────────────────────────── */}
        {payStep === "awaiting" && (
          <div className="text-center py-6 space-y-5">
            {/* Animated waiting indicator */}
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>

            <div>
              <p className="font-black text-lg">Payment Browser Mein Khula</p>
              <p className="text-sm text-muted-foreground mt-1">
                Browser mein payment karo, phir yahan wapas aao.
              </p>
            </div>

            {/* Status text */}
            {pollStatus && (
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-2xl px-4 py-2.5">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
                {pollStatus}
              </div>
            )}

            {/* External browser open again button */}
            <div className="flex items-center justify-center">
              <button
                onClick={() => {
                  const cfBase = "https://payments.cashfree.com/order/#";
                  const cfTestBase = "https://payments-test.cashfree.com/order/#";
                  // Re-open the pending order
                  const storedId = sessionStorage.getItem("cf_pending_order_id") ?? pendingOrderId;
                  if (storedId) {
                    // We don't have the session ID here anymore but can re-create order
                    toast.info("Naya order banao ya browser reopen karo.");
                  }
                }}
                className="text-xs text-primary font-semibold hover:underline flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3" />
                Browser mein dobara kholo
              </button>
            </div>

            {/* Manual verify button */}
            <GradientButton
              onClick={handleManualCheck}
              isLoading={submitting}
              disabled={submitting}
              className="w-full py-4 rounded-2xl text-base font-bold"
            >
              <CheckCircle2 className="w-4 h-4 mr-2 inline" />
              Maine Pay Kar Diya — Verify Karo
            </GradientButton>

            <button onClick={resetFlow} className="text-xs text-muted-foreground hover:underline block mx-auto">
              Wapas jao / cancel karo
            </button>
          </div>
        )}

        {/* ── DONE step ───────────────────────────────────────────────────────── */}
        {payStep === "done" && (
          <div className="text-center py-6 space-y-4">
            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
            <div>
              <p className="font-black text-lg">Payment Successful!</p>
              <p className="text-sm text-muted-foreground mt-1">
                ₹{amount} aapke wallet mein add ho gaya.
              </p>
            </div>
            <button onClick={resetFlow} className="text-sm text-primary font-bold hover:underline">
              + Aur paisa add karo
            </button>
          </div>
        )}
      </div>

      {/* ── Recent Recharge History ─────────────────────────────────────────────── */}
      {requests.length > 0 && (
        <div className="glass-card rounded-3xl p-4 mb-5 space-y-3">
          <h3 className="font-bold text-sm flex items-center gap-2">
            <Clock className="w-4 h-4 text-orange-500" /> Recharge History
          </h3>
          {requests.map(r => (
            <div key={r.id} className={cn(
              "flex items-center gap-3 p-3.5 rounded-2xl border",
              r.status === "pending"  ? "bg-orange-500/5 border-orange-500/15" :
              r.status === "approved" ? "bg-green-500/5 border-green-500/15" :
                                        "bg-red-500/5 border-red-500/15"
            )}>
              <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                r.status === "pending"  ? "bg-orange-500/15" :
                r.status === "approved" ? "bg-green-500/15" : "bg-red-500/15"
              )}>
                {r.status === "pending"  ? <Clock className="w-3.5 h-3.5 text-orange-500" /> :
                 r.status === "approved" ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> :
                 <XCircle className="w-3.5 h-3.5 text-red-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold">₹{r.amountInRupees} recharge</p>
                <p className="text-[10px] text-muted-foreground">{formatRelativeTime(r.createdAt)}</p>
                {r.adminNote && <p className="text-[10px] text-red-500 mt-0.5">{r.adminNote}</p>}
              </div>
              <span className={cn("text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-wide",
                r.status === "pending"  ? "bg-orange-500/15 text-orange-600" :
                r.status === "approved" ? "bg-green-500/15 text-green-600" : "bg-red-500/15 text-red-500"
              )}>
                {r.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Transaction History ────────────────────────────────────────────────── */}
      <h3 className="font-bold text-base mb-3 px-1">Transaction History</h3>
      <div className="flex flex-col gap-3">
        {wallet.transactions.length === 0 ? (
          <div className="text-center py-12 glass-card rounded-3xl">
            <WalletIcon className="w-8 h-8 mx-auto mb-2 opacity-20" />
            <p className="text-sm text-muted-foreground">Abhi koi transaction nahi.</p>
          </div>
        ) : (
          wallet.transactions.map((tx) => {
            const isCredit = tx.kind === "recharge" || tx.kind === "refund" || tx.kind === "payout";
            return (
              <div key={tx.id} className="glass-card rounded-2xl p-4 flex items-center gap-4">
                <div className={cn("w-10 h-10 shrink-0 rounded-full flex items-center justify-center",
                  isCredit ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-500"
                )}>
                  {tx.kind === "recharge" ? <ArrowDownLeft className="w-5 h-5" /> :
                   tx.kind === "refund"   ? <RefreshCcw    className="w-5 h-5" /> :
                   tx.kind === "payout"   ? <HandCoins     className="w-5 h-5" /> :
                                           <ArrowUpRight   className="w-5 h-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{tx.description}</p>
                  <p className="text-xs text-muted-foreground">{formatRelativeTime(tx.createdAt)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className={cn("font-bold text-sm", isCredit ? "text-green-600" : "text-red-500")}>
                    {isCredit ? "+" : "-"}{formatRupees(tx.amountInRupees)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Bal: {formatRupees(tx.balanceAfter)}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </PageTransition>
  );
}
