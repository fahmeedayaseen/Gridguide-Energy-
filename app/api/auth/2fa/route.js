import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { send2faCode, verify2faCode } from "@/lib/sms.js";
import { z } from "zod";

// POST /api/auth/2fa?action=send|verify|enable|disable
export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  switch (action) {

    // ── Send 2FA code ──────────────────────────────────────────────────────────
    case "send": {
      const user = await prisma.user.findUnique({
        where:  { id: auth.user.id },
        select: { phone: true },
      });
      if (!user?.phone) return err("No phone number on file. Add a phone number in your profile settings first.", 400);

      const result = await send2faCode(auth.user.id, user.phone);
      if (!result.success) return err(result.error || "Failed to send SMS", 500);

      return ok({ message: "Verification code sent to your phone." });
    }

    // ── Verify 2FA code ────────────────────────────────────────────────────────
    case "verify": {
      const { data, error } = await parseBody(request, z.object({ code: z.string().length(6) }));
      if (error) return err("Invalid code format", 400);

      const result = await verify2faCode(auth.user.id, data.code);
      if (!result.valid) return err(result.error, 401);

      return ok({ verified: true, message: "Identity verified." });
    }

    // ── Enable 2FA (after verifying a code first) ──────────────────────────────
    case "enable": {
      const { data, error } = await parseBody(request, z.object({
        code:  z.string().length(6),
        phone: z.string().min(10),
      }));
      if (error) return err("Invalid request", 400);

      const result = await verify2faCode(auth.user.id, data.code);
      if (!result.valid) return err(result.error, 401);

      await prisma.user.update({
        where: { id: auth.user.id },
        data:  { phone: data.phone, twoFactorEnabled: true },
      });

      return ok({ message: "Two-factor authentication enabled." });
    }

    // ── Disable 2FA ────────────────────────────────────────────────────────────
    case "disable": {
      const { data, error } = await parseBody(request, z.object({ code: z.string().length(6) }));
      if (error) return err("Invalid request", 400);

      const result = await verify2faCode(auth.user.id, data.code);
      if (!result.valid) return err(result.error, 401);

      await prisma.user.update({
        where: { id: auth.user.id },
        data:  { twoFactorEnabled: false },
      });

      return ok({ message: "Two-factor authentication disabled." });
    }

    default:
      return err("Invalid action. Use: send, verify, enable, or disable", 400);
  }
}

// GET /api/auth/2fa — get 2FA status for current user
export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const user = await prisma.user.findUnique({
    where:  { id: auth.user.id },
    select: { twoFactorEnabled: true, phone: true },
  });

  return ok({
    enabled:    user?.twoFactorEnabled || false,
    hasPhone:   !!user?.phone,
    // Mask phone number for display: (555) 012-***4
    phoneMasked: user?.phone
      ? user.phone.slice(0, -4).replace(/\d/g, "•") + user.phone.slice(-4)
      : null,
  });
}
