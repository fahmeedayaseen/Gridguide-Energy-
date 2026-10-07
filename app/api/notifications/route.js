import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";

// GET /api/notifications — user's notifications
export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const unreadOnly = searchParams.get("unread") === "true";

  const notifications = await prisma.notification.findMany({
    where: { userId: auth.user.id, ...(unreadOnly && { read: false }) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const unreadCount = await prisma.notification.count({
    where: { userId: auth.user.id, read: false },
  });

  return ok({ notifications, unreadCount });
}

// PATCH /api/notifications — mark all as read
export async function PATCH(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  await prisma.notification.updateMany({
    where: { userId: auth.user.id, read: false },
    data:  { read: true },
  });

  return ok({ message: "All notifications marked as read." });
}

// DELETE /api/notifications — clear all
export async function DELETE(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  await prisma.notification.deleteMany({ where: { userId: auth.user.id } });
  return ok({ message: "Notifications cleared." });
}
