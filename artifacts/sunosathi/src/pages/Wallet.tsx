import { useGetWallet } from "@workspace/api-client-react";
import { PageTransition } from "@/components/PageTransition";
import { formatRupees, formatRelativeTime } from "@/lib/format";
import { GradientButton } from "@/components/GradientButton";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  Wallet as WalletIcon, ArrowUpRight, ArrowDownLeft,
  RefreshCcw, HandCoins, CheckCircle2, XCircle,
  Clock, ShieldCheck, CreditCard, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { getGetWalletQueryKey } from "@workspace/api-client-react";
import { load as loadCashfree } from "@cashfreepayments/cashfree-js";

const AMOUNTS = [25, 50, 100, 200, 1000];
const MIN_RECHARGE = 25;
type Step = "select" | "done";

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

  const [step, setStep] = useState<Step>("select");
  const [amount, setAmount] = useState<number>(25);
  const [submitting, setSubmitting] = useState(false);
  const [requests, setRequests] = useState<RechargeRequest[]>([]);
  const redirectVerifiedRef = useRef(false);

  const fetchRequests = () => {
    fetch("/api/wallet/recharge-requests", { credentials: "include" })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setRequests(d); })
      .catch(() => {});
  };
  useEffect(() => { fetchRequests(); }, []);

  // ── Handle Cashfree redirect return (mobile fallback flow) ──────────────────
  // On mobile, Cashfree redirects back to return_url with ?cf_order_id=...
  // We detect this, verify server-side, credit wallet, then clean the URL.
  useEffect(() => {
    if (redirectVerifiedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get("cf_order_id");
    if (!orderId) return;
    redirectVerifiedRef.current = true;

    // Clean URL immediately so refresh doesn't re-trigger
    window.history.replaceState({}, "", window.location.pathname);

    setSubmitting(true);
    toast.loading("Verifying your payment…", { id: "cf-verify" });

    fetch("/api/wallet/cashfree/verify", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, amountInRupees: 0 }),
    })
      .then(async (res) => {
        toast.dismiss("cf-verify");
        if (res.ok) {
          const data = await res.json() as { success: boolean; newBalance?: number; alreadyCredited?: boolean };
          setStep("done");
          queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
          fetchRequests();
          if (data.alreadyCredited) {
            toast.success("Payment already credited to your wallet!");
          } else {
            toast.success(`Wallet recharged successfully!`);
          }
        } else {
          const err = await res.json().catch(() => ({})) as { error?: string };
          // Payment may still be processing — webhook will credit it
          toast.info(err.error ?? "Payment received. Wallet will update shortly.");
        }
      })
      .catch(() => {
        toast.dismiss("cf-verify");
        toast.info("Payment received. Wallet will update shortly.");
      })
      .finally(() => setSubmitting(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCashfree = async () => {
    const amt = amount;
    if (!amt || amt < MIN_RECHARGE) { toast.error(`Minimum recharge is ₹${MIN_RECHARGE}`); return; }
    setSubmitting(true);
    try {
      // 1. Create order on backend
      const orderRes = await fetch("/api/wallet/cashfree/order", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountInRupees: amt }),
      });
      if (!orderRes.ok) {
        const err = await orderRes.json().catch(() => ({})) as { error?: string };
        toast.error(err.error ?? "Failed to create payment order.");
        setSubmitting(false);
        return;
      }
      const { orderId, paymentSessionId, env } =
        await orderRes.json() as { orderId: string; paymentSessionId: string; env: string };

      // 2. Open Cashfree checkout
      const cashfree = await loadCashfree({ mode: env === "production" ? "production" : "sandbox" });
      const result = await cashfree.checkout({
        paymentSessionId,
        redirectTarget: "_modal",
      });

      if ((result as { error?: { message?: string } }).error) {
        const msg = (result as { error: { message?: string } }).error.message ?? "Payment cancelled.";
        toast.error(msg);
        setSubmitting(false);
        return;
      }

      // 3. Verify on backend (re-check with Cashfree API — cannot be faked)
      const verifyRes = await fetch("/api/wallet/cashfree/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, amountInRupees: amt }),
      });

      if (verifyRes.ok) {
        setStep("done");
        queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
        fetchRequests();
        toast.success(`₹${amount} added to your wallet!`);
      } else {
        const err = await verifyRes.json().catch(() => ({})) as { error?: string };
        toast.error(err.error ?? "Payment verification failed. Please contact support.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Payment failed. Please try again.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const resetFlow = () => {
    setStep("select");
    setAmount(25);
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

        {step === "select" && (
          <div className="space-y-4">
            {/* Quick amount pills */}
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

            {/* Cashfree pay button */}
            <GradientButton
              onClick={handleCashfree}
              isLoading={submitting}
              disabled={submitting || amount < MIN_RECHARGE}
              className="w-full py-4 rounded-2xl text-base font-bold"
            >
              <CreditCard className="w-4 h-4 mr-2 inline" />
              Recharge ₹{amount}
            </GradientButton>

            {/* Trust badges */}
            <div className="flex items-center justify-center gap-4 pt-1">
              {["UPI", "Cards", "NetBanking", "Wallets"].map(m => (
                <span key={m} className="text-[10px] text-muted-foreground font-medium">{m}</span>
              ))}
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="text-center py-6 space-y-4">
            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
            <div>
              <p className="font-black text-lg">Payment Successful!</p>
              <p className="text-sm text-muted-foreground mt-1">
                ₹{amount} has been instantly added to your wallet.
              </p>
            </div>
            <button onClick={resetFlow} className="text-sm text-primary font-bold hover:underline">
              + Add more money
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
            <p className="text-sm text-muted-foreground">No transactions yet.</p>
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
