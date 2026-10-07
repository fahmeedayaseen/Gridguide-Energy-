/**
 * GET  /api/community/posts/[id]/replies  — list replies
 * POST /api/community/posts/[id]/replies  — add a reply
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z } from "zod";

const replySchema = z.object({ body: z.string().min(1).max(2000) });

export async function GET(request, { params }) {
  const { id } = params;
  const post = await prisma.communityPost.findUnique({ where: { id } });
  if (!post) return err("Post not found.", 404);

  const replies = await prisma.communityReply.findMany({
    where:   { postId: id },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { name: true } } },
  });

  return ok({ replies });
}

export async function POST(request, { params }) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { id } = params;
  const post = await prisma.communityPost.findUnique({ where: { id } });
  if (!post) return err("Post not found.", 404);

  const { data, error } = await parseBody(request, replySchema);
  if (error) return err("Validation failed", 400, error);

  const reply = await prisma.communityReply.create({
    data: { postId: id, userId: auth.user.id, body: data.body },
    include: { user: { select: { name: true } } },
  });

  return ok({ reply, message: "Reply posted." }, 201);
}
