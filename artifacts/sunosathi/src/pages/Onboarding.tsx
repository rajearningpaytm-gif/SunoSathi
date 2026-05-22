import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

export default function Onboarding() {
  const [, setLocation] = useLocation();

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-5 py-8"
      style={{
        background:
          "linear-gradient(160deg, #0f0a1e 0%, #1a0f2e 45%, #0d1a2e 100%)",
      }}
    >
      <motion.div
        className="w-full max-w-sm"
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        {/* Header */}
        <div className="text-center mb-10">
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, type: "spring", stiffness: 220, damping: 18 }}
            className="w-20 h-20 rounded-3xl shadow-2xl flex items-center justify-center mx-auto mb-5"
            style={{
              background: "linear-gradient(135deg, #ec4899 0%, #f97316 50%, #8b5cf6 100%)",
            }}
          >
            <span className="text-4xl">👂</span>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <h1 className="text-2xl font-black mb-2 bg-gradient-to-r from-pink-500 via-purple-400 to-orange-400 bg-clip-text text-transparent">
              Welcome to SunoSathi!
            </h1>
            <p className="text-sm text-white/50 leading-relaxed">
              Tell us who you are so we can<br />set up your perfect experience.
            </p>
          </motion.div>
        </div>

        {/* Role cards */}
        <div className="space-y-4">

          {/* Male — Seeker */}
          <motion.button
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            whileHover={{ scale: 1.025 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setLocation("/onboarding/user")}
            className="w-full text-left rounded-3xl overflow-hidden shadow-lg focus:outline-none group relative"
          >
            <div
              className="absolute inset-0"
              style={{
                background: "linear-gradient(135deg, #3b82f6 0%, #0ea5e9 100%)",
              }}
            />
            <div className="relative px-5 py-5 flex items-center gap-4">
              <div className="w-[72px] h-[72px] rounded-2xl bg-white/20 flex items-center justify-center shrink-0 shadow-inner backdrop-blur-sm">
                <span className="text-4xl">👨</span>
              </div>

              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-white font-black text-lg">I am a Guy</span>
                  <span className="bg-white/25 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
                    Seeker
                  </span>
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
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4, duration: 0.4 }}
            whileHover={{ scale: 1.025 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setLocation("/onboarding/listener")}
            className="w-full text-left rounded-3xl overflow-hidden shadow-lg focus:outline-none group relative"
          >
            <div
              className="absolute inset-0"
              style={{
                background: "linear-gradient(135deg, #ec4899 0%, #f43f5e 100%)",
              }}
            />
            <div className="relative px-5 py-5 flex items-center gap-4">
              <div className="w-[72px] h-[72px] rounded-2xl bg-white/20 flex items-center justify-center shrink-0 shadow-inner backdrop-blur-sm">
                <span className="text-4xl">👩</span>
              </div>

              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-white font-black text-lg">I am a Girl</span>
                  <span className="bg-white/25 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
                    Listener
                  </span>
                </div>
                <p className="text-pink-100 text-xs leading-relaxed">
                  Become a verified listener. Listen to people &amp; help others.
                </p>
              </div>

              <ArrowRight className="w-5 h-5 text-white/70 group-hover:translate-x-1 transition-transform shrink-0" />
            </div>
          </motion.button>
        </div>

        {/* Trust line */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-center text-[11px] text-white/35 mt-7 flex items-center justify-center gap-1.5"
        >
          <span>🔒</span>
          Your identity stays completely anonymous at all times.
        </motion.p>

        {/* Stats bar */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="flex items-center justify-center gap-6 mt-5 px-4 py-3 rounded-2xl backdrop-blur"
          style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          {[
            { value: "10K+", label: "Users" },
            { value: "500+", label: "Listeners" },
            { value: "4.8★", label: "Rating" },
          ].map(({ value, label }) => (
            <div key={label} className="text-center">
              <p className="text-sm font-black text-white">{value}</p>
              <p className="text-[9px] text-white/40 font-medium">{label}</p>
            </div>
          ))}
        </motion.div>
      </motion.div>
    </div>
  );
}
