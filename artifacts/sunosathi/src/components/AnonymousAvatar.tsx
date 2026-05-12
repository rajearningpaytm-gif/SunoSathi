import { useMemo } from "react";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

interface AnonymousAvatarProps {
  seed: string;
  name: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

// ── Desi Indian style avatar catalogue ───────────────────────────────────────
export const AVATAR_PRESETS = [
  { id: "av_arjun",  label: "Arjun"  },
  { id: "av_rahul",  label: "Rahul"  },
  { id: "av_vikas",  label: "Vikas"  },
  { id: "av_rohit",  label: "Rohit"  },
  { id: "av_aakash", label: "Aakash" },
  { id: "av_deepak", label: "Deepak" },
  { id: "av_kiran",  label: "Kiran"  },
  { id: "av_manish", label: "Manish" },
] as const;

export function getAvatarImageUrl(seed: string): string | null {
  if (!seed.startsWith("av_")) return null;
  const name = seed.replace("av_", "");
  // micah style — illustrated human faces with South-Asian / desi skin tones
  return (
    `https://api.dicebear.com/9.x/micah/svg?seed=${encodeURIComponent(name)}` +
    `&backgroundColor=7c3aed,be185d,d97706,0d9488,1d4ed8` +
    `&baseColor=f9c9b6,ac6651,77311d` +
    `&facialHairProbability=30`
  );
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
