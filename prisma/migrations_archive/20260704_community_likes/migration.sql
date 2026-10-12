-- Community likes — per-user dedup table
-- Without this, "likes" could only ever be a raw, unauthenticated counter
-- that anyone could inflate by repeated clicks, and there was no way to
-- know whether the current viewer had already liked a post (so a page
-- refresh would silently let them like it again).

CREATE TABLE IF NOT EXISTS "CommunityLike" (
  "id"        TEXT NOT NULL,
  "postId"    TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunityLike_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "CommunityLike" ADD CONSTRAINT "CommunityLike_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CommunityLike" ADD CONSTRAINT "CommunityLike_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "CommunityLike_postId_userId_key" ON "CommunityLike"("postId", "userId");
CREATE INDEX IF NOT EXISTS "CommunityLike_postId_idx" ON "CommunityLike"("postId");
CREATE INDEX IF NOT EXISTS "CommunityLike_userId_idx" ON "CommunityLike"("userId");
