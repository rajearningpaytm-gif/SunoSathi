import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useGetMyProfile,
  useGetMoodCategories,
  useGetFeaturedListeners,
  useListListeners,
  useSetOnlineStatus,
  useSetCallSettings,
  useGetDashboardSummary,
  ListListenersMood,
  ListListenersGender
} from "@workspace/api-client-react";
import { PageTransition } from "@/components/PageTransition";
import { MoodPill } from "@/components/MoodPill";
import { ListenerCard } from "@/components/ListenerCard";
import { GradientButton } from "@/components/GradientButton";
import { SafetyBanner } from "@/components/SafetyBanner";
import { Phone, Video, Star } from "lucide-react";
import { formatRupees } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMyProfileQueryKey, getListListenersQueryKey } from "@workspace/api-client-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export default function Home() {
  const { data: profile, isLoading } = useGetMyProfile();

  if (isLoading) return (
    <div className="flex-1 flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
    </div>
  );
  if (!profile) return null;

  if (profile.role === "user") return <UserHome profile={profile} />;
  return <ListenerHome profile={profile} />;
}

function UserHome({ profile }: { profile: any }) {
  const [selectedMood, setSelectedMood] = useState<ListListenersMood | "all">("all");
  const [selectedGender, setSelectedGender] = useState<ListListenersGender>("all");
  const [onlyOnline, setOnlyOnline] = useState(false);

  const { data: moods } = useGetMoodCategories();
  const { data: featured } = useGetFeaturedListeners();
  const listenersParams = {
    mood: selectedMood === "all" ? undefined : selectedMood,
    gender: selectedGender === "all" ? undefined : selectedGender,
    onlyOnline: onlyOnline ? true : undefined,
  };
  const { data: listeners, isLoading: isLoadingListeners } = useListListeners(listenersParams, {
    query: {
      queryKey: getListListenersQueryKey(listenersParams),
      refetchInterval: 20_000,
      refetchOnWindowFocus: true,
    },
  });

  return (
    <PageTransition className="flex-1 flex flex-col pb-24">
      {/* Safety banner — slightly pushed down from top */}
      <div className="mt-1">
        <SafetyBanner />
      </div>

      {/* Greeting */}
      <div className="px-4 pt-5 pb-4">
        <h1 className="text-2xl font-bold">Hi, {profile.anonymousUsername} 👋</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Who would you like to talk to today?</p>
      </div>

      {/* Mood filter */}
      <div className="px-4 mb-10">
        <h2 className="text-base font-bold mb-3 text-foreground">How are you feeling?</h2>
        <div className="flex overflow-x-auto gap-2.5 pb-2 -mx-4 px-4 snap-x hide-scrollbar">
          <MoodPill
            label="All"
            count={moods?.reduce((acc, m) => acc + m.listenerCount, 0) || 0}
            isActive={selectedMood === "all"}
            onClick={() => setSelectedMood("all")}
          />
          {moods?.map((mood) => (
            <MoodPill
              key={mood.key}
              label={mood.label}
              count={mood.listenerCount}
              isActive={selectedMood === mood.key}
              onClick={() => setSelectedMood(mood.key as ListListenersMood)}
            />
          ))}
        </div>
      </div>

      {/* Featured Listeners */}
      {featured && featured.length > 0 && selectedMood === "all" && selectedGender === "all" && !onlyOnline && (
        <div className="px-4 mb-12">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold">Featured Listeners</h2>
            <span className="text-xs text-muted-foreground">First min free · Swipe →</span>
          </div>
          <div className="flex overflow-x-auto gap-4 pb-3 -mx-4 px-4 snap-x hide-scrollbar">
            {featured.map((listener) => (
              <div key={listener.id} className="w-[220px] shrink-0 snap-start">
                <ListenerCard listener={listener} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Find a Listener */}
      <div className="px-4 mb-6">
        {/* Section header + online toggle */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold">Find a Listener</h2>
          <div className="flex items-center gap-2">
            <Switch id="online-mode" checked={onlyOnline} onCheckedChange={setOnlyOnline} />
            <Label htmlFor="online-mode" className="text-xs font-medium">Online now</Label>
          </div>
        </div>

        {/* Gender filter chips */}
        <div className="flex gap-2 pb-2 mb-5 overflow-x-auto hide-scrollbar -mx-4 px-4">
          {["all", "female", "male", "other"].map((gender) => (
            <button
              key={gender}
              onClick={() => setSelectedGender(gender as ListListenersGender)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-all ${
                selectedGender === gender
                  ? "bg-primary text-white border-primary shadow-sm"
                  : "bg-muted text-muted-foreground border-border/40 hover:border-primary/30"
              }`}
            >
              {gender === "all" ? "Any Gender" : gender.charAt(0).toUpperCase() + gender.slice(1)}
            </button>
          ))}
        </div>

        {isLoadingListeners ? (
          <div className="grid grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="aspect-[3/4] bg-muted/60 animate-pulse rounded-[1.5rem]" />
            ))}
          </div>
        ) : !listeners || listeners.length === 0 ? (
          <div className="text-center py-14 glass-card rounded-3xl">
            <p className="text-muted-foreground text-sm mb-2">No listeners match your filters.</p>
            <button
              onClick={() => { setSelectedMood("all"); setSelectedGender("all"); setOnlyOnline(false); }}
              className="text-primary text-sm font-semibold hover:underline"
            >
              Clear all filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {listeners.map((listener) => (
              <ListenerCard key={listener.id} listener={listener} />
            ))}
          </div>
        )}
      </div>
    </PageTransition>
  );
}

function ListenerHome({ profile }: { profile: any }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const setOnlineStatus = useSetOnlineStatus();
  const setCallSettings = useSetCallSettings();
  const { data: dashboard } = useGetDashboardSummary();

  const p = profile.listenerProfile;

  // Local state for instant toggle feedback — seeded from server value
  const [audioEnabled, setAudioEnabled] = useState<boolean>(p?.audioCallsEnabled ?? true);
  const [videoEnabled, setVideoEnabled] = useState<boolean>(p?.videoCallsEnabled ?? true);

  const handleOnlineToggle = (checked: boolean) => {
    setOnlineStatus.mutate(
      { data: { isOnline: checked } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() }) }
    );
  };

  const handleCallToggle = (field: "audioCallsEnabled" | "videoCallsEnabled", checked: boolean) => {
    // Optimistic UI — update local state immediately
    if (field === "audioCallsEnabled") setAudioEnabled(checked);
    else setVideoEnabled(checked);

    setCallSettings.mutate(
      { data: { [field]: checked } },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() }),
        onError: () => {
          // Rollback on error
          if (field === "audioCallsEnabled") setAudioEnabled(!checked);
          else setVideoEnabled(!checked);
        },
      }
    );
  };

  if (!p) {
    return (
      <PageTransition className="flex-1 flex flex-col items-center justify-center p-6 text-center pb-24">
        <h2 className="text-2xl font-bold mb-4">Become a Listener</h2>
        <p className="text-muted-foreground mb-8">Start earning by helping others feel heard and understood.</p>
        <GradientButton onClick={() => setLocation("/apply")} className="w-full">Apply Now</GradientButton>
      </PageTransition>
    );
  }

  if (p.applicationStatus === "pending") {
    return (
      <PageTransition className="flex-1 flex flex-col items-center justify-center p-6 text-center pb-24">
        <div className="w-24 h-24 bg-primary/10 text-primary rounded-full flex items-center justify-center mb-6">
          <Star className="w-10 h-10" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Application under review</h2>
        <p className="text-muted-foreground">We're reviewing your application. Usually takes 1-2 business days.</p>
      </PageTransition>
    );
  }

  if (p.applicationStatus === "rejected") {
    return (
      <PageTransition className="flex-1 flex flex-col items-center justify-center p-6 text-center pb-24">
        <div className="w-24 h-24 bg-destructive/10 text-destructive rounded-full flex items-center justify-center mb-6">
          <Star className="w-10 h-10" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Application Not Approved</h2>
        <p className="text-muted-foreground mb-6">
          {p.rejectionReason || "Unfortunately, your application was not approved at this time."}
        </p>
        <GradientButton onClick={() => setLocation("/apply")} variant="secondary" className="w-full">Re-apply</GradientButton>
      </PageTransition>
    );
  }

  return (
    <PageTransition className="flex-1 flex flex-col pb-24">
      <SafetyBanner />

      <div className="p-4">
        <div className="flex items-center justify-between mb-8 mt-2">
          <div>
            <h1 className="text-2xl font-bold">Hi, {p.displayName}</h1>
            <p className="text-sm text-muted-foreground">Welcome back to SunoSathi</p>
          </div>
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-2 bg-card px-3 py-1.5 rounded-full border border-border/50 shadow-sm">
              <Label
                htmlFor="listener-online"
                className={`text-sm font-semibold ${p.isOnline ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}
              >
                {p.isOnline ? "Online" : "Offline"}
              </Label>
              <Switch
                id="listener-online"
                checked={p.isOnline}
                onCheckedChange={handleOnlineToggle}
                disabled={setOnlineStatus.isPending}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="glass-card p-4 rounded-2xl">
            <p className="text-xs text-muted-foreground mb-1">Today's Earnings</p>
            <p className="text-2xl font-bold text-primary">{formatRupees(dashboard?.todayEarningsInRupees ?? 0)}</p>
          </div>
          <div className="glass-card p-4 rounded-2xl">
            <p className="text-xs text-muted-foreground mb-1">Active Sessions</p>
            <p className="text-2xl font-bold">{dashboard?.activeSessions || 0}</p>
          </div>
          <div className="glass-card p-4 rounded-2xl">
            <p className="text-xs text-muted-foreground mb-1">Total Sessions</p>
            <p className="text-xl font-bold">{dashboard?.totalSessions || 0}</p>
          </div>
          <div className="glass-card p-4 rounded-2xl">
            <p className="text-xs text-muted-foreground mb-1">Rating</p>
            <div className="flex items-center gap-1">
              <Star className="w-5 h-5 text-yellow-500 fill-current" />
              <p className="text-xl font-bold">{(dashboard?.averageRating || 0).toFixed(1)}</p>
            </div>
          </div>
        </div>

        {/* ── Call Type Toggles ─────────────────────────────────────────── */}
        <div className="glass-card rounded-2xl p-4 mb-8 border border-border/40">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Accept Calls
          </p>
          <div className="flex flex-col gap-3">
            {/* Audio Calls */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${
                  audioEnabled
                    ? "bg-pink-500/15 text-pink-500"
                    : "bg-muted text-muted-foreground"
                }`}>
                  <Phone className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold leading-tight">Audio Calls</p>
                  <p className="text-[11px] text-muted-foreground">
                    {audioEnabled ? "Users can call you" : "Hidden from users"}
                  </p>
                </div>
              </div>
              <Switch
                checked={audioEnabled}
                onCheckedChange={(v) => handleCallToggle("audioCallsEnabled", v)}
                disabled={setCallSettings.isPending}
                className="data-[state=checked]:bg-pink-500"
              />
            </div>

            <div className="h-px bg-border/40" />

            {/* Video Calls */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${
                  videoEnabled
                    ? "bg-violet-500/15 text-violet-500"
                    : "bg-muted text-muted-foreground"
                }`}>
                  <Video className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold leading-tight">Video Calls</p>
                  <p className="text-[11px] text-muted-foreground">
                    {videoEnabled ? "Users can video call you" : "Hidden from users"}
                  </p>
                </div>
              </div>
              <Switch
                checked={videoEnabled}
                onCheckedChange={(v) => handleCallToggle("videoCallsEnabled", v)}
                disabled={setCallSettings.isPending}
                className="data-[state=checked]:bg-pink-500"
              />
            </div>
          </div>
        </div>

        <h2 className="text-base font-bold mb-4">Recent Sessions</h2>
        {dashboard?.recentSessions && dashboard.recentSessions.length > 0 ? (
          <div className="space-y-3">
            {dashboard.recentSessions.map((session) => (
              <Link key={session.id} href={`/chat/${session.id}`}>
                <div className="glass-card p-4 rounded-2xl flex items-center gap-4 cursor-pointer hover:border-primary/30 transition-colors">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg">
                    {session.userName.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{session.userName}</p>
                    <p className="text-xs text-muted-foreground capitalize">{session.kind} · {session.status}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-sm">{session.billedMinutes}m</p>
                    <p className="text-xs text-muted-foreground">{formatRupees(session.totalCostInRupees)}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-10 text-muted-foreground glass-card rounded-2xl">
            <p className="text-sm">No recent sessions yet.</p>
          </div>
        )}
      </div>
    </PageTransition>
  );
}
