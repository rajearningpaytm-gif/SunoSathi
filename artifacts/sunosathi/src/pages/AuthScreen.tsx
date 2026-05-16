import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMyProfileQueryKey } from "@workspace/api-client-react";
import { apiUrl } from "@/lib/apiBase";
import { useLocation } from "wouter";
import { ArrowRight } from "lucide-react";

const IS_NATIVE = Capacitor.isNativePlatform();

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
const MALE_AVATARS = [
  { seed: "av_arjun",  emoji: "😎", label: "Arjun"  },
  { seed: "av_rohan",  emoji: "🤓", label: "Rohan"  },
  { seed: "av_kiran",  emoji: "😊", label: "Kiran"  },
  { seed: "av_dev",    emoji: "🧑", label: "Dev"    },
];
const FEMALE_AVATARS = [
  { seed: "av_priya",  emoji: "😍", label: "Priya"  },
  { seed: "av_ananya", emoji: "🌸", label: "Ananya" },
  { seed: "av_meera",  emoji: "🌺", label: "Meera"  },
  { seed: "av_zara",   emoji: "✨", label: "Zara"   },
];

function avatarUrl(seed: string) {
  return `https://api.dicebear.com/7.x/lorelei/svg?seed=${encodeURIComponent(seed)}&backgroundColor=7c3aed,be185d,f97316&backgroundType=gradientLinear&radius=50`;
}

// ── Interests for Seekers ────────────────────────────────────────────────────
const INTERESTS = [
  { id: "emotional_support", label: "Emotional Support", emoji: "💖" },
  { id: "friendship",        label: "Friendship",        emoji: "🤝" },
  { id: "venting",           label: "Just Venting",      emoji: "🗣️" },
  { id: "general_chat",      label: "General Chat",      emoji: "💬" },
  { id: "advice",            label: "Need Advice",       emoji: "💡" },
  { id: "loneliness",        label: "Feeling Lonely",    emoji: "🌙" },
];

const FEMALE_NAMES = ["Aanya", "Diya", "Anaya", "Myra", "Sara", "Kiara", "Priya", "Meera", "Zara", "Riya"];
function pickRandom<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]!; }

// ── Navigation helper ─────────────────────────────────────────────────────────
function resolveAuthPath(data: {
  hasOnboarded: boolean;
  role: string;
  applicationStatus?: string | null;
}): string {
  if (data.role === "listener") {
    if (data.applicationStatus === "approved") return "/earnings";
    return data.hasOnboarded ? "/onboarding/pending" : "/onboarding/listener";
  }
  return data.hasOnboarded ? "/home" : "/onboarding";
}

// ── Branded Loader ────────────────────────────────────────────────────────────
function BrandedLoader({ message }: { message: string }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{ background: "linear-gradient(135deg, #0f0a1e 0%, #1a0f2e 50%, #0d1a2e 100%)" }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      <motion.div
        initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.1, type: "spring", stiffness: 260, damping: 22 }}
        className="flex flex-col items-center gap-5"
      >
        <div className="w-20 h-20 rounded-3xl shadow-2xl flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #f97316 0%, #ec4899 60%, #8b5cf6 100%)" }}>
          <span className="text-4xl">👂</span>
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-black text-white mb-1">SunoSathi</h1>
          <p className="text-sm text-white/50">{message}</p>
        </div>
        <div className="flex gap-2 mt-2">
          {[0, 1, 2].map((i) => (
            <motion.span key={i} className="w-2.5 h-2.5 rounded-full"
              style={{ background: "linear-gradient(135deg, #f97316, #ec4899)" }}
              animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.2 }} />
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Step 1: Role select (matches the welcome photo) ──────────────────────────
function StepRoleSelect({ onSelect }: { onSelect: (role: "male" | "female") => void }) {
  return (
    <motion.div
      key="role"
      className="w-full max-w-sm"
      initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
    >
      <div className="text-center mb-10">
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, type: "spring", stiffness: 220, damping: 18 }}
          className="w-20 h-20 rounded-3xl shadow-2xl flex items-center justify-center mx-auto mb-5"
          style={{ background: "linear-gradient(135deg, #ec4899 0%, #f97316 50%, #8b5cf6 100%)" }}
        >
          <span className="text-4xl">👂</span>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <h1 className="text-2xl font-black mb-2 bg-gradient-to-r from-pink-500 via-purple-400 to-orange-400 bg-clip-text text-transparent">
            Welcome to SunoSathi!
          </h1>
          <p className="text-sm text-white/50 leading-relaxed">
            Tell us who you are so we can<br />set up your perfect experience.
          </p>
        </motion.div>
      </div>

      <div className="space-y-4">
        {/* Male — Seeker */}
        <motion.button
          initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3, duration: 0.4 }}
          whileHover={{ scale: 1.025 }} whileTap={{ scale: 0.97 }}
          onClick={() => onSelect("male")}
          className="w-full text-left rounded-3xl overflow-hidden shadow-lg focus:outline-none group relative"
        >
          <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, #3b82f6 0%, #0ea5e9 100%)" }} />
          <div className="relative px-5 py-5 flex items-center gap-4">
            <div className="w-[72px] h-[72px] rounded-2xl bg-white/20 flex items-center justify-center shrink-0 shadow-inner backdrop-blur-sm">
              <span className="text-4xl">👨</span>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-white font-black text-lg">I am a Guy</span>
                <span className="bg-white/25 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">Seeker</span>
              </div>
              <p className="text-blue-100 text-xs leading-relaxed">
                Talk anonymously with verified female listeners who really listen.
              </p>
              <div className="flex items-center gap-3 mt-2.5">
                <span className="flex items-center gap-1 text-[10px] text-blue-200 font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-200 inline-block" />
                  100% Anonymous
                </span>
              </div>
            </div>
            <ArrowRight className="w-5 h-5 text-white/70 group-hover:translate-x-1 transition-transform shrink-0" />
          </div>
        </motion.button>

        {/* Female — Listener */}
        <motion.button
          initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.4, duration: 0.4 }}
          whileHover={{ scale: 1.025 }} whileTap={{ scale: 0.97 }}
          onClick={() => onSelect("female")}
          className="w-full text-left rounded-3xl overflow-hidden shadow-lg focus:outline-none group relative"
        >
          <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, #ec4899 0%, #f43f5e 100%)" }} />
          <div className="relative px-5 py-5 flex items-center gap-4">
            <div className="w-[72px] h-[72px] rounded-2xl bg-white/20 flex items-center justify-center shrink-0 shadow-inner backdrop-blur-sm">
              <span className="text-4xl">👩</span>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-white font-black text-lg">I am a Girl</span>
                <span className="bg-white/25 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">Listener</span>
              </div>
              <p className="text-pink-100 text-xs leading-relaxed">
                Become a verified listener. Listen to people &amp; help others.
              </p>
            </div>
            <ArrowRight className="w-5 h-5 text-white/70 group-hover:translate-x-1 transition-transform shrink-0" />
          </div>
        </motion.button>
      </div>

      <motion.p
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}
        className="text-center text-[11px] text-white/35 mt-7 flex items-center justify-center gap-1.5"
      >
        <span>🔒</span> Your identity stays completely anonymous at all times.
      </motion.p>
    </motion.div>
  );
}

// ── Step 2 (GUY/SEEKER): Full profile form — avatar + name + age + interest + WhatsApp ──
function StepSeekerProfile({
  onBack, onSubmit, isLoading,
}: {
  onBack: () => void;
  onSubmit: (data: { avatarSeed: string; name: string; age: number; interest: string; whatsapp: string }) => void;
  isLoading: boolean;
}) {
  const [avatarSeed, setAvatarSeed] = useState("");
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [interest, setInterest] = useState("");
  const [whatsapp, setWhatsapp] = useState("");

  const ageNum = Number(age);
  const cleanWa = whatsapp.replace(/\D/g, "");
  const valid =
    avatarSeed &&
    name.trim().length >= 2 &&
    ageNum >= 13 && ageNum <= 100 &&
    interest &&
    cleanWa.length >= 10;

  function handleSubmit() {
    if (!valid || isLoading) return;
    onSubmit({ avatarSeed, name: name.trim(), age: ageNum, interest, whatsapp: cleanWa });
  }

  return (
    <motion.div
      key="seeker-profile"
      className="w-full max-w-sm"
      initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.35 }}
    >
      <div className="text-center mb-6">
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 220, damping: 18 }}
          className="w-16 h-16 rounded-2xl shadow-2xl flex items-center justify-center mx-auto mb-3"
          style={{ background: "linear-gradient(135deg, #3b82f6 0%, #0ea5e9 100%)" }}
        >
          <span className="text-3xl">👨</span>
        </motion.div>
        <h1 className="text-xl font-black text-white mb-1">Apna Profile Banao</h1>
        <p className="text-xs text-white/50">Bas 30 second mein ready.</p>
      </div>

      {/* Avatar */}
      <div className="mb-4">
        <p className="text-white/60 text-[11px] font-bold uppercase tracking-widest mb-2.5">
          1. Avatar chunein
        </p>
        <div className="grid grid-cols-4 gap-2.5">
          {MALE_AVATARS.map((av) => (
            <button
              key={av.seed}
              type="button"
              onClick={() => setAvatarSeed(av.seed)}
              className={`flex flex-col items-center gap-1 p-2 rounded-2xl transition-all active:scale-95 ${
                avatarSeed === av.seed ? "ring-2 ring-blue-500" : "ring-1 ring-white/10"
              }`}
              style={{
                background: avatarSeed === av.seed ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.05)",
              }}
            >
              <img src={avatarUrl(av.seed)} alt={av.label} className="w-12 h-12 rounded-xl" loading="lazy" />
              <span className="text-[9px] text-white/60 font-medium">{av.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Name */}
      <div className="mb-3">
        <label className="block text-white/60 text-[11px] font-bold uppercase tracking-widest mb-2">
          2. Aapka Naam
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 60))}
          placeholder="Jaise: Arjun, Kabir…"
          maxLength={60}
          className="w-full px-4 py-3 rounded-2xl text-white text-sm font-medium placeholder-white/25 outline-none transition-all"
          style={{ background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.12)" }}
          onFocus={(e) => (e.target.style.border = "1.5px solid rgba(59,130,246,0.7)")}
          onBlur={(e) => (e.target.style.border = "1.5px solid rgba(255,255,255,0.12)")}
        />
      </div>

      {/* Age */}
      <div className="mb-4">
        <label className="block text-white/60 text-[11px] font-bold uppercase tracking-widest mb-2">
          3. Aapki Umar
        </label>
        <input
          type="number"
          inputMode="numeric"
          value={age}
          onChange={(e) => setAge(e.target.value)}
          placeholder="18"
          min={13} max={100}
          className="w-full px-4 py-3 rounded-2xl text-white text-sm font-medium placeholder-white/25 outline-none transition-all"
          style={{ background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.12)" }}
          onFocus={(e) => (e.target.style.border = "1.5px solid rgba(59,130,246,0.7)")}
          onBlur={(e) => (e.target.style.border = "1.5px solid rgba(255,255,255,0.12)")}
        />
      </div>

      {/* Interest */}
      <div className="mb-4">
        <label className="block text-white/60 text-[11px] font-bold uppercase tracking-widest mb-2">
          4. Aapki Ruchi (Interest)
        </label>
        <div className="grid grid-cols-2 gap-2">
          {INTERESTS.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => setInterest(it.id)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-2xl text-left transition-all active:scale-95 text-[12px] font-semibold ${
                interest === it.id ? "ring-2 ring-blue-500" : "ring-1 ring-white/10"
              }`}
              style={{
                background: interest === it.id ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.05)",
                color: interest === it.id ? "#fff" : "rgba(255,255,255,0.7)",
              }}
            >
              <span className="text-base shrink-0">{it.emoji}</span>
              <span className="leading-tight">{it.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* WhatsApp */}
      <div className="mb-5">
        <label className="block text-white/60 text-[11px] font-bold uppercase tracking-widest mb-2">
          5. WhatsApp Number
        </label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50 text-sm font-bold select-none">+91</span>
          <input
            type="tel"
            inputMode="numeric"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value.replace(/\D/g, "").slice(0, 10))}
            placeholder="9876543210"
            maxLength={10}
            className="w-full pl-14 pr-4 py-3 rounded-2xl text-white text-base font-semibold placeholder-white/25 outline-none transition-all"
            style={{ background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.12)" }}
            onFocus={(e) => (e.target.style.border = "1.5px solid rgba(59,130,246,0.7)")}
            onBlur={(e) => (e.target.style.border = "1.5px solid rgba(255,255,255,0.12)")}
          />
        </div>
        <p className="text-[10px] text-white/40 mt-1.5 pl-1 flex items-center gap-1">
          <span>🔒</span> Sirf payment aur support ke liye. Kabhi share nahi hoga.
        </p>
      </div>

      {/* Buttons */}
      <div className="flex gap-3">
        <button
          onClick={onBack}
          disabled={isLoading}
          className="flex-none px-5 py-3.5 rounded-2xl font-semibold text-sm text-white/60 transition-all active:scale-95 disabled:opacity-40"
          style={{ background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.1)" }}
        >
          ← Wapas
        </button>
        <button
          onClick={handleSubmit}
          disabled={!valid || isLoading}
          className="flex-1 py-3.5 rounded-2xl font-bold text-[15px] text-white transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={{
            background: "linear-gradient(135deg, #3b82f6 0%, #0ea5e9 100%)",
            boxShadow: valid && !isLoading ? "0 6px 28px rgba(59,130,246,0.4)" : "none",
          }}
        >
          {isLoading ? (
            <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          ) : (
            <>Dashboard kholo 🎉</>
          )}
        </button>
      </div>
    </motion.div>
  );
}

// ── Step 2 (GIRL/LISTENER): WhatsApp only (listener goes to apply form next) ──
function StepListenerWhatsApp({
  onBack, onSubmit, isLoading,
}: {
  onBack: () => void;
  onSubmit: (whatsapp: string) => void;
  isLoading: boolean;
}) {
  const [whatsapp, setWhatsapp] = useState("");
  const valid = whatsapp.replace(/\D/g, "").length >= 10;

  return (
    <motion.div
      key="listener-whatsapp"
      className="w-full max-w-sm"
      initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.35 }}
    >
      <div className="text-center mb-8">
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 220, damping: 18 }}
          className="w-20 h-20 rounded-3xl shadow-2xl flex items-center justify-center mx-auto mb-5"
          style={{ background: "linear-gradient(135deg, #ec4899 0%, #f43f5e 100%)" }}
        >
          <span className="text-4xl">📱</span>
        </motion.div>
        <h1 className="text-2xl font-black mb-2 text-white">WhatsApp Number</h1>
        <p className="text-sm text-white/50 leading-relaxed">
          Approval aur payment ke liye zaroori hai.
        </p>
      </div>

      <div className="mb-3">
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50 text-base font-bold select-none">+91</span>
          <input
            type="tel"
            inputMode="numeric"
            autoFocus
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value.replace(/\D/g, "").slice(0, 10))}
            placeholder="9876543210"
            maxLength={10}
            className="w-full pl-14 pr-4 py-4 rounded-2xl text-white text-lg font-semibold placeholder-white/25 outline-none transition-all"
            style={{ background: "rgba(255,255,255,0.07)", border: "2px solid rgba(255,255,255,0.12)" }}
            onFocus={(e) => (e.target.style.border = "2px solid rgba(236,72,153,0.7)")}
            onBlur={(e) => (e.target.style.border = "2px solid rgba(255,255,255,0.12)")}
          />
        </div>
        <p className="text-[11px] text-white/40 mt-2 pl-1 flex items-center gap-1">
          <span>🔒</span> Sirf payment aur support ke liye. Kabhi share nahi hoga.
        </p>
      </div>

      <div className="flex gap-3 mt-6">
        <button
          onClick={onBack}
          disabled={isLoading}
          className="flex-none px-5 py-4 rounded-2xl font-semibold text-sm text-white/60 transition-all active:scale-95 disabled:opacity-40"
          style={{ background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.1)" }}
        >
          ← Wapas
        </button>
        <button
          onClick={() => valid && !isLoading && onSubmit(whatsapp)}
          disabled={!valid || isLoading}
          className="flex-1 py-4 rounded-2xl font-bold text-[15px] text-white transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={{
            background: "linear-gradient(135deg, #ec4899 0%, #f43f5e 100%)",
            boxShadow: valid && !isLoading ? "0 6px 28px rgba(236,72,153,0.4)" : "none",
          }}
        >
          {isLoading ? (
            <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          ) : (
            <>Aage Badho 🎉</>
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
  const [step, setStep] = useState<"role" | "details">("role");
  const [role, setRole] = useState<"male" | "female" | null>(null);
  const [loaderMsg, setLoaderMsg] = useState("Device check kar rahe hain…");
  const deviceIdRef = useRef<string>("");

  async function doNavigate(data: { hasOnboarded: boolean; role: string; applicationStatus?: string | null }) {
    try { await queryClient.refetchQueries({ queryKey: ["auth-user"] }); } catch { /* ignore */ }
    queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
    setLocation(resolveAuthPath(data));
  }

  // ── Auto device-login on mount ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function checkDevice() {
      try {
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
          setTimeout(() => { if (!cancelled) doNavigate(data); }, 800);
        } else {
          if (!cancelled) setPhase("form");
        }
      } catch {
        if (!cancelled) setPhase("form");
      }
    }

    checkDevice();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Seeker (Guy) full signup ──────────────────────────────────────────────
  async function handleSeekerSignup(d: {
    avatarSeed: string; name: string; age: number; interest: string; whatsapp: string;
  }) {
    if (phase === "submitting") return;
    setPhase("submitting");
    setLoaderMsg("Account bana rahe hain…");

    try {
      const res = await fetch(apiUrl("/api/auth/device-signup"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          deviceId:   deviceIdRef.current,
          name:       d.name,
          age:        d.age,
          gender:     "male",
          whatsapp:   d.whatsapp,
          avatarSeed: d.avatarSeed,
          interest:   d.interest,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setPhase("form");
        toast.error(data?.error || "Signup fail hua. Dobara try karein.");
        return;
      }
      setLoaderMsg(`Welcome, ${d.name}! 🎉`);
      setTimeout(() => doNavigate(data), 900);
    } catch {
      setPhase("form");
      toast.error("Network error. Internet check karein.");
    }
  }

  // ── Listener (Girl) signup — minimal, listener apply form collects rest ───
  async function handleListenerSignup(whatsapp: string) {
    if (phase === "submitting") return;
    setPhase("submitting");
    setLoaderMsg("Account bana rahe hain…");

    const autoName   = pickRandom(FEMALE_NAMES);
    const autoAvatar = pickRandom(FEMALE_AVATARS).seed;

    try {
      const res = await fetch(apiUrl("/api/auth/device-signup"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          deviceId:   deviceIdRef.current,
          name:       autoName,
          age:        21,
          gender:     "female",
          whatsapp:   whatsapp.replace(/\D/g, ""),
          avatarSeed: autoAvatar,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setPhase("form");
        toast.error(data?.error || "Signup fail hua. Dobara try karein.");
        return;
      }
      setLoaderMsg(`Welcome, ${autoName}! 🎉`);
      setTimeout(() => doNavigate(data), 900);
    } catch {
      setPhase("form");
      toast.error("Network error. Internet check karein.");
    }
  }

  const isSubmitting = phase === "submitting";
  const showLoader = phase === "checking" || isSubmitting;

  return (
    <>
      <AnimatePresence>
        {showLoader && <BrandedLoader message={loaderMsg} />}
      </AnimatePresence>

      {phase === "form" && (
        <div
          className="min-h-screen flex flex-col items-center justify-center px-5 py-8 overflow-y-auto relative"
          style={{ background: "linear-gradient(160deg, #0f0a1e 0%, #1a0f2e 45%, #0d1a2e 100%)" }}
        >
          {/* Ambient glow */}
          <div className="absolute top-[-60px] left-1/2 -translate-x-1/2 w-72 h-72 rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle, rgba(236,72,153,0.22) 0%, transparent 70%)", filter: "blur(48px)" }} />
          <div className="absolute bottom-0 left-[-30px] w-52 h-52 rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle, rgba(249,115,22,0.15) 0%, transparent 70%)", filter: "blur(40px)" }} />

          <div className="relative z-10 w-full flex items-center justify-center py-4">
            <AnimatePresence mode="wait">
              {step === "role" && (
                <StepRoleSelect
                  key="role"
                  onSelect={(r) => { setRole(r); setStep("details"); }}
                />
              )}
              {step === "details" && role === "male" && (
                <StepSeekerProfile
                  key="seeker"
                  onBack={() => setStep("role")}
                  onSubmit={handleSeekerSignup}
                  isLoading={isSubmitting}
                />
              )}
              {step === "details" && role === "female" && (
                <StepListenerWhatsApp
                  key="listener"
                  onBack={() => setStep("role")}
                  onSubmit={handleListenerSignup}
                  isLoading={isSubmitting}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </>
  );
}
