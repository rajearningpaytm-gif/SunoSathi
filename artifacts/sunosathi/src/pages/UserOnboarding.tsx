import { useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useCompleteOnboarding } from "@workspace/api-client-react";
import { GradientButton } from "@/components/GradientButton";
import { cn } from "@/lib/utils";
import { AVATAR_PRESETS, getAvatarImageUrl } from "@/components/AnonymousAvatar";

const NICKNAMES = [
  "Kabir", "Aryan", "Rohan", "Ishan", "Vihaan",
  "Arjun", "Dev", "Kian", "Syed", "Ayaan",
];

const AGE_BRACKETS = [
  { label: "Under 18", range: "< 18", value: 16 },
  { label: "18–24",    range: "18–24", value: 21 },
  { label: "25–34",    range: "25–34", value: 30 },
  { label: "35–49",    range: "35–49", value: 42 },
  { label: "50+",      range: "50+",   value: 55 },
];

export default function UserOnboarding() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<"age" | "nickname">("age");
  const [ageBracket, setAgeBracket] = useState<(typeof AGE_BRACKETS)[number]>(AGE_BRACKETS[1]);
  const [nickname, setNickname] = useState("");
  const [avatarSeed, setAvatarSeed] = useState<string>(AVATAR_PRESETS[0].id);

  const completeOnboarding = useCompleteOnboarding();

  function handleSubmit() {
    if (nickname.trim().length < 2) {
      toast.error("Nickname must be at least 2 characters.");
      return;
    }
    completeOnboarding.mutate(
      {
        data: {
          role: "user",
          anonymousUsername: nickname.trim(),
          avatarSeed,
          age: ageBracket.value,
        },
      },
      {
        onSuccess: () => {
          toast.success("Welcome to SunoSathi! 👂");
          setLocation("/home");
        },
        onError: (err: any) => toast.error(err?.message || "Setup failed. Please try again."),
      }
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-5"
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
        {/* Progress */}
        <div className="flex gap-2 mb-8">
          {(["age", "nickname"] as const).map((s, i) => (
            <div
              key={s}
              className={cn(
                "h-1.5 rounded-full flex-1 transition-all duration-500",
                step === s || (i === 0 && step === "nickname")
                  ? "bg-blue-500"
                  : "bg-white/15"
              )}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          {step === "age" && (
            <motion.div
              key="age"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <div className="text-center mb-8">
                <div className="w-14 h-14 rounded-2xl bg-blue-500/15 flex items-center justify-center mx-auto mb-4">
                  <span className="text-3xl">🎂</span>
                </div>
                <h1 className="text-2xl font-black mb-1.5 text-white">How old are you?</h1>
                <p className="text-sm text-white/45">
                  This helps us match you with the right listener.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2 mb-8">
                {AGE_BRACKETS.map((bracket) => (
                  <button
                    key={bracket.label}
                    type="button"
                    onClick={() => setAgeBracket(bracket)}
                    className={cn(
                      "w-full flex items-center justify-between px-5 py-3.5 rounded-2xl border-2 font-semibold text-sm transition-all",
                      ageBracket.label === bracket.label
                        ? "border-blue-500 bg-blue-500/15 text-blue-300"
                        : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                    )}
                  >
                    <span>{bracket.label}</span>
                    {ageBracket.label === bracket.label && (
                      <span className="text-blue-400 text-lg">✓</span>
                    )}
                  </button>
                ))}
              </div>

              <GradientButton
                className="w-full py-5 text-base"
                style={{ background: "linear-gradient(135deg, #3b82f6, #0ea5e9)" }}
                onClick={() => setStep("nickname")}
              >
                Continue →
              </GradientButton>
            </motion.div>
          )}

          {step === "nickname" && (
            <motion.div
              key="nickname"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <div className="text-center mb-6">
                {/* Live preview of selected avatar + name */}
                <div className="flex flex-col items-center gap-2 mb-4">
                  <div className="w-20 h-20 rounded-full overflow-hidden border-4 border-blue-500/40 shadow-lg shadow-blue-500/20">
                    <img
                      src={getAvatarImageUrl(avatarSeed) ?? ""}
                      alt="Selected avatar"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  {nickname.trim().length >= 2 && (
                    <div className="flex items-center gap-1.5 bg-blue-500/15 border border-blue-500/30 rounded-full px-3 py-1">
                      <span className="text-sm font-bold text-blue-300">{nickname}</span>
                      <span className="text-xs text-blue-400">✓ Verified</span>
                    </div>
                  )}
                </div>
                <h1 className="text-2xl font-black mb-1 text-white">Pick a nickname</h1>
                <p className="text-sm text-white/45">Stay anonymous — this is your only identity here.</p>
              </div>

              <div className="mb-4">
                <input
                  type="text"
                  value={nickname}
                  onChange={e => setNickname(e.target.value.slice(0, 24))}
                  placeholder="e.g. Kabir"
                  maxLength={24}
                  className="w-full rounded-2xl border-2 border-blue-500/30 bg-white/5 px-4 py-3.5 text-lg font-semibold text-center text-white placeholder:text-white/25 focus:outline-none focus:border-blue-400 transition"
                  autoFocus
                />
                <p className="text-xs text-white/35 mt-1.5 text-center">
                  {nickname.trim().length < 2
                    ? "At least 2 characters"
                    : `✓ Looks great, ${nickname}!`}
                </p>
              </div>

              <div className="mb-5">
                <p className="text-[10px] font-bold text-white/35 uppercase tracking-wider mb-2">✨ Suggestions</p>
                <div className="flex flex-wrap gap-1.5">
                  {NICKNAMES.map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setNickname(n)}
                      className={cn(
                        "text-xs px-3 py-1.5 rounded-full border font-semibold transition-all",
                        nickname === n
                          ? "bg-blue-500 text-white border-blue-500"
                          : "bg-blue-500/10 text-blue-300 border-blue-500/20 hover:bg-blue-500/20"
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-6">
                <p className="text-[10px] font-bold text-white/35 uppercase tracking-wider mb-3">Choose your avatar</p>
                <div className="grid grid-cols-4 gap-2">
                  {AVATAR_PRESETS.map(({ id, label }) => {
                    const url = getAvatarImageUrl(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setAvatarSeed(id)}
                        className={cn(
                          "flex flex-col items-center gap-1.5 p-2 rounded-2xl border-2 transition-all",
                          avatarSeed === id
                            ? "border-blue-500 bg-blue-500/20 shadow-md shadow-blue-500/25"
                            : "border-transparent bg-white/5 hover:bg-white/10"
                        )}
                      >
                        <div className="w-12 h-12 rounded-xl overflow-hidden">
                          {url && <img src={url} alt={label} className="w-full h-full object-cover" />}
                        </div>
                        <span className="text-[9px] font-bold text-white/50">{label}</span>
                        {avatarSeed === id && (
                          <span className="text-[8px] font-bold text-blue-400">✓ Selected</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep("age")}
                  className="flex-none px-4 py-3 rounded-2xl border-2 border-white/15 font-semibold text-white/50 hover:bg-white/5 transition text-sm"
                >
                  ← Back
                </button>
                <GradientButton
                  className="flex-1 py-3 text-sm"
                  style={{ background: "linear-gradient(135deg, #3b82f6, #0ea5e9)" }}
                  isLoading={completeOnboarding.isPending}
                  disabled={nickname.trim().length < 2}
                  onClick={handleSubmit}
                >
                  Enter SunoSathi 👂
                </GradientButton>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
