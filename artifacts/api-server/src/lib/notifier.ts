import type { Response } from "express";

export type NotificationEvent =
  | {
      type: "new_session";
      sessionId: string;
      kind: "chat" | "call" | "video_call";
      userName: string;
      userAvatarSeed: string;
    }
  | {
      type: "new_message";
      sessionId: string;
      userName: string;
      preview: string;
    }
  | {
      type: "call_accepted";
      sessionId: string;
    }
  | {
      type: "call_declined";
      sessionId: string;
    }
  | {
      type: "call_missed";
      sessionId: string;
    }
  | {
      type: "session_ended";
      sessionId: string;
    }
  | {
      type: "typing";
      sessionId: string;
      senderRole: "user" | "listener";
    };

const connections = new Map<string, Response>();

export function registerConnection(userId: string, res: Response) {
  const existing = connections.get(userId);
  if (existing) {
    try {
      existing.end();
    } catch {
      // already closed
    }
  }
  connections.set(userId, res);
}

export function unregisterConnection(userId: string) {
  connections.delete(userId);
}

export function notifyUser(userId: string, event: NotificationEvent) {
  const res = connections.get(userId);
  if (!res) return;
  try {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch {
    connections.delete(userId);
  }
}
