import { useEffect } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { useGetMyProfile, getGetMyProfileQueryKey } from "@workspace/api-client-react";
import { Clock, XCircle } from "lucide-react";

export default function PendingApproval() {
  const [, setLocation] = useLocation();

  const { data: profile } = useGetMyProfile({
    query: { queryKey: getGetMyProfileQueryKey(), refetchInterval: 10_000 },
  });

  useEffect(() => {
    const status = profile?.listenerProfile?.applicationStatus;
    if (status === "approved") {
      setLocation("/earnings");
    }
  }, [profile, setLocation]);

  const status = profile?.listenerProfile?.applicationStatus ?? "pending";
  const rejectionReason = profile?.listenerProfile?.rejectionReason;

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-5"
      style={{
        background: "linear-gradient(160deg, #0f0a1e 0%, #1a0f2e 45%, #0d1a2e 100%)",
      }}
    >
      <motion.div
        className="w-full max-w-sm text-center"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        {status === "rejected" ? (
          <>
            <div className="w-20 h-20 rounded-full bg-red-500/15 flex items-center justify-center mx-auto mb-5">
              <XCircle className="w-10 h-10 text-red-400" />
            </div>
            <h1 className="text-2xl font-black mb-2 text-red-400">Application Rejected</h1>
            <p className="text-sm text-white/45 mb-4 leading-relaxed">
              Unfortunately, your application wasn't approved this time.
            </p>
            {rejectionReason && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 mb-6 text-left">
                <p className="text-xs font-semibold text-red-400 mb-1">Reason:</p>
                <p className="text-sm text-red-300">{rejectionReason}</p>
              </div>
            )}
            <button
              onClick={() => setLocation("/onboarding/listener")}
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-pink-500 to-rose-500 text-white font-bold shadow-md hover:opacity-90 transition"
            >
              Reapply →
            </button>
          </>
        ) : (
          <>
            <motion.div
              className="w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg"
              style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.25), rgba(236,72,153,0.25))" }}
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <Clock className="w-12 h-12 text-violet-400" />
            </motion.div>

            <h1 className="text-2xl font-black mb-2 text-white">Under Review</h1>
            <p className="text-sm text-white/45 leading-relaxed mb-6">
              Your listener application is being reviewed by our team.
              This usually takes <strong className="text-white">24–48 hours</strong>.
            </p>

            <div
              className="rounded-2xl p-5 border text-left space-y-3 mb-6"
              style={{ background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.1)" }}
            >
              <p className="text-xs font-bold text-white/35 uppercase tracking-wider">What happens next</p>
              {[
                { emoji: "📋", text: "Our team reviews your profile and bio" },
                { emoji: "✅", text: "You get approved and can go online" },
                { emoji: "💰", text: "Start earning ₹2–4 per minute" },
              ].map(({ emoji, text }) => (
                <div key={text} className="flex items-start gap-3">
                  <span className="text-lg">{emoji}</span>
                  <p className="text-sm text-white/45">{text}</p>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-center gap-2 text-xs text-white/30">
              <motion.div
                className="w-2 h-2 rounded-full bg-violet-400"
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
              Checking status automatically every 10 seconds…
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
