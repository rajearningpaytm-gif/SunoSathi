import { useState } from "react";
import {
  useListMyChatSessions,
  usePostListenerReview,
  getListMyChatSessionsQueryKey,
} from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { PageTransition } from "@/components/PageTransition";
import { EmptyState } from "@/components/EmptyState";
import { GradientButton } from "@/components/GradientButton";
import { formatRelativeTime, formatRupees } from "@/lib/format";
import { MessageCircle, Phone, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useQueryClient } from "@tanstack/react-query";

export default function Chats() {
  const { data: sessions, isLoading } = useListMyChatSessions();
  const postReview = usePostListenerReview();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const [reviewSession, setReviewSession] = useState<{ id: string; listenerId: string; listenerName: string } | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");

  const handleOpenReview = (session: { id: string; listenerId: string; listenerName: string }) => {
    setReviewSession(session);
    setRating(0);
    setComment("");
  };

  const handleCloseReview = () => {
    setReviewSession(null);
  };

  const handleReviewSubmit = () => {
    if (!reviewSession) return;
    if (rating === 0) { toast.error("Please select a rating"); return; }
    if (comment.length < 3) { toast.error("Please leave a brief comment"); return; }
    postReview.mutate(
      { id: reviewSession.listenerId, data: { rating, comment, sessionId: reviewSession.id } },
      {
        onSuccess: () => {
          toast.success("Review submitted!");
          setReviewSession(null);
          queryClient.invalidateQueries({ queryKey: getListMyChatSessionsQueryKey() });
        },
        onError: (err: any) => toast.error(err?.data?.error || "Failed to submit review"),
      }
    );
  };

  if (isLoading) return <div className="flex-1 flex items-center justify-center p-4">Loading...</div>;

  if (!sessions || sessions.length === 0) {
    return (
      <PageTransition className="flex-1 flex flex-col pt-20">
        <EmptyState
          title="No chats yet"
          description="Your conversation history will appear here once you connect with a listener."
        />
      </PageTransition>
    );
  }

  return (
    <PageTransition className="flex-1 flex flex-col p-4 pb-24">
      <h1 className="text-2xl font-bold mb-6 px-2">Chats</h1>

      <div className="flex flex-col gap-3">
        {sessions.map(session => (
          <div key={session.id} className="glass-card rounded-2xl overflow-hidden border border-border/40">
            <Link href={`/chat/${session.id}`}>
              <div className="p-4 flex items-center gap-4 cursor-pointer hover:border-primary/30 transition-colors">
                <div className="relative shrink-0">
                  <img
                    src={session.listenerPhotoUrl}
                    alt={session.listenerName}
                    className="w-14 h-14 rounded-full object-cover border-2 border-background shadow-sm"
                  />
                  {session.status === "active" && (
                    <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-500 border-2 border-background rounded-full" />
                  )}
                  <div className="absolute -top-1 -right-1 w-6 h-6 bg-background rounded-full flex items-center justify-center shadow-sm">
                    {session.kind === "chat" ? (
                      <MessageCircle className="w-3.5 h-3.5 text-primary" />
                    ) : (
                      <Phone className="w-3.5 h-3.5 text-secondary" />
                    )}
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center mb-1">
                    <p className="font-semibold truncate pr-2">{session.listenerName}</p>
                    <p className="text-xs text-muted-foreground whitespace-nowrap">{formatRelativeTime(session.startedAt)}</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground truncate pr-4">
                      {session.lastMessagePreview || (session.status === "active" ? "Session active..." : "Session ended")}
                    </p>
                    {session.status === "ended" && (
                      <p className="text-xs font-medium text-foreground bg-muted px-2 py-0.5 rounded-md whitespace-nowrap">
                        {formatRupees(session.totalCostInRupees)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </Link>

            {/* Rate CTA — only for ended sessions without a review */}
            {session.status === "ended" && !session.hasReview && (
              <div className="px-4 pb-3 pt-0">
                <button
                  onClick={() => handleOpenReview({ id: session.id, listenerId: session.listenerId, listenerName: session.listenerName })}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 dark:text-yellow-400 text-sm font-medium hover:bg-yellow-500/20 transition-colors"
                >
                  <Star className="w-3.5 h-3.5 fill-current" />
                  Rate this session
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Review bottom sheet */}
      <Sheet open={!!reviewSession} onOpenChange={(open) => { if (!open) handleCloseReview(); }}>
        <SheetContent side="bottom" className="rounded-t-[2rem] border-border/50">
          <SheetHeader className="text-left mb-6">
            <SheetTitle>Rate your listener</SheetTitle>
            <SheetDescription>How was your session with {reviewSession?.listenerName}?</SheetDescription>
          </SheetHeader>

          <div className="flex justify-center gap-2 mb-6">
            {[1, 2, 3, 4, 5].map(star => (
              <button key={star} onClick={() => setRating(star)} className="p-2 transition-transform hover:scale-110 active:scale-95">
                <Star className={cn("w-10 h-10", rating >= star ? "fill-yellow-500 text-yellow-500" : "text-muted-foreground opacity-30")} />
              </button>
            ))}
          </div>

          <Textarea
            placeholder="Leave a brief comment…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="mb-6 rounded-xl resize-none"
            rows={3}
          />

          <GradientButton className="w-full" onClick={handleReviewSubmit} isLoading={postReview.isPending}>
            Submit Review
          </GradientButton>
          <button
            onClick={handleCloseReview}
            className="w-full mt-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Skip for now
          </button>
        </SheetContent>
      </Sheet>
    </PageTransition>
  );
}
