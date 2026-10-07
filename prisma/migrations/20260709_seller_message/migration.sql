-- GridGuide Seller Messaging
-- Migration: 20260709_seller_message
--
-- Adds SellerMessage model for buyer-to-seller product inquiries.
-- Threaded per product per buyer. Sellers see messages in their portal
-- Messages tab; buyers can message from the marketplace product page.

CREATE TABLE IF NOT EXISTS "SellerMessage" (
  "id"        TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "sellerId"  TEXT NOT NULL REFERENCES "Seller"("id") ON DELETE CASCADE,
  "buyerId"   TEXT NOT NULL REFERENCES "User"("id"),
  "productId" TEXT REFERENCES "Product"("id"),
  "body"      TEXT NOT NULL,
  "read"      BOOLEAN NOT NULL DEFAULT false,
  "replyTo"   TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "SellerMessage_sellerId_createdAt_idx" ON "SellerMessage"("sellerId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "SellerMessage_buyerId_idx"            ON "SellerMessage"("buyerId");
