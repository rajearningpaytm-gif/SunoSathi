import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setBaseUrl } from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import {
  useGetMyProfile,
  getGetMyProfileQueryKey,
} from "@workspace/api-client-react";
import { useEffect, useState, lazy, Suspense, Component, type ReactNode } from "react";

interface EBProps { children: ReactNode; resetKey?: string; }
interface EBState { hasError: boolean; }

class ErrorBoundary extends Component<EBProps, EBState> {
  constructor(props: EBProps) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(): EBState {
    return { hasError: true };
  }
  componentDidUpdate(prev: EBProps) {
    // Auto-reset when the route changes (resetKey changes)
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <p className="font-bold text-base mb-1">Kuch galat ho gaya</p>
          <p className="text-xs text-muted-foreground mb-5">Wapas jaao ya page reload karo.</p>
          <div className="flex gap-3">
            <button
              onClick={() => { window.history.back(); this.setState({ hasError: false }); }}
              className="bg-white/10 hover:bg-white/20 text-white px-5 py-2 rounded-full text-sm font-medium transition"
            >
              Wapas Jao
            </button>
            <button
              onClick={() => window.location.reload()}
              className="bg-purple-600 hover:bg-purple-700 text-white px-5 py-2 rounded-full text-sm font-medium transition"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
import { useNotifications } from "@/hooks/useNotifications";
import { useFcmToken } from "@/hooks/useFcmToken";
import {
  IncomingCallOverlay,
  type IncomingCallData,
} from "@/components/IncomingCallOverlay";

// ── Eagerly load critical path (no auth needed) ──────────────────────────────
import { AppShell } from "@/components/AppShell";
import SplashScreen from "@/pages/SplashScreen";
import AuthScreen from "@/pages/AuthScreen";
import Legal from "@/pages/Legal";

// ── Lazy load authenticated pages (only loaded after login) ──────────────────
const Onboarding         = lazy(() => import("@/pages/Onboarding"));
const UserOnboarding     = lazy(() => import("@/pages/UserOnboarding"));
const ListenerApply      = lazy(() => import("@/pages/ListenerApplyOnboarding"));
const PendingApproval    = lazy(() => import("@/pages/PendingApproval"));
const Home          = lazy(() => import("@/pages/Home"));
const ListenerDetail= lazy(() => import("@/pages/ListenerDetail"));
const Chats         = lazy(() => import("@/pages/Chats"));
const ChatRoom      = lazy(() => import("@/pages/ChatRoom"));
const Wallet        = lazy(() => import("@/pages/Wallet"));
const Apply         = lazy(() => import("@/pages/Apply"));
const Admin         = lazy(() => import("@/pages/Admin"));
const Settings         = lazy(() => import("@/pages/Settings"));
const Earnings         = lazy(() => import("@/pages/Earnings"));
const ListenerCallPage = lazy(() => import("@/pages/ListenerCallPage"));
const NotFound         = lazy(() => import("@/pages/not-found"));

// APK build: VITE_API_ORIGIN=https://sunosathi.replit.app makes all /api/* calls absolute.
// Web build: empty string → relative URLs work through the server proxy.
setBaseUrl(import.meta.env.VITE_API_ORIGIN || null);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
  },
});

function PageLoader() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

function AuthGatedRoutes() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { data: profile, isLoading: profileLoading } = useGetMyProfile({
    query: { enabled: isAuthenticated, queryKey: getGetMyProfileQueryKey() },
  });
  const [location, setLocation] = useLocation();
  const [incomingCall, setIncomingCall] = useState<IncomingCallData | null>(null);

  const notificationsEnabled = isAuthenticated && !!profile?.hasOnboarded;
  const isListener = notificationsEnabled && profile?.role === "listener";

  useNotifications(notificationsEnabled, isListener ? setIncomingCall : undefined);
  // Register FCM for ALL onboarded users (engagement push) + listeners (incoming calls)
  useFcmToken(notificationsEnabled, isListener);

  // ── Presence heartbeat — pings backend every 60s while tab is visible ──────
  // Powers admin Live tab "Online Users" section.
  useEffect(() => {
    if (!isAuthenticated || !profile?.hasOnboarded) return;
    const ping = () => {
      if (document.visibilityState !== "visible") return;
      fetch(`${import.meta.env.VITE_API_ORIGIN ?? ""}/api/me/heartbeat`, { method: "POST", credentials: "include" }).catch(() => {});
    };
    ping();
    const t = setInterval(ping, 60_000);
    document.addEventListener("visibilitychange", ping);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", ping); };
  }, [isAuthenticated, profile?.hasOnboarded]);

  // Handle service-worker messages (background FCM: user tapped "Accept" notification)
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "INCOMING_CALL_ACCEPT" && e.data.sessionId) {
        setIncomingCall(null);
        setLocation(`/chat/${e.data.sessionId}`);
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [setLocation]);

  // Always force dark mode — no toggle
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!isAuthenticated) return;
    if (!profile) return;
    if (!profile.hasOnboarded && !location.startsWith("/onboarding") && !location.startsWith("/admin")) {
      setLocation("/onboarding");
    } else if (profile.hasOnboarded && location === "/") {
      if (profile.role === "listener") {
        if (profile.listenerProfile?.applicationStatus === "approved") {
          setLocation("/earnings");
        } else {
          setLocation("/onboarding/pending");
        }
      } else {
        setLocation("/home");
      }
    } else if (
      profile.hasOnboarded &&
      profile.role === "listener" &&
      profile.listenerProfile?.applicationStatus !== "approved" &&
      !location.startsWith("/onboarding")
    ) {
      setLocation("/onboarding/pending");
    }
  }, [authLoading, profileLoading, isAuthenticated, profile, location, setLocation]);

  // Legal pages are accessible without auth
  if (location.startsWith("/legal/")) {
    return (
      <Switch>
        <Route path="/legal/terms"><Legal doc="terms" /></Route>
        <Route path="/legal/privacy"><Legal doc="privacy" /></Route>
        <Route path="/legal/safety"><Legal doc="safety" /></Route>
        <Route path="/legal/disclaimer"><Legal doc="disclaimer" /></Route>
      </Switch>
    );
  }

  // ── Admin portal is completely standalone — manages its own login/PIN flow.
  // Intercept before the unauthenticated → Landing redirect so admins always
  // land on the dedicated admin login screen, never on the consumer page.
  if (location.startsWith("/admin")) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Admin />
      </Suspense>
    );
  }

  if (authLoading || (isAuthenticated && profileLoading)) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    if (location === "/auth") return <AuthScreen />;
    return <SplashScreen />;
  }

  // Onboarding sub-routes are always accessible to authenticated users
  const isOnboardingRoute = location.startsWith("/onboarding");

  if (profile && !profile.hasOnboarded && !isOnboardingRoute) return null;
  if (profile?.hasOnboarded && location === "/") return null;

  // Onboarding routes rendered without AppShell
  if (isOnboardingRoute) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/onboarding"          component={Onboarding} />
          <Route path="/onboarding/user"     component={UserOnboarding} />
          <Route path="/onboarding/listener" component={ListenerApply} />
          <Route path="/onboarding/pending"  component={PendingApproval} />
        </Switch>
      </Suspense>
    );
  }

  return (
    <>
      {/* Full-screen incoming call overlay — renders above everything */}
      <IncomingCallOverlay
        call={incomingCall}
        onDismiss={() => setIncomingCall(null)}
        onNavigate={(id, kind) => setLocation(kind === "chat" ? `/chat/${id}` : kind === "video_call" ? `/call/${id}?video=1` : `/call/${id}`)}
      />

      <AppShell>
        <ErrorBoundary resetKey={location}>
          <Suspense fallback={<PageLoader />}>
            <Switch>
              <Route path="/home"          component={Home} />
              <Route path="/listeners/:id" component={ListenerDetail} />
              <Route path="/chats"         component={Chats} />
              <Route path="/chat/:id"      component={ChatRoom} />
              <Route path="/call/:id"      component={ListenerCallPage} />
              <Route path="/wallet"        component={Wallet} />
              <Route path="/apply"         component={Apply} />
              <Route path="/earnings"      component={Earnings} />
              <Route path="/settings"      component={Settings} />
              <Route component={NotFound} />
            </Switch>
          </Suspense>
        </ErrorBoundary>
      </AppShell>
    </>
  );
}

function App() {
  // Detect admin route from the real browser URL — before Wouter touches anything.
  // This guarantees /admin always opens the admin portal regardless of session state
  // or any client-side routing race conditions.
  const rawPath = window.location.pathname;
  const isAdminRoute =
    rawPath === "/admin" ||
    rawPath.startsWith("/admin/") ||
    rawPath === "/admin#" ||
    rawPath.includes("/admin");

  if (isAdminRoute) {
    return (
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <Suspense fallback={<PageLoader />}>
            <Admin />
          </Suspense>
          <Toaster position="top-center" richColors closeButton />
        </QueryClientProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AuthGatedRoutes />
          </WouterRouter>
          <Toaster position="top-center" richColors closeButton />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
