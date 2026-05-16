import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMyProfileQueryKey } from "@workspace/api-client-react";
import { apiUrl } from "@/lib/apiBase";
import { useLocation } from "wouter";

const IS_NATIVE = Capacitor.isNativePlatform();
const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

// ── Device ID helper ─────────────────────────────────────────────────────────
async function getDeviceId(): Promise<string> {
  if (IS_NATIVE) {
    try {
      const { Device } = await import("@capacitor/device");
      const info = await Device.getId();
      return info.identifier;
    } catch {
      // fall through to localStorage
    }
  }
  const STORAGE_KEY = "ss_device_id";
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = "web_" + crypto.randomUUID().replace(/-/g, "");
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}

// ── Avatar catalogue ──────────────────────────────────────────────────────────
const AVATARS = [
  { seed: "av_arjun",    emoji: "😎", label: "Arjun"    },
  { seed: "av_rohan",    emoji: "🤓", label: "Rohan"    },
  { seed: "av_kiran",    emoji: "😊", label: "Kiran"    },
  { seed: "av_dev",      emoji: "🧑", label: "Dev"      },
  { seed: "av_priya",    emoji: "😍", label: "Priya"    },
  { seed: "av_ananya",   emoji: "🌸", label: "Ananya"   },
  { seed: "av_meera",    emoji: "🌺", label: "Meera"    },
  { seed: "av_zara",     emoji: "✨", label: "Zara"     },
];

function avatarUrl(seed: string) {
  return `https://api.dicebear.com/7.x/lorelei/svg?seed=${encodeURIComponent(seed)}&backgroundColor=7c3aed,be185d,f97316&backgroundType=gradientLinear&radius=50`;
}

// ── Navigation helper ─────────────────────────────────────────────────────────
// Uses wouter setLocation (SPA navigation — no page reload, no infinite loop).
// Falls back to window.location.replace only if navigate is not available.
function resolveAuthPath(data: {
  hasOnboarded: boolean;
  role: string;
  applicationStatus?: string | null;
}): string {
  if (!data.hasOnboarded) return "/onboarding";
  if (data.role === "listener") {
    return data.applicationStatus === "approved" ? "/earnings" : "/onboarding/pending";
  }
  return "/home";
}

// ── Branded Loader ────────────────────────────────────────────────────────────
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

// ── Step 1: Avatar + Name + Age ───────────────────────────────────────────────
function StepProfile({
  onNext,
}: {
  onNext: (data: { avatarSeed: string; name: string; age: string }) => void;
}) {
  const [selectedAvatar, setSelectedAvatar] = useState("");
  const [name, setName] = useState("");
  const [age, setAge] = useState("");

  const valid =
    selectedAvatar &&
    name.trim().length >= 2 &&
    Number(age) >= 13 &&
    Number(age) <= 100;

  return (
    <motion.div
      key="step1"
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-5"
    >
      {/* Avatar selection */}
      <div>
        <p className="text-white/60 text-xs font-semibold uppercase tracking-widest mb-3">
          Avatar chunein
        </p>
        <div className="grid grid-cols-4 gap-3">
          {AVATARS.map((av) => (
            <button
              key={av.seed}
              onClick={() => setSelectedAvatar(av.seed)}
              className={`flex flex-col items-center gap-1 p-2 rounded-2xl transition-all active:scale-95 ${
                selectedAvatar === av.seed
                  ? "ring-2 ring-pink-500"
                  : "ring-1 ring-white/10"
              }`}
              style={{
                background:
                  selectedAvatar === av.seed
                    ? "rgba(236,72,153,0.18)"
                    : "rgba(255,255,255,0.05)",
              }}
            >
              <img
                src={avatarUrl(av.seed)}
                alt={av.label}
                className="w-12 h-12 rounded-xl"
                loading="lazy"
              />
              <span className="text-[10px] text-white/60 font-medium">{av.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Name */}
      <div>
        <label className="block text-white/60 text-xs font-semibold uppercase tracking-widest mb-2">
          Aapka Naam
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Jaise: Arjun, Priya..."
          maxLength={60}
          className="w-full px-4 py-3.5 rounded-2xl text-white text-sm font-medium placeholder-white/25 outline-none transition-all"
          style={{
            background: "rgba(255,255,255,0.07)",
            border: "1.5px solid rgba(255,255,255,0.12)",
          }}
          onFocus={(e) =>
            (e.target.style.border = "1.5px solid rgba(236,72,153,0.7)")
          }
          onBlur={(e) =>
            (e.target.style.border = "1.5px solid rgba(255,255,255,0.12)")
          }
        />
      </div>

      {/* Age */}
      <div>
        <label className="block text-white/60 text-xs font-semibold uppercase tracking-widest mb-2">
          Aapki Umar
        </label>
        <input
          type="number"
          inputMode="numeric"
          value={age}
          onChange={(e) => setAge(e.target.value)}
          placeholder="18"
          min={13}
          max={100}
          className="w-full px-4 py-3.5 rounded-2xl text-white text-sm font-medium placeholder-white/25 outline-none transition-all"
          style={{
            background: "rgba(255,255,255,0.07)",
            border: "1.5px solid rgba(255,255,255,0.12)",
          }}
          onFocus={(e) =>
            (e.target.style.border = "1.5px solid rgba(236,72,153,0.7)")
          }
          onBlur={(e) =>
            (e.target.style.border = "1.5px solid rgba(255,255,255,0.12)")
          }
        />
      </div>

      <button
        onClick={() =>
          valid && onNext({ avatarSeed: selectedAvatar, name, age })
        }
        disabled={!valid}
        className="w-full py-4 rounded-2xl font-bold text-[15px] text-white transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed mt-1"
        style={{
          background:
            "linear-gradient(135deg, #f97316 0%, #ec4899 55%, #8b5cf6 100%)",
          boxShadow: valid
            ? "0 6px 28px rgba(236,72,153,0.4), 0 2px 8px rgba(0,0,0,0.25)"
            : "none",
        }}
      >
        Aage Badho →
      </button>
    </motion.div>
  );
}

// ── Step 2: Gender + WhatsApp ─────────────────────────────────────────────────
function StepContact({
  onBack,
  onSubmit,
  isLoading,
}: {
  onBack: () => void;
  onSubmit: (data: { gender: string; whatsapp: string }) => void;
  isLoading: boolean;
}) {
  const [gender, setGender] = useState<"male" | "female" | "">("");
  const [whatsapp, setWhatsapp] = useState("");

  const valid = gender && whatsapp.replace(/\D/g, "").length >= 10;

  return (
    <motion.div
      key="step2"
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-5"
    >
      {/* Gender */}
      <div>
        <label className="block text-white/60 text-xs font-semibold uppercase tracking-widest mb-3">
          Aap kaun hain?
        </label>
        <div className="grid grid-cols-2 gap-3">
          {(["male", "female"] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGender(g)}
              className={`flex flex-col items-center justify-center gap-2 py-4 rounded-2xl transition-all active:scale-95 font-semibold text-sm ${
                gender === g ? "ring-2 ring-pink-500" : "ring-1 ring-white/10"
              }`}
              style={{
                background:
                  gender === g
                    ? "rgba(236,72,153,0.18)"
                    : "rgba(255,255,255,0.05)",
                color: gender === g ? "#fff" : "rgba(255,255,255,0.6)",
              }}
            >
              <span className="text-2xl">{g === "male" ? "👦" : "👩"}</span>
              <span>{g === "male" ? "Male (Seeker)" : "Female (Listener)"}</span>
            </button>
          ))}
        </div>
        {gender && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-[11px] text-white/40 mt-2 text-center"
          >
            {gender === "female"
              ? "✨ Aap listener ke roop mein register honge"
              : "🎧 Aap seekers ke roop mein register honge"}
          </motion.p>
        )}
      </div>

      {/* WhatsApp */}
      <div>
        <label className="block text-white/60 text-xs font-semibold uppercase tracking-widest mb-2">
          WhatsApp Number
        </label>
        <div className="relative">
          <span
            className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 text-sm font-medium select-none"
          >
            +91
          </span>
          <input
            type="tel"
            inputMode="tel"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            placeholder="9876543210"
            maxLength={15}
            className="w-full pl-14 pr-4 py-3.5 rounded-2xl text-white text-sm font-medium placeholder-white/25 outline-none transition-all"
            style={{
              background: "rgba(255,255,255,0.07)",
              border: "1.5px solid rgba(255,255,255,0.12)",
            }}
            onFocus={(e) =>
              (e.target.style.border = "1.5px solid rgba(236,72,153,0.7)")
            }
            onBlur={(e) =>
              (e.target.style.border = "1.5px solid rgba(255,255,255,0.12)")
            }
          />
        </div>
        <p className="text-[10px] text-white/30 mt-1.5 pl-1">
          Sirf payment aur support ke liye. Kabhi share nahi hoga.
        </p>
      </div>

      {/* Buttons */}
      <div className="flex gap-3 mt-1">
        <button
          onClick={onBack}
          disabled={isLoading}
          className="flex-none px-5 py-4 rounded-2xl font-semibold text-sm text-white/60 transition-all active:scale-95 disabled:opacity-40"
          style={{ background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.1)" }}
        >
          ← Wapas
        </button>
        <button
          onClick={() => valid && !isLoading && onSubmit({ gender, whatsapp })}
          disabled={!valid || isLoading}
          className="flex-1 py-4 rounded-2xl font-bold text-[15px] text-white transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={{
            background:
              "linear-gradient(135deg, #f97316 0%, #ec4899 55%, #8b5cf6 100%)",
            boxShadow:
              valid && !isLoading
                ? "0 6px 28px rgba(236,72,153,0.4)"
                : "none",
          }}
        >
          {isLoading ? (
            <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          ) : (
            "Join SunoSathi 🎉"
          )}
        </button>
      </div>
    </motion.div>
  );
}

// ── Main AuthScreen ───────────────────────────────────────────────────────────
export default function AuthScreen() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [phase, setPhase] = useState<"checking" | "form" | "submitting">("checking");
  const [step, setStep] = useState<1 | 2>(1);
  const [loaderMsg, setLoaderMsg] = useState("Device check kar rahe hain…");
  const [step1Data, setStep1Data] = useState<{
    avatarSeed: string;
    name: string;
    age: string;
  } | null>(null);
  const deviceIdRef = useRef<string>("");

  // ── Shared: refetch auth state FIRST, then navigate via SPA router ──────────
  // We MUST await the refetch so isAuthenticated = true before setLocation is
  // called. Without this, AuthGatedRoutes sees isAuthenticated=false, shows
  // AuthScreen again, which re-runs checkDevice → infinite loop.
  async function doNavigate(data: { hasOnboarded: boolean; role: string; applicationStatus?: string | null }) {
    try {
      await queryClient.refetchQueries({ queryKey: ["auth-user"] });
    } catch { /* ignore — if refetch fails, navigate anyway */ }
    queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
    setLocation(resolveAuthPath(data));
  }

  // ── On mount: get device ID and attempt silent auto-login ──────────────────
  useEffect(() => {
    let cancelled = false;

    async function checkDevice() {
      try {
        // 8-second timeout guard: if server doesn't respond, fall through to signup form
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const deviceId = await getDeviceId();
        deviceIdRef.current = deviceId;

        let res: Response;
        try {
          res = await fetch(apiUrl("/api/auth/device-login"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ deviceId }),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }

        const data = await res.json().catch(() => ({}));

        if (cancelled) return;

        if (res.ok && data?.found === true) {
          setLoaderMsg("Swaagat hai wapas! 🎉");
          setTimeout(() => {
            if (!cancelled) doNavigate(data);
          }, 800);
        } else {
          if (!cancelled) setPhase("form");
        }
      } catch {
        // Timeout, network error, or any exception → show signup form
        if (!cancelled) setPhase("form");
      }
    }

    checkDevice();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sign-up submit ─────────────────────────────────────────────────────────
  async function handleSignup(contactData: { gender: string; whatsapp: string }) {
    if (!step1Data || phase === "submitting") return;
    setPhase("submitting");
    setLoaderMsg("Account bana rahe hain…");

    try {
      const res = await fetch(apiUrl("/api/auth/device-signup"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          deviceId:  deviceIdRef.current,
          name:      step1Data.name,
          age:       Number(step1Data.age),
          gender:    contactData.gender,
          whatsapp:  contactData.whatsapp,
          avatarSeed: step1Data.avatarSeed,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setPhase("form");
        toast.error(data?.error || "Signup fail hua. Dobara try karein.");
        return;
      }

      setLoaderMsg(`Welcome, ${step1Data.name}! 🎉`);
      setTimeout(() => doNavigate(data), 900);
    } catch {
      setPhase("form");
      toast.error("Network error. Check your internet connection.");
    }
  }

  const showLoader = phase === "checking" || phase === "submitting";

  return (
    <>
      <AnimatePresence>
        {showLoader && <BrandedLoader message={loaderMsg} />}
      </AnimatePresence>

      {phase === "form" && (
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

          <div className="relative z-10 px-5 pt-11 pb-10 flex flex-col flex-1 overflow-y-auto">
            {/* Brand bar */}
            <motion.div
              className="flex items-center gap-2.5 mb-6"
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

            {/* Hero */}
            <motion.div
              className="mb-6"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.08 }}
            >
              <h1 className="text-[1.65rem] font-black leading-[1.2] text-white mb-1.5">
                {step === 1 ? (
                  <>
                    Apna{" "}
                    <span
                      style={{
                        backgroundImage:
                          "linear-gradient(90deg, #f97316 0%, #ec4899 100%)",
                        WebkitBackgroundClip: "text",
                        WebkitTextFillColor: "transparent",
                      }}
                    >
                      Profile
                    </span>{" "}
                    banao
                  </>
                ) : (
                  <>
                    Thoda aur{" "}
                    <span
                      style={{
                        backgroundImage:
                          "linear-gradient(90deg, #f97316 0%, #ec4899 100%)",
                        WebkitBackgroundClip: "text",
                        WebkitTextFillColor: "transparent",
                      }}
                    >
                      baaki hai
                    </span>
                  </>
                )}
              </h1>
              <p className="text-white/40 text-[13px]">
                {step === 1
                  ? "Koi password nahi. Bas 30 second mein ready."
                  : "Bas ek step aur — phir aap tayar hain!"}
              </p>
            </motion.div>

            {/* Step indicator */}
            <div className="flex items-center gap-2 mb-6">
              {[1, 2].map((s) => (
                <div
                  key={s}
                  className="h-1 rounded-full transition-all duration-300"
                  style={{
                    flex: 1,
                    background:
                      step >= s
                        ? "linear-gradient(90deg, #f97316, #ec4899)"
                        : "rgba(255,255,255,0.1)",
                  }}
                />
              ))}
            </div>

            {/* Steps */}
            <AnimatePresence mode="wait">
              {step === 1 ? (
                <StepProfile
                  key="step1"
                  onNext={(data) => {
                    setStep1Data(data);
                    setStep(2);
                  }}
                />
              ) : (
                <StepContact
                  key="step2"
                  onBack={() => setStep(1)}
                  onSubmit={handleSignup}
                  isLoading={phase === "submitting"}
                />
              )}
            </AnimatePresence>

            {/* Footer */}
            <p className="text-center text-[10px] text-white/20 leading-relaxed mt-6">
              Register karke aap humari{" "}
              <a
                href="/legal/terms"
                className="underline text-white/35 hover:text-white/55"
              >
                Terms of Service
              </a>{" "}
              aur{" "}
              <a
                href="/legal/privacy"
                className="underline text-white/35 hover:text-white/55"
              >
                Privacy Policy
              </a>{" "}
              se agree karte hain.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
