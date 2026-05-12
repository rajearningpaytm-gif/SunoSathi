import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";

export default function SplashScreen() {
  const [, setLocation] = useLocation();
  const [phase, setPhase] = useState<"in" | "out">("in");

  useEffect(() => {
    // Start exit animation at 3.1s, navigate at 3.6s
    const exitTimer = setTimeout(() => setPhase("out"), 3100);
    const navTimer  = setTimeout(() => setLocation("/auth"), 3600);
    return () => {
      clearTimeout(exitTimer);
      clearTimeout(navTimer);
    };
  }, [setLocation]);

  return (
    <AnimatePresence>
      {phase === "in" && (
        <motion.div
          key="splash"
          className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden"
          style={{
            background:
              "linear-gradient(160deg, hsl(290,70%,12%) 0%, hsl(265,60%,18%) 45%, hsl(240,65%,14%) 100%)",
          }}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
        >
          {/* ── Background radial glow ──────────────────────────── */}
          <motion.div
            className="absolute w-[340px] h-[340px] rounded-full pointer-events-none"
            style={{
              background:
                "radial-gradient(circle, rgba(236,72,153,0.22) 0%, rgba(139,92,246,0.14) 50%, transparent 72%)",
            }}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 1.4, ease: "easeOut" }}
          />

          {/* ── Second softer glow layer ────────────────────────── */}
          <motion.div
            className="absolute w-[500px] h-[500px] rounded-full pointer-events-none"
            style={{
              background:
                "radial-gradient(circle, rgba(249,115,22,0.08) 0%, transparent 65%)",
            }}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 1.8, ease: "easeOut", delay: 0.2 }}
          />

          {/* ── Logo ──────────────────────────────────────────────── */}
          <motion.div
            className="relative mb-8"
            initial={{ scale: 0.25, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{
              type: "spring",
              stiffness: 180,
              damping: 18,
              delay: 0.12,
            }}
          >
            {/* Glow halo behind the logo tile */}
            <div
              className="absolute inset-0 rounded-[2.2rem] blur-2xl scale-125 opacity-70"
              style={{
                background:
                  "linear-gradient(135deg, #ec4899 0%, #f97316 50%, #8b5cf6 100%)",
              }}
            />
            <div
              className="relative w-[110px] h-[110px] rounded-[2.2rem] flex items-center justify-center shadow-2xl"
              style={{
                background:
                  "linear-gradient(135deg, #ec4899 0%, #f97316 50%, #8b5cf6 100%)",
                boxShadow:
                  "0 0 48px rgba(236,72,153,0.55), 0 24px 48px rgba(0,0,0,0.45)",
              }}
            >
              <span className="text-[3.4rem] leading-none select-none">👂</span>
            </div>
          </motion.div>

          {/* ── App name ──────────────────────────────────────────── */}
          <motion.h1
            className="text-[2.6rem] font-black tracking-tight text-white mb-2 leading-none"
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.52, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          >
            Suno
            <span
              style={{
                background:
                  "linear-gradient(90deg, #f97316 0%, #ec4899 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Sathi
            </span>
          </motion.h1>

          {/* ── Tagline ───────────────────────────────────────────── */}
          <motion.p
            className="text-[1rem] font-semibold tracking-widest uppercase"
            style={{ color: "rgba(255,255,255,0.55)", letterSpacing: "0.18em" }}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.88, duration: 0.5, ease: "easeOut" }}
          >
            Talk with heart&nbsp;
            <motion.span
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                delay: 1.3,
                type: "spring",
                stiffness: 300,
                damping: 14,
              }}
              style={{ display: "inline-block" }}
            >
              ❤️
            </motion.span>
          </motion.p>

          {/* ── Subtle shimmer line at bottom ─────────────────────── */}
          <motion.div
            className="absolute bottom-16 left-1/2 -translate-x-1/2 h-0.5 rounded-full"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(236,72,153,0.5), rgba(249,115,22,0.5), transparent)",
              width: 120,
            }}
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 1 }}
            transition={{ delay: 1.1, duration: 0.7, ease: "easeOut" }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
