import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signInWithCredential,
  PhoneAuthProvider,
  type ConfirmationResult,
} from "firebase/auth";
import { Capacitor } from "@capacitor/core";
import { firebaseAuth } from "@/lib/firebase";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMyProfileQueryKey } from "@workspace/api-client-react";
import { apiUrl } from "@/lib/apiBase";

const IS_NATIVE = Capacitor.isNativePlatform();

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

async function verifyPhoneToken(idToken: string) {
  // Try sign-in first; if account not found, auto sign-up
  let res = await fetch(apiUrl("/api/auth/firebase/verify-token"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ idToken, intent: "signin" }),
  });

  // Auto sign-up for new users
  if (res.status === 404) {
    res = await fetch(apiUrl("/api/auth/firebase/verify-token"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ idToken, intent: "signup", role: "user" }),
    });
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Auth failed (${res.status})`);
  return data as {
    ok: boolean;
    role: string;
    hasOnboarded: boolean;
    isNewUser: boolean;
  };
}

function navigateAfterAuth(data: { hasOnboarded: boolean; role: string }) {
  if (!data.hasOnboarded) {
    window.location.replace(`${BASE}/onboarding`);
  } else if (data.role === "listener") {
    window.location.replace(`${BASE}/earnings`);
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

type Step = "phone" | "otp";

export default function AuthScreen() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showLoader, setShowLoader] = useState(false);
  const [loaderMessage, setLoaderMessage] = useState("Signing you in…");
  const [countdown, setCountdown] = useState(0);

  // Web only — stores confirmation result from signInWithPhoneNumber
  const confirmationRef = useRef<ConfirmationResult | null>(null);
  // Native only — stores verificationId from Capacitor plugin
  const verificationIdRef = useRef<string | null>(null);

  // Countdown timer for resend OTP
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // Web reCAPTCHA verifier — invisible, created once
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);
  function getRecaptchaVerifier() {
    if (recaptchaRef.current) return recaptchaRef.current;
    const verifier = new RecaptchaVerifier(firebaseAuth, "recaptcha-container", {
      size: "invisible",
    });
    recaptchaRef.current = verifier;
    return verifier;
  }

  async function handleSendOtp() {
    const cleaned = phone.replace(/\s/g, "");
    if (cleaned.length < 10) {
      toast.error("Sahi mobile number daalo (10 digit)");
      return;
    }
    const fullPhone = cleaned.startsWith("+") ? cleaned : `+91${cleaned}`;
    setIsLoading(true);

    try {
      if (IS_NATIVE) {
        // Native Capacitor — uses Android Firebase SDK, no reCAPTCHA
        const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
        const result = await FirebaseAuthentication.signInWithPhoneNumber({ phoneNumber: fullPhone });
        verificationIdRef.current = result.verificationId ?? null;
      } else {
        // Web — uses invisible reCAPTCHA
        const verifier = getRecaptchaVerifier();
        const confirmation = await signInWithPhoneNumber(firebaseAuth, fullPhone, verifier);
        confirmationRef.current = confirmation;
      }

      setStep("otp");
      setCountdown(30);
      toast.success("OTP bheja gaya!");
    } catch (err: any) {
      console.error("Send OTP error:", err);
      // Reset reCAPTCHA on error so user can retry
      if (!IS_NATIVE) {
        recaptchaRef.current?.clear();
        recaptchaRef.current = null;
      }
      const msg = err?.message ?? "";
      if (msg.includes("invalid-phone-number") || msg.includes("INVALID_PHONE_NUMBER")) {
        toast.error("Invalid phone number format.");
      } else if (msg.includes("too-many-requests") || msg.includes("TOO_MANY_ATTEMPTS")) {
        toast.error("Bahut zyada requests. Thodi der baad try karo.");
      } else {
        toast.error("OTP nahi gaya. Dobara try karo.");
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleVerifyOtp() {
    if (otp.length < 6) {
      toast.error("6-digit OTP daalo");
      return;
    }
    setIsLoading(true);
    setShowLoader(true);
    setLoaderMessage("OTP verify ho raha hai…");

    try {
      let idToken: string;

      if (IS_NATIVE) {
        const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
        const verificationId = verificationIdRef.current;
        if (!verificationId) throw new Error("Verification ID missing. OTP dobara bhejo.");

        const result = await FirebaseAuthentication.confirmVerificationCode({
          verificationId,
          verificationCode: otp,
        });

        // Get idToken from native result or via credential
        if (result.credential?.idToken) {
          // Sign in to web SDK with the credential to get a fresh idToken
          const credential = PhoneAuthProvider.credential(verificationId, otp);
          const userCred = await signInWithCredential(firebaseAuth, credential);
          idToken = await userCred.user.getIdToken();
        } else {
          throw new Error("Verification failed. OTP dobara bhejo.");
        }
      } else {
        const confirmation = confirmationRef.current;
        if (!confirmation) throw new Error("Session expired. OTP dobara bhejo.");
        const userCred = await confirmation.confirm(otp);
        idToken = await userCred.user.getIdToken();
      }

      setLoaderMessage("Login ho raha hai…");
      const data = await verifyPhoneToken(idToken);
      queryClient.invalidateQueries({ queryKey: ["auth-user"] });
      queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      navigateAfterAuth(data);
    } catch (err: any) {
      console.error("Verify OTP error:", err);
      setIsLoading(false);
      setShowLoader(false);
      const msg = err?.message ?? "";
      if (msg.includes("invalid-verification-code") || msg.includes("INVALID_CODE")) {
        toast.error("Galat OTP. Dobara check karo.");
      } else if (msg.includes("code-expired") || msg.includes("CODE_EXPIRED")) {
        toast.error("OTP expire ho gaya. Naya OTP maango.");
        setStep("phone");
      } else {
        toast.error(err.message || "Verification failed. Try again.");
      }
    }
  }

  function handleResendOtp() {
    setOtp("");
    setStep("phone");
    confirmationRef.current = null;
    verificationIdRef.current = null;
    if (!IS_NATIVE) {
      recaptchaRef.current?.clear();
      recaptchaRef.current = null;
    }
    handleSendOtp();
  }

  return (
    <>
      <AnimatePresence>
        {showLoader && <BrandedLoader message={loaderMessage} />}
      </AnimatePresence>

      {/* Invisible reCAPTCHA container (web only) */}
      <div id="recaptcha-container" />

      <div
        className="min-h-screen flex flex-col overflow-hidden relative"
        style={{ background: "linear-gradient(160deg, #0f0a1e 0%, #1a0f2e 45%, #0d1a2e 100%)" }}
      >
        {/* Ambient glow orbs */}
        <div className="absolute top-[-60px] left-1/2 -translate-x-1/2 w-72 h-72 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(236,72,153,0.22) 0%, transparent 70%)", filter: "blur(48px)" }} />
        <div className="absolute top-48 right-[-40px] w-56 h-56 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(139,92,246,0.18) 0%, transparent 70%)", filter: "blur(50px)" }} />
        <div className="absolute bottom-0 left-[-30px] w-52 h-52 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(249,115,22,0.15) 0%, transparent 70%)", filter: "blur(40px)" }} />

        <div className="relative z-10 px-5 pt-11 pb-8 flex flex-col">

          {/* Brand bar */}
          <motion.div className="flex items-center gap-2.5 mb-8"
            initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "linear-gradient(135deg, #f97316 0%, #ec4899 55%, #8b5cf6 100%)", boxShadow: "0 4px 16px rgba(236,72,153,0.35)" }}>
              <span className="text-[17px]">👂</span>
            </div>
            <span className="text-white font-black text-[17px] tracking-tight">SunoSathi</span>
          </motion.div>

          {/* Hero headline */}
          <motion.div className="mb-7"
            initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.08 }}>
            <h1 className="text-[2rem] font-black leading-[1.18] text-white mb-2.5">
              Someone is{" "}
              <span style={{ backgroundImage: "linear-gradient(90deg, #f97316 0%, #ec4899 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                ready
              </span>{" "}
              to listen.
            </h1>
            <p className="text-white/45 text-[13px] leading-relaxed">
              Real people. Real conversations. Safe &amp; anonymous.
            </p>
          </motion.div>

          {/* Listener carousel */}
          <motion.div className="mb-8"
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.18 }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-white/40 text-[10px] font-semibold uppercase tracking-widest">Online now</p>
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
                <motion.div key={listener.name}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.04 * i + 0.1, duration: 0.28 }}
                  className="flex-none flex flex-col items-center gap-1.5">
                  <div className="relative">
                    <div className="w-[60px] h-[60px] rounded-[14px] overflow-hidden"
                      style={{ background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.1)", boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }}>
                      <img src={listener.photo} alt={listener.name} className="w-full h-full object-cover"
                        onError={(e) => {
                          const t = e.target as HTMLImageElement;
                          t.src = `https://api.dicebear.com/7.x/lorelei/svg?seed=${listener.name}&backgroundColor=7c3aed,be185d&backgroundType=gradientLinear`;
                        }} />
                    </div>
                    <span className="absolute -bottom-[2px] -right-[2px] flex h-[14px] w-[14px] items-center justify-center">
                      <span className="animate-ping absolute inline-flex h-[10px] w-[10px] rounded-full bg-green-400 opacity-60" />
                      <span className="relative inline-flex rounded-full h-[10px] w-[10px] bg-green-400" style={{ border: "2px solid #0f0a1e" }} />
                    </span>
                  </div>
                  <p className="text-[10px] font-bold text-white/80 leading-none">{listener.name}</p>
                  <p className="text-[8.5px] text-white/35 leading-none -mt-0.5">{listener.tagline}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* ── Auth Form ── */}
          <AnimatePresence mode="wait">
            {step === "phone" ? (
              <motion.div key="phone-step"
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.28 }}>

                <p className="text-white/60 text-[13px] font-semibold mb-3">
                  Mobile number se login karo
                </p>

                {/* Phone input */}
                <div className="flex items-center gap-2 mb-4 rounded-2xl overflow-hidden"
                  style={{ background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.12)" }}>
                  <div className="flex items-center gap-1.5 px-4 py-4 border-r border-white/10 shrink-0">
                    <span className="text-base">🇮🇳</span>
                    <span className="text-white font-bold text-[15px]">+91</span>
                  </div>
                  <input
                    type="tel"
                    inputMode="numeric"
                    placeholder="Mobile number"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
                    onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
                    className="flex-1 bg-transparent text-white placeholder-white/30 text-[15px] font-medium outline-none px-3 py-4"
                    autoComplete="tel"
                    maxLength={10}
                  />
                </div>

                {/* Send OTP button */}
                <button
                  onClick={handleSendOtp}
                  disabled={isLoading || phone.length < 10}
                  className="w-full flex items-center justify-center gap-2.5 py-[15px] px-5 rounded-2xl font-bold text-[15px] text-white transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed mb-5"
                  style={{ background: "linear-gradient(135deg, #f97316 0%, #ec4899 55%, #8b5cf6 100%)", boxShadow: "0 6px 28px rgba(236,72,153,0.4), 0 2px 8px rgba(0,0,0,0.25)" }}>
                  {isLoading ? (
                    <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.45 2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.82a16 16 0 0 0 6.29 6.29l.98-.98a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                    </svg>
                  )}
                  {isLoading ? "OTP bheja ja raha hai…" : "OTP Bhejo"}
                </button>

                {/* Trust row */}
                <div className="flex items-center justify-center gap-6 mb-4">
                  {[{ icon: "🎭", label: "Anonymous" }, { icon: "✅", label: "Verified" }, { icon: "🔒", label: "Secure" }].map(({ icon, label }) => (
                    <div key={label} className="flex items-center gap-1.5">
                      <span className="text-sm">{icon}</span>
                      <span className="text-[10px] text-white/35 font-medium">{label}</span>
                    </div>
                  ))}
                </div>

                <p className="text-center text-[10px] text-white/22 leading-relaxed">
                  By continuing, you agree to our{" "}
                  <a href="/legal/terms" className="underline text-white/38 hover:text-white/55">Terms of Service</a>
                  {" "}and{" "}
                  <a href="/legal/privacy" className="underline text-white/38 hover:text-white/55">Privacy Policy</a>.
                </p>
              </motion.div>

            ) : (
              <motion.div key="otp-step"
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.28 }}>

                {/* Back button */}
                <button onClick={() => { setStep("phone"); setOtp(""); confirmationRef.current = null; verificationIdRef.current = null; }}
                  className="flex items-center gap-1.5 text-white/50 text-[13px] mb-4 hover:text-white/80 transition-colors">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m15 18-6-6 6-6"/>
                  </svg>
                  Wapas jao
                </button>

                <p className="text-white/60 text-[13px] font-semibold mb-1">OTP daalo</p>
                <p className="text-white/35 text-[12px] mb-4">
                  +91 {phone} pe OTP bheja gaya hai
                </p>

                {/* OTP input */}
                <div className="flex items-center justify-center mb-4 rounded-2xl overflow-hidden"
                  style={{ background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.12)" }}>
                  <input
                    type="tel"
                    inputMode="numeric"
                    placeholder="6-digit OTP"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                    onKeyDown={(e) => e.key === "Enter" && handleVerifyOtp()}
                    className="w-full bg-transparent text-white placeholder-white/30 text-[20px] font-bold outline-none px-5 py-4 text-center tracking-[0.3em]"
                    autoComplete="one-time-code"
                    maxLength={6}
                    autoFocus
                  />
                </div>

                {/* Verify button */}
                <button
                  onClick={handleVerifyOtp}
                  disabled={isLoading || otp.length < 6}
                  className="w-full flex items-center justify-center gap-2.5 py-[15px] px-5 rounded-2xl font-bold text-[15px] text-white transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed mb-4"
                  style={{ background: "linear-gradient(135deg, #f97316 0%, #ec4899 55%, #8b5cf6 100%)", boxShadow: "0 6px 28px rgba(236,72,153,0.4), 0 2px 8px rgba(0,0,0,0.25)" }}>
                  {isLoading ? (
                    <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5"/>
                    </svg>
                  )}
                  {isLoading ? "Verify ho raha hai…" : "OTP Verify Karo"}
                </button>

                {/* Resend */}
                <div className="text-center">
                  {countdown > 0 ? (
                    <p className="text-white/35 text-[12px]">OTP dobara bhejo ({countdown}s)</p>
                  ) : (
                    <button onClick={handleResendOtp}
                      className="text-white/60 text-[12px] underline hover:text-white/90 transition-colors">
                      OTP dobara bhejo
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </div>
    </>
  );
}
