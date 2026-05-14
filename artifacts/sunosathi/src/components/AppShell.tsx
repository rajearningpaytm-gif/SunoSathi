import { motion } from "framer-motion";
import { Link, useLocation } from "wouter";
import { Home, MessageCircle, Wallet as WalletIcon, Settings, TrendingUp } from "lucide-react";
import { useGetMyProfile, useGetWallet } from "@workspace/api-client-react";
import { AnonymousAvatar } from "./AnonymousAvatar";
import { formatRupees } from "@/lib/format";
import { useState, useEffect } from "react";

const FULLSCREEN_PREFIXES = ["/chat/", "/call/", "/admin"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: profile } = useGetMyProfile();
  const { data: wallet } = useGetWallet();
  const [listenerSelf, setListenerSelf] = useState<{ displayName: string; photoUrl: string } | null>(null);

  // Fetch listener's chosen name + portrait for the header
  useEffect(() => {
    if (profile?.role !== "listener") return;
    fetch("/api/listener/me", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then((d: { displayName: string; photoUrl: string } | null) => {
        if (d?.displayName) setListenerSelf(d);
      })
      .catch(() => {});
  }, [profile?.role]);

  if (!profile) return <>{children}</>;

  const isFullScreen = FULLSCREEN_PREFIXES.some(p => location === p || location.startsWith(p + "/") || location.startsWith(p));
  if (isFullScreen) return <>{children}</>;

  const isUser = profile.role === "user";
  const headerName  = (!isUser && listenerSelf) ? listenerSelf.displayName : profile.anonymousUsername;
  const headerPhoto = (!isUser && listenerSelf?.photoUrl) ? listenerSelf.photoUrl : null;

  const navItems = isUser
    ? [
        { path: "/home",     label: "Home",        icon: Home },
        { path: "/chats",    label: "Chats", icon: MessageCircle },
        { path: "/wallet",   label: "Wallet",       icon: WalletIcon },
        { path: "/settings", label: "Settings",     icon: Settings },
      ]
    : [
        { path: "/home",     label: "Home",        icon: Home },
        { path: "/chats",    label: "Chats", icon: MessageCircle },
        { path: "/earnings", label: "Earnings",     icon: TrendingUp },
        { path: "/settings", label: "Settings",     icon: Settings },
      ];

  return (
    <div className="min-h-[100dvh] flex flex-col text-foreground relative">

      {/* ── Sticky top header ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-card/80 backdrop-blur-xl border-b border-border/40 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {headerPhoto ? (
            <img
              src={headerPhoto}
              alt={headerName}
              className="w-8 h-8 rounded-full object-cover border border-border/40"
            />
          ) : (
            <AnonymousAvatar seed={profile.avatarSeed || profile.id} name={profile.anonymousUsername} size="sm" />
          )}
          <span className="font-semibold text-sm">{headerName}</span>
        </div>
        {isUser && (
          <Link href="/wallet">
            <div className="flex items-center gap-1.5 bg-primary/10 text-primary px-3 py-1.5 rounded-full border border-primary/20 text-xs font-bold cursor-pointer hover:bg-primary/15 transition-colors">
              <WalletIcon className="w-3.5 h-3.5" />
              {wallet ? formatRupees(wallet.balanceInRupees) : "Wallet"}
            </div>
          </Link>
        )}
      </header>

      {/* ── Scrollable page content ───────────────────────────────────────── */}
      <main className="flex-1 flex flex-col w-full max-w-md mx-auto">
        {children}
      </main>

      {/* ── Full-width bottom navigation bar ─────────────────────────────── */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-2xl border-t border-border/50" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div className="flex items-stretch w-full max-w-md mx-auto">
          {navItems.map((item) => {
            const isActive = location === item.path || location.startsWith(item.path + "/");
            return (
              <Link
                key={item.path}
                href={item.path}
                className="relative flex-1 flex flex-col items-center justify-center gap-1 py-3 px-2 min-h-[64px]"
              >
                {isActive && (
                  <motion.div
                    layoutId="bottom-nav-indicator"
                    className="absolute inset-x-2 top-0 h-0.5 bg-primary rounded-b-full"
                    transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  />
                )}
                <item.icon
                  className={`w-6 h-6 transition-colors ${isActive ? "text-primary" : "text-muted-foreground"}`}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                <span className={`text-[11px] font-semibold leading-none transition-colors ${isActive ? "text-primary" : "text-muted-foreground"}`}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
