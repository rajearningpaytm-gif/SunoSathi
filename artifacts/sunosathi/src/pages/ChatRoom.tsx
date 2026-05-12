import { useState, useEffect, useRef, useCallback } from "react";
import EmojiPicker, { type EmojiClickData, Theme } from "emoji-picker-react";
import { useParams, useLocation } from "wouter";
import {
  useGetChatSession,
  getGetChatSessionQueryKey,
  useListChatMessages,
  getListChatMessagesQueryKey,
  useSendChatMessage,
  useEndChatSession,
  usePostListenerReview,
  useGetMyProfile,
} from "@workspace/api-client-react";
import { PageTransition } from "@/components/PageTransition";
import { GradientButton } from "@/components/GradientButton";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Send, PhoneOff, Star, Flag, ChevronRight, Phone, MessageCircle, Clock, Smile } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { getGetWalletQueryKey } from "@workspace/api-client-react";

const REPORT_CATEGORIES = [
  { id: "rude_abusive",      label: "Rude or Abusive",    emoji: "😡", desc: "Insults, threats, hostile tone" },
  { id: "sexual_harassment", label: "Sexual Harassment",   emoji: "🚨", desc: "Inappropriate or sexual remarks" },
  { id: "fake_caller",       label: "Fake / Time-waster",  emoji: "🎭", desc: "Not genuinely seeking help" },
];

const FEEDBACK_OPTIONS = [
  { id: "good",              label: "Good experience",      emoji: "✅", desc: "Nothing to report — all fine",  positive: true },
  { id: "rude_abusive",     label: "Rude or Abusive",      emoji: "😡", desc: "Insults, threats, hostility",    positive: false },
  { id: "sexual_harassment", label: "Sexual Harassment",    emoji: "🚨", desc: "Inappropriate sexual remarks",   positive: false },
  { id: "fake_caller",       label: "Fake / Time-waster",  emoji: "🎭", desc: "Not genuinely seeking help",     positive: false },
];

function formatIst(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatIstDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function TypingBubble() {
  return (
    <div className="flex items-end gap-2 mr-auto max-w-[60%]">
      <div
        className="px-4 py-3 rounded-2xl rounded-bl-sm flex items-center gap-1"
        style={{ background: "rgba(var(--muted-rgb,120,120,120),0.12)", border: "1px solid rgba(120,120,120,0.15)" }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-2 h-2 rounded-full bg-muted-foreground/50 inline-block"
            style={{
              animation: "typing-bounce 1.2s ease-in-out infinite",
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function SessionStartCard({ kind, startedAt }: { kind: string; startedAt: string }) {
  const Icon = kind === "call" ? Phone : MessageCircle;
  const label = kind === "call" ? "Audio Call" : "Chat Session";
  return (
    <div className="flex justify-center my-3">
      <div
        className="flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-semibold"
        style={{
          background: "linear-gradient(135deg, rgba(249,115,22,0.1), rgba(236,72,153,0.1))",
          border: "1px solid rgba(249,115,22,0.2)",
          color: "#f97316",
        }}
      >
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span>{label} started</span>
        <span className="opacity-60">·</span>
        <span className="opacity-70 font-normal">{formatIstDate(startedAt)}</span>
      </div>
    </div>
  );
}

function SessionEndCard({ endedAt, billedMinutes, kind }: { endedAt: string; billedMinutes: number; kind: string }) {
  const label = kind === "call" ? "Audio Call" : "Chat Session";
  return (
    <div className="flex justify-center my-3">
      <div
        className="flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-semibold"
        style={{
          background: "rgba(100,100,100,0.06)",
          border: "1px solid rgba(100,100,100,0.15)",
          color: "var(--muted-foreground)",
        }}
      >
        <Clock className="w-3.5 h-3.5 shrink-0" />
        <span>{label} ended</span>
        <span className="opacity-60">·</span>
        <span>{billedMinutes}m</span>
        <span className="opacity-60">·</span>
        <span className="font-normal">{formatIstDate(endedAt)}</span>
      </div>
    </div>
  );
}

export default function ChatRoom() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialScrollDone = useRef(false);

  const { data: profile } = useGetMyProfile();
  const { data: session, refetch: refetchSession } = useGetChatSession(id!, {
    query: { enabled: !!id, refetchInterval: 5000, queryKey: getGetChatSessionQueryKey(id!) },
  });
  const { data: messages } = useListChatMessages(id!, {
    query: { enabled: !!id, refetchInterval: 3000, queryKey: getListChatMessagesQueryKey(id!) },
  });

  const sendMessage = useSendChatMessage();
  const endSession = useEndChatSession();
  const postReview = usePostListenerReview();

  // Typing state from SSE
  const [otherTyping, setOtherTyping] = useState(false);
  const otherTypingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // User review state
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");

  // Listener report & feedback state
  const [reportOpen, setReportOpen] = useState(false);
  const [reportPhase, setReportPhase] = useState<"choose" | "category">("choose");
  const [reportMode, setReportMode] = useState<"continue" | "end" | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackDone, setFeedbackDone] = useState(false);
  const [submittingReport, setSubmittingReport] = useState(false);

  const isUser = profile?.role === "user";
  const isListener = profile?.role === "listener";
  const isActive = session?.status === "active";
  const listenerIsOnline = (session as any)?.listenerIsOnline ?? false;

  // Scroll to bottom — instant on first load, smooth on new messages
  useEffect(() => {
    if (!messages) return;
    if (!initialScrollDone.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
      initialScrollDone.current = true;
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, otherTyping]);

  // Auto-focus input when session is active
  useEffect(() => {
    if (!isActive) return;
    const t = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, [isActive]);

  // Per-minute billing tick
  useEffect(() => {
    if (!isActive || !isUser || !id) return;
    tickIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/chat/sessions/${id}/tick`, { method: "POST", credentials: "include" });
        const data = await res.json();
        if (!res.ok) {
          if (data.autoEnded) {
            toast.error("Wallet balance exhausted — session ended.");
            queryClient.invalidateQueries({ queryKey: getGetChatSessionQueryKey(id) });
            queryClient.invalidateQueries({ queryKey: getListChatMessagesQueryKey(id) });
          }
          return;
        }
        queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetChatSessionQueryKey(id) });
      } catch { /* ignore */ }
    }, 60_000);
    return () => { if (tickIntervalRef.current) clearInterval(tickIntervalRef.current); };
  }, [isActive, isUser, id]);

  // Auto-show listener feedback when session ends
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (isListener && !isActive && session?.status === "ended" && !feedbackDone && !feedbackOpen) {
      timer = setTimeout(() => setFeedbackOpen(true), 500);
    }
    return () => { if (timer) clearTimeout(timer); };
  }, [isListener, isActive, session?.status, feedbackDone, feedbackOpen]);

  // Listen for typing SSE events dispatched by useNotifications
  useEffect(() => {
    if (!id) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { sessionId: string; senderRole: string };
      if (detail.sessionId !== id) return;
      // Show typing only if the OTHER party is typing
      const otherRole = isUser ? "listener" : "user";
      if (detail.senderRole !== otherRole) return;
      setOtherTyping(true);
      if (otherTypingRef.current) clearTimeout(otherTypingRef.current);
      otherTypingRef.current = setTimeout(() => setOtherTyping(false), 3000);
    };
    window.addEventListener("ss:typing", handler);
    return () => window.removeEventListener("ss:typing", handler);
  }, [id, isUser]);

  // Send typing event to server (debounced, max once per 2s)
  const sendTyping = useCallback(() => {
    if (!id) return;
    if (typingTimeoutRef.current) return; // throttle
    fetch(`/api/chat/sessions/${id}/typing`, { method: "POST", credentials: "include" }).catch(() => {});
    typingTimeoutRef.current = setTimeout(() => { typingTimeoutRef.current = null; }, 2000);
  }, [id]);

  const handleBodyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBody(e.target.value);
    if (e.target.value.trim()) sendTyping();
  };

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    setBody(prev => prev + emojiData.emoji);
    sendTyping();
    // Keep focus on input after selecting emoji
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // Close emoji picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    if (showEmojiPicker) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showEmojiPicker]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    const messageText = body.trim();
    setBody("");
    sendMessage.mutate(
      { id: id!, data: { body: messageText } },
      { onError: () => { toast.error("Failed to send message"); setBody(messageText); } }
    );
  };

  const handleEnd = () => {
    if (!isActive) return;
    endSession.mutate(
      { id: id! },
      {
        onSuccess: () => {
          toast.success("Session ended");
          if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
          if (isUser) setReviewOpen(true);
          else setFeedbackOpen(true);
        },
        onError: () => toast.error("Failed to end session"),
      }
    );
  };

  const handleSubmitReport = async (category: string, endAfter = false) => {
    if (!session) return;
    setSubmittingReport(true);
    try {
      const res = await fetch("/api/safety/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sessionId: id, reportedUserId: session.userId, category }),
      });
      const data = await res.json();
      if (!res.ok && res.status !== 409) throw new Error(data.error || "Failed");
      toast.success("Report submitted. This user has been blocked.");
    } catch (err: any) {
      toast.error(err?.message || "Failed to submit report.");
    } finally {
      setSubmittingReport(false);
      setReportOpen(false);
      setReportPhase("choose");
      setReportMode(null);
    }
    if (endAfter) {
      endSession.mutate({ id: id! }, {
        onSuccess: () => { if (tickIntervalRef.current) clearInterval(tickIntervalRef.current); setLocation("/chats"); },
      });
    }
  };

  const handleFeedbackSelect = async (category: string, isPositive: boolean) => {
    setFeedbackDone(true);
    setFeedbackOpen(false);
    if (isPositive) { setLocation("/chats"); return; }
    try {
      const res = await fetch("/api/safety/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sessionId: id, reportedUserId: session?.userId, category }),
      });
      const data = await res.json();
      if (!res.ok && res.status !== 409) throw new Error(data.error);
      toast.success("Thank you for keeping SunoSathi safe. This user has been blocked.");
    } catch {
      toast.error("Could not submit feedback.");
    }
    setLocation("/chats");
  };

  const handleReviewSubmit = () => {
    if (rating === 0) { toast.error("Please select a rating"); return; }
    if (comment.length < 3) { toast.error("Please leave a brief comment"); return; }
    postReview.mutate(
      { id: session!.listenerId, data: { rating, comment, sessionId: id! } },
      {
        onSuccess: () => { toast.success("Review submitted!"); setReviewOpen(false); setLocation("/chats"); },
        onError: (err: any) => toast.error(err?.data?.error || "Failed to submit review"),
      }
    );
  };

  const handleSkipReview = () => { setReviewOpen(false); setLocation("/chats"); };

  if (!session) return null;

  // Status label in header — always show Online/Offline (session end is shown in timeline)
  const statusLabel = (() => {
    if (otherTyping) return { text: "typing…", color: "text-primary animate-pulse" };
    if (listenerIsOnline) return { text: "Online", color: "text-green-500" };
    return { text: "Offline", color: "text-muted-foreground" };
  })();

  const statusDot = otherTyping
    ? "bg-primary animate-pulse"
    : listenerIsOnline
      ? "bg-green-500"
      : "bg-gray-500";

  return (
    <>
      {/* Typing bounce animation */}
      <style>{`
        @keyframes typing-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
          30% { transform: translateY(-5px); opacity: 1; }
        }
      `}</style>

      <PageTransition className="flex flex-col h-[100dvh] relative" style={{ background: "#0d0a14" }}>

        {/* ── Header ────────────────────────────────────────────────────────── */}
        <header
          className="absolute top-0 w-full z-10 px-3 py-2.5 flex items-center justify-between"
          style={{
            background: "rgba(13,10,20,0.88)",
            backdropFilter: "blur(20px)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            boxShadow: "0 1px 8px rgba(0,0,0,0.3)",
          }}
        >
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => history.back()}
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-muted/60 transition-colors -ml-1"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="relative">
              <img
                src={session.listenerPhotoUrl}
                alt={session.listenerName}
                className="w-9 h-9 rounded-full object-cover"
                style={{ border: "2px solid rgba(120,120,120,0.2)" }}
              />
              <span
                className={cn("absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-background", statusDot)}
              />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-sm leading-tight truncate">
                {isUser ? session.listenerName : session.userName}
              </h2>
              <p className={cn("text-xs leading-tight font-medium", statusLabel.color)}>
                {statusLabel.text}
                {isActive && session.billedMinutes > 0 && !otherTyping && (
                  <span className="text-muted-foreground font-normal"> · {session.billedMinutes}m</span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {isListener && isActive && (
              <button
                onClick={() => { setReportPhase("choose"); setReportMode(null); setReportOpen(true); }}
                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-orange-50 dark:hover:bg-orange-500/10 text-orange-500 transition-colors"
              >
                <Flag className="w-4 h-4" />
              </button>
            )}
            {isActive && (
              <button
                onClick={handleEnd}
                disabled={endSession.isPending}
                className="w-9 h-9 flex items-center justify-center rounded-full text-destructive hover:bg-destructive/10 transition-colors"
              >
                <PhoneOff className="w-5 h-5" />
              </button>
            )}
          </div>
        </header>

        {/* ── Messages ──────────────────────────────────────────────────────── */}
        <div
          className="flex-1 overflow-y-auto px-3 pt-[64px] pb-3 flex flex-col gap-1"
          style={{ paddingBottom: showEmojiPicker ? "410px" : "80px", transition: "padding-bottom 0.25s ease" }}
        >
          {/* Session start timeline card */}
          <SessionStartCard kind={session.kind} startedAt={session.startedAt} />

          {messages?.map((msg, idx) => {
            const isMe = msg.senderRole === profile?.role;
            const isSystem = msg.senderRole === "system";
            const prevMsg = idx > 0 ? messages[idx - 1] : null;
            const showTimestamp = !prevMsg || (new Date(msg.createdAt).getTime() - new Date(prevMsg.createdAt).getTime()) > 5 * 60 * 1000;

            if (isSystem) {
              return (
                <div key={msg.id} className="flex justify-center my-2">
                  <span
                    className="text-[11px] font-medium px-3 py-1 rounded-full"
                    style={{
                      background: "rgba(249,115,22,0.08)",
                      color: "#f97316",
                      border: "1px solid rgba(249,115,22,0.15)",
                    }}
                  >
                    {msg.body}
                  </span>
                </div>
              );
            }

            return (
              <div key={msg.id}>
                {showTimestamp && (
                  <div className="flex justify-center my-2">
                    <span className="text-[10px] text-muted-foreground/60">{formatIst(msg.createdAt)}</span>
                  </div>
                )}
                <div className={cn("flex", isMe ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[75%] flex flex-col", isMe ? "items-end" : "items-start")}>
                    <div
                      className={cn("px-4 py-2.5 text-sm leading-relaxed", isMe ? "rounded-2xl rounded-br-sm" : "rounded-2xl rounded-bl-sm")}
                      style={isMe
                        ? {
                            background: "linear-gradient(135deg, #f97316 0%, #ec4899 100%)",
                            color: "#fff",
                            boxShadow: "0 2px 8px rgba(249,115,22,0.25)",
                          }
                        : {
                            background: "rgba(120,120,120,0.1)",
                            color: "var(--foreground)",
                            border: "1px solid rgba(120,120,120,0.12)",
                          }
                      }
                    >
                      {msg.body}
                    </div>
                    <span className="text-[10px] text-muted-foreground/50 mt-0.5 px-1">
                      {formatIst(msg.createdAt)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Typing indicator bubble */}
          {otherTyping && <TypingBubble />}

          {/* Session end timeline card */}
          {!isActive && session.endedAt && (
            <SessionEndCard endedAt={session.endedAt} billedMinutes={session.billedMinutes} kind={session.kind} />
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* ── Input bar ─────────────────────────────────────────────────────── */}
        <div
          className="absolute bottom-0 left-0 right-0"
          style={{
            background: "rgba(13,10,20,0.94)",
            backdropFilter: "blur(16px)",
            borderTop: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {/* Emoji picker panel */}
          {showEmojiPicker && (
            <div
              ref={emojiPickerRef}
              className="px-2 pt-2"
              style={{ height: "340px" }}
            >
              <EmojiPicker
                theme={Theme.DARK}
                onEmojiClick={handleEmojiClick}
                width="100%"
                height={320}
                skinTonesDisabled
                searchPlaceholder="Search emoji…"
                previewConfig={{ showPreview: false }}
                style={{ background: "transparent", border: "none", boxShadow: "none" } as React.CSSProperties}
              />
            </div>
          )}

          <div
            className="px-3 py-2.5"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 10px)" }}
          >
            <form onSubmit={handleSend} className="flex items-center gap-2">
              {/* Emoji toggle button */}
              {isActive && (
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker(v => !v)}
                  className="w-9 h-9 flex items-center justify-center rounded-full shrink-0 transition-colors"
                  style={{
                    color: showEmojiPicker ? "#f97316" : "rgba(180,180,180,0.7)",
                    background: showEmojiPicker ? "rgba(249,115,22,0.12)" : "transparent",
                  }}
                >
                  <Smile className="w-5 h-5" />
                </button>
              )}

              <div className="flex-1 relative">
                <Input
                  ref={inputRef}
                  value={body}
                  onChange={handleBodyChange}
                  onFocus={() => setShowEmojiPicker(false)}
                  placeholder="Type a message…"
                  disabled={sendMessage.isPending}
                  inputMode="text"
                  autoComplete="off"
                  className="rounded-2xl border-0 focus-visible:ring-1 focus-visible:ring-primary/40"
                  style={{
                    background: "rgba(255,255,255,0.07)",
                    fontSize: "15px",
                    height: "46px",
                    paddingLeft: "16px",
                    paddingRight: "16px",
                    color: "rgba(255,255,255,0.92)",
                  }}
                />
              </div>
              <button
                type="submit"
                disabled={!body.trim() || sendMessage.isPending}
                className="shrink-0 flex items-center justify-center rounded-full transition-all duration-200 active:scale-90"
                style={{
                  width: "46px",
                  height: "46px",
                  background: body.trim()
                    ? "linear-gradient(135deg, #f97316 0%, #ec4899 100%)"
                    : "rgba(255,255,255,0.07)",
                  boxShadow: body.trim() ? "0 3px 12px rgba(249,115,22,0.4)" : "none",
                  opacity: body.trim() ? 1 : 0.45,
                }}
              >
                <Send className="w-4 h-4 text-white ml-0.5" />
              </button>
            </form>
          </div>
        </div>

        {/* ── User: Rate your listener ─────────────────────────────────────── */}
        <Sheet open={reviewOpen} onOpenChange={setReviewOpen}>
          <SheetContent side="bottom" className="rounded-t-[2rem] border-border/50">
            <SheetHeader className="text-left mb-6">
              <SheetTitle>Rate your listener</SheetTitle>
              <SheetDescription>How was your session with {session.listenerName}?</SheetDescription>
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
            <button onClick={handleSkipReview} className="w-full mt-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              Skip for now
            </button>
          </SheetContent>
        </Sheet>

        {/* ── Listener: In-session Report Sheet ────────────────────────────── */}
        <Sheet open={reportOpen} onOpenChange={open => {
          if (!open) { setReportPhase("choose"); setReportMode(null); }
          setReportOpen(open);
        }}>
          <SheetContent side="bottom" className="rounded-t-[2rem] border-border/50">
            <SheetHeader className="text-left mb-5">
              <div className="flex items-center gap-2">
                <Flag className="w-4 h-4 text-orange-500" />
                <SheetTitle>{reportPhase === "choose" ? "Report this user" : "What happened?"}</SheetTitle>
              </div>
              <SheetDescription>
                {reportPhase === "choose"
                  ? "Choose how you'd like to handle this situation."
                  : "Select the most appropriate reason for your report."}
              </SheetDescription>
            </SheetHeader>
            {reportPhase === "choose" && (
              <div className="space-y-3">
                <button
                  onClick={() => { setReportMode("end"); setReportPhase("category"); }}
                  className="w-full flex items-center justify-between p-4 rounded-2xl bg-destructive/5 border border-destructive/20 text-left"
                >
                  <div>
                    <p className="font-semibold text-destructive text-sm">⛔ End Session &amp; Block</p>
                    <p className="text-xs text-muted-foreground mt-0.5">End immediately, block this user, and file a report</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-destructive/50 shrink-0" />
                </button>
                <button
                  onClick={() => { setReportMode("continue"); setReportPhase("category"); }}
                  className="w-full flex items-center justify-between p-4 rounded-2xl bg-muted/50 border border-border/50 text-left"
                >
                  <div>
                    <p className="font-semibold text-sm">🔇 Report &amp; Continue</p>
                    <p className="text-xs text-muted-foreground mt-0.5">File a report silently without ending the session</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </button>
              </div>
            )}
            {reportPhase === "category" && (
              <div className="space-y-3">
                {REPORT_CATEGORIES.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => handleSubmitReport(cat.id, reportMode === "end")}
                    disabled={submittingReport}
                    className="w-full flex items-start gap-3 p-4 rounded-2xl bg-muted/50 border border-border/50 text-left hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    <span className="text-xl shrink-0">{cat.emoji}</span>
                    <div>
                      <p className="font-semibold text-sm">{cat.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{cat.desc}</p>
                    </div>
                  </button>
                ))}
                {submittingReport && <p className="text-center text-xs text-muted-foreground animate-pulse">Submitting…</p>}
                <button onClick={() => setReportPhase("choose")} className="w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  ← Back
                </button>
              </div>
            )}
          </SheetContent>
        </Sheet>

        {/* ── Listener: Post-session Feedback Sheet ───────────────────────── */}
        <Sheet open={feedbackOpen} onOpenChange={open => {
          if (!open && !feedbackDone) { setFeedbackDone(true); setLocation("/chats"); }
          setFeedbackOpen(open);
        }}>
          <SheetContent side="bottom" className="rounded-t-[2rem] border-border/50">
            <SheetHeader className="text-left mb-5">
              <SheetTitle>How was this session?</SheetTitle>
              <SheetDescription>
                Your safety matters. If anything felt wrong, let us know — it takes just a tap.
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-3">
              {FEEDBACK_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => handleFeedbackSelect(opt.id, opt.positive)}
                  className={cn(
                    "w-full flex items-start gap-3 p-4 rounded-2xl border text-left transition-colors",
                    opt.positive
                      ? "bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/20 hover:bg-green-100 dark:hover:bg-green-500/20"
                      : "bg-muted/50 border-border/50 hover:bg-muted"
                  )}
                >
                  <span className="text-xl shrink-0">{opt.emoji}</span>
                  <div>
                    <p className={cn("font-semibold text-sm", opt.positive ? "text-green-700 dark:text-green-400" : "")}>
                      {opt.label}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>
            <button
              onClick={() => { setFeedbackDone(true); setFeedbackOpen(false); setLocation("/chats"); }}
              className="w-full mt-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Skip for now
            </button>
          </SheetContent>
        </Sheet>

      </PageTransition>
    </>
  );
}
