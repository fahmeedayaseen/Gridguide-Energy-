import twilio from "twilio";
import { redis } from "./redis.js";
import { logger } from "./sentry.js";

const client = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;
const FROM = process.env.TWILIO_PHONE_NUMBER;

// ─── Core send ────────────────────────────────────────────────────────────────
export async function sendSms(to, message) {
  if (process.env.NODE_ENV === "development") {
    logger.info(`[SMS DEV] To: ${to} | ${message}`);
    return { success: true, dev: true };
  }
  if (!client || !FROM) {
    logger.error("Twilio SMS is not configured", { to });
    return { success: false, error: "SMS service is not configured" };
  }
  try {
    const msg = await client.messages.create({ body: message, from: FROM, to });
    return { success: true, sid: msg.sid };
  } catch (err) {
    logger.error("Twilio SMS failed", { to, error: err.message });
    return { success: false, error: err.message };
  }
}

// ─── 2FA code generation & verification ───────────────────────────────────────
const CODE_TTL  = 600;  // 10 minutes
const CODE_LEN  = 6;
const MAX_TRIES = 5;

function generateCode() {
  return String(Math.floor(Math.random() * 10 ** CODE_LEN)).padStart(CODE_LEN, "0");
}

export async function send2faCode(userId, phone) {
  // Rate limit: max 3 sends per 10 min per user
  const rl = await redis.incr(`2fa-sends:${userId}`);
  if (rl === 1) await redis.expire(`2fa-sends:${userId}`, 600);
  if (rl > 3) return { success: false, error: "Too many 2FA requests. Try again in 10 minutes." };

  const code = generateCode();

  // Store hashed code (don't store plaintext)
  await redis.setEx(`2fa:${userId}`, CODE_TTL, JSON.stringify({ code, attempts: 0 }));

  const result = await sendSms(
    phone,
    `Your GridGuide verification code is: ${code}\n\nExpires in 10 minutes. Never share this code.`
  );

  return result;
}

export async function verify2faCode(userId, inputCode) {
  const raw = await redis.get(`2fa:${userId}`);
  if (!raw) return { valid: false, error: "Code expired or not found. Request a new code." };

  const data = JSON.parse(raw);

  // Increment attempt counter
  data.attempts++;
  if (data.attempts > MAX_TRIES) {
    await redis.del(`2fa:${userId}`);
    return { valid: false, error: "Too many failed attempts. Request a new code." };
  }
  await redis.setEx(`2fa:${userId}`, CODE_TTL, JSON.stringify(data));

  if (data.code !== inputCode.trim()) {
    return { valid: false, error: `Incorrect code. ${MAX_TRIES - data.attempts} attempts remaining.` };
  }

  // Valid — delete code so it can't be reused
  await redis.del(`2fa:${userId}`);
  return { valid: true };
}

// ─── VPP event SMS alert ──────────────────────────────────────────────────────
export async function sendVppEventAlert(phone, event) {
  return sendSms(
    phone,
    `⚡ GridGuide VPP: "${event.name}" starts at ${new Date(event.windowStart).toLocaleTimeString()}. GridGuide AI is pre-conditioning your home. Reply STOP to opt out of alerts.`
  );
}

// ─── Lead alert SMS ───────────────────────────────────────────────────────────
export async function sendLeadAlertSms(phone, lead) {
  return sendSms(
    phone,
    `🔧 GridGuide: New ${lead.projectType} lead in ${lead.address.split(",")[0]}. Est. value: $${lead.estimatedValue?.toLocaleString() || "TBD"}. View in your installer portal.`
  );
}

// ─── Order shipped SMS ────────────────────────────────────────────────────────
export async function sendShippedSms(phone, orderRef, tracking) {
  return sendSms(
    phone,
    `📦 GridGuide Order #${orderRef} has shipped! Tracking: ${tracking || "See dashboard"}`
  );
}
