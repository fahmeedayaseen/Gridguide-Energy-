import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z } from "zod";

const reviewSchema = z.object({
  installerId: z.string(),
  rating:      z.number().int().min(1).max(5),
  comment:     z.string().min(10).max(1000).optional(),
  jobType:     z.string().optional(),
});

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const installerId = searchParams.get("installerId");
  if (!installerId) return err("installerId required", 400);

  const reviews = await prisma.installerReview.findMany({
    where: { installerId, verified: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const avg = reviews.length
    ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
    : 0;

  return ok({ reviews, average: Math.round(avg * 10) / 10, total: reviews.length });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, reviewSchema);
  if (error) return err("Validation failed", 400, error);

  // Verify user has a completed job with this installer
  const job = await prisma.job.findFirst({
    where: {
      installerId: data.installerId,
      status:      "COMPLETED",
      lead:        { customerEmail: auth.user.email },
    },
  });

  // In production require verified: !!job — for now accept all
  const review = await prisma.installerReview.create({
    data: {
      installerId: data.installerId,
      rating:      data.rating,
      comment:     data.comment,
      jobType:     data.jobType,
      verified:    !!job,
    },
  });

  // Recalculate installer rating
  const allReviews = await prisma.installerReview.findMany({
    where:  { installerId: data.installerId },
    select: { rating: true },
  });
  const avg = allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length;

  await prisma.installer.update({
    where: { id: data.installerId },
    data:  { rating: Math.round(avg * 10) / 10, reviewCount: allReviews.length },
  });

  return ok({ review }, 201);
}
