import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithCredential,
  GoogleAuthProvider,
} from "firebase/auth";
import { Capacitor } from "@capacitor/core";
import { firebaseAuth } from "@/lib/firebase";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMyProfileQueryKey } from "@workspace/api-client-react";
import { apiUrl } from "@/lib/apiBase";

const IS_NATIVE = Capacitor.isNativePlatform();

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

async function verifyGoogleToken(idToken: string) {
  const res = await fetch(apiUrl("/api/auth/google/verify-token"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ idToken }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Auth failed (${res.status})`);
  return data as {
    ok: boolean;
    role: string;
    hasOnboarded: boolean;
    applicationStatus: string | null;
  };
}

function navigateAfterAuth(data: {
  hasOnboarded: boolean;
  role: string;
  applicationStatus: string | null;
}) {
  if (!data.hasOnboarded) {
    window.location.replace(`${BASE}/onboarding`);
  } else if (data.role === "listener") {
    if (data.applicationStatus === "approved") {
      window.location.replace(`${BASE}/earnings`);
    } else {
      window.location.replace(`${BASE}/onboarding/pending`);
    }
  } else {
    window.location.replace(`${BASE}/home`);
  }
}

const LISTENERS = [
  { name: "Priya",  tagline: "Anxiety",      photo: `${BASE}/listeners/priya.webp`  },
  { name: "Ananya", tagline: "Relationships", photo: `${BASE}/listeners/ananya.webp` },
  { name: "Shreya", tagline: "Loneliness",    photo: `${BASE}/listeners/shreya.webp` },
  { name: "Divya",  tagline: "Breakups",      photo: `${BASE}/listeners/divya.webp`  },
  { name: "Meera",  tagline: "Family",        photo: `${BASE}/listeners/meera.webp`  },
  { name: "Zara",   tagline: "Self-esteem",   photo: `${BASE}/listeners/zara.webp`   },
  { name: "Kavya",  tagline: "Career",        photo: `${BASE}/listeners/kavya.webp`  },
  { name: "Riya",   tagline: "Life Advice",   photo: `${BASE}/listeners/riya.webp`   },
];

function BrandedLoader({ message }: { message: string }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{ background: "linear-gradient(135deg, #0f0a1e 0%, #1a0f2e 50%, #0d1a2e 100%)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      <motion.div
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.1, type: "spring", stiffness: 260, damping: 22 }}
        className="flex flex-col items-center gap-5"
      >
        <div
          className="w-20 h-20 rounded-3xl shadow-2xl flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #f97316 0%, #ec4899 60%, #8b5cf6 100%)" }}
        >
          <span className="text-4xl">👂</span>
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-black text-white mb-1">SunoSathi</h1>
          <p className="text-sm text-white/50">{message}</p>
        </div>
        <div className="flex gap-2 mt-2">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="w-2.5 h-2.5 rounded-full"
              style={{ background: "linear-gradient(135deg, #f97316, #ec4899)" }}
              animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.2 }}
            />
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function AuthScreen() {
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const [showLoader, setShowLoader] = useState(false);
  const [loaderMessage, setLoaderMessage] = useState("Signing you in…");

  // Web only: handle redirect result when Google sends user back after signInWithRedirect.
  // On native, we use the @capacitor-firebase/authentication plugin (no redirect needed).
  useEffect(() => {
    if (IS_NATIVE) return;
    let cancelled = false;
    async function checkRedirectResult() {
      try {
        const result = await getRedirectResult(firebaseAuth);
        if (!result || cancelled) return;
        setShowLoader(true);
        setLoaderMessage("Signing you in…");
        const idToken = await result.user.getIdToken();
        const data = await verifyGoogleToken(idToken);
        queryClient.invalidateQueries({ queryKey: ["auth-user"] });
        queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
        if (!cancelled) navigateAfterAuth(data);
      } catch (err: any) {
        if (!cancelled) {
          setShowLoader(false);
          const ignoredCodes = ["auth/null-user", "auth/no-current-user", "auth/argument-error", "auth/internal-error"];
          if (!ignoredCodes.includes(err?.code)) {
            toast.error(err.message || "Sign in failed. Please try again.");
          }
        }
      }
    }
    checkRedirectResult();
    return () => { cancelled = true; };
  }, [queryClient]);

  async function handleGoogleSignIn() {
    if (isLoading || showLoader) return;

    // ── Native (APK): use @capacitor-firebase/authentication ──────────────────
    // This uses the native Android Google Sign-In SDK — shows Google's own
    // account picker, no WebView redirect to firebaseapp.com, works reliably.
    if (IS_NATIVE) {
      setIsLoading(true);
      setLoaderMessage("Opening Google…");
      try {
        const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
        const result = await FirebaseAuthentication.signInWithGoogle();
        const idToken = result.credential?.idToken;
        if (!idToken) throw new Error("Google sign-in returned no ID token.");

        setShowLoader(true);
        setLoaderMessage("Signing you in…");

        const credential = GoogleAuthProvider.credential(idToken);
        const userCred = await signInWithCredential(firebaseAuth, credential);
        const firebaseIdToken = await userCred.user.getIdToken();
        const data = await verifyGoogleToken(firebaseIdToken);

        queryClient.invalidateQueries({ queryKey: ["auth-user"] });
        queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
        navigateAfterAuth(data);
      } catch (err: any) {
        setIsLoading(false);
        setShowLoader(false);
        if (err?.code === "auth/cancelled-popup-request" || err?.message?.includes("cancelled")) return;
        toast.error(err.message || "Google sign-in failed. Please try again.");
      }
      return;
    }

    // ── Web: popup first, redirect fallback ───────────────────────────────────
    const provider = new GoogleAuthProvider();
    provider.addScope("email");
    provider.addScope("profile");
    provider.setCustomParameters({ prompt: "select_account" });

    setIsLoading(true);
    try {
      setLoaderMessage("Signing you in…");
      const result = await signInWithPopup(firebaseAuth, provider);
      setShowLoader(true);
      const idToken = await result.user.getIdToken();
      const data = await verifyGoogleToken(idToken);
      queryClient.invalidateQueries({ queryKey: ["auth-user"] });
      queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      navigateAfterAuth(data);
    } catch (err: any) {
      const code = err?.code ?? "";
      if (
        code === "auth/popup-blocked" ||
        code === "auth/operation-not-supported-in-this-environment"
      ) {
        try {
          setLoaderMessage("Redirecting to Google…");
          setShowLoader(true);
          await signInWithRedirect(firebaseAuth, provider);
          return;
        } catch (redirectErr: any) {
          setShowLoader(false);
          toast.error(redirectErr.message || "Could not open Google sign-in.");
          return;
        }
      }
      if (
        code === "auth/popup-closed-by-user" ||
        code === "auth/cancelled-popup-request"
      ) {
        setIsLoading(false);
        return;
      }
      setShowLoader(false);
      toast.error(err.message || "Sign in failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <AnimatePresence>
        {showLoader && <BrandedLoader message={loaderMessage} />}
      </AnimatePresence>

      <div
        className="min-h-screen flex flex-col overflow-hidden relative"
        style={{
          background:
            "linear-gradient(160deg, #0f0a1e 0%, #1a0f2e 45%, #0d1a2e 100%)",
        }}
      >
        {/* Ambient glow orbs */}
        <div
          className="absolute top-[-60px] left-1/2 -translate-x-1/2 w-72 h-72 rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, rgba(236,72,153,0.22) 0%, transparent 70%)",
            filter: "blur(48px)",
          }}
        />
        <div
          className="absolute top-48 right-[-40px] w-56 h-56 rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, rgba(139,92,246,0.18) 0%, transparent 70%)",
            filter: "blur(50px)",
          }}
        />
        <div
          className="absolute bottom-0 left-[-30px] w-52 h-52 rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, rgba(249,115,22,0.15) 0%, transparent 70%)",
            filter: "blur(40px)",
          }}
        />

        <div className="relative z-10 px-5 pt-11 pb-8 flex flex-col">

          {/* ── Brand bar ── */}
          <motion.div
            className="flex items-center gap-2.5 mb-8"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background:
                  "linear-gradient(135deg, #f97316 0%, #ec4899 55%, #8b5cf6 100%)",
                boxShadow: "0 4px 16px rgba(236,72,153,0.35)",
              }}
            >
              <span className="text-[17px]">👂</span>
            </div>
            <span className="text-white font-black text-[17px] tracking-tight">
              SunoSathi
            </span>
          </motion.div>

          {/* ── Hero headline ── */}
          <motion.div
            className="mb-7"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.08 }}
          >
            <h1 className="text-[2rem] font-black leading-[1.18] text-white mb-2.5">
              Someone is{" "}
              <span
                style={{
                  backgroundImage:
                    "linear-gradient(90deg, #f97316 0%, #ec4899 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                ready
              </span>{" "}
              to listen.
            </h1>
            <p className="text-white/45 text-[13px] leading-relaxed">
              Real people. Real conversations. Safe &amp; anonymous.
            </p>
          </motion.div>

          {/* ── Listener carousel ── */}
          <motion.div
            className="mb-8"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.18 }}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-white/40 text-[10px] font-semibold uppercase tracking-widest">
                Online now
              </p>
              <span className="flex items-center gap-1.5 text-[10px] font-bold text-green-400">
                <span className="relative flex h-[7px] w-[7px]">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-70" />
                  <span className="relative inline-flex rounded-full h-[7px] w-[7px] bg-green-400" />
                </span>
                {LISTENERS.length} live
              </span>
            </div>

            <div className="flex gap-3 overflow-x-auto pb-1 -mx-5 px-5 scrollbar-none">
              {LISTENERS.map((listener, i) => (
                <motion.button
                  key={listener.name}
                  onClick={handleGoogleSignIn}
                  disabled={isLoading || showLoader}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.04 * i + 0.1, duration: 0.28 }}
                  className="flex-none flex flex-col items-center gap-1.5 focus:outline-none disabled:opacity-60 active:scale-95 transition-transform duration-100"
                >
                  <div className="relative">
                    <div
                      className="w-[60px] h-[60px] rounded-[14px] overflow-hidden"
                      style={{
                        background: "rgba(255,255,255,0.07)",
                        border: "1.5px solid rgba(255,255,255,0.1)",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                      }}
                    >
                      <img
                        src={listener.photo}
                        alt={listener.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          const t = e.target as HTMLImageElement;
                          t.src = `https://api.dicebear.com/7.x/lorelei/svg?seed=${listener.name}&backgroundColor=7c3aed,be185d&backgroundType=gradientLinear`;
                        }}
                      />
                    </div>
                    {/* Live dot */}
                    <span className="absolute -bottom-[2px] -right-[2px] flex h-[14px] w-[14px] items-center justify-center">
                      <span className="animate-ping absolute inline-flex h-[10px] w-[10px] rounded-full bg-green-400 opacity-60" />
                      <span
                        className="relative inline-flex rounded-full h-[10px] w-[10px] bg-green-400"
                        style={{ border: "2px solid #0f0a1e" }}
                      />
                    </span>
                  </div>
                  <p className="text-[10px] font-bold text-white/80 leading-none">
                    {listener.name}
                  </p>
                  <p className="text-[8.5px] text-white/35 leading-none -mt-0.5">
                    {listener.tagline}
                  </p>
                </motion.button>
              ))}
            </div>
          </motion.div>

          {/* ── Sign-in button ── */}
          <div>
            <button
              onClick={handleGoogleSignIn}
              disabled={isLoading || showLoader}
              className="w-full flex items-center justify-center gap-3 py-[15px] px-5 rounded-2xl font-bold text-[15px] text-white transition-all active:scale-[0.97] disabled:opacity-60 disabled:cursor-not-allowed mb-5"
              style={{
                background:
                  "linear-gradient(135deg, #f97316 0%, #ec4899 55%, #8b5cf6 100%)",
                boxShadow:
                  "0 6px 28px rgba(236,72,153,0.4), 0 2px 8px rgba(0,0,0,0.25)",
              }}
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  className="shrink-0"
                >
                  <path
                    fill="rgba(255,255,255,0.92)"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="rgba(255,255,255,0.92)"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="rgba(255,255,255,0.92)"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                  />
                  <path
                    fill="rgba(255,255,255,0.92)"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
              )}
              {isLoading ? "Opening Google…" : "Continue with Google"}
            </button>

            {/* Trust row */}
            <div className="flex items-center justify-center gap-6 mb-4">
              {[
                { icon: "🎭", label: "Anonymous" },
                { icon: "✅", label: "Verified" },
                { icon: "🔒", label: "Secure" },
              ].map(({ icon, label }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <span className="text-sm">{icon}</span>
                  <span className="text-[10px] text-white/35 font-medium">
                    {label}
                  </span>
                </div>
              ))}
            </div>

            <p className="text-center text-[10px] text-white/22 leading-relaxed">
              By continuing, you agree to our{" "}
              <a
                href="/legal/terms"
                className="underline text-white/38 hover:text-white/55"
              >
                Terms of Service
              </a>{" "}
              and{" "}
              <a
                href="/legal/privacy"
                className="underline text-white/38 hover:text-white/55"
              >
                Privacy Policy
              </a>
              .
            </p>
          </div>

        </div>
      </div>
    </>
  );
}
