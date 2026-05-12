import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface MoodPillProps {
  label: string;
  count: number;
  isActive?: boolean;
  onClick?: () => void;
}

export function MoodPill({ label, count, isActive, onClick }: MoodPillProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className={cn(
        "relative flex-none px-4 py-2.5 rounded-full text-sm font-bold transition-all overflow-hidden border snap-start",
        isActive
          ? "border-primary bg-primary/10 text-primary shadow-sm"
          : "border-border bg-card text-foreground/70 hover:border-primary/30"
      )}
    >
      {isActive && (
        <motion.div
          layoutId="mood-pill-active"
          className="absolute inset-0 bg-primary/10 -z-10"
          initial={false}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
        />
      )}
      <span className="relative z-10 flex items-center gap-1.5">
        {label}
        <span className={cn(
          "text-[10px] px-1.5 py-0.5 rounded-full font-semibold",
          isActive ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
        )}>
          {count}
        </span>
      </span>
    </motion.button>
  );
}
