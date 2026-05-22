# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## App: SunoSathi

Emotional support web app (mobile-first). Users chat/call verified Listeners (₹4/min chat, ₹6/min call).

### Architecture

- `artifacts/sunosathi` — React + Vite mobile-first web app (THE only user-facing app)
- `artifacts/api-server` — Express API (port 8080, proxied at `/api`)
- `lib/db` — Drizzle ORM schema + PostgreSQL client
- `lib/api-spec` — OpenAPI spec + codegen
- Firebase Auth (Phone OTP + email + Google) — via `firebase/auth`
- Firebase Admin SDK — `FIREBASE_SERVICE_ACCOUNT` secret

> The user does NOT want a separate Expo/native mobile app. The web app is
> mobile-first and is the single deliverable. Do not recreate `artifacts/sunosathi-mobile`.

### Completed Features

1. **Auth** — Phone OTP + Email/password dual login
2. **Listener System** — Application, approval, online/offline status
3. **Chat/Call Sessions** — Ringing state, billing after accept, tick-based per-minute billing
4. **Incoming Call Flow**:
   - Session created as `"ringing"` — no billing yet
   - `POST /api/chat/sessions/:id/accept` — listener accepts, billing starts (first minute)
   - `POST /api/chat/sessions/:id/decline` — listener declines
   - `POST /api/chat/sessions/:id/ring-timeout` — auto-missed after 20s
   - SSE events: `call_accepted`, `call_declined`, `call_missed` dispatched as browser CustomEvents for CallScreen
5. **IncomingCallOverlay** — Full-screen overlay with pulsing avatar, countdown ring, Web Audio ringtone, Accept/Decline
6. **FCM Web Push** — `PUT /api/listener/fcm-token` stores device token; `sendCallFcm()` fires background push; `firebase-messaging-sw.js` service worker
7. **Wallet & Earnings** — User recharge, listener withdrawal, payout buttons
8. **Safety System** — In-call report sheet, admin safety alerts
9. **ChatRoom** — Real-time messaging (SSE), message history

### Session Status Flow

```
ringing → active → ended
        → declined
        → missed
```

### FCM Setup (VAPID Key)

To enable background push notifications:
1. Firebase Console → Project Settings → Cloud Messaging → Web configuration
2. Click "Generate key pair" under "Web Push certificates"
3. Add as Replit Secret: `VITE_FIREBASE_VAPID_KEY`

Without the VAPID key, foreground SSE + IncomingCallOverlay still works; only background push is disabled.

### Key Files

- `artifacts/sunosathi/src/components/IncomingCallOverlay.tsx` — Full-screen incoming call UI
- `artifacts/sunosathi/src/lib/ringtone.ts` — Web Audio API ringtone
- `artifacts/sunosathi/src/hooks/useFcmToken.ts` — FCM token registration
- `artifacts/sunosathi/public/firebase-messaging-sw.js` — FCM background service worker
- `artifacts/api-server/src/lib/firebaseAdmin.ts` — Firebase Admin + `sendCallFcm()`
- `artifacts/api-server/src/routes/chat.ts` — Session management (ringing/accept/decline)
- `artifacts/api-server/src/lib/notifier.ts` — SSE event system
