import { prisma } from "@/lib/db.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { err } from "@/lib/auth.js";
import { getThermostatState } from "@/lib/redis.js";

/**
 * GET /api/events — Server-Sent Events (SSE) stream
 * 
 * Streams real-time dashboard updates to the client:
 *   - Thermostat state (every 30s)
 *   - Unread notification count (every 30s)
 *   - Active VPP event status (every 60s)
 *   - Device live readings (every 60s)
 * 
 * Client usage:
 *   const es = new EventSource("/api/events", { withCredentials: true });
 *   es.addEventListener("thermostat", (e) => setThermo(JSON.parse(e.data)));
 *   es.addEventListener("notifications", (e) => setUnread(JSON.parse(e.data).count));
 *   es.addEventListener("vpp", (e) => setVppEvent(JSON.parse(e.data)));
 *   es.addEventListener("heartbeat", () => {}); // keep-alive
 */
export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = auth.user.id;
  const encoder = new TextEncoder();

  /** Format an SSE message */
  function sse(event, data) {
    return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  const stream = new ReadableStream({
    async start(controller) {
      let active = true;

      const safeEnqueue = (chunk) => {
        try { if (active) controller.enqueue(chunk); } catch {}
      };

      // ── Initial data push on connect ────────────────────────────────────────
      try {
        // 1. Unread notifications
        const unread = await prisma.notification.count({
          where: { userId, read: false },
        });
        safeEnqueue(sse("notifications", { count: unread }));

        // 2. Thermostat state (from cache)
        const thermo = await getThermostatState(userId);
        if (thermo) safeEnqueue(sse("thermostat", thermo));

        // 3. Active VPP events
        const vppEvent = await prisma.vppEvent.findFirst({
          where: { status: "ACTIVE" },
          select: { id: true, name: true, windowStart: true, windowEnd: true, netPool: true, participantCount: true },
        });
        if (vppEvent) safeEnqueue(sse("vpp", vppEvent));

        // 4. Device summary (solar production, battery SOC)
        const devices = await prisma.device.findMany({
          where:  { userId, status: "ACTIVE" },
          select: { id: true, type: true, manufacturer: true, model: true, lastReading: true, lastSeenAt: true },
        });
        safeEnqueue(sse("devices", { devices }));

        // Heartbeat to confirm connection
        safeEnqueue(sse("heartbeat", { ts: Date.now() }));

      } catch (initErr) {
        console.error("[SSE] Initial push error:", initErr.message);
      }

      // ── Poll loop: push updates every 30 seconds ──────────────────────────
      const interval = setInterval(async () => {
        if (!active) return clearInterval(interval);

        try {
          // Notifications (fast, cached-friendly)
          const unread = await prisma.notification.count({
            where: { userId, read: false },
          });
          safeEnqueue(sse("notifications", { count: unread }));

          // Thermostat
          const thermo = await getThermostatState(userId);
          if (thermo) safeEnqueue(sse("thermostat", thermo));

          // VPP event (changes infrequently — check every cycle)
          const vppEvent = await prisma.vppEvent.findFirst({
            where: { status: { in: ["ACTIVE", "SCHEDULED"] } },
            orderBy: { windowStart: "asc" },
            select: { id: true, name: true, status: true, windowStart: true, windowEnd: true, netPool: true },
          });
          safeEnqueue(sse("vpp", vppEvent || null));

          // Heartbeat
          safeEnqueue(sse("heartbeat", { ts: Date.now() }));

        } catch (pollErr) {
          console.error("[SSE] Poll error:", pollErr.message);
          safeEnqueue(sse("error", { message: "Stream error — reconnecting" }));
        }
      }, 30_000); // 30 seconds

      // ── Device readings: slower poll every 60s ─────────────────────────────
      const deviceInterval = setInterval(async () => {
        if (!active) return clearInterval(deviceInterval);
        try {
          const devices = await prisma.device.findMany({
            where:  { userId, status: "ACTIVE" },
            select: { id: true, type: true, lastReading: true, lastSeenAt: true },
          });
          safeEnqueue(sse("devices", { devices }));
        } catch {}
      }, 60_000);

      // ── Admin-only stream: platform stats ──────────────────────────────────
      if (auth.user.role === "ADMIN") {
        const adminInterval = setInterval(async () => {
          if (!active) return clearInterval(adminInterval);
          try {
            const [userCount, pendingSellers, pendingProducts, activeVpp] = await Promise.all([
              prisma.user.count(),
              prisma.seller.count({ where: { verificationStatus: "PENDING" } }),
              prisma.product.count({ where: { status: "PENDING_REVIEW" } }),
              prisma.vppEvent.count({ where: { status: "ACTIVE" } }),
            ]);
            safeEnqueue(sse("admin_stats", { userCount, pendingSellers, pendingProducts, activeVpp, ts: Date.now() }));
          } catch {}
        }, 30_000);
      }

      // ── Cleanup on client disconnect ───────────────────────────────────────
      request.signal?.addEventListener("abort", () => {
        active = false;
        clearInterval(interval);
        clearInterval(deviceInterval);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection":    "keep-alive",
      "X-Accel-Buffering": "no",  // disable nginx buffering
    },
  });
}
