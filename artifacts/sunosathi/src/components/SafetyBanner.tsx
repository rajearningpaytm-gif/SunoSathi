import { useEffect, useRef } from "react";

const WARNINGS = [
  { emoji: "⚠️", text: "Sexual talks ya harassment bilkul allowed nahi hai" },
  { emoji: "🤝", text: "Listeners ke saath respectful rehna zaroori hai" },
  { emoji: "📵", text: "Phone number, email ya social media share mat karo" },
  { emoji: "🔒", text: "Anonymous raho — real identity reveal mat karo" },
  { emoji: "🆘", text: "Emergency mein 112 pe call karo" },
  { emoji: "✅", text: "Galat behave kare toh turant report karo" },
  { emoji: "🚫", text: "Abusive language par account permanently ban hoga" },
];

export function SafetyBanner() {
  const trackRef = useRef<HTMLDivElement>(null);

  // CSS animation via injected <style> so it works regardless of Tailwind config
  useEffect(() => {
    const id = "ss-marquee-style";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      @keyframes ss-marquee {
        0%   { transform: translateX(0); }
        100% { transform: translateX(-50%); }
      }
      .ss-marquee-track {
        animation: ss-marquee 6s linear infinite;
        display: flex;
        white-space: nowrap;
      }
      .ss-marquee-track:hover {
        animation-play-state: paused;
      }
    `;
    document.head.appendChild(style);
  }, []);

  const items = [...WARNINGS, ...WARNINGS];

  return (
    <div
      style={{
        background: "#FDD835",
        borderBottom: "1px solid #F9A825",
        overflow: "hidden",
        position: "relative",
        userSelect: "none",
        width: "100%",
      }}
    >

      <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "1px 8px", position: "relative" }}>
        {/* Shield badge */}
        <span style={{ fontSize: "15px", flexShrink: 0, filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.2))" }}>
          🛡️
        </span>

        {/* Scroll track container */}
        <div style={{ overflow: "hidden", flex: 1, position: "relative" }}>
          {/* Left fade */}
          <div style={{
            position: "absolute", left: 0, top: 0, bottom: 0, width: "10px", zIndex: 2, pointerEvents: "none",
            background: "linear-gradient(to right, #FDD835, transparent)",
          }} />
          {/* Right fade */}
          <div style={{
            position: "absolute", right: 0, top: 0, bottom: 0, width: "10px", zIndex: 2, pointerEvents: "none",
            background: "linear-gradient(to left, #FDD835, transparent)",
          }} />

          {/* Marquee track */}
          <div ref={trackRef} className="ss-marquee-track" style={{ gap: "3rem" }}>
            {items.map((w, i) => (
              <span
                key={i}
                style={{
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  fontSize: "15px",
                  fontWeight: 700,
                  color: "#1A1A1A",
                  letterSpacing: "0.01em",
                  textShadow: "0 1px 0 rgba(255,255,255,0.6)",
                }}
              >
                <span>{w.emoji}</span>
                <span>{w.text}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
