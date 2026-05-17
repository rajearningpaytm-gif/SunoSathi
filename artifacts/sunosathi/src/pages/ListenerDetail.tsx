import { useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetListenerById,
  useGetMyProfile,
  getGetListenerByIdQueryKey,
} from "@workspace/api-client-react";
import { PageTransition } from "@/components/PageTransition";
import { GradientButton } from "@/components/GradientButton";
import { Star, Phone, Video, ArrowLeft, Clock } from "lucide-react";
import { formatRelativeTime } from "@/lib/format";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import CallScreen from "./CallScreen";

export default function ListenerDetail() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: profile } = useGetMyProfile();

  const { data: listener, isLoading } = useGetListenerById(id!, {
    query: {
      enabled: !!id,
      queryKey: getGetListenerByIdQueryKey(id!),
      refetchInterval: 10_000,
      refetchOnWindowFocus: true,
    },
  });
  const [callOpen, setCallOpen] = useState(false);
  const [videoCallOpen, setVideoCallOpen] = useState(false);

  const handleStartCall = () => {
    if (!profile) return;
    if (profile.role === "listener") { toast.error("Listeners cannot start sessions."); return; }
    if (!listener?.isOnline) { toast.error("This listener is currently offline."); return; }
    setCallOpen(true);
  };

  const handleStartVideoCall = () => {
    if (!profile) return;
    if (profile.role === "listener") { toast.error("Listeners cannot start sessions."); return; }
    if (!listener?.isOnline) { toast.error("This listener is currently offline."); return; }
    setVideoCallOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }
  if (!listener) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh] text-muted-foreground">
        Listener not found
      </div>
    );
  }

  const canInteract = profile?.role !== "listener";

  return (
    <>
      <PageTransition className="flex flex-col bg-background min-h-screen">
        {/* Hero image — compact so buttons are visible without scrolling */}
        <div className="relative w-full overflow-hidden shrink-0" style={{ aspectRatio: "4/3", maxHeight: "45vh" }}>
          <img
            src={listener.photoUrl}
            alt={listener.displayName}
            className="w-full h-full object-cover object-top"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />

          <button
            onClick={() => history.back()}
            className="absolute top-4 left-4 w-10 h-10 rounded-full bg-background/60 backdrop-blur flex items-center justify-center z-10 shadow"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          {/* TOP-RIGHT: Online dot on hero image */}
          {listener.isOnline && (
            <div className="absolute top-4 right-4 z-10">
              <span className="relative flex w-4 h-4">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full w-4 h-4 bg-green-500 border-2 border-white shadow-[0_0_10px_#22c55e]" />
              </span>
            </div>
          )}

          {/* Name overlay at bottom of hero */}
          <div className="absolute bottom-3 left-4 right-4 z-10">
            <h1 className="text-2xl font-bold drop-shadow-md mb-1.5">{listener.displayName}</h1>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="capitalize px-2.5 py-0.5 rounded-full bg-primary/20 backdrop-blur text-primary text-xs font-medium border border-primary/20">
                {listener.gender}
              </span>
              <div className="flex items-center gap-1 bg-black/40 backdrop-blur px-2.5 py-0.5 rounded-full border border-white/10">
                <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
                <span className="text-xs font-bold text-white">{listener.ratingAverage.toFixed(1)}</span>
                <span className="text-[10px] text-white/60">({listener.ratingCount})</span>
              </div>
              <div className="flex items-center gap-1 bg-black/40 backdrop-blur px-2.5 py-0.5 rounded-full border border-white/10 text-white">
                <Clock className="w-3.5 h-3.5" />
                <span className="text-xs font-bold">{listener.totalSessions} sessions</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── FIXED CTA PANEL — always visible, sits above bottom nav ── */}
        <div className="fixed bottom-[4.5rem] left-1/2 -translate-x-1/2 w-full max-w-md z-40 px-4">
          <div className="bg-background/90 backdrop-blur-xl border border-border/60 rounded-2xl p-3 shadow-xl shadow-black/10">
            {!listener.isOnline && (
              <p className="text-center text-xs text-muted-foreground mb-2">
                This listener is currently offline
              </p>
            )}
            <div className="flex gap-3">
              {listener.audioCallsEnabled !== false && (
                <GradientButton
                  className="flex-1 h-12 text-sm"
                  onClick={handleStartCall}
                  disabled={!listener.isOnline || !canInteract}
                >
                  <Phone className="w-4 h-4 mr-1.5" />
                  Audio Call ₹{listener.pricePerMinuteCall}/m
                </GradientButton>
              )}
              {listener.videoCallsEnabled !== false && (
                <button
                  onClick={handleStartVideoCall}
                  disabled={!listener.isOnline || !canInteract}
                  className="flex-1 h-12 rounded-xl bg-violet-600 hover:bg-violet-700 active:scale-95 text-white text-sm font-semibold flex items-center justify-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-violet-500/25"
                >
                  <Video className="w-4 h-4" />
                  Video Call ₹12/m
                </button>
              )}
              {listener.audioCallsEnabled === false && listener.videoCallsEnabled === false && (
                <div className="flex-1 h-12 rounded-xl bg-muted flex items-center justify-center text-sm text-muted-foreground font-medium">
                  Calls not available
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Scrollable content — padded at bottom to clear the fixed CTA + nav */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="px-5 py-4 max-w-md mx-auto w-full space-y-5" style={{ paddingBottom: "10rem" }}>
            {/* About */}
            <div>
              <h2 className="text-base font-bold mb-1.5">About me</h2>
              <p className="text-muted-foreground leading-relaxed text-sm whitespace-pre-wrap">
                {listener.bio}
              </p>
            </div>

            {/* Skills */}
            <div>
              <h2 className="text-base font-bold mb-1.5">Expertise</h2>
              <div className="flex flex-wrap gap-2">
                {listener.skills.map((skill) => (
                  <span
                    key={skill}
                    className="px-3 py-1 rounded-xl bg-muted text-muted-foreground text-xs font-medium border border-border/50"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>

            {/* Reviews */}
            <div>
              <h2 className="text-base font-bold mb-2">Reviews</h2>
              {listener.reviews && listener.reviews.length > 0 ? (
                <div className="space-y-3">
                  {listener.reviews.map((review) => (
                    <div key={review.id} className="bg-muted/40 p-4 rounded-2xl border border-border/40">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-semibold text-sm">{review.reviewerName}</span>
                        <div className="flex items-center gap-0.5 text-yellow-400">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star key={i} className={`w-3 h-3 ${i < review.rating ? "fill-current" : "opacity-25"}`} />
                          ))}
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">"{review.comment}"</p>
                      <p className="text-[10px] text-muted-foreground/50 text-right mt-1">
                        {formatRelativeTime(review.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground bg-muted/30 p-5 rounded-2xl text-center border border-border/40 text-sm">
                  No reviews yet. Be the first to connect!
                </p>
              )}
            </div>
          </div>
        </div>
      </PageTransition>

      {/* Audio call overlay */}
      {callOpen && listener && (
        <CallScreen
          listenerId={id!}
          listenerName={listener.displayName}
          listenerPhoto={listener.photoUrl}
          pricePerMinute={listener.pricePerMinuteCall}
          onClose={() => setCallOpen(false)}
        />
      )}

      {/* Video call overlay */}
      {videoCallOpen && listener && (
        <CallScreen
          listenerId={id!}
          listenerName={listener.displayName}
          listenerPhoto={listener.photoUrl}
          pricePerMinute={12}
          onClose={() => setVideoCallOpen(false)}
          video
        />
      )}
    </>
  );
}
