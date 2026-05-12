import { Router, type IRouter } from "express";
import {
  registerConnection,
  unregisterConnection,
} from "../lib/notifier";

const router: IRouter = Router();

router.get("/notifications/stream", (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const userId = req.user.id;
  registerConnection(userId, res);

  res.write(`event: connected\ndata: ${JSON.stringify({ userId })}\n\n`);

  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      clearInterval(heartbeat);
    }
  }, 20000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unregisterConnection(userId);
  });
});

export default router;
