import { useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { GradientButton } from "@/components/GradientButton";
import { cn } from "@/lib/utils";
import { Phone, User, FileText, Sparkles } from "lucide-react";
import { apiUrl } from "@/lib/apiBase";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const SKILL_OPTIONS = [
  "Anxiety", "Relationships", "Breakups", "Loneliness",
  "Stress", "Family Issues", "Career", "Depression",
  "Grief", "Self-esteem", "Trauma", "Motivation",
  "Friendship", "Empathy", "Life Advice",
];

const LISTENER_PHOTOS = [
  { url: `${BASE}/listeners/pool/avatar1.webp`, label: "Style 1" },
  { url: `${BASE}/listeners/pool/avatar2.webp`, label: "Style 2" },
  { url: `${BASE}/listeners/pool/avatar3.webp`, label: "Style 3" },
  { url: `${BASE}/listeners/pool/avatar4.webp`, label: "Style 4" },
  { url: `${BASE}/listeners/pool/avatar5.webp`, label: "Style 5" },
  { url: `${BASE}/listeners/pool/avatar6.webp`, label: "Style 6" },
];

const AGE_BRACKETS = [
  { label: "Under 18", value: 16 },
  { label: "18–24",    value: 21 },
  { label: "25–34",    value: 30 },
  { label: "35–49",    value: 42 },
  { label: "50+",      value: 55 },
];

type Step = "profile" | "bio" | "contact";

async function submitApplication(body: object) {
  const res = await fetch(apiUrl("/api/listener/apply"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Submit failed (${res.status})`);
  return data;
}

export default function ListenerApplyOnboarding() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<Step>("profile");
  const [isLoading, setIsLoading] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [photoUrl, setPhotoUrl] = useState(LISTENER_PHOTOS[0].url);
  const [ageBracket, setAgeBracket] = useState<(typeof AGE_BRACKETS)[number]>(AGE_BRACKETS[1]);
  const [bio, setBio] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [contactNumber, setContactNumber] = useState("");

  const steps: Step[] = ["profile", "bio", "contact"];
  const stepIndex = steps.indexOf(step);

  function toggleSkill(s: string) {
    setSkills(prev =>
      prev.includes(s) ? prev.filter(x => x !== s) : prev.length < 5 ? [...prev, s] : prev
    );
  }

  async function handleSubmit() {
    if (!contactNumber.trim() || contactNumber.replace(/\D/g, "").length < 10) {
      toast.error("Please enter a valid 10-digit WhatsApp number.");
      return;
    }
    setIsLoading(true);
    try {
      await submitApplication({
        displayName: displayName.trim(),
        gender: "female",
        bio: bio.trim(),
        skills,
        photoUrl,
        contactNumber: contactNumber.trim(),
        age: ageBracket.value,
      });
      toast.success("Application submitted! 🎉");
      setLocation("/onboarding/pending");
    } catch (err: any) {
      toast.error(err.message || "Failed to submit. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-5 py-10"
      style={{
        background: "linear-gradient(160deg, #0f0a1e 0%, #1a0f2e 45%, #0d1a2e 100%)",
      }}
    >
      <motion.div
        className="w-full max-w-sm"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        {/* Application badge */}
        <div className="flex items-center justify-center gap-2 mb-5 px-4 py-1.5 rounded-full bg-pink-500/15 border border-pink-500/25 w-fit mx-auto">
          <Sparkles className="w-3.5 h-3.5 text-pink-400" />
          <span className="text-xs font-bold text-pink-300 tracking-wide uppercase">Listener Application</span>
        </div>

        {/* Progress */}
        <div className="flex gap-2 mb-6">
          {steps.map((s, i) => (
            <div
              key={s}
              className={cn(
                "h-1.5 rounded-full flex-1 transition-all duration-500",
                i <= stepIndex ? "bg-pink-500" : "bg-white/15"
              )}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* ── STEP 1: Profile ─────────────────────────────────────────────── */}
          {step === "profile" && (
            <motion.div
              key="profile"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <div className="text-center mb-6">
                <div className="w-14 h-14 rounded-2xl bg-pink-500/15 flex items-center justify-center mx-auto mb-3">
                  <User className="w-7 h-7 text-pink-400" />
                </div>
                <h1 className="text-2xl font-black mb-1 text-white">Your listener profile</h1>
                <p className="text-xs text-white/40">This is how users see you. Make it warm!</p>
              </div>

              {/* Display name */}
              <div className="mb-4">
                <label className="text-xs font-bold text-white/35 uppercase tracking-wider block mb-1.5">
                  Display Name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value.slice(0, 40))}
                  placeholder="e.g. Ananya, Priya, Zara…"
                  maxLength={40}
                  autoFocus
                  className="w-full rounded-2xl border-2 border-pink-500/30 bg-white/5 px-4 py-3 text-base font-semibold text-white placeholder:text-white/20 focus:outline-none focus:border-pink-400 transition"
                />
                <p className="text-[10px] text-white/30 mt-1 pl-1">
                  {displayName.length < 2 ? "At least 2 characters" : `✓ Great name, ${displayName}!`}
                </p>
              </div>

              {/* Age bracket */}
              <div className="mb-4">
                <label className="text-xs font-bold text-white/35 uppercase tracking-wider block mb-2">
                  Your Age
                </label>
                <div className="grid grid-cols-5 gap-1.5">
                  {AGE_BRACKETS.map((bracket) => (
                    <button
                      key={bracket.label}
                      type="button"
                      onClick={() => setAgeBracket(bracket)}
                      className={cn(
                        "py-2.5 rounded-xl border-2 font-semibold text-xs transition-all",
                        ageBracket.label === bracket.label
                          ? "border-pink-500 bg-pink-500/15 text-pink-300"
                          : "border-white/10 bg-white/5 text-white/50 hover:bg-pink-500/10"
                      )}
                    >
                      {bracket.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Avatar pick */}
              <div className="mb-5">
                <label className="text-xs font-bold text-white/35 uppercase tracking-wider block mb-2">
                  Choose your avatar
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {LISTENER_PHOTOS.map(({ url, label }) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => setPhotoUrl(url)}
                      className={cn(
                        "rounded-2xl p-2 border-2 transition-all flex flex-col items-center gap-1",
                        photoUrl === url
                          ? "border-pink-500 bg-pink-500/15"
                          : "border-transparent bg-white/5 hover:bg-white/10"
                      )}
                    >
                      <img src={url} alt={label} className="w-14 h-14 rounded-xl" />
                      <span className="text-[10px] font-semibold text-white/35">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <GradientButton
                className="w-full py-4"
                style={{ background: "linear-gradient(135deg, #ec4899, #f43f5e)" }}
                disabled={displayName.trim().length < 2}
                onClick={() => setStep("bio")}
              >
                Continue →
              </GradientButton>
            </motion.div>
          )}

          {/* ── STEP 2: Bio & Skills ─────────────────────────────────────────── */}
          {step === "bio" && (
            <motion.div
              key="bio"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <div className="text-center mb-5">
                <div className="w-14 h-14 rounded-2xl bg-pink-500/15 flex items-center justify-center mx-auto mb-3">
                  <FileText className="w-7 h-7 text-pink-400" />
                </div>
                <h1 className="text-2xl font-black mb-1 text-white">Tell us about yourself</h1>
                <p className="text-xs text-white/40">Your bio is what users read before connecting.</p>
              </div>

              {/* Bio */}
              <div className="mb-4">
                <label className="text-xs font-bold text-white/35 uppercase tracking-wider block mb-1.5">
                  Your Bio <span className="normal-case font-normal">(min 20 characters)</span>
                </label>
                <textarea
                  value={bio}
                  onChange={e => setBio(e.target.value.slice(0, 600))}
                  placeholder="I'm a compassionate listener who loves helping others navigate their emotions. I'm patient, non-judgemental, and always here to listen..."
                  rows={4}
                  className="w-full rounded-2xl border-2 border-pink-500/30 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-pink-400 transition resize-none"
                  autoFocus
                />
                <p className="text-[10px] text-white/30 mt-1 pl-1 flex justify-between">
                  <span>{bio.length < 20 ? `${20 - bio.length} more characters needed` : "✓ Great!"}</span>
                  <span>{bio.length}/600</span>
                </p>
              </div>

              {/* Skills */}
              <div className="mb-5">
                <label className="text-xs font-bold text-white/35 uppercase tracking-wider block mb-2">
                  Your Strengths <span className="normal-case font-normal">(pick up to 5)</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {SKILL_OPTIONS.map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleSkill(s)}
                      className={cn(
                        "text-xs px-3 py-1.5 rounded-full border font-semibold transition-all",
                        skills.includes(s)
                          ? "bg-pink-500 text-white border-pink-500"
                          : "bg-pink-500/10 text-pink-300 border-pink-500/20 hover:bg-pink-500/20"
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                {skills.length === 0 && (
                  <p className="text-[10px] text-white/30 mt-1.5 pl-1">Select at least 1 skill</p>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep("profile")}
                  className="flex-none px-4 py-3 rounded-2xl border-2 border-white/15 font-semibold text-white/50 hover:bg-white/5 transition text-sm"
                >
                  ← Back
                </button>
                <GradientButton
                  className="flex-1 py-3 text-sm"
                  style={{ background: "linear-gradient(135deg, #ec4899, #f43f5e)" }}
                  disabled={bio.trim().length < 20 || skills.length === 0}
                  onClick={() => setStep("contact")}
                >
                  Continue →
                </GradientButton>
              </div>
            </motion.div>
          )}

          {/* ── STEP 3: Contact Number ────────────────────────────────────────── */}
          {step === "contact" && (
            <motion.div
              key="contact"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <div className="text-center mb-6">
                <div className="w-14 h-14 rounded-2xl bg-green-500/15 flex items-center justify-center mx-auto mb-3">
                  <Phone className="w-7 h-7 text-green-400" />
                </div>
                <h1 className="text-2xl font-black mb-1 text-white">WhatsApp number</h1>
                <p className="text-xs text-white/40 leading-relaxed">
                  Our team will verify you on WhatsApp before approval.
                  <br />
                  <span className="text-green-400 font-medium">Only used for verification — never shown publicly.</span>
                </p>
              </div>

              <div className="mb-6">
                <label className="text-xs font-bold text-white/35 uppercase tracking-wider block mb-1.5">
                  WhatsApp Number
                </label>
                <div className="flex rounded-2xl border-2 border-pink-500/30 bg-white/5 overflow-hidden focus-within:border-pink-400 transition">
                  <div className="flex items-center px-3 bg-pink-500/10 border-r border-pink-500/20">
                    <span className="text-sm font-bold text-pink-300">🇮🇳 +91</span>
                  </div>
                  <input
                    type="tel"
                    value={contactNumber}
                    onChange={e => setContactNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    placeholder="9876543210"
                    autoFocus
                    inputMode="numeric"
                    pattern="[0-9]{10}"
                    className="flex-1 px-3 py-3 text-base font-semibold bg-transparent text-white placeholder:text-white/20 focus:outline-none"
                  />
                </div>
                <p className="text-[10px] text-white/30 mt-1.5 pl-1">
                  {contactNumber.length === 10
                    ? "✓ Looks good!"
                    : `${10 - contactNumber.length} more digits needed`}
                </p>
              </div>

              {/* Summary */}
              <div className="rounded-2xl p-4 border border-pink-500/15 mb-5" style={{ background: "rgba(255,255,255,0.05)" }}>
                <p className="text-xs font-bold text-white/35 uppercase tracking-wider mb-2">Your Application</p>
                <div className="flex items-center gap-3">
                  <img src={photoUrl} alt={displayName} className="w-10 h-10 rounded-xl shrink-0" />
                  <div>
                    <p className="font-bold text-sm text-white">{displayName}</p>
                    <p className="text-[10px] text-white/40">{skills.slice(0, 3).join(", ")}{skills.length > 3 ? `…+${skills.length - 3}` : ""}</p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep("bio")}
                  className="flex-none px-4 py-3 rounded-2xl border-2 border-white/15 font-semibold text-white/50 hover:bg-white/5 transition text-sm"
                >
                  ← Back
                </button>
                <GradientButton
                  className="flex-1 py-3 text-sm"
                  style={{ background: "linear-gradient(135deg, #ec4899, #f43f5e)" }}
                  isLoading={isLoading}
                  disabled={contactNumber.replace(/\D/g, "").length < 10}
                  onClick={handleSubmit}
                >
                  Submit Application 🎉
                </GradientButton>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
