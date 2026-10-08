import crypto from "crypto";
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { getProviderEnv, normalizeProviderKey } from "@/lib/vpp-partners.js";
import { settleVppEventBatch, recomputeEventGrossRevenue } from "@/lib/vpp-settlement.js";
import { IS_PROD } from "@/lib/secrets.js";

function validSignature(raw, signature, secret) {
  if (!secret) return !IS_PROD; // only reachable in development — production requires a configured secret
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const provided = String(signature || "").replace(/^sha256=/, "");
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

const SETTLEMENT_EVENT_TYPES = ["settlement.reported", "event.settled", "dispatch.settled", "vpp.settlement.completed"];

export async function POST(request, { params }) {
  const providerKey = normalizeProviderKey(params.provider);
  const provider = await prisma.vppProvider.findUnique({ where: { key: providerKey } });
  if (!provider) return err("Unknown VPP provider", 404);
  const raw = await request.text();
  const env = getProviderEnv(providerKey);
  const sig = request.headers.get("x-gridguide-signature") || request.headers.get("x-leap-signature") || request.headers.get("x-enel-signature");
  if (!validSignature(raw, sig, env.webhookSecret)) return err("Invalid webhook signature", 401);
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { return err("Invalid JSON", 400); }
  const eventType = payload.type || payload.event_type || payload.eventType || "unknown";
  const externalId = payload.id || payload.event_id || payload.externalEventId || null;
  // De-duplicate partner retries. The key is the delivery id when the partner
  // sends one, otherwise the payload id, scoped by event type (so
  // event.created and event.updated for the same event are both kept).
  // (providerId, externalId) is unique; a retry is acknowledged with 200 and
  // not processed again — previously each retry re-ran event/settlement logic.
  const deliveryId = request.headers.get("x-webhook-id") || request.headers.get("x-delivery-id") || request.headers.get("idempotency-key")
    || payload.webhook_id || payload.delivery_id || externalId;
  const dedupeKey = deliveryId ? `${eventType}:${deliveryId}` : null;
  let webhook;
  try {
    webhook = await prisma.vppProviderWebhook.create({ data: { providerId: provider.id, eventType, externalId: dedupeKey, payload } });
  } catch (e) {
    if (e?.code === "P2002") return ok({ received: true, duplicate: true });
    throw e;
  }

  if (["event.created", "vpp.event.created", "event.updated", "dispatch.created"].includes(eventType)) {
    const start = payload.windowStart || payload.start || payload.window_start;
    const end = payload.windowEnd || payload.end || payload.window_end;
    if (start && end) {
      // Match an existing local event by our id or the partner's event id.
      // (The old code keyed new events on the webhook row id, so every
      // event.updated delivery created a duplicate event.)
      const existing = payload.localId
        ? await prisma.vppPartnerEvent.findUnique({ where: { id: payload.localId } })
        : externalId ? await prisma.vppPartnerEvent.findFirst({ where: { providerId: provider.id, externalEventId: externalId } }) : null;
      const extProgramId = payload.programExternalId || payload.program_id || payload.externalProgramId || null;
      const program = extProgramId ? await prisma.vppGridProgram.findFirst({ where: { providerId: provider.id, externalProgramId: String(extProgramId) } }) : null;
      const statusMap = { SCHEDULED: "SCHEDULED", ACTIVE: "ACTIVE", COMPLETED: "COMPLETED", CANCELLED: "CANCELLED", CANCELED: "CANCELLED" };
      const status = statusMap[String(payload.status || "").toUpperCase()];
      try {
        if (existing) {
          await prisma.vppPartnerEvent.update({ where: { id: existing.id }, data: { ...(status && { status }), windowStart: new Date(start), windowEnd: new Date(end), metadata: payload } });
        } else {
          const created = await prisma.vppPartnerEvent.create({ data: { providerId: provider.id, programId: program?.id || null, externalEventId: externalId, name: payload.name || `${provider.name} Grid Event`, windowStart: new Date(start), windowEnd: new Date(end), ...(status && { status }), grossRevenue: Number(payload.grossRevenue || payload.revenue || 0), metadata: payload } });
          if (created.programId) {
            const enrollees = await prisma.vppProgramEnrollment.findMany({ where: { programId: created.programId, status: "ACTIVE" }, select: { id: true, userId: true } });
            if (enrollees.length) await prisma.vppEventParticipation.createMany({ data: enrollees.map(e => ({ eventId: created.id, enrollmentId: e.id, userId: e.userId, status: "INVITED" })), skipDuplicates: true });
          }
        }
      } catch (e) {
        await prisma.vppProviderWebhook.update({ where: { id: webhook.id }, data: { processError: `Event upsert failed: ${e.message}` } }).catch(() => {});
      }
    }
  }

  // ── Live settlement delivery ──────────────────────────────────────────────
  // A partner can report settlement data directly via webhook instead of (or
  // in addition to) an admin importing a settlement file through
  // POST /api/vpp/events/partner/[id]/settlement. Both paths call the exact
  // same settleVppEventBatch function, so the split math and wallet-deposit
  // idempotency guarantees are identical regardless of how the data arrived.
  //
  // Expected payload shape (partner-specific field names are normalized
  // below; adjust the normalization once real Leap/Enel settlement payload
  // docs are available — this is a reasonable best guess, not a confirmed
  // partner contract):
  //   { type: "settlement.reported", localEventId?, externalEventId?,
  //     participants: [{ externalEnrollmentId, grossAmount, deliveredKwh? }] }
  let settlementSummary = null;
  if (SETTLEMENT_EVENT_TYPES.includes(eventType)) {
    const participants = Array.isArray(payload.participants) ? payload.participants : null;
    let localEvent = null;
    if (payload.localEventId) {
      localEvent = await prisma.vppPartnerEvent.findUnique({ where: { id: payload.localEventId } });
    } else if (externalId) {
      localEvent = await prisma.vppPartnerEvent.findFirst({ where: { providerId: provider.id, externalEventId: externalId } });
    }

    if (!localEvent) {
      await prisma.vppProviderWebhook.update({ where: { id: webhook.id }, data: { processError: "Settlement webhook received but no matching local VppPartnerEvent found (checked localEventId and externalEventId)." } });
    } else if (!participants || participants.length === 0) {
      await prisma.vppProviderWebhook.update({ where: { id: webhook.id }, data: { processError: "Settlement webhook received but payload had no participants array." } });
    } else {
      const normalized = participants.map(p => ({
        externalEnrollmentId: p.externalEnrollmentId || p.enrollmentId || p.external_enrollment_id || null,
        grossAmount: Number(p.grossAmount ?? p.amount ?? p.gross_amount ?? 0),
        deliveredKwh: p.deliveredKwh ?? p.delivered_kwh ?? undefined,
      })).filter(p => p.externalEnrollmentId && p.grossAmount > 0);

      const batch = await settleVppEventBatch(prisma, { eventId: localEvent.id, participants: normalized, metadata: { source: "webhook", webhookId: webhook.id } });
      settlementSummary = { successCount: batch.successCount, failCount: batch.failCount, depositFailedCount: batch.depositFailedCount, totals: batch.totals };

      const grossRevenue = await recomputeEventGrossRevenue(prisma, localEvent.id);
      settlementSummary.grossRevenue = grossRevenue;
      await prisma.vppPartnerEvent.update({
        where: { id: localEvent.id },
        data: {
          status: (batch.failCount === 0 && batch.depositFailedCount === 0) ? "SETTLED" : "SETTLEMENT_PENDING",
        },
      }).catch(() => null);

      if (batch.failCount > 0 || batch.depositFailedCount > 0) {
        const unresolved = batch.results.filter(r => !r.ok).map(r => r.error);
        const depositIssues = batch.results.filter(r => r.ok && r.depositFailed).map(r => r.depositError);
        await prisma.vppProviderWebhook.update({
          where: { id: webhook.id },
          data: { processError: [...unresolved, ...depositIssues].slice(0, 8).join("; ") || "One or more participants could not be fully settled." },
        }).catch(() => null);
      }
    }
  }

  await prisma.vppProviderWebhook.update({ where: { id: webhook.id }, data: { processed: true } });
  return ok({ received: true, webhookId: webhook.id, settlement: settlementSummary });
}
