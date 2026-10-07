/**
 * lib/suppression.js
 * Email suppression list — checked before every marketing send.
 * Transactional emails (account-security, password reset) bypass suppression.
 */
import { prisma } from "./db.js";

/**
 * Check if an email is suppressed.
 * Returns the suppression record if found, null if not suppressed.
 */
export async function isSuppressed(email) {
  return prisma.emailSuppression.findUnique({
    where: { email: email.toLowerCase().trim() },
  });
}

/**
 * Add an email to the suppression list.
 * reason: UNSUBSCRIBE | BOUNCE | COMPLAINT | ADMIN | EXPIRED
 * source: origin system (e.g. "installer-invite", "enterprise-invite", "webhook")
 */
export async function suppress(email, reason, source, metadata) {
  return prisma.emailSuppression.upsert({
    where:  { email: email.toLowerCase().trim() },
    create: { email: email.toLowerCase().trim(), reason, source, metadata },
    update: { reason, source, metadata, updatedAt: new Date() },
  });
}

/**
 * Remove from suppression list (admin action — requires audit log entry separately).
 */
export async function unsuppress(email) {
  return prisma.emailSuppression.deleteMany({
    where: { email: email.toLowerCase().trim() },
  });
}

/**
 * Issue an unsubscribe token for an email address.
 * Used when building email footers — call once per send.
 */
export async function issueUnsubscribeToken(email) {
  const record = await prisma.unsubscribeToken.create({
    data: { email: email.toLowerCase().trim() },
  });
  return record.token;
}

/**
 * Process an unsubscribe token.
 * Returns { success, email } or { error }.
 */
export async function processUnsubscribe(token) {
  const record = await prisma.unsubscribeToken.findUnique({ where: { token } });
  if (!record) return { error: "Token not found." };
  if (record.usedAt) return { error: "This unsubscribe link has already been used." };

  await prisma.$transaction([
    prisma.unsubscribeToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.emailSuppression.upsert({
      where:  { email: record.email },
      create: { email: record.email, reason: "UNSUBSCRIBE", source: "self-service" },
      update: { reason: "UNSUBSCRIBE", updatedAt: new Date() },
    }),
  ]);

  return { success: true, email: record.email };
}
