import { useState } from "react";
import { useParams } from "wouter";
import {
  useGetListenerById,
  useGetMyProfile,
  getGetListenerByIdQueryKey,
} from "@workspace/api-client-react";
import { PageTransition } from "@/components/PageTransition";
import { GradientButton } from "@/components/GradientButton";
import { Star, Phone, ArrowLeft, Clock } from "lucide-react";
import { formatRelativeTime } from "@/lib/format";
import { toast } from "sonner";
import CallScreen from "./CallScreen";

export default function ListenerDetail() {
  const { id } = useParams();
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

  const handleStartCall = () => {
    if (!profile) return;
    if (profile.role === "listener") { toast.error("Listeners cannot start sessions."); return; }
    if (!listener?.isOnline) { toast.error("This listener is currently offline."); return; }
    setCallOpen(true);
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

  // Safe defaults for every field — handles new/incomplete listener profiles
  const displayName   = listener.displayName   ?? "Listener";
  const gender        = listener.gender        ?? "";
  const bio           = listener.bio           ?? "";
  const photoUrl      = listener.photoUrl      ?? "";
  const skills        = listener.skills        ?? [];
  const reviews       = listener.reviews       ?? [];
  const ratingAvg     = listener.ratingAverage ?? 0;
  const ratingCount   = listener.ratingCount   ?? 0;
  const totalSessions = (listener as any).totalSessions ?? 0;
  const pricePerMin   = listener.pricePerMinuteCall ?? 0;
  const isOnline      = listener.isOnline      ?? false;
  const audioEnabled  = listener.audioCallsEnabled !== false;
  const canInteract   = profile?.role !== "listener";

  return (
    <>
      <PageTransition className="flex flex-col bg-background min-h-screen">
        {/* Hero image */}
        <div className="relative w-full overflow-hidden shrink-0" style={{ aspectRatio: "4/3", maxHeight: "45vh" }}>
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={displayName}
              className="w-full h-full object-cover object-top"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-violet-900 to-pink-900" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />

          <button
            onClick={() => history.back()}
            className="absolute top-4 left-4 w-10 h-10 rounded-full bg-background/60 backdrop-blur flex items-center justify-center z-10 shadow"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          {isOnline && (
            <div className="absolute top-4 right-4 z-10">
              <span className="relative flex w-4 h-4">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full w-4 h-4 bg-green-500 border-2 border-white shadow-[0_0_10px_#22c55e]" />
              </span>
            </div>
          )}

          <div className="absolute bottom-3 left-4 right-4 z-10">
            <h1 className="text-2xl font-bold drop-shadow-md mb-1.5">{displayName}</h1>
            <div className="flex flex-wrap items-center gap-1.5">
              {gender && (
                <span className="capitalize px-2.5 py-0.5 rounded-full bg-primary/20 backdrop-blur text-primary text-xs font-medium border border-primary/20">
                  {gender}
                </span>
              )}
              <div className="flex items-center gap-1 bg-black/40 backdrop-blur px-2.5 py-0.5 rounded-full border border-white/10">
                <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
                <span className="text-xs font-bold text-white">{ratingAvg.toFixed(1)}</span>
                <span className="text-[10px] text-white/60">({ratingCount})</span>
              </div>
              <div className="flex items-center gap-1 bg-black/40 backdrop-blur px-2.5 py-0.5 rounded-full border border-white/10 text-white">
                <Clock className="w-3.5 h-3.5" />
                <span className="text-xs font-bold">{totalSessions} sessions</span>
              </div>
            </div>
          </div>
        </div>

        {/* Fixed CTA panel */}
        <div className="fixed bottom-[4.5rem] left-1/2 -translate-x-1/2 w-full max-w-md z-40 px-4">
          <div className="bg-background/90 backdrop-blur-xl border border-border/60 rounded-2xl p-3 shadow-xl shadow-black/10">
            {!isOnline && (
              <p className="text-center text-xs text-muted-foreground mb-2">
                This listener is currently offline
              </p>
            )}
            <div>
              {audioEnabled ? (
                <GradientButton
                  className="w-full h-14 text-base"
                  onClick={handleStartCall}
                  disabled={!isOnline || !canInteract}
                >
                  <Phone className="w-5 h-5 mr-2" />
                  Audio Call ₹{pricePerMin}/m
                </GradientButton>
              ) : (
                <div className="w-full h-14 rounded-xl bg-muted flex items-center justify-center text-sm text-muted-foreground font-medium">
                  Calls not available
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="px-5 py-4 max-w-md mx-auto w-full space-y-5" style={{ paddingBottom: "10rem" }}>

            {/* About */}
            {bio ? (
              <div>
                <h2 className="text-base font-bold mb-1.5">About me</h2>
                <p className="text-muted-foreground leading-relaxed text-sm whitespace-pre-wrap">{bio}</p>
              </div>
            ) : null}

            {/* Skills */}
            {skills.length > 0 && (
              <div>
                <h2 className="text-base font-bold mb-1.5">Expertise</h2>
                <div className="flex flex-wrap gap-2">
                  {skills.map((skill, idx) => (
                    <span
                      key={skill ?? idx}
                      className="px-3 py-1 rounded-xl bg-muted text-muted-foreground text-xs font-medium border border-border/50"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Reviews */}
            <div>
              <h2 className="text-base font-bold mb-2">Reviews</h2>
              {reviews.length > 0 ? (
                <div className="space-y-3">
                  {reviews.map((review, idx) => (
                    <div key={review?.id ?? idx} className="bg-muted/40 p-4 rounded-2xl border border-border/40">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-semibold text-sm">{review?.reviewerName ?? "User"}</span>
                        <div className="flex items-center gap-0.5 text-yellow-400">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star key={i} className={`w-3 h-3 ${i < (review?.rating ?? 0) ? "fill-current" : "opacity-25"}`} />
                          ))}
                        </div>
                      </div>
                      {review?.comment && (
                        <p className="text-sm text-muted-foreground leading-relaxed">"{review.comment}"</p>
                      )}
                      {review?.createdAt && (
                        <p className="text-[10px] text-muted-foreground/50 text-right mt-1">
                          {formatRelativeTime(review.createdAt)}
                        </p>
                      )}
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

      {callOpen && listener && (
        <CallScreen
          listenerId={id!}
          listenerName={displayName}
          listenerPhoto={photoUrl}
          pricePerMinute={pricePerMin}
          onClose={() => setCallOpen(false)}
        />
      )}
    </>
  );
}
