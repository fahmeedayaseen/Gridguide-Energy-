import crypto from "crypto";
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { getProviderEnv, normalizeProviderKey } from "@/lib/vpp-partners.js";
import { settleVppEventBatch, recomputeEventGrossRevenue } from "@/lib/vpp-settlement.js";
import { insecureDevBypassEnabled } from "@/lib/secrets.js";

function validSignature(raw, signature, secret) {
  // Fail closed on every deployed environment (Audit §5 M1): a missing secret
  // rejects the webhook unless a developer explicitly enabled the local-only
  // bypass (ALLOW_INSECURE_DEV_SECRETS=true, ignored in production).
  if (!secret) return insecureDevBypassEnabled();
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
  const webhook = await prisma.vppProviderWebhook.create({ data: { providerId: provider.id, eventType, externalId, payload } });

  if (["event.created", "vpp.event.created", "event.updated", "dispatch.created"].includes(eventType)) {
    const start = payload.windowStart || payload.start || payload.window_start;
    const end = payload.windowEnd || payload.end || payload.window_end;
    if (start && end) {
      await prisma.vppPartnerEvent.upsert({
        where: { id: payload.localId || `webhook-${webhook.id}` },
        update: { status: payload.status?.toUpperCase?.() || undefined, metadata: payload },
        create: { id: payload.localId || `webhook-${webhook.id}`, providerId: provider.id, externalEventId: externalId, name: payload.name || `${provider.name} Grid Event`, windowStart: new Date(start), windowEnd: new Date(end), grossRevenue: Number(payload.grossRevenue || payload.revenue || 0), metadata: payload },
      }).catch(() => null);
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
