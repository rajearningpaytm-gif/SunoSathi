import * as React from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface GradientButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
  isLoading?: boolean;
}

export const GradientButton = React.forwardRef<HTMLButtonElement, GradientButtonProps>(
  ({ className, variant = "primary", isLoading, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(
          "relative inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-medium text-white shadow-md transition-all active:scale-95 disabled:pointer-events-none disabled:opacity-70",
          variant === "primary"
            ? "bg-gradient-to-r from-pink-500 to-orange-400 hover:shadow-lg"
            : "bg-gradient-to-r from-purple-500 to-pink-500 hover:shadow-lg",
          className
        )}
        {...props}
      >
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {children}
      </button>
    );
  }
);
GradientButton.displayName = "GradientButton";
