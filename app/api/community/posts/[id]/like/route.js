/**
 * POST   /api/community/posts/[id]/like — like a post
 * DELETE /api/community/posts/[id]/like — unlike a post
 *
 * Backed by the CommunityLike join table (one row per user per post,
 * unique constraint) — CommunityPost.likes is kept as a fast denormalized
 * counter, incremented/decremented alongside the real per-user record so
 * a user can't like the same post twice by clicking repeatedly, and a page
 * refresh correctly shows whether they've already liked it.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";

export async function POST(request, { params }) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const post = await prisma.communityPost.findUnique({ where: { id: params.id } });
  if (!post) return err("Post not found.", 404);

  const existing = await prisma.communityLike.findUnique({
    where: { postId_userId: { postId: params.id, userId: auth.user.id } },
  });
  if (existing) return ok({ likes: post.likes, likedByMe: true }); // already liked — idempotent, not an error

  const [, updated] = await prisma.$transaction([
    prisma.communityLike.create({ data: { postId: params.id, userId: auth.user.id } }),
    prisma.communityPost.update({ where: { id: params.id }, data: { likes: { increment: 1 } } }),
  ]);

  return ok({ likes: updated.likes, likedByMe: true });
}

export async function DELETE(request, { params }) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const existing = await prisma.communityLike.findUnique({
    where: { postId_userId: { postId: params.id, userId: auth.user.id } },
  });
  if (!existing) {
    const post = await prisma.communityPost.findUnique({ where: { id: params.id } });
    return ok({ likes: post?.likes || 0, likedByMe: false }); // wasn't liked — idempotent
  }

  const [, updated] = await prisma.$transaction([
    prisma.communityLike.delete({ where: { id: existing.id } }),
    prisma.communityPost.update({ where: { id: params.id }, data: { likes: { decrement: 1 } } }),
  ]);

  return ok({ likes: updated.likes, likedByMe: false });
}
