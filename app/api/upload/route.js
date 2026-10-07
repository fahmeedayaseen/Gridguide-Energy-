import { authenticateRequest } from "@/lib/jwt.js";
import { uploadFile, uploadFiles } from "@/lib/upload.js";
import { ok, err } from "@/lib/auth.js";
import { rateLimit } from "@/lib/redis.js";
import { logger } from "@/lib/sentry.js";

// Folder mapping per upload context
const FOLDERS = {
  // Verification documents — private S3, admin-only access
  license:          "verification/licenses",
  insurance:        "verification/insurance",
  tax:              "verification/tax",
  background:       "verification/background",
  // Utility bills — private S3 (contain account numbers, service address)
  bill:             "utility-bills",
  // Product content — public CDN
  product:          "products",
  avatar:           "avatars",
};

const ALLOWED_CONTEXTS = Object.keys(FOLDERS);

/**
 * POST /api/upload?context=license
 * Content-Type: multipart/form-data
 * Field: file  (single) | files (multiple, for products)
 */
export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  // Rate limit: 20 uploads per hour per user
  const { allowed } = await rateLimit(`upload:${auth.user.id}`, 20, 3600);
  if (!allowed) return err("Upload rate limit reached. Try again in an hour.", 429);

  const { searchParams } = new URL(request.url);
  const context = searchParams.get("context") || "product";

  if (!ALLOWED_CONTEXTS.includes(context)) {
    return err(`Invalid upload context. Must be one of: ${ALLOWED_CONTEXTS.join(", ")}`, 400);
  }

  // Restrict verification uploads to sellers/installers/admins
  const verificationContexts = ["license","insurance","tax","background"];
  if (verificationContexts.includes(context) && !["SELLER","INSTALLER","ADMIN"].includes(auth.user.role)) {
    return err("Only sellers and installers can upload verification documents.", 403);
  }

  const folder = FOLDERS[context];

  try {
    const formData = await request.formData();

    // Handle single file
    const single = formData.get("file");
    if (single && typeof single !== "string") {
      const result = await uploadFile(single, folder);
      logger.info("File uploaded", { userId: auth.user.id, context, key: result.key });
      return ok({ file: result }, 201);
    }

    // Handle multiple files (product images)
    const multiple = formData.getAll("files");
    if (multiple.length) {
      if (multiple.length > 10) return err("Maximum 10 files per upload", 400);

      const results = await uploadFiles(multiple, folder);
      logger.info("Files uploaded", { userId: auth.user.id, context, count: results.length });
      return ok({ files: results }, 201);
    }

    return err("No file provided. Send a 'file' or 'files' field in multipart/form-data.", 400);

  } catch (uploadErr) {
    logger.error("Upload failed", { userId: auth.user.id, context, error: uploadErr.message });
    return err(uploadErr.message || "Upload failed", 500);
  }
}

/**
 * DELETE /api/upload?key=uploads/abc123.pdf
 * Removes a file from S3 (admin or owner only)
 */
export async function DELETE(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  if (auth.user.role !== "ADMIN") return err("Only admins can delete uploaded files.", 403);

  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  if (!key) return err("key required", 400);

  const { deleteFile } = await import("@/lib/upload.js");
  await deleteFile(key);

  return ok({ message: "File deleted." });
}
