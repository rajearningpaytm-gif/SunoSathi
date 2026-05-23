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

// All male-presenting "top" (hair) options in DiceBear 9.x avataaars.
// We intentionally exclude every long-hair, hijab, bun, frida, curvy variant.
const MALE_TOP = [
  "shortHairShortFlat",
  "shortHairShortRound",
  "shortHairShortWaved",
  "shortHairShortCurly",
  "shortHairSides",
  "shortHairTheCaesar",
  "shortHairTheCaesarSidePart",
  "shortHairDreads01",
  "shortHairDreads02",
  "shortHairFrizzle",
  "shortHairShaggyMullet",
].join(",");

// Empty out anything that could read as feminine on avataaars
const NO_FEMININE_ACCESS = [
  "&accessories=blank",
  "&accessoriesProbability=0",
  "&facialHair=beardLight,beardMedium,beardMajestic,moustacheFancy,moustacheMagnum,blank",
  "&facialHairProbability=40",
  // No fancy clothes; keep it simple male t-shirt / hoodie palette
  "&clothing=hoodie,shirtCrewNeck,shirtScoopNeck,shirtVNeck,collarAndSweater,graphicShirt",
  "&clothesColor=262e33,3c4f5c,545454,65c9ff,5199e4,25557c,929598,a7ffc4,b1e2ff,e6e6e6",
].join("");

export function getAvatarImageUrl(seed: string): string | null {
  if (!seed.startsWith("av_")) return null;
  // Map each preset id to a stable, unique seed string so each card shows a
  // *different* but consistently male avatar across renders.
  const seedStr = seed.replace("av_", "boy-");
  return (
    `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(seedStr)}` +
    `&top=${MALE_TOP}` +
    `&hairColor=2c1b18,4a312c,724133,a55728,0e0e0e,000000` +
    `&skinColor=614335,ae5d29,d08b5b,edb98a,fd9841,f8d25c` +
    `&eyebrows=defaultNatural,flatNatural,raisedExcitedNatural,upDownNatural` +
    `&mouth=default,smile,serious,twinkle,tongue` +
    `&eyes=default,happy,squint,wink,side` +
    NO_FEMININE_ACCESS +
    `&backgroundColor=b45309,1e3a5f,78350f,1e1b4b,065f46`
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
