import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuid } from "uuid";

const s3 = new S3Client({
  region:      process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.AWS_S3_BUCKET || "gridguide-uploads";
const CDN    = process.env.AWS_CDN_URL   || `https://${BUCKET}.s3.amazonaws.com`;

// ─── Allowed file types ────────────────────────────────────────────────────────
const ALLOWED_TYPES = {
  "image/jpeg":       "jpg",
  "image/png":        "png",
  "image/webp":       "webp",
  "application/pdf":  "pdf",
};

const MAX_SIZE_MB = 10;
const MAX_SIZE    = MAX_SIZE_MB * 1024 * 1024;

// ─── Upload to S3 ─────────────────────────────────────────────────────────────
export async function uploadFile(file, folder = "uploads") {
  if (!ALLOWED_TYPES[file.type]) {
    throw new Error(`File type ${file.type} not allowed. Use JPG, PNG, WEBP, or PDF.`);
  }
  if (file.size > MAX_SIZE) {
    throw new Error(`File too large. Maximum size is ${MAX_SIZE_MB}MB.`);
  }

  const ext  = ALLOWED_TYPES[file.type];
  const key  = `${folder}/${uuid()}.${ext}`;
  const body = Buffer.from(await file.arrayBuffer());

  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         key,
    Body:        body,
    ContentType: file.type,
    ACL:         "private", // documents are private; product images are public
  }));

  return { key, url: `${CDN}/${key}` };
}

// ─── Upload multiple files ─────────────────────────────────────────────────────
export async function uploadFiles(files, folder = "uploads") {
  return Promise.all(Array.from(files).map((f) => uploadFile(f, folder)));
}

// ─── Generate presigned URL (for viewing private docs in admin) ────────────────
export async function getPresignedUrl(key, expiresIn = 3600) {
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn }
  );
}

// ─── Delete file ──────────────────────────────────────────────────────────────
export async function deleteFile(key) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

// ─── Parse multipart form upload in Next.js route handler ─────────────────────
export async function parseUpload(request, fieldName = "file", folder = "uploads") {
  try {
    const formData = await request.formData();
    const file = formData.get(fieldName);
    if (!file || typeof file === "string") {
      return { error: "No file uploaded" };
    }
    const result = await uploadFile(file, folder);
    return { data: result };
  } catch (err) {
    return { error: err.message };
  }
}

export async function parseMultipleUploads(request, fieldName = "files", folder = "uploads") {
  try {
    const formData = await request.formData();
    const files    = formData.getAll(fieldName);
    if (!files.length) return { error: "No files uploaded" };
    const results  = await uploadFiles(files, folder);
    return { data: results };
  } catch (err) {
    return { error: err.message };
  }
}
