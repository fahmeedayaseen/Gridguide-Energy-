/**
 * GET  /api/blog          — list published posts (public)
 * POST /api/blog          — create post (admin only)
 * PATCH /api/blog?id=     — update post (admin only)
 * DELETE /api/blog?id=    — delete post (admin only)
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest, requireRole } from "@/lib/jwt.js";
import { z } from "zod";

const postSchema = z.object({
  title:       z.string().min(5).max(200),
  body:        z.string().min(50),
  excerpt:     z.string().max(300).optional(),
  tag:         z.string(),
  authorName:  z.string().optional(),
  published:   z.boolean().optional().default(false),
  readMinutes: z.number().int().min(1).max(60).optional().default(5),
  slug:        z.string().optional(),
});

function toSlug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const tag    = searchParams.get("tag");
  const limit  = Math.min(parseInt(searchParams.get("limit") || "20"), 50);
  const slug   = searchParams.get("slug");

  if (slug) {
    const post = await prisma.blogPost.findUnique({ where: { slug } });
    if (!post || !post.published) return err("Post not found.", 404);
    return ok({ post });
  }

  const posts = await prisma.blogPost.findMany({
    where:   { published: true, ...(tag ? { tag } : {}) },
    orderBy: { publishedAt: "desc" },
    take:    limit,
    select:  { id: true, slug: true, title: true, excerpt: true, tag: true, authorName: true, publishedAt: true, readMinutes: true },
  });

  return ok({ posts });
}

export async function POST(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, postSchema);
  if (error) return err("Validation failed", 400, error);

  const slug = data.slug || toSlug(data.title);
  const existing = await prisma.blogPost.findUnique({ where: { slug } });
  if (existing) return err(`Slug "${slug}" is already in use.`, 409);

  const post = await prisma.blogPost.create({
    data: {
      ...data,
      slug,
      publishedAt: data.published ? new Date() : null,
    },
  });

  return ok({ post, message: "Blog post created." }, 201);
}

export async function PATCH(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return err("Post ID required.", 400);

  const { data, error } = await parseBody(request, postSchema.partial());
  if (error) return err("Validation failed", 400, error);

  const existing = await prisma.blogPost.findUnique({ where: { id } });
  if (!existing) return err("Post not found.", 404);

  // Set publishedAt when first publishing
  const publishedAt = data.published && !existing.published ? new Date() : existing.publishedAt;

  const post = await prisma.blogPost.update({
    where: { id },
    data:  { ...data, publishedAt },
  });

  return ok({ post, message: "Post updated." });
}

export async function DELETE(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return err("Post ID required.", 400);

  await prisma.blogPost.delete({ where: { id } });
  return ok({ message: "Post deleted." });
}
