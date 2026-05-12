import { motion } from "framer-motion";
import { Link, useLocation } from "wouter";
import {
  ShieldCheck, Heart, Clock, Star, CheckCircle2,
  Zap, Users, Award, TrendingUp, Mail, MessageCircle as WhatsAppIcon,
} from "lucide-react";
import { ListenerGender } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

const MOCK_LISTENERS = [
  { id: "m1", displayName: "Aarya", gender: ListenerGender.female, skills: ["Anxiety", "Relationships", "Empathy"], photoUrl: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=500&q=80", ratingAverage: 4.9, ratingCount: 214, isOnline: true },
  { id: "m2", displayName: "Kabir", gender: ListenerGender.male, skills: ["Career", "Stress", "Motivation"], photoUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=500&q=80", ratingAverage: 4.8, ratingCount: 178, isOnline: true },
  { id: "m3", displayName: "Priya", gender: ListenerGender.female, skills: ["Breakup", "Loneliness", "Sadness"], photoUrl: "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=500&q=80", ratingAverage: 5.0, ratingCount: 302, isOnline: true },
  { id: "m4", displayName: "Rohan", gender: ListenerGender.male, skills: ["Depression", "Anxiety", "Relationships"], photoUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=500&q=80", ratingAverage: 4.7, ratingCount: 95, isOnline: false },
  { id: "m5", displayName: "Neha", gender: ListenerGender.female, skills: ["Trauma", "Grief", "Self-worth"], photoUrl: "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=500&q=80", ratingAverage: 4.9, ratingCount: 411, isOnline: true },
  { id: "m6", displayName: "Dev", gender: ListenerGender.male, skills: ["Career", "Breakup", "Motivation"], photoUrl: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=500&q=80", ratingAverage: 4.8, ratingCount: 133, isOnline: true },
];

const REVIEWS = [
  { name: "QuietMoon27", rating: 5, time: "2 days ago", text: "I was crying at 3 AM with no one to talk to. Aarya picked up instantly and stayed with me for an hour. SunoSathi saved me that night." },
  { name: "Ishan_R", rating: 5, time: "5 days ago", text: "Felt judged everywhere else. Here nobody knows my name and I can just talk freely. The listener really understood my anxiety." },
  { name: "SilentRiver", rating: 5, time: "1 week ago", text: "After my breakup I had no one. Priya helped me process it without telling me what to do. Just listened. That's all I needed." },
];

const STEPS = [
  { icon: "🎭", title: "Pick a nickname", desc: "Stay 100% anonymous. No real name, no face, no judgement." },
  { icon: "👂", title: "Choose a listener", desc: "Browse verified listeners by mood, gender or availability." },
  { icon: "💬", title: "Start talking", desc: "Chat or voice call. Your first minute is always free." },
];

const STATS = [
  { icon: Users,      value: "2,400+", label: "People helped",      color: "text-pink-400"   },
  { icon: Award,      value: "35+",    label: "Verified listeners", color: "text-purple-400" },
  { icon: Star,       value: "4.9 ★",  label: "Average rating",     color: "text-amber-400"  },
  { icon: TrendingUp, value: "24/7",   label: "Always online",      color: "text-blue-400"   },
];

const TRUST = [
  { icon: ShieldCheck,  color: "text-primary",   bg: "bg-primary/15",   title: "100% Anonymous",     desc: "No real name, no phone, no face. Just a nickname." },
  { icon: CheckCircle2, color: "text-green-400",  bg: "bg-green-500/15", title: "Verified & Trained", desc: "Every listener is manually reviewed before going live." },
  { icon: Heart,        color: "text-rose-400",   bg: "bg-rose-500/15",  title: "Non-judgemental",    desc: "Say what you feel — no shame, no unwanted advice." },
  { icon: Clock,        color: "text-blue-400",   bg: "bg-blue-500/15",  title: "Available 24 / 7",   desc: "2 AM panic? Bad day at work? Someone is always there." },
];

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.08, duration: 0.5 } }),
};

export default function Landing() {
  const [, setLocation] = useLocation();
  const goToSignUp = () => setLocation("/auth");
  const goToSignIn = () => setLocation("/auth?mode=login");

  return (
    <div
      className="min-h-screen flex flex-col overflow-x-hidden"
      style={{ background: "linear-gradient(160deg, #0f0a1e 0%, #1a0f2e 45%, #0d1a2e 100%)" }}
    >
      {/* Ambient glow orbs */}
      <div className="fixed top-[-60px] left-1/2 -translate-x-1/2 w-80 h-80 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(236,72,153,0.15) 0%, transparent 70%)", filter: "blur(48px)" }} />
      <div className="fixed top-48 right-[-40px] w-64 h-64 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(139,92,246,0.12) 0%, transparent 70%)", filter: "blur(50px)" }} />

      {/* ── Sticky header ─────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-50 backdrop-blur-xl border-b px-5 py-3 flex items-center justify-between max-w-md mx-auto w-full"
        style={{ background: "rgba(15,10,30,0.85)", borderColor: "rgba(255,255,255,0.08)" }}
      >
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-gradient-brand rounded-lg flex items-center justify-center shadow-sm">
            <span className="text-sm">👂</span>
          </div>
          <span className="font-bold text-base text-gradient-brand">SunoSathi</span>
        </div>
        <button
          onClick={goToSignIn}
          className="text-xs font-semibold px-3 py-1.5 rounded-full border border-primary/30 text-primary hover:bg-primary/10 transition"
          style={{ background: "rgba(255,255,255,0.05)" }}
        >
          Sign In
        </button>
      </header>

      <main className="flex-1 max-w-md mx-auto w-full">

        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section className="relative px-6 pt-10 pb-10 text-center overflow-hidden">
          <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.1 } } }}>

            <motion.div variants={fadeUp} custom={0}>
              <div className="inline-flex items-center gap-2 bg-green-500/10 text-green-400 text-xs font-bold px-3 py-1.5 rounded-full border border-green-500/20 mb-6">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                {MOCK_LISTENERS.filter(l => l.isOnline).length} listeners online right now
              </div>
            </motion.div>

            <motion.h1 variants={fadeUp} custom={1}
              className="text-[2.6rem] font-extrabold leading-[1.1] tracking-tight text-white mb-4">
              Someone is<br /><span className="text-gradient-brand">listening.</span>
            </motion.h1>

            <motion.p variants={fadeUp} custom={2}
              className="text-base text-white/45 leading-relaxed mb-8 max-w-xs mx-auto">
              Talk to a verified, caring listener whenever you need — anonymous and judgement-free.
            </motion.p>

            {/* CTA Buttons */}
            <motion.div variants={fadeUp} custom={3} className="space-y-3 px-2">
              <button
                onClick={goToSignUp}
                className="w-full py-4 rounded-2xl font-bold text-base text-white shadow-lg transition-all active:scale-[0.98] hover:shadow-xl"
                style={{
                  background: "linear-gradient(135deg, hsl(310,70%,55%) 0%, hsl(340,80%,60%) 50%, hsl(25,85%,60%) 100%)",
                  boxShadow: "0 8px 32px rgba(200,60,120,0.30), 0 2px 8px rgba(200,60,120,0.15)",
                }}
              >
                Start Talking Now — Sign Up
              </button>

              <button
                onClick={goToSignIn}
                className="w-full py-4 rounded-2xl font-semibold text-sm transition-all active:scale-[0.98]"
                style={{
                  background: "rgba(255,255,255,0.07)",
                  backdropFilter: "blur(16px)",
                  WebkitBackdropFilter: "blur(16px)",
                  border: "1.5px solid rgba(200,100,180,0.25)",
                  color: "hsl(310,60%,75%)",
                }}
              >
                Already have an account? <span className="font-bold">Sign In →</span>
              </button>
            </motion.div>

          </motion.div>
        </section>

        {/* ── Stats grid ───────────────────────────────────────────────── */}
        <section className="px-4 pb-10">
          <div className="grid grid-cols-2 gap-3">
            {STATS.map((s, i) => (
              <motion.div key={s.label}
                initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 + i * 0.07 }}
                className="rounded-2xl p-4 flex items-center gap-3"
                style={{ background: "rgba(255,255,255,0.06)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.06)" }}>
                  <s.icon className={cn("w-5 h-5", s.color)} />
                </div>
                <div>
                  <p className={cn("text-lg font-extrabold leading-none", s.color)}>{s.value}</p>
                  <p className="text-[11px] text-white/35 mt-0.5">{s.label}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ── Listener cards ──────────────────────────────────────────── */}
        <section className="pb-12">
          <div className="px-5 mb-4 flex items-end justify-between">
            <div>
              <h2 className="text-xl font-bold text-white">Our Listeners</h2>
              <p className="text-xs text-white/35 mt-0.5">First minute free · Swipe to explore</p>
            </div>
            <button onClick={goToSignUp} className="text-xs text-primary font-semibold hover:underline">See all →</button>
          </div>
          <div className="flex overflow-x-auto gap-4 pb-3 px-5 snap-x" style={{ scrollbarWidth: "none" }}>
            {MOCK_LISTENERS.map((listener, i) => (
              <motion.div key={listener.id}
                initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.06 }}
                className="w-[170px] shrink-0 snap-start" onClick={goToSignUp}>
                <div className="rounded-[1.5rem] overflow-hidden cursor-pointer hover:scale-[1.02] transition-transform active:scale-[0.98]"
                  style={{ background: "rgba(255,255,255,0.07)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 4px 20px rgba(0,0,0,0.3)" }}>
                  <div className="relative aspect-[3/4] w-full overflow-hidden bg-muted">
                    <img src={listener.photoUrl} alt={listener.displayName} className="w-full h-full object-cover" loading="lazy" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                    <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-black/50 backdrop-blur px-2 py-0.5 rounded-full">
                      <span className={cn("w-1.5 h-1.5 rounded-full", listener.isOnline ? "bg-green-400 animate-pulse" : "bg-gray-400")} />
                      <span className="text-[10px] font-medium text-white">{listener.isOnline ? "Online" : "Away"}</span>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 p-3">
                      <p className="font-bold text-base text-white">{listener.displayName}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                        <span className="text-xs font-semibold text-white">{listener.ratingAverage}</span>
                        <span className="text-[10px] text-white/60">({listener.ratingCount})</span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {listener.skills.slice(0, 2).map(s => (
                          <span key={s} className="text-[9px] font-medium px-1.5 py-0.5 bg-white/15 backdrop-blur rounded-full border border-white/10 text-white">{s}</span>
                        ))}
                      </div>
                      <div className="mt-2.5 w-full bg-green-500 text-white rounded-xl py-1.5 text-[10px] font-bold flex items-center justify-center gap-1">
                        <Zap className="w-2.5 h-2.5 shrink-0" /> Free 1 min
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
            <div onClick={goToSignUp}
              className="w-[130px] shrink-0 snap-start flex flex-col items-center justify-center rounded-[1.5rem] border-2 border-dashed cursor-pointer hover:border-primary/40 transition p-4 text-center gap-3"
              style={{ background: "rgba(255,255,255,0.05)", backdropFilter: "blur(12px)", borderColor: "rgba(200,100,180,0.25)" }}>
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-lg font-bold text-primary">+</span>
              </div>
              <p className="text-xs font-semibold text-white/40 leading-tight">25 more listeners inside</p>
              <span className="text-[10px] text-primary font-bold">Sign up free →</span>
            </div>
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────────── */}
        <section className="px-5 pb-16">
          <h2 className="text-xl font-bold mb-6 text-center text-white">How it works</h2>
          <div className="space-y-4">
            {STEPS.map((step, i) => (
              <motion.div key={i}
                initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                className="flex gap-4 items-start p-4 rounded-2xl"
                style={{ background: "rgba(255,255,255,0.06)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="w-12 h-12 shrink-0 rounded-2xl bg-gradient-brand flex items-center justify-center text-2xl shadow-sm">{step.icon}</div>
                <div className="pt-0.5">
                  <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Step {i + 1}</span>
                  <p className="font-bold text-base mt-0.5 text-white">{step.title}</p>
                  <p className="text-sm text-white/45 mt-0.5">{step.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ── Why trust us ─────────────────────────────────────────────── */}
        <section
          className="px-5 pb-16 pt-12 border-y"
          style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.07)" }}
        >
          <h2 className="text-xl font-bold mb-8 text-center text-white">Why people trust us</h2>
          <div className="space-y-5">
            {TRUST.map(({ icon: Icon, color, bg, title, desc }, i) => (
              <motion.div key={title}
                initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }} transition={{ delay: i * 0.08 }}
                className="flex gap-4 items-start">
                <div className={cn("w-10 h-10 shrink-0 rounded-xl flex items-center justify-center", bg)}>
                  <Icon className={cn("w-5 h-5", color)} />
                </div>
                <div>
                  <p className="font-semibold text-white">{title}</p>
                  <p className="text-sm text-white/45">{desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ── Testimonials ─────────────────────────────────────────────── */}
        <section className="px-5 pt-12 pb-12">
          <h2 className="text-xl font-bold mb-2 text-center text-white">What people say</h2>
          <p className="text-center text-xs text-white/30 mb-7">All usernames are anonymous</p>
          <div className="space-y-4">
            {REVIEWS.map((r, i) => (
              <motion.div key={i}
                initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                className="p-5 rounded-2xl"
                style={{ background: "rgba(255,255,255,0.06)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-gradient-brand flex items-center justify-center text-white font-bold text-sm shadow-sm">{r.name[0]}</div>
                    <div>
                      <p className="font-semibold text-sm text-white">{r.name}</p>
                      <p className="text-[10px] text-white/30">{r.time}</p>
                    </div>
                  </div>
                  <div className="flex gap-0.5">{Array.from({ length: r.rating }).map((_, j) => <Star key={j} className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />)}</div>
                </div>
                <p className="text-sm text-white/50 leading-relaxed">"{r.text}"</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ── Free trial ───────────────────────────────────────────────── */}
        <section className="px-5 pb-12">
          <motion.div
            initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            className="rounded-3xl border border-green-500/25 p-6 text-center"
            style={{ background: "rgba(34,197,94,0.07)" }}
          >
            <div className="w-14 h-14 rounded-2xl bg-green-500/15 flex items-center justify-center mx-auto mb-4">
              <Zap className="w-7 h-7 text-green-400" />
            </div>
            <p className="text-lg font-extrabold mb-1 text-white">First minute — always free</p>
            <p className="text-sm text-white/40 mb-5 leading-relaxed max-w-xs mx-auto">Connect with any listener and talk for a full minute before deciding. No commitment, no upfront payment.</p>
            <button onClick={goToSignUp} className="bg-green-500 hover:bg-green-600 text-white font-bold px-8 py-3 rounded-2xl text-sm transition shadow-lg shadow-green-500/20">
              Try it Free →
            </button>
          </motion.div>
        </section>

        {/* ── Final CTA ────────────────────────────────────────────────── */}
        <section className="px-5 pb-16">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }}
            className="bg-gradient-brand rounded-3xl p-8 text-center text-white shadow-2xl shadow-primary/30 relative overflow-hidden">
            <div className="absolute inset-0 opacity-20 pointer-events-none"
              style={{ backgroundImage: "radial-gradient(circle at 30% 20%, white 0%, transparent 50%), radial-gradient(circle at 70% 80%, white 0%, transparent 50%)" }} />
            <p className="text-3xl font-extrabold mb-2 relative">You deserve to be heard.</p>
            <p className="text-white/80 text-sm mb-6 relative">Join 2,400+ people already talking.</p>
            <div className="flex flex-col gap-3 relative">
              <button onClick={goToSignUp} className="bg-white text-primary font-bold px-8 py-3.5 rounded-2xl hover:bg-white/90 transition text-sm shadow-lg">
                Start for Free →
              </button>
              <button onClick={goToSignIn} className="font-medium text-white/80 hover:text-white text-sm transition py-1">
                Already a member? Sign In
              </button>
            </div>
          </motion.div>
        </section>

      </main>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer
        className="border-t py-8 px-5 max-w-md mx-auto w-full"
        style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.07)" }}
      >
        <div className="flex items-center gap-2 justify-center mb-1">
          <div className="w-6 h-6 bg-gradient-brand rounded-lg flex items-center justify-center"><span className="text-xs">👂</span></div>
          <span className="font-bold text-sm text-gradient-brand">SunoSathi</span>
        </div>
        <p className="text-center text-xs text-white/30 mb-5">Emotional support, always available.</p>
        <div className="flex flex-col gap-2 mb-5">
          <a href="mailto:rajsocialtalkk@gmail.com"
            className="flex items-center gap-3 bg-primary/5 hover:bg-primary/10 border border-primary/15 rounded-2xl px-4 py-3 transition group">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0"><Mail className="w-4 h-4 text-primary" /></div>
            <div>
              <p className="text-xs font-bold text-white group-hover:text-primary transition">Email Support</p>
              <p className="text-[11px] text-white/30">rajsocialtalkk@gmail.com</p>
            </div>
          </a>
          <a href="https://wa.me/919967785330" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-3 bg-green-500/5 hover:bg-green-500/10 border border-green-500/20 rounded-2xl px-4 py-3 transition group">
            <div className="w-8 h-8 rounded-xl bg-green-500/10 flex items-center justify-center shrink-0"><WhatsAppIcon className="w-4 h-4 text-green-400" /></div>
            <div>
              <p className="text-xs font-bold text-white group-hover:text-green-400 transition">WhatsApp Support</p>
              <p className="text-[11px] text-white/30">Chat with us directly</p>
            </div>
          </a>
        </div>
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 mb-4">
          <Link href="/legal/terms" className="text-xs text-white/30 hover:text-primary transition-colors">Terms</Link>
          <Link href="/legal/privacy" className="text-xs text-white/30 hover:text-primary transition-colors">Privacy</Link>
          <Link href="/legal/safety" className="text-xs text-white/30 hover:text-primary transition-colors">Safety</Link>
          <Link href="/legal/disclaimer" className="text-xs text-white/30 hover:text-primary transition-colors">Disclaimer</Link>
        </div>
        <p className="text-center text-[11px] text-white/20">© 2026 SunoSathi. All rights reserved.</p>
      </footer>
    </div>
  );
}
