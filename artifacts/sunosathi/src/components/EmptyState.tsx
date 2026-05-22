import { ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center p-8 py-16", className)}>
      <motion.div 
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
        className="w-32 h-32 mb-6 rounded-full bg-gradient-to-tr from-primary/20 to-secondary/20 flex items-center justify-center relative overflow-hidden"
      >
        <div className="absolute inset-0 bg-gradient-brand opacity-20 blur-2xl" />
        <div className="w-16 h-16 rounded-full bg-background shadow-sm border border-border/50" />
      </motion.div>
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground mb-6 max-w-sm text-balance">
        {description}
      </p>
      {action}
    </div>
  );
}
