import { useMemo } from "react";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

interface AnonymousAvatarProps {
  seed: string;
  name: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

// Each id is a unique seed that ALWAYS produces a distinctly male-looking
// avataaars cartoon (short male hair only, no long-hair / hijab / bun / curly
// female styles, no earrings, no feminine accessories). Switched away from
// DiceBear "adventurer" which would render some seeds as female-coded bobs.
//
// Labels here are NOT shown in the UI — the user types their OWN name.
export const AVATAR_PRESETS = [
  { id: "av_m1", label: "Avatar 1" },
  { id: "av_m2", label: "Avatar 2" },
  { id: "av_m3", label: "Avatar 3" },
  { id: "av_m4", label: "Avatar 4" },
  { id: "av_m5", label: "Avatar 5" },
  { id: "av_m6", label: "Avatar 6" },
  { id: "av_m7", label: "Avatar 7" },
  { id: "av_m8", label: "Avatar 8" },
] as const;

// Each preset maps to a locally-bundled SVG in /public/avatars/.
// Pre-generated with DiceBear "personas" (male-default modern flat style) and
// committed to the repo so there is ZERO runtime dependency on api.dicebear.com.
// This also makes load instant and immune to network blocks / CORS / cache.
const SEED_TO_FILE: Record<string, string> = {
  av_m1: "boy-1.svg",
  av_m2: "boy-2.svg",
  av_m3: "boy-3.svg",
  av_m4: "boy-4.svg",
  av_m5: "boy-5.svg",
  av_m6: "boy-6.svg",
  av_m7: "boy-7.svg",
  av_m8: "boy-8.svg",
};

export function getAvatarImageUrl(seed: string): string | null {
  const file = SEED_TO_FILE[seed];
  if (!file) return null;
  // BASE_URL ensures the path works regardless of where the app is mounted.
  const base = (import.meta as any).env?.BASE_URL ?? "/";
  return `${base.replace(/\/$/, "")}/avatars/${file}`;
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export function AnonymousAvatar({ seed, name, size = "md", className }: AnonymousAvatarProps) {
  const imgUrl = getAvatarImageUrl(seed);

  const { h1, h2 } = useMemo(() => {
    const baseHash = hashString(seed || "default");
    const h1 = baseHash % 360;
    const h2 = (h1 + 60) % 360;
    return { h1, h2 };
  }, [seed]);

  const sizeClasses = {
    sm: "w-8 h-8 text-xs",
    md: "w-10 h-10 text-sm",
    lg: "w-16 h-16 text-lg",
    xl: "w-24 h-24 text-2xl",
  };

  if (imgUrl) {
    return (
      <div
        className={cn(
          "relative inline-flex items-center justify-center rounded-full overflow-hidden shrink-0 shadow-sm bg-muted",
          sizeClasses[size],
          className
        )}
      >
        <img src={imgUrl} alt={name} className="w-full h-full object-cover" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative inline-flex items-center justify-center rounded-full overflow-hidden shrink-0 shadow-sm",
        sizeClasses[size],
        className
      )}
      style={{
        background: `linear-gradient(135deg, hsl(${h1}, 80%, 65%), hsl(${h2}, 80%, 65%))`,
        color: "white",
        fontWeight: "bold",
      }}
    >
      <span className="opacity-90">{initials(name)}</span>
    </div>
  );
}
