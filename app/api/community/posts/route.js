/**
 * GET  /api/community/posts           — list posts (public, paginated)
 * POST /api/community/posts           — create post (auth required)
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z } from "zod";

const createSchema = z.object({
  title:    z.string().min(5).max(200),
  body:     z.string().min(20).max(5000),
  tag:      z.string(),
  location: z.string().max(100).optional(),
});

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const tag    = searchParams.get("tag");
  const search = searchParams.get("q");
  const limit  = Math.min(parseInt(searchParams.get("limit") || "20"), 50);
  const cursor = searchParams.get("cursor");

  // Optional — an anonymous visitor can browse the community feed; only
  // signed-in users get their own like state attached.
  const auth = await authenticateRequest(request).catch(() => ({ error: true }));
  const viewerId = auth?.user?.id || null;

  const posts = await prisma.communityPost.findMany({
    where: {
      published: true,
      ...(tag ? { tag } : {}),
      ...(search ? { OR: [{ title: { contains: search, mode: "insensitive" } }, { body: { contains: search, mode: "insensitive" } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take:    limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      user:    { select: { name: true, avatar: true } },
      _count:  { select: { replies: true } },
      ...(viewerId ? { likedBy: { where: { userId: viewerId }, select: { id: true } } } : {}),
    },
  });

  const hasMore = posts.length > limit;
  const items   = (hasMore ? posts.slice(0, limit) : posts).map((p) => ({
    ...p,
    likedByMe: viewerId ? (p.likedBy?.length > 0) : false,
    likedBy: undefined,
  }));
  const next    = hasMore ? items[items.length - 1].id : null;

  return ok({ posts: items, hasMore, cursor: next });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, createSchema);
  if (error) return err("Validation failed", 400, error);

  const post = await prisma.communityPost.create({
    data: {
      userId:   auth.user.id,
      title:    data.title,
      body:     data.body,
      tag:      data.tag,
      location: data.location || null,
    },
    include: {
      user:   { select: { name: true } },
      _count: { select: { replies: true } },
    },
  });

  return ok({ post, message: "Post published." }, 201);
}
