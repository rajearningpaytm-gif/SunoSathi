import { useAuth } from "@workspace/replit-auth-web";
import { Link } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { PageTransition } from "@/components/PageTransition";
import { AnonymousAvatar, AVATAR_PRESETS, getAvatarImageUrl } from "@/components/AnonymousAvatar";
import {
  ChevronRight, LogOut,
  Mail, MessageSquare, HelpCircle, Shield, Check, Camera,
  Phone, AtSign,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMyProfileQueryKey } from "@workspace/api-client-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function Settings() {
  const { logout } = useAuth();
  const { data: profile } = useGetMyProfile();
  const queryClient = useQueryClient();
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [updatingAvatar, setUpdatingAvatar] = useState(false);

  if (!profile) return null;

  const handleAvatarSelect = async (seed: string) => {
    if (seed === profile.avatarSeed || updatingAvatar) return;
    setUpdatingAvatar(true);
    try {
      const res = await fetch("/api/me/avatar", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed }),
      });
      if (!res.ok) throw new Error("Update failed");
      await queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      toast.success("Avatar updated!");
      setShowAvatarPicker(false);
    } catch {
      toast.error("Could not update avatar");
    } finally {
      setUpdatingAvatar(false);
    }
  };

  return (
    <PageTransition className="flex-1 flex flex-col px-4 pb-24 pt-4">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      {/* ── Profile card ──────────────────────────────────────────────────────── */}
      <div className="glass-card rounded-3xl p-6 mb-6 flex flex-col items-center text-center">
        {/* Avatar with edit button */}
        <div className="relative mb-4">
          <AnonymousAvatar seed={profile.avatarSeed || profile.id} name={profile.anonymousUsername} size="xl" />
          <button
            onClick={() => setShowAvatarPicker(v => !v)}
            className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center shadow-lg border-2 border-white hover:bg-primary/90 transition-colors"
          >
            <Camera className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Avatar picker */}
        {showAvatarPicker && (
          <div className="w-full mb-4">
            <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Choose your avatar</p>
            <div className="grid grid-cols-4 gap-3">
              {AVATAR_PRESETS.map(preset => {
                const imgUrl = getAvatarImageUrl(preset.id);
                const isSelected = profile.avatarSeed === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => handleAvatarSelect(preset.id)}
                    disabled={updatingAvatar}
                    className={cn(
                      "relative flex flex-col items-center gap-1.5 p-2 rounded-2xl border-2 transition-all",
                      isSelected
                        ? "border-primary bg-primary/8 scale-105"
                        : "border-border/40 hover:border-primary/40 hover:bg-muted/30"
                    )}
                  >
                    {imgUrl && (
                      <img
                        src={imgUrl}
                        alt={preset.label}
                        className="w-12 h-12 rounded-full bg-muted"
                      />
                    )}
                    <span className="text-[9px] font-bold text-muted-foreground">{preset.label}</span>
                    {isSelected && (
                      <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-primary flex items-center justify-center shadow">
                        <Check className="w-2.5 h-2.5 text-white" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setShowAvatarPicker(false)}
              className="text-xs text-muted-foreground mt-3 hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        <h2 className="text-xl font-bold leading-tight">{profile.anonymousUsername}</h2>
        <span className="mt-1.5 px-3 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold capitalize border border-primary/20">
          {profile.role}
        </span>

        {/* Login identity — real account proof */}
        {((profile as any).phone || profile.email) && (
          <div className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20">
            {(profile as any).phone
              ? <Phone className="w-3 h-3 text-green-500 shrink-0" />
              : <AtSign className="w-3 h-3 text-green-500 shrink-0" />
            }
            <span className="text-[11px] font-semibold text-green-600 dark:text-green-400">
              {(profile as any).phone ?? profile.email}
            </span>
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
          <Shield className="w-3 h-3" /> Anonymous — your identity is protected
        </p>
      </div>

      {/* ── Help & Support ────────────────────────────────────────────────────── */}
      <div className="glass-card rounded-2xl mb-4 overflow-hidden">
        <div className="px-4 pt-4 pb-2">
          <div className="flex items-center gap-2 mb-1">
            <HelpCircle className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Help & Support</p>
          </div>

          <a
            href="mailto:support@sunosathi.app?subject=SunoSathi Support"
            className="flex items-center gap-3 py-3.5 px-2 -mx-2 rounded-xl hover:bg-muted/40 transition-colors"
          >
            <div className="w-9 h-9 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
              <Mail className="w-4 h-4 text-blue-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Email Support</p>
              <p className="text-xs text-muted-foreground">Get help via email</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          </a>

          <a
            href="https://wa.me/918882765408"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 py-3.5 px-2 -mx-2 rounded-xl hover:bg-muted/40 transition-colors"
          >
            <div className="w-9 h-9 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
              <MessageSquare className="w-4 h-4 text-green-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">WhatsApp Support</p>
              <p className="text-xs text-muted-foreground">Instant help · Usually replies fast</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          </a>
        </div>
      </div>

      {/* ── Legal ─────────────────────────────────────────────────────────────── */}
      <div className="glass-card rounded-2xl mb-4 overflow-hidden">
        <div className="px-4 pt-4 pb-2">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1 px-2">Legal</p>
          {[
            { href: "/legal/terms",      label: "Terms of Service" },
            { href: "/legal/privacy",    label: "Privacy Policy" },
            { href: "/legal/safety",     label: "Safety Guidelines" },
            { href: "/legal/disclaimer", label: "Disclaimer" },
          ].map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center justify-between py-3.5 px-2 -mx-2 rounded-xl hover:bg-muted/40 transition-colors"
            >
              <span className="text-sm font-medium">{item.label}</span>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </Link>
          ))}
        </div>
      </div>

      {/* ── Log Out ───────────────────────────────────────────────────────────── */}
      <div className="glass-card rounded-2xl mb-5 overflow-hidden">
        <button
          onClick={logout}
          className="w-full py-4 flex items-center justify-center gap-2 text-destructive font-semibold text-sm hover:bg-destructive/8 transition-colors rounded-2xl"
        >
          <LogOut className="w-4 h-4" />
          Log Out
        </button>
      </div>

      <p className="text-center text-[10px] text-muted-foreground">SunoSathi · Version 1.0.0</p>
    </PageTransition>
  );
}
