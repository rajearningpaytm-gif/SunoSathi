import { motion } from "framer-motion";
import { Star } from "lucide-react";
import { Listener } from "@workspace/api-client-react";
import { Link } from "wouter";

interface ListenerCardProps {
  listener: Listener;
  showFreeConnect?: boolean;
}

export function ListenerCard({ listener, showFreeConnect = false }: ListenerCardProps) {
  return (
    <Link href={`/listeners/${listener.id}`}>
      <motion.div
        whileTap={{ scale: 0.97 }}
        className="rounded-[1.8rem] overflow-hidden flex flex-col cursor-pointer border border-border/40 bg-card shadow-sm hover:shadow-md transition-shadow"
      >
        {/* ── Photo ── */}
        <div className="relative aspect-[3/4] w-full overflow-hidden bg-muted">
          <img
            src={listener.photoUrl}
            alt={listener.displayName}
            className="w-full h-full object-cover"
            loading="lazy"
          />

          {/* Online dot — top-right only */}
          <div className="absolute top-2.5 right-2.5">
            {listener.isOnline ? (
              <span className="relative flex w-3.5 h-3.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full w-3.5 h-3.5 bg-green-500 border-[2px] border-white shadow-[0_0_8px_#22c55e]" />
              </span>
            ) : (
              <span className="w-3 h-3 rounded-full bg-gray-400/70 border-[2px] border-white/60 block" />
            )}
          </div>
        </div>

        {/* ── Bottom: Name + Rating + Connect ── */}
        <div className="px-3 pt-2.5 pb-2.5 flex flex-col gap-2">
          {/* Name LEFT — Rating RIGHT, single line */}
          <div className="flex items-center justify-between gap-1">
            <span
              className="text-base font-extrabold truncate leading-tight"
              style={{
                color: "#ffffff",
                WebkitTextFillColor: "#ffffff",
                textShadow: "0 1px 8px rgba(0,0,0,0.4)",
              }}
            >
              {listener.displayName}
            </span>
            <div className="flex items-center gap-0.5 shrink-0">
              <Star className="w-4 h-4 fill-yellow-400 drop-shadow-[0_0_4px_rgba(250,204,21,0.8)]" style={{ color: "#facc15" }} />
              <span
                className="text-sm font-extrabold"
                style={{
                  background: "linear-gradient(90deg, #fbbf24, #f59e0b)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                  filter: "drop-shadow(0 0 4px rgba(251,191,36,0.6))",
                }}
              >
                {listener.ratingAverage.toFixed(1)}
              </span>
            </div>
          </div>

          {/* Connect button */}
          <div className={`w-full text-center py-2 rounded-xl text-xs font-bold tracking-wide ${
            showFreeConnect
              ? "bg-green-500 text-white"
              : "bg-primary text-primary-foreground"
          }`}>
            {showFreeConnect ? "🎉 Free Connect" : "Connect"}
          </div>
        </div>
      </motion.div>
    </Link>
  );
}
